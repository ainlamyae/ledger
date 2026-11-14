
// Flat fallbacks until the Setting tab holds a value.
const BODY_MASS_HEALTHY_KG_DEFAULT = 70;
const CALORIE_DESIRED_KCAL_DEFAULT = 2000;
const SLEEP_DESIRED_HOURS_DEFAULT = 8;
const FIBER_DESIRED_G_DEFAULT = 30;
// USDA %DV for total fat (2,000 kcal diet), until Tune saves a FAT_DESIRED_G_MIN/MAX band.
const FAT_DESIRED_G_DEFAULT = 65;
const ACTIVITY_DESIRED_MIN_DEFAULT = 100;
const PROTEIN_DESIRED_G_DEFAULT = 100;

// Protein per kg of LEAN mass, Tune's opening band. Morton 2018 (~1.6, upper CI 2.2 g/kg
// total mass) restated against fat-free mass, as Helms 2014 recommends.
const PROTEIN_G_PER_KG_LBM_MIN_DEFAULT = 1.8;
const PROTEIN_G_PER_KG_LBM_MAX_DEFAULT = 2.2;

// Fiber band: floor above the USDA's 14 g/1000 kcal; ceiling scales with body mass.
const FIBER_G_PER_1000_KCAL_MIN_DEFAULT = 17;
const FIBER_G_PER_KG_MAX_DEFAULT = 0.5;

// Fat band: the IOM AMDR (2005), 20-35% of Eᵢₙ.
const FAT_PCT_OF_KCAL_MIN_DEFAULT = 20;
const FAT_PCT_OF_KCAL_MAX_DEFAULT = 35;

// Carb band: 30-50% of Eᵢₙ, below the AMDR's 45-65% to leave room for protein on a deficit.
const CARB_PCT_OF_KCAL_MIN_DEFAULT = 30;
const CARB_PCT_OF_KCAL_MAX_DEFAULT = 50;
// USDA %DV for total carbohydrate, until Tune saves a CARB_DESIRED_G_MIN/MAX band.
const CARB_DESIRED_G_DEFAULT = 275;

// Atwater energy densities — physical constants, not settings.
const KCAL_PER_G_FAT = 9;
const KCAL_PER_G_CARB = 4;

const MS_PER_DAY = 86400000;

// Walking MET when the Activity sheet has no Walk row. Duplicates
// health-activity-estimator.js's EXERCISE_MET_DEFAULT: that file loads after this one.
const ACTIVITY_MET_FALLBACK = 3;

// Tune's MET box during its preview — a what-if, never saved.
const ACTIVITY_MET_PREVIEW_KEY = 'ACTIVITY_MET_PREVIEW';

// The Walk row's MET (health-activity-catalogue.js), so no Setting can drift from it.
function activityMet() {
  const preview = currentSettings[ACTIVITY_MET_PREVIEW_KEY];
  if (Number.isFinite(preview)) return preview;
  const met = typeof activityByName === 'function' ? activityByName('Walk')?.met : null;
  return Number.isFinite(met) ? met : ACTIVITY_MET_FALLBACK;
}

// Energy density of body fat — a population constant.
const GENERIC_KCAL_PER_KG_FAT = 7700;

// Last resort when there's no body mass to evaluate the MET formula at.
const GENERIC_KCAL_PER_ACTIVE_MIN = 5;

// ACSM: κ mL O₂/kg/min per MET (Tune's κ, default 3) at 200 mL O₂ per kcal. Not the
// `MET × kg × hours` shorthand, which runs a flat 5% low.
const MET_ML_O2_PER_KG_MIN_DEFAULT = 3;
const ML_O2_PER_KCAL = 200;

function metMlO2PerKgMin() {
  return getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT);
}

function kcalPerMetKgMin() {
  return metMlO2PerKgMin() / ML_O2_PER_KCAL;
}

// The app's only MET→kcal conversion, so planned and measured burn can't disagree.
function metKcal(met, bodyMassKg, minutes) {
  return met * bodyMassKg * minutes * kcalPerMetKgMin();
}

function isBodyMassReading(e) {
  return e.category === 'Body Mass' && e.amount !== null;
}

function bodyMassReadingsAscending(entries) {
  return entries.filter(isBodyMassReading).sort((a, b) => a.date.localeCompare(b.date));
}

function latestBodyMassKg(entries) {
  const readings = bodyMassReadingsAscending(entries);
  return readings.length ? readings[readings.length - 1].amount : null;
}

// The calibration window: n_p periods of L_p days, ending yesterday.
const BMR_CALIBRATION_PERIOD_COUNT_KEY = 'BMR_CALIBRATION_PERIOD_COUNT';
const BMR_CALIBRATION_PERIOD_DAYS_KEY = 'BMR_CALIBRATION_PERIOD_DAYS';

// m̄'s window is the SAVED L_p, so one setting decides how much the scale is smoothed.
// Tune passes its typed (unsaved) L_p in itself.
function bodyMassSmoothingDays() {
  return getSetting(BMR_CALIBRATION_PERIOD_DAYS_KEY, BMR_CALIBRATION_PERIOD_DAYS_DEFAULT);
}

// Health Chart's average lines, over the same L_p days as Body Mass's trend.
function healthAvgName(suffix = '') {
  return `${bodyMassSmoothingDays()}-Day Average${suffix}`;
}

// One value per date: summed for things that accumulate across a day (sleep, activity,
// food), averaged for repeat looks at one quantity (two body-mass readings).
function dailyValues(entries, matches, valueOf, combine) {
  const raw = new Map();
  entries.forEach((e) => {
    if (!matches(e)) return;
    if (!raw.has(e.date)) raw.set(e.date, []);
    raw.get(e.date).push(valueOf(e));
  });
  const byDate = new Map();
  raw.forEach((values, date) => byDate.set(date, combine(values)));
  return byDate;
}

const sumDailyValues = (values) => values.reduce((a, b) => a + b, 0);
const meanDailyValues = (values) => sumDailyValues(values) / values.length;

// `byDate` trimmed to the `windowDays` ending YESTERDAY — today is still filling in.
function trailingToYesterday(byDate, windowDays) {
  const yesterdayMs = parseIsoDateUTC(isoFromDate(new Date())) - MS_PER_DAY;
  const windowStartMs = yesterdayMs - (windowDays - 1) * MS_PER_DAY;
  const trimmed = new Map();
  byDate.forEach((value, date) => {
    const ms = parseIsoDateUTC(date);
    if (ms >= windowStartMs && ms <= yesterdayMs) trimmed.set(date, value);
  });
  return trimmed;
}

// Every "logged average over L_p days" seed on the Tune sheet; null with nothing in the window.
function trailingAverage(byDate, windowDays) {
  const trimmed = trailingToYesterday(byDate, windowDays);
  return trimmed.size > 0 ? avg(trimmed) : null;
}

