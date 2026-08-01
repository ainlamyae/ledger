// "Tune" in the Health Indicators heading: shows the daily calorie target as a
// formula with its tunable inputs editable, recomputes as you type, and can write
// the values back to the Settings tab.
//
// A "Solve for" radio picks which one quantity is the unknown — everything else
// on the sheet becomes a known you type in, and that one field goes readonly and
// shows the answer. Eᵢₙ (calories) and t (days to m_g) are two more fields
// alongside the rest, not a fixed pair of results: whether each is typed or
// computed depends on the mode, and for TAU/DELTA_M on which one you last
// typed into (see computedIdsForMode below).
//
// The point is that the target is the one number in the app derived from settings
// you can't see the effect of until you save them — this makes the arithmetic and
// the sensitivity visible first, in whichever direction you actually want it. It
// computes with the SAME functions the charts use (calorieTargetDetail,
// projectTargetDays, maintenanceAffineCoefficients, via a temporary settings
// overlay), so the preview can't drift from what saving would actually produce.

// Editable rows: the Settings key, its input, and the fallback shown when the key
// isn't set. Order matches the formula's own term order. Every one of these can
// also become the computed field (see FORMULA_SOLVE_FIELD_ID) except κ, which
// stays a plain input in every mode — a technical constant, not something
// anyone solves for.
const FORMULA_FIELDS = [
  { key: 'KCAL_PER_MET_KG_MIN', inputId: 'formula-met-o2', fallback: () => MET_ML_O2_PER_KG_MIN_DEFAULT },
  // Walk's own catalogue MET (Edit Activity), not the ACTIVITY_MET setting — the
  // Activity sheet row is the one place that number is actually maintained.
  { key: 'ACTIVITY_MET', inputId: 'formula-met', value: () => exerciseMet('Walk') },
  { key: 'ACTIVITY_TARGET_MIN', inputId: 'formula-activity-min', fallback: () => ACTIVITY_TARGET_MIN_DEFAULT },
  // No default: an unset WEEKLY_FAT_LOSS_KG is exactly what makes the target
  // uncomputable and sends the charts to the flat CALORIE_TARGET_KCAL, so the
  // playground opens on 0 (maintenance) rather than inventing a deficit.
  { key: 'WEEKLY_FAT_LOSS_KG', inputId: 'formula-weekly-loss', fallback: () => 0 },
  { key: 'BODY_MASS_TARGET_KG', inputId: 'formula-target', fallback: () => BODY_MASS_TARGET_KG_DEFAULT },
  // In this list, not the two below it: f divides the whole intake identity, so a blank
  // one leaves Eᵢₙ genuinely uncomputable rather than merely undecorated.
  { key: TEF_PERCENT_KEY, inputId: 'formula-tef-pct', fallback: () => TEF_PERCENT_DEFAULT },
];

// Metabolic adaptation's pair, kept out of FORMULA_FIELDS for the same reason the protein
// band is: λ feeds only the two reported rows (BMR_a and the adapted plateau), so a blank
// one should stop those from being shown, never stop the target from being computed.
const ADAPT_FORMULA_FIELDS = [
  { key: ADAPT_PCT_PER_WEEK_KEY, inputId: 'formula-adapt-per-week', fallback: () => ADAPT_PCT_PER_WEEK_DEFAULT },
  { key: ADAPT_PCT_CAP_KEY, inputId: 'formula-adapt-cap', fallback: () => ADAPT_PCT_CAP_DEFAULT },
];

// The lean-mass protein band: its own pair of fields, kept out of FORMULA_FIELDS on
// purpose. Those are read unconditionally and a blank one invalidates the whole calorie
// preview — but protein feeds nothing in the calorie identities, so an empty p_min
// should only stop protein from being computed and saved, not the target.
const PROTEIN_FORMULA_FIELDS = [
  { key: 'PROTEIN_G_PER_KG_LBM_MIN', inputId: 'formula-protein-per-kg-min', fallback: () => PROTEIN_G_PER_KG_LBM_MIN_DEFAULT },
  { key: 'PROTEIN_G_PER_KG_LBM_MAX', inputId: 'formula-protein-per-kg-max', fallback: () => PROTEIN_G_PER_KG_LBM_MAX_DEFAULT },
];

