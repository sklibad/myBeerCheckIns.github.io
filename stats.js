// Statistics page: everything is computed in the browser from stats_data.js (`data`, one record
// per check-in) and redrawn whenever another year is chosen.
(function () {
    'use strict';

    // ---------- Basics ----------

    // Beer styles grouped like the filters of the check-in map, one colour each on all charts
    var STYLES = [
        { id: 'lager', label: 'Lager', color: '#e9a92a' },
        { id: 'ale', label: 'Ale / APA', color: '#d95f0e' },
        { id: 'ipa', label: 'IPA', color: '#7f9a2e' },
        { id: 'sour', label: 'Sour', color: '#c2456b' },
        { id: 'stout', label: 'Stout / Porter', color: '#3c2828' },
        { id: 'other', label: 'Other', color: '#a39a86' }
    ];
    var STYLE_BY_ID = {};
    STYLES.forEach(function (s) { STYLE_BY_ID[s.id] = s; });

    function styleGroup(style) {
        if (style.indexOf('Lager') >= 0 || style.indexOf('Pilsner') >= 0 || style === 'Märzen' || style === 'Festbier') return 'lager';
        // same order as the filters of the check-in map ("… Dark Ale" IPAs count as ales)
        if (style.indexOf('Ale') >= 0) return 'ale';
        if (style.indexOf('IPA') >= 0) return 'ipa';
        if (style.indexOf('Sour') >= 0) return 'sour';
        if (style.indexOf('Stout') >= 0 || style.indexOf('Porter') >= 0) return 'stout';
        return 'other';
    }

    var FRIEND_NAMES = {
        AM: 'Anna Mlíková', ES: 'Eliška Sieglová', FZ: 'Filip Zadražil', JT: 'Jan Tarabec',
        JZ: 'Jana Žemličková', LP: 'Luboš Petržilka', ME: 'Malcolm Edwards', MJ: 'Miroslav Janeček',
        MK: 'Michal Knížek', MS: 'Matyáš Svítok', PL: 'Petr Lhota', TB: 'Tomáš Borolič',
        TH: 'Terezie Hofmanová', TS: 'Tereza Svobodová', TV: 'Tereza Vodičková', WS: 'Wenhan Sun'
    };

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var HOME = [50.0944850, 14.4806282];   // the wind rose is drawn around Prague
    var DIRECTIONS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    var MIN_FOR_AVERAGE = 5;               // "Best rated" rankings: places with at least 5 check-ins
    var BROWN = 'rgb(87, 62, 62)';
    var ORANGE = '#cc4c02';

    function parseDate(dmy) {
        var p = dmy.split('/').map(Number);
        return new Date(p[2], p[1] - 1, p[0]);
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function plural(n, word) {
        return n.toLocaleString('en-US') + ' ' + (n === 1 ? word : word.replace(/y$/, 'ie') + 's');
    }

    function average(list) {
        return list.reduce(function (a, b) { return a + b; }, 0) / list.length;
    }

    // Five circles, the last one partly filled (like in the check-in map)
    function ratingDots(rating) {
        var html = '<span class="rating-dots" aria-hidden="true">';
        for (var i = 1; i <= 5; i++) {
            var fill = Math.max(0, Math.min(1, rating - (i - 1)));
            html += fill >= 1 ? '<span class="dot filled"></span>' :
                fill > 0 ? '<span class="dot" style="background: conic-gradient(#FFD700 0 ' + (fill * 100) + '%, transparent 0)"></span>' :
                '<span class="dot"></span>';
        }
        return html + '</span>';
    }

    var records = data.map(function (r) {
        return Object.assign({}, r, { date: parseDate(r.Date), style: styleGroup(r.Beer_style), Rating: Number(r.Rating) });
    });
    var years = Array.from(new Set(records.map(function (r) { return r.date.getFullYear(); }))).sort();
    var firstDate = new Date(Math.min.apply(null, records.map(function (r) { return r.date; })));
    var lastDate = new Date(Math.max.apply(null, records.map(function (r) { return r.date; })));

    // year: null = all time
    // hidden: beer styles switched off in the legends of the rating chart and the wind rose
    var state = { year: null, beers: 'best', rankings: {}, hidden: { ratings: {}, rose: {} } };

    function selection() {
        return state.year === null ? records : records.filter(function (r) { return r.date.getFullYear() === state.year; });
    }

    function monthYear(d) {
        return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    }

    // ---------- Chart.js look ----------

    Chart.defaults.font.family = 'Arial, sans-serif';
    Chart.defaults.color = BROWN;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(60, 40, 40, 0.95)';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    var GRID = 'rgba(87, 62, 62, 0.12)';
    var charts = {};

    function barChart(id, options) {
        return new Chart(document.getElementById(id), {
            type: 'bar',
            data: { labels: [], datasets: [] },
            options: Object.assign({
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, border: { color: GRID } },
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRID }, border: { display: false } }
                }
            }, options || {})
        });
    }

    // ---------- Top: year pills and summary ----------

    function renderYearPills() {
        var items = [{ id: 'all', label: 'All time' }].concat(years.map(function (y) { return { id: String(y), label: String(y) }; }));
        document.getElementById('year-pills').innerHTML = items.map(function (item) {
            var checked = (state.year === null ? 'all' : String(state.year)) === item.id;
            return '<input type="radio" name="year" id="year-' + item.id + '" value="' + item.id + '"' + (checked ? ' checked' : '') + '>' +
                '<label for="year-' + item.id + '">' + item.label + '</label>';
        }).join('');
    }

    document.getElementById('year-pills').addEventListener('change', function (e) {
        state.year = e.target.value === 'all' ? null : Number(e.target.value);
        render();
    });

    function renderSummary(list) {
        document.getElementById('stats-summary').textContent = state.year === null
            ? plural(list.length, 'check-in') + ' · ' + monthYear(firstDate) + ' – ' + monthYear(lastDate)
            : plural(list.length, 'check-in') + ' in ' + state.year;
    }

    // ---------- Key numbers ----------

    function renderKpis(list) {
        var unique = function (key) { return new Set(list.map(key)).size; };
        var tiles = [
            { value: list.length, label: 'Check-ins' },
            { value: unique(function (r) { return r.Beer + '|' + r.Brewery; }), label: 'Different beers' },
            { value: unique(function (r) { return r.Venue; }), label: 'Venues' },
            { value: unique(function (r) { return r.Brewery; }), label: 'Breweries' },
            { value: unique(function (r) { return r.Brewery_country; }), label: 'Countries of origin' }
        ];
        var avg = list.length ? average(list.map(function (r) { return r.Rating; })) : 0;
        document.getElementById('kpis').innerHTML = tiles.map(function (t) {
            return '<div class="kpi"><span class="kpi-value">' + t.value.toLocaleString('en-US') + '</span><span class="kpi-label">' + t.label + '</span></div>';
        }).join('') +
            '<div class="kpi"><span class="kpi-value">' + avg.toFixed(2) + '</span><span class="kpi-label">Average rating</span>' + ratingDots(avg) + '</div>';
    }

    // ---------- Check-ins over time ----------

    function renderMonthly(list) {
        var labels = [], values = [], keys = [];
        if (state.year === null) {
            for (var d = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1); d <= lastDate; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
                keys.push(d.getFullYear() * 12 + d.getMonth());
                labels.push(monthYear(d));
            }
        } else {
            for (var m = 0; m < 12; m++) {
                keys.push(state.year * 12 + m);
                labels.push(MONTHS[m]);
            }
        }
        var counts = {};
        list.forEach(function (r) {
            var k = r.date.getFullYear() * 12 + r.date.getMonth();
            counts[k] = (counts[k] || 0) + 1;
        });
        values = keys.map(function (k) { return counts[k] || 0; });

        if (!charts.monthly) {
            charts.monthly = barChart('monthly-chart', {
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return plural(c.parsed.y, 'check-in'); } } } },
                scales: {
                    x: { grid: { display: false }, border: { color: GRID }, ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 12 } },
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRID }, border: { display: false } }
                }
            });
        }
        charts.monthly.data.labels = labels;
        charts.monthly.data.datasets = [{ data: values, backgroundColor: ORANGE, hoverBackgroundColor: '#993404', borderRadius: 3, maxBarThickness: 36 }];
        charts.monthly.update();

        var best = values.indexOf(Math.max.apply(null, values));
        document.getElementById('monthly-note').textContent = values[best]
            ? 'Busiest: ' + labels[best] + ' (' + plural(values[best], 'check-in') + ')' : '';
    }

    // ---------- Calendar heatmap: months × days ----------

    var HEAT = ['#fee391', '#fec44f', '#fe9929', '#d95f0e', '#993404'];

    function renderCalendar(list) {
        var counts = {};
        list.forEach(function (r) {
            var k = r.date.getMonth() + '-' + r.date.getDate();
            counts[k] = (counts[k] || 0) + 1;
        });
        var max = Math.max.apply(null, Object.keys(counts).map(function (k) { return counts[k]; }).concat([1]));
        var year = state.year === null ? 2024 : state.year;   // a leap year for "all time" (29 Feb)

        var html = '<div class="cal-row cal-head"><span></span>';
        for (var day = 1; day <= 31; day++) {
            html += '<span>' + (day === 1 || day % 5 === 0 ? day : '') + '</span>';
        }
        html += '</div>';
        for (var m = 0; m < 12; m++) {
            var days = new Date(year, m + 1, 0).getDate();
            html += '<div class="cal-row"><span class="cal-month">' + MONTHS[m] + '</span>';
            for (day = 1; day <= 31; day++) {
                if (day > days) {
                    html += '<span class="cal-cell cal-none"></span>';
                    continue;
                }
                var n = counts[m + '-' + day] || 0;
                var level = n ? Math.min(HEAT.length - 1, Math.floor((HEAT.length) * Math.sqrt(n / max) - 0.001)) : -1;
                var title = day + ' ' + MONTHS[m] + (state.year === null ? '' : ' ' + state.year) + ': ' + plural(n, 'check-in');
                html += '<span class="cal-cell" title="' + title + '"' + (n ? ' style="background-color: ' + HEAT[Math.max(0, level)] + '"' : '') + '></span>';
            }
            html += '</div>';
        }
        html += '<div class="cal-legend"><span>fewer</span>' + HEAT.map(function (c) {
            return '<span class="cal-cell" style="background-color: ' + c + '"></span>';
        }).join('') + '<span>more</span></div>';
        document.getElementById('calendar').innerHTML = html;
    }

    // ---------- Days of the week ----------

    function renderWeekdays(list) {
        var counts = [0, 0, 0, 0, 0, 0, 0];
        list.forEach(function (r) { counts[(r.date.getDay() + 6) % 7]++; });
        if (!charts.weekdays) {
            charts.weekdays = barChart('weekday-chart', {
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return plural(c.parsed.y, 'check-in'); } } } }
            });
        }
        var max = Math.max.apply(null, counts);
        charts.weekdays.data.labels = WEEKDAYS;
        charts.weekdays.data.datasets = [{
            data: counts,
            backgroundColor: counts.map(function (c) { return c === max ? '#993404' : ORANGE; }),
            borderRadius: 4,
            maxBarThickness: 44
        }];
        charts.weekdays.update();
        document.getElementById('weekday-note').textContent = max
            ? 'Busiest: ' + WEEKDAYS[counts.indexOf(max)] + ' (' + plural(max, 'check-in') + ')' : '';
    }

    // ---------- Ratings by style ----------

    var RATINGS = [];
    for (var step = 1; step <= 20; step++) RATINGS.push(step / 4);

    function styleLegend(id, counts, total) {
        document.getElementById(id).innerHTML = STYLES.map(function (s) {
            var n = counts ? counts[s.id] || 0 : null;
            return '<span class="legend-item"><span class="legend-swatch" style="background-color: ' + s.color + '"></span>' + s.label +
                (n !== null ? ' <b>' + n + '</b><span class="legend-share">' + (total ? Math.round(100 * n / total) : 0) + ' %</span>' : '') + '</span>';
        }).join('');
    }

    // Legend whose styles can be switched off and on (chart: "ratings" or "rose")
    function toggleLegend(id, chart) {
        document.getElementById(id).innerHTML = STYLES.map(function (s) {
            var off = !!state.hidden[chart][s.id];
            return '<button type="button" class="legend-item legend-toggle' + (off ? ' off' : '') + '" data-chart="' + chart + '" data-style="' + s.id + '"' +
                ' aria-pressed="' + !off + '" title="Show / hide ' + s.label + '">' +
                '<span class="legend-swatch" style="background-color: ' + s.color + '"></span>' + s.label + '</button>';
        }).join('');
    }

    document.addEventListener('click', function (e) {
        var button = e.target.closest('.legend-toggle');
        if (!button) return;
        var chart = button.dataset.chart;
        var style = button.dataset.style;
        var off = !state.hidden[chart][style];
        state.hidden[chart][style] = off;
        button.classList.toggle('off', off);
        button.setAttribute('aria-pressed', !off);
        var index = STYLES.map(function (st) { return st.id; }).indexOf(style);
        if (chart === 'ratings') {
            charts.ratings.setDatasetVisibility(index, !off);
            charts.ratings.update();
        } else {
            charts.rose.series[index].setVisible(!off);
        }
    });

    function renderRatings(list) {
        if (!charts.ratings) {
            charts.ratings = barChart('rating-chart', {
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { title: function (items) { return 'Rating ' + items[0].label; } } }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, border: { color: GRID },
                        ticks: { callback: function (v, i) { return i % 4 === 3 ? RATINGS[i] : ''; }, maxRotation: 0, autoSkip: false } },
                    y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: GRID }, border: { display: false } }
                }
            });
        }
        charts.ratings.data.labels = RATINGS.map(function (r) { return r.toFixed(2); });
        charts.ratings.data.datasets = STYLES.map(function (s) {
            return {
                label: s.label,
                hidden: !!state.hidden.ratings[s.id],
                backgroundColor: s.color,
                data: RATINGS.map(function (value) {
                    return list.filter(function (r) { return r.style === s.id && r.Rating === value; }).length;
                }),
                borderRadius: 2
            };
        });
        charts.ratings.update();
        toggleLegend('rating-legend', 'ratings');
        var avg = list.length ? average(list.map(function (r) { return r.Rating; })) : 0;
        document.getElementById('rating-note').textContent = list.length ? 'Average ' + avg.toFixed(2) : '';
    }

    // ---------- Beer styles and serving ----------

    function renderStyles(list) {
        var counts = {};
        list.forEach(function (r) { counts[r.style] = (counts[r.style] || 0) + 1; });
        if (!charts.styles) {
            charts.styles = new Chart(document.getElementById('style-chart'), {
                type: 'doughnut',
                data: { labels: [], datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '62%',
                    plugins: { legend: { display: false } }
                }
            });
        }
        charts.styles.data.labels = STYLES.map(function (s) { return s.label; });
        charts.styles.data.datasets = [{
            data: STYLES.map(function (s) { return counts[s.id] || 0; }),
            backgroundColor: STYLES.map(function (s) { return s.color; }),
            borderColor: 'rgb(238, 231, 212)',
            borderWidth: 2
        }];
        charts.styles.update();
        styleLegend('style-legend', counts, list.length);

        // Served as: one stacked bar
        var serving = {};
        list.forEach(function (r) { serving[r.Serving_style] = (serving[r.Serving_style] || 0) + 1; });
        var colors = { Draft: '#d95f0e', Bottle: '#7f9a2e', Can: '#a39a86' };
        var kinds = Object.keys(serving).sort(function (a, b) { return serving[b] - serving[a]; });
        document.getElementById('serving').innerHTML =
            '<div class="serving-bar">' + kinds.map(function (k) {
                return '<span style="width: ' + (100 * serving[k] / list.length) + '%; background-color: ' + (colors[k] || BROWN) + '" title="' + k + ': ' + serving[k] + '"></span>';
            }).join('') + '</div><div class="legend">' + kinds.map(function (k) {
                return '<span class="legend-item"><span class="legend-swatch" style="background-color: ' + (colors[k] || BROWN) + '"></span>' +
                    k + ' <b>' + serving[k] + '</b><span class="legend-share">' + Math.round(100 * serving[k] / list.length) + ' %</span></span>';
            }).join('') + '</div>';
    }

    // ---------- Best and worst beers ----------

    // Opens the place on the check-in map in a window over this page (place-window.js);
    // with a check-in ID also that beer's popup row and detail
    function placeLink(kind, name, checkinId) {
        return '<a href="map4.html?' + kind + '=' + encodeURIComponent(name) + (checkinId ? '&checkin=' + checkinId : '') +
            '" target="_blank" rel="noopener" data-place-window title="Show on the check-in map">' + escapeHtml(name) + '</a>';
    }

    function renderBeers(list) {
        var sorted = list.slice().sort(function (a, b) {
            return (state.beers === 'best' ? b.Rating - a.Rating : a.Rating - b.Rating) || (b.date - a.date);
        }).slice(0, 10);
        document.getElementById('top-beers').innerHTML = sorted.length ? sorted.map(function (r) {
            return '<li class="beer-row">' +
                '<span class="beer-score"><b>' + r.Rating.toFixed(2) + '</b>' + ratingDots(r.Rating) + '</span>' +
                '<span class="beer-main"><span class="beer-name">' + escapeHtml(r.Beer) + '</span>' +
                '<span class="beer-sub"><span class="style-dot" style="background-color: ' + STYLE_BY_ID[r.style].color + '"></span>' +
                escapeHtml(r.Beer_style) + ' · ' + placeLink('brewery', r.Brewery, r.ID) + ' (' + escapeHtml(r.Brewery_country) + ')</span>' +
                '<span class="beer-sub">' + placeLink('venue', r.Venue, r.ID) + ' · ' + r.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' +
                '</span></li>';
        }).join('') : '<li class="empty">No check-ins</li>';
    }

    // ---------- Rankings ----------

    // key(record) -> group name(s); name(key) -> html for the name
    var RANKINGS = [
        { id: 'venues', key: function (r) { return [r.Venue]; }, name: function (k) { return placeLink('venue', k); } },
        { id: 'breweries', key: function (r) { return [r.Brewery]; }, name: function (k) { return placeLink('brewery', k); } },
        { id: 'countries', key: function (r) { return [r.Brewery_country]; }, name: escapeHtml },
        { id: 'friends', key: function (r) { return r.Friends; }, name: function (k) {
            return '<img class="avatar" src="ikony/' + encodeURIComponent(k) + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'">' +
                escapeHtml(FRIEND_NAMES[k] || k);
        } },
        { id: 'beer-styles', key: function (r) { return [r.Beer_style]; }, name: escapeHtml }
    ];

    function renderRanking(ranking, list) {
        var mode = state.rankings[ranking.id] || 'most';
        var groups = {};
        list.forEach(function (r) {
            ranking.key(r).forEach(function (k) {
                (groups[k] = groups[k] || []).push(r.Rating);
            });
        });
        var rows = Object.keys(groups).map(function (k) {
            return { key: k, count: groups[k].length, avg: average(groups[k]) };
        });
        if (mode === 'best') {
            rows = rows.filter(function (r) { return r.count >= MIN_FOR_AVERAGE; });
            rows.sort(function (a, b) { return (b.avg - a.avg) || (b.count - a.count); });
        } else {
            rows.sort(function (a, b) { return (b.count - a.count) || (b.avg - a.avg); });
        }
        rows = rows.slice(0, 10);
        var max = rows.length ? (mode === 'best' ? 5 : rows[0].count) : 1;
        var el = document.getElementById('ranking-' + ranking.id);
        el.innerHTML = rows.length ? rows.map(function (row, i) {
            var value = mode === 'best' ? row.avg : row.count;
            return '<li class="rank-row"><span class="rank-no">' + (i + 1) + '</span>' +
                '<span class="rank-main"><span class="rank-name">' + ranking.name(row.key) + '</span>' +
                '<span class="rank-bar"><span style="width: ' + (100 * value / max) + '%"></span></span></span>' +
                '<span class="rank-value">' + (mode === 'best'
                    ? '<b>' + row.avg.toFixed(2) + '</b><small>' + row.count + '×</small>'
                    : '<b>' + row.count + '</b><small>' + row.avg.toFixed(2) + '</small>') + '</span></li>';
        }).join('') : '<li class="empty">' + (mode === 'best' ? 'Nothing with at least ' + MIN_FOR_AVERAGE + ' check-ins' : 'No check-ins') + '</li>';
    }

    // Most / Best rated switches of the rankings and Best / Worst of the beers
    document.addEventListener('click', function (e) {
        var button = e.target.closest('.pill-toggle button');
        if (!button) return;
        var toggle = button.parentNode;
        toggle.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === button); });
        if (toggle.dataset.for === 'beers') {
            state.beers = button.dataset.mode;
            renderBeers(selection());
        } else {
            state.rankings[toggle.dataset.for] = button.dataset.mode;
            renderRanking(RANKINGS.filter(function (r) { return r.id === toggle.dataset.for; })[0], selection());
        }
    });

    // ---------- Wind rose: directions of the venues from Prague ----------

    function azimuth(lat1, lon1, lat2, lon2) {
        var rad = Math.PI / 180;
        var dLon = (lon2 - lon1) * rad;
        var y = Math.sin(dLon) * Math.cos(lat2 * rad);
        var x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLon);
        return (Math.atan2(y, x) / rad + 360) % 360;
    }

    function renderWindRose(list) {
        var counts = {};
        var total = 0;
        list.forEach(function (r) {
            if (!r.Venue_location) return;
            var p = r.Venue_location.split(',').map(Number);
            var dir = DIRECTIONS[Math.round(azimuth(HOME[0], HOME[1], p[0], p[1]) / 22.5) % 16];
            counts[r.style + dir] = (counts[r.style + dir] || 0) + 1;
            total++;
        });
        var series = STYLES.map(function (s) {
            return {
                name: s.label,
                color: s.color,
                visible: !state.hidden.rose[s.id],
                data: DIRECTIONS.map(function (d) { return total ? Math.round(1000 * (counts[s.id + d] || 0) / total) / 10 : 0; })
            };
        });
        if (charts.rose) charts.rose.destroy();
        charts.rose = Highcharts.chart('wind-rose', {
            chart: { polar: true, type: 'column', backgroundColor: 'transparent', style: { fontFamily: 'Arial, sans-serif' } },
            title: { text: null },
            credits: { enabled: false },
            exporting: { enabled: false },
            pane: { size: '88%' },
            legend: { enabled: false },
            xAxis: {
                categories: DIRECTIONS,
                tickmarkPlacement: 'on',
                lineWidth: 0,
                gridLineColor: GRID,
                labels: { style: { color: BROWN, fontWeight: 'bold', fontSize: '11px' } }
            },
            yAxis: {
                min: 0,
                endOnTick: false,
                gridLineColor: GRID,
                labels: { format: '{value} %', style: { color: 'rgba(87, 62, 62, 0.6)', fontSize: '10px' } },
                reversedStacks: false
            },
            tooltip: { shared: true, valueSuffix: ' %', backgroundColor: 'rgba(255, 255, 255, 0.95)', borderColor: BROWN },
            plotOptions: {
                series: { stacking: 'normal', shadow: false, groupPadding: 0, pointPlacement: 'on', borderWidth: 1, borderColor: 'rgb(238, 231, 212)' }
            },
            series: series
        });
        toggleLegend('rose-legend', 'rose');
    }

    // ---------- All ----------

    function render() {
        var list = selection();
        renderYearPills();
        renderSummary(list);
        renderKpis(list);
        renderMonthly(list);
        renderCalendar(list);
        renderWeekdays(list);
        renderRatings(list);
        renderStyles(list);
        renderBeers(list);
        RANKINGS.forEach(function (ranking) { renderRanking(ranking, list); });
        renderWindRose(list);
    }

    render();
})();