// m̄: a single reading swings with water and glycogen, so plan figures use the L_p-day mean,
// to 0.1 kg. The window ends at the newest reading before today (not yesterday), so a week
// off the scale doesn't empty it. Same-day readings count as one day.
function smoothedBodyMassKg(entries, windowDays = bodyMassSmoothingDays()) {
  const today = isoFromDate(new Date());
  const byDate = dailyValues(entries, (e) => isBodyMassReading(e) && e.date < today, (e) => e.amount, meanDailyValues);
  if (byDate.size === 0) return null;
  const windowStartMs = parseIsoDateUTC([...byDate.keys()].sort().at(-1)) - (windowDays - 1) * MS_PER_DAY;
  const inWindow = [...byDate].filter(([date]) => parseIsoDateUTC(date) >= windowStartMs).map(([, kg]) => kg);
  return Math.round(meanDailyValues(inWindow) * 10) / 10;
}

// The mass every PLAN figure uses. Per-day series use that day's own reading instead.
function planBodyMassKg(entries) {
  return smoothedBodyMassKg(entries);
}

// `1.6-2`, `1.6~2`, `1.6 – 2`, `1.6 to 2` all parse. A bare `1.6` is a zero-width band.
const G_PER_KG_BAND_SEPARATOR = /\s*(?:~|-|–|—|to)\s*/i;

// The single g/kg cell as {low, high} — null if absent or non-numeric.
function parseGPerKgRangeCell() {
  const raw = getSettingString('PROTEIN_DESIRED_G_PER_KG', null);
  if (raw === null) return null;

  const parts = String(raw).trim().split(G_PER_KG_BAND_SEPARATOR)
    .map(Number)
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (parts.length === 0) return null;

  return { low: parts[0], high: parts[parts.length - 1] };
}

// The g/kg band from the cell or the _MIN/_MAX rows (rows win per end). Sorted, so a
// backwards band still reads.
function getProteinGPerKgBand() {
  const cell = parseGPerKgRangeCell();
  const ends = [
    getSetting('PROTEIN_DESIRED_G_PER_KG_MIN', null) ?? cell?.low ?? null,
    getSetting('PROTEIN_DESIRED_G_PER_KG_MAX', null) ?? cell?.high ?? null,
  ].filter((n) => n !== null);

  if (ends.length === 0) return null;
  return { low: Math.min(...ends), high: Math.max(...ends) };
}

// The absolute `${key}_MIN/_MAX` gram band Tune writes. Either end optional; sorted, since
// ends computed on different bases (e.g. fiber's) can come out backwards.
function savedBandG(key) {
  const ends = [
    getSetting(`${key}_MIN`, null),
    getSetting(`${key}_MAX`, null),
  ].filter((n) => n !== null && n > 0);

  if (ends.length === 0) return null;
  return { min: Math.round(Math.min(...ends)), max: Math.round(Math.max(...ends)) };
}

// The flat `key` setting as a zero-width band.
function flatBandG(key, fallback) {
  const flat = getSetting(key, fallback);
  return { min: flat, max: flat };
}

// A zero-width band has no inside, so it keeps the at-or-over rule. Over the ceiling is
// its own "still a hit" tier, checked against band.max by the callers.
function withinDesiredBand(g, band) {
  return g >= band.min && (band.max === band.min || g <= band.max);
}

// Already p × LBM, so it must not go back through a basis mass.
function getProteinAbsoluteBandG() {
  return savedBandG('PROTEIN_DESIRED_G');
}

// Lean-mass grams first, then g/kg × HEALTHY mass (today's would shrink the band as you
// lose, when protein matters most; latest reading as fallback), then flat PROTEIN_DESIRED_G.
function getProteinDesiredBandG(entries) {
  const absolute = getProteinAbsoluteBandG();
  if (absolute !== null) return absolute;

  const band = getProteinGPerKgBand();
  const basisBodyMassKg = band !== null
    ? (getSetting('BODY_MASS_HEALTHY_KG', null) ?? latestBodyMassKg(entries))
    : null;

  if (basisBodyMassKg !== null) {
    return { min: Math.round(basisBodyMassKg * band.low), max: Math.round(basisBodyMassKg * band.high) };
  }

  return flatBandG('PROTEIN_DESIRED_G', PROTEIN_DESIRED_G_DEFAULT);
}

// "131" or "131~164", shared by the glance tile and the Insight prompt (which passes '-').
function formatProteinDesiredBand(band, separator = '~') {
  return band.max > band.min ? `${band.min}${separator}${band.max}` : `${band.min}`;
}

function withinProteinBand(g, band) {
  return withinDesiredBand(g, band);
}

function getFiberAbsoluteBandG() {
  return savedBandG('FIBER_DESIRED_G');
}

function getFiberDesiredBandG(entries) {
  return getFiberAbsoluteBandG() ?? flatBandG('FIBER_DESIRED_G', FIBER_DESIRED_G_DEFAULT);
}

function withinFiberBand(g, band) {
  return withinDesiredBand(g, band);
}

function getFatAbsoluteBandG() {
  return savedBandG('FAT_DESIRED_G');
}

function getFatDesiredBandG(entries) {
  return getFatAbsoluteBandG() ?? flatBandG('FAT_DESIRED_G', FAT_DESIRED_G_DEFAULT);
}

function withinFatBand(g, band) {
  return withinDesiredBand(g, band);
}

function getCarbAbsoluteBandG() {
  return savedBandG('CARB_DESIRED_G');
}

function getCarbDesiredBandG(entries) {
  return getCarbAbsoluteBandG() ?? flatBandG('CARB_DESIRED_G', CARB_DESIRED_G_DEFAULT);
}

function withinCarbBand(g, band) {
  return withinDesiredBand(g, band);
}

// Mifflin-St Jeor BMR (kcal/day). Maintenance is always BMR + an activity burn, never a
// lifestyle multiplier, so every deficit shares one baseline.
const MIFFLIN_KCAL_PER_KG = 10;
const MIFFLIN_KCAL_PER_CM = 6.25;
const MIFFLIN_KCAL_PER_YEAR = 5;

function mifflinSexKcal(sex) {
  return sex === 'male' ? 5 : -161;
}

function mifflinStJeorBmr(bodyMassKg, heightCm, age, sex) {
  return MIFFLIN_KCAL_PER_KG * bodyMassKg + MIFFLIN_KCAL_PER_CM * heightCm - MIFFLIN_KCAL_PER_YEAR * age + mifflinSexKcal(sex);
}

// Katch-McArdle (1996): fat is nearly inert, so BMR is predicted from lean mass alone —
// no age term. Only as good as the LBM behind it, hence the user's choice, not a default.
const KATCH_BASE_KCAL = 370;
const KATCH_KCAL_PER_KG_LBM = 21.6;

function katchMcArdleBmr(lbmKg) {
  return KATCH_BASE_KCAL + KATCH_KCAL_PER_KG_LBM * lbmKg;
}

// LBM to the 0.1 kg the boxes show, so the trace's `370 + 21.6 × LBM` multiplies out.
function bmrLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  return Math.round(leanBodyMassKg(bodyMassKg, heightCm, sex) * 10) / 10;
}

// Which equation the app runs on; unset reads as Mifflin.
const BMR_FORMULA_KEY = 'BMR_FORMULA';
const BMR_FORMULA_DEFAULT = 'mifflin';

function bmrFormula() {
  return getSettingString(BMR_FORMULA_KEY, BMR_FORMULA_DEFAULT) === 'katch' ? 'katch' : BMR_FORMULA_DEFAULT;
}

