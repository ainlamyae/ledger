// Caloric Intake chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthCaloriesChart = null;
// Headroom above the plotted range, with a floor — a window of near-identical days
// would otherwise be padded by almost nothing and sit flush against the top.
const CALORIE_AXIS_PAD_FRACTION = 0.15;
const CALORIE_AXIS_MIN_PAD_KCAL = 120;

// Rounding for the top, so the axis still lands on readable tick figures (1,650
// rather than 1,663).
const CALORIE_AXIS_STEP_KCAL = 50;

// Coarser, for the one case where the target still has to widen the axis. A coarse step
// holds the frame still across several hundred kcal of target movement.
const CALORIE_AXIS_TARGET_STEP_KCAL = 250;

// From 0 kcal, so a bar's height is the day's intake. The top is framed on what was
// LOGGED, padded out.
//
// The target is deliberately NOT part of the frame. Padding around it made the ruler move
// with the thing it measures: a 278 kcal change landed the caps 2 px from where they
// started, with the bars changing height instead. What was eaten doesn't depend on the
// target, so framing on it holds still while the target moves across it.
//
// The caps still can't fall off-plot, so the frame is WIDENED — never re-padded — to
// reach one. That only arises when the target sits beyond everything logged.
function calorieAxisBounds(loggedValues, targetValues) {
  const framing = loggedValues.length ? loggedValues : targetValues;
  const lo = Math.min(...framing);
  const hi = Math.max(...framing);
  const pad = Math.max(CALORIE_AXIS_MIN_PAD_KCAL, (hi - lo) * CALORIE_AXIS_PAD_FRACTION);

  const roundUp = (v, step) => Math.ceil(v / step) * step;

  return {
    min: 0,
    max: Math.max(roundUp(hi + pad, CALORIE_AXIS_STEP_KCAL), roundUp(Math.max(...targetValues), CALORIE_AXIS_TARGET_STEP_KCAL)),
  };
}

