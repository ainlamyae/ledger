// BMR calibration: how wrong the equation's BMR is, measured from logged data over n_p
// periods of L_p days. Shown in Tune and stored per day in Physique's Derived column.
//
// Two independent daily deficits are compared per period:
//   D  = TEI − BMR − AEE − TEF (+SD)   what the equation implies happened
//   ΔM = Δm̄ × 7700 / L_p               what the mass change says happened
// Their gap is the equation's error (the offset), averaged over periods weighted 0.1
// (oldest) to 1.0 (newest). The app adds that offset to the equation at any mass, so
// it keeps the equation's slope and shifts its level.

const BMR_CALIBRATION_WINDOW_DAYS = 7;
const BMR_CALIBRATION_PERIOD_DAYS_DEFAULT = 7;
const BMR_CALIBRATION_PERIOD_COUNT_DEFAULT = 4;

// `days` from an ISO date, in UTC so the timezone can't shift it.
function isoDatePlusDays(dateIso, days) {
  const d = new Date(parseIsoDateUTC(dateIso) + days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Linear recency weight: 0.1 for the oldest period up to 1.0 for the newest; 1 if alone.
const BMR_CALIBRATION_OLDEST_WEEK_WEIGHT = 0.1;
function weekRecencyWeight(weekIndex, totalWeeks) {
  if (totalWeeks <= 1) return 1;
  return BMR_CALIBRATION_OLDEST_WEEK_WEIGHT
    + (1 - BMR_CALIBRATION_OLDEST_WEEK_WEIGHT) * (weekIndex / (totalWeeks - 1));
}

// Weighted mean over items with a non-null value; null when none has one.
function weightedMean(items, weightFn, valueFn) {
  const valid = items.filter((it) => valueFn(it) !== null);
  const totalWeight = valid.reduce((sum, it) => sum + weightFn(it), 0);
  if (!totalWeight) return null;
  return valid.reduce((sum, it) => sum + weightFn(it) * valueFn(it), 0) / totalWeight;
}

// Mean of `valueFn` over items, or null when empty.
function meanOf(items, valueFn) {
  return items.length ? items.reduce((sum, it) => sum + valueFn(it), 0) / items.length : null;
}

// The calculation, data in and result out, no DOM. A failure (`ok: false`) still returns
// the days and periods built so far, so their tables can show.
//
// The window runs from `startDateIso` (default BMR_CALIBRATION_WINDOW_DAYS back) to the
// latest eligible day, rounded up to whole `chunkDays` periods. With `numChunks`, it is
// exactly that many periods ending on endDateIso.
function computeBmrCalibration(startDateIso = null, chunkDays = BMR_CALIBRATION_PERIOD_DAYS_DEFAULT, endDateIso = null, numChunks = null) {
  const eligible = (p) => p.caloriesIn !== null && p.caloriesOut !== null;

  // Anchored on the latest eligible day, so a gap in logging can't empty the window.
  // endDateIso caps it.
  const latestEligible = allPhysiqueEntries
    .filter((p) => p.date && eligible(p) && (!endDateIso || p.date <= endDateIso))
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
  if (!latestEligible) {
    return { ok: false, reason: 'No day has both Calories In and Calories Out logged yet.', days: [], weeks: [], eligibleCount: 0 };
  }

  const windowEnd = numChunks ? endDateIso : latestEligible.date;
  const requestedSpanDays = startDateIso
    ? Math.round((parseIsoDateUTC(windowEnd) - parseIsoDateUTC(startDateIso)) / 86400000) + 1
    : BMR_CALIBRATION_WINDOW_DAYS;
  const numWeeks = numChunks || Math.max(1, Math.ceil(requestedSpanDays / chunkDays));
  const windowDays = numWeeks * chunkDays;
  const windowStart = isoDatePlusDays(windowEnd, -(windowDays - 1));
  const byDate = new Map(allPhysiqueEntries.filter((p) => p.date).map((p) => [p.date, p]));

  const healthEntries = physiqueAsHealthEntries();
  // Smoothed over this window's own period length, so each period's m̄ spans one period.
  const massAsOf = (dateIso) => smoothedBodyMassKg(healthEntries.filter((e) => e.date <= dateIso), chunkDays);

  // The profile is read up front so each day's TEF/SD can show even when the
  // profile check below fails.
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const formula = bmrFormula();
  const haveProfile = heightCm !== null && (sex === 'male' || sex === 'female')
    && (age !== null || !bmrNeedsAge(formula));
  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
  const tefPct = tefPercent();
  const divisor = tefDivisor(tefPct);

  const days = [];
  for (let i = 0; i < windowDays; i++) {
    const date = isoDatePlusDays(windowStart, i);
    const p = byDate.get(date) || null;
    const m = massAsOf(date);
    // TEF falls back to the f share when unmeasured. D needs the day's stored BMR, so it's
    // null without a profile; SD also needs a sleep log.
    let tef = null;
    let sd = null;
    let deficit = null;
    if (p && p.caloriesIn !== null) {
      tef = p.tef !== null ? p.tef : Math.round(p.caloriesIn * (1 - divisor));
      const maintenanceForDay = haveProfile ? pickBmrForBasis(bmrFiguresForDate(date), 'bmr') : null;
      if (maintenanceForDay !== null) {
        const activity = p.caloriesOut ?? 0;
        const sleepHours = p.sleep ?? physiqueSleepHours(p);
        const balance = dailyEnergyBalanceKcal(p.caloriesIn, maintenanceForDay, activity, tef, sleepHours, sleepDesired);
        deficit = Math.round(balance.balance);
        if (sleepHours !== null) sd = Math.round(balance.deprivationKcal);
      }
    }
    days.push({
      date,
      m,
      caloriesIn: p ? p.caloriesIn : null,
      caloriesOut: p ? p.caloriesOut : null,
      deficit,
      tef,
      sd,
      eligible: !!(p && eligible(p)),
    });
  }
  const eligibleCount = days.filter((d) => d.eligible).length;

  // One entry per period, oldest first. Offset = D − ΔM (both negative for a deficit).
  const weeks = [];
  for (let w = 0; w < numWeeks; w++) {
    const weekStart = isoDatePlusDays(windowStart, w * chunkDays);
    const weekEnd = isoDatePlusDays(weekStart, chunkDays - 1);
    const weekDays = days.filter((d) => d.date >= weekStart && d.date <= weekEnd);
    const weekEligible = weekDays.filter((d) => d.eligible);
    const massEndW = massAsOf(weekEnd);
    const massStartW = massAsOf(isoDatePlusDays(weekStart, -1));
    const avgIntakeW = meanOf(weekEligible, (d) => d.caloriesIn);
    const avgActivityW = meanOf(weekEligible, (d) => d.caloriesOut);
    const deficitW = meanOf(weekDays.filter((d) => d.deficit !== null), (d) => d.deficit);

    const deltaMassW = (massStartW !== null && massEndW !== null) ? massEndW - massStartW : null;
    const deltaMKcalW = deltaMassW === null ? null : (deltaMassW * GENERIC_KCAL_PER_KG_FAT) / chunkDays;

    const offsetW = (deficitW !== null && deltaMKcalW !== null) ? deficitW - deltaMKcalW : null;

    weeks.push({
      index: w,
      weekStart,
      weekEnd,
      weight: weekRecencyWeight(w, numWeeks),
      eligibleCount: weekEligible.length,
      avgIntake: avgIntakeW,
      avgActivity: avgActivityW,
      massStart: massStartW,
      massEnd: massEndW,
      deltaMass: deltaMassW,
      deltaMKcal: deltaMKcalW,
      deficit: deficitW,
      offset: offsetW,
    });
  }

  const weighted = (valueFn) => weightedMean(weeks, (w) => w.weight, valueFn);
  const fail = (reason) => ({ ok: false, reason, days, weeks, eligibleCount, chunkDays });
  const avgIntake = weighted((w) => w.avgIntake);
  const avgActivity = weighted((w) => w.avgActivity);
  const deficitActual = weighted((w) => w.deficit);
  const deltaMActual = weighted((w) => w.deltaMKcal);
  if (avgIntake === null || avgActivity === null) {
    return fail('No period in this window has both Calories In and Calories Out logged.');
  }
  if (deltaMActual === null) {
    return fail('Not enough body-mass readings logged around this window to measure any period\'s mass change.');
  }

  if (!haveProfile) {
    const missing = [
      heightCm === null ? 'Height' : null,
      (sex !== 'male' && sex !== 'female') ? 'Sex' : null,
      (bmrNeedsAge(formula) && age === null) ? 'Birth Date' : null,
    ].filter(Boolean).join(', ');
    return fail(`Needs ${missing} filled in under Settings first — the offset is measured against the equation's own figure.`);
  }

  const offsetKcal = weighted((w) => w.offset);
  if (offsetKcal === null) {
    return fail('No single period has both a D figure and a measurable ΔM to compare.');
  }

  const bodyMassNowKg = planBodyMassKg(healthEntries);
  const equationBmrNow = bmrKcal(bodyMassNowKg, heightCm, age, sex, formula);
  const bmrCal = equationBmrNow + offsetKcal;

  return {
    ok: true,
    windowDays, numWeeks, chunkDays, windowStart, windowEnd, days, weeks, eligibleCount,
    avgIntake, avgActivity, deficitActual, deltaMActual,
    tefPct, divisor, bmrCal: Math.round(bmrCal),
    equationBmrNow: Math.round(equationBmrNow), offsetKcal: Math.round(offsetKcal),
  };
}

// Tune's Periods table, under Calculations.
function renderBmrCalibrationWeeks(weeks, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';
  weeks.forEach((w) => {
    const tr = document.createElement('tr');
    const shown = (value, format) => (value === null ? '—' : format(value));
    const kcal = (v) => Math.round(v).toString();
    const cells = [
      `${w.weekStart} → ${w.weekEnd}`,
      shown(w.massEnd, (v) => v.toFixed(1)),
      shown(w.deltaMass, (v) => v.toFixed(1)),
      shown(w.deltaMKcal, kcal),
      shown(w.deficit, kcal),
      shown(w.offset, (v) => withExplicitSign(Math.round(v))),
      w.weight.toFixed(2),
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = privacyMode ? maskDigits(text) : text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderBmrCalibrationSubstituted(result, elId) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  if (!result.ok) return;

  const offsetSign = result.offsetKcal >= 0 ? '+' : '−';
  appendLabelledRows(el, [
    ['D', `${Math.round(result.deficitActual)} kcal/day — equation-implied`],
    ['ΔM', `${Math.round(result.deltaMActual)} kcal/day — measured, from mass change`],
    ['Offset', `D − ΔM = ${withExplicitSign(result.offsetKcal)} kcal/day`],
    ['BMR_cal', `${result.equationBmrNow} ${offsetSign} ${Math.abs(result.offsetKcal)} = ${result.bmrCal} kcal/day`],
  ]);
}

// A box's whole number, or `fallback` when it isn't one ≥ 1.
function periodInputValue(inputId, fallback) {
  const raw = Number(document.getElementById(inputId).value);
  return (Number.isFinite(raw) && raw >= 1) ? Math.round(raw) : fallback;
}

// Ends yesterday, since today is usually still being logged.
function bmrCalibrationForWindow(periodCount, periodDays) {
  return computeBmrCalibration(null, periodDays, isoDateFromDays(-1), periodCount);
}

// Tune's Update: saves n_p / L_p and recomputes every Physique day's BMR_cal and
// m_avg (with its BMI and m_d) in one request.
async function updateStoredBmrCalibration() {
  const periodCount = periodInputValue('formula-cal-period-count', BMR_CALIBRATION_PERIOD_COUNT_DEFAULT);
  const periodDays = periodInputValue('formula-cal-period-days', BMR_CALIBRATION_PERIOD_DAYS_DEFAULT);
  if (!confirm(`Recompute BMR_cal over ${periodCount} × ${periodDays} days, and m_avg over ${periodDays} days, for every day in the Physique sheet?`)) return;

  const unchanged = getSetting(BMR_CALIBRATION_PERIOD_COUNT_KEY, null) === periodCount
    && getSetting(BMR_CALIBRATION_PERIOD_DAYS_KEY, null) === periodDays;
  try {
    // A changed window is saved, and saving it recomputes; an unchanged one is forced.
    const days = unchanged
      ? await recomputeStoredPhysiqueBmr([], { force: true })
      : await saveSettingValues({
        [BMR_CALIBRATION_PERIOD_COUNT_KEY]: periodCount,
        [BMR_CALIBRATION_PERIOD_DAYS_KEY]: periodDays,
      });
    if (days === null) throw new Error('Writing the Derived column failed — see the console.');
    showToast(`Updated — BMR_cal over ${periodCount} × ${periodDays} days and m_avg over ${periodDays} days recomputed for ${days} days in the Physique sheet.`);
  } catch (err) {
    showFieldError('formula-status', err.message);
  }
}

function initBmrCalibration() {
  onAsyncClick('formula-update-btn', updateStoredBmrCalibration);
}
