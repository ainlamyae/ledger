// Body Mass chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthBodyMassChart = null;

// For a bar that can't be scored — the first reading, or a stall too short to call.
// Green would claim progress that isn't measured; red, a setback that isn't either.

// One flat reading is scale noise, not a plateau.
const BODY_MASS_STALL_RED_AFTER_DAYS = 2;

// The tolerance getCalorieDesiredKind and calcProjection also treat as "there" — no scale
// reading lands on a healthy mass to the gram.
const BODY_MASS_AT_HEALTHY_TOLERANCE_KG = 0.1;

function bodyMassIsHealthy(bodyMassKg) {
  const healthyKg = getSetting('BODY_MASS_HEALTHY_KG', null);
  return healthyKg !== null && bodyMassKg !== null && Math.abs(healthyKg - bodyMassKg) < BODY_MASS_AT_HEALTHY_TOLERANCE_KG;
}

// Progress since the previous reading; null is unscored (gray). A day the scale held
// still is judged by WHERE and HOW LONG: holding at the healthy mass is what success looks like,
// so it stays green; holding short of it only reads as a miss after
// BODY_MASS_STALL_RED_AFTER_DAYS, since one flat reading is as likely to be noise.
function bodyMassChangeIsProgress(deltaKg, bodyMassKg, healthyIsDownward, stallDays) {
  if (deltaKg === null) return null;
  if (deltaKg === 0) {
    if (bodyMassIsHealthy(bodyMassKg)) return true;
    return stallDays >= BODY_MASS_STALL_RED_AFTER_DAYS ? false : null;
  }
  return (deltaKg < 0) === healthyIsDownward;
}

// Deurenberg et al. 1991 (Br J Nutr): body fat % from BMI alone. The app has no direct
// measurement anywhere, so this is a population estimate at the same trust level as the
// USDA/AI calorie lookups.
function estimateBodyFatPercent(bodyMassKg, heightCm, age, sex) {
  const bmi = bodyMassKg / (heightCm / 100) ** 2;
  const sexTerm = sex === 'male' ? 1 : 0;
  return 1.20 * bmi + 0.23 * age - 10.8 * sexTerm - 5.4;
}

// Held to a plausible range, so a nonsense BMI can't produce a nonsense figure. Every
// fat-related value on this chart goes through it, so none of them can disagree.
function clampedBodyFatPercent(bodyMassKg, heightCm, age, sex) {
  return Math.max(3, Math.min(60, estimateBodyFatPercent(bodyMassKg, heightCm, age, sex)));
}

// Estimated fat mass (kg) at `bodyMassKg` — that clamped share of it.
function estimatedFatMassKg(bodyMassKg, heightCm, age, sex) {
  return bodyMassKg * (clampedBodyFatPercent(bodyMassKg, heightCm, age, sex) / 100);
}

// Energy stored in that fat mass, costed at fat's ~7,700 kcal/kg.
function fatEnergyKcal(bodyMassKg, heightCm, age, sex) {
  return estimatedFatMassKg(bodyMassKg, heightCm, age, sex) * GENERIC_KCAL_PER_KG_FAT;
}

// Headroom around the plotted range. The floor keeps a window of nearly identical
// readings off the top and bottom edges.
const BODY_MASS_AXIS_PAD_FRACTION = 0.15;
const BODY_MASS_AXIS_MIN_PAD_KG = 0.5;

// Smallest first; the first step keeping the count under BODY_MASS_MAX_GRIDLINES wins, so
// every line lands on a round kg.
const BODY_MASS_TICK_STEPS_KG = [0.5, 1, 2, 5, 10];
const BODY_MASS_MAX_GRIDLINES = 8;

// Cyan, so the healthy-mass mark can't pass for the 7-Day Trend's text colour.
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

// emaSeries, but restarted after a long gap and blank across it.
function bodyMassEmaSeries(values) {
  const series = [];
  let run = [];
  let lastIndex = null;
  values.forEach((v, i) => {
    if (v !== null && lastIndex !== null && i - lastIndex > BODY_MASS_RUN_MAX_GAP_DAYS) {
      series.push(...emaSeries(run.slice(0, lastIndex - (i - run.length) + 1)));
      while (series.length < i) series.push(null);
      run = [];
    }
    run.push(v);
    if (v !== null) lastIndex = i;
  });
  series.push(...emaSeries(run));
  return series;
}

