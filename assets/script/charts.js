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

// Destroy-then-construct. Only for the unconditional case; a render that skips
// construction on empty data keeps its own manual destroy.
function upsertChart(existingChart, ctx, config) {
  if (existingChart) existingChart.destroy();
  return new Chart(ctx, config);
}

let expenseBreakdownTrendChart = null;

// Stacked spend per month, with that month's INCOME over the top of it as a single
// line — the two questions ("where did it go" and "was it more than came in") read
// off one chart instead of two, which is what let the separate Revenue vs.
// Expenditure area chart go: its expense series was this chart's stack total, and
// its income series is the line below.
function renderExpenseBreakdownTrendChart(months) {
  const ctx = document.getElementById('expense-breakdown-trend-chart');
  if (expenseBreakdownTrendChart) expenseBreakdownTrendChart.destroy();
  if (months.length === 0) return;

  const categories = months[0].categories;

  // Income leads the legend: it's the line every bar is read against, not another
  // slice of the stack. Same order as `datasets` below, which is what lets the
  // legend index BE the dataset index.
  const legendItems = [{ name: 'Income', color: targetMarkColor() }, ...categories];

  // 1.2x the SECOND-highest month, so one outlier doesn't squash the rest. Measured
  // on whichever is taller that month, spend or income — sizing on the stack alone
  // would draw the line off the top of the plot in any month that earned more than
  // it spent, which is most of them.
  //
  // Takes a visibility test rather than measuring everything once, because this axis
  // is PINNED: switching the biggest category off left the remaining bars in the
  // bottom third of a plot still scaled for it. The legend recomputes this and
  // reassigns scales.y.max on every click. Dataset 0 is the income line and 1..n are
  // the categories in order, which is the index this is asked about.
  const axisMaxFor = (isVisible) => {
    const peaks = months.map((m) => {
      const stack = categories.reduce(
        (sum, c, ci) => sum + (isVisible(ci + 1) ? (m.categories.find((mc) => mc.name === c.name)?.value || 0) : 0),
        0
      );
      return Math.max(stack, isVisible(0) ? Math.abs(m.income || 0) : 0);
    });
    const sortedPeaks = [...peaks].sort((a, b) => b - a);
    const max = niceAxisMax((sortedPeaks[1] ?? sortedPeaks[0]) * 1.2);
    // Everything switched off: hand the axis back to Chart.js rather than pinning
    // it to zero, which has no gridlines to draw.
    return max > 0 ? max : undefined;
  };
  const yMax = axisMaxFor(() => true);

  expenseBreakdownTrendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        {
          type: 'line',
          label: 'Income',
          data: months.map((m) => Math.abs(m.income || 0)),
          borderColor: targetMarkColor(),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          // A month's income is one flat figure for that whole month, not a slope
          // from last month's to this one's — sloping it invented a value for every
          // point in between and turned a pay rise into a peak. 'middle' steps
          // halfway between months, so each flat run sits centred over its own
          // bar and the jump lands on the boundary between them.
          stepped: 'middle',
          // Its own stack, so a stacked y axis reads it as a line ACROSS the bars
          // rather than another storey on top of them.
          stack: 'income',
          // Drawn last, so it stays legible over the tallest stack.
          order: 0,
        },
        ...categories.map((c) => ({
          label: c.name,
          data: months.map((m) => m.categories.find((mc) => mc.name === c.name)?.value || 0),
          backgroundColor: c.color,
          order: 1,
        })),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, max: yMax, afterFit: fixTrendYAxisWidth, ticks: { callback: (value) => formatCurrency(value) } },
      },
    },
  });

  // After the chart, not before: the legend reads its dataset visibility, so it
  // needs the chart to exist. Chart.js' own dataset hiding is enough here (unlike
  // the by-category charts, which re-render) — the x axis is months, so a hidden
  // series leaves the axis and every other series exactly where they were.
  const drawLegend = () => renderCategoryLegend('expense-breakdown-trend-legend', legendItems, {
    isHidden: (_, i) => !expenseBreakdownTrendChart.isDatasetVisible(i),
    onToggle: (_, i) => {
      expenseBreakdownTrendChart.setDatasetVisibility(i, !expenseBreakdownTrendChart.isDatasetVisible(i));
      // The axis is pinned, so it has to be re-measured against what's left showing
      // — otherwise hiding the biggest category just leaves a gap at the top.
      expenseBreakdownTrendChart.options.scales.y.max =
        axisMaxFor((di) => expenseBreakdownTrendChart.isDatasetVisible(di));
      expenseBreakdownTrendChart.update();
      drawLegend();
    },
  });
  drawLegend();
}

let spendingTrendChart = null;

