// "Formula" in the Health Indicators heading: shows the daily calorie target as a
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
const FORMULA_TOGGLE_IDS = [...Object.values(FORMULA_SOLVE_FIELD_ID), 'formula-days', 'formula-eta'];

// Which fields are computed in EIN and TARGET_MASS — fixed, unlike TAU and
// DELTA_M below, which let you type either Eᵢₙ or t and compute whichever
// you didn't touch.
const FORMULA_COMPUTED_IDS = {
  EIN: ['formula-ein', 'formula-days', 'formula-eta'],
  TARGET_MASS: ['formula-target'],
};

// For TAU and DELTA_M, either Eᵢₙ or t can be the known that drives the solve
// — whichever you last typed into. Tracked per mode (not reset when you
// switch radios and back) so it remembers which one you were using. Defaults
// match each mode's original, single-direction behavior until you type into
// the other box: TAU opens on a typed Eᵢₙ, DELTA_M on a typed day count.
const dualKnownField = { TAU: 'ein', DELTA_M: 'days' };

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
      ? ['formula-weekly-loss', 'formula-days', 'formula-eta']
      : ['formula-weekly-loss', 'formula-ein'];
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
    t    =  (ρ / B) × ln[ (m − m∞) / (m_g − m∞) ]`;

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

  const preview = { ...overrides };
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

  return { mode, overrides, preview, bodyMassKg, heightCm, age, sex, einKcal, days, invalid };
}

// The formula with every symbol replaced by the figure actually used, so a
// surprising total can be traced to whichever input produced it. Each mode
// builds its own row list, in whichever order it actually derived them —
// EIN/TAU go BMR→Eₐ→D→Eᵢₙ→A→B→m∞→t; TARGET_MASS goes straight to A→B→m∞→m_g
// (BMR/Eₐ/D would describe maintenance at the current mass, which this mode
// never claims equals the typed Eᵢₙ); DELTA_M runs the TARGET_MASS half
// backwards for m∞→Eᵢₙ, then continues on into BMR→Eₐ→D→Δm.
function renderFormulaSubstituted(rows) {
  const el = document.getElementById('formula-substituted');
  el.innerHTML = '';
  if (rows === null) return;

  rows.forEach(([label, value]) => {
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
    setEtaNote(`never — plateaus at ${Math.round(proj.equilibriumKg * 10) / 10} kg`);
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

function renderFormulaPreview() {
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

  if (mode === 'EIN') {
    // τ, MET, κ, Δm, m_g are all typed; Eᵢₙ and t both follow.
    const tau = preview.ACTIVITY_TARGET_MIN;
    const detail = withFormulaOverrides(preview, () => calorieTargetDetail(bodyMassKg));
    if (detail === null) { cantCompute(); return; }
    const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa });
    const proj = projectTargetDays({
      intakeKcal: detail.kcal, bodyMassKg, heightCm, age, sex, met, tau, kappa,
      targetKg: preview.BODY_MASS_TARGET_KG,
    });
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
      ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(a)} kcal/day`],
      ['B', `10 + ${met} × ${tau} × ${kappa} / 200  =  ${bRounded} kcal/day per kg`],
      ['m∞', `(${detail.kcal} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
    ];
    if (proj.status === 'ok') {
      rows.push(['t', `(7700 / ${bRounded}) × ln[(${bodyMassKg} − ${eqRounded}) / (${preview.BODY_MASS_TARGET_KG} − ${eqRounded})]  =  ${Math.round(proj.days)} days`]);
    }
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

    const proj = projectTargetDays({
      intakeKcal: einForDisplay, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg,
    });
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
      ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(a)} kcal/day`],
      ['B', `10 + ${met} × ${tau} × ${kappa} / 200  =  ${bRounded} kcal/day per kg`],
      ['m∞', `(${Math.round(einForDisplay)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
    );
    if (proj.status === 'ok') {
      rows.push(['t', `(7700 / ${bRounded}) × ln[(${bodyMassKg} − ${eqRounded}) / (${targetKg} − ${eqRounded})]  =  ${Math.round(proj.days)} days`]);
    }
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
    const proj = projectTargetDays({
      intakeKcal: einForDisplay, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg,
    });
    renderFormulaDaysField(proj);

    renderFormulaSubstituted([
      ['BMR', `10 × ${bodyMassKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(bmr)} kcal/day`],
      ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
      ['D', `${Math.round(bmr)} + ${Math.round(activityKcal)} − ${Math.round(einForDisplay)}  =  ${Math.round(deficit)} kcal/day`],
      ['Δm', `${Math.round(deficit)} × 7 / 7700  =  ${deltaMSolved} kg/week`],
      ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(a)} kcal/day`],
      ['B', `10 + ${met} × ${tau} × ${kappa} / 200  =  ${bRounded} kcal/day per kg`],
      ['m∞', `(${Math.round(einForDisplay)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      ...(proj.status === 'ok' ? [['t', `(7700 / ${bRounded}) × ln[(${bodyMassKg} − ${eqRounded}) / (${targetKg} − ${eqRounded})]  =  ${Math.round(proj.days)} days`]] : []),
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
  FORMULA_FIELDS.forEach((field) => {
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
  loadFormulaInputsFromSettings();
  applySolveForMode('EIN');
  renderFormulaPreview();
  // No autofocus, same as every other modal here.
  document.getElementById('formula-modal').hidden = false;
}

async function saveFormulaSettings() {
  const { overrides, invalid } = readFormulaInputs();
  if (invalid.length) return;

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
    showFieldError('formula-status', 'Saved — the Caloric Intake chart and the forecast now use these.');
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

  [...FORMULA_FIELDS.map((f) => f.inputId), 'formula-body-mass', 'formula-height', 'formula-age'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderFormulaPreview);
  });
  document.getElementById('formula-sex').addEventListener('change', renderFormulaPreview);

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
      applySolveForMode(currentSolveFor());
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
