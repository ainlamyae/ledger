
// Used until a Setting tab exists, so nothing changes for anyone without one.
const BODY_MASS_HEALTHY_KG_DEFAULT = 70;
const CALORIE_DESIRED_KCAL_DEFAULT = 2000;
const SLEEP_DESIRED_HOURS_DEFAULT = 8;
const FIBER_DESIRED_G_DEFAULT = 30;
// The general USDA %DV reference for total fat (2,000 kcal diet) — same role as the two
// defaults above, a flat number to score against before the Tune's own
// pct-of-Eᵢₙ band (FAT_DESIRED_G_MIN/MAX) has ever been saved.
const FAT_DESIRED_G_DEFAULT = 65;
const ACTIVITY_DESIRED_MIN_DEFAULT = 100;
const PROTEIN_DESIRED_G_DEFAULT = 100;

// Protein per kg of LEAN mass, not total mass — the band the Formula Tune opens on.
// 1.8-2.2 spans what the resistance-training literature supports for holding lean mass in
// an energy deficit: Morton et al. 2018 (Br J Sports Med) puts the point above which
// fat-free-mass gains stop accruing at ~1.6 g/kg total mass with a 2.2 upper confidence
// bound, and Helms et al. 2014 recommends scaling to fat-free mass instead, which is what
// makes 1.8-2.2 the same advice expressed against LBM.
const PROTEIN_G_PER_KG_LBM_MIN_DEFAULT = 1.8;
const PROTEIN_G_PER_KG_LBM_MAX_DEFAULT = 2.2;

// The fiber band's two coefficients — the Formula Tune opens on these. 17 g/1000 kcal
// sits above the USDA rule of thumb (14 g/1000 kcal); 0.5 g/kg body mass is a common upper-bound heuristic so the
// ceiling scales with the person rather than staying a flat number regardless of size.
const FIBER_G_PER_1000_KCAL_MIN_DEFAULT = 17;
const FIBER_G_PER_KG_MAX_DEFAULT = 0.5;

// The fat band's two coefficients — 20-35% of total energy from fat is the Institute of
// Medicine's Acceptable Macronutrient Distribution Range for adults (Dietary Reference
// Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino
// Acids, 2005), the same range the USDA Dietary Guidelines for Americans carries forward.
// Both ends scale off Eᵢₙ (percent of intake calories), unlike fiber's floor/ceiling on two
// different bases, since that's how the AMDR itself is defined.
const FAT_PCT_OF_KCAL_MIN_DEFAULT = 20;
const FAT_PCT_OF_KCAL_MAX_DEFAULT = 35;
// Fat's fixed energy density (Atwater) — grams per kcal, not a personal parameter, so it's a
// plain constant rather than an overridable setting the way the two percentages above are.
const KCAL_PER_G_FAT = 9;

// The carb band's two coefficients — 30-50% of total energy, below the IOM AMDR's 45-65%
// to leave room for protein on a deficit. Both ends scale off Eᵢₙ, like the fat band above.
const CARB_PCT_OF_KCAL_MIN_DEFAULT = 30;
const CARB_PCT_OF_KCAL_MAX_DEFAULT = 50;
// Carbohydrate's fixed energy density (Atwater) — grams per kcal, same role as KCAL_PER_G_FAT.
const KCAL_PER_G_CARB = 4;
// The general USDA %DV reference for total carbohydrate (2,000 kcal diet) — same role as
// FAT_DESIRED_G_DEFAULT, a flat number to score against before the Tune's own
// pct-of-Eᵢₙ band (CARB_DESIRED_G_MIN/MAX) has ever been saved.
const CARB_DESIRED_G_DEFAULT = 275;

// Intensity assumed for ACTIVITY_DESIRED_MIN (3.0 walking, 5.0 compound lifting, 7.0
// jogging). Duplicates health-activity-estimator.js's EXERCISE_MET_DEFAULT rather than
// referencing it: this file loads first, so that const is still in its dead zone.
const ACTIVITY_MET_FALLBACK = 3;

// Tune's MET box while its preview runs (withFormulaOverrides) — a what-if, never
// saved to the Setting tab.
const ACTIVITY_MET_PREVIEW_KEY = 'ACTIVITY_MET_PREVIEW';

// The walking activity's MET, from the Activity sheet's Walk row (exerciseMet,
// health-activity-catalogue.js) — the one place that number is maintained, so there's no Setting
// for it to drift from. Tune's typed what-if wins during its own preview only.
function activityMet() {
  const preview = currentSettings[ACTIVITY_MET_PREVIEW_KEY];
  if (typeof preview === 'number' && Number.isFinite(preview)) return preview;
  // No Walk row (a fresh sheet): the walking fallback, not the generic exercise one.
  const met = typeof activityByName === 'function' ? activityByName('Walk')?.met : null;
  return Number.isFinite(met) ? met : ACTIVITY_MET_FALLBACK;
}

// Energy density of body fat, shared by the projection, desired intake and Calorie
// Balance. A population constant, not a personal parameter.
const GENERIC_KCAL_PER_KG_FAT = 7700;

// Last resort, for when no body mass is on file and the MET formula can't be evaluated.
const GENERIC_KCAL_PER_ACTIVE_MIN = 5;

// ACSM form: 1 MET ≈ 3.5 mL O₂/kg/min (default 3, Tune's κ) and a litre of O₂ releases
// ~5 kcal (200 mL per kcal), so κ/200 kcal per MET per kg per minute. Not the `MET × kg × hours`
// shorthand, which assumes 1 MET = 1 kcal/kg/hour and lands a flat 5% low.
const MET_ML_O2_PER_KG_MIN_DEFAULT = 3;
const ML_O2_PER_KCAL = 200;

// Only the mL-O₂ numerator is overridable (KCAL_PER_MET_KG_MIN). The /200 is oxygen's
// energy yield, not a personal parameter.
function kcalPerMetKgMin() {
  return getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT) / ML_O2_PER_KCAL;
}

// The app's only MET→kcal conversion, so desired intake's assumed activity burn and
// Calculate's measured one (health-activity-estimator.js) can't disagree.
function metKcal(met, bodyMassKg, minutes) {
  return met * bodyMassKg * minutes * kcalPerMetKgMin();
}

function latestBodyMassKg(entries) {
  const bodyMassEntries = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return bodyMassEntries.length ? bodyMassEntries[bodyMassEntries.length - 1].amount : null;
}

// A single scale reading is a poor estimate of the mass every equation here is built on:
// water and glycogen swing it by more than a week of fat loss does, so yesterday's dinner
// can move the whole plan. m(t) in the decay model means clean mass, and the standard fix
// is a rolling mean — m̄(t) = (1/L_p) × Σ m(t−i), i = 0…L_p−1 — which is what the plan
// figures read instead. The window is Tune's period length L_p (the same days BMR_cal
// groups by), not a fixed week, so one setting decides how much the scale is smoothed.
//
// The window ends at the LATEST reading, not at today: anchoring on today would quietly
// empty the window after a week away from the scale, and no average at all is worse than
// an average of slightly older readings. Every reading inside it counts equally, however
// many land on one date — averaging per-day means first would weight a day weighed twice
// the same as a day weighed once.
//
// Rounded to the 0.1 kg a scale reads to, for the same reason the LBM figure is: the
// substituted trace multiplies this number out, and a hidden extra decimal is what makes a
// printed line fail to add up.
//
// The saved L_p, not Tune's box: a typed-but-unsaved period length is a what-if for
// Tune's own sheet (health-tune.js passes it in), not for the rest of the app.
function bodyMassSmoothingDays() {
  return getSetting(BMR_CALIBRATION_PERIOD_DAYS_KEY, BMR_CALIBRATION_PERIOD_DAYS_DEFAULT);
}

function smoothedBodyMassKg(entries, windowDays = bodyMassSmoothingDays()) {
  const readings = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (readings.length === 0) return null;

  const windowStartMs = parseIsoDateUTC(readings[readings.length - 1].date)
    - (windowDays - 1) * 86400000;
  const inWindow = readings.filter((e) => parseIsoDateUTC(e.date) >= windowStartMs);
  return Math.round((inWindow.reduce((sum, e) => sum + e.amount, 0) / inWindow.length) * 10) / 10;
}

// The mass every PLAN-level figure is evaluated at — the desired intake, its direction, the
// forecast, the Tune's boxes and the Health Plan prompt. Deliberately NOT used by the
// per-day series (Caloric Intake's desired line, Calorie Balance's maintenance): those
// describe what was true on one specific day, and that day's own reading is the honest
// input there. Here the noise is only noise.
function planBodyMassKg(entries) {
  return smoothedBodyMassKg(entries);
}

// `1.6-2`, `1.6~2`, `1.6 – 2`, `1.6 to 2` all parse. A bare `1.6` is a zero-width band.
const G_PER_KG_BAND_SEPARATOR = /\s*(?:~|-|–|—|to)\s*/i;

// That single cell as {low, high} — null if absent or holding nothing numeric.
function parseGPerKgRangeCell() {
  const raw = getSettingString('PROTEIN_DESIRED_G_PER_KG', null);
  if (raw === null) return null;

  const parts = String(raw).trim().split(G_PER_KG_BAND_SEPARATOR)
    .map(Number)
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (parts.length === 0) return null;

  return { low: parts[0], high: parts[parts.length - 1] };
}

