// Tune: the desired daily intake as an editable formula that recomputes as you type
// and can save its inputs to Settings. "Solve for" picks the one unknown; the rest are
// typed. It runs the charts' own functions under a settings overlay, so the preview
// can't drift from what saving produces.

// What a fresh user (no Settings, no readings) sees in Tune's profile boxes.
const TUNE_PROFILE_DEFAULTS = { heightCm: 170, age: 35, neckCm: 38, waistCm: 91, hipCm: 99, bodyMassKg: 78.9, smoothBodyMassKg: 79 };
const WEEKLY_FAT_LOSS_PCT_DEFAULT = 1;

// The calorie solve's inputs: Settings key, input, fallback. A blank one blocks the
// whole solve. Each but κ can become a mode's computed field.
const FORMULA_FIELDS = [
  { key: 'KCAL_PER_MET_KG_MIN', inputId: 'formula-met-o2', fallback: () => MET_ML_O2_PER_KG_MIN_DEFAULT },
  // Walk's MET lives on the Activity sheet; a typed one is preview-only and never saved.
  { key: ACTIVITY_MET_PREVIEW_KEY, inputId: 'formula-met', value: () => activityMet() },
  { key: 'ACTIVITY_DESIRED_MIN', inputId: 'formula-activity-min', fallback: () => ACTIVITY_DESIRED_MIN_DEFAULT },
  // Defaults to the desired sleep, so an untouched box adds no sleep penalty.
  { key: 'PLAN_SLEEP_HOURS', inputId: 'formula-plan-sleep-hours', fallback: () => getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT) },
  { key: SLEEP_DEPRIVATION_PCT_PER_HOUR_KEY, inputId: 'formula-sleep-deprivation-pct', fallback: () => SLEEP_DEPRIVATION_PCT_PER_HOUR_DEFAULT },
  // Unset: 1%/week of m̄.
  { key: 'WEEKLY_FAT_LOSS_KG', inputId: 'formula-weekly-loss', fallback: () => weeklyFatLossKgFromPct(WEEKLY_FAT_LOSS_PCT_DEFAULT, planBodyMassKg(physiqueAsHealthEntries()) ?? TUNE_PROFILE_DEFAULTS.smoothBodyMassKg) },
  { key: 'BODY_MASS_HEALTHY_KG', inputId: 'formula-healthy', fallback: () => BODY_MASS_HEALTHY_KG_DEFAULT },
  // f divides the whole intake identity, so a blank one does block Eᵢₙ.
  { key: TEF_PERCENT_KEY, inputId: 'formula-tef-pct', fallback: () => TEF_PERCENT_DEFAULT },
];

// The lists below feed only their own rows, so a blank one hides those rows
// without blocking the calorie solve.

// Metabolic adaptation (λ, λt_max).
const ADAPT_FORMULA_FIELDS = [
  { key: ADAPT_PCT_PER_WEEK_KEY, inputId: 'formula-adapt-per-week', fallback: () => ADAPT_PCT_PER_WEEK_DEFAULT },
  { key: ADAPT_PCT_CAP_KEY, inputId: 'formula-adapt-cap', fallback: () => ADAPT_PCT_CAP_DEFAULT },
];

// U.S. Navy body-fat girths.
const NAVY_FORMULA_FIELDS = [
  { key: 'NECK_CM', inputId: 'formula-neck', fallback: () => TUNE_PROFILE_DEFAULTS.neckCm },
  { key: 'WAIST_CM', inputId: 'formula-waist', fallback: () => TUNE_PROFILE_DEFAULTS.waistCm },
  { key: 'HIP_CM', inputId: 'formula-hip', fallback: () => TUNE_PROFILE_DEFAULTS.hipCm },
];

// The BMR_cal window (n_p × L_p days ending yesterday).
const CALIBRATION_FORMULA_FIELDS = [
  { key: BMR_CALIBRATION_PERIOD_COUNT_KEY, inputId: 'formula-cal-period-count', fallback: () => BMR_CALIBRATION_PERIOD_COUNT_DEFAULT },
  { key: BMR_CALIBRATION_PERIOD_DAYS_KEY, inputId: 'formula-cal-period-days', fallback: () => BMR_CALIBRATION_PERIOD_DAYS_DEFAULT },
];

