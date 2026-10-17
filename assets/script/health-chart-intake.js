// Intake chart (Health Chart): Caloric Intake's dots, caps and average over a stack of
// the day's macros in kcal. Shared helpers live in health-chart.js.

let healthIntakeChart = null;

// One fixed hue per macro, clear of the dots' green/red and the cyan desired cap.
// Grams to kcal by Atwater factor (fiber 2 kcal/g).
const INTAKE_MACROS = [
  { key: 'amount2', label: 'Protein', hue: 330, kcalPerG: 4 },
  { key: 'fiberG', label: 'Dietary Fiber', hue: 165, kcalPerG: 2 },
  { key: 'fatG', label: 'Fat', hue: 45, kcalPerG: KCAL_PER_G_FAT },
  { key: 'carbG', label: 'Carbohydrate', hue: 205, kcalPerG: KCAL_PER_G_CARB },
];

function renderHealthIntakeChart(entries) {
  const ctx = document.getElementById('health-intake-chart');

  const desired = getCalorieDesired(entries);

  const calorieEntries = calorieLogEntries(entries);
  const dates = healthCalorieChartDates(entries);
  const byDate = new Map();
  calorieEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  // kcal per macro per day. Carbohydrate is USDA's "by difference", fiber included, so
  // fiber comes off it first.
  const macroEntries = entries.filter((e) => e.category === 'Calories; Protein');
  const gramsOf = (e, key) => {
    const g = e[key] ?? 0;
    return key === 'carbG' ? Math.max(0, g - (e.fiberG ?? 0)) : g;
  };
  // Grams as logged, for the hover.
  const gramsByMacro = INTAKE_MACROS.map(({ key }) => {
    const m = new Map();
    macroEntries.forEach((e) => {
      if (e[key] !== null && e[key] !== undefined) m.set(e.date, (m.get(e.date) || 0) + e[key]);
    });
    return m;
  });
  const kcalByMacro = INTAKE_MACROS.map(({ key, kcalPerG }) => {
    const m = new Map();
    macroEntries.forEach((e) => {
      if (e[key] !== null && e[key] !== undefined) m.set(e.date, (m.get(e.date) || 0) + gramsOf(e, key) * kcalPerG);
    });
    return m;
  });

  // Atwater rates don't sum to each food's own USDA energy, so each day's segments are
  // scaled to share out that day's TEI exactly.
  dates.forEach((d) => {
    const sum = kcalByMacro.reduce((total, m) => total + (m.get(d) || 0), 0);
    if (!sum || !byDate.has(d)) return;
    const scale = byDate.get(d) / sum;
    kcalByMacro.forEach((m) => { if (m.has(d)) m.set(d, m.get(d) * scale); });
  });
  const macroColors = INTAKE_MACROS.map(({ hue }) => seriesColor(hue, { lightness: '--chart-series-light' }));

  // Only the BMR selected in Tune, coloured as on Caloric Intake; a day missing it
  // falls back to the equation, as pickBmrForBasis does.
  const BMR_COLORS = {
    BMR_mif: chartColor('--chart-blue'),
    BMR_kat: chartColor('--chart-orange'),
    BMR_cal: chartColor('--chart-indigo'),
    BMR_adp: chartColor('--chart-purple'),
    BMR_avg: chartColor('--chart-warn'),
  };
  const tuneBmrKey = { bmr_cal: 'BMR_cal', bmr_adp: 'BMR_adp', bmr_avg: 'BMR_avg' }[bmrBasis()] ?? BMR_EQUATION_KEYS[bmrFormula()];
  const BMR_CAPS = [{ key: tuneBmrKey, color: BMR_COLORS[tuneBmrKey] }];
  const bmrByKey = { [tuneBmrKey]: new Map() };
  const bmrKeyByDate = new Map();
  const restingKcalByDate = new Map();
  dates.forEach((d) => {
    const figures = bmrFiguresForDate(d);
    const selected = pickBmrForBasis(figures);
    if (selected !== null) {
      bmrByKey[tuneBmrKey].set(d, selected);
      bmrKeyByDate.set(d, selectedBmrKey(figures));
    }
    const plain = pickBmrForBasis(figures, 'bmr');
    if (plain !== null) restingKcalByDate.set(d, plain);
  });

  const desiredByDay = calorieDesiredSeries(entries, dates);
  const dayDesired = (i) => ({ ...desired, kcal: desiredByDay[i].kcal });

  // Dot colours graded exactly as Caloric Intake's bars.
  const CALORIE_NEAR_DESIRED_COLOR = chartColor('--chart-neutral');
  const values = dates.map((d) => (byDate.has(d) ? byDate.get(d) : null));
  const dotColors = dates.map((d, i) => {
    if (!byDate.has(d)) return chartColor('--chart-good');
    const value = values[i];
    const dt = dayDesired(i);
    if (withinCalorieDesired(value, dt)) return chartColor('--chart-good');
    const bmr = desired.isMax ? restingKcalByDate.get(d) : undefined;
    if (bmr === undefined || bmr === null || bmr <= dt.kcal) {
      return calorieDesiredScore(value, dt) === 'near' ? CALORIE_NEAR_DESIRED_COLOR : chartColor('--chart-bad');
    }
    if (value >= bmr) return chartColor('--chart-bad');
    return lerpHex(chartColor('--chart-good'), chartColor('--chart-bad'), (value - dt.kcal) / (bmr - dt.kcal));
  });

  const weeklyAvg = emaSeries(values);

  // A miss in a week still on the desired side reads gray.
  dotColors.forEach((color, i) => {
    if (color !== chartColor('--chart-bad')) return;
    const avg = weeklyAvg[i];
    if (avg === null || avg === undefined) return;
    if (withinCalorieDesired(avg, dayDesired(i))) dotColors[i] = CALORIE_NEAR_DESIRED_COLOR;
  });

  // Hidden legend entries leave the axes too.
  const hidden = legendHiddenNames('health-intake-legend');
  const dotClasses = dotColors.map((c) => (c === chartColor('--chart-good') ? 'Desired met'
    : c === CALORIE_NEAR_DESIRED_COLOR ? 'Near desired' : 'Missed desired'));
  const shownValues = maskHiddenClasses(values, dotClasses, hidden);

  const macroDatasets = INTAKE_MACROS.map(({ label }, m) => ({
    type: 'bar',
    label,
    data: dates.map((d) => kcalByMacro[m].get(d) ?? 0),
    backgroundColor: macroColors[m],
    stack: 'macros',
    hidden: hidden.has(label),
    order: 2,
  }));
  const stackTops = dates.map((d, i) => macroDatasets.reduce((sum, ds) => sum + (ds.hidden ? 0 : ds.data[i]), 0));

  const restingKcalValues = BMR_CAPS.filter(({ key }) => !hidden.has(BMR_DEFINITIONS[key]))
    .flatMap(({ key }) => [...bmrByKey[key].values()]);
  const axis = calorieAxisBounds(
    shownValues.filter((v) => v !== null).concat(stackTops.filter((v) => v > 0), hidden.has('7-Day Average') ? [] : weeklyAvg.filter((v) => v !== null)),
    (hidden.has(`Desired ${desired.word}`) ? [] : desiredByDay.map((b) => b.kcal)).concat(restingKcalValues),
  );
  const capHalf = (axis.max - axis.min) * 0.004;
  const capData = desiredByDay.map((b) => [b.kcal - capHalf, b.kcal + capHalf]);

  healthIntakeChart = upsertChart(healthIntakeChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        ...macroDatasets,
        trendLineDataset('7-Day Average', weeklyAvg, { yAxisID: 'y1', hidden: hidden.has('7-Day Average') }),
        {
          type: 'bar',
          label: `${desired.word} for the day`,
          hidden: hidden.has(`Desired ${desired.word}`),
          data: capData,
          yAxisID: 'y1',
          backgroundColor: chartColor('--chart-cyan'),
          grouped: false,
          isDesiredLine: true,
          order: 1,
        },
        ...BMR_CAPS.filter(({ key }) => bmrByKey[key].size > 0).map(({ key, color }) => desiredCapDataset(
          key, dates.map((d) => bmrByKey[key].get(d) ?? null), capHalf,
          { yAxisID: 'y1', isDesiredLine: true, backgroundColor: color, hidden: hidden.has(BMR_DEFINITIONS[key]), order: 1 },
        )),
        {
          type: 'line',
          label: 'Calories',
          data: shownValues,
          yAxisID: 'y1',
          showLine: false,
          pointRadius: fitPointRadius(5),
          pointHoverRadius: fitPointRadius(7),
          pointBackgroundColor: dotColors,
          pointBorderColor: chartColor('--chart-point-border'),
          pointBorderWidth: fitPointBorderWidth(5, 1.5),
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.raw !== null && item.raw !== 0 && !item.dataset.isDesiredLine && !item.dataset.isWeeklyAverage,
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            labelColors: (item) => {
              const ds = item.dataset;
              const fill = Array.isArray(ds.pointBackgroundColor) ? ds.pointBackgroundColor[item.dataIndex] : ds.backgroundColor;
              return { borderColor: fill, backgroundColor: fill };
            },
            label: (item) => {
              const m = INTAKE_MACROS.findIndex((x) => x.label === item.dataset.label);
              const macro = INTAKE_MACROS[m];
              const grams = macro ? gramsByMacro[m].get(item.label) : undefined;
              const text = macro
                ? `${macro.label}: ${Math.round(item.parsed.y)} kcal${grams !== undefined ? ` (${Math.round(grams * 10) / 10} g)` : ''}`
                : `TEI (Total Energy Intake): ${item.parsed.y} kcal`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [`Desired ${desired.word}: ${desiredByDay[i].kcal} kcal`];
              const kcal = bmrByKey[tuneBmrKey].get(items[0].label);
              if (kcal !== undefined) lines.push(`${bmrHoverLabel(bmrKeyByDate.get(items[0].label))}: ${Math.round(kcal)} kcal`);
              if (weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ...wellnessCategoryXScale(dates), stacked: true },
        // The stack's own axis, pinned to y1's kcal range so bars and dots share one scale.
        y: { ...ghostRightAxis(), stacked: true, min: axis.min, max: axis.max },
        y1: {
          min: axis.min,
          max: axis.max,
          position: 'left',
          afterFit: fixDatedYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
      },
    },
  });

  renderToggleLegend('health-intake-legend', dates.length === 0 ? [] : [
    ...INTAKE_MACROS.map(({ label }, m) => ({ name: label, color: macroColors[m] })),
    { name: 'Desired met', color: chartColor('--chart-good') },
    { name: 'Near desired', color: CALORIE_NEAR_DESIRED_COLOR },
    { name: 'Missed desired', color: chartColor('--chart-bad') },
    { name: '7-Day Average', color: desiredMarkColor() },
    { name: `Desired ${desired.word}`, color: chartColor('--chart-cyan') },
    ...BMR_CAPS.filter(({ key }) => bmrByKey[key].size > 0).map(({ key, color }) => ({ name: BMR_DEFINITIONS[key], color })),
  ], () => renderHealthIntakeChart(entries));
}