// A category's four period bars share one hue, told apart by opacity (most recent =
// most opaque).
function hslWithAlpha(hsl, alpha) {
  return hsl.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

// Divisors turning each period's total into a monthly average. Lifelong has none —
// renderSpendingTrendChart passes the real month count instead.
const SPENDING_TREND_PERIODS = [
  { key: 'lastMonth', label: 'Last Month', alpha: 1, months: 1 },
  { key: 'quarterAvg', label: 'Last Quarter', alpha: 0.7, months: 3 },
  { key: 'yearAvg', label: 'Last Year', alpha: 0.45, months: 12 },
  { key: 'lifelongAvg', label: 'Lifelong', alpha: 0.25, months: null },
];

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

// Categories switched off from this chart's legend, by name. Module-level, so the
// choice survives the re-render each click triggers — and a plain refresh of the
// dashboard, which is the same call again.
const hiddenSpendingCategories = new Set();

function renderSpendingTrendChart(categories, totalMonths) {
  const ctx = document.getElementById('spending-trend-chart');
  if (spendingTrendChart) spendingTrendChart.destroy();

  // The legend lists every category and is drawn before the early return below, so
  // switching the last one off still leaves something to switch back on.
  renderCategoryLegend('spending-trend-legend', categories, {
    isHidden: (c) => hiddenSpendingCategories.has(c.name),
    onToggle: (c) => {
      if (!hiddenSpendingCategories.delete(c.name)) hiddenSpendingCategories.add(c.name);
      renderSpendingTrendChart(categories, totalMonths);
    },
  });

  // Filtered out of the data rather than hidden inside it: a category is this
  // chart's x axis, so Chart.js' own per-index hiding would leave a labelled gap
  // where the bars were.
  const shown = categories.filter((c) => !hiddenSpendingCategories.has(c.name));
  if (shown.length === 0) return;

  spendingTrendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: shown.map((c) => c.name),
      datasets: SPENDING_TREND_PERIODS.map((p) => ({
        label: p.label,
        data: shown.map((c) => c[p.key] / (p.months || totalMonths || 1)),
        backgroundColor: shown.map((c) => hslWithAlpha(c.color, p.alpha)),
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // All four period bars stay visible; ignore the default toggle-on-click.
        legend: { onClick: () => {} },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatCurrency(item.raw)}`,
          },
        },
      },
      scales: {
        x: { ticks: { display: false }, border: { width: 3 } },
        y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } },
      },
    },
  });
}

const SPENDING_BREAKDOWN_PERIODS = [
  { key: 'lastMonth', canvasId: 'spending-breakdown-lastmonth-chart' },
  { key: 'quarterAvg', canvasId: 'spending-breakdown-quarter-chart' },
  { key: 'yearAvg', canvasId: 'spending-breakdown-year-chart' },
  { key: 'lifelongAvg', canvasId: 'spending-breakdown-lifelong-chart' },
];

const spendingBreakdownCharts = {};

function renderSpendingBreakdownCharts(categories) {
  SPENDING_BREAKDOWN_PERIODS.forEach(({ key, canvasId }) => {
    const ctx = document.getElementById(canvasId);
    if (spendingBreakdownCharts[canvasId]) spendingBreakdownCharts[canvasId].destroy();
    if (categories.length === 0) return;

    const data = categories.map((c) => c[key]);
    const total = data.reduce((sum, v) => sum + v, 0);

    spendingBreakdownCharts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: categories.map((c) => c.name),
        datasets: [{ data, backgroundColor: categories.map((c) => c.color) }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: () => '',
              label: (item) => {
                const pct = total ? (item.raw / total * 100).toFixed(1) : '0.0';
                return `${item.label}: ${formatCurrency(item.raw)} (${privacyMode ? maskDigits(pct) : pct}%)`;
              },
            },
          },
        },
      },
    });
  });
}

const TYPE_BREAKDOWN_PERIODS = [
  { key: 'lastMonth', suffix: 'lastmonth', label: 'Last Month' },
  { key: 'lastQuarter', suffix: 'lastquarter', label: 'Last Quarter' },
  { key: 'lastYear', suffix: 'lastyear', label: 'Last Year' },
  { key: 'lifelong', suffix: 'lifelong', label: 'Lifelong' },
];
const TYPE_BREAKDOWN_OTHER_COLOR = '#9ca3af';

const typeBreakdownCharts = {};

// Heading + 4 period donuts + legend, built from scratch so the panels follow whatever
// categories Insight defines rather than a hardcoded list.
function buildTypeBreakdownSection(category) {
  const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const section = document.createElement('div');
  section.className = 'type-breakdown-category';
  section.id = `type-breakdown-${slug}-section`;

  const heading = document.createElement('h3');
  heading.textContent = category;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'donut-grid';

  TYPE_BREAKDOWN_PERIODS.forEach(({ suffix, label }) => {
    const item = document.createElement('div');
    item.className = 'donut-item';

    const h4 = document.createElement('h4');
    h4.textContent = label;

    const chartBox = document.createElement('div');
    chartBox.className = 'chart-box chart-box-donut';

    const canvas = document.createElement('canvas');
    canvas.id = `type-breakdown-${slug}-${suffix}-chart`;

    chartBox.appendChild(canvas);
    item.append(h4, chartBox);
    grid.appendChild(item);
  });

  section.appendChild(grid);

  const legend = document.createElement('div');
  legend.className = 'donut-legend';
  legend.id = `type-breakdown-${slug}-legend`;
  section.appendChild(legend);

  return section;
}

// One donut per category per period: that category's Types as a share of its total.
// Only categories with a named Type get a panel. The gap between the category total and
// the sum of its named Types becomes an "Untyped" slice.
//
// CURRENTLY UNCALLED, deliberately: the call in app.js's reportPromise and the
// "Spending Breakdown by Type" section in index.html are both commented out, and this
// is kept whole so uncommenting those two is all it takes to bring the wall back.
function renderTypeBreakdownCharts(typeBreakdown) {
  // By absolute lifelong spend, so the biggest movers surface first whatever their sign.
  const orderedCategories = Object.keys(typeBreakdown)
    .filter((category) => typeBreakdown[category].types.length > 0)
    .sort((a, b) => {
      const lifelongA = Math.abs((typeBreakdown[a]?.total?.lifelong) || 0);
      const lifelongB = Math.abs((typeBreakdown[b]?.total?.lifelong) || 0);
      return lifelongB - lifelongA;
    });

  const container = document.getElementById('type-breakdown-container');
  container.innerHTML = '';

  orderedCategories.forEach((category) => {
    const data = typeBreakdown[category];

    container.appendChild(buildTypeBreakdownSection(category));

    // Sorted once, so the legend and all four donuts share slice order and colours.
    const types = [...data.types].sort((a, b) => Math.abs(b.lifelong) - Math.abs(a.lifelong));
    const colors = types.map((_, i) => `hsl(${Math.round((i * 360) / types.length)}, 65%, 55%)`);

    const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    renderCategoryLegend(`type-breakdown-${slug}-legend`, [
      ...types.map((t, i) => ({ name: t.name, color: colors[i] })),
      { name: 'Untyped', color: TYPE_BREAKDOWN_OTHER_COLOR },
    ]);

    TYPE_BREAKDOWN_PERIODS.forEach(({ key, suffix }) => {
      const canvasId = `type-breakdown-${slug}-${suffix}-chart`;
      const ctx = document.getElementById(canvasId);

      const typedTotal = types.reduce((sum, t) => sum + t[key], 0);
      const total = (data.total && data.total[key]) || typedTotal;
      const untyped = Math.max(0, total - typedTotal);

      const labels = [...types.map((t) => t.name), 'Untyped'];
      const values = [...types.map((t) => t[key]), untyped];
      const sliceColors = [...colors, TYPE_BREAKDOWN_OTHER_COLOR];

      typeBreakdownCharts[canvasId] = upsertChart(typeBreakdownCharts[canvasId], ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: sliceColors }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: () => '',
                label: (item) => {
                  const pct = total ? (item.raw / total * 100).toFixed(1) : '0.0';
                  return `${item.label}: ${formatCurrency(item.raw)} (${privacyMode ? maskDigits(pct) : pct}%)`;
                },
              },
            },
          },
        },
      });
    });
  });
}

let accountCompositionChart = null;

// Nested doughnut: account type (inner), institution (middle, one fixed colour each),
// individual account (outer, shaded by institution). Slices size on the ABSOLUTE
// balance, so a debt account renders normally instead of breaking the chart.
// Types and institutions switched off from the two legends, by name. Module-level,
// so a choice survives the re-render each click triggers and the next dashboard load.
const hiddenAccountTypes = new Set();
const hiddenInstitutions = new Set();

function renderAccountCompositionChart(accounts) {
  const ctx = document.getElementById('account-composition-chart');
  if (accountCompositionChart) accountCompositionChart.destroy();
  if (accounts.length === 0) return;

  // Largest absolute balance first, so a big debt still ranks near the top. Anything
  // netting to zero is dropped rather than left as an empty legend entry.
  const rankedByAbs = (list, keyOf) => {
    const totals = new Map();
    list.forEach((a) => {
      const key = keyOf(a);
      totals.set(key, (totals.get(key) || 0) + Math.abs(a.balance));
    });
    return [...totals.keys()]
      .filter((key) => totals.get(key) > 0)
      .sort((a, b) => totals.get(b) - totals.get(a));
  };

  const typeOf = (a) => a.type || 'Other';
  const institutionOf = (a) => a.institution || 'Other';

  // Evenly-spaced hues, so no count repeats a colour the way a fixed palette would.
  //
  // `band` is what keeps the two rings apart. Both used to walk the same wheel from
  // the same starting hue, so with a similar number of types and institutions the two
  // palettes came out IDENTICAL — the second-largest institution painted in exactly the
  // second-largest type's colour. That's what makes a TFSA (an Investment) read as
  // "the Saving colour": the slice matches a legend entry it has nothing to do with.
  // The half-step offset pulls the hues off each other; the deeper, less saturated
  // band is what still tells the rings apart when the two counts differ enough for the
  // hues to realign anyway.
  const TYPE_BAND = { offset: 0, saturation: 65, lightness: 55 };
  const INSTITUTION_BAND = { offset: 0.5, saturation: 45, lightness: 42 };
  const distinctColors = (count, band) => Array.from({ length: count }, (_, i) =>
    `hsl(${Math.round(((i + band.offset) * 360) / count) % 360}, ${band.saturation}%, ${band.lightness}%)`);

  // Both palettes and both legends are built from EVERY account, not from what's
  // currently shown: the hues are spaced by count, so recomputing them over a
  // filtered list would recolour the survivors on every click — and a name dropped
  // from its legend is a name with no way back on.
  const allTypes = rankedByAbs(accounts, typeOf);
  const allInstitutions = rankedByAbs(accounts, institutionOf);

  const typeColors = {};
  distinctColors(allTypes.length, TYPE_BAND).forEach((color, i) => { typeColors[allTypes[i]] = color; });

  // One fixed colour per institution, whatever types its accounts span.
  const institutionColorMap = {};
  distinctColors(allInstitutions.length, INSTITUTION_BAND).forEach((color, i) => { institutionColorMap[allInstitutions[i]] = color; });

  // Drawn before the early return below, so switching everything off still leaves
  // both legends to switch something back on with. Hiding a type takes its
  // institutions and accounts out of the two outer rings with it — the rings are
  // built from the accounts that survive both filters, so the hierarchy holds.
  const redraw = () => renderAccountCompositionChart(accounts);
  renderCategoryLegend('account-composition-legend', allTypes.map((t) => ({ name: t, color: typeColors[t] })), {
    isHidden: (t) => hiddenAccountTypes.has(t.name),
    onToggle: (t) => {
      if (!hiddenAccountTypes.delete(t.name)) hiddenAccountTypes.add(t.name);
      redraw();
    },
  });
  renderCategoryLegend('account-composition-institution-legend', allInstitutions.map((name) => ({ name, color: institutionColorMap[name] })), {
    isHidden: (n) => hiddenInstitutions.has(n.name),
    onToggle: (n) => {
      if (!hiddenInstitutions.delete(n.name)) hiddenInstitutions.add(n.name);
      redraw();
    },
  });

  const shown = accounts.filter((a) => !hiddenAccountTypes.has(typeOf(a)) && !hiddenInstitutions.has(institutionOf(a)));
  if (shown.length === 0) return;

  const byType = new Map();
  shown.forEach((a) => {
    const type = typeOf(a);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(a);
  });

  const typeAbsTotals = new Map();
  byType.forEach((group, type) => {
    typeAbsTotals.set(type, group.reduce((sum, acc) => sum + Math.abs(acc.balance), 0));
  });

  const types = allTypes.filter((type) => (typeAbsTotals.get(type) || 0) > 0);

  const accountLabels = [];
  const accountValues = [];
  const accountColors = [];
  const institutionLabels = [];
  const institutionValues = [];
  const institutionColors = [];
  const typeLabels = [];
  const typeValues = [];
  const typeColorList = [];

  types.forEach((type) => {
    const group = byType.get(type);
    typeLabels.push(type);
    typeValues.push(typeAbsTotals.get(type));
    typeColorList.push(typeColors[type]);

    // Largest institution first, so the middle ring lines up with the outer one.
    const byInstitution = new Map();
    group.forEach((a) => {
      const institution = a.institution || 'Other';
      if (!byInstitution.has(institution)) byInstitution.set(institution, []);
      byInstitution.get(institution).push(a);
    });

    const institutions = [...byInstitution.entries()]
      .map(([name, accts]) => ({ name, accts, abs: accts.reduce((sum, a) => sum + Math.abs(a.balance), 0) }))
      .filter((institution) => institution.abs > 0)
      .sort((a, b) => b.abs - a.abs);

    institutions.forEach((institution) => {
      institutionLabels.push(institution.name);
      institutionValues.push(institution.abs);
      institutionColors.push(institutionColorMap[institution.name]);

      [...institution.accts]
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .forEach((a, j) => {
          accountLabels.push(a.name);
          accountValues.push(Math.abs(a.balance));
          accountColors.push(hslWithAlpha(institutionColorMap[institution.name], Math.max(0.4, 0.85 - j * 0.15)));
        });
    });
  });

  const total = typeValues.reduce((sum, v) => sum + v, 0);

  // By datasetIndex (outer to inner), so the tooltip names whichever ring is hovered.
  const ringLabels = [accountLabels, institutionLabels, typeLabels];

  accountCompositionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: accountLabels,
      datasets: [
        { data: accountValues, backgroundColor: accountColors, weight: 1 },
        { data: institutionValues, backgroundColor: institutionColors, weight: 1 },
        { data: typeValues, backgroundColor: typeColorList, weight: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Otherwise one hover matches the same dataIndex in all three rings and
      // produces three tooltip lines.
      interaction: { mode: 'point' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // The default title looks up account-ring names by dataIndex, which is
            // meaningless for the inner two rings.
            title: () => '',
            label: (item) => {
              const name = ringLabels[item.datasetIndex][item.dataIndex];
              const pct = total ? (item.raw / total * 100).toFixed(1) : '0.0';
              return `${name}: ${formatCurrency(item.raw)} (${privacyMode ? maskDigits(pct) : pct}%)`;
            },
          },
        },
      },
    },
  });
}

// Used until a Setting tab exists, so nothing changes for anyone without one.
const BODY_MASS_TARGET_KG_DEFAULT = 82;
const CALORIE_TARGET_KCAL_DEFAULT = 2000;
const SLEEP_TARGET_HOURS_DEFAULT = 8;
const FIBER_TARGET_G_DEFAULT = 30;
const ACTIVITY_TARGET_MIN_DEFAULT = 100;
const PROTEIN_TARGET_G_DEFAULT = 100;

// Protein per kg of LEAN mass, not total mass — the band the Formula playground opens on.
// 1.8-2.2 spans what the resistance-training literature supports for holding lean mass in
// an energy deficit: Morton et al. 2018 (Br J Sports Med) puts the point above which
// fat-free-mass gains stop accruing at ~1.6 g/kg total mass with a 2.2 upper confidence
// bound, and Helms et al. 2014 recommends scaling to fat-free mass instead, which is what
// makes 1.8-2.2 the same advice expressed against LBM.
const PROTEIN_G_PER_KG_LBM_MIN_DEFAULT = 1.8;
const PROTEIN_G_PER_KG_LBM_MAX_DEFAULT = 2.2;

// The fiber band's two coefficients — the Formula playground opens on these. 14 g/1000 kcal
// is the USDA/Dietary Guidelines for Americans rule of thumb (derived from the ~25g/2000kcal
// adult reference intake); 0.5 g/kg body weight is a common upper-bound heuristic so the
// ceiling scales with the person rather than staying a flat number regardless of size.
const FIBER_G_PER_1000_KCAL_MIN_DEFAULT = 14;
const FIBER_G_PER_KG_MAX_DEFAULT = 0.5;

// Intensity assumed for ACTIVITY_TARGET_MIN (3.0 walking, 5.0 compound lifting, 7.0
// jogging). Duplicates activity-estimator.js's EXERCISE_MET_DEFAULT rather than
// referencing it: charts.js loads first, so that const is still in its dead zone.
const ACTIVITY_MET_FALLBACK = 3.5;

// Either key works, so an already-filled row isn't ignored over a naming preference.
const ACTIVITY_MET_SETTING_KEYS = ['ACTIVITY_MET', 'ACTIVITY_MET_DEFAULT'];

function activityMet() {
  for (const key of ACTIVITY_MET_SETTING_KEYS) {
    const met = getSetting(key, null);
    if (met !== null) return met;
  }
  return ACTIVITY_MET_FALLBACK;
}

// Energy density of body fat, shared by the projection, the calorie target and Calorie
// Balance. A population constant, not a personal parameter.
const GENERIC_KCAL_PER_KG_FAT = 7700;

// Last resort, for when no body mass is on file and the MET formula can't be evaluated.
const GENERIC_KCAL_PER_ACTIVE_MIN = 5;

// ACSM form: 1 MET = 3.5 mL O₂/kg/min and a litre of O₂ releases ~5 kcal (200 mL
// per kcal), so 3.5/200 kcal per MET per kg per minute. Not the `MET × kg × hours`
// shorthand, which assumes 1 MET = 1 kcal/kg/hour and lands a flat 5% low.
const MET_ML_O2_PER_KG_MIN_DEFAULT = 3.5;
const ML_O2_PER_KCAL = 200;

// Only the mL-O₂ numerator is overridable (KCAL_PER_MET_KG_MIN). The /200 is oxygen's
// energy yield, not a personal parameter.
function kcalPerMetKgMin() {
  return getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT) / ML_O2_PER_KCAL;
}

// The app's only MET→kcal conversion, so the target's assumed activity burn and
// Calculate's measured one (activity-estimator.js) can't disagree.
function metKcal(met, bodyMassKg, minutes) {
  return met * bodyMassKg * minutes * kcalPerMetKgMin();
}

function latestBodyMassKg(entries) {
  const bodyMassEntries = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return bodyMassEntries.length ? bodyMassEntries[bodyMassEntries.length - 1].amount : null;
}

// A single scale reading is a poor estimate of the mass every equation here is built on:
// water and glycogen swing it by more than a week of fat loss does, so yesterday's dinner
// can move the whole plan. m(t) in the decay model means clean mass, and the standard fix
// is the 7-day rolling mean — m̄(t) = (1/7) × Σ m(t−i), i = 0…6 — which is what the plan
// figures read instead.
//
// The window ends at the LATEST reading, not at today: anchoring on today would quietly
// empty the window after a week away from the scale, and no average at all is worse than
// an average of slightly older readings. Every reading inside it counts equally, however
// many land on one date — averaging per-day means first would weight a day weighed twice
// the same as a day weighed once.
//
// Rounded to the 0.1 kg a scale reads to, for the same reason the LBM figure is: the
// substituted trace multiplies this number out, and a hidden extra decimal is what makes a
// printed line fail to add up.
const BODY_MASS_SMOOTHING_WINDOW_DAYS = 7;

function smoothedBodyMassKg(entries, windowDays = BODY_MASS_SMOOTHING_WINDOW_DAYS) {
  const readings = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (readings.length === 0) return null;

  const windowStartMs = parseIsoDateUTC(readings[readings.length - 1].date)
    - (windowDays - 1) * 86400000;
  const inWindow = readings.filter((e) => parseIsoDateUTC(e.date) >= windowStartMs);
  return Math.round((inWindow.reduce((sum, e) => sum + e.amount, 0) / inWindow.length) * 10) / 10;
}

// The mass every PLAN-level figure is evaluated at — the target intake, its direction, the
// forecast, the playground's boxes and the Health Plan prompt. Deliberately NOT used by the
// per-day series (Caloric Intake's target line, Calorie Balance's maintenance): those
// describe what was true on one specific day, and that day's own reading is the honest
// input there. Here the noise is only noise.
function planBodyMassKg(entries) {
  return smoothedBodyMassKg(entries);
}

// `1.6-2`, `1.6~2`, `1.6 – 2`, `1.6 to 2` all parse. A bare `1.6` is a zero-width band.
const G_PER_KG_BAND_SEPARATOR = /\s*(?:~|-|–|—|to)\s*/i;

// That single cell as {low, high} — null if absent or holding nothing numeric.
function parseGPerKgRangeCell() {
  const raw = getSettingString('PROTEIN_TARGET_G_PER_KG', null);
  if (raw === null) return null;

  const parts = String(raw).trim().split(G_PER_KG_BAND_SEPARATOR)
    .map(Number)
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (parts.length === 0) return null;

  return { low: parts[0], high: parts[parts.length - 1] };
}

// The g/kg band as {low, high}; null sends getProteinTargetBandG to its flat fallback.
// Either entry style works — one cell (`1.6-2`) or one end per row — with the explicit
// _MIN/_MAX rows winning per end. Sorted, so a band entered backwards still reads.
function getProteinGPerKgBand() {
  const cell = parseGPerKgRangeCell();
  const ends = [
    getSetting('PROTEIN_TARGET_G_PER_KG_MIN', null) ?? cell?.low ?? null,
    getSetting('PROTEIN_TARGET_G_PER_KG_MAX', null) ?? cell?.high ?? null,
  ].filter((n) => n !== null);

  if (ends.length === 0) return null;
  return { low: Math.min(...ends), high: Math.max(...ends) };
}

// An absolute gram band, as the Formula playground's lean-mass protein rows write it.
// Takes precedence over the g/kg band below: it is ALREADY a body mass times a per-kg
// figure (p × LBM), so putting it back through a basis mass would double-count. Both
// ends optional and sorted, same as the g/kg pair.
function getProteinAbsoluteBandG() {
  const ends = [
    getSetting('PROTEIN_TARGET_G_MIN', null),
    getSetting('PROTEIN_TARGET_G_MAX', null),
  ].filter((n) => n !== null && n > 0);

  if (ends.length === 0) return null;
  return { min: Math.round(Math.min(...ends)), max: Math.round(Math.max(...ends)) };
}

// A band, not a point, because the evidence behind it is a range (1.6-2.0 g/kg).
// Applied to TARGET body mass, not today's: scaling off current body mass would shrink the
// target with every kg lost, exactly when protein matters most. Falls back to the
// latest weigh-in, then to a zero-width band at the flat PROTEIN_TARGET_G.
function getProteinTargetBandG(entries) {
  // The lean-mass band first: it's the most specific thing on the sheet, and the only
  // one whose grams were computed against a body-composition estimate rather than
  // total mass.
  const absolute = getProteinAbsoluteBandG();
  if (absolute !== null) return absolute;

  const band = getProteinGPerKgBand();
  const basisBodyMassKg = band !== null
    ? (getSetting('BODY_MASS_TARGET_KG', null) ?? latestBodyMassKg(entries))
    : null;

  if (basisBodyMassKg !== null) {
    return { min: Math.round(basisBodyMassKg * band.low), max: Math.round(basisBodyMassKg * band.high) };
  }

  const flat = getSetting('PROTEIN_TARGET_G', PROTEIN_TARGET_G_DEFAULT);
  return { min: flat, max: flat };
}

// Midpoint, for callers that structurally need one number — Protein Source Rotation.
function getProteinTargetG(entries) {
  const { min, max } = getProteinTargetBandG(entries);
  return Math.round((min + max) / 2);
}

// "131" or "131~164" — one place, so the glance tile and the Insight prompt can't
// drift. The separator is a parameter: the prompt passes '-' rather than send the AI
// an unusual character.
function formatProteinTargetBand(band, separator = '~') {
  return band.max > band.min ? `${band.min}${separator}${band.max}` : `${band.min}`;
}

// Inside the band? A zero-width band has no inside and keeps the plain at-or-over
// rule. Over the top isn't a miss — both the chart's bar colours and the glance tile
// give it its own dark-green "past the ceiling, still a hit" treatment instead.
function withinProteinBand(g, band) {
  return g >= band.min && (band.max === band.min || g <= band.max);
}

// The fiber band the Formula playground writes — FIBER_TARGET_G_MIN/MAX, same shape as
// getProteinAbsoluteBandG. Sorted, so a band that came out backwards (a very light body
// weight paired with a high intake, where the per-kg ceiling can undercut the per-1000kcal
// floor) still reads as a proper band rather than an inverted one.
function getFiberAbsoluteBandG() {
  const ends = [
    getSetting('FIBER_TARGET_G_MIN', null),
    getSetting('FIBER_TARGET_G_MAX', null),
  ].filter((n) => n !== null && n > 0);

  if (ends.length === 0) return null;
  return { min: Math.round(Math.min(...ends)), max: Math.round(Math.max(...ends)) };
}

// Falls back to the flat FIBER_TARGET_G/_DEFAULT as a zero-width band, same fallback shape
// getProteinTargetBandG uses, for whoever hasn't opened the Formula playground's fiber rows
// yet.
function getFiberTargetBandG(entries) {
  const absolute = getFiberAbsoluteBandG();
  if (absolute !== null) return absolute;

  const flat = getSetting('FIBER_TARGET_G', FIBER_TARGET_G_DEFAULT);
  return { min: flat, max: flat };
}

// In-band check only — same shape as withinProteinBand. Over-the-ceiling is its own
// separate tier (still a hit, darker green), checked directly against band.max wherever
// the bulb/chart need to tell the two apart.
function withinFiberBand(g, band) {
  return g >= band.min && (band.max === band.min || g <= band.max);
}

// Mifflin-St Jeor BMR (kcal/day) — staying alive before any movement. Every
// maintenance figure in the app is this plus an activity burn, never a lifestyle
// multiplier, so no two of them measure a deficit against different baselines.
function mifflinStJeorBmr(bodyMassKg, heightCm, age, sex) {
  return 10 * bodyMassKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

// Katch-McArdle (1996): BMR = 370 + 21.6 × LBM. It asks the same question a different way
// — fat mass is nearly metabolically inert, so the honest predictor is the lean mass alone
// rather than a regression on total mass, height and age. Age drops out completely, and sex
// enters only through the LBM figure.
//
// Which means it's only better than Mifflin to the extent the LBM behind it is: with a real
// body-fat measurement it's the more accurate of the two, and with the app's Boer estimate
// it's a second opinion built from the same three numbers. That's the whole trade, and it's
// why the choice is the user's rather than a silent upgrade.
const KATCH_BASE_KCAL = 370;
const KATCH_KCAL_PER_KG_LBM = 21.6;

function katchMcArdleBmr(lbmKg) {
  return KATCH_BASE_KCAL + KATCH_KCAL_PER_KG_LBM * lbmKg;
}

// The LBM this equation is evaluated at, rounded to the same 0.1 kg the LBM box and the
// protein band show — so the trace's `370 + 21.6 × 61.4` multiplies out to the BMR printed
// beside it instead of missing it by a kcal.
function bmrLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  return Math.round(boerLeanBodyMassKg(bodyMassKg, heightCm, sex) * 10) / 10;
}

// Which of the two the whole app runs on. A string setting rather than a flag so the sheet
// says which equation is in force, and unset reads as Mifflin — the behaviour every existing
// copy already has.
const BMR_FORMULA_KEY = 'BMR_FORMULA';
const BMR_FORMULA_DEFAULT = 'mifflin';

function bmrFormula() {
  return getSettingString(BMR_FORMULA_KEY, BMR_FORMULA_DEFAULT) === 'katch' ? 'katch' : BMR_FORMULA_DEFAULT;
}

// Age is a Mifflin term only, so a plan on the LBM equation is complete without a birth
// date. Every guard that used to demand one unconditionally asks this instead — otherwise
// switching equations would report a profile incomplete over a number the model no longer
// reads.
function bmrNeedsAge(formula = bmrFormula()) {
  return formula !== 'katch';
}

// The app's single BMR call — the one function every maintenance figure goes through, so a
// switched equation moves all of them together or none. `formula` is a parameter with the
// setting as its default because the Formula Playground previews the other equation before
// it's saved; same reason maintenanceAffineCoefficients takes one.
function bmrKcal(bodyMassKg, heightCm, age, sex, formula = bmrFormula()) {
  return formula === 'katch'
    ? katchMcArdleBmr(bmrLeanBodyMassKg(bodyMassKg, heightCm, sex))
    : mifflinStJeorBmr(bodyMassKg, heightCm, age, sex);
}

// Thermic effect of food: the energy spent digesting what you eat, ~10% of intake on a
// mixed diet. It belongs to expenditure, so counting it RAISES the intake that produces a
// given deficit — and because it's a share of that very intake, the balance has to be
// solved rather than added on:
//
//     Eᵢₙ = BMR + Eₐ + TEF − D,  TEF = f × Eᵢₙ   ⇒   Eᵢₙ = (BMR + Eₐ − D) / (1 − f)
//
// Folding it into Eₐ and subtracting it separately are the same statement — intake − TEF
// − BMR − Eₐ = −D rearranges to that same line — so the two conventions can't disagree
// about a number here.
//
// Defaults to 0, which is exactly the app's arithmetic before this existed. Switching it on
// lifts every target by ~11%, and that's a decision for whoever owns the plan.
const TEF_PERCENT_KEY = 'TEF_PERCENT_OF_INTAKE';
const TEF_PERCENT_DEFAULT = 0;

function tefPercent() {
  return getSetting(TEF_PERCENT_KEY, TEF_PERCENT_DEFAULT);
}

// The (1 − f) every intake and maintenance figure is divided by. Held inside 0–90%: a
// negative share isn't a thermic effect, and at f = 1 digestion costs everything you eat
// and the identity has no finite solution at all.
const TEF_PERCENT_MAX = 90;

function tefDivisor(percent = tefPercent()) {
  return 1 - Math.min(Math.max(percent, 0), TEF_PERCENT_MAX) / 100;
}

// Metabolic adaptation: on a long cut, BMR falls by more than the lost mass accounts for —
// less leptin and T3, quieter sympathetic tone, cheaper movement — and the gap widens with
// time on the diet before levelling off. BMR_adapt(t) = BMR × (1 − λt), with λt plateauing
// somewhere near 10–15% by week 10–12. Refeeds and diet breaks walk λt back toward 0.
//
// Reported, never planned with: Eᵢₙ, the deficit and the arrival date are all left as the
// un-adapted identities give them, because the adaptation is a consequence of the diet
// rather than an input to it, and t is a moving target while λt is still growing. What it
// buys is the honest caveat on m∞ — a plateau at a HEAVIER mass than the constant-BMR model
// promises, which is the usual reason a forecast overshoots in practice. adaptedPlateauKg
// below is how much heavier.
const ADAPT_PCT_PER_WEEK_KEY = 'BMR_ADAPT_PCT_PER_WEEK';
const ADAPT_PCT_CAP_KEY = 'BMR_ADAPT_PCT_CAP';
const ADAPT_PCT_PER_WEEK_DEFAULT = 1;
const ADAPT_PCT_CAP_DEFAULT = 12;

// λt at day `days` — the share of BMR lost by then, capped. Days rather than weeks because
// every other time quantity here (t, the decay constant) is in days.
function adaptationFraction(days, pctPerWeek, pctCap) {
  const grown = (pctPerWeek / 100) * (days / 7);
  return Math.max(0, Math.min(grown, pctCap / 100));
}

// Resting maintenance from the profile and the smoothed body mass; null if anything is
// missing. Excludes activity — each caller adds the figure right for its own window.
function restingMaintenanceKcal(entries) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const bodyMassKg = planBodyMassKg(entries);

  if (heightCm === null || (age === null && bmrNeedsAge()) || (sex !== 'male' && sex !== 'female') || bodyMassKg === null) return null;
  return bmrKcal(bodyMassKg, heightCm, age, sex);
}

// Inside this margin the Physical Activity dot goes gray rather than red. Same 5% as
// CALORIE_TARGET_NEAR_FRACTION, kept separate because the two score different things.
const ACTIVITY_NEAR_TARGET_FRACTION = 0.05;

// What ACTIVITY_TARGET_MIN implies at `bodyMassKg`. Gross, not net of resting — Calorie
// Balance also adds gross activity to plain BMR, so both maintenance figures agree.
function activityTargetKcal(bodyMassKg) {
  return metKcal(activityMet(), bodyMassKg, getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT));
}

// A PINNED activity target: the same idea as CALORIE_TARGET_PIN_KEY below, but for the
// workout goal itself. Unset, the goal is ACTIVITY_TARGET_MIN minutes and whatever that
// burns falls as body mass falls, since metKcal scales with mass — pin this instead and
// the BURN stays put, so the minutes needed rise instead as you get lighter.
//
// Deliberately doesn't touch activityTargetKcal above (or calorieTargetDetail, which calls
// it): those stay the raw, pin-blind calculation the Formula Playground previews live and
// the calorie-intake target is built from — the same way CALORIE_TARGET_PIN_KEY leaves
// calorieTargetDetail alone. Only the activity tile and chart, which show the workout goal
// itself rather than daily intake, read this.
const ACTIVITY_TARGET_PIN_KEY = 'ACTIVITY_TARGET_FIXED_KCAL';

function pinnedActivityTargetKcal() {
  return getSetting(ACTIVITY_TARGET_PIN_KEY, null);
}

// TODAY's activity kcal target: the pinned figure if one is set, else whatever
// ACTIVITY_TARGET_MIN implies at bodyMassKg.
function getActivityTargetKcal(bodyMassKg) {
  return pinnedActivityTargetKcal() ?? activityTargetKcal(bodyMassKg);
}

// The mirror for minutes: unset, it's just the flat ACTIVITY_TARGET_MIN; pinned, it's
// however many minutes at bodyMassKg it now takes to burn the pinned figure — rising as
// body mass falls, since the same MET moves less mass per minute. No body mass, no figure
// to divide by, so it falls back to the flat minutes setting either way.
function getActivityTargetMin(bodyMassKg) {
  const pinnedKcal = pinnedActivityTargetKcal();
  if (pinnedKcal === null || bodyMassKg === null) {
    return getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT);
  }
  return pinnedKcal / (activityMet() * bodyMassKg * kcalPerMetKgMin());
}

// The single rule every activity kcal figure goes through. A Calculate-derived amount2
// wins (it used the real per-exercise MET); otherwise minutes at ACTIVITY_MET.
function activityEntryKcal(entry, bodyMassKg) {
  if (entry.amount2 !== null) return entry.amount2;
  const mins = toActivityMinutes(entry.amount, entry.unit);
  return bodyMassKg != null ? metKcal(activityMet(), bodyMassKg, mins) : mins * GENERIC_KCAL_PER_ACTIVE_MIN;
}

// The target for ONE body mass: BMR + the burn ACTIVITY_TARGET_MIN implies − the deficit
// that hits WEEKLY_FAT_LOSS_KG. No lifestyle multiplier, so it agrees with the forecast
// and Calorie Balance. The trade, since no label carries it: BMR + target activity
// omits food's thermic effect and incidental NEAT, landing near 1.29 x BMR — so a
// former 1.55-multiplier user loses ~475 kcal/day of ceiling, and WEEKLY_FAT_LOSS_KG
// is the dial for it.
//
// Body mass is an argument because both terms scale with it and Caloric Intake evaluates
// per day. Null when an input is missing; the caller falls back to CALORIE_TARGET_KCAL.
function calorieTargetDetail(bodyMassKg) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  // Not getSetting directly: a pinned percentage makes the rate a function of the mass
  // this is being evaluated at, which is what turns a fixed-kg plan into a proportional one
  // everywhere at once — this tile, the per-day chart line, and the playground's preview.
  const weeklyFatLossKg = weeklyFatLossKgAt(bodyMassKg);

  // Age only when the BMR equation in force actually reads it (see bmrNeedsAge).
  const haveAllInputs = bodyMassKg !== null && heightCm !== null && (age !== null || !bmrNeedsAge())
    && (sex === 'male' || sex === 'female') && weeklyFatLossKg !== null;
  if (!haveAllInputs) return null;

  const bmr = bmrKcal(bodyMassKg, heightCm, age, sex);
  const activityKcal = activityTargetKcal(bodyMassKg);

  // A negative WEEKLY_FAT_LOSS_KG (lean bulk) makes this a surplus and lifts the target
  // above maintenance, flipping it from a ceiling to a floor. No plausibility guard: an
  // aggressive target means an aggressive setting, which is the user's call.
  //
  // The TEF divisor is the last step, not a term: digestion's cost is a share of the intake
  // being solved for, so it scales the whole balance rather than being added to one side of
  // it (see tefDivisor). At the default f = 0 it divides by 1 and this is the same figure the
  // app has always produced.
  const divisor = tefDivisor();
  const kcal = Math.round((bmr + activityKcal - (weeklyFatLossKg * GENERIC_KCAL_PER_KG_FAT) / 7) / divisor);

  // Off the ROUNDED intake, so `TEF = f × Eᵢₙ` multiplies out against the Eᵢₙ shown beside it.
  return { kcal, bmr, activityKcal, weeklyFatLossKg, tefKcal: kcal * (1 - divisor), tefDivisor: divisor };
}

// Δm as a share of body mass — the unit the safety literature is written in, and with
// its inverse below the pair the playground's Δm/Δm% boxes read off each other. Here
// rather than in the playground because the Health Plan prompt quotes the same figure.
//
// 0.5–1% of body mass per week is the usual sustainable range, and 1% the ceiling:
// above it more of what comes off is lean mass, and the pace rarely holds. It's only
// ever a verdict shown beside the box, never a limit — an aggressive target is the
// user's call, exactly as calorieTargetDetail treats one.
const WEEKLY_FAT_LOSS_PCT_FLOOR = 0.5;
const WEEKLY_FAT_LOSS_PCT_CEILING = 1;

function weeklyFatLossPct(weeklyFatLossKg, bodyMassKg) {
  if (weeklyFatLossKg === null || bodyMassKg === null || bodyMassKg <= 0) return null;
  return Math.round((weeklyFatLossKg / bodyMassKg) * 10000) / 100;
}

// The inverse. Three decimals, not two: 1% of 86.9 kg is 0.869 kg/week, and rounding
// that to 0.87 reads back as 1.001% — the two boxes would disagree by a digit every
// time one drove the other.
function weeklyFatLossKgFromPct(pct, bodyMassKg) {
  if (pct === null || bodyMassKg === null) return null;
  return Math.round((pct / 100) * bodyMassKg * 1000) / 1000;
}

// PINNING THE PERCENTAGE: the third way to hold a plan steady, alongside
// CALORIE_TARGET_FIXED_KCAL. Set it and the weekly kilograms are recomputed from every
// new weigh-in as a share of THAT mass, so the pace stays proportional to the body doing
// the losing instead of being a fixed number of kilograms.
//
// Its own key rather than a mode flag, and blank means unset, so both pins read the same
// way: whichever key holds a number is the one in force. The two are mutually exclusive —
// they answer the same question from opposite ends — which the playground enforces by
// writing a blank into the other one whenever it sets either.
const WEEKLY_FAT_LOSS_PCT_PIN_KEY = 'WEEKLY_FAT_LOSS_PCT';

function pinnedWeeklyFatLossPct() {
  return getSetting(WEEKLY_FAT_LOSS_PCT_PIN_KEY, null);
}

// The weekly rate in kg AT a given body mass — the one place the difference between the
// two rate plans lives, so every reader of the rate gets the same answer. Unpinned it's
// the flat WEEKLY_FAT_LOSS_KG this always read; pinned it's a share of that mass, so it
// shrinks as you do. Body mass is an argument because the whole point is that the answer
// depends on it, and Caloric Intake evaluates per day.
function weeklyFatLossKgAt(bodyMassKg) {
  const pct = pinnedWeeklyFatLossPct();
  if (pct !== null && bodyMassKg !== null) return weeklyFatLossKgFromPct(pct, bodyMassKg);
  return getSetting('WEEKLY_FAT_LOSS_KG', null);
}

function calculatedCalorieTargetKcal(bodyMassKg) {
  const detail = calorieTargetDetail(bodyMassKg);
  return detail === null ? null : detail.kcal;
}

function flatCalorieTargetKcal() {
  return getSetting('CALORIE_TARGET_KCAL', CALORIE_TARGET_KCAL_DEFAULT);
}

// A PINNED target: one number that stays put instead of being recalculated from
// each new weigh-in. Set it and the figure stops tracking body mass — which is
// also what makes the app self-consistent, because the forecast
// (projectTargetDays) has always solved dm/dt at a CONSTANT Eᵢₙ. A target that
// steps down with you is a different, faster plan than the one being forecast.
//
// Deliberately its own key rather than reusing CALORIE_TARGET_KCAL: that one is
// the fallback for an incomplete profile and is already sitting on existing
// sheets, so giving it precedence would silently change the target for anyone
// whose copy holds a stale value. Blank here means today's behaviour, unchanged.
const CALORIE_TARGET_PIN_KEY = 'CALORIE_TARGET_FIXED_KCAL';

function pinnedCalorieTargetKcal() {
  return getSetting(CALORIE_TARGET_PIN_KEY, null);
}

// TODAY's target: the calculated figure at the smoothed body mass, else flat
// CALORIE_TARGET_KCAL. Only the FIGURE — which side to be on is getCalorieTargetKind,
// and getCalorieTarget pairs them so no label can carry one without the other.
//
// Smoothed rather than the last reading alone (planBodyMassKg): both terms of the target
// scale with mass, so a single water-heavy morning would otherwise move the day's calorie
// ceiling by ~30 kcal for no metabolic reason — and it's the same basis the Formula
// Playground previews and saves against, so the tile and the modal can't disagree.
function getCalorieTargetKcal(entries) {
  return pinnedCalorieTargetKcal()
    ?? calculatedCalorieTargetKcal(planBodyMassKg(entries))
    ?? flatCalorieTargetKcal();
}

// The target per day, each from the body mass in effect THAT day rather than today's
// applied backwards. It moves ~15.8 kcal/kg across both terms, so a 6 kg loss shifts it
// ~95 kcal — enough that one flat line marked days red that were comfortably inside the
// maximum actually applying when they were eaten. Each entry carries its body mass so the
// tooltip can say why the figure moved; null on the flat fallback, which has no basis.
function calorieTargetSeries(entries, dates) {
  // A pinned target is one flat line by definition — the whole point is that it
  // didn't move as the body mass under it did. bodyMassKg stays null so the
  // tooltip doesn't claim a weigh-in explains a figure that ignores them.
  const pinned = pinnedCalorieTargetKcal();
  if (pinned !== null) return dates.map(() => ({ kcal: pinned, bodyMassKg: null }));

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const bodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(bodyMassEntries), dates);
  const flat = flatCalorieTargetKcal();

  return dates.map((date) => {
    const bodyMassKg = bodyMassForDate.get(date) ?? null;
    const kcal = calculatedCalorieTargetKcal(bodyMassKg);
    return kcal === null ? { kcal: flat, bodyMassKg: null } : { kcal, bodyMassKg };
  });
}

// This target is directional, not a point to land on — a ceiling heading down, a floor
// heading up. Eating 400 under a bulk's figure is no better than 400 over a cut's, so
// scoring both sides the same way would tell half the users the opposite of the truth.
//
// Direction is target body mass vs. the smoothed body mass. With neither, or a target already
// reached (0.1 kg tolerance), the sign of WEEKLY_FAT_LOSS_KG decides — negative is a bulk, so a
// floor. Nothing at all keeps the ceiling.
//
// Smoothed for a stronger reason than the figure itself: this decides whether the target is a
// ceiling or a floor, so within 0.1 kg of goal a single noisy reading could flip the whole
// panel's scoring from one day to the next.
function getCalorieTargetKind(entries) {
  const targetKg = getSetting('BODY_MASS_TARGET_KG', null);
  const currentKg = planBodyMassKg(entries);

  if (targetKg !== null && currentKg !== null && Math.abs(targetKg - currentKg) >= 0.1) {
    return targetKg < currentKg ? 'max' : 'min';
  }

  // Only the sign is read, and a pinned percentage carries the same one — a negative rate
  // is a lean bulk in either plan.
  const weeklyFatLossKg = weeklyFatLossKgAt(currentKg);
  return (weeklyFatLossKg !== null && weeklyFatLossKg < 0) ? 'min' : 'max';
}

// Figure, kind and every display form in one object, so the tile, the chart and the
// Insight prompt can't describe the same number two different ways.
function getCalorieTarget(entries) {
  const kind = getCalorieTargetKind(entries);
  return {
    kcal: getCalorieTargetKcal(entries),
    kind,
    isMax: kind === 'max',
    word: kind === 'max' ? 'Max' : 'Min',
    full: kind === 'max' ? 'Maximum' : 'Minimum',
  };
}

// Is a day's intake on the right side of the target? At-or-under a ceiling,
// at-or-over a floor — hitting it exactly counts as met either way.
function withinCalorieTarget(kcal, target) {
  return target.isMax ? kcal <= target.kcal : kcal >= target.kcal;
}

// Inside this margin a day is neither scored nor condemned — a few percent is within
// the noise of the estimate and of the log itself.
const CALORIE_TARGET_NEAR_FRACTION = 0.05;

// 'met' on the right side, 'near' within CALORIE_TARGET_NEAR_FRACTION past it, 'missed'
// beyond. Distance is measured alike for a ceiling and a floor, so a bulk's
// under-eating grades exactly like a cut's over-eating.
function calorieTargetScore(kcal, target) {
  if (withinCalorieTarget(kcal, target)) return 'met';
  return Math.abs(kcal - target.kcal) <= target.kcal * CALORIE_TARGET_NEAR_FRACTION ? 'near' : 'missed';
}

// The window every Health Indicators chart plots, when the From/To pair above Body Mass
// hasn't been filled in yet: the last 4 weeks. Body Mass appears here as well as in
// State Trend & Forecast without duplicating it — that one is the trajectory over the
// whole history and ignores this window, this one scores each day's move toward the
// target or away from it.
const WELLNESS_METRICS_DAYS = 28;

let wellnessCaloriesChart = null;
let wellnessSleepChart = null;
let wellnessActivityChart = null;
let wellnessProteinChart = null;
let wellnessFiberChart = null;
let wellnessProjectionChart = null;

function lastNDates(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (n - 1 - i));
    return isoFromDate(d);
  });
}

// Every ISO date from fromIso to toIso inclusive. Empty on a missing, unparseable or
// inverted range — callers read that as "no data" rather than special-casing it.
function datesInRange(fromIso, toIso) {
  if (!fromIso || !toIso) return [];
  const from = dateFromIso(fromIso);
  const to = dateFromIso(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return [];

  const dates = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    dates.push(isoFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
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

function renderWellnessCharts(entries) {
  renderTodayGlanceCards(entries);
  renderWellnessBodyMassChart(entries);
  renderWellnessCaloriesChart(entries);
  renderWellnessSleepChart(entries);
  renderWellnessActivityChart(entries);
  renderWellnessProteinChart(entries);
  renderWellnessFiberChart(entries);
  renderWellnessProjectionChart(entries);
  renderWellnessEnergyBalanceChart(entries);
}

// The charts answer "how's the trend", not "am I on track right now" — these tiles give
// today's actual-vs-target for all four metrics without reading four rightmost bars.
function renderTodayGlanceCards(entries) {
  const todayIso = isoFromDate(new Date());

  let calories = null;
  let protein = null;
  let fiber = null;
  let activityMins = null;

  entries
    .filter((e) => e.date === todayIso)
    .forEach((e) => {
      if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
        calories = (calories ?? 0) + e.amount;
      }
      if (e.category === 'Calories; Protein' && e.amount2 !== null) {
        protein = (protein ?? 0) + e.amount2;
      }
      if (e.category === 'Calories; Protein' && e.fiberG !== null && e.fiberG !== undefined) {
        fiber = (fiber ?? 0) + e.fiberG;
      }
      if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
        activityMins = (activityMins ?? 0) + toActivityMinutes(e.amount, e.unit);
      }
    });

  const calorieTarget = getCalorieTarget(entries);
  const proteinBand = getProteinTargetBandG(entries);
  const fiberBand = getFiberTargetBandG(entries);
  const bodyMassKg = latestBodyMassKg(entries);
  // Minutes when time is what's pinned; rises with a lighter body mass when calorie burn
  // is pinned instead — see getActivityTargetMin.
  const activityTarget = Math.round(getActivityTargetMin(bodyMassKg));

  // The heading carries which target it is, since the number can't and the value line
  // has no room. Digit-free, so privacy mode has nothing to hide.
  document.getElementById('today-calories-label').textContent = `${calorieTarget.word} Calory Intake`;

  // Protein is the one metric judged against a RANGE, and the one where overshooting
  // still counts as a hit — see withinProteinBand and the chart's PROTEIN_OVER_BAND_COLOR.
  const proteinInBand = protein !== null && withinProteinBand(protein, proteinBand);
  const proteinOverBand = protein !== null && protein > proteinBand.max;

  // Same in-band/over-band split as protein — see withinFiberBand/getFiberTargetBandG.
  const fiberInBand = fiber !== null && withinFiberBand(fiber, fiberBand);
  const fiberOverBand = fiber !== null && fiber > fiberBand.max;

  // What hitting the minutes target would burn — pinned flat if calorie burn is what's
  // pinned, else via the same activityTargetKcal the calorie target is built from, so the
  // two can't quote different numbers for one day.
  const targetBurn = bodyMassKg !== null ? `${Math.round(getActivityTargetKcal(bodyMassKg))} kcal` : null;

  setTodayGlanceTile('today-calories', calories, calorieTarget.kcal, 'kcal', calories !== null && withinCalorieTarget(calories, calorieTarget));
  setTodayGlanceTile('today-protein', protein, formatProteinTargetBand(proteinBand), 'g', proteinInBand || proteinOverBand, null, proteinOverBand);
  setTodayGlanceTile('today-fiber', fiber, formatProteinTargetBand(fiberBand), 'g', fiberInBand || fiberOverBand, null, fiberOverBand);
  setTodayGlanceTile('today-activity', activityMins, activityTarget, 'min', activityMins !== null && activityMins >= activityTarget, targetBurn);
}

// `target` is a number, or a preformatted string for Protein's band — both interpolate
// and mask alike. `note` restates it in a second unit ("(394 kcal)"), inside the same
// string rather than its own element, so the line reads at one size and masks as one.
// `isHigh` gives Protein the same dark-green-past-the-band-top the chart uses; every
// other tile leaves it false and gets the plain two-colour split. `colorOverride`, when
// given, paints the value that exact colour instead of picking one of the two/three
// fixed classes — Sleep's own gradient read, see renderTodayGlanceCards above.
function setTodayGlanceTile(idPrefix, value, target, unit, isGood, note = null, isHigh = false, colorOverride = null) {
  const el = document.getElementById(`${idPrefix}-value`);
  el.classList.remove('income', 'income-high', 'expense');
  el.style.color = '';

  const text = `${value !== null ? value : '—'} / ${target} ${unit}${note !== null ? ` (${note})` : ''}`;
  el.textContent = privacyMode ? maskDigits(text) : text;
  if (value === null) return;
  if (colorOverride !== null) {
    el.style.color = colorOverride;
  } else {
    el.classList.add(isGood ? (isHigh ? 'income-high' : 'income') : 'expense');
  }
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

// lastNDates clipped to the earliest matching entry, so a short logging history isn't
// pushed to the right behind a run of empty days.
// The one window the whole Health Indicators panel plots, bar State Trend & Forecast:
// whatever the From/To pair above Body Mass holds, else the WELLNESS_METRICS_DAYS
// default. Protein Source Rotation reads it too — it wants the two ends rather than
// every day between them, which is why this returns the range and not the date list.
//
// Read straight off the inputs rather than from state initDateRangeControl hands back,
// so it can't matter whether a chart renders before or after that wiring runs — an
// unfilled pair simply reads as "use the default", which is what it means.
function wellnessDateRange() {
  const from = document.getElementById('wellness-date-from').value;
  const to = document.getElementById('wellness-date-to').value;
  if (from && to) return { from, to };

  const fallback = lastNDates(WELLNESS_METRICS_DAYS);
  return { from: fallback[0], to: fallback[fallback.length - 1] };
}

// One control for the panel. Every chart under State Trend & Forecast redraws on a
// change, Protein Source Rotation included — it used to carry a second From/To pair of
// its own, so the panel showed two windows at once.
function initWellnessRangeControl() {
  initDateRangeControl('wellness-date-from', 'wellness-date-to', WELLNESS_METRICS_DAYS, () => {
    renderWellnessCharts(physiqueAsWellnessEntries());
    renderProteinRotationChart(wellnessDateRange());
  });
}

// The date list built from that range, clipped to what this particular metric has
// logged.
function wellnessWindowDates(matchingEntries) {
  const { from, to } = wellnessDateRange();
  const window = datesInRange(from, to);

  // Clipped forward to the first day this metric has anything logged, so a chart doesn't
  // open on a run of empty days it never had data for. An inverted range gives no days,
  // and every caller already reads an empty window as "nothing to draw".
  if (!window.length || matchingEntries.length === 0) return window;
  const earliest = matchingEntries.reduce((min, e) => (e.date < min ? e.date : min), matchingEntries[0].date);
  const start = earliest > window[0] ? earliest : window[0];
  return window.filter((d) => d >= start);
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

// The Calories/Calories; Protein rows the Caloric Intake chart is built from.
function calorieLogEntries(entries) {
  return entries.filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null);
}

// The x-axis Caloric Intake and Body Mass BOTH plot on. Body Mass deliberately doesn't
// clip to its own log the way every other metric chart does: the two are read as a
// stacked pair, and different start days would slide their dates out of line.
function wellnessCalorieChartDates(entries) {
  return wellnessWindowDates(calorieLogEntries(entries));
}

let wellnessBodyMassChart = null;

// For a bar that can't be scored — the first reading, or a stall too short to call.
// Green would claim progress that isn't measured; red, a setback that isn't either.
const BODY_MASS_UNSCORED_COLOR = '#9ca3af';

// One flat reading is scale noise, not a plateau.
const BODY_MASS_STALL_RED_AFTER_DAYS = 2;

// Down on a cut, up on a bulk. Via getCalorieTargetKind rather than re-reading
// BODY_MASS_TARGET_KG, so this chart's green and Caloric Intake's max/min come from one read
// of the target, fallbacks included.
function bodyMassTargetIsDownward(entries) {
  return getCalorieTargetKind(entries) === 'max';
}

// The tolerance getCalorieTargetKind and calcProjection also treat as "there" — no scale
// reading lands on a target to the gram.
const BODY_MASS_AT_TARGET_TOLERANCE_KG = 0.1;

function bodyMassIsAtTarget(bodyMassKg) {
  const targetKg = getSetting('BODY_MASS_TARGET_KG', null);
  return targetKg !== null && bodyMassKg !== null && Math.abs(targetKg - bodyMassKg) < BODY_MASS_AT_TARGET_TOLERANCE_KG;
}

// Progress since the previous reading; null is unscored (gray). A day the scale held
// still is judged by WHERE and HOW LONG: holding at the target is what success looks like,
// so it stays green; holding short of it only reads as a miss after
// BODY_MASS_STALL_RED_AFTER_DAYS, since one flat reading is as likely to be noise.
function bodyMassChangeIsProgress(deltaKg, bodyMassKg, targetIsDownward, stallDays) {
  if (deltaKg === null) return null;
  if (deltaKg === 0) {
    if (bodyMassIsAtTarget(bodyMassKg)) return true;
    return stallDays >= BODY_MASS_STALL_RED_AFTER_DAYS ? false : null;
  }
  return (deltaKg < 0) === targetIsDownward;
}

// Deurenberg et al. 1991 (Br J Nutr): body fat % from BMI alone. The app has no direct
// measurement anywhere, so this is a population estimate at the same trust level as the
// USDA/AI calorie lookups.
function estimateBodyFatPercent(bodyMassKg, heightCm, age, sex) {
  const bmi = bodyMassKg / (heightCm / 100) ** 2;
  const sexTerm = sex === 'male' ? 1 : 0;
  return 1.20 * bmi + 0.23 * age - 10.8 * sexTerm - 5.4;
}

// Held to a plausible range, so a nonsense BMI can't produce a nonsense figure. Every
// fat-related value on this chart goes through it, so none of them can disagree.
function clampedBodyFatPercent(bodyMassKg, heightCm, age, sex) {
  return Math.max(3, Math.min(60, estimateBodyFatPercent(bodyMassKg, heightCm, age, sex)));
}

// Estimated fat mass (kg) at `bodyMassKg` — that clamped share of it.
function estimatedFatMassKg(bodyMassKg, heightCm, age, sex) {
  return bodyMassKg * (clampedBodyFatPercent(bodyMassKg, heightCm, age, sex) / 100);
}

// Energy stored in that fat mass, costed at fat's ~7,700 kcal/kg.
function fatEnergyKcal(bodyMassKg, heightCm, age, sex) {
  return estimatedFatMassKg(bodyMassKg, heightCm, age, sex) * GENERIC_KCAL_PER_KG_FAT;
}

// Boer 1984 (Am J Physiol 247:F632): lean body mass (kg) from mass, height and sex —
// the LBM equation clinical dosing uses, and the one that validates closest to DEXA in
// a general population. Deliberately NOT m × (1 − bodyFat%) off the Deurenberg estimate
// above: that route squares a BMI-only approximation, and Boer was regressed against
// measured lean mass directly. Age doesn't enter it.
//
// Split into its coefficients rather than written as two expressions because Katch-McArdle
// BMR is 21.6 × this: maintenance stays affine in body mass under that equation too, and
// maintenanceAffineCoefficients needs the per-kg and mass-independent halves separately to
// say so. One copy of the numbers, two things read off them.
const BOER_LBM_COEFFICIENTS = {
  male: { perKg: 0.407, perCm: 0.267, constant: -19.2 },
  female: { perKg: 0.252, perCm: 0.473, constant: -48.3 },
};

function boerLeanBodyMassCoefficients(sex) {
  return sex === 'male' ? BOER_LBM_COEFFICIENTS.male : BOER_LBM_COEFFICIENTS.female;
}

function boerLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  const c = boerLeanBodyMassCoefficients(sex);
  return c.perKg * bodyMassKg + c.perCm * heightCm + c.constant;
}

// The same four knobs the Formula Playground's glycogen block opens on (s, g_musc,
// g_liver, r) — defaults here match its input boxes, so a State Trend reader who never
// opens that modal still gets the same swing it would report for their own body.
const GLYCOGEN_SKELETAL_FRAC_DEFAULT = 45; // % of LBM
const GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT = 14; // g glycogen / kg muscle
const GLYCOGEN_LIVER_G_DEFAULT = 100; // g
const GLYCOGEN_WATER_RATIO_DEFAULT = 3; // g H2O / g glycogen

// ΔM_gly = g_musc × m_musc + g_liver, water-bound at r, in kg — the same identity the
// Formula Playground's glycogen block walks through (see its readGlycogenSwingFormula),
// evaluated at the defaults rather than whatever's currently typed there. This is the
// day-to-day swing glycogen and its bound water alone can account for, at this body —
// the noise floor State Trend & Forecast measures its smoothing against.
function glycogenSwingKg(bodyMassKg, heightCm, sex) {
  if (bodyMassKg === null || bodyMassKg === undefined || heightCm === null || heightCm === undefined) return null;
  const lbmKg = boerLeanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(lbmKg) || lbmKg <= 0) return null;
  const muscleKg = lbmKg * (GLYCOGEN_SKELETAL_FRAC_DEFAULT / 100);
  if (muscleKg <= 0) return null;
  const glycogenG = GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT * muscleKg + GLYCOGEN_LIVER_G_DEFAULT;
  return (glycogenG * (1 + GLYCOGEN_WATER_RATIO_DEFAULT)) / 1000;
}

// The target actually used to decide "have I arrived" — past the raw target by the
// glycogen/water swing, in the direction travel is already headed, so a bad-water-day
// reading can't land on the wrong side of the real target. Shared by calcProjection and
// the Formula Playground so both count arrival the same way and can't disagree. Falls
// back to the raw target when the swing can't be estimated (no height/sex on file).
function arrivalTargetKg(targetKg, bodyMassKg, heightCm, sex, isDownward) {
  const swingKg = glycogenSwingKg(bodyMassKg, heightCm, sex);
  return swingKg === null ? targetKg : targetKg + (isDownward ? -swingKg : swingKg);
}

// Headroom around the plotted range. The floor keeps a window of nearly identical
// readings off the top and bottom edges.
const BODY_MASS_AXIS_PAD_FRACTION = 0.15;
const BODY_MASS_AXIS_MIN_PAD_KG = 0.5;

// Smallest first; the first step keeping the count under BODY_MASS_MAX_GRIDLINES wins, so
// every line lands on a round kg.
const BODY_MASS_TICK_STEPS_KG = [0.5, 1, 2, 5, 10];
const BODY_MASS_MAX_GRIDLINES = 8;

// Fat energy runs to six figures against a capped axis width, so "175k kcal".
function maskedThousandsTick(unit) {
  return (v) => {
    const label = `${Math.round(v / 1000)}k ${unit}`;
    return privacyMode ? maskDigits(label) : label;
  };
}

// One bar per reading, scored by direction of travel on the same dates Caloric Intake
// uses, so the two compare bar for bar. No target line of its own: State Trend above
// already draws one, and a target several kg away would flatten this axis into exactly
// the flat line that chart exists to smooth.
//
// The twin axis restates each bar as the energy stored in the fat mass it implies.
// Body fat % moves with BMI, so that mapping is quadratic while a Chart.js twin axis
// can only be linear — anchoring at the ends of the kg range costs under 0.5% of the
// span on a typical window, 2.8% across an unusually wide 13 kg one.
function renderWellnessBodyMassChart(entries) {
  const ctx = document.getElementById('wellness-body-mass-chart');

  const targetIsDownward = bodyMassTargetIsDownward(entries);

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const byDate = bodyMassByDateMap(bodyMassEntries);
  const dates = wellnessCalorieChartDates(entries);

  // Scored against the previous READING, not the previous day, so logging every third
  // day still leaves every bar something to compare against — the leftmost included,
  // seeded from the last weigh-in before the window. stallStartDate is where the
  // current run of identical readings began, so a plateau predating the window still
  // counts its full length.
  let previousKg = null;
  let stallStartDate = null;
  [...byDate.keys()].sort().forEach((d) => {
    if (d >= dates[0]) return;
    const kg = Math.round(byDate.get(d) * 100) / 100;
    if (previousKg === null || kg !== previousKg) stallStartDate = d;
    previousKg = kg;
  });

  // Read before the loop, so each day's fat energy can be worked out as it goes.
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  // The same smoothed line and glycogen/water swing zone State Trend & Forecast draws
  // (computeBodyMassTrend/computeGlycogenZoneAnchor/glycogenSwingKg, charts.js), built off
  // the FULL history in `byDate` rather than just this window — smoothing needs the
  // context past the window's edges to agree with the other chart there — then read back
  // only for the dates this chart actually plots.
  const trendMap = computeBodyMassTrend(byDate);
  const trendDates = [...trendMap.keys()].sort();
  const lastTrendDate = trendDates[trendDates.length - 1];
  const swingKg = lastTrendDate !== undefined ? glycogenSwingKg(byDate.get(lastTrendDate), heightCm, sex) : null;
  const zoneAnchorMap = swingKg === null ? null : computeGlycogenZoneAnchor(trendMap);
  const stateTrendSeries = dates.map((d) => trendMap.get(d) ?? null);
  // Half of swingKg on each edge, so the band's total top-to-bottom height reads as
  // swingKg — not the doubled 2×swingKg that ± each full swingKg on both sides gave.
  const zoneHalfKg = swingKg === null ? null : swingKg / 2;
  const zoneUpperSeries = dates.map((d) => {
    if (zoneAnchorMap === null) return null;
    const a = zoneAnchorMap.get(d);
    return a === undefined ? null : a + zoneHalfKg;
  });
  const zoneLowerSeries = dates.map((d) => {
    if (zoneAnchorMap === null) return null;
    const a = zoneAnchorMap.get(d);
    return a === undefined ? null : a - zoneHalfKg;
  });

  const values = [];
  const barColors = [];
  const detailByDate = new Map();

  dates.forEach((d) => {
    if (!byDate.has(d)) {
      // An empty slot, not a zero: 0 kg is impossible and would drag the axis to it.
      values.push(null);
      barColors.push(BODY_MASS_UNSCORED_COLOR);
      return;
    }

    const kg = Math.round(byDate.get(d) * 100) / 100;
    const delta = previousKg === null ? null : Math.round((kg - previousKg) * 100) / 100;
    if (delta !== 0) stallStartDate = d;
    const stallDays = delta === 0
      ? Math.round((parseIsoDateUTC(d) - parseIsoDateUTC(stallStartDate)) / 86400000)
      : 0;
    const progress = bodyMassChangeIsProgress(delta, kg, targetIsDownward, stallDays);

    // The change BETWEEN the two readings, each converted at its own body mass — the
    // fat share of a kg moves with BMI, so a flat 7,700 would be wrong.
    const fatKcal = haveProfile ? fatEnergyKcal(kg, heightCm, age, sex) : null;
    const fatDeltaKcal = (haveProfile && delta !== null)
      ? fatKcal - fatEnergyKcal(previousKg, heightCm, age, sex)
      : null;
    const bodyFatPct = haveProfile ? clampedBodyFatPercent(kg, heightCm, age, sex) : null;
    const fatMassKg = haveProfile ? estimatedFatMassKg(kg, heightCm, age, sex) : null;
    // BMI needs only height, so it survives a profile missing birth date or sex.
    const bmi = heightCm !== null ? computeBmi(kg, heightCm) : null;
    detailByDate.set(d, { delta, fatKcal, fatDeltaKcal, bodyFatPct, fatMassKg, bmi });

    values.push(kg);
    barColors.push(progress === null ? BODY_MASS_UNSCORED_COLOR : (progress ? '#16a34a' : '#dc2626'));
    previousKg = kg;
  });

  // Sloped, not flat: a bar here is an absolute level, so the week's mean says little
  // and its direction says everything.
  const weekColumns = bucketedColumnCount(dates);
  const { series: trendSeries, slopePerWeek } = weeklyTrendSeries(values, weekColumns);

  // A single reading against the target reads as noise, not a reversal, when the week
  // it belongs to is still trending the right way overall — gray it out rather than
  // calling it a miss. Stall-days are untouched: their red already means something else.
  dates.forEach((d, i) => {
    if (barColors[i] !== '#dc2626') return;
    const delta = detailByDate.get(d)?.delta;
    if (!delta) return;
    const slope = slopePerWeek[i];
    if (slope === null || slope === undefined) return;
    if ((slope < 0) === targetIsDownward) barColors[i] = BODY_MASS_UNSCORED_COLOR;
  });

  // Explicit bounds, not `grace`: the twin axis derives from them and Chart.js resolves
  // `grace` too late to read here. The trend folds in too — a fit extended to the week's
  // edges can reach past every reading in it, and would otherwise clip.
  const logged = [...values, ...trendSeries, ...stateTrendSeries, ...zoneUpperSeries, ...zoneLowerSeries].filter((v) => v !== null);
  const kgLo = logged.length ? Math.min(...logged) : 0;
  const kgHi = logged.length ? Math.max(...logged) : 0;
  const kgPad = Math.max((kgHi - kgLo) * BODY_MASS_AXIS_PAD_FRACTION, BODY_MASS_AXIS_MIN_PAD_KG);

  // kg owns the gridlines, so both bounds round out to a whole step of it — otherwise
  // the lines land wherever the padding left them. The step grows with the range.
  const kgStep = BODY_MASS_TICK_STEPS_KG.find((s) => (kgHi - kgLo + 2 * kgPad) / s <= BODY_MASS_MAX_GRIDLINES)
    ?? BODY_MASS_TICK_STEPS_KG[BODY_MASS_TICK_STEPS_KG.length - 1];
  const yMin = Math.max(0, Math.floor((kgLo - kgPad) / kgStep) * kgStep);
  const yMax = Math.ceil((kgHi + kgPad) / kgStep) * kgStep;

  // Without the full profile the axis falls back to the invisible spacer, so the plot
  // area still lines up with its neighbours.
  const canShowFatEnergy = logged.length > 0 && haveProfile;

  wellnessBodyMassChart = upsertChart(wellnessBodyMassChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Body Mass',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Trend', trendSeries, {}, weekColumns),
        // The State Trend & Forecast chart's own smoothed line and glycogen/water swing
        // band, copied onto this chart's category axis (see stateTrendSeries/zoneUpperSeries/
        // zoneLowerSeries above). Two line datasets for the band, same reason that chart
        // needs both: Chart.js fills the area BETWEEN a dataset and the one its `fill`
        // points at, so the band needs both edges plotted, just invisibly (borderWidth 0).
        // Omitted entirely whenever the swing can't be estimated (no height/sex on file).
        // isStateTrendOverlay marks all three so the tooltip filter below can skip them,
        // the same way isWeeklyAverage does for the existing 7-Day Trend line. The band's
        // `order` (3) is higher than the bars' (2) — this codebase's convention is lower
        // order draws later/on top (see weeklyAverageDataset's own comment) — so the band
        // sits BEHIND the bars, a background reference rather than a wash over them; the
        // green trend line below keeps a lower order so it still reads on top.
        ...(zoneAnchorMap !== null ? [
          {
            type: 'line',
            label: 'Glycogen + Water Swing (upper)',
            data: zoneUpperSeries,
            borderWidth: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0.3,
            fill: false,
            spanGaps: false,
            isStateTrendOverlay: true,
            order: 3,
          },
          {
            type: 'line',
            label: 'Glycogen + Water Swing',
            data: zoneLowerSeries,
            // Same neutral amber the projection chart uses — normal noise, not a target
            // or a warning.
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            borderWidth: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0.3,
            fill: '-1',
            spanGaps: false,
            isStateTrendOverlay: true,
            order: 3,
          },
        ] : []),
        {
          type: 'line',
          label: 'State Trend & Forecast',
          data: stateTrendSeries,
          borderColor: '#16a34a',
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 0,
          spanGaps: false,
          isStateTrendOverlay: true,
          order: 1.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Matching the other charts in the section — without it the cursor lands on the
      // trend line instead of the day's bar, and that row is filtered out.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        title: {
          display: !values.some((v) => v !== null),
          text: 'No body mass readings logged in this range',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: {
          // Days with no weigh-in plot as a gap; index mode would otherwise hand them
          // over as an empty row.
          filter: (item) => item.raw !== null && !item.dataset.isWeeklyAverage && !item.dataset.isStateTrendOverlay,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const d = detailByDate.get(item.label) ?? {};
              const lines = [`Body Mass: ${item.parsed.y} kg`];
              // Against the previous READING, not "yesterday" — on an every-third-day
              // habit those differ. Omitted on the first bar.
              if (d.delta !== null && d.delta !== undefined) {
                lines.push(`Changed Mass: ${withExplicitSign(d.delta)} kg`);
              }
              // BMI leads the derived rows because the rest are computed from it.
              // Unitless by definition, so no unit.
              if (d.bmi !== null && d.bmi !== undefined) lines.push(`BMI: ${d.bmi}`);
              // Composition before energy, which derives from it. All Deurenberg
              // estimates, so all three vanish together without the full profile.
              if (d.bodyFatPct !== null && d.bodyFatPct !== undefined) {
                lines.push(`Body Fat: ${Math.round(d.bodyFatPct * 10) / 10} %`);
                lines.push(`Fat Mass: ${Math.round(d.fatMassKg * 10) / 10} kg`);
              }
              if (d.fatKcal !== null && d.fatKcal !== undefined) {
                lines.push(`Fat Energy: ${Math.round(d.fatKcal / 1000)}k kcal`);
              }
              if (d.fatDeltaKcal !== null && d.fatDeltaKcal !== undefined) {
                lines.push(`Fat Energy Change: ${withExplicitSign(Math.round(d.fatDeltaKcal))} kcal`);
              }
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // Flush left and last, like every reference figure in the section. Rate
            // only; the rows above already run to seven. Absent on a week with no slope.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined || slopePerWeek[i] === null) return '';
              const text = `7-Day Trend: ${withExplicitSign(Math.round(slopePerWeek[i] * 100) / 100)} kg/week`;
              return privacyMode ? maskDigits(text) : text;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        // Fat energy left, kg right — but kg keeps the gridlines: it's what the bars
        // are read against, and the only one that lands on round numbers. Only the
        // sides move; the bars stay on `y`.
        y: {
          // The one chart here that must NOT begin at zero — a 0 kg baseline puts every
          // bar within a pixel of the same height and hides the movement it exists for.
          beginAtZero: false,
          position: 'right',
          min: yMin,
          max: yMax,
          afterFit: fixTrendYAxisWidth,
          // autoSkip off so the step is honoured exactly.
          ticks: { stepSize: kgStep, autoSkip: false, callback: maskedUnitTick('kg', kgStep < 1 ? 1 : 0) },
        },
        y1: canShowFatEnergy
          ? {
            // Twin of y as stored fat energy; see above for why it anchors at the ends.
            position: 'left',
            min: fatEnergyKcal(yMin, heightCm, age, sex),
            max: fatEnergyKcal(yMax, heightCm, age, sex),
            afterFit: fixTrendYAxisWidth,
            // No lines of its own; its step is kg's equivalent, so each kcal label still
            // sits on one of kg's lines even though the figures can't also be round.
            grid: { drawOnChartArea: false },
            ticks: {
              stepSize: (fatEnergyKcal(yMax, heightCm, age, sex) - fatEnergyKcal(yMin, heightCm, age, sex))
                / ((yMax - yMin) / kgStep),
              autoSkip: false,
              callback: maskedThousandsTick('kcal'),
            },
          }
          : ghostLeftAxis(),
      },
    },
  });
}

// Headroom around the plotted range, with a floor — a window of near-identical days
// would otherwise be padded by almost nothing and sit flush against both edges.
const CALORIE_AXIS_PAD_FRACTION = 0.15;
const CALORIE_AXIS_MIN_PAD_KCAL = 120;

// Rounding for those bounds, so a zoomed axis still lands on readable tick
// figures (1,650 rather than 1,663).
const CALORIE_AXIS_STEP_KCAL = 50;

// Coarser, for the one case where the target still has to widen the axis. A coarse step
// holds the frame still across several hundred kcal of target movement.
const CALORIE_AXIS_TARGET_STEP_KCAL = 250;

// Framed on what was LOGGED, padded out. The zeros standing in for unlogged days would
// drag the floor back down and undo the zoom; clamped at zero so small intakes give the
// zero-based axis rather than negative calories.
//
// The target is deliberately NOT part of the frame. Padding around it made the ruler move
// with the thing it measures: a 278 kcal change landed the caps 2 px from where they
// started, with the bars changing height instead. What was eaten doesn't depend on the
// target, so framing on it holds still while the target moves across it.
//
// The caps still can't fall off-plot, so the frame is WIDENED — never re-padded — to
// reach one. That only arises when the target sits beyond everything logged.
function calorieAxisBounds(loggedValues, targetValues) {
  const framing = loggedValues.length ? loggedValues : targetValues;
  const lo = Math.min(...framing);
  const hi = Math.max(...framing);
  const pad = Math.max(CALORIE_AXIS_MIN_PAD_KCAL, (hi - lo) * CALORIE_AXIS_PAD_FRACTION);

  const roundDown = (v, step) => Math.max(0, Math.floor(v / step) * step);
  const roundUp = (v, step) => Math.ceil(v / step) * step;

  return {
    min: Math.min(roundDown(lo - pad, CALORIE_AXIS_STEP_KCAL), roundDown(Math.min(...targetValues), CALORIE_AXIS_TARGET_STEP_KCAL)),
    max: Math.max(roundUp(hi + pad, CALORIE_AXIS_STEP_KCAL), roundUp(Math.max(...targetValues), CALORIE_AXIS_TARGET_STEP_KCAL)),
  };
}

function renderWellnessCaloriesChart(entries) {
  const ctx = document.getElementById('wellness-calories-chart');

  const target = getCalorieTarget(entries);

  const calorieEntries = calorieLogEntries(entries);
  const dates = wellnessCalorieChartDates(entries);
  const byDate = new Map();
  calorieEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  // Re-evaluated per day, so there's no single figure to draw: each bar carries its own
  // and is scored against that one alone.
  const targetByDay = calorieTargetSeries(entries, dates);
  const dayTarget = (i) => ({ ...target, kcal: targetByDay[i].kcal });

  // Each bar against its OWN day's figure: green on the right side, gray within
  // CALORIE_TARGET_NEAR_FRACTION past it, red beyond — so the colour IS the read, and a
  // near-miss is called neither a win nor a failure. No shaded out-of-bounds region:
  // the target moves by tens of kcal across a window, far too little for a filled zone
  // to follow, so the wash only ever communicated a fixed limit the chart doesn't have.
  // An unlogged day plots as 0 and takes the green — a missing log, not a fast, and
  // invisible at zero height anyway rather than the worst day on the chart under a floor.
  const CALORIE_NEAR_TARGET_COLOR = '#9ca3af';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d)) return '#16a34a';
    const score = calorieTargetScore(values[i], dayTarget(i));
    if (score === 'met') return '#16a34a';
    return score === 'near' ? CALORIE_NEAR_TARGET_COLOR : '#dc2626';
  });

  // Averaged off the LOGGED days only, so `values`' zero-for-nothing-logged stand-ins
  // don't count as days of fasting. Computed here, ahead of the axis, so a missed day
  // can be graded against it below.
  const weekColumns = bucketedColumnCount(dates);
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), weekColumns);

  // A single day's overshoot reads as noise, not a habit, when the week around it is
  // still landing on the target's right side — gray it out rather than calling it a
  // miss. Only a 'missed' bar moves: 'met' is already green and 'near' is already this
  // same gray.
  barColors.forEach((color, i) => {
    if (color !== '#dc2626') return;
    const avg = weeklyAvg[i];
    if (avg === null || avg === undefined) return;
    if (withinCalorieTarget(avg, dayTarget(i))) barColors[i] = CALORIE_NEAR_TARGET_COLOR;
  });

  const axis = calorieAxisBounds(values.filter((v, i) => byDate.has(dates[i])), targetByDay.map((b) => b.kcal));

  // A cap across each bar rather than one continuous line: a line spanning the window
  // reads as a single shared limit however it's dashed, while a mark per bar says the
  // limit belongs to that day alone. Thickness scales with the axis span.
  const capHalf = (axis.max - axis.min) * 0.004;
  const capData = targetByDay.map((b) => [b.kcal - capHalf, b.kcal + capHalf]);

  wellnessCaloriesChart = upsertChart(wellnessCaloriesChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Calories',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        {
          type: 'bar',
          label: `${target.word} for the day`,
          data: capData,
          backgroundColor: targetMarkColor(),
          grouped: false,
          isTargetLine: true,
          // Lowest order paints last, so the cap stays visible on a bar that overshot it.
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Hovering anywhere in a column reports that day. Without it the cap is often the
      // nearest element to the pointer, and since it's filtered out below, hovering near
      // the top of a bar would produce an empty tooltip.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The cap is filtered out — a floating bar would report itself as a
          // `[from, to]` pair — and stated properly in afterBody instead.
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const lines = [`Actual Intake: ${item.parsed.y} kcal`];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // afterBody rather than a label row: Chart.js indents body lines to clear the
            // colour swatch, while this sits flush left. target.word, so it reads
            // "Target Max" rather than "Target Maximum".
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [`Target ${target.word}: ${targetByDay[i].kcal} kcal`];
              if (weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: {
          // NOT zero-based, unlike the other intake charts. The target drifts only a few
          // tens of kcal across a 12-week window — on a 0-2,500 axis that's a handful of
          // pixels, which is why the per-day figures still read as one fixed line. Bars
          // here are a position against their own cap, not a quantity of food, so the
          // axis covers the region the comparison actually happens in.
          min: axis.min,
          max: axis.max,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
        y1: ghostRightAxis(),
      },
    },
  });
}

// Clock minutes onto a noon-anchored axis, so a bed/wake pair crossing midnight renders
// as one contiguous span instead of splitting at 0:00. Noon, not an assumed bedtime: a
// fixed 18:00 anchor baked in "everyone sleeps at night" and broke on a night shift,
// while noon falls mid-waking-period for virtually any schedule.
const SLEEP_AXIS_ANCHOR_MIN = 12 * 60;
function sleepAxisValue(clockMin) {
  return (((clockMin - SLEEP_AXIS_ANCHOR_MIN) + 24 * 60) % (24 * 60)) / 60;
}

// Inverse of sleepAxisValue, shared by the ticks and the weekly-average tooltip. Both
// the anchor and the 3h step are whole hours, so no label lookup table is needed.
function sleepAxisClockMin(v) {
  return Math.round((SLEEP_AXIS_ANCHOR_MIN + v * 60) % (24 * 60));
}

function sleepAxisTickLabel(v) {
  return formatClockTime24(sleepAxisClockMin(v));
}

// The real bed-to-wake span rounded out to a 3-hour tick, rather than a fixed 18-hour
// window that wastes space on hours nobody sleeps through. 0-18 only with no data.
//
// The tick AT OR BELOW the earliest bedtime, not a whole tick below it. Flooring a 23:00
// bedtime already lands on 21:00; subtracting a further 3h put the axis floor at 18:00
// and left three empty hours under every bar — six with the top end padded the same way.
// A pad is added only when an extreme falls exactly ON a tick, which is the one case
// where the bar would otherwise sit flush against the axis edge with nothing to read it
// against (a midnight bedtime lands on 00:00, so the axis opens at 21:00).
function computeSleepAxisRange(shiftedPairs) {
  if (shiftedPairs.length === 0) return { axisMin: 0, axisMax: 18 };
  const min = Math.min(...shiftedPairs.map((p) => p.start));
  const max = Math.max(...shiftedPairs.map((p) => p.end));
  const floorTick = Math.floor(min / 3) * 3;
  const ceilTick = Math.ceil(max / 3) * 3;
  return {
    axisMin: Math.max(0, min === floorTick ? floorTick - 3 : floorTick),
    axisMax: Math.min(24, max === ceilTick ? ceilTick + 3 : ceilTick),
  };
}

function lerpHex(hexA, hexB, t) {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${rgb.join(',')})`;
}

// Red -> amber -> green from half the target up to the target, in the app's own
// expense/calories/income colours. Solid at either end.
function sleepStatusColor(durationHr, targetHr) {
  const minHr = targetHr / 2;
  const ratio = Math.min(1, Math.max(0, (durationHr - minHr) / (targetHr - minHr)));
  return ratio < 0.5
    ? lerpHex('#dc2626', '#f59e0b', ratio / 0.5)
    : lerpHex('#f59e0b', '#16a34a', (ratio - 0.5) / 0.5);
}

function renderWellnessSleepChart(entries) {
  const ctx = document.getElementById('wellness-sleep-chart');

  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  const sleepEntries = entries.filter((e) => e.category === 'Sleep' && e.amount !== null);
  const dates = wellnessWindowDates(sleepEntries);

  // Only the longest bed/wake-bearing entry per date, so a nap logged separately
  // doesn't compete with the night. A date with only a duration is left as a gap.
  const bestByDate = new Map();
  sleepEntries.forEach((e) => {
    if (e.sleepBedMin === null || e.sleepWakeMin === null) return;
    const current = bestByDate.get(e.date);
    if (!current || e.amount > current.amount) bestByDate.set(e.date, e);
  });

  // Shifted once up front, feeding both the axis range and the chart data, so the shift
  // and the validity check (wake must land after bed) live in one place.
  const shiftedByDate = new Map();
  const validShiftedPairs = [];
  dates.forEach((d) => {
    const e = bestByDate.get(d);
    if (!e) return;
    const start = sleepAxisValue(e.sleepBedMin);
    const end = sleepAxisValue(e.sleepWakeMin);
    if (end <= start) return;
    shiftedByDate.set(d, { start, end, e });
    validShiftedPairs.push({ start, end });
  });

  const { axisMin, axisMax } = computeSleepAxisRange(validShiftedPairs);

  const rangeByDate = new Map(); // date -> { bedMin, wakeMin, durationHr }
  const barColors = [];
  const sleepData = dates.map((d) => {
    const shifted = shiftedByDate.get(d);
    if (!shifted) { barColors.push(null); return null; }
    const { start, end, e } = shifted;
    rangeByDate.set(d, { bedMin: e.sleepBedMin, wakeMin: e.sleepWakeMin, durationHr: e.amount });
    barColors.push(sleepStatusColor(e.amount, sleepTarget));
    return [start, end];
  });

  // Averaged in AXIS units, not clock minutes: the shift has already unwrapped
  // midnight, so a plain mean works where clock times would average 23:30 and 00:30
  // into midday.
  const weekColumns = bucketedColumnCount(dates);
  const bedAvg = weeklyAverageSeries(dates.map((d) => shiftedByDate.get(d)?.start ?? null), weekColumns);
  const wakeAvg = weeklyAverageSeries(dates.map((d) => shiftedByDate.get(d)?.end ?? null), weekColumns);

  wellnessSleepChart = upsertChart(wellnessSleepChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Sleep',
          data: sleepData,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Avg Bed', bedAvg, {}, weekColumns),
        weeklyAverageDataset('7-Day Avg Wake', wakeAvg, {}, weekColumns),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Without it the cursor lands on whichever average line is nearest, not the bar.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // Nights with no pair plot as a gap; index mode would hand them over empty.
          filter: (item) => item.raw !== null && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const r = rangeByDate.get(item.label);
              if (!r) return '';
              const lines = [
                `Bed: ${formatClockTime24(r.bedMin)}`,
                `Wake: ${formatClockTime24(r.wakeMin)}`,
                `Duration: ${r.durationHr} hr`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // Flush left and last, like every reference figure in the section.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined || bedAvg[i] === null) return '';
              const lines = [
                `7-Day Avg Bed: ${formatClockTime24(sleepAxisClockMin(bedAvg[i]))}`,
                `7-Day Avg Wake: ${formatClockTime24(sleepAxisClockMin(wakeAvg[i]))}`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: {
          min: axisMin,
          max: axisMax,
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: 3, callback: sleepAxisTickLabel },
        },
        y1: ghostRightAxis(),
      },
    },
  });
}

// Steps and timed entries onto one comparable scale. ~100 steps/min is walking
// pace; WORKOUT_STEPS_PER_MIN overrides it for a longer or shorter stride, and
// applies everywhere at once — this chart, the Activity target, and the workout
// estimator's own duration (activeSecondsForNoteLine, activity-estimator.js).
// The default lives here rather than beside WORKOUT_REP_SEC_DEFAULT because
// charts.js loads first: a const in the later file would still be in its dead
// zone. Nothing there needs it anyway — the estimator calls this function.
const WORKOUT_STEPS_PER_MIN_DEFAULT = 100;

function toActivityMinutes(amount, unit) {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'steps' || u === 'step') {
    return Math.round(amount / getSetting('WORKOUT_STEPS_PER_MIN', WORKOUT_STEPS_PER_MIN_DEFAULT));
  }
  if (u === 'hr' || u === 'hour' || u === 'hours') return Math.round(amount * 60);
  return amount; // 'min' or unknown — use as-is
}