// The fiber band's two coefficients, kept out of FORMULA_FIELDS for the same reason as
// PROTEIN_FORMULA_FIELDS: fiber feeds no calorie identity, so a blank one should only stop
// fiber from being computed and saved, not the target.
const FIBER_FORMULA_FIELDS = [
  { key: 'FIBER_G_PER_1000_KCAL_MIN', inputId: 'formula-fiber-per-1000kcal-min', fallback: () => FIBER_G_PER_1000_KCAL_MIN_DEFAULT },
  { key: 'FIBER_G_PER_KG_MAX', inputId: 'formula-fiber-per-kg-max', fallback: () => FIBER_G_PER_KG_MAX_DEFAULT },
];

// The fat band's two coefficients, kept out of FORMULA_FIELDS for the same reason as
// FIBER_FORMULA_FIELDS: fat feeds no calorie identity, so a blank one should only stop
// fat from being computed and saved, not the target.
const FAT_FORMULA_FIELDS = [
  { key: 'FAT_PCT_OF_KCAL_MIN', inputId: 'formula-fat-pct-min', fallback: () => FAT_PCT_OF_KCAL_MIN_DEFAULT },
  { key: 'FAT_PCT_OF_KCAL_MAX', inputId: 'formula-fat-pct-max', fallback: () => FAT_PCT_OF_KCAL_MAX_DEFAULT },
];

// The carb band's two coefficients, kept out of FORMULA_FIELDS for the same reason as
// FAT_FORMULA_FIELDS: carb feeds no calorie identity, so a blank one should only stop
// carb from being computed and saved, not the target.
const CARB_FORMULA_FIELDS = [
  { key: 'CARB_PCT_OF_KCAL_MIN', inputId: 'formula-carb-pct-min', fallback: () => CARB_PCT_OF_KCAL_MIN_DEFAULT },
  { key: 'CARB_PCT_OF_KCAL_MAX', inputId: 'formula-carb-pct-max', fallback: () => CARB_PCT_OF_KCAL_MAX_DEFAULT },
];

// Which box each "Solve for" radio value fills in. Activity intensity (MET)
// isn't offered as a solvable target — only τ, on the activity side, is.
const FORMULA_SOLVE_FIELD_ID = {
  EIN: 'formula-ein',
  TARGET_MASS: 'formula-target',
  TAU: 'formula-activity-min',
  DELTA_M: 'formula-weekly-loss',
};

// Every box that can go readonly in some mode — the five solvable fields plus
// Eᵢₙ and t, which follow whichever is picked rather than having their own radio.
// formula-eta (the estimated-arrival date) always tracks formula-days: the two
// are just two views of the same t, so they're always both typed or both
// computed together — never listed separately below.
// formula-weekly-loss-pct is on the list for the opposite reason to formula-eta: it's
// never typed in DELTA_M mode, where Δm is the answer, so the percentage is an answer
// too and the box has to go readonly with it.
// formula-target-bmi is on the list for the same reason formula-weekly-loss-pct is: in
// TARGET_MASS the kilograms are the answer, so the BMI they come to is an answer too and the
// box has to go readonly with them.
const FORMULA_TOGGLE_IDS = [...Object.values(FORMULA_SOLVE_FIELD_ID), 'formula-days', 'formula-eta', 'formula-weekly-loss-pct', 'formula-target-bmi'];

// Which fields are computed in EIN and TARGET_MASS — fixed, unlike TAU and
// DELTA_M below, which let you type either Eᵢₙ or t and compute whichever
// you didn't touch.
// FIXED_PCT is the one mode named for what it HOLDS rather than what it solves: Δm% is
// the typed input and everything the rate feeds is computed from it — the kilograms, the
// intake, and the day count. Which makes it EIN's twin, differing only in that Δm comes
// from a share of body mass and the journey is proportional rather than constant-intake.
const FORMULA_COMPUTED_IDS = {
  EIN: ['formula-ein', 'formula-days', 'formula-eta'],
  TARGET_MASS: ['formula-target', 'formula-target-bmi'],
  FIXED_PCT: ['formula-weekly-loss', 'formula-ein', 'formula-days', 'formula-eta'],
};

