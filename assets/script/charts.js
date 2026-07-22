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
  if (scale.width < TREND_Y_AXIS_WIDTH) scale.width = TREND_Y_AXIS_WIDTH;
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

// Standard estimate for 1kg of body fat — the same generic energy density
// calibration.js's un-calibrated formula and getCalorieTargetKcal() below
// both fall back to until the user's own history is fitted via Calibrate.
const GENERIC_KCAL_PER_KG_FAT = 7700;

function latestWeightKg(entries) {
  const weightEntries = entries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return weightEntries.length ? weightEntries[weightEntries.length - 1].amount : null;
}

// Protein's target can be a flat gram amount (PROTEIN_TARGET_G) or, if set,
// a per-kg multiplier (PROTEIN_TARGET_G_PER_KG) applied to the most
// recently logged Weight entry — e.g. 1.6 g/kg scales automatically as body
// weight changes instead of needing to be updated by hand whenever it does.
// The per-kg setting wins whenever it's present and a weight has been
// logged; otherwise this falls back to the flat gram target.
function getProteinTargetG(entries) {
  const perKg = getSetting('PROTEIN_TARGET_G_PER_KG', null);
  const weightKg = perKg !== null ? latestWeightKg(entries) : null;
  if (weightKg !== null) return Math.round(weightKg * perKg);
  return getSetting('PROTEIN_TARGET_G', PROTEIN_TARGET_G_DEFAULT);
}

// Calorie target can be a flat kcal amount (CALORIE_TARGET_KCAL) or, if
// HEIGHT_CM, BIRTH_DATE, SEX, ACTIVITY_MULTIPLIER, and WEEKLY_FAT_LOSS_KG
// are all set (and a Weight entry has been logged), a calculated one:
// Mifflin-St Jeor BMR × ACTIVITY_MULTIPLIER gives maintenance calories
// (TDEE), then a daily deficit sized to hit WEEKLY_FAT_LOSS_KG is
// subtracted — using the user's own calibrated energy density (the
// Calibrate button) once available, falling back to the generic 7,700
// kcal/kg otherwise, the same convention the Weight Trend & Forecast
// projection already uses. Missing any one input falls back to the flat
// CALORIE_TARGET_KCAL setting, same as protein above.
function getCalorieTargetKcal(entries) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const activityMultiplier = getSetting('ACTIVITY_MULTIPLIER', null);
  const weeklyFatLossKg = getSetting('WEEKLY_FAT_LOSS_KG', null);
  const weightKg = latestWeightKg(entries);

  const haveAllInputs = heightCm !== null && age !== null && (sex === 'male' || sex === 'female')
    && activityMultiplier !== null && weeklyFatLossKg !== null && weightKg !== null;

  if (haveAllInputs) {
    const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
    const tdee = bmr * activityMultiplier;
    const gains = getCalibratedGains();
    const kcalPerKg = (gains && gains.betaCal > 0) ? 1 / gains.betaCal : GENERIC_KCAL_PER_KG_FAT;
    const dailyDeficit = (weeklyFatLossKg * kcalPerKg) / 7;
    return Math.round(tdee - dailyDeficit);
  }

  return getSetting('CALORIE_TARGET_KCAL', CALORIE_TARGET_KCAL_DEFAULT);
}

// Number of trailing days shown in the Health Metrics row (Caloric Intake,
// Physical Activity, Rest & Recovery) — Body Weight has its own dedicated
// history in the Weight Trend & Forecast chart below, so it's not repeated
// here, and these 3 charts get the freed-up width to show more days.
const WELLNESS_METRICS_DAYS = 14;

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

