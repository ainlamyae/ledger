// Finance Chart page. Every figure comes from the Transaction tab: parsed once in
// buildFinanceChartData, then drawn by one renderer per chart.

// ---------------------------------------------------------------------------
// Periods and steps
// ---------------------------------------------------------------------------

// The four complete periods (all before this month). `months` turns a total into a
// monthly average (Lifelong: the months it covers); `alpha` shades its bar;
// `slug` names its donut canvases. Insight reads these too.
const FINANCE_PERIODS = [
  { key: 'lastMonth', label: 'Last Month', months: 1, alpha: 1, slug: 'lastmonth' },
  { key: 'lastQuarter', label: 'Last Quarter', months: 3, alpha: 0.7, slug: 'quarter' },
  { key: 'lastYear', label: 'Last Year', months: 12, alpha: 0.45, slug: 'year' },
  { key: 'lifelong', label: 'Lifelong', months: null, alpha: 0.25, slug: 'lifelong' },
];

// A period total as a monthly average.
function spendingMonthlyAverage(totals, period, lifelongMonths) {
  return totals[period.key] / (period.months || lifelongMonths || 1);
}

// The Range row: how far back, and the step the trend bars sum by.
const FINANCE_TREND_RANGES = [
  { slug: '3m', label: '3m', months: 3, step: 'week' },
  { slug: '6m', label: '6m', months: 6, step: 'week' },
  { slug: '1y', label: '1y', months: 12, step: 'month' },
  { slug: '5y', label: '5y', months: 60, step: 'quarter' },
  { slug: 'all', label: 'All', step: 'quarter' },
];
let financeTrendRangeSlug = '1y';

// start: the step holding a date (weeks start Monday); next: the one after.
const FINANCE_TREND_STEPS = {
  week: {
    start: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)),
    next: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7),
  },
  month: {
    start: (d) => new Date(d.getFullYear(), d.getMonth(), 1),
    next: (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
  },
  quarter: {
    start: (d) => new Date(d.getFullYear(), d.getMonth() - (d.getMonth() % 3), 1),
    next: (d) => new Date(d.getFullYear(), d.getMonth() + 3, 1),
  },
};

