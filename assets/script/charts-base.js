// Read when each chart is constructed, so a theme switch needs no per-chart options.
function applyChartTheme() {
  Chart.defaults.color = chartColor('--color-text-muted');
  Chart.defaults.borderColor = chartColor('--color-border');
  // Every chart's text at .9rem, the app's own size for that band, in the px Chart.js takes.
  Chart.defaults.font.size = chartFontSize();

  // privacyMode is read at call time; loadDashboard rebuilds the charts on toggle.
  Chart.defaults.scales.linear.ticks.callback = function (value) {
    const label = this.getLabelForValue(value);
    return privacyMode ? maskDigits(label) : label;
  };
}

// .9rem in px, against the page's base size (which steps with screen width).
function chartFontSize() {
  return 0.9 * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

// Every reference mark in Health Indicators — the per-column caps, State Trend's target
// line. Deliberately not red: red is this app's "missed" score, so a limit drawn in it
// read as a failure rather than as the thing being measured against.
function targetMarkColor() {
  return chartColor('--color-text');
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

// Teal, for BMR_cal beside BMR_adp's violet — a third reference line on the same chart needs
// its own hue, not a tint of either existing one, so all three bases stay visually distinct
// in both themes.

// Amber, for BMR_kat beside BMR_mif's default mark, so the two equations read apart.

// A continuous exponential moving average, not a fixed weekly bucket: each day blends
// today's own reading into yesterday's already-smoothed value, rather than every column
// in a calendar week sharing one fit that resets at the boundary — the reset is what
// made the old per-week trend jump at every seventh column even when the data barely
// changed. alpha = 2/(span+1) gives it roughly a `span`-day memory. An unlogged day
// carries the last smoothed value forward rather than breaking the line.
function emaSeries(values, span = 7) {
  const alpha = 2 / (span + 1);
  let prev = null;
  return values.map((v) => {
    if (v === null || v === undefined) return prev;
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    return prev;
  });
}

// The smoothed series' own rate of change over the trailing `span` days — comparable to
// the old per-week slope, but read off two points on one continuous curve instead of a
// fit that jumps at a bucket boundary. Null until there's a full span of smoothed values
// behind it.
function emaSlopePerSpan(series, span = 7) {
  return series.map((_, i) => (i >= span && series[i] !== null && series[i - span] !== null
    ? series[i] - series[i - span]
    : null));
}

// The trend line: a solid curve in the dark/light neutral every other reference
// mark on these charts uses. `monotone` interpolation keeps the curve from overshooting
// past a local high/low into a bump the data never had.
function trendLineDataset(label, series, extra = {}) {
  return {
    type: 'line',
    label,
    data: series,
    borderColor: targetMarkColor(),
    borderWidth: 2,
    fill: false,
    tension: 0.3,
    cubicInterpolationMode: 'monotone',
    spanGaps: false,
    pointRadius: 0,
    pointHitRadius: 0,
    isWeeklyAverage: true,
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

// Every chart colour comes from styles.css's :root (--chart-*, --color-*), read when
// the chart is drawn, so a change there restyles the charts too. `alpha` gives rgba.
function chartColor(name, alpha = null) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase();
  if (alpha === null || !/^#[0-9a-f]{6}$/.test(hex)) return hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// A generated category colour at `hue`, saturation and lightness from styles.css;
// `shade` steps it darker by --chart-series-shade-step.
function seriesColor(hue, { saturation = '--chart-series-saturation', lightness = '--chart-series-lightness', shade = 0 } = {}) {
  const pct = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return `hsl(${hue}, ${pct(saturation)}%, ${pct(lightness) - shade * pct('--chart-series-shade-step')}%)`;
}

// A #rrggbb colour's hue, 0-360.
function colorHue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
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
    swatch.style.setProperty('--swatch-color', c.color);

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

// Dates read YYYY-MM-DD everywhere, chart ticks and hovers included.
function formatIsoDateShort(iso) {
  return new Date(parseIsoDateUTC(iso)).toISOString().slice(0, 10);
}

// On a category scale `value` is the tick's index, so it resolves back to the ISO
// string first.
function shortDateTickCallback(value) {
  return formatIsoDateShort(this.getLabelForValue(value));
}

// Up to `maxTicks` indices spread evenly across 0..length-1 inclusive (both ends
// included whenever there's more than one). Only a fallback now — see
// wellnessTickIndices below, which anchors to calendar weeks instead — for a window too
// short to contain a Monday, and for thinning a long list of Mondays down to maxTicks.
function evenlySpacedIndices(length, maxTicks = 7) {
  if (length <= 0) return [];
  if (length <= maxTicks) return Array.from({ length }, (_, i) => i);
  const out = [];
  for (let i = 0; i < maxTicks; i++) {
    out.push(Math.round((i * (length - 1)) / (maxTicks - 1)));
  }
  return [...new Set(out)];
}

// Every Monday in `dates` — the grid anchored to calendar weeks rather than picked
// evenly by array index. Index-evenly-spaced ticks land on a different weekday every
// time the window's own length changes by even a single day (a 28-day window and a
// 29-day window spread their 7 picks differently), which is what made the grid feel
// "random" even once every chart was reading it off one shared date list. Thinned
// toward maxTicks — still only Mondays — when a long window has more of them than that;
// falls back to evenlySpacedIndices on a window too short to contain even one.
function wellnessTickIndices(dates, maxTicks = 7) {
  const mondays = [];
  dates.forEach((d, i) => {
    if (new Date(parseIsoDateUTC(d)).getUTCDay() === 1) mondays.push(i);
  });
  if (mondays.length === 0) return evenlySpacedIndices(dates.length, maxTicks);
  if (mondays.length <= maxTicks) return mondays;
  return evenlySpacedIndices(mondays.length, maxTicks).map((i) => mondays[i]);
}

// The x scale for every category-axis wellness chart (labels: dates) — forces its ticks
// onto wellnessTickIndices instead of Chart.js's own autoSkip, so it can't drift from
// State Trend & Forecast's linear axis, which is built to pick the same indices over the
// same window (see the scales.x block in renderWellnessProjectionChart).
function wellnessCategoryXScale(dates) {
  return {
    afterBuildTicks: (axis) => {
      axis.ticks = wellnessTickIndices(dates).map((i) => ({ value: i }));
    },
    // autoSkip false: it defaults to true and runs AFTER afterBuildTicks, so left on it
    // was free to thin the ticks just set above however IT saw fit at the current
    // canvas width — independently of whatever the linear axis's own autoSkip pass
    // decided — which is exactly the kind of divergence afterBuildTicks was meant to
    // rule out. Off here, the ticks this function chose are the ticks that get drawn.
    ticks: { maxRotation: 45, minRotation: 45, autoSkip: false, callback: shortDateTickCallback },
  };
}

// Fat energy runs to six figures against a capped axis width, so "175k kcal".
function maskedThousandsTick(unit) {
  return (v) => {
    const label = `${Math.round(v / 1000)}k ${unit}`;
    return privacyMode ? maskDigits(label) : label;
  };
}
