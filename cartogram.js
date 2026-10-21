// Shared code of the cartogram pages (map1–3.html). Each page only calls
// initCartogram() with its areas; map, controls, popups and legend are built here
// in the same style as the check-in map (map4.html).

// Devices without a mouse (phones, tablets) cannot hover
var isTouchDevice = window.matchMedia('(hover: none)').matches;

function isSmallScreen() {
    return window.innerWidth <= 760;
}

// ---------- Classification of the cartogram values ----------

var NO_VALUE_COLOR = '#d7d7d7';

// ColorBrewer YlOrBr with the lightest colour left out, so even the first class
// stands out from the grey "0" areas and the basemap; index = number of classes
var CLASS_COLORS = {
    2: ['#fec44f', '#d95f0e'],
    3: ['#fed98e', '#fe9929', '#cc4c02'],
    4: ['#fed98e', '#fe9929', '#d95f0e', '#993404'],
    5: ['#fee391', '#fec44f', '#fe9929', '#d95f0e', '#993404'],
    6: ['#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#8c2d04']
};

// Jenks natural breaks of sorted values into k classes: returns the index
// where each class after the first starts (dynamic programming, O(k·n²))
function naturalBreaks(values, k) {
    var n = values.length;
    var sum = [0], sumSq = [0];
    values.forEach(function (v, i) {
        sum.push(sum[i] + v);
        sumSq.push(sumSq[i] + v * v);
    });
    // squared deviations of values[i..j)
    function deviation(i, j) {
        var s = sum[j] - sum[i];
        return sumSq[j] - sumSq[i] - s * s / (j - i);
    }

    var cost = [[0]], start = [[0]];
    for (var c = 1; c <= k; c++) {
        cost[c] = [];
        start[c] = [];
        for (var j = c; j <= n; j++) {
            cost[c][j] = Infinity;
            for (var i = c - 1; i < j; i++) {
                var value = cost[c - 1][i] + deviation(i, j);
                if (value < cost[c][j]) {
                    cost[c][j] = value;
                    start[c][j] = i;
                }
            }
        }
    }

    var starts = [];
    for (var cls = k, end = n; cls > 1; cls--) {
        end = start[cls][end];
        starts.unshift(end);
    }
    return { starts: starts, deviation: cost[k][n] };
}

// End of a class: its largest value rounded up to as few significant digits as
// possible (9.64 -> 10, 43.3 -> 50, 1.02 -> 1.1) while the next class can still
// start one step later, at most at its smallest value; null if nothing fits
function roundBreak(low, high, decimals) {
    var step = Math.pow(10, -decimals);
    var limit = Math.floor(high / step + 1e-9);         // in steps
    for (var digits = 1; ; digits++) {
        var unit = Math.max(1, Math.round(Math.pow(10, Math.floor(Math.log10(low)) - digits + 1) / step));
        var t = Math.ceil(low / step / unit - 1e-9) * unit;
        if (t <= limit) return t * step;
        if (unit === 1) return null;
    }
}

// Legend bounds that follow each other without gaps (9.6 is followed by 9.7) and
// end on round numbers where the gap between two classes allows it. A break lies
// between the largest value of one class and the smallest of the next, so the
// classes keep their areas. All numbers get the same decimals: 0 when all values
// are at least 10, 1 from 0.1, otherwise 2 – more if a break does not fit.
function classBounds(classes, hasZero) {
    var smallest = classes[0].min;
    var largest = classes[classes.length - 1].max;
    for (var d = smallest >= 10 ? 0 : smallest >= 0.1 ? 1 : 2; d <= 6; d++) {
        var step = Math.pow(10, -d);
        if (Number(smallest.toFixed(d)) < step) continue;   // the smallest value would show as 0
        var breaks = [];
        for (var i = 0; i < classes.length - 1; i++) {
            // the next class starts one step above the break, at most at its smallest value
            var t = roundBreak(classes[i].max, classes[i + 1].min - step, d);
            if (t === null || (breaks.length && t <= breaks[breaks.length - 1])) break;
            breaks.push(t);
        }
        if (breaks.length === classes.length - 1) {
            // after the grey "0" the first class starts one step above zero
            var first = hasZero ? step : Math.floor(smallest / step + 1e-9) * step;
            var last = Math.ceil(largest / step - 1e-9) * step;
            return { decimals: d, step: step, lower: first, breaks: breaks, upper: last };
        }
    }
    return null;
}