// The picked range's step and its first step start (All: the first transaction's).
function financeTrendWindow(firstDate) {
  const range = FINANCE_TREND_RANGES.find((r) => r.slug === financeTrendRangeSlug);
  const step = FINANCE_TREND_STEPS[range.step];
  const now = new Date();
  const from = range.months
    ? new Date(now.getFullYear(), now.getMonth() - range.months, now.getDate())
    : dateFromIso(firstDate);
  return { step, start: step.start(from) };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const toCents = (value) => Math.round(value * 100) / 100;
const monthStartIso = (back) => {
  const now = new Date();
  return isoFromDate(new Date(now.getFullYear(), now.getMonth() - back, 1));
};

// Transaction rows (A:F) with a real date, oldest first. Amount: + income, − spend.
function parseChartTransactions(rows) {
  return rows
    .map((row) => ({
      date: cellText(row[0]).slice(0, 10),
      category: cellText(row[3]).trim(),
      description: cellText(row[4]),
      amount: Number(row[5]) || 0,
    }))
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Running total, one point per day from the first transaction to today (or a
// later dated one), so each deposit shows on its own day.
function netWorthByDay(transactions) {
  if (transactions.length === 0) return [];
  const byDay = new Map();
  transactions.forEach((t) => byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount));

  const today = isoFromDate(new Date());
  const last = transactions.at(-1).date > today ? transactions.at(-1).date : today;
  const points = [];
  let cumulative = 0;
  for (let d = dateFromIso(transactions[0].date); isoFromDate(d) <= last; d.setDate(d.getDate() + 1)) {
    const date = isoFromDate(d);
    cumulative += byDay.get(date) || 0;
    points.push({ date, cumulative: toCents(cumulative) });
  }
  return points;
}

// Each logged day's income (every positive amount) and net spend per category.
function spendByDay(transactions) {
  const byDay = new Map();
  transactions.forEach((t) => {
    if (!byDay.has(t.date)) byDay.set(t.date, { date: t.date, income: 0, spend: {} });
    const day = byDay.get(t.date);
    if (t.amount > 0) day.income += t.amount;
    day.spend[t.category] = (day.spend[t.category] || 0) - t.amount;
  });
  return [...byDay.values()];
}

// The Breakdown Type a Description starts with (whole word, any case); '' if none.
// `typeNames` is longest first, so "Kitchen Tools" wins over "Kitchen".
function transactionType(description, typeNames) {
  const text = description.trim().toLowerCase();
  return typeNames.find((name) => {
    const lower = name.toLowerCase();
    return text.startsWith(lower) && !/[a-z0-9]/.test(text.charAt(lower.length));
  }) || '';
}

// Breakdown's A:B rows as category -> its Type names, longest first.
function typeNamesByCategory(typeNameRows) {
  const names = new Map();
  typeNameRows.forEach((row) => {
    const category = cellText(row[0]).trim();
    const type = cellText(row[1]).trim();
    if (!category || !type) return;
    if (!names.has(category)) names.set(category, []);
    names.get(category).push(type);
  });
  names.forEach((list) => list.sort((a, b) => b.length - a.length));
  return names;
}

// Spend (positive) per category and per Type over the four complete periods:
// { category: { total: {lastMonth, …}, types: [{ name, lastMonth, … }] } }.
function spendByPeriod(transactions, typeNames) {
  const thisMonth = monthStartIso(0);
  const starts = FINANCE_PERIODS.map((p) => [p.key, p.months ? monthStartIso(p.months) : '']);
  const blank = () => Object.fromEntries(FINANCE_PERIODS.map((p) => [p.key, 0]));
  const add = (totals, t) => starts.forEach(([key, start]) => { if (t.date >= start) totals[key] -= t.amount; });
  const cents = (totals) => Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, toCents(v)]));

  const byCategory = new Map();
  transactions.forEach((t) => {
    if (!t.category || t.date >= thisMonth) return;
    if (!byCategory.has(t.category)) byCategory.set(t.category, { total: blank(), types: new Map() });
    const entry = byCategory.get(t.category);
    add(entry.total, t);
    const type = transactionType(t.description, typeNames.get(t.category) || []);
    if (!type) return;
    if (!entry.types.has(type)) entry.types.set(type, blank());
    add(entry.types.get(type), t);
  });

  const result = {};
  byCategory.forEach((entry, category) => {
    result[category] = {
      total: cents(entry.total),
      // A Type with no lifelong spend would only clutter the donuts.
      types: [...entry.types].map(([name, totals]) => ({ name, ...cents(totals) })).filter((t) => t.lifelong),
    };
  });
  return result;
}

// Complete months from the first transaction's to last month: Lifelong's divisor.
function lifelongMonthCount(transactions) {
  const first = transactions.find((t) => t.date < monthStartIso(0));
  if (!first) return 0;
  const [y, m] = first.date.split('-').map(Number);
  const now = new Date();
  return (now.getFullYear() - y) * 12 + now.getMonth() + 1 - m;
}

// Everything the Chart page (and Insight) draws. `categoryNames` are the spending
// categories, ranked here by lifelong spend and given hues spread round the wheel.
function buildFinanceChartData(transactionRows, typeNameRows, categoryNames) {
  const transactions = parseChartTransactions(transactionRows);
  const typeBreakdown = spendByPeriod(transactions, typeNamesByCategory(typeNameRows));
  const lifelongOf = (name) => Math.abs(typeBreakdown[name]?.total.lifelong || 0);

  const categories = [...categoryNames]
    .sort((a, b) => lifelongOf(b) - lifelongOf(a))
    .map((name, i, all) => ({ name, color: seriesColor(Math.round((i * 360) / all.length)) }));

  // Positive period totals per category, in rank order.
  const categoryComparison = categories.map((c) => ({
    ...c,
    ...Object.fromEntries(FINANCE_PERIODS.map((p) => [p.key, Math.abs(typeBreakdown[c.name]?.total[p.key] || 0)])),
  }));

  const netWorthDays = netWorthByDay(transactions);
  return {
    netWorthDays,
    // What the account balances should add up to.
    transactionTotal: netWorthDays.at(-1)?.cumulative || 0,
    trend: { categories, days: spendByDay(transactions) },
    categoryComparison,
    typeBreakdown,
    lifelongMonths: lifelongMonthCount(transactions),
  };
}

