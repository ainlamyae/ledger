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

// An invisible right-hand axis reserving the exact same TREND_Y_AXIS_WIDTH
// as a real right axis (Weight Trend & Forecast's BMI line, Physical
// Activity's calories-burned dots) — so a chart with no real right axis
// still gets the same plot-area width and x-axis tick spacing as the two
// that do, instead of stretching further right and misaligning the date
// labels across the Health Metrics section. A fresh object per call since
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

// Same idea as niceAxisMax but with a much finer ladder, for axes where a
// coarse round-up wastes visible chart area. niceAxisMax steps 1 → 2 → 5 → 10,
// so anything just past 2,000 lands on 5,000 and leaves over half the plot
// empty: a 2,100 kcal deficit — an ordinary day of eating light — got an axis
// twice the height of the tallest bar. These steps keep the round-up to at most
// 25% instead of 150%, while still landing on values a reader parses at a
// glance. Kept separate rather than widening niceAxisMax itself so the other
// chart using that helper keeps the bounds it was tuned with.
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

// Standard estimate for 1kg of body fat — the same generic energy density
// calibration.js's un-calibrated formula and getCalorieTargetKcal() below
// both fall back to until the user's own history is fitted via Calibrate.
const GENERIC_KCAL_PER_KG_FAT = 7700;

// Flat calorie-burn-per-active-minute estimate — used only as a per-day
// fallback (below, and in calibration.js's buildCalibrationSamples) for an
// Activity entry with no real Calculate-derived kcal (amount2) of its own,
// e.g. an older entry logged before that existed. Any entry that does carry
// a real kcal figure uses that instead, in both the calibrated and generic
// projection formulas.
const GENERIC_KCAL_PER_ACTIVE_MIN = 5;

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

// Mifflin-St Jeor resting/basal metabolic rate (kcal/day) — the energy cost
// of simply staying alive, before any movement is added. Shared by
// getCalorieTargetKcal below (× ACTIVITY_MULTIPLIER, giving a TDEE the
// deficit target is subtracted from) and the Calorie Deficit & Fat Loss chart
// (which adds each day's own logged activity burn instead of a multiplier),
// so the formula itself exists in exactly one place.
function mifflinStJeorBmr(weightKg, heightCm, age, sex) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

// Resting maintenance (kcal/day) from the profile settings and the most
// recently logged weight — null if any input is missing. Deliberately the same
// Mifflin-St Jeor basis the Calorie Deficit & Fat Loss chart applies per-day,
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

// Energy density of body fat (kcal per kg) used wherever a calorie figure has
// to be converted into a body-mass one: the user's own calibrated value (the
// Calibrate button's fitted calorie coefficient, inverted) once one exists,
// otherwise the generic 7,700 — the same convention calcProjection() and the
// calculated calorie target both already follow.
function kcalPerKgFat() {
  const gains = getCalibratedGains();
  return (gains && gains.betaCal > 0) ? 1 / gains.betaCal : GENERIC_KCAL_PER_KG_FAT;
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
    const tdee = mifflinStJeorBmr(weightKg, heightCm, age, sex) * activityMultiplier;
    const dailyDeficit = (weeklyFatLossKg * kcalPerKgFat()) / 7;
    return Math.round(tdee - dailyDeficit);
  }

  return getSetting('CALORIE_TARGET_KCAL', CALORIE_TARGET_KCAL_DEFAULT);
}

// Number of trailing days shown in each Health Metrics chart (Caloric
// Intake, Protein Intake, Physical Activity, Rest & Recovery) — Body Weight
// has its own dedicated history in the Weight Trend & Forecast chart above,
// so it's not repeated here. These charts are full-width (one per row)
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
// fixed N-day lookback (Wellness Insight, Protein Source Rotation, ...) —
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
  renderWellnessCaloriesChart(entries);
  renderWellnessSleepChart(entries);
  renderWellnessActivityChart(entries);
  renderWellnessProteinChart(entries);
  renderWellnessProjectionChart(entries);
  renderWellnessEnergyBalanceChart(entries);
  renderWellnessCompositionChart(entries);
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