// Colour scale computed from the data. The values are very skewed (a few
// districts with hundreds of check-ins per area, most with a few), so the
// natural breaks are searched on log10 of the non-zero values; the number of
// classes is the smallest one explaining at least 90 % of the variance
// (goodness of variance fit), 3–6 classes. Zero gets its own grey class.
function choropleth(densities) {
    var all = densities.map(function (v) { return Number(v) || 0; });
    var values = all.filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    var hasZero = all.length > values.length;
    var logs = values.map(Math.log10);
    var distinct = new Set(values).size;

    var mean = logs.reduce(function (a, b) { return a + b; }, 0) / logs.length;
    var total = logs.reduce(function (a, v) { return a + (v - mean) * (v - mean); }, 0);
    var maxClasses = Math.min(6, distinct);
    var k = Math.min(3, maxClasses);
    var natural = naturalBreaks(logs, k);
    while (k < maxClasses && total > 0 && 1 - natural.deviation / total < 0.9) {
        k++;
        natural = naturalBreaks(logs, k);
    }

    var colors = CLASS_COLORS[Math.max(2, k)].slice(-k);
    var starts = [0].concat(natural.starts, [values.length]);
    var classes = [];
    for (var c = 0; c < k; c++) {
        classes.push({
            min: values[starts[c]],
            max: values[starts[c + 1] - 1],
            color: colors[c]
        });
    }
    var bounds = classes.length ? classBounds(classes, hasZero) : null;

    return {
        classes: classes,
        color: function (value) {
            value = Number(value) || 0;
            if (value <= 0 || !classes.length) return NO_VALUE_COLOR;
            for (var i = 0; i < classes.length - 1; i++) {
                if (value <= bounds.breaks[i]) return classes[i].color;
            }
            return classes[classes.length - 1].color;
        },
        // legend rows [{label, color}]: "0", then classes that follow each other
        legendItems: function () {
            var items = hasZero ? [{ label: '0', color: NO_VALUE_COLOR }] : [];
            if (!classes.length) return items;
            var d = bounds.decimals;
            var edges = [bounds.lower].concat(bounds.breaks.map(function (t) { return t + bounds.step; }));
            var ends = bounds.breaks.concat([bounds.upper]);
            classes.forEach(function (cls, i) {
                items.push({ label: edges[i].toFixed(d) + ' \u2013 ' + ends[i].toFixed(d), color: cls.color });
            });
            return items;
        }
    };
}

// ---------- Basemaps ----------

var AUTHOR_LINK = '<a href="https://www.linkedin.com/in/david-skliba/?locale=en_US" target="_blank">David Šklíba</a>';

// "Light" (Esri World Light Gray: grey without colours, labels on top) is the default: the
// class colours of the cartograms read much better on it than on the colourful OpenStreetMap
var ESRI_GRAY = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_';

function createBasemaps() {
    return {
        "Light": L.layerGroup([
            L.tileLayer(ESRI_GRAY + 'Base/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 19,
                maxNativeZoom: 16,
                attribution: 'Tiles &copy; <a href="https://www.esri.com" target="_blank">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors | ' + AUTHOR_LINK
            }),
            // place names above the coloured areas (pane created by initCartograms)
            L.tileLayer(ESRI_GRAY + 'Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 16, pane: 'cartoLabels' })
        ]),
        "OS Map": L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> | ' + AUTHOR_LINK
        }),
        "Imagery": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank">ESRI</a> | ' + AUTHOR_LINK
        }),
        "TopoMap": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            opacity: 0.5,
            attribution: '&copy; <a href="https://opentopomap.org/credits" target="_blank">OpenTopoMap</a> | ' + AUTHOR_LINK
        })
    };
}

// ---------- What can be shown ----------

var METRICS = {
    checkIns: {
        label: 'Check-ins',
        icon: 'ikony/pub.png',
        // venues of an area; the density counts all their check-ins
        years: function () { return venueYears; },
        emptyText: "I haven't discovered any venue here yet."
    },
    breweries: {
        label: 'Breweries',
        icon: 'ikony/beer.png',
        // breweries of an area; the density counts the breweries
        years: function () { return breweryYears; },
        emptyText: "I haven't tried any beer brewed here yet."
    }
};

function plural(count, word) {
    return count + ' ' + (count === 1 ? word : word.replace(/y$/, 'ie') + 's');
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// Places of an area with a check-in until the end of `year` (null = all time), their number
// of check-ins and the density: check-ins (or breweries) per area unit of the area set
function areaStats(metricId, places, properties, year) {
    var yearsOf = METRICS[metricId].years();
    var shown = [];
    var checkIns = 0;
    places.forEach(function (place) {
        var count = 0;
        var years = yearsOf[place] || {};
        Object.keys(years).forEach(function (y) {
            if (year === null || Number(y) <= year) count += years[y];
        });
        if (count) {
            shown.push(place);
            checkIns += count;
        }
    });
    var areaKey = Object.keys(properties).filter(function (key) { return key.indexOf('area_') === 0; })[0];
    var count = metricId === 'checkIns' ? checkIns : shown.length;
    return { places: shown, checkIns: checkIns, density: count / properties[areaKey] };
}

// "12.4" / "0.85" / "1366": about three significant digits
function formatDensity(value) {
    return value.toFixed(value >= 100 ? 0 : value >= 1 ? 1 : 2);
}

// 1st, 2nd, 3rd, 4th, 11th, 21st …
function ordinal(n) {
    var suffixes = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

// Popup like the venue / brewery popups of the check-in map: dark header with the
// area and counts (rank: e.g. "12.4 check-ins / 1 000 km² · 5th of 77 districts"),
// below it the list of places
function areaPopup(title, metricId, stats, rank) {
    var metric = METRICS[metricId];
    var places = stats.places;
    var sorted = places.slice().sort(function (a, b) { return a.localeCompare(b, 'cs'); });
    var subtitle = metricId === 'checkIns'
        ? plural(places.length, 'venue') + ' · ' + plural(stats.checkIns, 'check-in')
        : plural(places.length, 'brewery');

    var html = "<div class='popup-header'><span class='popup-title'>" + escapeHtml(title) + "</span>" +
        (sorted.length ? "<span class='popup-subtitle'>" + subtitle + "</span>" : '') +
        (rank ? "<span class='popup-subtitle popup-rank'>" + rank + "</span>" : '') + "</div>";
    if (sorted.length) {
        // every place opens the check-in map place view in a window over the cartogram
        // (openPlaceWindow); with Ctrl / middle click in a new tab
        var param = metricId === 'checkIns' ? 'venue' : 'brewery';
        html += "<ul class='popup-list'>" + sorted.map(function (place) {
            return '<li><a href="map4.html?' + param + '=' + encodeURIComponent(place) + '" target="_blank" rel="noopener" title="Show on the check-in map">' +
                escapeHtml(place) + '</a></li>';
        }).join('') + '</ul>';
    } else {
        html += "<p class='popup-empty'>" + metric.emptyText + "</p>";
    }
    return html;
}

// ---------- Place window ----------

// The check-in map place view (map4.html?venue=… / ?brewery=…) in a window over the cartogram;
// closing it returns to the cartogram exactly as it was
var placeWindow = null;

function openPlaceWindow(url, title) {
    if (!placeWindow) {
        var backdrop = document.createElement('div');
        backdrop.className = 'place-window-backdrop';
        backdrop.hidden = true;
        backdrop.innerHTML = '<div class="place-window" role="dialog" aria-modal="true" aria-labelledby="place-window-title">' +
            '<div class="place-window-header"><span class="place-window-title" id="place-window-title"></span>' +
            '<button type="button" class="place-window-close" aria-label="Close and return to the cartogram">&times;</button></div>' +
            '<iframe class="place-window-frame" title="Check-in map"></iframe></div>';
        document.body.appendChild(backdrop);
        placeWindow = {
            backdrop: backdrop,
            title: backdrop.querySelector('.place-window-title'),
            frame: backdrop.querySelector('iframe')
        };
        backdrop.querySelector('.place-window-close').addEventListener('click', closePlaceWindow);
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) closePlaceWindow();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closePlaceWindow();
        });
        // Escape pressed inside the check-in map closes the window too (same origin), unless it
        // closes the check-in detail sheet there first (checked in the capture phase, before
        // the check-in map handles the key)
        placeWindow.frame.addEventListener('load', function () {
            try {
                var doc = placeWindow.frame.contentWindow.document;
                doc.addEventListener('keydown', function (e) {
                    var sheet = doc.getElementById('contentBox');
                    if (e.key === 'Escape' && !(sheet && sheet.classList.contains('open'))) closePlaceWindow();
                }, true);
            } catch (err) { /* not reachable: Escape works outside the frame only */ }
        });
    }
    placeWindow.title.textContent = title;
    placeWindow.frame.src = url;
    placeWindow.backdrop.hidden = false;
    placeWindow.backdrop.querySelector('.place-window-close').focus();
}

