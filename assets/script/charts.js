// Chart.js reads these global defaults when each chart is constructed, so
// charts created after a theme switch automatically get legible axis/legend/
// grid colors without per-chart options.
function applyChartTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  Chart.defaults.color = dark ? '#94a3b8' : '#6b7280';
  Chart.defaults.borderColor = dark ? '#334155' : '#e5e7eb';

  // Masks numeric axis labels (e.g. dollar amounts) when privacy mode is
  // on. Reads privacyMode at call time, so toggling it later just requires
  // recreating the charts (loadDashboard already destroys/rebuilds them).
  Chart.defaults.scales.linear.ticks.callback = function (value) {
    const label = this.getLabelForValue(value);
    return privacyMode ? maskDigits(label) : label;
  };
}

// The colour every reference mark in Health Indicators is drawn in — the
// per-column caps and the State Trend goal line.
//
// Deliberately NOT red. Red is this app's "missed" score on bars and dots, so a
// limit drawn in the same red read as a failure rather than as the thing being
// measured against. Near-black on light, near-white on dark (matching
// --color-text), so it stays the strongest line on the chart either way.
// Called at render time, and every chart is destroyed and rebuilt on a theme
// switch (loadDashboard), so it always picks up the current theme.
function boundMarkColor() {
  return document.documentElement.dataset.theme === 'dark' ? '#e2e8f0' : '#1f2937';
}

// Fixed width for the y-axis label column on the three Trend charts, so
// their plot areas (and thus their y-axes) line up vertically even though
// each chart's values have a different number of digits.
const TREND_Y_AXIS_WIDTH = 64;

function fixTrendYAxisWidth(scale) {
  if (scale.width < TREND_Y_AXIS_WIDTH) scale.width = TREND_Y_AXIS_WIDTH;
}

// An invisible right-hand axis reserving the exact same TREND_Y_AXIS_WIDTH
// as a real right axis (State Trend & Forecast's BMI line, Body Mass's fat
// energy, Physical Activity's kcal) — so a chart with no real right axis
// still gets the same plot-area width and x-axis tick spacing as the two
// that do, instead of stretching further right and misaligning the date
// labels across the Health Indicators section. A fresh object per call since
// Chart.js's afterFit mutates the live scale instance it's handed, not this
// config object, but a factory avoids relying on that being safe forever.
function ghostRightAxis() {
  return {
    position: 'right',
    afterFit: fixTrendYAxisWidth,
    grid: { drawOnChartArea: false, drawTicks: false },
    border: { display: false },
    ticks: { display: false },
  };
}

// Mirror of the above, for a chart whose real axis sits on the RIGHT (Body Mass's
// kg scale). Without a left spacer its plot area would start further left than
// its neighbours' and misalign the date labels down the section.
function ghostLeftAxis() {
  return { ...ghostRightAxis(), position: 'left' };
}

// The Health Indicators section's one mark for "the figure that applies here" —
// a solid red hairline drawn as a floating bar (`[from, to]`) with
// `grouped: false`, so it overlays its own column rather than being placed
// beside it. Every chart in the section that has such a figure uses this, so the
// mark means the same thing and looks the same wherever it appears.
// `values` is one entry per column; null leaves that column unmarked.
function boundCapDataset(label, values, capHalf, extra = {}) {
  return {
    type: 'bar',
    label,
    data: values.map((v) => (v === null || v === undefined ? null : [v - capHalf, v + capHalf])),
    backgroundColor: boundMarkColor(),
    grouped: false,
    // Chart.js draws highest order first, so the lowest paints last and sits on
    // top — a cap is only useful if it's still visible on a column that overshot it.
    order: 0,
    ...extra,
  };
}

// Half-thickness for those caps: a fraction of the axis span rather than a fixed
// amount in the data's own units, so the mark stays a hairline whatever range the
// chart ends up covering.
function boundCapHalf(axisSpan) {
  return Math.abs(axisSpan) * 0.006;
}

// Violet — the app's existing "not a score" colour (the unscored burn dot). The
// section's neutral gray was tried first and disappeared: it's a mid-tone against
// both themes and it already means "unscored bar", so the dash read as noise.
const WEEKLY_AVG_COLOR = '#7c3aed';

// Counted back from the LAST column, which is always today (trailingDatesForCategory
// clips the start of the window, never the end) — so the most recent seven days are
// one whole bucket and only the oldest one can come up short.
function weeklyBucketIndex(i, count) {
  return Math.floor((count - 1 - i) / 7);
}

// Per column, the mean of the 7-day bucket it falls in. Nulls are days with nothing
// logged and are left out of the mean — the logged-days-only rule avg() already uses,
// so a missing log can't drag the average under a bound it was never measured against.
// A bucket with no logged day at all stays null.
function weeklyAverageSeries(values) {
  const buckets = new Map();
  values.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const b = weeklyBucketIndex(i, values.length);
    const acc = buckets.get(b) ?? { total: 0, n: 0 };
    buckets.set(b, { total: acc.total + v, n: acc.n + 1 });
  });
  return values.map((_, i) => {
    const acc = buckets.get(weeklyBucketIndex(i, values.length));
    return acc ? acc.total / acc.n : null;
  });
}

// Sibling of weeklyAverageSeries for a chart whose bars are an absolute LEVEL rather
// than a per-day quantity (Body Mass): a flat mean there says almost nothing, so each
// week gets the least-squares fit through its own readings instead, evaluated across
// all seven columns. Columns are consecutive calendar days, so the slope is per day.
//
// A week with one reading gets that reading and nothing else — a flat dash would claim
// the week didn't move, which isn't measured. A week with none gets nothing.
function weeklyTrendSeries(values) {
  const points = new Map();
  values.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const b = weeklyBucketIndex(i, values.length);
    if (!points.has(b)) points.set(b, { xs: [], ys: [] });
    points.get(b).xs.push(i);
    points.get(b).ys.push(v);
  });

  const fits = new Map();
  points.forEach((p, b) => {
    if (p.xs.length >= 2) fits.set(b, linearRegression(p.xs, p.ys));
  });

  const series = values.map((v, i) => {
    const fit = fits.get(weeklyBucketIndex(i, values.length));
    if (fit) return fit.slope * i + fit.intercept;
    return v === null || v === undefined ? null : v;
  });
  // Per column, so the tooltip can quote it without re-deriving the bucket. Stated per
  // WEEK, which is the figure worth acting on.
  const slopePerWeek = values.map((_, i) => {
    const fit = fits.get(weeklyBucketIndex(i, values.length));
    return fit ? fit.slope * 7 : null;
  });
  return { series, slopePerWeek };
}

// That series drawn as one dashed segment per week — flat for an average, sloped for a
// trend. The segment CROSSING a bucket boundary is painted transparent, so the weeks
// read as separate dashes instead of one line joined by vertical risers.
function weeklyAverageDataset(label, series, extra = {}) {
  // Off-the-end neighbours are never the same bucket — an out-of-range index can
  // otherwise land back on a real bucket number and hide a one-column week.
  const sameBucket = (a, b) => a >= 0 && b >= 0 && a < series.length && b < series.length
    && weeklyBucketIndex(a, series.length) === weeklyBucketIndex(b, series.length);
  const hasValue = (i) => series[i] !== null && series[i] !== undefined;
  const joined = (a, b) => sameBucket(a, b) && hasValue(a) && hasValue(b);
  return {
    type: 'line',
    label,
    data: series,
    borderColor: WEEKLY_AVG_COLOR,
    // Matched to the goal caps, which come out around 2px: their half-thickness is
    // a fraction of the axis span (0.004-0.006) against a 200-240px plot area.
    borderWidth: 2,
    borderDash: [6, 4],
    tension: 0,
    segment: {
      borderColor: (c) => (sameBucket(c.p0DataIndex, c.p1DataIndex) ? WEEKLY_AVG_COLOR : 'transparent'),
    },
    // A value with no drawable segment either side shows as a dot instead of
    // vanishing — the clipped one-column oldest bucket, or a Body Mass week holding a
    // single weigh-in. A neighbour is only drawable if it's in this bucket AND has a
    // value; same-bucket-but-null leaves nothing to draw a line to.
    pointRadius: (c) => (hasValue(c.dataIndex)
      && !joined(c.dataIndex, c.dataIndex - 1) && !joined(c.dataIndex, c.dataIndex + 1) ? 2 : 0),
    pointBackgroundColor: WEEKLY_AVG_COLOR,
    pointHitRadius: 0,
    isWeeklyAverage: true,
    // Between the bars (2) and the bound caps (0), so the cap stays the top mark.
    order: 1,
    ...extra,
  };
}

// Rounds a computed axis max up to the nearest "nice" number (1/2/5 times a
// power of ten, e.g. 4327 -> 5000) so explicit y-axis caps don't show an
// arbitrary value with no clean gridlines.
function niceAxisMax(value) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const residual = value / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

// Finer-grained niceAxisMax, for axes where its 1/2/5/10 ladder rounds up far
// enough to waste most of the plot area.
const NICE_AXIS_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceAxisBound(value) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const residual = value / magnitude;
  return (NICE_AXIS_STEPS.find((step) => residual <= step) ?? 10) * magnitude;
}

// Destroys `existingChart` if present, then constructs and returns a new
// Chart.js instance from `config` — only used where destroy and construct are
// unconditionally adjacent; render functions that skip construction on empty
// data (to still clear a stale chart) keep their own manual destroy instead.
function upsertChart(existingChart, ctx, config) {
  if (existingChart) existingChart.destroy();
  return new Chart(ctx, config);
}

let incomeExpenseChart = null;

function renderIncomeExpenseChart(months) {
  const ctx = document.getElementById('income-expense-chart');

  renderCategoryLegend('income-expense-legend', [
    { name: 'Income', color: '#16a34a' },
    { name: 'Expenses', color: '#dc2626' },
  ]);

  incomeExpenseChart = upsertChart(incomeExpenseChart, ctx, {
    type: 'line',
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        { label: 'Income', data: months.map((m) => m.income), borderColor: '#16a34a', backgroundColor: 'rgba(22, 163, 74, .4)', stepped: true, fill: true, pointRadius: 0 },
        { label: 'Expenses', data: months.map((m) => Math.abs(m.expenses)), borderColor: '#dc2626', backgroundColor: 'rgba(220, 38, 38, .4)', stepped: true, fill: true, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, afterFit: fixTrendYAxisWidth, ticks: { callback: (value) => formatCurrency(value) } } },
    },
  });
}

let expenseBreakdownTrendChart = null;

function renderExpenseBreakdownTrendChart(months) {
  const ctx = document.getElementById('expense-breakdown-trend-chart');
  if (expenseBreakdownTrendChart) expenseBreakdownTrendChart.destroy();
  if (months.length === 0) return;

  const categories = months[0].categories;

  renderCategoryLegend('expense-breakdown-trend-legend', categories);

  // Cap the y-axis at 1.2x the second-highest monthly total so a single
  // outlier month doesn't squash every other month's bars into a sliver.
  const totals = months.map((m) => m.categories.reduce((sum, c) => sum + c.value, 0));
  const sortedTotals = [...totals].sort((a, b) => b - a);
  const yMax = niceAxisMax((sortedTotals[1] ?? sortedTotals[0]) * 1.2);

  expenseBreakdownTrendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map((m) => m.label),
      datasets: categories.map((c) => ({
        label: c.name,
        data: months.map((m) => m.categories.find((mc) => mc.name === c.name)?.value || 0),
        backgroundColor: c.color,
      })),
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
}

let spendingTrendChart = null;