// bodyMassKg / heightM². Computed, never asked of an LLM, and shared by the BMI line, the
// Body Mass tooltip and insight.js.
function computeBmi(bodyMassKg, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((bodyMassKg / (heightM * heightM)) * 10) / 10;
}

// The inverse — the body mass a BMI implies at this height. Only one place needs it, the
// Formula Playground's target-BMI box, but it lives here beside computeBmi so the pair can't
// drift apart the way two copies of one rearrangement eventually do.
function bodyMassKgFromBmi(bmi, heightCm) {
  const heightM = heightCm / 100;
  return Math.round(bmi * heightM * heightM * 10) / 10;
}

// The WHO bands, for the one place a BMI is a GOAL rather than a reading: a target body mass
// is a number you choose, and the whole reason to show its BMI is to say whether the choice
// lands somewhere sensible. Both ends matter here, unlike the fat-loss band where only the
// ceiling is a warning — an underweight target is as much a problem as an obese one.
const BMI_HEALTHY_MIN = 18.5;
const BMI_HEALTHY_MAX = 24.9;

function bmiVerdict(bmi) {
  if (bmi < 16) return { text: 'severely underweight', outside: true };
  if (bmi < BMI_HEALTHY_MIN) return { text: 'underweight', outside: true };
  if (bmi <= BMI_HEALTHY_MAX) return { text: `in the healthy ${BMI_HEALTHY_MIN}–${BMI_HEALTHY_MAX} band`, outside: false };
  if (bmi < 30) return { text: 'overweight', outside: true };
  if (bmi < 35) return { text: 'obese (class I)', outside: true };
  return { text: 'obese (class II+)', outside: true };
}

