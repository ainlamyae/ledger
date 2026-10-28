// Caloric Intake chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthCaloriesChart = null;
// Headroom above the plotted range, with a floor — a window of near-identical days
// would otherwise be padded by almost nothing and sit flush against the top.
const CALORIE_AXIS_PAD_FRACTION = 0.15;
const CALORIE_AXIS_MIN_PAD_KCAL = 120;

// Rounding for the top, so the axis still lands on readable tick figures (1,650
// rather than 1,663).
const CALORIE_AXIS_STEP_KCAL = 50;

// Coarser, for the one case where the desired figure still has to widen the axis. A coarse step
// holds the frame still across several hundred kcal of desired movement.
const CALORIE_AXIS_DESIRED_STEP_KCAL = 250;

// From 0 kcal, so a bar's height is the day's intake. The top is framed on what was
// LOGGED, padded out.
//
// The desired figure is deliberately NOT part of the frame. Padding around it made the ruler move
// with the thing it measures: a 278 kcal change landed the caps 2 px from where they
// started, with the bars changing height instead. What was eaten doesn't depend on the
// desired figure, so framing on it holds still while that moves across it.
//
// The caps still can't fall off-plot, so the frame is WIDENED — never re-padded — to
// reach one. That only arises when the desired figure sits beyond everything logged.
function calorieAxisBounds(loggedValues, desiredValues) {
  // Falls back to 0 when every entry is hidden.
  const framing = loggedValues.length ? loggedValues : desiredValues.length ? desiredValues : [0];
  const lo = Math.min(...framing);
  const hi = Math.max(...framing);
  const pad = Math.max(CALORIE_AXIS_MIN_PAD_KCAL, (hi - lo) * CALORIE_AXIS_PAD_FRACTION);

  const roundUp = (v, step) => Math.ceil(v / step) * step;

  return {
    min: 0,
    max: Math.max(roundUp(hi + pad, CALORIE_AXIS_STEP_KCAL), roundUp(Math.max(0, ...desiredValues), CALORIE_AXIS_DESIRED_STEP_KCAL)),
  };
}

