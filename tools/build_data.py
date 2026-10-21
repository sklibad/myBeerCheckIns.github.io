"""Regenerate every data file the website reads from database.csv.

Replaces the notebooks Create_check_ins_dict.ipynb and cartograms_data.ipynb
(including the dictionaries they only printed and that had to be pasted into
map1-3.js by hand).

Usage (from the repository root):
    python tools/build_data.py
    python tools/build_data.py --csv path/to/database.csv --boundaries C:/untappd_app

Writes:
    data.js, stats_data.js, map1.js, map2.js, map3.js,
    place_years.js, circles.js                            (read by the pages)
    check_ins.txt, venue_check_ins.txt, brewery_check_ins.txt,
    venues.geojson, breweries.geojson, *_cartogram.geojson  (intermediate outputs)
and bumps the ?v=N asset version in the HTML pages when a JS file changed.

Needs pandas and geopandas.
"""
import argparse
import json
import math
import os
import re
import sys
import tempfile

import warnings

import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString, Point
from shapely.ops import polylabel, unary_union
from shapely.validation import make_valid

from round_coordinates import round_coordinates

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PAGES = ['cartograms.html', 'map4.html', 'statistics.html']
REQUIRED = ['ID', 'Beer', 'Brewery', 'Brewery_location', 'Venue', 'Venue_location', 'Date']


# ---------------------------------------------------------------- check-ins

def load_database(path):
    df = pd.read_csv(path, sep=',', encoding='utf-8-sig')
    # rows left completely empty by spreadsheet editors
    df = df.dropna(how='all').reset_index(drop=True)

    incomplete = df[df[REQUIRED].isna().any(axis=1)]
    if len(incomplete):
        lines = []
        for row_index, row in incomplete.iterrows():
            missing = ', '.join(c for c in REQUIRED if pd.isna(row[c]))
            lines.append(f'  CSV line {row_index + 2}: missing {missing}')
        sys.exit('database.csv has incomplete check-ins:\n' + '\n'.join(lines))

    for column in ('Brewery_location', 'Venue_location'):
        bad = ~df[column].str.match(r'^\s*-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?\s*$')
        if bad.any():
            sys.exit(f'Unreadable {column} on CSV line(s): ' +
                     ', '.join(str(i + 2) for i in df.index[bad]))

    df['ID'] = df['ID'].astype(int)
    duplicates = df['ID'][df['ID'].duplicated()].unique()
    if len(duplicates):
        print('Warning: duplicate check-in IDs:', ', '.join(map(str, duplicates)))

    # full-size photos instead of 640x640 previews
    df['Photo_url'] = df['Photo_url'].str.replace('640x640', 'raw', regex=False)
    return df


def clean_value(value):
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, 'item'):  # numpy scalar
        return value.item()
    return value


def check_in_records(df):
    records = []
    for row in df.to_dict(orient='records'):
        record = {key: clean_value(value) for key, value in row.items()}
        friends = record['Friends']
        record['Friends'] = [f.strip() for f in friends.split(',')] if friends else []
        records.append(record)
    return records


def group_check_ins(records, key):
    """{place: [check-in without the place field, ...]} sorted by beer name"""
    groups = {}
    for record in records:
        rest = {k: v for k, v in record.items() if k != key}
        groups.setdefault(record[key], []).append(rest)
    return {place: sorted(items, key=lambda x: str(x['Beer']).lower())
            for place, items in groups.items()}


def place_years(records, key):
    """{place: {year: number of check-ins}} with years in order"""
    result = {}
    for record in records:
        years = result.setdefault(record[key], {})
        year = record['Date'][-4:]
        years[year] = years.get(year, 0) + 1
    return {place: dict(sorted(years.items())) for place, years in sorted(result.items())}


# ---------------------------------------------------------------- geography

def points(df, location_column):
    lat_lon = df[location_column].str.split(',', expand=True).astype(float)
    geometry = gpd.points_from_xy(lat_lon[1], lat_lon[0], crs='EPSG:4326')
    return gpd.GeoDataFrame(df.drop(columns=location_column), geometry=geometry)


def read_boundaries(path, name_column):
    gdf = gpd.read_file(path)[[name_column, 'geometry']]
    # invisible soft hyphens (e.g. in "Ústí nad Labem") would break name lookups
    gdf[name_column] = gdf[name_column].str.replace('\u00ad', '', regex=False)
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs('EPSG:4326')
    return gdf


def add_count(polygons, name_column, counts, column):
    counts = counts.reset_index(name=column)
    polygons = polygons.merge(counts, on=name_column, how='left')
    polygons[column] = polygons[column].fillna(0)
    return polygons


