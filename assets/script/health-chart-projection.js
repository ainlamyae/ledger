// Body-Mass State Trend & Forecast chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthProjectionChart = null;

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
  // Never hidden: the card is in the page from the first paint with "—" in it, like
  // the Status cards beside it, and this only fills it in (or back to "—" when there
  // isn't enough logged to measure progress). Hiding it until the data arrived made it
  // pop in after everything else and shift the page under it.
  meterWrap.style.removeProperty('--fill-pct');
  meterTrack.style.removeProperty('--mark-step');
  timeTrack.style.removeProperty('--mark-step');
  meterWrap.style.setProperty('--meter-pct', '0');
  meterFill.classList.remove('danger');
  meterCallout.textContent = '';
  meterCallout.classList.remove('danger');
  meterDone.textContent = '—';
  meterRemaining.textContent = '—';
  meterHealthy.textContent = '';
  meterRemaining.classList.remove('danger');
  timeWrap.style.removeProperty('--fill-pct');
  timeWrap.style.setProperty('--meter-pct', '0');
  timeElapsed.textContent = '—';
  timeRemaining.textContent = '—';
  timeEta.textContent = '';
  etaEl.textContent = '';
  plateauNote.textContent = '';
  plateauNote.classList.remove('warning');

  const bodyMassEntries = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bodyMassEntries.length < 2) return;

  const startBodyMass = bodyMassEntries[0].amount;
  const lastBodyMass = bodyMassEntries[bodyMassEntries.length - 1].amount;

  const proj = calcProjection(entries);
  if (!proj) return;

  // First logged body mass to healthy, shown whatever the trajectory status — "wrong
  // direction" is worth seeing, just in the danger colour. Both readouts are kg so the
  // pair compares directly; the percentage still drives the bar's width.
  const bodyMassHealthy = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  const totalDelta = startBodyMass - bodyMassHealthy;
  if (Math.abs(totalDelta) >= 0.1) {
    const pct = Math.max(0, Math.min(100, ((startBodyMass - lastBodyMass) / totalDelta) * 100));
    const doneKg = Math.round(Math.abs(startBodyMass - lastBodyMass) * 10) / 10;
    const remainingKg = Math.round(Math.abs(lastBodyMass - bodyMassHealthy) * 10) / 10;
    const isWrongDirection = proj.status === 'wrong-direction';

    meterWrap.style.setProperty('--meter-pct', `${pct}`);
    // A mark every 2 kg from the first reading.
    meterTrack.style.setProperty('--mark-step', `${(2 / Math.abs(totalDelta)) * 100}`);
    meterFill.classList.toggle('danger', isWrongDirection);
    if (!isWrongDirection) meterWrap.style.setProperty('--fill-pct', `${Math.round(pct)}`);

    // The reading, then m̄ (the rolling average, as the Status card reads it) in brackets.
    const mBar = storedMassAsOf(isoFromDate(new Date()))?.m_avg ?? planBodyMassKg(entries);
    const currentText = Number.isFinite(mBar)
      ? `${lastBodyMass} (${Math.round(mBar * 10) / 10}) kg`
      : `${lastBodyMass} kg`;
    meterCallout.textContent = privacyMode ? maskDigits(currentText) : currentText;
    meterCallout.classList.toggle('danger', isWrongDirection);

    const doneText = `${doneKg} kg`;
    meterDone.textContent = privacyMode ? maskDigits(doneText) : doneText;
    // "lost" on a cut, "gained" on a bulk: the healthy mass's side of the first body-mass reading.
    document.getElementById('body-mass-progress-meter-done-label').textContent = totalDelta > 0 ? 'lost' : 'gained';

    const remainingText = `${remainingKg} kg`;
    meterRemaining.textContent = privacyMode ? maskDigits(remainingText) : remainingText;
    meterRemaining.classList.toggle('danger', isWrongDirection);

    // The swing (see glycogenSwingKg) alongside the healthy mass itself — its line is a
    // single number, but any reading within this band of it is glycogen and water, not a
    // real miss, the same margin State Trend & Forecast's own zone and arrival math use.
    const healthySwingKg = glycogenSwingKg(lastBodyMass, getSetting('HEIGHT_CM', null), getSettingString('SEX', null));
    const healthyText = healthySwingKg === null
      ? `→ ${bodyMassHealthy} kg`
      : `→ ${bodyMassHealthy} ± ${Math.round(healthySwingKg * 10) / 10} kg`;
    meterHealthy.textContent = privacyMode ? maskDigits(healthyText) : healthyText;
  }

  // An undrawable projection drops only the projected SEGMENT. It used to `return`
  // here, but the chart is destroyed at the top of this function, so the panel went
  // blank and took the history, trend and healthy lines with it — none of which depend on
  // a projection. The status line says why, and the rate keeps it concrete.
  const rateNote = () => {
    const kgPerWeek = Math.abs(proj.slope * 7).toFixed(2);
    const direction = proj.slope > 0 ? 'gaining' : 'losing';
    return `${direction} ~${kgPerWeek} kg/week`;
  };
  const statusNote = {
    reached: () => 'Desired mass reached! 🎉',
    'no-change': () => 'No net change at current habits',
    'wrong-direction': () => `Current habits trend away from the desired mass — ${rateNote()}, so no arrival date can be projected`,
    // Right direction, but it decays to zero before the desired mass: the intake these
    // habits average IS maintenance at that body mass.
    asymptote: () => `Currently ${rateNote()}, but these habits level off around ${Math.round(proj.equilibriumKg * 10) / 10} kg — the desired mass isn't reachable without changing them`,
  }[proj.status];
  if (statusNote) {
    const note = statusNote();
    etaEl.textContent = privacyMode ? maskDigits(note) : note;
  }

  const hasProjection = proj.status === 'ok';
  const projPoints = hasProjection ? proj.projectedPoints : [];

  // The same journey in time rather than kg: elapsed since the first body-mass reading against
  // the forecast's remaining days. A long time bar beside a short body-mass bar is itself
  // the signal that progress is slower than the effort. Needs an arrival date.
  if (hasProjection) {
    // Re-parsed as UTC, so today sits on the same footing as every other date here.
    const todayMs = parseIsoDateUTC(isoFromDate(new Date()));
    const daysElapsed = Math.max(0, Math.round((todayMs - parseIsoDateUTC(bodyMassEntries[0].date)) / 86400000));
    const daysToGo = Math.max(0, proj.daysToHealthy);
    const totalDays = daysElapsed + daysToGo;

    if (totalDays > 0) {
      const timePct = Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
      timeWrap.style.setProperty('--meter-pct', `${timePct}`);
      // A mark every 4 weeks from the first reading.
      timeTrack.style.setProperty('--mark-step', `${(28 / totalDays) * 100}`);
      timeWrap.style.setProperty('--fill-pct', `${Math.round(timePct)}`);

      const elapsedText = `${daysElapsed} ${daysElapsed === 1 ? 'day' : 'days'}`;
      timeElapsed.textContent = privacyMode ? maskDigits(elapsedText) : elapsedText;

      const toGoText = `${daysToGo} ${daysToGo === 1 ? 'day' : 'days'}`;
      timeRemaining.textContent = privacyMode ? maskDigits(toGoText) : toGoText;

      const etaText = `→ ${isoFromDate(proj.etaDate)}`;
      timeEta.textContent = privacyMode ? maskDigits(etaText) : etaText;
    }
  }

  const histLabels = bodyMassEntries.map((e) => e.date);
  const projLabels = projPoints.map((p) => p.date);

  // The same From/To window every other chart under this one reads
  // (healthDateRange), bounding BOTH ends — nothing plots outside it, forecast
  // included, same as Body Mass/Calorie Balance/Physical Activity/Caloric Intake
  // never show a "tomorrow" bar either. With the default To (today) that means no
  // projected segment is visible until To is pushed into the future.
  //
  // Filtered from histLabels/projLabels themselves, NOT healthWindowDates —
  // that helper returns every CALENDAR day in the window (what the bar charts
  // want, so an unlogged day still draws an empty column), but this chart's
  // datasets are sparse points on a linear day-offset axis with spanGaps:
  // false (see the comment below): only real body-mass reading days and real WEEKLY
  // projected points belong in allLabels. Filling the gaps between them with
  // dateless "empty" days would put null right next to the sparse projected
  // points and spanGaps would refuse to bridge them, breaking the dashed line
  // into invisible fragments.
  //
  // histLabels/lastDate stay the TRUE full history regardless of the window —
  // the trend, adaptation and calorie-implied trajectory all need that full
  // run to compute correctly at the window's own left edge, the same reason
  // renderHealthBodyMassChart's mirrored overlay does.
  const { from: windowFromDate, to: windowToDate } = healthDateRange();
  const windowHistLabels = histLabels.filter((d) => d >= windowFromDate && d <= windowToDate);
  const windowProjLabels = projLabels.filter((d) => d >= windowFromDate && d <= windowToDate);
  const allLabels = [...new Set([...windowHistLabels, ...windowProjLabels])].sort();
  if (!allLabels.length) return;

  const projMap = new Map(projPoints.map((p) => [p.date, p.bodyMass]));
  const lastDate = histLabels[histLabels.length - 1];

  // Same-day body-mass readings are averaged before smoothing, rather than letting whichever
  // came last silently win.
  const bodyMassSumsByDate = new Map();
  bodyMassEntries.forEach((e) => {
    const cur = bodyMassSumsByDate.get(e.date) || { sum: 0, count: 0 };
    cur.sum += e.amount;
    cur.count += 1;
    bodyMassSumsByDate.set(e.date, cur);
  });
  const bodyMassByDate = new Map([...bodyMassSumsByDate].map(([d, { sum, count }]) => [d, sum / count]));

  // Read here, ahead of the trend, so the zone band below can be positioned against it.
  const heightCm = getSetting('HEIGHT_CM', null);
  const sex = getSettingString('SEX', null);
  const swingKg = glycogenSwingKg(lastBodyMass, heightCm, sex);
  const trendMap = computeBodyMassTrend(bodyMassByDate);

  // The body-mass trajectory implied by logged calories alone: start at the first
  // body-mass reading, then walk forward a day at a time adding that day's calorie balance
  // (intake minus BMR, activity and TEF) converted to kg via GENERIC_KCAL_PER_KG_FAT —
  // the same balance Calorie Balance itself scores. A day with nothing logged carries
  // the running total forward flat rather than guessing. Needs a profile for BMR, same
  // as that chart. Set against the smoothed trend line, the gap between the two is what
  // the calorie math alone can't explain — water, glycogen, or a logging gap.
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');
  const calorieTrendMap = new Map();
  if (haveProfile) {
    const calorieTrendDates = datesInRange(bodyMassEntries[0].date, lastDate);
    const calorieBodyMassForDate = carryForwardBodyMassByDate(bodyMassByDate, calorieTrendDates);

    const intakeByDate = new Map();
    const tefByDate = new Map();
    const activityKcalByDate = new Map();
    const sleepHoursByDate = new Map();
    entries.forEach((e) => {
      if (e.amount === null) return;
      if (e.category === 'Calories' || e.category === 'Calories; Protein') {
        intakeByDate.set(e.date, (intakeByDate.get(e.date) || 0) + e.amount);
        // This day's own measured TEF (Physique column L) where calculated —
        // same measured-over-estimated precedence Calorie Balance gives it.
        if (e.tefKcal !== null && e.tefKcal !== undefined) {
          tefByDate.set(e.date, (tefByDate.get(e.date) || 0) + e.tefKcal);
        }
      } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
        const kcal = activityEntryKcal(e, calorieBodyMassForDate.get(e.date) ?? null);
        activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
      } else if (e.category === 'Sleep') {
        sleepHoursByDate.set(e.date, (sleepHoursByDate.get(e.date) || 0) + e.amount);
      }
    });
    const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);

    let running = startBodyMass;
    calorieTrendDates.forEach((d) => {
      calorieTrendMap.set(d, running);
      if (!intakeByDate.has(d)) return;
      const intake = intakeByDate.get(d);
      const maintenance = storedBmrForDate(d);
      if (maintenance === null) return;
      const activity = activityKcalByDate.get(d) || 0;
      const tef = tefByDate.has(d) ? tefByDate.get(d) : intake * (1 - tefDivisor());
      // Same sleep-adjusted balance Calorie Balance itself scores (dailyEnergyBalanceKcal)
      // — this walk can't disagree with that chart's own reading of a day's shortfall.
      const { balance } = dailyEnergyBalanceKcal(intake, maintenance, activity, tef, sleepHoursByDate.get(d), sleepDesired);
      running += balance / GENERIC_KCAL_PER_KG_FAT;
    });
  }

  // Anchored to the calorie-implied trajectory above, not an EMA of the smoothed trend
  // itself. That trajectory assumes intake vs. burn is the ONLY thing moving the scale,
  // so it's the driest the smoothed trend could read — the trend's own wobble above it
  // is the glycogen/water noise. The zone's top edge has to BE that line, not straddle
  // it, so the band sits entirely below rather than centered on it.
  const zoneAnchorMap = (swingKg === null || !haveProfile) ? null : calorieTrendMap;

  const plateauDays = detectPlateau(trendMap);
  if (plateauDays) {
    const plateauLine = `⚠️ Body mass trend has been flat for ~${plateauDays} days — consider adjusting your calorie limit`;
    plateauNote.textContent = privacyMode ? maskDigits(plateauLine) : plateauLine;
    plateauNote.classList.add('warning');
  }

  // Daily history then weekly projected points must NOT sit on equal category ticks,
  // which would imply every gap is the same length. A true linear day-offset axis makes
  // a week gap 7x the width of a one-day gap.
  const firstDateMs = parseIsoDateUTC(allLabels[0]);
  const dayOffset = (dateStr) => Math.round((parseIsoDateUTC(dateStr) - firstDateMs) / 86400000);
  const offsetToDateLabel = (offset) => new Date(firstDateMs + offset * 86400000).toISOString().slice(0, 10);

  // No raw per-reading series: Body Mass already plots every reading, this is the trend.
  const datasets = [
    // The zone anchor (the calorie-implied trajectory) down to anchor − the glycogen/water
    // swing — a band the trend line can wander inside without it being a real change. The
    // upper edge is the anchor itself, unshifted, so it draws exactly on top of the gray
    // Calorie-Implied Trajectory line — tension 0 to match that line's own straight
    // segments, not the smoothed trend's curve. Two line datasets rather than one:
    // Chart.js fills the area BETWEEN a dataset and the one its `fill` points at, so the
    // zone needs both edges plotted, just invisibly (borderWidth 0). Omitted whenever the
    // swing or the calorie trajectory can't be computed (no profile on file) rather than
    // drawn at 0, which would claim glycogen accounts for nothing.
    ...(zoneAnchorMap !== null ? [
      {
        label: 'Glycogen + Water Swing (upper)',
        data: allLabels.map((d) => {
          const a = zoneAnchorMap.get(d);
          return { x: dayOffset(d), y: a === undefined ? null : a };
        }),
        borderWidth: 0,
        pointRadius: 0,
        tension: 0,
        fill: false,
        spanGaps: false,
        isSwingBand: true,
        order: 5,
      },
      {
        label: 'Glycogen + Water Swing',
        data: allLabels.map((d) => {
          const a = zoneAnchorMap.get(d);
          return { x: dayOffset(d), y: a === undefined ? null : a - swingKg };
        }),
        // The zone reads as "normal noise", not a goal or a warning, so it takes the
        // app's neutral highlight rather than either of those colours.
        backgroundColor: chartColor('--chart-warn', 0.15),
        borderWidth: 0,
        pointRadius: 0,
        tension: 0,
        // Fills to the upper-bound dataset just above this one in the array.
        fill: '-1',
        spanGaps: false,
        isSwingBand: true,
        order: 5,
      },
      // Where the actual trend has dropped BELOW the swing zone's own floor — glycogen
      // and water alone don't explain a drop that size, so unlike the zone above this
      // reads as a real loss, not noise. Sits at the zone floor (a zero-height fill
      // against the dataset above) whenever the trend is inside or above the zone, and
      // drops to the trend's own value — opening up a red fill down to it — for exactly
      // the stretch it's actually below. tension 0 to match the zone's own straight
      // edges rather than the trend line's smoothed curve.
      {
        label: 'Muscle Loss (below swing zone)',
        data: allLabels.map((d) => {
          const a = zoneAnchorMap.get(d);
          const trend = trendMap.get(d);
          if (a === undefined || trend === null || trend === undefined) return { x: dayOffset(d), y: null };
          return { x: dayOffset(d), y: Math.min(trend, a - swingKg) };
        }),
        // A real warning, so it reads noticeably stronger than the yellow zone's own
        // 0.15 neutral tint rather than matching it.
        backgroundColor: chartColor('--chart-bad', 0.45),
        borderWidth: 0,
        pointRadius: 0,
        tension: 0,
        // Fills to the zone-floor dataset just above this one in the array.
        fill: '-1',
        spanGaps: false,
        isSwingBand: true,
        order: 5,
      },
    ] : []),
    {
      label: 'State Trend & Forecast',
      data: allLabels.map((d) => ({ x: dayOffset(d), y: trendMap.get(d) ?? null })),
      borderColor: chartColor('--chart-good'),
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      spanGaps: false,
      order: 4,
    },
    // Omitted without a profile — same guard as calorieTrendMap's own computation above.
    ...(haveProfile ? [{
      label: 'Calorie-Implied Trajectory',
      data: allLabels.map((d) => {
        const y = calorieTrendMap.get(d);
        return { x: dayOffset(d), y: y === undefined ? null : y };
      }),
      borderColor: chartColor('--chart-neutral'),
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 3,
    }] : []),
    // Omitted rather than plotted empty, so it can't sit in the legend claiming a
    // forecast exists.
    ...(hasProjection ? [{
      label: 'Projected',
      data: allLabels.map((d) => {
        let y = null;
        if (d === lastDate) y = lastBodyMass;
        else if (d > lastDate) y = projMap.get(d) ?? null;
        return { x: dayOffset(d), y };
      }),
      borderColor: chartColor('--chart-indigo'),
      // The app's one dash pattern, at the width of the trend line it continues. At
      // Chart.js's default width 3 the forecast was the heaviest line on the chart
      // despite being the least certain thing on it.
      borderDash: [4, 4],
      borderWidth: 2,
      // Line only — a shaded area read as a quantity, when all this asserts is where
      // the trend goes.
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 2,
    }] : []),
    {
      // bodyMassHealthy, not proj.bodyMassHealthy — that's only set on an 'ok' projection, but
      // the desired-mass line is drawn either way.
      label: `${bodyMassHealthy} kg Desired`,
      data: allLabels.map((d) => ({ x: dayOffset(d), y: bodyMassHealthy })),
      // Solid, like the section's hairline caps. It stays a continuous LINE rather than
      // caps because this chart has no columns: its x-axis is a linear time scale, so
      // there's nothing per-column for a mark to belong to.
      borderColor: desiredMarkColor(),
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 1,
    },
  ];

  // Skipped without a height: BMI can't be computed, and an empty scale is worse than
  // none. There's no BMI LINE either — BMI is a fixed linear rescale of body mass, so it
  // would retrace the body-mass line pixel for pixel, and the y1 axis alone lets it be
  // read off that line. (heightCm itself was read earlier, ahead of the trend.)

  // Left to auto-range, Chart.js can pick a BMI span that doesn't correspond to the
  // body-mass span, so a point on the chart would read as the wrong BMI off the right axis.
  // Deriving y1's bounds from the same body-mass range keeps the two true parallel twins.
  //
  // Rounded to whole kg, not just padded: a fractional min/max breaks Chart.js's own
  // round-number tick algorithm, which is what produced the clean 1 kg gridlines.
  //
  // Raw body-mass readings are excluded since they're no longer plotted. lastBodyMass stays — the
  // projection starts from it. The swing band's own edges are included so the padded
  // axis can't clip the zone it's meant to fully show.
  const trendExtremes = zoneAnchorMap === null ? [] : [...zoneAnchorMap.values()].flatMap((v) => [v + swingKg, v - swingKg]);
  const bodyMassValues = [...trendMap.values(), ...projMap.values(), ...trendExtremes, ...calorieTrendMap.values(), lastBodyMass, bodyMassHealthy]
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const bodyMassMin = Math.min(...bodyMassValues);
  const bodyMassMax = Math.max(...bodyMassValues);
  const bodyMassPad = Math.max(0.5, (bodyMassMax - bodyMassMin) * 0.08);

  // The healthy end gets no padding: nothing is ever plotted past it, so padding reserved
  // an empty band — a 70 kg healthy mass floored to 68. Still floor/ceil'd to whole kg, since
  // the ticks step by 1 from these bounds. Only when the healthy mass really is the extreme; a
  // reading that overshoots it pads normally, because then something IS drawn beyond.
  const yMin = bodyMassMin < bodyMassHealthy
    ? Math.floor(bodyMassMin - bodyMassPad)
    : Math.floor(bodyMassHealthy);
  const yMax = bodyMassMax > bodyMassHealthy
    ? Math.ceil(bodyMassMax + bodyMassPad)
    : Math.ceil(bodyMassHealthy);

  // The EXACT date list Body Mass and Caloric Intake already share (see
  // healthCalorieChartDates) — clipped forward to the earliest CALORIE entry, not
  // this chart's own earliest body-mass reading, which can predate it and did: clipping to
  // bodyMassEntries[0] here left this axis starting well before every bar chart's own
  // leftmost bar, with empty space where they had none. Reused directly for both the
  // axis edges and the tick list below, so this axis can't quote a different window
  // than the one they're actually drawn on.
  const axisDates = healthCalorieChartDates(entries);
  const axisFromDate = axisDates.length ? axisDates[0] : windowFromDate;

  const scales = {
    x: {
      type: 'linear',
      // Pinned to the window's own (clipped) edges, not left for Chart.js to auto-fit
      // from whatever's actually plotted: allLabels is sparse (only body-mass readings and
      // weekly projected points), so an auto-fit axis stretched to fit just those
      // points ran a narrower — or wider — span than every category-axis chart above
      // it, which always covers the full clipped window (every calendar day, even
      // empty ones). That's what let the same calendar date land at a different
      // fraction across this chart's width than everywhere else — "today" mid-plot
      // here, far right there.
      //
      // Flush with the window's first and last date, like the category axes (offset: false
      // in wellnessCategoryXScale), so the edge gridlines sit on the plot's edges at every range.
      min: dayOffset(axisFromDate),
      max: dayOffset(axisDates.length ? axisDates[axisDates.length - 1] : windowToDate),
      // min = max, so the labels hold a fixed 45° like the rest of the section instead
      // of Chart.js straightening them whenever they happen to fit — which made this
      // axis flip angle on resize.
      //
      // Ticks forced onto the SAME calendar dates the section's category-axis charts
      // pick (wellnessTickIndices, charts-base.js — 8 evenly spaced, ends included) —
      // Chart.js's own autoSkip runs a
      // pixel-width heuristic that differs between a category axis and this linear
      // day-offset one, so left to itself this axis could (and did) label different
      // calendar dates than every bar chart above it for the exact same window.
      afterBuildTicks: (axis) => {
        axis.ticks = wellnessTickIndices(axisDates).map((i) => ({ value: dayOffset(axisDates[i]) }));
      },
      // autoSkip false for the same reason wellnessCategoryXScale disables it
      // (charts-base.js): left on, it runs AFTER afterBuildTicks and could thin the 7
      // ticks just chosen above independently of whatever the category axes' own
      // autoSkip passes decide, undoing the point of picking them identically.
      ticks: { maxRotation: 45, minRotation: 45, autoSkip: false, callback: offsetToDateLabel },
    },
    y: {
      min: yMin,
      max: yMax,
      afterFit: fixDatedYAxisWidth,
      // Pinned: once min/max are explicit (needed to lock the BMI axis to this range),
      // Chart.js's auto step-size stopped producing the clean 1 kg steps.
      ticks: { stepSize: 1, callback: maskedUnitTick('kg') },
    },
  };
  if (heightCm !== null) {
    scales.y1 = {
      // Exact, not rounded — that's what keeps this a true pixel-for-pixel twin.
      min: computeBmi(yMin, heightCm),
      max: computeBmi(yMax, heightCm),
      position: 'right',
      afterFit: fixDatedYAxisWidth,
      grid: { drawOnChartArea: false },
      ticks: {
        stepSize: 1,
        // Otherwise Chart.js forces the exact min/max on as extra labels off the step
        // grid — 25.3/33.2 alongside an evenly-stepped 27, 28, 29.
        includeBounds: false,
        callback: maskedUnitTick('BMI', 1),
      },
    };
  }

  // Chart canvas is currently hidden in HTML — skip rendering, but keep everything
  // above so the progress meters and ETA text still populate normally.
  if (ctx) {
    healthProjectionChart = upsertChart(healthProjectionChart, ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          // Off, like the rest of the section: Chart.js draws it inside the canvas, so a
          // legend here left this plot area ~30px shorter. Series are named in the tooltip.
          legend: { display: false },
          tooltip: { external: null },
        },
        scales,
      },
    });
  }

}

