// Calibrate flow: fits calcProjection()'s energy-balance formula (charts.js) to
// the user's own Weight/Calories/Activity history by weighted least squares and
// saves the gains to the Settings tab. User-triggered only.
//
// It estimates an ENERGY model and nothing else — kcal per kg (1/betaCal), what
// a logged active kcal costs on the scale (betaAct), and the drift those two
// don't explain (beta0). Sleep and protein are logged, charted and targeted
// elsewhere in the app, but they are not terms in an energy balance and are not
// in the Mifflin-St Jeor BMR the calorie bound is built on, so they are not
// fitted here. See fitWeightedOLS for the rest of that reasoning.

const PROJ_CALIBRATION_MIN_SAMPLES = 6;
const PROJ_CALIBRATION_MIN_CALORIE_COVERAGE = 0.5;
const PROJ_CALIBRATION_MAX_INTERVAL_WEIGHT_DAYS = 60;
// How much the intake averages must vary across samples before the fit has
// anything to work with. Two figures, because the two builders produce averages
// with genuinely different spreads: smoothing removes the day-to-day noise and
// leaves only real multi-week variation, so the same person's smoothed samples
// vary less than their interval samples do. Measured over 60 synthetic
// histories at four levels of intake variability, the smoothed spread ran
// 58-85% of the interval spread (at the tightest: 75 kcal vs 129), so a single
// 100 kcal gate would reject smoothed data that has ample signal in it.
const PROJ_CALIBRATION_MIN_CALORIE_STD_DEV = 100;
const PROJ_SMOOTHED_MIN_CALORIE_STD_DEV = 60;
// Blocking bounds: only reject an energy density this extreme, since it's
// almost certainly a numerical artifact (near-singular fit) rather than a
// real physiological signal.
const PROJ_CALIBRATION_MIN_KCAL_PER_KG = 1500;
const PROJ_CALIBRATION_MAX_KCAL_PER_KG = 20000;
// Warn-only band. Short weigh-in windows are dominated by water/glycogen, which
// can pull the fitted density well below 7,700 without the fit being wrong.
const PROJ_CALIBRATION_TYPICAL_MIN_KCAL_PER_KG = 5000;
const PROJ_CALIBRATION_TYPICAL_MAX_KCAL_PER_KG = 9500;
const PROJ_CALIBRATION_MIN_R2 = 0.15;

const PROJ_SETTING_KEYS = [
  'PROJ_BASELINE_KG_PER_DAY',
  'PROJ_CAL_KG_PER_KCAL_DAY',
  'PROJ_ACTIVITY_KG_PER_KCAL_DAY',
  // Everything below is RETIRED — never written any more, and nothing reads it.
  // Listed only so Reset still clears rows left on a sheet from when they were
  // written, the same reason PROJ_ACTIVITY_KG_PER_MIN_DAY is here. The sleep and
  // protein coefficients went when the model became a pure energy model; the
  // rest were informational, and fit quality now lives in the modal that
  // computes it rather than on the Settings tab.
  'PROJ_SLEEP_KG_PER_HOUR_DAY',
  'PROJ_PROTEIN_KG_PER_G_DAY',
  'PROJ_CALIBRATION_R2',
  'PROJ_CALIBRATION_SAMPLES',
  'PROJ_CALIBRATED_AT',
  'PROJ_CALIBRATION_METHOD',
  // Superseded by PROJ_ACTIVITY_KG_PER_KCAL_DAY (see charts.js's
  // getCalibratedGains) — kept here only so Reset still cleans up a
  // leftover row from before this rename, on anyone who calibrated earlier.
  'PROJ_ACTIVITY_KG_PER_MIN_DAY',
];

let calibrationListenersAttached = false;
let lastCalibrationFit = null; // the SELECTED method's fit once it passes, else null
let lastCalibrationRun = null; // { interval, smoothed } — both methods, from the last Run click

function initCalibrationPanel() {
  if (calibrationListenersAttached) return;
  calibrationListenersAttached = true;

  initFormulaToggle();
  document.getElementById('calibrate-projection-btn').addEventListener('click', openCalibrationModal);
  document.getElementById('calibration-cancel-btn').addEventListener('click', closeCalibrationModal);
  document.getElementById('calibration-run-btn').addEventListener('click', runCalibration);
  // Switching method after a run re-picks from results already computed rather
  // than refitting — both fits are produced by every Run, so the comparison
  // table stays put and only the "saving this" marker and Save state move.
  document.getElementById('calibration-method').addEventListener('change', () => {
    if (lastCalibrationRun) renderCalibrationComparison();
  });
  document.getElementById('calibration-save-btn').addEventListener('click', saveCalibratedGains);
  document.getElementById('calibration-reset-btn').addEventListener('click', resetCalibration);
}

// Calibrated/generic view switch. Display-only: flips the flag
// getCalibratedGains() reads, writes nothing, and resets on reload.
function initFormulaToggle() {
  const btn = document.getElementById('formula-toggle-btn');

  btn.addEventListener('click', () => {
    useCalibratedFormula = !useCalibratedFormula;
    refreshFormulaToggle();

    // Same data, different formula — re-render without re-fetching.
    renderWellnessCharts(getDatedWellnessEntries());
    renderInsightDataPreview(getInsightDateRange());
  });

  refreshFormulaToggle();
}