def count_inside(polygons, name_column, places, column):
    joined = gpd.sjoin(polygons, places, how='left')
    return add_count(polygons, name_column, joined.groupby(name_column)['ID'].count(), column)


def add_density(polygons, crs, area_column, divisor):
    polygons[area_column] = polygons.to_crs(crs).geometry.area / divisor
    polygons['cart_brew'] = polygons['breweries'] / polygons[area_column]
    polygons['cart_check'] = polygons['check_ins'] / polygons[area_column]
    return polygons


def assign_admin_with_fallback(places, polygons, admin_column='ADMIN'):
    """Country of every place: the polygon it lies in, else the nearest one
    (places on the coast or on small islands missing from the generalized map)."""
    joined = gpd.sjoin(places, polygons[[admin_column, 'geometry']],
                       how='left', predicate='intersects')
    missing = joined[admin_column].isna()
    if missing.any():
        # distances in degrees are good enough to pick the nearest country
        warnings.filterwarnings('ignore', 'Geometry is in a geographic CRS', UserWarning)
        nearest = gpd.sjoin_nearest(places.loc[joined.index[missing]],
                                    polygons[[admin_column, 'geometry']], how='left')
        joined.loc[missing, admin_column] = nearest[admin_column].values
    return joined


def places_within(polygons, name_column, places, place_column):
    """{polygon name: [places inside]} for polygons with at least one place"""
    result = {}
    for _, polygon in polygons.iterrows():
        inside = places[places.geometry.within(polygon['geometry'])][place_column].tolist()
        if inside:
            result[polygon[name_column]] = inside
    return result


def places_by_country(places, polygons, place_column):
    assigned = assign_admin_with_fallback(places, polygons)
    return (assigned.dropna(subset=['ADMIN'])
            .groupby('ADMIN')[place_column].apply(list).to_dict())


def build_cartograms(df, boundaries):
    breweries = points(df, 'Brewery_location').drop_duplicates(subset='Brewery')
    check_ins = points(df, 'Venue_location')
    venues = check_ins.drop_duplicates(subset='Venue')

    praha = read_boundaries(os.path.join(boundaries, 'leaflet_Prague', 'prague_detailed.geojson'), 'NAME_2')
    okresy = read_boundaries(os.path.join(boundaries, 'leaflet_Czechia', 'okresy.geojson'), 'NAME_2')
    kraje = read_boundaries(os.path.join(boundaries, 'leaflet_Czechia', 'kraje.geojson'), 'NAME_1')
    svet = read_boundaries(os.path.join(boundaries, 'leaflet_World', 'generalized_world.geojson'), 'ADMIN')

    # check-ins and breweries per area (areas in 10 / 1000 / 10 000 km2)
    def czech_cartogram(polygons, column, area_column, divisor):
        polygons = count_inside(polygons, column, check_ins, 'check_ins')
        polygons = count_inside(polygons, column, breweries, 'breweries')
        return add_density(polygons, 'EPSG:32633', area_column, divisor)

    praha = czech_cartogram(praha, 'NAME_2', 'area_10km', 10_000_000)
    okresy = czech_cartogram(okresy, 'NAME_2', 'area_1000km', 1_000_000_000)
    kraje = czech_cartogram(kraje, 'NAME_1', 'area_1000km', 1_000_000_000)
    kraje = kraje.rename(columns={'NAME_1': 'NAME_2'})

    world = svet
    world = add_count(world, 'ADMIN',
                      assign_admin_with_fallback(check_ins, svet).groupby('ADMIN')['ID'].count(), 'check_ins')
    world = add_count(world, 'ADMIN',
                      assign_admin_with_fallback(breweries, svet).groupby('ADMIN')['ID'].count(), 'breweries')
    world = add_density(world, 'EPSG:6933', 'area_10000km', 100_000_000_000)

    return {
        'venues': venues[['Venue', 'geometry']],
        'breweries': breweries[['Brewery', 'geometry']],
        'prague_cartogram': praha,
        'okresy_cartogram': okresy,
        'kraje_cartogram': kraje,
        'countries_cartogram': world,
        'pragueVenues': places_within(praha, 'NAME_2', venues, 'Venue'),
        'pragueBreweries': places_within(praha, 'NAME_2', breweries, 'Brewery'),
        'czechVenues': places_within(okresy, 'NAME_2', venues, 'Venue'),
        'czechBreweries': places_within(okresy, 'NAME_2', breweries, 'Brewery'),
        'krajeCheckIns': places_within(kraje, 'NAME_2', venues, 'Venue'),
        'krajeBreweries': places_within(kraje, 'NAME_2', breweries, 'Brewery'),
        'countryVenues': places_by_country(venues, svet, 'Venue'),
        'countryBreweries': places_by_country(breweries, svet, 'Brewery'),
    }