function closePlaceWindow() {
    if (!placeWindow || placeWindow.backdrop.hidden) return;
    placeWindow.backdrop.hidden = true;
    placeWindow.frame.src = 'about:blank';
}

document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('.carto-popup .popup-list a');
    if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openPlaceWindow(link.getAttribute('href'), link.textContent);
});

// ---------- Legend ----------

var CartogramLegend = L.Control.extend({
    options: { position: 'bottomleft', collapsed: false },

    onAdd: function (map) {
        var container = L.DomUtil.create('div', 'carto-legend');
        container.classList.toggle('collapsed', this.options.collapsed);

        this._button = L.DomUtil.create('button', 'carto-legend-toggle', container);
        this._button.type = 'button';
        this._button.setAttribute('aria-label', 'Legend');
        this._button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="6" height="4" rx="1"/>' +
            '<rect x="3" y="10" width="6" height="4" rx="1"/><rect x="3" y="16" width="6" height="4" rx="1"/>' +
            '<path d="M12 6h9M12 12h9M12 18h9"/></svg>';
        this._panel = L.DomUtil.create('div', 'carto-legend-panel', container);

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        // Phones: a tap on the button opens the legend, a tap on it or on the map closes it
        if (this.options.collapsed) {
            container.classList.add('collapsible');
            L.DomEvent.on(container, 'click', function (e) {
                if (e.target.closest('.carto-coverage')) return;
                this.setOpen(container.classList.contains('collapsed'));
            }, this);
            map.on('click', function () { this.setOpen(false); }, this);
        }
        return container;
    },

    setOpen: function (open) {
        if (!this.options.collapsed) return;
        this.getContainer().classList.toggle('collapsed', !open);
        this._button.setAttribute('aria-expanded', open);
    },

    // Footer below the legend (coverage of the areas), kept when the legend is redrawn
    setCoverage: function (html) {
        var footer = this._panel.querySelector('.carto-coverage');
        if (!footer) footer = L.DomUtil.create('div', 'carto-coverage', this._panel);
        footer.innerHTML = html;
    },

    // Proportional circles: nested circles of a few round counts, sized like on the map
    // circles: [{value, radius}] from the largest
    updateCircles: function (title, unit, circles) {
        var size = circles.length ? Math.ceil(circles[0].radius * 2) + 2 : 0;
        var padTop = 7;                     // half a label above the largest circle
        var labelY = -Infinity;
        var parts = circles.map(function (c) {
            var top = padTop + size - 1 - 2 * c.radius;
            // labels of small circles would overlap: each at least 13 px below the previous one
            labelY = Math.max(top, labelY + 13);
            return { c: c, top: top, labelY: labelY };
        });
        var height = Math.max(padTop + size, labelY + 6);
        var svg = '<svg class="carto-legend-circles" width="' + (size + 60) + '" height="' + height + '" aria-hidden="true">' +
            parts.map(function (part) {
                return '<circle cx="' + (size / 2) + '" cy="' + (padTop + size - 1 - part.c.radius) + '" r="' + part.c.radius + '"/>';
            }).join('') +
            parts.map(function (part) {
                return '<polyline points="' + (size / 2) + ',' + part.top + ' ' + (size + 2) + ',' + part.top + ' ' +
                    (size + 8) + ',' + part.labelY + '"/>' +
                    '<text x="' + (size + 11) + '" y="' + (part.labelY + 4) + '">' + part.c.value + '</text>';
            }).join('') + '</svg>';
        this._panel.innerHTML = '<div class="carto-legend-title">' + title + '</div>' +
            '<div class="carto-legend-unit">' + unit + '</div>' + svg;
    },

    // title: "Check-ins", unit: "per 10 km²", items: [{label, color}]
    update: function (title, unit, items, fillOpacity) {
        this._panel.innerHTML = '<div class="carto-legend-title">' + title + '</div>' +
            '<div class="carto-legend-unit">' + unit + '</div>' +
            items.map(function (item) {
                return '<div class="carto-legend-row"><span class="carto-legend-swatch" style="background-color: ' +
                    item.color + '; opacity: ' + fillOpacity + '"></span><span>' + item.label + '</span></div>';
            }).join('');
    }
});