// ---------------------------------------------------------------------------
// Shared drawing
// ---------------------------------------------------------------------------

// Every chart on the page by canvas id, so a redraw replaces the old one.
const financeCharts = {};

function drawFinanceChart(canvasId, config) {
  financeCharts[canvasId] = upsertChart(financeCharts[canvasId], document.getElementById(canvasId), config);
  return financeCharts[canvasId];
}

function clearFinanceChart(canvasId) {
  financeCharts[canvasId]?.destroy();
  delete financeCharts[canvasId];
}

// "Name: $1,234.00 (12.3%)" of `total`; the percentage masks with the amounts.
function financeShareLabel(name, value, total) {
  const pct = total ? ((value / total) * 100).toFixed(1) : '0.0';
  return `${name}: ${formatCurrency(value)} (${privacyMode ? maskDigits(pct) : pct}%)`;
}

// Legend-less doughnut options whose hover reads each slice as a share of `total`.
function financeDonutOptions(total, nameOf = (item) => item.label) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { title: () => '', label: (item) => financeShareLabel(nameOf(item), item.raw, total) } },
    },
  };
}

function drawFinanceDonut(canvasId, labels, values, colors) {
  const total = values.reduce((sum, v) => sum + v, 0);
  drawFinanceChart(canvasId, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
    options: financeDonutOptions(total),
  });
}

// The filled blue running-total line, smoothed; `monotone` stops overshoot.
function netWorthLineDataset(points) {
  return {
    label: 'Cumulative Net Worth',
    data: points.map((p) => p.cumulative),
    borderColor: chartColor('--chart-blue'),
    backgroundColor: chartColor('--chart-blue', 0.1),
    fill: true,
    tension: 0.3,
    cubicInterpolationMode: 'monotone',
    pointRadius: 0,
  };
}

// Hover title: the date, as on the x axis.
const datedTooltipTitle = (items) => (items.length ? formatIsoDateShort(items[0].label) : '');

const netWorthTooltip = { callbacks: { title: datedTooltipTitle, label: (item) => `${item.dataset.label}: ${formatCurrency(item.raw)}` } };

// ---------------------------------------------------------------------------
// Trend charts (Range row)
// ---------------------------------------------------------------------------

// Draws the range buttons and the two charts they window.
function renderFinanceTrendCharts(report) {
  renderRangeButtons('finance-trend-range', FINANCE_TREND_RANGES, financeTrendRangeSlug, (slug) => {
    financeTrendRangeSlug = slug;
    renderFinanceTrendCharts(report);
  });
  renderSavingsTrendChart(report.netWorthDays);
  renderExpenseBreakdownTrendChart(report.trend);
}

// Cumulative Net Worth: daily points.
function renderSavingsTrendChart(allDays) {
  const canvasId = 'savings-trend-chart';
  if (allDays.length === 0) return clearFinanceChart(canvasId);

  const startIso = isoFromDate(financeTrendWindow(allDays[0].date).start);
  const days = allDays.filter((d) => d.date >= startIso);
  const dates = days.map((d) => d.date);

  drawFinanceChart(canvasId, {
    type: 'line',
    data: { labels: dates, datasets: [netWorthLineDataset(days)] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: netWorthTooltip },
      scales: {
        x: datedCategoryXScale(dates),
        y: { beginAtZero: false, afterFit: fixTrendYAxisWidth, ticks: { callback: formatCurrency } },
      },
    },
  });
}

// The range's steps through today, each summing its days' income and spend.
function expenseTrendSteps({ categories, days }) {
  const { step, start } = financeTrendWindow(days[0].date);
  const lastStep = step.start(new Date());
  const steps = [];
  let i = 0;
  for (let d = start; d <= lastStep; d = step.next(d)) {
    const from = isoFromDate(d);
    const to = isoFromDate(step.next(d));
    let income = 0;
    const spend = {};
    while (i < days.length && days[i].date < from) i += 1;
    for (; i < days.length && days[i].date < to; i += 1) {
      income += days[i].income;
      Object.entries(days[i].spend).forEach(([name, v]) => { spend[name] = (spend[name] || 0) + v; });
    }
    steps.push({
      date: isoFromDate(d),
      income: toCents(income),
      // A refund-heavy step nets below zero, which a stacked bar can't draw.
      spend: categories.map((c) => Math.max(0, toCents(spend[c.name] || 0))),
    });
  }
  return steps;
}

