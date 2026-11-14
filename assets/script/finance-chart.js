
// "Name: $1,234.00 (12.3%)" of `total`; the percentage masks with the amounts.
function financeShareLabel(name, value, total) {
  const pct = total ? (value / total * 100).toFixed(1) : '0.0';
  return `${name}: ${formatCurrency(value)} (${privacyMode ? maskDigits(pct) : pct}%)`;
}

// Legend-less doughnut options whose hover reads each slice as a share of `total`.
function financeDonutOptions(total, nameOf = (item) => item.label) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: () => '',
          label: (item) => financeShareLabel(nameOf(item), item.raw, total),
        },
      },
    },
  };
}

// The filled blue running-total line the glance and Savings charts share.
function cumulativeLineDataset(label, months) {
  return {
    label,
    data: months.map((m) => m.cumulative),
    borderColor: chartColor('--chart-blue'),
    backgroundColor: chartColor('--chart-blue', 0.1),
    fill: true,
    tension: 0.4,
    pointRadius: 0,
  };
}

let expenseBreakdownTrendChart = null;

// Stacked spend per month with that month's income as a line across it, so
// "where did it go" and "was it more than came in" read off one chart.
function renderExpenseBreakdownTrendChart(months) {
  const ctx = document.getElementById('expense-breakdown-trend-chart');
  if (months.length === 0) {
    if (expenseBreakdownTrendChart) expenseBreakdownTrendChart.destroy();
    return;
  }

  const categories = months[0].categories;

  // Same order as `datasets`, so a legend index is its dataset index.
  const legendItems = [{ name: 'Income', color: desiredMarkColor() }, ...categories];

  // No y max: Chart.js fits the tallest month, and re-fits when a series is hidden.
  expenseBreakdownTrendChart = upsertChart(expenseBreakdownTrendChart, ctx, {
    type: 'bar',
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        {
          type: 'line',
          label: 'Income',
          data: months.map((m) => Math.abs(m.income || 0)),
          borderColor: desiredMarkColor(),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          // A month's income is one flat figure: step halfway between months so
          // each run sits over its own bar and a change lands on the boundary.
          stepped: 'middle',
          // Its own stack, so it reads as a line across the bars, not a storey on them.
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
        y: { stacked: true, beginAtZero: true, afterFit: fixTrendYAxisWidth, ticks: { callback: formatCurrency } },
      },
    },
  });

  // Drawn after the chart, whose visibility it reads. Chart.js' own hiding is
  // enough here: the x axis is months, so a hidden series moves nothing else.
  const drawLegend = () => renderCategoryLegend('expense-breakdown-trend-legend', legendItems, {
    isHidden: (_, i) => !expenseBreakdownTrendChart.isDatasetVisible(i),
    onToggle: (_, i) => {
      expenseBreakdownTrendChart.setDatasetVisibility(i, !expenseBreakdownTrendChart.isDatasetVisible(i));
      expenseBreakdownTrendChart.update();
      drawLegend();
    },
  });
  drawLegend();
}

let spendingTrendChart = null;

// Divisors turning each period's total into a monthly average; Lifelong uses the
// real month count (see spendingMonthlyAverage).
const SPENDING_TREND_PERIODS = [
  { key: 'lastMonth', label: 'Last Month', alpha: 1, months: 1 },
  { key: 'quarterAvg', label: 'Last Quarter', alpha: 0.7, months: 3 },
  { key: 'yearAvg', label: 'Last Year', alpha: 0.45, months: 12 },
  { key: 'lifelongAvg', label: 'Lifelong', alpha: 0.25, months: null },
];

// Category `c`'s period total as a monthly average. Insight reads it too.
function spendingMonthlyAverage(c, period, totalMonths) {
  return c[period.key] / (period.months || totalMonths || 1);
}

// Kept for the page's life, so a choice survives each re-render and refresh.
const hiddenSpendingCategories = legendHiddenNames('spending-trend-legend');