// For TAU and DELTA_M, either Eᵢₙ or t can be the known that drives the solve
// — whichever you last typed into. Tracked per mode (not reset when you
// switch radios and back) so it remembers which one you were using. Defaults
// match each mode's original, single-direction behavior until you type into
// the other box: TAU opens on a typed Eᵢₙ, DELTA_M on a typed day count.
const dualKnownField = { TAU: 'ein', DELTA_M: 'days' };

// The same idea for Δm, which also has two boxes: kg/week and % of current body mass
// per week. One quantity in two units, like t and its arrival date, so whichever you last
// typed into is the known and the other is rewritten from it on every render.
//
// Two modes overrule the memory, in opposite directions: DELTA_M solves for Δm, so both
// boxes are answers and neither is typed; FIXED_PCT is defined by holding the percentage,
// so it's typed there whatever you last touched.
let weeklyLossKnownField = 'kg';   // 'kg' | 'pct'

// The same idea again for the target body mass, which also has two boxes: kilograms and the
// BMI they come to at this height. One quantity in two units, so whichever you last typed
// into is the known and the other is rewritten from it on every render.
//
// One mode overrules the memory: TARGET_MASS solves for m_g, so both boxes are answers and
// neither is typed. (There's no FIXED_PCT-style counterpart pinning the BMI — nothing in the
// app holds a BMI still, so there's nothing to overrule it in the other direction.)
let targetMassKnownField = 'kg';   // 'kg' | 'bmi'

function targetBmiIsTyped() {
  if (currentSolveFor() === 'TARGET_MASS') return false;
  return targetMassKnownField === 'bmi';
}

function weeklyLossPctIsTyped() {
  const mode = currentSolveFor();
  if (mode === 'FIXED_PCT') return true;
  if (mode === 'DELTA_M') return false;
  return weeklyLossKnownField === 'pct';
}

function currentPinMode() {
  return document.querySelector('input[name="formula-pin-mode"]:checked').value;
}

// Which BMR equation the preview is running. Both are first-class: this is read into the
// settings overlay so calorieTargetDetail and activityTargetKcal see it, and passed
// explicitly to maintenanceAffineCoefficients, which is called outside the overlay.
function currentBmrFormula() {
  return document.querySelector('input[name="formula-bmr-formula"]:checked').value;
}

// The mass every identity on this sheet is evaluated at — the smoothed box, never the raw
// weigh-in above it. One accessor rather than a dozen getElementById calls so there is
// exactly one place that decides which of the two rows the formulas read.
function formulaBodyMassKg() {
  return formulaNumber('formula-body-mass-smooth');
}

// The percentage in play this render: the typed one wherever the percentage is what's held,
// otherwise the one the kilograms imply. Every consumer goes through this — the box, the
// trace and the journey the day count is measured along — so the three can't quote
// different rates, and none of them reads a box a keystroke behind the kilograms.
function weeklyLossPctInPlay(weeklyLossKg, bodyMassKg) {
  return weeklyLossPctIsTyped()
    ? formulaNumber('formula-weekly-loss-pct')
    : weeklyFatLossPct(weeklyLossKg, bodyMassKg);
}

// The selected radio's own field is always computed, plus exactly one of
// {Eᵢₙ, t} — never both, never neither — for whichever this mode's OTHER
// field is (dualKnownField picks it for TAU/DELTA_M; EIN and TARGET_MASS have
// no choice to make, see FORMULA_COMPUTED_IDS above).
function computedIdsForMode(mode) {
  if (mode === 'TAU') {
    return dualKnownField.TAU === 'ein'
      ? ['formula-activity-min', 'formula-days', 'formula-eta']
      : ['formula-activity-min', 'formula-ein'];
  }
  if (mode === 'DELTA_M') {
    return dualKnownField.DELTA_M === 'ein'
      ? ['formula-weekly-loss', 'formula-weekly-loss-pct', 'formula-days', 'formula-eta']
      : ['formula-weekly-loss', 'formula-weekly-loss-pct', 'formula-ein'];
  }
  return FORMULA_COMPUTED_IDS[mode];
}