// Stacked spend per step with that step's income as a line across it, so
// "where did it go" and "was it more than came in" read off one chart.
function renderExpenseBreakdownTrendChart(trend) {
  const canvasId = 'expense-breakdown-trend-chart';
  if (trend.days.length === 0 || trend.categories.length === 0) return clearFinanceChart(canvasId);

  const steps = expenseTrendSteps(trend);
  const dates = steps.map((s) => s.date);
  // Same order as the datasets, so a legend index is its dataset index.
  const legendItems = [{ name: 'Income', color: desiredMarkColor() }, ...trend.categories];

  // No y max: Chart.js fits the tallest step, and re-fits when a series is hidden.
  const chart = drawFinanceChart(canvasId, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [
        {
          type: 'line',
          label: 'Income',
          data: steps.map((s) => s.income),
          borderColor: desiredMarkColor(),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          // One flat figure per step, changing on the boundary between bars.
          stepped: 'middle',
          // Its own stack and drawn last: a line across the bars, not a storey on them.
          stack: 'income',
          order: 0,
        },
        ...trend.categories.map((c, ci) => ({
          label: c.name,
          data: steps.map((s) => s.spend[ci]),
          backgroundColor: c.color,
          order: 1,
        })),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: datedTooltipTitle } } },
      scales: {
        x: { ...datedCategoryXScale(dates), stacked: true },
        y: { stacked: true, beginAtZero: true, afterFit: fixTrendYAxisWidth, ticks: { callback: formatCurrency } },
      },
    },
  });

  // Chart.js' own hiding is enough: the x axis is time, so nothing else moves.
  const drawLegend = () => renderCategoryLegend('expense-breakdown-trend-legend', legendItems, {
    isHidden: (_, i) => !chart.isDatasetVisible(i),
    onToggle: (_, i) => {
      chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
      chart.update();
      drawLegend();
    },
  });
  drawLegend();
}