function renderSpendingTrendChart(categories, totalMonths) {
  const ctx = document.getElementById('spending-trend-chart');
  if (spendingTrendChart) spendingTrendChart.destroy();

  // Drawn before the early return, so the last category switched off can come back.
  renderToggleLegend('spending-trend-legend', categories, () => renderSpendingTrendChart(categories, totalMonths));

  // Filtered out rather than hidden: categories are the x axis, so Chart.js'
  // per-index hiding would leave a labelled gap.
  const shown = categories.filter((c) => !hiddenSpendingCategories.has(c.name));
  if (shown.length === 0) return;

  spendingTrendChart = upsertChart(spendingTrendChart, ctx, {
    type: 'bar',
    data: {
      labels: shown.map((c) => c.name),
      datasets: SPENDING_TREND_PERIODS.map((p) => ({
        label: p.label,
        data: shown.map((c) => spendingMonthlyAverage(c, p, totalMonths)),
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
        y: { beginAtZero: true, ticks: { callback: formatCurrency } },
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
    if (categories.length === 0) {
      if (spendingBreakdownCharts[canvasId]) spendingBreakdownCharts[canvasId].destroy();
      return;
    }

    const data = categories.map((c) => c[key]);
    const total = data.reduce((sum, v) => sum + v, 0);

    spendingBreakdownCharts[canvasId] = upsertChart(spendingBreakdownCharts[canvasId], ctx, {
      type: 'doughnut',
      data: {
        labels: categories.map((c) => c.name),
        datasets: [{ data, backgroundColor: categories.map((c) => c.color) }],
      },
      options: financeDonutOptions(total),
    });
  });
}

const TYPE_BREAKDOWN_PERIODS = [
  { key: 'lastMonth', suffix: 'lastmonth', label: 'Last Month' },
  { key: 'lastQuarter', suffix: 'lastquarter', label: 'Last Quarter' },
  { key: 'lastYear', suffix: 'lastyear', label: 'Last Year' },
  { key: 'lifelong', suffix: 'lifelong', label: 'Lifelong' },
];

const typeBreakdownCharts = {};

const typeBreakdownSlug = (category) => category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const typeBreakdownCanvasId = (slug, suffix) => `type-breakdown-${slug}-${suffix}-chart`;

// One card: heading, four period donuts and a legend, built per category so the
// panels follow whatever categories Insight defines.
function buildTypeBreakdownSection(category, slug) {
  const section = document.createElement('div');
  section.className = 'panel-section card type-breakdown-category';
  section.id = `type-breakdown-${slug}-section`;

  const heading = document.createElement('h3');
  heading.textContent = `${category} by Type`;
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
    canvas.id = typeBreakdownCanvasId(slug, suffix);

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

// One donut per category per period: its named Types as shares of its total, plus
// an "Untyped" slice for the rest. Only categories with a named Type get a panel.
function renderTypeBreakdownCharts(typeBreakdown) {
  // By absolute lifelong spend, so the biggest movers surface first whatever their sign.
  const lifelongAbs = (category) => Math.abs(typeBreakdown[category].total?.lifelong || 0);
  const orderedCategories = Object.keys(typeBreakdown)
    .filter((category) => typeBreakdown[category].types.length > 0)
    .sort((a, b) => lifelongAbs(b) - lifelongAbs(a));

  const container = document.getElementById('type-breakdown-container');
  container.innerHTML = '';
  container.hidden = orderedCategories.length === 0;

  orderedCategories.forEach((category) => {
    const data = typeBreakdown[category];
    const slug = typeBreakdownSlug(category);

    container.appendChild(buildTypeBreakdownSection(category, slug));

    // Sorted once, so the legend and all four donuts share slice order and colours.
    const types = [...data.types].sort((a, b) => Math.abs(b.lifelong) - Math.abs(a.lifelong));
    const colors = types.map((_, i) => seriesColor(Math.round((i * 360) / types.length)));

    renderCategoryLegend(`type-breakdown-${slug}-legend`, [
      ...types.map((t, i) => ({ name: t.name, color: colors[i] })),
      { name: 'Untyped', color: chartColor('--chart-neutral') },
    ]);

    TYPE_BREAKDOWN_PERIODS.forEach(({ key, suffix }) => {
      const canvasId = typeBreakdownCanvasId(slug, suffix);
      const ctx = document.getElementById(canvasId);

      const typedTotal = types.reduce((sum, t) => sum + t[key], 0);
      const total = data.total?.[key] || typedTotal;
      const untyped = Math.max(0, total - typedTotal);

      const labels = [...types.map((t) => t.name), 'Untyped'];
      const values = [...types.map((t) => t[key]), untyped];
      const sliceColors = [...colors, chartColor('--chart-neutral')];

      typeBreakdownCharts[canvasId] = upsertChart(typeBreakdownCharts[canvasId], ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: sliceColors }] },
        options: financeDonutOptions(total),
      });
    });
  });
}

let accountCompositionChart = null;

// Kept for the page's life, so a choice survives each re-render and the next load.
const hiddenAccountTypes = legendHiddenNames('account-composition-legend');
const hiddenInstitutions = legendHiddenNames('account-composition-institution-legend');

// Outer-ring account shades: the largest account in an institution is most opaque.
const ACCOUNT_SLICE_ALPHA = { first: 0.85, step: 0.15, min: 0.4 };

// Nested doughnut: account type (inner), institution (middle, one colour each) and
// account (outer, shaded by institution). Slices size on the ABSOLUTE balance, so a
// debt account renders normally instead of breaking the chart.
function renderAccountCompositionChart(accounts) {
  const ctx = document.getElementById('account-composition-chart');
  if (accounts.length === 0) {
    if (accountCompositionChart) accountCompositionChart.destroy();
    return;
  }

  const absTotal = (list) => list.reduce((sum, a) => sum + Math.abs(a.balance), 0);
  const groupBy = (list, keyOf) => {
    const groups = new Map();
    list.forEach((a) => {
      const key = keyOf(a);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    });
    return groups;
  };

  // Largest absolute balance first; anything netting to zero is dropped.
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

  // Evenly spaced hues. The institution ring's half-step offset and deeper band keep
  // its colours from matching the type ring's when the two counts are similar.
  const TYPE_BAND = { offset: 0 };
  const INSTITUTION_BAND = { offset: 0.5, saturation: '--chart-ring-saturation', lightness: '--chart-ring-lightness' };
  const distinctColors = (count, band) => Array.from({ length: count }, (_, i) =>
    seriesColor(Math.round(((i + band.offset) * 360) / count) % 360, band));

  // Palettes and legends come from EVERY account, so hiding one neither recolours
  // the rest nor drops a name that's needed to switch it back on.
  const allTypes = rankedByAbs(accounts, typeOf);
  const allInstitutions = rankedByAbs(accounts, institutionOf);

  const typeColors = {};
  distinctColors(allTypes.length, TYPE_BAND).forEach((color, i) => { typeColors[allTypes[i]] = color; });

  const institutionColorMap = {};
  distinctColors(allInstitutions.length, INSTITUTION_BAND).forEach((color, i) => { institutionColorMap[allInstitutions[i]] = color; });

  // Drawn before the early return, so something is always left to switch back on.
  const redraw = () => renderAccountCompositionChart(accounts);
  renderToggleLegend('account-composition-legend', allTypes.map((t) => ({ name: t, color: typeColors[t] })), redraw);
  renderToggleLegend('account-composition-institution-legend', allInstitutions.map((name) => ({ name, color: institutionColorMap[name] })), redraw);

  // Rings are built only from accounts surviving both filters, so the hierarchy holds.
  const shown = accounts.filter((a) => !hiddenAccountTypes.has(typeOf(a)) && !hiddenInstitutions.has(institutionOf(a)));
  if (shown.length === 0) return;

  const byType = groupBy(shown, typeOf);
  const typeAbsTotals = new Map();
  byType.forEach((group, type) => typeAbsTotals.set(type, absTotal(group)));

  const types = allTypes.filter((type) => (typeAbsTotals.get(type) || 0) > 0);

  // Outer to inner, the datasets' order.
  const rings = [0, 1, 2].map(() => ({ labels: [], values: [], colors: [] }));
  const [accountRing, institutionRing, typeRing] = rings;
  const addSlice = (ring, label, value, color) => {
    ring.labels.push(label);
    ring.values.push(value);
    ring.colors.push(color);
  };

  types.forEach((type) => {
    const group = byType.get(type);
    addSlice(typeRing, type, typeAbsTotals.get(type), typeColors[type]);

    // Largest institution first, so the middle ring lines up with the outer one.
    const institutions = [...groupBy(group, institutionOf).entries()]
      .map(([name, accts]) => ({ name, accts, abs: absTotal(accts) }))
      .filter((institution) => institution.abs > 0)
      .sort((a, b) => b.abs - a.abs);

    institutions.forEach((institution) => {
      const color = institutionColorMap[institution.name];
      addSlice(institutionRing, institution.name, institution.abs, color);

      [...institution.accts]
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .forEach((a, j) => {
          const alpha = Math.max(ACCOUNT_SLICE_ALPHA.min, ACCOUNT_SLICE_ALPHA.first - j * ACCOUNT_SLICE_ALPHA.step);
          addSlice(accountRing, a.name, Math.abs(a.balance), hslWithAlpha(color, alpha));
        });
    });
  });

  const total = typeRing.values.reduce((sum, v) => sum + v, 0);

  accountCompositionChart = upsertChart(accountCompositionChart, ctx, {
    type: 'doughnut',
    data: {
      labels: accountRing.labels,
      datasets: rings.map((ring) => ({ data: ring.values, backgroundColor: ring.colors, weight: 1 })),
    },
    options: {
      // Named from the hovered ring, not the account-ring labels.
      ...financeDonutOptions(total, (item) => rings[item.datasetIndex].labels[item.dataIndex]),
      // Otherwise one hover matches that dataIndex in all three rings.
      interaction: { mode: 'point' },
    },
  });
}

let savingsTrendChart = null;

// The Finance glance's Cumulative Net Worth: the line alone, with no axes or grid.
// The hover still names the month and amount.
let financeGlanceNetWorthChart = null;

function renderFinanceGlanceNetWorthChart(months) {
  const ctx = document.getElementById('finance-glance-networth-chart');
  financeGlanceNetWorthChart = upsertChart(financeGlanceNetWorthChart, ctx, {
    type: 'line',
    data: {
      labels: months.map((m) => m.label),
      datasets: [cumulativeLineDataset('Cumulative Net Worth', months)],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => formatCurrency(item.raw) } },
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { display: false, grid: { display: false }, beginAtZero: false },
      },
    },
  });
}