function renderWellnessCharts(entries) {
  renderTodayGlanceCards(entries);
  renderWellnessCaloriesChart(entries);
  renderWellnessSleepChart(entries);
  renderWellnessActivityChart(entries);
  renderWellnessProteinChart(entries);
  renderWellnessProjectionChart(entries);
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
      if (e.category === 'Activity' && e.amount !== null) {
        activityMins = (activityMins ?? 0) + toActivityMinutes(e.amount, e.unit);
      }
      if (e.category === 'Sleep' && e.amount !== null) {
        sleepHours = (sleepHours ?? 0) + e.amount;
      }
    });
  if (sleepHours !== null) sleepHours = Math.round(sleepHours * 10) / 10;

  const calorieTarget = getCalorieTargetKcal(entries);
  const proteinTarget = getProteinTargetG(entries);
  const activityTarget = getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT);
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  // Which direction is "good" differs per metric: at/under target is the
  // win for Calories (a deficit target), at/over target is the win for
  // Protein/Activity/Sleep.
  setTodayGlanceTile('today-calories', calories, calorieTarget, 'kcal', calories !== null && calories <= calorieTarget);
  setTodayGlanceTile('today-protein', protein, proteinTarget, 'g', protein !== null && protein >= proteinTarget);
  setTodayGlanceTile('today-activity', activityMins, activityTarget, 'min', activityMins !== null && activityMins >= activityTarget);
  setTodayGlanceTile('today-sleep', sleepHours, sleepTarget, 'hr', sleepHours !== null && sleepHours >= sleepTarget);
}

function setTodayGlanceTile(idPrefix, value, target, unit, isGood) {
  const el = document.getElementById(`${idPrefix}-value`);
  el.classList.remove('income', 'expense');

  const text = `${value !== null ? value : '—'} / ${target} ${unit}`;
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

function renderWellnessCaloriesChart(entries) {
  const ctx = document.getElementById('wellness-calories-chart');

  const calorieTarget = getCalorieTargetKcal(entries);

  const dates = lastNDates(WELLNESS_METRICS_DAYS);
  const byDate = new Map();
  entries
    .filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null)
    .forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  wellnessCaloriesChart = upsertChart(wellnessCaloriesChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Calories',
          data: dates.map((d) => byDate.get(d) || 0),
          backgroundColor: '#f59e0b',
          order: 2,
        },
        {
          type: 'line',
          label: `${calorieTarget} kcal target`,
          data: new Array(WELLNESS_METRICS_DAYS).fill(calorieTarget),
          borderColor: '#dc2626',
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: maskedValueTooltipLabel } },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7 } },
        y: {
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

function renderWellnessSleepChart(entries) {
  const ctx = document.getElementById('wellness-sleep-chart');

  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  const dates = lastNDates(WELLNESS_METRICS_DAYS);
  const byDate = new Map();
  entries
    .filter((e) => e.category === 'Sleep' && e.amount !== null)
    .forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  const sleepData = dates.map((d) => byDate.get(d) || 0);

  wellnessSleepChart = upsertChart(wellnessSleepChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Sleep',
          data: sleepData,
          backgroundColor: '#6366f1',
          order: 2,
        },
        {
          type: 'line',
          label: `${sleepTarget} hr target`,
          data: new Array(WELLNESS_METRICS_DAYS).fill(sleepTarget),
          borderColor: '#dc2626',
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: maskedValueTooltipLabel } },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7 } },
        y: {
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('hr') },
        },
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

// weightKg / heightM² — computed here (not asked of any LLM) since it's
// shared by the Weight Trend & Forecast chart's BMI line and insight.js's
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

function renderWellnessActivityChart(entries) {
  const ctx = document.getElementById('wellness-activity-chart');

  const activityTarget = getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT);

  const dates = lastNDates(WELLNESS_METRICS_DAYS);
  const activityEntries = entries.filter((e) => e.category === 'Activity' && e.amount !== null);

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

  const descriptionColors = descriptions.map((_, i) => `hsl(${Math.round((i * 360) / descriptions.length)}, 65%, 55%)`);

  const activityDatasets = descriptions.map((d, i) => ({
    type: 'bar',
    label: shortActivityLabel(d),
    data: dates.map((date) => byDescription.get(d).get(date) || 0),
    backgroundColor: descriptionColors[i],
    stack: 'activity',
    order: 2,
  }));

  const hasData = activityDatasets.some((ds) => ds.data.some((v) => v > 0));

  wellnessActivityChart = upsertChart(wellnessActivityChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        ...activityDatasets,
        {
          type: 'line',
          label: `${activityTarget} min target`,
          data: new Array(WELLNESS_METRICS_DAYS).fill(activityTarget),
          borderColor: '#dc2626',
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        // No legend — the small chart-box-donut area doesn't have room for
        // one; hover the stacked segments (tooltip) to see each description.
        legend: { display: false },
        title: {
          display: !hasData,
          text: 'No activity logged yet — add a Walk, Run, or Workout entry to get started',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: { callbacks: { label: maskedValueTooltipLabel } },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7 } },
        y: {
          stacked: true,
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('min') },
        },
      },
    },
  });
}

