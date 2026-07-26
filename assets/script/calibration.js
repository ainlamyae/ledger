// Weight Trend & Forecast's "Calibrate" flow: fits calcProjection()'s
// generic energy-balance formula (charts.js) to the user's OWN weigh-in/
// calorie/activity/sleep history via weighted least squares, then saves the
// resulting gains to the Settings tab so calcProjection() picks them up via
// getCalibratedGains(). Never runs automatically — a user who doesn't click
// Calibrate keeps the generic formula exactly as-is.

const PROJ_CALIBRATION_MIN_SAMPLES = 6;
const PROJ_CALIBRATION_MIN_CALORIE_COVERAGE = 0.5;
const PROJ_CALIBRATION_MAX_INTERVAL_WEIGHT_DAYS = 60;
const PROJ_CALIBRATION_MIN_CALORIE_STD_DEV = 100;
// Blocking bounds: only reject an energy density this extreme, since it's
// almost certainly a numerical artifact (near-singular fit) rather than a
// real physiological signal.
const PROJ_CALIBRATION_MIN_KCAL_PER_KG = 1500;
const PROJ_CALIBRATION_MAX_KCAL_PER_KG = 20000;
// Warn-only band: 7,700 kcal/kg (pure fat) is a ceiling, not a norm — real
// short-window weigh-in data is often dominated by water/glycogen shifts
// (glycogen depletion drags several kg of water with it at near-zero kcal
// cost), which can drag the fitted energy density well below 7,700 without
// the fit itself being unreliable. Outside this band is unusual enough to
// flag, not implausible enough to block.
const PROJ_CALIBRATION_TYPICAL_MIN_KCAL_PER_KG = 5000;
const PROJ_CALIBRATION_TYPICAL_MAX_KCAL_PER_KG = 9500;
const PROJ_CALIBRATION_MIN_R2 = 0.15;

const PROJ_SETTING_KEYS = [
  'PROJ_BASELINE_KG_PER_DAY',
  'PROJ_CAL_KG_PER_KCAL_DAY',
  'PROJ_ACTIVITY_KG_PER_MIN_DAY',
  'PROJ_SLEEP_KG_PER_HOUR_DAY',
  'PROJ_PROTEIN_KG_PER_G_DAY',
  'PROJ_CALIBRATED_AT',
  'PROJ_CALIBRATION_R2',
  'PROJ_CALIBRATION_SAMPLES',
];

let calibrationListenersAttached = false;
let lastCalibrationFit = null; // { beta0, betaCal, betaAct, betaSleep, r2, n } once a passing fit exists, else null

function initCalibrationPanel() {
  if (calibrationListenersAttached) return;
  calibrationListenersAttached = true;

  document.getElementById('calibrate-projection-btn').addEventListener('click', openCalibrationModal);
  document.getElementById('calibration-cancel-btn').addEventListener('click', closeCalibrationModal);
  document.getElementById('calibration-run-btn').addEventListener('click', runCalibration);
  document.getElementById('calibration-save-btn').addEventListener('click', saveCalibratedGains);
  document.getElementById('calibration-reset-btn').addEventListener('click', resetCalibration);
}

function openCalibrationModal() {
  lastCalibrationFit = null;
  document.getElementById('calibration-save-btn').disabled = true;
  clearFieldError('calibration-status');

  const gains = getCalibratedGains();
  const summary = document.getElementById('calibration-summary');
  if (gains) {
    const calibratedAt = getSettingString('PROJ_CALIBRATED_AT', 'an earlier session');
    const r2 = getSetting('PROJ_CALIBRATION_R2', null);
    const n = getSetting('PROJ_CALIBRATION_SAMPLES', null);
    const details = [n !== null ? `${n} intervals` : null, r2 !== null ? `R² ${r2.toFixed(2)}` : null]
      .filter(Boolean).join(', ');
    summary.innerHTML = `<p>Currently calibrated (${calibratedAt}${details ? `, ${details}` : ''}). Run again to refit from your latest history, or reset to the generic formula.</p>`;
  } else {
    summary.innerHTML = '<p>Not calibrated yet — the forecast is using the generic formula (7,700 kcal/kg, 5 kcal per active minute, and a 0.7–1.0 sleep multiplier) for everyone.</p>';
  }

  document.getElementById('calibration-modal').hidden = false;
}

function closeCalibrationModal() {
  document.getElementById('calibration-modal').hidden = true;
}