// One bar per reading, scored by direction of travel on the same dates Caloric Intake
// uses, so the two compare bar for bar. m_des (BODY_MASS_HEALTHY_KG, Tune's healthy body
// mass) is marked across it with the section's desired-value cap.
//
// The twin axis restates each bar as the energy stored in the fat mass it implies.
// Body fat % moves with BMI, so that mapping is quadratic while a Chart.js twin axis
// can only be linear — anchoring at the ends of the kg range costs under 0.5% of the
// span on a typical window, 2.8% across an unusually wide 13 kg one.
function renderHealthBodyMassChart(entries) {
  const ctx = document.getElementById('health-body-mass-chart');

  const healthyIsDownward = bodyMassHealthyIsDownward(entries);

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const byDate = bodyMassByDateMap(bodyMassEntries);
  const dates = healthCalorieChartDates(entries);

  // Scored against the previous READING, not the previous day, so logging every third
  // day still leaves every bar something to compare against — the leftmost included,
  // seeded from the last body-mass reading before the window. stallStartDate is where the
  // current run of identical readings began, so a plateau predating the window still
  // counts its full length.
  let previousKg = null;
  let previousDate = null;
  let stallStartDate = null;
  [...byDate.keys()].sort().forEach((d) => {
    if (d >= dates[0]) return;
    const kg = Math.round(byDate.get(d) * 100) / 100;
    if (previousKg === null || kg !== previousKg) stallStartDate = d;
    previousKg = kg;
    previousDate = d;
  });

  // Read before the loop, so each day's fat energy can be worked out as it goes.
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  // The same smoothed line and glycogen/water swing zone State Trend & Forecast draws
  // (computeBodyMassTrend/computeGlycogenZoneAnchor in health-math.js, glycogenSwingKg here), built off
  // the FULL history in `byDate` rather than just this window — smoothing needs the
  // context past the window's edges to agree with the other chart there — then read back
  // only for the dates this chart actually plots.
  const trendMap = computeBodyMassTrend(byDate);
  const trendDates = [...trendMap.keys()].sort();
  const lastTrendDate = trendDates[trendDates.length - 1];
  // Its slope at each point, read back below alongside the raw day-to-day delta, so a
  // single noisy body-mass reading doesn't read as the real trend.
  const trendSlopeByDate = computeBodyMassTrendSlopeGramsPerDay(trendMap);
  const storedMassByDay = storedMassByDate();
  const swingKg = lastTrendDate !== undefined ? glycogenSwingKg(byDate.get(lastTrendDate), heightCm, sex) : null;

  // Calorie-implied trajectory: same walk the (now-hidden) State Trend & Forecast chart
  // built — start at the first body-mass reading and advance by each day's calorie balance. Used
  // here for the indigo reference line, the yellow zone, and the Muscle Loss red zone.
  // Requires a full profile (height/age/sex) for BMR; omitted otherwise.
  const calorieTrendMap = new Map();
  // Each day's OWN balance-implied change, in grams — the exact figure the Status card's
  // Δm computes for today, kept per-date here so the hover's Calorie Trend Slope can read
  // it directly instead of diffing two calorieTrendMap points (see the comment where this
  // is filled in below for why that diff is off by a day).
  const calorieDayBalanceGPerDay = new Map();
  if (haveProfile) {
    const sortedWeighInDates = [...byDate.keys()].sort();
    if (sortedWeighInDates.length >= 1) {
      // Through the chart's own last plotted date, not just the last actual body-mass reading —
      // otherwise a day (or several) without a fresh body-mass reading leaves this line flat short
      // of today, disagreeing with the Status card's own Δm for a day it never reaches.
      // carryForwardBodyMassByDate below fills the gap with the last known reading.
      const runStartDate = bodyMassRunStartDate(sortedWeighInDates);
      const calorieTrendDates = datesInRange(runStartDate, dates[dates.length - 1]);
      const calorieBodyMassForDate = carryForwardBodyMassByDate(byDate, calorieTrendDates);
      const cIntakeByDate = new Map();
      const cTefByDate = new Map();
      const cActivityKcalByDate = new Map();
      const cSleepHoursByDate = new Map();
      entries.forEach((e) => {
        if (e.amount === null) return;
        if (e.category === 'Calories' || e.category === 'Calories; Protein') {
          cIntakeByDate.set(e.date, (cIntakeByDate.get(e.date) || 0) + e.amount);
          if (e.tefKcal !== null && e.tefKcal !== undefined) {
            cTefByDate.set(e.date, (cTefByDate.get(e.date) || 0) + e.tefKcal);
          }
        } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
          const kcal = activityEntryKcal(e, calorieBodyMassForDate.get(e.date) ?? null);
          cActivityKcalByDate.set(e.date, (cActivityKcalByDate.get(e.date) || 0) + kcal);
        } else if (e.category === 'Sleep') {
          cSleepHoursByDate.set(e.date, (cSleepHoursByDate.get(e.date) || 0) + e.amount);
        }
      });
      const cSleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
      let running = byDate.get(runStartDate);
      calorieTrendDates.forEach((d) => {
        // Plotted BEFORE this day's own balance is folded in — calorieTrendMap.get(d) is
        // the trajectory as of the START of d (last night's number), and d's own balance
        // only shows up in TOMORROW's point. Reading two consecutive points back out of
        // calorieTrendMap to get "today's slope" would therefore actually read YESTERDAY's
        // balance instead — calorieDayBalanceGPerDay below is captured right here, the one
        // place that balance actually exists per day, so the hover's slope line can't get
        // the date shifted by one the way a naive point-to-point diff did.
        calorieTrendMap.set(d, running);
        if (!cIntakeByDate.has(d)) return;
        const intake = cIntakeByDate.get(d);
        const maintenance = storedBmrForDate(d);
        if (maintenance === null) return;
        const activity = cActivityKcalByDate.get(d) || 0;
        const tef = cTefByDate.has(d) ? cTefByDate.get(d) : intake * (1 - tefDivisor());
        const { balance } = dailyEnergyBalanceKcal(intake, maintenance, activity, tef, cSleepHoursByDate.get(d), cSleepDesired);
        calorieDayBalanceGPerDay.set(d, Math.round((balance / GENERIC_KCAL_PER_KG_FAT) * 1000));
        running += balance / GENERIC_KCAL_PER_KG_FAT;
      });
    }
  }
  const calorieTrendSeries = dates.map((d) => calorieTrendMap.get(d) ?? null);

  // Yellow zone anchored to the calorie-implied trajectory, matching State Trend &
  // Forecast exactly: upper edge = indigo line, lower edge = indigo line − full swingKg.
  const zoneUpperSeries = dates.map((d) => calorieTrendMap.get(d) ?? null);
  const zoneLowerSeries = dates.map((d) => {
    const c = calorieTrendMap.get(d);
    return c !== undefined && swingKg !== null ? c - swingKg : null;
  });

  const values = [];
  const barColors = [];
  const detailByDate = new Map();

  dates.forEach((d) => {
    if (!byDate.has(d)) {
      // An empty slot, not a zero: 0 kg is impossible and would drag the axis to it.
      values.push(null);
      barColors.push(chartColor('--chart-neutral'));
      return;
    }

    const kg = Math.round(byDate.get(d) * 100) / 100;
    // Unscored after a long gap: the old reading says nothing about this one.
    const afterGap = previousDate !== null
      && (parseIsoDateUTC(d) - parseIsoDateUTC(previousDate)) / 86400000 > BODY_MASS_RUN_MAX_GAP_DAYS;
    const delta = previousKg === null || afterGap ? null : Math.round((kg - previousKg) * 100) / 100;
    if (delta !== 0) stallStartDate = d;
    const stallDays = delta === 0
      ? Math.round((parseIsoDateUTC(d) - parseIsoDateUTC(stallStartDate)) / 86400000)
      : 0;
    const progress = bodyMassChangeIsProgress(delta, kg, healthyIsDownward, stallDays);

    const fatKcal = haveProfile ? fatEnergyKcal(kg, heightCm, age, sex) : null;
    // BMI needs only height, so it survives a profile missing birth date or sex.
    // BMI and Δm (Changed Mass) as stored in the day's Derived cell (health-physique.js), read
    // rather than worked out; a day without one falls back to the calculation.
    const storedMass = storedMassByDay.get(d);
    const bmi = storedMass?.BMI ?? (heightCm !== null ? computeBmi(kg, heightCm) : null);
    const smoothedChangeGPerDay = massChangeGPerDay(storedMass) ?? trendSlopeByDate.get(d) ?? null;
    detailByDate.set(d, { delta, fatKcal, bmi, smoothedChangeGPerDay });

    values.push(kg);
    barColors.push(progress === null ? chartColor('--chart-neutral') : (progress ? chartColor('--chart-good') : chartColor('--chart-bad')));
    previousKg = kg;
    previousDate = d;
  });

  // Smoothed, not flat: a bar here is an absolute level, so a flat week's mean says
  // little and its direction says everything. An EMA rather than a per-week fit, so the
  // line has no seam at a bucket boundary — today's own body-mass reading blends straight in,
  // same as any other day.
  const trendSeries = bodyMassEmaSeries(values);
  const slopePerWeek = emaSlopePerSpan(trendSeries);

  // A single reading away from the healthy mass reads as noise, not a reversal, when the week
  // it belongs to is still trending the right way overall — gray it out rather than
  // calling it a miss. Stall-days are untouched: their red already means something else.
  dates.forEach((d, i) => {
    if (barColors[i] !== chartColor('--chart-bad')) return;
    const delta = detailByDate.get(d)?.delta;
    if (!delta) return;
    const slope = slopePerWeek[i];
    if (slope === null || slope === undefined) return;
    if ((slope < 0) === healthyIsDownward) barColors[i] = chartColor('--chart-neutral');
  });

  // Explicit bounds, not `grace`: the twin axis derives from them and Chart.js resolves
  // `grace` too late to read here. The trend folds in too — a fit extended to the week's
  // edges can reach past every reading in it, and would otherwise clip.
  const healthyKg = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  // Legend entries switched off (renderToggleLegend below) leave the axis too; dots by their colour's name.
  const hidden = legendHiddenNames('health-body-mass-legend');
  const dotClasses = barColors.map((c) => (c === chartColor('--chart-good') ? 'Toward healthy'
    : c === chartColor('--chart-bad') ? 'Away from healthy' : 'Unscored'));
  const shownValues = maskHiddenClasses(values, dotClasses, hidden);
  const shownIf = (name, series) => (hidden.has(name) ? [] : series);
  const logged = [
    ...shownValues,
    ...shownIf('7-Day Trend', trendSeries),
    ...shownIf('Glycogen + Water Swing', zoneUpperSeries),
    // Muscle Loss fills down from the swing's lower edge, so either keeps it.
    ...(hidden.has('Glycogen + Water Swing') && hidden.has('Muscle Loss') ? [] : zoneLowerSeries),
    ...shownIf('Calorie Trend', calorieTrendSeries),
    ...shownIf('Healthy Body Mass', [healthyKg]),
  ].filter((v) => v !== null);
  const kgLo = logged.length ? Math.min(...logged) : 0;
  const kgHi = logged.length ? Math.max(...logged) : 0;
  const kgPad = Math.max((kgHi - kgLo) * BODY_MASS_AXIS_PAD_FRACTION, BODY_MASS_AXIS_MIN_PAD_KG);

  // kg owns the gridlines, so both bounds round out to a whole step of it — otherwise
  // the lines land wherever the padding left them. The step grows with the range.
  const kgStep = BODY_MASS_TICK_STEPS_KG.find((s) => (kgHi - kgLo + 2 * kgPad) / s <= BODY_MASS_MAX_GRIDLINES)
    ?? BODY_MASS_TICK_STEPS_KG[BODY_MASS_TICK_STEPS_KG.length - 1];
  const yMin = Math.max(0, Math.floor((kgLo - kgPad) / kgStep) * kgStep);
  const yMax = Math.ceil((kgHi + kgPad) / kgStep) * kgStep;

  healthBodyMassChart = upsertChart(healthBodyMassChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          // Colored dots joined by a thin connecting line. The dots still carry
          // the meaning (barColors — green progress / red regression / gray noise),
          // exactly as when this was dots-only (showLine: false). The line is a
          // quiet neutral thread just to show the shape: tension 0 so it's straight
          // segments rather than a smoothed curve, and spanGaps on so every reading
          // joins the next, across days with none.
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
          pointBackgroundColor: barColors,
          pointBorderColor: chartColor('--chart-point-border'),
          pointBorderWidth: fitPointBorderWidth(5, 1.5),
          order: 2,
        },
        trendLineDataset('7-Day Trend', trendSeries, { hidden: hidden.has('7-Day Trend') }),
        ...(healthyKg !== null && dates.length
          ? [desiredCapDataset('Healthy Body Mass', new Array(dates.length).fill(healthyKg), desiredCapHalf(yMax - yMin), { isDesiredLine: true, backgroundColor: BODY_MASS_HEALTHY_COLOR(), hidden: hidden.has('Healthy Body Mass') })]
          : []),
        // Yellow zone, Muscle Loss red zone, and indigo Calorie-Implied Trajectory line —
        // all anchored to the calorie-implied trajectory and omitted together whenever the
        // profile is incomplete (no BMR → no trajectory). fill: '-1' chain runs upper →
        // lower (yellow fill) → Muscle Loss (red fill), matching State Trend & Forecast.
        // Band order (3) sits behind the dots (2); lines use lower orders to read on top.
        ...(calorieTrendMap.size > 0 && swingKg !== null ? [
          {
            type: 'line',
            label: 'Glycogen + Water Swing (upper)',
            data: zoneUpperSeries,
            borderWidth: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0,
            fill: false,
            spanGaps: false,
            isStateTrendOverlay: true,
            order: 3,
          },
          {
            type: 'line',
            label: 'Glycogen + Water Swing',
            data: zoneLowerSeries,
            // Hidden by its fill alone: Muscle Loss fills down from this edge.
            backgroundColor: hidden.has('Glycogen + Water Swing') ? 'transparent' : chartColor('--chart-warn', 0.15),
            borderWidth: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0,
            fill: '-1',
            spanGaps: false,
            isStateTrendOverlay: true,
            order: 3,
          },
          {
            type: 'line',
            label: 'Muscle Loss (below swing zone)',
            data: dates.map((d) => {
              const c = calorieTrendMap.get(d);
              const trend = trendMap.get(d);
              if (c === undefined || trend === null || trend === undefined) return null;
              return Math.min(trend, c - swingKg);
            }),
            backgroundColor: chartColor('--chart-bad', 0.45),
            borderWidth: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0,
            fill: '-1',
            spanGaps: false,
            isStateTrendOverlay: true,
            hidden: hidden.has('Muscle Loss'),
            order: 3,
          },
          {
            type: 'line',
            label: 'Calorie-Implied Trajectory',
            data: calorieTrendSeries,
            // Indigo, like the forecast's Projected line, so it can't pass for the gray dot line.
            borderColor: chartColor('--chart-indigo'),
            borderWidth: 2,
            fill: false,
            tension: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            spanGaps: false,
            isStateTrendOverlay: true,
            hidden: hidden.has('Calorie Trend'),
            order: 1.5,
          },
        ] : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Matching the other charts in the section — without it the cursor lands on the
      // trend line instead of the day's bar, and that row is filtered out.
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
          // Days with no body-mass reading plot as a gap; index mode would otherwise hand them
          // over as an empty row.
          filter: (item) => item.raw !== null && !item.dataset.isWeeklyAverage && !item.dataset.isStateTrendOverlay && !item.dataset.isDesiredLine,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const d = detailByDate.get(item.label) ?? {};
              const lines = [`m (Body Mass): ${item.parsed.y} kg`];
              // The smoothed trend's own slope, not the raw day-to-day delta a single
              // water/glycogen-heavy body-mass reading would swing — this is the one shown.
              if (d.smoothedChangeGPerDay !== null && d.smoothedChangeGPerDay !== undefined) {
                lines.push(`Δm (Changed Mass): ${withExplicitSign(d.smoothedChangeGPerDay)} g/day`);
              }
              // BMI leads the derived rows because the rest are computed from it.
              // Unitless by definition, so no unit.
              if (d.bmi !== null && d.bmi !== undefined) lines.push(`BMI (Body Mass Index): ${d.bmi} kg/m²`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // Flush left and last, like every reference figure in the section. One fact
            // per line, same rule every other row in this tooltip already follows (the
            // label callback's own Body Mass/Changed Mass/BMI rows never combine two
            // figures on one line either) — value and slope are two separate lines, not
            // one line with the slope parenthesized after the value.
            //
            // The indigo line (renamed "Calorie Trend" for the hover — "Calorie-Implied
            // Trajectory" is the chart's own internal/legend name) is filtered out of the
            // item rows above (isStateTrendOverlay), same as every other overlay line, so
            // its own value/slope never showed anywhere in the hover — added here instead,
            // right above 7-Day Trend so the two rates read together. calorieTrendMap
            // already holds its value per date.
            //
            // Slope is that day's OWN balance-implied change (calorieDayBalanceGPerDay,
            // captured while the trajectory is built above), not a diff between two
            // calorieTrendMap points — calorieTrendMap.get(d) is the trajectory as of the
            // START of d, so a naive point-to-point diff actually reads the PRIOR day's
            // balance (the one that moved d-1's point to d's), landing one day off from
            // what the number was labeled as. Reading the captured balance directly is
            // also exactly the Status card's own Δm arithmetic for today, so the two can't
            // disagree the way a diffed or averaged figure could.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return [];
              const d = items[0].label;
              const lines = [];
              if (healthyKg !== null) lines.push(`m_des (Healthy Body Mass): ${healthyKg} kg`);

              const trajectoryKg = calorieTrendMap.get(d);
              if (trajectoryKg !== undefined) {
                lines.push(`Calorie Trend: ${Math.round(trajectoryKg * 100) / 100} kg`);
                const slopeGPerDay = calorieDayBalanceGPerDay.get(d);
                if (slopeGPerDay !== undefined) {
                  // g/day, not kg/week — same unit Δm (Changed Mass) above uses, so the
                  // two rates read on the same scale instead of forcing a unit conversion
                  // to compare them.
                  lines.push(`Calorie Trend Slope: ${withExplicitSign(slopeGPerDay)} g/day`);
                }
              }

              // g/day like Δm and Calorie Trend Slope above, so all three rates compare
              // directly (the slope itself is kg per week).
              if (slopePerWeek[i] !== null) {
                lines.push(`7-Day Trend: ${withExplicitSign(Math.round((slopePerWeek[i] * 1000) / 7))} g/day`);
              }

              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          // Must NOT begin at zero — a 0 kg baseline puts every bar within a pixel of
          // the same height and hides the movement the chart exists for.
          beginAtZero: false,
          position: 'left',
          min: yMin,
          max: yMax,
          afterFit: fixDatedYAxisWidth,
          // autoSkip off so the step is honoured exactly.
          ticks: { stepSize: kgStep, autoSkip: false, callback: maskedUnitTick('kg', kgStep < 1 ? 1 : 0) },
        },
        // BMI (kg/m²) right axis — a fixed linear rescale of kg so it stays a true
        // pixel-for-pixel twin of y. Step derived from kgStep / height² so the tick
        // density matches the left axis, then snapped to the nearest clean BMI step.
        y1: heightCm !== null
          ? (() => {
            const BMI_TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5];
            const rawBmiStep = kgStep / Math.pow(heightCm / 100, 2);
            const bmiStep = BMI_TICK_STEPS.find((s) => s >= rawBmiStep) ?? BMI_TICK_STEPS[BMI_TICK_STEPS.length - 1];
            return {
              min: computeBmi(yMin, heightCm),
              max: computeBmi(yMax, heightCm),
              position: 'right',
              afterFit: fixDatedYAxisWidth,
              grid: { drawOnChartArea: false },
              ticks: {
                stepSize: bmiStep,
                includeBounds: false,
                callback: maskedUnitTick('kg/m²', bmiStep < 1 ? 1 : 0),
              },
            };
          })()
          : ghostRightAxis(),
      },
    },
  });
  // Swatches under the chart, named as in the hover.
  const haveZones = calorieTrendMap.size > 0 && swingKg !== null;
  renderToggleLegend('health-body-mass-legend', [
    { name: 'Toward healthy', color: chartColor('--chart-good') },
    { name: 'Away from healthy', color: chartColor('--chart-bad') },
    { name: 'Unscored', color: chartColor('--chart-neutral') },
    { name: '7-Day Trend', color: desiredMarkColor() },
    ...(healthyKg !== null ? [{ name: 'Healthy Body Mass', color: BODY_MASS_HEALTHY_COLOR() }] : []),
    ...(haveZones ? [
      { name: 'Calorie Trend', color: chartColor('--chart-indigo') },
      { name: 'Glycogen + Water Swing', color: chartColor('--chart-warn', 0.4) },
      { name: 'Muscle Loss', color: chartColor('--chart-bad', 0.45) },
    ] : []),
  ], () => renderHealthBodyMassChart(entries));
}