// "NEAT (Non-Exercise Activity Thermogenesis)" -> "NEAT"; the parenthetical doesn't fit
// a legend and isn't needed once you know the term.
function shortActivityLabel(description) {
  return description.split(' (')[0].trim();
}

// The two segments read most often, pinned rather than left to whatever hue their
// alphabetical position lands on — a generated one slides out from under them the
// moment a new description is logged. Keyed on the SHORTENED label.
const PINNED_ACTIVITY_COLORS = new Map([
  ['neat', '#3b82f6'],
  ['strength training', '#16a34a'],
]);

// Everything else gets a generated hue from the colour circle MINUS a band around each
// pinned one, otherwise a third activity lands on a near-identical blue and the pinning
// buys nothing. The surviving arcs are measured end to end and the hues spread evenly
// along that total, so they stay as far apart as the reduced range allows.
const RESERVED_ACTIVITY_HUES = [142, 217]; // the two pinned colors above
const RESERVED_ACTIVITY_HUE_MARGIN = 25;

function unreservedActivityHues(count) {
  const allowed = [];
  let cursor = 0;
  RESERVED_ACTIVITY_HUES
    .map((h) => [h - RESERVED_ACTIVITY_HUE_MARGIN, h + RESERVED_ACTIVITY_HUE_MARGIN])
    .sort((a, b) => a[0] - b[0])
    .forEach(([from, to]) => {
      if (from > cursor) allowed.push([cursor, from]);
      cursor = Math.max(cursor, to);
    });
  if (cursor < 360) allowed.push([cursor, 360]);

  const total = allowed.reduce((sum, [from, to]) => sum + (to - from), 0);

  return Array.from({ length: count }, (_, i) => {
    let offset = ((i + 0.5) * total) / count;
    for (const [from, to] of allowed) {
      if (offset < to - from) return Math.round(from + offset);
      offset -= to - from;
    }
    return Math.round(allowed[allowed.length - 1][1]);
  });
}

