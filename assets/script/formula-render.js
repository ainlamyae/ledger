
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
// `plan` carries the figures the correction rows are derived from — the intake, the
// coefficients behind it, the BMR and activity burn, and the horizon λt is measured along.
// Passed in rather than re-read from the boxes because three of the five modes solve for
// something those boxes only catch up with on the next line of this same function.
function renderFormulaSubstituted(rows, plan = null) {
  const el = document.getElementById('formula-substituted');
  el.innerHTML = '';
  // Each derived half is guarded, and separately: this element is cleared above, so
  // anything thrown while building one of them would leave the whole trace — BMR, Eₐ, D,
  // Eᵢₙ, A, B, m∞, t — blank, which is a far worse failure than a few missing lines, and
  // one throwing must not take the other's rows with it either.
  //
  // Δm%, TEF and BMI_g are NOT read here any more — each now sits inside `rows` itself,
  // called by the mode that built it, at the spot the legend puts it (Δm% by D, TEF by
  // Eᵢₙ, BMI_g by m_g), rather than tacked on after everything mode-specific is done.
  let lbmRows = [];
  try {
    lbmRows = renderLbmField();
  } catch (err) {
    console.error('Lean body mass failed to render', err);
  }
  let proteinRows = [];
  try {
    proteinRows = renderProteinFields();
  } catch (err) {
    console.error('Protein band failed to render', err);
  }
  // Independent of the protein block above — reads m̄ and Eᵢₙ, not LBM — but guarded
  // separately for the same reason every block here is: one throwing can't take the others
  // down with it.
  let fiberRows = [];
  try {
    fiberRows = renderFiberFields();
  } catch (err) {
    console.error('Fiber band failed to render', err);
  }
  // Independent of the fiber block above too — reads only Eᵢₙ, no body mass — but guarded
  // separately for the same reason.
  let fatRows = [];
  try {
    fatRows = renderFatFields();
  } catch (err) {
    console.error('Fat band failed to render', err);
  }
  // Independent of the fat block above too — reads only Eᵢₙ, no body mass — but guarded
  // separately for the same reason.
  let carbRows = [];
  try {
    carbRows = renderCarbFields();
  } catch (err) {
    console.error('Carb band failed to render', err);
  }
  // Reads the same LBM box above — guarded separately so a throw here can't take LBM/protein
  // down with it, same as every other block in this function.
  let glycogenRows = [];
  try {
    glycogenRows = renderGlycogenSwingField();
  } catch (err) {
    console.error('Glycogen swing failed to render', err);
  }
  // Guarded separately for the same reason as the two above: BMR, M and the adaptation pair
  // are four boxes and up to two rows, and none of them is worth taking the calorie trace
  // down with it.
  let correctionRows = [];
  try {
    correctionRows = renderCorrectionFields(plan);
  } catch (err) {
    console.error('Correction terms failed to render', err);
  }
  // Independent of the correction block above — reads plan.bmr/plan.intakeKcal directly
  // rather than the adaptation figures — but guarded separately for the same reason.
  let deficitBmrRows = [];
  try {
    deficitBmrRows = renderDeficitVsBmrField(plan);
  } catch (err) {
    console.error('Deficit vs. BMR failed to render', err);
  }

  // LBM leads (it sits with the profile, ahead of everything `rows` itself starts with),
  // then `rows` — which now carries Δm%, TEF and BMI_g inline, at the legend's own
  // positions — then D_bmr% (the one box that compares E_in against BMR, so it sits right
  // after the rows that produce both), then the adaptation pair, then glycogen, protein,
  // fiber, fat and carb: the same order the legend lists them in, and the same order the
  // eye travels down the sheet.
  [...lbmRows, ...(rows ?? []), ...deficitBmrRows, ...correctionRows, ...glycogenRows, ...proteinRows, ...fiberRows, ...fatRows, ...carbRows].forEach(([label, value]) => {
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
// `minB` is the bracket's floor: B at τ = 0, i.e. the BMR equation's own per-kg term over
// the thermic divisor. It used to be the literal 10 Mifflin contributes, which is neither
// Katch's 21.6×c_m nor either of them once (1 − f) has divided it — and a floor above the
// real one silently reports a reachable τ as unsolvable.
function solveBForTypedDays({ deficit, massToLose, t, rho, minB = 10 }) {
  const h = (B) => deficit * (1 - Math.exp((-B * t) / rho)) - massToLose * B;
  const lo = minB;
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

// m_musc, m_gly and the glycogen+water swing they imply, from whatever m̄, h, σ and the
// four glycogen knobs currently read — or null when any of them is missing. Independent
// of "Solve for" like the protein band below: no calorie identity involves it, it's
// purely the explanation for why m and m̄ disagree day to day.
//
// LBM drives it rather than body mass directly, same reasoning Katch-McArdle and the
// protein band already use here: glycogen is stored in muscle (and the liver, which
// doesn't scale with a lifter's muscle mass at all), not in fat, so two people at the
// same body mass but different body composition don't carry the same glycogen store.
// But LBM alone overstates it: skeletal muscle is only about 40-50% of LBM — the rest is
// water, organs, skin and bone, none of which store meaningful glycogen — so applying a
// published muscle-TISSUE glycogen density (g/kg wet muscle) straight to LBM comes out
// roughly double. s cuts LBM down to that muscle share first, so g_musc can be the real
// muscle-tissue figure instead of a diluted per-LBM one.
// Re-derived from m̄/h/σ rather than reading the formula-lbm box, for the same reason
// readProteinFormula does: this has to work in every mode, including ones where that
// box hasn't rendered yet this pass.
function readGlycogenSwingFormula() {
  const bodyMassKg = formulaBodyMassKg();
  const heightCm = formulaNumber('formula-height');
  const sex = document.getElementById('formula-sex').value;
  const skeletalFrac = formulaNumber('formula-glycogen-skeletal-frac');
  const gPerKgMuscle = formulaNumber('formula-glycogen-per-kg-muscle');
  const liverG = formulaNumber('formula-glycogen-liver');
  const waterRatio = formulaNumber('formula-glycogen-water-ratio');
  if (bodyMassKg === null || heightCm === null || skeletalFrac === null || gPerKgMuscle === null
    || liverG === null || waterRatio === null) return null;

  const rawLbm = boerLeanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(rawLbm) || rawLbm <= 0) return null;
  // Rounded to 0.1 kg before it's used further, same as readProteinFormula — otherwise
  // the trace's `s × LBM = m_musc` line would show a rounded LBM that doesn't actually
  // multiply out to the muscle mass figure beside it.
  const lbmKg = Math.round(rawLbm * 10) / 10;
  // s is a share of LBM, not of m̄: it's a fat-free-mass ratio (skeletal muscle vs. the
  // rest of LBM), and m̄ still carries the fat LBM has already had stripped out.
  const muscleKg = Math.round((lbmKg * (skeletalFrac / 100)) * 10) / 10;
  if (muscleKg <= 0) return null;

  const glycogenG = Math.round(gPerKgMuscle * muscleKg + liverG);
  return {
    lbmKg, skeletalFrac, muscleKg, gPerKgMuscle, liverG, glycogenG,
    waterRatio, swingKg: Math.round((glycogenG * (1 + waterRatio)) / 100) / 10,
  };
}

// The m_musc, m_gly and ΔM_gly boxes and their trace rows — always as a pair per box,
// same rule every other computed field here follows. A dash in all three when an input
// is missing.
function renderGlycogenSwingField() {
  const swing = readGlycogenSwingFormula();
  if (swing === null) {
    ['formula-glycogen-muscle', 'formula-glycogen-g', 'formula-glycogen-swing'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { lbmKg, skeletalFrac, muscleKg, gPerKgMuscle, liverG, glycogenG, waterRatio, swingKg } = swing;
  setComputedField('formula-glycogen-muscle', String(muscleKg));
  setComputedField('formula-glycogen-g', String(glycogenG));
  setComputedField('formula-glycogen-swing', String(swingKg));
  return [
    ['m_musc', `${skeletalFrac}% × ${lbmKg}  =  ${muscleKg} kg`],
    ['m_gly', `${gPerKgMuscle} × ${muscleKg} + ${liverG}  =  ${glycogenG} g`],
    ['ΔM_gly', `${glycogenG} × (1 + ${waterRatio}) / 1000  =  ${swingKg} kg`],
  ];
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
  const bodyMassKg = formulaBodyMassKg();
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

// The LBM box and its trace row alone — split out from the protein band below so it can
// sit with the profile (m̄/h/σ/BMR) at the top of the sheet, ahead of the calorie solve,
// while still sharing the one Boer read every other lean-mass consumer here (protein,
// glycogen) uses.
function renderLbmField() {
  const protein = readProteinFormula();

  if (protein === null) {
    setComputedField('formula-lbm', '—');
    return [];
  }

  const { lbmKg, bodyMassKg, heightCm, sex } = protein;
  setComputedField('formula-lbm', String(lbmKg));

  const coefficients = sex === 'male'
    ? `0.407 × ${bodyMassKg} + 0.267 × ${heightCm} − 19.2`
    : `0.252 × ${bodyMassKg} + 0.473 × ${heightCm} − 48.3`;
  return [['LBM', `${coefficients}  =  ${lbmKg} kg`]];
}

// The two protein boxes, and the [label, substituted] rows the trace below appends for
// them — always as a pair, so a shown number and its shown arithmetic come from the same
// read. Empty rows when the band isn't computable, which is the trace's own "nothing to
// say" for these two, not a failure of the calorie solve.
function renderProteinFields() {
  const protein = readProteinFormula();

  // A dash in both boxes is the whole message: which of m, h, p_min, p_max is missing is
  // already visible in the box that's empty, and #formula-profile-note is reporting it for
  // the calorie solve too.
  if (protein === null) {
    ['formula-protein-min', 'formula-protein-max'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { lbmKg, perKgMin, perKgMax, minG, maxG } = protein;
  setComputedField('formula-protein-min', String(minG));
  setComputedField('formula-protein-max', String(maxG));

  return [
    ['P_min', `${perKgMin} × ${lbmKg}  =  ${minG} g/day`],
    ['P_max', `${perKgMax} × ${lbmKg}  =  ${maxG} g/day`],
  ];
}

// The fiber band: a floor scaled to how much you eat (14 g/1000 kcal, the USDA/DGA rule of
// thumb) and a ceiling scaled to body weight (0.5 g/kg) — two different bases, unlike
// protein's single LBM, so neither end rides on a box the other computes.
//
// Reads formula-ein directly rather than re-deriving it: by the time renderFiberFields runs
// (from renderFormulaSubstituted, after the calorie half of the sheet), that box already
// holds this render's Eᵢₙ — typed or solved, in every mode — so this is the one read that
// can't disagree with what the sheet just showed.
function readFiberFormula() {
  const bodyMassKg = formulaBodyMassKg();
  const einKcal = formulaNumber('formula-ein');
  const perKcalMin = formulaNumber('formula-fiber-per-1000kcal-min');
  const perKgMax = formulaNumber('formula-fiber-per-kg-max');
  if (bodyMassKg === null || einKcal === null || perKcalMin === null || perKgMax === null) return null;

  return {
    bodyMassKg, einKcal, perKcalMin, perKgMax,
    minG: Math.round(perKcalMin * (einKcal / 1000)),
    maxG: Math.round(perKgMax * bodyMassKg),
  };
}

// The two fiber boxes and their trace rows — same pairing and same dash-on-missing-input
// convention renderProteinFields uses.
function renderFiberFields() {
  const fiber = readFiberFormula();

  if (fiber === null) {
    ['formula-fiber-min', 'formula-fiber-max'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { bodyMassKg, einKcal, perKcalMin, perKgMax, minG, maxG } = fiber;
  setComputedField('formula-fiber-min', String(minG));
  setComputedField('formula-fiber-max', String(maxG));

  return [
    ['F_min', `${perKcalMin} × (${einKcal} / 1000)  =  ${minG} g/day`],
    ['F_max', `${perKgMax} × ${bodyMassKg}  =  ${maxG} g/day`],
  ];
}

// The fat band: both ends a share of Eᵢₙ (20-35%, the IOM's Acceptable Macronutrient
// Distribution Range for adults) converted to grams at fat's fixed 9 kcal/g energy density —
// unlike fiber's two different bases, both k_min and k_max scale off the same Eᵢₙ, since
// that's how the AMDR itself is defined.
//
// Reads formula-ein directly, same reason readFiberFormula does: by the time
// renderFatFields runs (from renderFormulaSubstituted, after the calorie half of the sheet),
// that box already holds this render's Eᵢₙ — typed or solved, in every mode.
function readFatFormula() {
  const einKcal = formulaNumber('formula-ein');
  const pctMin = formulaNumber('formula-fat-pct-min');
  const pctMax = formulaNumber('formula-fat-pct-max');
  if (einKcal === null || pctMin === null || pctMax === null) return null;

  return {
    einKcal, pctMin, pctMax,
    minG: Math.round((pctMin / 100) * einKcal / KCAL_PER_G_FAT),
    maxG: Math.round((pctMax / 100) * einKcal / KCAL_PER_G_FAT),
  };
}

// The two fat boxes and their trace rows — same pairing and same dash-on-missing-input
// convention renderFiberFields uses.
function renderFatFields() {
  const fat = readFatFormula();

  if (fat === null) {
    ['formula-fat-min', 'formula-fat-max'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { einKcal, pctMin, pctMax, minG, maxG } = fat;
  setComputedField('formula-fat-min', String(minG));
  setComputedField('formula-fat-max', String(maxG));

  return [
    ['G_min', `(${pctMin}% × ${einKcal}) / ${KCAL_PER_G_FAT}  =  ${minG} g/day`],
    ['G_max', `(${pctMax}% × ${einKcal}) / ${KCAL_PER_G_FAT}  =  ${maxG} g/day`],
  ];
}

// The carb band: both ends a share of Eᵢₙ (45-65%, the IOM's Acceptable Macronutrient
// Distribution Range for adults) converted to grams at carbohydrate's fixed 4 kcal/g energy
// density — same shape as readFatFormula, just the AMDR's other end and Atwater factor.
//
// Reads formula-ein directly, same reason readFatFormula does: by the time
// renderCarbFields runs (from renderFormulaSubstituted, after the calorie half of the sheet),
// that box already holds this render's Eᵢₙ — typed or solved, in every mode.
function readCarbFormula() {
  const einKcal = formulaNumber('formula-ein');
  const pctMin = formulaNumber('formula-carb-pct-min');
  const pctMax = formulaNumber('formula-carb-pct-max');
  if (einKcal === null || pctMin === null || pctMax === null) return null;

  return {
    einKcal, pctMin, pctMax,
    minG: Math.round((pctMin / 100) * einKcal / KCAL_PER_G_CARB),
    maxG: Math.round((pctMax / 100) * einKcal / KCAL_PER_G_CARB),
  };
}

// The two carb boxes and their trace rows — same pairing and same dash-on-missing-input
// convention renderFatFields uses.
function renderCarbFields() {
  const carb = readCarbFormula();

  if (carb === null) {
    ['formula-carb-min', 'formula-carb-max'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { einKcal, pctMin, pctMax, minG, maxG } = carb;
  setComputedField('formula-carb-min', String(minG));
  setComputedField('formula-carb-max', String(maxG));

  return [
    ['C_min', `(${pctMin}% × ${einKcal}) / ${KCAL_PER_G_CARB}  =  ${minG} g/day`],
    ['C_max', `(${pctMax}% × ${einKcal}) / ${KCAL_PER_G_CARB}  =  ${maxG} g/day`],
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
// BMI_g → m_g, run before anything reads the kilograms box — same shape and same reason as
// syncWeeklyLossFromPct below, and written raw rather than through setComputedField for the
// same one too: m_g is a settings-backed field read unconditionally by readFormulaInputs, and
// a privacy-masked placeholder in it would report BODY_MASS_TARGET_KG invalid and disable
// Save.
function syncTargetMassFromBmi() {
  if (!targetBmiIsTyped()) return;
  const bmi = formulaNumber('formula-target-bmi');
  const heightCm = formulaNumber('formula-height');
  if (bmi === null || heightCm === null || heightCm <= 0) return;
  document.getElementById('formula-target').value = String(bodyMassKgFromBmi(bmi, heightCm));
}

// The BMI_g box and the trace row for the identity — always as a pair, so the figure shown
// and the arithmetic behind it come from a single read. m_g comes off its box rather than
// being passed in: by the time the trace is built that box holds this render's value in every
// mode — typed in four of them, and freshly solved in TARGET_MASS.
//
// Always printed in the m_g → BMI direction whichever box was typed, for the same reason the
// Δm% row is: the kilograms are what the rest of the sheet actually used, so tracing them is
// the honest line even when a BMI produced them.
function renderTargetBmiField() {
  const targetKg = formulaNumber('formula-target');
  const heightCm = formulaNumber('formula-height');
  const el = document.getElementById('formula-target-bmi');
  const typed = targetBmiIsTyped();

  if (targetKg === null || heightCm === null || heightCm <= 0) {
    if (!typed) setComputedField('formula-target-bmi', '');
    el.classList.remove('formula-out-of-band');
    return [];
  }

  const bmi = computeBmi(targetKg, heightCm);
  if (!typed) setComputedField('formula-target-bmi', String(bmi));
  const verdict = bmiVerdict(bmi);
  el.classList.toggle('formula-out-of-band', verdict.outside);
  return [['BMI_des', `${targetKg} / (${heightCm / 100})²  =  ${bmi} kg/m² — ${verdict.text}`]];
}

function syncWeeklyLossFromPct() {
  if (!weeklyLossPctIsTyped()) return;
  const kg = weeklyFatLossKgFromPct(formulaNumber('formula-weekly-loss-pct'), formulaBodyMassKg());
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
  const bodyMassKg = formulaBodyMassKg();
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

// The BMR line, in whichever equation the radio has selected. Both print the same way —
// coefficients substituted, then the figure — so switching equations changes the arithmetic
// on show rather than only the answer at the end of it. The Katch line quotes the same
// rounded LBM the LBM box shows, which is why it multiplies out exactly.
function formulaBmrRow(bmr, { bodyMassKg, heightCm, age, sex, formula }) {
  if (formula === 'katch') {
    return ['BMR', `370 + 21.6 × ${bmrLeanBodyMassKg(bodyMassKg, heightCm, sex)}  =  ${Math.round(bmr)} kcal/day — Katch-McArdle, from lean mass`];
  }
  const sigma = sex === 'male' ? '+ 5' : '− 161';
  return ['BMR', `10 × ${bodyMassKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(bmr)} kcal/day`];
}

// The A and B lines, which move under both switches: Katch replaces BMR's mass-free terms
// and its per-kg coefficient (age drops out), and f divides whatever those come to. Printed
// as the bracket then the divisor, the same shape the identity is written in, so a shifted
// figure can be traced to whichever of the two moved it. At f = 0 the divisor is left off
// entirely rather than printed as a "/ 1" nobody needs to read.
function formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }) {
  const { a, b, tefDivisor: divisor, formula } = coefficients;
  const lbm = boerLeanBodyMassCoefficients(sex);
  const sigma = sex === 'male' ? '+ 5' : '− 161';
  const aTerms = formula === 'katch'
    ? `370 + 21.6 × (${lbm.perCm} × ${heightCm} − ${Math.abs(lbm.constant)})`
    : `6.25 × ${heightCm} − 5 × ${age} ${sigma}`;
  const bTerms = formula === 'katch'
    ? `21.6 × ${lbm.perKg} + ${met} × ${tau} × ${kappa} / 200`
    : `10 + ${met} × ${tau} × ${kappa} / 200`;
  const byDivisor = divisor === 1 ? '' : `, all / ${Math.round(divisor * 1000) / 1000}`;
  return [
    ['A', `${aTerms}${byDivisor}  =  ${Math.round(a)} kcal/day`],
    ['B', `${bTerms}${byDivisor}  =  ${Math.round(b * 100) / 100} kcal/day per kg`],
  ];
}

// The Eᵢₙ line. Two forms, because there are two identities: without a thermic share it's
// the plain sum this app has always printed, and with one it's that sum divided by (1 − f)
// — the solved form, since TEF is a share of the answer rather than a known term.
function formulaEinRows(coefficients, { bmr, activityKcal, deficit, einKcal }) {
  const divisor = coefficients.tefDivisor;
  const sum = `${Math.round(bmr)} + ${Math.round(activityKcal)} − ${Math.round(deficit)}`;
  if (divisor === 1) return [['TEI', `${sum}  =  ${Math.round(einKcal)} kcal/day`]];
  return [['TEI', `(${sum}) / ${Math.round(divisor * 1000) / 1000}  =  ${Math.round(einKcal)} kcal/day`]];
}

// The same identity read the other way, for the mode that solves for Δm: D is what's left of
// maintenance once the intake and the digestion it costs are both accounted for. Two forms
// again, so that at f = 0 the line is the plain subtraction it has always been.
function formulaDeficitRows(coefficients, { bmr, activityKcal, einKcal, deficit }) {
  const divisor = coefficients.tefDivisor;
  const head = `${Math.round(bmr)} + ${Math.round(activityKcal)} − `;
  const intake = divisor === 1
    ? `${Math.round(einKcal)}`
    : `${Math.round(einKcal)}×${Math.round(divisor * 1000) / 1000}`;
  return [['D', `${head}${intake}  =  ${Math.round(deficit)} kcal/day`]];
}

// f, λ and λt_max as this render sees them. Kept together because all three are read on
// every path including the failure ones, where the boxes still have to be brought in line
// with a plan that didn't compute.
function readAdaptationInputs() {
  return {
    pctPerWeek: formulaNumber('formula-adapt-per-week'),
    pctCap: formulaNumber('formula-adapt-cap'),
  };
}

// The TEF box and the two adaptation boxes, plus the trace rows for them — filled from one
// `plan` so a shown figure and its shown arithmetic can't come from different renders. Null
// (a failed or absent calorie solve) dashes all three: none of them means anything without
// an Eᵢₙ to be a share of.
//
// Adaptation is evaluated at the horizon t this render produced, because λt is a function of
// time on the diet and t is the only day count on the sheet. Without one — an unreachable
// target — the cap is quoted instead, which is where λt was heading anyway.
// The TEF box and its trace row — reads formula-ein and f (formula-tef-pct) directly,
// same reason renderFiberFields/renderFatFields do: by the time this runs, formula-ein
// already holds this render's value in every mode, so this can't disagree with what the
// sheet just showed. Split out from renderCorrectionFields so it can sit right above Eᵢₙ
// rather than down with the adaptation pair.
function readTefFormula() {
  const einKcal = formulaNumber('formula-ein');
  const tefPct = formulaNumber('formula-tef-pct');
  if (einKcal === null || tefPct === null) return null;
  return { einKcal, tefPct, tefKcal: Math.round(einKcal * (tefPct / 100)) };
}

function renderTefField() {
  const tef = readTefFormula();

  if (tef === null) {
    setComputedField('formula-tef', '—');
    return [];
  }

  const { einKcal, tefPct, tefKcal } = tef;
  setComputedField('formula-tef', String(tefKcal));
  // Only when there is one: at f = 0 the identity is true and empty, and a row reading
  // "0 × 1163 = 0" is three columns of nothing.
  if (tefKcal <= 0) return [];
  return [['TEF', `${tefPct}% × ${einKcal}  =  ${tefKcal} kcal/day`]];
}

// The `δ` box and its trace rows (η, δ) — always as a pair with the box, so the
// number shown and the arithmetic behind it come from one call. `sleepInfo` is
// `{ weeklyFatLossKg, rawDeficit, deficit, sleepDeprivationEffectKcal, factor, pctPerHour,
// planSleepHours, sleepTargetHours }` — either calorieTargetDetail's own return
// (EIN/FIXED_PCT) or the equivalent object TAU builds locally from the same
// sleepAdjustedDeficitKcal call. Both already ran that call through the render's own
// `preview` overlay, so `factor`/`pctPerHour` reflect a typed-but-unsaved γ — this reads
// them back off the object rather than re-deriving either, which would read the SAVED
// setting instead and disagree with the box on screen.
// `null` in TARGET_MASS and DELTA_M: both those modes reverse-solve D FROM a typed Eᵢₙ
// rather than building it from a target rate, so "how much bigger does D need to be" is
// a question that doesn't arise there — see the mode-specific comments at each call site.
function renderSleepDeprivationField(sleepInfo) {
  if (sleepInfo === null) {
    setComputedField('formula-deprivation-effect', '—');
    return [];
  }
  const { rawDeficit, sleepDeprivationEffectKcal, factor, pctPerHour, planSleepHours, sleepTargetHours } = sleepInfo;
  setComputedField('formula-deprivation-effect', String(sleepDeprivationEffectKcal));
  // Only when there is one: at s ≥ s_target the identity is true and empty, same reason
  // TEF's row above is skipped at f = 0.
  if (sleepDeprivationEffectKcal <= 0) return [];
  const factorRounded = Math.round(factor * 1000) / 1000;
  return [
    ['η', `1 − (${pctPerHour}/100) × max(0, ${sleepTargetHours} − ${planSleepHours})  =  ${factorRounded}`],
    ['SD', `${Math.round(rawDeficit)} / ${factorRounded} − ${Math.round(rawDeficit)}  =  ${sleepDeprivationEffectKcal} kcal/day`],
  ];
}

// The D row itself, in whichever form applies: the plain rate this app has always shown
// when sleep isn't costing anything, or that same rate divided by η when it is — so a
// reader can trace exactly where the extra kcal in δ above came from.
function formulaDeficitTraceLine(sleepInfo) {
  const raw = `${sleepInfo.weeklyFatLossKg} × 7700 / 7`;
  if (sleepInfo.sleepDeprivationEffectKcal <= 0) return `${raw}  =  ${Math.round(sleepInfo.deficit)} kcal/day`;
  const factorRounded = Math.round(sleepInfo.factor * 1000) / 1000;
  return `(${raw}) / ${factorRounded}  =  ${Math.round(sleepInfo.deficit)} kcal/day`;
}

// Past this share of BMR, more of what a deficit costs tends to come from lean
// mass rather than fat — the box turns red as a warning against too harsh a cut,
// not a hard limit (nothing here blocks the value or the save).
const DEFICIT_VS_BMR_PCT_CEILING = 20;

// The D_bmr% box and its trace row — how far E_in sits below BMR, as a percentage
// of BMR. Reads plan.bmr/plan.intakeKcal rather than the formula-bmr/formula-ein
// boxes directly: those two are set at different points across the five modes (the
// correction block above sets formula-bmr itself, later in this same render pass),
// while plan already carries both figures this render actually used, however they
// were derived. Not part of the calorie algebra — nothing downstream reads this
// box — it exists only to flag the cut, so a failed calorie solve (plan === null)
// just dashes it rather than blocking anything.
function renderDeficitVsBmrField(plan) {
  const el = document.getElementById('formula-deficit-bmr-pct');
  if (plan === null || !Number.isFinite(plan.bmr) || plan.bmr === 0) {
    setComputedField('formula-deficit-bmr-pct', '—');
    el.classList.remove('formula-pct-over');
    return [];
  }

  const { bmr, intakeKcal } = plan;
  const pct = Math.round(((bmr - intakeKcal) / bmr) * 1000) / 10;
  setComputedField('formula-deficit-bmr-pct', String(pct));
  el.classList.toggle('formula-pct-over', pct > DEFICIT_VS_BMR_PCT_CEILING);

  return [['D_bmr%', `(${Math.round(bmr)} − ${Math.round(intakeKcal)}) / ${Math.round(bmr)} × 100  =  ${pct} %`]];
}

function renderCorrectionFields(plan) {
  const bmrEl = 'formula-bmr-adapt';
  const plateauEl = 'formula-plateau-adapt';
  const { pctPerWeek, pctCap } = readAdaptationInputs();

  if (plan === null) {
    ['formula-bmr', 'formula-activity-kcal', 'formula-maintenance', 'formula-deficit', bmrEl, plateauEl].forEach((id) => setComputedField(id, '—'));
    renderSleepDeprivationField(null);
    return [];
  }

  const { intakeKcal, coefficients, bmr, activityKcal, deficit, days, journey } = plan;
  const rows = [];

  // Two figures with boxes but no trace rows of their own here — BMR and Eₐ already print
  // their substituted lines as rows of every mode, D prints its own in all but TARGET_MASS,
  // and M is just the BMR and Eₐ boxes added together in front of the reader.
  setComputedField('formula-bmr', String(Math.round(bmr)));
  setComputedField('formula-activity-kcal', String(Math.round(activityKcal)));
  setComputedField('formula-maintenance', String(Math.round(bmr + activityKcal)));
  setComputedField('formula-deficit', String(Math.round(deficit)));

  if (pctPerWeek === null || pctCap === null || bmr === null) {
    [bmrEl, plateauEl].forEach((id) => setComputedField(id, '—'));
    return rows;
  }

  // At the cap when there's no arrival date to measure λt at — named as such in the trace,
  // so the figure is never read as "by day t" when there is no t.
  const atCap = days === null;
  const fraction = atCap
    ? adaptationFraction(Infinity, pctPerWeek, pctCap)
    : adaptationFraction(days, pctPerWeek, pctCap);
  const adaptedBmr = bmr * (1 - fraction);
  const lostPct = Math.round(fraction * 1000) / 10;
  setComputedField(bmrEl, String(Math.round(adaptedBmr)));
  rows.push(['BMR_adp', `${Math.round(bmr)} × (1 − ${lostPct}/100)  =  ${Math.round(adaptedBmr)} kcal/day — ${atCap ? `at the ${pctCap}% ceiling` : `by day ${Math.round(days)}`}`]);

  // A proportional journey has no plateau to move, so there is no overshoot to report —
  // the same reason the m∞ rows are dropped in that journey (see renderFormulaPreview). The
  // reason goes in the trace, never in the unit column, which reads `kg` and stops.
  if (journey === 'pct') {
    setComputedField(plateauEl, '—');
    rows.push(['m∞_adp', 'no plateau on a proportional journey, so no overshoot to report']);
    return rows;
  }

  const plateauKg = adaptedPlateauKg(intakeKcal, coefficients, fraction);
  const plainPlateauKg = (intakeKcal - coefficients.a) / coefficients.b;
  if (!Number.isFinite(plateauKg)) {
    setComputedField(plateauEl, '—');
    return rows;
  }

  const plateauRounded = Math.round(plateauKg * 10) / 10;
  const overshootKg = Math.round((plateauKg - plainPlateauKg) * 10) / 10;
  setComputedField(plateauEl, String(plateauRounded));
  rows.push(['m∞_adp', `(${Math.round(intakeKcal)} − ${Math.round(coefficients.aBmr * (1 - fraction) / coefficients.tefDivisor)}) / ${Math.round(((1 - fraction) * coefficients.bBmr + coefficients.activityPerKg) / coefficients.tefDivisor * 100) / 100}  =  ${plateauRounded} kg${overshootKg > 0 ? ` — ${overshootKg} kg above m∞, which is the usual overshoot` : ''}`]);
  return rows;
}

function renderFormulaPreview() {
  // Both unit-pair syncs first, before anything reads the box each one writes: a typed BMI
  // has to become kilograms before m_g is read, exactly as a typed Δm% has to become
  // kilograms before Δm is.
  syncTargetMassFromBmi();
  syncWeeklyLossFromPct();
  const { mode, preview, bodyMassKg, heightCm, age, sex, formula, einKcal, days, invalid } = readFormulaInputs();
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
  const bmr = bmrKcal(bodyMassKg, heightCm, age, sex, formula);
  const tef = preview[TEF_PERCENT_KEY];

  // Everything maintenanceAffineCoefficients and projectTargetDays need except τ, which is
  // the one member of the set a mode can solve for. Spread with the mode's own τ at each
  // call site, so the two BMR equations and the thermic share reach the coefficients, the
  // forecast and the trace through one object rather than eight repeated argument lists.
  const profile = { heightCm, age, sex, met, kappa, formula, tef };
  const bmrRow = formulaBmrRow(bmr, { bodyMassKg, heightCm, age, sex, formula });

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
    // "Arrived" is judged past the target by the glycogen/water swing (see
    // arrivalTargetKg in charts.js) — the same rule the live State Trend & Forecast
    // chart's own arrival date uses, so this t can't disagree with it.
    const forecastTargetKg = arrivalTargetKg(targetKg, bodyMassKg, heightCm, sex, targetKg < bodyMassKg);
    const detail = withFormulaOverrides(preview, () => calorieTargetDetail(bodyMassKg));
    if (detail === null) { cantCompute(); return; }
    const weeklyPct = weeklyLossPctInPlay(detail.weeklyFatLossKg, bodyMassKg);
    const coefficients = maintenanceAffineCoefficients({ ...profile, tau });
    const { a, b } = coefficients;
    const proj = formulaProjection({
      intakeKcal: detail.kcal, bodyMassKg, targetKg: forecastTargetKg, tau, ...profile,
    }, weeklyPct);
    setComputedField('formula-ein', String(Math.round(detail.kcal)));
    renderFormulaDaysField(proj);

    // calorieTargetDetail already ran the sleep adjustment (see sleepAdjustedDeficitKcal in
    // wellness-math.js) — `detail` IS the sleepInfo shape renderSleepDeprivationField wants,
    // so this mode reads the deficit straight off it rather than recomputing the raw rate.
    const deficit = detail.deficit;
    const bRounded = Math.round(b * 100) / 100;
    const eqRounded = Math.round(((detail.kcal - a) / b) * 10) / 10;
    const rows = [
      bmrRow,
      ['AEE', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(detail.activityKcal)} kcal/day`],
      ...renderSleepDeprivationField(detail),
      ...renderWeeklyLossPctField(),
      ['D', formulaDeficitTraceLine(detail)],
      ...renderTefField(),
      ...formulaEinRows(coefficients, {
        bmr: detail.bmr, activityKcal: detail.activityKcal, deficit, einKcal: detail.kcal,
      }),
      ...renderTargetBmiField(),
    ];
    // A, B and m∞ are the constant-intake journey's plateau. On the proportional one nothing
    // holds Eᵢₙ still and there is no plateau, so printing them would trace a journey this
    // t was never measured along — the same reason TARGET_MASS omits BMR/Eₐ/D.
    if (proj.journey !== 'pct') {
      rows.push(
        ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
        ['m∞', `(${detail.kcal} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      );
    }
    rows.push(...formulaDaysRow(proj, { bodyMassKg, targetKg: forecastTargetKg, weeklyPct, bRounded, eqRounded }));
    renderFormulaSubstituted(rows, {
      intakeKcal: detail.kcal,
      coefficients,
      bmr: detail.bmr,
      activityKcal: detail.activityKcal,
      deficit,
      days: proj.status === 'ok' ? proj.days : null,
      journey: proj.journey,
    });
    return;
  }

  if (mode === 'TAU') {
    const deltaM = preview.WEEKLY_FAT_LOSS_KG;
    const targetKg = preview.BODY_MASS_TARGET_KG;
    const knownField = dualKnownField.TAU;

    // Δm is the fixed known in BOTH directions of this mode — only τ (and, in the
    // days-known direction, Eᵢₙ) is being solved for — so the sleep adjustment applies
    // the same forward way calorieTargetDetail's own does, regardless of which box drove
    // the solve.
    const planSleepHours = preview.PLAN_SLEEP_HOURS;
    const sleepTargetHours = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);
    const rawDeficit = (deltaM * GENERIC_KCAL_PER_KG_FAT) / 7;
    // Wrapped so a typed-but-unsaved γ (SLEEP_DEPRIVATION_PCT_PER_HOUR, read inside this
    // call) reaches the preview the same way it reaches calorieTargetDetail's own call in
    // EIN/FIXED_PCT mode above.
    const { deficitKcal: deficit, sleepDeprivationEffectKcal, factor, pctPerHour } = withFormulaOverrides(
      preview, () => sleepAdjustedDeficitKcal(rawDeficit, planSleepHours, sleepTargetHours),
    );
    const sleepInfo = {
      weeklyFatLossKg: deltaM, rawDeficit, deficit, sleepDeprivationEffectKcal, factor, pctPerHour, planSleepHours, sleepTargetHours,
    };

    // Both directions below solve the same identity the coefficients are built from, so they
    // read the thermic divisor and the BMR equation's per-kg term off ONE construction of it
    // rather than re-deriving either. τ is a placeholder here — it cancels out of everything
    // read at this point (the divisor, and the BMR half of B).
    const shape = maintenanceAffineCoefficients({ ...profile, tau: 0 });
    const divisor = shape.tefDivisor;

    let tau;
    if (knownField === 'ein') {
      // Eᵢₙ×(1−f) = BMR + m·MET·τ·κ/ε − D  ⇒  m·MET·τ·κ/ε = Eᵢₙ×(1−f) + D − BMR
      const activityKcalNeeded = einKcal * divisor + deficit - bmr;
      tau = Math.round((activityKcalNeeded * ML_O2_PER_KCAL) / (met * bodyMassKg * kappa));
    } else {
      // t and m_g typed instead of Eᵢₙ: no algebra isolates τ here (see
      // solveBForTypedDays), so this direction root-finds B numerically. Both the deficit and
      // the solved B are the TEF-scaled ones — dividing D by (1 − f) is exactly what turns
      // the un-thermic identity into the thermic one (see the derivation there) — so the
      // minutes come back out by undoing that divisor and the BMR term B carries.
      const c = (met * kappa) / ML_O2_PER_KCAL;
      const B = solveBForTypedDays({
        deficit: deficit / divisor,
        massToLose: bodyMassKg - targetKg,
        t: days,
        rho: GENERIC_KCAL_PER_KG_FAT,
        minB: shape.bBmr / divisor,
      });
      tau = B === null ? NaN : Math.round((B * divisor - shape.bBmr) / c);
    }
    if (!Number.isFinite(tau) || tau < 0) { cantCompute(); return; }
    setComputedField('formula-activity-min', String(tau));

    const coefficients = maintenanceAffineCoefficients({ ...profile, tau });
    const { a, b } = coefficients;
    const activityKcal = withFormulaOverrides(
      { ...preview, ACTIVITY_TARGET_MIN: tau },
      () => activityTargetKcal(bodyMassKg),
    );
    // When t was typed, Eᵢₙ was never given — it's exactly what the solved τ
    // implies via the same flat equation the 'ein' direction runs forward, thermic
    // divisor and all.
    const einForDisplay = knownField === 'ein' ? einKcal : (bmr + activityKcal - deficit) / divisor;

    // Pin-aware only in the Eᵢₙ-known direction, where t is computed forward from the rate.
    // The other direction SOLVED τ from a typed t through the constant-Eᵢₙ decay identity
    // (solveBForTypedDays), so its projection has to be read in that same model — a
    // proportional t here would contradict the very day count τ was fitted to.
    const weeklyPct = weeklyLossPctInPlay(deltaM, bodyMassKg);
    // Only in the forward (Eᵢₙ-known) direction: the other direction solved τ against the
    // TYPED target above (massToLose), so redisplaying it against a different figure here
    // would contradict the very day count τ was fitted to.
    const forecastTargetKg = knownField === 'ein'
      ? arrivalTargetKg(targetKg, bodyMassKg, heightCm, sex, targetKg < bodyMassKg)
      : targetKg;
    const projArgs = { intakeKcal: einForDisplay, bodyMassKg, targetKg: forecastTargetKg, tau, ...profile };
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
      bmrRow,
      ['AEE', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
      ...renderSleepDeprivationField(sleepInfo),
      ...renderWeeklyLossPctField(),
      ['D', formulaDeficitTraceLine(sleepInfo)],
      ...renderTefField(),
      ...formulaEinRows(coefficients, { bmr, activityKcal, deficit, einKcal: einForDisplay }),
      ...renderTargetBmiField(),
    );
    if (proj.journey !== 'pct') {
      rows.push(
        ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
        ['m∞', `(${Math.round(einForDisplay)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      );
    }
    rows.push(...formulaDaysRow(proj, { bodyMassKg, targetKg: forecastTargetKg, weeklyPct, bRounded, eqRounded }));
    renderFormulaSubstituted(rows, {
      intakeKcal: einForDisplay,
      coefficients,
      bmr,
      activityKcal,
      deficit,
      // Typed in the t-known direction, projected in the other — either way it's the horizon
      // this render's plan actually arrives on, which is what λt is measured along.
      days: knownField === 'days' ? days : (proj.status === 'ok' ? proj.days : null),
      journey: proj.journey,
    });
    return;
  }

  if (mode === 'TARGET_MASS') {
    // Eᵢₙ and t are both typed; solve m_g from the same exponential-decay
    // identity projectTargetDays uses in the other direction.
    const tau = preview.ACTIVITY_TARGET_MIN;
    const coefficients = maintenanceAffineCoefficients({ ...profile, tau });
    const { a, b } = coefficients;
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
    // (the mass-independent / mass-scaling split) feed the m_g identity below. D isn't
    // being built from a target rate here — Eᵢₙ is typed — so there's no forward "how
    // much bigger does D need to be" question for the sleep adjustment to answer; dashed
    // rather than computed.
    renderSleepDeprivationField(null);
    renderFormulaSubstituted([
      ...renderTefField(),
      ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
      ['m∞', `(${Math.round(einKcal)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      ['m_des', `${eqRounded} + (${bodyMassKg} − ${eqRounded}) × e^(−${bRounded}×${days}/7700)  =  ${mGRounded} kg`],
      ...renderTargetBmiField(),
      ...renderWeeklyLossPctField(),
    ], (() => {
      // The BMR, activity and deficit figures this mode doesn't print are still what the
      // correction boxes describe, so they're computed here rather than left out — the trace
      // omits them because they don't feed m_g, not because they're unknown. D is the one
      // the typed Eᵢₙ implies at the CURRENT mass, which is the only sense the box can have
      // in a mode that solves for a future one.
      const activityKcal = withFormulaOverrides(preview, () => activityTargetKcal(bodyMassKg));
      return {
        intakeKcal: einKcal,
        coefficients,
        bmr,
        activityKcal,
        deficit: bmr + activityKcal - einKcal * coefficients.tefDivisor,
        days,
        journey: 'intake',
      };
    })());
    return;
  }

  // DELTA_M: either Eᵢₙ or t can be the known that drives this one — unlike
  // TAU, Δm has no effect on the timing (it only ever enters through Eᵢₙ), so
  // neither direction needs the numerical step TAU's t-known path does.
  const tau = preview.ACTIVITY_TARGET_MIN;
  const targetKg = preview.BODY_MASS_TARGET_KG;
  const coefficients = maintenanceAffineCoefficients({ ...profile, tau });
  const { a, b } = coefficients;
  const activityKcal = withFormulaOverrides(preview, () => activityTargetKcal(bodyMassKg));
  const knownField = dualKnownField.DELTA_M;
  // D is reverse-solved FROM Eᵢₙ or m_g in this mode (below), never built from a target
  // rate — so, same as TARGET_MASS, there's no forward question for the sleep adjustment
  // to answer here; dashed rather than computed.
  renderSleepDeprivationField(null);

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

  // The thermic share comes off the intake before the deficit is read from it: D is what's
  // left of maintenance once the intake and its own digestion cost are accounted for, which
  // is the same Eᵢₙ×(1−f) = BMR + Eₐ − D line every other mode solves.
  const deficit = bmr + activityKcal - einForDisplay * coefficients.tefDivisor;
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
    // "Arrived" is judged past the target by the glycogen/water swing (see
    // arrivalTargetKg in charts.js) — the same rule the live State Trend & Forecast
    // chart's own arrival date uses, so this t can't disagree with it.
    const forecastTargetKg = arrivalTargetKg(targetKg, bodyMassKg, heightCm, sex, targetKg < bodyMassKg);
    const proj = formulaProjection({
      intakeKcal: einForDisplay, bodyMassKg, targetKg: forecastTargetKg, tau, ...profile,
    }, weeklyPct);
    renderFormulaDaysField(proj);

    renderFormulaSubstituted([
      bmrRow,
      ['AEE', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
      ...formulaDeficitRows(coefficients, { bmr, activityKcal, einKcal: einForDisplay, deficit }),
      ...renderTefField(),
      ['Δm', `${Math.round(deficit)} × 7 / 7700  =  ${deltaMSolved} kg/week`],
      ...(proj.journey === 'pct' ? [] : [
        ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
        ['m∞', `(${Math.round(einForDisplay)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      ]),
      ...formulaDaysRow(proj, { bodyMassKg, targetKg: forecastTargetKg, weeklyPct, bRounded, eqRounded }),
      ...renderTargetBmiField(),
      ...renderWeeklyLossPctField(),
    ], {
      intakeKcal: einForDisplay,
      coefficients,
      bmr,
      activityKcal,
      deficit,
      days: proj.status === 'ok' ? proj.days : null,
      journey: proj.journey,
    });
    return;
  }

  // t was known here, so — unlike a projection — the arrival date is just
  // today plus that many days, not something projectTargetDays derives.
  setEtaDate(isoDateFromDays(days));
  setEtaNote('');
  setComputedField('formula-ein', String(Math.round(einForDisplay)));

  const decayRounded = Math.round(decay * 1000) / 1000;
  renderFormulaSubstituted([
    ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
    ['m∞', `(${targetKg} − ${bodyMassKg}×${decayRounded}) / (1 − ${decayRounded})  =  ${eqRounded} kg`],
    ['TEI', `${Math.round(a)} + ${bRounded} × ${eqRounded}  =  ${Math.round(einForDisplay)} kcal/day`],
    ...renderTefField(),
    bmrRow,
    ['AEE', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
    ...formulaDeficitRows(coefficients, { bmr, activityKcal, einKcal: einForDisplay, deficit }),
    ['Δm', `${Math.round(deficit)} × 7 / 7700  =  ${deltaMSolved} kg/week`],
    ...renderTargetBmiField(),
    ...renderWeeklyLossPctField(),
  ], {
    intakeKcal: einForDisplay,
    coefficients,
    bmr,
    activityKcal,
    deficit,
    days,
    journey: 'intake',
  });
}