function currentSolveFor() {
  return document.querySelector('input[name="formula-solve-for"]:checked').value;
}

// Eᵢₙ, t, and its date box: in TAU and DELTA_M, whichever of these isn't
// currently driving the solve is still the one you'd click into to switch
// which one does — so it can't be truly readonly there, unlike everywhere
// else a field is "computed". It's marked with this class instead, which
// gets the same dashed/highlighted look .formula-row input:read-only does,
// without blocking interaction.
const FORMULA_DUAL_FIELD_IDS = ['formula-ein', 'formula-days', 'formula-eta'];

function applySolveForMode(mode) {
  const computed = new Set(computedIdsForMode(mode));
  const isDualMode = mode === 'TAU' || mode === 'DELTA_M';
  FORMULA_TOGGLE_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (isDualMode && FORMULA_DUAL_FIELD_IDS.includes(id)) {
      el.readOnly = false;
      el.classList.toggle('formula-field-computed', computed.has(id));
    } else {
      el.readOnly = computed.has(id);
      el.classList.remove('formula-field-computed');
    }
  });
}

// Broken into its named terms rather than shown as one long line: each is a
// separate published formula with its own source, and the substituted figures
// below are labelled with the same symbols so the two read together. Stays fixed
// regardless of "Solve for" — every mode is a rearrangement of this same set of
// identities, and the substituted trace below is what shows which rearrangement
// actually ran. No blank lines between the blocks — the four-space indent on
// every formula line is what separates it from the heading above it, so the
// spacers only added height.
const FORMULA_EXPRESSION = `Smoothing the scale — daily weight carries water and glycogen, m(t) means clean mass
    m̄    =  (1/7) × Σ m(t−i),  i = 0…6
Lean body mass — Boer (1984)
    LBM  =  0.407×m  +  0.267×h  −  19.2      (♂)
    LBM  =  0.252×m  +  0.473×h  −  48.3      (♀)
Resting metabolic rate — Katch-McArdle (1996), from lean mass instead of age/sex
    BMR  =  370  +  21.6×LBM
Resting metabolic rate — Mifflin-St Jeor (1990)
    BMR  =  10×m  +  6.25×h  −  5×a  +  σ
Activity burn at the daily target — ACSM metabolic equation
    Eₐ   =  MET × m × τ × κ / ε
Weekly fat loss as a share of body mass — 0.5–1%/week band
    Δm%  =  100 × Δm / m
Daily energy deficit implied by the weekly fat-loss target
    D    =  (Δm × ρ) / 7
Thermic effect of food — a share of the very intake being solved for
    TEF  =  f × Eᵢₙ
Target daily intake — TEF folded in by solving, not by adding
    Eᵢₙ  =  BMR  +  Eₐ  +  TEF  −  D    =    (BMR  +  Eₐ  −  D) / (1 − f)
The target body mass as a BMI — 18.5–24.9 healthy band
    BMI_g =  m_g / (h/100)²
Maintenance is affine in body mass — M(m) = A + B×m
    A    =  (6.25×h  −  5×a  +  σ) / (1 − f)           under Mifflin
    B    =  (10  +  MET × τ × κ / ε) / (1 − f)         under Mifflin
    A    =  (370  +  21.6×(c_h×h + c_0)) / (1 − f)     under Katch
    B    =  (21.6×c_m  +  MET × τ × κ / ε) / (1 − f)   under Katch
Body mass at which Eᵢₙ becomes maintenance
    m∞   =  (Eᵢₙ  −  A) / B
Exponential decay toward m∞, not linear loss
    m(t) =  m∞  +  (m − m∞) × e^(−B×t/ρ)
    t    =  (ρ / B) × ln[ (m − m∞) / (m_g − m∞) ]
Proportional journey instead, when Δm% is what's held — no plateau, so no m∞
    m(t) =  m × (1 − Δm%/100)^(t/7)
    t    =  7 × ln(m / m_g) / −ln(1 − Δm%/100)
Metabolic adaptation — BMR sags faster than the lost mass alone predicts
    BMR_a(t) = BMR × (1 − λt),  λt capped at λt_max ≈ 10–15% by week 10–12
    m∞_a =  (Eᵢₙ − A_a) / B_a,  the BMR half of A and B scaled by (1 − λt)
Skeletal muscle mass — the fraction of LBM that actually stores glycogen
    m_musc =  s × LBM
Glycogen store, from muscle mass
    m_gly  =  g_musc × m_musc  +  g_liver
Glycogen-bound water — the swing glycogen alone accounts for, not fat
    ΔM_gly =  m_gly × (1 + r) / 1000
Daily protein band, scaled to lean mass
    P_min =  p_min × LBM
    P_max =  p_max × LBM
Fiber band — a floor from daily intake, a ceiling from body weight
    F_min =  f_min × (Eᵢₙ / 1000)
    F_max =  f_max × m
Fat band — both ends a share of intake, 20-35% AMDR
    G_min =  (k_min/100 × Eᵢₙ) / 9
    G_max =  (k_max/100 × Eᵢₙ) / 9
Carb band — both ends a share of intake, 45-65% AMDR
    C_min =  (q_min/100 × Eᵢₙ) / 4
    C_max =  (q_max/100 × Eᵢₙ) / 4`;