function renderWellnessActivityChart(entries) {
  const ctx = document.getElementById('wellness-activity-chart');

  const activityEntries = entries.filter((e) => (e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null);
  const dates = wellnessWindowDates(activityEntries);

  // One stacked segment per description rather than a summed bar, so each day's
  // composition shows and not just its total. Entries with no recognized
  // category (an exercise name missing from the Activities tab) are dropped
  // rather than pooled into an 'Other' segment the sheet doesn't define.
  const categorizedEntries = activityEntries.filter((e) => e.description && e.description !== 'Other');
  const descriptions = [...new Set(categorizedEntries.map((e) => e.description))].sort();
  const byDescription = new Map(descriptions.map((d) => [d, new Map()]));
  categorizedEntries.forEach((e) => {
    const mins = toActivityMinutes(e.amount, e.unit);
    const byDate = byDescription.get(e.description);
    byDate.set(e.date, (byDate.get(e.date) || 0) + mins);
  });

  // Burn per day on its own axis — minutes and kcal are different scales, so this is a
  // deliberate dual-axis chart. Every entry gets a figure via activityEntryKcal, so an
  // entry without amount2 no longer leaves a logged day with no dot.
  const activityBodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(entries.filter((e) => e.category === 'Body Mass' && e.amount !== null)), dates);
  const caloriesByDate = new Map();
  activityEntries.forEach((e) => {
    const kcal = activityEntryKcal(e, activityBodyMassForDate.get(e.date) ?? null);
    caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + kcal);
  });

  const pinnedColorFor = (d) => PINNED_ACTIVITY_COLORS.get(shortActivityLabel(d).toLowerCase()) ?? null;
  const generatedHues = unreservedActivityHues(descriptions.filter((d) => pinnedColorFor(d) === null).length);
  let nextGeneratedHue = 0;
  const descriptionColors = descriptions.map((d) => pinnedColorFor(d)
    ?? `hsl(${generatedHues[nextGeneratedHue++]}, 65%, 55%)`);

  // Everything plots NEGATIVE so the chart hangs below the axis: minutes and calories
  // are both what a day spent, not what it accumulated. Only the geometry is flipped —
  // ticks and tooltips report the magnitudes.
  const activityDatasets = descriptions.map((d, i) => ({
    type: 'bar',
    label: shortActivityLabel(d),
    data: dates.map((date) => -(byDescription.get(d).get(date) || 0)),
    backgroundColor: descriptionColors[i],
    stack: 'activity',
    order: 2,
  }));

  const hasData = activityDatasets.some((ds) => ds.data.some((v) => v !== 0));

  // Scored against what that day's own body mass would burn at ACTIVITY_TARGET_MIN — or
  // the pinned calorie burn, if that's what's pinned instead — via the same
  // getActivityTargetKcal the activity tile uses, so the two can't disagree. Met is
  // green, short by up to ACTIVITY_NEAR_TARGET_FRACTION gray, further short red. Without
  // a body mass there's no target, so the dot stays neutral violet.
  const dotColor = (date, kcal) => {
    const bodyMassKg = activityBodyMassForDate.get(date) ?? null;
    if (kcal === null || bodyMassKg === null) return '#7c3aed';
    const target = getActivityTargetKcal(bodyMassKg);
    if (kcal >= target) return '#16a34a';
    return target - kcal <= target * ACTIVITY_NEAR_TARGET_FRACTION ? '#9ca3af' : '#dc2626';
  };

  // Dots, not a connected line: each day's burn is independent, and a line would bridge
  // the unlogged days as though they were a trend.
  const caloriesData = dates.map((date) => (caloriesByDate.has(date) ? caloriesByDate.get(date) : null));
  const caloriesDataset = {
    type: 'line',
    label: 'Actual Burn',
    data: caloriesData.map((v) => (v === null ? null : -v)),
    yAxisID: 'y1',
    showLine: false,
    pointRadius: 5,
    pointHoverRadius: 7,
    pointBackgroundColor: dates.map((date, i) => dotColor(date, caloriesData[i])),
    pointBorderColor: '#fff',
    pointBorderWidth: 1.5,
    order: 0,
  };

  // TARGET BURN on the kcal axis, not the flat minutes target it used to be — that sat
  // on the other axis from the dots it appeared to judge, so a day could clear it on a
  // walk while burning less than a day that lifted. It moves day to day when time is
  // what's pinned, since activityTargetKcal scales with body mass; flat when calorie
  // burn is pinned instead. No body mass, no figure, so it breaks there rather than
  // inventing one.
  const targetBurnKcal = dates.map((date) => {
    const bodyMassKg = activityBodyMassForDate.get(date) ?? null;
    return bodyMassKg === null ? null : getActivityTargetKcal(bodyMassKg);
  });

  // A cap per column, the same mark Caloric Intake and Calorie Balance use. It was a
  // dashed line while the target was flat; now that it moves with body mass, a line
  // spanning the window would read as one shared limit however it's dashed.
  const burnMagnitudes = [
    ...caloriesData.filter((v) => v !== null),
    ...targetBurnKcal.filter((v) => v !== null),
  ];
  const capHalf = (burnMagnitudes.length ? Math.max(...burnMagnitudes) : 1) * 0.006;
  const targetLineDataset = {
    type: 'bar',
    label: 'Target Burn',
    data: targetBurnKcal.map((v) => (v === null ? null : [-v - capHalf, -v + capHalf])),
    yAxisID: 'y1',
    backgroundColor: targetMarkColor(),
    grouped: false,
    // Lowest order paints last: bars (2), the weekly average and this cap (both 1, the
    // cap second so it wins the tie), then the dots (0) above everything.
    order: 1,
    isTargetLine: true,
  };

  // On the kcal axis, not the minutes one — Target Burn lives there, and it's what the
  // week is compared against. Negated like the dots it averages.
  const weekColumns = bucketedColumnCount(dates);
  const weeklyBurnAvg = weeklyAverageSeries(caloriesData, weekColumns);
  const weeklyBurnDataset = weeklyAverageDataset(
    '7-Day Average Burn',
    weeklyBurnAvg.map((v) => (v === null ? null : -v)),
    { yAxisID: 'y1' },
    weekColumns,
  );

  wellnessActivityChart = upsertChart(wellnessActivityChart, ctx, {
    data: {
      labels: dates,
      datasets: [...activityDatasets, weeklyBurnDataset, targetLineDataset, caloriesDataset],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        title: {
          display: !hasData,
          text: 'No activity logged yet — add a Walk, Run, or Workout entry to get started',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: {
          // Empty slots and the cap, whose `[from, to]` pair goes to afterBody instead.
          filter: (item) => item.raw !== null && !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          // Dataset order. Without it Chart.js sorts by `order`, which controls DRAW
          // order, and put the dots above the bars — away from the Target Burn figure
          // they should be read against.
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // Each dot's swatch takes the scored colour it was drawn in.
            labelColors: (item) => {
              const ds = item.dataset;
              const fill = Array.isArray(ds.pointBackgroundColor)
                ? ds.pointBackgroundColor[item.dataIndex]
                : (ds.pointBackgroundColor ?? ds.backgroundColor);
              return { borderColor: fill, backgroundColor: fill };
            },
            // Signed like the axes: calories keep the minus, minutes report magnitude.
            // y1 is kcal, everything else minutes, so the unit follows the row's axis.
            label: (item) => {
              const isKcal = item.dataset.yAxisID === 'y1';
              const v = Math.round(item.parsed.y);
              const text = `${item.dataset.label}: ${isKcal ? v : Math.abs(v)} ${isKcal ? 'kcal' : 'min'}`;
              return privacyMode ? maskDigits(text) : text;
            },
            // Flush left and last, the placement Caloric Intake gives its own target.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [];
              if (targetBurnKcal[i] !== null) lines.push(`Target Burn: ${-Math.round(targetBurnKcal[i])} kcal`);
              if (weeklyBurnAvg[i] !== null) lines.push(`7-Day Average Burn: ${-Math.round(weeklyBurnAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        // kcal left with the gridlines, minutes right with none: the comparison this
        // chart exists for — Actual against Target Burn — happens on the kcal scale,
        // so the lines have to be spaced in kcal. Only the sides move; the axis ids are
        // untouched. Both run from 0 downward, since everything is negated, but they
        // label differently: calories keep the minus because that energy left the body,
        // minutes drop it because negative time is meaningless.
        y: {
          stacked: true,
          position: 'right',
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => maskedUnitTick('min')(Math.abs(v)) },
        },
        y1: {
          position: 'left',
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

function renderWellnessProteinChart(entries) {
  const ctx = document.getElementById('wellness-protein-chart');

  const band = getProteinTargetBandG(entries);

  const proteinEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.amount2 !== null);
  const dates = wellnessWindowDates(proteinEntries);
  const byDate = new Map();
  proteinEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount2));

  // Both ends take the section's per-column cap, so this chart's mark means what every
  // other chart's does. The band stays shaded: these two line datasets exist only to
  // carry `fill: '+1'` (which shades down to the NEXT dataset, so the pair must stay
  // adjacent and in this order) with their stroke off, and the caps draw over them. A
  // zero-width band collapses to one row of caps with nothing to shade.
  //
  // Green, not red: unlike Caloric Intake's shading, this region is the one you're
  // aiming to land IN, and it sits behind bars scored in the same green.
  const bandFill = (value, extra = {}) => ({
    type: 'line',
    label: `${value} g band edge`,
    data: new Array(dates.length).fill(value),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 3,
    ...extra,
  });

  // The two ways of leaving the band are NOT equivalent. Under the floor is the miss
  // that costs muscle on a deficit, so red. Over the top is a darker green than the
  // band itself — still a day you hit your protein, just past the point where more
  // buys anything, and read as a success rather than the neutral gray the other charts
  // give their near-miss. An unlogged day takes the plain green.
  const PROTEIN_OVER_BAND_COLOR = '#166534';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinProteinBand(values[i], band)) return '#16a34a';
    return values[i] > band.max ? PROTEIN_OVER_BAND_COLOR : '#dc2626';
  });

  // Zero-based and auto-topped, so the span is whatever is tallest — a bar or the band.
  const capHalf = targetCapHalf(Math.max(band.max, ...values, 1));
  const capFor = (value, label) => targetCapDataset(label, new Array(dates.length).fill(value), capHalf, { isTargetLine: true });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: 'rgba(22, 163, 74, 0.10)' }),
      bandFill(band.min),
      capFor(band.max, `${band.max} g upper target`),
      capFor(band.min, `${band.min} g target floor`),
    ]
    : [capFor(band.min, `${band.min} g target`)];

  // Logged days only, so the zero stand-ins don't pull the week under the band's floor.
  const weekColumns = bucketedColumnCount(dates);
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), weekColumns);

  wellnessProteinChart = upsertChart(wellnessProteinChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Actual Intake',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        ...targetDatasets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Without it the cursor lands on the average line, not the bar.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The band's lines are the same constant every day, so as rows they'd repeat
          // identically on every hover. Stated once by afterBody instead.
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `Actual Intake: ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            // Both ends, flush left and last — the Actual/Target shape the other charts
            // use. A zero-width band reads as one target, not an equal Min and Max.
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`Target Min: ${band.min} g`, `Target Max: ${band.max} g`]
                : [`Target: ${band.min} g`];
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} g`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: {
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('g') },
        },
        y1: ghostRightAxis(),
      },
    },
  });
}

// Now a shaded min/max band like Protein Intake, not a flat single line — the Formula
// playground's fiber rows produce a band the same shape protein's do (getFiberTargetBandG),
// so the chart reads the same way: a floor that's a genuine miss (red) and a ceiling that's
// still a hit (dark green), not a flat met-or-missed. Read from the same Physique-day Fiber
// figure (fiberG) the Health tiles' own Fiber card sums — see physiqueAsWellnessEntries.
function renderWellnessFiberChart(entries) {
  const ctx = document.getElementById('wellness-fiber-chart');

  const band = getFiberTargetBandG(entries);

  const fiberEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.fiberG !== null && e.fiberG !== undefined);
  const dates = wellnessWindowDates(fiberEntries);
  const byDate = new Map();
  fiberEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.fiberG));

  // Same shape as Protein Intake's bandFill — two flat line datasets whose only job is the
  // `fill: '+1'` shading between them, stroke off, caps drawn over them.
  const bandFill = (value, extra = {}) => ({
    type: 'line',
    label: `${value} g band edge`,
    data: new Array(dates.length).fill(value),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 3,
    ...extra,
  });

  // Same three-way split as Protein Intake: under the floor is red, in the band (or
  // unlogged) is green, and past the ceiling is a darker green — still a hit, not a miss.
  const FIBER_OVER_BAND_COLOR = '#166534';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinFiberBand(values[i], band)) return '#16a34a';
    return values[i] > band.max ? FIBER_OVER_BAND_COLOR : '#dc2626';
  });

  const capHalf = targetCapHalf(Math.max(band.max, ...values, 1));
  const capFor = (value, label) => targetCapDataset(label, new Array(dates.length).fill(value), capHalf, { isTargetLine: true });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: 'rgba(22, 163, 74, 0.10)' }),
      bandFill(band.min),
      capFor(band.max, `${band.max} g upper target`),
      capFor(band.min, `${band.min} g target floor`),
    ]
    : [capFor(band.min, `${band.min} g target`)];

  const weekColumns = bucketedColumnCount(dates);
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), weekColumns);

  wellnessFiberChart = upsertChart(wellnessFiberChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Actual Intake',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        ...targetDatasets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `Actual Intake: ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`Target Min: ${band.min} g`, `Target Max: ${band.max} g`]
                : [`Target: ${band.min} g`];
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} g`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: {
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('g') },
        },
        y1: ghostRightAxis(),
      },
    },
  });
}

// Least-squares fit. The intercept is only needed by the Body Mass weekly trend,
// which has to EVALUATE the fitted line rather than just report how steep it is.
function linearRegression(xs, ys) {
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

function linearRegressionSlope(xs, ys) {
  return linearRegression(xs, ys).slope;
}

// Over days that actually HAVE a log, not the calendar length of the window.
function avg(map) {
  return [...map.values()].reduce((a, b) => a + b, 0) / map.size;
}

// UTC end to end: `new Date("YYYY-MM-DD")` parses as UTC midnight, and formatting that
// back in local time rolls it back a day in any negative-offset zone.
function parseIsoDateUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// In LOGGED POINTS, not calendar days.
const BODY_MASS_TREND_WINDOW_SIZE = 5;

// Centered moving average: each point is diluted by its neighbours on both sides, so a
// noisy reading doesn't spike — or, with a trailing-only average, drag the line up and
// lag behind afterwards. Windowing by logged points rather than elapsed days smooths
// the same whether entries are daily or sporadic, where a time-decayed average would
// stop smoothing once the gaps approach its decay window.
function smoothBodyMassSeries(values, windowSize) {
  const radius = Math.floor((windowSize - 1) / 2);
  return values.map((_, i) => {
    const windowValues = values.slice(Math.max(0, i - radius), Math.min(values.length, i + radius + 1));
    return windowValues.reduce((a, b) => a + b, 0) / windowValues.length;
  });
}

function computeBodyMassTrend(bodyMassByDate, windowSize = BODY_MASS_TREND_WINDOW_SIZE) {
  const dates = [...bodyMassByDate.keys()].sort();
  const values = dates.map((d) => bodyMassByDate.get(d));
  const smoothed = smoothBodyMassSeries(values, windowSize);

  const trend = new Map();
  smoothed.forEach((v, i) => trend.set(dates[i], v));
  return trend;
}

// Where the ±swingKg band drawn AROUND the trend line is centered — deliberately
// smoother than the trend line itself, which is already a moving average but can still
// wobble point to point. An exponential moving average of the trend, not a copy of it:
// each step nudges the anchor only a fraction of the way toward the trend's current
// value, so the zone is the visually STABLE thing on the chart and the green line is
// what moves around inside it. That fraction (alpha) is fixed and separate from
// swingKg — swingKg still sets the band's ±WIDTH (how far the trend can wander before a
// wobble stops reading as glycogen), this only sets how fast the band's CENTER drifts.
const GLYCOGEN_ZONE_SMOOTHING_ALPHA = 1 / BODY_MASS_TREND_WINDOW_SIZE;

function computeGlycogenZoneAnchor(trendMap, alpha = GLYCOGEN_ZONE_SMOOTHING_ALPHA) {
  const dates = [...trendMap.keys()].sort();
  const zone = new Map();
  let anchor = null;
  dates.forEach((d) => {
    const v = trendMap.get(d);
    anchor = anchor === null ? v : anchor + alpha * (v - anchor);
    zone.set(d, anchor);
  });
  return zone;
}

// A net change this small over ~10 days is a genuine stall rather than water, sodium or
// cycle. Checked against the SMOOTHED line — raw weigh-ins trip a naive threshold.
const PLATEAU_WINDOW_DAYS = 10;
const PLATEAU_THRESHOLD_KG = 0.3;

// How many days the trend has held flat, or null — either the trend moved, or there
// isn't enough history spanning the window to tell (sparse entries can't confirm 10
// flat days, only fail to disprove them).
function detectPlateau(trendMap) {
  const dates = [...trendMap.keys()].sort();
  if (dates.length < 3) return null;

  const lastDate = dates[dates.length - 1];
  const lastMs = parseIsoDateUTC(lastDate);
  const windowStartMs = lastMs - (PLATEAU_WINDOW_DAYS - 1) * 86400000;
  if (parseIsoDateUTC(dates[0]) > windowStartMs) return null;

  const windowStartDate = dates.find((d) => parseIsoDateUTC(d) >= windowStartMs);
  const change = trendMap.get(lastDate) - trendMap.get(windowStartDate);
  if (Math.abs(change) >= PLATEAU_THRESHOLD_KG) return null;

  return Math.round((lastMs - parseIsoDateUTC(windowStartDate)) / 86400000);
}

// A and B from "Maintenance is affine in body mass — M(m) = A + B×m": the body-mass-
// independent and body-mass-scaling halves of BMR + activity burn. Shared by
// projectTargetDays (the forward m_g → t direction) and the Formula Playground's reverse
// t → m_g solve, so both read the same A/B rather than two copies of this algebra.
//
// Affine under BOTH BMR equations, which is what lets one decay model serve them. Mifflin is
// affine in m by construction; Katch-McArdle is 370 + 21.6 × LBM and Boer's LBM is itself
// affine in m, so substituting gives 370 + 21.6×(c_h×h + c_0) as the constant half and
// 21.6×c_m as the per-kg one. Age falls out of A entirely there.
//
// TEF divides both halves rather than appearing as a term: maintenance is the intake that
// holds mass steady, and at that intake digestion is costing f of it, so M = (A₀ + B₀m)/(1−f).
// Every consumer — m∞, the decay constant, the reverse solves — therefore gets the thermic
// effect for free, and at the default f = 0 gets exactly today's coefficients.
//
// `formula` and `tef` are parameters defaulting to the saved settings so the Formula
// Playground can preview an unsaved choice through this same function instead of a second
// copy of the algebra. The extra returned parts are for the substituted trace and for
// adaptedPlateauKg, which has to scale the BMR half alone.
function maintenanceAffineCoefficients({
  heightCm, age, sex, met, tau, kappa, formula = bmrFormula(), tef = tefPercent(),
}) {
  const activityPerKg = (met * tau * kappa) / ML_O2_PER_KCAL;
  const lbm = boerLeanBodyMassCoefficients(sex);
  const aBmr = formula === 'katch'
    ? KATCH_BASE_KCAL + KATCH_KCAL_PER_KG_LBM * (lbm.perCm * heightCm + lbm.constant)
    : 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
  const bBmr = formula === 'katch' ? KATCH_KCAL_PER_KG_LBM * lbm.perKg : 10;
  const divisor = tefDivisor(tef);

  return {
    a: aBmr / divisor,
    b: (bBmr + activityPerKg) / divisor,
    aBmr,
    bBmr,
    activityPerKg,
    tefDivisor: divisor,
    formula,
  };
}

// Where the mass actually levels off once BMR has adapted — the same m∞ = (Eᵢₙ − A)/B, with
// the BMR half of each coefficient scaled by (1 − λt) and the activity half left alone:
// adaptation is a resting-metabolism effect, not a cheaper workout. Above the un-adapted m∞
// whenever λt > 0, and the difference is the overshoot the plain model hides.
function adaptedPlateauKg(intakeKcal, coefficients, adaptFraction) {
  const { aBmr, bBmr, activityPerKg, tefDivisor: divisor } = coefficients;
  const remaining = 1 - adaptFraction;
  return (intakeKcal - (remaining * aBmr) / divisor)
    / ((remaining * bBmr + activityPerKg) / divisor);
}

// The TARGET trajectory — eating exactly Eᵢₙ and hitting ACTIVITY_TARGET_MIN every
// day. Shared with the Formula Playground, so its printed A / B / m∞ / t and the chart's
// forecast are one piece of arithmetic rather than two that can disagree.
//
// Closed form of dm/dt = (Eᵢₙ − A − B·m)/ρ, not a day-by-day loop: it's a linear ODE, so
// the exact answer is one log. Verified against numeric integration.
//
// Works both directions — a surplus puts m∞ above m and the same log gives days to gain
// — but only reaches targets BETWEEN m and m∞. Past the asymptote is genuinely
// unreachable at that intake, and is reported rather than extrapolated.
// `formula` and `tef` ride along unread except to reach maintenanceAffineCoefficients, so
// the playground's unsaved BMR equation and thermic share reach the forecast the same way
// they reach A and B. Omitted by the settings-driven callers, which get the saved pair.
function projectTargetDays({
  intakeKcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg, formula, tef,
}) {
  const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa, formula, tef });
  const equilibriumKg = (intakeKcal - a) / b;

  if (Math.abs(bodyMassKg - targetKg) < BODY_MASS_AT_TARGET_TOLERANCE_KG) {
    return { a, b, equilibriumKg, status: 'reached' };
  }

  const ratio = (bodyMassKg - equilibriumKg) / (targetKg - equilibriumKg);
  if (!Number.isFinite(ratio) || ratio <= 1) {
    return { a, b, equilibriumKg, status: 'unreachable' };
  }

  const days = (GENERIC_KCAL_PER_KG_FAT / b) * Math.log(ratio);
  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  // decayPerKg is the coefficient of the exponential the chart draws, which for THIS
  // journey is B itself. It's named separately because the proportional journey below
  // decays at a rate that has nothing to do with maintenance, and both feed one curve.
  return { a, b, decayPerKg: b, equilibriumKg, days, etaIso: isoFromDate(eta), status: 'ok', journey: 'intake' };
}

// The OTHER target trajectory: the one a pinned percentage describes. Δm = p·m/100 every
// week, so the mass falls by a constant FRACTION rather than a constant number of
// kilograms — m(t) = m × (1 − p/100)^(t/7), i.e. dm/dt = −k·m with k = −ln(1 − p/100)/7
// per day. Returned in projectTargetDays' shape, with m∞ = 0, because the two are the same
// exponential with different coefficients: one curve-drawing routine serves both.
//
// No plateau, and therefore no 'unreachable' for a real rate — a constant fraction off a
// falling mass always crosses any positive target eventually, which is exactly what makes
// this the one plan that can't stall short of the goal. A rate of zero or less is the only
// thing that never arrives, and the caller keeps it out (see targetProjection).
function projectTargetDaysAtFixedPct({ bodyMassKg, targetKg, weeklyPct }) {
  const base = { decayPerKg: 0, equilibriumKg: 0, journey: 'pct' };
  if (Math.abs(bodyMassKg - targetKg) < BODY_MASS_AT_TARGET_TOLERANCE_KG) {
    return { ...base, status: 'reached' };
  }

  // Per DAY, from the per-week fraction: the weekly figure is what's set, but every
  // consumer of this — the curve, the day count — works in days.
  const kPerDay = -Math.log(1 - weeklyPct / 100) / 7;
  const decayPerKg = kPerDay * GENERIC_KCAL_PER_KG_FAT;
  const days = Math.log(bodyMassKg / targetKg) / kPerDay;
  if (!Number.isFinite(days) || days <= 0) {
    // There are only two ways a constant positive share never arrives, and neither is a
    // plateau — so the reason travels with the result: the display has no equilibrium figure
    // to describe here the way the constant-Eᵢₙ journey's 'unreachable' does.
    return {
      ...base,
      status: 'unreachable',
      reason: weeklyPct > 0
        ? 'the target is not below your current body mass'
        : 'a rate of 0% or less never moves the mass',
    };
  }

  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  return { ...base, decayPerKg, days, etaIso: isoFromDate(eta), status: 'ok' };
}

// The target trajectory in whichever journey the pins currently describe — the single
// entry point the chart and the Health Plan prompt both go through, so a pinned percentage
// can't move the arrival date in one of them and not the other. A and B are merged in
// either way: they describe maintenance, which is true regardless of which journey is
// being walked, and the chart reads them for the rate note.
//
// pct > 0 only. A pinned zero or negative percentage is a hold or a bulk, and the
// constant-Eᵢₙ form below already handles both — including reporting a target below the
// plateau as unreachable, which the proportional form has no way to express.
function targetJourneyProjection({ intakeKcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg }) {
  const pct = pinnedWeeklyFatLossPct();
  if (pct !== null && pct > 0) {
    return {
      ...maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa }),
      ...projectTargetDaysAtFixedPct({ bodyMassKg, targetKg, weeklyPct: pct }),
    };
  }
  return projectTargetDays({ intakeKcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg });
}

// The same target trajectory from saved Settings rather than the playground's live inputs,
// so the two agree whenever its boxes still hold what's on the sheet. Null without a profile.
function targetProjectionFromSettings(entries, bodyMassKg, targetKg) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  if (heightCm === null || (age === null && bmrNeedsAge()) || (sex !== 'male' && sex !== 'female')) return null;

  return targetJourneyProjection({
    // Eᵢₙ itself: the calculated target is exactly what the playground computes.
    intakeKcal: getCalorieTargetKcal(entries),
    bodyMassKg,
    heightCm,
    age,
    sex,
    met: activityMet(),
    tau: getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT),
    kappa: getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT),
    targetKg,
  });
}

function calcProjection(entries) {
  const bodyMassTarget = getSetting('BODY_MASS_TARGET_KG', BODY_MASS_TARGET_KG_DEFAULT);
  // The figure only; which side to be on doesn't enter this arithmetic. Stands in as
  // the intake level when nothing has been logged.
  const calorieTarget = getCalorieTargetKcal(entries);
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = isoFromDate(today);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - 14);
  const cutoffIso = isoFromDate(cutoff);

  const bodyMassEntries = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bodyMassEntries.length < 2) return null;

  const lastBodyMass = bodyMassEntries[bodyMassEntries.length - 1].amount;
  // planBodyMassKg (m̄), not the raw last reading — per its own definition, this is the
  // mass every PLAN-level figure is evaluated at, the Formula Playground's own bodyMassKg
  // included, so the target method's day count and ETA below can't disagree with what
  // the Playground prints for the same profile.
  const planMass = planBodyMassKg(entries) ?? lastBodyMass;

  const arrivalTarget = arrivalTargetKg(
    bodyMassTarget, planMass, getSetting('HEIGHT_CM', null), getSettingString('SEX', null),
    bodyMassTargetIsDownward(entries),
  );

  // The TARGET wins whenever the profile allows it — read straight off targetProjection,
  // the exact projectTargetDays / projectTargetDaysAtFixedPct result the Formula
  // Playground's own t and ETA come from (via targetProjectionFromSettings), not a second
  // copy of the day-count formula. That makes the forecast a statement of the target, not
  // of recent behaviour: eat over the target for a fortnight and it does NOT slip.
  // Calorie Balance is where actual-vs-target shows day by day.
  const targetProjection = targetProjectionFromSettings(entries, planMass, arrivalTarget);
  if (targetProjection !== null) {
    if (targetProjection.status === 'reached') return { status: 'reached' };

    // Rate at m̄, for the ETA line's note — the same mass t was solved from.
    const slope = (calorieTarget - (targetProjection.a + targetProjection.b * planMass)) / GENERIC_KCAL_PER_KG_FAT;

    if (targetProjection.status === 'unreachable') {
      return { status: 'asymptote', method: 'target', slope, equilibriumKg: targetProjection.equilibriumKg };
    }

    // status === 'ok': today + the exact day count projectTargetDays solved, not a
    // re-derivation of it — same rounding, so the ETA can't land a day off from the
    // Playground's.
    const daysToTarget = Math.round(targetProjection.days);
    const etaDate = new Date(today);
    etaDate.setDate(today.getDate() + daysToTarget);

    // m(t) = m∞ + (m − m∞)·e^(−decay·t/ρ), the curve those same coefficients trace.
    const bodyMassAtDay = (d) => targetProjection.equilibriumKg
      + (planMass - targetProjection.equilibriumKg) * Math.exp(-(targetProjection.decayPerKg * d) / GENERIC_KCAL_PER_KG_FAT);

    const cappedDays = Math.min(daysToTarget, 365);
    const projectedPoints = [];
    for (let d = 0; d <= cappedDays; d += 7) {
      const pd = new Date(today);
      pd.setDate(today.getDate() + d);
      projectedPoints.push({ date: isoFromDate(pd), bodyMass: Math.round(bodyMassAtDay(d) * 10) / 10 });
    }
    if (daysToTarget <= 365) {
      projectedPoints.push({ date: isoFromDate(etaDate), bodyMass: Math.round(arrivalTarget * 10) / 10 });
    }

    return {
      status: 'ok',
      slope,
      daysToTarget,
      etaDate,
      projectedPoints,
      method: 'target',
      bodyMassTarget,
      equilibriumKg: targetProjection.equilibriumKg,
    };
  }

  // No profile: the target can't be projected at all, so fall back to what the LOGGED
  // behaviour of the last 14 days implies instead.
  const recentEntries = entries.filter((e) => e.date >= cutoffIso && e.date <= todayIso);

  const caloriesByDate = new Map();
  const activityKcalByDate = new Map();
  const sleepByDate = new Map();

  recentEntries.forEach((e) => {
    if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
      const kcal = activityEntryKcal(e, latestBodyMassKg(entries));
      activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
    } else if (e.category === 'Sleep' && e.amount !== null) {
      sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
    }
  });

  let slope;
  let method;
  // The exponential model's coefficients; null means project as a straight line.
  let decay = null;

  if (caloriesByDate.size > 0 || activityKcalByDate.size > 0) {
    const avgCalories = caloriesByDate.size > 0 ? avg(caloriesByDate) : calorieTarget;
    const avgActivityKcal = activityKcalByDate.size > 0 ? avg(activityKcalByDate) : 0;
    const avgSleep = sleepByDate.size > 0 ? avg(sleepByDate) : sleepTarget;

    // Negative balance = deficit = loss. Against MAINTENANCE, not calorieTarget: the
    // target is already maintenance minus the target deficit, so eating exactly it
    // produced a ~zero balance and a "no net change" forecast — precisely when the
    // target loss should have been delivered. Same shape as the target's own basis,
    // differing only in the activity figure: logged burn here, target burn there.
    const resting = restingMaintenanceKcal(entries);
    const maintenance = resting !== null
      ? resting + avgActivityKcal
      // No profile, so no BMR and no calculated target — the flat CALORIE_TARGET_KCAL
      // the user chose directly is the best baseline available.
      : calorieTarget + avgActivityKcal;

    const balance = avgCalories - maintenance;
    const baseSlope = balance / GENERIC_KCAL_PER_KG_FAT;
    const sleepRatio = Math.min(1.0, Math.max(0.7, avgSleep / sleepTarget));
    slope = baseSlope * sleepRatio;

    // Maintenance is affine in body mass, not constant, so a fixed intake decays
    // exponentially toward the body mass where that intake IS maintenance. Both terms
    // scale with mass: BMR by its 10·m coefficient, logged burn because metKcal is
    // proportional to body mass. Needs a profile — without a BMR there's no A/B to split
    // maintenance into, so `decay` stays null and the straight line is used.
    if (resting !== null && lastBodyMass > 0) {
      const perKg = 10 + avgActivityKcal / lastBodyMass;
      const bodyMassIndependent = maintenance - perKg * lastBodyMass;
      decay = {
        perKg,
        // Sleep scales the rate, so it divides the energy density rather than entering
        // the equilibrium — same destination, different speed of arrival.
        kcalPerKg: GENERIC_KCAL_PER_KG_FAT / sleepRatio,
        equilibriumKg: (avgCalories - bodyMassIndependent) / perKg,
      };
    }

    // The formula scales by sleep, so a missing sleep log really is partial data.
    const allPresent = caloriesByDate.size > 0 && activityKcalByDate.size > 0 && sleepByDate.size > 0;
    method = allPresent ? 'full' : 'partial';
  } else {
    const src = bodyMassEntries.filter((e) => e.date >= cutoffIso);
    const data = src.length >= 2 ? src : bodyMassEntries;
    slope = linearRegressionSlope(data.map((_, i) => i), data.map((e) => e.amount));
    method = 'body-mass-only';
  }

  // Reported even with no forecast, so the ETA line can show the rate instead of a bare
  // "projection unavailable".
  if (slope === 0) return { status: 'no-change', method, slope };

  // lastBodyMass, not planMass: these methods' own slope/equilibrium above were fitted
  // from the actual latest reading (see resting/perKg/bodyMassIndependent), so the curve
  // has to start from the same point they describe. Only the 'target' method (returned
  // above already) is measured at m̄.
  const goingDown = arrivalTarget < lastBodyMass;
  if ((goingDown && slope > 0) || (!goingDown && slope < 0)) return { status: 'wrong-direction', method, slope };

  // A fixed intake only ever carries you to its own equilibrium, so a target on the far
  // side is never reached. The straight line always produced a date regardless, which
  // is what this status exists to report.
  if (decay !== null) {
    const gapNow = lastBodyMass - decay.equilibriumKg;
    const gapTarget = arrivalTarget - decay.equilibriumKg;
    if (gapTarget / gapNow <= 0) {
      return { status: 'asymptote', method, slope, equilibriumKg: decay.equilibriumKg };
    }
  }

  // The straight line's division, or the closed form t = (ρ/B)·ln[(m − m∞)/(m_g − m∞)].
  const daysToTarget = decay !== null
    ? Math.round((decay.kcalPerKg / decay.perKg)
      * Math.log((lastBodyMass - decay.equilibriumKg) / (arrivalTarget - decay.equilibriumKg)))
    : Math.round((arrivalTarget - lastBodyMass) / slope);
  const etaDate = new Date(today);
  etaDate.setDate(today.getDate() + daysToTarget);

  // m(t) = m∞ + (m − m∞)·e^(−B·t/ρ) for the curve, m + slope·t for the line.
  const bodyMassAtDay = (d) => (decay !== null
    ? decay.equilibriumKg + (lastBodyMass - decay.equilibriumKg) * Math.exp(-(decay.perKg * d) / decay.kcalPerKg)
    : lastBodyMass + slope * d);

  const cappedDays = Math.min(daysToTarget, 365);
  const projectedPoints = [];
  for (let d = 0; d <= cappedDays; d += 7) {
    const pd = new Date(today);
    pd.setDate(today.getDate() + d);
    projectedPoints.push({ date: isoFromDate(pd), bodyMass: Math.round(bodyMassAtDay(d) * 10) / 10 });
  }
  if (daysToTarget <= 365) {
    projectedPoints.push({ date: isoFromDate(etaDate), bodyMass: Math.round(arrivalTarget * 10) / 10 });
  }

  return {
    status: 'ok',
    slope,
    daysToTarget,
    etaDate,
    projectedPoints,
    method,
    bodyMassTarget,
    equilibriumKg: decay !== null ? decay.equilibriumKg : null,
  };
}

function renderWellnessProjectionChart(entries) {
  const ctx = document.getElementById('wellness-projection-chart');
  if (wellnessProjectionChart) wellnessProjectionChart.destroy();

  const meterWrap = document.getElementById('body-mass-progress-meter');
  const meterFill = document.getElementById('body-mass-progress-meter-fill');
  const meterCallout = document.getElementById('body-mass-progress-meter-callout');
  const meterDone = document.getElementById('body-mass-progress-meter-done');
  const meterRemaining = document.getElementById('body-mass-progress-meter-remaining');
  const meterTarget = document.getElementById('body-mass-progress-meter-target');
  const timeWrap = document.getElementById('time-progress-meter');
  const timeFill = document.getElementById('time-progress-meter-fill');
  const timeElapsed = document.getElementById('time-progress-meter-elapsed');
  const timeRemaining = document.getElementById('time-progress-meter-remaining');
  const timeEta = document.getElementById('time-progress-meter-eta');
  const etaEl = document.getElementById('body-mass-projection-eta');
  const plateauNote = document.getElementById('body-mass-plateau-note');
  meterWrap.hidden = true;
  meterCallout.textContent = '';
  meterCallout.classList.remove('danger');
  meterDone.textContent = '';
  meterRemaining.textContent = '';
  meterTarget.textContent = '';
  meterRemaining.classList.remove('danger');
  timeWrap.hidden = true;
  timeElapsed.textContent = '';
  timeRemaining.textContent = '';
  timeEta.textContent = '';
  etaEl.textContent = '';
  plateauNote.textContent = '';
  plateauNote.classList.remove('warning');

  const bodyMassEntries = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bodyMassEntries.length < 2) return;

  const startBodyMass = bodyMassEntries[0].amount;
  const lastBodyMass = bodyMassEntries[bodyMassEntries.length - 1].amount;

  const proj = calcProjection(entries);
  if (!proj) return;

  // First logged body mass to target, shown whatever the trajectory status — "wrong
  // direction" is worth seeing, just in the danger colour. Both readouts are kg so the
  // pair compares directly; the percentage still drives the bar's width.
  const bodyMassTarget = getSetting('BODY_MASS_TARGET_KG', BODY_MASS_TARGET_KG_DEFAULT);
  const totalDelta = startBodyMass - bodyMassTarget;
  if (Math.abs(totalDelta) >= 0.1) {
    const pct = Math.max(0, Math.min(100, ((startBodyMass - lastBodyMass) / totalDelta) * 100));
    const doneKg = Math.round(Math.abs(startBodyMass - lastBodyMass) * 10) / 10;
    const remainingKg = Math.round(Math.abs(lastBodyMass - bodyMassTarget) * 10) / 10;
    const isWrongDirection = proj.status === 'wrong-direction';

    meterWrap.hidden = false;
    meterFill.style.width = `${pct}%`;
    meterFill.classList.toggle('danger', isWrongDirection);

    // Same edge the fill stops at, so the bubble reads as "you are here" rather
    // than a second, disagreeing marker.
    meterCallout.style.left = `${pct}%`;
    const currentText = `${lastBodyMass} kg`;
    meterCallout.textContent = privacyMode ? maskDigits(currentText) : currentText;
    meterCallout.classList.toggle('danger', isWrongDirection);

    const doneText = `${doneKg} kg`;
    meterDone.textContent = privacyMode ? maskDigits(doneText) : doneText;

    const remainingText = `${remainingKg} kg`;
    meterRemaining.textContent = privacyMode ? maskDigits(remainingText) : remainingText;
    meterRemaining.classList.toggle('danger', isWrongDirection);

    // The swing (see glycogenSwingKg) alongside the target itself — the target line is a
    // single number, but any reading within this band of it is glycogen and water, not a
    // real miss, the same margin State Trend & Forecast's own zone and arrival math use.
    const targetSwingKg = glycogenSwingKg(lastBodyMass, getSetting('HEIGHT_CM', null), getSettingString('SEX', null));
    const targetText = targetSwingKg === null
      ? `→ ${bodyMassTarget} kg`
      : `→ ${bodyMassTarget} kg ± ${Math.round(targetSwingKg * 10) / 10} kg`;
    meterTarget.textContent = privacyMode ? maskDigits(targetText) : targetText;
  }

  // An undrawable projection drops only the projected SEGMENT. It used to `return`
  // here, but the chart is destroyed at the top of this function, so the panel went
  // blank and took the history, trend and target lines with it — none of which depend on
  // a projection. The status line says why, and the rate keeps it concrete.
  const rateNote = () => {
    const kgPerWeek = Math.abs(proj.slope * 7).toFixed(2);
    const direction = proj.slope > 0 ? 'gaining' : 'losing';
    return `${direction} ~${kgPerWeek} kg/week`;
  };
  const statusNote = {
    reached: () => 'Target reached! 🎉',
    'no-change': () => 'No net change at current habits',
    'wrong-direction': () => `Current habits trend away from target — ${rateNote()}, so no arrival date can be projected`,
    // Right direction, but it decays to zero before the target: the intake these habits
    // average IS maintenance at that body mass.
    asymptote: () => `Currently ${rateNote()}, but these habits level off around ${Math.round(proj.equilibriumKg * 10) / 10} kg — the target isn't reachable without changing them`,
  }[proj.status];
  if (statusNote) {
    const note = statusNote();
    etaEl.textContent = privacyMode ? maskDigits(note) : note;
  }

  const hasProjection = proj.status === 'ok';
  const projPoints = hasProjection ? proj.projectedPoints : [];

  // The same journey in time rather than kg: elapsed since the first weigh-in against
  // the forecast's remaining days. A long time bar beside a short body-mass bar is itself
  // the signal that progress is slower than the effort. Needs an arrival date.
  if (hasProjection) {
    // Re-parsed as UTC, so today sits on the same footing as every other date here.
    const todayMs = parseIsoDateUTC(isoFromDate(new Date()));
    const daysElapsed = Math.max(0, Math.round((todayMs - parseIsoDateUTC(bodyMassEntries[0].date)) / 86400000));
    const daysToGo = Math.max(0, proj.daysToTarget);
    const totalDays = daysElapsed + daysToGo;

    if (totalDays > 0) {
      const timePct = Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
      timeWrap.hidden = false;
      timeFill.style.width = `${timePct}%`;

      const elapsedText = `${daysElapsed} ${daysElapsed === 1 ? 'day' : 'days'}`;
      timeElapsed.textContent = privacyMode ? maskDigits(elapsedText) : elapsedText;

      const toGoText = `${daysToGo} ${daysToGo === 1 ? 'day' : 'days'}`;
      timeRemaining.textContent = privacyMode ? maskDigits(toGoText) : toGoText;

      const etaText = `→ ${isoFromDate(proj.etaDate)}`;
      timeEta.textContent = privacyMode ? maskDigits(etaText) : etaText;
    }
  }

  const histLabels = bodyMassEntries.map((e) => e.date);
  const projLabels = projPoints.map((p) => p.date);
  const allLabels = [...new Set([...histLabels, ...projLabels])].sort();

  const projMap = new Map(projPoints.map((p) => [p.date, p.bodyMass]));
  const lastDate = histLabels[histLabels.length - 1];

  // Same-day weigh-ins are averaged before smoothing, rather than letting whichever
  // came last silently win.
  const bodyMassSumsByDate = new Map();
  bodyMassEntries.forEach((e) => {
    const cur = bodyMassSumsByDate.get(e.date) || { sum: 0, count: 0 };
    cur.sum += e.amount;
    cur.count += 1;
    bodyMassSumsByDate.set(e.date, cur);
  });
  const bodyMassByDate = new Map([...bodyMassSumsByDate].map(([d, { sum, count }]) => [d, sum / count]));

  // Read here, ahead of the trend, so the zone band below can be positioned against it.
  const heightCm = getSetting('HEIGHT_CM', null);
  const sex = getSettingString('SEX', null);
  const swingKg = glycogenSwingKg(lastBodyMass, heightCm, sex);
  const trendMap = computeBodyMassTrend(bodyMassByDate);
  const zoneAnchorMap = swingKg === null ? null : computeGlycogenZoneAnchor(trendMap);

  // The body-mass trajectory implied by logged calories alone: start at the first
  // weigh-in, then walk forward a day at a time adding that day's calorie balance
  // (intake minus BMR, activity and TEF) converted to kg via GENERIC_KCAL_PER_KG_FAT —
  // the same balance Calorie Balance itself scores. A day with nothing logged carries
  // the running total forward flat rather than guessing. Needs a profile for BMR, same
  // as that chart. Set against the smoothed trend line, the gap between the two is what
  // the calorie math alone can't explain — water, glycogen, or a logging gap.
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');
  const calorieTrendMap = new Map();
  if (haveProfile) {
    const calorieTrendDates = datesInRange(bodyMassEntries[0].date, lastDate);
    const calorieBodyMassForDate = carryForwardBodyMassByDate(bodyMassByDate, calorieTrendDates);

    const intakeByDate = new Map();
    const tefByDate = new Map();
    const activityKcalByDate = new Map();
    entries.forEach((e) => {
      if (e.amount === null) return;
      if (e.category === 'Calories' || e.category === 'Calories; Protein') {
        intakeByDate.set(e.date, (intakeByDate.get(e.date) || 0) + e.amount);
        // This day's own measured TEF (Physique column L) where calculated —
        // same measured-over-estimated precedence Calorie Balance gives it.
        if (e.tefKcal !== null && e.tefKcal !== undefined) {
          tefByDate.set(e.date, (tefByDate.get(e.date) || 0) + e.tefKcal);
        }
      } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
        const kcal = activityEntryKcal(e, calorieBodyMassForDate.get(e.date) ?? null);
        activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
      }
    });

    let running = startBodyMass;
    calorieTrendDates.forEach((d) => {
      calorieTrendMap.set(d, running);
      if (!intakeByDate.has(d)) return;
      const intake = intakeByDate.get(d);
      const maintenance = bmrKcal(calorieBodyMassForDate.get(d), heightCm, age, sex);
      const activity = activityKcalByDate.get(d) || 0;
      const tef = tefByDate.has(d) ? tefByDate.get(d) : intake * (1 - tefDivisor());
      const balance = intake - maintenance - activity - tef;
      running += balance / GENERIC_KCAL_PER_KG_FAT;
    });
  }

  const plateauDays = detectPlateau(trendMap);
  if (plateauDays) {
    const plateauLine = `⚠️ Body mass trend has been flat for ~${plateauDays} days — consider adjusting your calorie limit`;
    plateauNote.textContent = privacyMode ? maskDigits(plateauLine) : plateauLine;
    plateauNote.classList.add('warning');
  }

  // Daily history then weekly projected points must NOT sit on equal category ticks,
  // which would imply every gap is the same length. A true linear day-offset axis makes
  // a week gap 7x the width of a one-day gap.
  const firstDateMs = parseIsoDateUTC(allLabels[0]);
  const dayOffset = (dateStr) => Math.round((parseIsoDateUTC(dateStr) - firstDateMs) / 86400000);
  const offsetToDateLabel = (offset) =>
    new Date(firstDateMs + offset * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // No raw per-reading series: Body Mass already plots every reading, this is the trend.
  const datasets = [
    // The zone anchor ± the glycogen/water swing — a band the trend line can wander
    // inside without it being a real change. Tension matches the trend line's own
    // curve — the anchor is an EMA (see computeGlycogenZoneAnchor), so it's already a
    // continuous, slower-moving line, not a stepped one. Two line datasets rather than
    // one: Chart.js fills the area BETWEEN a dataset and the one its `fill` points at,
    // so the zone needs both edges plotted, just invisibly (borderWidth 0). Omitted
    // whenever the swing can't be estimated (no height/sex on file) rather than drawn
    // at 0, which would claim glycogen accounts for nothing.
    ...(zoneAnchorMap !== null ? [
      {
        label: 'Glycogen + Water Swing (upper)',
        data: allLabels.map((d) => {
          const a = zoneAnchorMap.get(d);
          return { x: dayOffset(d), y: a === undefined ? null : a + swingKg };
        }),
        borderWidth: 0,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
        spanGaps: false,
        isSwingBand: true,
        order: 5,
      },
      {
        label: 'Glycogen + Water Swing',
        data: allLabels.map((d) => {
          const a = zoneAnchorMap.get(d);
          return { x: dayOffset(d), y: a === undefined ? null : a - swingKg };
        }),
        // The zone reads as "normal noise", not a target or a warning, so it takes the
        // app's neutral highlight rather than either of those colours.
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
        borderWidth: 0,
        pointRadius: 0,
        tension: 0.3,
        // Fills to the upper-bound dataset just above this one in the array.
        fill: '-1',
        spanGaps: false,
        isSwingBand: true,
        order: 5,
      },
    ] : []),
    {
      label: 'State Trend & Forecast',
      data: allLabels.map((d) => ({ x: dayOffset(d), y: trendMap.get(d) ?? null })),
      borderColor: '#16a34a',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      spanGaps: false,
      order: 4,
    },
    // Omitted without a profile — same guard as calorieTrendMap's own computation above.
    ...(haveProfile ? [{
      label: 'Calorie-Implied Trajectory',
      data: allLabels.map((d) => {
        const y = calorieTrendMap.get(d);
        return { x: dayOffset(d), y: y === undefined ? null : y };
      }),
      borderColor: '#9ca3af',
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 3,
    }] : []),
    // Omitted rather than plotted empty, so it can't sit in the legend claiming a
    // forecast exists.
    ...(hasProjection ? [{
      label: 'Projected',
      data: allLabels.map((d) => {
        let y = null;
        if (d === lastDate) y = lastBodyMass;
        else if (d > lastDate) y = projMap.get(d) ?? null;
        return { x: dayOffset(d), y };
      }),
      borderColor: '#6366f1',
      // The app's one dash pattern, at the width of the trend line it continues. At
      // Chart.js's default width 3 the forecast was the heaviest line on the chart
      // despite being the least certain thing on it.
      borderDash: [4, 4],
      borderWidth: 2,
      // Line only — a shaded area read as a quantity, when all this asserts is where
      // the trend goes.
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 2,
    }] : []),
    {
      // bodyMassTarget, not proj.bodyMassTarget — that's only set on an 'ok' projection, but
      // the target line is drawn either way.
      label: `${bodyMassTarget} kg Target`,
      data: allLabels.map((d) => ({ x: dayOffset(d), y: bodyMassTarget })),
      // Solid, like the section's hairline caps. It stays a continuous LINE rather than
      // caps because this chart has no columns: its x-axis is a linear time scale, so
      // there's nothing per-column for a mark to belong to.
      borderColor: targetMarkColor(),
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 1,
    },
  ];

  // Skipped without a height: BMI can't be computed, and an empty scale is worse than
  // none. There's no BMI LINE either — BMI is a fixed linear rescale of body mass, so it
  // would retrace the body-mass line pixel for pixel, and the y1 axis alone lets it be
  // read off that line. (heightCm itself was read earlier, ahead of the trend.)

  // Left to auto-range, Chart.js can pick a BMI span that doesn't correspond to the
  // body-mass span, so a point on the chart would read as the wrong BMI off the right axis.
  // Deriving y1's bounds from the same body-mass range keeps the two true parallel twins.
  //
  // Rounded to whole kg, not just padded: a fractional min/max breaks Chart.js's own
  // round-number tick algorithm, which is what produced the clean 1 kg gridlines.
  //
  // Raw weigh-ins are excluded since they're no longer plotted. lastBodyMass stays — the
  // projection starts from it. The swing band's own edges are included so the padded
  // axis can't clip the zone it's meant to fully show.
  const trendExtremes = zoneAnchorMap === null ? [] : [...zoneAnchorMap.values()].flatMap((v) => [v + swingKg, v - swingKg]);
  const bodyMassValues = [...trendMap.values(), ...projMap.values(), ...trendExtremes, ...calorieTrendMap.values(), lastBodyMass, bodyMassTarget]
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const bodyMassMin = Math.min(...bodyMassValues);
  const bodyMassMax = Math.max(...bodyMassValues);
  const bodyMassPad = Math.max(0.5, (bodyMassMax - bodyMassMin) * 0.08);

  // The target end gets no padding: nothing is ever plotted past it, so padding reserved
  // an empty band — a 70 kg target floored to 68. Still floor/ceil'd to whole kg, since
  // the ticks step by 1 from these bounds. Only when the target really is the extreme; a
  // reading that overshoots it pads normally, because then something IS drawn beyond.
  const yMin = bodyMassMin < bodyMassTarget
    ? Math.floor(bodyMassMin - bodyMassPad)
    : Math.floor(bodyMassTarget);
  const yMax = bodyMassMax > bodyMassTarget
    ? Math.ceil(bodyMassMax + bodyMassPad)
    : Math.ceil(bodyMassTarget);

  const scales = {
    x: {
      type: 'linear',
      // min = max, so the labels hold a fixed 45° like the rest of the section instead
      // of Chart.js straightening them whenever they happen to fit — which made this
      // axis flip angle on resize.
      ticks: { maxTicksLimit: 24, maxRotation: 45, minRotation: 45, autoSkip: true, callback: offsetToDateLabel },
    },
    y: {
      min: yMin,
      max: yMax,
      afterFit: fixTrendYAxisWidth,
      // Pinned: once min/max are explicit (needed to lock the BMI axis to this range),
      // Chart.js's auto step-size stopped producing the clean 1 kg steps.
      ticks: { stepSize: 1, callback: maskedUnitTick('kg') },
    },
  };
  if (heightCm !== null) {
    scales.y1 = {
      // Exact, not rounded — that's what keeps this a true pixel-for-pixel twin.
      min: computeBmi(yMin, heightCm),
      max: computeBmi(yMax, heightCm),
      position: 'right',
      afterFit: fixTrendYAxisWidth,
      grid: { drawOnChartArea: false },
      ticks: {
        stepSize: 1,
        // Otherwise Chart.js forces the exact min/max on as extra labels off the step
        // grid — 25.3/33.2 alongside an evenly-stepped 27, 28, 29.
        includeBounds: false,
        callback: maskedUnitTick('BMI', 1),
      },
    };
  }

  wellnessProjectionChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // Off, like the rest of the section: Chart.js draws it inside the canvas, so a
        // legend here left this plot area ~30px shorter. Series are named in the tooltip.
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales,
    },
  });

}