// The g/kg band as {low, high}; null sends getProteinDesiredBandG to its flat fallback.
// Either entry style works — one cell (`1.6-2`) or one end per row — with the explicit
// _MIN/_MAX rows winning per end. Sorted, so a band entered backwards still reads.
function getProteinGPerKgBand() {
  const cell = parseGPerKgRangeCell();
  const ends = [
    getSetting('PROTEIN_DESIRED_G_PER_KG_MIN', null) ?? cell?.low ?? null,
    getSetting('PROTEIN_DESIRED_G_PER_KG_MAX', null) ?? cell?.high ?? null,
  ].filter((n) => n !== null);

  if (ends.length === 0) return null;
  return { low: Math.min(...ends), high: Math.max(...ends) };
}

// An absolute gram band, as the Formula Tune's lean-mass protein rows write it.
// Takes precedence over the g/kg band below: it is ALREADY a body mass times a per-kg
// figure (p × LBM), so putting it back through a basis mass would double-count. Both
// ends optional and sorted, same as the g/kg pair.
function getProteinAbsoluteBandG() {
  const ends = [
    getSetting('PROTEIN_DESIRED_G_MIN', null),
    getSetting('PROTEIN_DESIRED_G_MAX', null),
  ].filter((n) => n !== null && n > 0);

  if (ends.length === 0) return null;
  return { min: Math.round(Math.min(...ends)), max: Math.round(Math.max(...ends)) };
}

// A band, not a point, because the evidence behind it is a range (1.6-2.0 g/kg).
// Applied to HEALTHY body mass, not today's: scaling off current body mass would shrink the
// band with every kg lost, exactly when protein matters most. Falls back to the
// latest body-mass reading, then to a zero-width band at the flat PROTEIN_DESIRED_G.
function getProteinDesiredBandG(entries) {
  // The lean-mass band first: it's the most specific thing on the sheet, and the only
  // one whose grams were computed against a body-composition estimate rather than
  // total mass.
  const absolute = getProteinAbsoluteBandG();
  if (absolute !== null) return absolute;

  const band = getProteinGPerKgBand();
  const basisBodyMassKg = band !== null
    ? (getSetting('BODY_MASS_HEALTHY_KG', null) ?? latestBodyMassKg(entries))
    : null;

  if (basisBodyMassKg !== null) {
    return { min: Math.round(basisBodyMassKg * band.low), max: Math.round(basisBodyMassKg * band.high) };
  }

  const flat = getSetting('PROTEIN_DESIRED_G', PROTEIN_DESIRED_G_DEFAULT);
  return { min: flat, max: flat };
}

// "131" or "131~164" — one place, so the glance tile and the Insight prompt can't
// drift. The separator is a parameter: the prompt passes '-' rather than send the AI
// an unusual character.
function formatProteinDesiredBand(band, separator = '~') {
  return band.max > band.min ? `${band.min}${separator}${band.max}` : `${band.min}`;
}

// Inside the band? A zero-width band has no inside and keeps the plain at-or-over
// rule. Over the top isn't a miss — both the chart's bar colours and the glance tile
// give it its own dark-green "past the ceiling, still a hit" treatment instead.
function withinProteinBand(g, band) {
  return g >= band.min && (band.max === band.min || g <= band.max);
}

// The fiber band the Formula Tune writes — FIBER_DESIRED_G_MIN/MAX, same shape as
// getProteinAbsoluteBandG. Sorted, so a band that came out backwards (a very light body
// weight paired with a high intake, where the per-kg ceiling can undercut the per-1000kcal
// floor) still reads as a proper band rather than an inverted one.
function getFiberAbsoluteBandG() {
  const ends = [
    getSetting('FIBER_DESIRED_G_MIN', null),
    getSetting('FIBER_DESIRED_G_MAX', null),
  ].filter((n) => n !== null && n > 0);

  if (ends.length === 0) return null;
  return { min: Math.round(Math.min(...ends)), max: Math.round(Math.max(...ends)) };
}

// Falls back to the flat FIBER_DESIRED_G/_DEFAULT as a zero-width band, same fallback shape
// getProteinDesiredBandG uses, for whoever hasn't opened the Formula Tune's fiber rows
// yet.
function getFiberDesiredBandG(entries) {
  const absolute = getFiberAbsoluteBandG();
  if (absolute !== null) return absolute;

  const flat = getSetting('FIBER_DESIRED_G', FIBER_DESIRED_G_DEFAULT);
  return { min: flat, max: flat };
}

// In-band check only — same shape as withinProteinBand. Over-the-ceiling is its own
// separate tier (still a hit, darker green), checked directly against band.max wherever
// the bulb/chart need to tell the two apart.
function withinFiberBand(g, band) {
  return g >= band.min && (band.max === band.min || g <= band.max);
}

// The fat band the Formula Tune writes — FAT_DESIRED_G_MIN/MAX, same shape as
// getFiberAbsoluteBandG. Sorted for the same reason: both ends are a share of Eᵢₙ, so
// there's no structural reason they can't come out backwards either.
function getFatAbsoluteBandG() {
  const ends = [
    getSetting('FAT_DESIRED_G_MIN', null),
    getSetting('FAT_DESIRED_G_MAX', null),
  ].filter((n) => n !== null && n > 0);

  if (ends.length === 0) return null;
  return { min: Math.round(Math.min(...ends)), max: Math.round(Math.max(...ends)) };
}

// Falls back to the flat FAT_DESIRED_G/_DEFAULT as a zero-width band, same fallback shape
// getFiberDesiredBandG uses, for whoever hasn't opened the Formula Tune's fat rows yet.
function getFatDesiredBandG(entries) {
  const absolute = getFatAbsoluteBandG();
  if (absolute !== null) return absolute;

  const flat = getSetting('FAT_DESIRED_G', FAT_DESIRED_G_DEFAULT);
  return { min: flat, max: flat };
}

// In-band check only — same shape as withinFiberBand.
function withinFatBand(g, band) {
  return g >= band.min && (band.max === band.min || g <= band.max);
}

// The carb band the Formula Tune writes — CARB_DESIRED_G_MIN/MAX, same shape as
// getFatAbsoluteBandG. Sorted for the same reason: both ends are a share of Eᵢₙ.
function getCarbAbsoluteBandG() {
  const ends = [
    getSetting('CARB_DESIRED_G_MIN', null),
    getSetting('CARB_DESIRED_G_MAX', null),
  ].filter((n) => n !== null && n > 0);

  if (ends.length === 0) return null;
  return { min: Math.round(Math.min(...ends)), max: Math.round(Math.max(...ends)) };
}

// Falls back to the flat CARB_DESIRED_G/_DEFAULT as a zero-width band, same fallback shape
// getFatDesiredBandG uses, for whoever hasn't opened the Formula Tune's carb rows yet.
function getCarbDesiredBandG(entries) {
  const absolute = getCarbAbsoluteBandG();
  if (absolute !== null) return absolute;

  const flat = getSetting('CARB_DESIRED_G', CARB_DESIRED_G_DEFAULT);
  return { min: flat, max: flat };
}

// In-band check only — same shape as withinFatBand.
function withinCarbBand(g, band) {
  return g >= band.min && (band.max === band.min || g <= band.max);
}

// Mifflin-St Jeor BMR (kcal/day) — staying alive before any movement. Every
// maintenance figure in the app is this plus an activity burn, never a lifestyle
// multiplier, so no two of them measure a deficit against different baselines.
function mifflinStJeorBmr(bodyMassKg, heightCm, age, sex) {
  return 10 * bodyMassKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

// Katch-McArdle (1996): BMR = 370 + 21.6 × LBM. It asks the same question a different way
// — fat mass is nearly metabolically inert, so the honest predictor is the lean mass alone
// rather than a regression on total mass, height and age. Age drops out completely, and sex
// enters only through the LBM figure.
//
// Which means it's only better than Mifflin to the extent the LBM behind it is: with a real
// body-fat measurement it's the more accurate of the two, and with the app's Boer estimate
// it's a second opinion built from the same three numbers. That's the whole trade, and it's
// why the choice is the user's rather than a silent upgrade.
const KATCH_BASE_KCAL = 370;
const KATCH_KCAL_PER_KG_LBM = 21.6;

function katchMcArdleBmr(lbmKg) {
  return KATCH_BASE_KCAL + KATCH_KCAL_PER_KG_LBM * lbmKg;
}

// The LBM this equation is evaluated at, rounded to the same 0.1 kg the LBM box and the
// protein band show — so the trace's `370 + 21.6 × 61.4` multiplies out to the BMR printed
// beside it instead of missing it by a kcal.
function bmrLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  return Math.round(leanBodyMassKg(bodyMassKg, heightCm, sex) * 10) / 10;
}

// Which of the two the whole app runs on. A string setting rather than a flag so the sheet
// says which equation is in force, and unset reads as Mifflin — the behaviour every existing
// copy already has.
const BMR_FORMULA_KEY = 'BMR_FORMULA';
const BMR_FORMULA_DEFAULT = 'mifflin';