// Applies an opacity to an hsl(...) color string, e.g. so each of the 4
// period bars for a category shares its hue, distinguished by opacity (most
// recent = most opaque).
function hslWithAlpha(hsl, alpha) {
  return hsl.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

// Divisors that turn each period's total into a monthly average. Lifelong
// has no fixed divisor here — it's divided by the actual number of months
// of data (passed into renderSpendingTrendChart) since the dashboard went
// live.
const SPENDING_TREND_PERIODS = [
  { key: 'lastMonth', label: 'Last Month', alpha: 1, months: 1 },
  { key: 'quarterAvg', label: 'Last Quarter', alpha: 0.7, months: 3 },
  { key: 'yearAvg', label: 'Last Year', alpha: 0.45, months: 12 },
  { key: 'lifelongAvg', label: 'Lifelong', alpha: 0.25, months: null },
];

// Renders a category-color swatch legend, shared by several panels (e.g. the
// Spending by Category bar chart + donuts).
function renderCategoryLegend(containerId, categories) {
  const legend = document.getElementById(containerId);
  legend.innerHTML = '';
  categories.forEach((c) => {
    const item = document.createElement('span');
    item.className = 'donut-legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'donut-legend-swatch';
    swatch.style.backgroundColor = c.color;

    item.append(swatch, document.createTextNode(c.name));
    legend.appendChild(item);
  });
}

function renderSpendingTrendChart(categories, totalMonths) {
  const ctx = document.getElementById('spending-trend-chart');
  if (spendingTrendChart) spendingTrendChart.destroy();

  renderCategoryLegend('spending-trend-legend', categories);
  if (categories.length === 0) return;

  spendingTrendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories.map((c) => c.name),
      datasets: SPENDING_TREND_PERIODS.map((p) => ({
        label: p.label,
        data: categories.map((c) => c[p.key] / (p.months || totalMonths || 1)),
        backgroundColor: categories.map((c) => hslWithAlpha(c.color, p.alpha)),
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // Clicking a legend entry normally toggles that dataset's visibility —
        // keep all 4 period bars always visible and ignore legend clicks.
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

// Builds the DOM for one category's panel (heading + 4 period donuts +
// legend) from scratch, so the set of panels reflects whatever categories
// the Insight tab actually defines rather than a hardcoded list.
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

// One donut per category per period, each showing that category's Types as
// a share of its overall total for that period. Only categories with at
// least one named Type get a panel — categories Insight tracks as a single
// total (no Type breakdown) wouldn't have anything to show. The gap between
// the category total (Insight's blank-Type row) and the sum of its named
// Types becomes an "Untyped" slice.
function renderTypeBreakdownCharts(typeBreakdown) {
  // Order panels by absolute lifelong spend (highest first) so the
  // biggest-impact categories surface at the top of the section, regardless
  // of sign.
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

    // Sort once by absolute lifelong spend (largest first) so the legend and
    // every period's donut share the same slice order and colors, regardless
    // of sign (e.g. a type that nets to refunds still ranks by its size).
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

// Nested doughnut: inner ring = totals per account type (shaded by type),
// middle ring = totals per institution (each institution has one fixed
// color, even if its accounts span multiple types), outer ring = each
// individual account (shaded by its institution's color). Slice sizes use
// the absolute balance so debt accounts (negative balances) still render as
// a normal positive-size slice rather than breaking the chart.
function renderAccountCompositionChart(accounts) {
  const ctx = document.getElementById('account-composition-chart');
  if (accountCompositionChart) accountCompositionChart.destroy();
  if (accounts.length === 0) return;

  const byType = new Map();
  accounts.forEach((a) => {
    const type = a.type || 'Other';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(a);
  });

  const typeAbsTotals = new Map();
  byType.forEach((group, type) => {
    typeAbsTotals.set(type, group.reduce((sum, acc) => sum + Math.abs(acc.balance), 0));
  });

  // Largest absolute balance first, so the inner ring (and its legend) ranks
  // account types by overall size regardless of sign — debt accounts with a
  // large negative balance still rank near the top. Types with a zero
  // absolute total (e.g. accounts that net to zero) are dropped so they
  // don't show up as an empty legend entry.
  const types = [...byType.keys()]
    .filter((type) => typeAbsTotals.get(type) > 0)
    .sort((a, b) => typeAbsTotals.get(b) - typeAbsTotals.get(a));

  // Evenly-spaced hues around the color wheel so every entry gets a distinct
  // color no matter how many there are, instead of cycling through (and
  // repeating) a fixed-size palette once the count exceeds it.
  const distinctColors = (count) => Array.from({ length: count }, (_, i) => `hsl(${Math.round((i * 360) / count)}, 65%, 55%)`);

  const typeColors = {};
  distinctColors(types.length).forEach((color, i) => { typeColors[types[i]] = color; });

  // One fixed color per institution (regardless of which type(s) its
  // accounts fall under), so every slice for that institution — and its
  // legend entry — always shows the same color instead of a per-type shade.
  const institutionAbsTotals = new Map();
  accounts.forEach((a) => {
    const institution = a.institution || 'Other';
    institutionAbsTotals.set(institution, (institutionAbsTotals.get(institution) || 0) + Math.abs(a.balance));
  });
  const institutionNames = [...institutionAbsTotals.keys()]
    .filter((name) => institutionAbsTotals.get(name) > 0)
    .sort((a, b) => institutionAbsTotals.get(b) - institutionAbsTotals.get(a));
  const institutionColorMap = {};
  distinctColors(institutionNames.length).forEach((color, i) => { institutionColorMap[institutionNames[i]] = color; });

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

    // Group this type's accounts by institution, largest institution first,
    // so the middle ring's slices line up with the outer ring's accounts.
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

  renderCategoryLegend('account-composition-legend', types.map((t) => ({ name: t, color: typeColors[t] })));

  // Second legend line for the middle ring: one entry per institution, using
  // its single fixed color (same color for that institution everywhere in
  // the chart, even if its accounts span multiple types), largest first.
  renderCategoryLegend('account-composition-institution-legend', institutionNames.map((name) => ({ name, color: institutionColorMap[name] })));

  // Indexed by datasetIndex (outer to inner: account, institution, type) so
  // the tooltip can look up the right name for whichever ring is hovered,
  // independent of how Chart.js handles the dataset config objects.
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
      // Without this, hovering one ring's segment also matches the elements
      // at the same dataIndex in the other two rings, producing 3 tooltip
      // lines for a single hover. 'point' mode limits it to the arc actually
      // under the cursor.
      interaction: { mode: 'point' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // Suppress the default title, which otherwise looks up
            // `data.labels` (the outer/account-ring names) by dataIndex —
            // a meaningless value for middle/inner-ring items.
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

// Fallback defaults used until the user adds a 'Settings' tab — identical
// to today's hardcoded values, so nothing changes for anyone who hasn't.
const WEIGHT_GOAL_KG_DEFAULT = 82;
const CALORIE_TARGET_KCAL_DEFAULT = 2000;
const SLEEP_TARGET_HOURS_DEFAULT = 8;
const ACTIVITY_TARGET_MIN_DEFAULT = 100;
const PROTEIN_TARGET_G_DEFAULT = 100;

// Intensity assumed for ACTIVITY_TARGET_MIN (3.0 walking, 3.5 general resistance
// work, 5.0 compound lifting, 6.0 swimming, 7.0 jogging). Same value as
// activity-estimator.js's EXERCISE_MET_DEFAULT, but written out: charts.js loads
// first, so referencing that const here would throw on its temporal dead zone.
const ACTIVITY_MET_FALLBACK = 3.5;

// Either key works — ACTIVITY_MET_DEFAULT is what's on the sheet in practice, so
// an already-filled row isn't ignored over a naming preference.
const ACTIVITY_MET_SETTING_KEYS = ['ACTIVITY_MET', 'ACTIVITY_MET_DEFAULT'];

function activityMet() {
  for (const key of ACTIVITY_MET_SETTING_KEYS) {
    const met = getSetting(key, null);
    if (met !== null) return met;
  }
  return ACTIVITY_MET_FALLBACK;
}

// Standard estimate for 1kg of body fat — the energy density the projection
// formula, getCalorieBoundKcal() below and the Calorie Balance chart all work
// from. A population constant, not a personal parameter.
const GENERIC_KCAL_PER_KG_FAT = 7700;

// Last-resort flat per-minute burn, used only when no weight is on file at all
// and the MET formula therefore can't be evaluated.
const GENERIC_KCAL_PER_ACTIVE_MIN = 5;

// ACSM form: 1 MET = 3.5 mL O₂/kg/min and a litre of O₂ releases ~5 kcal (200 mL
// per kcal), so 3.5/200 kcal per MET per kg per minute. Not the `MET × kg × hours`
// shorthand, which assumes 1 MET = 1 kcal/kg/hour and lands a flat 5% low.
const MET_ML_O2_PER_KG_MIN_DEFAULT = 3.5;
const ML_O2_PER_KCAL = 200;

// Only the mL-O₂ numerator is overridable (KCAL_PER_MET_KG_MIN in Settings, so
// the Formula Playground can save a different one); the /200 is fixed, since it's
// oxygen's energy yield rather than anything personal.
function kcalPerMetKgMin() {
  return getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT) / ML_O2_PER_KCAL;
}

// The app's only MET→kcal conversion, so the bound's assumed activity burn and
// Calculate's measured one (activity-estimator.js) can't disagree.
function metKcal(met, weightKg, minutes) {
  return met * weightKg * minutes * kcalPerMetKgMin();
}

function latestWeightKg(entries) {
  const weightEntries = entries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return weightEntries.length ? weightEntries[weightEntries.length - 1].amount : null;
}

// Accepted ways of writing the g/kg band in one Settings cell: `1.6-2`,
// `1.6~2`, `1.6 – 2`, `1.6 to 2`. A bare `1.6` is still valid and simply
// means a band with the same figure at both ends.
const G_PER_KG_BAND_SEPARATOR = /\s*(?:~|-|–|—|to)\s*/i;

// The `1.6-2`-style single cell, parsed to {low, high} — null if it's absent
// or holds nothing numeric. A bare `1.6` yields low === high.
function parseGPerKgRangeCell() {
  const raw = getSettingString('PROTEIN_TARGET_G_PER_KG', null);
  if (raw === null) return null;

  const parts = String(raw).trim().split(G_PER_KG_BAND_SEPARATOR)
    .map(Number)
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (parts.length === 0) return null;

  return { low: parts[0], high: parts[parts.length - 1] };
}

// The protein target's g-per-kg band as {low, high} — null if none of the
// three keys yields a usable figure, which sends getProteinTargetBandG() to
// the flat PROTEIN_TARGET_G fallback. Either style of entry works, whichever
// reads better in the Settings tab: the band in one cell
// (PROTEIN_TARGET_G_PER_KG = `1.6-2`), or one end per row
// (PROTEIN_TARGET_G_PER_KG_MIN = `1.6`, PROTEIN_TARGET_G_PER_KG_MAX = `2`).
// The explicit _MIN/_MAX rows win per-end over the range cell, so either can
// be overridden on its own. Whatever survives is sorted, so a band entered
// backwards is still read as a band rather than an empty one.
function getProteinGPerKgBand() {
  const cell = parseGPerKgRangeCell();
  const ends = [
    getSetting('PROTEIN_TARGET_G_PER_KG_MIN', null) ?? cell?.low ?? null,
    getSetting('PROTEIN_TARGET_G_PER_KG_MAX', null) ?? cell?.high ?? null,
  ].filter((n) => n !== null);

  if (ends.length === 0) return null;
  return { low: Math.min(...ends), high: Math.max(...ends) };
}

// Protein's target is a BAND of grams per day rather than a single number,
// because the evidence behind it is a range (e.g. 1.6–2.0 g/kg), not a point.
// The band is that g/kg range applied to your GOAL weight (WEIGHT_GOAL_KG) —
// not today's weight — since the point of the protein floor is to support the
// body you're heading for; scaling it off current weight would quietly shrink
// the target with every kg lost, exactly when protein matters most. Falls back
// to the most recently logged weight if no goal is set, and finally to the flat
// PROTEIN_TARGET_G (as a zero-width band) if no per-kg band is set at all, so
// an existing flat-gram setup keeps behaving exactly as before.
function getProteinTargetBandG(entries) {
  const band = getProteinGPerKgBand();
  const basisWeightKg = band !== null
    ? (getSetting('WEIGHT_GOAL_KG', null) ?? latestWeightKg(entries))
    : null;

  if (basisWeightKg !== null) {
    return { min: Math.round(basisWeightKg * band.low), max: Math.round(basisWeightKg * band.high) };
  }

  const flat = getSetting('PROTEIN_TARGET_G', PROTEIN_TARGET_G_DEFAULT);
  return { min: flat, max: flat };
}

// Midpoint of the band, for the places that structurally need ONE number
// rather than a range — Protein Source Rotation's per-ingredient share of the
// daily target.
function getProteinTargetG(entries) {
  const { min, max } = getProteinTargetBandG(entries);
  return Math.round((min + max) / 2);
}

// "131" for a zero-width band, "131~164" otherwise — the one place the band's
// display form is decided, so the glance tile and the Insight prompt can't
// drift apart. The separator is a parameter because the two callers want
// different ones: '~' reads as "to" on the tile, while the Insight prompt
// passes a plain '-' rather than sending an unusual character to the AI.
function formatProteinTargetBand(band, separator = '~') {
  return band.max > band.min ? `${band.min}${separator}${band.max}` : `${band.min}`;
}

// Did a day's protein land INSIDE the band? Under the floor and over the top
// end are both misses, since the band's upper end is a real ceiling rather than
// headroom. A zero-width band (flat PROTEIN_TARGET_G, no per-kg range set) has
// no inside to land in, so it keeps the plain at-or-over rule it always had.
// Shared by the glance tile and the Protein Intake chart's bar colors so the
// two can't score the same day differently.
function withinProteinBand(g, band) {
  return g >= band.min && (band.max === band.min || g <= band.max);
}

// Mifflin-St Jeor resting/basal metabolic rate (kcal/day) — the cost of staying
// alive before any movement. All three maintenance figures here are BMR plus an
// activity burn, no lifestyle multiplier: the calorie bound adds what
// ACTIVITY_TARGET_MIN implies, the forecast and the Calorie Balance chart add
// logged burn. One formula, so they can't measure deficits against different
// baselines.
function mifflinStJeorBmr(weightKg, heightCm, age, sex) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

// Resting maintenance (kcal/day) from the profile settings and the most
// recently logged weight — null if any input is missing. Deliberately the same
// Mifflin-St Jeor basis the Calorie Balance chart applies per-day,
// so calcProjection and that chart measure a deficit against the SAME baseline
// instead of two different ones. Excludes activity: callers add whatever
// activity figure is appropriate for their own window (see both call sites).
function restingMaintenanceKcal(entries) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const weightKg = latestWeightKg(entries);

  if (heightCm === null || age === null || (sex !== 'male' && sex !== 'female') || weightKg === null) return null;
  return mifflinStJeorBmr(weightKg, heightCm, age, sex);
}

// How far under the day's implied burn still reads as "basically on target" — the
// Physical Activity dot goes gray rather than red inside this margin. Same 5% the
// Caloric Intake bars use (CALORIE_BOUND_NEAR_FRACTION), kept separate because the
// two score different things.
const ACTIVITY_NEAR_TARGET_FRACTION = 0.05;

// The kcal/day ACTIVITY_TARGET_MIN implies at `weightKg`. Gross, not net of
// resting — matching the Calorie Balance chart, which also adds gross activity
// kcal to plain BMR, so both maintenance figures stay the same number.
function activityTargetKcal(weightKg) {
  return metKcal(activityMet(), weightKg, getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT));
}

// One Activity entry's calorie burn — the single rule every activity kcal figure
// in the app goes through. Its own Calculate-derived amount2 wins when present
// (that used the real per-exercise MET); otherwise the entry's minutes are costed
// at ACTIVITY_MET and the given weight.
function activityEntryKcal(entry, weightKg) {
  if (entry.amount2 !== null) return entry.amount2;
  const mins = toActivityMinutes(entry.amount, entry.unit);
  return weightKg != null ? metKcal(activityMet(), weightKg, mins) : mins * GENERIC_KCAL_PER_ACTIVE_MIN;
}

// The calculated bound for ONE weight (kcal/day): Mifflin-St Jeor BMR + the burn
// ACTIVITY_TARGET_MIN implies − the deficit that hits WEEKLY_FAT_LOSS_KG at 7,700
// kcal/kg. No lifestyle multiplier: this used to scale BMR by ACTIVITY_MULTIPLIER
// while the forecast and Calorie Balance chart used BMR + activity, so the app
// held two different maintenance figures.
//
// The trade, since no label carries it: BMR + target activity omits food's thermic
// effect and incidental NEAT, landing near 1.29 × BMR, so a former 1.55-multiplier
// user loses ~475 kcal/day of ceiling. WEEKLY_FAT_LOSS_KG is the dial for that.
//
// Weight is an argument, not the latest weigh-in, because both terms scale with it
// and the Caloric Intake chart evaluates per day (calorieBoundSeries). Returns
// null when an input is missing — the caller falls back to CALORIE_TARGET_KCAL.
// ACTIVITY_MET/ACTIVITY_TARGET_MIN have defaults, so unlike the multiplier they
// replaced, neither absence can cause that fallback.
function calorieBoundDetail(weightKg) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const weeklyFatLossKg = getSetting('WEEKLY_FAT_LOSS_KG', null);

  const haveAllInputs = weightKg !== null && heightCm !== null && age !== null
    && (sex === 'male' || sex === 'female') && weeklyFatLossKg !== null;
  if (!haveAllInputs) return null;

  const bmr = mifflinStJeorBmr(weightKg, heightCm, age, sex);
  const activityKcal = activityTargetKcal(weightKg);

  // The setting being converted is WEEKLY_FAT_LOSS_KG — a fat goal — so turning
  // it into a daily deficit needs adipose tissue's energy density, which is a
  // population constant rather than anything measurable off a scale. A negative
  // value (a lean bulk) makes this a surplus and lifts the bound above
  // maintenance, which is what flips it from a ceiling to a floor.
  //
  // No plausibility guard on the result: a bound that looks aggressive means
  // WEEKLY_FAT_LOSS_KG itself is aggressive — the user's own setting to make,
  // and there would be nothing to substitute anyway.
  const kcal = Math.round(bmr + activityKcal - (weeklyFatLossKg * GENERIC_KCAL_PER_KG_FAT) / 7);

  return { kcal, bmr, activityKcal, weeklyFatLossKg };
}

function calculatedCalorieBoundKcal(weightKg) {
  const detail = calorieBoundDetail(weightKg);
  return detail === null ? null : detail.kcal;
}

function flatCalorieBoundKcal() {
  return getSetting('CALORIE_TARGET_KCAL', CALORIE_TARGET_KCAL_DEFAULT);
}

// TODAY's bound in kcal — the calculated figure at the most recent weigh-in, or
// the flat CALORIE_TARGET_KCAL setting when the profile can't produce one. This
// is the single-figure form, for the places that need one number for right now
// (the Calories glance tile, the Insight prompt).
//
// This is only the FIGURE. Which side of it to be on is getCalorieBoundKind()
// below — every label goes through getCalorieBound() so the two travel
// together.
function getCalorieBoundKcal(entries) {
  return calculatedCalorieBoundKcal(latestWeightKg(entries)) ?? flatCalorieBoundKcal();
}

// The bound evaluated for every day on the Caloric Intake chart's x-axis, each
// from the weight in effect THAT day (most recent weigh-in on or before it,
// carried forward — the same read the Calorie Balance chart uses
// for its per-day BMR) rather than from today's weight applied backwards across
// the whole window.
//
// The bound is a function of weight through both its terms — ~10 kcal/kg from the
// BMR and ~5.8 kcal/kg from the activity burn at default MET and target, so a 6 kg
// loss moves a calculated maximum by roughly 95 kcal — so a single flat line
// judged the first day of a 12-week window against the body you have now, marking
// days red that were comfortably inside the maximum that actually applied when you
// ate them. Each entry carries
// the weight it came from so the tooltip can show why the figure moved; weightKg
// is null on the flat-setting fallback, which has no weight basis at all and
// stays a genuinely flat line.
function calorieBoundSeries(entries, dates) {
  const weightEntries = entries.filter((e) => e.category === 'Weight' && e.amount !== null);
  const weightForDate = carryForwardWeightByDate(weightByDateMap(weightEntries), dates);
  const flat = flatCalorieBoundKcal();

  return dates.map((date) => {
    const weightKg = weightForDate.get(date) ?? null;
    const kcal = calculatedCalorieBoundKcal(weightKg);
    return kcal === null ? { kcal: flat, weightKg: null } : { kcal, weightKg };
  });
}

// There is no "target" daily intake in this app — the figure above is a BOUND,
// and which bound it is follows the direction of the goal. Someone heading DOWN
// in weight has to eat at MOST that many calories (a ceiling); someone heading
// UP has to eat at LEAST that many (a floor). Eating 400 kcal under a bulk's
// figure is not a good day, and neither is eating 400 over a cut's, so calling
// both of them "target" told half the users the exact opposite of the truth.
//
// Direction comes from goal weight vs. the latest weigh-in, which is the user's
// intent in its plainest form. With no goal, no weigh-in, or a goal already
// reached (same 0.1 kg tolerance calcProjection() treats as "there"), the sign
// of WEEKLY_FAT_LOSS_KG decides instead — negative is a lean bulk, so a floor.
// Neither available keeps the ceiling, matching the at-or-under rule the
// Calories tile has always applied.
function getCalorieBoundKind(entries) {
  const goalKg = getSetting('WEIGHT_GOAL_KG', null);
  const currentKg = latestWeightKg(entries);

  if (goalKg !== null && currentKg !== null && Math.abs(goalKg - currentKg) >= 0.1) {
    return goalKg < currentKg ? 'max' : 'min';
  }

  const weeklyFatLossKg = getSetting('WEEKLY_FAT_LOSS_KG', null);
  return (weeklyFatLossKg !== null && weeklyFatLossKg < 0) ? 'min' : 'max';
}

// The bound as one object — the kcal figure, which bound it is, and the display
// forms the labels need ('max' inline, 'Max' leading a heading, 'Maximum' as a
// tooltip field name) — so the glance tile, the Caloric Intake chart and the
// Insight prompt can't drift into describing the same number two different ways.
function getCalorieBound(entries) {
  const kind = getCalorieBoundKind(entries);
  return {
    kcal: getCalorieBoundKcal(entries),
    kind,
    isMax: kind === 'max',
    word: kind === 'max' ? 'Max' : 'Min',
    full: kind === 'max' ? 'Maximum' : 'Minimum',
  };
}

// Is a day's intake on the right side of the bound? At-or-under a ceiling,
// at-or-over a floor — hitting it exactly counts as met either way.
function withinCalorieBound(kcal, bound) {
  return bound.isMax ? kcal <= bound.kcal : kcal >= bound.kcal;
}

// How far past the bound still reads as "basically on target". Inside this margin
// the day is neither scored nor condemned — a few percent is within the noise of
// the estimate and of the log itself.
const CALORIE_BOUND_NEAR_FRACTION = 0.05;

// Three-way score for a day's intake: 'met' on the right side of the bound, 'near'
// when it's past it by no more than CALORIE_BOUND_NEAR_FRACTION, 'missed' beyond
// that. The wrong-side distance is measured the same way for a ceiling and a floor,
// so a bulk's under-eating grades exactly like a cut's over-eating.
function calorieBoundScore(kcal, bound) {
  if (withinCalorieBound(kcal, bound)) return 'met';
  return Math.abs(kcal - bound.kcal) <= bound.kcal * CALORIE_BOUND_NEAR_FRACTION ? 'near' : 'missed';
}

// A day's signed distance from its bound (kcal), for the Caloric Intake tooltip's
// Variance line — positive above the figure, negative below it, whichever of
// those two the goal happens to want.
function calorieBoundVariance(kcal, boundKcal) {
  return Math.round(kcal - boundKcal);
}

// Number of trailing days shown in each Health Indicators chart (Body Mass,
// Caloric Intake, Protein Intake, Physical Activity, Rest & Recovery). Body
// Mass appears here as well as in the State Trend & Forecast chart above
// without duplicating it: that one is the trajectory (trend, goal, forecast),
// this one scores each individual day's move as toward or away from the goal.
// These charts are full-width (one per row)
// rather than 4-across, so 84 days (12 weeks) fits comfortably; each render
// function's x-axis already thins tick labels (autoSkip/maxTicksLimit), so
// no other change is needed to keep them readable at this range.
const WELLNESS_METRICS_DAYS = 84;

let wellnessCaloriesChart = null;
let wellnessSleepChart = null;
let wellnessActivityChart = null;
let wellnessProteinChart = null;
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

// Every ISO date from fromIso to toIso inclusive, ascending. Empty if either
// date is missing/unparseable or fromIso is after toIso — callers treat that
// the same as "no data in range" rather than special-casing it.
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

// Wires up a From/To date-range picker (two <input type="date">) shared by
// any panel that lets the user pick an arbitrary custom range instead of a
// fixed N-day lookback (Health Insight, Protein Source Rotation, ...) —
// one implementation instead of each panel re-deriving its own defaulting
// and listener wiring. Defaults both inputs to the last defaultDays days
// (today inclusive) the first time they're empty, fires onChange on every
// edit, and returns a getter for the current {from, to} value.
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
  renderWellnessWeightChart(entries);
  renderWellnessCaloriesChart(entries);
  renderWellnessSleepChart(entries);
  renderWellnessActivityChart(entries);
  renderWellnessProteinChart(entries);
  renderWellnessProjectionChart(entries);
  renderWellnessEnergyBalanceChart(entries);
}

// "Today at a glance" stat tiles above the 4 trend charts — the charts are
// good for a 14-day trend but bad for "am I on track right now," so this
// gives today's actual-vs-target for all four metrics in one glance instead
// of reading the rightmost bar of four separate charts. Reuses the same
// .card/.value/.income/.expense styling as the main dashboard's summary cards.
function renderTodayGlanceCards(entries) {
  const todayIso = isoFromDate(new Date());

  let calories = null;
  let protein = null;
  let activityMins = null;
  let sleepHours = null;

  entries
    .filter((e) => e.date === todayIso)
    .forEach((e) => {
      if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
        calories = (calories ?? 0) + e.amount;
      }
      if (e.category === 'Calories; Protein' && e.amount2 !== null) {
        protein = (protein ?? 0) + e.amount2;
      }
      if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
        activityMins = (activityMins ?? 0) + toActivityMinutes(e.amount, e.unit);
      }
      if (e.category === 'Sleep' && e.amount !== null) {
        sleepHours = (sleepHours ?? 0) + e.amount;
      }
    });
  if (sleepHours !== null) sleepHours = Math.round(sleepHours * 10) / 10;

  const calorieBound = getCalorieBound(entries);
  const proteinBand = getProteinTargetBandG(entries);
  const activityTarget = getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT);
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  // The Calories tile's own heading carries which bound its figure is, because
  // the number alone can't say it and the value line has no room: "Max Calories"
  // on a cut, "Min Calories" on a bulk. Digit-free, so privacy mode has nothing
  // to hide here. The four tiles are all today's figures (last night's, for
  // Sleep) — the panel they sit in says so, so the headings don't repeat it.
  document.getElementById('today-calories-label').textContent = `${calorieBound.word} Calory Intake`;

  // Which direction is "good" differs per metric: for Calories it's whichever
  // side of the bound the goal points to (at/under a max, at/over a min);
  // at/over target is the win for Activity/Sleep. Protein is judged against a
  // RANGE (withinProteinBand above) — inside the band only.
  const proteinInBand = protein !== null && withinProteinBand(protein, proteinBand);

  // What hitting the minutes target would burn — the same figure the calorie
  // bound is built from (activityTargetKcal), so the tile and the bound can't
  // quote different numbers for the same plan. Needs a weigh-in; without one
  // the tile just reads as it did before.
  const weightKg = latestWeightKg(entries);
  const plannedBurn = weightKg !== null ? `${Math.round(activityTargetKcal(weightKg))} kcal` : null;

  setTodayGlanceTile('today-calories', calories, calorieBound.kcal, 'kcal', calories !== null && withinCalorieBound(calories, calorieBound));
  setTodayGlanceTile('today-protein', protein, formatProteinTargetBand(proteinBand), 'g', proteinInBand);
  setTodayGlanceTile('today-activity', activityMins, activityTarget, 'min', activityMins !== null && activityMins >= activityTarget, plannedBurn);
  setTodayGlanceTile('today-sleep', sleepHours, sleepTarget, 'hr', sleepHours !== null && sleepHours >= sleepTarget);
}