// ---------- Page ----------

// Loads a data script once (map1–3.js are large, so only the chosen region is loaded)
var loadedScripts = {};
function loadScript(src, callback) {
    if (loadedScripts[src] === true) return callback();
    if (loadedScripts[src]) return loadedScripts[src].push(callback);
    loadedScripts[src] = [callback];
    var script = document.createElement('script');
    script.src = src;
    script.onload = function () {
        var callbacks = loadedScripts[src];
        loadedScripts[src] = true;
        callbacks.forEach(function (cb) { cb(); });
    };
    document.head.appendChild(script);
}

// One map for all cartograms; a switch chooses the region and the map flies there.
// regions: [{ id, label, script,
//             view: function (small) -> { bounds } or { center, zoom }   (optional, default: all areas)
//             setup: function () -> { nameProperty, fillOpacity, areaSets } }]   (called after the script loaded)
// areaSets: [{ id, label, geojson, unit: 'per 10 km²', places: { checkIns: {...}, breweries: {...} },
//              title: function (name) }]; a second set adds a switch (regions / districts)
// The region comes from the URL hash (#prague, #czechia, #world) and is kept there.
function initCartograms(regions) {
    var small = isSmallScreen();
    var map = L.map('map', {
        zoomControl: false,
        // finer steps on phones, so fitting a region does not round the zoom down a whole level
        zoomSnap: small ? 0.25 : 1
    }).setView([49.8, 15.5], 4);

    // labels of the light basemap above the areas, not catching clicks
    var labelPane = map.createPane('cartoLabels');
    labelPane.style.zIndex = 450;
    labelPane.style.pointerEvents = 'none';

    var basemaps = createBasemaps();
    basemaps["Light"].addTo(map);

    var regionById = function (id) {
        return regions.filter(function (r) { return r.id === id; })[0];
    };
    var startRegion = regionById(window.location.hash.slice(1)) || regions[0];

    // year: show check-ins until the end of that year (null = all time)
    // mode: "density" (choropleth) or "total" (proportional circles, where circles.js has them)
    // unvisited: hatch the areas without a check-in (brewery) in the selected time
    var state = { region: null, config: null, metric: 'checkIns', areaSet: null, year: null, mode: 'density', unvisited: false };
    var configs = {};
    var layers = {};
    var currentLayer = null;

    function areaTitle(areaSet, name) {
        return areaSet.title ? areaSet.title(name) : name;
    }

    function buildLayer(config, areaSet, metricId) {
        var statsOf = function (feature, year) {
            var places = areaSet.places[metricId][feature.properties[config.nameProperty]] || [];
            return areaStats(metricId, places, feature.properties, year);
        };
        // Classes of the data until the selected year, computed once per year: the legend shows
        // the intervals of that time and an area changes colour as it grows against the others
        var scales = {};
        var scaleFor = function (year) {
            var key = year === null ? 'all' : year;
            if (!scales[key]) {
                scales[key] = choropleth(areaSet.geojson[0].features.map(function (feature) {
                    return statsOf(feature, year).density;
                }));
            }
            return scales[key];
        };
        var countOf = function (feature, year) {
            var stats = statsOf(feature, year);
            return metricId === 'checkIns' ? stats.checkIns : stats.places.length;
        };
        var style = function (feature) {
            if (state.unvisited && !countOf(feature, state.year)) {
                return { fillColor: 'url(#carto-unvisited)', fillOpacity: 1, color: '#232323', weight: 1.2 };
            }
            if (state.mode === 'total') {
                return { fillColor: '#f4ecd8', fillOpacity: 0.55, color: '#232323', weight: 1.2 };
            }
            return {
                fillColor: scaleFor(state.year).color(statsOf(feature, state.year).density),
                fillOpacity: config.fillOpacity,
                color: '#232323',
                weight: 1.2
            };
        };
        // Rank among all areas of the set in the selected time: by density, in the Total view by
        // the count ("5th of 77 districts"); areas with nothing get no rank
        var features = areaSet.geojson[0].features;
        var rankValues = {};
        var rankText = function (feature) {
            var total = state.mode === 'total';
            var key = (state.year === null ? 'all' : state.year) + (total ? ':total' : ':density');
            var valueOf = function (f) { return total ? countOf(f, state.year) : statsOf(f, state.year).density; };
            if (!rankValues[key]) rankValues[key] = features.map(valueOf);
            var value = valueOf(feature);
            if (!value) return '';
            var rank = 1 + rankValues[key].filter(function (v) { return v > value; }).length;
            var place = ordinal(rank) + ' of ' + features.length + ' ' + areaSet.label.toLowerCase();
            if (total) return place + ' by ' + (metricId === 'checkIns' ? 'check-ins' : 'breweries');
            return formatDensity(value) + ' ' + (metricId === 'checkIns' ? 'check-ins' : 'breweries') + ' ' +
                areaSet.unit.replace(/^per /, '/ ') + ' \u00b7 ' + place;
        };
        var popupHtml = function (feature) {
            var name = feature.properties[config.nameProperty];
            return areaPopup(areaTitle(areaSet, name), metricId, statsOf(feature, state.year), rankText(feature));
        };

        var layer = L.geoJSON(areaSet.geojson, {
            style: style,
            onEachFeature: function (feature, featureLayer) {
                var name = feature.properties[config.nameProperty];
                featureLayer.bindPopup(function () {
                    return popupHtml(feature);
                }, {
                    className: 'carto-popup',
                    maxWidth: Math.min(320, window.innerWidth - 40),
                    minWidth: Math.min(220, window.innerWidth - 40),
                    autoPanPadding: [16, 16]
                });
                if (!isTouchDevice) {
                    featureLayer.bindTooltip(escapeHtml(areaTitle(areaSet, name)), { sticky: true, className: 'carto-tooltip' });
                }
            }
        });
        addHighlight(layer);
        return { layer: layer, scaleFor: scaleFor, statsOf: statsOf, countOf: countOf, popupHtml: popupHtml };
    }

    function circlesKey() {
        return state.region.id + '/' + state.areaSet.id;
    }

    function hasCircles() {
        return typeof areaCircles !== 'undefined' && !!state.areaSet && !!areaCircles[circlesKey()];
    }

    // Circle layout of an area set for this device (circles.js: a desktop and a phone profile)
    function circleProfile(key) {
        return areaCircles[key][small ? 'phone' : 'desktop'];
    }

    // Radius in pixels of a circle for `count` at the current zoom. At the reference zoom and
    // below it scales exactly with the map, so circles keep fitting their areas when zoomed out;
    // zoomed in they grow only half as fast (the areas grow faster, so they still fit)
    function circleRadius(scale, zoom, count) {
        var refRadius = scale * Math.sqrt(count) / (40075016.686 / (256 * Math.pow(2, zoom)));
        var dz = map.getZoom() - zoom;
        return refRadius * Math.pow(2, dz <= 0 ? dz : dz / 2);
    }

    // Proportional circles of one area set and metric. One size scale for all years. A circle
    // sits on the pole of its area while it fits there (for the shown year and zoom); otherwise
    // it grows from its spot outside the territory (the same spot in every year) with a leader line
    function buildCircles(config, areaSet, metricId, statsOf, popupHtml) {
        var key = state.region.id + '/' + areaSet.id;
        var poles = areaCircles[key].poles;
        var profile = circleProfile(key);
        var data = profile[metricId];
        var group = L.layerGroup();
        var leaders = L.layerGroup().addTo(group);
        var items = [];
        areaSet.geojson[0].features.forEach(function (feature) {
            var name = feature.properties[config.nameProperty];
            if (!poles[name]) return;
            var pole = [poles[name][0], poles[name][1]];
            var item = { name: name, feature: feature, pole: pole, room: poles[name][2], spot: data.outside[name],
                marker: L.circleMarker(pole, {
                color: 'white', weight: 1.5, fillColor: '#cc4c02', fillOpacity: 0.85
            }) };
            item.line = L.polyline([pole, pole], { color: '#3c2828', weight: 1.3, interactive: false });
            item.leader = L.layerGroup([item.line,
                L.circleMarker(pole, { radius: 2.5, color: '#3c2828', weight: 1, fillColor: '#3c2828', fillOpacity: 1, interactive: false })
            ]);
            item.marker.bindPopup(function () {
                return popupHtml(feature);
            }, {
                className: 'carto-popup',
                maxWidth: Math.min(320, window.innerWidth - 40),
                minWidth: Math.min(220, window.innerWidth - 40),
                autoPanPadding: [16, 16]
            });
            if (!isTouchDevice) {
                var tooltip = escapeHtml(areaTitle(areaSet, name));
                item.marker.bindTooltip(tooltip, { sticky: true, className: 'carto-tooltip' });
                // the name would cover the popup
                item.marker.on('popupopen', function () { item.marker.unbindTooltip(); });
                item.marker.on('popupclose', function () {
                    item.marker.bindTooltip(tooltip, { sticky: true, className: 'carto-tooltip' });
                });
            }
            items.push(item);
        });

        function count(item, year) {
            var stats = statsOf(item.feature, year);
            return metricId === 'checkIns' ? stats.checkIns : stats.places.length;
        }

        // sizes and positions for the year and the current zoom; larger circles below smaller ones
        function update() {
            var metresPerPixel = 40075016.686 / (256 * Math.pow(2, map.getZoom()));
            items.forEach(function (item) {
                var value = count(item, state.year);
                item.radius = value ? circleRadius(data.scale, profile.zoom, value) : 0;
                // out of the area only when it does not fit (1 px from the border) and has a spot
                var fits = item.radius + 1 <= item.room / metresPerPixel;
                var spot = fits ? null : item.spot;
                if (value) {
                    item.marker.setLatLng(spot || item.pole).setRadius(item.radius).addTo(group);
                } else {
                    group.removeLayer(item.marker);
                }
                if (value && spot) {
                    item.line.setLatLngs([item.pole, spot]);
                    item.leader.addTo(leaders);
                } else {
                    leaders.removeLayer(item.leader);
                }
            });
            items.slice().sort(function (a, b) { return b.radius - a.radius; }).forEach(function (item) {
                if (item.radius && map.hasLayer(item.marker)) item.marker.bringToFront();
            });
        }

        // two or three round counts for the legend (1, 2, 5 × 10^n): the largest at most 40 px
        // so it does not cover the map, each next one clearly smaller (≤ 65 % of the radius)
        function legendCircles() {
            var all = items.map(function (item) { return count(item, null); });
            var max = Math.max.apply(null, all);
            var nice = function (v) {
                var p = Math.pow(10, Math.floor(Math.log10(v)));
                return [5, 2, 1].map(function (m) { return m * p; }).filter(function (n) { return n <= v; })[0];
            };
            var radius = function (value) { return circleRadius(data.scale, profile.zoom, value); };
            var top = nice(max);
            while (top > 1 && radius(top) > 40) top = nice(top / 2);
            var values = [top];
            for (var v = top; v > 1 && values.length < 3; ) {
                v = nice(v / 2);   // the next smaller round number (5 → 2 → 1 → 0.5 …)
                if (v >= 1 && radius(v) <= 0.65 * radius(values[values.length - 1])) values.push(v);
            }
            // a second size even when the round numbers below are too close in size
            if (values.length === 1 && top > 1) values.push(nice(top / 2));
            return values.map(function (value) { return { value: value, radius: radius(value) }; });
        }

        return { layer: group, update: update, legendCircles: legendCircles };
    }

    // The area under the mouse, or with an open popup, gets a dark outline
    function addHighlight(geoJsonLayer) {
        var outline = { color: '#3c2828', weight: 3.5 };
        geoJsonLayer.eachLayer(function (layer) {
            var tooltip = layer.getTooltip();
            layer.on('popupopen', function () {
                layer.setStyle(outline);
                // only now: moving the path in the DOM under the cursor would swallow the click
                layer.bringToFront();
                // the name tooltip would cover the popup
                if (tooltip) layer.unbindTooltip();
            });
            layer.on('popupclose', function () {
                geoJsonLayer.resetStyle(layer);
                if (tooltip) layer.bindTooltip(tooltip);
            });
            if (!isTouchDevice) {
                layer.on('mouseover', function () { layer.setStyle(outline); });
                layer.on('mouseout', function () {
                    if (!layer.isPopupOpen()) geoJsonLayer.resetStyle(layer);
                });
            }
        });
    }

    var legend = new CartogramLegend({ position: 'bottomleft', collapsed: small }).addTo(map);

    var circleLayers = {};
    var currentCircles = null;

    // Hatch pattern for the areas without a check-in, in the SVG the areas are drawn in
    function ensureHatch() {
        var svg = map.getPane('overlayPane').querySelector('svg');
        if (!svg || svg.querySelector('#carto-unvisited')) return;
        var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = '<pattern id="carto-unvisited" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
            '<rect width="7" height="7" fill="rgba(255, 255, 255, 0.55)"/>' +
            '<line x1="0" y1="0" x2="0" y2="7" stroke="#993404" stroke-width="2.4" stroke-opacity="0.6"/></pattern>';
        svg.insertBefore(defs, svg.firstChild);
    }

    // "Visited 28 / 77 districts" with a bar, and the switch for hatching the rest
    function showCoverage(key) {
        var features = state.areaSet.geojson[0].features;
        var visited = features.filter(function (f) { return layers[key].countOf(f, state.year) > 0; }).length;
        var noun = state.areaSet.label.toLowerCase();
        var checkIns = state.metric === 'checkIns';
        legend.setCoverage(
            '<div class="carto-coverage-text">' + (checkIns ? 'Visited ' : 'Breweries in ') +
            '<b>' + visited + '</b> / ' + features.length + ' ' + noun + '</div>' +
            '<div class="carto-coverage-bar"><span style="width: ' + (100 * visited / features.length).toFixed(1) + '%"></span></div>' +
            '<label class="carto-coverage-toggle"><input type="checkbox" class="carto-unvisited-toggle"' + (state.unvisited ? ' checked' : '') + '>' +
            (checkIns ? 'Highlight unvisited ' + noun : 'Highlight ' + noun + ' without one') + '</label>');
    }

    legend.getContainer().addEventListener('change', function (e) {
        if (!e.target.classList.contains('carto-unvisited-toggle')) return;
        state.unvisited = e.target.checked;
        currentLayer.resetStyle();
    });

    function show() {
        var key = state.region.id + ':' + state.areaSet.id + ':' + state.metric;
        if (!layers[key]) layers[key] = buildLayer(state.config, state.areaSet, state.metric);
        if (currentLayer) map.removeLayer(currentLayer);
        if (currentCircles) map.removeLayer(currentCircles.layer);
        currentCircles = null;
        if (!hasCircles()) state.mode = 'density';
        currentLayer = layers[key].layer.addTo(map);
        ensureHatch();
        currentLayer.resetStyle();
        var title = METRICS[state.metric].label + (state.year ? ' until ' + state.year : '');
        if (state.mode === 'total') {
            if (!circleLayers[key]) circleLayers[key] = buildCircles(state.config, state.areaSet, state.metric, layers[key].statsOf, layers[key].popupHtml);
            currentCircles = circleLayers[key];
            currentCircles.layer.addTo(map);
            updateCircles();
        } else {
            legend.update(title, state.areaSet.unit, layers[key].scaleFor(state.year).legendItems(), state.config.fillOpacity);
            showCoverage(key);
        }
    }

    function updateCircles() {
        if (!currentCircles) return;
        currentCircles.update();
        legend.updateCircles(METRICS[state.metric].label + (state.year ? ' until ' + state.year : ''),
            state.metric === 'checkIns' ? 'number of check-ins' : 'number of breweries', currentCircles.legendCircles());
        showCoverage(state.region.id + ':' + state.areaSet.id + ':' + state.metric);
    }

    map.on('zoomend', updateCircles);

    // Years with check-ins; the last one equals "All time"
    var years = {};
    [venueYears, breweryYears].forEach(function (places) {
        Object.keys(places).forEach(function (place) {
            Object.keys(places[place]).forEach(function (year) { years[year] = true; });
        });
    });
    var yearItems = Object.keys(years).map(Number).sort().slice(0, -1).map(function (year) {
        return { id: String(year), label: String(year) };
    }).concat([{ id: 'all', label: 'All time' }]);

    // Switches: region, Check-ins / Breweries, Regions / Districts (Czechia only), Density /
    // Total and the year. Larger screens show them all in the top right corner; phones show a
    // one-line summary with a year stepper, and the switches in a sheet that slides up from it.
    function onSwitchChange(e) {
        map.closePopup();
        if (e.target.name === 'region') {
            selectRegion(regionById(e.target.value), true);
            return;
        }
        if (e.target.name === 'metric') {
            state.metric = e.target.value;
        } else if (e.target.name === 'mode') {
            state.mode = e.target.value;
        } else if (e.target.name === 'year') {
            state.year = e.target.value === 'all' ? null : Number(e.target.value);
        } else {
            state.areaSet = state.config.areaSets.filter(function (s) { return s.id === e.target.value; })[0];
        }
        show();
        renderSwitches();
        // Total needs room for the circles placed outside the territory, Density does not
        if (e.target.name === 'mode') fitRegion(true);
    }

    var switchControl = L.control({ position: 'topright' });
    switchControl.onAdd = function () {
        var div = L.DomUtil.create('div', 'carto-switches' + (small ? ' compact' : ''));
        L.DomEvent.disableClickPropagation(div);
        div.addEventListener('change', onSwitchChange);
        if (small) {
            div.addEventListener('click', function (e) {
                if (e.target.closest('.carto-summary-button')) setSheetOpen(sheet.hidden);
                var step = e.target.closest('[data-year-step]');
                if (step) stepYear(Number(step.dataset.yearStep));
            });
        }
        return div;
    };
    switchControl.addTo(map);

    // Phones: the sheet with all the switches
    var sheet = L.DomUtil.create('div', 'carto-sheet', map.getContainer());
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Map settings');
    sheet.innerHTML = '<div class="carto-sheet-header"><span class="carto-sheet-handle" aria-hidden="true"></span>' +
        '<span class="carto-sheet-title">Show on map</span>' +
        '<button type="button" class="carto-sheet-done">Done</button></div><div class="carto-sheet-body"></div>';
    var sheetBody = sheet.querySelector('.carto-sheet-body');
    L.DomEvent.disableClickPropagation(sheet);
    L.DomEvent.disableScrollPropagation(sheet);
    sheet.addEventListener('change', onSwitchChange);
    sheet.querySelector('.carto-sheet-done').addEventListener('click', function () { setSheetOpen(false); });
    map.on('click', function () { setSheetOpen(false); });

    // drag the header down to close
    (function () {
        var header = sheet.querySelector('.carto-sheet-header');
        var startY = null;
        header.addEventListener('touchstart', function (e) { startY = e.touches[0].clientY; }, { passive: true });
        header.addEventListener('touchmove', function (e) {
            if (startY === null) return;
            var dy = Math.max(0, e.touches[0].clientY - startY);
            sheet.style.transform = 'translateY(' + dy + 'px)';
        }, { passive: true });
        header.addEventListener('touchend', function (e) {
            if (startY === null) return;
            var dy = e.changedTouches[0].clientY - startY;
            startY = null;
            sheet.style.transform = '';
            if (dy > 60) setSheetOpen(false);
        });
    })();

    function setSheetOpen(open) {
        sheet.hidden = !open;
        var button = switchControl.getContainer().querySelector('.carto-summary-button');
        if (button) button.setAttribute('aria-expanded', open);
    }

    // ‹ › next to the summary: previous / next year without opening the sheet
    function stepYear(direction) {
        var ids = yearItems.map(function (item) { return item.id; });
        var index = ids.indexOf(state.year === null ? 'all' : String(state.year)) + direction;
        if (index < 0 || index >= ids.length) return;
        map.closePopup();
        state.year = ids[index] === 'all' ? null : Number(ids[index]);
        show();
        renderSwitches();
    }

    // caption: small text before the pills; checked: id of the selected item
    function group(name, label, items, checked, caption) {
        return '<div class="overlay-switch" role="radiogroup" aria-label="' + label + '">' +
            (caption ? '<span class="switch-caption">' + caption + '</span>' : '') + items.map(function (item) {
            var id = name + '-' + item.id;
            return '<input type="radio" name="' + name + '" value="' + item.id + '" id="' + id + '"' + (item.id === checked ? ' checked' : '') + '>' +
                '<label for="' + id + '">' + (item.icon ? '<img src="' + item.icon + '" alt="">' : '') + item.label + '</label>';
        }).join('') + '</div>';
    }

    function renderSwitches() {
        var html = group('region', 'Region', regions, state.region.id);
        html += group('metric', 'Show on map', Object.keys(METRICS).map(function (id) {
            return { id: id, label: METRICS[id].label, icon: METRICS[id].icon };
        }), state.metric);
        if (state.config && state.config.areaSets.length > 1) {
            html += group('areas', 'Areas', state.config.areaSets, state.areaSet.id);
        }
        if (hasCircles()) {
            html += group('mode', 'Show as', [{ id: 'density', label: 'Density' }, { id: 'total', label: 'Total' }], state.mode);
        }
        if (yearItems.length > 1) {
            html += group('year', 'Check-ins until the end of', yearItems, state.year === null ? 'all' : String(state.year), 'Until');
        }
        if (!small) {
            switchControl.getContainer().innerHTML = html;
            return;
        }
        sheetBody.innerHTML = html;

        // summary of the choice: "Czechia · Breweries · Districts · Total"
        var parts = [state.region.label, METRICS[state.metric].label];
        if (state.config && state.config.areaSets.length > 1) parts.push(state.areaSet.label);
        if (hasCircles()) parts.push(state.mode === 'total' ? 'Total' : 'Density');
        var yearIds = yearItems.map(function (item) { return item.id; });
        var yearIndex = yearIds.indexOf(state.year === null ? 'all' : String(state.year));
        switchControl.getContainer().innerHTML =
            '<button type="button" class="carto-summary-button" aria-expanded="' + !sheet.hidden + '">' +
            '<span class="carto-summary-text">' + parts.join(' \u00b7 ') + '</span><span class="carto-summary-arrow" aria-hidden="true">\u25be</span></button>' +
            (yearItems.length > 1 ? '<div class="year-stepper" role="group" aria-label="Year">' +
                '<button type="button" data-year-step="-1" aria-label="Previous year"' + (yearIndex <= 0 ? ' disabled' : '') + '>\u2039</button>' +
                '<span>' + yearItems[yearIndex].label + '</span>' +
                '<button type="button" data-year-step="1" aria-label="Next year"' + (yearIndex >= yearIds.length - 1 ? ' disabled' : '') + '>\u203a</button></div>' : '');
    }

    // Zoom (+ fullscreen in the same bar) and basemaps: bottom right on phones, top on desktop
    map.zoomControl = L.control.zoom({ position: small ? 'bottomright' : 'topleft' }).addTo(map);
    L.control.fullscreen({
        position: small ? 'bottomright' : 'topleft',
        title: 'Fullscreen',
        titleCancel: 'Exit fullscreen'
    }).addTo(map);
    L.control.layers(basemaps, null, { position: small ? 'bottomright' : 'topright' }).addTo(map);
    addAttributionToggle(map);

    var loading = L.DomUtil.create('div', 'carto-loading', map.getContainer());
    loading.textContent = 'Loading map\u2026';
    loading.hidden = true;

    // The view of a region: its own (world on phones: Europe) or all its areas, clear of the switches
    function fitRegion(animate) {
        var view = state.region.view ? state.region.view(small) : null;
        if (view && view.center) {
            map[animate ? 'flyTo' : 'setView'](view.center, view.zoom, animate ? { duration: 1.2 } : { animate: false });
            return;
        }
        var bounds = view && view.bounds ? L.latLngBounds(view.bounds) : currentLayer.getBounds();
        // proportional circles placed outside the territory must stay in view as well
        if (state.mode === 'total' && typeof areaCircles !== 'undefined') {
            Object.keys(areaCircles).forEach(function (key) {
                if (key.indexOf(state.region.id + '/') !== 0) return;
                var profile = circleProfile(key);
                ['checkIns', 'breweries'].forEach(function (metric) {
                    var spots = profile[metric].outside;
                    Object.keys(spots).forEach(function (name) {
                        bounds.extend(spots[name]);
                    });
                });
            });
        }
        // nothing under the switches in the top right corner
        var top = switchControl.getContainer().offsetHeight + 16;
        var options = { paddingTopLeft: [16, top], paddingBottomRight: small ? [60, 16] : [16, 16] };
        if (animate) {
            map.flyToBounds(bounds, L.extend({ duration: 1.2 }, options));
        } else {
            map.fitBounds(bounds, L.extend({ animate: false }, options));
        }
    }

    function selectRegion(region, animate) {
        state.region = region;
        if (window.location.hash.slice(1) !== region.id) {
            history.replaceState(null, '', '#' + region.id);
        }
        renderSwitches();
        loading.hidden = false;
        loadScript(region.script, function () {
            loading.hidden = true;
            if (state.region !== region) return;   // another region was chosen meanwhile
            if (!configs[region.id]) configs[region.id] = region.setup();
            state.config = configs[region.id];
            state.areaSet = state.config.areaSets[0];
            renderSwitches();
            show();
            fitRegion(animate);
        });
    }

    window.addEventListener('hashchange', function () {
        var region = regionById(window.location.hash.slice(1));
        if (region && region !== state.region) selectRegion(region, true);
    });

    selectRegion(startRegion, false);
    return map;
}

// Attribution (Leaflet, source of the active basemap, author) hidden behind an "i" button
function addAttributionToggle(map) {
    var control = L.control({ position: 'bottomright' });
    control.onAdd = function () {
        var wrapper = L.DomUtil.create('div', 'attribution-toggle');
        var button = L.DomUtil.create('button', 'attribution-button', wrapper);
        button.type = 'button';
        button.textContent = 'i';
        button.setAttribute('aria-label', 'Map data sources');
        button.setAttribute('aria-expanded', 'false');
        wrapper.appendChild(map.attributionControl.getContainer());
        L.DomEvent.disableClickPropagation(wrapper);
        L.DomEvent.on(button, 'click', function () {
            setOpen(!wrapper.classList.contains('open'));
        });
        return wrapper;
    };
    function setOpen(open) {
        var wrapper = control.getContainer();
        wrapper.classList.toggle('open', open);
        wrapper.querySelector('.attribution-button').setAttribute('aria-expanded', open);
    }
    control.addTo(map);
    // keep the "i" button at the very bottom of its corner, below the other buttons
    control.getContainer().parentNode.appendChild(control.getContainer());
    map.on('click', function () { setOpen(false); });
}