// Label reports the active view; the no-saved-fit state gets its own label so a
// disabled button doesn't read identically to the enabled generic one.
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
  lastCalibrationRun = null;
  document.getElementById('calibration-save-btn').disabled = true;
  clearCalibrationStatus();

  // The saved fit, not the active view — this modal is about what's on file,
  // so a user comparing against the generic formula must still see (and be
  // able to reset) the calibration they actually have.
  const gains = readSavedCalibratedGains();
  const summary = document.getElementById('calibration-summary');
  summary.innerHTML = gains
    ? savedCalibrationHtml(gains)
    : '<p>Not calibrated yet — the forecast is using the generic formula (7,700 kcal/kg, 5 kcal per active minute, and a 0.7–1.0 sleep multiplier) for everyone.</p>';

  document.getElementById('calibration-modal').hidden = false;
}

// What is actually ON THE SHEET, in the same units the comparison table uses so
// the two can be read against each other. This used to say only "Currently
// calibrated (N samples, R² x)", which named the fit's quality but never the
// coefficients driving the forecast — so a saved fit could be steering every
// chart with a wrong-signed or implausible constant and the one dialog devoted
// to it would show no sign of that.
function savedCalibrationHtml(gains) {
  const density = gains.betaCal > 0 ? Math.round(1 / gains.betaCal) : null;
  const activity = gains.betaAct < 0 ? Math.round(-1 / gains.betaAct) : null;

  const problems = [];
  if (density === null) {
    problems.push('the calorie coefficient is backwards — this fit says eating more speeds up weight loss');
  } else if (density < PROJ_CALIBRATION_TYPICAL_MIN_KCAL_PER_KG || density > PROJ_CALIBRATION_TYPICAL_MAX_KCAL_PER_KG) {
    problems.push(`a ${density.toLocaleString()} kcal/kg scale response is outside the usual ${PROJ_CALIBRATION_TYPICAL_MIN_KCAL_PER_KG.toLocaleString()}–${PROJ_CALIBRATION_TYPICAL_MAX_KCAL_PER_KG.toLocaleString()} range`);
  }
  if (gains.betaAct > 0) {
    // Worth spelling out in grams: as a raw coefficient this reads as a small
    // number, and the size of what it claims is invisible.
    const perTypicalSession = (gains.betaAct * 300 * 1000).toFixed(0);
    problems.push(`the activity coefficient is backwards — this fit says a 300 kcal workout ADDS ${perTypicalSession} g/day`);
  }

  const warn = problems.length
    ? `<p class="hint" style="color:var(--color-danger,#dc2626)"><strong>This saved fit looks wrong:</strong> ${problems.join('; ')}. It is driving your forecast now. Run Calibration below to refit, or reset to the generic formula.</p>`
    : '';

  return `<p>Currently calibrated — these are the constants on your Settings tab, driving the forecast right now. Run Calibration to see how well they fit your latest history:</p>
  <table class="calibration-summary-table">
    <tr><td>Energy density <span class="hint">(scale response)</span></td><td>${density !== null ? `~${density.toLocaleString()} kcal/kg <span class="hint">(generic: 7,700)</span>` : `betaCal ${gains.betaCal.toExponential(3)} — wrong sign`}</td></tr>
    <tr><td>Activity cost</td><td>${activity !== null ? `~${activity.toLocaleString()} kcal/kg` : `${(gains.betaAct * 1000).toFixed(2)} g/day per kcal burned — wrong sign`}</td></tr>
    <tr><td>Baseline drift</td><td>${(gains.beta0 * 1000).toFixed(0)} g/day unexplained by logged intake or activity</td></tr>
  </table>
  ${warn}
  <p class="hint">Run Calibration to refit from your latest history and compare both sampling methods, or reset to the generic formula.</p>`;
}

function closeCalibrationModal() {
  document.getElementById('calibration-modal').hidden = true;
}