// Collapses same-day Weight entries (averaged), pairs up consecutive
// weigh-ins into intervals, and computes each interval's average
// calories/activity/sleep using the exact same day-with-a-log averaging
// convention calcProjection() uses (charts.js's avg()) — training and
// projection must agree on what "average calories" means, or the fitted
// coefficients end up calibrated against a quantity calcProjection() never
// actually feeds them.
function buildCalibrationSamples(entries, sleepTarget, proteinTarget) {
  const weightSums = new Map();
  const caloriesByDate = new Map();
  const activityByDate = new Map();
  const sleepByDate = new Map();
  const proteinByDate = new Map();

  entries.forEach((e) => {
    if (e.amount === null) return;
    if (e.category === 'Weight') {
      const cur = weightSums.get(e.date) || { sum: 0, count: 0 };
      cur.sum += e.amount;
      cur.count += 1;
      weightSums.set(e.date, cur);
    } else if (e.category === 'Calories' || e.category === 'Calories; Protein') {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
      if (e.category === 'Calories; Protein' && e.amount2 !== null) {
        proteinByDate.set(e.date, (proteinByDate.get(e.date) || 0) + e.amount2);
      }
    } else if (e.category === 'Activity') {
      const mins = toActivityMinutes(e.amount, e.unit);
      activityByDate.set(e.date, (activityByDate.get(e.date) || 0) + mins);
    } else if (e.category === 'Sleep') {
      sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
    }
  });

  const weightByDate = new Map([...weightSums].map(([date, { sum, count }]) => [date, sum / count]));
  const dates = [...weightByDate.keys()].sort();

  const sliceByRange = (map, fromInclusive, toExclusive) => {
    const sliced = new Map();
    for (const [date, value] of map) {
      if (date >= fromInclusive && date < toExclusive) sliced.set(date, value);
    }
    return sliced;
  };

  const samples = [];
  let excludedCount = 0;

  for (let i = 0; i < dates.length - 1; i++) {
    const dateA = dates[i];
    const dateB = dates[i + 1];
    const days = Math.round((parseIsoDateUTC(dateB) - parseIsoDateUTC(dateA)) / 86400000);
    if (days <= 0) continue;

    // Missing intake data must not be silently treated as "0" or "at
    // target" — calories is the primary driver, so an interval with too
    // sparse a calorie log is excluded outright rather than guessed at.
    const calSlice = sliceByRange(caloriesByDate, dateA, dateB);
    if (calSlice.size / days < PROJ_CALIBRATION_MIN_CALORIE_COVERAGE) {
      excludedCount++;
      continue;
    }

    const actSlice = sliceByRange(activityByDate, dateA, dateB);
    const sleepSlice = sliceByRange(sleepByDate, dateA, dateB);
    const proteinSlice = sliceByRange(proteinByDate, dateA, dateB);

    samples.push({
      days,
      ratePerDay: (weightByDate.get(dateB) - weightByDate.get(dateA)) / days,
      avgCalories: avg(calSlice),
      avgActivityMins: actSlice.size > 0 ? avg(actSlice) : 0,
      avgSleepHours: sleepSlice.size > 0 ? avg(sleepSlice) : sleepTarget,
      avgProteinG: proteinSlice.size > 0 ? avg(proteinSlice) : proteinTarget,
    });
  }

  return { samples, excludedCount };
}

// Gauss-Jordan elimination with partial pivoting. Returns null if the system
// is singular (e.g. a predictor with zero variance across every sample).
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-10) return null;
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

// Weighted least squares (weight = days, capped, so one abnormally long gap
// can't dominate the fit) of:
//   ratePerDay ≈ β0 + β1·(avgCalories−calorieTarget) + β2·avgActivityMins + β3·(avgSleepHours−sleepTarget) + β4·(avgProteinG−proteinTarget)
// Centering calories/sleep/protein on the user's existing target settings
// makes β0 a clean "baseline kg/day drift my logged habits don't explain"
// term (adaptive thermogenesis / intake under-reporting / noise) —
// something the generic formula has no provision for at all.
function fitWeightedOLS(samples, calorieTarget, sleepTarget, proteinTarget) {
  const X = samples.map((s) => [1, s.avgCalories - calorieTarget, s.avgActivityMins, s.avgSleepHours - sleepTarget, s.avgProteinG - proteinTarget]);
  const y = samples.map((s) => s.ratePerDay);
  const w = samples.map((s) => Math.min(s.days, PROJ_CALIBRATION_MAX_INTERVAL_WEIGHT_DAYS));

  const k = 5;
  const ATA = Array.from({ length: k }, () => new Array(k).fill(0));
  const ATy = new Array(k).fill(0);

  samples.forEach((_, i) => {
    for (let a = 0; a < k; a++) {
      ATy[a] += w[i] * X[i][a] * y[i];
      for (let b = 0; b < k; b++) ATA[a][b] += w[i] * X[i][a] * X[i][b];
    }
  });

  const beta = solveLinearSystem(ATA, ATy);
  if (!beta) return { status: 'singular' };

  const wSum = w.reduce((a, b) => a + b, 0);
  const yMeanW = w.reduce((s, wi, i) => s + wi * y[i], 0) / wSum;
  let ssRes = 0;
  let ssTot = 0;
  samples.forEach((_, i) => {
    const yHat = beta[0] * X[i][0] + beta[1] * X[i][1] + beta[2] * X[i][2] + beta[3] * X[i][3] + beta[4] * X[i][4];
    ssRes += w[i] * (y[i] - yHat) ** 2;
    ssTot += w[i] * (y[i] - yMeanW) ** 2;
  });
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { status: 'ok', beta0: beta[0], betaCal: beta[1], betaAct: beta[2], betaSleep: beta[3], betaProtein: beta[4], r2, n: samples.length };
}