function bmrFormula() {
  return getSettingString(BMR_FORMULA_KEY, BMR_FORMULA_DEFAULT) === 'katch' ? 'katch' : BMR_FORMULA_DEFAULT;
}

// Age is a Mifflin term only, so a plan on the LBM equation is complete without a birth
// date. Every guard that used to demand one unconditionally asks this instead — otherwise
// switching equations would report a profile incomplete over a number the model no longer
// reads.
function bmrNeedsAge(formula = bmrFormula()) {
  return formula !== 'katch';
}

// The app's single BMR call — the one function every maintenance figure goes through, so a
// switched equation moves all of them together or none. `formula` is a parameter with the
// setting as its default because the Tune previews the other equation before
// it's saved; same reason maintenanceAffineCoefficients takes one.
function bmrKcal(bodyMassKg, heightCm, age, sex, formula = bmrFormula()) {
  return formula === 'katch'
    ? katchMcArdleBmr(bmrLeanBodyMassKg(bodyMassKg, heightCm, sex))
    : mifflinStJeorBmr(bodyMassKg, heightCm, age, sex);
}

// Thermic effect of food: the energy spent digesting what you eat, ~10% of intake on a
// mixed diet. It belongs to expenditure, so counting it RAISES the intake that produces a
// given deficit — and because it's a share of that very intake, the balance has to be
// solved rather than added on:
//
//     Eᵢₙ = BMR + Eₐ + TEF − D,  TEF = f × Eᵢₙ   ⇒   Eᵢₙ = (BMR + Eₐ − D) / (1 − f)
//
// Folding it into Eₐ and subtracting it separately are the same statement — intake − TEF
// − BMR − Eₐ = −D rearranges to that same line — so the two conventions can't disagree
// about a number here.
//
// Defaults to 13.5% of intake, Tune's starting f.
const TEF_PERCENT_KEY = 'TEF_PERCENT_OF_INTAKE';
const TEF_PERCENT_DEFAULT = 13.5;

function tefPercent() {
  return getSetting(TEF_PERCENT_KEY, TEF_PERCENT_DEFAULT);
}

// The (1 − f) every intake and maintenance figure is divided by. Held inside 0–90%: a
// negative share isn't a thermic effect, and at f = 1 digestion costs everything you eat
// and the identity has no finite solution at all.
const TEF_PERCENT_MAX = 90;

function tefDivisor(percent = tefPercent()) {
  return 1 - Math.min(Math.max(percent, 0), TEF_PERCENT_MAX) / 100;
}

// Metabolic adaptation: on a long cut, BMR falls by more than the lost mass accounts for —
// less leptin and T3, quieter sympathetic tone, cheaper movement — and the gap widens with
// time on the diet before levelling off. BMR_adapt(t) = BMR × (1 − λt), with λt plateauing
// somewhere near 10–15% by week 10–12. Refeeds and diet breaks walk λt back toward 0.
//
// Reported, never planned with: Eᵢₙ, the deficit and the arrival date are all left as the
// un-adapted identities give them, because the adaptation is a consequence of the diet
// rather than an input to it, and t keeps moving while λt is still growing. What it
// buys is the honest caveat on m∞ — a plateau at a HEAVIER mass than the constant-BMR model
// promises, which is the usual reason a forecast overshoots in practice. adaptedPlateauKg
// below is how much heavier.
const ADAPT_PCT_PER_WEEK_KEY = 'BMR_ADAPT_PCT_PER_WEEK';
const ADAPT_PCT_CAP_KEY = 'BMR_ADAPT_PCT_CAP';
const ADAPT_PCT_PER_WEEK_DEFAULT = 1;
const ADAPT_PCT_CAP_DEFAULT = 12;

// λt at day `days` — the share of BMR lost by then, capped. Days rather than weeks because
// every other time quantity here (t, the decay constant) is in days.
function adaptationFraction(days, pctPerWeek, pctCap) {
  const grown = (pctPerWeek / 100) * (days / 7);
  return Math.max(0, Math.min(grown, pctCap / 100));
}

// Days actually elapsed since the first logged body-mass reading, as of `atIsoDate` (today when
// omitted) — the real-world "how long have you actually been dieting" basis BMR_adp uses
// everywhere OUTSIDE the Tune itself. The Tune's own BMR_adp is
// deliberately forward-looking instead — adaptation BY ARRIVAL at m_des, t days from now
// (see health-tune-render.js/renderCorrectionFields) — a different question (how adapted will
// you be when you get there) from the one this answers (how adapted are you right now, or
// were you on some past logged day). Clamped to >= 0 so a date before the first body-mass reading
// can't go negative. Null with no body-mass reading logged at all — there's no diet start to count from.
function daysSinceFirstWeighIn(bodyMassEntries, atIsoDate = null) {
  if (!bodyMassEntries.length) return null;
  const firstDate = bodyMassEntries.map((e) => e.date).sort()[0];
  const atMs = parseIsoDateUTC(atIsoDate !== null ? atIsoDate : isoFromDate(new Date()));
  return Math.max(0, Math.round((atMs - parseIsoDateUTC(firstDate)) / 86400000));
}

// Which basis the WHOLE APP runs deficits and the calorie desired figure on — a Formula
// Tune fieldset, the same shape as BMR_FORMULA_KEY above. Unset reads as plain 'bmr',
// the behaviour every existing sheet already has.
const BMR_BASIS_KEY = 'BMR_BASIS';
const BMR_BASIS_DEFAULT = 'bmr';

function bmrBasis() {
  const raw = getSettingString(BMR_BASIS_KEY, BMR_BASIS_DEFAULT);
  return (raw === 'bmr_adp' || raw === 'bmr_cal') ? raw : BMR_BASIS_DEFAULT;
}

// The current BMR calibration: an empirically back-solved BMR from actual logged
// intake/activity/weight-change, rather than the height/age/sex (or lean-mass) equation.
// Read from the Physique sheet itself — the latest day whose stored Derived cell carries a
// BMR_cal (health-physique.js keeps those current) — not from a Setting copy that could drift
// from it. Two numbers come out of that day: the calibrated figure itself (shown as-is in
// the Status card and the Caloric Intake chart), and its OFFSET from that day's equation
// BMR (signed, possibly negative). Everything that turns a raw bmrKcal() into a plan figure
// keeps running the equation's own shape — how BMR moves as body mass changes, i.e. its
// slope — and just shifts the whole line by this constant OFFSET, per the "keep the
// equation's slope, shift the level" choice: a single measured point can't imply a slope of
// its own, so borrowing the equation's is the only option that doesn't require new data.
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
// The calibration window: n_p periods of L_p days, ending yesterday.
const BMR_CALIBRATION_PERIOD_COUNT_KEY = 'BMR_CALIBRATION_PERIOD_COUNT';
const BMR_CALIBRATION_PERIOD_DAYS_KEY = 'BMR_CALIBRATION_PERIOD_DAYS';

// The calibrated figure itself, for display (Status card, Caloric Intake chart) — null until
// a calibration has actually been saved, same "nothing to show yet" convention as every other
// optional setting here.
function calibratedBmrKcal() {
  return latestStoredCalibration()?.bmrCal ?? null;
}

// 0 outside 'bmr_cal' (nothing to shift by) or before a calibration has ever been saved
// (falls back to the plain equation rather than silently refusing to compute) — same shape as
// currentAdaptationFraction's own "0 unless bmr_adp" guard below.
function currentCalibratedOffsetKcal() {
  if (bmrBasis() !== 'bmr_cal') return 0;
  return latestStoredCalibration()?.offsetKcal ?? 0;
}

// The single choke point every consumer of a raw bmrKcal() figure routes through before
// using it in a deficit or the calorie desired figure — so flipping the BMR_BASIS setting
// changes every one of them identically (the desired daily intake, Calorie Balance's
// per-day Maintenance, the Status card's D/Δm, Physique's own maintenance figure) instead
// of each deciding for itself. Under 'bmr' this is a no-op; under 'bmr_adp' it discounts
// by adaptationFraction at daysSinceFirstWeighIn, evaluated `atIsoDate` (today when
// omitted). Reads the full entry list itself via physiqueAsHealthEntries() rather than
// taking one as a parameter, so every existing bmrKcal() call site can adopt this with a
// one-line wrap instead of a signature change threaded through its whole call chain.
function applyBmrBasis(bmr, atIsoDate = null) {
  if (bmr === null) return bmr;
  if (bmrBasis() === 'bmr_cal') return bmr + currentCalibratedOffsetKcal();
  if (bmrBasis() !== 'bmr_adp') return bmr;
  const bodyMassEntries = physiqueAsHealthEntries().filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const daysOnDiet = daysSinceFirstWeighIn(bodyMassEntries, atIsoDate);
  if (daysOnDiet === null) return bmr;
  const pctPerWeek = getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT);
  const pctCap = getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT);
  return bmr * (1 - adaptationFraction(daysOnDiet, pctPerWeek, pctCap));
}