// Age is a Mifflin term only, so a Katch plan is complete without a birth date.
function bmrNeedsAge(formula = bmrFormula()) {
  return formula !== 'katch';
}

// The single BMR call, so a switched equation moves every figure together. `formula` is a
// parameter so Tune can preview an unsaved choice.
function bmrKcal(bodyMassKg, heightCm, age, sex, formula = bmrFormula()) {
  return formula === 'katch'
    ? katchMcArdleBmr(bmrLeanBodyMassKg(bodyMassKg, heightCm, sex))
    : mifflinStJeorBmr(bodyMassKg, heightCm, age, sex);
}

// The saved BMR profile; `complete` once BMR can be evaluated.
function bmrProfileFromSettings() {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const complete = heightCm !== null && (age !== null || !bmrNeedsAge()) && (sex === 'male' || sex === 'female');
  return { heightCm, age, sex, complete };
}

// Thermic effect of food. It's a share f of the very intake being solved for, so it
// divides rather than adds:  Eᵢₙ = BMR + Eₐ + f·Eᵢₙ − D  ⇒  Eᵢₙ = (BMR + Eₐ − D) / (1 − f).
const TEF_PERCENT_KEY = 'TEF_PERCENT_OF_INTAKE';
const TEF_PERCENT_DEFAULT = 13.5;

function tefPercent() {
  return getSetting(TEF_PERCENT_KEY, TEF_PERCENT_DEFAULT);
}

// (1 − f), with f held to 0–90%: at f = 1 the identity has no finite solution.
const TEF_PERCENT_MAX = 90;

function tefDivisor(percent = tefPercent()) {
  return 1 - Math.min(Math.max(percent, 0), TEF_PERCENT_MAX) / 100;
}

// f seeded from measured TEF: Σ TEF / Σ TEI over the window's days that have a measured
// TEF (each such day also has the TEI it was measured against).
function trailingTefPercent(entries, windowDays) {
  const hasMeasuredTef = (e) => e.category === 'Calories; Protein'
    && e.tefKcal !== null && e.tefKcal !== undefined && e.amount !== null;
  const tefByDate = dailyValues(entries, hasMeasuredTef, (e) => e.tefKcal, sumDailyValues);
  const teiByDate = dailyValues(entries, hasMeasuredTef, (e) => e.amount, sumDailyValues);

  const tefTrimmed = trailingToYesterday(tefByDate, windowDays);
  if (tefTrimmed.size === 0) return null;
  const tefSum = sumDailyValues([...tefTrimmed.values()]);
  const teiSum = sumDailyValues([...tefTrimmed.keys()].map((date) => teiByDate.get(date)));
  return teiSum > 0 ? (tefSum / teiSum) * 100 : null;
}

// Metabolic adaptation: BMR_adapt(t) = BMR × (1 − λt), λt growing weekly to a cap (~10–15%).
// Reported, not planned with — it's a consequence of the diet — except under the bmr_adp
// basis; adaptedPlateauKg gives the heavier plateau it implies.
const ADAPT_PCT_PER_WEEK_KEY = 'BMR_ADAPT_PCT_PER_WEEK';
const ADAPT_PCT_CAP_KEY = 'BMR_ADAPT_PCT_CAP';
const ADAPT_PCT_PER_WEEK_DEFAULT = 1;
const ADAPT_PCT_CAP_DEFAULT = 12;

// λt at day `days`, capped.
function adaptationFraction(days, pctPerWeek, pctCap) {
  const grown = (pctPerWeek / 100) * (days / 7);
  return Math.max(0, Math.min(grown, pctCap / 100));
}

// Days on the diet as of `atIsoDate` (today when null), counted from the first weigh-in;
// null with none. Tune's own BMR_adp instead asks how adapted you'll be BY arrival
// (health-tune-render.js).
function daysSinceFirstWeighIn(bodyMassEntries, atIsoDate = null) {
  if (!bodyMassEntries.length) return null;
  const firstDate = bodyMassEntries.map((e) => e.date).sort()[0];
  const atMs = parseIsoDateUTC(atIsoDate ?? isoFromDate(new Date()));
  return Math.max(0, Math.round((atMs - parseIsoDateUTC(firstDate)) / MS_PER_DAY));
}

// λt at the saved rates on `atIsoDate` (today when null); null with no weigh-in.
function adaptationFractionAt(atIsoDate = null) {
  const daysOnDiet = daysSinceFirstWeighIn(physiqueAsHealthEntries().filter(isBodyMassReading), atIsoDate);
  if (daysOnDiet === null) return null;
  const pctPerWeek = getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT);
  const pctCap = getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT);
  return adaptationFraction(daysOnDiet, pctPerWeek, pctCap);
}

// Which BMR the whole app runs deficits on (Tune fieldset); unset reads as plain 'bmr'.
const BMR_BASIS_KEY = 'BMR_BASIS';
const BMR_BASIS_DEFAULT = 'bmr';

function bmrBasis() {
  const raw = getSettingString(BMR_BASIS_KEY, BMR_BASIS_DEFAULT);
  return (raw === 'bmr_adp' || raw === 'bmr_cal' || raw === 'bmr_avg') ? raw : BMR_BASIS_DEFAULT;
}

// BMR_avg: the mean of a day's known equation/calibrated/adapted figures. The plan runs it
// as the active equation scaled by BMR_avg / equation (today at m̄, or Tune's preview), so
// the affine model keeps the equation's shape.
const BMR_AVG_RATIO_PREVIEW_KEY = 'BMR_AVG_RATIO_PREVIEW';
const BMR_AVERAGED_KEYS = ['BMR_mif', 'BMR_kat', 'BMR_cal', 'BMR_adp'];

function bmrAverageOf(figures) {
  const known = BMR_AVERAGED_KEYS.map((key) => figures?.[key]).filter(Number.isFinite);
  return known.length ? Math.round(meanDailyValues(known)) : null;
}

// 1 outside 'bmr_avg', or with nothing to measure it on.
function currentBmrAverageRatio() {
  if (bmrBasis() !== 'bmr_avg') return 1;
  const preview = currentSettings[BMR_AVG_RATIO_PREVIEW_KEY];
  if (Number.isFinite(preview)) return preview;
  // Today at m̄, not the last stored row: that can be a pre-logged future day.
  if (typeof todayBmrFigures !== 'function') return 1;
  const figures = todayBmrFigures();
  const avg = bmrAverageOf(figures);
  const equation = figures?.[BMR_EQUATION_KEYS[bmrFormula()]];
  return avg !== null && equation > 0 ? avg / equation : 1;
}

// The latest Physique day with a stored BMR_cal (health-physique.js keeps them current):
// the figure itself and its signed offset from that day's equation BMR. One measured point
// can't give a slope, so plan figures keep the equation's slope and shift by the offset.
function latestStoredCalibration() {
  if (typeof physiqueDatedAscending !== 'function') return null;
  const equationKey = BMR_EQUATION_KEYS[bmrFormula()];
  const days = physiqueDatedAscending();
  for (let i = days.length - 1; i >= 0; i--) {
    const figures = days[i].bmr;
    if (figures && Number.isFinite(figures.BMR_cal) && Number.isFinite(figures[equationKey])) {
      return { bmrCal: figures.BMR_cal, offsetKcal: figures.BMR_cal - figures[equationKey] };
    }
  }
  return null;
}

