// Weight Trend & Forecast's "Calibrate" flow: fits calcProjection()'s
// generic energy-balance formula (charts.js) to the user's OWN weigh-in/
// calorie/activity/sleep history via weighted ridge regression (penalty chosen
// from that history by leave-one-out cross-validation), then saves the
// resulting gains to the Settings tab so calcProjection() picks them up via
// getCalibratedGains(). Never runs automatically — a user who doesn't click
// Calibrate keeps the generic formula exactly as-is.
//
// Weigh-in noise no longer stops a calibration outright, which is what it used
// to do ("your data is too noisy to calibrate yet"). Two things replace that
// refusal:
//   1. Each fitted sample now spans at least three weeks and takes its rate
//      from every weigh-in inside that span, instead of differencing whichever
//      two weigh-ins happened to be consecutive — so scale/water noise is
//      averaged down before the regression sees it, without the response and
//      the habit averages ending up describing different days
//      (buildCalibrationSamples).
//   2. If the fitted calorie sensitivity still comes out implausible, the
//      calorie term alone is PINNED to the generic 7,700 kcal/kg and the rest
//      of the model is fitted around it, instead of the whole calibration being
//      thrown away over one bad coefficient (fitCalibration).
// So Run Calibration always yields a saveable fit as long as there's enough
// history to build the minimum number of windows at all — what varies is how
// much of the model is genuinely the user's, which the summary and warnings say
// outright rather than hiding behind a pass/fail.

const PROJ_CALIBRATION_MIN_SAMPLES = 6;
const PROJ_CALIBRATION_MIN_CALORIE_COVERAGE = 0.5;
const PROJ_CALIBRATION_MAX_INTERVAL_WEIGHT_DAYS = 60;

// Minimum calendar span of one fitted sample. Two consecutive weigh-ins used to
// be the unit, and that unit is dominated by noise: at a fairly ordinary ±0.4 kg
// of scale/water variation, a 3-day gap carries about 0.19 kg/day of noise
// against a real signal nearer 0.03 kg/day. Regressing on that pulls the calorie
// coefficient toward zero, and since the reported energy density is 1/βcal, a
// βcal squashed toward zero surfaces as an absurd density — the "34,986 kcal/kg,
// your data is too noisy" failure. Endpoint noise doesn't grow with the length of
// the baseline but the signal does, so a longer span is the fix.
//
// Chosen by running this whole pipeline over 200 simulated histories with a
// known 7,700 kcal/kg density (180 days, weigh-ins every 3 days, ±0.4 kg of
// scale noise). Pairing consecutive weigh-ins produced a usable fitted density
// 30 times out of 200 — median 9,300 kcal/kg, skewed high exactly as the bug
// report showed — and fell back to the generic density the other 170. Three-week
// windows produced one 155 times out of 200, median 8,300. The gap widens with
// more history (184/200 at a year) and survives daily weigh-ins on a ±0.8 kg
// scale with 6% freak readings (142/200 vs 5/200). Going longer still (28 days)
// stopped improving the estimate and only cost samples, so this is the knee.
const PROJ_CALIBRATION_MIN_INTERVAL_DAYS = 21;
// Below this much spread in intake BETWEEN WINDOWS, the density is only weakly
// supported however plausible it looks, so it's flagged. Deliberately a warning
// and not a pin: an implausible density is caught by the bounds below on its own
// merits, and a plausible one is worth keeping even if the evidence for it is
// thin. Scaled to what a window average actually varies by — a 21-day mean of
// intake that swings ±400 kcal daily only moves about ±50 kcal from window to
// window, so the ±100 kcal figure this replaced (written for 3-day averages)
// would now flag literally everyone.
const PROJ_CALIBRATION_WEAK_CALORIE_STD_DEV = 25;
// Pinning bounds: an energy density this extreme is a numerical artifact of a
// near-singular fit rather than a real physiological signal, so the calorie
// term gets pinned instead of stored. These no longer block a calibration —
// they only decide whether the density is the user's or the generic one. That
// distinction matters beyond the forecast: getCalorieTargetKcal() converts
// WEEKLY_FAT_LOSS_KG into a daily deficit using this density, so saving an
// absurd one would move the user's actual calorie target, which is why it's
// substituted rather than merely warned about.
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
  'PROJ_ACTIVITY_KG_PER_KCAL_DAY',
  'PROJ_SLEEP_KG_PER_HOUR_DAY',
  'PROJ_PROTEIN_KG_PER_G_DAY',
  'PROJ_CALIBRATED_AT',
  'PROJ_CALIBRATION_R2',
  'PROJ_CALIBRATION_SAMPLES',
  'PROJ_CALIBRATION_ALPHA',
  // Superseded by PROJ_ACTIVITY_KG_PER_KCAL_DAY (see charts.js's
  // getCalibratedGains) — kept here only so Reset still cleans up a
  // leftover row from before this rename, on anyone who calibrated earlier.
  'PROJ_ACTIVITY_KG_PER_MIN_DAY',
];

let calibrationListenersAttached = false;
let lastCalibrationFit = null; // { beta0, betaCal, betaAct, betaSleep, betaProtein, r2, r2Cv, alpha, n } once a passing fit exists, else null

function initCalibrationPanel() {
  if (calibrationListenersAttached) return;
  calibrationListenersAttached = true;

  initFormulaToggle();
  document.getElementById('calibrate-projection-btn').addEventListener('click', openCalibrationModal);
  document.getElementById('calibration-cancel-btn').addEventListener('click', closeCalibrationModal);
  document.getElementById('calibration-run-btn').addEventListener('click', runCalibration);
  document.getElementById('calibration-save-btn').addEventListener('click', saveCalibratedGains);
  document.getElementById('calibration-reset-btn').addEventListener('click', resetCalibration);
}