// `target` is a number for the single-figure metrics and a preformatted
// string ("131~164") for Protein's band — both interpolate identically, and
// maskDigits masks either the same way.
// `note` restates the target in a second unit ("= 394 kcal"). Part of the same
// string rather than its own styled element, so the whole line reads at one
// size and masks as one thing.
function setTodayGlanceTile(idPrefix, value, target, unit, isGood, note = null) {
  const el = document.getElementById(`${idPrefix}-value`);
  el.classList.remove('income', 'expense');

  const text = `${value !== null ? value : '—'} / ${target} ${unit}${note !== null ? ` = ${note}` : ''}`;
  el.textContent = privacyMode ? maskDigits(text) : text;
  if (value !== null) el.classList.add(isGood ? 'income' : 'expense');
}

// Health Tracker charts show plain physical units (kcal/hr/min/kg), not
// dollars, so they never pass through formatCurrency's masking — but
// they're still personal health data the privacy toggle should hide just
// the same. These wrap a plain "${value} unit" tick/tooltip formatter so
// both the axis and the tooltip (which would otherwise leak the exact
// number on hover even with masked ticks) get masked identically.
// decimals: null (default) just strips float noise without forcing trailing
// zeros — right for the whole-number-ish charts (kcal/min/g). Pass a number
// (e.g. 2 for BMI) to always show exactly that many decimal places instead.
function maskedUnitTick(unit, decimals = null) {
  return (v) => {
    // Chart.js generates its own evenly-spaced tick values by repeated
    // addition of a step size, which drifts into float noise (e.g.
    // 32.400000000000006) on fractional-step axes like BMI — round before
    // display so that noise never reaches the label.
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

// Clipped version of lastNDates(maxDays) — starts at the earliest matching
// entry instead of always padding out to a fixed trailing window, so a
// shorter logging history isn't visually pushed to the right with empty
// days on the left. Mirrors how the Weight Trend & Forecast chart's x-axis
// above already starts at its own first logged entry (weightEntries[0].date)
// rather than a fixed lookback.
function trailingDatesForCategory(matchingEntries, maxDays) {
  const capped = lastNDates(maxDays);
  if (matchingEntries.length === 0) return capped;
  const earliest = matchingEntries.reduce((min, e) => (e.date < min ? e.date : min), matchingEntries[0].date);
  const from = earliest > capped[0] ? earliest : capped[0];
  return capped.filter((d) => d >= from);
}

// Formats an ISO 'YYYY-MM-DD' label as e.g. "Jun 29" — the same short style
// the Weight Trend & Forecast chart's x-axis already uses (offsetToDateLabel
// below), instead of the raw ISO string a category-scale axis shows by
// default.
function formatIsoDateShort(iso) {
  return new Date(parseIsoDateUTC(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Category-scale tick callback: `value` is the tick's index, not the label
// itself, so getLabelForValue() resolves it back to the ISO string first.
function shortDateTickCallback(value) {
  return formatIsoDateShort(this.getLabelForValue(value));
}

// The Calories/Calories; Protein rows the Caloric Intake chart is built from.
function calorieLogEntries(entries) {
  return entries.filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null);
}

// The x-axis the Caloric Intake chart and the Body Weight chart directly above
// it BOTH plot on — the trailing window clipped to the first day calories were
// logged. The weight chart deliberately does NOT run trailingDatesForCategory
// over the weight log the way every other metric chart does over its own
// category: the two are read as a stacked pair (was the scale moving the right
// way on the days I stayed inside my bound?), and a weight log that starts on a
// different day than the calorie log would slide one chart's dates out of line
// with the other's.
function wellnessCalorieChartDates(entries) {
  return trailingDatesForCategory(calorieLogEntries(entries), WELLNESS_METRICS_DAYS);
}

let wellnessWeightChart = null;

// Neutral gray for a bar that can't be scored: the first reading shown, with
// nothing before it to compare against, or a stall too short to call yet. Green
// would claim progress that isn't measured; red, a setback that isn't either.
const WEIGHT_UNSCORED_COLOR = '#9ca3af';

// A stall only reads as a setback once it has held this many days. Under it the
// bar stays gray — one flat reading is scale noise, not a plateau.
const WEIGHT_STALL_RED_AFTER_DAYS = 2;

// Which way the scale has to move to count as progress — down on a cut, up on a
// bulk. Derived from getCalorieBoundKind rather than re-reading WEIGHT_GOAL_KG
// here, so this chart's green and the max/min bound of the Caloric Intake chart
// below it always come from one read of the goal, fallbacks included (an
// at-goal weight defers to the sign of WEEKLY_FAT_LOSS_KG, and downward when
// neither is set).
function weightGoalIsDownward(entries) {
  return getCalorieBoundKind(entries) === 'max';
}

// Is that day's weight already the goal weight? Same 0.1 kg tolerance
// getCalorieBoundKind and calcProjection treat as "there" — a scale reading is
// not going to land on the goal to the gram, and a figure that close is at it.
const WEIGHT_AT_GOAL_TOLERANCE_KG = 0.1;

function weightIsAtGoal(weightKg) {
  const goalKg = getSetting('WEIGHT_GOAL_KG', null);
  return goalKg !== null && weightKg !== null && Math.abs(goalKg - weightKg) < WEIGHT_AT_GOAL_TOLERANCE_KG;
}

// Is a day's change from the previous reading progress? null means unscored (gray):
// either nothing to compare against, or a stall that hasn't lasted long enough to
// judge.
//
// A day the scale held exactly still is judged by WHERE and for HOW LONG it held.
// Holding at the goal is what success looks like once you're there, so that stays
// green however long it lasts. Holding short of the goal is only called a miss once
// it has persisted WEIGHT_STALL_RED_AFTER_DAYS — a single flat reading is as likely
// to be scale noise as a real plateau, so it goes gray rather than red.
function weightChangeIsProgress(deltaKg, weightKg, goalIsDownward, stallDays) {
  if (deltaKg === null) return null;
  if (deltaKg === 0) {
    if (weightIsAtGoal(weightKg)) return true;
    return stallDays >= WEIGHT_STALL_RED_AFTER_DAYS ? false : null;
  }
  return (deltaKg < 0) === goalIsDownward;
}

// Deurenberg et al. 1991 (Br J Nutr) age/sex-specific body fat % from BMI alone —
// the app has no direct body-fat measurement (scale, calipers, DEXA) anywhere, so
// this is a population-average estimate at the same trust level as the USDA/AI
// calorie lookups.
function estimateBodyFatPercent(weightKg, heightCm, age, sex) {
  const bmi = weightKg / (heightCm / 100) ** 2;
  const sexTerm = sex === 'male' ? 1 : 0;
  return 1.20 * bmi + 0.23 * age - 10.8 * sexTerm - 5.4;
}

// Deurenberg's estimate held to a plausible range, so a nonsense BMI can't produce a
// nonsense figure downstream. Everything fat-related on this chart goes through it,
// so the percentage shown and the axis derived from it can't disagree.
function clampedBodyFatPercent(weightKg, heightCm, age, sex) {
  return Math.max(3, Math.min(60, estimateBodyFatPercent(weightKg, heightCm, age, sex)));
}

// Estimated fat mass (kg) at `weightKg` — that clamped share of it.
function estimatedFatMassKg(weightKg, heightCm, age, sex) {
  return weightKg * (clampedBodyFatPercent(weightKg, heightCm, age, sex) / 100);
}

// Energy stored in that fat mass, costed at fat's ~7,700 kcal/kg.
function fatEnergyKcal(weightKg, heightCm, age, sex) {
  return estimatedFatMassKg(weightKg, heightCm, age, sex) * GENERIC_KCAL_PER_KG_FAT;
}

// Headroom above and below the plotted kg range, mirroring the `grace: '15%'` this
// axis used before it needed explicit bounds. The floor keeps a window of nearly
// identical readings from sitting flush against the top and bottom.
const WEIGHT_AXIS_PAD_FRACTION = 0.15;
const WEIGHT_AXIS_MIN_PAD_KG = 0.5;

// Gridline spacing for the kg scale, smallest first — the first one that keeps the
// count at or under WEIGHT_MAX_GRIDLINES wins, so every line lands on a round kg.
const WEIGHT_TICK_STEPS_KG = [0.5, 1, 2, 5, 10];
const WEIGHT_MAX_GRIDLINES = 8;

// Fat energy runs to six figures and the axis width is capped, so ticks read
// "175k kcal" rather than "175255 kcal".
function maskedThousandsTick(unit) {
  return (v) => {
    const label = `${Math.round(v / 1000)}k ${unit}`;
    return privacyMode ? maskDigits(label) : label;
  };
}

// Each day's reading as a bar, scored green/red by whether it moved toward the
// goal or away from it — the same pass/fail read the Caloric Intake chart below
// applies to a day's eating, on the same dates, so the two can be compared bar
// for bar. It shows no goal line of its own: State Trend & Forecast above
// already draws the goal, the trend, and the projection, and a goal several kg
// away would flatten the y-axis here into exactly the flat line that chart
// exists to smooth — this one is only about the day-to-day direction.
//
// The right axis restates the same bars as the energy stored in the fat mass each
// one implies (fatEnergyKcal), so a drop in kg can be read as the kcal of fat it
// represents. Because body fat % itself moves with BMI, that mapping is quadratic
// in mass while a Chart.js twin axis can only be linear — it's anchored at the two
// ends of the kg range, which over a typical window costs under 0.5% of the axis
// span (~9 g of fat) and about 2.8% across an unusually wide 13 kg one.
function renderWellnessWeightChart(entries) {
  const ctx = document.getElementById('wellness-weight-chart');

  const goalIsDownward = weightGoalIsDownward(entries);

  const weightEntries = entries.filter((e) => e.category === 'Weight' && e.amount !== null);
  const byDate = weightByDateMap(weightEntries);
  const dates = wellnessCalorieChartDates(entries);

  // Scored against the previous READING, not the previous calendar day, so
  // logging every third day still leaves every bar with something to be
  // compared against. That includes the leftmost bar, seeded from the most recent
  // weigh-in BEFORE the window rather than left unscored just because its
  // predecessor is off the left edge of the chart.
  // stallStartDate is the date the current run of identical readings began, so a
  // plateau that started before the window still counts its full length here.
  let previousKg = null;
  let stallStartDate = null;
  [...byDate.keys()].sort().forEach((d) => {
    if (d >= dates[0]) return;
    const kg = Math.round(byDate.get(d) * 100) / 100;
    if (previousKg === null || kg !== previousKg) stallStartDate = d;
    previousKg = kg;
  });

  // Read before the loop so each day's stored fat energy can be worked out as it
  // goes, for the tooltip.
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  const values = [];
  const barColors = [];
  const detailByDate = new Map();

  dates.forEach((d) => {
    if (!byDate.has(d)) {
      // No weigh-in: an empty slot, not a zero. Caloric Intake can plot a
      // missing log as a harmless zero-height bar, but 0 kg is an impossible
      // weight that would drag this chart's whole y-axis down to it.
      values.push(null);
      barColors.push(WEIGHT_UNSCORED_COLOR);
      return;
    }

    const kg = Math.round(byDate.get(d) * 100) / 100;
    const delta = previousKg === null ? null : Math.round((kg - previousKg) * 100) / 100;
    if (delta !== 0) stallStartDate = d;
    const stallDays = delta === 0
      ? Math.round((parseIsoDateUTC(d) - parseIsoDateUTC(stallStartDate)) / 86400000)
      : 0;
    const progress = weightChangeIsProgress(delta, kg, goalIsDownward, stallDays);

    // The change in STORED FAT ENERGY between the two readings, not the reading
    // costed at a flat 7,700 — the fat share of a kg moves with BMI, so the two
    // ends of the change are each converted at their own body mass.
    const fatKcal = haveProfile ? fatEnergyKcal(kg, heightCm, age, sex) : null;
    const fatDeltaKcal = (haveProfile && delta !== null)
      ? fatKcal - fatEnergyKcal(previousKg, heightCm, age, sex)
      : null;
    const bodyFatPct = haveProfile ? clampedBodyFatPercent(kg, heightCm, age, sex) : null;
    const fatMassKg = haveProfile ? estimatedFatMassKg(kg, heightCm, age, sex) : null;
    // BMI needs only height, so it survives a profile missing birth date or sex —
    // gating it on the full profile would hide a figure that is computable.
    const bmi = heightCm !== null ? computeBmi(kg, heightCm) : null;
    detailByDate.set(d, { delta, fatKcal, fatDeltaKcal, bodyFatPct, fatMassKg, bmi });

    values.push(kg);
    barColors.push(progress === null ? WEIGHT_UNSCORED_COLOR : (progress ? '#16a34a' : '#dc2626'));
    previousKg = kg;
  });

  // Sloped, not flat: a bar here is an absolute level, so the week's mean says little
  // and its direction says everything.
  const { series: trendSeries, slopePerWeek } = weeklyTrendSeries(values);

  // Explicit kg bounds instead of `grace`, because the fat-energy twin axis has to
  // be derived from them and Chart.js resolves `grace` too late to read here.
  // The trend is folded in as well — a fit extended to the week's edges can reach past
  // every reading in it, and a bound that ignored that would clip the dash.
  const logged = [...values, ...trendSeries].filter((v) => v !== null);
  const kgLo = logged.length ? Math.min(...logged) : 0;
  const kgHi = logged.length ? Math.max(...logged) : 0;
  const kgPad = Math.max((kgHi - kgLo) * WEIGHT_AXIS_PAD_FRACTION, WEIGHT_AXIS_MIN_PAD_KG);

  // Gridlines belong to the kg scale here, so both bounds are rounded out to a whole
  // step of it — otherwise the lines fall wherever the padded range happens to land
  // and you get labels like 86.5 with no line at 94. The step grows with the range so
  // a 15 kg window doesn't draw sixteen lines.
  const kgStep = WEIGHT_TICK_STEPS_KG.find((s) => (kgHi - kgLo + 2 * kgPad) / s <= WEIGHT_MAX_GRIDLINES)
    ?? WEIGHT_TICK_STEPS_KG[WEIGHT_TICK_STEPS_KG.length - 1];
  const yMin = Math.max(0, Math.floor((kgLo - kgPad) / kgStep) * kgStep);
  const yMax = Math.ceil((kgHi + kgPad) / kgStep) * kgStep;

  // The fat-energy axis needs the whole Mifflin/Deurenberg profile; without it (or
  // with nothing logged) the right side falls back to the invisible spacer so this
  // chart's plot area still lines up with its neighbours.
  const canShowFatEnergy = logged.length > 0 && haveProfile;

  wellnessWeightChart = upsertChart(wellnessWeightChart, ctx, {
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
        weeklyAverageDataset('7-Day Trend', trendSeries),
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
          filter: (item) => item.raw !== null && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const d = detailByDate.get(item.label) ?? {};
              const lines = [`Body Mass: ${item.parsed.y} kg`];
              // Measured against the previous READING, not "yesterday" — on an
              // every-third-day logging habit those aren't the same thing. Omitted on
              // the first bar, which has nothing before it to compare against.
              if (d.delta !== null && d.delta !== undefined) {
                lines.push(`Changed Mass: ${withExplicitSign(d.delta)} kg`);
              }
              // BMI first of the derived figures — it's a plain mass/height ratio, and
              // the body-fat estimate below is computed FROM it, so it reads in that
              // order. Unitless by definition, hence no unit on the row.
              if (d.bmi !== null && d.bmi !== undefined) lines.push(`BMI: ${d.bmi}`);
              // Composition before energy, since the energy figures are derived from
              // it. All three are estimates from BMI (Deurenberg) rather than anything
              // measured, and all three vanish together without the full profile.
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
            // The dash's own figure, flush left and last — the placement every chart in
            // the section gives its reference figures. Rate only; the rows above already
            // run to seven. Absent on a week with under two readings, which has no slope.
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
        // Fat energy on the LEFT, kg on the RIGHT. kg still owns the gridlines
        // though — it's the scale the bars are actually read against, and the only
        // one that can put every line on a round number, since fat energy is a
        // non-linear restatement of it. The bars stay on `y` (their default axis),
        // so only the sides move.
        y: {
          // The one metric chart here that must NOT begin at zero: a 0 kg
          // baseline puts every bar within a pixel or two of the same height and
          // hides the day-to-day movement this chart is entirely about. The padded
          // real range is used instead, so the lowest bar still has visible height
          // without the axis pretending to start at zero.
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
            // Twin of y, restated as stored fat energy — see the note above the
            // function for why this mapping is anchored at the ends rather than exact.
            position: 'left',
            min: fatEnergyKcal(yMin, heightCm, age, sex),
            max: fatEnergyKcal(yMax, heightCm, age, sex),
            afterFit: fixTrendYAxisWidth,
            // No lines of its own — kg draws them. Its own step is the kg step's
            // equivalent so each kcal label still sits on one of those lines, even
            // though the figures themselves can't also be round.
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

// Headroom left above and below the plotted range on the Caloric Intake y-axis,
// as a fraction of that range — with a floor, since a window whose days are all
// within a few kcal of each other would otherwise be padded by almost nothing and
// sit flush against the top and bottom of the plot area.
const CALORIE_AXIS_PAD_FRACTION = 0.15;
const CALORIE_AXIS_MIN_PAD_KCAL = 120;

// Rounding for those bounds, so a zoomed axis still lands on readable tick
// figures (1,650 rather than 1,663).
const CALORIE_AXIS_STEP_KCAL = 50;

// Coarser rounding for the one case where the BOUND still has to widen the axis
// (a bound sitting beyond everything logged in the window). A coarse step means
// the frame holds still across several hundred kcal of bound movement, so
// switching formulas moves the caps within a fixed frame for as long as possible
// instead of dragging the frame along with them.
const CALORIE_AXIS_BOUND_STEP_KCAL = 250;

// Bounds for the Caloric Intake y-axis, framed on what was LOGGED — every day
// with intake on it, padded out. Only logged days count: the zeros standing in for
// days with nothing logged would drag the floor back to zero and undo the zoom
// this exists for. Clamped at zero, so a window of genuinely small intakes just
// becomes the zero-based axis it always was rather than showing negative calories.
//
// The bound is deliberately NOT part of that frame. Padding the axis around the
// bound made the ruler move with the thing it measures: the bound shifts as
// weight (and the settings behind it) change, and an axis that re-padded itself
// around the new figure put the caps back in almost exactly the same pixels — a
// 278 kcal change landing 2 px from where it started, with the intake bars
// changing height instead. Framing on logged intake keeps the frame fixed while
// the bound moves across it, since what was eaten doesn't depend on the bound.
//
// The caps still can't be allowed off-plot, so the frame is WIDENED (never
// re-padded) to reach a cap that would otherwise fall outside it — that's the one
// case where the bound can still move the axis, and it only arises when the bound
// sits beyond everything logged in the window.
function calorieAxisBounds(loggedValues, boundValues) {
  const framing = loggedValues.length ? loggedValues : boundValues;
  const lo = Math.min(...framing);
  const hi = Math.max(...framing);
  const pad = Math.max(CALORIE_AXIS_MIN_PAD_KCAL, (hi - lo) * CALORIE_AXIS_PAD_FRACTION);

  const roundDown = (v, step) => Math.max(0, Math.floor(v / step) * step);
  const roundUp = (v, step) => Math.ceil(v / step) * step;

  return {
    min: Math.min(roundDown(lo - pad, CALORIE_AXIS_STEP_KCAL), roundDown(Math.min(...boundValues), CALORIE_AXIS_BOUND_STEP_KCAL)),
    max: Math.max(roundUp(hi + pad, CALORIE_AXIS_STEP_KCAL), roundUp(Math.max(...boundValues), CALORIE_AXIS_BOUND_STEP_KCAL)),
  };
}

function renderWellnessCaloriesChart(entries) {
  const ctx = document.getElementById('wellness-calories-chart');

  const bound = getCalorieBound(entries);

  const calorieEntries = calorieLogEntries(entries);
  const dates = wellnessCalorieChartDates(entries);
  const byDate = new Map();
  calorieEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  // The bound is re-evaluated for every day from the weight in effect that day
  // (calorieBoundSeries), so there is no single figure for this chart to draw:
  // each day has its own, marked on its own bar, and each day's bar is scored
  // against that one and no other.
  const boundByDay = calorieBoundSeries(entries, dates);
  const dayBound = (i) => ({ ...bound, kcal: boundByDay[i].kcal });

  // Bars are scored against their OWN day's figure in the app's own
  // income/expense colors rather than a flat amber — green on the right side of
  // the bound (at-or-under a max, at-or-over a min), gray when past it by under
  // CALORIE_BOUND_NEAR_FRACTION, red beyond that — so the color IS the read, with
  // a near-miss called neither a win nor a failure. There is deliberately no shaded
  // out-of-bounds region any more: the bound moves by tens of kcal across a
  // window, which is far too little for a filled zone to visibly follow, so all
  // that a big flat wash of red communicated was a fixed limit the chart doesn't
  // have. A day with nothing logged is scored as neither: it plots as 0, which is
  // a missing log rather than a day of fasting, so it takes the green (and is
  // invisible at zero height anyway) instead of being counted as the worst day on
  // the chart under a floor.
  // Same gray the Body Mass chart uses for a bar it won't score either way.
  const CALORIE_NEAR_BOUND_COLOR = '#9ca3af';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d)) return '#16a34a';
    const score = calorieBoundScore(values[i], dayBound(i));
    if (score === 'met') return '#16a34a';
    return score === 'near' ? CALORIE_NEAR_BOUND_COLOR : '#dc2626';
  });

  const axis = calorieAxisBounds(values.filter((v, i) => byDate.has(dates[i])), boundByDay.map((b) => b.kcal));

  // Each day's own figure is marked as a cap across its bar — a floating bar
  // (`[from, to]`) the same width as the bar it sits on, with `grouped: false` so
  // it overlays that bar instead of being placed beside it. This replaces the
  // single continuous line the chart used to draw: one line spanning the whole
  // window reads as one shared limit no matter how it's dashed or stepped, while a
  // mark per bar says the limit belongs to that day and to no other. Thickness is
  // a fraction of the axis span rather than a fixed kcal amount, so it stays a
  // hairline whatever range the axis ends up covering.
  const capHalf = (axis.max - axis.min) * 0.004;
  const capData = boundByDay.map((b) => [b.kcal - capHalf, b.kcal + capHalf]);

  // Averaged off the LOGGED days only, so `values`' zero-for-nothing-logged stand-ins
  // don't count as days of fasting.
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)));

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
        weeklyAverageDataset('7-Day Average', weeklyAvg),
        {
          type: 'bar',
          label: `${bound.word} for the day`,
          data: capData,
          backgroundColor: boundMarkColor(),
          grouped: false,
          isBoundMarker: true,
          // Chart.js draws datasets from the HIGHEST order to the lowest, so the
          // lowest order paints last and ends up on top. The caps go above the
          // bars: a cap is only useful if it's still visible on a day whose bar
          // overshoots it.
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Hovering anywhere in a day's column reports that day, rather than
      // requiring the cursor to land on the bar itself. Without this, the cap
      // sitting on top of the bar is often the nearest element to the pointer —
      // and since the cap is filtered out of the tooltip below, hovering near the
      // top of a bar could produce an empty tooltip instead of the day's figures.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The caps are filtered out as their own tooltip row (the Protein and
          // Activity charts do the same with their target lines) — a floating bar
          // would report itself as a `[from, to]` pair — and the figure they mark
          // is stated properly in the lines below instead: as a bound, compared to
          // the day, and attributed to the weight it was calculated from, since
          // that weight is the reason it differs from the next day's.
          filter: (item) => !item.dataset.isBoundMarker && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // One labelled field per line, in the same form the Calorie Balance
            // tooltip already uses for its terms.
            label: (item) => {
              const day = boundByDay[item.dataIndex];
              // Actual last so it sits directly above the planned bound it's scored
              // against, the same Actual/Planned pairing Calorie Balance uses.
              const lines = [
                `Variance: ${withExplicitSign(calorieBoundVariance(item.parsed.y, day.kcal))} kcal`,
                `Actual Intake: ${item.parsed.y} kcal`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // The bound goes last, and via afterBody rather than the label array:
            // Chart.js indents body lines to clear the colour swatch, while afterBody
            // text sits flush with the tooltip's own left padding. bound.word, not
            // bound.full, so it reads "Planned Max" / "Planned Min" rather than
            // "Planned Maximum".
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [`Planned ${bound.word}: ${boundByDay[i].kcal} kcal`];
              if (weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: {
          // Deliberately NOT zero-based, unlike the other intake charts here: the
          // bound moves by roughly 16 kcal per kg of body weight (its BMR and
          // activity terms are both weight-scaled — see calorieBoundDetail), so
          // across a 12-week window it drifts a few tens of kcal — on a 0-2,500 axis that
          // is a handful of pixels end to end and a fraction of one between
          // adjacent days, which is why a per-day figure still read as one fixed
          // line. Bars here are read as a position against their own cap rather
          // than as a quantity of food, so the axis covers the region the
          // comparison actually happens in (see calorieAxisBounds).
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

// Maps a clock time (minutes since midnight) onto a noon-anchored axis, so a
// bedtime/waketime pair that crosses midnight (the normal case) renders as
// one contiguous span instead of wrapping/splitting at a raw 0:00 boundary.
// Anchored at noon rather than a specific assumed bedtime — an earlier fixed
// 18:00 anchor baked in an "everyone goes to bed in the evening" assumption
// that doesn't generalize (e.g. to a night-shift sleep schedule) — noon is
// the one instant of the day virtually guaranteed to fall in the middle of
// anyone's *awake* period, so the same wrap-avoidance trick works regardless
// of actual schedule.
const SLEEP_AXIS_ANCHOR_MIN = 12 * 60;
function sleepAxisValue(clockMin) {
  return (((clockMin - SLEEP_AXIS_ANCHOR_MIN) + 24 * 60) % (24 * 60)) / 60;
}

// Ticks are always whole-hour-aligned (both the anchor and the 3h step below
// are multiples of 60 minutes), so the real clock time is always derivable
// from the axis math directly via the same formatClockTime24 helper the
// tooltip uses (wellness.js) — no fixed label lookup table needed.
// Inverse of sleepAxisValue — shared by the ticks and the weekly-average tooltip.
function sleepAxisClockMin(v) {
  return Math.round((SLEEP_AXIS_ANCHOR_MIN + v * 60) % (24 * 60));
}

function sleepAxisTickLabel(v) {
  return formatClockTime24(sleepAxisClockMin(v));
}

// Rounds the actual earliest-bedtime/latest-waketime span (in axis units,
// across the pairs actually being charted) out to the nearest 3-hour tick
// with a little padding, instead of always reserving a fixed 18-hour window —
// so the chart tightly fits real bed/wake times instead of wasting space on
// hours nobody actually sleeps through. Falls back to the old 0-18 default
// only when there's no valid data to compute a range from.
function computeSleepAxisRange(shiftedPairs) {
  if (shiftedPairs.length === 0) return { axisMin: 0, axisMax: 18 };
  const min = Math.min(...shiftedPairs.map((p) => p.start));
  const max = Math.max(...shiftedPairs.map((p) => p.end));
  return {
    axisMin: Math.max(0, Math.floor(min / 3) * 3 - 3),
    axisMax: Math.min(24, Math.ceil(max / 3) * 3 + 3),
  };
}

function lerpHex(hexA, hexB, t) {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${rgb.join(',')})`;
}

// Red -> amber -> green as duration goes from "minimum" (half the target) up
// to the target itself, reusing the app's own existing expense/calories/
// income colors rather than inventing new ones. Duration at or below the
// minimum is solid red; at or above target is solid green.
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
  const dates = trailingDatesForCategory(sleepEntries, WELLNESS_METRICS_DAYS);

  // Per date, only the single longest bed/wake-bearing entry is drawn (e.g.
  // a nap logged separately from the night's sleep) — dates where no entry
  // has bed/wake data (only ever a plain duration number) are left as a gap
  // rather than falling back to the old bottom-anchored bar style.
  const bestByDate = new Map();
  sleepEntries.forEach((e) => {
    if (e.sleepBedMin === null || e.sleepWakeMin === null) return;
    const current = bestByDate.get(e.date);
    if (!current || e.amount > current.amount) bestByDate.set(e.date, e);
  });

  // Shift every shown date's bed/wake pair onto the noon-anchored axis once,
  // up front — both to derive the axis's own min/max range below and to
  // reuse when building the chart data, so the shift math and the "is this
  // pair valid" check (wake must land after bed once shifted) happen in
  // exactly one place.
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

  // Averaged in noon-anchored AXIS units rather than raw clock minutes: the shift has
  // already unwrapped midnight, so a plain mean works where a mean of clock times
  // would average 23:30 and 00:30 into midday.
  const bedAvg = weeklyAverageSeries(dates.map((d) => shiftedByDate.get(d)?.start ?? null));
  const wakeAvg = weeklyAverageSeries(dates.map((d) => shiftedByDate.get(d)?.end ?? null));

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
        weeklyAverageDataset('7-Day Avg Bed', bedAvg),
        weeklyAverageDataset('7-Day Avg Wake', wakeAvg),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Matching the other charts in the section — without it the cursor lands on
      // whichever average line happens to be nearest instead of the day's bar.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // Nights with no bed/wake pair plot as a gap; index mode would otherwise
          // hand them over as an empty row.
          filter: (item) => item.raw !== null && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // One labelled field per line, like every other chart in this section,
            // rather than the three packed into a single run-on row.
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
            // Flush-left and last, the same placement every other chart in the
            // section gives its reference figures.
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

// Convert any activity amount to minutes so steps and timed entries
// are comparable on the same chart. ~100 steps/min is a typical walking pace.
function toActivityMinutes(amount, unit) {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'steps' || u === 'step') return Math.round(amount / 100);
  if (u === 'hr' || u === 'hour' || u === 'hours') return Math.round(amount * 60);
  return amount; // 'min' or unknown — use as-is
}

// weightKg / heightM² — computed here (not asked of any LLM) since it's shared by
// the State Trend & Forecast chart's BMI line, the Body Mass tooltip and insight.js's
// report data.
function computeBmi(weightKg, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

// Descriptions like "NEAT (Non-Exercise Activity Thermogenesis)" get
// truncated to just "NEAT" for display — the parenthetical explanation
// doesn't fit the legend/tooltip and isn't needed once you know the term.
function shortActivityLabel(description) {
  return description.split(' (')[0].trim();
}

// NEAT and Strength training get the app's blue and green rather than whichever
// hue their alphabetical position happens to land on — they're the two segments
// read most often, and a generated hue slides out from under them the moment a
// new activity description is logged. Keyed on the SHORTENED label, so
// "NEAT (Non-Exercise Activity Thermogenesis)" matches as well.
const PINNED_ACTIVITY_COLORS = new Map([
  ['neat', '#3b82f6'],
  ['strength training', '#16a34a'],
]);

// Every other description still gets an evenly-spaced generated hue, but drawn
// from the color circle MINUS a band around each pinned hue — otherwise a third
// activity can land on a near-identical blue or green and the pinning buys
// nothing. The surviving arcs are measured end to end and the remaining hues
// spaced evenly along that total, so they stay as far from each other as the
// reduced range allows instead of bunching at one edge.
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
  const dates = trailingDatesForCategory(activityEntries, WELLNESS_METRICS_DAYS);

  // One stacked segment per description (e.g. NEAT / Resistance / Cardio)
  // instead of a single summed bar, so each day's activity composition is
  // visible at a glance, not just its total — evenly-spaced hues the same
  // way renderAccountCompositionChart colors an arbitrary-length category list.
  const descriptions = [...new Set(activityEntries.map((e) => e.description || 'Other'))].sort();
  const byDescription = new Map(descriptions.map((d) => [d, new Map()]));
  activityEntries.forEach((e) => {
    const description = e.description || 'Other';
    const mins = toActivityMinutes(e.amount, e.unit);
    const byDate = byDescription.get(description);
    byDate.set(e.date, (byDate.get(e.date) || 0) + mins);
  });

  // Calories burned per day, on its own left-hand axis (minutes and kcal are
  // different scales, so this is a deliberate dual-axis chart). Every entry gets a
  // figure via activityEntryKcal — its own Calculate-derived amount2, else its
  // minutes costed at ACTIVITY_MET and that day's weight. Entries without amount2
  // used to be skipped outright, which left a logged activity day with no kcal dot.
  const activityWeightForDate = carryForwardWeightByDate(weightByDateMap(entries.filter((e) => e.category === 'Weight' && e.amount !== null)), dates);
  const caloriesByDate = new Map();
  activityEntries.forEach((e) => {
    const kcal = activityEntryKcal(e, activityWeightForDate.get(e.date) ?? null);
    caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + kcal);
  });

  const pinnedColorFor = (d) => PINNED_ACTIVITY_COLORS.get(shortActivityLabel(d).toLowerCase()) ?? null;
  const generatedHues = unreservedActivityHues(descriptions.filter((d) => pinnedColorFor(d) === null).length);
  let nextGeneratedHue = 0;
  const descriptionColors = descriptions.map((d) => pinnedColorFor(d)
    ?? `hsl(${generatedHues[nextGeneratedHue++]}, 65%, 55%)`);

  // Everything on this chart is plotted NEGATIVE so the whole thing hangs below the
  // x-axis: minutes and calories are both what a day spent, not what it accumulated,
  // and the mirrored form says that at a glance. The magnitudes are what's reported
  // in ticks and tooltips — only the geometry is flipped.
  const activityDatasets = descriptions.map((d, i) => ({
    type: 'bar',
    label: shortActivityLabel(d),
    data: dates.map((date) => -(byDescription.get(d).get(date) || 0)),
    backgroundColor: descriptionColors[i],
    stack: 'activity',
    order: 2,
  }));

  const hasData = activityDatasets.some((ds) => ds.data.some((v) => v !== 0));

  // Each dot is scored against the kcal that day's own body mass would burn at
  // ACTIVITY_TARGET_MIN (activityTargetKcal — the same figure the calorie bound's
  // activity term uses, so the two can't disagree). Met or beaten is green, short by
  // up to ACTIVITY_NEAR_TARGET_FRACTION is gray, further short is red. The dashed
  // line itself is in MINUTES on the other axis, so it can't be the comparison: a
  // day can clear the minutes target on a walk and still burn far less than a day
  // that lifted, which is exactly what these colors surface. Without a body mass for
  // that day there's no target to score against, so the dot stays neutral purple.
  const dotColor = (date, kcal) => {
    const weightKg = activityWeightForDate.get(date) ?? null;
    if (kcal === null || weightKg === null) return '#7c3aed';
    const target = activityTargetKcal(weightKg);
    if (kcal >= target) return '#16a34a';
    return target - kcal <= target * ACTIVITY_NEAR_TARGET_FRACTION ? '#9ca3af' : '#dc2626';
  };

  // Dot-per-day series rather than a connected line — each day's calorie
  // burn is its own independent figure (some days have none logged at all,
  // which a connected line would misleadingly bridge over as a trend).
  // Scored on the positive figures, plotted negated — same mirror as the bars.
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

  // The reference line is the PLANNED BURN, on the kcal axis — not the flat
  // minutes target it used to be. That line sat on the other axis from the dots
  // it appeared to judge, so a day could clear it on a walk while burning far
  // less than a day that lifted; the dots were already scored against this
  // figure instead, and the visible line now matches what scores them.
  //
  // It moves day to day because activityTargetKcal is MET x that day's own
  // carried-forward body mass x ACTIVITY_TARGET_MIN — so it falls as body mass
  // does. Stepped, since the weight is carried forward between weigh-ins and the
  // figure genuinely holds flat until the next one; a sloped line would imply an
  // interpolation that isn't happening. A day with no body mass on file has no
  // figure, so the line breaks there rather than inventing one.
  const plannedBurnKcal = dates.map((date) => {
    const weightKg = activityWeightForDate.get(date) ?? null;
    return weightKg === null ? null : activityTargetKcal(weightKg);
  });

  // Marked as a cap across each day's own column — a floating bar (`[from, to]`)
  // with `grouped: false` so it overlays rather than sits beside, exactly as the
  // Caloric Intake and Calorie Balance charts mark their own per-day figures.
  // It used to be a dashed line, which was right while the target was a flat
  // number of minutes; now that it moves with each day's body mass, a line
  // spanning the window would read as one shared limit no matter how it's dashed,
  // while a mark per column says the figure belongs to that day and no other.
  // Thickness is a fraction of the kcal range so it stays a hairline at any scale.
  const burnMagnitudes = [
    ...caloriesData.filter((v) => v !== null),
    ...plannedBurnKcal.filter((v) => v !== null),
  ];
  const capHalf = (burnMagnitudes.length ? Math.max(...burnMagnitudes) : 1) * 0.006;
  const targetLineDataset = {
    type: 'bar',
    label: 'Planned Burn',
    data: plannedBurnKcal.map((v) => (v === null ? null : [-v - capHalf, -v + capHalf])),
    yAxisID: 'y1',
    backgroundColor: boundMarkColor(),
    grouped: false,
    // Chart.js draws highest order first, so the lowest paints last and sits on top:
    // bars (2), then the weekly average and this cap (both 1, the cap listed second
    // so it wins the tie), then the dots (0) above everything.
    order: 1,
    isTargetLine: true,
  };

  // Averaged on the kcal axis, not the minutes one: Planned Burn is the figure the
  // week is being compared against, and it lives there. Negated like the dots it
  // averages.
  const weeklyBurnAvg = weeklyAverageSeries(caloriesData);
  const weeklyBurnDataset = weeklyAverageDataset(
    '7-Day Average Burn',
    weeklyBurnAvg.map((v) => (v === null ? null : -v)),
    { yAxisID: 'y1' },
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
          // Empty slots, and the cap — a floating bar would report itself as a
          // `[from, to]` pair, so its figure is stated properly in afterBody
          // instead, the same way Caloric Intake handles its own cap.
          filter: (item) => item.raw !== null && !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          // Rows in dataset order. Without this Chart.js hands them over sorted by
          // the `order` property that controls DRAW order, which put the dots
          // (order: 0) above the bars, away from the Planned Burn figure below
          // that they should be read against.
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // Each dot's swatch is the scored colour it was actually drawn in,
            // rather than the dataset's single default.
            labelColors: (item) => {
              const ds = item.dataset;
              const fill = Array.isArray(ds.pointBackgroundColor)
                ? ds.pointBackgroundColor[item.dataIndex]
                : (ds.pointBackgroundColor ?? ds.backgroundColor);
              return { borderColor: fill, backgroundColor: fill };
            },
            // Signed the same way the two axes are: calories keep the minus (energy
            // spent), minutes report the magnitude they actually were.
            label: (item) => {
              // y1 is the kcal scale, everything else on this chart is minutes — so
              // the unit follows the axis the row belongs to.
              const isKcal = item.dataset.yAxisID === 'y1';
              const v = Math.round(item.parsed.y);
              const text = `${item.dataset.label}: ${isKcal ? v : Math.abs(v)} ${isKcal ? 'kcal' : 'min'}`;
              return privacyMode ? maskDigits(text) : text;
            },
            // The cap's own figure, last and flush-left via afterBody — the same
            // placement Caloric Intake gives its bound, so the two read alike.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [];
              if (plannedBurnKcal[i] !== null) lines.push(`Planned Burn: ${-Math.round(plannedBurnKcal[i])} kcal`);
              if (weeklyBurnAvg[i] !== null) lines.push(`7-Day Average Burn: ${-Math.round(weeklyBurnAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        // kcal on the LEFT owning the gridlines, minutes on the right drawing none.
        // The exception to this panel's left-axis-is-the-primary rule, and it earns
        // it: the comparison this chart exists to make — Actual Burn against Planned
        // Burn — happens entirely on the kcal scale, so the horizontal lines have to
        // be spaced in kcal for that pair to be readable against them. The axis ids
        // are untouched (bars default to `y`, the dots and the planned line name
        // `y1`); only the sides move.
        // Both scales run from 0 at the top down into the negative, since every
        // series is plotted negated — but they label differently on purpose. Calories
        // keep the minus sign: that energy left the body. Minutes drop it, because
        // negative time spent is meaningless; their direction carries the meaning.
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
  const dates = trailingDatesForCategory(proteinEntries, WELLNESS_METRICS_DAYS);
  const byDate = new Map();
  proteinEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount2));

  // Each end of the band is marked with the section's own per-column cap rather
  // than a dashed line spanning the window, so this chart's red mark reads as the
  // same thing as every other chart's. The band is still a shaded region: the two
  // line datasets survive purely to carry `fill: '+1'` (which shades from the
  // upper line down to the NEXT dataset, so the pair must stay adjacent and in
  // this order) with their own stroke turned off, and the caps are drawn over the
  // top. A zero-width band (flat PROTEIN_TARGET_G, no per-kg range) collapses to
  // a single row of caps with nothing to shade between.
  //
  // Shaded green, not red: unlike the Caloric Intake chart — where the shading
  // marks the half you must stay OUT of — the region between these two lines is
  // the one you're aiming to land in, and it sits behind bars scored in the same
  // green.
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

  // Green inside the band; the two ways of leaving it are NOT equivalent. Falling
  // short of the floor is the miss that costs you muscle on a deficit, so it stays
  // red. Going over the top end isn't a failure — just past the point where more
  // protein buys anything — so it goes gray rather than being scored either way. A
  // day with nothing logged takes the green, since 0 g is a missing log rather than
  // a day without protein (and a zero-height bar is invisible regardless).
  const PROTEIN_OVER_BAND_COLOR = '#9ca3af';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinProteinBand(values[i], band)) return '#16a34a';
    return values[i] > band.max ? PROTEIN_OVER_BAND_COLOR : '#dc2626';
  });

  // This axis is zero-based and auto-topped, so its span is whatever the tallest
  // thing on it is — a bar or the band's own top end.
  const capHalf = boundCapHalf(Math.max(band.max, ...values, 1));
  const capFor = (value, label) => boundCapDataset(label, new Array(dates.length).fill(value), capHalf, { isTargetLine: true });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: 'rgba(22, 163, 74, 0.10)' }),
      bandFill(band.min),
      capFor(band.max, `${band.max} g upper target`),
      capFor(band.min, `${band.min} g target floor`),
    ]
    : [capFor(band.min, `${band.min} g target`)];

  // Logged days only, so `values`' zero-for-nothing-logged stand-ins don't pull the
  // week under the band's floor.
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)));

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
        weeklyAverageDataset('7-Day Average', weeklyAvg),
        ...targetDatasets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Matching the other charts in the section — without it the cursor lands on
      // the average line instead of the day's bar, and that row is filtered out.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The band's two lines are the same constant on every day, so as datasets
          // they'd repeat as identical rows on every hover. They're filtered out here
          // and stated once by afterBody below instead.
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `Actual Intake: ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            // Both ends of the band, flush left and last — the same Actual/Planned
            // shape Caloric Intake and Calorie Balance use. A flat PROTEIN_TARGET_G
            // with no per-kg range collapses the band to one figure, so it reads as a
            // single target rather than a Min and Max that happen to be equal.
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`Planned Min: ${band.min} g`, `Planned Max: ${band.max} g`]
                : [`Planned Target: ${band.min} g`];
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

// Average of a Map's values (e.g. calories/activity/sleep summed per logged
// date) — averaged over days that actually HAVE a log, not the calendar
// length of the window.
function avg(map) {
  return [...map.values()].reduce((a, b) => a + b, 0) / map.size;
}

// Parse/format in UTC throughout: `new Date("YYYY-MM-DD")` parses as UTC
// midnight, and formatting that back with the LOCAL timezone can roll it
// back a day in any negative-UTC-offset zone — staying in UTC end-to-end
// avoids that mismatch.
function parseIsoDateUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Window size (in LOGGED POINTS, not calendar days) for the Weight Trend &
// Forecast chart's "State Trend & Forecast" line.
const WEIGHT_TREND_WINDOW_SIZE = 5;

// Centered simple moving average over the sorted per-day weight series:
// each point is averaged together with its nearest neighbors on both sides,
// so one noisy reading gets diluted by its surroundings instead of showing
// up as a spike (or, with a trailing-only average, dragging the line up to
// meet it and lagging behind afterwards). Windowing by logged points rather
// than elapsed days means it smooths the same way whether entries are daily
// or sporadic — unlike a time-decayed average, whose smoothing effectively
// vanishes once gaps between weigh-ins approach the decay window.
function computeWeightTrend(weightByDate, windowSize = WEIGHT_TREND_WINDOW_SIZE) {
  const dates = [...weightByDate.keys()].sort();
  const values = dates.map((d) => weightByDate.get(d));
  const radius = Math.floor((windowSize - 1) / 2);

  const trend = new Map();
  values.forEach((_, i) => {
    const windowValues = values.slice(Math.max(0, i - radius), Math.min(values.length, i + radius + 1));
    trend.set(dates[i], windowValues.reduce((a, b) => a + b, 0) / windowValues.length);
  });

  return trend;
}

// A net change this small in kg over ~10 days reads as a genuine stall
// rather than normal day-to-day fluctuation (water, sodium, cycle) — checked
// against the already-smoothed Weight Trend line, not raw weigh-ins, which
// are noisy enough day-to-day to trip a naive threshold on their own.
const PLATEAU_WINDOW_DAYS = 10;
const PLATEAU_THRESHOLD_KG = 0.3;

// Returns how many days the trend has actually held flat, or null if
// there's not enough logged history spanning the full window to tell (a
// couple of sparse entries can't confirm 10 days of flatness, only fail to
// disprove it) or the trend has moved enough to not count as a plateau.
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

// The PLANNED trajectory — eating exactly the calculated bound Eᵢₙ and hitting
// ACTIVITY_TARGET_MIN every day. Shared with the Health Formula Playground so its
// printed A / B / m∞ / t and the State Trend & Forecast forecast are one piece of arithmetic
// rather than two copies that can disagree.
//
// Closed-form solution of dm/dt = (Eᵢₙ − A − B·m)/ρ at fixed intake, rather than a
// day-by-day loop: it's an ordinary linear ODE, so the exact answer is one log.
// Verified against numeric integration (agrees to the discrete step's rounding).
//
// Works in both directions — a surplus makes m∞ heavier than m and the same log
// gives the days to gain — but it can only reach targets that lie between m and
// m∞. A target past the asymptote is genuinely unreachable at that intake, which
// is reported rather than extrapolated.
function projectPlanDays({ intakeKcal, weightKg, heightCm, age, sex, met, tau, kappa, goalKg }) {
  const a = 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
  const b = 10 + (met * tau * kappa) / ML_O2_PER_KCAL;
  const equilibriumKg = (intakeKcal - a) / b;

  if (Math.abs(weightKg - goalKg) < WEIGHT_AT_GOAL_TOLERANCE_KG) {
    return { a, b, equilibriumKg, status: 'reached' };
  }

  const ratio = (weightKg - equilibriumKg) / (goalKg - equilibriumKg);
  if (!Number.isFinite(ratio) || ratio <= 1) {
    return { a, b, equilibriumKg, status: 'unreachable' };
  }

  const days = (GENERIC_KCAL_PER_KG_FAT / b) * Math.log(ratio);
  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  return { a, b, equilibriumKg, days, etaIso: isoFromDate(eta), status: 'ok' };
}

// The same plan, fed from saved Settings rather than the playground's live inputs —
// so the chart and the playground agree whenever the playground's boxes still hold
// what's on the sheet. Null without the profile the BMR needs.
function planProjectionFromSettings(entries, weightKg, goalKg) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  if (heightCm === null || age === null || (sex !== 'male' && sex !== 'female')) return null;

  return projectPlanDays({
    // Eᵢₙ itself — the calculated bound is BMR + activity-at-target − the deficit
    // WEEKLY_FAT_LOSS_KG implies, which is exactly what the playground computes.
    intakeKcal: getCalorieBoundKcal(entries),
    weightKg,
    heightCm,
    age,
    sex,
    met: activityMet(),
    tau: getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT),
    kappa: getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT),
    goalKg,
  });
}

function calcProjection(entries) {
  const weightGoal = getSetting('WEIGHT_GOAL_KG', WEIGHT_GOAL_KG_DEFAULT);
  // The bound's figure only — which side of it the user should be on doesn't
  // enter the arithmetic here, so only the number is read. Used as the stand-in
  // intake level when nothing has been logged.
  const calorieTarget = getCalorieBoundKcal(entries);
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = isoFromDate(today);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - 14);
  const cutoffIso = isoFromDate(cutoff);

  const weightEntries = entries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (weightEntries.length < 2) return null;

  const lastWeight = weightEntries[weightEntries.length - 1].amount;
  if (Math.abs(lastWeight - weightGoal) < 0.1) return { status: 'reached' };

  const recentEntries = entries.filter((e) => e.date >= cutoffIso && e.date <= todayIso);

  const caloriesByDate = new Map();
  const activityKcalByDate = new Map();
  const sleepByDate = new Map();

  recentEntries.forEach((e) => {
    if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
      const kcal = activityEntryKcal(e, latestWeightKg(entries));
      activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
    } else if (e.category === 'Sleep' && e.amount !== null) {
      sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
    }
  });

  let slope;
  let method;
  // Set only by the habit branch below, and only with a profile on file: the
  // exponential model's three coefficients. Null means project as a straight line.
  let decay = null;

  // The PLAN wins whenever the profile allows it, so this chart's arrival date is the
  // same one the Health Formula Playground prints. That makes the forecast a statement
  // of the plan rather than of recent behaviour: eat over the bound for a fortnight
  // and this date does NOT slip. The Calorie Balance chart below is where actual
  // intake vs. plan is visible day by day.
  const plan = planProjectionFromSettings(entries, lastWeight, weightGoal);
  if (plan !== null && plan.status !== 'reached') {
    decay = {
      perKg: plan.b,
      // No sleep factor: the plan doesn't model sleep, and dividing ρ here would
      // change the arrival date away from the playground's t.
      kcalPerKg: GENERIC_KCAL_PER_KG_FAT,
      equilibriumKg: plan.equilibriumKg,
    };
    // Rate at today's mass, for the ETA line's "~x kg/week" note. The trajectory
    // itself decelerates, which the decay coefficients above carry.
    slope = (getCalorieBoundKcal(entries) - (plan.a + plan.b * lastWeight)) / GENERIC_KCAL_PER_KG_FAT;
    method = 'plan';
  } else if (caloriesByDate.size > 0 || activityKcalByDate.size > 0) {
    const avgCalories = caloriesByDate.size > 0 ? avg(caloriesByDate) : calorieTarget;
    const avgActivityKcal = activityKcalByDate.size > 0 ? avg(activityKcalByDate) : 0;
    const avgSleep = sleepByDate.size > 0 ? avg(sleepByDate) : sleepTarget;

    // Negative balance = caloric deficit = weight loss. avgActivityKcal
    // already folds in the *5-per-minute estimate for any entry lacking
    // a real kcal figure, so it's added here directly rather than
    // re-deriving it from minutes.
    //
    // Measured against MAINTENANCE, not calorieTarget: the target is already
    // maintenance minus the planned deficit, so eating exactly it once produced a
    // ~zero balance and a "no net change" forecast — precisely when the planned
    // WEEKLY_FAT_LOSS_KG should have been delivered.
    //
    // Same shape as the bound's own basis (BMR + activity, no multiplier — see
    // calorieBoundDetail), differing only in which activity figure: the window's
    // actual logged burn here, the ACTIVITY_TARGET_MIN one there.
    const resting = restingMaintenanceKcal(entries);
    const maintenance = resting !== null
      ? resting + avgActivityKcal
      // No profile on file, so there's no BMR to work from and no calculated
      // bound either — getCalorieBoundKcal fell back to the flat
      // CALORIE_TARGET_KCAL setting, a number the user chose directly with no
      // deficit arithmetic inside it. Treating that as the reference is the
      // best available baseline in that case.
      : calorieTarget + avgActivityKcal;

    const balance = avgCalories - maintenance;
    const baseSlope = balance / GENERIC_KCAL_PER_KG_FAT;
    const sleepRatio = Math.min(1.0, Math.max(0.7, avgSleep / sleepTarget));
    slope = baseSlope * sleepRatio;

    // Maintenance isn't a constant as weight changes — it's affine in body mass,
    // so holding intake fixed makes the trajectory an exponential decay toward
    // the weight where that intake IS maintenance, not a straight line. Both
    // terms scale with mass: BMR by its 10·m coefficient, and the logged activity
    // burn because metKcal is proportional to weight (the same kg of walking
    // costs less at a lighter body). Only available with a profile — without a
    // BMR there's no A/B to split maintenance into, so `decay` stays null and the
    // straight-line projection below is used unchanged.
    if (resting !== null && lastWeight > 0) {
      const perKg = 10 + avgActivityKcal / lastWeight;
      const weightIndependent = maintenance - perKg * lastWeight;
      decay = {
        perKg,
        // Sleep scales the whole rate, so it divides the energy density rather
        // than entering the equilibrium — the destination is the same either way,
        // only the speed of arrival changes.
        kcalPerKg: GENERIC_KCAL_PER_KG_FAT / sleepRatio,
        equilibriumKg: (avgCalories - weightIndependent) / perKg,
      };
    }

    // The formula scales by sleep, so a missing sleep log genuinely leaves it
    // working with partial habit data.
    const allPresent = caloriesByDate.size > 0 && activityKcalByDate.size > 0 && sleepByDate.size > 0;
    method = allPresent ? 'full' : 'partial';
  } else {
    const src = weightEntries.filter((e) => e.date >= cutoffIso);
    const data = src.length >= 2 ? src : weightEntries;
    slope = linearRegressionSlope(data.map((_, i) => i), data.map((e) => e.amount));
    method = 'weight-only';
  }

  // The slope is reported even when no forecast can be drawn, so the ETA line
  // can show the rate instead of a bare "projection unavailable".
  if (slope === 0) return { status: 'no-change', method, slope };

  const goingDown = weightGoal < lastWeight;
  if ((goingDown && slope > 0) || (!goingDown && slope < 0)) return { status: 'wrong-direction', method, slope };

  // A fixed intake can only ever carry you to its own equilibrium weight, so a
  // goal on the far side of it is never reached however long you hold the habit.
  // The straight line couldn't express that — it always produced an arrival date
  // — which is exactly the case this status exists to report.
  if (decay !== null) {
    const gapNow = lastWeight - decay.equilibriumKg;
    const gapGoal = weightGoal - decay.equilibriumKg;
    if (gapGoal / gapNow <= 0) {
      return { status: 'asymptote', method, slope, equilibriumKg: decay.equilibriumKg };
    }
  }

  // Time to the goal: the straight line's own division, or the exponential
  // model's closed form — t = (ρ/B)·ln[(m − m∞)/(m_g − m∞)], the exact solution
  // of dm/dt = (E − A − B·m)/ρ rather than a day-by-day simulation of it.
  const daysToGoal = decay !== null
    ? Math.round((decay.kcalPerKg / decay.perKg)
      * Math.log((lastWeight - decay.equilibriumKg) / (weightGoal - decay.equilibriumKg)))
    : Math.round((weightGoal - lastWeight) / slope);
  const etaDate = new Date(today);
  etaDate.setDate(today.getDate() + daysToGoal);

  // m(t) = m∞ + (m − m∞)·e^(−B·t/ρ) for the curve, m + slope·t for the line.
  const weightAtDay = (d) => (decay !== null
    ? decay.equilibriumKg + (lastWeight - decay.equilibriumKg) * Math.exp(-(decay.perKg * d) / decay.kcalPerKg)
    : lastWeight + slope * d);

  const cappedDays = Math.min(daysToGoal, 365);
  const projectedPoints = [];
  for (let d = 0; d <= cappedDays; d += 7) {
    const pd = new Date(today);
    pd.setDate(today.getDate() + d);
    projectedPoints.push({ date: isoFromDate(pd), weight: Math.round(weightAtDay(d) * 10) / 10 });
  }
  if (daysToGoal <= 365) {
    projectedPoints.push({ date: isoFromDate(etaDate), weight: weightGoal });
  }

  return {
    status: 'ok',
    slope,
    daysToGoal,
    etaDate,
    projectedPoints,
    method,
    weightGoal,
    equilibriumKg: decay !== null ? decay.equilibriumKg : null,
  };
}

function renderWellnessProjectionChart(entries) {
  const ctx = document.getElementById('wellness-projection-chart');
  if (wellnessProjectionChart) wellnessProjectionChart.destroy();

  const meterWrap = document.getElementById('weight-progress-meter');
  const meterFill = document.getElementById('weight-progress-meter-fill');
  const meterDone = document.getElementById('weight-progress-meter-done');
  const meterRemaining = document.getElementById('weight-progress-meter-remaining');
  const timeWrap = document.getElementById('time-progress-meter');
  const timeFill = document.getElementById('time-progress-meter-fill');
  const timeElapsed = document.getElementById('time-progress-meter-elapsed');
  const timeRemaining = document.getElementById('time-progress-meter-remaining');
  const etaEl = document.getElementById('weight-projection-eta');
  const plateauNote = document.getElementById('weight-plateau-note');
  meterWrap.hidden = true;
  meterDone.textContent = '';
  meterRemaining.textContent = '';
  meterRemaining.classList.remove('danger');
  timeWrap.hidden = true;
  timeElapsed.textContent = '';
  timeRemaining.textContent = '';
  etaEl.textContent = '';
  plateauNote.textContent = '';
  plateauNote.classList.remove('warning');

  const weightEntries = entries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (weightEntries.length < 2) return;

  const startWeight = weightEntries[0].amount;
  const lastWeight = weightEntries[weightEntries.length - 1].amount;

  const proj = calcProjection(entries);
  if (!proj) return;

  // Progress meter: how far from the first logged weight to the goal —
  // shown whenever there's a real start point and a distinct goal,
  // regardless of trajectory status (even "wrong direction" is worth
  // seeing visually, just in the danger color instead of the accent).
  // Both readouts are kg — how far you've come and how far is left, in the same
  // unit, so the pair can be compared directly. The percentage still drives the
  // bar's width; it just isn't spelled out beside a kg figure any more.
  const weightGoal = getSetting('WEIGHT_GOAL_KG', WEIGHT_GOAL_KG_DEFAULT);
  const totalDelta = startWeight - weightGoal;
  if (Math.abs(totalDelta) >= 0.1) {
    const pct = Math.max(0, Math.min(100, ((startWeight - lastWeight) / totalDelta) * 100));
    const doneKg = Math.round(Math.abs(startWeight - lastWeight) * 10) / 10;
    const remainingKg = Math.round(Math.abs(lastWeight - weightGoal) * 10) / 10;
    const isWrongDirection = proj.status === 'wrong-direction';

    meterWrap.hidden = false;
    meterFill.style.width = `${pct}%`;
    meterFill.classList.toggle('danger', isWrongDirection);

    const doneText = `${doneKg} kg`;
    meterDone.textContent = privacyMode ? maskDigits(doneText) : doneText;

    const remainingText = `${remainingKg} kg`;
    meterRemaining.textContent = privacyMode ? maskDigits(remainingText) : remainingText;
    meterRemaining.classList.toggle('danger', isWrongDirection);
  }

  // A projection that can't be drawn (already at goal, flat trend, or
  // trending away from it) used to `return` here — but the chart was already
  // destroyed at the top of this function, so the panel went fully blank and
  // took the weight history, the smoothed trend line, and the goal line with
  // it. None of those three depend on a projection existing. Now only the
  // projected segment itself is dropped: the status line says why, and
  // everything actually MEASURED stays on screen.
  // The rate is included on the two "can't forecast" statuses so the line says
  // something concrete rather than a bare "projection unavailable".
  const rateNote = () => {
    const kgPerWeek = Math.abs(proj.slope * 7).toFixed(2);
    const direction = proj.slope > 0 ? 'gaining' : 'losing';
    return `${direction} ~${kgPerWeek} kg/week`;
  };
  const statusNote = {
    reached: () => 'Goal reached! 🎉',
    'no-change': () => 'No net change at current habits',
    'wrong-direction': () => `Current habits trend away from goal — ${rateNote()}, so no arrival date can be projected`,
    // The rate is real and pointed the right way, but it decays to zero before
    // the goal: the intake these habits average IS maintenance at that weight.
    asymptote: () => `Currently ${rateNote()}, but these habits level off around ${Math.round(proj.equilibriumKg * 10) / 10} kg — the goal isn't reachable without changing them`,
  }[proj.status];
  if (statusNote) {
    const note = statusNote();
    etaEl.textContent = privacyMode ? maskDigits(note) : note;
  }

  // Which model drew the forecast, said out loud. It decides the SHAPE of the
  // projected line, and until now nothing on screen revealed it: the plan and
  // habit paths both integrate maintenance as it falls with body mass, so their
  // line is an exponential that visibly eases off; the body-mass-only fallback
  // is a least-squares slope and is dead straight by construction. A line that
  // looks straighter than expected is answered here rather than left a mystery.
  const PROJECTION_METHOD_NOTE = {
    plan: 'from your plan — the curve eases as body mass falls',
    full: 'from recent habits — the curve eases as body mass falls',
    partial: 'from recent habits (partial data) — the curve eases as body mass falls',
    'weight-only': 'from the body-mass trend alone — a straight line, with no profile to model the slowdown',
  };

  const hasProjection = proj.status === 'ok';
  const projPoints = hasProjection ? proj.projectedPoints : [];

  // Companion to the weight meter above: the same journey measured in time
  // rather than in kg. "Elapsed" is days since the first weigh-in (how long
  // you've been at this), "to go" is the forecast's own remaining days — so the
  // two bars together answer "how far along am I" on both axes at once, and a
  // long time bar beside a short weight bar is itself the signal that progress
  // is slower than the effort. Needs an actual arrival date, so it's hidden for
  // any status that can't produce one.
  if (hasProjection) {
    // Today's own Y-M-D re-parsed as UTC, so it's on the same footing as every
    // other date here (see parseIsoDateUTC) rather than mixing zones.
    const todayMs = parseIsoDateUTC(isoFromDate(new Date()));
    const daysElapsed = Math.max(0, Math.round((todayMs - parseIsoDateUTC(weightEntries[0].date)) / 86400000));
    const daysToGo = Math.max(0, proj.daysToGoal);
    const totalDays = daysElapsed + daysToGo;

    if (totalDays > 0) {
      const timePct = Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
      timeWrap.hidden = false;
      timeFill.style.width = `${timePct}%`;

      const elapsedText = `${daysElapsed} ${daysElapsed === 1 ? 'day' : 'days'}`;
      timeElapsed.textContent = privacyMode ? maskDigits(elapsedText) : elapsedText;

      const toGoText = `${daysToGo} ${daysToGo === 1 ? 'day' : 'days'}`;
      timeRemaining.textContent = privacyMode ? maskDigits(toGoText) : toGoText;
    }

    // The 'ok' status left this line blank, so a forecast that WAS drawn said
    // nothing about itself. It now states its current rate and which model
    // produced it, the same line the can't-forecast statuses already use.
    const okNote = `Currently ${rateNote()} — projected ${PROJECTION_METHOD_NOTE[proj.method] ?? ''}`;
    etaEl.textContent = privacyMode ? maskDigits(okNote) : okNote;
  }

  const histLabels = weightEntries.map((e) => e.date);
  const projLabels = projPoints.map((p) => p.date);
  const allLabels = [...new Set([...histLabels, ...projLabels])].sort();

  const projMap = new Map(projPoints.map((p) => [p.date, p.weight]));
  const lastDate = histLabels[histLabels.length - 1];

  // Same-day duplicate weigh-ins (e.g. morning + evening) are averaged before
  // smoothing, rather than letting whichever entry comes last silently win.
  const weightSumsByDate = new Map();
  weightEntries.forEach((e) => {
    const cur = weightSumsByDate.get(e.date) || { sum: 0, count: 0 };
    cur.sum += e.amount;
    cur.count += 1;
    weightSumsByDate.set(e.date, cur);
  });
  const weightByDate = new Map([...weightSumsByDate].map(([d, { sum, count }]) => [d, sum / count]));
  const trendMap = computeWeightTrend(weightByDate);

  const plateauDays = detectPlateau(trendMap);
  if (plateauDays) {
    const plateauLine = `⚠️ Body mass trend has been flat for ~${plateauDays} days — consider adjusting your calorie limit`;
    plateauNote.textContent = privacyMode ? maskDigits(plateauLine) : plateauLine;
    plateauNote.classList.add('warning');
  }

  // Daily history followed by weekly (then a single distant ETA) projected
  // points must NOT be spaced as equal category ticks — that visually
  // implies every gap is the same length. Plot on a true linear axis (day
  // offset from the first date) instead, so a week gap actually takes up
  // 7x the width of a one-day gap.
  const firstDateMs = parseIsoDateUTC(allLabels[0]);
  const dayOffset = (dateStr) => Math.round((parseIsoDateUTC(dateStr) - firstDateMs) / 86400000);
  const offsetToDateLabel = (offset) =>
    new Date(firstDateMs + offset * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // No raw per-reading series here — the Body Mass chart above already plots
  // every reading, and this chart is the trend.
  const datasets = [
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
    // Omitted entirely rather than plotted empty when there's no drawable
    // projection, so it doesn't sit in the legend claiming a forecast exists.
    ...(hasProjection ? [{
      label: 'Projected',
      data: allLabels.map((d) => {
        let y = null;
        if (d === lastDate) y = lastWeight;
        else if (d > lastDate) y = projMap.get(d) ?? null;
        return { x: dayOffset(d), y };
      }),
      borderColor: '#6366f1',
      // The one dash pattern used everywhere in the app, and the same width as
      // the trend line this continues — it was [6, 4] at Chart.js's default
      // width 3, which made the forecast the heaviest, longest-dashed line on a
      // chart where it's the least certain thing shown, and left the red goal
      // line beside it looking like a different kind of dash.
      borderDash: [4, 4],
      borderWidth: 2,
      // Line only — the shaded area under it read as a quantity, when all the
      // forecast actually asserts is where the trend line goes.
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 2,
    }] : []),
    {
      // weightGoal, not proj.weightGoal — the latter is only set on an 'ok'
      // projection, but the goal line is drawn either way.
      label: `${weightGoal} kg Goal`,
      data: allLabels.map((d) => ({ x: dayOffset(d), y: weightGoal })),
      // Solid, matching the hairline caps the rest of the section marks its
      // figures with — this used to be dashed, which made it the odd one out.
      // It stays a continuous line rather than becoming caps like the others
      // because this chart has no columns to cap: its x-axis is a true linear
      // time scale carrying irregularly spaced history and a distant projected
      // point, so there is nothing per-column for a mark to belong to.
      borderColor: boundMarkColor(),
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 1,
    },
  ];

  // Only set up when a height is on file — without it BMI can't be computed,
  // and an axis with no correspondence to compute would just be a confusing
  // empty scale, so the whole axis is skipped rather than shown broken.
  // There's no separate BMI *line*: BMI is a fixed linear rescale of weight
  // (see below), so a plotted BMI line would just exactly retrace the
  // weight line pixel-for-pixel — the right-hand y1 axis alone already lets
  // BMI be read straight off the existing weight line.
  const heightCm = getSetting('HEIGHT_CM', null);

  // BMI = weight × (1 / heightM²) — a fixed linear rescale of weight, not an
  // independent quantity, which is exactly why there's no separate BMI line
  // above: it would just retrace the weight line exactly. Left to auto-range
  // on its own, Chart.js can pick a BMI axis span that doesn't correspond to
  // the weight axis's span, so a given height on the chart would read as the
  // wrong BMI off the right-hand axis even though the weight line there is
  // correct. Deriving y1's min/max from the exact same weight range as y
  // (via computeBmi) keeps the two axes true parallel twins — same shape,
  // consistent correspondence, whatever ruler you read.
  // Rounded to whole kg (not just padded) — a fractional min/max (e.g.
  // 81.8–94.3) breaks Chart.js's own "nice round numbers" tick algorithm,
  // which is what produced clean 1kg-apart gridlines (94, 93, 92, …) before
  // any explicit min/max was set. Flooring/ceiling to whole numbers keeps
  // that same clean stepping while still fixing the axis bounds so y1 can
  // be derived from them.
  // Raw weigh-ins are excluded — no longer plotted, so framing on them would
  // reserve space for a line that isn't there. lastWeight stays: the projection
  // starts from it.
  const weightValues = [...trendMap.values(), ...projMap.values(), lastWeight, weightGoal]
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const weightMin = Math.min(...weightValues);
  const weightMax = Math.max(...weightValues);
  const weightPad = Math.max(0.5, (weightMax - weightMin) * 0.08);

  // The goal end gets no padding: the projection stops there and nothing is ever
  // plotted past it, so padding reserved a band of chart with nothing in it — a
  // 70 kg goal was floored to 68, two empty kg below the lowest thing drawn. The
  // axis now ends on the goal itself, which is the line everything is read
  // against. Still floor/ceil'd to whole kg: the ticks below step by exactly 1
  // from these bounds, so a fractional goal would otherwise put every gridline
  // on a fractional number.
  // Only when the goal really is the extreme — a reading that overshoots it pads
  // normally, since then there IS something drawn beyond the goal to make room for.
  const yMin = weightMin < weightGoal
    ? Math.floor(weightMin - weightPad)
    : Math.floor(weightGoal);
  const yMax = weightMax > weightGoal
    ? Math.ceil(weightMax + weightPad)
    : Math.ceil(weightGoal);

  const scales = {
    x: {
      type: 'linear',
      // minRotation matches maxRotation so the labels sit at a fixed 45°, the
      // same as every other Health chart's date axis, instead of Chart.js
      // straightening them to horizontal whenever they happen to fit — which
      // made this one chart's axis read differently from the ones stacked
      // right below it, and flip angle as the window resized.
      ticks: { maxTicksLimit: 24, maxRotation: 45, minRotation: 45, autoSkip: true, callback: offsetToDateLabel },
    },
    y: {
      min: yMin,
      max: yMax,
      afterFit: fixTrendYAxisWidth,
      // Forced rather than left to Chart.js's auto step-size algorithm —
      // once min/max are explicit (needed to lock the BMI axis to this same
      // range), that algorithm stopped producing the clean constant 1kg
      // steps it used to; pinning it directly guarantees 94, 93, 92, 91, …
      // every time, independent of whatever heuristic picked the step before.
      ticks: { stepSize: 1, callback: maskedUnitTick('kg') },
    },
  };
  if (heightCm !== null) {
    scales.y1 = {
      // Left as the exact (non-rounded) BMI equivalent of yMin/yMax — this
      // is what keeps the axis a true twin of the weight axis, pixel for
      // pixel. Rounding these would reintroduce the earlier bug where a
      // given height on the chart read as the wrong BMI off this axis.
      min: computeBmi(yMin, heightCm),
      max: computeBmi(yMax, heightCm),
      position: 'right',
      afterFit: fixTrendYAxisWidth,
      grid: { drawOnChartArea: false },
      ticks: {
        stepSize: 1,
        // Chart.js's default ticks.includeBounds forces the exact min/max
        // onto the axis as extra labels even when they land off the clean
        // step grid (here: 25.3/33.2 alongside the evenly-stepped 27,28,29…)
        // — turned off so only the evenly-spaced ticks are shown.
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
        // Off, like every other Health Indicators chart. Chart.js draws the legend
        // inside the canvas, so a legend here left this chart's plot area ~30px
        // shorter than the rest of the section. Series are named in the tooltip.
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => offsetToDateLabel(items[0].parsed.x),
            label: maskedValueTooltipLabel,
          },
        },
      },
      scales,
    },
  });

  // No line for a drawable projection: the arrival date and days remaining are
  // already on the time meter, and the dashed segment shows the trajectory. etaEl
  // is left to the statuses above, which explain why there's no forecast at all.
}

