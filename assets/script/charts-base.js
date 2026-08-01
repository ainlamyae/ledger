// Read when each chart is constructed, so a theme switch needs no per-chart options.
function applyChartTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  Chart.defaults.color = dark ? '#94a3b8' : '#6b7280';
  Chart.defaults.borderColor = dark ? '#334155' : '#e5e7eb';

  // privacyMode is read at call time; loadDashboard rebuilds the charts on toggle.
  Chart.defaults.scales.linear.ticks.callback = function (value) {
    const label = this.getLabelForValue(value);
    return privacyMode ? maskDigits(label) : label;
  };
}

// Every reference mark in Health Indicators — the per-column caps, State Trend's target
// line. Deliberately not red: red is this app's "missed" score, so a limit drawn in it
// read as a failure rather than as the thing being measured against.
function targetMarkColor() {
  return document.documentElement.dataset.theme === 'dark' ? '#e2e8f0' : '#1f2937';
}

// Fixed y-axis label width, so plot areas line up down the section however many
// digits each chart's values run to.
const TREND_Y_AXIS_WIDTH = 64;

function fixTrendYAxisWidth(scale) {
  if (scale.width < TREND_Y_AXIS_WIDTH) scale.width = TREND_Y_AXIS_WIDTH;
}

// Invisible spacer reserving the same width as a real right axis, so a chart without
// one doesn't stretch further right and misalign the section's date labels. A factory,
// since afterFit mutates the scale it's handed.
function ghostRightAxis() {
  return {
    position: 'right',
    afterFit: fixTrendYAxisWidth,
    grid: { drawOnChartArea: false, drawTicks: false },
    border: { display: false },
    ticks: { display: false },
  };
}

// Mirror, for a chart whose real axis sits on the right (Body Mass's kg scale).
function ghostLeftAxis() {
  return { ...ghostRightAxis(), position: 'left' };
}

// The section's one mark for "the figure that applies here": a hairline floating bar
// (`[from, to]`, `grouped: false`) overlaying its own column. Shared so the mark means
// the same thing everywhere. One `values` entry per column; null leaves it unmarked.
function targetCapDataset(label, values, capHalf, extra = {}) {
  return {
    type: 'bar',
    label,
    data: values.map((v) => (v === null || v === undefined ? null : [v - capHalf, v + capHalf])),
    backgroundColor: targetMarkColor(),
    grouped: false,
    // Lowest order paints last, so the cap stays visible on a column that overshot it.
    order: 0,
    ...extra,
  };
}

// A fraction of the axis span, not a fixed amount in the data's units, so the cap
// stays a hairline at any range.
function targetCapHalf(axisSpan) {
  return Math.abs(axisSpan) * 0.006;
}

// Violet, the app's existing "not a score" colour. Grey was tried first and vanished:
// a mid-tone in both themes, and it already means "unscored bar" on the same chart.
const WEEKLY_AVG_COLOR = '#7c3aed';

// Counted back from the last BUCKETED column — see bucketedColumnCount: that's the
// last column of the window, except when the window ends today, in which case it's
// yesterday. So the most recent seven complete days are one whole bucket and only
// the oldest can come up short.
//
// Returns -1 for a column past the bucketed range (today), which every caller reads
// as "belongs to no week": buckets.get(-1) is undefined, so the column averages to
// null and weeklyAverageDataset's sameBucket() refuses to join a dash to it.
function weeklyBucketIndex(i, count) {
  return Math.floor((count - 1 - i) / 7);
}

// How many of `dates`' columns the weekly maths may bucket. Today is left out
// whenever it's the last column: it's a day in progress — the food logged by
// 10am, the steps walked so far — so averaging it in drags the current week down
// by an amount that shrinks as the day goes on, and reports "this week" as worse
// than it is. A window ending on a past date has no such column and keeps all of
// them.
function bucketedColumnCount(dates) {
  const endsToday = dates.length > 0 && dates[dates.length - 1] === isoFromDate(new Date());
  return endsToday ? dates.length - 1 : dates.length;
}