// The most recent weigh-in on or before each date, carried forward — a BMR is needed
// for every day in the window, not just the days a weigh-in lands on. Days before the
// first reading fall back to it rather than dropping off the chart.
function carryForwardBodyMassByDate(bodyMassByDate, dates) {
  const weighInDates = [...bodyMassByDate.keys()].sort();
  if (weighInDates.length === 0) return new Map();

  const carried = new Map();
  let next = 0;
  let current = bodyMassByDate.get(weighInDates[0]);
  dates.forEach((date) => {
    while (next < weighInDates.length && weighInDates[next] <= date) {
      current = bodyMassByDate.get(weighInDates[next]);
      next += 1;
    }
    carried.set(date, current);
  });
  return carried;
}

// Smallest half-span the axis scales to, so a run of all-deficit days still leaves a
// band above zero to read them against instead of pinning zero to the top.
const ENERGY_BALANCE_AXIS_MIN_KCAL = 200;

// Both bounds round out to a multiple of this, so every label sits on a gridline and
// the halves step identically. niceAxisBound's ladder could land on 800 and leave one
// odd tick among a run of 500s.
const ENERGY_BALANCE_TICK_KCAL = 250;

// The sign carries the whole meaning here — deficit vs surplus — so a positive figure
// shows its + rather than going bare.
function withExplicitSign(value) {
  return value > 0 ? `+${value}` : String(value);
}