// TODAY's adaptation fraction — applyBmrBasis's "just the fraction" twin, for the one
// caller that has to scale aBmr/bBmr SEPARATELY rather than one whole BMR figure
// (maintenanceAffineCoefficients, below) — a plain BMR value doesn't exist yet at the
// point that needs this number. 0 under the plain 'bmr' basis, or with no body-mass reading to
// count a diet start from.
function currentAdaptationFraction() {
  if (bmrBasis() !== 'bmr_adp') return 0;
  const bodyMassEntries = physiqueAsHealthEntries().filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const daysOnDiet = daysSinceFirstWeighIn(bodyMassEntries);
  if (daysOnDiet === null) return 0;
  const pctPerWeek = getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT);
  const pctCap = getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT);
  return adaptationFraction(daysOnDiet, pctPerWeek, pctCap);
}

// Resting maintenance from the profile and the smoothed body mass; null if anything is
// missing. Excludes activity — each caller adds the figure right for its own window.
function restingMaintenanceKcal(entries) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const bodyMassKg = planBodyMassKg(entries);

  if (heightCm === null || (age === null && bmrNeedsAge()) || (sex !== 'male' && sex !== 'female') || bodyMassKg === null) return null;
  return applyBmrBasis(bmrKcal(bodyMassKg, heightCm, age, sex));
}

// Inside this margin the Physical Activity dot goes gray rather than red. Same 5% as
// CALORIE_DESIRED_NEAR_FRACTION, kept separate because the two score different things.
const ACTIVITY_NEAR_DESIRED_FRACTION = 0.05;

// What ACTIVITY_DESIRED_MIN implies at `bodyMassKg`. Gross, not net of resting — Calorie
// Balance also adds gross activity to plain BMR, so both maintenance figures agree.
function activityDesiredKcal(bodyMassKg) {
  return metKcal(activityMet(), bodyMassKg, getSetting('ACTIVITY_DESIRED_MIN', ACTIVITY_DESIRED_MIN_DEFAULT));
}

// A PINNED desired activity: the same idea as CALORIE_DESIRED_PIN_KEY below, but for the
// workout goal itself. Unset, the goal is ACTIVITY_DESIRED_MIN minutes and whatever that
// burns falls as body mass falls, since metKcal scales with mass — pin this instead and
// the BURN stays put, so the minutes needed rise instead as you get lighter.
//
// Deliberately doesn't touch activityDesiredKcal above (or calorieDesiredDetail, which calls
// it): those stay the raw, pin-blind calculation the Tune previews live and
// the desired intake is built from — the same way CALORIE_DESIRED_PIN_KEY leaves
// calorieDesiredDetail alone. Only the activity tile and chart, which show the workout goal
// itself rather than daily intake, read this.
const ACTIVITY_DESIRED_PIN_KEY = 'ACTIVITY_DESIRED_FIXED_KCAL';

function pinnedActivityDesiredKcal() {
  return getSetting(ACTIVITY_DESIRED_PIN_KEY, null);
}

// TODAY's desired activity kcal: the pinned figure if one is set, else whatever
// ACTIVITY_DESIRED_MIN implies at bodyMassKg.
function getActivityDesiredKcal(bodyMassKg) {
  return pinnedActivityDesiredKcal() ?? activityDesiredKcal(bodyMassKg);
}

// The mirror for minutes: unset, it's just the flat ACTIVITY_DESIRED_MIN; pinned, it's
// however many minutes at bodyMassKg it now takes to burn the pinned figure — rising as
// body mass falls, since the same MET moves less mass per minute. No body mass, no figure
// to divide by, so it falls back to the flat minutes setting either way.
function getActivityDesiredMin(bodyMassKg) {
  const pinnedKcal = pinnedActivityDesiredKcal();
  if (pinnedKcal === null || bodyMassKg === null) {
    return getSetting('ACTIVITY_DESIRED_MIN', ACTIVITY_DESIRED_MIN_DEFAULT);
  }
  return pinnedKcal / (activityMet() * bodyMassKg * kcalPerMetKgMin());
}

// The single rule every activity kcal figure goes through. A Calculate-derived amount2
// wins (it used the real per-exercise MET); otherwise minutes at the Walk MET (activityMet).
function activityEntryKcal(entry, bodyMassKg) {
  if (entry.amount2 !== null) return entry.amount2;
  const mins = toActivityMinutes(entry.amount, entry.unit);
  return bodyMassKg != null ? metKcal(activityMet(), bodyMassKg, mins) : mins * GENERIC_KCAL_PER_ACTIVE_MIN;
}

// Sleep Efficiency Factor: 1 − rate × hours below desired — the per-hour cost a short
// night has on fat-loss efficiency. 1.0 at or above desired, floored at 0 rather than
// going negative on an extreme night. The rate itself is a Tune input (γ,
// SLEEP_DEPRIVATION_PCT_PER_HOUR_KEY), not a constant — this reads whatever's saved (or
// overlaid by the Tune's preview), defaulting to 3%/hr, within the literature's
// 2–3%/hr range. Shared by calorieDesiredDetail (the plan-level intake, below), the
// Calorie Balance / State Trend & Forecast charts' day-by-day reading, and the Sleep
// chart's own dot, so none of them can disagree about what a given night is worth.
const SLEEP_DEPRIVATION_PCT_PER_HOUR_KEY = 'SLEEP_DEPRIVATION_PCT_PER_HOUR';
const SLEEP_DEPRIVATION_PCT_PER_HOUR_DEFAULT = 3;

function sleepEfficiencyFactor(sleepHours, sleepDesiredHours) {
  if (sleepHours === null || sleepHours === undefined || !sleepDesiredHours) return 1;
  const hoursBelow = Math.max(0, sleepDesiredHours - sleepHours);
  const pctPerHour = getSetting(SLEEP_DEPRIVATION_PCT_PER_HOUR_KEY, SLEEP_DEPRIVATION_PCT_PER_HOUR_DEFAULT);
  return Math.max(0, 1 - (pctPerHour / 100) * hoursBelow);
}

// kcal of ground given back to short sleep — (1 - factor) × how far the balance already
// sat from zero, ALWAYS pushed toward the positive (surplus/weight-gain) direction,
// whichever side of zero the balance started on. On a deficit that shrinks it — less of
// it actually became fat loss. On a surplus (or maintenance) it GROWS it instead — short
// sleep drives hunger and cuts NEAT, so someone already eating over maintenance ends up
// further over it, not unaffected. Null with no sleep logged (no basis to apply the
// factor to, not zero). This is the REVERSE question from sleepAdjustedDeficitKcal below
// — "given what was actually eaten, how much did a short night cost or add" rather than
// "how much BIGGER does the planned deficit need to be" — so it always multiplies by
// (1 - factor) rather than dividing. See dailyEnergyBalanceKcal for where this feeds a
// day's actual balance.
function sleepDeprivationKcal(balanceKcal, sleepHours, sleepDesiredHours) {
  if (balanceKcal === null || sleepHours === null || sleepHours === undefined) return null;
  const factor = sleepEfficiencyFactor(sleepHours, sleepDesiredHours);
  return Math.round(Math.abs(balanceKcal) * (1 - factor));
}

// One day's energy balance, effective: intake minus maintenance, activity and TEF, then
// the Sleep Deprivation Effect (see sleepDeprivationKcal) added — a short night makes a
// deficit less negative (less fat lost) and a surplus MORE positive (more gained), since
// the adjustment always pushes toward the positive side regardless of which side the raw
// balance started on. Shared by Calorie Balance and State Trend & Forecast's
// Calorie-Implied Trajectory so the two can't disagree about what a day's shortfall (or
// overshoot) actually cost.
function dailyEnergyBalanceKcal(intake, maintenance, activity, tef, sleepHours, sleepDesiredHours) {
  const rawBalance = intake - maintenance - activity - tef;
  const deprivationKcal = sleepDeprivationKcal(rawBalance, sleepHours, sleepDesiredHours) ?? 0;
  return { rawBalance, deprivationKcal, balance: rawBalance + deprivationKcal };
}

// Never divide the deficit up by more than this — realistic inputs (sleepDesiredHours up
// to a day, planSleepHours ≥ 0) never come close, but a typed extreme shouldn't be able to
// send the desired intake to ±Infinity.
const SLEEP_EFFICIENCY_FACTOR_MIN = 0.2;

// The FORWARD question calorieDesiredDetail asks: given a night that only delivers
// `sleepEfficiencyFactor` of full value, how much BIGGER does the raw deficit need to be
// to still realize `rawDeficitKcal`/day of actual fat loss? Divides rather than
// multiplies — the mirror of sleepDeprivationKcal's reverse (actual-balance) question
// above. Only on an actual deficit; a surplus or maintenance passes through unchanged,
// since poor sleep isn't modelled as making a bulk MORE effective. Shared by
// calorieDesiredDetail and every Tune mode that constructs D from a desired
// rate (EIN/FIXED_PCT/TAU), so none of them can quote a different D for the same inputs.
function sleepAdjustedDeficitKcal(rawDeficitKcal, planSleepHours, sleepDesiredHours) {
  // Read once and carried in the result, rather than re-read by every caller that wants
  // to trace η back to γ — so a typed (unsaved) γ in the Tune reaches the
  // trace the same way it reached the factor, off this one read.
  const pctPerHour = getSetting(SLEEP_DEPRIVATION_PCT_PER_HOUR_KEY, SLEEP_DEPRIVATION_PCT_PER_HOUR_DEFAULT);
  if (rawDeficitKcal === null || rawDeficitKcal <= 0) {
    return { rawDeficitKcal, deficitKcal: rawDeficitKcal, sleepDeprivationEffectKcal: 0, factor: 1, pctPerHour };
  }
  const factor = sleepEfficiencyFactor(planSleepHours, sleepDesiredHours);
  const deficitKcal = rawDeficitKcal / Math.max(factor, SLEEP_EFFICIENCY_FACTOR_MIN);
  return {
    rawDeficitKcal, deficitKcal, sleepDeprivationEffectKcal: Math.round(deficitKcal - rawDeficitKcal), factor, pctPerHour,
  };
}

