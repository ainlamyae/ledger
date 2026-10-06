// BMR calibration: measures how wrong the equation's BMR actually is, from logged data over
// a trailing window (n_p periods of L_p days ending yesterday), rather than trying to
// predict BMR from height/age/sex (or lean mass) alone. Shown in Tune (BMR_cal row, its
// Periods under Calculations, Update) and stored per day in Physique's BMR column.
// Local only, no AI — every number in the trace is one this app already tracks.
//
// The core idea is two INDEPENDENT estimates of the same day's energy deficit, compared:
//   D  = TEI − equationBMR − AEE − TEF (+SD)   — what the CURRENT equation BMR implies happened
//   ΔM = (massStart − massEnd) × 7700 / 7       — what ACTUALLY happened, from real mass change,
//                                                  the equation never enters into it
// If the equation's BMR were exactly right, D and ΔM would already agree. The gap (D − ΔM) IS
// the equation's error — that's the Offset. Priced one WEEK at a time (D and ΔM each averaged/
// measured over that week's own days and its own mass reading, never blended across raw days
// first), then combined with a linear recency weight — 0.1 for the oldest week, 1.0 for the
// newest (weekRecencyWeight) — so a long window can draw on months of data without letting
// six-week-old numbers outvote last week's.
//
// Applied as an OFFSET from what the equation says (latestStoredCalibration, wellness-math.js:
// the latest Physique day's stored BMR_cal minus its equation BMR), not a raw replacement BMR — applyBmrBasis/maintenanceAffineCoefficients
// add that offset to whatever the equation says at any body mass, so the app keeps the
// equation's own slope (how BMR moves as you gain/lose) and just shifts the whole line to
// match what was actually measured, per the "keep slope, shift level" design.

const BMR_CALIBRATION_WINDOW_DAYS = 7;
const BMR_CALIBRATION_PERIOD_DAYS_DEFAULT = 10;
const BMR_CALIBRATION_PERIOD_COUNT_DEFAULT = 3;

