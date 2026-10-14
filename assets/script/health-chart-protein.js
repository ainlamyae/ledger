// Protein chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthProteinChart = null;
function renderHealthProteinChart(entries) {
  const ctx = document.getElementById('health-protein-chart');

  const band = getProteinDesiredBandG(entries);

  const proteinEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.amount2 !== null);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = healthCalorieChartDates(entries);
  const byDate = new Map();
  proteinEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount2));

  // Both ends take the section's per-column cap, so this chart's mark means what every
  // other chart's does. The band stays shaded: these two line datasets exist only to
  // carry `fill: '+1'` (which shades down to the NEXT dataset, so the pair must stay
  // adjacent and in this order) with their stroke off, and the caps draw over them. A
  // zero-width band collapses to one row of caps with nothing to shade.
  //
  // Green, not red: unlike Caloric Intake's shading, this region is the one you're
  // aiming to land IN, and it sits behind bars scored in the same green.
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

  // The two ways of leaving the band are NOT equivalent. Under the floor is the miss
  // that costs muscle on a deficit, so red. Over the top is a darker green than the
  // band itself — still a day you hit your protein, just past the point where more
  // buys anything, and read as a success rather than the neutral gray the other charts
  // give their near-miss. An unlogged day takes the plain green.
  const PROTEIN_OVER_BAND_COLOR = chartColor('--chart-good-high');
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinProteinBand(values[i], band)) return chartColor('--chart-good');
    return values[i] > band.max ? PROTEIN_OVER_BAND_COLOR : chartColor('--chart-bad');
  });

  // Zero-based and auto-topped, so the span is whatever is tallest — a bar or the band.
  const capHalf = desiredCapHalf(Math.max(band.max, ...values, 1));
  // Cyan, the desired mark's colour on the other Health charts, apart from the 7-Day Average.
  const capFor = (value, label) => desiredCapDataset(label, new Array(dates.length).fill(value), capHalf, { isDesiredLine: true, backgroundColor: chartColor('--chart-cyan') });

  const desiredDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: chartColor('--chart-good', 0.1) }),
      bandFill(band.min),
      capFor(band.max, `${band.max} g desired upper end`),
      capFor(band.min, `${band.min} g desired floor`),
    ]
    : [capFor(band.min, `${band.min} g desired`)];

  // Logged days only, so the zero stand-ins don't pull the week under the band's floor.
  const weeklyAvg = emaSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)));

  const gTopProtein = Math.max(...values, band.max, band.min, 1);
  const gStepProtein = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTopProtein / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMaxProtein = Math.ceil(gTopProtein / gStepProtein) * gStepProtein;

  // Legend entries switched off (renderToggleLegend below); bars by their colour's name.
  const hidden = legendHiddenNames('health-protein-legend');
  const barClasses = barColors.map((c) => (c === chartColor('--chart-good') ? 'Within desired'
    : c === PROTEIN_OVER_BAND_COLOR ? 'Over desired' : 'Under desired'));

  healthProteinChart = upsertChart(healthProteinChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Actual Intake',
          data: maskHiddenClasses(values, barClasses, hidden),
          backgroundColor: barColors,
          order: 2,
        },
        trendLineDataset('7-Day Average', weeklyAvg, { hidden: hidden.has('7-Day Average') }),
        // The band's two fill edges go with the band entry, every other mark with the desired one.
        ...desiredDatasets.map((ds) => ({ ...ds, hidden: hidden.has(ds.label.endsWith('band edge') ? 'Desired Protein band' : 'Desired Protein') })),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Without it the cursor lands on the average line, not the bar.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The band's lines are the same constant every day, so as rows they'd repeat
          // identically on every hover. Stated once by afterBody instead.
          filter: (item) => !item.dataset.isDesiredLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `P (Actual Protein): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            // Both ends, flush left and last — the Actual/Desired shape the other charts
            // use. A zero-width band reads as one desired figure, not an equal Min and Max.
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`P_min (Desired Protein, lower end): ${band.min} g`, `P_max (Desired Protein, upper end): ${band.max} g`]
                : [`P_min (Desired Protein): ${band.min} g`];
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
          max: gMaxProtein,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStepProtein, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMaxProtein * 4,
          position: 'left',
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: gStepProtein * 4, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });

  // Swatches under the chart, named as in the hover.
  renderToggleLegend('health-protein-legend', dates.length === 0 ? [] : [
    { name: 'Within desired', color: chartColor('--chart-good') },
    { name: 'Over desired', color: PROTEIN_OVER_BAND_COLOR },
    { name: 'Under desired', color: chartColor('--chart-bad') },
    { name: '7-Day Average', color: desiredMarkColor() },
    { name: 'Desired Protein', color: chartColor('--chart-cyan') },
    ...(band.max > band.min ? [{ name: 'Desired Protein band', color: chartColor('--chart-good', 0.25) }] : []),
  ], () => renderHealthProteinChart(entries));
}