// The desired intake for ONE body mass: BMR + the burn ACTIVITY_DESIRED_MIN implies − the deficit
// that hits WEEKLY_FAT_LOSS_KG. No lifestyle multiplier, so it agrees with the forecast
// and Calorie Balance. The trade, since no label carries it: BMR + desired activity
// omits food's thermic effect and incidental NEAT, landing near 1.29 x BMR — so a
// former 1.55-multiplier user loses ~475 kcal/day of ceiling, and WEEKLY_FAT_LOSS_KG
// is the dial for it.
//
// Body mass is an argument because both terms scale with it and Caloric Intake evaluates
// per day. Null when an input is missing; the caller falls back to CALORIE_DESIRED_KCAL.
// `storedBmr`: a past day's BMR from its stored cell, used instead of the equation.
function calorieDesiredDetail(bodyMassKg, storedBmr = null) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  // Not getSetting directly: a pinned percentage makes the rate a function of the mass
  // this is being evaluated at, which is what turns a fixed-kg plan into a proportional one
  // everywhere at once — this tile, the per-day chart line, and the Tune's preview.
  const weeklyFatLossKg = weeklyFatLossKgAt(bodyMassKg);

  // Age only when the BMR equation in force actually reads it (see bmrNeedsAge).
  const haveAllInputs = bodyMassKg !== null && weeklyFatLossKg !== null && (storedBmr !== null
    || (heightCm !== null && (age !== null || !bmrNeedsAge()) && (sex === 'male' || sex === 'female')));
  if (!haveAllInputs) return null;

  const bmr = storedBmr ?? applyBmrBasis(bmrKcal(bodyMassKg, heightCm, age, sex));
  const activityKcal = activityDesiredKcal(bodyMassKg);

  // A negative WEEKLY_FAT_LOSS_KG (lean bulk) makes this a surplus and lifts the figure
  // above maintenance, flipping it from a ceiling to a floor. No plausibility guard: an
  // aggressive figure means an aggressive setting, which is the user's call.
  const rawDeficit = (weeklyFatLossKg * GENERIC_KCAL_PER_KG_FAT) / 7;

  // PLAN_SLEEP_HOURS defaults to the desired sleep itself — "assume you hit it" — so an
  // untouched setting keeps this identical to the arithmetic before the sleep model
  // existed. Type fewer hours in the Tune's `s` box and the deficit below
  // grows to compensate for the lost efficiency (see sleepAdjustedDeficitKcal).
  const sleepDesiredHours = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
  const planSleepHours = getSetting('PLAN_SLEEP_HOURS', sleepDesiredHours);
  const {
    deficitKcal: deficit, sleepDeprivationEffectKcal, factor, pctPerHour,
  } = sleepAdjustedDeficitKcal(rawDeficit, planSleepHours, sleepDesiredHours);

  // The TEF divisor is the last step, not a term: digestion's cost is a share of the intake
  // being solved for, so it scales the whole balance rather than being added to one side of
  // it (see tefDivisor). At the default f = 0 it divides by 1 and this is the same figure the
  // app has always produced.
  const divisor = tefDivisor();
  const kcal = Math.round((bmr + activityKcal - deficit) / divisor);

  // Off the ROUNDED intake, so `TEF = f × Eᵢₙ` multiplies out against the Eᵢₙ shown beside it.
  return {
    kcal, bmr, activityKcal, weeklyFatLossKg, rawDeficit, deficit, sleepDeprivationEffectKcal, factor, pctPerHour,
    planSleepHours, sleepDesiredHours, tefKcal: kcal * (1 - divisor), tefDivisor: divisor,
  };
}

// Δm as a share of body mass — the unit the safety literature is written in, and with
// its inverse below the pair the Tune's Δm/Δm% boxes read off each other. Here
// rather than in the Tune because the Health Plan prompt quotes the same figure.
//
// 0.5–1% of body mass per week is the usual sustainable range, and 1% the ceiling:
// above it more of what comes off is lean mass, and the pace rarely holds. It's only
// ever a verdict shown beside the box, never a limit — an aggressive rate is the
// user's call, exactly as calorieDesiredDetail treats one.
const WEEKLY_FAT_LOSS_PCT_FLOOR = 0.5;
const WEEKLY_FAT_LOSS_PCT_CEILING = 1;

function weeklyFatLossPct(weeklyFatLossKg, bodyMassKg) {
  if (weeklyFatLossKg === null || bodyMassKg === null || bodyMassKg <= 0) return null;
  return Math.round((weeklyFatLossKg / bodyMassKg) * 10000) / 100;
}

// The inverse. Three decimals, not two: 1% of 86.9 kg is 0.869 kg/week, and rounding
// that to 0.87 reads back as 1.001% — the two boxes would disagree by a digit every
// time one drove the other.
function weeklyFatLossKgFromPct(pct, bodyMassKg) {
  if (pct === null || bodyMassKg === null) return null;
  return Math.round((pct / 100) * bodyMassKg * 1000) / 1000;
}

// PINNING THE PERCENTAGE: the third way to hold a plan steady, alongside
// CALORIE_DESIRED_FIXED_KCAL. Set it and the weekly kilograms are recomputed from every
// new body-mass reading as a share of THAT mass, so the pace stays proportional to the body doing
// the losing instead of being a fixed number of kilograms.
//
// Its own key rather than a mode flag, and blank means unset, so both pins read the same
// way: whichever key holds a number is the one in force. The two are mutually exclusive —
// they answer the same question from opposite ends — which the Tune enforces by
// writing a blank into the other one whenever it sets either.
const WEEKLY_FAT_LOSS_PCT_PIN_KEY = 'WEEKLY_FAT_LOSS_PCT';

function pinnedWeeklyFatLossPct() {
  return getSetting(WEEKLY_FAT_LOSS_PCT_PIN_KEY, null);
}

// The weekly rate in kg AT a given body mass — the one place the difference between the
// two rate plans lives, so every reader of the rate gets the same answer. Unpinned it's
// the flat WEEKLY_FAT_LOSS_KG this always read; pinned it's a share of that mass, so it
// shrinks as you do. Body mass is an argument because the whole point is that the answer
// depends on it, and Caloric Intake evaluates per day.
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

// A PINNED desired intake: one number that stays put instead of being recalculated from
// each new body-mass reading. Set it and the figure stops tracking body mass — which is
// also what makes the app self-consistent, because the forecast
// (projectHealthyDays) has always solved dm/dt at a CONSTANT Eᵢₙ. A figure that
// steps down with you is a different, faster plan than the one being forecast.
//
// Deliberately its own key rather than reusing CALORIE_DESIRED_KCAL: that one is
// the fallback for an incomplete profile and is already sitting on existing
// sheets, so giving it precedence would silently change desired intake for anyone
// whose copy holds a stale value. Blank here means today's behaviour, unchanged.
const CALORIE_DESIRED_PIN_KEY = 'CALORIE_DESIRED_FIXED_KCAL';

function pinnedCalorieDesiredKcal() {
  return getSetting(CALORIE_DESIRED_PIN_KEY, null);
}

// TODAY's desired intake: the calculated figure at the smoothed body mass, else flat
// CALORIE_DESIRED_KCAL. Only the FIGURE — which side to be on is getCalorieDesiredKind,
// and getCalorieDesired pairs them so no label can carry one without the other.
//
// Smoothed rather than the last reading alone (planBodyMassKg): both terms of the figure
// scale with mass, so a single water-heavy morning would otherwise move the day's calorie
// ceiling by ~30 kcal for no metabolic reason — and it's the same basis the Formula
// Tune previews and saves against, so the tile and the modal can't disagree.
function getCalorieDesiredKcal(entries) {
  return pinnedCalorieDesiredKcal()
    ?? calculatedCalorieDesiredKcal(planBodyMassKg(entries))
    ?? flatCalorieDesiredKcal();
}

