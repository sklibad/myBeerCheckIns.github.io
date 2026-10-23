// Statistics page: everything is computed in the browser from stats_data.js (`data`, one record
// per check-in) and redrawn whenever another year is chosen.
(function () {
    'use strict';

    // ---------- Basics ----------

    // Beer styles grouped like the filters of the check-in map, one colour each on all charts
    var STYLES = [
        { id: 'lager', label: 'Lager', color: '#ffc000' },
        { id: 'ale', label: 'Ale / APA', color: '#e07400' },
        { id: 'ipa', label: 'IPA', color: '#6e9a1e' },
        { id: 'sour', label: 'Sour', color: '#c8326b' },
        { id: 'stout', label: 'Stout / Porter', color: '#3b2a20' },
        { id: 'other', label: 'Other', color: '#b8b8b8' }
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
    var DIRECTIONS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    var MIN_FOR_AVERAGE = 5;               // "Best rated" rankings: places with at least 5 check-ins
    // Untappd look (see stats.css)
    var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", Arial, sans-serif';
    var TEXT = '#000000';
    var TEXT_SOFT = '#595959';
    var LINE = '#e2e2e2';
    var YELLOW = '#ffc000';
    var YELLOW_DARK = '#e0a800';
    var AMBER = '#c77700';

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

    // Five rating caps like on Untappd, the last one partly filled; withNumber adds "(4.25)"
    function ratingCaps(rating, withNumber) {
        var html = '<span class="caps" aria-hidden="true">';
        for (var i = 1; i <= 5; i++) {
            var fill = Math.max(0, Math.min(1, rating - (i - 1)));
            html += '<span class="cap" style="--fill: ' + Math.round(fill * 100) + '%"></span>';
        }
        html += '</span>';
        return withNumber ? html + '<span class="caps-num">(' + rating.toFixed(2) + ')</span>' : html;
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

    Chart.defaults.font.family = FONT;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = TEXT_SOFT;
    Chart.defaults.plugins.tooltip.backgroundColor = '#ffffff';
    Chart.defaults.plugins.tooltip.titleColor = TEXT;
    Chart.defaults.plugins.tooltip.bodyColor = TEXT_SOFT;
    Chart.defaults.plugins.tooltip.borderColor = LINE;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 4;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    var GRID = '#ededed';
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
            '<div class="kpi"><span class="kpi-value">' + avg.toFixed(2) + '</span><span class="kpi-label">Average rating</span>' + ratingCaps(avg) + '</div>';
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
        charts.monthly.data.datasets = [{ data: values, backgroundColor: YELLOW, hoverBackgroundColor: YELLOW_DARK, borderRadius: 2, maxBarThickness: 36 }];
        charts.monthly.update();

        var best = values.indexOf(Math.max.apply(null, values));
        document.getElementById('monthly-note').textContent = values[best]
            ? 'Busiest: ' + labels[best] + ' (' + plural(values[best], 'check-in') + ')' : '';
    }

    // ---------- Calendar heatmap: months × days ----------

    var HEAT = ['#ffeeb3', '#ffd966', '#ffc000', '#e08f00', '#a35a00'];

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
            backgroundColor: counts.map(function (c) { return c === max ? AMBER : YELLOW; }),
            borderRadius: 2,
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
            borderColor: '#ffffff',
            borderWidth: 2
        }];
        charts.styles.update();
        styleLegend('style-legend', counts, list.length);

        // Served as: one stacked bar
        var serving = {};
        list.forEach(function (r) { serving[r.Serving_style] = (serving[r.Serving_style] || 0) + 1; });
        var colors = { Draft: YELLOW, Bottle: '#8a4500', Can: '#b8b8b8' };
        var kinds = Object.keys(serving).sort(function (a, b) { return serving[b] - serving[a]; });
        document.getElementById('serving').innerHTML =
            '<div class="serving-bar">' + kinds.map(function (k) {
                return '<span style="width: ' + (100 * serving[k] / list.length) + '%; background-color: ' + (colors[k] || TEXT_SOFT) + '" title="' + k + ': ' + serving[k] + '"></span>';
            }).join('') + '</div><div class="legend">' + kinds.map(function (k) {
                return '<span class="legend-item"><span class="legend-swatch" style="background-color: ' + (colors[k] || TEXT_SOFT) + '"></span>' +
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
        document.getElementById('top-beers').innerHTML = sorted.length ? sorted.map(function (r, i) {
            return '<li class="beer-row">' +
                '<span class="beer-main"><span class="beer-name"><span class="beer-rank">' + (i + 1) + '</span>' + escapeHtml(r.Beer) + '</span>' +
                '<span class="beer-sub">' + placeLink('brewery', r.Brewery, r.ID) + ' (' + escapeHtml(r.Brewery_country) + ')</span>' +
                '<span class="beer-sub"><span class="style-dot" style="background-color: ' + STYLE_BY_ID[r.style].color + '"></span>' + escapeHtml(r.Beer_style) + '</span>' +
                '</span><span class="beer-details"><span>' + ratingCaps(r.Rating, true) + '</span>' +
                '<span>' + placeLink('venue', r.Venue, r.ID) + '</span>' +
                '<span>' + r.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' +
                '</span></li>';
        }).join('') : '<li class="empty">No check-ins</li>';
    }

    // ---------- Rankings ----------

    // key(record) -> group name(s); name(key) -> html for the name
    var RANKINGS = [
        { id: 'venues', key: function (r) { return [r.Venue]; }, name: function (k) { return placeLink('venue', k); } },
        { id: 'breweries', key: function (r) { return [r.Brewery]; }, name: function (k) { return placeLink('brewery', k); } },
        { id: 'countries', key: function (r) { return [r.Brewery_country]; }, name: function (k) { return '<span>' + escapeHtml(k) + '</span>'; } },
        { id: 'friends', key: function (r) { return r.Friends; }, name: function (k) {
            return '<img class="avatar" src="ikony/' + encodeURIComponent(k) + '.jpg" alt="" onerror="this.style.visibility=\'hidden\'">' +
                '<span>' + escapeHtml(FRIEND_NAMES[k] || k) + '</span>';
        } },
        { id: 'beer-styles', key: function (r) { return [r.Beer_style]; }, name: function (k) {
            return '<span class="style-dot" style="background-color: ' + STYLE_BY_ID[styleGroup(k)].color + '"></span><span>' + escapeHtml(k) + '</span>';
        } }
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
                    : '<b>' + row.count + '</b><small>(' + row.avg.toFixed(2) + ')</small>') + '</span></li>';
        }).join('') : '<li class="empty">' + (mode === 'best' ? 'Nothing with at least ' + MIN_FOR_AVERAGE + ' check-ins' : 'No check-ins') + '</li>';
    }

    // Most / Best rated tabs of the rankings and Best / Worst of the beers
    document.addEventListener('click', function (e) {
        var button = e.target.closest('.filter-tabs button');
        if (!button) return;
        var toggle = button.parentNode;
        if (toggle.dataset.for === 'rose-area') {
            rose.area = button.dataset.mode;
            renderWindRose(selection());
            setRoseScale(rose.area, true);
            return;
        }
        toggle.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === button); });
        if (toggle.dataset.for === 'beers') {
            state.beers = button.dataset.mode;
            renderBeers(selection());
        } else {
            state.rankings[toggle.dataset.for] = button.dataset.mode;
            renderRanking(RANKINGS.filter(function (r) { return r.id === toggle.dataset.for; })[0], selection());
        }
    });

    // ---------- Wind rose over a map: directions of the venues from home ----------

    // The rose is centred on the venue "Home - Ipak". The map below always keeps that point in its
    // centre (no dragging, zoom around the centre), so every sector points at the area it counts.
    var HOME = (function () {
        var home = records.filter(function (r) { return r.Venue === 'Home - Ipak' && r.Venue_location; })[0];
        return home ? home.Venue_location.split(',').map(Number) : [50.0734821, 14.4282220];
    })();
    var ROSE_MARGIN = 28;                                   // chart margin, the same on all sides
    // The tabs choose which check-ins the rose counts (by the venue: in Prague, in the rest of
    // Czechia, abroad; venueAreas from stats_data.js, venues missing there are abroad) and the
    // map scale for them: the distance from home at the rim of the rose
    var ROSE_AREAS = {
        prague: { km: 14, text: 'in Prague' },
        czechia: { km: 300, text: 'in Czechia without Prague' },
        abroad: { km: 2600, text: 'abroad' }
    };
    // area: the chosen tab; scale: its map scale (null after the user zooms by hand);
    // auto: a zoom set by the code is running
    var rose = { map: null, dots: null, area: 'prague', scale: 'prague', auto: false };

    function venueArea(r) {
        return (typeof venueAreas !== 'undefined' && venueAreas[r.Venue]) || 'abroad';
    }

    // direction of a venue as it lies on the (Web Mercator) map under the rose, so the sectors
    // point at the dots; the great-circle bearing would differ far away (USA: WNW instead of W)
    function azimuth(lat1, lon1, lat2, lon2) {
        var rad = Math.PI / 180;
        var mercY = function (lat) { return Math.log(Math.tan(Math.PI / 4 + lat * rad / 2)); };
        var dLon = (lon2 - lon1) * rad;
        return (Math.atan2(dLon, mercY(lat2) - mercY(lat1)) / rad + 360) % 360;
    }

    // radius of the rose in pixels (pane size 88 % of the plot area)
    function roseRadius() {
        var size = rose.map.getSize();
        return 0.44 * Math.max(50, Math.min(size.x, size.y) - 2 * ROSE_MARGIN);
    }

    // zoom at which the rim of the rose lies the scale's distance from home
    function zoomForScale(scale) {
        var metresPerPixel = 1000 * ROSE_AREAS[scale].km / roseRadius();
        return Math.log(156543.03392 * Math.cos(HOME[0] * Math.PI / 180) / metresPerPixel) / Math.LN2;
    }

    function markAreaTab() {
        document.querySelectorAll('[data-for="rose-area"] button').forEach(function (b) {
            b.classList.toggle('active', b.dataset.mode === rose.area);
        });
    }

    function setRoseScale(scale, animate) {
        var zoom = rose.map._limitZoom(zoomForScale(scale));
        rose.scale = scale;
        if (zoom === rose.map.getZoom()) return;
        rose.auto = true;
        rose.map.setView(HOME, zoom, { animate: !!animate });
    }

    // a zoom by hand (wheel, pinch, + / -) leaves the preset scale (the chosen check-ins stay)
    function onRoseZoomEnd() {
        if (rose.auto) {
            rose.auto = false;
            return;
        }
        rose.scale = null;
    }

    // Attribution (Leaflet, Esri, author) hidden behind an "i" button like on the other maps
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
        // keep the "i" button at the very bottom of its corner, below the zoom buttons
        control.getContainer().parentNode.appendChild(control.getContainer());
        map.on('click', function () { setOpen(false); });
    }

    function initRoseMap() {
        rose.map = L.map('rose-map', {
            center: HOME,
            zoom: 5,
            zoomSnap: 0.25,
            zoomDelta: 0.5,
            minZoom: 1,
            maxZoom: 16,
            dragging: false,
            scrollWheelZoom: 'center',
            doubleClickZoom: 'center',
            touchZoom: 'center',
            boxZoom: false,
            keyboard: false,
            zoomControl: false,
            preferCanvas: true
        });
        L.control.zoom({ position: 'bottomright' }).addTo(rose.map);
        rose.map.createPane('labels').style.zIndex = 410;
        rose.map.getPane('labels').style.pointerEvents = 'none';
        var esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
        L.tileLayer(esri + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxNativeZoom: 16,
            attribution: 'Tiles &copy; <a href="https://www.esri.com" target="_blank">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors | ' +
                '<a href="https://www.linkedin.com/in/david-skliba/?locale=en_US" target="_blank">David \u0160kl\u00edba</a>'
        }).addTo(rose.map);
        L.tileLayer(esri + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, pane: 'labels' }).addTo(rose.map);
        rose.dots = L.layerGroup().addTo(rose.map);
        addAttributionToggle(rose.map);
        rose.map.on('zoomend', onRoseZoomEnd);
        // keep the rose centred on home and the chosen scale whenever the box changes size
        // (window resize, phone rotation, layout changes)
        rose.map.on('resize', function () {
            if (rose.scale) setRoseScale(rose.scale, false);
        });
        if (window.ResizeObserver) {
            new ResizeObserver(function () {
                rose.map.invalidateSize(false);
                if (charts.rose) charts.rose.reflow();
            }).observe(rose.map.getContainer());
        }
        setRoseScale(rose.scale, false);
    }

    // venues of the selection as dots under the rose, area by the number of check-ins
    function renderRoseDots(list) {
        var venues = {};
        list.forEach(function (r) {
            if (r.Venue_location) venues[r.Venue_location] = (venues[r.Venue_location] || 0) + 1;
        });
        rose.dots.clearLayers();
        Object.keys(venues).forEach(function (loc) {
            L.circleMarker(loc.split(',').map(Number), {
                radius: Math.min(9, 2 + Math.sqrt(venues[loc])),
                stroke: false,
                fillColor: '#8a4500',
                fillOpacity: 0.55,
                interactive: false
            }).addTo(rose.dots);
        });
    }

    function renderWindRose(selected) {
        if (!rose.map) initRoseMap();
        var list = selected.filter(function (r) { return venueArea(r) === rose.area; });
        markAreaTab();
        document.getElementById('rose-note').textContent = plural(list.length, 'check-in') + ' ' +
            ROSE_AREAS[rose.area].text + ' \u00b7 share per direction from Home \u2013 Ipak';
        renderRoseDots(list);
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
        var halo = '3px #ffffff';
        if (charts.rose) charts.rose.destroy();
        charts.rose = Highcharts.chart('wind-rose', {
            chart: { polar: true, type: 'column', backgroundColor: 'transparent', margin: ROSE_MARGIN, style: { fontFamily: FONT } },
            title: { text: null },
            credits: { enabled: false },
            exporting: { enabled: false },
            pane: { size: '88%', background: [{ backgroundColor: 'transparent', borderWidth: 0 }] },
            legend: { enabled: false },
            xAxis: {
                categories: DIRECTIONS,
                tickmarkPlacement: 'on',
                lineWidth: 0,
                gridLineColor: 'rgba(0, 0, 0, 0.22)',
                labels: { style: { color: TEXT, fontWeight: '600', fontSize: '12px', textOutline: halo } }
            },
            yAxis: {
                min: 0,
                endOnTick: false,
                gridLineColor: 'rgba(0, 0, 0, 0.14)',
                labels: { format: '{value} %', style: { color: TEXT_SOFT, fontSize: '10px', textOutline: halo } },
                reversedStacks: false
            },
            tooltip: { shared: true, followTouchMove: false, valueSuffix: ' %', backgroundColor: '#ffffff', borderColor: LINE, borderRadius: 4, shadow: false, style: { color: TEXT } },
            plotOptions: {
                series: { stacking: 'normal', shadow: false, groupPadding: 0, pointPlacement: 'on', borderWidth: 1, borderColor: '#ffffff', opacity: 0.8 }
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