// Weight (kg) in effect on each of `dates`: the most recent weigh-in on or
// before that day, carried forward. A BMR has to be computed for every day in
// the window, not only the days a weigh-in happens to land on. Days before the
// very first weigh-in fall back to that first reading — the closest thing on
// file — rather than dropping off the chart entirely.
function carryForwardWeightByDate(weightByDate, dates) {
  const weighInDates = [...weightByDate.keys()].sort();
  if (weighInDates.length === 0) return new Map();

  const carried = new Map();
  let next = 0;
  let current = weightByDate.get(weighInDates[0]);
  dates.forEach((date) => {
    while (next < weighInDates.length && weighInDates[next] <= date) {
      current = weightByDate.get(weighInDates[next]);
      next += 1;
    }
    carried.set(date, current);
  });
  return carried;
}

// Smallest half-span (kcal) the energy-balance y-axis is ever scaled to, so a
// stretch of days that are all deficits still leaves a visible band above the
// zero line to read them against, instead of pinning zero flush to the top of
// the plot area.
const ENERGY_BALANCE_AXIS_MIN_KCAL = 200;

// Fixed gridline spacing for that axis. Both bounds get rounded out to a multiple of
// it, so every label sits on a gridline and the two halves step identically.
// niceAxisBound was doing this before and its 1/1.2/1.5/2/2.5/3/4/5/6/8/10 ladder
// could land on e.g. 800, leaving one odd final tick among a run of 500s.
const ENERGY_BALANCE_TICK_KCAL = 250;