function renderWellnessProteinChart(entries) {
  const ctx = document.getElementById('wellness-protein-chart');

  const proteinTarget = getProteinTargetG(entries);

  const dates = lastNDates(WELLNESS_METRICS_DAYS);
  const byDate = new Map();
  entries
    .filter((e) => e.category === 'Calories; Protein' && e.amount2 !== null)
    .forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount2));

  wellnessProteinChart = upsertChart(wellnessProteinChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Protein',
          data: dates.map((d) => byDate.get(d) || 0),
          backgroundColor: '#0ea5e9',
          order: 2,
        },
        {
          type: 'line',
          label: `${proteinTarget} g target`,
          data: new Array(WELLNESS_METRICS_DAYS).fill(proteinTarget),
          borderColor: '#dc2626',
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: maskedValueTooltipLabel } },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7 } },
        y: {
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('g') },
        },
      },
    },
  });
}

function linearRegressionSlope(xs, ys) {
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

// Average of a Map's values (e.g. calories/activity/sleep summed per logged
// date) — averaged over days that actually HAVE a log, not the calendar
// length of the window. calibration.js's fit must use this exact semantics
// when building its training averages, or the calibrated coefficients end up
// tuned against a different quantity than calcProjection() feeds them here.
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
// Forecast chart's "Weight Trend" line.
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

// A slope this large (kg/day) is well outside anything physiologically real
// — a backstop so a noisy calibrated coefficient extrapolating past its
// training data's range can't produce a runaway projection.
const PROJ_SLOPE_CLAMP_KG_PER_DAY = 0.15;

// Reads the 4 gains calibration.js's "Calibrate" flow can write to the
// Settings tab. Returns null unless all 4 are present, so calcProjection()
// falls back to the generic formula for anyone who hasn't calibrated.
// betaProtein is read separately with a 0 (no effect) default rather than
// added to that required set — an existing calibration from before protein
// tracking existed stays valid as-is, and only starts factoring in protein
// once the user next clicks Calibrate.
function getCalibratedGains() {
  const beta0 = getSetting('PROJ_BASELINE_KG_PER_DAY', null);
  const betaCal = getSetting('PROJ_CAL_KG_PER_KCAL_DAY', null);
  const betaAct = getSetting('PROJ_ACTIVITY_KG_PER_MIN_DAY', null);
  const betaSleep = getSetting('PROJ_SLEEP_KG_PER_HOUR_DAY', null);
  if ([beta0, betaCal, betaAct, betaSleep].some((v) => v === null)) return null;
  const betaProtein = getSetting('PROJ_PROTEIN_KG_PER_G_DAY', 0);
  return { beta0, betaCal, betaAct, betaSleep, betaProtein };
}

function calcProjection(entries) {
  const weightGoal = getSetting('WEIGHT_GOAL_KG', WEIGHT_GOAL_KG_DEFAULT);
  const calorieTarget = getCalorieTargetKcal(entries);
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);
  const proteinTarget = getProteinTargetG(entries);

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
  const activityByDate = new Map();
  const sleepByDate = new Map();
  const proteinByDate = new Map();

  recentEntries.forEach((e) => {
    if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if (e.category === 'Activity' && e.amount !== null) {
      const mins = toActivityMinutes(e.amount, e.unit);
      activityByDate.set(e.date, (activityByDate.get(e.date) || 0) + mins);
    } else if (e.category === 'Sleep' && e.amount !== null) {
      sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
    }
    if (e.category === 'Calories; Protein' && e.amount2 !== null) {
      proteinByDate.set(e.date, (proteinByDate.get(e.date) || 0) + e.amount2);
    }
  });

  let slope;
  let method;
  let calibrated = false;

  if (caloriesByDate.size > 0 || activityByDate.size > 0) {
    const avgCalories = caloriesByDate.size > 0 ? avg(caloriesByDate) : calorieTarget;
    const avgActivityMins = activityByDate.size > 0 ? avg(activityByDate) : 0;
    const avgSleep = sleepByDate.size > 0 ? avg(sleepByDate) : sleepTarget;
    const avgProtein = proteinByDate.size > 0 ? avg(proteinByDate) : proteinTarget;

    const gains = getCalibratedGains();
    if (gains) {
      slope = gains.beta0
        + gains.betaCal * (avgCalories - calorieTarget)
        + gains.betaAct * avgActivityMins
        + gains.betaSleep * (avgSleep - sleepTarget)
        + gains.betaProtein * (avgProtein - proteinTarget);
      slope = Math.max(-PROJ_SLOPE_CLAMP_KG_PER_DAY, Math.min(PROJ_SLOPE_CLAMP_KG_PER_DAY, slope));
      calibrated = true;
    } else {
      // Negative balance = caloric deficit = weight loss
      const balance = avgCalories - (calorieTarget + avgActivityMins * 5);
      const baseSlope = balance / GENERIC_KCAL_PER_KG_FAT;
      const sleepRatio = Math.min(1.0, Math.max(0.7, avgSleep / sleepTarget));
      slope = baseSlope * sleepRatio;
    }

    const allPresent = caloriesByDate.size > 0 && activityByDate.size > 0 && sleepByDate.size > 0;
    method = allPresent ? 'full' : 'partial';
  } else {
    const src = weightEntries.filter((e) => e.date >= cutoffIso);
    const data = src.length >= 2 ? src : weightEntries;
    slope = linearRegressionSlope(data.map((_, i) => i), data.map((e) => e.amount));
    method = 'weight-only';
  }

  if (slope === 0) return { status: 'no-change', method };

  const goingDown = weightGoal < lastWeight;
  if ((goingDown && slope > 0) || (!goingDown && slope < 0)) return { status: 'wrong-direction', method };

  const daysToGoal = Math.round((weightGoal - lastWeight) / slope);
  const etaDate = new Date(today);
  etaDate.setDate(today.getDate() + daysToGoal);

  const cappedDays = Math.min(daysToGoal, 365);
  const projectedPoints = [];
  for (let d = 0; d <= cappedDays; d += 7) {
    const pd = new Date(today);
    pd.setDate(today.getDate() + d);
    projectedPoints.push({ date: isoFromDate(pd), weight: Math.round((lastWeight + slope * d) * 10) / 10 });
  }
  if (daysToGoal <= 365) {
    projectedPoints.push({ date: isoFromDate(etaDate), weight: weightGoal });
  }

  return { status: 'ok', slope, daysToGoal, etaDate, projectedPoints, method, weightGoal, calibrated };
}