// For display; null until a calibration exists.
function calibratedBmrKcal() {
  return latestStoredCalibration()?.bmrCal ?? null;
}

// 0 outside 'bmr_cal' or before any calibration (the plain equation, not a refusal).
function currentCalibratedOffsetKcal() {
  if (bmrBasis() !== 'bmr_cal') return 0;
  return latestStoredCalibration()?.offsetKcal ?? 0;
}

// The choke point every raw bmrKcal() passes before a deficit or desired figure, so
// BMR_BASIS changes them all alike. bmr_adp discounts by λt on `atIsoDate` (today when null).
function applyBmrBasis(bmr, atIsoDate = null) {
  if (bmr === null) return bmr;
  const basis = bmrBasis();
  if (basis === 'bmr_avg') return bmr * currentBmrAverageRatio();
  if (basis === 'bmr_cal') return bmr + currentCalibratedOffsetKcal();
  if (basis !== 'bmr_adp') return bmr;
  const fraction = adaptationFractionAt(atIsoDate);
  return fraction === null ? bmr : bmr * (1 - fraction);
}

// Today's λt alone, for maintenanceAffineCoefficients, which scales aBmr/bBmr separately.
// 0 outside 'bmr_adp' or with no weigh-in.
function currentAdaptationFraction() {
  if (bmrBasis() !== 'bmr_adp') return 0;
  return adaptationFractionAt() ?? 0;
}

// Resting maintenance at m̄; null if anything is missing. Callers add their own activity.
function restingMaintenanceKcal(entries) {
  const { heightCm, age, sex, complete } = bmrProfileFromSettings();
  const bodyMassKg = planBodyMassKg(entries);

  if (!complete || bodyMassKg === null) return null;
  return applyBmrBasis(bmrKcal(bodyMassKg, heightCm, age, sex));
}

function activityDesiredMin() {
  return getSetting('ACTIVITY_DESIRED_MIN', ACTIVITY_DESIRED_MIN_DEFAULT);
}

// The gross burn ACTIVITY_DESIRED_MIN implies at `bodyMassKg` — gross, as Calorie Balance adds it.
function activityDesiredKcal(bodyMassKg) {
  return metKcal(activityMet(), bodyMassKg, activityDesiredMin());
}

// A pinned activity BURN: it stays put and the minutes rise as mass falls. Read only by the
// activity tile and chart; the desired intake (and Tune's preview) stays pin-blind.
const ACTIVITY_DESIRED_PIN_KEY = 'ACTIVITY_DESIRED_FIXED_KCAL';

function pinnedActivityDesiredKcal() {
  return getSetting(ACTIVITY_DESIRED_PIN_KEY, null);
}

function getActivityDesiredKcal(bodyMassKg) {
  return pinnedActivityDesiredKcal() ?? activityDesiredKcal(bodyMassKg);
}

// The flat minutes setting, or the minutes the pinned burn takes at `bodyMassKg`.
function getActivityDesiredMin(bodyMassKg) {
  const pinnedKcal = pinnedActivityDesiredKcal();
  if (pinnedKcal === null || bodyMassKg === null) return activityDesiredMin();
  return activityMinutesFromKcal(pinnedKcal, bodyMassKg);
}

// The inverse of metKcal at the Walk MET.
function activityMinutesFromKcal(kcal, bodyMassKg) {
  return kcal / (activityMet() * bodyMassKg * kcalPerMetKgMin());
}

// The one rule for an activity entry's kcal: Calculate's amount2 (real per-exercise MET)
// wins, else minutes at the Walk MET.
function activityEntryKcal(entry, bodyMassKg) {
  if (entry.amount2 !== null) return entry.amount2;
  const mins = toActivityMinutes(entry.amount, entry.unit);
  return bodyMassKg != null ? metKcal(activityMet(), bodyMassKg, mins) : mins * GENERIC_KCAL_PER_ACTIVE_MIN;
}