// Guardrails independent of the fit-time solver succeeding — a technically
// "solvable" system can still be statistically meaningless (near-zero
// calorie variance) or physiologically nonsensical (wrong-signed or
// wildly-scaled energy density).
function validateCalibration(fit, samples) {
  const blocking = [];
  const warnings = [];

  const calorieValues = samples.map((s) => s.avgCalories);
  const calorieMean = calorieValues.reduce((a, b) => a + b, 0) / calorieValues.length;
  const calorieStdDev = Math.sqrt(calorieValues.reduce((s, v) => s + (v - calorieMean) ** 2, 0) / calorieValues.length);
  if (calorieStdDev < PROJ_CALIBRATION_MIN_CALORIE_STD_DEV) {
    blocking.push(`Your logged calorie intake barely varies across weigh-ins (±${calorieStdDev.toFixed(0)} kcal) — not enough signal to calibrate reliably yet.`);
  }

  if (fit.betaCal <= 0) {
    blocking.push('The fit implies eating more speeds up weight loss, which is not physiologically plausible — your data is too noisy to calibrate yet.');
  } else {
    const effectiveKcalPerKg = 1 / fit.betaCal;
    if (effectiveKcalPerKg < PROJ_CALIBRATION_MIN_KCAL_PER_KG || effectiveKcalPerKg > PROJ_CALIBRATION_MAX_KCAL_PER_KG) {
      blocking.push(`The fit implies an extreme ${Math.round(effectiveKcalPerKg).toLocaleString()} kcal/kg energy density — your data is too noisy to calibrate yet.`);
    } else if (effectiveKcalPerKg < PROJ_CALIBRATION_TYPICAL_MIN_KCAL_PER_KG || effectiveKcalPerKg > PROJ_CALIBRATION_TYPICAL_MAX_KCAL_PER_KG) {
      warnings.push(`Energy density of ${Math.round(effectiveKcalPerKg).toLocaleString()} kcal/kg is outside the typical 5,000–9,500 range — often reflects water/glycogen swings rather than fat loss in a shorter logging window. Still usable; recalibrating later with more history may tighten it.`);
    }
  }

  if (fit.r2 < PROJ_CALIBRATION_MIN_R2) {
    warnings.push(`Low-confidence fit (R² ${fit.r2.toFixed(2)}) — your logged habits don't explain much of your weight trend yet. Save anyway, or log more consistently first for a better calibration.`);
  }

  return { blocking, warnings };
}