// "+320" / "-450" — the sign carries the entire meaning on this chart (a
// deficit vs a surplus), so a positive figure is shown with an explicit + in
// the tooltip rather than bare.
function withExplicitSign(value) {
  return value > 0 ? `+${value}` : String(value);
}

let wellnessEnergyBalanceChart = null;

// A day's bar color, scored against the plan line rather than just the sign of the
// balance: at or beyond the line is green, short of it but still on the goal's side
// of zero is gray — real progress, only less than planned — and the wrong side of
// zero is red. Hitting the line exactly counts as met, the same way withinCalorieBound
// treats its bound. With no plan set there's no middle band, so it falls back to the
// sign alone and behaves as it did before.
function energyBalanceColor(balance, isCut, planned) {
  const towardGoal = isCut ? balance < 0 : balance > 0;
  if (!towardGoal) return '#dc2626';
  if (planned === null) return '#16a34a';
  return (isCut ? balance <= planned : balance >= planned) ? '#16a34a' : '#9ca3af';
}

// The daily deficit WEEKLY_FAT_LOSS_KG implies — the same D the Health Formula
// Playground spells out as (Δm × ρ) / 7, from the one shared fat-density constant
// so the two can't quote different figures. Returned already signed to THIS
// chart's convention: a planned loss is a deficit and sits below zero, a planned
// gain flips above it. null when the setting is unset or zero (maintenance), since
// a line drawn on zero would just retrace the axis.
function plannedBalanceKcal() {
  const weeklyKg = getSetting('WEEKLY_FAT_LOSS_KG', null);
  if (weeklyKg === null || weeklyKg === 0) return null;
  return -Math.round((weeklyKg * GENERIC_KCAL_PER_KG_FAT) / 7);
}

