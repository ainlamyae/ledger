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
  // activityMet() as the fallback, not the bare constant — it also honours the
  // ACTIVITY_MET_DEFAULT spelling an existing sheet may use instead.
  { key: 'ACTIVITY_MET', inputId: 'formula-met', fallback: () => activityMet() },
  { key: 'ACTIVITY_TARGET_MIN', inputId: 'formula-activity-min', fallback: () => ACTIVITY_TARGET_MIN_DEFAULT },
  // No default: an unset WEEKLY_FAT_LOSS_KG is exactly what makes the target
  // uncomputable and sends the charts to the flat CALORIE_TARGET_KCAL, so the
  // playground opens on 0 (maintenance) rather than inventing a deficit.
  { key: 'WEEKLY_FAT_LOSS_KG', inputId: 'formula-weekly-loss', fallback: () => 0 },
  { key: 'BODY_MASS_TARGET_KG', inputId: 'formula-target', fallback: () => BODY_MASS_TARGET_KG_DEFAULT },
];

// The lean-mass protein band: its own pair of fields, kept out of FORMULA_FIELDS on
// purpose. Those are read unconditionally and a blank one invalidates the whole calorie
// preview — but protein feeds nothing in the calorie identities, so an empty p_min
// should only stop protein from being computed and saved, not the target.
const PROTEIN_FORMULA_FIELDS = [
  { key: 'PROTEIN_G_PER_KG_LBM_MIN', inputId: 'formula-protein-per-kg-min', fallback: () => PROTEIN_G_PER_KG_LBM_MIN_DEFAULT },
  { key: 'PROTEIN_G_PER_KG_LBM_MAX', inputId: 'formula-protein-per-kg-max', fallback: () => PROTEIN_G_PER_KG_LBM_MAX_DEFAULT },
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
const FORMULA_TOGGLE_IDS = [...Object.values(FORMULA_SOLVE_FIELD_ID), 'formula-days', 'formula-eta', 'formula-weekly-loss-pct'];

// Which fields are computed in EIN and TARGET_MASS — fixed, unlike TAU and
// DELTA_M below, which let you type either Eᵢₙ or t and compute whichever
// you didn't touch.
// FIXED_PCT is the one mode named for what it HOLDS rather than what it solves: Δm% is
// the typed input and everything the rate feeds is computed from it — the kilograms, the
// intake, and the day count. Which makes it EIN's twin, differing only in that Δm comes
// from a share of body mass and the journey is proportional rather than constant-intake.
const FORMULA_COMPUTED_IDS = {
  EIN: ['formula-ein', 'formula-days', 'formula-eta'],
  TARGET_MASS: ['formula-target'],
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

function weeklyLossPctIsTyped() {
  const mode = currentSolveFor();
  if (mode === 'FIXED_PCT') return true;
  if (mode === 'DELTA_M') return false;
  return weeklyLossKnownField === 'pct';
}

function currentPinMode() {
  return document.querySelector('input[name="formula-pin-mode"]:checked').value;
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
const FORMULA_EXPRESSION = `Resting metabolic rate — Mifflin-St Jeor (1990)
    BMR  =  10×m  +  6.25×h  −  5×a  +  σ
Activity burn at the daily target — ACSM metabolic equation
    Eₐ   =  MET × m × τ × κ / ε
Weekly fat loss as a share of body mass — 0.5–1%/week band
    Δm%  =  100 × Δm / m
Daily energy deficit implied by the weekly fat-loss target
    D    =  (Δm × ρ) / 7
Target daily intake
    Eᵢₙ  =  BMR  +  Eₐ  −  D
Maintenance is affine in body mass — M(m) = A + B×m
    A    =  6.25×h  −  5×a  +  σ
    B    =  10  +  MET × τ × κ / ε
Body mass at which Eᵢₙ becomes maintenance
    m∞   =  (Eᵢₙ  −  A) / B
Exponential decay toward m∞, not linear loss
    m(t) =  m∞  +  (m − m∞) × e^(−B×t/ρ)
    t    =  (ρ / B) × ln[ (m − m∞) / (m_g − m∞) ]
Proportional journey instead, when Δm% is what's held — no plateau, so no m∞
    m(t) =  m × (1 − Δm%/100)^(t/7)
    t    =  7 × ln(m / m_g) / −ln(1 − Δm%/100)
Lean body mass — Boer (1984)
    LBM  =  0.407×m  +  0.267×h  −  19.2      (♂)
    LBM  =  0.252×m  +  0.473×h  −  48.3      (♀)
Daily protein band, scaled to lean mass
    P_min =  p_min × LBM
    P_max =  p_max × LBM`;

function formulaFieldValue(field) {
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

  const bodyMassKg = formulaNumber('formula-body-mass');
  const heightCm = formulaNumber('formula-height');
  const age = formulaNumber('formula-age');
  const sex = document.getElementById('formula-sex').value;
  if (bodyMassKg === null) invalid.push('current body mass');
  if (heightCm === null) invalid.push('HEIGHT_CM');
  if (age === null) invalid.push('BIRTH_DATE (age)');

  if (heightCm !== null) overrides.HEIGHT_CM = heightCm;
  overrides.SEX = sex;

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

  return { mode, overrides, preview, bodyMassKg, heightCm, age, sex, einKcal, days, invalid };
}

// The formula with every symbol replaced by the figure actually used, so a
// surprising total can be traced to whichever input produced it. Each mode
// builds its own row list, in whichever order it actually derived them —
// EIN/TAU go BMR→Eₐ→D→Eᵢₙ→A→B→m∞→t; TARGET_MASS goes straight to A→B→m∞→m_g
// (BMR/Eₐ/D would describe maintenance at the current mass, which this mode
// never claims equals the typed Eᵢₙ); DELTA_M runs the TARGET_MASS half
// backwards for m∞→Eᵢₙ, then continues on into BMR→Eₐ→D→Δm.
// The lean-mass protein rows are appended here rather than by each mode: they're the same
// three lines in all five, and `null` (a failed calorie solve) blanks the calorie half
// while leaving them — nothing about LBM or the protein band depends on that solve. This
// is also where the three protein BOXES are filled, so a shown figure and its shown
// arithmetic always come from one read of the inputs.
function renderFormulaSubstituted(rows) {
  const el = document.getElementById('formula-substituted');
  el.innerHTML = '';
  // Each derived half is guarded, and separately: this element is cleared above, so
  // anything thrown while building one of them would leave the whole trace — BMR, Eₐ, D,
  // Eᵢₙ, A, B, m∞, t — blank, which is a far worse failure than a few missing lines, and
  // one throwing must not take the other's rows with it either.
  //
  // Δm% is filled here for a second reason: it's the Δm → % half of that pair, and this
  // is the one function every mode reaches exactly once, failure paths included — so the
  // percentage can never be left describing a previous render's kilograms.
  let pctRows = [];
  try {
    pctRows = renderWeeklyLossPctField();
  } catch (err) {
    console.error('Weekly fat-loss percentage failed to render', err);
  }
  let proteinRows = [];
  try {
    proteinRows = renderProteinFields();
  } catch (err) {
    console.error('Protein band failed to render', err);
  }

  [...(rows ?? []), ...pctRows, ...proteinRows].forEach(([label, value]) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    p.append(strong, document.createTextNode(privacyMode ? maskDigits(value) : value));
    el.appendChild(p);
  });
}

// Sets the date box itself — a real ISO date or blank, never status text: an
// <input type="date"> silently rejects anything else, which is exactly why the
// "already there" / "never" messages live in the adjacent note span instead.
// Not privacy-masked: unlike every other computed figure here, there's no way
// to mask a date value without it stopping being a valid one.
function setEtaDate(iso) {
  document.getElementById('formula-eta').value = iso;
}

function setEtaNote(text) {
  document.getElementById('formula-eta-note').textContent = privacyMode && text ? maskDigits(text) : text;
}

// Days and the date they land on are two separate lines: t stays a plain number
// like every other field, and the date (or the reason there isn't one) goes in
// its own row below it. Called wherever t is this render's computed field —
// always in EIN, and in TAU/DELTA_M whenever their typed field is Eᵢₙ rather
// than t. When t is typed instead, its own branch sets the date directly via
// setEtaDate(isoDateFromDays(days)) — there's no projection to read a status
// off in that direction.
function renderFormulaDaysField(proj) {
  if (proj === null) {
    setComputedField('formula-days', '');
    setEtaDate('');
    setEtaNote('');
    return;
  }
  if (proj.status === 'reached') {
    setComputedField('formula-days', '');
    setEtaDate('');
    setEtaNote('already there');
    return;
  }
  if (proj.status === 'unreachable') {
    setComputedField('formula-days', '');
    setEtaDate('');
    // A proportional journey has no plateau to name, so it carries its own reason instead.
    setEtaNote(proj.journey === 'pct'
      ? `never — ${proj.reason}`
      : `never — plateaus at ${Math.round(proj.equilibriumKg * 10) / 10} kg`);
    return;
  }
  setComputedField('formula-days', String(Math.round(proj.days)));
  setEtaDate(proj.etaIso);
  setEtaNote('');
}

// The one case with no closed form: TAU with a typed day count instead of a
// typed Eᵢₙ. M(m) = A + B×m is affine, so every other quantity (Eᵢₙ, m∞)
// collapses out algebraically here, leaving a single equation in B alone —
// D×(1 − e^(−B×t/ρ)) = (m − m_g)×B — which still can't be isolated for B
// because B sits both outside and inside the exponential. Solved by bisection
// instead: h(B) is continuous and, over the B ≥ 10 range a real τ ≥ 0 can
// reach, changes sign at most once for a physically reachable target, so a
// wide bracket and a hundred halvings pin it down to well past display
// precision — or prove no reachable τ solves it.
function solveBForTypedDays({ deficit, massToLose, t, rho }) {
  const h = (B) => deficit * (1 - Math.exp((-B * t) / rho)) - massToLose * B;
  const lo = 10;
  const hi = 1e7;
  const hLo = h(lo);
  const hHi = h(hi);
  if (Math.abs(hLo) < 1e-9) return lo;
  if (Math.abs(hHi) < 1e-9) return hi;
  if (!Number.isFinite(hLo) || !Number.isFinite(hHi) || Math.sign(hLo) === Math.sign(hHi)) return null;

  let low = lo;
  let high = hi;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (Math.sign(h(mid)) === Math.sign(hLo)) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

// LBM and the protein band it implies, from whatever m, h and σ currently read — or
// null when any of the four numbers it needs is missing. Solving for something else
// never changes this: no calorie identity involves protein, so it's the one block here
// that's the same in all five modes.
//
// Boer takes the CURRENT body mass, not m_g, and what Save writes is the resulting
// grams rather than a per-kg rule. That's what keeps the target from sliding down as
// you diet — the g/kg band in charts.js needs BODY_MASS_TARGET_KG as its basis for
// exactly that reason, whereas a gram figure is already frozen at the mass it was
// computed from, and only moves when you re-save here.
function readProteinFormula() {
  const bodyMassKg = formulaNumber('formula-body-mass');
  const heightCm = formulaNumber('formula-height');
  const sex = document.getElementById('formula-sex').value;
  const perKgMin = formulaNumber('formula-protein-per-kg-min');
  const perKgMax = formulaNumber('formula-protein-per-kg-max');
  if (bodyMassKg === null || heightCm === null || perKgMin === null || perKgMax === null) return null;

  // Rounded to 0.1 kg BEFORE the grams are taken off it, not just for display: the trace
  // below shows `p × LBM = P`, and a hidden extra decimal in LBM is exactly what would
  // make that line fail to multiply out by a gram.
  const raw = boerLeanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const lbmKg = Math.round(raw * 10) / 10;

  // Sorted, so a band typed in backwards still reads as a band — the same courtesy
  // getProteinGPerKgBand extends to the g/kg pair.
  const low = Math.min(perKgMin, perKgMax);
  const high = Math.max(perKgMin, perKgMax);
  return {
    bodyMassKg, heightCm, sex, lbmKg, perKgMin: low, perKgMax: high,
    minG: Math.round(lbmKg * low),
    maxG: Math.round(lbmKg * high),
  };
}

// The three protein boxes, and the [label, substituted] rows the trace below appends for
// them — always as a pair, so a shown number and its shown arithmetic come from the same
// read. Empty rows when the band isn't computable, which is the trace's own "nothing to
// say" for these three, not a failure of the calorie solve.
function renderProteinFields() {
  const protein = readProteinFormula();

  // A dash in all three boxes is the whole message: which of m, h, p_min, p_max is
  // missing is already visible in the box that's empty, and #formula-profile-note is
  // reporting it for the calorie solve too.
  if (protein === null) {
    ['formula-lbm', 'formula-protein-min', 'formula-protein-max'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { lbmKg, perKgMin, perKgMax, minG, maxG, bodyMassKg, heightCm, sex } = protein;
  setComputedField('formula-lbm', String(lbmKg));
  setComputedField('formula-protein-min', String(minG));
  setComputedField('formula-protein-max', String(maxG));

  const coefficients = sex === 'male'
    ? `0.407 × ${bodyMassKg} + 0.267 × ${heightCm} − 19.2`
    : `0.252 × ${bodyMassKg} + 0.473 × ${heightCm} − 48.3`;
  return [
    ['LBM', `${coefficients}  =  ${lbmKg} kg`],
    ['P_min', `${perKgMin} × ${lbmKg}  =  ${minG} g/day`],
    ['P_max', `${perKgMax} × ${lbmKg}  =  ${maxG} g/day`],
  ];
}

// Δm% → Δm, run before anything reads the kg box so every mode below — and Save, which
// persists WEEKLY_FAT_LOSS_KG — sees the kilograms the typed percentage implies at the
// CURRENT body mass. That's the point of driving it from this end: 1% keeps meaning 1%
// as m changes, instead of freezing the kilograms it happened to mean when you typed it.
//
// Written raw rather than through setComputedField, unlike every other derived figure
// here: the kg box is a settings-backed input read unconditionally by readFormulaInputs,
// and a privacy-masked placeholder in it would report WEEKLY_FAT_LOSS_KG invalid and
// disable Save. loadFormulaInputsFromSettings fills the same box unmasked for the same
// reason.
function syncWeeklyLossFromPct() {
  if (!weeklyLossPctIsTyped()) return;
  const kg = weeklyFatLossKgFromPct(formulaNumber('formula-weekly-loss-pct'), formulaNumber('formula-body-mass'));
  if (kg === null) return;
  document.getElementById('formula-weekly-loss').value = String(kg);
}

// Which journey this render's day count describes. The proportional one whenever the
// percentage is the thing being held — either because FIXED_PCT is the mode (that's its
// premise) or because the pin fieldset says so, which is what the SAVED plan will do, so
// the playground's t and the Body Mass chart's forecast stay one figure.
//
// Only the forward direction (rate + m_g → t) can follow the pin. TARGET_MASS, and
// TAU/DELTA_M when a day count is typed, run the constant-Eᵢₙ algebra backwards to derive
// an input from a t you asserted — a question that only exists in that model, since under
// a proportional journey the rate is set by the percentage and neither τ nor Eᵢₙ moves the
// date at all. Those three keep their own meaning and are left alone.
function formulaJourneyIsProportional() {
  return currentSolveFor() === 'FIXED_PCT' || currentPinMode() === 'pct';
}

// The forecast, in that journey. A percentage of zero or less has no proportional arrival
// to compute — the mass never falls — so it drops back to the constant-Eᵢₙ form, which
// reports a hold or a gain properly instead of dividing by a zero rate.
function formulaProjection(args, weeklyPct) {
  if (formulaJourneyIsProportional() && weeklyPct !== null && weeklyPct > 0) {
    return projectTargetDaysAtFixedPct({
      bodyMassKg: args.bodyMassKg, targetKg: args.targetKg, weeklyPct,
    });
  }
  return projectTargetDays(args);
}

// The t line of the trace, in whichever journey produced it — one builder rather than the
// same template string written out at each mode's end, since there are now two forms of it
// and three places that print one.
function formulaDaysRow(proj, { bodyMassKg, targetKg, weeklyPct, bRounded, eqRounded }) {
  if (proj.status !== 'ok') return [];
  if (proj.journey === 'pct') {
    // No m∞ in it anywhere: a proportional journey has no plateau, which is why this form
    // can't report a target as unreachable and the other one can.
    return [['t', `7 × ln(${bodyMassKg} / ${targetKg}) / −ln(1 − ${weeklyPct}/100)  =  ${Math.round(proj.days)} days`]];
  }
  return [['t', `(7700 / ${bRounded}) × ln[(${bodyMassKg} − ${eqRounded}) / (${targetKg} − ${eqRounded})]  =  ${Math.round(proj.days)} days`]];
}

// Where a rate sits against the 0.5–1%/week band, for the substituted trace and the box's
// own colour — deliberately NOT the unit column, which says `%/week` and only that, the
// same as every other row. `over` is the only state that reads as a warning: under the
// floor is merely slow, and a negative rate is a deliberate lean bulk
// (calorieTargetDetail supports one), not a mistake.
function weeklyLossPctVerdict(pct) {
  if (pct > WEEKLY_FAT_LOSS_PCT_CEILING) {
    return { text: `above the ${WEEKLY_FAT_LOSS_PCT_CEILING}%/week ceiling`, over: true };
  }
  if (pct >= WEEKLY_FAT_LOSS_PCT_FLOOR) {
    return { text: `in the ${WEEKLY_FAT_LOSS_PCT_FLOOR}–${WEEKLY_FAT_LOSS_PCT_CEILING}%/week band`, over: false };
  }
  if (pct > 0) return { text: `under the ${WEEKLY_FAT_LOSS_PCT_FLOOR}%/week floor`, over: false };
  if (pct === 0) return { text: 'maintenance', over: false };
  return { text: 'a surplus, not a deficit', over: false };
}

// The Δm% box and the trace row for the identity — always as a pair, so the percentage
// shown and the arithmetic behind it come from a single read. Δm comes off its box rather
// than being passed in: by the time the trace is built that box holds this render's value
// in every mode — typed in three of them, and freshly solved in DELTA_M.
//
// The verdict goes in the trace line and the box's own colour, nowhere else: the unit
// column reads `%/week` and stops there, like every other row's.
function renderWeeklyLossPctField() {
  const bodyMassKg = formulaNumber('formula-body-mass');
  const weeklyLossKg = formulaNumber('formula-weekly-loss');
  const derivedPct = weeklyFatLossPct(weeklyLossKg, bodyMassKg);
  const pctIsTyped = weeklyLossPctIsTyped();
  const pct = weeklyLossPctInPlay(weeklyLossKg, bodyMassKg);
  const pctEl = document.getElementById('formula-weekly-loss-pct');

  // Blank rather than a dash when there's no body mass to be a share of: which box is
  // empty already says why, and #formula-profile-note is reporting it for the solve too.
  if (pct === null) {
    if (!pctIsTyped) setComputedField('formula-weekly-loss-pct', '');
    pctEl.classList.remove('formula-pct-over');
    return [];
  }

  if (!pctIsTyped) setComputedField('formula-weekly-loss-pct', String(pct));
  const verdict = weeklyLossPctVerdict(pct);
  pctEl.classList.toggle('formula-pct-over', verdict.over);

  // Always the 100×Δm/m direction, whichever box was typed — the kilograms are what the
  // rest of the arithmetic below actually used, so tracing them back is the honest line
  // even when a percentage produced them.
  if (derivedPct === null) return [];
  return [['Δm%', `100 × ${weeklyLossKg} / ${bodyMassKg}  =  ${derivedPct} %/week — ${verdict.text}`]];
}

function renderFormulaPreview() {
  syncWeeklyLossFromPct();
  const { mode, preview, bodyMassKg, heightCm, age, sex, einKcal, days, invalid } = readFormulaInputs();
  const noteEl = document.getElementById('formula-profile-note');
  const saveBtn = document.getElementById('formula-save-btn');

  // Only Eᵢₙ and t (and its date) are blanked here — none of the three is read
  // by the unconditional FORMULA_FIELDS loop in readFormulaInputs, so clearing
  // them can't get this mode stuck. Whichever FORMULA_FIELDS-backed target
  // this mode computes (τ, Δm, or m_g) IS read unconditionally by that loop,
  // precisely so Save can persist it — overwriting it with a non-numeric
  // placeholder here would make every future render see a blank "known" and
  // report that same field invalid forever, even after the real problem is
  // fixed. So on failure it's left showing whatever it last held.
  const computedNow = computedIdsForMode(mode);
  const showFailure = (message) => {
    if (computedNow.includes('formula-ein')) setComputedField('formula-ein', '—');
    if (computedNow.includes('formula-days')) {
      setComputedField('formula-days', '');
      setEtaDate('');
      setEtaNote('');
    }
    renderFormulaSubstituted(null);
    noteEl.textContent = message;
  };

  if (invalid.length) {
    showFailure(`Needs a number in: ${invalid.join(', ')}.`);
    saveBtn.disabled = true;
    return;
  }

  const cantCompute = () => showFailure("Can't compute from these values.");

  // Known in every mode: MET, τ, κ, Δm, and m_g are typed inputs everywhere
  // except in whichever single mode solves for one of them.
  const met = withFormulaOverrides(preview, activityMet);
  const kappa = preview.KCAL_PER_MET_KG_MIN;
  const bmr = mifflinStJeorBmr(bodyMassKg, heightCm, age, sex);
  const sigma = sex === 'male' ? '+ 5' : '− 161';

  noteEl.textContent = '';
  saveBtn.disabled = false;

  // One branch for two modes, because the arithmetic IS the same: τ, MET, κ, Δm and m_g are
  // typed and Eᵢₙ and t both follow. FIXED_PCT differs only in where Δm came from — a share
  // of body mass rather than a figure typed in kilograms, already converted into the kg box
  // by syncWeeklyLossFromPct — and in the journey its t is measured along, which
  // formulaProjection decides for both.
  if (mode === 'EIN' || mode === 'FIXED_PCT') {
    const tau = preview.ACTIVITY_TARGET_MIN;
    const targetKg = preview.BODY_MASS_TARGET_KG;
    const detail = withFormulaOverrides(preview, () => calorieTargetDetail(bodyMassKg));
    if (detail === null) { cantCompute(); return; }
    const weeklyPct = weeklyLossPctInPlay(detail.weeklyFatLossKg, bodyMassKg);
    const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa });
    const proj = formulaProjection({
      intakeKcal: detail.kcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg,
    }, weeklyPct);
    setComputedField('formula-ein', String(Math.round(detail.kcal)));
    renderFormulaDaysField(proj);

    const deficit = (detail.weeklyFatLossKg * GENERIC_KCAL_PER_KG_FAT) / 7;
    const bRounded = Math.round(b * 100) / 100;
    const eqRounded = Math.round(((detail.kcal - a) / b) * 10) / 10;
    const rows = [
      ['BMR', `10 × ${bodyMassKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(detail.bmr)} kcal/day`],
      ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(detail.activityKcal)} kcal/day`],
      ['D', `${detail.weeklyFatLossKg} × 7700 / 7  =  ${Math.round(deficit)} kcal/day`],
      ['Eᵢₙ', `${Math.round(detail.bmr)} + ${Math.round(detail.activityKcal)} − ${Math.round(deficit)}  =  ${detail.kcal} kcal/day`],
    ];
    // A, B and m∞ are the constant-intake journey's plateau. On the proportional one nothing
    // holds Eᵢₙ still and there is no plateau, so printing them would trace a journey this
    // t was never measured along — the same reason TARGET_MASS omits BMR/Eₐ/D.
    if (proj.journey !== 'pct') {
      rows.push(
        ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(a)} kcal/day`],
        ['B', `10 + ${met} × ${tau} × ${kappa} / 200  =  ${bRounded} kcal/day per kg`],
        ['m∞', `(${detail.kcal} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      );
    }
    rows.push(...formulaDaysRow(proj, { bodyMassKg, targetKg, weeklyPct, bRounded, eqRounded }));
    renderFormulaSubstituted(rows);
    return;
  }

  if (mode === 'TAU') {
    const deltaM = preview.WEEKLY_FAT_LOSS_KG;
    const deficit = (deltaM * GENERIC_KCAL_PER_KG_FAT) / 7;
    const targetKg = preview.BODY_MASS_TARGET_KG;
    const knownField = dualKnownField.TAU;

    let tau;
    if (knownField === 'ein') {
      // Eᵢₙ = BMR + m·MET·τ·κ/ε − D  ⇒  m·MET·τ·κ/ε = Eᵢₙ + D − BMR
      const activityKcalNeeded = einKcal + deficit - bmr;
      tau = Math.round((activityKcalNeeded * ML_O2_PER_KCAL) / (met * bodyMassKg * kappa));
    } else {
      // t and m_g typed instead of Eᵢₙ: no algebra isolates τ here (see
      // solveBForTypedDays), so this direction root-finds B numerically.
      const c = (met * kappa) / ML_O2_PER_KCAL;
      const B = solveBForTypedDays({ deficit, massToLose: bodyMassKg - targetKg, t: days, rho: GENERIC_KCAL_PER_KG_FAT });
      tau = B === null ? NaN : Math.round((B - 10) / c);
    }
    if (!Number.isFinite(tau) || tau < 0) { cantCompute(); return; }
    setComputedField('formula-activity-min', String(tau));

    const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa });
    const activityKcal = withFormulaOverrides(
      { ...preview, ACTIVITY_TARGET_MIN: tau },
      () => activityTargetKcal(bodyMassKg),
    );
    // When t was typed, Eᵢₙ was never given — it's exactly what the solved τ
    // implies via the same flat equation the 'ein' direction runs forward.
    const einForDisplay = knownField === 'ein' ? einKcal : (bmr + activityKcal - deficit);

    // Pin-aware only in the Eᵢₙ-known direction, where t is computed forward from the rate.
    // The other direction SOLVED τ from a typed t through the constant-Eᵢₙ decay identity
    // (solveBForTypedDays), so its projection has to be read in that same model — a
    // proportional t here would contradict the very day count τ was fitted to.
    const weeklyPct = weeklyLossPctInPlay(deltaM, bodyMassKg);
    const projArgs = { intakeKcal: einForDisplay, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg };
    const proj = knownField === 'ein' ? formulaProjection(projArgs, weeklyPct) : projectTargetDays(projArgs);
    if (knownField === 'ein') {
      renderFormulaDaysField(proj);
    } else {
      setComputedField('formula-ein', String(Math.round(einForDisplay)));
      // t was typed here, not computed — same as TARGET_MASS/DELTA_M's
      // t-known side, the date is just today plus that many days.
      setEtaDate(isoDateFromDays(days));
      setEtaNote('');
    }

    const bRounded = Math.round(b * 100) / 100;
    const eqRounded = Math.round(((einForDisplay - a) / b) * 10) / 10;
    const rows = [];
    if (knownField === 'days') {
      rows.push(['τ', `solved numerically so that m(t=${days}) = ${targetKg} kg`]);
    }
    rows.push(
      ['BMR', `10 × ${bodyMassKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(bmr)} kcal/day`],
      ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
      ['D', `${deltaM} × 7700 / 7  =  ${Math.round(deficit)} kcal/day`],
      ['Eᵢₙ', `${Math.round(bmr)} + ${Math.round(activityKcal)} − ${Math.round(deficit)}  =  ${Math.round(einForDisplay)} kcal/day`],
    );
    if (proj.journey !== 'pct') {
      rows.push(
        ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(a)} kcal/day`],
        ['B', `10 + ${met} × ${tau} × ${kappa} / 200  =  ${bRounded} kcal/day per kg`],
        ['m∞', `(${Math.round(einForDisplay)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      );
    }
    rows.push(...formulaDaysRow(proj, { bodyMassKg, targetKg, weeklyPct, bRounded, eqRounded }));
    renderFormulaSubstituted(rows);
    return;
  }

  if (mode === 'TARGET_MASS') {
    // Eᵢₙ and t are both typed; solve m_g from the same exponential-decay
    // identity projectTargetDays uses in the other direction.
    const tau = preview.ACTIVITY_TARGET_MIN;
    const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa });
    const equilibriumKg = (einKcal - a) / b;
    const mG = equilibriumKg + (bodyMassKg - equilibriumKg) * Math.exp((-b * days) / GENERIC_KCAL_PER_KG_FAT);
    if (!Number.isFinite(mG)) { cantCompute(); return; }
    const mGRounded = Math.round(mG * 10) / 10;
    setComputedField('formula-target', String(mGRounded));
    // t is typed here, not computed, but it still means the same thing it
    // does everywhere else (days from today) — so the date box can show it
    // the same way DELTA_M does below, keeping the two boxes in sync.
    setEtaDate(isoDateFromDays(days));
    setEtaNote('');

    const bRounded = Math.round(b * 100) / 100;
    const eqRounded = Math.round(equilibriumKg * 10) / 10;
    // No BMR/Eₐ/D/Eᵢₙ preamble here: those describe maintenance at the CURRENT
    // mass, which this mode never claims equals the typed Eᵢₙ — only A and B
    // (the mass-independent / mass-scaling split) feed the m_g identity below.
    renderFormulaSubstituted([
      ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(a)} kcal/day`],
      ['B', `10 + ${met} × ${tau} × ${kappa} / 200  =  ${bRounded} kcal/day per kg`],
      ['m∞', `(${Math.round(einKcal)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      ['m_g', `${eqRounded} + (${bodyMassKg} − ${eqRounded}) × e^(−${bRounded}×${days}/7700)  =  ${mGRounded} kg`],
    ]);
    return;
  }

  // DELTA_M: either Eᵢₙ or t can be the known that drives this one — unlike
  // TAU, Δm has no effect on the timing (it only ever enters through Eᵢₙ), so
  // neither direction needs the numerical step TAU's t-known path does.
  const tau = preview.ACTIVITY_TARGET_MIN;
  const targetKg = preview.BODY_MASS_TARGET_KG;
  const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa });
  const activityKcal = withFormulaOverrides(preview, () => activityTargetKcal(bodyMassKg));
  const knownField = dualKnownField.DELTA_M;

  let einForDisplay;
  let decay;
  if (knownField === 'ein') {
    einForDisplay = einKcal;
  } else {
    // t and m_g typed instead: m∞ solves from the exponential identity —
    // the same one TARGET_MASS reads the other way — then Eᵢₙ = A + B×m∞.
    decay = Math.exp((-b * days) / GENERIC_KCAL_PER_KG_FAT);
    const equilibriumKg = (targetKg - bodyMassKg * decay) / (1 - decay);
    einForDisplay = a + b * equilibriumKg;
  }
  if (!Number.isFinite(einForDisplay)) { cantCompute(); return; }

  const deficit = bmr + activityKcal - einForDisplay;
  const deltaMSolved = Math.round((deficit * 7 / GENERIC_KCAL_PER_KG_FAT) * 100) / 100;
  if (!Number.isFinite(deltaMSolved)) { cantCompute(); return; }
  setComputedField('formula-weekly-loss', String(deltaMSolved));

  const bRounded = Math.round(b * 100) / 100;
  const eqRounded = Math.round(((einForDisplay - a) / b) * 10) / 10;

  if (knownField === 'ein') {
    // Eᵢₙ was given; t follows the same way it does in EIN/TAU's ein-known
    // direction — a real projection, so it can carry the "already there" /
    // "never" statuses too.
    //
    // The percentage passed is the one the JUST-SOLVED Δm implies, not the box's: this mode
    // computes the rate, so the box is a render behind until renderWeeklyLossPctField
    // catches it up below. With the percentage pinned, that solved rate expressed as a share
    // of today's mass is exactly what the pin would hold, so the journey is its own.
    const weeklyPct = weeklyFatLossPct(deltaMSolved, bodyMassKg);
    const proj = formulaProjection({
      intakeKcal: einForDisplay, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg,
    }, weeklyPct);
    renderFormulaDaysField(proj);

    renderFormulaSubstituted([
      ['BMR', `10 × ${bodyMassKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(bmr)} kcal/day`],
      ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
      ['D', `${Math.round(bmr)} + ${Math.round(activityKcal)} − ${Math.round(einForDisplay)}  =  ${Math.round(deficit)} kcal/day`],
      ['Δm', `${Math.round(deficit)} × 7 / 7700  =  ${deltaMSolved} kg/week`],
      ...(proj.journey === 'pct' ? [] : [
        ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(a)} kcal/day`],
        ['B', `10 + ${met} × ${tau} × ${kappa} / 200  =  ${bRounded} kcal/day per kg`],
        ['m∞', `(${Math.round(einForDisplay)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      ]),
      ...formulaDaysRow(proj, { bodyMassKg, targetKg, weeklyPct, bRounded, eqRounded }),
    ]);
    return;
  }

  // t was known here, so — unlike a projection — the arrival date is just
  // today plus that many days, not something projectTargetDays derives.
  setEtaDate(isoDateFromDays(days));
  setEtaNote('');
  setComputedField('formula-ein', String(Math.round(einForDisplay)));

  const decayRounded = Math.round(decay * 1000) / 1000;
  renderFormulaSubstituted([
    ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(a)} kcal/day`],
    ['B', `10 + ${met} × ${tau} × ${kappa} / 200  =  ${bRounded} kcal/day per kg`],
    ['m∞', `(${targetKg} − ${bodyMassKg}×${decayRounded}) / (1 − ${decayRounded})  =  ${eqRounded} kg`],
    ['Eᵢₙ', `${Math.round(a)} + ${bRounded} × ${eqRounded}  =  ${Math.round(einForDisplay)} kcal/day`],
    ['BMR', `10 × ${bodyMassKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(bmr)} kcal/day`],
    ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
    ['D', `${Math.round(bmr)} + ${Math.round(activityKcal)} − ${Math.round(einForDisplay)}  =  ${Math.round(deficit)} kcal/day`],
    ['Δm', `${Math.round(deficit)} × 7 / 7700  =  ${deltaMSolved} kg/week`],
  ]);
}

function loadFormulaInputsFromSettings() {
  [...FORMULA_FIELDS, ...PROTEIN_FORMULA_FIELDS].forEach((field) => {
    document.getElementById(field.inputId).value = formulaFieldValue(field);
  });
  // Seeded from the same places the charts read, so the figure shown on open
  // matches the one on the Caloric Intake line before anything is touched.
  document.getElementById('formula-body-mass').value = latestBodyMassKg(physiqueAsWellnessEntries()) ?? '';
  document.getElementById('formula-height').value = getSetting('HEIGHT_CM', null) ?? '';
  document.getElementById('formula-age').value = ageFromBirthDate(getSettingString('BIRTH_DATE', null)) ?? '';
  // Falls back to male only because the formula needs one of the two — an unset
  // SEX has no neutral value to substitute here.
  const sex = getSettingString('SEX', null);
  document.getElementById('formula-sex').value = sex === 'female' ? 'female' : 'male';
  // Eᵢₙ and t are never seeded here — every mode either computes them itself on
  // the render that follows, or (TARGET_MASS) leaves whatever day count was
  // already typed in place.
  //
  // Δm% likewise: normally it's derived from the kg box on that same render. The exception
  // is a pinned percentage, where IT is the saved authority and the kilograms are what get
  // derived — WEEKLY_FAT_LOSS_KG on the sheet is then only the figure the last save's body
  // mass happened to imply. Written only in that case, so a save from a session where the
  // percentage was being typed doesn't blank the box it's typed into.
  const pinnedPct = pinnedWeeklyFatLossPct();
  if (pinnedPct !== null) document.getElementById('formula-weekly-loss-pct').value = pinnedPct;
}

function openFormulaPlayground() {
  clearFieldError('formula-status');
  document.getElementById('formula-expression').textContent = FORMULA_EXPRESSION;
  document.querySelector('input[name="formula-solve-for"][value="EIN"]').checked = true;
  // A fresh look at TAU/DELTA_M's original single-direction behavior each
  // time the modal opens, rather than carrying over whichever side of either
  // one was last typed into in a previous session.
  dualKnownField.TAU = 'ein';
  dualKnownField.DELTA_M = 'days';
  // Same fresh start for the Δm pair — 'kg' unless the percentage is the pinned quantity,
  // in which case it's the one on the sheet and the kilograms are what follow from it.
  weeklyLossKnownField = pinnedWeeklyFatLossPct() !== null ? 'pct' : 'kg';
  // Set from what's actually on the sheet, so the trio always shows the live state rather
  // than defaulting to one and inviting an accidental switch. The two pinnable keys are
  // mutually exclusive (Save blanks one whenever it writes the other), so this reads them
  // in a fixed order rather than trying to reconcile a sheet holding both.
  const pinMode = pinnedWeeklyFatLossPct() !== null
    ? 'pct'
    : (pinnedCalorieTargetKcal() !== null ? 'intake' : 'deficit');
  document.querySelector(`input[name="formula-pin-mode"][value="${pinMode}"]`).checked = true;
  const activityPinMode = pinnedActivityTargetKcal() !== null ? 'calorie' : 'time';
  document.querySelector(`input[name="formula-activity-pin-mode"][value="${activityPinMode}"]`).checked = true;
  loadFormulaInputsFromSettings();
  applySolveForMode('EIN');
  renderFormulaPreview();
  // No autofocus, same as every other modal here.
  document.getElementById('formula-modal').hidden = false;
}

// Eᵢₙ as the playground currently shows it — computed in most modes, typed in the
// ones that solve for something else. Read off the box either way, so what gets
// pinned is exactly the number on screen.
function formulaEinKcal() {
  const shown = evaluateNumberExpression(document.getElementById('formula-ein').value.trim());
  return (shown !== null && shown > 0) ? Math.round(shown) : null;
}

async function saveFormulaSettings() {
  const { overrides, invalid, bodyMassKg } = readFormulaInputs();
  if (invalid.length) return;

  // THREE ways to hold a plan steady, and each excludes the other two: pinning the intake
  // writes the shown Eᵢₙ, pinning the percentage writes the shown Δm%, and pinning the
  // deficit writes a blank into both — which is how either setting gets cleared, since
  // getSetting reads an empty cell as unset and WEEKLY_FAT_LOSS_KG (saved with the rest of
  // these inputs) is what the deficit is then held at. Each key is only written when it's
  // changing, so a save from the default mode doesn't add two blank rows to a sheet that
  // never had either.
  const pinMode = currentPinMode();
  const pinned = pinMode === 'intake';
  const pctPinned = pinMode === 'pct';
  const einKcal = formulaEinKcal();
  if (pinned && einKcal === null) {
    showFieldError('formula-status', "Can't pin a daily intake while Eᵢₙ has no value — fill the other inputs in first, or pin the deficit instead.");
    return;
  }
  // Off the box, like the intake pin reads Eᵢₙ off its own: what gets pinned is the figure
  // on screen, whether it was typed there or derived from the kilograms.
  const pctToPin = formulaNumber('formula-weekly-loss-pct');
  if (pctPinned && pctToPin === null) {
    showFieldError('formula-status', "Can't pin a fat-loss percentage while Δm% has no value — it needs a body mass and a weekly rate, or pin the deficit instead.");
    return;
  }
  if (pinned || pinnedCalorieTargetKcal() !== null) {
    overrides[CALORIE_TARGET_PIN_KEY] = pinned ? einKcal : '';
  }
  if (pctPinned || pinnedWeeklyFatLossPct() !== null) {
    overrides[WEEKLY_FAT_LOSS_PCT_PIN_KEY] = pctPinned ? pctToPin : '';
  }

  // Same shape, for the activity target instead of daily intake: pinning the calorie
  // burn writes Eₐ as the currently typed τ/MET/body-mass imply it (via activityTargetKcal,
  // the same pin-blind calculation this preview already uses); pinning the time writes a
  // blank, which is how ACTIVITY_TARGET_MIN — saved with the rest of these inputs — goes
  // back to being what the burn is held at.
  const activityPinned = document.querySelector('input[name="formula-activity-pin-mode"]:checked').value === 'calorie';
  const activityKcalToPin = activityPinned
    ? Math.round(withFormulaOverrides(overrides, () => activityTargetKcal(bodyMassKg)))
    : null;
  if (activityPinned || pinnedActivityTargetKcal() !== null) {
    overrides[ACTIVITY_TARGET_PIN_KEY] = activityPinned ? activityKcalToPin : '';
  }

  // Both the rule and the grams it produced. The per-kg pair is only ever read back into
  // these two boxes, while PROTEIN_TARGET_G_MIN/MAX is what the tile, the chart and the
  // Insight prompt actually use — so the sheet keeps the reasoning next to the result
  // instead of leaving two unexplained gram figures behind.
  const protein = readProteinFormula();
  if (protein !== null) {
    overrides.PROTEIN_G_PER_KG_LBM_MIN = protein.perKgMin;
    overrides.PROTEIN_G_PER_KG_LBM_MAX = protein.perKgMax;
    overrides.PROTEIN_TARGET_G_MIN = protein.minG;
    overrides.PROTEIN_TARGET_G_MAX = protein.maxG;
  }

  const saveBtn = document.getElementById('formula-save-btn');
  const statusEl = document.getElementById('formula-status');
  const originalLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  clearFieldError('formula-status');
  statusEl.classList.remove('status-ok');

  try {
    await saveSettingValues(overrides);
    // saveSettingValues has already refreshed currentSettings, so re-rendering
    // here is what makes the charts behind the modal agree with it immediately.
    applySettingsToWidgets();
    renderWellnessCharts(physiqueAsWellnessEntries());
    loadFormulaInputsFromSettings();
    applySolveForMode(currentSolveFor());
    renderFormulaPreview();
    statusEl.classList.add('status-ok');
    let intakeNote = 'The deficit is what stays fixed; the Caloric Intake chart and the forecast now use these.';
    if (pinned) {
      intakeNote = `Daily intake is pinned at ${einKcal} kcal and no longer moves with your body mass.`;
    } else if (pctPinned) {
      intakeNote = `Fat loss is pinned at ${pctToPin}% of body mass a week, so the kilograms per week — and the intake that delivers them — are recalculated at every weigh-in, and the forecast now follows the proportional journey.`;
    }
    const activityNote = activityPinned
      ? `Activity burn is pinned at ${activityKcalToPin} kcal/day — the activity tile and chart now show the minutes that takes, rising as your body mass falls.`
      : 'Activity time (τ) is what stays fixed on the activity target; the calorie burn it implies falls as your body mass does.';
    const proteinNote = protein === null
      ? 'The protein band was left alone — it needs body mass, height and both per-kg ends.'
      : `Protein target is now ${protein.minG}–${protein.maxG} g/day, from ${protein.perKgMin}–${protein.perKgMax} g per kg of ${protein.lbmKg} kg lean mass.`;
    showFieldError('formula-status', `Saved — ${intakeNote} ${activityNote} ${proteinNote}`);
  } catch (err) {
    showFieldError('formula-status', err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
  }
}

function initFormulaPlayground() {
  // A sibling of the <h2>, not a child of it — the h2 is the collapse toggle, so
  // a button inside it would close the panel on the way to opening the modal.
  document.getElementById('formula-playground-btn').addEventListener('click', openFormulaPlayground);

  // Δm is left out here and wired with Δm% below: both have to record which of the pair
  // is the known BEFORE the render, and a plain render-only listener firing first would
  // let the previous known overwrite the box being typed into.
  [...FORMULA_FIELDS.map((f) => f.inputId).filter((id) => id !== 'formula-weekly-loss'),
    ...PROTEIN_FORMULA_FIELDS.map((f) => f.inputId),
    'formula-body-mass', 'formula-height', 'formula-age'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderFormulaPreview);
  });
  document.getElementById('formula-sex').addEventListener('change', renderFormulaPreview);

  // Either box can be the one you fill in; typing into it makes it the known and pushes
  // the other one. No mode check needed: in DELTA_M both are readonly, and a readonly
  // input fires no input event.
  [['formula-weekly-loss', 'kg'], ['formula-weekly-loss-pct', 'pct']].forEach(([id, field]) => {
    document.getElementById(id).addEventListener('input', () => {
      weeklyLossKnownField = field;
      renderFormulaPreview();
    });
  });

  // Typing into Eᵢₙ or t marks it as the known driving TAU/DELTA_M's solve
  // (see dualKnownField) before reapplying which field looks computed and
  // re-rendering — outside those two modes this is a no-op, since EIN and
  // TARGET_MASS don't have a choice to record.
  const markDualKnown = (field) => {
    const mode = currentSolveFor();
    if (mode === 'TAU' || mode === 'DELTA_M') {
      dualKnownField[mode] = field;
      applySolveForMode(mode);
    }
  };
  document.getElementById('formula-ein').addEventListener('input', () => {
    markDualKnown('ein');
    renderFormulaPreview();
  });
  document.getElementById('formula-days').addEventListener('input', () => {
    markDualKnown('days');
    renderFormulaPreview();
  });

  // The date box is the other view of t, not a separate value: whenever it's
  // editable, picking or typing a date converts straight to a day count and
  // drives the same render formula-days itself would — so either box can be
  // the one you actually fill in. 'change', not 'input': a date input doesn't
  // have a complete value to convert until a full date is picked, unlike the
  // free-typed number boxes above.
  document.getElementById('formula-eta').addEventListener('change', (event) => {
    if (event.target.readOnly || !event.target.value) return;
    markDualKnown('days');
    document.getElementById('formula-days').value = String(daysFromTodayIso(event.target.value));
    renderFormulaPreview();
  });

  document.querySelectorAll('input[name="formula-solve-for"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      // Holding the percentage and pinning it are one decision, so picking the mode picks
      // the pin — otherwise a plan built here would be saved as a fixed-kilogram one and
      // the app would immediately stop doing what the modal just showed. The reverse isn't
      // forced: the pin is about the saved plan and applies in every mode.
      if (currentSolveFor() === 'FIXED_PCT') {
        document.querySelector('input[name="formula-pin-mode"][value="pct"]').checked = true;
      }
      applySolveForMode(currentSolveFor());
      clearFieldError('formula-status');
      renderFormulaPreview();
    });
  });

  // The pin fieldset used to be Save-only state. It isn't any more: pinning the percentage
  // changes which journey t is measured along, so the preview has to re-render with it —
  // and the percentage becomes the held quantity, which is what pinning it means.
  document.querySelectorAll('input[name="formula-pin-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (currentPinMode() === 'pct') weeklyLossKnownField = 'pct';
      clearFieldError('formula-status');
      renderFormulaPreview();
    });
  });

  document.getElementById('formula-reset-btn').addEventListener('click', () => {
    loadFormulaInputsFromSettings();
    clearFieldError('formula-status');
    renderFormulaPreview();
  });
  document.getElementById('formula-close-btn').addEventListener('click', () => {
    document.getElementById('formula-modal').hidden = true;
  });
  document.getElementById('formula-save-btn').addEventListener('click', saveFormulaSettings);
}