// Per column, the mean of its 7-day bucket. Nulls are unlogged days and sit out (avg()'s
// rule), so a missing log can't drag the week under a target it was never measured
// against. A bucket with nothing logged stays null.
function weeklyAverageSeries(values, columnsToBucket = values.length) {
  const buckets = new Map();
  values.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const b = weeklyBucketIndex(i, columnsToBucket);
    if (b < 0) return;
    const acc = buckets.get(b) ?? { total: 0, n: 0 };
    buckets.set(b, { total: acc.total + v, n: acc.n + 1 });
  });
  return values.map((_, i) => {
    const acc = buckets.get(weeklyBucketIndex(i, columnsToBucket));
    return acc ? acc.total / acc.n : null;
  });
}

// For bars that are an absolute LEVEL, not a per-day quantity (Body Mass): a flat mean
// says almost nothing there, so each week gets the least-squares fit through its own
// readings, evaluated across all seven columns. Columns are consecutive days, so the
// slope is per day. One reading yields just that reading — a flat dash would claim the
// week didn't move, which isn't measured. None yields nothing.
function weeklyTrendSeries(values, columnsToBucket = values.length) {
  const points = new Map();
  values.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const b = weeklyBucketIndex(i, columnsToBucket);
    if (b < 0) return;
    if (!points.has(b)) points.set(b, { xs: [], ys: [] });
    points.get(b).xs.push(i);
    points.get(b).ys.push(v);
  });

  const fits = new Map();
  points.forEach((p, b) => {
    if (p.xs.length >= 2) fits.set(b, linearRegression(p.xs, p.ys));
  });

  const series = values.map((v, i) => {
    const bucket = weeklyBucketIndex(i, columnsToBucket);
    // Today: no fit, and no bare reading either. Falling back to `v` here would draw
    // a lone dot on a "7-Day Trend" line from a single day of data.
    if (bucket < 0) return null;
    const fit = fits.get(bucket);
    if (fit) return fit.slope * i + fit.intercept;
    return v === null || v === undefined ? null : v;
  });
  // Per column so the tooltip needn't re-derive the bucket; per week because that's the
  // figure worth acting on.
  const slopePerWeek = values.map((_, i) => {
    const fit = fits.get(weeklyBucketIndex(i, columnsToBucket));
    return fit ? fit.slope * 7 : null;
  });
  return { series, slopePerWeek };
}

// One dashed segment per week — flat for an average, sloped for a trend. The segment
// crossing a bucket boundary is painted transparent, so the weeks read as separate
// dashes rather than one line joined by vertical risers.
function weeklyAverageDataset(label, series, extra = {}, columnsToBucket = series.length) {
  // Bounds-checked: an out-of-range index can otherwise land back on a real bucket
  // number and hide a one-column week. A -1 bucket (today) matches nothing, so the
  // segment into today's column is transparent like any other week boundary.
  const sameBucket = (a, b) => a >= 0 && b >= 0 && a < series.length && b < series.length
    && weeklyBucketIndex(a, columnsToBucket) >= 0
    && weeklyBucketIndex(a, columnsToBucket) === weeklyBucketIndex(b, columnsToBucket);
  const hasValue = (i) => series[i] !== null && series[i] !== undefined;
  const joined = (a, b) => sameBucket(a, b) && hasValue(a) && hasValue(b);
  return {
    type: 'line',
    label,
    data: series,
    borderColor: WEEKLY_AVG_COLOR,
    // Matched to the target caps, which land near 2px on a 200-240px plot area.
    borderWidth: 2,
    borderDash: [6, 4],
    tension: 0,
    segment: {
      borderColor: (c) => (sameBucket(c.p0DataIndex, c.p1DataIndex) ? WEEKLY_AVG_COLOR : 'transparent'),
    },
    // With no drawable segment either side, show a dot rather than nothing — the
    // clipped oldest bucket, or a Body Mass week holding one weigh-in.
    pointRadius: (c) => (hasValue(c.dataIndex)
      && !joined(c.dataIndex, c.dataIndex - 1) && !joined(c.dataIndex, c.dataIndex + 1) ? 2 : 0),
    pointBackgroundColor: WEEKLY_AVG_COLOR,
    pointHitRadius: 0,
    isWeeklyAverage: true,
    // Between the bars (2) and the target caps (0), so the cap stays the top mark.
    order: 1,
    ...extra,
  };
}