// Health Metrics' "which formula am I looking at" toggle. Everything
// calibration-dependent funnels through charts.js's getCalibratedGains(), so
// flipping one flag switches the whole section between the calibrated view and
// the generic one — the Weight Trend & Forecast slope/ETA, the calculated
// calorie target (and with it the Caloric Intake target line and the Calories
// Today tile), and Wellness Insight's trajectory/energy-density lines. It
// writes nothing to the Settings tab: this is a display switch for comparing
// the two, not an edit to the saved fit, so it can't damage a calibration and
// resets to calibrated on reload.
//
// Calorie Deficit & Fat Loss follows it too, and relabels its right axis when
// it does — the fitted density measures scale weight rather than fat, so that
// axis means a different thing in each view (see
// renderWellnessEnergyBalanceChart). Body Composition Change is the one chart
// that stays put in both: the fit has no composition parameter to substitute
// (it's an energy model; Forbes/Deurenberg are anthropometric), and it's the
// measured-magnitude reference the predictive charts get compared against.
function initFormulaToggle() {
  const btn = document.getElementById('formula-toggle-btn');

  btn.addEventListener('click', () => {
    useCalibratedFormula = !useCalibratedFormula;
    refreshFormulaToggle();

    // Re-render straight from the already-loaded entries rather than going
    // through loadDashboard — the toggle changes only how these numbers are
    // computed, not what data they're computed from, so there's nothing to
    // re-fetch. renderWellnessCharts covers the projection chart, the target
    // lines, and the Today at a glance tiles in one call.
    renderWellnessCharts(getDatedWellnessEntries());
    renderInsightDataPreview(getInsightDateRange());
  });

  refreshFormulaToggle();
}

// Label reports the ACTIVE view, so the button doubles as a status readout;
// the title says what clicking will do.
//
// The no-saved-fit state gets its OWN label rather than reusing the plain
// "Generic formula" one: with nothing on file the button is disabled, and a
// disabled button reading exactly what the enabled generic view reads is
// indistinguishable from "you toggled to generic and it won't toggle back."
// Naming the reason inline is what makes a dead button legible.
function refreshFormulaToggle() {
  const btn = document.getElementById('formula-toggle-btn');
  const hasSavedFit = readSavedCalibratedGains() !== null;

  btn.disabled = !hasSavedFit;
  const showingCalibrated = hasSavedFit && useCalibratedFormula;

  btn.textContent = !hasSavedFit
    ? '📊 Generic formula (nothing calibrated)'
    : showingCalibrated ? '📐 Calibrated formula' : '📊 Generic formula';
  btn.setAttribute('aria-pressed', String(showingCalibrated));
  btn.title = !hasSavedFit
    ? 'No calibration is saved, so there are no calibrated numbers to compare against — run ⚙️ Calibrate, then Save'
    : showingCalibrated
      ? 'Showing your calibrated formula — click to compare against the generic one'
      : 'Showing the generic formula — click to switch back to your calibrated one';
}

