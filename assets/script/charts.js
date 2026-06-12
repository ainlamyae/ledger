let incomeExpenseChart = null;

function renderIncomeExpenseChart(months) {
  const ctx = document.getElementById('income-expense-chart');
  if (incomeExpenseChart) incomeExpenseChart.destroy();

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
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, max: yMax },
      },
    },
  });
}

let spendingTrendChart = null;

function renderSpendingTrendChart(categories) {
  const ctx = document.getElementById('spending-trend-chart');
  if (spendingTrendChart) spendingTrendChart.destroy();
  if (categories.length === 0) return;

  spendingTrendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories.map((c) => c.name),
      datasets: [
        { label: 'Last Month', data: categories.map((c) => c.lastMonth), backgroundColor: '#1d4ed8' },
        { label: 'Last Quarter Average', data: categories.map((c) => c.quarterAvg), backgroundColor: '#3b82f6' },
        { label: 'Last Year Average', data: categories.map((c) => c.yearAvg), backgroundColor: '#93c5fd' },
        { label: 'Lifelong Average', data: categories.map((c) => c.lifelongAvg), backgroundColor: '#dbeafe' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
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
  const legend = document.getElementById('spending-breakdown-legend');
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