// Statement is one row per month, so the ranges are whole months.
const FINANCE_TREND_RANGES = [
  { slug: '3m', label: '3m', months: 3 },
  { slug: '6m', label: '6m', months: 6 },
  { slug: '1y', label: '1y', months: 12 },
  { slug: '5y', label: '5y', months: 60 },
  { slug: 'all', label: 'All' },
];
let financeTrendRangeSlug = '1y';

function financeTrendMonths(months) {
  const range = FINANCE_TREND_RANGES.find((r) => r.slug === financeTrendRangeSlug);
  return range.months ? months.slice(-range.months) : months;
}

// Draws the range buttons and the two charts they window.
function renderFinanceTrendCharts(report) {
  renderRangeButtons('finance-trend-range', FINANCE_TREND_RANGES, financeTrendRangeSlug, (slug) => {
    financeTrendRangeSlug = slug;
    renderFinanceTrendCharts(report);
  });
  renderExpenseBreakdownTrendChart(financeTrendMonths(report.categoryTrend));
  renderSavingsTrendChart(financeTrendMonths(report.savingsTrend));
}

function renderSavingsTrendChart(months) {
  const ctx = document.getElementById('savings-trend-chart');

  savingsTrendChart = upsertChart(savingsTrendChart, ctx, {
    type: 'line',
    data: {
      labels: months.map((m) => m.label),
      datasets: [cumulativeLineDataset('Cumulative Savings', months)],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false, afterFit: fixTrendYAxisWidth, ticks: { callback: formatCurrency } } },
    },
  });
}