// Logged activity kcal/day over the window, to seed Tune's τ.
function trailingActivityKcal(entries, bodyMassKg, windowDays) {
  const byDate = dailyValues(
    entries,
    (e) => (e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null,
    (e) => activityEntryKcal(e, bodyMassKg),
    sumDailyValues,
  );
  return trailingAverage(byDate, windowDays);
}

// γ: fat-loss efficiency lost per hour of sleep below desired (Tune input, default 3%,
// within the literature's 2–3%).
const SLEEP_DEPRIVATION_PCT_PER_HOUR_KEY = 'SLEEP_DEPRIVATION_PCT_PER_HOUR';
const SLEEP_DEPRIVATION_PCT_PER_HOUR_DEFAULT = 3;

function sleepDeprivationPctPerHour() {
  return getSetting(SLEEP_DEPRIVATION_PCT_PER_HOUR_KEY, SLEEP_DEPRIVATION_PCT_PER_HOUR_DEFAULT);
}

// η = 1 − γ × hours below desired, floored at 0; 1 with no sleep logged. Shared by the plan,
// the balance charts and the Sleep chart so a night is worth the same everywhere.
function sleepEfficiencyFactor(sleepHours, sleepDesiredHours) {
  if (sleepHours === null || sleepHours === undefined || !sleepDesiredHours) return 1;
  const hoursBelow = Math.max(0, sleepDesiredHours - sleepHours);
  return Math.max(0, 1 - (sleepDeprivationPctPerHour() / 100) * hoursBelow);
}

// Logged sleep over the window, to seed Tune's s.
function trailingSleepHours(entries, windowDays) {
  const byDate = dailyValues(entries, (e) => e.category === 'Sleep' && e.amount !== null, (e) => e.amount, sumDailyValues);
  return trailingAverage(byDate, windowDays);
}

// The REVERSE question: what a short night cost on a day's actual balance — |balance| ×
// (1 − η), always toward surplus (a deficit shrinks; a surplus grows, since short sleep
// drives hunger and cuts NEAT). Null with no sleep logged.
function sleepDeprivationKcal(balanceKcal, sleepHours, sleepDesiredHours) {
  if (balanceKcal === null || sleepHours === null || sleepHours === undefined) return null;
  const factor = sleepEfficiencyFactor(sleepHours, sleepDesiredHours);
  return Math.round(Math.abs(balanceKcal) * (1 - factor));
}

// A day's effective balance: intake − maintenance − activity − TEF, plus the sleep effect.
// Shared by Calorie Balance and the Calorie-Implied Trajectory.
function dailyEnergyBalanceKcal(intake, maintenance, activity, tef, sleepHours, sleepDesiredHours) {
  const rawBalance = intake - maintenance - activity - tef;
  const deprivationKcal = sleepDeprivationKcal(rawBalance, sleepHours, sleepDesiredHours) ?? 0;
  return { rawBalance, deprivationKcal, balance: rawBalance + deprivationKcal };
}

// Caps the deficit's inflation so a typed extreme can't send the desired intake to ±Infinity.
const SLEEP_EFFICIENCY_FACTOR_MIN = 0.2;

// The FORWARD question: how much bigger the raw deficit must be for η-efficient sleep to
// still deliver it (divides, mirroring sleepDeprivationKcal). Deficits only — poor sleep
// doesn't make a bulk more effective. γ rides along so traces read the same value.
function sleepAdjustedDeficitKcal(rawDeficitKcal, planSleepHours, sleepDesiredHours) {
  const pctPerHour = sleepDeprivationPctPerHour();
  if (rawDeficitKcal === null || rawDeficitKcal <= 0) {
    return { rawDeficitKcal, deficitKcal: rawDeficitKcal, sleepDeprivationEffectKcal: 0, factor: 1, pctPerHour };
  }
  const factor = sleepEfficiencyFactor(planSleepHours, sleepDesiredHours);
  const deficitKcal = rawDeficitKcal / Math.max(factor, SLEEP_EFFICIENCY_FACTOR_MIN);
  return {
    rawDeficitKcal, deficitKcal, sleepDeprivationEffectKcal: Math.round(deficitKcal - rawDeficitKcal), factor, pctPerHour,
  };
}

// The desired intake at ONE body mass: (BMR + desired activity − the WEEKLY_FAT_LOSS_KG
// deficit) / (1 − f). No lifestyle multiplier, so it agrees with the forecast and Calorie
// Balance. Null when an input is missing (callers fall back to CALORIE_DESIRED_KCAL).
// `storedBmr`: a past day's stored BMR, used instead of the equation.
function calorieDesiredDetail(bodyMassKg, storedBmr = null) {
  const { heightCm, age, sex, complete } = bmrProfileFromSettings();
  const weeklyFatLossKg = weeklyFatLossKgAt(bodyMassKg);

  if (bodyMassKg === null || weeklyFatLossKg === null || (storedBmr === null && !complete)) return null;

  const bmr = storedBmr ?? applyBmrBasis(bmrKcal(bodyMassKg, heightCm, age, sex));
  const activityKcal = activityDesiredKcal(bodyMassKg);

  // Negative (a lean bulk) makes this a surplus, turning the ceiling into a floor.
  const rawDeficit = (weeklyFatLossKg * GENERIC_KCAL_PER_KG_FAT) / 7;

  // PLAN_SLEEP_HOURS defaults to the desired sleep, i.e. no adjustment.
  const sleepDesiredHours = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
  const planSleepHours = getSetting('PLAN_SLEEP_HOURS', sleepDesiredHours);
  const {
    deficitKcal: deficit, sleepDeprivationEffectKcal, factor, pctPerHour,
  } = sleepAdjustedDeficitKcal(rawDeficit, planSleepHours, sleepDesiredHours);

  const divisor = tefDivisor();
  const kcal = Math.round((bmr + activityKcal - deficit) / divisor);

  // TEF off the ROUNDED intake, so `TEF = f × Eᵢₙ` multiplies out against the shown Eᵢₙ.
  return {
    kcal, bmr, activityKcal, weeklyFatLossKg, rawDeficit, deficit, sleepDeprivationEffectKcal, factor, pctPerHour,
    planSleepHours, sleepDesiredHours, tefKcal: kcal * (1 - divisor), tefDivisor: divisor,
  };
}

// Δm as a share of body mass. 0.5–1%/week is the usual sustainable range; above 1% more of
// the loss is lean mass. A verdict beside the box, never a limit.
const WEEKLY_FAT_LOSS_PCT_FLOOR = 0.5;
const WEEKLY_FAT_LOSS_PCT_CEILING = 1;

function weeklyFatLossPct(weeklyFatLossKg, bodyMassKg) {
  if (weeklyFatLossKg === null || bodyMassKg === null || bodyMassKg <= 0) return null;
  return Math.round((weeklyFatLossKg / bodyMassKg) * 10000) / 100;
}

// D_bmr%: intake below BMR as a share of BMR. Past the ceiling more of the deficit tends to
// come from lean mass — a warning, never a limit.
const DEFICIT_VS_BMR_PCT_CEILING = 20;

function deficitVsBmrPct(bmr, intakeKcal) {
  if (!Number.isFinite(bmr) || bmr === 0 || !Number.isFinite(intakeKcal)) return null;
  return Math.round(((bmr - intakeKcal) / bmr) * 1000) / 10;
}

// Three decimals, so kg → % → kg round-trips without the two boxes disagreeing by a digit.
function weeklyFatLossKgFromPct(pct, bodyMassKg) {
  if (pct === null || bodyMassKg === null) return null;
  return Math.round((pct / 100) * bodyMassKg * 1000) / 1000;
}

// A pinned PERCENTAGE: the weekly kg is recomputed as a share of each new mass. Mutually
// exclusive with CALORIE_DESIRED_FIXED_KCAL (Tune blanks the other); whichever key holds a
// number is in force.
const WEEKLY_FAT_LOSS_PCT_PIN_KEY = 'WEEKLY_FAT_LOSS_PCT';

function pinnedWeeklyFatLossPct() {
  return getSetting(WEEKLY_FAT_LOSS_PCT_PIN_KEY, null);
}

// The weekly kg AT a body mass: flat WEEKLY_FAT_LOSS_KG, or the pinned share of that mass.
function weeklyFatLossKgAt(bodyMassKg) {
  const pct = pinnedWeeklyFatLossPct();
  if (pct !== null && bodyMassKg !== null) return weeklyFatLossKgFromPct(pct, bodyMassKg);
  return getSetting('WEEKLY_FAT_LOSS_KG', null);
}

function calculatedCalorieDesiredKcal(bodyMassKg, storedBmr = null) {
  const detail = calorieDesiredDetail(bodyMassKg, storedBmr);
  return detail === null ? null : detail.kcal;
}

function flatCalorieDesiredKcal() {
  return getSetting('CALORIE_DESIRED_KCAL', CALORIE_DESIRED_KCAL_DEFAULT);
}

// A PINNED desired intake that doesn't track body mass — which matches the forecast, solved
// at constant Eᵢₙ. Its own key: CALORIE_DESIRED_KCAL is the incomplete-profile fallback and
// may hold stale values on existing sheets.
const CALORIE_DESIRED_PIN_KEY = 'CALORIE_DESIRED_FIXED_KCAL';

function pinnedCalorieDesiredKcal() {
  return getSetting(CALORIE_DESIRED_PIN_KEY, null);
}

// TODAY's desired intake figure: pinned, else calculated at m̄ (Tune's basis too), else flat.
// Which side to be on is getCalorieDesiredKind.
function getCalorieDesiredKcal(entries) {
  return pinnedCalorieDesiredKcal()
    ?? calculatedCalorieDesiredKcal(planBodyMassKg(entries))
    ?? flatCalorieDesiredKcal();
}

// The desired intake per day, at that day's own body mass (it moves ~16 kcal/kg). bodyMassKg
// rides along for the tooltip; null when the figure ignores it (pinned or flat).
function calorieDesiredSeries(entries, dates) {
  const pinned = pinnedCalorieDesiredKcal();
  if (pinned !== null) return dates.map(() => ({ kcal: pinned, bodyMassKg: null }));

  const bodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(entries.filter(isBodyMassReading)), dates);
  const flat = flatCalorieDesiredKcal();

  return dates.map((date) => {
    const bodyMassKg = bodyMassForDate.get(date) ?? null;
    const kcal = calculatedCalorieDesiredKcal(bodyMassKg, storedBmrForDate(date));
    return kcal === null ? { kcal: flat, bodyMassKg: null } : { kcal, bodyMassKg };
  });
}