function renderWellnessProjectionChart(entries) {
  const ctx = document.getElementById('wellness-projection-chart');
  if (wellnessProjectionChart) wellnessProjectionChart.destroy();

  const meterWrap = document.getElementById('weight-progress-meter');
  const meterFill = document.getElementById('weight-progress-meter-fill');
  const meterPct = document.getElementById('weight-progress-meter-pct');
  const etaEl = document.getElementById('weight-projection-eta');
  meterWrap.hidden = true;
  meterPct.textContent = '';
  etaEl.textContent = '';

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
  const weightGoal = getSetting('WEIGHT_GOAL_KG', WEIGHT_GOAL_KG_DEFAULT);
  const totalDelta = startWeight - weightGoal;
  if (Math.abs(totalDelta) >= 0.1) {
    const pct = Math.max(0, Math.min(100, ((startWeight - lastWeight) / totalDelta) * 100));
    meterWrap.hidden = false;
    meterFill.style.width = `${pct}%`;
    meterFill.classList.toggle('danger', proj.status === 'wrong-direction');
    const pctText = `${Math.round(pct)}%`;
    meterPct.textContent = privacyMode ? maskDigits(pctText) : pctText;
  }

  if (proj.status === 'reached') { etaEl.textContent = 'Goal reached! 🎉'; return; }
  if (proj.status === 'no-change') { etaEl.textContent = 'No net change at current habits'; return; }
  if (proj.status === 'wrong-direction') { etaEl.textContent = 'Current habits trend away from goal — projection unavailable'; return; }

  const histLabels = weightEntries.map((e) => e.date);
  const projLabels = proj.projectedPoints.map((p) => p.date);
  const allLabels = [...new Set([...histLabels, ...projLabels])].sort();

  const histMap = new Map(weightEntries.map((e) => [e.date, e.amount]));
  const projMap = new Map(proj.projectedPoints.map((p) => [p.date, p.weight]));
  const lastDate = histLabels[histLabels.length - 1];

  // Same-day duplicate weigh-ins (e.g. morning + evening) are averaged
  // before smoothing, rather than letting whichever entry happens to be
  // last in histMap silently win.
  const weightSumsByDate = new Map();
  weightEntries.forEach((e) => {
    const cur = weightSumsByDate.get(e.date) || { sum: 0, count: 0 };
    cur.sum += e.amount;
    cur.count += 1;
    weightSumsByDate.set(e.date, cur);
  });
  const weightByDate = new Map([...weightSumsByDate].map(([d, { sum, count }]) => [d, sum / count]));
  const trendMap = computeWeightTrend(weightByDate);

  // Daily history followed by weekly (then a single distant ETA) projected
  // points must NOT be spaced as equal category ticks — that visually
  // implies every gap is the same length. Plot on a true linear axis (day
  // offset from the first date) instead, so a week gap actually takes up
  // 7x the width of a one-day gap.
  const firstDateMs = parseIsoDateUTC(allLabels[0]);
  const dayOffset = (dateStr) => Math.round((parseIsoDateUTC(dateStr) - firstDateMs) / 86400000);
  const offsetToDateLabel = (offset) =>
    new Date(firstDateMs + offset * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  const datasets = [
    {
      label: 'Actual Weight',
      data: allLabels.map((d) => ({ x: dayOffset(d), y: histMap.get(d) ?? null })),
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.08)',
      fill: true,
      tension: 0.3,
      pointRadius: 2,
      spanGaps: false,
      order: 3,
    },
    {
      label: 'Weight Trend',
      data: allLabels.map((d) => ({ x: dayOffset(d), y: trendMap.get(d) ?? null })),
      borderColor: '#16a34a',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      spanGaps: false,
      order: 4,
    },
    {
      label: 'Projected',
      data: allLabels.map((d) => {
        let y = null;
        if (d === lastDate) y = lastWeight;
        else if (d > lastDate) y = projMap.get(d) ?? null;
        return { x: dayOffset(d), y };
      }),
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.08)',
      borderDash: [6, 4],
      fill: true,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 2,
    },
    {
      label: `${proj.weightGoal} kg goal`,
      data: allLabels.map((d) => ({ x: dayOffset(d), y: proj.weightGoal })),
      borderColor: '#dc2626',
      borderDash: [4, 4],
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
  const weightValues = [...histMap.values(), ...trendMap.values(), ...projMap.values(), lastWeight, proj.weightGoal]
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const weightMin = Math.min(...weightValues);
  const weightMax = Math.max(...weightValues);
  const weightPad = Math.max(0.5, (weightMax - weightMin) * 0.08);
  const yMin = Math.floor(weightMin - weightPad);
  const yMax = Math.ceil(weightMax + weightPad);

  const scales = {
    x: {
      type: 'linear',
      ticks: { maxTicksLimit: 24, maxRotation: 45, minRotation: 0, autoSkip: true, callback: offsetToDateLabel },
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
        legend: {
          display: true,
          position: 'top',
          labels: {
            boxWidth: 14,
            font: { size: 11 },
            // The goal-line dataset's label is literally "${weightGoal} kg
            // goal" — mask its digits like everything else on this chart,
            // rather than letting the legend leak the one number the ticks
            // and tooltip already hide.
            generateLabels: (chart) => {
              const generated = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              return privacyMode ? generated.map((l) => ({ ...l, text: maskDigits(l.text) })) : generated;
            },
          },
        },
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

  const etaStr = proj.etaDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const note = proj.method === 'weight-only' ? ' · weight trend only'
    : proj.method === 'partial' ? ' · partial habit data' : '';
  const calibNote = proj.calibrated ? ' · calibrated' : '';
  const etaLine = `Projected to reach ${proj.weightGoal} kg on ${etaStr} (~${proj.daysToGoal} days)${note}${calibNote}`;
  etaEl.textContent = privacyMode ? maskDigits(etaLine) : etaLine;
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

const COMMON_CHART_LIMIT = 36;

// Counts how many transactions share each value of `field`, ignoring blanks,
// and returns the top N as {label, count} sorted highest first.
function topValueCounts(transactions, field, limit) {
  const counts = new Map();
  transactions.forEach((t) => {
    const value = t[field];
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

// Vertical bar chart shared by the Common Payees / Common Expense
// Descriptions panels — both just show record counts per value, sized to
// match the other trend charts' chart-box (labels rotate to fit up to 50
// bars in that same width).
function renderTopCountsChart(chart, canvasId, entries) {
  const ctx = document.getElementById(canvasId);
  if (chart) chart.destroy();
  if (entries.length === 0) return null;

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map((e) => e.label),
      datasets: [{ label: 'Records', data: entries.map((e) => e.count), backgroundColor: '#3b82f6' }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

// Sums each transaction's amount per value of `field`, ignoring blanks, and
// returns the top N as {label, total} ranked by spend magnitude (largest
// absolute total first).
function topValueSums(transactions, field, limit) {
  const sums = new Map();
  transactions.forEach((t) => {
    const value = t[field];
    if (!value) return;
    sums.set(value, (sums.get(value) || 0) + t.amount);
  });

  return [...sums.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([label, total]) => ({ label, total }));
}

// Vertical bar chart of total spend per value, sized to match the other
// trend charts' chart-box like renderTopCountsChart. Bars use the absolute
// total so expense totals (negative sums) still stand upright instead of
// hanging below the axis.
function renderTopSumsChart(chart, canvasId, entries) {
  const ctx = document.getElementById(canvasId);
  if (chart) chart.destroy();
  if (entries.length === 0) return null;

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map((e) => e.label),
      datasets: [{
        label: 'Total',
        data: entries.map((e) => Math.abs(e.total)),
        backgroundColor: entries.map((e) => (e.total >= 0 ? '#16a34a' : '#dc2626')),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => formatCurrency(item.raw) } },
      },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } },
        y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } },
      },
    },
  });
}

function isNotIncome(t) {
  return t.category !== 'Income';
}

let commonPayeeChart = null;

function renderCommonPayeeChart(transactions) {
  commonPayeeChart = renderTopCountsChart(commonPayeeChart, 'common-payee-chart',
    topValueCounts(transactions.filter(isNotIncome), 'payee', COMMON_CHART_LIMIT));
}

let commonDescriptionChart = null;

function renderCommonDescriptionChart(transactions) {
  const expenses = transactions.filter((t) => t.amount < 0 && isNotIncome(t));
  commonDescriptionChart = renderTopCountsChart(commonDescriptionChart, 'common-description-chart',
    topValueCounts(expenses, 'description', COMMON_CHART_LIMIT));
}

let payeeSpendChart = null;

function renderPayeeSpendChart(transactions) {
  const expenses = transactions.filter((t) => t.amount < 0 && isNotIncome(t));
  payeeSpendChart = renderTopSumsChart(payeeSpendChart, 'payee-spend-chart',
    topValueSums(expenses, 'payee', COMMON_CHART_LIMIT));
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

