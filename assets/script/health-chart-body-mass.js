// Body Mass chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthBodyMassChart = null;

// The tolerance getCalorieDesiredKind and calcProjection also treat as "there": no scale
// reading lands on a healthy mass to the gram.
const BODY_MASS_AT_HEALTHY_TOLERANCE_KG = 0.1;

// Headroom around the plotted range; the floor keeps near-identical readings off the edges.
const BODY_MASS_AXIS_PAD_FRACTION = 0.15;
const BODY_MASS_AXIS_MIN_PAD_KG = 0.5;

// The first step keeping the count under BODY_MASS_MAX_GRIDLINES wins, so lines land on round kg.
const BODY_MASS_TICK_STEPS_KG = [0.5, 1, 2, 5, 10];
const BODY_MASS_MAX_GRIDLINES = 8;
// The BMI twin axis snaps to the first of these at or above kg step ÷ height².
const BODY_MASS_BMI_TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5];

// Cyan, so the healthy-mass mark can't pass for the L_p-Day Trend's colour.
const BODY_MASS_HEALTHY_COLOR = () => chartColor('--chart-cyan');

// A gap longer than this between readings ends a run; the trend lines restart after it.
const BODY_MASS_RUN_MAX_GAP_DAYS = 14;

// First reading of the latest run, so one stray old reading can't anchor the trajectory.
function bodyMassRunStartDate(sortedDates) {
  let start = sortedDates[0];
  for (let i = 1; i < sortedDates.length; i += 1) {
    const gapDays = (parseIsoDateUTC(sortedDates[i]) - parseIsoDateUTC(sortedDates[i - 1])) / 86400000;
    if (gapDays > BODY_MASS_RUN_MAX_GAP_DAYS) start = sortedDates[i];
  }
  return start;
}

// emaSeries over L_p days, restarted after a long gap and blank across it.
function bodyMassEmaSeries(values, span) {
  const series = [];
  let run = [];
  let lastIndex = null;
  values.forEach((v, i) => {
    if (v !== null && lastIndex !== null && i - lastIndex > BODY_MASS_RUN_MAX_GAP_DAYS) {
      series.push(...emaSeries(run.slice(0, lastIndex - (i - run.length) + 1), span));
      while (series.length < i) series.push(null);
      run = [];
    }
    run.push(v);
    if (v !== null) lastIndex = i;
  });
  series.push(...emaSeries(run, span));
  return series;
}

// The L_p-Day Trend for `dates` and its change per L_p days, shared with Safe Pace. Run
// over the full history, then cropped, so the window's first days aren't cold-started.
function bodyMassTrendSeries(byDate, dates) {
  const trendDays = bodyMassSmoothingDays();
  if (!dates.length) return { trendDays, trendSeries: [], slopePerSpan: [] };
  const firstReading = [...byDate.keys()].sort()[0];
  const historyDates = firstReading && firstReading < dates[0]
    ? datesInRange(firstReading, dates[dates.length - 1])
    : dates;
  const offset = historyDates.length - dates.length;
  const values = historyDates.map((d) => (byDate.has(d) ? Math.round(byDate.get(d) * 100) / 100 : null));
  const trendSeries = bodyMassEmaSeries(values, trendDays);
  const slopePerSpan = emaSlopePerSpan(trendSeries, trendDays);
  return { trendDays, trendSeries: trendSeries.slice(offset), slopePerSpan: slopePerSpan.slice(offset) };
}

