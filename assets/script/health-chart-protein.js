// Protein chart (Health Chart), plus the band chart Fiber, Fat and Carbohydrate share.

// Over the band is a darker green: still a hit, just past where more buys anything.
// Under it is red, the miss that costs muscle on a deficit.
function renderHealthProteinChart(entries) {
  renderHealthMacroBandChart(entries, {
    id: 'protein',
    key: 'amount2',
    symbol: 'P',
    getBand: getProteinDesiredBandG,
    withinBand: withinProteinBand,
    overColor: '--chart-good-high',
    underColor: '--chart-bad',
    mark: 'cap',
    rerender: renderHealthProteinChart,
  });
}

// One Chart.js instance per macro band chart, by spec id.
const healthMacroBandCharts = {};

// Daily grams of one macro against its desired band (spec.getBand): green in the band or
// unlogged, spec.overColor/underColor outside it, an L_p-day average, and the band's ends
// as per-column caps (mark 'cap') or dashed lines (mark 'line'), all cyan. The y1 axis
// reads the same grams in kcal by the macro's Atwater factor (INTAKE_MACROS).
function renderHealthMacroBandChart(entries, spec) {
  const ctx = document.getElementById(`health-${spec.id}-chart`);
  const legendId = `health-${spec.id}-legend`;
  const { label: name, kcalPerG } = INTAKE_MACROS.find((m) => m.key === spec.key);
  const desiredName = `Desired ${name}`;
  const bandName = `${desiredName} band`;

  const band = spec.getBand(entries);
  const hasBand = band.max > band.min;

  // Shared by every chart in the panel so their gridlines line up.
  const dates = healthCalorieChartDates(entries);
  const byDate = new Map();
  entries.forEach((e) => {
    if (e.category === 'Calories; Protein' && e[spec.key] != null) byDate.set(e.date, (byDate.get(e.date) || 0) + e[spec.key]);
  });
  const flat = (value) => new Array(dates.length).fill(value);

  const values = dates.map((d) => byDate.get(d) || 0);
  const barClasses = dates.map((d, i) => {
    if (!byDate.has(d) || spec.withinBand(values[i], band)) return 'Within desired';
    return values[i] > band.max ? 'Over desired' : 'Under desired';
  });
  const classColors = {
    'Within desired': chartColor('--chart-good'),
    'Over desired': chartColor(spec.overColor),
    'Under desired': chartColor(spec.underColor),
  };
  const barColors = barClasses.map((c) => classColors[c]);

  // Invisible-stroke lines whose `fill: '+1'` shades down to the NEXT dataset, so the
  // pair must stay adjacent and in this order. Green: the band is where you aim to land.
  const bandFill = (value, extra = {}) => ({
    type: 'line',
    label: `${value} g band edge`,
    data: flat(value),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    isDesiredLine: true,
    order: 3,
    ...extra,
  });

  // Zero-based and auto-topped, so the span is whatever is tallest: a bar or the band.
  const capHalf = spec.mark === 'cap' ? desiredCapHalf(Math.max(band.max, ...values, 1)) : 0;
  const desiredMark = (value, label) => (spec.mark === 'cap'
    ? desiredCapDataset(label, flat(value), capHalf, { isDesiredLine: true, backgroundColor: chartColor('--chart-cyan') })
    : {
      type: 'line',
      label,
      data: flat(value),
      borderColor: chartColor('--chart-cyan'),
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      tension: 0,
      isDesiredLine: true,
      order: 0,
    });

  // A zero-width band collapses to one mark with nothing to shade.
  const desiredDatasets = hasBand
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: chartColor('--chart-good', 0.1) }),
      bandFill(band.min),
      desiredMark(band.max, `${band.max} g desired upper end`),
      desiredMark(band.min, `${band.min} g desired floor`),
    ]
    : [desiredMark(band.min, `${band.min} g desired`)];

  // Logged days only, so the zero stand-ins don't pull the week under the floor.
  const weeklyAvg = emaSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), bodyMassSmoothingDays());

  // Legend entries switched off leave the axis too.
  const hidden = legendHiddenNames(legendId);
  const shownValues = maskHiddenClasses(values, barClasses, hidden);
  const shownDesired = hidden.has(desiredName) && (!hasBand || hidden.has(bandName)) ? [] : [band.max, band.min];
  const shownAvg = hidden.has(healthAvgName()) ? [] : weeklyAvg;
  const gTop = Math.max(...shownValues, ...shownAvg, ...shownDesired, 1);
  const gStep = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTop / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMax = Math.ceil(gTop / gStep) * gStep;

  healthMacroBandCharts[spec.id] = upsertChart(healthMacroBandCharts[spec.id], ctx, {
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
        trendLineDataset(healthAvgName(), weeklyAvg, { hidden: hidden.has(healthAvgName()) }),
        // The fill edges go with the band entry, every other mark with the desired one.
        ...desiredDatasets.map((ds) => ({ ...ds, hidden: hidden.has(ds.label.endsWith('band edge') ? bandName : desiredName) })),
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
          // Constant every day, so stated once by afterBody instead of as rows.
          filter: (item) => !item.dataset.isDesiredLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `${spec.symbol} (Actual ${name}): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const lines = hasBand
                ? [`${spec.symbol}_min (${desiredName}, lower end): ${band.min} g`, `${spec.symbol}_max (${desiredName}, upper end): ${band.max} g`]
                : [`${spec.symbol}_min (${desiredName}): ${band.min} g`];
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`${healthAvgName()}: ${Math.round(weeklyAvg[i])} g`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: datedCategoryXScale(dates),
        y: {
          min: 0,
          max: gMax,
          position: 'right',
          afterFit: fixDatedYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStep, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMax * kcalPerG,
          position: 'left',
          afterFit: fixDatedYAxisWidth,
          ticks: { stepSize: gStep * kcalPerG, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });

  // Swatches under the chart, named as in the hover.
  renderToggleLegend(legendId, dates.length === 0 ? [] : [
    ...Object.entries(classColors).map(([className, color]) => ({ name: className, color })),
    { name: healthAvgName(), color: desiredMarkColor() },
    { name: desiredName, color: chartColor('--chart-cyan') },
    ...(hasBand ? [{ name: bandName, color: chartColor('--chart-good', 0.25) }] : []),
  ], () => spec.rerender(entries));
}