function formulaFieldValue(field) {
  // `value` skips Settings entirely — for fields (like Activity Intensity) whose
  // real source is somewhere else on the sheet, not a Settings key.
  if (field.value) return field.value();
  return getSetting(field.key, null) ?? field.fallback();
}

// Runs fn with `currentSettings` overlaid by the playground's edits, so the
// preview goes through the real calorieTargetDetail/metKcal path instead of a
// second copy of the arithmetic that could disagree with it.
function withFormulaOverrides(overrides, fn) {
  const saved = currentSettings;
  currentSettings = { ...currentSettings, ...overrides };
  try {
    return fn();
  } finally {
    currentSettings = saved;
  }
}

function formulaNumber(inputId) {
  const raw = document.getElementById(inputId).value.trim();
  const num = Number(raw);
  return (raw === '' || Number.isNaN(num)) ? null : num;
}

// Writes a computed answer into a box, masked like every other derived figure
// when privacy mode is on. Never used for a box the user is currently typing
// into — only for whichever field the current mode just solved.
function setComputedField(inputId, text) {
  document.getElementById(inputId).value = privacyMode ? maskDigits(text) : text;
}

// A BIRTH_DATE that reads back as exactly `age` whole years, so the preview can
// drive the real ageFromBirthDate path instead of a second copy of the formula
// that takes an age directly. Feb 29 is clamped to the 28th, which is the one
// date where subtracting years would roll into March and lose a year.
function birthDateForAge(age) {
  const today = new Date();
  const month = today.getMonth();
  const day = (month === 1 && today.getDate() === 29) ? 28 : today.getDate();
  return isoFromDate(new Date(today.getFullYear() - age, month, day));
}

// today + days, as the exact ISO date an <input type="date"> box needs — the
// inverse of daysFromTodayIso below. setDate rather than raw ms arithmetic, so
// this can't land on the wrong side of a DST change.
function isoDateFromDays(days) {
  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  return isoFromDate(eta);
}

// The inverse: how many days from today a typed/picked date is. Both ends go
// through parseIsoDateUTC (UTC midnight, not local) rather than subtracting
// two `Date` objects directly — a local-time subtraction is off by one on the
// two days a year local midnight isn't exactly 24h away from the next one.
function daysFromTodayIso(dateIso) {
  return Math.round((parseIsoDateUTC(dateIso) - parseIsoDateUTC(isoFromDate(new Date()))) / 86400000);
}