// The desired intake per day, each from the body mass in effect THAT day rather than today's
// applied backwards. It moves ~15.8 kcal/kg across both terms, so a 6 kg loss shifts it
// ~95 kcal — enough that one flat line marked days red that were comfortably inside the
// maximum actually applying when they were eaten. Each entry carries its body mass so the
// tooltip can say why the figure moved; null on the flat fallback, which has no basis.
function calorieDesiredSeries(entries, dates) {
  // A pinned figure is one flat line by definition — the whole point is that it
  // didn't move as the body mass under it did. bodyMassKg stays null so the
  // tooltip doesn't claim a body-mass reading explains a figure that ignores them.
  const pinned = pinnedCalorieDesiredKcal();
  if (pinned !== null) return dates.map(() => ({ kcal: pinned, bodyMassKg: null }));

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const bodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(bodyMassEntries), dates);
  const flat = flatCalorieDesiredKcal();

  return dates.map((date) => {
    const bodyMassKg = bodyMassForDate.get(date) ?? null;
    const kcal = calculatedCalorieDesiredKcal(bodyMassKg, storedBmrForDate(date));
    return kcal === null ? { kcal: flat, bodyMassKg: null } : { kcal, bodyMassKg };
  });
}

// Desired intake is directional, not a point to land on — a ceiling heading down, a floor
// heading up. Eating 400 under a bulk's figure is no better than 400 over a cut's, so
// scoring both sides the same way would tell half the users the opposite of the truth.
//
// Direction is healthy body mass vs. the smoothed body mass. With neither, or a healthy mass already
// reached (0.1 kg tolerance), the sign of WEEKLY_FAT_LOSS_KG decides — negative is a bulk, so a
// floor. Nothing at all keeps the ceiling.
//
// Smoothed for a stronger reason than the figure itself: this decides whether the figure is a
// ceiling or a floor, so within 0.1 kg of goal a single noisy reading could flip the whole
// panel's scoring from one day to the next.
function getCalorieDesiredKind(entries) {
  const healthyKg = getSetting('BODY_MASS_HEALTHY_KG', null);
  const currentKg = planBodyMassKg(entries);

  if (healthyKg !== null && currentKg !== null && Math.abs(healthyKg - currentKg) >= 0.1) {
    return healthyKg < currentKg ? 'max' : 'min';
  }

  // Only the sign is read, and a pinned percentage carries the same one — a negative rate
  // is a lean bulk in either plan.
  const weeklyFatLossKg = weeklyFatLossKgAt(currentKg);
  return (weeklyFatLossKg !== null && weeklyFatLossKg < 0) ? 'min' : 'max';
}

// Figure, kind and every display form in one object, so the tile, the chart and the
// Insight prompt can't describe the same number two different ways.
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

// Is a day's intake on the right side of desired? At-or-under a ceiling,
// at-or-over a floor — hitting it exactly counts as met either way.
function withinCalorieDesired(kcal, desired) {
  return desired.isMax ? kcal <= desired.kcal : kcal >= desired.kcal;
}

// Inside this margin a day is neither scored nor condemned — a few percent is within
// the noise of the estimate and of the log itself.
const CALORIE_DESIRED_NEAR_FRACTION = 0.05;

// 'met' on the right side, 'near' within CALORIE_DESIRED_NEAR_FRACTION past it, 'missed'
// beyond. Distance is measured alike for a ceiling and a floor, so a bulk's
// under-eating grades exactly like a cut's over-eating.
function calorieDesiredScore(kcal, desired) {
  if (withinCalorieDesired(kcal, desired)) return 'met';
  return Math.abs(kcal - desired.kcal) <= desired.kcal * CALORIE_DESIRED_NEAR_FRACTION ? 'near' : 'missed';
}

// Least-squares fit. The intercept is only needed by the Body Mass weekly trend,
// which has to EVALUATE the fitted line rather than just report how steep it is.
function linearRegression(xs, ys) {
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

function linearRegressionSlope(xs, ys) {
  return linearRegression(xs, ys).slope;
}

// Over days that actually HAVE a log, not the calendar length of the window.
function avg(map) {
  return [...map.values()].reduce((a, b) => a + b, 0) / map.size;
}

// UTC end to end: `new Date("YYYY-MM-DD")` parses as UTC midnight, and formatting that
// back in local time rolls it back a day in any negative-offset zone.
function parseIsoDateUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// In LOGGED POINTS, not calendar days.
const BODY_MASS_TREND_WINDOW_SIZE = 5;

// Centered moving average: each point is diluted by its neighbours on both sides, so a
// noisy reading doesn't spike — or, with a trailing-only average, drag the line up and
// lag behind afterwards. Windowing by logged points rather than elapsed days smooths
// the same whether entries are daily or sporadic, where a time-decayed average would
// stop smoothing once the gaps approach its decay window.
function smoothBodyMassSeries(values, windowSize) {
  const radius = Math.floor((windowSize - 1) / 2);
  return values.map((_, i) => {
    const windowValues = values.slice(Math.max(0, i - radius), Math.min(values.length, i + radius + 1));
    return windowValues.reduce((a, b) => a + b, 0) / windowValues.length;
  });
}

function computeBodyMassTrend(bodyMassByDate, windowSize = BODY_MASS_TREND_WINDOW_SIZE) {
  const dates = [...bodyMassByDate.keys()].sort();
  const values = dates.map((d) => bodyMassByDate.get(d));
  const smoothed = smoothBodyMassSeries(values, windowSize);

  const trend = new Map();
  smoothed.forEach((v, i) => trend.set(dates[i], v));
  return trend;
}

// The green line's own slope at each of its points, in g/day — a day-to-day kg delta
// swings with whatever water or glycogen moved that reading, but the SMOOTHED line
// barely bends, so its slope is what's left once that noise is averaged out. Centered
// on both neighbours where they exist (divided by the calendar gap between them, since
// logged points aren't always consecutive days); one-sided at either end of the series.
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
    const days = (parseIsoDateUTC(toDate) - parseIsoDateUTC(fromDate)) / 86400000;
    const kgPerDay = (trendMap.get(toDate) - trendMap.get(fromDate)) / days;
    slope.set(d, Math.round(kgPerDay * 1000));
  });
  return slope;
}

// Where the ±swingKg band drawn AROUND the trend line is centered — deliberately
// smoother than the trend line itself, which is already a moving average but can still
// wobble point to point. An exponential moving average of the trend, not a copy of it:
// each step nudges the anchor only a fraction of the way toward the trend's current
// value, so the zone is the visually STABLE thing on the chart and the green line is
// what moves around inside it. That fraction (alpha) is fixed and separate from
// swingKg — swingKg still sets the band's ±WIDTH (how far the trend can wander before a
// wobble stops reading as glycogen), this only sets how fast the band's CENTER drifts.
const GLYCOGEN_ZONE_SMOOTHING_ALPHA = 1 / BODY_MASS_TREND_WINDOW_SIZE;

function computeGlycogenZoneAnchor(trendMap, alpha = GLYCOGEN_ZONE_SMOOTHING_ALPHA) {
  const dates = [...trendMap.keys()].sort();
  const zone = new Map();
  let anchor = null;
  dates.forEach((d) => {
    const v = trendMap.get(d);
    anchor = anchor === null ? v : anchor + alpha * (v - anchor);
    zone.set(d, anchor);
  });
  return zone;
}

// A net change this small over ~10 days is a genuine stall rather than water, sodium or
// cycle. Checked against the SMOOTHED line — raw body-mass readings trip a naive threshold.
const PLATEAU_WINDOW_DAYS = 10;
const PLATEAU_THRESHOLD_KG = 0.3;

// How many days the trend has held flat, or null — either the trend moved, or there
// isn't enough history spanning the window to tell (sparse entries can't confirm 10
// flat days, only fail to disprove them).
function detectPlateau(trendMap) {
  const dates = [...trendMap.keys()].sort();
  if (dates.length < 3) return null;

  const lastDate = dates[dates.length - 1];
  const lastMs = parseIsoDateUTC(lastDate);
  const windowStartMs = lastMs - (PLATEAU_WINDOW_DAYS - 1) * 86400000;
  if (parseIsoDateUTC(dates[0]) > windowStartMs) return null;

  const windowStartDate = dates.find((d) => parseIsoDateUTC(d) >= windowStartMs);
  const change = trendMap.get(lastDate) - trendMap.get(windowStartDate);
  if (Math.abs(change) >= PLATEAU_THRESHOLD_KG) return null;

  return Math.round((lastMs - parseIsoDateUTC(windowStartDate)) / 86400000);
}