// Lean-mass protein band (g/kg LBM).
const PROTEIN_FORMULA_FIELDS = [
  { key: 'PROTEIN_G_PER_KG_LBM_MIN', inputId: 'formula-protein-per-kg-min', fallback: () => PROTEIN_G_PER_KG_LBM_MIN_DEFAULT },
  { key: 'PROTEIN_G_PER_KG_LBM_MAX', inputId: 'formula-protein-per-kg-max', fallback: () => PROTEIN_G_PER_KG_LBM_MAX_DEFAULT },
];

// Fiber band: a floor per 1000 kcal, a ceiling per kg.
const FIBER_FORMULA_FIELDS = [
  { key: 'FIBER_G_PER_1000_KCAL_MIN', inputId: 'formula-fiber-per-1000kcal-min', fallback: () => FIBER_G_PER_1000_KCAL_MIN_DEFAULT },
  { key: 'FIBER_G_PER_KG_MAX', inputId: 'formula-fiber-per-kg-max', fallback: () => FIBER_G_PER_KG_MAX_DEFAULT },
];

// Fat band, % of intake.
const FAT_FORMULA_FIELDS = [
  { key: 'FAT_PCT_OF_KCAL_MIN', inputId: 'formula-fat-pct-min', fallback: () => FAT_PCT_OF_KCAL_MIN_DEFAULT },
  { key: 'FAT_PCT_OF_KCAL_MAX', inputId: 'formula-fat-pct-max', fallback: () => FAT_PCT_OF_KCAL_MAX_DEFAULT },
];

// Carb band, % of intake.
const CARB_FORMULA_FIELDS = [
  { key: 'CARB_PCT_OF_KCAL_MIN', inputId: 'formula-carb-pct-min', fallback: () => CARB_PCT_OF_KCAL_MIN_DEFAULT },
  { key: 'CARB_PCT_OF_KCAL_MAX', inputId: 'formula-carb-pct-max', fallback: () => CARB_PCT_OF_KCAL_MAX_DEFAULT },
];

// Every settings-backed Tune field, for loading and live re-rendering.
const ALL_FORMULA_FIELDS = [
  ...FORMULA_FIELDS, ...PROTEIN_FORMULA_FIELDS, ...FIBER_FORMULA_FIELDS, ...FAT_FORMULA_FIELDS,
  ...CARB_FORMULA_FIELDS, ...ADAPT_FORMULA_FIELDS, ...CALIBRATION_FORMULA_FIELDS, ...NAVY_FORMULA_FIELDS,
];

// The box each "Solve for" value fills. MET isn't solvable; τ is.
const FORMULA_SOLVE_FIELD_ID = {
  EIN: 'formula-ein',
  HEALTHY_MASS: 'formula-healthy',
  TAU: 'formula-activity-min',
  DELTA_M: 'formula-weekly-loss',
};

// Every box that can go readonly in some mode. Each unit pair (t/date, Δm/Δm%,
// m_g/BMI_g) is typed or computed together.
const FORMULA_TOGGLE_IDS = [...Object.values(FORMULA_SOLVE_FIELD_ID), 'formula-days', 'formula-eta', 'formula-weekly-loss-pct', 'formula-healthy-bmi'];

// Computed boxes in the fixed modes. FIXED_PCT is EIN's twin: Δm% is held and the
// kilograms, intake and day count follow from it.
const FORMULA_COMPUTED_IDS = {
  EIN: ['formula-ein', 'formula-days', 'formula-eta'],
  HEALTHY_MASS: ['formula-healthy', 'formula-healthy-bmi'],
  FIXED_PCT: ['formula-weekly-loss', 'formula-ein', 'formula-days', 'formula-eta'],
};

// TAU and DELTA_M solve from whichever of Eᵢₙ or t was typed last, remembered per
// mode. Eᵢₙ by default, so either mode responds straight away.
const dualKnownField = { TAU: 'ein', DELTA_M: 'ein' };

// Which box of a unit pair was typed last; the other is rewritten from it each render.
// DELTA_M computes both Δm boxes, FIXED_PCT always types the %, HEALTHY_MASS computes both m_g boxes.
let weeklyLossKnownField = 'kg';   // 'kg' | 'pct'
let healthyMassKnownField = 'kg';   // 'kg' | 'bmi'

function healthyBmiIsTyped() {
  if (currentSolveFor() === 'HEALTHY_MASS') return false;
  return healthyMassKnownField === 'bmi';
}

