// Body-Mass State Trend & Forecast chart (Health Chart), plus its progress meters and
// forecast notes. Shared helpers live in health-chart.js.

let healthProjectionChart = null;

// A meter mark every 2 kg, and every 4 weeks, from the first reading.
const PROJECTION_METER_MARK_KG = 2;
const PROJECTION_METER_MARK_DAYS = 28;
const PROJECTION_AXIS_PAD_FRACTION = 0.08;

function renderHealthProjectionChart(entries) {
  const ctx = document.getElementById('health-projection-chart');

  const meterWrap = document.getElementById('body-mass-progress-meter');
  const meterFill = document.getElementById('body-mass-progress-meter-fill');
  const meterCallout = document.getElementById('body-mass-progress-meter-callout');
  const meterDone = document.getElementById('body-mass-progress-meter-done');
  const meterRemaining = document.getElementById('body-mass-progress-meter-remaining');
  const meterHealthy = document.getElementById('body-mass-progress-meter-healthy');
  const timeWrap = document.getElementById('time-progress-meter');
  const timeElapsed = document.getElementById('time-progress-meter-elapsed');
  const timeRemaining = document.getElementById('time-progress-meter-remaining');
  const timeEta = document.getElementById('time-progress-meter-eta');
  const [meterTrack, timeTrack] = document.querySelectorAll('.body-mass-progress-meter-track');
  const etaEl = document.getElementById('body-mass-projection-eta');
  const plateauNote = document.getElementById('body-mass-plateau-note');
  const showMasked = (el, text) => { el.textContent = privacyMode ? maskDigits(text) : text; };
  const round1 = (v) => Math.round(v * 10) / 10;
  const dayCount = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const setMeter = (wrap, track, pct, markStep) => {
    wrap.style.setProperty('--meter-pct', `${pct}`);
    track.style.setProperty('--mark-step', `${markStep}`);
  };

  // Never hidden, so the card doesn't pop in late: reset to "—".
  [meterWrap, timeWrap].forEach((wrap) => {
    wrap.style.removeProperty('--fill-pct');
    wrap.style.setProperty('--meter-pct', '0');
  });
  [meterTrack, timeTrack].forEach((track) => track.style.removeProperty('--mark-step'));
  [meterFill, meterCallout, meterRemaining].forEach((el) => el.classList.remove('danger'));
  [meterDone, meterRemaining, timeElapsed, timeRemaining].forEach((el) => { el.textContent = '—'; });
  [meterCallout, meterHealthy, timeEta, etaEl, plateauNote].forEach((el) => { el.textContent = ''; });
  plateauNote.classList.remove('warning');

  const bodyMassEntries = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bodyMassEntries.length < 2) return;

  const firstDate = bodyMassEntries[0].date;
  const startBodyMass = bodyMassEntries[0].amount;
  const lastBodyMass = bodyMassEntries[bodyMassEntries.length - 1].amount;

  const proj = calcProjection(entries);
  if (!proj) return;

  const todayIso = isoFromDate(new Date());
  const heightCm = getSetting('HEIGHT_CM', null);
  const sex = getSettingString('SEX', null);
  const swingKg = glycogenSwingKg(lastBodyMass, heightCm, sex);

  // First reading to healthy, whatever the status: "wrong direction" in the danger colour.
  const bodyMassHealthy = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  const totalDelta = startBodyMass - bodyMassHealthy;
  if (Math.abs(totalDelta) >= BODY_MASS_AT_HEALTHY_TOLERANCE_KG) {
    const pct = Math.max(0, Math.min(100, ((startBodyMass - lastBodyMass) / totalDelta) * 100));
    const isWrongDirection = proj.status === 'wrong-direction';

    setMeter(meterWrap, meterTrack, pct, (PROJECTION_METER_MARK_KG / Math.abs(totalDelta)) * 100);
    meterFill.classList.toggle('danger', isWrongDirection);
    if (!isWrongDirection) meterWrap.style.setProperty('--fill-pct', `${Math.round(pct)}`);

    // The reading, then m̄ (as the Status card reads it) in brackets.
    const mBar = storedMassAsOf(todayIso)?.m_avg ?? planBodyMassKg(entries);
    showMasked(meterCallout, Number.isFinite(mBar)
      ? `${lastBodyMass} (${round1(mBar)}) kg`
      : `${lastBodyMass} kg`);
    meterCallout.classList.toggle('danger', isWrongDirection);

    showMasked(meterDone, `${round1(Math.abs(startBodyMass - lastBodyMass))} kg`);
    document.getElementById('body-mass-progress-meter-done-label').textContent = totalDelta > 0 ? 'lost' : 'gained';

    showMasked(meterRemaining, `${round1(Math.abs(lastBodyMass - bodyMassHealthy))} kg`);
    meterRemaining.classList.toggle('danger', isWrongDirection);

    // ± the glycogen/water swing: within it of healthy isn't a real miss.
    showMasked(meterHealthy, swingKg === null
      ? `→ ${bodyMassHealthy} kg`
      : `→ ${bodyMassHealthy} ± ${round1(swingKg)} kg`);
  }

  // An undrawable projection drops only the projected segment; the status line says why.
  const rateNote = () => `${proj.slope > 0 ? 'gaining' : 'losing'} ~${Math.abs(proj.slope * 7).toFixed(2)} kg/week`;
  const statusNote = {
    reached: () => 'Desired mass reached! 🎉',
    'no-change': () => 'No net change at current habits',
    'wrong-direction': () => `Current habits trend away from the desired mass — ${rateNote()}, so no arrival date can be projected`,
    // Right direction, but these habits' intake IS maintenance short of the desired mass.
    asymptote: () => `Currently ${rateNote()}, but these habits level off around ${round1(proj.equilibriumKg)} kg — the desired mass isn't reachable without changing them`,
  }[proj.status];
  if (statusNote) showMasked(etaEl, statusNote());

  const hasProjection = proj.status === 'ok';
  const projPoints = hasProjection ? proj.projectedPoints : [];

  // The same journey in time: elapsed since the first reading against days to go.
  if (hasProjection) {
    // UTC, so today sits on the same footing as every other date here.
    const daysElapsed = Math.max(0, Math.round((parseIsoDateUTC(todayIso) - parseIsoDateUTC(firstDate)) / MS_PER_DAY));
    const daysToGo = Math.max(0, proj.daysToHealthy);
    const totalDays = daysElapsed + daysToGo;

    if (totalDays > 0) {
      const timePct = Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
      setMeter(timeWrap, timeTrack, timePct, (PROJECTION_METER_MARK_DAYS / totalDays) * 100);
      timeWrap.style.setProperty('--fill-pct', `${Math.round(timePct)}`);
      showMasked(timeElapsed, dayCount(daysElapsed));
      showMasked(timeRemaining, dayCount(daysToGo));
      showMasked(timeEta, `→ ${shortYearDate(isoFromDate(proj.etaDate))}`);
    }
  }

  const histLabels = bodyMassEntries.map((e) => e.date);
  const projLabels = projPoints.map((p) => p.date);

  // Only points inside the From/To window plot. Kept sparse (readings and weekly projected
  // points), since a null beside a projected point breaks its spanGaps: false dashed line.
  const { from: windowFromDate, to: windowToDate } = healthDateRange();
  const inWindow = (d) => d >= windowFromDate && d <= windowToDate;
  const allLabels = [...new Set([...histLabels.filter(inWindow), ...projLabels.filter(inWindow)])].sort();
  if (!allLabels.length) return;

  const projMap = new Map(projPoints.map((p) => [p.date, p.bodyMass]));
  const lastDate = histLabels[histLabels.length - 1];
  const bodyMassByDate = bodyMassByDateMap(bodyMassEntries);
  const trendMap = computeBodyMassTrend(bodyMassByDate);

  // The trajectory logged calories alone imply; needs a profile for BMR. Its gap to the
  // trend is what calories can't explain.
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');
  const calorieTrendMap = haveProfile
    ? calorieImpliedTrajectory(entries, bodyMassByDate, datesInRange(firstDate, lastDate), startBodyMass).kgByDate
    : new Map();

  // The swing zone hangs below the calorie trajectory (its driest reading).
  const zoneAnchorMap = (swingKg === null || !haveProfile) ? null : calorieTrendMap;

  const plateauDays = detectPlateau(trendMap);
  if (plateauDays) {
    showMasked(plateauNote, `⚠️ Body mass trend has been flat for ~${plateauDays} days — consider adjusting your calorie limit`);
    plateauNote.classList.add('warning');
  }

  // A linear day-offset axis, so a weekly projected gap reads 7x a daily one.
  const firstDateMs = parseIsoDateUTC(allLabels[0]);
  const dayOffset = (dateStr) => Math.round((parseIsoDateUTC(dateStr) - firstDateMs) / MS_PER_DAY);
  const offsetToDateLabel = (offset) => shortYearDate(new Date(firstDateMs + offset * MS_PER_DAY).toISOString().slice(0, 10));
  const series = (yOf) => allLabels.map((d) => ({ x: dayOffset(d), y: yOf(d) }));
  // Invisible edges for the fills; tension 0 to match the trajectory's straight segments.
  const swingBand = (label, yOf, extra) => ({
    label,
    data: series(yOf),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    fill: '-1',
    spanGaps: false,
    isSwingBand: true,
    order: 5,
    ...extra,
  });
  const line = (label, yOf, borderColor, extra) => ({
    label,
    data: series(yOf),
    borderColor,
    borderWidth: 2,
    fill: false,
    tension: 0,
    pointRadius: 0,
    spanGaps: false,
    ...extra,
  });

  // No raw readings: Body Mass already plots them; this is the trend.
  const datasets = [
    // Omitted without a profile, not drawn at 0 (which would claim no glycogen swing).
    ...(zoneAnchorMap !== null ? [
      swingBand('Glycogen + Water Swing (upper)', (d) => zoneAnchorMap.get(d) ?? null, { fill: false }),
      swingBand('Glycogen + Water Swing', (d) => {
        const a = zoneAnchorMap.get(d);
        return a === undefined ? null : a - swingKg;
      }, { backgroundColor: chartColor('--chart-warn', 0.15) }),
      // A real loss, so a stronger tint than the zone's.
      swingBand('Muscle Loss (below swing zone)', (d) => muscleLossKg(zoneAnchorMap.get(d), trendMap.get(d), swingKg), {
        backgroundColor: chartColor('--chart-bad', 0.45),
      }),
    ] : []),
    line('State Trend & Forecast', (d) => trendMap.get(d) ?? null, chartColor('--chart-good'), { tension: 0.3, order: 4 }),
    ...(haveProfile
      ? [line('Calorie-Implied Trajectory', (d) => calorieTrendMap.get(d) ?? null, chartColor('--chart-neutral'), { order: 3 })]
      : []),
    // Omitted rather than plotted empty, so nothing claims a forecast exists.
    ...(hasProjection ? [line('Projected', (d) => {
      if (d === lastDate) return lastBodyMass;
      if (d > lastDate) return projMap.get(d) ?? null;
      return null;
    }, chartColor('--chart-indigo'), {
      // The app's one dash: the least certain line.
      borderDash: [4, 4],
      order: 2,
    })] : []),
    {
      // bodyMassHealthy, not proj.bodyMassHealthy: that's only set on an 'ok' projection.
      label: `${bodyMassHealthy} kg Desired`,
      data: series(() => bodyMassHealthy),
      // A line, not caps: a linear axis has no columns for caps.
      borderColor: desiredMarkColor(),
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 1,
    },
  ];

  // Explicit whole-kg bounds, so the BMI axis can derive from them. The swing band's
  // edges count, so the zone is never clipped.
  const swingExtremes = zoneAnchorMap === null ? [] : [...zoneAnchorMap.values()].flatMap((v) => [v + swingKg, v - swingKg]);
  const bodyMassValues = [...trendMap.values(), ...projMap.values(), ...swingExtremes, ...calorieTrendMap.values(), lastBodyMass, bodyMassHealthy]
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const bodyMassMin = Math.min(...bodyMassValues);
  const bodyMassMax = Math.max(...bodyMassValues);
  const bodyMassPad = Math.max(BODY_MASS_AXIS_MIN_PAD_KG, (bodyMassMax - bodyMassMin) * PROJECTION_AXIS_PAD_FRACTION);

  // No padding past the healthy mass when it's the extreme: nothing is drawn beyond it.
  const yMin = Math.floor(bodyMassMin < bodyMassHealthy ? bodyMassMin - bodyMassPad : bodyMassHealthy);
  const yMax = Math.ceil(bodyMassMax > bodyMassHealthy ? bodyMassMax + bodyMassPad : bodyMassHealthy);

  // The dates Body Mass and Caloric Intake plot, so this axis spans the same window.
  const axisDates = healthCalorieChartDates(entries);
  const axisFromDate = axisDates.length ? axisDates[0] : windowFromDate;
  const axisToDate = axisDates.length ? axisDates[axisDates.length - 1] : windowToDate;

  const scales = {
    x: {
      type: 'linear',
      // Pinned to the window's edges, to line up with the category-axis charts above.
      min: dayOffset(axisFromDate),
      max: dayOffset(axisToDate),
      // Same tick dates as the category axes; autoSkip off so they aren't thinned.
      afterBuildTicks: (axis) => {
        axis.ticks = wellnessTickIndices(axisDates).map((i) => ({ value: dayOffset(axisDates[i]) }));
      },
      ticks: { maxRotation: 45, minRotation: 45, autoSkip: false, callback: offsetToDateLabel },
    },
    y: {
      min: yMin,
      max: yMax,
      afterFit: fixDatedYAxisWidth,
      // Pinned: explicit min/max stop the auto step giving clean 1 kg steps.
      ticks: { stepSize: 1, callback: maskedUnitTick('kg') },
    },
  };
  // Skipped without a height. No BMI line: it would retrace the body-mass line.
  if (heightCm !== null) {
    scales.y1 = {
      // Exact, not rounded, so it stays a pixel-for-pixel twin.
      min: computeBmi(yMin, heightCm),
      max: computeBmi(yMax, heightCm),
      position: 'right',
      afterFit: fixDatedYAxisWidth,
      grid: { drawOnChartArea: false },
      ticks: {
        stepSize: 1,
        // Otherwise the exact min/max show as off-grid labels.
        includeBounds: false,
        callback: maskedUnitTick('BMI', 1),
      },
    };
  }

  // The canvas is hidden in the HTML; the meters and notes still fill.
  if (ctx) {
    healthProjectionChart = upsertChart(healthProjectionChart, ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          // Off like the rest of the section; series are named in the tooltip.
          legend: { display: false },
          tooltip: { external: null },
        },
        scales,
      },
    });
  }
}