function runCalibration() {
  const calorieTarget = getCalorieTargetKcal(getDatedWellnessEntries());
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);
  const proteinTarget = getProteinTargetG(getDatedWellnessEntries());

  const summary = document.getElementById('calibration-summary');
  const saveBtn = document.getElementById('calibration-save-btn');
  clearFieldError('calibration-status');
  saveBtn.disabled = true;
  lastCalibrationFit = null;

  const { samples, excludedCount } = buildCalibrationSamples(getDatedWellnessEntries(), sleepTarget, proteinTarget);

  if (samples.length < PROJ_CALIBRATION_MIN_SAMPLES) {
    summary.innerHTML = `<p>Only ${samples.length} usable weigh-in interval(s) found (need at least ${PROJ_CALIBRATION_MIN_SAMPLES}, each with calorie logs covering at least half the interval). Log Weight alongside Calories more consistently, then try again.</p>`;
    return;
  }

  const fit = fitWeightedOLS(samples, calorieTarget, sleepTarget, proteinTarget);
  if (fit.status !== 'ok') {
    summary.innerHTML = '<p>Could not fit a stable model from this history — try logging more varied calorie intake alongside your weigh-ins.</p>';
    return;
  }

  const effectiveKcalPerKg = fit.betaCal > 0 ? Math.round(1 / fit.betaCal) : null;
  // The generic formula subtracts activity's kcal-equivalent from balance
  // (more activity -> more deficit -> more negative slope), so betaAct is
  // expected to fit NEGATIVE (more activity minutes -> more weight loss).
  // Flip the sign here to show it in the same positive "kcal burned per
  // minute" framing as the generic model's flat constant of 5, rather than
  // literally printing the negative coefficient and making a physically
  // correct fit look backwards.
  const activityKcalEquivPerMin = effectiveKcalPerKg !== null ? Math.round(-fit.betaAct * effectiveKcalPerKg) : null;

  summary.innerHTML = `<table class="calibration-summary-table">
    <tr><td>Intervals used</td><td>${fit.n}${excludedCount ? ` (${excludedCount} excluded — insufficient calorie logs)` : ''}</td></tr>
    <tr><td>Fit quality (R²)</td><td>${fit.r2.toFixed(2)}</td></tr>
    <tr><td>Energy density</td><td>${effectiveKcalPerKg !== null ? `~${effectiveKcalPerKg.toLocaleString()} kcal/kg <span class="hint">(generic: 7,700)</span>` : 'n/a'}</td></tr>
    <tr><td>Activity</td><td>${activityKcalEquivPerMin !== null ? `~${activityKcalEquivPerMin} kcal/min-equivalent <span class="hint">(generic: 5)</span>` : `${(fit.betaAct * 1000).toFixed(1)} g/day per active minute`}</td></tr>
    <tr><td>Sleep</td><td>${(fit.betaSleep * 1000).toFixed(0)} g/day per hour above/below your ${sleepTarget} hr target</td></tr>
    <tr><td>Protein</td><td>${(fit.betaProtein * 1000).toFixed(0)} g/day per gram above/below your ${proteinTarget} g target</td></tr>
    <tr><td>Baseline drift</td><td>${(fit.beta0 * 1000).toFixed(0)} g/day unexplained by logged intake/activity/sleep/protein</td></tr>
  </table>`;

  const validation = validateCalibration(fit, samples);
  if (validation.blocking.length > 0) {
    showFieldError('calibration-status', validation.blocking.join(' '));
    return;
  }
  if (validation.warnings.length > 0) {
    showFieldError('calibration-status', validation.warnings.join(' '));
  }

  lastCalibrationFit = fit;
  saveBtn.disabled = false;
}

async function saveCalibratedGains() {
  if (!lastCalibrationFit) return;

  const btn = document.getElementById('calibration-save-btn');
  btn.disabled = true;
  clearFieldError('calibration-status');

  try {
    const fit = lastCalibrationFit;
    await saveSettingValues({
      PROJ_BASELINE_KG_PER_DAY: fit.beta0,
      PROJ_CAL_KG_PER_KCAL_DAY: fit.betaCal,
      PROJ_ACTIVITY_KG_PER_MIN_DAY: fit.betaAct,
      PROJ_SLEEP_KG_PER_HOUR_DAY: fit.betaSleep,
      PROJ_PROTEIN_KG_PER_G_DAY: fit.betaProtein,
      PROJ_CALIBRATED_AT: new Date().toISOString().slice(0, 10),
      PROJ_CALIBRATION_R2: Math.round(fit.r2 * 1000) / 1000,
      PROJ_CALIBRATION_SAMPLES: fit.n,
    });

    applySettingsToWidgets();
    renderWellnessProjectionChart(getDatedWellnessEntries());

    closeCalibrationModal();
  } catch (err) {
    showFieldError('calibration-status', `Failed to save calibration: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function resetCalibration() {
  await confirmAndDelete('Remove your calibrated forecast gains and revert to the generic formula?', async () => {
    await initSettingsPanel(true);
    if (settingsSheetMissing) return;

    const rowsToDelete = allSettingRows.filter((r) => PROJ_SETTING_KEYS.includes(r.key));
    if (rowsToDelete.length === 0) {
      closeCalibrationModal();
      return;
    }

    // Descending by row so each request's startIndex/endIndex is still
    // valid by the time the API processes the next one in the same call —
    // same pattern as transactions.js's bulkDeleteTransactions.
    const requests = [...rowsToDelete]
      .sort((a, b) => b.row - a.row)
      .map((r) => ({
        deleteDimension: {
          range: { sheetId: settingsSheetId, dimension: 'ROWS', startIndex: r.row - 1, endIndex: r.row },
        },
      }));

    await batchUpdate(requests);
    await refreshSettingsList(true);
    currentSettings = await loadSettings(true);
    applySettingsToWidgets();
    renderWellnessProjectionChart(getDatedWellnessEntries());
    closeCalibrationModal();
  }, 'Failed to reset calibration');
}