let wellnessEnergyBalanceChart = null;

// Against the target line, not just the sign: at or beyond it on the day itself is a
// darker green — a proper hit, not just a near-miss. Short of it falls back to the
// week: a 7-day average that's still made the target reads as real progress despite
// the one off day (green), but an average that's ALSO short means the day isn't an
// outlier, it's the trend, so it reads red like the wrong-side-of-zero case. No target
// means no band to compare against, so it falls back to the sign alone.
function energyBalanceColor(balance, isCut, target, weeklyAvg) {
  const towardTarget = isCut ? balance < 0 : balance > 0;
  if (!towardTarget) return '#dc2626';
  if (target === null) return '#16a34a';
  if (isCut ? balance <= target : balance >= target) return '#166534';
  const weekOnTarget = weeklyAvg !== null && weeklyAvg !== undefined
    && (isCut ? weeklyAvg <= target : weeklyAvg >= target);
  return weekOnTarget ? '#16a34a' : '#dc2626';
}

// The daily deficit the weekly rate implies — the playground's D, from the same
// fat-density constant so the two can't disagree. Already signed to this chart's
// convention. Null at zero or unset, since a line on zero would retrace the axis.
//
// Takes a body mass because a pinned percentage makes the rate depend on it; unpinned the
// argument is ignored and this is the flat WEEKLY_FAT_LOSS_KG it always was.
function targetBalanceKcal(bodyMassKg) {
  const weeklyKg = weeklyFatLossKgAt(bodyMassKg);
  if (weeklyKg === null || weeklyKg === 0) return null;
  return -Math.round((weeklyKg * GENERIC_KCAL_PER_KG_FAT) / 7);
}

