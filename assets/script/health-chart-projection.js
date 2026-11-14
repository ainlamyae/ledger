// Body-Mass State Trend & Forecast chart (Health Chart), plus the progress meters and
// forecast notes beside it. Shared math/helpers live in health-chart.js.

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
  // Never hidden, so the card doesn't pop in late and shift the page: reset to "—" here.
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

  const startBodyMass = bodyMassEntries[0].amount;
  const lastBodyMass = bodyMassEntries[bodyMassEntries.length - 1].amount;

  const proj = calcProjection(entries);
  if (!proj) return;

  // First reading to healthy, shown whatever the status: "wrong direction" in the danger colour.
  const bodyMassHealthy = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  const totalDelta = startBodyMass - bodyMassHealthy;
  if (Math.abs(totalDelta) >= BODY_MASS_AT_HEALTHY_TOLERANCE_KG) {
    const pct = Math.max(0, Math.min(100, ((startBodyMass - lastBodyMass) / totalDelta) * 100));
    const doneKg = Math.round(Math.abs(startBodyMass - lastBodyMass) * 10) / 10;
    const remainingKg = Math.round(Math.abs(lastBodyMass - bodyMassHealthy) * 10) / 10;
    const isWrongDirection = proj.status === 'wrong-direction';

    meterWrap.style.setProperty('--meter-pct', `${pct}`);
    meterTrack.style.setProperty('--mark-step', `${(PROJECTION_METER_MARK_KG / Math.abs(totalDelta)) * 100}`);
    meterFill.classList.toggle('danger', isWrongDirection);
    if (!isWrongDirection) meterWrap.style.setProperty('--fill-pct', `${Math.round(pct)}`);

    // The reading, then m̄ (as the Status card reads it) in brackets.
    const mBar = storedMassAsOf(isoFromDate(new Date()))?.m_avg ?? planBodyMassKg(entries);
    showMasked(meterCallout, Number.isFinite(mBar)
      ? `${lastBodyMass} (${Math.round(mBar * 10) / 10}) kg`
      : `${lastBodyMass} kg`);
    meterCallout.classList.toggle('danger', isWrongDirection);

    showMasked(meterDone, `${doneKg} kg`);
    // "lost" on a cut, "gained" on a bulk.
    document.getElementById('body-mass-progress-meter-done-label').textContent = totalDelta > 0 ? 'lost' : 'gained';

    showMasked(meterRemaining, `${remainingKg} kg`);
    meterRemaining.classList.toggle('danger', isWrongDirection);

    // ± the glycogen/water swing: a reading within it of the healthy mass isn't a real miss.
    const healthySwingKg = glycogenSwingKg(lastBodyMass, getSetting('HEIGHT_CM', null), getSettingString('SEX', null));
    showMasked(meterHealthy, healthySwingKg === null
      ? `→ ${bodyMassHealthy} kg`
      : `→ ${bodyMassHealthy} ± ${Math.round(healthySwingKg * 10) / 10} kg`);
  }

  // An undrawable projection drops only the projected segment; the status line says why.
  const rateNote = () => {
    const kgPerWeek = Math.abs(proj.slope * 7).toFixed(2);
    const direction = proj.slope > 0 ? 'gaining' : 'losing';
    return `${direction} ~${kgPerWeek} kg/week`;
  };
  const statusNote = {
    reached: () => 'Desired mass reached! 🎉',
    'no-change': () => 'No net change at current habits',
    'wrong-direction': () => `Current habits trend away from the desired mass — ${rateNote()}, so no arrival date can be projected`,
    // Right direction, but the intake these habits average IS maintenance short of the desired mass.
    asymptote: () => `Currently ${rateNote()}, but these habits level off around ${Math.round(proj.equilibriumKg * 10) / 10} kg — the desired mass isn't reachable without changing them`,
  }[proj.status];
  if (statusNote) showMasked(etaEl, statusNote());

  const hasProjection = proj.status === 'ok';
  const projPoints = hasProjection ? proj.projectedPoints : [];

  // The same journey in time: elapsed since the first reading against the forecast's days to go.
  if (hasProjection) {
    // Re-parsed as UTC, so today sits on the same footing as every other date here.
    const todayMs = parseIsoDateUTC(isoFromDate(new Date()));
    const daysElapsed = Math.max(0, Math.round((todayMs - parseIsoDateUTC(bodyMassEntries[0].date)) / 86400000));
    const daysToGo = Math.max(0, proj.daysToHealthy);
    const totalDays = daysElapsed + daysToGo;

    if (totalDays > 0) {
      const timePct = Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
      timeWrap.style.setProperty('--meter-pct', `${timePct}`);
      timeTrack.style.setProperty('--mark-step', `${(PROJECTION_METER_MARK_DAYS / totalDays) * 100}`);
      timeWrap.style.setProperty('--fill-pct', `${Math.round(timePct)}`);
      showMasked(timeElapsed, `${daysElapsed} ${daysElapsed === 1 ? 'day' : 'days'}`);
      showMasked(timeRemaining, `${daysToGo} ${daysToGo === 1 ? 'day' : 'days'}`);
      showMasked(timeEta, `→ ${isoFromDate(proj.etaDate)}`);
    }
  }

  const histLabels = bodyMassEntries.map((e) => e.date);
  const projLabels = projPoints.map((p) => p.date);

  // Only points inside the shared From/To window plot, forecast included. Kept sparse
  // (real readings and weekly projected points, not every calendar day), since a null
  // beside a projected point would break the spanGaps: false dashed line. The trend and
  // trajectory still use the full history so the window's left edge is right.
  const { from: windowFromDate, to: windowToDate } = healthDateRange();
  const inWindow = (d) => d >= windowFromDate && d <= windowToDate;
  const allLabels = [...new Set([...histLabels.filter(inWindow), ...projLabels.filter(inWindow)])].sort();
  if (!allLabels.length) return;

  const projMap = new Map(projPoints.map((p) => [p.date, p.bodyMass]));
  const lastDate = histLabels[histLabels.length - 1];
  const bodyMassByDate = bodyMassByDateMap(bodyMassEntries);

  const heightCm = getSetting('HEIGHT_CM', null);
  const sex = getSettingString('SEX', null);
  const swingKg = glycogenSwingKg(lastBodyMass, heightCm, sex);
  const trendMap = computeBodyMassTrend(bodyMassByDate);

  // The trajectory logged calories alone imply, from the first reading; needs a profile
  // for BMR. Its gap to the trend is what calories can't explain: water, glycogen, or a logging gap.
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');
  const calorieTrendMap = haveProfile
    ? calorieImpliedTrajectory(entries, bodyMassByDate, datesInRange(bodyMassEntries[0].date, lastDate), startBodyMass).kgByDate
    : new Map();

  // The swing zone hangs below the calorie trajectory, its driest possible reading, so
  // the trend's wobble above it is the glycogen/water noise.
  const zoneAnchorMap = (swingKg === null || !haveProfile) ? null : calorieTrendMap;

  const plateauDays = detectPlateau(trendMap);
  if (plateauDays) {
    showMasked(plateauNote, `⚠️ Body mass trend has been flat for ~${plateauDays} days — consider adjusting your calorie limit`);
    plateauNote.classList.add('warning');
  }

  // A linear day-offset axis, so a weekly projected gap reads 7x a daily one.
  const firstDateMs = parseIsoDateUTC(allLabels[0]);
  const dayOffset = (dateStr) => Math.round((parseIsoDateUTC(dateStr) - firstDateMs) / 86400000);
  const offsetToDateLabel = (offset) => new Date(firstDateMs + offset * 86400000).toISOString().slice(0, 10);
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

  // No raw per-reading series: Body Mass already plots every reading, this is the trend.
  const datasets = [
    // Omitted without a profile rather than drawn at 0, which would claim glycogen accounts for nothing.
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
    {
      label: 'State Trend & Forecast',
      data: series((d) => trendMap.get(d) ?? null),
      borderColor: chartColor('--chart-good'),
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      spanGaps: false,
      order: 4,
    },
    ...(haveProfile ? [{
      label: 'Calorie-Implied Trajectory',
      data: series((d) => calorieTrendMap.get(d) ?? null),
      borderColor: chartColor('--chart-neutral'),
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 3,
    }] : []),
    // Omitted rather than plotted empty, so nothing claims a forecast exists.
    ...(hasProjection ? [{
      label: 'Projected',
      data: series((d) => {
        if (d === lastDate) return lastBodyMass;
        if (d > lastDate) return projMap.get(d) ?? null;
        return null;
      }),
      borderColor: chartColor('--chart-indigo'),
      // The app's one dash, no heavier than the trend: it's the least certain line.
      borderDash: [4, 4],
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 2,
    }] : []),
    {
      // bodyMassHealthy, not proj.bodyMassHealthy: that's only set on an 'ok' projection.
      label: `${bodyMassHealthy} kg Desired`,
      data: series(() => bodyMassHealthy),
      // A line, not caps: a linear time axis has no columns for caps to sit on.
      borderColor: desiredMarkColor(),
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 1,
    },
  ];

  // Explicit bounds so the BMI axis can be derived from them, rounded to whole kg for
  // clean 1 kg gridlines. The swing band's edges count, so the zone is never clipped.
  const trendExtremes = zoneAnchorMap === null ? [] : [...zoneAnchorMap.values()].flatMap((v) => [v + swingKg, v - swingKg]);
  const bodyMassValues = [...trendMap.values(), ...projMap.values(), ...trendExtremes, ...calorieTrendMap.values(), lastBodyMass, bodyMassHealthy]
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const bodyMassMin = Math.min(...bodyMassValues);
  const bodyMassMax = Math.max(...bodyMassValues);
  const bodyMassPad = Math.max(BODY_MASS_AXIS_MIN_PAD_KG, (bodyMassMax - bodyMassMin) * PROJECTION_AXIS_PAD_FRACTION);

  // No padding past the healthy mass when it's the extreme: nothing is drawn beyond it.
  const yMin = bodyMassMin < bodyMassHealthy
    ? Math.floor(bodyMassMin - bodyMassPad)
    : Math.floor(bodyMassHealthy);
  const yMax = bodyMassMax > bodyMassHealthy
    ? Math.ceil(bodyMassMax + bodyMassPad)
    : Math.ceil(bodyMassHealthy);

  // The exact dates Body Mass and Caloric Intake plot, so this axis spans the same window.
  const axisDates = healthCalorieChartDates(entries);
  const axisFromDate = axisDates.length ? axisDates[0] : windowFromDate;

  const scales = {
    x: {
      type: 'linear',
      // Pinned to the window's edges, so a date lands at the same fraction across as on
      // the category-axis charts above.
      min: dayOffset(axisFromDate),
      max: dayOffset(axisDates.length ? axisDates[axisDates.length - 1] : windowToDate),
      // Ticks on the same dates the category axes pick; autoSkip off so they aren't thinned.
      afterBuildTicks: (axis) => {
        axis.ticks = wellnessTickIndices(axisDates).map((i) => ({ value: dayOffset(axisDates[i]) }));
      },
      // min = max rotation, so labels hold 45° like the rest of the section.
      ticks: { maxRotation: 45, minRotation: 45, autoSkip: false, callback: offsetToDateLabel },
    },
    y: {
      min: yMin,
      max: yMax,
      afterFit: fixDatedYAxisWidth,
      // Pinned: with explicit min/max the auto step stops giving clean 1 kg steps.
      ticks: { stepSize: 1, callback: maskedUnitTick('kg') },
    },
  };
  // Skipped without a height. No BMI line: it would retrace the body-mass line exactly.
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
        // Otherwise the exact min/max are forced on as off-grid labels.
        includeBounds: false,
        callback: maskedUnitTick('BMI', 1),
      },
    };
  }

  // The canvas is hidden in the HTML; the meters and notes above still fill.
  if (ctx) {
    healthProjectionChart = upsertChart(healthProjectionChart, ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          // Off like the rest of the section, so the plot isn't shortened; series are named in the tooltip.
          legend: { display: false },
          tooltip: { external: null },
        },
        scales,
      },
    });
  }
}
