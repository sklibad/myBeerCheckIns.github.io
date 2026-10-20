"""Regenerate every data file the website reads from database.csv.

Replaces the notebooks Create_check_ins_dict.ipynb and cartograms_data.ipynb
(including the dictionaries they only printed and that had to be pasted into
map1-3.js by hand).

Usage (from the repository root):
    python tools/build_data.py
    python tools/build_data.py --csv path/to/database.csv --boundaries C:/untappd_app

Writes:
    data.js, stats_data.js, map1.js, map2.js, map3.js    (read by the pages)
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

from round_coordinates import round_coordinates

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PAGES = ['index.html', 'beer_terminology.html', 'map1.html', 'map2.html',
              'map3.html', 'map4.html', 'statistics.html']
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
    pattern = re.compile(r'\?v=(\d+)"')
    pages = [os.path.join(repo, p) for p in HTML_PAGES]
    texts = {}
    for page in pages:
        with open(page, encoding='utf-8', newline='') as f:
            texts[page] = f.read()
    current = max(int(v) for t in texts.values() for v in pattern.findall(t))
    for page, text in texts.items():
        with open(page, 'w', encoding='utf-8', newline='') as f:
            f.write(pattern.sub(f'?v={current + 1}"', text))
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