function openCalibrationModal() {
  lastCalibrationFit = null;
  document.getElementById('calibration-save-btn').disabled = true;
  clearCalibrationStatus();

  // The saved fit, not the active view — this modal is about what's on file,
  // so a user comparing against the generic formula must still see (and be
  // able to reset) the calibration they actually have.
  const gains = readSavedCalibratedGains();
  const summary = document.getElementById('calibration-summary');
  if (gains) {
    const calibratedAt = getSettingString('PROJ_CALIBRATED_AT', 'an earlier session');
    const r2 = getSetting('PROJ_CALIBRATION_R2', null);
    const n = getSetting('PROJ_CALIBRATION_SAMPLES', null);
    const details = [n !== null ? `${n} windows` : null, r2 !== null ? `R² ${r2.toFixed(2)}` : null]
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

// Collapses same-day Weight entries (averaged), spans weigh-ins into multi-week
// windows, and computes each window's average
// calories/activity/sleep using the exact same day-with-a-log averaging
// convention calcProjection() uses (charts.js's avg()) — training and
// projection must agree on what "average calories" means, or the fitted
// coefficients end up calibrated against a quantity calcProjection() never
// actually feeds them.
//
// A sample is a WINDOW of at least PROJ_CALIBRATION_MIN_INTERVAL_DAYS, not a
// pair of consecutive weigh-ins, and its rate is the least-squares slope through
// every weigh-in inside that window. Both parts fight noise, and neither one
// distorts what's being related to what:
//   - the long baseline is where the signal finally outweighs the ±0.4 kg of
//     scale/water variation on the endpoints (see the constant's own comment);
//   - the in-window slope uses all the readings rather than just the two ends,
//     so one freak reading (salty dinner, scale on carpet) can't define a whole
//     sample by landing on a boundary.
//
// What this deliberately does NOT do is smooth the weight series first and then
// difference the smoothed line. That sounds like the same idea and measurably
// makes things worse: a centered moving average at each endpoint pulls in
// readings from outside the window, so the response ends up describing a ~15-day
// span while avgCalories and friends describe the 3-day gap between the
// weigh-ins, and relating one to the other is what manufactures a 30,000+
// kcal/kg density in the first place. Simulated against a known 7,700 kcal/kg it
// landed in the plausible band essentially never (0–5% depending on noise, with
// a median density around 30,000) — strictly worse than the raw weigh-ins it was
// meant to clean up, and a faithful reproduction of the reported symptom. The
// response and the predictors have to cover the same days; smoothing only helps
// when it's the same smoothing on both sides, which is what a longer window
// achieves by construction.
//
// Windows start at every weigh-in, so they overlap. That's deliberate — it keeps
// the sample count usable on a few months of history — but it does mean
// neighbouring samples share most of their days, which makes the leave-one-out
// score in fitWeightedRidge optimistic and is called out where that's reported.
function buildCalibrationSamples(entries, sleepTarget, proteinTarget) {
  const weightSums = new Map();
  const caloriesByDate = new Map();
  const activityKcalByDate = new Map();
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
    } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
      // Real Calculate-derived kcal (amount2) when this entry has one —
      // otherwise the flat per-minute estimate calcProjection()'s
      // un-calibrated formula also uses, so an older entry without a kcal
      // figure still contributes something to the fit rather than nothing.
      const mins = toActivityMinutes(e.amount, e.unit);
      const kcal = e.amount2 !== null ? e.amount2 : mins * GENERIC_KCAL_PER_ACTIVE_MIN;
      activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
    } else if (e.category === 'Sleep') {
      sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
    }
  });

  const weightByDate = new Map([...weightSums].map(([date, { sum, count }]) => [date, sum / count]));
  const dates = [...weightByDate.keys()].sort();
  const daysBetween = (from, to) => Math.round((parseIsoDateUTC(to) - parseIsoDateUTC(from)) / 86400000);

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

    // Close the window on the first weigh-in far enough out to carry signal,
    // rather than on whichever one happens to come next.
    let j = i + 1;
    while (j < dates.length && daysBetween(dateA, dates[j]) < PROJ_CALIBRATION_MIN_INTERVAL_DAYS) j++;
    // Every later start is closer to the end of the history than this one, so
    // once one window runs off the end none of the rest can qualify either.
    if (j >= dates.length) break;

    const dateB = dates[j];
    const days = daysBetween(dateA, dateB);

    // Missing intake data must not be silently treated as "0" or "at
    // target" — calories is the primary driver, so a window with too
    // sparse a calorie log is excluded outright rather than guessed at.
    const calSlice = sliceByRange(caloriesByDate, dateA, dateB);
    if (calSlice.size / days < PROJ_CALIBRATION_MIN_CALORIE_COVERAGE) {
      excludedCount++;
      continue;
    }

    const actSlice = sliceByRange(activityKcalByDate, dateA, dateB);
    const sleepSlice = sliceByRange(sleepByDate, dateA, dateB);
    const proteinSlice = sliceByRange(proteinByDate, dateA, dateB);

    // Slope through every weigh-in from dateA to dateB inclusive. Both
    // endpoints belong in it, while the habit slices above stop before dateB —
    // that isn't an inconsistency: a weigh-in reflects the days BEFORE it, so
    // the intake that moved the scale from dateA's reading to dateB's is the
    // intake logged on dateA through dateB-1.
    const windowDates = dates.slice(i, j + 1);

    samples.push({
      days,
      ratePerDay: linearRegressionSlope(
        windowDates.map((date) => daysBetween(dateA, date)),
        windowDates.map((date) => weightByDate.get(date)),
      ),
      avgCalories: avg(calSlice),
      avgActivityKcal: actSlice.size > 0 ? avg(actSlice) : 0,
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

// Ridge penalties tried by the leave-one-out search in fitWeightedRidge, as a
// fraction of the data's own information (see solveRidge for why that's a pure
// ratio here). 0 is included so a genuinely strong fit isn't shrunk at all.
const PROJ_RIDGE_ALPHAS = [0, 0.01, 0.03, 0.1, 0.3, 1, 3, 10];

// Among penalties whose held-out error is within this fraction of the best,
// the strongest one wins — see fitWeightedRidge.
const PROJ_RIDGE_TIE_TOLERANCE = 0.01;

// Predictor order for every coefficient array below: calories, activity,
// sleep, protein. The intercept is handled separately (it isn't penalized).
const PROJ_PREDICTOR_COUNT = 4;
const PROJ_CALORIE_PREDICTOR = 0;

// Which predictors the solver may estimate, one entry per fallback stage in
// fitCalibration. Anything left out isn't dropped from the MODEL — it's held at
// a fixed value the solver fits around: the calorie term at the generic energy
// density, the rest at zero.
const PROJ_FITTABLE_ALL = [0, 1, 2, 3];
const PROJ_FITTABLE_HABITS = [1, 2, 3];
const PROJ_FITTABLE_NONE = [];

// The model being fitted, in the units each coefficient is reported in:
//   ratePerDay ≈ β0 + β1·(avgCalories−calorieTarget) + β2·avgActivityKcal + β3·(avgSleepHours−sleepTarget) + β4·(avgProteinG−proteinTarget)
// avgActivityKcal (not raw activity minutes) so this term is in the same
// energy units as avgCalories — β2 then means the same thing β1 does, just
// for calories burned instead of eaten, rather than requiring a separate
// minutes-to-kcal conversion bolted on afterward for display purposes only.
// Centering calories/sleep/protein on the user's existing target settings
// makes β0 a clean "baseline kg/day drift my logged habits don't explain"
// term (adaptive thermogenesis / intake under-reporting / noise) —
// something the generic formula has no provision for at all.
//
// `pinnedBetaCal` (null, or a kg/day-per-kcal value) holds β1 fixed instead of
// estimating it, and `fittable` lists the predictor indices the solver may move.
function buildDesign(samples, calorieTarget, sleepTarget, proteinTarget, pinnedBetaCal, fittable) {
  const x = samples.map((s) => [
    s.avgCalories - calorieTarget,
    s.avgActivityKcal,
    s.avgSleepHours - sleepTarget,
    s.avgProteinG - proteinTarget,
  ]);
  const yObserved = samples.map((s) => s.ratePerDay);

  return {
    x,
    // Kept alongside `y` for R²: the denominator has to be variance around the
    // mean OBSERVED rate, or "better than assuming your average rate" stops
    // meaning that once part of the model is pinned.
    yObserved,
    // What the solver actually minimizes. A pinned calorie term's contribution
    // is known up front, so it's subtracted from the response first (a standard
    // regression offset) and the remaining terms plus the intercept fit only
    // what it leaves behind.
    y: pinnedBetaCal === null
      ? yObserved
      : yObserved.map((rate, i) => rate - pinnedBetaCal * x[i][PROJ_CALORIE_PREDICTOR]),
    // Weight = interval length in days, capped, so one abnormally long gap
    // can't dominate the fit.
    w: samples.map((s) => Math.min(s.days, PROJ_CALIBRATION_MAX_INTERVAL_WEIGHT_DAYS)),
    pinnedBetaCal,
    fittable,
  };
}

// Weighted ridge regression over `rows` of `design`, returned in the model's
// ORIGINAL units so every caller and every stored coefficient keeps the meaning
// documented above.
//
// Ridge is not scale-invariant, which matters enormously here: these four
// predictors are hundreds of kcal, hundreds of kcal, about one hour, and tens of
// grams. Adding one raw penalty to an unstandardized normal-matrix diagonal
// would have penalized the sleep coefficient on the order of 10,000x harder than
// the calorie one, purely because of the units they happen to be measured in. So
// each predictor is standardized by its own WEIGHTED standard deviation first,
// which also makes every diagonal entry of Z'WZ exactly the total weight — so
// `alpha` is a pure ratio of penalty to information, comparable across
// predictors and across users, rather than a magic number in mixed units.
//
// Returns null if the penalized system still can't be solved.
function solveRidge(design, rows, alpha) {
  const { x, y, w, fittable } = design;
  const wSum = rows.reduce((sum, i) => sum + w[i], 0);
  if (wSum <= 0) return null;

  const yMean = rows.reduce((sum, i) => sum + w[i] * y[i], 0) / wSum;

  // A predictor with no variance across these rows (e.g. protein never logged,
  // so every deviation from target is the same number) carries no information
  // and can't be standardized. It's dropped with a zero coefficient rather than
  // making the whole system singular — which is what the un-regularized fit did,
  // refusing to calibrate the other three terms at all over one unused input.
  //
  // Non-fittable predictors keep mean 0 / sd 0 and are never entered: their
  // coefficient stays 0 here, so the intercept expression below ignores them,
  // which is what makes a pinned term's β0 come out in the same units and with
  // the same meaning as an unpinned one's (the pinned term contributes nothing
  // at x = 0 either way).
  const mean = new Array(PROJ_PREDICTOR_COUNT).fill(0);
  const sd = new Array(PROJ_PREDICTOR_COUNT).fill(0);
  const active = [];
  fittable.forEach((j) => {
    const m = rows.reduce((sum, i) => sum + w[i] * x[i][j], 0) / wSum;
    const variance = rows.reduce((sum, i) => sum + w[i] * (x[i][j] - m) ** 2, 0) / wSum;
    mean[j] = m;
    sd[j] = Math.sqrt(variance);
    if (sd[j] > 0) active.push(j);
  });

  const beta = new Array(PROJ_PREDICTOR_COUNT).fill(0);

  if (active.length > 0) {
    const k = active.length;
    const A = Array.from({ length: k }, () => new Array(k).fill(0));
    const b = new Array(k).fill(0);

    rows.forEach((i) => {
      const z = active.map((j) => (x[i][j] - mean[j]) / sd[j]);
      const dy = y[i] - yMean;
      for (let a = 0; a < k; a++) {
        b[a] += w[i] * z[a] * dy;
        for (let c = 0; c < k; c++) A[a][c] += w[i] * z[a] * z[c];
      }
    });

    for (let a = 0; a < k; a++) A[a][a] += alpha * wSum;

    const solved = solveLinearSystem(A, b);
    if (!solved) return null;

    // A standardized coefficient is "per standard deviation", so dividing by
    // that predictor's own sd puts it back into per-kcal / per-hour / per-gram.
    active.forEach((j, a) => { beta[j] = solved[a] / sd[j]; });
  }

  // The intercept is deliberately NOT penalized — standard practice, since it
  // isn't a slope and shrinking it would bias the model's overall level rather
  // than its sensitivities. Because the predictors were centered above, it falls
  // out as the fitted value at x = 0, which in these already-target-centered
  // coordinates is exactly the semantics charts.js depends on: the rate at
  // target intake, zero logged activity, target sleep, and target protein.
  const beta0 = yMean - beta.reduce((sum, bj, j) => sum + bj * mean[j], 0);

  return { beta0, beta, droppedCount: fittable.length - active.length };
}

function predictRate(coefficients, xi) {
  return coefficients.beta0 + coefficients.beta.reduce((sum, bj, j) => sum + bj * xi[j], 0);
}

// Total weighted squared error of predicting each interval from a model refitted
// WITHOUT it — standardization included, so nothing about the held-out interval
// leaks into the model that predicts it. This is what selects alpha: any
// in-sample criterion would always pick zero shrinkage, because ridge can only
// ever increase in-sample error. Null if any fold fails to solve.
function looSquaredError(design, alpha) {
  const n = design.y.length;
  let sse = 0;

  for (let held = 0; held < n; held++) {
    const rows = [];
    for (let i = 0; i < n; i++) if (i !== held) rows.push(i);

    const trained = solveRidge(design, rows, alpha);
    if (!trained) return null;
    sse += design.w[held] * (design.y[held] - predictRate(trained, design.x[held])) ** 2;
  }

  return sse;
}

// Fits the model above with the penalty chosen from the user's own data.
//
// Why regularize at all: four predictors over a few dozen weigh-in intervals,
// all correlated (eat more on days you train more, sleep less when you eat
// late), is exactly the setup where least squares hands back large offsetting
// coefficients that fit the noise. In practice that produced physiologically
// impossible signs — a fit claiming that burning calories, sleeping more, and
// eating more protein each ADD weight — and, because β0 has to absorb whatever
// those wrong-signed terms contribute at the user's average habits, a baseline
// drift so large the projection came out pinned to its own safety clamp. Ridge
// pulls the sensitivities toward zero, and β0 follows them back toward the
// weighted mean rate actually observed, which is the honest answer when the
// habit data explains little.
function fitWeightedRidge(samples, calorieTarget, sleepTarget, proteinTarget, pinnedBetaCal, fittable) {
  const design = buildDesign(samples, calorieTarget, sleepTarget, proteinTarget, pinnedBetaCal, fittable);
  const allRows = design.y.map((_, i) => i);

  // With no predictor being estimated there's nothing to shrink, so there's no
  // penalty to choose either — searching would just report whichever α won a
  // tie between identical scores, which reads in the summary as a real finding.
  const alphas = fittable.length === 0 ? [0] : PROJ_RIDGE_ALPHAS;

  const scored = alphas
    .map((alpha) => ({ alpha, sse: looSquaredError(design, alpha) }))
    .filter((s) => s.sse !== null);
  if (scored.length === 0) return { status: 'singular' };

  // Among penalties that predict a held-out interval about equally well, take
  // the strongest: it's the one least likely to be reading noise as signal.
  // (Same idea as glmnet's one-standard-error rule, with a fixed tolerance in
  // place of an SE estimate.)
  const bestSse = Math.min(...scored.map((s) => s.sse));
  const chosen = scored
    .filter((s) => s.sse <= bestSse * (1 + PROJ_RIDGE_TIE_TOLERANCE))
    .reduce((best, s) => (s.alpha > best.alpha ? s : best));

  const fit = solveRidge(design, allRows, chosen.alpha);
  if (!fit) return { status: 'singular' };

  const wSum = design.w.reduce((a, b) => a + b, 0);
  const yMeanW = design.w.reduce((s, wi, i) => s + wi * design.yObserved[i], 0) / wSum;
  let ssRes = 0;
  let ssTot = 0;
  design.y.forEach((yi, i) => {
    // Residuals are taken in the solver's own (offset) space while ssTot comes
    // from the observed rates. That's not a mismatch: subtracting a pinned
    // term's contribution from both the observation and the prediction cancels,
    // so these ARE the full model's residuals on the observed rates. The
    // denominator, though, has to stay the spread of what was actually measured.
    ssRes += design.w[i] * (yi - predictRate(fit, design.x[i])) ** 2;
    ssTot += design.w[i] * (design.yObserved[i] - yMeanW) ** 2;
  });

  return {
    status: 'ok',
    beta0: fit.beta0,
    betaCal: pinnedBetaCal === null ? fit.beta[PROJ_CALORIE_PREDICTOR] : pinnedBetaCal,
    betaAct: fit.beta[1],
    betaSleep: fit.beta[2],
    betaProtein: fit.beta[3],
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    // How well the model predicts an interval it never saw. Unlike R² this can
    // go NEGATIVE, which is the useful part: below zero means the fitted habit
    // terms predict a new weigh-in interval worse than simply assuming the
    // average rate, i.e. there's no usable signal yet however good R² looks.
    r2Cv: ssTot > 0 ? 1 - chosen.sse / ssTot : 0,
    alpha: chosen.alpha,
    droppedCount: fit.droppedCount,
    habitTermsFitted: fittable.some((j) => j !== PROJ_CALORIE_PREDICTOR),
    n: samples.length,
  };
}

// Spread of the window-average intake across the samples the fit is handed. Low
// spread means little leverage to separate "ate more" from everything else that
// moved, so it's what the weak-evidence warning is measured against. Note this
// is inherently much smaller than daily variation: averaging three weeks of
// intake flattens most of it, and overlapping windows share days on top of that.
function calorieSpread(samples) {
  const values = samples.map((s) => s.avgCalories);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

// Why this fit's calorie coefficient can't serve as the user's energy density —
// or null if it can. Phrased as a mid-sentence clause because it's reported to
// the user inside the pinning warning, not thrown away.
//
// Only implausibility pins. Thin evidence for a plausible number doesn't: a
// density inside the physiological bounds is a usable density whether the data
// supports it strongly or weakly, and swapping it for 7,700 on the grounds that
// we're not confident enough would replace the user's own estimate with a
// stranger's for no gain. Weak support is warned about instead.
function calorieTermRejection(fit) {
  if (!(fit.betaCal > 0)) {
    return 'the unconstrained fit came out implying that eating more speeds up weight loss';
  }
  const kcalPerKg = 1 / fit.betaCal;
  if (kcalPerKg < PROJ_CALIBRATION_MIN_KCAL_PER_KG || kcalPerKg > PROJ_CALIBRATION_MAX_KCAL_PER_KG) {
    return `the unconstrained fit came out at an impossible ${Math.round(kcalPerKg).toLocaleString()} kcal/kg`;
  }
  return null;
}

// Fits as much of the model as this history can actually support, degrading
// instead of refusing. Three stages, each keeping everything the previous one
// established:
//   1. Everything fitted — the calorie term included.
//   2. Calorie term pinned to the generic 7,700 kcal/kg, activity/sleep/protein
//      and the baseline drift fitted around it. This is the case that used to be
//      an outright "could not calibrate": a scale-noise-dominated response
//      leaves β1 unidentifiable long before it costs you the other three terms
//      or the baseline drift, which are the parts the generic formula has no
//      equivalent for at all.
//   3. Generic density and baseline drift only, if the habit predictors are so
//      collinear that even the penalized system won't solve. Thin, but it's
//      still the user's own measured drift rather than a shrug.
// `pinReason` (null in stage 1) is what the summary and warnings report, so a
// pinned fit never passes itself off as a fully personal one.
function fitCalibration(samples, calorieTarget, sleepTarget, proteinTarget) {
  const calorieStdDev = calorieSpread(samples);
  const attempt = (pin, fittable) => fitWeightedRidge(samples, calorieTarget, sleepTarget, proteinTarget, pin, fittable);

  const free = attempt(null, PROJ_FITTABLE_ALL);
  const pinReason = free.status === 'ok'
    ? calorieTermRejection(free)
    : 'the unconstrained fit had no stable solution at all';
  if (!pinReason) return { ...free, calorieStdDev, pinReason: null };

  const genericBetaCal = 1 / GENERIC_KCAL_PER_KG_FAT;
  const pinned = attempt(genericBetaCal, PROJ_FITTABLE_HABITS);
  if (pinned.status === 'ok') return { ...pinned, calorieStdDev, pinReason };

  return { ...attempt(genericBetaCal, PROJ_FITTABLE_NONE), calorieStdDev, pinReason };
}

// What's worth telling the user about a fit that is, by construction, always
// saveable. Nothing here blocks: fitCalibration has already substituted the
// generic energy density for anything implausible, so what's left is disclosure
// — which parts of this calibration are genuinely theirs, and how much to trust
// the parts that are.
function validateCalibration(fit) {
  const warnings = [];

  if (fit.pinReason) {
    const fittedRest = fit.habitTermsFitted
      ? 'your baseline drift plus the activity, sleep, and protein sensitivities are all still fitted from your own history'
      : 'your baseline drift is still fitted from your own history';
    warnings.push(`Energy density couldn't be read off your data (${fit.pinReason}), so it's pinned to the generic 7,700 kcal/kg and the rest of the model was fitted around it — ${fittedRest}. Recalibrate once you've logged more varied intake alongside your weigh-ins to get a density of your own.`);
  } else {
    const effectiveKcalPerKg = 1 / fit.betaCal;
    if (effectiveKcalPerKg < PROJ_CALIBRATION_TYPICAL_MIN_KCAL_PER_KG || effectiveKcalPerKg > PROJ_CALIBRATION_TYPICAL_MAX_KCAL_PER_KG) {
      warnings.push(`Energy density of ${Math.round(effectiveKcalPerKg).toLocaleString()} kcal/kg is outside the typical 5,000–9,500 range — often reflects water/glycogen swings rather than fat loss in a shorter logging window. Still usable; recalibrating later with more history may tighten it.`);
    }
    if (fit.calorieStdDev < PROJ_CALIBRATION_WEAK_CALORIE_STD_DEV) {
      warnings.push(`Your average intake barely differs from one window to the next (±${fit.calorieStdDev.toFixed(0)} kcal), so this energy density is only weakly supported — it came out physiologically sensible, which is why it was kept, but there isn't much in your history separating "ate more" from everything else that changed. Varying your intake more, or logging longer, is what firms it up.`);
    }
  }

  if (!fit.habitTermsFitted) {
    warnings.push('None of the activity, sleep, or protein terms could be separated from each other in this history, so this calibration is the generic formula plus your own measured baseline drift and nothing more.');
  } else if (fit.droppedCount > 0) {
    warnings.push(`${fit.droppedCount} of the habit inputs never varied across your weigh-ins, so ${fit.droppedCount === 1 ? 'it was' : 'they were'} left out of the fit rather than guessed at — log ${fit.droppedCount === 1 ? 'it' : 'them'} alongside your weight to include ${fit.droppedCount === 1 ? 'it' : 'them'} next time.`);
  }

  if (fit.betaAct > 0) {
    warnings.push("The fit implies burning more calories through activity slows weight loss, which is not physiologically plausible — the activity term is likely just noise; the rest of the calibration is still usable.");
  }

  // The honest headline when regularization couldn't rescue the fit: R2 measures
  // how well the model describes the intervals it was fitted on, which a flexible
  // model can always do to some degree. r2Cv measures whether it predicts a
  // weigh-in it never saw, and at or below zero it does worse than simply
  // assuming the average rate — so the calibrated forecast is not yet an
  // improvement on the generic one, whatever R2 says.
  // Overlapping windows (see buildCalibrationSamples) make this score somewhat
  // generous, since a held-out window shares most of its days with its
  // neighbours — so at or below zero it's a clear verdict, not a marginal one.
  if (fit.r2Cv <= 0) {
    warnings.push(`This fit has no predictive power yet (predictive R² ${fit.r2Cv.toFixed(2)}) — on weigh-ins it hadn't seen it does no better than assuming your average rate, so the calibrated forecast isn't an improvement on the generic one.${fit.pinReason ? '' : ' The energy density is still worth keeping; the habit sensitivities aren\'t reliable yet.'}`);
  }

  if (fit.r2 < PROJ_CALIBRATION_MIN_R2) {
    warnings.push(`Low-confidence fit (R² ${fit.r2.toFixed(2)}) — your logged habits don't explain much of your weight trend yet. Save anyway, or log more consistently first for a better calibration.`);
  }

  return warnings;
}

function runCalibration() {
  const calorieTarget = getCalorieTargetKcal(getDatedWellnessEntries());
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);
  const proteinTarget = getProteinTargetG(getDatedWellnessEntries());

  const summary = document.getElementById('calibration-summary');
  const saveBtn = document.getElementById('calibration-save-btn');
  clearCalibrationStatus();
  saveBtn.disabled = true;
  lastCalibrationFit = null;

  const { samples, excludedCount } = buildCalibrationSamples(getDatedWellnessEntries(), sleepTarget, proteinTarget);

  if (samples.length < PROJ_CALIBRATION_MIN_SAMPLES) {
    summary.innerHTML = `<p>Only ${samples.length} usable ${PROJ_CALIBRATION_MIN_INTERVAL_DAYS}-day window(s) found (need at least ${PROJ_CALIBRATION_MIN_SAMPLES}, each with calorie logs covering at least half the window). Windows start at every weigh-in and run to the first weigh-in ${PROJ_CALIBRATION_MIN_INTERVAL_DAYS}+ days later, so this needs roughly ${PROJ_CALIBRATION_MIN_INTERVAL_DAYS} days of history plus ${PROJ_CALIBRATION_MIN_SAMPLES} more weigh-ins after that, with Calories logged alongside.</p>`;
    return;
  }

  // The only remaining way to come back without a fit: every stage of
  // fitCalibration's fallback chain failed to solve, which needs a degenerate
  // design (zero total interval weight) rather than merely noisy data.
  const fit = fitCalibration(samples, calorieTarget, sleepTarget, proteinTarget);
  if (fit.status !== 'ok') {
    summary.innerHTML = '<p>Could not fit a stable model from this history — try logging more varied calorie intake alongside your weigh-ins.</p>';
    return;
  }

  const effectiveKcalPerKg = fit.betaCal > 0 ? Math.round(1 / fit.betaCal) : null;
  // betaAct is now in the same units as betaCal (kg/day per kcal, just for
  // burning instead of eating), so its own implied energy density is
  // directly comparable to the intake-derived one above — similar values
  // are a sanity check that the model is internally consistent; wildly
  // different ones (or a positive betaAct, flagged separately below) mean
  // the activity term is mostly noise.
  const activityKcalPerKg = fit.betaAct < 0 ? Math.round(-1 / fit.betaAct) : null;

  summary.innerHTML = `<table class="calibration-summary-table">
    <tr><td>Windows used</td><td>${fit.n}${excludedCount ? ` (${excludedCount} excluded — insufficient calorie logs)` : ''} <span class="hint">each spans at least ${PROJ_CALIBRATION_MIN_INTERVAL_DAYS} days and takes its rate from every weigh-in inside it, so day-to-day water and sodium swings average out instead of drowning the signal; windows start at every weigh-in, so they overlap</span></td></tr>
    <tr><td>Fit quality (R²)</td><td>${fit.r2.toFixed(2)} <span class="hint">in-sample</span></td></tr>
    <tr><td>Predictive (R²)</td><td>${fit.r2Cv.toFixed(2)} <span class="hint">on windows the fit never saw — at or below 0 means your habit data doesn't predict a new window better than assuming your average rate. Reads a little generously, since overlapping windows share days</span></td></tr>
    <tr><td>Shrinkage</td><td>${!fit.habitTermsFitted ? 'n/a' : fit.alpha === 0 ? 'none needed' : `α ${fit.alpha}`} <span class="hint">${!fit.habitTermsFitted ? 'no habit sensitivities were estimated, so there was nothing to shrink' : fit.alpha === 0 ? 'the fit held up on its own' : 'chosen from your own data by leave-one-out; pulls noisy sensitivities toward zero'}</span></td></tr>
    <tr><td>Energy density</td><td>${effectiveKcalPerKg !== null
      ? `~${effectiveKcalPerKg.toLocaleString()} kcal/kg <span class="hint">${fit.pinReason ? 'pinned to the generic value — your history couldn\'t identify one of its own; see the note below' : '(generic: 7,700)'}</span>`
      : 'n/a'}</td></tr>
    <tr><td>Activity</td><td>${activityKcalPerKg !== null ? `~${activityKcalPerKg.toLocaleString()} kcal/kg <span class="hint">(compare to Energy density above — similar values mean the model is internally consistent)</span>` : `${(fit.betaAct * 1000).toFixed(2)} g/day per kcal burned`}</td></tr>
    <tr><td>Sleep</td><td>${(fit.betaSleep * 1000).toFixed(0)} g/day per hour above/below your ${sleepTarget} hr target</td></tr>
    <tr><td>Protein</td><td>${(fit.betaProtein * 1000).toFixed(0)} g/day per gram above/below your ${proteinTarget} g target</td></tr>
    <tr><td>Baseline drift</td><td>${(fit.beta0 * 1000).toFixed(0)} g/day unexplained by logged intake/activity/sleep/protein</td></tr>
  </table>`;

  const warnings = validateCalibration(fit);
  if (warnings.length > 0) {
    // Rendered through the same red .status element a real failure would use
    // (no separate warning color in this app's CSS) — spelling out "calibration
    // succeeded" and "still enabled" in the text itself, rather than relying on
    // color, is what keeps a heads-up from reading as a refusal.
    showFieldError('calibration-status', `⚠️ Calibrated successfully — Save below is still enabled. Heads up: ${warnings.join(' ')}`);
  }

  lastCalibrationFit = fit;
  saveBtn.disabled = false;
}

// Which of the just-written keys can't be found (or came back changed) on the
// sheet. PROJ_CALIBRATED_AT is excluded from the value comparison on purpose:
// it's cosmetic, and a date-formatted cell can legitimately read back in the
// sheet's own display format rather than the ISO string that was written,
// which would fail a strict comparison for no real reason. Every other key is
// numeric and functional.
function unverifiedCalibrationKeys(written) {
  return Object.entries(written)
    .filter(([key]) => key !== 'PROJ_CALIBRATED_AT')
    .filter(([key, value]) => {
      const stored = getSetting(key, null);
      // Relative tolerance — Sheets round-trips a double through ~15
      // significant digits, so demanding bit-for-bit equality would flag a
      // perfectly good write. The +1e-12 floor keeps a legitimate 0 (e.g. a
      // zero protein gain) from failing on a zero relative tolerance.
      return stored === null || Math.abs(stored - value) > Math.abs(value) * 1e-9 + 1e-12;
    })
    .map(([key]) => key);
}

function setCalibrationStatus(message, isSuccess = false) {
  const el = document.getElementById('calibration-status');
  el.classList.toggle('status-success', isSuccess);
  el.textContent = message;
  el.hidden = false;
}

// clearFieldError only hides the element, so the success styling and the
// relabeled Cancel button have to be undone explicitly or they leak into the
// next run.
function clearCalibrationStatus() {
  document.getElementById('calibration-status').classList.remove('status-success');
  document.getElementById('calibration-cancel-btn').textContent = 'Cancel';
  clearFieldError('calibration-status');
}

async function saveCalibratedGains() {
  if (!lastCalibrationFit) return;

  const btn = document.getElementById('calibration-save-btn');
  btn.disabled = true;
  clearCalibrationStatus();

  const fit = lastCalibrationFit;
  const written = {
    PROJ_BASELINE_KG_PER_DAY: fit.beta0,
    PROJ_CAL_KG_PER_KCAL_DAY: fit.betaCal,
    PROJ_ACTIVITY_KG_PER_KCAL_DAY: fit.betaAct,
    PROJ_SLEEP_KG_PER_HOUR_DAY: fit.betaSleep,
    PROJ_PROTEIN_KG_PER_G_DAY: fit.betaProtein,
    PROJ_CALIBRATED_AT: new Date().toISOString().slice(0, 10),
    PROJ_CALIBRATION_R2: Math.round(fit.r2 * 1000) / 1000,
    PROJ_CALIBRATION_SAMPLES: fit.n,
    // Recorded so a saved calibration says how much it had to be shrunk to
    // hold up — the coefficients alone can't tell you that afterwards.
    PROJ_CALIBRATION_ALPHA: fit.alpha,
  };

  try {
    await saveSettingValues(written);
  } catch (err) {
    setCalibrationStatus(`Failed to save calibration: ${err.message}`);
    btn.disabled = false;
    return;
  }

  // saveSettingValues re-reads the whole Settings tab back into
  // currentSettings, so this checks what the sheet NOW HOLDS rather than
  // re-inspecting what we just tried to write. A partial write is the one
  // failure that would otherwise pass silently: the formula needs all four
  // core gains present, so a single missing row means every consumer quietly
  // falls back to the generic formula while the modal reports success.
  const unverified = unverifiedCalibrationKeys(written);
  const engaged = readSavedCalibratedGains() !== null;
  if (unverified.length > 0 || !engaged) {
    refreshFormulaToggle();

    // EVERY key coming back missing means the read-back itself returned
    // nothing, not that eight separate writes each silently no-op'd — the
    // writes are awaited above and throw on any API error, so they reached the
    // sheet. Saying "couldn't confirm" without that distinction previously led
    // to a Reset to Default that deleted a calibration which was safely
    // written, so this case explicitly warns against exactly that.
    const readBackEmpty = unverified.length === Object.keys(written).length - 1;
    setCalibrationStatus(readBackEmpty
      ? 'The calibration was written to the sheet, but reading the Settings tab back returned nothing, so it can\'t be confirmed here. Do NOT use "Reset to Default" — that would delete a fit that is probably saved. Reload the page and reopen this dialog to check, and see the browser console for the underlying Sheets error.'
      : `Wrote the calibration, but couldn't confirm ${unverified.join(', ')} on the Settings tab — the forecast is still using the generic formula. Check those rows on that tab before re-running Calibrate.`);
    btn.disabled = false;
    return;
  }

  // Saved AND verified. Everything below is display refresh only, so it's
  // wrapped separately: a rendering failure must never be reported as a failed
  // save. Conflating the two is what previously told a user their calibration
  // hadn't saved when it had — and sent them to "Reset to Default", deleting a
  // fit that was already safely on the sheet.
  useCalibratedFormula = true;
  try {
    refreshFormulaToggle();
    applySettingsToWidgets();
    // Whole section, not just the projection chart: a new energy density also
    // moves the calculated calorie target, and with it the Caloric Intake
    // target line and the Calories Today tile.
    renderWellnessCharts(getDatedWellnessEntries());
  } catch (err) {
    console.error('Calibration saved and verified, but refreshing the display failed:', err);
  }

  // Modal deliberately stays open on success — the whole point of verifying is
  // to be able to say so, which a modal that closes itself can't do. Save is
  // left disabled since this fit is now written, and Cancel becomes Close.
  setCalibrationStatus(`✅ Saved and verified — all ${Object.keys(written).length} values were written to the Settings tab and read back. The forecast is now using your calibrated formula (${fit.n} windows, R² ${fit.r2.toFixed(2)}).`, true);
  document.getElementById('calibration-cancel-btn').textContent = 'Close';
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
    // No saved fit left, so the toggle has nothing to compare and disables
    // itself — reset first so the re-render below already reads the new state.
    useCalibratedFormula = true;
    refreshFormulaToggle();
    renderWellnessCharts(getDatedWellnessEntries());
    closeCalibrationModal();
  }, 'Failed to reset calibration');
}
