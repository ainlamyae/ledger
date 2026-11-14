// Read when each chart is constructed, so a theme switch needs no per-chart options.
function applyChartTheme() {
  Chart.defaults.color = chartColor('--color-text-muted');
  Chart.defaults.borderColor = chartColor('--color-border');
  Chart.defaults.font.size = chartFontSize();
  // The page's own font, not Chart.js's Helvetica/Arial.
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  // Every tooltip drawn over the page (htmlTooltip), so a tall one isn't cut at the canvas.
  Chart.defaults.plugins.tooltip.enabled = false;
  Chart.defaults.plugins.tooltip.external = htmlTooltip;

  // privacyMode is read at call time; loadDashboard rebuilds the charts on toggle.
  Chart.defaults.scales.linear.ticks.callback = function (value) {
    const label = this.getLabelForValue(value);
    return privacyMode ? maskDigits(label) : label;
  };
}

// The type scale's Small (--text-small, .8rem) in px, as table text is.
function chartFontSize() {
  return 0.8 * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

// Every reference mark in Health Chart (caps, State Trend's healthy line). Not red: red
// means "missed", so a limit drawn in it read as a failure.
function desiredMarkColor() {
  return chartColor('--color-text');
}

// Fixed y-axis widths, so plot areas line up down a section. The left fits an
// 18-character Rotation name ("Protein Supplement"); right axes carry only short units.
const TREND_Y_AXIS_LABEL_CHARS = 18;
const TREND_Y_AXIS_WIDTH = 120;
const TREND_Y_AXIS_RIGHT_WIDTH = 84;

// A Rotation name cut to TREND_Y_AXIS_LABEL_CHARS; the hover still names it in full.
function trendYAxisCategoryTick(value) {
  const name = String(this.getLabelForValue(value) ?? '');
  return name.length > TREND_Y_AXIS_LABEL_CHARS ? `${name.slice(0, TREND_Y_AXIS_LABEL_CHARS - 1)}…` : name;
}

// An exact width, not a minimum: wider unit ticks would otherwise push one chart's plot
// area in and its gridlines out of line with the rest.
function fixTrendYAxisWidth(scale) {
  scale.width = scale.position === 'right' ? TREND_Y_AXIS_RIGHT_WIDTH : TREND_Y_AXIS_WIDTH;
}

// The dated Health charts' y axes, both sides one width: just wide enough for their
// widest label, so every chart's gridlines line up.
const DATED_Y_AXIS_WIDEST_LABEL = '-1500 kcal';
function fixDatedYAxisWidth(scale) {
  const { ctx, options } = scale;
  ctx.save();
  ctx.font = Chart.helpers.toFont(options.ticks.font).string;
  const labelWidth = ctx.measureText(DATED_Y_AXIS_WIDEST_LABEL).width;
  ctx.restore();
  // tickLength even when ticks aren't drawn, so ghostRightAxis matches a real axis.
  scale.width = Math.ceil(labelWidth + options.ticks.padding + options.grid.tickLength);
}

// Chart.js's tooltip as a page overlay, so a hover taller than its chart isn't cut off.
const TOOLTIP_GAP_PX = 10;

function htmlTooltip({ chart, tooltip }) {
  let el = document.querySelector('.chart-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.className = 'chart-tooltip';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    // Fixed to the screen, so a scroll would leave it behind its chart.
    document.addEventListener('scroll', () => { el.hidden = true; }, { passive: true, capture: true });
  }
  if (tooltip.opacity === 0 || !chart.canvas.isConnected) {
    el.hidden = true;
    return;
  }

  const row = (text, color, bold = false) => {
    const line = document.createElement('div');
    line.className = 'chart-tooltip-row';
    if (bold) line.style.fontWeight = '700';
    if (color) {
      const swatch = document.createElement('span');
      swatch.className = 'chart-tooltip-swatch';
      swatch.style.background = color.backgroundColor;
      swatch.style.borderColor = color.borderColor;
      line.appendChild(swatch);
    }
    line.appendChild(document.createTextNode(text));
    return line;
  };
  el.replaceChildren(
    ...tooltip.title.map((t) => row(t, null, true)),
    ...tooltip.beforeBody.map((t) => row(t)),
    ...tooltip.body.flatMap((b, i) => [
      ...b.before.map((t) => row(t)),
      ...b.lines.map((t) => row(t, tooltip.labelColors[i])),
      ...b.after.map((t) => row(t)),
    ]),
    ...tooltip.afterBody.map((t) => row(t)),
    ...tooltip.footer.map((t) => row(t, null, true)),
  );
  el.style.fontSize = `${chartFontSize()}px`;
  el.hidden = false;

  // Beside the caret, flipped and clamped so it stays on screen.
  const rect = chart.canvas.getBoundingClientRect();
  const gap = TOOLTIP_GAP_PX;
  const { width, height } = el.getBoundingClientRect();
  let left = rect.left + tooltip.caretX + gap;
  if (left + width > window.innerWidth - gap) left = rect.left + tooltip.caretX - gap - width;
  const top = rect.top + tooltip.caretY - height / 2;
  el.style.left = `${Math.max(gap, left)}px`;
  el.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - height - gap))}px`;
}

// Invisible spacer the width of a real right axis, so a chart without one keeps its
// date labels aligned. A factory, since afterFit mutates the scale it's handed.
function ghostRightAxis() {
  return {
    position: 'right',
    afterFit: fixDatedYAxisWidth,
    grid: { drawOnChartArea: false, drawTicks: false },
    border: { display: false },
    ticks: { display: false },
  };
}

// The section's one "figure that applies here" mark: a hairline floating bar over its
// own column. One `values` entry per column; null leaves it unmarked.
function desiredCapDataset(label, values, capHalf, extra = {}) {
  return {
    type: 'bar',
    label,
    data: values.map((v) => (v === null || v === undefined ? null : [v - capHalf, v + capHalf])),
    backgroundColor: desiredMarkColor(),
    grouped: false,
    // Lowest order paints last, so the cap stays visible on a column that overshot it.
    order: 0,
    ...extra,
  };
}

// A fraction of the axis span, so the cap stays a hairline at any range.
const DESIRED_CAP_HALF_FRACTION = 0.006;

function desiredCapHalf(axisSpan) {
  return Math.abs(axisSpan) * DESIRED_CAP_HALF_FRACTION;
}

// Exponential moving average with roughly a `span`-day memory (alpha = 2/(span+1)), so
// the trend doesn't jump at week boundaries. An unlogged day carries the last value.
function emaSeries(values, span = 7) {
  const alpha = 2 / (span + 1);
  let prev = null;
  return values.map((v) => {
    if (v === null || v === undefined) return prev;
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    return prev;
  });
}

// The smoothed series' change over the trailing `span` days; null until a full span exists.
function emaSlopePerSpan(series, span = 7) {
  return series.map((_, i) => (i >= span && series[i] !== null && series[i - span] !== null
    ? series[i] - series[i - span]
    : null));
}

// The trend line, in the reference-mark neutral. `monotone` keeps it from overshooting
// into bumps the data never had.
function trendLineDataset(label, series, extra = {}) {
  return {
    type: 'line',
    label,
    data: series,
    borderColor: desiredMarkColor(),
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

// Rounds an axis cap up to this ladder × a power of ten, for clean gridlines without
// wasting the plot area.
const NICE_AXIS_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceAxisBound(value) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const residual = value / magnitude;
  return (NICE_AXIS_STEPS.find((step) => residual <= step) ?? 10) * magnitude;
}

// Destroy-then-construct, lazily: each chart builds only once its .chart-box nears the
// viewport, so collapsed panels don't pay for layout up front. A panel collapsing at boot
// is mid its 0.35s transition and can read as visible, so its charts wait that out first.
//
// Returns a Proxy for the Chart: it forwards to the real one once built (finance-chart.js's
// legend calls its methods and edits `.options`); before that, visibility reads "visible"
// and mutators no-op.
const PANEL_COLLAPSE_TRANSITION_MS = 400;
const CHART_BUILD_ROOT_MARGIN = '400px';

const CHART_PRE_BUILD_DEFAULTS = {
  isDatasetVisible: () => true,
  setDatasetVisibility: () => {},
  update: () => {},
  resize: () => {},
};

// Charts not yet scrolled near, by canvas; buildPendingCharts draws them now.
const pendingChartBuilds = new Map();

// Unanimated, so a capture right after sees them finished.
function buildPendingCharts(root) {
  [...pendingChartBuilds].forEach(([forceBuild, canvas]) => {
    if (root.contains(canvas)) forceBuild();
  });
}

function upsertChart(existingChart, ctx, config) {
  if (existingChart) existingChart.destroy();

  const canvas = ctx.canvas || ctx;
  const box = canvas.closest('.chart-box') || canvas;
  const state = { chart: null, observer: null, timer: null };

  const build = () => {
    pendingChartBuilds.delete(forceBuild);
    state.chart = new Chart(ctx, config);
  };
  const stopWaiting = () => {
    state.observer?.disconnect();
    clearTimeout(state.timer);
  };
  const forceBuild = () => {
    stopWaiting();
    config.options = { ...config.options, animation: false };
    build();
  };
  pendingChartBuilds.set(forceBuild, canvas);

  const startObserving = () => {
    state.observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        build();
        state.observer.disconnect();
      }
    }, { rootMargin: CHART_BUILD_ROOT_MARGIN });
    state.observer.observe(box);
  };

  if (box.closest('.panel.collapsed')) {
    state.timer = setTimeout(startObserving, PANEL_COLLAPSE_TRANSITION_MS);
  } else {
    startObserving();
  }

  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'destroy') {
        return () => {
          pendingChartBuilds.delete(forceBuild);
          state.chart?.destroy();
          stopWaiting();
        };
      }
      if (state.chart) {
        const value = state.chart[prop];
        return typeof value === 'function' ? value.bind(state.chart) : value;
      }
      return CHART_PRE_BUILD_DEFAULTS[prop];
    },
  });
}

// [r, g, b], 0-255, of a #rrggbb colour.
function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

// A styles.css :root colour (--chart-*, --color-*), read at draw time so a CSS change
// restyles the charts. `alpha` gives rgba.
function chartColor(name, alpha = null) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase();
  if (alpha === null || !/^#[0-9a-f]{6}$/.test(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
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
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
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

// Category-colour swatch legend, shared by several panels. With `toggle`, each entry is
// a button: `isHidden(entry, i)` styles it, `onToggle(entry, i)` hides and redraws (what
// hiding means is the chart's call). A hidden entry stays, dimmed, as the way back.
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

// Health Chart legends whose entries switch their series off and on. Hidden names are
// kept per legend for the page's life, so a range change or reload of data keeps them.
const chartLegendHidden = new Map(); // legend id -> Set of hidden entry names

function legendHiddenNames(containerId) {
  if (!chartLegendHidden.has(containerId)) chartLegendHidden.set(containerId, new Set());
  return chartLegendHidden.get(containerId);
}

// `rerender` redraws the chart, which reads legendHiddenNames itself.
function renderToggleLegend(containerId, categories, rerender) {
  const hidden = legendHiddenNames(containerId);
  renderCategoryLegend(containerId, categories, {
    isHidden: (c) => hidden.has(c.name),
    onToggle: (c) => {
      if (hidden.has(c.name)) hidden.delete(c.name);
      else hidden.add(c.name);
      rerender();
    },
  });
}

// `values` with every point whose class (a legend name) is hidden blanked out.
function maskHiddenClasses(values, classes, hidden) {
  return values.map((v, i) => (hidden.has(classes[i]) ? null : v));
}

// A unit tick the privacy toggle masks. `decimals: null` rounds off Chart.js's float
// drift (32.400000000000006) without forcing trailing zeros; a number fixes the places.
function maskedUnitTick(unit, decimals = null) {
  return (v) => {
    const rounded = decimals !== null ? v.toFixed(decimals) : Math.round(v * 100) / 100;
    const label = `${rounded} ${unit}`;
    return privacyMode ? maskDigits(label) : label;
  };
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

// Up to `maxTicks` indices spread evenly across 0..length-1, both ends included.
function evenlySpacedIndices(length, maxTicks = 7) {
  if (length <= 0) return [];
  if (length <= maxTicks) return Array.from({ length }, (_, i) => i);
  const out = [];
  for (let i = 0; i < maxTicks; i++) {
    out.push(Math.round((i * (length - 1)) / (maxTicks - 1)));
  }
  return [...new Set(out)];
}

// Dated Health charts: this many gridlines, the first and last on the window's ends.
const HEALTH_X_GRIDLINES = 8;

function wellnessTickIndices(dates) {
  return evenlySpacedIndices(dates.length, HEALTH_X_GRIDLINES);
}

// The x scale for every dated category-axis Health chart, on State Trend & Forecast's ticks.
function wellnessCategoryXScale(dates) {
  return {
    afterBuildTicks: (axis) => {
      axis.ticks = wellnessTickIndices(dates).map((i) => ({ value: i }));
    },
    // First and last dates on the plot's edges; gridlines through each date.
    offset: false,
    grid: { offset: false },
    // autoSkip off, or it would thin the ticks set above.
    ticks: { maxRotation: 45, minRotation: 45, autoSkip: false, callback: shortDateTickCallback },
  };
}

// 📤 on a chart page: the whole page as a PNG, named by the button's data-screenshot.
// html2canvas-pro (reads color-mix, unlike html2canvas) loads on first use only.
const HTML2CANVAS_URL = 'https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.8/dist/html2canvas-pro.min.js';
let html2canvasPromise = null;
// What body's system-ui resolves to on each platform; html2canvas can't draw system-ui itself.
const SCREENSHOT_FONT_STACK = '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

function loadHtml2canvas() {
  html2canvasPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HTML2CANVAS_URL;
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => { html2canvasPromise = null; reject(new Error('html2canvas failed to load')); };
    document.head.appendChild(script);
  });
  return html2canvasPromise;
}

// Phone: the share sheet (Save Image → gallery). Laptop: a download.
async function saveScreenshot(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function capturePageScreenshot(button) {
  const panel = button.closest('.panel');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '⏳';
  try {
    const html2canvas = await loadHtml2canvas();
    buildPendingCharts(panel);
    const canvas = await html2canvas(panel, {
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      scale: Math.min(2, window.devicePixelRatio || 1),
      // Not every display:none element: <head>, <link> and <style> are, and the clone lost its CSS.
      ignoreElements: (el) => el.classList.contains('panel-header-actions'),
      onclone: (doc) => {
        doc.body.style.fontFamily = SCREENSHOT_FONT_STACK;
        // html2canvas boxes a <button> whatever its CSS; a legend entry is a swatch and a word.
        doc.querySelectorAll('button.donut-legend-item-toggle').forEach((legendButton) => {
          const span = doc.createElement('span');
          span.className = legendButton.className;
          span.append(...legendButton.childNodes);
          legendButton.replaceWith(span);
        });
      },
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await saveScreenshot(blob, `${button.dataset.screenshot}-${localIso()}.png`);
  } catch (err) {
    console.error('Screenshot failed', err);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function initPageScreenshots() {
  document.querySelectorAll('button[data-screenshot]').forEach((button) => {
    button.addEventListener('click', () => capturePageScreenshot(button));
  });
}