// Every box maps to a Settings key except current body mass, which is a Physique
// measurement — it belongs here because both terms of the formula scale with it,
// but there is no setting to write it to. Eᵢₙ and t are never settings-backed in
// any mode (see the module comment) so they're read separately from
// FORMULA_FIELDS and never enter `overrides`.
//
// `preview` always carries the typed age as a BIRTH_DATE so the calculation runs
// through the real ageFromBirthDate path; `overrides` (what Save writes) only
// includes BIRTH_DATE when the typed age actually differs from the stored date's,
// so saving an untouched age can't replace a real birth date with a synthetic one
// that merely happens to yield the same number of years.
//
// FORMULA_FIELDS is read unconditionally regardless of mode: whichever one of the
// five is this mode's computed field still holds a valid, freshly-solved number
// by the time this runs (renderFormulaPreview always writes it back before
// returning), so there's nothing to skip — and Save relies on that to persist
// the solved value along with everything else.
function readFormulaInputs() {
  const mode = currentSolveFor();
  const overrides = {};
  const invalid = [];
  FORMULA_FIELDS.forEach((field) => {
    const num = formulaNumber(field.inputId);
    if (num === null) invalid.push(field.key);
    else overrides[field.key] = num;
  });

  const bodyMassKg = formulaBodyMassKg();
  const heightCm = formulaNumber('formula-height');
  const age = formulaNumber('formula-age');
  const sex = document.getElementById('formula-sex').value;
  const formula = currentBmrFormula();
  if (bodyMassKg === null) invalid.push('m̄ (smoothed body mass)');
  if (heightCm === null) invalid.push('HEIGHT_CM');
  // Age is a Mifflin input only — Katch-McArdle reads lean mass instead — so on that
  // equation a blank age isn't missing, it's simply not part of the model.
  if (age === null && bmrNeedsAge(formula)) invalid.push('BIRTH_DATE (age)');

  if (heightCm !== null) overrides.HEIGHT_CM = heightCm;
  overrides.SEX = sex;
  overrides[BMR_FORMULA_KEY] = formula;

  // The Δm box is the preview's only source of truth for the rate, so the pin key is
  // blanked out of the overlay: a WEEKLY_FAT_LOSS_PCT already on the sheet would otherwise
  // make calorieTargetDetail recompute the rate from the saved percentage and ignore what's
  // typed here. Not blanked in `overrides` — what Save writes to that key is the pin
  // fieldset's decision, not this function's.
  const preview = { ...overrides, [WEEKLY_FAT_LOSS_PCT_PIN_KEY]: '' };
  if (age !== null) {
    preview.BIRTH_DATE = birthDateForAge(age);
    if (age !== ageFromBirthDate(getSettingString('BIRTH_DATE', null))) {
      overrides.BIRTH_DATE = preview.BIRTH_DATE;
    }
  }

  // Blank exactly when the current mode is about to compute it — not invalid,
  // just not typed yet.
  const computed = computedIdsForMode(mode);
  const einIsTyped = !computed.includes('formula-ein');
  const daysIsTyped = !computed.includes('formula-days');

  const einKcal = einIsTyped ? formulaNumber('formula-ein') : null;
  if (einIsTyped && einKcal === null) invalid.push('Eᵢₙ (target daily intake)');

  const days = daysIsTyped ? formulaNumber('formula-days') : null;
  if (daysIsTyped && days === null) invalid.push('t (days)');

  // FIXED_PCT is the only mode where the percentage is an INPUT, so it's the only one where
  // a blank one is missing rather than merely not derived yet. Δm is reported blank by the
  // loop above in every mode, but there it's the box you'd fill; here it's the one that
  // can't be filled by hand, so naming the percentage is what points at the right box.
  if (mode === 'FIXED_PCT' && formulaNumber('formula-weekly-loss-pct') === null) {
    invalid.push('Δm% (weekly fat loss, % of body mass)');
  }

  return { mode, overrides, preview, bodyMassKg, heightCm, age, sex, formula, einKcal, days, invalid };
}