// Desired intake is a ceiling when heading down, a floor heading up: healthy mass vs. m̄
// (smoothed, so one noisy reading can't flip the scoring near goal). At goal or without
// either mass, a negative weekly rate means a bulk; nothing at all keeps the ceiling.
function getCalorieDesiredKind(entries) {
  const healthyKg = getSetting('BODY_MASS_HEALTHY_KG', null);
  const currentKg = planBodyMassKg(entries);

  if (healthyKg !== null && currentKg !== null && Math.abs(healthyKg - currentKg) >= BODY_MASS_AT_HEALTHY_TOLERANCE_KG) {
    return healthyKg < currentKg ? 'max' : 'min';
  }

  const weeklyFatLossKg = weeklyFatLossKgAt(currentKg);
  return (weeklyFatLossKg !== null && weeklyFatLossKg < 0) ? 'min' : 'max';
}

// Figure, kind and display words together, so no label can describe them differently.
function getCalorieDesired(entries) {
  const kind = getCalorieDesiredKind(entries);
  return {
    kcal: getCalorieDesiredKcal(entries),
    kind,
    isMax: kind === 'max',
    word: kind === 'max' ? 'Max' : 'Min',
    full: kind === 'max' ? 'Maximum' : 'Minimum',
  };
}

// At-or-under a ceiling, at-or-over a floor.
function withinCalorieDesired(kcal, desired) {
  return desired.isMax ? kcal <= desired.kcal : kcal >= desired.kcal;
}

// Least squares; the intercept is for the Body Mass weekly trend, which evaluates the line.
function linearRegression(xs, ys) {
  const n = xs.length;
  const sumX = sumDailyValues(xs);
  const sumY = sumDailyValues(ys);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

function linearRegressionSlope(xs, ys) {
  return linearRegression(xs, ys).slope;
}

// Over days that HAVE a log, not the window's calendar length.
function avg(map) {
  return meanDailyValues([...map.values()]);
}

// UTC throughout: local formatting of a UTC midnight rolls back a day west of Greenwich.
function parseIsoDateUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// In LOGGED POINTS, not calendar days.
const BODY_MASS_TREND_WINDOW_SIZE = 5;

// Centered moving average over logged points: no spike on a noisy reading, no trailing
// lag, and it smooths sporadic logs as well as daily ones.
function smoothBodyMassSeries(values, windowSize) {
  const radius = Math.floor((windowSize - 1) / 2);
  return values.map((_, i) => meanDailyValues(values.slice(Math.max(0, i - radius), Math.min(values.length, i + radius + 1))));
}

function computeBodyMassTrend(bodyMassByDate, windowSize = BODY_MASS_TREND_WINDOW_SIZE) {
  const dates = [...bodyMassByDate.keys()].sort();
  const smoothed = smoothBodyMassSeries(dates.map((d) => bodyMassByDate.get(d)), windowSize);

  const trend = new Map();
  smoothed.forEach((v, i) => trend.set(dates[i], v));
  return trend;
}

// The trend line's own slope in g/day (the raw delta is mostly water): centered on both
// neighbours over their calendar gap, one-sided at the ends.
function computeBodyMassTrendSlopeGramsPerDay(trendMap) {
  const dates = [...trendMap.keys()].sort();
  const slope = new Map();
  dates.forEach((d, i) => {
    const prev = i > 0 ? dates[i - 1] : null;
    const next = i < dates.length - 1 ? dates[i + 1] : null;
    if (prev === null && next === null) {
      slope.set(d, null);
      return;
    }
    const fromDate = prev ?? d;
    const toDate = next ?? d;
    const days = (parseIsoDateUTC(toDate) - parseIsoDateUTC(fromDate)) / MS_PER_DAY;
    const kgPerDay = (trendMap.get(toDate) - trendMap.get(fromDate)) / days;
    slope.set(d, Math.round(kgPerDay * 1000));
  });
  return slope;
}

// Less than this net change over the window, on the SMOOTHED line, is a real stall.
const PLATEAU_WINDOW_DAYS = 10;
const PLATEAU_THRESHOLD_KG = 0.3;

// Days the trend has held flat, or null if it moved or the history doesn't span the window.
function detectPlateau(trendMap) {
  const dates = [...trendMap.keys()].sort();
  if (dates.length < 3) return null;

  const lastDate = dates[dates.length - 1];
  const lastMs = parseIsoDateUTC(lastDate);
  const windowStartMs = lastMs - (PLATEAU_WINDOW_DAYS - 1) * MS_PER_DAY;
  if (parseIsoDateUTC(dates[0]) > windowStartMs) return null;

  const windowStartDate = dates.find((d) => parseIsoDateUTC(d) >= windowStartMs);
  const change = trendMap.get(lastDate) - trendMap.get(windowStartDate);
  if (Math.abs(change) >= PLATEAU_THRESHOLD_KG) return null;

  return Math.round((lastMs - parseIsoDateUTC(windowStartDate)) / MS_PER_DAY);
}

// Maintenance is affine in body mass, M(m) = A + B·m, under both equations (Boer's LBM is
// itself affine in m, so Katch is too). Shared by the forecast and Tune's reverse solve.
// TEF divides both halves. `formula`/`tef` let Tune preview unsaved choices; aBmr, bBmr and
// activityPerKg are returned UN-discounted for the trace and adaptedPlateauKg.
// BMR's per-kg term under the equation in force: Mifflin's 10, or Katch's 21.6 × LBM per kg.
function bmrKcalPerKg(sex, heightCm, formula = bmrFormula()) {
  return formula === 'katch' ? KATCH_KCAL_PER_KG_LBM * leanBodyMassCoefficients(sex, heightCm).perKg : MIFFLIN_KCAL_PER_KG;
}

function maintenanceAffineCoefficients({
  heightCm, age, sex, met, tau, kappa, formula = bmrFormula(), tef = tefPercent(), bodyMassKg = null,
}) {
  const activityPerKg = (met * tau * kappa) / ML_O2_PER_KCAL;
  const lbm = leanBodyMassCoefficients(sex, heightCm);
  const aBmr = formula === 'katch'
    ? KATCH_BASE_KCAL + KATCH_KCAL_PER_KG_LBM * (lbm.perCm * heightCm + lbm.constant)
    : MIFFLIN_KCAL_PER_CM * heightCm - MIFFLIN_KCAL_PER_YEAR * age + mifflinSexKcal(sex);
  const bBmr = bmrKcalPerKg(sex, heightCm, formula);
  const divisor = tefDivisor(tef);

  // The forecast runs on the BMR basis, held constant for the whole trip (the closed form
  // needs fixed A/B): bmr_adp at today's λt; bmr_cal and bmr_avg as a fixed fraction of the
  // equation scaling both halves, never extrapolated. Without bodyMassKg to measure the
  // calibrated fraction against, bmr_cal falls back to shifting by the offset.
  const basis = bmrBasis();
  const basisFraction = currentAdaptationFraction();
  const calibratedOffset = currentCalibratedOffsetKcal();
  let aBmrEff;
  let bBmrEff;
  const equationBmrNow = bodyMassKg === null ? null : aBmr + bBmr * bodyMassKg;
  if (basis === 'bmr_cal' && equationBmrNow) {
    const calibratedFraction = calibratedOffset / equationBmrNow;
    aBmrEff = aBmr * (1 + calibratedFraction);
    bBmrEff = bBmr * (1 + calibratedFraction);
  } else if (basis === 'bmr_avg') {
    const ratio = currentBmrAverageRatio();
    aBmrEff = aBmr * ratio;
    bBmrEff = bBmr * ratio;
  } else {
    aBmrEff = aBmr * (1 - basisFraction) + calibratedOffset;
    bBmrEff = bBmr * (1 - basisFraction);
  }

  return {
    a: aBmrEff / divisor,
    b: (bBmrEff + activityPerKg) / divisor,
    aBmr,
    bBmr,
    activityPerKg,
    tefDivisor: divisor,
    formula,
  };
}

// m∞ once BMR has adapted: the BMR halves scaled by (1 − λt), activity untouched. Above the
// plain m∞ whenever λt > 0 — the overshoot the plain model hides.
function adaptedPlateauKg(intakeKcal, coefficients, adaptFraction) {
  const { aBmr, bBmr, activityPerKg, tefDivisor: divisor } = coefficients;
  const remaining = 1 - adaptFraction;
  return (intakeKcal - (remaining * aBmr) / divisor)
    / ((remaining * bBmr + activityPerKg) / divisor);
}

// `days` from now (or from `from`), as a Date.
function daysAfter(from, days) {
  const date = new Date(from);
  date.setDate(from.getDate() + days);
  return date;
}

// The DESIRED trajectory at constant Eᵢₙ, shared with Tune. Closed form of the linear ODE
// dm/dt = (Eᵢₙ − A − B·m)/ρ. Only masses between m and m∞ are reachable; past the
// asymptote is reported, not extrapolated. `formula`/`tef` only pass through to A and B.
function projectHealthyDays({
  intakeKcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, healthyKg, formula, tef,
}) {
  const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa, formula, tef, bodyMassKg });
  const equilibriumKg = (intakeKcal - a) / b;

  if (Math.abs(bodyMassKg - healthyKg) < BODY_MASS_AT_HEALTHY_TOLERANCE_KG) {
    return { a, b, equilibriumKg, status: 'reached' };
  }

  const ratio = (bodyMassKg - equilibriumKg) / (healthyKg - equilibriumKg);
  if (!Number.isFinite(ratio) || ratio <= 1) {
    return { a, b, equilibriumKg, status: 'unreachable' };
  }

  const days = (GENERIC_KCAL_PER_KG_FAT / b) * Math.log(ratio);
  // decayPerKg is the drawn exponential's coefficient: B here, unrelated to B for the pct journey.
  return {
    a, b, decayPerKg: b, equilibriumKg, days, etaIso: isoFromDate(daysAfter(new Date(), Math.round(days))), status: 'ok', journey: 'intake',
  };
}

