// Carbohydrate chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthCarbChart = null;
// Fat's chart just above, same dashed-band-edge shape but the opposite severity read:
// too little carbohydrate isn't a deficiency the way too little fiber or protein is, so
// under the floor is merely unscored grey (chartColor('--chart-neutral')'s own shade) rather
// than a red miss — it's over the ceiling that's flagged, since that's the end actually
// linked to the bloating/water-retention complaint this band exists to catch. Read from
// the same Physique-day Carbohydrate figure (carbG) physiqueAsHealthEntries adds beside
// fiberG/fatG.
function renderHealthCarbChart(entries) {
  const ctx = document.getElementById('health-carb-chart');

  const band = getCarbDesiredBandG(entries);

  const carbEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.carbG !== null && e.carbG !== undefined);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = healthCalorieChartDates(entries);
  const byDate = new Map();
  carbEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.carbG));

  const CARB_UNDER_BAND_COLOR = chartColor('--chart-neutral');
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinCarbBand(values[i], band)) return chartColor('--chart-good');
    return values[i] > band.max ? chartColor('--chart-bad') : CARB_UNDER_BAND_COLOR;
  });

  // Same shape as Fiber/Fat Intake's bandFill — two flat line datasets whose only job
  // is the `fill: '+1'` shading between them, stroke off, drawn behind the bars.
  const bandFill = (value, extra = {}) => ({
    type: 'line',
    label: `${value} g band edge`,
    data: new Array(dates.length).fill(value),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    isDesiredLine: true,
    order: 3,
    ...extra,
  });

  // Cyan, the colour of every other desired mark on this panel, as a dashed line here
  // instead of a per-column tick.
  const desiredLine = (value, label) => ({
    type: 'line',
    label,
    data: new Array(dates.length).fill(value),
    borderColor: chartColor('--chart-cyan'),
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    tension: 0,
    isDesiredLine: true,
    order: 0,
  });

  const desiredDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: chartColor('--chart-good', 0.1) }),
      bandFill(band.min),
      desiredLine(band.max, `${band.max} g desired upper end`),
      desiredLine(band.min, `${band.min} g desired floor`),
    ]
    : [desiredLine(band.min, `${band.min} g desired`)];

  const weeklyAvg = emaSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)));

  // Legend entries switched off (renderToggleLegend below) leave the axis too; bars by their colour's name.
  const hidden = legendHiddenNames('health-carb-legend');
  const barClasses = barColors.map((c) => (c === chartColor('--chart-good') ? 'Within desired'
    : c === chartColor('--chart-bad') ? 'Over desired' : 'Under desired'));
  const shownValues = maskHiddenClasses(values, barClasses, hidden);
  const shownDesired = hidden.has('Desired Carbohydrate') && (band.max === band.min || hidden.has('Desired Carbohydrate band')) ? [] : [band.max, band.min];
  const shownAvg = hidden.has('7-Day Average') ? [] : weeklyAvg;
  const gTopCarb = Math.max(...shownValues, ...shownAvg, ...shownDesired, 1);
  const gStepCarb = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTopCarb / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMaxCarb = Math.ceil(gTopCarb / gStepCarb) * gStepCarb;


  healthCarbChart = upsertChart(healthCarbChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Actual Intake',
          data: shownValues,
          backgroundColor: barColors,
          order: 2,
        },
        trendLineDataset('7-Day Average', weeklyAvg, { hidden: hidden.has('7-Day Average') }),
        // The band's two fill edges go with the band entry, every other mark with the desired one.
        ...desiredDatasets.map((ds) => ({ ...ds, hidden: hidden.has(ds.label.endsWith('band edge') ? 'Desired Carbohydrate band' : 'Desired Carbohydrate') })),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !item.dataset.isDesiredLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `C (Actual Carbohydrate): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`C_min (Desired Carbohydrate, lower end): ${band.min} g`, `C_max (Desired Carbohydrate, upper end): ${band.max} g`]
                : [`C_min (Desired Carbohydrate): ${band.min} g`];
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
          max: gMaxCarb,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStepCarb, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMaxCarb * KCAL_PER_G_CARB,
          position: 'left',
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: gStepCarb * KCAL_PER_G_CARB, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });

  // Swatches under the chart, named as in the hover.
  renderToggleLegend('health-carb-legend', dates.length === 0 ? [] : [
    { name: 'Within desired', color: chartColor('--chart-good') },
    { name: 'Over desired', color: chartColor('--chart-bad') },
    { name: 'Under desired', color: CARB_UNDER_BAND_COLOR },
    { name: '7-Day Average', color: desiredMarkColor() },
    { name: 'Desired Carbohydrate', color: chartColor('--chart-cyan') },
    ...(band.max > band.min ? [{ name: 'Desired Carbohydrate band', color: chartColor('--chart-good', 0.25) }] : []),
  ], () => renderHealthCarbChart(entries));
}