// The body mass logged calories alone imply: from startKg, each day adds its sleep-adjusted
// balance (Calorie Balance's arithmetic) as fat. kgByDate is each day's value at its START;
// balanceGPerDay is that day's own change, so a hover never reads the previous day's.
function calorieImpliedTrajectory(entries, bodyMassByDate, walkDates, startKg) {
  const bodyMassForDate = carryForwardBodyMassByDate(bodyMassByDate, walkDates);
  const intakeByDate = new Map();
  const tefByDate = new Map();
  const activityKcalByDate = new Map();
  const sleepHoursByDate = new Map();
  const add = (map, date, value) => map.set(date, (map.get(date) || 0) + value);
  entries.forEach((e) => {
    if (e.amount === null) return;
    if (e.category === 'Calories' || e.category === 'Calories; Protein') {
      add(intakeByDate, e.date, e.amount);
      // Measured TEF wins over the estimate, as on Calorie Balance.
      if (e.tefKcal !== null && e.tefKcal !== undefined) add(tefByDate, e.date, e.tefKcal);
    } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
      add(activityKcalByDate, e.date, activityEntryKcal(e, bodyMassForDate.get(e.date) ?? null));
    } else if (e.category === 'Sleep') {
      add(sleepHoursByDate, e.date, e.amount);
    }
  });
  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);

  const kgByDate = new Map();
  const balanceGPerDay = new Map();
  let running = startKg;
  walkDates.forEach((d) => {
    kgByDate.set(d, running);
    if (!intakeByDate.has(d)) return;
    const intake = intakeByDate.get(d);
    const maintenance = storedBmrForDate(d);
    if (maintenance === null) return;
    const activity = activityKcalByDate.get(d) || 0;
    const tef = tefByDate.has(d) ? tefByDate.get(d) : intake * (1 - tefDivisor());
    const { balance } = dailyEnergyBalanceKcal(intake, maintenance, activity, tef, sleepHoursByDate.get(d), sleepDesired);
    balanceGPerDay.set(d, Math.round((balance / GENERIC_KCAL_PER_KG_FAT) * 1000));
    running += balance / GENERIC_KCAL_PER_KG_FAT;
  });
  return { kgByDate, balanceGPerDay };
}

// Where the trend fell below the swing zone's floor: a real loss, not glycogen and water.
function muscleLossKg(anchorKg, trendKg, swingKg) {
  if (anchorKg === undefined || trendKg === null || trendKg === undefined) return null;
  return Math.min(trendKg, anchorKg - swingKg);
}

// The BMI twin axis: tick density matched to the kg axis, snapped to a clean BMI step.
function bodyMassBmiAxis(yMin, yMax, kgStep, heightCm) {
  const rawBmiStep = kgStep / Math.pow(heightCm / 100, 2);
  const bmiStep = BODY_MASS_BMI_TICK_STEPS.find((s) => s >= rawBmiStep)
    ?? BODY_MASS_BMI_TICK_STEPS[BODY_MASS_BMI_TICK_STEPS.length - 1];
  return {
    min: computeBmi(yMin, heightCm),
    max: computeBmi(yMax, heightCm),
    position: 'right',
    afterFit: fixDatedYAxisWidth,
    grid: { drawOnChartArea: false },
    ticks: { stepSize: bmiStep, includeBounds: false, callback: maskedUnitTick('kg/m²', bmiStep < 1 ? 1 : 0) },
  };
}

// Shaded green behind the readings: the same band bmiVerdict grades BMI_des against.
const BMI_HEALTHY_BAND = [BMI_HEALTHY_MIN, BMI_HEALTHY_MAX];
const BMI_HEALTHY_LEGEND_NAME = `Healthy BMI (${BMI_HEALTHY_BAND[0]}–${BMI_HEALTHY_BAND[1]})`;