# ---------------------------------------------------------------- proportional circles

# Circles of the "Total" view of the cartograms (Prague and Czechia), area ~ count. One size
# scale for all years (switching the years shows the growth). The scale: as large as possible
# while CIRCLE_INSIDE_SHARE of the all-time circles still fit their areas, but the smallest
# circle at least CIRCLE_MIN_PX and the largest at most CIRCLE_MAX_PX (at the reference zoom).
# Every area gets its pole of inaccessibility and the room around it; the page puts a circle on
# the pole while it fits (decided for the shown year and zoom). For the circles that do not fit
# all time, a spot outside the territory is chosen once, as close as possible and preferably
# where the leader line crosses no other line or circle; in every year such a circle grows from
# that same spot. A desktop layout and one for phones (half a zoom level lower, larger circles
# against the areas) unless that pushes more than two extra circles out.
# Everything is in Web Mercator metres, the units the map is drawn in.
CIRCLE_MIN_PX = 3
CIRCLE_MAX_PX = 70
CIRCLE_INSIDE_SHARE = 0.75
CIRCLE_MAX_OUTSIDE = 6       # and never more circles than this out of their areas (leader lines)
CIRCLE_FIT_GAP_PX = 1      # a circle fits its area with this much room to the border
CIRCLE_GAP_PX = 3          # circles outside keep this distance to the territory and each other
WORLD_MERCATOR = 40075016.686


def mercator_per_pixel(zoom):
    return WORLD_MERCATOR / (256 * 2 ** zoom)


def largest_polygon(geometry):
    geometry = make_valid(geometry)
    parts = [g for g in getattr(geometry, 'geoms', [geometry]) if g.geom_type == 'Polygon']
    return max(parts, key=lambda g: g.area)


def to_lat_lng(points):
    series = gpd.GeoSeries(points, crs='EPSG:3857').to_crs('EPSG:4326')
    return [[round(p.y, 5), round(p.x, 5)] for p in series]


def place_outside(territory, fixed, outside, unit):
    """Positions {name: point} outside the territory for [(radius, name, pole)], largest first.
    fixed: [(centre, radius)] of the circles inside their areas"""
    gap = CIRCLE_GAP_PX * unit
    placed, leaders, result = [], [], {}
    for radius, name, pole in sorted(outside, reverse=True):
        best = None
        step = max(radius / 3, unit * 2)
        for angle in range(0, 360, 5):
            dx, dy = math.cos(math.radians(angle)), math.sin(math.radians(angle))
            t = step
            while t < 40 * radius + 200 * unit:
                centre = Point(pole.x + dx * t, pole.y + dy * t)
                if (centre.distance(territory) >= radius + gap and
                        all(centre.distance(c) >= radius + r + gap for c, r in placed)):
                    break
                t += step
            else:
                continue
            # leader lines crossing other leaders or running over other circles come last
            leader = LineString([pole, centre])
            conflicts = sum(1 for other in leaders if leader.crosses(other))
            conflicts += sum(1 for c, r in placed + fixed if c.distance(pole) > 1 and leader.distance(c) < r)
            score = (conflicts, t)
            if best is None or score < best[0]:
                best = (score, centre, leader)
        if best:
            placed.append((best[1], radius))
            leaders.append(best[2])
            result[name] = best[1]
    return result


def circle_scale(counts, rooms, unit):
    """Metres per sqrt(count): the largest scale with CIRCLE_INSIDE_SHARE of the circles fitting
    (and at most CIRCLE_MAX_OUTSIDE not),
    kept between the CIRCLE_MIN_PX smallest and CIRCLE_MAX_PX largest circle"""
    gap = CIRCLE_FIT_GAP_PX * unit
    ratios = sorted((rooms[name] - gap) / math.sqrt(count) for name, count in counts.items())
    share = max(CIRCLE_INSIDE_SHARE, 1 - CIRCLE_MAX_OUTSIDE / len(ratios))
    fit = ratios[min(len(ratios) - 1, int(len(ratios) * (1 - share)))]
    smallest = CIRCLE_MIN_PX * unit / math.sqrt(min(counts.values()))
    largest = CIRCLE_MAX_PX * unit / math.sqrt(max(counts.values()))
    return max(smallest, min(fit, largest))