function renderHealthCaloriesChart(entries) {
  const ctx = document.getElementById('health-calories-chart');

  const target = getCalorieTarget(entries);

  const calorieEntries = calorieLogEntries(entries);
  const dates = healthCalorieChartDates(entries);
  const byDate = new Map();
  calorieEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  // Resting metabolic rate per day, as stored in that day's Derived cell (Physique's
  // Derived column: the day's own carried-forward body mass and age), not recalculated here.
  // All four figures are drawn regardless of the BMR basis setting, so they can be
  // compared; each map skips the days its figure is missing. restingKcalByDate is the
  // active equation's plain BMR, which the bar colour grades against.
  const BMR_CAPS = [
    { key: 'BMR_mif', color: undefined },
    { key: 'BMR_kat', color: chartColor('--chart-orange') },
    { key: 'BMR_cal', color: chartColor('--chart-cyan') },
    { key: 'BMR_adp', color: chartColor('--chart-purple') },
  ];
  const bmrByKey = Object.fromEntries(BMR_CAPS.map(({ key }) => [key, new Map()]));
  const restingKcalByDate = new Map();
  dates.forEach((d) => {
    const figures = bmrFiguresForDate(d);
    BMR_CAPS.forEach(({ key }) => {
      if (figures[key] !== undefined) bmrByKey[key].set(d, figures[key]);
    });
    const plain = pickBmrForBasis(figures, 'bmr');
    if (plain !== null) restingKcalByDate.set(d, plain);
  });

  // Re-evaluated per day, so there's no single figure to draw: each bar carries its own
  // and is scored against that one alone.
  const targetByDay = calorieTargetSeries(entries, dates);
  const dayTarget = (i) => ({ ...target, kcal: targetByDay[i].kcal });

  // Each bar against its OWN day's figure: green on the right side, gray within
  // CALORIE_TARGET_NEAR_FRACTION past it, red beyond — so the colour IS the read, and a
  // near-miss is called neither a win nor a failure. No shaded out-of-bounds region:
  // the target moves by tens of kcal across a window, far too little for a filled zone
  // to follow, so the wash only ever communicated a fixed limit the chart doesn't have.
  // An unlogged day plots as 0 and takes the green — a missing log, not a fast, and
  // invisible at zero height anyway rather than the worst day on the chart under a floor.
  const CALORIE_NEAR_TARGET_COLOR = chartColor('--chart-neutral');
  const values = dates.map((d) => byDate.get(d) || 0);
  // On a "Max" target, red beyond it isn't flat — green at the target itself sliding
  // to red at that day's own Basal Metabolic Rate (restingKcalByDate, above), since
  // eating up to BMR alone already erases the deficit before activity or TEF even
  // factor in: the real ceiling the target sits a step under. Solid red at or past
  // BMR itself. A "Min" target (a bulk) has no such ceiling to gradient toward, so
  // it keeps the old flat near/missed split, as does a Max day BMR can't be priced
  // for yet (no profile, or no body mass logged).
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d)) return chartColor('--chart-good');
    const value = values[i];
    const dt = dayTarget(i);
    if (withinCalorieTarget(value, dt)) return chartColor('--chart-good');
    const bmr = target.isMax ? restingKcalByDate.get(d) : undefined;
    if (bmr === undefined || bmr === null || bmr <= dt.kcal) {
      return calorieTargetScore(value, dt) === 'near' ? CALORIE_NEAR_TARGET_COLOR : chartColor('--chart-bad');
    }
    if (value >= bmr) return chartColor('--chart-bad');
    return lerpHex(chartColor('--chart-good'), chartColor('--chart-bad'), (value - dt.kcal) / (bmr - dt.kcal));
  });

  // Fit off the LOGGED days only, so `values`' zero-for-nothing-logged stand-ins don't
  // count as days of fasting. A per-week least-squares trend, not a sliding average —
  // a sliding window reacts to a spike on either side of it, before or after it
  // actually happened; a trend fit to a fixed week only moves once, at the week's own
  // pace. Computed here, ahead of the axis, so a missed day can be graded against it
  // below.
  const weeklyAvg = emaSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)));

  // A single day's overshoot reads as noise, not a habit, when the week around it is
  // still landing on the target's right side — gray it out rather than calling it a
  // miss. Only a 'missed' bar moves: 'met' is already green and 'near' is already this
  // same gray.
  barColors.forEach((color, i) => {
    if (color !== chartColor('--chart-bad')) return;
    const avg = weeklyAvg[i];
    if (avg === null || avg === undefined) return;
    if (withinCalorieTarget(avg, dayTarget(i))) barColors[i] = CALORIE_NEAR_TARGET_COLOR;
  });

  const restingKcalValues = BMR_CAPS.flatMap(({ key }) => [...bmrByKey[key].values()]);
  const axis = calorieAxisBounds(
    values.filter((v, i) => byDate.has(dates[i])),
    targetByDay.map((b) => b.kcal).concat(restingKcalValues),
  );

  // A cap across each bar rather than one continuous line: a line spanning the window
  // reads as a single shared limit however it's dashed, while a mark per bar says the
  // limit belongs to that day alone. Thickness scales with the axis span.
  const capHalf = (axis.max - axis.min) * 0.004;
  const capData = targetByDay.map((b) => [b.kcal - capHalf, b.kcal + capHalf]);

  healthCaloriesChart = upsertChart(healthCaloriesChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Calories',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        trendLineDataset('7-Day Average', weeklyAvg),
        {
          type: 'bar',
          label: `${target.word} for the day`,
          data: capData,
          backgroundColor: targetMarkColor(),
          grouped: false,
          isTargetLine: true,
          // Lowest order paints last, so the cap stays visible on a bar that overshot it.
          order: 0,
        },
        // The four BMR figures, per day — the same per-day cap idiom as the Target above:
        // a mark per bar, BMR_mif in the target's colour, the other three in their own.
        ...BMR_CAPS.filter(({ key }) => bmrByKey[key].size > 0).map(({ key, color }) => targetCapDataset(
          key, dates.map((d) => bmrByKey[key].get(d) ?? null), capHalf,
          color ? { isTargetLine: true, backgroundColor: color } : { isTargetLine: true },
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
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const lines = [`TEI (Total Energy Intake): ${item.parsed.y} kcal`];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // afterBody rather than a label row: Chart.js indents body lines to clear the
            // colour swatch, while this sits flush left. target.word, so it reads
            // "Desired Max" rather than "Desired Maximum". No TEI prefix here — TEI
            // already labels the Actual Intake line above, and repeating it on this one
            // in the same tooltip would say the same symbol means two different things.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [`Desired ${target.word}: ${targetByDay[i].kcal} kcal`];
              // Named as in the Physique form: BMR_mif, BMR_kat, BMR_cal, BMR_adp.
              BMR_CAPS.forEach(({ key }) => {
                const kcal = bmrByKey[key].get(items[0].label);
                if (kcal !== undefined) lines.push(`${bmrHoverLabel(key)}: ${Math.round(kcal)} kcal`);
              });
              if (weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} kcal`);
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
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
        y1: ghostRightAxis(),
      },
    },
  });
}