// One gray dot per reading, on Caloric Intake's dates so the two compare bar for bar,
// with m_des marked across it and a BMI twin axis on the right.
function renderHealthBodyMassChart(entries) {
  const ctx = document.getElementById('health-body-mass-chart');

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const byDate = bodyMassByDateMap(bodyMassEntries);
  const dates = healthCalorieChartDates(entries);
  const lastDate = dates[dates.length - 1];

  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  // Smoothed trend and swing zone built off the full history, then read for these dates.
  const trendMap = computeBodyMassTrend(byDate);
  const lastTrendDate = [...trendMap.keys()].sort().pop();
  const trendSlopeByDate = computeBodyMassTrendSlopeGramsPerDay(trendMap);
  const storedMassByDay = storedMassByDate();
  const swingKg = lastTrendDate !== undefined ? glycogenSwingKg(byDate.get(lastTrendDate), heightCm, sex) : null;

  // Needs a full profile for BMR. Walked to the last plotted date, not the last reading,
  // so it agrees with the Status card's Δm on days without a fresh reading.
  let calorieTrendMap = new Map();
  let calorieDayBalanceGPerDay = new Map();
  if (haveProfile && byDate.size >= 1) {
    const runStartDate = bodyMassRunStartDate([...byDate.keys()].sort());
    const calorieTrendDates = datesInRange(runStartDate, lastDate);
    // Starts at the run's first L_p days' mean, so a bloated first day can't skew it.
    const startWindowEnd = calorieTrendDates[bodyMassSmoothingDays() - 1] ?? lastDate;
    const startKg = smoothedBodyMassKg(bodyMassEntries.filter((e) => e.date >= runStartDate && e.date <= startWindowEnd));
    ({ kgByDate: calorieTrendMap, balanceGPerDay: calorieDayBalanceGPerDay } = calorieImpliedTrajectory(entries, byDate, calorieTrendDates, startKg));
  }
  const haveZones = calorieTrendMap.size > 0 && swingKg !== null;
  const calorieTrendSeries = dates.map((d) => calorieTrendMap.get(d) ?? null);

  // Yellow zone: from the calorie-implied line down by the full swing.
  const zoneUpperSeries = calorieTrendSeries.slice();
  const zoneLowerSeries = dates.map((d) => {
    const c = calorieTrendMap.get(d);
    return c !== undefined && swingKg !== null ? c - swingKg : null;
  });

  const values = [];
  const detailByDate = new Map();
  dates.forEach((d) => {
    // An empty slot, not a zero: 0 kg is impossible and would drag the axis to it.
    if (!byDate.has(d)) {
      values.push(null);
      return;
    }
    const kg = Math.round(byDate.get(d) * 100) / 100;
    // BMI and Δm from the day's stored Derived cell, else calculated.
    const storedMass = storedMassByDay.get(d);
    const bmi = storedMass?.BMI ?? (heightCm !== null ? computeBmi(kg, heightCm) : null);
    const smoothedChangeGPerDay = massChangeGPerDay(storedMass) ?? trendSlopeByDate.get(d) ?? null;
    detailByDate.set(d, { bmi, smoothedChangeGPerDay });
    values.push(kg);
  });

  const { trendDays, trendSeries, slopePerSpan } = bodyMassTrendSeries(byDate, dates);
  const trendName = `${trendDays}-Day Trend`;

  // Explicit bounds, not `grace`: the twin axis derives from them. Series switched off in
  // the legend leave the fit too.
  const healthyKg = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  const hidden = legendHiddenNames('health-body-mass-legend');
  const dotClasses = values.map(() => 'Measured Body Mass');
  const shownValues = maskHiddenClasses(values, dotClasses, hidden);
  const shownIf = (name, series) => (hidden.has(name) ? [] : series);
  const logged = [
    ...shownValues,
    ...shownIf(trendName, trendSeries),
    ...shownIf('Glycogen + Water Swing', zoneUpperSeries),
    // Muscle Loss fills down from the swing's lower edge, so either keeps it.
    ...(hidden.has('Glycogen + Water Swing') && hidden.has('Muscle Loss') ? [] : zoneLowerSeries),
    ...shownIf('Calorie Trend', calorieTrendSeries),
    ...shownIf('Healthy Body Mass', [healthyKg]),
  ].filter((v) => v !== null);
  const kgLo = logged.length ? Math.min(...logged) : 0;
  const kgHi = logged.length ? Math.max(...logged) : 0;
  const kgPad = Math.max((kgHi - kgLo) * BODY_MASS_AXIS_PAD_FRACTION, BODY_MASS_AXIS_MIN_PAD_KG);

  // Bounds round out to a whole kg step so gridlines land on it; the step grows with the range.
  const kgStep = BODY_MASS_TICK_STEPS_KG.find((s) => (kgHi - kgLo + 2 * kgPad) / s <= BODY_MASS_MAX_GRIDLINES)
    ?? BODY_MASS_TICK_STEPS_KG[BODY_MASS_TICK_STEPS_KG.length - 1];
  const yMin = Math.max(0, Math.floor((kgLo - kgPad) / kgStep) * kgStep);
  const yMax = Math.ceil((kgHi + kgPad) / kgStep) * kgStep;

  // Stroke-less line behind the dots, for bands and overlays.
  const overlayLine = (label, data, extra) => ({
    type: 'line',
    label,
    data,
    borderWidth: 0,
    pointRadius: 0,
    pointHitRadius: 0,
    tension: 0,
    isStateTrendOverlay: true,
    ...extra,
  });

  healthBodyMassChart = upsertChart(healthBodyMassChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          // Gray dots joined by straight segments that span days with no reading.
          type: 'line',
          label: 'Body Mass',
          data: shownValues,
          showLine: true,
          borderColor: chartColor('--chart-neutral', 0.5),
          borderWidth: 1.5,
          tension: 0,
          spanGaps: true,
          pointRadius: fitPointRadius(5),
          pointHoverRadius: fitPointRadius(7),
          pointBackgroundColor: chartColor('--chart-neutral'),
          pointBorderColor: chartColor('--chart-point-border'),
          pointBorderWidth: fitPointBorderWidth(5, 1.5),
          order: 2,
        },
        trendLineDataset(trendName, trendSeries, { hidden: hidden.has(trendName) }),
        // Healthy BMI band: the upper edge fills down to the lower ('-1', so keep them adjacent).
        ...(heightCm !== null && dates.length ? BMI_HEALTHY_BAND.map((bmi, k) => overlayLine(
          `BMI ${bmi} edge`,
          new Array(dates.length).fill(bmi * (heightCm / 100) ** 2),
          {
            fill: k === 0 ? false : '-1',
            backgroundColor: chartColor('--chart-good', 0.12),
            hidden: hidden.has(BMI_HEALTHY_LEGEND_NAME),
            order: 4,
          },
        )) : []),
        ...(healthyKg !== null && dates.length
          ? [desiredCapDataset('Healthy Body Mass', new Array(dates.length).fill(healthyKg), desiredCapHalf(yMax - yMin), { isDesiredLine: true, backgroundColor: BODY_MASS_HEALTHY_COLOR(), hidden: hidden.has('Healthy Body Mass') })]
          : []),
        // Swing zone, Muscle Loss and the indigo trajectory, all off the calorie walk.
        // The '-1' chain runs upper → lower (yellow) → Muscle Loss (red); bands (3) sit behind the dots (2).
        ...(haveZones ? [
          overlayLine('Glycogen + Water Swing (upper)', zoneUpperSeries, { fill: false, spanGaps: false, order: 3 }),
          overlayLine('Glycogen + Water Swing', zoneLowerSeries, {
            // Hidden by its fill alone: Muscle Loss fills down from this edge.
            backgroundColor: hidden.has('Glycogen + Water Swing') ? 'transparent' : chartColor('--chart-warn', 0.15),
            fill: '-1',
            spanGaps: false,
            order: 3,
          }),
          overlayLine(
            'Muscle Loss (below swing zone)',
            dates.map((d) => muscleLossKg(calorieTrendMap.get(d), trendMap.get(d), swingKg)),
            { backgroundColor: chartColor('--chart-bad', 0.45), fill: '-1', spanGaps: false, hidden: hidden.has('Muscle Loss'), order: 3 },
          ),
          overlayLine('Calorie-Implied Trajectory', calorieTrendSeries, {
            // Indigo, so it can't pass for the gray dot line.
            borderColor: chartColor('--chart-indigo'),
            borderWidth: 2,
            fill: false,
            spanGaps: false,
            hidden: hidden.has('Calorie Trend'),
            order: 1.5,
          }),
        ] : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Otherwise the cursor lands on the trend line instead of the day's dot.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        title: {
          display: !values.some((v) => v !== null),
          text: 'No body mass readings logged in this range',
          color: Chart.defaults.color,
          font: { size: chartFontSize() },
          padding: { top: 40 },
        },
        tooltip: {
          // Gap days and overlay lines don't get rows of their own.
          filter: (item) => item.raw !== null && !item.dataset.isWeeklyAverage && !item.dataset.isStateTrendOverlay && !item.dataset.isDesiredLine,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const d = detailByDate.get(item.label) ?? {};
              const lines = [`m (Body Mass): ${item.parsed.y} kg`];
              // The smoothed trend's slope, not the raw day-to-day delta.
              if (d.smoothedChangeGPerDay !== null && d.smoothedChangeGPerDay !== undefined) {
                lines.push(`Δm (Changed Mass): ${withExplicitSign(d.smoothedChangeGPerDay)} g/day`);
              }
              if (d.bmi !== null && d.bmi !== undefined) lines.push(`BMI (Body Mass Index): ${d.bmi} kg/m²`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // The overlay lines' figures, one per line, all rates in g/day so they compare.
            // The slope is the day's own balance, the Status card's Δm arithmetic.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return [];
              const d = items[0].label;
              const lines = [];
              const trajectoryKg = calorieTrendMap.get(d);
              if (trajectoryKg !== undefined) {
                lines.push(`Calorie Trend: ${Math.round(trajectoryKg * 100) / 100} kg`);
                const slopeGPerDay = calorieDayBalanceGPerDay.get(d);
                if (slopeGPerDay !== undefined) lines.push(`Calorie Trend Slope: ${withExplicitSign(slopeGPerDay)} g/day`);
              }
              if (slopePerSpan[i] !== null) {
                lines.push(`${trendName}: ${withExplicitSign(Math.round((slopePerSpan[i] * 1000) / trendDays))} g/day`);
              }
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: datedCategoryXScale(dates),
        y: {
          // Not from zero: a 0 kg baseline flattens the movement the chart exists for.
          beginAtZero: false,
          position: 'left',
          min: yMin,
          max: yMax,
          afterFit: fixDatedYAxisWidth,
          // autoSkip off so the step is honoured exactly.
          ticks: { stepSize: kgStep, autoSkip: false, callback: maskedUnitTick('kg', kgStep < 1 ? 1 : 0) },
        },
        // A fixed linear rescale of kg, so it stays a pixel-for-pixel twin of y.
        y1: heightCm !== null ? bodyMassBmiAxis(yMin, yMax, kgStep, heightCm) : ghostRightAxis(),
      },
    },
  });
  // Swatches under the chart, named as in the hover.
  renderToggleLegend('health-body-mass-legend', [
    { name: 'Measured Body Mass', color: chartColor('--chart-neutral') },
    { name: trendName, color: desiredMarkColor() },
    ...(healthyKg !== null ? [{ name: 'Healthy Body Mass', color: BODY_MASS_HEALTHY_COLOR() }] : []),
    ...(heightCm !== null ? [{ name: BMI_HEALTHY_LEGEND_NAME, color: chartColor('--chart-good', 0.4) }] : []),
    ...(haveZones ? [
      { name: 'Calorie Trend', color: chartColor('--chart-indigo') },
      { name: 'Glycogen + Water Swing', color: chartColor('--chart-warn', 0.4) },
      { name: 'Muscle Loss', color: chartColor('--chart-bad', 0.45) },
    ] : []),
  ], () => renderHealthBodyMassChart(entries));
}
