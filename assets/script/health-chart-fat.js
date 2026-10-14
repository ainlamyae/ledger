// Fat chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthFatChart = null;
// Fiber's chart just above, with one deliberate difference: the band edges draw as a
// single dashed line spanning the whole window rather than fiber's per-day caps. The
// shaded fill between the two edges is the same green band fill as Protein/Fiber though —
// it draws behind the bars via its own invisible-stroke datasets, same as theirs, while
// the visible dashed line stays a separate on-top dataset. Read from the same Physique-day
// Fat figure (fatG) physiqueAsHealthEntries adds beside fiberG.
function renderHealthFatChart(entries) {
  const ctx = document.getElementById('health-fat-chart');

  const band = getFatTargetBandG(entries);

  const fatEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.fatG !== null && e.fatG !== undefined);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = healthCalorieChartDates(entries);
  const byDate = new Map();
  fatEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.fatG));

  // Under the floor is red, in the band (or unlogged) is green. Past the ceiling is a
  // lighter green — still inside the AMDR's own upper bound, just not the plain in-band hit.
  const FAT_OVER_BAND_COLOR = chartColor('--chart-good-light');
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinFatBand(values[i], band)) return chartColor('--chart-good');
    return values[i] > band.max ? FAT_OVER_BAND_COLOR : chartColor('--chart-bad');
  });

  // Same shape as Protein/Fiber Intake's bandFill — two flat line datasets whose only job
  // is the `fill: '+1'` shading between them, stroke off, drawn behind the bars.
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

  // targetMarkColor() is near-black in light mode, near-white in dark — the same colour
  // every other target cap on this panel uses, just as a continuous dashed line here
  // instead of a per-column tick.
  const targetLine = (value, label) => ({
    type: 'line',
    label,
    data: new Array(dates.length).fill(value),
    borderColor: targetMarkColor(),
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 0,
  });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: chartColor('--chart-good', 0.1) }),
      bandFill(band.min),
      targetLine(band.max, `${band.max} g upper target`),
      targetLine(band.min, `${band.min} g target floor`),
    ]
    : [targetLine(band.min, `${band.min} g target`)];

  const weeklyAvg = emaSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)));

  const gTopFat = Math.max(...values, band.max, band.min, 1);
  const gStepFat = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTopFat / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMaxFat = Math.ceil(gTopFat / gStepFat) * gStepFat;

  healthFatChart = upsertChart(healthFatChart, ctx, {
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
              const text = `G (Actual Fat): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`G_min (Desired Fat, lower end): ${band.min} g`, `G_max (Desired Fat, upper end): ${band.max} g`]
                : [`G_min (Desired Fat): ${band.min} g`];
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
          max: gMaxFat,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStepFat, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMaxFat * KCAL_PER_G_FAT,
          position: 'left',
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: gStepFat * KCAL_PER_G_FAT, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

