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

function createBasemaps() {
    return {
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

// Popup like the venue / brewery popups of the check-in map: dark header with the
// area and counts, below it the list of places
function areaPopup(title, metricId, stats) {
    var metric = METRICS[metricId];
    var places = stats.places;
    var sorted = places.slice().sort(function (a, b) { return a.localeCompare(b, 'cs'); });
    var subtitle = metricId === 'checkIns'
        ? plural(places.length, 'venue') + ' · ' + plural(stats.checkIns, 'check-in')
        : plural(places.length, 'brewery');

    var html = "<div class='popup-header'><span class='popup-title'>" + escapeHtml(title) + "</span>" +
        (sorted.length ? "<span class='popup-subtitle'>" + subtitle + "</span>" : '') + "</div>";
    if (sorted.length) {
        // every place opens on the check-in map in a new tab, so the cartogram stays as it is
        var param = metricId === 'checkIns' ? 'venue' : 'brewery';
        html += "<ul class='popup-list'>" + sorted.map(function (place) {
            return '<li><a href="map4.html?' + param + '=' + encodeURIComponent(place) + '" target="_blank" rel="noopener" title="Show on the check-in map (new tab)">' +
                escapeHtml(place) + '</a></li>';
        }).join('') + '</ul>';
    } else {
        html += "<p class='popup-empty'>" + metric.emptyText + "</p>";
    }
    return html;
}

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
            L.DomEvent.on(container, 'click', function () {
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
    var map = L.map('map', { zoomControl: false }).setView([49.8, 15.5], 4);

    var basemaps = createBasemaps();
    basemaps["OS Map"].addTo(map);

    var regionById = function (id) {
        return regions.filter(function (r) { return r.id === id; })[0];
    };
    var startRegion = regionById(window.location.hash.slice(1)) || regions[0];

    // year: show check-ins until the end of that year (null = all time)
    var state = { region: null, config: null, metric: 'checkIns', areaSet: null, year: null };
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
        var style = function (feature) {
            return {
                fillColor: scaleFor(state.year).color(statsOf(feature, state.year).density),
                fillOpacity: config.fillOpacity,
                color: '#232323',
                weight: 1.2
            };
        };
        var layer = L.geoJSON(areaSet.geojson, {
            style: style,
            onEachFeature: function (feature, featureLayer) {
                var name = feature.properties[config.nameProperty];
                featureLayer.bindPopup(function () {
                    return areaPopup(areaTitle(areaSet, name), metricId, statsOf(feature, state.year));
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
        return { layer: layer, scaleFor: scaleFor };
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

    function show() {
        var key = state.region.id + ':' + state.areaSet.id + ':' + state.metric;
        if (!layers[key]) layers[key] = buildLayer(state.config, state.areaSet, state.metric);
        if (currentLayer) map.removeLayer(currentLayer);
        currentLayer = layers[key].layer.addTo(map);
        currentLayer.resetStyle();
        legend.update(METRICS[state.metric].label + (state.year ? ' until ' + state.year : ''),
            state.areaSet.unit, layers[key].scaleFor(state.year).legendItems(), state.config.fillOpacity);
    }

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

    // Switches: region, Check-ins / Breweries, Regions / Districts (Czechia only) and the year
    var switchControl = L.control({ position: 'topright' });
    switchControl.onAdd = function () {
        var div = L.DomUtil.create('div', 'carto-switches');
        L.DomEvent.disableClickPropagation(div);
        div.addEventListener('change', function (e) {
            map.closePopup();
            if (e.target.name === 'region') {
                selectRegion(regionById(e.target.value), true);
                return;
            }
            if (e.target.name === 'metric') {
                state.metric = e.target.value;
            } else if (e.target.name === 'year') {
                state.year = e.target.value === 'all' ? null : Number(e.target.value);
            } else {
                state.areaSet = state.config.areaSets.filter(function (s) { return s.id === e.target.value; })[0];
            }
            show();
        });
        return div;
    };
    switchControl.addTo(map);

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
        if (yearItems.length > 1) {
            html += group('year', 'Check-ins until the end of', yearItems, state.year === null ? 'all' : String(state.year), 'Until');
        }
        switchControl.getContainer().innerHTML = html;
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
        var top = small ? switchControl.getContainer().offsetHeight + 16 : 16;
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