// A and B from "Maintenance is affine in body mass — M(m) = A + B×m": the body-mass-
// independent and body-mass-scaling halves of BMR + activity burn. Shared by
// projectHealthyDays (the forward m_g → t direction) and the Tune's reverse
// t → m_g solve, so both read the same A/B rather than two copies of this algebra.
//
// Affine under BOTH BMR equations, which is what lets one decay model serve them. Mifflin is
// affine in m by construction; Katch-McArdle is 370 + 21.6 × LBM and Boer's LBM is itself
// affine in m, so substituting gives 370 + 21.6×(c_h×h + c_0) as the constant half and
// 21.6×c_m as the per-kg one. Age falls out of A entirely there.
//
// TEF divides both halves rather than appearing as a term: maintenance is the intake that
// holds mass steady, and at that intake digestion is costing f of it, so M = (A₀ + B₀m)/(1−f).
// Every consumer — m∞, the decay constant, the reverse solves — therefore gets the thermic
// effect for free, and at the default f = 0 gets exactly today's coefficients.
//
// `formula` and `tef` are parameters defaulting to the saved settings so the Formula
// Tune can preview an unsaved choice through this same function instead of a second
// copy of the algebra. The extra returned parts are for the substituted trace and for
// adaptedPlateauKg, which has to scale the BMR half alone.
function maintenanceAffineCoefficients({
  heightCm, age, sex, met, tau, kappa, formula = bmrFormula(), tef = tefPercent(), bodyMassKg = null,
}) {
  const activityPerKg = (met * tau * kappa) / ML_O2_PER_KCAL;
  const lbm = leanBodyMassCoefficients(sex, heightCm);
  const aBmr = formula === 'katch'
    ? KATCH_BASE_KCAL + KATCH_KCAL_PER_KG_LBM * (lbm.perCm * heightCm + lbm.constant)
    : 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
  const bBmr = formula === 'katch' ? KATCH_KCAL_PER_KG_LBM * lbm.perKg : 10;
  const divisor = tefDivisor(tef);

  // The forecast's own a/b run on whichever BMR basis the Tune's toggle has
  // picked (bmrBasis/applyBmrBasis, above) — TODAY's adaptation fraction held constant for
  // the whole trip (currentAdaptationFraction), since the closed-form decay model needs a
  // fixed A/B, not one that keeps shrinking as the trip goes on. A lower effective BMR
  // means a smaller real deficit at the same intake, so t (and every date built from it)
  // comes out LONGER under bmr_adp, not unchanged — adaptation slows the trip, it doesn't
  // just relabel a box.
  //
  // aBmr/bBmr themselves are returned UN-discounted: adaptedPlateauKg reads them for its
  // own, separate, BY-ARRIVAL adaptation question (how adapted BMR will be BY t, once t is
  // known) — discounting them here too would double-count the same effect.
  //
  // bmr_cal is treated as a MAXIMUM adaptation already reached, the same shape bmr_adp
  // itself uses (a constant FRACTION scaling both terms, not an absolute kcal amount) — just
  // with the fraction measured from Calibrate instead of grown week-by-week from λ. Whatever
  // % below (or above) today's plain equation BMR_cal sits at is taken as a fixed, permanent
  // discount and held there for the WHOLE projection: aBmr and bBmr both scale by the same
  // (1 + calibratedFraction), so BMR still moves with body mass exactly as the equation says,
  // just uniformly discounted — never extrapolated past that measured %, since there's no
  // calibration data for what the discount would be at any other body mass. Falls back to the
  // ordinary shifted-line behavior when bodyMassKg isn't available to measure the fraction
  // against (some callers, e.g. health-insight-plan.js's prompt-formatting path, don't have "today's
  // mass" to hand).
  const basisFraction = currentAdaptationFraction();
  const calibratedOffset = currentCalibratedOffsetKcal();
  let aBmrEff;
  let bBmrEff;
  const equationBmrNow = bodyMassKg === null ? null : aBmr + bBmr * bodyMassKg;
  if (bmrBasis() === 'bmr_cal' && equationBmrNow) {
    const calibratedFraction = calibratedOffset / equationBmrNow;
    aBmrEff = aBmr * (1 + calibratedFraction);
    bBmrEff = bBmr * (1 + calibratedFraction);
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

// Where the mass actually levels off once BMR has adapted — the same m∞ = (Eᵢₙ − A)/B, with
// the BMR half of each coefficient scaled by (1 − λt) and the activity half left alone:
// adaptation is a resting-metabolism effect, not a cheaper workout. Above the un-adapted m∞
// whenever λt > 0, and the difference is the overshoot the plain model hides.
function adaptedPlateauKg(intakeKcal, coefficients, adaptFraction) {
  const { aBmr, bBmr, activityPerKg, tefDivisor: divisor } = coefficients;
  const remaining = 1 - adaptFraction;
  return (intakeKcal - (remaining * aBmr) / divisor)
    / ((remaining * bBmr + activityPerKg) / divisor);
}

// The DESIRED trajectory — eating exactly Eᵢₙ and hitting ACTIVITY_DESIRED_MIN every
// day. Shared with the Tune, so its printed A / B / m∞ / t and the chart's
// forecast are one piece of arithmetic rather than two that can disagree.
//
// Closed form of dm/dt = (Eᵢₙ − A − B·m)/ρ, not a day-by-day loop: it's a linear ODE, so
// the exact answer is one log. Verified against numeric integration.
//
// Works both directions — a surplus puts m∞ above m and the same log gives days to gain
// — but only reaches masses BETWEEN m and m∞. Past the asymptote is genuinely
// unreachable at that intake, and is reported rather than extrapolated.
// `formula` and `tef` ride along unread except to reach maintenanceAffineCoefficients, so
// the Tune's unsaved BMR equation and thermic share reach the forecast the same way
// they reach A and B. Omitted by the settings-driven callers, which get the saved pair.
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
  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  // decayPerKg is the coefficient of the exponential the chart draws, which for THIS
  // journey is B itself. It's named separately because the proportional journey below
  // decays at a rate that has nothing to do with maintenance, and both feed one curve.
  return { a, b, decayPerKg: b, equilibriumKg, days, etaIso: isoFromDate(eta), status: 'ok', journey: 'intake' };
}

// The OTHER desired trajectory: the one a pinned percentage describes. Δm = p·m/100 every
// week, so the mass falls by a constant FRACTION rather than a constant number of
// kilograms — m(t) = m × (1 − p/100)^(t/7), i.e. dm/dt = −k·m with k = −ln(1 − p/100)/7
// per day. Returned in projectHealthyDays' shape, with m∞ = 0, because the two are the same
// exponential with different coefficients: one curve-drawing routine serves both.
//
// No plateau, and therefore no 'unreachable' for a real rate — a constant fraction off a
// falling mass always crosses any positive healthy mass eventually, which is exactly what makes
// this the one plan that can't stall short of the goal. A rate of zero or less is the only
// thing that never arrives, and the caller keeps it out (see healthyProjection).
function projectHealthyDaysAtFixedPct({ bodyMassKg, healthyKg, weeklyPct }) {
  const base = { decayPerKg: 0, equilibriumKg: 0, journey: 'pct' };
  if (Math.abs(bodyMassKg - healthyKg) < BODY_MASS_AT_HEALTHY_TOLERANCE_KG) {
    return { ...base, status: 'reached' };
  }

  // Per DAY, from the per-week fraction: the weekly figure is what's set, but every
  // consumer of this — the curve, the day count — works in days.
  const kPerDay = -Math.log(1 - weeklyPct / 100) / 7;
  const decayPerKg = kPerDay * GENERIC_KCAL_PER_KG_FAT;
  const days = Math.log(bodyMassKg / healthyKg) / kPerDay;
  if (!Number.isFinite(days) || days <= 0) {
    // There are only two ways a constant positive share never arrives, and neither is a
    // plateau — so the reason travels with the result: the display has no equilibrium figure
    // to describe here the way the constant-Eᵢₙ journey's 'unreachable' does.
    return {
      ...base,
      status: 'unreachable',
      reason: weeklyPct > 0
        ? 'the healthy body mass is not below your current body mass'
        : 'a rate of 0% or less never moves the mass',
    };
  }

  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  return { ...base, decayPerKg, days, etaIso: isoFromDate(eta), status: 'ok' };
}

// The desired trajectory in whichever journey the pins currently describe — the single
// entry point the chart and the Health Plan prompt both go through, so a pinned percentage
// can't move the arrival date in one of them and not the other. A and B are merged in
// either way: they describe maintenance, which is true regardless of which journey is
// being walked, and the chart reads them for the rate note.
//
// pct > 0 only. A pinned zero or negative percentage is a hold or a bulk, and the
// constant-Eᵢₙ form below already handles both — including reporting a healthy mass below the
// plateau as unreachable, which the proportional form has no way to express.
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

// The same desired trajectory from saved Settings rather than the Tune's live inputs,
// so the two agree whenever its boxes still hold what's on the sheet. Null without a profile.
function healthyProjectionFromSettings(entries, bodyMassKg, healthyKg) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  if (heightCm === null || (age === null && bmrNeedsAge()) || (sex !== 'male' && sex !== 'female')) return null;

  return healthyJourneyProjection({
    // Eᵢₙ itself: the calculated desired intake is exactly what the Tune computes.
    intakeKcal: getCalorieDesiredKcal(entries),
    bodyMassKg,
    heightCm,
    age,
    sex,
    met: activityMet(),
    tau: getSetting('ACTIVITY_DESIRED_MIN', ACTIVITY_DESIRED_MIN_DEFAULT),
    kappa: getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT),
    healthyKg,
  });
}