// Rounds up to 1/2/5 x a power of ten (4327 -> 5000), so an explicit axis cap still
// gets clean gridlines.
function niceAxisMax(value) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const residual = value / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

// Finer ladder, where niceAxisMax's 1/2/5/10 would waste most of the plot area.
const NICE_AXIS_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceAxisBound(value) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const residual = value / magnitude;
  return (NICE_AXIS_STEPS.find((step) => residual <= step) ?? 10) * magnitude;
}

// Destroy-then-construct — except the construct half is lazy: rather than an
// immediate `new Chart()`, every chart goes through an IntersectionObserver and only
// builds once its .chart-box actually intersects, so scrolling past a long page of
// collapsed panels doesn't pay for every chart's layout/paint up front.
//
// A freshly-collapsed panel (setupPanelToggles, app.js) is mid CSS transition right
// after boot — its collapsing wrapper (styles.css's ".panel.collapsed > *", a 0.35s
// max-height transition) can still be tall for the first ~350ms, so an observer
// started the instant a chart renders can catch that in-between state and report a
// false "visible" for a chart that's actually about to be hidden. Charts inside an
// already-collapsed panel wait out that transition before their observer's first
// check, so it sees the real, settled geometry; anything not inside a collapsed
// panel (i.e. genuinely on screen already) observes immediately, no added delay.
//
// The returned value stands in for the real Chart instance everywhere a caller
// stores it back as `existingChart` next time — but one chart (Category Expenditure
// Trend, finance-charts.js) also keeps calling real Chart.js instance methods
// (isDatasetVisible/setDatasetVisibility/update) and touching `.options` on it
// directly, from its own legend, so a plain {destroy()} stand-in isn't enough. This
// returns a Proxy instead: once the real chart exists, every property/method
// transparently forwards to it (including nested writes like
// `chart.options.scales.y.max = …`, since the returned value is the real object,
// not a copy); before that, dataset-visibility reads default to "visible" and
// mutators/redraw calls no-op, so a legend built before its chart has ever been on
// screen doesn't throw.
//
// Only for the unconditional case; a render that skips construction on empty data
// keeps its own manual destroy.
const PANEL_COLLAPSE_TRANSITION_MS = 400;

function upsertChart(existingChart, ctx, config) {
  if (existingChart) existingChart.destroy();

  const canvas = ctx.canvas || ctx;
  const box = canvas.closest('.chart-box') || canvas;
  const state = { chart: null, observer: null, timer: null };

  const build = () => { state.chart = new Chart(ctx, config); };

  const startObserving = () => {
    state.observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        build();
        state.observer.disconnect();
      }
    }, { rootMargin: '400px' });
    state.observer.observe(box);
  };

  if (box.closest('.panel.collapsed')) {
    state.timer = setTimeout(startObserving, PANEL_COLLAPSE_TRANSITION_MS);
  } else {
    startObserving();
  }

  const PRE_BUILD_DEFAULTS = {
    isDatasetVisible: () => true,
    setDatasetVisibility: () => {},
    update: () => {},
    resize: () => {},
  };

  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'destroy') {
        return () => {
          state.chart?.destroy();
          state.observer?.disconnect();
          clearTimeout(state.timer);
        };
      }
      if (state.chart) {
        const value = state.chart[prop];
        return typeof value === 'function' ? value.bind(state.chart) : value;
      }
      return PRE_BUILD_DEFAULTS[prop];
    },
  });
}