function weeklyLossPctIsTyped() {
  const mode = currentSolveFor();
  if (mode === 'FIXED_PCT') return true;
  if (mode === 'DELTA_M') return false;
  return weeklyLossKnownField === 'pct';
}

function checkedRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function currentPinMode() {
  return checkedRadioValue('formula-pin-mode');
}

// The equation (mifflin/katch) under a BMR_cal/adp/avg pick, which layers on it.
let lastExplicitBmrFormula = 'mifflin';

const BMR_BASIS_RADIO_VALUES = ['bmr_cal', 'bmr_adp', 'bmr_avg'];

// The equation the preview runs on; never a basis value.
function currentBmrFormula() {
  const checked = checkedRadioValue('formula-bmr-formula');
  return BMR_BASIS_RADIO_VALUES.includes(checked) ? lastExplicitBmrFormula : checked;
}

// The basis (applyBmrBasis, health-math.js): a layered pick, or plain 'bmr'.
function currentBmrBasis() {
  const checked = checkedRadioValue('formula-bmr-formula');
  return BMR_BASIS_RADIO_VALUES.includes(checked) ? checked : 'bmr';
}

// m̄, the mass every identity here runs at (not the raw reading).
function formulaBodyMassKg() {
  return formulaNumber('formula-body-mass-smooth');
}

// Δm% this render: typed when held, else implied by the kilograms. The box, trace and
// journey all read it, so they can't disagree.
function weeklyLossPctInPlay(weeklyLossKg, bodyMassKg) {
  return weeklyLossPctIsTyped()
    ? formulaNumber('formula-weekly-loss-pct')
    : weeklyFatLossPct(weeklyLossKg, bodyMassKg);
}

// TAU and DELTA_M's own computed boxes.
const FORMULA_DUAL_OWN_IDS = {
  TAU: ['formula-activity-min'],
  DELTA_M: ['formula-weekly-loss', 'formula-weekly-loss-pct'],
};

function isDualSolveMode(mode) {
  return mode === 'TAU' || mode === 'DELTA_M';
}

// The mode's own field, plus exactly one of Eᵢₙ or t.
function computedIdsForMode(mode) {
  if (!isDualSolveMode(mode)) return FORMULA_COMPUTED_IDS[mode];
  const other = dualKnownField[mode] === 'ein' ? ['formula-days', 'formula-eta'] : ['formula-ein'];
  return [...FORMULA_DUAL_OWN_IDS[mode], ...other];
}

function currentSolveFor() {
  return checkedRadioValue('formula-solve-for');
}

// In TAU/DELTA_M these stay editable even when computed (typing one makes it the
// known), so they get a class instead of readonly.
const FORMULA_DUAL_FIELD_IDS = ['formula-ein', 'formula-days', 'formula-eta'];

