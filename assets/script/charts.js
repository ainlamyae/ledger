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

// Fixed width for the y-axis label column on the three Trend charts, so
// their plot areas (and thus their y-axes) line up vertically even though
// each chart's values have a different number of digits.
const TREND_Y_AXIS_WIDTH = 64;

function fixTrendYAxisWidth(scale) {
  scale.width = TREND_Y_AXIS_WIDTH;
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

let incomeExpenseChart = null;

function renderIncomeExpenseChart(months) {
  const ctx = document.getElementById('income-expense-chart');
  if (incomeExpenseChart) incomeExpenseChart.destroy();

  renderCategoryLegend('income-expense-legend', [
    { name: 'Income', color: '#16a34a' },
    { name: 'Expenses', color: '#dc2626' },
  ]);

  incomeExpenseChart = new Chart(ctx, {
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
      scales: { y: { beginAtZero: true, afterFit: fixTrendYAxisWidth } },
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
        y: { stacked: true, beginAtZero: true, max: yMax, afterFit: fixTrendYAxisWidth },
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
  { key: 'quarterAvg', label: 'Last Quarter Average', alpha: 0.7, months: 3 },
  { key: 'yearAvg', label: 'Last Year Average', alpha: 0.45, months: 12 },
  { key: 'lifelongAvg', label: 'Lifelong Average', alpha: 0.25, months: null },
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
        y: { beginAtZero: true },
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

const TYPE_BREAKDOWN_CATEGORIES = ['Grocery', 'Household', 'Personal', 'Transportation', 'Housing'];
const TYPE_BREAKDOWN_PERIODS = [
  { key: 'lastMonth', suffix: 'lastmonth' },
  { key: 'lastQuarter', suffix: 'lastquarter' },
  { key: 'lastYear', suffix: 'lastyear' },
  { key: 'lifelong', suffix: 'lifelong' },
];
const TYPE_BREAKDOWN_OTHER_COLOR = '#9ca3af';

const typeBreakdownCharts = {};

// One donut per category per period (20 total), each showing that
// category's Types as a share of its overall total for that period.
// The gap between the category total (Insight's blank-Type row) and the
// sum of its named Types becomes an "Untyped" slice.
function renderTypeBreakdownCharts(typeBreakdown) {
  // Order each category's panel by absolute lifelong spend (highest first)
  // so the biggest-impact categories surface at the top of the section,
  // regardless of sign.
  const orderedCategories = [...TYPE_BREAKDOWN_CATEGORIES].sort((a, b) => {
    const lifelongA = Math.abs((typeBreakdown[a]?.total?.lifelong) || 0);
    const lifelongB = Math.abs((typeBreakdown[b]?.total?.lifelong) || 0);
    return lifelongB - lifelongA;
  });

  orderedCategories.forEach((category) => {
    const section = document.getElementById(`type-breakdown-${category.toLowerCase()}-section`);
    if (section) section.parentElement.appendChild(section);
  });

  orderedCategories.forEach((category) => {
    const data = typeBreakdown[category];
    if (!data) return;

    // Sort once by absolute lifelong spend (largest first) so the legend and
    // every period's donut share the same slice order and colors, regardless
    // of sign (e.g. a type that nets to refunds still ranks by its size).
    const types = [...data.types].sort((a, b) => Math.abs(b.lifelong) - Math.abs(a.lifelong));
    const colors = types.map((_, i) => `hsl(${Math.round((i * 360) / types.length)}, 65%, 55%)`);

    renderCategoryLegend(`type-breakdown-${category.toLowerCase()}-legend`, [
      ...types.map((t, i) => ({ name: t.name, color: colors[i] })),
      { name: 'Untyped', color: TYPE_BREAKDOWN_OTHER_COLOR },
    ]);

    TYPE_BREAKDOWN_PERIODS.forEach(({ key, suffix }) => {
      const canvasId = `type-breakdown-${category.toLowerCase()}-${suffix}-chart`;
      const ctx = document.getElementById(canvasId);
      if (typeBreakdownCharts[canvasId]) typeBreakdownCharts[canvasId].destroy();

      const typedTotal = types.reduce((sum, t) => sum + t[key], 0);
      const total = (data.total && data.total[key]) || typedTotal;
      const untyped = Math.max(0, total - typedTotal);

      const labels = [...types.map((t) => t.name), 'Untyped'];
      const values = [...types.map((t) => t[key]), untyped];
      const sliceColors = [...colors, TYPE_BREAKDOWN_OTHER_COLOR];

      typeBreakdownCharts[canvasId] = new Chart(ctx, {
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

  const peakCount = Math.max(...counts);
  const normalPdf = (x) => (sd ? (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - avg) ** 2) / (2 * sd ** 2)) : 0);
  const peakPdf = normalPdf(avg) || 1;
  const curve = counts.map((_, i) => (normalPdf(min + binWidth * (i + 0.5)) / peakPdf) * peakCount);

  return { labels, counts, curve };
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
        { type: 'bar', label: 'Days', data: dist.counts, backgroundColor: 'rgba(59, 130, 246, .5)', order: 2, maxBarThickness: WORK_PATTERN_BAR_THICKNESS },
        { type: 'line', label: 'Normal Distribution', data: dist.curve, borderColor: '#dc2626', pointRadius: 0, tension: .4, order: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { filter: (item) => item.dataset.label === 'Days', callbacks: { label: (item) => `${item.raw} day(s)` } },
      },
      scales: {
        x: { afterFit: fixWorkPatternXAxisHeight },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function renderTimesheetDistributionCharts(entries) {
  const worked = entries.filter((e) => e.start && e.end);

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
  while (cursor <= today) {
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
  if (savingsTrendChart) savingsTrendChart.destroy();

  savingsTrendChart = new Chart(ctx, {
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
      scales: { y: { beginAtZero: false, afterFit: fixTrendYAxisWidth } },
    },
  });
}