// Eaten minus spent per day, with the fat change that balance implies on a twin axis.
//
// Spend is Mifflin-St Jeor BMR at that day's carried-forward body mass PLUS its logged
// activity burn — no lifestyle multiplier, since logged activity is already real kcal
// and scaling BMR too would count the same movement twice. The calorie target is built
// the same way, so the two agree on any day activity hits the target.
//
// The COLOURS follow the target, not the sign — a deficit is only progress for someone
// heading down, so the app's green and red keep meaning "toward" and "away" rather than
// congratulating a bulker for undereating. Which side is progress comes from
// getCalorieTargetKind, the same read Caloric Intake uses. Within that side the target
// splits green from gray, so falling behind reads differently from going backwards.
//
// Grams is balance ÷ kcal-per-kg, a fixed linear rescale off two population constants,
// which is what makes the right axis a true twin of the left.
function renderWellnessEnergyBalanceChart(entries) {
  const ctx = document.getElementById('wellness-energy-balance-chart');

  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const intakeEntries = entries.filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null);

  // No profile means no maintenance figure, no weigh-in means no body mass to feed it.
  // Either way the chart shows its explanatory empty state, not a misleading partial.
  const canCompute = haveProfile && bodyMassEntries.length > 0;
  const labels = canCompute ? wellnessWindowDates(intakeEntries) : [];
  const bodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(bodyMassEntries), labels);

  const intakeByDate = new Map();
  intakeEntries.forEach((e) => intakeByDate.set(e.date, (intakeByDate.get(e.date) || 0) + e.amount));

  // This day's own measured TEF (Physique column L, via 🧬 Micronutrients on its
  // ingredients) where Physique has calculated one — falls back to the flat
  // TEF_PERCENT_OF_INTAKE estimate below on any day without one, same as before
  // this column existed.
  const tefByDate = new Map();
  intakeEntries.forEach((e) => {
    if (e.tefKcal !== null && e.tefKcal !== undefined) tefByDate.set(e.date, (tefByDate.get(e.date) || 0) + e.tefKcal);
  });

  // Through the one shared rule, at the same carried-forward body mass the BMR term uses.
  const activityKcalByDate = new Map();
  entries.forEach((e) => {
    if ((e.category !== 'Activity' && e.category !== 'Activity; Calories') || e.amount === null) return;
    const kcal = activityEntryKcal(e, bodyMassForDate.get(e.date) ?? null);
    activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
  });

  // Which side of zero is progress. Same read Caloric Intake's target is built on, so
  // the two charts can't disagree about which way the user is headed.
  const isCut = getCalorieTargetKind(entries) === 'max';

  const detailByDate = new Map();

  const balanceData = labels.map((date) => {
    // No food logged is no data, not a day of eating nothing — an empty slot rather
    // than a huge fake deficit.
    if (!intakeByDate.has(date)) return null;

    const intake = Math.round(intakeByDate.get(date));
    const maintenance = Math.round(bmrKcal(bodyMassForDate.get(date), heightCm, age, sex));
    const activity = Math.round(activityKcalByDate.get(date) || 0);
    // Digestion is an expenditure like the other two, so it comes off the same subtraction —
    // otherwise switching TEF on would raise the target intake here without also raising the
    // cost of eating it, and this chart would contradict the one that set the target. A share
    // of what was ACTUALLY eaten, not of the target: this row scores the day that happened.
    // Measured (tefByDate, from the day's own breakdown macros) wins over estimated
    // whenever Physique has calculated one for this day.
    const tefMeasured = tefByDate.has(date);
    const tef = Math.round(tefMeasured ? tefByDate.get(date) : intake * (1 - tefDivisor()));
    const balance = intake - maintenance - activity - tef;

    detailByDate.set(date, {
      intake, maintenance, activity, tef, tefMeasured, balance,
      massG: Math.round((balance / GENERIC_KCAL_PER_KG_FAT) * 1000),
    });
    return balance;
  });

  const values = balanceData.filter((v) => v !== null);
  const hasData = values.length > 0;

  // Folded into the axis range too, so the dashes can't fall off-plot on a stretch of
  // days that all undershot them.
  // At the smoothed body mass, since a pinned percentage makes the deficit a function of body
  // mass: one dashed line for the whole window, drawn at the rate the plan's mass implies.
  const target = hasData ? targetBalanceKcal(planBodyMassKg(entries)) : null;

  const maxDeficit = Math.max(0, ...values.map((v) => -v), target === null ? 0 : -target);
  const maxSurplus = Math.max(0, ...values, target === null ? 0 : target);
  const upToTick = (v) => Math.ceil(Math.max(v * 1.08, ENERGY_BALANCE_AXIS_MIN_KCAL) / ENERGY_BALANCE_TICK_KCAL)
    * ENERGY_BALANCE_TICK_KCAL;
  const yMin = -upToTick(maxDeficit);
  const yMax = upToTick(maxSurplus);

  // A fraction of the axis span, so the dash stays a hairline at any range.
  const targetHalf = (yMax - yMin) * 0.004;

  // balanceData already nulls the unlogged days, so they sit out of the mean.
  const weekColumns = bucketedColumnCount(labels);
  const weeklyAvg = weeklyAverageSeries(balanceData, weekColumns);

  wellnessEnergyBalanceChart = upsertChart(wellnessEnergyBalanceChart, ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Calorie balance',
          data: balanceData,
          backgroundColor: balanceData.map((v, i) => energyBalanceColor(v, isCut, target, weeklyAvg[i])),
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        // A dash per day, the idiom Caloric Intake uses for its own target: a continuous
        // line reads as one shared limit, a mark on each bar says the target belongs to
        // that day.
        ...(target === null ? [] : [{
          type: 'bar',
          label: 'Target for the day',
          data: labels.map(() => [target - targetHalf, target + targetHalf]),
          backgroundColor: targetMarkColor(),
          grouped: false,
          isTargetLine: true,
          // Lowest order paints last, so it stays visible on a bar that overshot it.
          order: 0,
        }]),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        title: {
          display: !hasData,
          text: canCompute
            ? 'No calories logged yet — log what you ate to see your daily balance'
            : 'Add Height, Birth Date, and Sex in Settings (and log a Body Mass) to estimate this',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: {
          // The dashes are filtered out — a floating bar would report itself as a
          // `[from, to]` pair — and stated in afterBody instead.
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // The chart IS the subtraction, so every term is spelled out — a bare
            // "-450" wouldn't show whether eating less or moving more produced it.
            label: (item) => {
              const d = detailByDate.get(item.label);
              if (!d) return '';
              // Last of the body rows, to sit beside the Target row its colour is
              // compared against. A day over maintenance reports a SURPLUS, since
              // calling it a deficit would contradict the + in front of it.
              const actualWord = d.balance > 0 ? 'Surplus' : 'Deficit';
              // "Actual Intake", the same name Caloric Intake and Protein Intake give
              // the figure in their own hovers — one day's eating shouldn't be called
              // three different things across three charts of the same panel.
              //
              // Maintenance and Activity are the two things SUBTRACTED from it, so
              // they're shown subtracted: the column reads top-down as the arithmetic
              // behind the bar (intake, less maintenance, less activity, giving the
              // balance) instead of three bare figures the reader has to remember the
              // signs of. Activity especially — kcal burned printed as a positive reads
              // as something ADDED to the day.
              const lines = [
                `Actual Intake: ${d.intake} kcal`,
                `Maintenance: ${withExplicitSign(-d.maintenance)} kcal`,
                `Activity: ${withExplicitSign(-d.activity)} kcal`,
                // Only when there IS one. At the default f = 0 the row would be a
                // permanent "-0", which reads as a term that failed to compute rather
                // than one deliberately left out of the model. Labelled "measured" when
                // it's this day's own Physique figure, "est." when it's the flat
                // TEF_PERCENT_OF_INTAKE fallback — the two can differ by a real amount,
                // so which one produced this bar shouldn't be left ambiguous.
                ...(d.tef > 0 ? [`Digestion (TEF, ${d.tefMeasured ? 'measured' : 'est.'}): ${withExplicitSign(-d.tef)} kcal`] : []),
                `Expected Fat: ${withExplicitSign(d.massG)} g`,
                `Actual ${actualWord}: ${withExplicitSign(d.balance)} kcal`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // The playground's D. Flush left via afterBody, and signed like everything
            // else here so it reads off the axis its dash is drawn on.
            afterBody: (items) => {
              const lines = [];
              if (target !== null) {
                const word = target < 0 ? 'Deficit' : 'Surplus';
                lines.push(`Target ${word}: ${withExplicitSign(target)} kcal/day`);
              }
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) {
                lines.push(`7-Day Average: ${withExplicitSign(Math.round(weeklyAvg[i]))} kcal`);
                const weeklyMassG = Math.round(((weeklyAvg[i] * 7) / GENERIC_KCAL_PER_KG_FAT) * 1000);
                lines.push(`7-Day Expected Fat: ${withExplicitSign(weeklyMassG)} g`);
              }
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: {
          min: yMin,
          max: yMax,
          afterFit: fixTrendYAxisWidth,
          // Zero is the line the chart is read against, so it takes the tick-label
          // colour instead of receding into the gridlines. Evaluated at draw time, so a
          // theme switch recolours it.
          grid: { color: (ctx) => (ctx.tick.value === 0 ? Chart.defaults.color : Chart.defaults.borderColor) },
          // autoSkip off, or Chart.js drops ticks it thinks are crowded and the spacing
          // goes uneven again.
          ticks: { stepSize: ENERGY_BALANCE_TICK_KCAL, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
        y1: {
          // The gram equivalent of y's own bounds, so zero lines up and every bar reads
          // off either side.
          min: (yMin / GENERIC_KCAL_PER_KG_FAT) * 1000,
          max: (yMax / GENERIC_KCAL_PER_KG_FAT) * 1000,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { includeBounds: false, callback: maskedUnitTick('g') },
        },
      },
    },
  });
}

// One body mass per logged date, same averaging as renderWellnessProjectionChart's.
function bodyMassByDateMap(bodyMassEntries) {
  const sums = new Map();
  bodyMassEntries.forEach((e) => {
    const cur = sums.get(e.date) || { sum: 0, count: 0 };
    cur.sum += e.amount;
    cur.count += 1;
    sums.set(e.date, cur);
  });
  return new Map([...sums].map(([date, { sum, count }]) => [date, sum / count]));
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values, avg) {
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function minutesToClock(mins) {
  const wrapped = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

// Chart.js has no distribution plot, so: equal-width bins across the values' own range,
// plus a normal curve at the same mean/stdev scaled to the tallest bar. The curve is a
// shape overlay, not a second count axis.
function buildDistribution(values, binCount, formatLabel) {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values) > min ? Math.max(...values) : min + 1;
  const avg = mean(values);
  const sd = stdDev(values, avg);
  const binWidth = (max - min) / binCount;

  const counts = new Array(binCount).fill(0);
  values.forEach((v) => {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / binWidth));
    counts[idx]++;
  });

  const labels = counts.map((_, i) => formatLabel(min + binWidth * (i + 0.5)));

  // Bars are a % of all days, not raw counts, so the curve scales to the same peak.
  const percentages = counts.map((c) => (c / values.length) * 100);

  const peakPercentage = Math.max(...percentages);
  const normalPdf = (x) => (sd ? (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - avg) ** 2) / (2 * sd ** 2)) : 0);
  const peakPdf = normalPdf(avg) || 1;
  const curve = counts.map((_, i) => (normalPdf(min + binWidth * (i + 0.5)) / peakPdf) * peakPercentage);

  return { labels, counts, percentages, curve };
}

// Shared across all 4 Work Pattern Analysis bar charts so bars look the same
// thickness regardless of how many bars/bins each one happens to have (the
// 3 histograms have 10 bins, the Average Hours per Day chart has 5).
const WORK_PATTERN_BAR_THICKNESS = 18;

// Fixed height for the x-axis label row on the same 4 charts, so their plot
// areas line up even though Average Hours per Day's labels ("Last Quarter",
// "Last Year"...) are longer than the histograms' clock-time/hour labels and
// would otherwise wrap or reserve more vertical space, shrinking its bars.
const WORK_PATTERN_X_AXIS_HEIGHT = 80;

function fixWorkPatternXAxisHeight(scale) {
  scale.height = WORK_PATTERN_X_AXIS_HEIGHT;
}

const distributionCharts = {};

function renderDistributionChart(canvasId, dist) {
  const ctx = document.getElementById(canvasId);
  if (distributionCharts[canvasId]) distributionCharts[canvasId].destroy();
  if (!dist) return;

  distributionCharts[canvasId] = new Chart(ctx, {
    data: {
      labels: dist.labels,
      datasets: [
        { type: 'bar', label: 'Days', data: dist.percentages, counts: dist.counts, backgroundColor: 'rgba(59, 130, 246, .5)', order: 2, maxBarThickness: WORK_PATTERN_BAR_THICKNESS },
        { type: 'line', label: 'Normal Distribution', data: dist.curve, borderColor: '#dc2626', pointRadius: 0, tension: .4, order: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.dataset.label === 'Days',
          callbacks: { label: (item) => `${item.dataset.counts[item.dataIndex]} day(s) (${item.raw.toFixed(1)}%)` },
        },
      },
      scales: {
        x: { afterFit: fixWorkPatternXAxisHeight },
        y: { beginAtZero: true, ticks: { callback: (value) => `${value}%` } },
      },
    },
  });
}

const STANDARD_WORKDAY_MINUTES = 8 * 60;

// Signed tally of (shift − 8h) over qualifying entries: a real Start/End, not today's
// possibly-unfinished shift, not a weekend, and a non-negative duration. A missed
// weekday is excluded rather than counted as −8h — no data isn't leaving early — and a
// weekend shift doesn't count either way, since no 8h baseline was expected there.
// `days` is a trailing window (lifelong if falsy), matching averageDailyHours.
function computeOvertimeMinutes(entries, days) {
  const todayIso = isoFromDate(new Date());
  const windowStartIso = days
    ? isoFromDate(new Date(new Date().setDate(new Date().getDate() - (days - 1))))
    : null;

  const qualifying = entries.filter((e) =>
    e.start && e.end && e.date !== todayIso && !isWeekend(e.date)
    && (!windowStartIso || e.date >= windowStartIso)
    && computeDurationMinutes(e.start, e.end, e.breakMinutes) >= 0
  );

  const minutes = qualifying.reduce(
    (sum, e) => sum + (computeDurationMinutes(e.start, e.end, e.breakMinutes) - STANDARD_WORKDAY_MINUTES),
    0
  );

  return { minutes, count: qualifying.length };
}

function renderTimesheetOvertimeSummary(entries) {
  const el = document.getElementById('timesheet-overtime-summary');
  el.textContent = '';
  el.classList.remove('warning');

  const total = computeOvertimeMinutes(entries, null);
  if (total.count === 0) return; // not enough logged full days yet — stay blank, same convention as .body-mass-eta

  const year = computeOvertimeMinutes(entries, 365);
  const month = computeOvertimeMinutes(entries, 30);
  const week = computeOvertimeMinutes(entries, 7);

  const icon = total.minutes > 0 ? '⏱️' : '✅';
  const headline = total.minutes > 0
    ? `${signedMinutesToHm(total.minutes)} beyond an 8h/day pace overall`
    : 'At or under an 8h/day pace overall';

  el.textContent = `${icon} ${headline} — Last Year ${signedMinutesToHm(year.minutes)} · Last Month ${signedMinutesToHm(month.minutes)} · Last Week ${signedMinutesToHm(week.minutes)}`;
  el.classList.toggle('warning', total.minutes > 0);
}

function renderTimesheetDistributionCharts(entries) {
  const today = isoFromDate(new Date());
  const worked = entries.filter((e) => e.start && e.end && e.date !== today);

  renderDistributionChart('timesheet-start-distribution-chart', buildDistribution(worked.map((e) => timeToMinutes(e.start)), 10, minutesToClock));
  renderDistributionChart('timesheet-end-distribution-chart', buildDistribution(worked.map((e) => timeToMinutes(e.end)), 10, minutesToClock));

  // Weekends aren't representative shifts, and a negative duration (end before start,
  // or a break longer than the shift) is mis-keyed. Both would skew the bins.
  const durations = worked
    .filter((e) => !isWeekend(e.date))
    .map((e) => computeDurationMinutes(e.start, e.end, e.breakMinutes) / 60)
    .filter((h) => h >= 0);
  renderDistributionChart('timesheet-duration-distribution-chart', buildDistribution(durations, 10, (h) => `${h.toFixed(1)}h`));
}

function isHolidayEntry(entry) {
  return !!entry && !entry.start && !entry.end && !!entry.task;
}

// Hours in the trailing window (or since the first entry) over the working days elapsed
// in it. Weekends and marked holidays leave both numerator and denominator, so they
// can't pull the average down; a weekday with no entry still counts as 0 hours, since
// that's a missed log rather than time off.
function averageDailyHours(entries, days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let windowStart;
  if (days) {
    windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - (days - 1));
  } else {
    if (entries.length === 0) return 0;
    windowStart = entries.reduce((min, e) => (dateFromIso(e.date) < min ? dateFromIso(e.date) : min), dateFromIso(entries[0].date));
  }

  const byDate = new Map(entries.map((e) => [e.date, e]));

  let totalMinutes = 0;
  let workingDays = 0;
  const cursor = new Date(windowStart);
  while (cursor < today) {
    const iso = isoFromDate(cursor);
    if (!isWeekend(iso)) {
      const entry = byDate.get(iso);
      if (!isHolidayEntry(entry)) {
        workingDays++;
        if (entry?.start && entry?.end) totalMinutes += computeDurationMinutes(entry.start, entry.end, entry.breakMinutes) || 0;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return workingDays ? totalMinutes / 60 / workingDays : 0;
}

let timesheetDailyAverageChart = null;

function renderTimesheetDailyAverageChart(entries) {
  const ctx = document.getElementById('timesheet-daily-average-chart');
  if (timesheetDailyAverageChart) timesheetDailyAverageChart.destroy();
  if (entries.length === 0) return;

  const periods = [
    { label: 'Last Week', days: 7 },
    { label: 'Last Month', days: 30 },
    { label: 'Last Quarter', days: 90 },
    { label: 'Last Year', days: 365 },
    { label: 'Lifelong', days: null },
  ];

  timesheetDailyAverageChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: periods.map((p) => p.label),
      datasets: [{ label: 'Avg Hours/Day', data: periods.map((p) => averageDailyHours(entries, p.days)), backgroundColor: '#3b82f6', maxBarThickness: WORK_PATTERN_BAR_THICKNESS }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.raw.toFixed(1)}h/day` } },
      },
      scales: {
        x: { afterFit: fixWorkPatternXAxisHeight, ticks: { maxRotation: 90, minRotation: 90 } },
        y: { beginAtZero: true },
      },
    },
  });
}

let savingsTrendChart = null;

function renderSavingsTrendChart(months) {
  const ctx = document.getElementById('savings-trend-chart');

  savingsTrendChart = upsertChart(savingsTrendChart, ctx, {
    type: 'line',
    data: {
      labels: months.map((m) => m.label),
      datasets: [{
        label: 'Cumulative Savings',
        data: months.map((m) => m.cumulative),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, .1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false, afterFit: fixTrendYAxisWidth, ticks: { callback: (value) => formatCurrency(value) } } },
    },
  });
}

// The country listed on each Travel row is where that border-crossing event
// happened ("Country, City") — only the part before the comma matters here.
function travelCountryName(countryCity) {
  return (countryCity || '').split(',')[0].trim();
}

// Date + Time as one instant, so a same-day round trip nets a real sub-day duration
// instead of rounding to 0 just because both events share a date. Midnight if Time is
// blank. timeToMinutes lives in timesheet.js — fine, since this only runs post-load.
function travelInstant(t) {
  const date = new Date(t.date);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = timeToMinutes(t.time) || 0;
  return date.getTime() + minutes * 60000;
}

// Travel is a log of Arrival/Departure events, not pre-computed stays. An Arrival opens
// a stay; the next Departure closes it — whatever country IT names, since a departure is
// always from wherever the stay was — and the difference is credited to the opening
// country. A trailing Arrival is an ongoing stay, credited up to today.
//
// The log starts at the first trip ever taken, so the years lived at home before it
// would be dropped. Given a birthDate, a leading Departure is treated as though an
// Arrival had opened a stay in that same country at birth.
function computeCountryDays(travelEntries, birthDate) {
  const totals = new Map();
  let openCountry = null;
  let openSince = null;

  const sorted = [...travelEntries].sort((a, b) => a.row - b.row);

  if (birthDate && sorted.length > 0 && sorted[0].type.toLowerCase() === 'departure') {
    const birth = new Date(birthDate);
    if (!Number.isNaN(birth.getTime())) {
      openCountry = travelCountryName(sorted[0].countryCity);
      openSince = birth.getTime();
    }
  }

  sorted.forEach((t) => {
    const instant = travelInstant(t);
    if (instant === null) return;

    if (t.type.toLowerCase() === 'departure') {
      if (openCountry) {
        const days = Math.max(0, (instant - openSince) / 86400000);
        totals.set(openCountry, (totals.get(openCountry) || 0) + days);
      }
      openCountry = null;
      openSince = null;
    } else {
      // Anything not "Departure" is treated as an Arrival (covers the
      // sheet's "Arival" spelling and any future correction of it).
      openCountry = travelCountryName(t.countryCity);
      openSince = instant;
    }
  });

  if (openCountry) {
    const days = Math.max(0, (Date.now() - openSince) / 86400000);
    totals.set(openCountry, (totals.get(openCountry) || 0) + days);
  }

  return [...totals.entries()]
    .map(([country, days]) => ({ country, days }))
    .filter((c) => c.country)
    .sort((a, b) => b.days - a.days);
}

function getVisitedCountries(travelEntries) {
  return [...new Set(travelEntries.map((t) => travelCountryName(t.countryCity)).filter(Boolean))];
}

function formatDuration(days) {
  if (days >= 365) return `${(days / 365).toFixed(1)} yrs`;
  if (days >= 1) return `${Math.round(days)} d`;
  return `${Math.round(days * 24)} hr`;
}

// Common English country names -> ISO 3166-1 alpha-2, used to build flag
// emoji. Not exhaustive of every territory (e.g. Hong Kong has no flag emoji
// of its own in most fonts) — countryFlagEmoji() below falls back to a globe
// for anything not listed here.
const COUNTRY_ISO2 = {
  Afghanistan: 'AF', Albania: 'AL', Algeria: 'DZ', Argentina: 'AR', Armenia: 'AM',
  Australia: 'AU', Austria: 'AT', Azerbaijan: 'AZ', Bahrain: 'BH', Bangladesh: 'BD',
  Belarus: 'BY', Belgium: 'BE', Bolivia: 'BO', Brazil: 'BR', Bulgaria: 'BG',
  Cambodia: 'KH', Cameroon: 'CM', Canada: 'CA', Chile: 'CL', China: 'CN',
  Colombia: 'CO', Croatia: 'HR', Cuba: 'CU', Cyprus: 'CY', Czechia: 'CZ',
  'Czech Republic': 'CZ', Denmark: 'DK', Ecuador: 'EC', Egypt: 'EG', Estonia: 'EE',
  Ethiopia: 'ET', Finland: 'FI', France: 'FR', Georgia: 'GE', Germany: 'DE',
  Ghana: 'GH', Greece: 'GR', 'Hong Kong': 'HK', Hungary: 'HU', Iceland: 'IS',
  India: 'IN', Indonesia: 'ID', Iran: 'IR', Iraq: 'IQ', Ireland: 'IE',
  Israel: 'IL', Italy: 'IT', Japan: 'JP', Jordan: 'JO', Kazakhstan: 'KZ',
  Kenya: 'KE', Kuwait: 'KW', Latvia: 'LV', Lebanon: 'LB', Lithuania: 'LT',
  Luxembourg: 'LU', Malaysia: 'MY', Malta: 'MT', Mexico: 'MX', Mongolia: 'MN',
  Morocco: 'MA', Nepal: 'NP', Netherlands: 'NL', 'New Zealand': 'NZ', Nigeria: 'NG',
  Norway: 'NO', Oman: 'OM', Pakistan: 'PK', Panama: 'PA', Peru: 'PE',
  Philippines: 'PH', Poland: 'PL', Portugal: 'PT', Qatar: 'QA', Romania: 'RO',
  Russia: 'RU', 'Saudi Arabia': 'SA', Serbia: 'RS', Singapore: 'SG', Slovakia: 'SK',
  Slovenia: 'SI', 'South Africa': 'ZA', 'South Korea': 'KR', Spain: 'ES', 'Sri Lanka': 'LK',
  Sweden: 'SE', Switzerland: 'CH', Syria: 'SY', Taiwan: 'TW', Thailand: 'TH',
  Tunisia: 'TN', Turkey: 'TR', Ukraine: 'UA', 'United Arab Emirates': 'AE',
  'United Kingdom': 'GB', 'United States': 'US', Uruguay: 'UY', Uzbekistan: 'UZ',
  Venezuela: 'VE', Vietnam: 'VN', Yemen: 'YE',
};

// Regional Indicator Symbol pair for an ISO2 code (e.g. "CA" -> 🇨🇦).
function flagFromIso2(iso2) {
  return [...iso2.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

function countryFlagEmoji(countryName) {
  const iso2 = COUNTRY_ISO2[countryName];
  return iso2 ? flagFromIso2(iso2) : '🌍';
}

function renderCountryDaysList(countryTotals) {
  const list = document.getElementById('travel-country-days-list');
  list.innerHTML = '';

  if (countryTotals.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No travel history yet.';
    list.appendChild(empty);
    return;
  }

  countryTotals.forEach((c) => {
    const item = document.createElement('li');
    item.className = 'country-tile';
    item.title = `${c.country} — ${formatDuration(c.days)}`;

    const flag = document.createElement('span');
    flag.className = 'country-tile-flag';
    flag.textContent = countryFlagEmoji(c.country);

    const duration = document.createElement('span');
    duration.className = 'country-tile-duration';
    duration.textContent = formatDuration(c.days);

    item.append(flag, duration);
    list.appendChild(item);
  });
}

let worldMapChart = null;
let worldTopologyPromise = null;

// Loaded once per page session and reused on every dashboard refresh —
// world-atlas's country borders don't change between refreshes, only which
// countries are "visited" does.
function loadWorldTopology() {
  if (!worldTopologyPromise) {
    worldTopologyPromise = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then((res) => res.json());
  }
  return worldTopologyPromise;
}

async function renderWorldMapChart(visitedCountries) {
  const canvas = document.getElementById('travel-world-map-chart');
  const topology = await loadWorldTopology();

  // A forceRefresh (or a second, near-simultaneous call) could have already
  // torn down/rebuilt this chart while the fetch above was in flight — bail
  // rather than destroy a chart instance created after this call started.
  if (canvas.dataset.rendering === 'stale') return;

  const countries = ChartGeo.topojson.feature(topology, topology.objects.countries).features;
  const visited = new Set(visitedCountries.map((c) => c.toLowerCase()));
  const dark = document.documentElement.dataset.theme === 'dark';
  const visitedColor = '#3b82f6';
  const unvisitedColor = dark ? '#334155' : '#e5e7eb';

  worldMapChart = upsertChart(worldMapChart, canvas, {
    type: 'choropleth',
    data: {
      labels: countries.map((f) => f.properties.name),
      datasets: [{
        label: 'Visited',
        outline: countries,
        data: countries.map((f) => ({
          feature: f,
          value: visited.has((f.properties.name || '').toLowerCase()) ? 1 : 0,
        })),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      showOutline: true,
      showGraticule: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => item.raw.feature.properties.name } },
      },
      scales: {
        projection: { axis: 'x', projection: 'equalEarth' },
        color: {
          axis: 'x',
          display: false,
          legend: { display: false },
          interpolate: (t) => (t >= 1 ? visitedColor : unvisitedColor),
        },
      },
    },
  });
}

