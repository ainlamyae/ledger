// Fiber chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthFiberChart = null;
// Now a shaded min/max band like Protein Intake, not a flat single line — the Formula
// Tune's fiber rows produce a band the same shape protein's do (getFiberTargetBandG),
// so the chart reads the same way: a floor that's a genuine miss (red) and a ceiling that's
// still a hit (dark green), not a flat met-or-missed. Read from the same Physique-day Fiber
// figure (fiberG) the Health tiles' own Fiber card sums — see physiqueAsHealthEntries.
function renderHealthFiberChart(entries) {
  const ctx = document.getElementById('health-fiber-chart');

  const band = getFiberTargetBandG(entries);

  const fiberEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.fiberG !== null && e.fiberG !== undefined);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = healthCalorieChartDates(entries);
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
  const FIBER_OVER_BAND_COLOR = chartColor('--chart-good-high');
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinFiberBand(values[i], band)) return chartColor('--chart-good');
    return values[i] > band.max ? FIBER_OVER_BAND_COLOR : chartColor('--chart-bad');
  });

  const capHalf = targetCapHalf(Math.max(band.max, ...values, 1));
  const capFor = (value, label) => targetCapDataset(label, new Array(dates.length).fill(value), capHalf, { isTargetLine: true });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: chartColor('--chart-good', 0.1) }),
      bandFill(band.min),
      capFor(band.max, `${band.max} g upper target`),
      capFor(band.min, `${band.min} g target floor`),
    ]
    : [capFor(band.min, `${band.min} g target`)];

  const weeklyAvg = emaSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)));

  const gTopFiber = Math.max(...values, band.max, band.min, 1);
  const gStepFiber = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTopFiber / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMaxFiber = Math.ceil(gTopFiber / gStepFiber) * gStepFiber;

  healthFiberChart = upsertChart(healthFiberChart, ctx, {
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
        trendLineDataset('7-Day Average', weeklyAvg),
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
              const text = `F (Actual Dietary Fiber): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`F_min (Desired Dietary Fiber, lower end): ${band.min} g`, `F_max (Desired Dietary Fiber, upper end): ${band.max} g`]
                : [`F_min (Desired Dietary Fiber): ${band.min} g`];
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} g`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          min: 0,
          max: gMaxFiber,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStepFiber, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMaxFiber * 2,
          position: 'left',
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: gStepFiber * 2, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