// The pinned-percentage trajectory: m(t) = m × (1 − p/100)^(t/7), in projectHealthyDays'
// shape with m∞ = 0 so one routine draws both. No plateau: any positive rate arrives.
function projectHealthyDaysAtFixedPct({ bodyMassKg, healthyKg, weeklyPct }) {
  const base = { decayPerKg: 0, equilibriumKg: 0, journey: 'pct' };
  if (Math.abs(bodyMassKg - healthyKg) < BODY_MASS_AT_HEALTHY_TOLERANCE_KG) {
    return { ...base, status: 'reached' };
  }

  const kPerDay = -Math.log(1 - weeklyPct / 100) / 7;
  const decayPerKg = kPerDay * GENERIC_KCAL_PER_KG_FAT;
  const days = Math.log(bodyMassKg / healthyKg) / kPerDay;
  if (!Number.isFinite(days) || days <= 0) {
    // No equilibrium to describe, so the reason travels with the result.
    return {
      ...base,
      status: 'unreachable',
      reason: weeklyPct > 0
        ? 'the healthy body mass is not below your current body mass'
        : 'a rate of 0% or less never moves the mass',
    };
  }

  return { ...base, decayPerKg, days, etaIso: isoFromDate(daysAfter(new Date(), Math.round(days))), status: 'ok' };
}

// The desired trajectory for whichever journey the pins describe — the single entry point
// for the chart and the Health Plan prompt. A/B are merged in either way. Only pct > 0
// takes the proportional form; a hold or bulk needs the constant-Eᵢₙ one.
function healthyJourneyProjection({ intakeKcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, healthyKg }) {
  const pct = pinnedWeeklyFatLossPct();
  if (pct !== null && pct > 0) {
    return {
      ...maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa, bodyMassKg }),
      ...projectHealthyDaysAtFixedPct({ bodyMassKg, healthyKg, weeklyPct: pct }),
    };
  }
  return projectHealthyDays({ intakeKcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, healthyKg });
}

// The same trajectory from saved Settings, so it matches Tune while its boxes hold the
// saved values. Null without a profile.
function healthyProjectionFromSettings(entries, bodyMassKg, healthyKg) {
  const { heightCm, age, sex, complete } = bmrProfileFromSettings();
  if (!complete) return null;

  return healthyJourneyProjection({
    intakeKcal: getCalorieDesiredKcal(entries),
    bodyMassKg,
    heightCm,
    age,
    sex,
    met: activityMet(),
    tau: activityDesiredMin(),
    kappa: metMlO2PerKgMin(),
    healthyKg,
  });
}

// The forecast chart draws at most a year ahead, one point a week.
const PROJECTION_HORIZON_DAYS = 365;
// Without a profile, the forecast extrapolates the last fortnight's logs.
const PROJECTION_LOGGED_WINDOW_DAYS = 14;
// Bounds on the logged-sleep / desired-sleep rate multiplier.
const PROJECTION_SLEEP_RATIO_MIN = 0.7;

// Weekly points along `bodyMassAtDay`, plus the arrival point when within the horizon.
function projectedBodyMassPoints(today, daysToHealthy, bodyMassAtDay, arrivalHealthy) {
  const projectedPoints = [];
  for (let d = 0; d <= Math.min(daysToHealthy, PROJECTION_HORIZON_DAYS); d += 7) {
    projectedPoints.push({ date: isoFromDate(daysAfter(today, d)), bodyMass: Math.round(bodyMassAtDay(d) * 10) / 10 });
  }
  if (daysToHealthy <= PROJECTION_HORIZON_DAYS) {
    projectedPoints.push({ date: isoFromDate(daysAfter(today, daysToHealthy)), bodyMass: Math.round(arrivalHealthy * 10) / 10 });
  }
  return projectedPoints;
}