// The Finance glance's net worth: the line alone, no axes or grid; hover names the day.
function renderFinanceGlanceNetWorthChart(days) {
  drawFinanceChart('finance-glance-networth-chart', {
    type: 'line',
    data: { labels: days.map((d) => d.date), datasets: [netWorthLineDataset(days)] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: netWorthTooltip },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { display: false, grid: { display: false }, beginAtZero: false },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Period charts
// ---------------------------------------------------------------------------

// Kept for the page's life, so a choice survives each re-render and refresh.
const hiddenSpendingCategories = legendHiddenNames('spending-trend-legend');

// Average Monthly Spending by Category: four period bars per category.
function renderSpendingTrendChart(categories, lifelongMonths) {
  const canvasId = 'spending-trend-chart';
  // Drawn first, so the last category switched off can come back.
  renderToggleLegend('spending-trend-legend', categories, () => renderSpendingTrendChart(categories, lifelongMonths));

  // Filtered, not hidden: categories are the x axis, so hiding would leave a gap.
  const shown = categories.filter((c) => !hiddenSpendingCategories.has(c.name));
  if (shown.length === 0) return clearFinanceChart(canvasId);

  drawFinanceChart(canvasId, {
    type: 'bar',
    data: {
      labels: shown.map((c) => c.name),
      datasets: FINANCE_PERIODS.map((p) => ({
        label: p.label,
        data: shown.map((c) => spendingMonthlyAverage(c, p, lifelongMonths)),
        backgroundColor: shown.map((c) => hslWithAlpha(c.color, p.alpha)),
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // All four period bars stay; no toggle-on-click.
        legend: { onClick: () => {} },
        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${formatCurrency(item.raw)}` } },
      },
      scales: {
        // Every category named, tilting if it must.
        x: { ticks: { autoSkip: false }, border: { width: 3 } },
        y: { beginAtZero: true, ticks: { callback: formatCurrency } },
      },
    },
  });
}

// Spending Breakdown by Category: one donut per period.
function renderSpendingBreakdownCharts(categories) {
  FINANCE_PERIODS.forEach((p) => {
    const canvasId = `spending-breakdown-${p.slug}-chart`;
    if (categories.length === 0) return clearFinanceChart(canvasId);
    drawFinanceDonut(canvasId, categories.map((c) => c.name), categories.map((c) => c[p.key]), categories.map((c) => c.color));
  });
}

const typeBreakdownSlug = (category) => category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const typeBreakdownCanvasId = (slug, period) => `type-breakdown-${slug}-${period.slug}-chart`;

// One "<Category> by Type" card: heading, a donut per period, and a legend.
function buildTypeBreakdownSection(category, slug) {
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  };

  const section = make('div', 'panel-section card type-breakdown-category');
  section.id = `type-breakdown-${slug}-section`;
  const grid = make('div', 'donut-grid');
  FINANCE_PERIODS.forEach((p) => {
    const box = make('div', 'chart-box chart-box-donut');
    const canvas = make('canvas');
    canvas.id = typeBreakdownCanvasId(slug, p);
    box.appendChild(canvas);
    const item = make('div', 'donut-item');
    item.append(make('h4', '', p.label), box);
    grid.appendChild(item);
  });
  const legend = make('div', 'donut-legend');
  legend.id = `type-breakdown-${slug}-legend`;
  section.append(make('h3', '', `${category} by Type`), grid, legend);
  return section;
}

// A card per category with a named Type, biggest lifelong spend first: its Types
// as shares of its total, plus an "Untyped" slice for the rest.
function renderTypeBreakdownCharts(typeBreakdown) {
  const lifelongOf = (category) => Math.abs(typeBreakdown[category].total.lifelong || 0);
  const categories = Object.keys(typeBreakdown)
    .filter((category) => typeBreakdown[category].types.length > 0)
    .sort((a, b) => lifelongOf(b) - lifelongOf(a));

  const container = document.getElementById('type-breakdown-container');
  Object.keys(financeCharts).filter((id) => id.startsWith('type-breakdown-')).forEach(clearFinanceChart);
  container.innerHTML = '';
  container.hidden = categories.length === 0;

  const untypedColor = chartColor('--chart-neutral');
  categories.forEach((category) => {
    const { total, types: unsorted } = typeBreakdown[category];
    const slug = typeBreakdownSlug(category);
    container.appendChild(buildTypeBreakdownSection(category, slug));

    // Sorted once, so the legend and every donut share slice order and colours.
    const types = [...unsorted].sort((a, b) => Math.abs(b.lifelong) - Math.abs(a.lifelong));
    const colors = [...types.map((_, i) => seriesColor(Math.round((i * 360) / types.length))), untypedColor];
    const labels = [...types.map((t) => t.name), 'Untyped'];
    renderCategoryLegend(`type-breakdown-${slug}-legend`, labels.map((name, i) => ({ name, color: colors[i] })));

    FINANCE_PERIODS.forEach((p) => {
      const typed = types.reduce((sum, t) => sum + t[p.key], 0);
      const untyped = Math.max(0, (total[p.key] || typed) - typed);
      drawFinanceDonut(typeBreakdownCanvasId(slug, p), labels, [...types.map((t) => t[p.key]), untyped], colors);
    });
  });
}

// ---------------------------------------------------------------------------
// Account Allocation
// ---------------------------------------------------------------------------

// Kept for the page's life, so a choice survives each re-render and the next load.
const hiddenAccountTypes = legendHiddenNames('account-composition-legend');
const hiddenInstitutions = legendHiddenNames('account-composition-institution-legend');

// Outer-ring shades: an institution's largest account is the most opaque.
const ACCOUNT_SLICE_ALPHA = { first: 0.85, step: 0.15, min: 0.4 };

// Evenly spaced hues. The institution ring's half-step offset and deeper band keep
// its colours from matching the type ring's when the two counts are close.
const ACCOUNT_TYPE_BAND = { offset: 0 };
const ACCOUNT_INSTITUTION_BAND = { offset: 0.5, saturation: '--chart-ring-saturation', lightness: '--chart-ring-lightness' };

const accountTypeOf = (a) => a.type || 'Other';
const accountInstitutionOf = (a) => a.institution || 'Other';
const absBalance = (accounts) => accounts.reduce((sum, a) => sum + Math.abs(a.balance), 0);

function groupAccounts(accounts, keyOf) {
  const groups = new Map();
  accounts.forEach((a) => {
    const key = keyOf(a);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  });
  return groups;
}

// Group names by absolute balance, largest first; anything netting to zero dropped.
function rankedAccountGroups(accounts, keyOf) {
  return [...groupAccounts(accounts, keyOf)]
    .map(([name, group]) => ({ name, abs: absBalance(group), group }))
    .filter((g) => g.abs > 0)
    .sort((a, b) => b.abs - a.abs);
}

// Name -> colour, spread evenly round the wheel in `band`.
function accountColors(names, band) {
  return new Map(names.map((name, i) => [name, seriesColor(Math.round(((i + band.offset) * 360) / names.length) % 360, band)]));
}

// Nested doughnut: account type (inner), institution (middle) and account (outer,
// shaded from its institution's colour). Slices size on the ABSOLUTE balance, so a
// debt account still draws.
function renderAccountCompositionChart(accounts) {
  const canvasId = 'account-composition-chart';
  if (accounts.length === 0) return clearFinanceChart(canvasId);

  // Colours and legends from EVERY account, so hiding one neither recolours the
  // rest nor drops a name needed to switch it back on.
  const allTypes = rankedAccountGroups(accounts, accountTypeOf).map((g) => g.name);
  const allInstitutions = rankedAccountGroups(accounts, accountInstitutionOf).map((g) => g.name);
  const typeColors = accountColors(allTypes, ACCOUNT_TYPE_BAND);
  const institutionColors = accountColors(allInstitutions, ACCOUNT_INSTITUTION_BAND);

  const redraw = () => renderAccountCompositionChart(accounts);
  renderToggleLegend('account-composition-legend', allTypes.map((name) => ({ name, color: typeColors.get(name) })), redraw);
  renderToggleLegend('account-composition-institution-legend', allInstitutions.map((name) => ({ name, color: institutionColors.get(name) })), redraw);

  const shown = accounts.filter((a) => !hiddenAccountTypes.has(accountTypeOf(a)) && !hiddenInstitutions.has(accountInstitutionOf(a)));
  if (shown.length === 0) return clearFinanceChart(canvasId);

  // Outer to inner, the datasets' order.
  const rings = [0, 1, 2].map(() => ({ labels: [], values: [], colors: [] }));
  const [accountRing, institutionRing, typeRing] = rings;
  const addSlice = (ring, label, value, color) => {
    ring.labels.push(label);
    ring.values.push(value);
    ring.colors.push(color);
  };

  // Each ring nests inside the one outside it. Types keep their all-account rank,
  // so hiding one doesn't reshuffle the rest.
  const typeGroups = rankedAccountGroups(shown, accountTypeOf)
    .sort((a, b) => allTypes.indexOf(a.name) - allTypes.indexOf(b.name));
  typeGroups.forEach((type) => {
    addSlice(typeRing, type.name, type.abs, typeColors.get(type.name));
    rankedAccountGroups(type.group, accountInstitutionOf).forEach((institution) => {
      const color = institutionColors.get(institution.name);
      addSlice(institutionRing, institution.name, institution.abs, color);
      [...institution.group]
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .forEach((a, j) => {
          const alpha = Math.max(ACCOUNT_SLICE_ALPHA.min, ACCOUNT_SLICE_ALPHA.first - j * ACCOUNT_SLICE_ALPHA.step);
          addSlice(accountRing, a.name, Math.abs(a.balance), hslWithAlpha(color, alpha));
        });
    });
  });

  const total = typeRing.values.reduce((sum, v) => sum + v, 0);
  drawFinanceChart(canvasId, {
    type: 'doughnut',
    data: {
      labels: accountRing.labels,
      datasets: rings.map((ring) => ({ data: ring.values, backgroundColor: ring.colors, weight: 1 })),
    },
    options: {
      // Named from the hovered ring, not the account-ring labels.
      ...financeDonutOptions(total, (item) => rings[item.datasetIndex].labels[item.dataIndex]),
      // Otherwise one hover matches that index in all three rings.
      interaction: { mode: 'point' },
    },
  });
}