// One ISO date, `days` away from `dateIso` — UTC arithmetic throughout (parseIsoDateUTC),
// never a local Date object, so this can't drift a day off depending on the machine's
// timezone the way mixing UTC and local math would.
function isoDatePlusDays(dateIso, days) {
  const d = new Date(parseIsoDateUTC(dateIso) + days * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// Linear recency weight across the calibration's weeks — 0.1 for the OLDEST week, 1.0 for
// the NEWEST, so five months of history can be included without an ingredient logged
// differently (or a body genuinely different) six weeks ago outvoting last week's numbers.
// A single week is always weight 1 — there's nothing to rank it against.
const BMR_CALIBRATION_OLDEST_WEEK_WEIGHT = 0.1;
function weekRecencyWeight(weekIndex, totalWeeks) {
  if (totalWeeks <= 1) return 1;
  return BMR_CALIBRATION_OLDEST_WEEK_WEIGHT
    + (1 - BMR_CALIBRATION_OLDEST_WEEK_WEIGHT) * (weekIndex / (totalWeeks - 1));
}

// Weighted mean of `valueFn(item)` over whichever items have a non-null value, weighted by
// `weightFn(item)` — null (not 0) when nothing qualifies, so a week that never got logged
// simply drops out of the average rather than pulling it toward zero.
function weightedMean(items, weightFn, valueFn) {
  const valid = items.filter((it) => valueFn(it) !== null);
  const totalWeight = valid.reduce((sum, it) => sum + weightFn(it), 0);
  if (!totalWeight) return null;
  return valid.reduce((sum, it) => sum + weightFn(it) * valueFn(it), 0) / totalWeight;
}

// The whole calculation, pure data in and a result object out — no DOM. `ok: false` always
// carries whatever partial `days`/`weeks` it managed to build, so the caller can show the
// day-by-day and period-by-period tables even when there isn't enough to finish the arithmetic
// (the same "don't hide the process" the rest of this form follows).
//
// The window runs from `startDateIso` (null defaults to BMR_CALIBRATION_WINDOW_DAYS days back)
// through the latest ELIGIBLE day, rounded UP to whole `chunkDays`-long periods — a picked
// start of "10 days back" with a 7-day chunk becomes 2 full periods, never a partial
// one, since every period needs a complete span to average and mass-smooth on its own. Priced
// one PERIOD at a time (each its own average intake/activity, its own D, its own mass-based
// ΔM), then combined with a recency weight per period (weekRecencyWeight) rather than one flat
// average over the whole span — the size of the chunk only changes how many days each period
// covers, never the "weigh each period, not each day" shape of the calculation.
//
// With `numChunks`, the window is exactly that many periods ending ON endDateIso instead.
function computeBmrCalibration(startDateIso = null, chunkDays = BMR_CALIBRATION_PERIOD_DAYS_DEFAULT, endDateIso = null, numChunks = null) {
  const eligible = (p) => p.caloriesIn !== null && p.caloriesOut !== null;

  // Anchored on the latest ELIGIBLE day, not today — the same "end the window at the latest
  // real reading" choice smoothedBodyMassKg makes, so a day or two away from logging doesn't
  // empty the window entirely. endDateIso (Health Insight's To) caps it.
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

  const wellnessEntries = physiqueAsWellnessEntries();
  // Smoothed over this window's own period length, so each period's m̄ spans one period.
  const massAsOf = (dateIso) => smoothedBodyMassKg(wellnessEntries.filter((e) => e.date <= dateIso), chunkDays);

  // Read early (not just at the validation check below) so TEF/SD — informational columns in
  // the day table, not part of the arithmetic below — can still be shown per day even in a
  // window that ultimately fails the profile check.
  const heightCmEarly = getSetting('HEIGHT_CM', null);
  const ageEarly = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sexEarly = getSettingString('SEX', null);
  const formulaEarly = bmrFormula();
  const haveProfile = heightCmEarly !== null && (sexEarly === 'male' || sexEarly === 'female')
    && (ageEarly !== null || !bmrNeedsAge(formulaEarly));
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);
  const tefPct = tefPercent();
  const divisor = tefDivisor(tefPct);

  const days = [];
  for (let i = 0; i < windowDays; i++) {
    const date = isoDatePlusDays(windowStart, i);
    const p = byDate.get(date) || null;
    const m = massAsOf(date);
    // TEI/AEE are just this day's own logged figures — the standard symbols the Status card
    // and Formula Playground use for the same two numbers, not a fresh calculation. TEF falls
    // back to the flat f-share estimate when the day has no measured figure of its own, same
    // as the Status card's own TEF row does. D (and SD, the sleep-driven piece of it) need a
    // maintenance figure to react against (dailyEnergyBalanceKcal), so both are null wherever
    // the profile or that day's own body mass is missing — never a confident zero for
    // "nothing to show yet". D itself doesn't ALSO need a sleep log — dailyEnergyBalanceKcal
    // already treats a missing one as "no adjustment" — only SD does, since there's nothing
    // sleep-driven to report without one.
    let tef = null;
    let sd = null;
    let deficit = null;
    if (p && p.caloriesIn !== null) {
      tef = p.tef !== null ? p.tef : Math.round(p.caloriesIn * (1 - divisor));
      // The day's stored plain BMR (Physique's BMR column), not recomputed here.
      const maintenanceForDay = haveProfile ? pickBmrForBasis(bmrFiguresForDate(date), 'bmr') : null;
      if (maintenanceForDay !== null) {
        const activity = p.caloriesOut ?? 0;
        const sleepHours = p.sleep ?? physiqueSleepHours(p);
        const balance = dailyEnergyBalanceKcal(p.caloriesIn, maintenanceForDay, activity, tef, sleepHours, sleepTarget);
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

  // One entry per week, oldest first (index 0). Offset is the direct gap between two
  // independent deficit estimates: D (the Daily table's own, averaged — what the CURRENT
  // equation BMR implies happened) minus ΔM (the mass-based figure — what actually happened,
  // independent of the equation). If the equation's BMR were exactly right the two would
  // already agree and Offset would be 0; the size of the gap IS the correction.
  const weeks = [];
  for (let w = 0; w < numWeeks; w++) {
    const weekStart = isoDatePlusDays(windowStart, w * chunkDays);
    const weekEnd = isoDatePlusDays(weekStart, chunkDays - 1);
    const weekDays = days.filter((d) => d.date >= weekStart && d.date <= weekEnd);
    const weekEligible = weekDays.filter((d) => d.eligible);
    const massEndW = massAsOf(weekEnd);
    const massStartW = massAsOf(isoDatePlusDays(weekStart, -1));
    const avgIntakeW = weekEligible.length ? weekEligible.reduce((s, d) => s + d.caloriesIn, 0) / weekEligible.length : null;
    const avgActivityW = weekEligible.length ? weekEligible.reduce((s, d) => s + d.caloriesOut, 0) / weekEligible.length : null;

    // D: the Daily table's own D, averaged over the week — same negative-for-deficit sign
    // both tables already use.
    const weekDeficitDays = weekDays.filter((d) => d.deficit !== null);
    const deficitW = weekDeficitDays.length
      ? weekDeficitDays.reduce((s, d) => s + d.deficit, 0) / weekDeficitDays.length
      : null;

    // massEndW doubles as "this period's own mass" for the Daily table's m column too: it's
    // already the chunkDays-smoothed average (m̄ over one period length) ending exactly on
    // this period's last day.
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

  const avgIntake = weightedMean(weeks, (w) => w.weight, (w) => w.avgIntake);
  const avgActivity = weightedMean(weeks, (w) => w.weight, (w) => w.avgActivity);
  const deficitActual = weightedMean(weeks, (w) => w.weight, (w) => w.deficit);
  const deltaMActual = weightedMean(weeks, (w) => w.weight, (w) => w.deltaMKcal);
  if (avgIntake === null || avgActivity === null) {
    return { ok: false, reason: 'No period in this window has both Calories In and Calories Out logged.', days, weeks, eligibleCount, chunkDays };
  }
  if (deltaMActual === null) {
    return { ok: false, reason: 'Not enough body-mass readings logged around this window to measure any period\'s mass change.', days, weeks, eligibleCount, chunkDays };
  }

  const heightCm = heightCmEarly;
  const age = ageEarly;
  const sex = sexEarly;
  const formula = formulaEarly;
  if (!haveProfile) {
    const missing = [
      heightCm === null ? 'Height' : null,
      (sex !== 'male' && sex !== 'female') ? 'Sex' : null,
      (bmrNeedsAge(formula) && age === null) ? 'Birth Date' : null,
    ].filter(Boolean).join(', ');
    return { ok: false, reason: `Needs ${missing} filled in under Settings first — the offset is measured against the equation's own figure.`, days, weeks, eligibleCount, chunkDays };
  }

  const offsetKcal = weightedMean(weeks, (w) => w.weight, (w) => w.offset);
  if (offsetKcal === null) {
    return { ok: false, reason: 'No single period has both a D figure and a measurable ΔM to compare.', days, weeks, eligibleCount, chunkDays };
  }

  const bodyMassNowKg = planBodyMassKg(wellnessEntries);
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

// Tune's Periods table and lines, under Calculations.
function renderBmrCalibrationWeeks(weeks, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';
  weeks.forEach((w) => {
    const tr = document.createElement('tr');
    // w.deficit (D, averaged) and w.deltaMKcal (ΔM) are both already display-signed
    // (negative-for-deficit/loss) — Offset = w.offset = w.deficit − w.deltaMKcal, computed
    // once in computeBmrCalibration, not re-derived here.
    const cells = [
      `${w.weekStart} → ${w.weekEnd}`,
      w.massEnd === null ? '—' : w.massEnd.toFixed(1),
      w.deltaMass === null ? '—' : w.deltaMass.toFixed(1),
      w.deltaMKcal === null ? '—' : Math.round(w.deltaMKcal).toString(),
      w.deficit === null ? '—' : Math.round(w.deficit).toString(),
      w.offset === null ? '—' : withExplicitSign(Math.round(w.offset)),
      w.weight.toFixed(2),
    ];
    cells.forEach((text) => {
      const td = document.createElement('td');
      td.textContent = privacyMode ? maskDigits(text) : text;
      tr.appendChild(td);
    });
    if (!w.eligibleCount) tr.classList.add('row-empty');
    tbody.appendChild(tr);
  });
}

function renderBmrCalibrationSubstituted(result, elId) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  if (!result.ok) return;

  const offsetSign = result.offsetKcal >= 0 ? '+' : '−';
  const rows = [
    ['D', `${Math.round(result.deficitActual)} kcal/day — equation-implied`],
    ['ΔM', `${Math.round(result.deltaMActual)} kcal/day — measured, from mass change`],
    ['Offset', `D − ΔM = ${withExplicitSign(result.offsetKcal)} kcal/day`],
    ['BMR_cal', `${result.equationBmrNow} ${offsetSign} ${Math.abs(result.offsetKcal)} = ${result.bmrCal} kcal/day`],
  ];
  rows.forEach(([label, value]) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    p.append(strong, document.createTextNode(privacyMode ? maskDigits(value) : value));
    el.appendChild(p);
  });
}

// A typed box's whole number, or `fallback` when it's blank/zero/negative/non-numeric —
// never NaN or 0 into the date arithmetic.
function periodInputValue(inputId, fallback) {
  const raw = Number(document.getElementById(inputId).value);
  return (Number.isFinite(raw) && raw >= 1) ? Math.round(raw) : fallback;
}

// Ends yesterday: today is usually still being logged. Shared with Tune's BMR_cal.
function bmrCalibrationForWindow(periodCount, periodDays) {
  return computeBmrCalibration(null, periodDays, isoDateFromDays(-1), periodCount);
}

// Tune's Update: saves n_p / L_p and rewrites every day's stored BMR cell (its BMR_cal
// over the new window) and Mass cell (m_avg over the new L_p, with the BMI and m_d that
// follow it) in the Physique sheet, in one request.
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
    if (days === null) throw new Error('Writing the BMR column failed — see the console.');
    showFieldError('formula-status', `Updated — BMR_cal over ${periodCount} × ${periodDays} days and m_avg over ${periodDays} days recomputed for ${days} days in the Physique sheet.`);
  } catch (err) {
    showFieldError('formula-status', err.message);
  }
}

function initBmrCalibration() {
  onAsyncClick('formula-update-btn', updateStoredBmrCalibration);
}