// Per-day energy balance — what was eaten minus what was spent — with the
// body-fat change that balance implies on a twin right-hand axis.
//
// Spend is Mifflin-St Jeor BMR (Height/Birth Date/Sex plus that day's
// carried-forward weight) PLUS that day's own logged activity burn. No lifestyle
// multiplier on top — logged activity is already real kcal, NEAT included, so
// scaling BMR too would count the same movement twice. getCalorieBoundKcal is
// built the same way, so the two agree on any day activity hits the target.
//
// Negative is loss: a bar below zero is a deficit and reads as grams of fat lost
// off the right axis, above zero is a surplus and grams gained. This is the fat
// change your energy balance PREDICTS, which the Body Mass chart's own readings can
// be compared against.
//
// The COLORS follow the goal rather than the sign, which is why this chart is
// no longer titled "Calorie Deficit & Fat Loss": a deficit is only progress for
// someone heading down. Which side of zero the goal points to comes from
// getCalorieBoundKind — the same read the Caloric Intake bound uses — so the app's
// income/expense colors keep meaning "toward the goal" / "away from it" for both
// kinds of user instead of congratulating a bulker for undereating. Within the
// goal's side, the plan line splits green from gray (see energyBalanceColor): a day
// that met the planned deficit is green, one that moved the right way but fell short
// of it is gray, so falling behind the plan reads differently from going backwards.
//
// Maintenance is plain Mifflin-St Jeor and the density is fat's ~7,700 kcal/kg
// — both population constants rather than personal parameters — so the right
// axis reads "g fat" and the tooltip says "Expected fat". Grams is simply
// balance ÷ kcal-per-kg, a fixed linear rescale, which is exactly what makes
// the right axis a true twin of the left one.
function renderWellnessEnergyBalanceChart(entries) {
  const ctx = document.getElementById('wellness-energy-balance-chart');

  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  const weightEntries = entries.filter((e) => e.category === 'Weight' && e.amount !== null);
  const intakeEntries = entries.filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null);

  // Without a profile there's no maintenance figure, and without any weigh-in
  // there's no weight to feed it — either way the chart renders as its
  // explanatory empty state rather than a misleading partial one.
  const canCompute = haveProfile && weightEntries.length > 0;
  const labels = canCompute ? trailingDatesForCategory(intakeEntries, WELLNESS_METRICS_DAYS) : [];
  const weightForDate = carryForwardWeightByDate(weightByDateMap(weightEntries), labels);

  const intakeByDate = new Map();
  intakeEntries.forEach((e) => intakeByDate.set(e.date, (intakeByDate.get(e.date) || 0) + e.amount));

  // Per-day burn through the one shared rule, at that day's own carried-forward
  // weight — the same weight this chart's BMR term uses.
  const activityKcalByDate = new Map();
  entries.forEach((e) => {
    if ((e.category !== 'Activity' && e.category !== 'Activity; Calories') || e.amount === null) return;
    const kcal = activityEntryKcal(e, weightForDate.get(e.date) ?? null);
    activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
  });

  // Which side of zero is progress — a cut wants the bars below it, a gain
  // wants them above. Same read the Caloric Intake bound is built on, so the
  // two charts can't disagree about which direction the user is headed.
  const isCut = getCalorieBoundKind(entries) === 'max';

  const detailByDate = new Map();

  const balanceData = labels.map((date) => {
    // A day with no food logged isn't a day of eating nothing — it's a day
    // with no data, so it's an empty slot rather than a huge fake deficit.
    if (!intakeByDate.has(date)) return null;

    const intake = Math.round(intakeByDate.get(date));
    const maintenance = Math.round(mifflinStJeorBmr(weightForDate.get(date), heightCm, age, sex));
    const activity = Math.round(activityKcalByDate.get(date) || 0);
    const balance = intake - maintenance - activity;

    detailByDate.set(date, { intake, maintenance, activity, balance, massG: Math.round((balance / GENERIC_KCAL_PER_KG_FAT) * 1000) });
    return balance;
  });

  const values = balanceData.filter((v) => v !== null);
  const hasData = values.length > 0;

  // Folded into the axis range as well as drawn, so the plan dashes can't fall
  // outside the plot area on a stretch of days that all undershot them.
  const planned = hasData ? plannedBalanceKcal() : null;

  const maxDeficit = Math.max(0, ...values.map((v) => -v), planned === null ? 0 : -planned);
  const maxSurplus = Math.max(0, ...values, planned === null ? 0 : planned);
  const upToTick = (v) => Math.ceil(Math.max(v * 1.08, ENERGY_BALANCE_AXIS_MIN_KCAL) / ENERGY_BALANCE_TICK_KCAL)
    * ENERGY_BALANCE_TICK_KCAL;
  const yMin = -upToTick(maxDeficit);
  const yMax = upToTick(maxSurplus);

  // Half-thickness of each day's plan dash, as a fraction of the axis span so it
  // stays a hairline whatever range the axis covers.
  const plannedHalf = (yMax - yMin) * 0.004;

  // balanceData already carries null for days with nothing logged, so those days sit
  // out of the mean rather than counting as a day of eating nothing.
  const weeklyAvg = weeklyAverageSeries(balanceData);

  wellnessEnergyBalanceChart = upsertChart(wellnessEnergyBalanceChart, ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Calorie balance',
          data: balanceData,
          backgroundColor: balanceData.map((v) => energyBalanceColor(v, isCut, planned)),
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg),
        // One dash per day rather than a line spanning the window — the same idiom
        // the Caloric Intake chart uses for its bound, and for the same reason: a
        // continuous line reads as one shared limit, while a mark sitting on each
        // bar says the target belongs to that day. Built as a floating bar
        // (`[from, to]`) with `grouped: false` so it overlays its bar instead of
        // being placed beside it, and a hairline thickness scaled to the axis span.
        // Red like every other target mark here, not a colour of its own.
        ...(planned === null ? [] : [{
          type: 'bar',
          label: 'Planned for the day',
          data: labels.map(() => [planned - plannedHalf, planned + plannedHalf]),
          // boundMarkColor, like every other reference mark in the section.
          backgroundColor: boundMarkColor(),
          grouped: false,
          isBoundMarker: true,
          // Lowest order paints last, so the dash stays visible on a day whose bar
          // overshoots it.
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
          // The plan dashes are filtered out as their own tooltip row — a floating
          // bar would report itself as a `[from, to]` pair — so hovering a day
          // reports that day's balance and nothing else, exactly as it did before
          // the dashes existed.
          filter: (item) => !item.dataset.isBoundMarker && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // The whole point of the chart is the subtraction, so every term
            // of it is spelled out on hover — a bare "-450" wouldn't show
            // which of eating less or moving more produced it.
            label: (item) => {
              const d = detailByDate.get(item.label);
              if (!d) return '';
              // Named to pair with the "Planned deficit" row directly below it, and
              // last of the body rows for the same reason — the two figures the bar's
              // colour compares should sit together. Follows the sign the way that row
              // does: a day that ate over maintenance reports an actual SURPLUS, since
              // calling it a deficit would contradict the + in front of it.
              const actualWord = d.balance > 0 ? 'Surplus' : 'Deficit';
              const lines = [
                `Eaten: ${d.intake} kcal`,
                `Maintenance: ${d.maintenance} kcal`,
                `Activity: ${d.activity} kcal`,
                `Expected Fat: ${withExplicitSign(d.massG)} g`,
                `Actual ${actualWord}: ${withExplicitSign(d.balance)} kcal`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // D from the Health Formula Playground — the daily energy deficit the
            // weekly fat-loss goal implies. Last, and via afterBody so it sits flush
            // with the date rather than indented behind the swatch, matching how
            // Caloric Intake states its own bound. Signed like every other figure
            // here, so it reads off the axis where its dash is drawn: a deficit is
            // negative, a planned gain positive.
            afterBody: (items) => {
              const lines = [];
              if (planned !== null) {
                const word = planned < 0 ? 'Deficit' : 'Surplus';
                lines.push(`Planned ${word}: ${withExplicitSign(planned)} kcal/day`);
              }
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`7-Day Average: ${withExplicitSign(Math.round(weeklyAvg[i]))} kcal`);
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
          // Zero is the line the whole chart is read against — deficit below
          // it, surplus above — so it's drawn in the (theme-aware) tick-label
          // color instead of receding into the ordinary gridlines. Evaluated
          // at draw time, so a theme switch recolors it correctly.
          grid: { color: (ctx) => (ctx.tick.value === 0 ? Chart.defaults.color : Chart.defaults.borderColor) },
          // autoSkip off so every 250 really is drawn — with it on, Chart.js drops
          // ticks when it thinks they're crowded, which reintroduces uneven spacing.
          ticks: { stepSize: ENERGY_BALANCE_TICK_KCAL, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
        y1: {
          // The gram equivalent of y's own bounds — a true twin axis, so zero
          // lines up with the kcal axis's zero and every bar can be read off
          // either side.
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

// Same-day duplicate weigh-ins averaged together, same as
// renderWellnessProjectionChart's weightByDate — one weight per logged date.
function weightByDateMap(weightEntries) {
  const sums = new Map();
  weightEntries.forEach((e) => {
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

// Chart.js has no built-in distribution plot, so this buckets `values` into
// `binCount` equal-width bins spanning their own min/max, then fits a normal
// curve to the same mean/stdev and scales it so its peak matches the
// histogram's tallest bar (the curve is a shape overlay, not a second count
// axis).
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

  // Bars are shown as a % of all days rather than raw counts, so the curve
  // overlay is scaled to the same peak percentage to keep its shape lined up.
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

// Net/signed tally of (actual shift − 8h) across "qualifying" entries: has a
// real Start/End (a missed weekday is excluded, not counted as -8h — no data
// isn't the same as leaving early), isn't today's still-possibly-in-progress
// shift, isn't a weekend (this app's Work Analytics already treats weekends
// as non-representative of an 8h/day baseline — a logged weekend shift simply
// doesn't count toward this tally either way, rather than partially counting
// against a baseline that was never expected on a weekend), and has a
// non-negative computed duration (guards a mis-keyed entry, same as the
// duration histogram above). `days` is a trailing window (or lifelong if
// falsy) — not calendar-aligned, matching averageDailyHours' periods.
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
  if (total.count === 0) return; // not enough logged full days yet — stay blank, same convention as .weight-eta

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

  // Weekends and holidays/off days aren't representative work shifts, and a
  // negative duration (end-before-start, or a break longer than the shift)
  // is a mis-keyed entry — exclude all of them so they can't skew the
  // histogram into bins that don't reflect a normal workday.
  const durations = worked
    .filter((e) => !isWeekend(e.date))
    .map((e) => computeDurationMinutes(e.start, e.end, e.breakMinutes) / 60)
    .filter((h) => h >= 0);
  renderDistributionChart('timesheet-duration-distribution-chart', buildDistribution(durations, 10, (h) => `${h.toFixed(1)}h`));
}

function isHolidayEntry(entry) {
  return !!entry && !entry.start && !entry.end && !!entry.task;
}

// Total worked hours within the trailing `days` (or, for the lifelong
// period, since the first logged entry) divided by the working days that
// have elapsed in that window — weekends and marked holidays/days off are
// excluded from both the numerator and the denominator, so they don't pull
// the average down. A weekday with no entry at all still counts as a
// working day with 0 hours (it's a missed log, not time off).
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

// Combines a Travel row's Date + Time columns into a single instant (ms),
// so a same-day round trip (e.g. a border town visited for a few hours)
// nets a real sub-day duration instead of rounding down to exactly 0 just
// because both events share a calendar date. Falls back to midnight when
// Time is blank. timeToMinutes() is defined in timesheet.js — safe to call
// here since this only runs once the whole page (all script tags) has
// loaded, regardless of file order.
function travelInstant(t) {
  const date = new Date(t.date);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = timeToMinutes(t.time) || 0;
  return date.getTime() + minutes * 60000;
}

// Travel!A2:H is a chronological log of Arrival/Departure events, not
// pre-computed stays. An Arrival opens a stay in that country; the next
// Departure (regardless of its own country/city, since it's always wherever
// that stay was) closes it and its date difference is credited to the
// country the stay opened in. A trailing Arrival with no following Departure
// (the most recent entry) is still an ongoing stay, credited up to today.
//
// The log only starts at the first trip ever taken, so the years lived in
// the home country before that first Departure would otherwise be dropped
// entirely. If a birthDate is supplied (Settings!BIRTH_DATE) and the very
// first row is a Departure, that's treated as if an Arrival had opened a stay
// in that same country on the birth date.
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

