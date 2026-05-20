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
      scales: { y: { beginAtZero: true } },
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
  const yMax = (sortedTotals[1] ?? sortedTotals[0]) * 1.2;

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
        y: { stacked: true, beginAtZero: true, max: yMax },
      },
    },
  });
}

let spendingTrendChart = null;

// Convert a category's hex color to rgba so each of the 4 period bars for a
// category shares its hue, distinguished by opacity (most recent = most opaque).
function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((ch) => ch + ch).join('') : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const SPENDING_TREND_PERIODS = [
  { key: 'lastMonth', label: 'Last Month', alpha: 1 },
  { key: 'quarterAvg', label: 'Last Quarter Average', alpha: 0.7 },
  { key: 'yearAvg', label: 'Last Year Average', alpha: 0.45 },
  { key: 'lifelongAvg', label: 'Lifelong Average', alpha: 0.25 },
];

// Renders the shared category-color swatch legend used under the
// Spending vs. Benchmarks and Spending Breakdown by Category charts.
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

function renderSpendingTrendChart(categories) {
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
        data: categories.map((c) => c[p.key]),
        backgroundColor: categories.map((c) => hexToRgba(c.color, p.alpha)),
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // Clicking a legend entry normally toggles that dataset's visibility —
        // keep all 4 period bars always visible and ignore legend clicks.
        legend: { onClick: () => {} },
      },
      scales: { x: { ticks: { display: false } }, y: { beginAtZero: true } },
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
  renderCategoryLegend('spending-breakdown-legend', categories);

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
              label: (item) => {
                const pct = total ? (item.raw / total * 100).toFixed(1) : '0.0';
                return `${item.label}: ${formatCurrency(item.raw)} (${pct}%)`;
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
  // Order each category's panel by lifelong spend (highest first) so the
  // biggest-impact categories surface at the top of the section.
  const orderedCategories = [...TYPE_BREAKDOWN_CATEGORIES].sort((a, b) => {
    const lifelongA = (typeBreakdown[a]?.total?.lifelong) || 0;
    const lifelongB = (typeBreakdown[b]?.total?.lifelong) || 0;
    return lifelongB - lifelongA;
  });

  orderedCategories.forEach((category) => {
    const section = document.getElementById(`type-breakdown-${category.toLowerCase()}-section`);
    if (section) section.parentElement.appendChild(section);
  });

  orderedCategories.forEach((category) => {
    const data = typeBreakdown[category];
    if (!data) return;

    // Sort once by lifelong spend (largest first) so the legend and every
    // period's donut share the same slice order and colors.
    const types = [...data.types].sort((a, b) => b.lifelong - a.lifelong);
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
                label: (item) => {
                  const pct = total ? (item.raw / total * 100).toFixed(1) : '0.0';
                  return `${item.label}: ${formatCurrency(item.raw)} (${pct}%)`;
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

const ACCOUNT_TYPE_PALETTE = ['#3b82f6', '#16a34a', '#f59e0b', '#dc2626', '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

// Nested doughnut: inner ring = totals per account type, outer ring = each
// individual account, shaded with its type's color. Slice sizes use the
// absolute balance so debt accounts (negative balances) still render as a
// normal positive-size slice rather than breaking the chart.
function renderAccountCompositionChart(accounts) {
  const ctx = document.getElementById('account-composition-chart');
  if (accountCompositionChart) accountCompositionChart.destroy();
  if (accounts.length === 0) return;

  const types = [];
  const byType = new Map();
  accounts.forEach((a) => {
    const type = a.type || 'Other';
    if (!byType.has(type)) {
      byType.set(type, []);
      types.push(type);
    }
    byType.get(type).push(a);
  });

  const typeColors = {};
  types.forEach((type, i) => { typeColors[type] = ACCOUNT_TYPE_PALETTE[i % ACCOUNT_TYPE_PALETTE.length]; });

  const accountLabels = [];
  const accountValues = [];
  const accountColors = [];
  const typeLabels = [];
  const typeValues = [];
  const typeColorList = [];

  types.forEach((type) => {
    const group = byType.get(type);
    typeLabels.push(type);
    typeValues.push(group.reduce((sum, a) => sum + Math.abs(a.balance), 0));
    typeColorList.push(typeColors[type]);

    group.forEach((a, i) => {
      accountLabels.push(a.name);
      accountValues.push(Math.abs(a.balance));
      accountColors.push(hexToRgba(typeColors[type], Math.max(0.35, 1 - i * 0.18)));
    });
  });

  const total = typeValues.reduce((sum, v) => sum + v, 0);

  renderCategoryLegend('account-composition-legend', types.map((t) => ({ name: t, color: typeColors[t] })));

  accountCompositionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: accountLabels,
      datasets: [
        { data: accountValues, backgroundColor: accountColors, labels: accountLabels, weight: 1 },
        { data: typeValues, backgroundColor: typeColorList, labels: typeLabels, weight: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const name = item.dataset.labels[item.dataIndex];
              const pct = total ? (item.raw / total * 100).toFixed(1) : '0.0';
              return `${name}: ${formatCurrency(item.raw)} (${pct}%)`;
            },
          },
        },
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
      scales: { y: { beginAtZero: false } },
    },
  });
}

let savingsRateChart = null;

function renderSavingsRateChart(months) {
  const ctx = document.getElementById('savings-rate-chart');
  if (savingsRateChart) savingsRateChart.destroy();

  savingsRateChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map((m) => m.label),
      datasets: [{
        label: 'Savings Rate',
        data: months.map((m) => m.rate),
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22, 163, 74, .1)',
        fill: 'origin',
        tension: 0.4,
        pointRadius: 0,
        segment: {
          borderColor: (ctx) => (ctx.p0.parsed.y <= 0 || ctx.p1.parsed.y <= 0) ? '#dc2626' : '#16a34a',
          backgroundColor: (ctx) => (ctx.p0.parsed.y <= 0 || ctx.p1.parsed.y <= 0) ? 'rgba(220, 38, 38, .1)' : 'rgba(22, 163, 74, .1)',
        },
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `Savings Rate: ${item.raw.toFixed(1)}% (Saved: ${formatCurrency(months[item.dataIndex].saved)})`,
          },
        },
      },
      scales: { y: { min: 0, max: 100, ticks: { callback: (value) => `${value}%` } } },
    },
  });
}

