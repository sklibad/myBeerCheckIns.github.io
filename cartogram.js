// Shared helpers for the cartogram pages (map1–3.html)

// Devices without a mouse (phones, tablets) cannot hover
var isTouchDevice = window.matchMedia('(hover: none)').matches;

function isSmallScreen() {
    return window.innerWidth <= 760;
}

// Popups never get wider than the screen
function popupMaxWidth() {
    return Math.min(500, window.innerWidth - 60);
}

function popupOptions() {
    return {
        maxWidth: popupMaxWidth(),
        minWidth: Math.min(200, popupMaxWidth()),
        autoPanPadding: [12, 12]
    };
}

// Highlight a district on hover (mouse) or while its popup is open (touch)
function addHoverHighlight(geoJsonLayer, weight) {
    var highlight = {
        fillColor: '#ff1601',
        color: '#881d00',
        weight: weight
    };

    geoJsonLayer.eachLayer(function (layer) {
        if (isTouchDevice) {
            layer.on('popupopen', function () {
                this.setStyle(highlight);
            });
            layer.on('popupclose', function () {
                geoJsonLayer.resetStyle(this);
            });
        } else {
            layer.on('mouseover', function () {
                this.setStyle(highlight);
            });
            layer.on('mouseout', function () {
                geoJsonLayer.resetStyle(this);
            });
        }
    });
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

// Readable number: about two significant digits (2.0, 9.6, 22, 0.64, 0.006)
function formatClassValue(value) {
    var decimals = value >= 10 ? 0 : value >= 1 ? 1 : value >= 0.1 ? 2 : 3;
    return value.toFixed(decimals);
}

// Colour scale computed from the data. The values are very skewed (a few
// districts with hundreds of check-ins per area, most with a few), so the
// natural breaks are searched on log10 of the non-zero values; the number of
// classes is the smallest one explaining at least 90 % of the variance
// (goodness of variance fit), 3–6 classes. Zero gets its own grey class.
function choropleth(geojson, property) {
    var all = geojson[0].features.map(function (f) { return Number(f.properties[property]) || 0; });
    var values = all.filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    var logs = values.map(Math.log10);
    var distinct = new Set(values).size;

    var mean = logs.reduce(function (a, b) { return a + b; }, 0) / logs.length;
    var total = logs.reduce(function (a, v) { return a + (v - mean) * (v - mean); }, 0);
    var maxClasses = Math.min(6, distinct);
    var k = Math.min(3, maxClasses);
    var breaks = naturalBreaks(logs, k);
    while (k < maxClasses && total > 0 && 1 - breaks.deviation / total < 0.9) {
        k++;
        breaks = naturalBreaks(logs, k);
    }

    var colors = CLASS_COLORS[Math.max(2, k)].slice(-k);
    var bounds = [0].concat(breaks.starts, [values.length]);
    var classes = [];
    for (var c = 0; c < k; c++) {
        classes.push({
            min: values[bounds[c]],
            max: values[bounds[c + 1] - 1],
            color: colors[c]
        });
    }

    return {
        classes: classes,
        color: function (value) {
            value = Number(value) || 0;
            if (value <= 0 || !classes.length) return NO_VALUE_COLOR;
            for (var i = 0; i < classes.length - 1; i++) {
                // values between two classes go to the nearer one on the log scale
                if (value <= Math.sqrt(classes[i].max * classes[i + 1].min)) return classes[i].color;
            }
            return classes[classes.length - 1].color;
        },
        // items for L.control.Legend; style: fillOpacity, color, weight of the map layer
        legends: function (style) {
            var item = function (label, color) {
                return L.extend({ label: label, type: 'rectangle', fillColor: color }, style);
            };
            var items = all.some(function (v) { return v <= 0; }) ? [item('0', NO_VALUE_COLOR)] : [];
            classes.forEach(function (cls) {
                var min = formatClassValue(cls.min), max = formatClassValue(cls.max);
                items.push(item(min === max ? min : min + '–' + max, cls.color));
            });
            return items;
        }
    };
}

// On small screens zoom so that the whole area is visible
function fitMapOnSmallScreen(map, geoJsonLayer) {
    if (isSmallScreen()) {
        map.fitBounds(geoJsonLayer.getBounds(), { padding: [8, 8], animate: false });
    }
}