function calcProjection(entries) {
  const bodyMassHealthy = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  // The figure only; which side to be on doesn't enter this arithmetic. Stands in as
  // the intake level when nothing has been logged.
  const calorieDesired = getCalorieDesiredKcal(entries);
  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = isoFromDate(today);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - 14);
  const cutoffIso = isoFromDate(cutoff);

  const bodyMassEntries = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bodyMassEntries.length < 2) return null;

  const lastBodyMass = bodyMassEntries[bodyMassEntries.length - 1].amount;
  // planBodyMassKg (m̄), not the raw last reading — per its own definition, this is the
  // mass every PLAN-level figure is evaluated at, the Tune's own bodyMassKg
  // included, so the desired method's day count and ETA below can't disagree with what
  // the Tune prints for the same profile.
  const planMass = planBodyMassKg(entries) ?? lastBodyMass;

  const arrivalHealthy = arrivalHealthyKg(
    bodyMassHealthy, planMass, getSetting('HEIGHT_CM', null), getSettingString('SEX', null),
    bodyMassHealthyIsDownward(entries),
  );

  // The DESIRED plan wins whenever the profile allows it — read straight off healthyProjection,
  // the exact projectHealthyDays / projectHealthyDaysAtFixedPct result the Formula
  // Tune's own t and ETA come from (via healthyProjectionFromSettings), not a second
  // copy of the day-count formula. That makes the forecast a statement of the plan, not
  // of recent behaviour: eat over desired intake for a fortnight and it does NOT slip.
  // Calorie Balance is where actual-vs-desired shows day by day.
  const healthyProjection = healthyProjectionFromSettings(entries, planMass, arrivalHealthy);
  if (healthyProjection !== null) {
    if (healthyProjection.status === 'reached') return { status: 'reached' };

    // Rate at m̄, for the ETA line's note — the same mass t was solved from.
    const slope = (calorieDesired - (healthyProjection.a + healthyProjection.b * planMass)) / GENERIC_KCAL_PER_KG_FAT;

    if (healthyProjection.status === 'unreachable') {
      return { status: 'asymptote', method: 'healthy', slope, equilibriumKg: healthyProjection.equilibriumKg };
    }

    // status === 'ok': today + the exact day count projectHealthyDays solved, not a
    // re-derivation of it — same rounding, so the ETA can't land a day off from the
    // Tune's.
    const daysToHealthy = Math.round(healthyProjection.days);
    const etaDate = new Date(today);
    etaDate.setDate(today.getDate() + daysToHealthy);

    // m(t) = m∞ + (m − m∞)·e^(−decay·t/ρ), the curve those same coefficients trace.
    const bodyMassAtDay = (d) => healthyProjection.equilibriumKg
      + (planMass - healthyProjection.equilibriumKg) * Math.exp(-(healthyProjection.decayPerKg * d) / GENERIC_KCAL_PER_KG_FAT);

    const cappedDays = Math.min(daysToHealthy, 365);
    const projectedPoints = [];
    for (let d = 0; d <= cappedDays; d += 7) {
      const pd = new Date(today);
      pd.setDate(today.getDate() + d);
      projectedPoints.push({ date: isoFromDate(pd), bodyMass: Math.round(bodyMassAtDay(d) * 10) / 10 });
    }
    if (daysToHealthy <= 365) {
      projectedPoints.push({ date: isoFromDate(etaDate), bodyMass: Math.round(arrivalHealthy * 10) / 10 });
    }

    return {
      status: 'ok',
      slope,
      daysToHealthy,
      etaDate,
      projectedPoints,
      method: 'healthy',
      bodyMassHealthy,
      equilibriumKg: healthyProjection.equilibriumKg,
    };
  }

  // No profile: the plan can't be projected at all, so fall back to what the LOGGED
  // behaviour of the last 14 days implies instead.
  const recentEntries = entries.filter((e) => e.date >= cutoffIso && e.date <= todayIso);

  const caloriesByDate = new Map();
  const activityKcalByDate = new Map();
  const sleepByDate = new Map();

  recentEntries.forEach((e) => {
    if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
      const kcal = activityEntryKcal(e, latestBodyMassKg(entries));
      activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
    } else if (e.category === 'Sleep' && e.amount !== null) {
      sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
    }
  });

  let slope;
  let method;
  // The exponential model's coefficients; null means project as a straight line.
  let decay = null;

  if (caloriesByDate.size > 0 || activityKcalByDate.size > 0) {
    const avgCalories = caloriesByDate.size > 0 ? avg(caloriesByDate) : calorieDesired;
    const avgActivityKcal = activityKcalByDate.size > 0 ? avg(activityKcalByDate) : 0;
    const avgSleep = sleepByDate.size > 0 ? avg(sleepByDate) : sleepDesired;

    // Negative balance = deficit = loss. Against MAINTENANCE, not calorieDesired: the
    // figure is already maintenance minus the desired deficit, so eating exactly it
    // produced a ~zero balance and a "no net change" forecast — precisely when the
    // desired loss should have been delivered. Same shape as desired intake's own basis,
    // differing only in the activity figure: logged burn here, desired burn there.
    const resting = restingMaintenanceKcal(entries);
    const maintenance = resting !== null
      ? resting + avgActivityKcal
      // No profile, so no BMR and no calculated figure — the flat CALORIE_DESIRED_KCAL
      // the user chose directly is the best baseline available.
      : calorieDesired + avgActivityKcal;

    const balance = avgCalories - maintenance;
    const baseSlope = balance / GENERIC_KCAL_PER_KG_FAT;
    const sleepRatio = Math.min(1.0, Math.max(0.7, avgSleep / sleepDesired));
    slope = baseSlope * sleepRatio;

    // Maintenance is affine in body mass, not constant, so a fixed intake decays
    // exponentially toward the body mass where that intake IS maintenance. Both terms
    // scale with mass: BMR by its 10·m coefficient, logged burn because metKcal is
    // proportional to body mass. Needs a profile — without a BMR there's no A/B to split
    // maintenance into, so `decay` stays null and the straight line is used.
    if (resting !== null && lastBodyMass > 0) {
      const perKg = 10 + avgActivityKcal / lastBodyMass;
      const bodyMassIndependent = maintenance - perKg * lastBodyMass;
      decay = {
        perKg,
        // Sleep scales the rate, so it divides the energy density rather than entering
        // the equilibrium — same destination, different speed of arrival.
        kcalPerKg: GENERIC_KCAL_PER_KG_FAT / sleepRatio,
        equilibriumKg: (avgCalories - bodyMassIndependent) / perKg,
      };
    }

    // The formula scales by sleep, so a missing sleep log really is partial data.
    const allPresent = caloriesByDate.size > 0 && activityKcalByDate.size > 0 && sleepByDate.size > 0;
    method = allPresent ? 'full' : 'partial';
  } else {
    const src = bodyMassEntries.filter((e) => e.date >= cutoffIso);
    const data = src.length >= 2 ? src : bodyMassEntries;
    slope = linearRegressionSlope(data.map((_, i) => i), data.map((e) => e.amount));
    method = 'body-mass-only';
  }

  // Reported even with no forecast, so the ETA line can show the rate instead of a bare
  // "projection unavailable".
  if (slope === 0) return { status: 'no-change', method, slope };

  // lastBodyMass, not planMass: these methods' own slope/equilibrium above were fitted
  // from the actual latest reading (see resting/perKg/bodyMassIndependent), so the curve
  // has to start from the same point they describe. Only the 'healthy' method (returned
  // above already) is measured at m̄.
  const goingDown = arrivalHealthy < lastBodyMass;
  if ((goingDown && slope > 0) || (!goingDown && slope < 0)) return { status: 'wrong-direction', method, slope };

  // A fixed intake only ever carries you to its own equilibrium, so a healthy mass on the far
  // side is never reached. The straight line always produced a date regardless, which
  // is what this status exists to report.
  if (decay !== null) {
    const gapNow = lastBodyMass - decay.equilibriumKg;
    const gapHealthy = arrivalHealthy - decay.equilibriumKg;
    if (gapHealthy / gapNow <= 0) {
      return { status: 'asymptote', method, slope, equilibriumKg: decay.equilibriumKg };
    }
  }

  // The straight line's division, or the closed form t = (ρ/B)·ln[(m − m∞)/(m_g − m∞)].
  const daysToHealthy = decay !== null
    ? Math.round((decay.kcalPerKg / decay.perKg)
      * Math.log((lastBodyMass - decay.equilibriumKg) / (arrivalHealthy - decay.equilibriumKg)))
    : Math.round((arrivalHealthy - lastBodyMass) / slope);
  const etaDate = new Date(today);
  etaDate.setDate(today.getDate() + daysToHealthy);

  // m(t) = m∞ + (m − m∞)·e^(−B·t/ρ) for the curve, m + slope·t for the line.
  const bodyMassAtDay = (d) => (decay !== null
    ? decay.equilibriumKg + (lastBodyMass - decay.equilibriumKg) * Math.exp(-(decay.perKg * d) / decay.kcalPerKg)
    : lastBodyMass + slope * d);

  const cappedDays = Math.min(daysToHealthy, 365);
  const projectedPoints = [];
  for (let d = 0; d <= cappedDays; d += 7) {
    const pd = new Date(today);
    pd.setDate(today.getDate() + d);
    projectedPoints.push({ date: isoFromDate(pd), bodyMass: Math.round(bodyMassAtDay(d) * 10) / 10 });
  }
  if (daysToHealthy <= 365) {
    projectedPoints.push({ date: isoFromDate(etaDate), bodyMass: Math.round(arrivalHealthy * 10) / 10 });
  }

  return {
    status: 'ok',
    slope,
    daysToHealthy,
    etaDate,
    projectedPoints,
    method,
    bodyMassHealthy,
    equilibriumKg: decay !== null ? decay.equilibriumKg : null,
  };
}