function renderHealthCaloriesChart(entries) {
  const ctx = document.getElementById('health-calories-chart');

  const desired = getCalorieDesired(entries);

  const calorieEntries = calorieLogEntries(entries);
  const dates = healthCalorieChartDates(entries);
  const byDate = new Map();
  calorieEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  // Resting metabolic rate per day, as stored in that day's Derived cell (Physique's
  // Derived column: the day's own carried-forward body mass and age), not recalculated here.
  // All four figures are drawn regardless of the BMR basis setting, so they can be
  // compared; each map skips the days its figure is missing.
  const BMR_CAPS = [
    { key: 'BMR_mif', color: chartColor('--chart-blue') },
    { key: 'BMR_kat', color: chartColor('--chart-orange') },
    { key: 'BMR_cal', color: chartColor('--chart-indigo') },
    { key: 'BMR_adp', color: chartColor('--chart-purple') },
    { key: 'BMR_avg', color: chartColor('--chart-warn') },
  ];
  const bmrByKey = Object.fromEntries(BMR_CAPS.map(({ key }) => [key, new Map()]));
  dates.forEach((d) => {
    const figures = bmrFiguresForDate(d);
    BMR_CAPS.forEach(({ key }) => {
      if (figures[key] !== undefined) bmrByKey[key].set(d, figures[key]);
    });
  });

  // Re-evaluated per day, so there's no single figure to draw: each bar carries its own
  // and is scored against that one alone.
  const desiredByDay = calorieDesiredSeries(entries, dates);
  const dayDesired = (i) => ({ ...desired, kcal: desiredByDay[i].kcal });

  // Each bar against its OWN day's figure, graded by how much of the desired balance D
  // the day's intake leaves (intakeDesiredR, desiredGrade): Beat, Desired met, Near,
  // Short of and Missed desired, lifted by the L_p-day average's own grade so one off day
  // in a week on pace reads as a dip. No shaded out-of-bounds region: the desired figure
  // moves by tens of kcal across a window, far too little for a filled zone to follow.
  // An unlogged day plots as 0 and takes the green — a missing log, not a fast, and
  // invisible at zero height anyway rather than the worst day on the chart under a floor.
  const values = dates.map((d) => byDate.get(d) || 0);
  // Off the LOGGED days only, so `values`' zero-for-nothing-logged stand-ins don't count
  // as days of fasting.
  const weeklyAvg = emaSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), bodyMassSmoothingDays());
  const balanceKcal = desiredBalanceKcal(planBodyMassKg(entries));
  const barGrades = dates.map((d, i) => (byDate.has(d) ? desiredGrade(
    intakeDesiredR(values[i], dayDesired(i), balanceKcal),
    intakeDesiredR(weeklyAvg[i], dayDesired(i), balanceKcal),
  ) : null) ?? { name: null, color: chartColor('--chart-good') });
  const barColors = barGrades.map((g) => g.color);

  // Legend entries switched off (renderToggleLegend below) leave the axis too; bars by
  // their grade's name.
  const hidden = legendHiddenNames('health-calories-legend');
  const barClasses = barGrades.map((g) => g.name);
  const shownValues = maskHiddenClasses(values, barClasses, hidden);

  const restingKcalValues = BMR_CAPS.filter(({ key }) => !hidden.has(BMR_DEFINITIONS[key]))
    .flatMap(({ key }) => [...bmrByKey[key].values()]);
  const axis = calorieAxisBounds(
    shownValues.filter((v, i) => v !== null && byDate.has(dates[i])),
    (hidden.has(`Desired ${desired.word}`) ? [] : desiredByDay.map((b) => b.kcal)).concat(restingKcalValues),
  );

  // A cap across each bar rather than one continuous line: a line spanning the window
  // reads as a single shared limit however it's dashed, while a mark per bar says the
  // limit belongs to that day alone. Thickness scales with the axis span.
  const capHalf = (axis.max - axis.min) * 0.004;
  const capData = desiredByDay.map((b) => [b.kcal - capHalf, b.kcal + capHalf]);

  healthCaloriesChart = upsertChart(healthCaloriesChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Calories',
          data: shownValues,
          backgroundColor: barColors,
          order: 2,
        },
        trendLineDataset(healthAvgName(), weeklyAvg, { hidden: hidden.has(healthAvgName()) }),
        {
          type: 'bar',
          label: `${desired.word} for the day`,
          hidden: hidden.has(`Desired ${desired.word}`),
          data: capData,
          // Cyan, the desired mark's colour on Body Mass and Calorie Balance too.
          backgroundColor: chartColor('--chart-cyan'),
          grouped: false,
          isDesiredLine: true,
          // Lowest order paints last, so the cap stays visible on a bar that overshot it.
          order: 0,
        },
        // The four BMR figures, per day — the same per-day cap idiom as the Desired cap above,
        // each in its own colour.
        ...BMR_CAPS.filter(({ key }) => bmrByKey[key].size > 0).map(({ key, color }) => desiredCapDataset(
          key, dates.map((d) => bmrByKey[key].get(d) ?? null), capHalf,
          { isDesiredLine: true, backgroundColor: color, hidden: hidden.has(BMR_DEFINITIONS[key]) },
        )),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Hovering anywhere in a column reports that day. Without it the cap is often the
      // nearest element to the pointer, and since it's filtered out below, hovering near
      // the top of a bar would produce an empty tooltip.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The cap is filtered out — a floating bar would report itself as a
          // `[from, to]` pair — and stated properly in afterBody instead.
          filter: (item) => !item.dataset.isDesiredLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const lines = [`TEI (Total Energy Intake): ${item.parsed.y} kcal`];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // afterBody rather than a label row: Chart.js indents body lines to clear the
            // colour swatch, while this sits flush left. desired.word, so it reads
            // "Desired Max" rather than "Desired Maximum". No TEI prefix here — TEI
            // already labels the Actual Intake line above, and repeating it on this one
            // in the same tooltip would say the same symbol means two different things.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [`Desired ${desired.word}: ${desiredByDay[i].kcal} kcal`];
              // Named as in the Physique form: BMR_mif, BMR_kat, BMR_cal, BMR_adp, BMR_avg.
              BMR_CAPS.forEach(({ key }) => {
                const kcal = bmrByKey[key].get(items[0].label);
                if (kcal !== undefined) lines.push(`${bmrHoverLabel(key)}: ${Math.round(kcal)} kcal`);
              });
              if (weeklyAvg[i] !== null) lines.push(`${healthAvgName()}: ${Math.round(weeklyAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          // From 0 kcal, like the other intake charts.
          min: axis.min,
          max: axis.max,
          afterFit: fixDatedYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
        y1: ghostRightAxis(),
      },
    },
  });

  // Swatches under the chart, named as in the hover; BMR names without their symbols.
  renderToggleLegend('health-calories-legend', dates.length === 0 ? [] : [
    ...desiredGradeLegend(),
    { name: healthAvgName(), color: desiredMarkColor() },
    { name: `Desired ${desired.word}`, color: chartColor('--chart-cyan') },
    ...BMR_CAPS.filter(({ key }) => bmrByKey[key].size > 0).map(({ key, color }) => ({ name: BMR_DEFINITIONS[key], color })),
  ], () => renderHealthCaloriesChart(entries));
}