def area_circles(polygons, places, years_of, zooms, min_scales=None):
    """circles.js entry of one area set: {"poles": {name: [lat, lng, room in metres]},
    profile: {"zoom": z, metric: {"scale": metres per sqrt(count), "outside": {name: [lat, lng]}}}}
    min_scales: {profile: {metric: scale}} the scale must not go below (larger areas, larger circles)"""
    projected = polygons.to_crs('EPSG:3857')
    tolerance = mercator_per_pixel(max(zooms.values())) / 2
    poles, rooms = {}, {}
    for _, row in projected.iterrows():
        polygon = largest_polygon(row.geometry)
        pole = polylabel(polygon, tolerance=tolerance)
        poles[row['NAME_2']] = pole
        rooms[row['NAME_2']] = polygon.boundary.distance(pole)
    territory = unary_union([make_valid(g) for g in projected.geometry])

    def all_time_counts(metric):
        result = {}
        for name in poles:
            total = 0
            for place in places[metric].get(name, []):
                n = sum(years_of[metric].get(place, {}).values())
                total += n if metric == 'checkIns' else (1 if n else 0)
            if total:
                result[name] = total
        return result

    names = list(poles)
    entry = {'poles': {name: ll + [round(rooms[name])] for name, ll in zip(names, to_lat_lng([poles[n] for n in names]))}}
    for profile, zoom in zooms.items():
        unit = mercator_per_pixel(zoom)
        simple = territory.simplify(unit / 2)
        entry[profile] = {'zoom': zoom}
        for metric in ('checkIns', 'breweries'):
            counts = all_time_counts(metric)
            if not counts:
                entry[profile][metric] = {'scale': 0, 'outside': {}}
                continue
            scale = circle_scale(counts, rooms, unit)
            if min_scales:
                scale = max(scale, min_scales[profile][metric])
            fixed, outside = [], []
            for name, count in counts.items():
                radius = scale * math.sqrt(count)
                if radius + CIRCLE_FIT_GAP_PX * unit <= rooms[name]:
                    fixed.append((poles[name], radius))
                else:
                    outside.append((radius, name, poles[name]))
            spots = place_outside(simple, fixed, outside, unit)
            ordered = sorted(spots)
            entry[profile][metric] = {
                'scale': round(scale, 3),
                'outside': dict(zip(ordered, to_lat_lng([spots[n] for n in ordered]))) if ordered else {}
            }

    # The larger phone circles only where they push at most two more circles out of their areas
    def most_outside(profile):
        return max(len(entry[profile][metric]['outside']) for metric in ('checkIns', 'breweries'))
    if 'phone' in entry and most_outside('phone') > most_outside('desktop') + 2:
        entry['phone'] = entry['desktop']
    return entry


def build_circles(geo, records):
    """areaCircles for circles.js, keyed by "<region>/<area set>"."""
    years_of = {'checkIns': place_years(records, 'Venue'), 'breweries': place_years(records, 'Brewery')}
    sets = {
        'prague/districts': (geo['prague_cartogram'], geo['pragueVenues'], geo['pragueBreweries'], 11),
        'czechia/districts': (geo['okresy_cartogram'], geo['czechVenues'], geo['czechBreweries'], 7),
        'czechia/regions': (geo['kraje_cartogram'], geo['krajeCheckIns'], geo['krajeBreweries'], 7),
    }
    result = {}
    for key, (polygons, venues, breweries, zoom) in sets.items():
        # the regions of Czechia never get smaller circles than its districts
        minimum = None
        if key == 'czechia/regions':
            districts = result.get('czechia/districts')
            minimum = {profile: {metric: districts[profile][metric]['scale'] for metric in ('checkIns', 'breweries')}
                       for profile in ('desktop', 'phone')}
        result[key] = area_circles(polygons, {'checkIns': venues, 'breweries': breweries}, years_of,
                                   {'desktop': zoom, 'phone': zoom - 0.5}, minimum)
    return result


# ---------------------------------------------------------------- output

def geojson_text(gdf, path):
    """GeoJSON as written by GDAL (one feature per line); also saved to path"""
    with tempfile.TemporaryDirectory() as folder:
        temp = os.path.join(folder, os.path.basename(path))
        gdf.to_file(temp, driver='GeoJSON')
        with open(temp, encoding='utf-8') as f:
            text = f.read().strip()
    write_text(path, text + '\n')
    return text


def js_dict(d):
    lines = [f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}'
             for k, v in d.items()]
    return '{\n' + ',\n'.join(lines) + '\n}'


def js_file(variables):
    """variables: [(name, JavaScript literal), ...]"""
    return ''.join(f'var {name} = {value};\n\n' for name, value in variables)