function calcProjection(entries) {
  const bodyMassHealthy = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  // The figure only; also the intake level when nothing has been logged.
  const calorieDesired = getCalorieDesiredKcal(entries);
  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = isoFromDate(today);
  const cutoffIso = isoFromDate(daysAfter(today, -PROJECTION_LOGGED_WINDOW_DAYS));

  const bodyMassEntries = bodyMassReadingsAscending(entries);
  if (bodyMassEntries.length < 2) return null;

  const lastBodyMass = bodyMassEntries[bodyMassEntries.length - 1].amount;
  // m̄, as Tune uses, so the day count and ETA match it.
  const planMass = planBodyMassKg(entries) ?? lastBodyMass;

  const arrivalHealthy = arrivalHealthyKg(
    bodyMassHealthy, planMass, getSetting('HEIGHT_CM', null), getSettingString('SEX', null),
    bodyMassHealthyIsDownward(entries),
  );

  // The DESIRED plan wins whenever there's a profile — the same projection Tune prints, so
  // the forecast states the plan rather than recent behaviour (Calorie Balance shows that).
  const healthyProjection = healthyProjectionFromSettings(entries, planMass, arrivalHealthy);
  if (healthyProjection !== null) {
    if (healthyProjection.status === 'reached') return { status: 'reached' };

    // Rate at m̄, for the ETA line's note.
    const slope = (calorieDesired - (healthyProjection.a + healthyProjection.b * planMass)) / GENERIC_KCAL_PER_KG_FAT;

    if (healthyProjection.status === 'unreachable') {
      return { status: 'asymptote', method: 'healthy', slope, equilibriumKg: healthyProjection.equilibriumKg };
    }

    // Same rounding as Tune, so the ETA can't land a day off.
    const daysToHealthy = Math.round(healthyProjection.days);

    // m(t) = m∞ + (m − m∞)·e^(−decay·t/ρ).
    const bodyMassAtDay = (d) => healthyProjection.equilibriumKg
      + (planMass - healthyProjection.equilibriumKg) * Math.exp(-(healthyProjection.decayPerKg * d) / GENERIC_KCAL_PER_KG_FAT);

    return {
      status: 'ok',
      slope,
      daysToHealthy,
      etaDate: daysAfter(today, daysToHealthy),
      projectedPoints: projectedBodyMassPoints(today, daysToHealthy, bodyMassAtDay, arrivalHealthy),
      method: 'healthy',
      bodyMassHealthy,
      equilibriumKg: healthyProjection.equilibriumKg,
    };
  }

  // No profile: extrapolate the logged behaviour of the last fortnight instead.
  const recentEntries = entries.filter((e) => e.date >= cutoffIso && e.date <= todayIso);

  const caloriesByDate = new Map();
  const activityKcalByDate = new Map();
  const sleepByDate = new Map();

  recentEntries.forEach((e) => {
    if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
      const kcal = activityEntryKcal(e, lastBodyMass);
      activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
    } else if (e.category === 'Sleep' && e.amount !== null) {
      sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
    }
  });

  let slope;
  let method;
  // The exponential model's coefficients; null projects a straight line.
  let decay = null;

  if (caloriesByDate.size > 0 || activityKcalByDate.size > 0) {
    const avgCalories = caloriesByDate.size > 0 ? avg(caloriesByDate) : calorieDesired;
    const avgActivityKcal = activityKcalByDate.size > 0 ? avg(activityKcalByDate) : 0;
    const avgSleep = sleepByDate.size > 0 ? avg(sleepByDate) : sleepDesired;

    // Against MAINTENANCE, not calorieDesired (which already has the deficit taken off).
    // Without a profile, the flat desired figure is the best baseline available.
    const resting = restingMaintenanceKcal(entries);
    const maintenance = resting !== null
      ? resting + avgActivityKcal
      : calorieDesired + avgActivityKcal;

    const balance = avgCalories - maintenance;
    const baseSlope = balance / GENERIC_KCAL_PER_KG_FAT;
    const sleepRatio = Math.min(1.0, Math.max(PROJECTION_SLEEP_RATIO_MIN, avgSleep / sleepDesired));
    slope = baseSlope * sleepRatio;

    // Maintenance is affine in mass (the BMR equation's per-kg term plus mass-proportional
    // logged burn), so a fixed intake decays exponentially toward its own equilibrium.
    if (resting !== null && lastBodyMass > 0) {
      const { heightCm, sex } = bmrProfileFromSettings();
      const perKg = bmrKcalPerKg(sex, heightCm) + avgActivityKcal / lastBodyMass;
      const bodyMassIndependent = maintenance - perKg * lastBodyMass;
      decay = {
        perKg,
        // Sleep slows the rate, not the destination.
        kcalPerKg: GENERIC_KCAL_PER_KG_FAT / sleepRatio,
        equilibriumKg: (avgCalories - bodyMassIndependent) / perKg,
      };
    }

    // The formula scales by sleep, so a missing sleep log is partial data.
    const allPresent = caloriesByDate.size > 0 && activityKcalByDate.size > 0 && sleepByDate.size > 0;
    method = allPresent ? 'full' : 'partial';
  } else {
    const src = bodyMassEntries.filter((e) => e.date >= cutoffIso);
    const data = src.length >= 2 ? src : bodyMassEntries;
    slope = linearRegressionSlope(data.map((_, i) => i), data.map((e) => e.amount));
    method = 'body-mass-only';
  }

  // The rate is still reported, so the ETA line can show it.
  if (slope === 0) return { status: 'no-change', method, slope };

  // From lastBodyMass, not m̄: these slopes were fitted from the latest reading.
  const goingDown = arrivalHealthy < lastBodyMass;
  if ((goingDown && slope > 0) || (!goingDown && slope < 0)) return { status: 'wrong-direction', method, slope };

  // A fixed intake only reaches its own equilibrium; a healthy mass beyond it never arrives.
  if (decay !== null) {
    const gapNow = lastBodyMass - decay.equilibriumKg;
    const gapHealthy = arrivalHealthy - decay.equilibriumKg;
    if (gapHealthy / gapNow <= 0) {
      return { status: 'asymptote', method, slope, equilibriumKg: decay.equilibriumKg };
    }
  }

  // t = (ρ/B)·ln[(m − m∞)/(m_g − m∞)] for the curve, the plain division for the line.
  const daysToHealthy = decay !== null
    ? Math.round((decay.kcalPerKg / decay.perKg)
      * Math.log((lastBodyMass - decay.equilibriumKg) / (arrivalHealthy - decay.equilibriumKg)))
    : Math.round((arrivalHealthy - lastBodyMass) / slope);

  const bodyMassAtDay = (d) => (decay !== null
    ? decay.equilibriumKg + (lastBodyMass - decay.equilibriumKg) * Math.exp(-(decay.perKg * d) / decay.kcalPerKg)
    : lastBodyMass + slope * d);

  return {
    status: 'ok',
    slope,
    daysToHealthy,
    etaDate: daysAfter(today, daysToHealthy),
    projectedPoints: projectedBodyMassPoints(today, daysToHealthy, bodyMassAtDay, arrivalHealthy),
    method,
    bodyMassHealthy,
    equilibriumKg: decay !== null ? decay.equilibriumKg : null,
  };
}