function applySolveForMode(mode) {
  const computed = new Set(computedIdsForMode(mode));
  const isDualMode = isDualSolveMode(mode);
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

// Tune's Equations list, also sent verbatim to the AI (health-insight-plan.js).
// Indented lines are formulas; the rest are headings.
const FORMULA_EXPRESSION = `Smoothing the scale — daily weight carries water and glycogen, m(t) means clean mass. Ending yesterday: today's own reading, if any, is still excluded
    m̄     =  (1/L_p) × Σ m(t−i),  i = 1…L_p
The healthy body mass as a BMI — ${BMI_HEALTHY_MIN}–${BMI_HEALTHY_MAX} healthy band
    BMI_des =  m_des / (h/100)²
Body shape from the girths — WHtR under 0.5; WHR under 0.90 (♂) / 0.85 (♀), WHO; C_waist under 102 (♂) / 88 (♀) cm
    WHtR  =  C_waist / h
    WHR   =  C_waist / C_hip
    BRI   =  364.2  −  365.5 × √(1 − (C_waist/2π)² / (0.5×h)²)      Thomas et al. (2013)
Body-fat % by U.S. Navy — red above 25% (♂) / 32% (♀) — Hodgdon & Beckett (1984), girths and height in cm
    BF%   =  495 / (1.0324  −  0.19077×log10(C_waist − C_neck)  +  0.15456×log10(h))  −  450           (♂)
    BF%   =  495 / (1.29579  −  0.35004×log10(C_waist + C_hip − C_neck)  +  0.22100×log10(h))  −  450   (♀)
Lean body mass by U.S. Navy — body mass less its fat mass
    m_fat    =  m × BF% / 100
    LBM_navy =  m  −  m_fat  =  m × (1 − BF%/100)
Lean body mass — Boer (1984)
    LBM_boer =  0.407×m  +  0.267×h  −  19.2      (♂)
    LBM_boer =  0.252×m  +  0.473×h  −  48.3      (♀)
Lean body mass in force — whichever Plan Choices picks
    LBM   =  LBM_boer  or  LBM_navy
Basal metabolic rate by Katch-McArdle (1996), from lean mass instead of age/sex
    BMR_kat =  370  +  21.6×LBM
Basal metabolic rate by Mifflin-St Jeor (1990)
    BMR_mif =  10×m  +  6.25×h  −  5×a  +  σ
Calibrated basal metabolic rate — offset measured over n_p periods of L_p days, ending yesterday
    D_i     =  TEI − BMR − AEE − TEF + SD,  averaged over period i
    ΔM_i    =  (m̄_end,i − m̄_start,i) × ρ / L_p
    w_i     =  0.1 + 0.9 × i / (n_p − 1),  oldest period 0.1 → newest 1.0
    BMR_cal =  BMR  +  Σ w_i × (D_i − ΔM_i) / Σ w_i
Maintenance is affine in body mass — M(m) = A + B×m
    A     =  (6.25×h  −  5×a  +  σ) / (1 − f)           under Mifflin
    B     =  (10  +  MET × τ × κ / ε) / (1 − f)         under Mifflin
    A     =  (370  +  21.6×(c_h×h + c_0)) / (1 − f)     under Katch
    B     =  (21.6×c_m  +  MET × τ × κ / ε) / (1 − f)   under Katch
    c_h = c_0 = 0,  c_m = 1 − BF%/100                    on LBM_navy
Body mass at which TEI becomes maintenance
    m∞    =  (TEI  −  A) / B
Metabolic adaptation — BMR sags faster than the lost mass alone predicts
    BMR_adp(t) = BMR × (1 − λt),  λt capped at λt_max ≈ 10–15% by week 10–12
    m∞_adp =  (TEI − A_adp) / B_adp,  the BMR half of A and B scaled by (1 − λt)
    BMR_avg =  (BMR_mif + BMR_kat + BMR_cal + BMR_adp) / n,  over the n known, BMR_adp as of today
Activity energy expenditure at the desired daily activity — ACSM metabolic equation
    AEE   =  MET × m × τ × κ / ε
Sleep efficiency — from sleep length s and sleep deprivation rate γ, per hour below the desired sleep s_des
    η     =  1 − (γ/100) × max(0, s_des − s)
Weekly fat loss as a share of body mass — 0.5–1%/week band
    Δm%   =  100 × Δm / m
Daily energy deficit implied by the desired weekly fat loss, short sleep needs more of it
    D     =  (Δm × ρ / 7) / η
Sleep Deprivation Effect — the part of D that only makes up for short sleep
    SD    =  D  −  Δm × ρ / 7
Thermic effect of food — a share of the very intake being solved for
    TEF   =  f × TEI
Desired daily intake — TEF folded in by solving, not by adding
    TEI   =  BMR  +  AEE  +  TEF  −  D    =    (BMR  +  AEE  −  D) / (1 − f)
Exponential decay toward m∞, not linear loss
    m(t)  =  m∞  +  (m − m∞) × e^(−B×t/ρ)
    t     =  (ρ / B) × ln[ (m − m∞) / (m_des − m∞) ]
Proportional journey instead, when Δm% is what's held — no plateau, so no m∞
    m(t)  =  m × (1 − Δm%/100)^(t/7)
    t     =  7 × ln(m / m_des) / −ln(1 − Δm%/100)
Skeletal muscle mass — the fraction of LBM that actually stores glycogen
    m_musc =  s × LBM
Glycogen store, from muscle mass
    m_gly  =  g_musc × m_musc  +  g_liver
Glycogen-bound water — the swing glycogen alone accounts for, not fat
    ΔM_gly =  m_gly × (1 + r) / 1000
Daily protein band, scaled to lean mass
    P_min =  p_min × LBM
    P_max =  p_max × LBM
Fiber band — a floor from daily intake, a ceiling from body mass
    F_min =  b_min × (TEI / 1000)
    F_max =  b_max × m
Fat band — both ends a share of intake, 20-35% AMDR
    G_min =  (k_min/100 × TEI) / 9
    G_max =  (k_max/100 × TEI) / 9
Carb band — both ends a share of intake, 45-65% AMDR
    C_min =  (q_min/100 × TEI) / 4
    C_max =  (q_max/100 × TEI) / 4`;

function currentLbmFormula() {
  return checkedRadioValue('formula-lbm-formula');
}

// `value` is for fields whose source isn't a Settings key (MET).
function formulaFieldValue(field) {
  if (field.value) return field.value();
  return getSetting(field.key, null) ?? field.fallback();
}

// Runs fn with Tune's edits laid over `currentSettings`, so the preview uses the real functions.
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

// Tune's n_p × L_p window and what Calibrate measures over it; null while either box is invalid.
function tuneBmrCalibration() {
  const periodCount = formulaNumber('formula-cal-period-count');
  const periodDays = formulaNumber('formula-cal-period-days');
  if (!(periodCount >= 1) || !(periodDays >= 1)) return null;
  const n = Math.round(periodCount);
  const d = Math.round(periodDays);
  return { periodCount: n, periodDays: d, result: bmrCalibrationForWindow(n, d) };
}

// Writes a computed answer into a box, masked in privacy mode. Never for a typed box.
function setComputedField(inputId, text) {
  document.getElementById(inputId).value = privacyMode ? maskDigits(text) : text;
}

// A BIRTH_DATE exactly `age` years ago, so the preview runs ageFromBirthDate.
// Feb 29 becomes the 28th so it can't roll into March.
function birthDateForAge(age) {
  const today = new Date();
  const month = today.getMonth();
  const day = (month === 1 && today.getDate() === 29) ? 28 : today.getDate();
  return isoFromDate(new Date(today.getFullYear() - age, month, day));
}

// Today + days as an ISO date; setDate so DST can't shift it.
function isoDateFromDays(days) {
  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  return isoFromDate(eta);
}

// Days from today to a date, in UTC so DST can't make it off by one.
function daysFromTodayIso(dateIso) {
  return Math.round((parseIsoDateUTC(dateIso) - parseIsoDateUTC(isoFromDate(new Date()))) / 86400000);
}

// Reads every box. `overrides` is what Save writes; `preview` is the overlay the render
// runs under. FORMULA_FIELDS is read in every mode: the computed one already holds its
// solved value, which Save persists. BIRTH_DATE is only saved when the typed age differs
// from the stored one, so a real date isn't swapped for a synthetic one.
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
  // Only Mifflin uses age.
  if (age === null && bmrNeedsAge(formula)) invalid.push('BIRTH_DATE (age)');

  if (heightCm !== null) overrides.HEIGHT_CM = heightCm;
  overrides.SEX = sex;
  overrides[BMR_FORMULA_KEY] = formula;
  overrides[BMR_BASIS_KEY] = currentBmrBasis();
  overrides[LBM_FORMULA_KEY] = currentLbmFormula();

  // The Δm box drives the preview, so a saved % pin is blanked from the overlay only.
  const preview = { ...overrides, [WEEKLY_FAT_LOSS_PCT_PIN_KEY]: '' };
  if (age !== null) {
    preview.BIRTH_DATE = birthDateForAge(age);
    if (age !== ageFromBirthDate(getSettingString('BIRTH_DATE', null))) {
      overrides.BIRTH_DATE = preview.BIRTH_DATE;
    }
  }

  // A box this mode computes isn't missing when blank.
  const computed = computedIdsForMode(mode);
  const einIsTyped = !computed.includes('formula-ein');
  const daysIsTyped = !computed.includes('formula-days');

  const einKcal = einIsTyped ? formulaNumber('formula-ein') : null;
  if (einIsTyped && einKcal === null) invalid.push('TEI (desired daily intake)');

  const days = daysIsTyped ? formulaNumber('formula-days') : null;
  if (daysIsTyped && days === null) invalid.push('t (days)');

  // Only FIXED_PCT types the %, so only there is a blank one missing.
  if (mode === 'FIXED_PCT' && formulaNumber('formula-weekly-loss-pct') === null) {
    invalid.push('Δm% (weekly fat loss, % of body mass)');
  }

  return { mode, overrides, preview, bodyMassKg, heightCm, age, sex, formula, einKcal, days, invalid };
}
