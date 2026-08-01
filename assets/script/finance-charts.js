
let expenseBreakdownTrendChart = null;

// Stacked spend per month, with that month's INCOME over the top of it as a single
// line — the two questions ("where did it go" and "was it more than came in") read
// off one chart instead of two, which is what let the separate Revenue vs.
// Expenditure area chart go: its expense series was this chart's stack total, and
// its income series is the line below.
function renderExpenseBreakdownTrendChart(months) {
  const ctx = document.getElementById('expense-breakdown-trend-chart');
  if (months.length === 0) {
    if (expenseBreakdownTrendChart) expenseBreakdownTrendChart.destroy();
    return;
  }

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

  expenseBreakdownTrendChart = upsertChart(expenseBreakdownTrendChart, ctx, {
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

// Divisors turning each period's total into a monthly average. Lifelong has none —
// renderSpendingTrendChart passes the real month count instead.
const SPENDING_TREND_PERIODS = [
  { key: 'lastMonth', label: 'Last Month', alpha: 1, months: 1 },
  { key: 'quarterAvg', label: 'Last Quarter', alpha: 0.7, months: 3 },
  { key: 'yearAvg', label: 'Last Year', alpha: 0.45, months: 12 },
  { key: 'lifelongAvg', label: 'Lifelong', alpha: 0.25, months: null },
];

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

  spendingTrendChart = upsertChart(spendingTrendChart, ctx, {
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
  if (accounts.length === 0) {
    if (accountCompositionChart) accountCompositionChart.destroy();
    return;
  }

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

  accountCompositionChart = upsertChart(accountCompositionChart, ctx, {
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