function renderWellnessCaloriesChart(entries) {
  const ctx = document.getElementById('wellness-calories-chart');

  const calorieTarget = getCalorieTargetKcal(entries);

  const calorieEntries = entries.filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null);
  const dates = trailingDatesForCategory(calorieEntries, WELLNESS_METRICS_DAYS);
  const byDate = new Map();
  calorieEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

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
          data: new Array(dates.length).fill(calorieTarget),
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
        tooltip: { callbacks: { title: (items) => formatIsoDateShort(items[0].label), label: maskedValueTooltipLabel } },
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: {
          beginAtZero: true,
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
function sleepAxisTickLabel(v) {
  const clockMin = Math.round((SLEEP_AXIS_ANCHOR_MIN + v * 60) % (24 * 60));
  return formatClockTime24(clockMin);
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

  wellnessSleepChart = upsertChart(wellnessSleepChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Sleep',
          data: sleepData,
          backgroundColor: barColors,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const r = rangeByDate.get(item.label);
              if (!r) return '';
              const text = `Bed ${formatClockTime24(r.bedMin)} / Wake ${formatClockTime24(r.wakeMin)} · ${r.durationHr} hr`;
              return privacyMode ? maskDigits(text) : text;
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

  // Calories burned (Activity; Calories entries' amount2) summed per day —
  // surfaced as an extra tooltip line rather than a second y-axis: minutes
  // plotted as its own dot-per-day series on a dedicated right-hand axis
  // (requested explicitly — minutes and kcal are different scales, so this
  // is a deliberate dual-axis chart rather than the usual single-axis default).
  const caloriesByDate = new Map();
  activityEntries.forEach((e) => {
    if (e.amount2 === null) return;
    caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount2);
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

  // Dot-per-day series rather than a connected line — each day's calorie
  // burn is its own independent figure (some days have none logged at all,
  // which a connected line would misleadingly bridge over as a trend).
  const caloriesDataset = {
    type: 'line',
    label: 'Calories burned',
    data: dates.map((date) => (caloriesByDate.has(date) ? caloriesByDate.get(date) : null)),
    yAxisID: 'y1',
    showLine: false,
    pointRadius: 5,
    pointHoverRadius: 7,
    pointBackgroundColor: '#7c3aed',
    pointBorderColor: '#fff',
    pointBorderWidth: 1.5,
    order: 0,
  };

  // Excluded from the tooltip via the filter callback below — it's a fixed
  // reference line, not a per-day value, so repeating "90 min target" on
  // every hover added noise without telling you anything new each time.
  const targetLineDataset = {
    type: 'line',
    label: `${activityTarget} min target`,
    data: new Array(dates.length).fill(activityTarget),
    borderColor: '#dc2626',
    borderDash: [4, 4],
    pointRadius: 0,
    tension: 0,
    order: 1,
    isTargetLine: true,
  };

  wellnessActivityChart = upsertChart(wellnessActivityChart, ctx, {
    data: {
      labels: dates,
      datasets: [...activityDatasets, targetLineDataset, caloriesDataset],
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
          filter: (item) => !item.dataset.isTargetLine && item.raw !== null,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: maskedValueTooltipLabel,
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: {
          stacked: true,
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('min') },
        },
        y1: {
          position: 'right',
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { color: '#7c3aed', callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

function renderWellnessProteinChart(entries) {
  const ctx = document.getElementById('wellness-protein-chart');

  const proteinTarget = getProteinTargetG(entries);

  const proteinEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.amount2 !== null);
  const dates = trailingDatesForCategory(proteinEntries, WELLNESS_METRICS_DAYS);
  const byDate = new Map();
  proteinEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount2));

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
          data: new Array(dates.length).fill(proteinTarget),
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
        tooltip: { callbacks: { title: (items) => formatIsoDateShort(items[0].label), label: maskedValueTooltipLabel } },
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
// once the user next clicks Calibrate. PROJ_ACTIVITY_KG_PER_KCAL_DAY was
// PROJ_ACTIVITY_KG_PER_MIN_DAY (kg/day per activity MINUTE) before activity
// entries could carry a real calorie-burn figure — renamed rather than
// reinterpreted in place, so an old per-minute calibration under the old key
// simply reads as "not calibrated" (safe fallback to the generic formula)
// instead of silently applying a per-minute coefficient to a now-kcal input.
function readSavedCalibratedGains() {
  const beta0 = getSetting('PROJ_BASELINE_KG_PER_DAY', null);
  const betaCal = getSetting('PROJ_CAL_KG_PER_KCAL_DAY', null);
  const betaAct = getSetting('PROJ_ACTIVITY_KG_PER_KCAL_DAY', null);
  const betaSleep = getSetting('PROJ_SLEEP_KG_PER_HOUR_DAY', null);
  if ([beta0, betaCal, betaAct, betaSleep].some((v) => v === null)) return null;
  const betaProtein = getSetting('PROJ_PROTEIN_KG_PER_G_DAY', 0);
  return { beta0, betaCal, betaAct, betaSleep, betaProtein };
}

// Health Metrics' calibrated/generic toggle (calibration.js's
// initFormulaToggle). True — the default every load — means "use my
// calibration wherever it applies"; flipping it to false makes
// getCalibratedGains() report no calibration, so every consumer takes the
// generic path it already falls back to for a user who never calibrated. That
// one gate is the whole switch: nothing else needs a parallel "generic mode"
// code path, and no setting is written, so the comparison can't corrupt the
// saved fit. Session-only (not persisted) so a reload always returns to the
// truthful calibrated view rather than silently leaving the app in the
// what-if mode.
let useCalibratedFormula = true;

// The active view's gains — what every formula should read. Use
// readSavedCalibratedGains() directly ONLY to report on the saved
// calibration itself (the Calibrate modal's summary, the toggle's own
// enabled/disabled state), which must reflect what's on file regardless of
// which view is being displayed.
function getCalibratedGains() {
  return useCalibratedFormula ? readSavedCalibratedGains() : null;
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
  const activityKcalByDate = new Map();
  const sleepByDate = new Map();
  const proteinByDate = new Map();

  recentEntries.forEach((e) => {
    if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
      // Real Calculate-derived kcal (amount2) when this entry has one —
      // otherwise the same flat per-minute estimate the un-calibrated
      // formula below always used, so an older entry without a kcal figure
      // still contributes something rather than nothing.
      const mins = toActivityMinutes(e.amount, e.unit);
      const kcal = e.amount2 !== null ? e.amount2 : mins * GENERIC_KCAL_PER_ACTIVE_MIN;
      activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
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

  if (caloriesByDate.size > 0 || activityKcalByDate.size > 0) {
    const avgCalories = caloriesByDate.size > 0 ? avg(caloriesByDate) : calorieTarget;
    const avgActivityKcal = activityKcalByDate.size > 0 ? avg(activityKcalByDate) : 0;
    const avgSleep = sleepByDate.size > 0 ? avg(sleepByDate) : sleepTarget;
    const avgProtein = proteinByDate.size > 0 ? avg(proteinByDate) : proteinTarget;

    const gains = getCalibratedGains();
    if (gains) {
      slope = gains.beta0
        + gains.betaCal * (avgCalories - calorieTarget)
        + gains.betaAct * avgActivityKcal
        + gains.betaSleep * (avgSleep - sleepTarget)
        + gains.betaProtein * (avgProtein - proteinTarget);
      slope = Math.max(-PROJ_SLOPE_CLAMP_KG_PER_DAY, Math.min(PROJ_SLOPE_CLAMP_KG_PER_DAY, slope));
      calibrated = true;
    } else {
      // Negative balance = caloric deficit = weight loss. avgActivityKcal
      // already folds in the *5-per-minute estimate for any entry lacking
      // a real kcal figure, so it's added here directly rather than
      // re-deriving it from minutes.
      //
      // Measured against MAINTENANCE, not against calorieTarget. Using the
      // target here was a real error: the calculated target is already
      // maintenance MINUS the planned deficit, so someone eating exactly their
      // target came out at a balance of ~zero and the forecast reported "no net
      // change at current habits" — when hitting that target is precisely what
      // should deliver the planned WEEKLY_FAT_LOSS_KG. It also added logged
      // activity on top of a target derived from BMR × ACTIVITY_MULTIPLIER,
      // double-counting the movement the multiplier already assumed. The two
      // errors pointed in opposite directions, which is why the result looked
      // plausible while contradicting the Calorie Deficit & Fat Loss chart,
      // which measures against maintenance. Both now share one baseline.
      const resting = restingMaintenanceKcal(entries);
      const maintenance = resting !== null
        ? resting + avgActivityKcal
        // No profile on file, so there's no BMR to work from and no calculated
        // target either — getCalorieTargetKcal fell back to the flat
        // CALORIE_TARGET_KCAL setting, a number the user chose directly with no
        // deficit arithmetic inside it. Treating that as the reference is the
        // best available baseline in that case.
        : calorieTarget + avgActivityKcal;

      const balance = avgCalories - maintenance;
      const baseSlope = balance / GENERIC_KCAL_PER_KG_FAT;
      const sleepRatio = Math.min(1.0, Math.max(0.7, avgSleep / sleepTarget));
      slope = baseSlope * sleepRatio;
    }

    const allPresent = caloriesByDate.size > 0 && activityKcalByDate.size > 0 && sleepByDate.size > 0;
    method = allPresent ? 'full' : 'partial';
  } else {
    const src = weightEntries.filter((e) => e.date >= cutoffIso);
    const data = src.length >= 2 ? src : weightEntries;
    slope = linearRegressionSlope(data.map((_, i) => i), data.map((e) => e.amount));
    method = 'weight-only';
  }

  // slope/calibrated are reported even when no forecast can be drawn — the
  // rate is the one number that distinguishes the calibrated model from the
  // generic one in these states, so the ETA line can show it instead of a
  // bare "projection unavailable" that reads identically for both.
  if (slope === 0) return { status: 'no-change', method, slope, calibrated };

  const goingDown = weightGoal < lastWeight;
  if ((goingDown && slope > 0) || (!goingDown && slope < 0)) return { status: 'wrong-direction', method, slope, calibrated };

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
  const meterRemaining = document.getElementById('weight-progress-meter-remaining');
  const timeWrap = document.getElementById('time-progress-meter');
  const timeFill = document.getElementById('time-progress-meter-fill');
  const timeElapsed = document.getElementById('time-progress-meter-elapsed');
  const timeRemaining = document.getElementById('time-progress-meter-remaining');
  const etaEl = document.getElementById('weight-projection-eta');
  const plateauNote = document.getElementById('weight-plateau-note');
  meterWrap.hidden = true;
  meterPct.textContent = '';
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
  // Shows both the concrete kg remaining (the motivating, actionable number
  // a bare percentage doesn't convey) and the percentage already covered,
  // rather than just the one abstract figure.
  const weightGoal = getSetting('WEIGHT_GOAL_KG', WEIGHT_GOAL_KG_DEFAULT);
  const totalDelta = startWeight - weightGoal;
  if (Math.abs(totalDelta) >= 0.1) {
    const pct = Math.max(0, Math.min(100, ((startWeight - lastWeight) / totalDelta) * 100));
    const remainingKg = Math.round(Math.abs(lastWeight - weightGoal) * 10) / 10;
    const isWrongDirection = proj.status === 'wrong-direction';

    meterWrap.hidden = false;
    meterFill.style.width = `${pct}%`;
    meterFill.classList.toggle('danger', isWrongDirection);

    const pctText = `${Math.round(pct)}%`;
    meterPct.textContent = privacyMode ? maskDigits(pctText) : pctText;

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
  // everything actually MEASURED stays on screen. That's also what makes the
  // calibrated/generic toggle legible — flipping between a drawable and an
  // undrawable projection no longer blanks the whole chart, it just adds or
  // removes the dashed forecast.
  // The rate is included on the two "can't forecast" statuses because it's the
  // only figure that differs between the calibrated and the generic model in
  // those states — without it the calibrated/generic toggle looks inert here,
  // since both would print the same bare sentence.
  // Always names the model behind the number — "· calibrated" or "· generic"
  // — rather than labeling only the calibrated case. Now that a toggle switches
  // between them, an unlabelled line reads as "unknown", not as "generic".
  // Skipped for the weight-only method, where the slope is a plain regression
  // on the weigh-ins and NEITHER formula ran, so claiming either would mislead;
  // that path's own "· weight trend only" note already says as much.
  const modelNote = () => {
    if (proj.method === 'weight-only') return '';
    return proj.calibrated ? ' · calibrated' : ' · generic';
  };

  const rateNote = () => {
    const kgPerWeek = Math.abs(proj.slope * 7).toFixed(2);
    const direction = proj.slope > 0 ? 'gaining' : 'losing';
    return `${direction} ~${kgPerWeek} kg/week${modelNote()}`;
  };
  const statusNote = {
    reached: () => 'Goal reached! 🎉',
    'no-change': () => `No net change at current habits${modelNote()}`,
    'wrong-direction': () => `Current habits trend away from goal — ${rateNote()}, so no arrival date can be projected`,
  }[proj.status];
  if (statusNote) {
    const note = statusNote();
    etaEl.textContent = privacyMode ? maskDigits(note) : note;
  }

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
  }

  const histLabels = weightEntries.map((e) => e.date);
  const projLabels = projPoints.map((p) => p.date);
  const allLabels = [...new Set([...histLabels, ...projLabels])].sort();

  const histMap = new Map(weightEntries.map((e) => [e.date, e.amount]));
  const projMap = new Map(projPoints.map((p) => [p.date, p.weight]));
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

  const plateauDays = detectPlateau(trendMap);
  if (plateauDays) {
    const plateauLine = `⚠️ Weight trend has been flat for ~${plateauDays} days — consider adjusting your calorie target`;
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
      backgroundColor: 'rgba(99,102,241,0.08)',
      borderDash: [6, 4],
      fill: true,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 2,
    }] : []),
    {
      // weightGoal, not proj.weightGoal — the latter is only set on an 'ok'
      // projection, but the goal line is drawn either way.
      label: `${weightGoal} kg goal`,
      data: allLabels.map((d) => ({ x: dayOffset(d), y: weightGoal })),
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
  const weightValues = [...histMap.values(), ...trendMap.values(), ...projMap.values(), lastWeight, weightGoal]
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

  // etaDate/daysToGoal/method only exist on an 'ok' projection; the other
  // statuses already had their explanation written to etaEl above.
  if (!hasProjection) return;

  const etaStr = proj.etaDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const note = proj.method === 'weight-only' ? ' · weight trend only'
    : proj.method === 'partial' ? ' · partial habit data' : '';
  const etaLine = `Projected to reach ${weightGoal} kg on ${etaStr} (~${proj.daysToGoal} days)${note}${modelNote()}`;
  etaEl.textContent = privacyMode ? maskDigits(etaLine) : etaLine;
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

// "+320" / "-450" — the sign carries the entire meaning on this chart (a
// deficit vs a surplus), so a positive figure is shown with an explicit + in
// the tooltip rather than bare.
function withExplicitSign(value) {
  return value > 0 ? `+${value}` : String(value);
}

let wellnessEnergyBalanceChart = null;

// Per-day energy balance — what was eaten minus what was spent — with the
// body-fat change that balance implies on a twin right-hand axis.
//
// Spend is Mifflin-St Jeor BMR (from Height/Birth Date/Sex plus that day's
// carried-forward weight — the "cost of just being alive" the user has no log
// for) PLUS that day's own logged activity burn. ACTIVITY_MULTIPLIER is
// deliberately NOT applied on top of the BMR the way getCalorieTargetKcal
// does it: activity is already logged in this app as real kcal, NEAT
// included, so scaling BMR by a lifestyle multiplier as well would count the
// same movement twice and overstate every deficit.
//
// Sign convention follows the Body Composition Change chart directly below —
// negative is loss. A bar below zero is a deficit and reads as grams of fat
// lost off the right axis; above zero is a surplus and grams gained. Keeping
// both charts pointing the same way is what makes them comparable: this one
// is the fat change your energy balance PREDICTS, that one is the fat change
// your weigh-ins actually SHOW.
//
// Both of this chart's constants follow the Health Metrics calibrated/generic
// toggle, and what the right axis MEASURES changes with them, so it's
// relabelled rather than silently reinterpreted:
//
//   Generic — maintenance is plain Mifflin-St Jeor and the density is fat's
//     ~7,700 kcal/kg, which is not a personal parameter. The axis reads
//     "g fat".
//   Calibrated — the density is the user's own fitted kcal/kg, which is a
//     SCALE-WEIGHT response (how far the scale moves per kcal, water and
//     glycogen included) and routinely fits well below 7,700 on short weigh-in
//     windows; see calibration.js's typical-band comment. Under that model the
//     number genuinely isn't fat, so the axis reads "g weight" and the tooltip
//     says "Expected scale weight". Presenting a fitted 3,171 kcal/kg as fat
//     would overstate fat loss by 2.4x by counting water as fat.
//
// Calibrated maintenance is derived even though the fit has no BMR term: β₀ is
// its rate at target intake with no logged activity, so target − β₀·K is that
// user's own resting-equivalent expenditure. It's applied as a fixed OFFSET to
// the per-day Mifflin curve rather than as a flat constant, so the level comes
// from the fit while the day-to-day response to weight change (~10 kcal/kg) is
// preserved. Caveat no label can carry: β₀ also absorbs whatever the fit failed
// to attribute to activity, so on a fit whose activity term came out as noise
// this figure has habitual activity partly baked in — and the chart then adds
// logged activity on top of it. The calibrated view is "what my own history
// implies", not a cleaner measurement.
//
// There's no separate fat-loss line, for the same reason the Weight Trend
// chart has no separate BMI line: grams of fat is balance ÷ kcal-per-kg, a
// fixed linear rescale, so a plotted line would retrace the bars exactly.
// Deriving y1's min/max from y's own bounds makes the right axis a true twin
// of the left, so the gram figure can be read straight off the same bars.
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

  // Real Calculate-derived kcal (amount2) where an Activity entry has one,
  // else the same flat per-minute estimate calcProjection() falls back to for
  // entries logged before that existed.
  const activityKcalByDate = new Map();
  entries.forEach((e) => {
    if ((e.category !== 'Activity' && e.category !== 'Activity; Calories') || e.amount === null) return;
    const kcal = e.amount2 !== null ? e.amount2 : toActivityMinutes(e.amount, e.unit) * GENERIC_KCAL_PER_ACTIVE_MIN;
    activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
  });

  // null in generic view (that's what the toggle does), so this one read
  // switches both constants and both labels below.
  const gains = getCalibratedGains();
  const kcalPerKg = gains ? kcalPerKgFat() : GENERIC_KCAL_PER_KG_FAT;
  // Ticks carry the bare unit, matching the left axis's "kcal" — naming the
  // quantity on every tick repeated it eight times and crowded out the numbers.
  // Whether the figure is fat or scale weight is said in the tooltip
  // (massLabel), which is where the rest of this chart's detail already lives.
  const massLabel = gains ? 'Expected scale weight' : 'Expected fat';

  // Levels the whole Mifflin curve onto the fit's own resting-equivalent
  // expenditure, measured at the latest weigh-in — the one day where the
  // calibrated maintenance is exactly target − β₀·K.
  const latestWeight = latestWeightKg(entries);
  const maintenanceOffset = (gains && latestWeight !== null)
    ? (getCalorieTargetKcal(entries) - gains.beta0 * kcalPerKg) - mifflinStJeorBmr(latestWeight, heightCm, age, sex)
    : 0;

  const detailByDate = new Map();

  const balanceData = labels.map((date) => {
    // A day with no food logged isn't a day of eating nothing — it's a day
    // with no data, so it's an empty slot rather than a huge fake deficit.
    if (!intakeByDate.has(date)) return null;

    const intake = Math.round(intakeByDate.get(date));
    const maintenance = Math.round(mifflinStJeorBmr(weightForDate.get(date), heightCm, age, sex) + maintenanceOffset);
    const activity = Math.round(activityKcalByDate.get(date) || 0);
    const balance = intake - maintenance - activity;

    detailByDate.set(date, { intake, maintenance, activity, balance, massG: Math.round((balance / kcalPerKg) * 1000) });
    return balance;
  });

  const values = balanceData.filter((v) => v !== null);
  const hasData = values.length > 0;

  const maxDeficit = Math.max(0, ...values.map((v) => -v));
  const maxSurplus = Math.max(0, ...values);
  const yMin = -niceAxisBound(Math.max(maxDeficit * 1.08, ENERGY_BALANCE_AXIS_MIN_KCAL));
  const yMax = niceAxisBound(Math.max(maxSurplus * 1.08, ENERGY_BALANCE_AXIS_MIN_KCAL));

  wellnessEnergyBalanceChart = upsertChart(wellnessEnergyBalanceChart, ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Calorie balance',
          data: balanceData,
          // Green for a deficit, red for a surplus — the same
          // income/expense colors the rest of the app reads as
          // "toward the goal" / "away from it".
          backgroundColor: balanceData.map((v) => (v !== null && v < 0 ? '#16a34a' : '#dc2626')),
        },
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
            ? 'No calories logged yet — log what you ate to see your daily deficit'
            : 'Add Height, Birth Date, and Sex in Settings (and log a Weight) to estimate this',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: {
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // The whole point of the chart is the subtraction, so every term
            // of it is spelled out on hover — a bare "-450" wouldn't show
            // which of eating less or moving more produced it.
            label: (item) => {
              const d = detailByDate.get(item.label);
              if (!d) return '';
              const lines = [
                `Eaten: ${d.intake} kcal`,
                `Maintenance: ${d.maintenance} kcal`,
                `Activity: ${d.activity} kcal`,
                `Balance: ${withExplicitSign(d.balance)} kcal`,
                `${massLabel}: ${withExplicitSign(d.massG)} g`,
              ];
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
          ticks: { callback: maskedUnitTick('kcal') },
        },
        y1: {
          // Left as the exact gram equivalent of y's own bounds (not rounded)
          // — that exactness is what keeps this axis a true twin, so a given
          // height on a bar reads as the right gram figure here.
          min: (yMin / kcalPerKg) * 1000,
          max: (yMax / kcalPerKg) * 1000,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { includeBounds: false, callback: maskedUnitTick('g') },
        },
      },
    },
  });
}

// Forbes' constant (kg) relating the fat-free share of ANY weight change to
// current fat mass: ΔFFM/ΔBW = FORBES_C_KG / (FORBES_C_KG + fatMassKg) — the
// leaner someone already is, the larger the fraction of their next kg lost
// (or gained) is fat-free mass rather than fat. (Forbes 1987; see Hall 2007,
// Br J Nutr, "Body fat and fat-free mass inter-relationships: Forbes's
// theory revisited".)
const FORBES_C_KG = 10.4;

// Long-established fraction of fat-free mass that is water (Pace & Rathbun
// 1945, ~0.73; confirmed ~0.70-0.76 across mammals and human cadaver
// analysis in later reviews). The remaining ~27% of any fat-free mass
// change is lean solids — protein and mineral — labeled "Muscle" below
// since that's overwhelmingly what it represents day to day.
const FFM_WATER_FRACTION = 0.73;

// Deurenberg et al. 1991 (Br J Nutr) age/sex-specific body fat % prediction
// from BMI alone — used here because no direct body-fat measurement (scale,
// calipers, DEXA) exists anywhere in this app, same "best available
// estimate" trust level as calorie-estimator.js's USDA/AI fallbacks.
function estimateBodyFatPercent(weightKg, heightCm, age, sex) {
  const bmi = weightKg / (heightCm / 100) ** 2;
  const sexTerm = sex === 'male' ? 1 : 0;
  return 1.20 * bmi + 0.23 * age - 10.8 * sexTerm - 5.4;
}

// Splits a measured weight change (kg, negative = loss) into fat / muscle /
// water using Forbes' fat vs fat-free partition, then the fat-free portion's
// established water fraction. This is a population-average estimate, not a
// measurement — there's no way to actually observe this split from a scale
// alone, which is why the chart's caption calls it out as such.
function splitWeightChange(deltaKg, weightKg, heightCm, age, sex) {
  const bfPercent = Math.max(3, Math.min(60, estimateBodyFatPercent(weightKg, heightCm, age, sex)));
  const fatMassKg = weightKg * (bfPercent / 100);
  const ffmFraction = FORBES_C_KG / (FORBES_C_KG + fatMassKg);

  const fat = deltaKg * (1 - ffmFraction);
  const ffm = deltaKg * ffmFraction;
  return { fat, muscle: ffm * (1 - FFM_WATER_FRACTION), water: ffm * FFM_WATER_FRACTION };
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

let wellnessCompositionChart = null;

function renderWellnessCompositionChart(entries) {
  const ctx = document.getElementById('wellness-composition-chart');

  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  const weightEntries = entries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Full trailing calendar range (same as every other wellness chart's own
  // x-axis), not just the days that happen to have a weigh-in — a day with
  // no logged weight (including the very first/last day of the window)
  // still gets its own bar slot, just left empty (null), rather than being
  // dropped from the axis entirely and compressing the date range.
  const labels = haveProfile && weightEntries.length > 0 ? trailingDatesForCategory(weightEntries, WELLNESS_METRICS_DAYS) : [];
  const weightByDate = weightByDateMap(weightEntries);

  const fatData = [];
  const muscleData = [];
  const waterData = [];

  let lastKnownDate = null;
  labels.forEach((date) => {
    const hasToday = weightByDate.has(date);
    if (hasToday && lastKnownDate !== null) {
      const delta = weightByDate.get(date) - weightByDate.get(lastKnownDate);
      const split = splitWeightChange(delta, weightByDate.get(date), heightCm, age, sex);
      fatData.push(Math.round(split.fat * 1000) / 1000);
      muscleData.push(Math.round(split.muscle * 1000) / 1000);
      waterData.push(Math.round(split.water * 1000) / 1000);
    } else {
      // No prior weigh-in to diff against (first logged day) or nothing
      // logged today — an empty slot, not a zero-change bar.
      fatData.push(null);
      muscleData.push(null);
      waterData.push(null);
    }
    if (hasToday) lastKnownDate = date;
  });

  const hasData = fatData.some((v) => v !== null);

  wellnessCompositionChart = upsertChart(wellnessCompositionChart, ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Fat', data: fatData, backgroundColor: '#f97316', stack: 'composition' },
        { type: 'bar', label: 'Muscle', data: muscleData, backgroundColor: '#8b5cf6', stack: 'composition' },
        { type: 'bar', label: 'Water', data: waterData, backgroundColor: '#3b82f6', stack: 'composition' },
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
          text: haveProfile
            ? 'Not enough weigh-ins yet to estimate a composition change'
            : 'Add Height, Birth Date, and Sex in Settings to estimate this breakdown',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: { callbacks: { title: (items) => formatIsoDateShort(items[0].label), label: maskedValueTooltipLabel } },
      },
      scales: {
        x: { stacked: true, ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 7, callback: shortDateTickCallback } },
        y: { stacked: true, afterFit: fixTrendYAxisWidth, ticks: { callback: maskedUnitTick('kg', 2) } },
        y1: ghostRightAxis(),
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