def write_text(path, text):
    """Write keeping the file's line endings (LF for new files);
    returns True when the content changed"""
    old = None
    if os.path.exists(path):
        with open(path, encoding='utf-8', newline='') as f:
            old = f.read()
        if '\r\n' in old:
            text = text.replace('\n', '\r\n')
    if old == text:
        return False
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)
    return True


def bump_asset_version(repo):
    # "...css?v=31" in tags, 'map1.js?v=31' in the cartograms.html script
    pattern = re.compile(r'\?v=(\d+)(["\'])')
    pages = [os.path.join(repo, p) for p in HTML_PAGES]
    texts = {}
    for page in pages:
        with open(page, encoding='utf-8', newline='') as f:
            texts[page] = f.read()
    current = max(int(m.group(1)) for t in texts.values() for m in pattern.finditer(t))
    for page, text in texts.items():
        with open(page, 'w', encoding='utf-8', newline='') as f:
            f.write(pattern.sub(lambda m: f'?v={current + 1}' + m.group(2), text))
    return current + 1


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--csv', default=os.path.join(REPO, 'database.csv'),
                        help='check-in export (default: database.csv in the repository)')
    parser.add_argument('--boundaries', default=os.path.dirname(REPO),
                        help='folder with leaflet_Prague, leaflet_Czechia, leaflet_World '
                             '(default: parent of the repository)')
    parser.add_argument('--out', default=REPO, help='output folder (default: the repository)')
    parser.add_argument('--no-bump', action='store_true',
                        help='do not bump the ?v=N asset version in the HTML pages')
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)

    def out(name):
        return os.path.join(args.out, name)

    df = load_database(args.csv)
    records = check_in_records(df)
    venue_check_ins = group_check_ins(records, 'Venue')
    brewery_check_ins = group_check_ins(records, 'Brewery')
    print(f'{len(records)} check-ins, {len(venue_check_ins)} venues, {len(brewery_check_ins)} breweries')

    def dump(value):
        return json.dumps(value, ensure_ascii=False, indent=4)

    write_text(out('check_ins.txt'), dump(records))
    write_text(out('venue_check_ins.txt'), dump(venue_check_ins))
    write_text(out('brewery_check_ins.txt'), dump(brewery_check_ins))

    geo = build_cartograms(df, args.boundaries)
    gj = {name: geojson_text(geo[name], out(name + '.geojson'))
          for name in ('venues', 'breweries', 'prague_cartogram', 'okresy_cartogram',
                       'kraje_cartogram', 'countries_cartogram')}

    def collection(name):
        return '[' + gj[name] + '\n]'

    js_files = {
        'data.js': [('venues_lst', collection('venues')),
                    ('breweries_lst', collection('breweries')),
                    ('venue_check_ins', dump(venue_check_ins)),
                    ('brewery_check_ins', dump(brewery_check_ins))],
        'stats_data.js': [('data', dump(records))],
        'map1.js': [('prague_cartogram', collection('prague_cartogram')),
                    ('pragueVenues', js_dict(geo['pragueVenues'])),
                    ('pragueBreweries', js_dict(geo['pragueBreweries']))],
        'map2.js': [('kraje', collection('kraje_cartogram')),
                    ('okresy', collection('okresy_cartogram')),
                    ('czechVenues', js_dict(geo['czechVenues'])),
                    ('czechBreweries', js_dict(geo['czechBreweries'])),
                    ('krajeBreweries', js_dict(geo['krajeBreweries'])),
                    ('krajeCheckIns', js_dict(geo['krajeCheckIns']))],
        'map3.js': [('countries', collection('countries_cartogram')),
                    ('breweries', js_dict(geo['countryBreweries'])),
                    ('venues', js_dict(geo['countryVenues']))],
        # check-ins per year of every place, for the year filter of the cartograms
        'place_years.js': [('venueYears', js_dict(place_years(records, 'Venue'))),
                           ('breweryYears', js_dict(place_years(records, 'Brewery')))],
        # positions and size scale of the proportional circles ("Total" view of the cartograms)
        'circles.js': [('areaCircles', json.dumps(build_circles(geo, records), ensure_ascii=False, indent=1))],
    }
    changed = []
    for name, variables in js_files.items():
        text = round_coordinates(js_file(variables))
        if write_text(out(name), text):
            changed.append(name)
        print(f'{name}: {len(text.encode()):,} bytes')

    if not changed:
        print('No JS data file changed.')
    elif args.no_bump or os.path.abspath(args.out) != REPO:
        print('Changed:', ', '.join(changed))
    else:
        version = bump_asset_version(REPO)
        print('Changed:', ', '.join(changed), f'- asset version bumped to ?v={version}')


if __name__ == '__main__':
    main()