// A category's four period bars share one hue, told apart by opacity (most recent =
// most opaque).
function hslWithAlpha(hsl, alpha) {
  return hsl.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

// Category-colour swatch legend, shared by several panels.
//
// Pass `toggle` and every entry becomes a button that switches its series off and
// on: `isHidden(entry, i)` decides how the entry is drawn, `onToggle(entry, i)`
// does the hiding and redraws. What "hiding" means differs per chart — a dataset
// on the trend chart, a category filtered out of a whole re-render on the ones
// whose colours or ring proportions depend on what's showing — so that decision
// stays with the chart and the legend only reports the click.
//
// A hidden entry stays in the legend, dimmed and struck through: it's the only way
// back, and a legend that lost its entry on click would be a one-way door.
function renderCategoryLegend(containerId, categories, toggle) {
  const legend = document.getElementById(containerId);
  legend.innerHTML = '';
  categories.forEach((c, i) => {
    const item = document.createElement(toggle ? 'button' : 'span');
    item.className = 'donut-legend-item';

    if (toggle) {
      const hidden = toggle.isHidden(c, i);
      item.type = 'button';
      item.classList.add('donut-legend-item-toggle');
      item.classList.toggle('donut-legend-item-off', hidden);
      item.setAttribute('aria-pressed', String(!hidden));
      item.title = `${hidden ? 'Show' : 'Hide'} ${c.name}`;
      item.addEventListener('click', () => toggle.onToggle(c, i));
    }

    const swatch = document.createElement('span');
    swatch.className = 'donut-legend-swatch';
    swatch.style.backgroundColor = c.color;

    item.append(swatch, document.createTextNode(c.name));
    legend.appendChild(item);
  });
}

// The shared From/To picker: one implementation instead of each panel re-deriving its
// own defaulting and wiring. Seeds both inputs to the last defaultDays when empty,
// fires onChange on every edit, and returns a getter for the current {from, to}.
function initDateRangeControl(fromId, toId, defaultDays, onChange) {
  const fromEl = document.getElementById(fromId);
  const toEl = document.getElementById(toId);

  if (!fromEl.value || !toEl.value) {
    const defaultDates = lastNDates(defaultDays);
    fromEl.value = defaultDates[0];
    toEl.value = defaultDates[defaultDates.length - 1];
  }

  fromEl.addEventListener('change', onChange);
  toEl.addEventListener('change', onChange);

  return () => ({ from: fromEl.value, to: toEl.value });
}

// Health units never pass through formatCurrency's masking, but they're still personal
// data the privacy toggle should hide — and a tooltip would leak the exact figure even
// with masked ticks. `decimals: null` strips float noise without forcing trailing zeros;
// pass a number (2 for BMI) to fix the places instead.
function maskedUnitTick(unit, decimals = null) {
  return (v) => {
    // Chart.js builds ticks by repeated addition, which drifts into float noise
    // (32.400000000000006) on a fractional step. Round before it reaches the label.
    const rounded = decimals !== null ? v.toFixed(decimals) : Math.round(v * 100) / 100;
    const label = `${rounded} ${unit}`;
    return privacyMode ? maskDigits(label) : label;
  };
}

function maskedValueTooltipLabel(item) {
  const prefix = item.dataset.label ? `${item.dataset.label}: ` : '';
  const value = String(item.formattedValue);
  return `${prefix}${privacyMode ? maskDigits(value) : value}`;
}

// "Jun 29", matching offsetToDateLabel below, rather than the raw ISO string a
// category axis shows by default.
function formatIsoDateShort(iso) {
  return new Date(parseIsoDateUTC(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// On a category scale `value` is the tick's index, so it resolves back to the ISO
// string first.
function shortDateTickCallback(value) {
  return formatIsoDateShort(this.getLabelForValue(value));
}

// Fat energy runs to six figures against a capped axis width, so "175k kcal".
function maskedThousandsTick(unit) {
  return (v) => {
    const label = `${Math.round(v / 1000)}k ${unit}`;
    return privacyMode ? maskDigits(label) : label;
  };
}