// Averages same-day Weight entries, pairs consecutive weigh-ins into intervals,
// and averages each interval's habits with charts.js's avg() — training and
// projection must agree on what "average calories" means.
function buildCalibrationSamples(entries) {
  const weightSums = new Map();
  const caloriesByDate = new Map();
  const activityKcalByDate = new Map();

  entries.forEach((e) => {
    if (e.amount === null) return;
    if (e.category === 'Weight') {
      const cur = weightSums.get(e.date) || { sum: 0, count: 0 };
      cur.sum += e.amount;
      cur.count += 1;
      weightSums.set(e.date, cur);
    } else if (e.category === 'Calories' || e.category === 'Calories; Protein') {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
      // Real Calculate-derived kcal (amount2) when this entry has one —
      // otherwise the flat per-minute estimate calcProjection()'s
      // un-calibrated formula also uses, so an older entry without a kcal
      // figure still contributes something to the fit rather than nothing.
      const mins = toActivityMinutes(e.amount, e.unit);
      const kcal = e.amount2 !== null ? e.amount2 : mins * GENERIC_KCAL_PER_ACTIVE_MIN;
      activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
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

    const actSlice = sliceByRange(activityKcalByDate, dateA, dateB);

    samples.push({
      days,
      ratePerDay: (weightByDate.get(dateB) - weightByDate.get(dateA)) / days,
      avgCalories: avg(calSlice),
      avgActivityKcal: actSlice.size > 0 ? avg(actSlice) : 0,
    });
  }

  return { samples, excludedCount };
}

// ---------------------------------------------------------------------------
// Smoothed sampling
//
// The interval builder above trains on RAW daily numbers, and the response it
// forms — (W_B − W_A) / days between two consecutive weigh-ins — is mostly
// noise. Over a 3-day gap a normal ±0.4 kg of scale/water/glycogen variation is
// ~±0.19 kg/day against a real signal nearer 0.03 kg/day. Errors-in-variables
// attenuation then squashes betaCal toward zero, and since the modal reports
// density as 1/betaCal, a small betaCal prints as an absurd one. That is where
// the 34,986 kcal/kg figure behind 123171c and f345339 came from.
//
// So: smooth every series over the whole history, one sample per weigh-in.
// TWO RULES, both learned the hard way in e32604d, and neither is optional:
//
//   1. ONE SPAN, SHARED BY EVERY SERIES. That commit smoothed weight with
//      computeWeightTrend (which windows by logged POINTS, so its reach extends
//      ~6 days past the days the habit averages covered) and measured the
//      result landing in the plausible density band 0-5% of the time, median
//      ~30,000 kcal/kg. The two sides of the regression were describing
//      different days. The window here is one thing, defined once, and the
//      habit averages cover exactly the dates that window spans.
//
//   2. THE RATE COMES FROM A FITTED SLOPE, NEVER FROM DIFFERENCING A SMOOTHED
//      CURVE. Smoothing weight into a line and then differencing it reintroduces
//      exactly the noise the smoothing removed. localSlopeKgPerDay fits a line
//      through the weigh-ins in the window and takes its slope, which smooths
//      and differentiates in one step, uses every reading rather than two
//      endpoints, and needs no interpolation across gaps.
//
// The window is measured in LOGGED WEIGH-INS, not calendar days — the same
// smoother the Weight Trend line on the chart already uses (computeWeightTrend
// in charts.js, WEIGHT_TREND_WINDOW_SIZE points, centered). That choice is
// documented there and it matters more here than it does on the chart: a
// fixed-day window is a different amount of smoothing for different people. On
// 30 days of daily weigh-ins a 15-DAY window is half the entire history and
// leaves ~2 independent samples, so the fit gets refused for lack of data;
// the same history under a 5-POINT window leaves ~6. Windowing by points makes
// the smoothing adapt to how often someone actually steps on the scale, which
// is the whole reason charts.js does it that way.
//
// The habit averages then cover the exact date range those points span, which
// is what keeps rule 1 satisfied while the window itself is counted in points.
//
// Measured over 200 synthetic histories with a known 7,700 kcal/kg (±0.4 kg
// scale noise). "plausible" = fitted density in 5,000-9,500; "usable" also
// requires a positive out-of-sample R²; both out of 200:
//
//                     interval        window 5        window 7        window 9
//   30d daily      25 / 1 usable   43 / 0 usable    gate refuses    gate refuses
//   45d daily      34 / 5           75 / 13          94 / 17        gate refuses
//   90d daily      55 / 6          123 / 79         145 / 110       149 / 113
//   180d every 3d  121 / 75        174 / 168        183 / 172       183 / 174
//
// Wider windows are better wherever there is enough history to afford them, but
// they divide into fewer independent samples and get refused on a short one — a
// 7-point window can't calibrate 30 days of daily weigh-ins at all. 5 is the
// only size that works across the whole range, and it is the value the Weight
// Trend line already uses, so the curve the calibration trains on is the curve
// the chart draws.
//
// Those figures include the shrunken end windows. Requiring full windows and
// discarding the first and last `radius` weigh-ins scores slightly better where
// there is data to spare (90d daily: 132/96 rather than 123/79) and slightly
// worse at 180d, but on a 30-day history it means throwing away 4 of 30
// weigh-ins, so the ends are kept and downweighted instead.
//
// HOW WIDE THE SHORT-HISTORY SPREAD IS, because a median hides it and quoting
// one is actively misleading. Fitted density by percentile, 400 runs, daily
// weigh-ins, truth 7,700:
//
//              p10     p25   median     p75     p90    in band
//   30d      2,595   3,960    6,052  11,209  20,582   102/400
//   90d      5,252   6,316    7,634   9,823  13,320   248/400
//   180d     6,268   6,955    7,691   8,543   9,846   342/400
//
// At 30 days p10 to p90 spans EIGHTFOLD, so any single fit is close to
// arbitrary — a run returning 2,700 or 20,000 is an ordinary draw, not a bug to
// go hunting for. The spread is the number that matters here, not the middle of
// it. Roughly 90 days is where a fit becomes worth saving rather than worth
// looking at, and that is a limit of the data rather than of the smoother,
// which is why the out-of-sample score sits beside every fit in the modal.
const PROJ_SMOOTHING_WINDOW_POINTS = WEIGHT_TREND_WINDOW_SIZE;

// Outlier rejection on the weight series before anything is fitted, so one
// mistyped weigh-in (87 entered as 8.7, or a duplicate row) can't bend the
// local slope around it. Hampel: compare each reading to the median of its
// neighbours and reject at 3 robust sigmas. The kg floor matters as much as the
// sigma count — a very steady logger has a near-zero MAD, and without a floor
// every ordinary 0.4 kg water swing would read as an outlier.
const PROJ_HAMPEL_RADIUS_DAYS = 7;
const PROJ_HAMPEL_SIGMAS = 3;
const PROJ_HAMPEL_MIN_DEVIATION_KG = 1.5;

// A smoothed value is only emitted where the smoother had real data underneath
// it, so a sample is never an extrapolation dressed up as a measurement.
const PROJ_SMOOTHED_MIN_CALORIE_COVERAGE = 0.5; // of the days the window spans
// A window is N weigh-ins regardless of how far apart they are, so a sporadic
// logger's five points can reach across months — at which point the "local"
// slope is a chord over empty space, not a smoothed rate. Capped by the gap
// between consecutive points rather than the window's total width, since it's
// the emptiness that misleads, not the length.
const PROJ_SMOOTHED_MAX_WEIGHT_GAP_DAYS = 10;

const MS_PER_DAY = 86400000;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Drops readings too far from their local median. Returns a new Map; the input
// is left alone so the caller can still report how many were rejected.
function hampelFilterWeights(weightByDate) {
  const dates = [...weightByDate.keys()].sort();
  const ms = dates.map(parseIsoDateUTC);
  const kept = new Map();

  dates.forEach((date, i) => {
    const neighbours = dates
      .filter((_, j) => Math.abs(ms[j] - ms[i]) <= PROJ_HAMPEL_RADIUS_DAYS * MS_PER_DAY)
      .map((d) => weightByDate.get(d));
    // Nothing to compare against — a lone reading is kept rather than judged.
    if (neighbours.length < 3) {
      kept.set(date, weightByDate.get(date));
      return;
    }

    const med = median(neighbours);
    const mad = median(neighbours.map((v) => Math.abs(v - med)));
    const threshold = Math.max(PROJ_HAMPEL_SIGMAS * 1.4826 * mad, PROJ_HAMPEL_MIN_DEVIATION_KG);
    if (Math.abs(weightByDate.get(date) - med) <= threshold) kept.set(date, weightByDate.get(date));
  });

  return kept;
}

// Least-squares slope in kg/day through [{ dayOffset, kg }]. Null when every
// reading sits on the same day, which has no slope to speak of.
function localSlopeKgPerDay(points) {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.dayOffset, 0) / n;
  const meanY = points.reduce((s, p) => s + p.kg, 0) / n;

  let num = 0;
  let den = 0;
  points.forEach((p) => {
    num += (p.dayOffset - meanX) * (p.kg - meanY);
    den += (p.dayOffset - meanX) ** 2;
  });

  return den < 1e-9 ? null : num / den;
}

// Mean over the days in the span that HAVE a log — never over the calendar
// length. This is charts.js's avg() semantics, and it has to stay that way:
// calcProjection() feeds the fitted coefficients exactly this quantity, so a
// builder that averaged over all days instead would tune them against
// something the projection never sees. Returns { mean, coverage }.
function smoothedDailyMean(byDate, dates) {
  const present = dates.map((d) => byDate.get(d)).filter((v) => v !== undefined);
  return {
    mean: present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null,
    coverage: present.length / dates.length,
  };
}

// Every ISO date from `from` to `to` inclusive.
function datesBetween(from, to) {
  const out = [];
  for (let ms = parseIsoDateUTC(from); ms <= parseIsoDateUTC(to); ms += MS_PER_DAY) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

// One sample per logged weigh-in, centered on that weigh-in, exactly the way
// computeWeightTrend builds the Weight Trend line. Emits the same shape
// buildCalibrationSamples does — plus calorieCenter, since this builder centers
// each sample on the bound that applied over its own dates rather than on one
// present-day scalar (see the comment at the centering line below).
function buildSmoothedCalibrationSamples(entries, windowPoints = PROJ_SMOOTHING_WINDOW_POINTS) {
  const radius = Math.floor((windowPoints - 1) / 2);

  const weightSums = new Map();
  const caloriesByDate = new Map();
  const activityKcalByDate = new Map();

  entries.forEach((e) => {
    if (e.amount === null) return;
    if (e.category === 'Weight') {
      const cur = weightSums.get(e.date) || { sum: 0, count: 0 };
      cur.sum += e.amount;
      cur.count += 1;
      weightSums.set(e.date, cur);
    } else if (e.category === 'Calories' || e.category === 'Calories; Protein') {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
      const mins = toActivityMinutes(e.amount, e.unit);
      const kcal = e.amount2 !== null ? e.amount2 : mins * GENERIC_KCAL_PER_ACTIVE_MIN;
      activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
    }
  });

  const rawWeights = new Map([...weightSums].map(([date, { sum, count }]) => [date, sum / count]));
  const weightByDate = hampelFilterWeights(rawWeights);
  const outlierCount = rawWeights.size - weightByDate.size;

  const weighInDates = [...weightByDate.keys()].sort();
  if (weighInDates.length < 3) {
    return { samples: [], excludedCount: 0, outlierCount, weighInCount: weighInDates.length, windowPoints };
  }

  const allDates = datesBetween(weighInDates[0], weighInDates[weighInDates.length - 1]);

  // The bound for every calendar day, each from the weight in effect that day —
  // the same series the Caloric Intake chart draws its per-day caps from, so the
  // two can't disagree about what the bound was on any given date.
  const boundByDate = new Map();
  calorieBoundSeries(entries, allDates).forEach((b, i) => boundByDate.set(allDates[i], b.kcal));

  const weighInMs = weighInDates.map(parseIsoDateUTC);
  const samples = [];
  let excludedCount = 0;

  // Every weigh-in gets a sample, including the first and last few. The window
  // shrinks at the ends rather than the point being dropped — exactly what
  // computeWeightTrend does, and the reason matters here: on a short history
  // discarding `radius` weigh-ins from each end throws away a real fraction of
  // everything there is. An end window is thinner and its slope is noisier, but
  // that is what the `evidence` weight below is for, so a 3-point end window
  // counts for less than a full 5-point one instead of counting for nothing.
  for (let i = 0; i < weighInDates.length; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(weighInDates.length - 1, i + radius);
    // Two points define a line exactly, so their "slope" carries none of the
    // noise-cancelling the smoother exists for.
    if (to - from + 1 < 3) { excludedCount++; continue; }
    const points = [];
    for (let j = from; j <= to; j++) {
      points.push({ dayOffset: (weighInMs[j] - weighInMs[i]) / MS_PER_DAY, kg: weightByDate.get(weighInDates[j]) });
    }

    const maxGap = points.slice(1).reduce((m, p, k) => Math.max(m, p.dayOffset - points[k].dayOffset), 0);
    if (maxGap > PROJ_SMOOTHED_MAX_WEIGHT_GAP_DAYS) { excludedCount++; continue; }

    // The habit averages cover exactly the dates this window of weigh-ins
    // spans — that identity is rule 1, and it is the whole reason the earlier
    // attempt at smoothing failed.
    const windowDates = datesBetween(weighInDates[from], weighInDates[to]);

    const cal = smoothedDailyMean(caloriesByDate, windowDates);
    if (cal.mean === null || cal.coverage < PROJ_SMOOTHED_MIN_CALORIE_COVERAGE) { excludedCount++; continue; }

    const slope = localSlopeKgPerDay(points);
    if (slope === null) { excludedCount++; continue; }

    const act = smoothedDailyMean(activityKcalByDate, windowDates);
    const bound = smoothedDailyMean(boundByDate, windowDates);

    samples.push({
      // Kept only so a sample from either builder has the same shape;
      // fitWeightedOLS weights this builder's samples by `evidence` instead.
      days: windowDates.length,
      ratePerDay: slope,
      avgCalories: cal.mean,
      avgActivityKcal: act.mean ?? 0,
      // Centered on the bound that applied over THIS window's dates, not on one
      // scalar taken from today's weight. The bound is a function of weight, so
      // a single present-day figure applied backwards puts a TRENDING error
      // into the primary regressor — and that trend correlates with the trend
      // in the response, so unlike a constant offset it does not wash into
      // beta0, it biases betaCal. calorieBoundDetail() reaches the bound
      // through the previous calibration's density, but that enters only as
      // weeklyFatLossKg × K / 7, identical every day, so the dependence on the
      // old fit IS a constant and stays out of the slopes.
      calorieCenter: bound.mean,
      evidence: points.length * cal.coverage,
    });
  }

  return {
    samples,
    excludedCount,
    outlierCount,
    weighInCount: weighInDates.length,
    windowPoints,
  };
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

// Weighted least squares (weight = interval days, capped) of:
//   ratePerDay ≈ β0 + β1·(avgCalories−calorieTarget) + β2·avgActivityKcal
// Activity is in kcal, not minutes, so β2 shares β1's units. Centering on the
// calorie bound makes β0 the baseline drift logged intake and activity don't
// explain, rather than an extrapolation to eating nothing.
//
// Three terms, not five. This flow estimates an ENERGY model — 1/β1 is the
// user's kcal per kg, and it feeds the calorie bound, the forecast and the
// Calorie Deficit chart. Sleep hours and protein grams are not quantities in
// an energy balance, and are not in the Mifflin-St Jeor BMR the bound is built
// on, so they are not fitted. They were also the two weakest and most
// collinear predictors: 1a8c088 records a fit claiming that burning calories,
// sleeping more and eating more protein each ADD weight, with β0 absorbing the
// offset until the projection pinned itself to its own safety clamp. Removing
// them is why the remaining three are estimable without regularization.
// Both builders feed this. Two per-sample fields let them differ without
// forking the fit: calorieCenter (the smoothed builder centers each day on the
// bound that applied that day; the interval builder has no per-sample center
// and falls back to the one scalar), and evidence (the smoothed builder weights
// by how much real data sits under a day, since its samples are all one day
// wide and `days` no longer carries that information).
function fitWeightedOLS(samples, calorieTarget) {
  const X = samples.map((s) => [1, s.avgCalories - (s.calorieCenter ?? calorieTarget), s.avgActivityKcal]);
  const y = samples.map((s) => s.ratePerDay);
  const w = samples.map((s) => s.evidence ?? Math.min(s.days, PROJ_CALIBRATION_MAX_INTERVAL_WEIGHT_DAYS));

  const k = 3;
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
    const yHat = beta.reduce((sum, b, a) => sum + b * X[i][a], 0);
    ssRes += w[i] * (y[i] - yHat) ** 2;
    ssTot += w[i] * (y[i] - yMeanW) ** 2;
  });
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { status: 'ok', beta0: beta[0], betaCal: beta[1], betaAct: beta[2], r2, n: samples.length };
}

// Out-of-sample score. R² alone can't be compared between the two builders:
// smoothing the response strips out most of the variance in-sample R² was
// being charged for, so the smoothed fit's R² is higher whether or not it
// predicts better. This holds out contiguous stretches of TIME, refits, and
// scores the prediction on the held-out stretch — the number that actually says
// whether the model generalizes. Negative means it predicts a new stretch worse
// than just assuming the average rate.
//
// Contiguous blocks, never leave-one-out. Neighbouring samples are correlated
// (adjacent smoothed days share nearly all their input), so LOO would score a
// held-out sample against training data that already contains it. 1a8c088 is
// the cautionary tale: its ridge penalty was chosen by LOO and picked maximum
// shrinkage, which drove betaCal to zero and made the reported density a
// division artifact.
//
// `purge` drops training samples adjacent to the held-out block for the same
// reason — with a 5-point window, a sample one position outside the block still
// shares 4 of its 5 weigh-ins with one inside it. 0 for the interval builder,
// whose samples don't overlap.
const PROJ_CV_BLOCKS = 5;

function blockedCvR2(samples, calorieTarget, purge = 0) {
  if (samples.length < PROJ_CV_BLOCKS * 2) return null;

  const y = samples.map((s) => s.ratePerDay);
  const w = samples.map((s) => s.evidence ?? Math.min(s.days, PROJ_CALIBRATION_MAX_INTERVAL_WEIGHT_DAYS));
  const wSum = w.reduce((a, b) => a + b, 0);
  const yMeanW = w.reduce((sum, wi, i) => sum + wi * y[i], 0) / wSum;

  let ssRes = 0;
  let ssTot = 0;
  let scored = 0;

  for (let b = 0; b < PROJ_CV_BLOCKS; b++) {
    const from = Math.floor((b * samples.length) / PROJ_CV_BLOCKS);
    const to = Math.floor(((b + 1) * samples.length) / PROJ_CV_BLOCKS);
    const train = samples.filter((_, i) => i < from - purge || i >= to + purge);
    if (train.length < 4) continue;

    const fit = fitWeightedOLS(train, calorieTarget);
    if (fit.status !== 'ok') continue;

    for (let i = from; i < to; i++) {
      const s = samples[i];
      const yHat = fit.beta0
        + fit.betaCal * (s.avgCalories - (s.calorieCenter ?? calorieTarget))
        + fit.betaAct * s.avgActivityKcal;
      ssRes += w[i] * (y[i] - yHat) ** 2;
      ssTot += w[i] * (y[i] - yMeanW) ** 2;
      scored++;
    }
  }

  return scored > 0 && ssTot > 0 ? 1 - ssRes / ssTot : null;
}

// How much INDEPENDENT evidence a smoothed fit rests on. Consecutive samples
// share all but one of their weigh-ins, so they are not separate observations:
// 30 weigh-ins under a 5-point window is ~6 independent samples, not 26.
// Counting the raw samples would present overlap as evidence. The interval
// builder's samples don't overlap, so there its own count is the honest figure.
function effectiveSampleCount(built) {
  if (!built.weighInCount) return built.samples.length;
  return Math.max(1, Math.round(built.weighInCount / built.windowPoints));
}

// Guardrails independent of the fit-time solver succeeding — a technically
// "solvable" system can still be statistically meaningless (near-zero
// calorie variance) or physiologically nonsensical (wrong-signed or
// wildly-scaled energy density).
function validateCalibration(fit, samples, { smoothed = false, cvR2 = null } = {}) {
  const blocking = [];
  const warnings = [];

  const calorieValues = samples.map((s) => s.avgCalories);
  const calorieMean = calorieValues.reduce((a, b) => a + b, 0) / calorieValues.length;
  const calorieStdDev = Math.sqrt(calorieValues.reduce((s, v) => s + (v - calorieMean) ** 2, 0) / calorieValues.length);
  const minStdDev = smoothed ? PROJ_SMOOTHED_MIN_CALORIE_STD_DEV : PROJ_CALIBRATION_MIN_CALORIE_STD_DEV;
  if (calorieStdDev < minStdDev) {
    blocking.push(`Your logged calorie intake barely varies across samples (±${calorieStdDev.toFixed(0)} kcal) — not enough signal to calibrate reliably yet.`);
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

  // A soft warning rather than blocking (unlike betaCal above) — activity is
  // the secondary predictor here, so one noisy fit shouldn't throw away an
  // otherwise-usable calibration the way a backwards calorie coefficient does.
  if (fit.betaAct > 0) {
    warnings.push("The fit implies burning more calories through activity slows weight loss, which is not physiologically plausible — the activity term is likely just noise; the rest of the calibration is still usable.");
  }

  // Out-of-sample first when it's available. In-sample R² is not comparable
  // between the two builders — smoothing the response inflates it whether or
  // not the model predicts any better — so where a held-out score exists it is
  // the one that decides, and a score at or below zero is the honest signal
  // that the habit terms beat nothing at all.
  if (cvR2 !== null) {
    if (cvR2 <= 0) {
      warnings.push(`This fit predicts a held-out stretch of your history no better than simply assuming your average rate (out-of-sample R² ${cvR2.toFixed(2)}). The numbers below are still your data, but the calibrated forecast is unlikely to beat the generic one yet.`);
    }
  } else if (fit.r2 < PROJ_CALIBRATION_MIN_R2) {
    warnings.push(`Low-confidence fit (R² ${fit.r2.toFixed(2)}) — your logged habits don't explain much of your weight trend yet. Save anyway, or log more consistently first for a better calibration.`);
  }

  return { blocking, warnings };
}

// Runs one builder end to end. Never throws on bad data — a method that can't
// produce a fit returns { failure } so the comparison can still show the other
// one beside it rather than the whole dialog collapsing to a single error.
function runOneMethod(method, entries, calorieTarget) {
  const smoothed = method === 'smoothed';
  const built = smoothed ? buildSmoothedCalibrationSamples(entries) : buildCalibrationSamples(entries);
  const { samples } = built;

  const effectiveN = effectiveSampleCount(built);
  if (effectiveN < PROJ_CALIBRATION_MIN_SAMPLES) {
    return {
      method,
      failure: smoothed
        ? `Your ${built.weighInCount || 0} weigh-in(s) smooth into ~${effectiveN} independent sample(s), and ${PROJ_CALIBRATION_MIN_SAMPLES} are needed. Every ${built.windowPoints} consecutive weigh-ins make one, so about ${PROJ_CALIBRATION_MIN_SAMPLES * built.windowPoints} weigh-ins (with calorie logs on at least half the days they cover) gets there.`
        : `Only ${samples.length} usable weigh-in interval(s) found (need at least ${PROJ_CALIBRATION_MIN_SAMPLES}, each with calorie logs covering at least half the interval).`,
    };
  }

  const fit = fitWeightedOLS(samples, calorieTarget);
  if (fit.status !== 'ok') {
    return { method, failure: 'Could not fit a stable model from this history — try logging more varied calorie intake alongside your weigh-ins.' };
  }

  // Purge only for the smoothed builder; its samples overlap, the interval
  // builder's don't.
  const cvR2 = blockedCvR2(samples, calorieTarget, smoothed ? built.windowPoints : 0);
  const validation = validateCalibration(fit, samples, { smoothed, cvR2 });

  return { method, built, fit, cvR2, effectiveN, validation };
}

function methodColumnHtml(result) {
  // Spans all six measure columns — a method that couldn't fit has no numbers
  // to line up under them, and an empty row reads as a zero rather than a
  // "not enough data".
  if (result.failure) return `<td colspan="6" class="hint">${result.failure}</td>`;

  const { fit, cvR2, effectiveN, built } = result;
  const density = fit.betaCal > 0 ? `~${Math.round(1 / fit.betaCal).toLocaleString()}` : 'n/a';
  // Same units as betaCal, so its implied density is directly comparable —
  // similar values mean the model is internally consistent.
  const activity = fit.betaAct < 0
    ? `~${Math.round(-1 / fit.betaAct).toLocaleString()} kcal/kg`
    : `${(fit.betaAct * 1000).toFixed(2)} g/day per kcal (wrong sign)`;
  const excluded = built.excludedCount ? ` <span class="hint">(${built.excludedCount} skipped)</span>` : '';
  const outliers = built.outlierCount ? ` <span class="hint">(${built.outlierCount} outlier weigh-in${built.outlierCount > 1 ? 's' : ''} dropped)</span>` : '';
  // Both numbers, with the count of samples actually fitted first — every one
  // of them goes into the regression. The independent figure beside it is what
  // the R² and the minimum-data gate are judged on, because consecutive
  // smoothed samples share all but one of their weigh-ins.
  const counts = built.weighInCount
    ? `${fit.n} <span class="hint">(~${effectiveN} independent)</span>`
    : `${fit.n}`;

  return `<td>${density} kcal/kg</td>
    <td>${activity}</td>
    <td>${(fit.beta0 * 1000).toFixed(0)} g/day</td>
    <td>${cvR2 === null ? 'n/a' : cvR2.toFixed(2)}</td>
    <td>${fit.r2.toFixed(2)}</td>
    <td>${counts}${excluded}${outliers}</td>`;
}

function selectedCalibrationMethod() {
  return document.querySelector('input[name="calibration-method"]:checked').value;
}

function runCalibration() {
  // The bound's kcal figure is the intake level the fit centers on — its
  // max/min direction is a labelling matter and has no place in the regression.
  // The smoothed builder overrides this per sample with the bound that applied
  // on that day; for the interval builder it is the only center there is.
  const entries = getDatedWellnessEntries();
  const calorieTarget = getCalorieBoundKcal(entries);

  clearCalibrationStatus();
  lastCalibrationFit = null;
  document.getElementById('calibration-save-btn').disabled = true;

  lastCalibrationRun = {
    interval: runOneMethod('interval', entries, calorieTarget),
    smoothed: runOneMethod('smoothed', entries, calorieTarget),
  };

  renderCalibrationComparison();
}

// Both fits side by side, every time. Nothing is written until Save, so seeing
// the method you did NOT pick is free — and it is the only way to tell whether
// switching would actually change anything.
function renderCalibrationComparison() {
  const run = lastCalibrationRun;
  if (!run) return;

  const chosen = selectedCalibrationMethod();
  const row = (key, label, note) => {
    const r = run[key];
    const mark = key === chosen ? ' ← saving this' : '';
    return `<tr class="${key === chosen ? 'calibration-row-selected' : ''}">
      <th scope="row">${label}${mark}<br><span class="hint">${note}</span></th>
      ${methodColumnHtml(r)}
    </tr>`;
  };

  document.getElementById('calibration-summary').innerHTML = `<table class="calibration-summary-table calibration-compare-table">
    <thead><tr>
      <th></th><th>Energy density<br><span class="hint">generic: 7,700</span></th>
      <th>Activity cost<br><span class="hint">compare to density</span></th>
      <th>Baseline drift</th>
      <th>Predicts held-out<br><span class="hint">R², out-of-sample</span></th>
      <th>Fit quality<br><span class="hint">R², in-sample</span></th>
      <th>Samples fitted<br><span class="hint">all of them are used</span></th>
    </tr></thead>
    <tbody>
      ${row('interval', 'Weigh-in intervals', 'raw daily logs, one sample per weigh-in pair')}
      ${row('smoothed', 'Smoothed', `${PROJ_SMOOTHING_WINDOW_POINTS}-weigh-in centered window, the same smoother as the Weight Trend line`)}
    </tbody>
  </table>
  <p class="hint">Out-of-sample R² is the one to trust when comparing the two: in-sample R² is inflated by smoothing whether or not the model predicts better. Zero or below means the fit beats nothing.</p>`;

  applyCalibrationSelection();
}

// Enables Save, or explains why it can't be, for whichever method is selected.
function applyCalibrationSelection() {
  const result = lastCalibrationRun?.[selectedCalibrationMethod()];
  const saveBtn = document.getElementById('calibration-save-btn');
  clearCalibrationStatus();
  lastCalibrationFit = null;
  saveBtn.disabled = true;

  if (!result) return;
  if (result.failure) {
    showFieldError('calibration-status', `❌ Could not calibrate with this method: ${result.failure}`);
    return;
  }
  if (result.validation.blocking.length > 0) {
    showFieldError('calibration-status', `❌ Could not calibrate: ${result.validation.blocking.join(' ')}`);
    return;
  }
  if (result.validation.warnings.length > 0) {
    // Shares the red .status element with real failures, so the text itself has
    // to say the calibration succeeded rather than relying on colour.
    showFieldError('calibration-status', `⚠️ Calibrated successfully — Save below is still enabled. Heads up: ${result.validation.warnings.join(' ')}`);
  }

  lastCalibrationFit = { ...result.fit, method: result.method, effectiveN: result.effectiveN, cvR2: result.cvR2 };
  saveBtn.disabled = false;
}

// Which just-written keys are missing or changed on the sheet. Every value the
// save writes is a number now, so all of them can be checked — there is no
// longer a date or a method name to exempt from the comparison.
function unverifiedCalibrationKeys(written) {
  return Object.entries(written)
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
  // Exactly the three constants readSavedCalibratedGains() reads back, and
  // nothing else. The Settings tab holds values the app USES; a run date, a
  // sample count, an R², a method name and two permanently-zero coefficients
  // were all written here at various points and none of them were ever read by
  // anything — they only made a hand-edited tab harder to understand. Fit
  // quality now lives in the modal that computed it, which is the only place it
  // was ever displayed anyway. All of the retired keys stay in
  // PROJ_SETTING_KEYS so Reset still clears rows left on an older sheet.
  const written = {
    PROJ_BASELINE_KG_PER_DAY: fit.beta0,
    PROJ_CAL_KG_PER_KCAL_DAY: fit.betaCal,
    PROJ_ACTIVITY_KG_PER_KCAL_DAY: fit.betaAct,
  };

  try {
    await saveSettingValues(written);
  } catch (err) {
    setCalibrationStatus(`Failed to save calibration: ${err.message}`);
    btn.disabled = false;
    return;
  }

  // Checks what the sheet now holds, not what we tried to write. A partial
  // write is the one failure that would otherwise pass silently — all four core
  // gains must be present or every consumer falls back to the generic formula.
  const unverified = unverifiedCalibrationKeys(written);
  const engaged = readSavedCalibratedGains() !== null;
  if (unverified.length > 0 || !engaged) {
    refreshFormulaToggle();

    // Every key missing means the read-back returned nothing, not that the
    // writes failed — they're awaited and throw. Warn against Reset here, which
    // would delete a calibration that is probably saved.
    const readBackEmpty = unverified.length === Object.keys(written).length;
    setCalibrationStatus(readBackEmpty
      ? 'The calibration was written to the sheet, but reading the Settings tab back returned nothing, so it can\'t be confirmed here. Do NOT use "Reset to Default" — that would delete a fit that is probably saved. Reload the page and reopen this dialog to check, and see the browser console for the underlying Sheets error.'
      : `Wrote the calibration, but couldn't confirm ${unverified.join(', ')} on the Settings tab — the forecast is still using the generic formula. Check those rows on that tab before re-running Calibrate.`);
    btn.disabled = false;
    return;
  }

  // Saved and verified; below is display refresh only. Wrapped separately so a
  // rendering failure is never reported as a failed save.
  useCalibratedFormula = true;
  try {
    refreshFormulaToggle();
    applySettingsToWidgets();
    // Whole section, not just the projection chart: a new energy density also
    // moves the calculated calorie bound, and with it the Caloric Intake
    // bound line and the Calories tile.
    renderWellnessCharts(getDatedWellnessEntries());
  } catch (err) {
    console.error('Calibration saved and verified, but refreshing the display failed:', err);
  }

  // Modal deliberately stays open on success — the whole point of verifying is
  // to be able to say so, which a modal that closes itself can't do. Save is
  // left disabled since this fit is now written, and Cancel becomes Close.
  // The fit's quality figures are reported here and in the table above, not
  // saved — they describe this run, and the Settings tab holds only what the
  // app reads back.
  const cvNote = fit.cvR2 === null ? '' : `, out-of-sample R² ${fit.cvR2.toFixed(2)}`;
  const methodLabel = fit.method === 'smoothed' ? 'smoothed' : 'weigh-in interval';
  setCalibrationStatus(`✅ Saved and verified — all ${Object.keys(written).length} coefficients were written to the Settings tab and read back. The forecast is now using your calibrated formula (${methodLabel} sampling, ~${fit.effectiveN} independent samples${cvNote}).`, true);
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
