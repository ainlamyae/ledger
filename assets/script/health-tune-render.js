// Calculations: every formula with the figures it actually used. `rows` is the mode's own
// trace (null when the solve failed); the blocks that don't depend on the solve are added
// here. `plan` holds the figures this render solved, which the boxes may not show yet.
function renderFormulaSubstituted(rows, plan = null) {
  const el = document.getElementById('formula-substituted');
  el.innerHTML = '';
  // Each block is guarded on its own, so one throwing can't blank the rest.
  const safeRows = (name, build) => {
    try {
      return build();
    } catch (err) {
      console.error(`${name} failed to render`, err);
      return [];
    }
  };
  const allRows = [
    ...safeRows('Body-shape checks', renderBodyShapeFields),
    ...safeRows('U.S. Navy body fat', renderNavyFields),
    ...safeRows('Lean body mass', renderLbmField),
    ...(rows ?? []),
    ...safeRows('Deficit vs. BMR', () => renderDeficitVsBmrField(plan)),
    ...safeRows('Correction terms', () => [...renderCorrectionFields(plan), ...bmrAverageRows()]),
    ...safeRows('Glycogen swing', renderGlycogenSwingField),
    ...MACRO_BANDS.flatMap((band) => safeRows(band.block, () => renderMacroBand(band))),
  ];
  appendLabelledRows(el, sortRowsByTuneOrder(allRows));
}

// Each [label, value] as a "label: value" paragraph, masked in privacy mode.
function appendLabelledRows(el, rows) {
  rows.forEach(([label, value]) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    p.append(strong, document.createTextNode(privacyMode ? maskDigits(value) : value));
    el.appendChild(p);
  });
}

// Lines without a row of their own, placed just before the row they lead into
// (A, B, m∞ come before the adaptation pair, as in the Equations list).
const CALCULATION_ANCHORS = { A: 'λ', B: 'λ', 'm∞': 'λ', m_fat: 'LBM_navy' };

// The Calculations lines in the order of Tune's own rows. A line with neither a row
// nor an anchor stays right after the line it followed. Stable for equal ranks.
function sortRowsByTuneOrder(allRows) {
  const order = [...document.querySelectorAll('#health-tune-panel .formula-row .formula-sym')]
    .map((el) => el.textContent.trim());
  const rankOf = (label) => order.indexOf(label);
  let previous = -1;
  return allRows
    .map((row, i) => {
      let rank = rankOf(row[0]);
      if (rank === -1 && CALCULATION_ANCHORS[row[0]]) rank = rankOf(CALCULATION_ANCHORS[row[0]]) - 0.5;
      if (rank === -1) rank = previous + 0.001;
      previous = rank;
      return { row, rank, i };
    })
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((x) => x.row);
}

// An ISO date or blank: a date input rejects anything else, so status text goes in the
// note. Not privacy-masked, since a masked date isn't a valid one.
function setEtaDate(iso) {
  document.getElementById('formula-eta').value = iso;
}

function setEtaNote(text) {
  document.getElementById('formula-eta-note').textContent = privacyMode && text ? maskDigits(text) : text;
}

// A typed t: its date is just today plus t.
function setTypedDaysEta(days) {
  setEtaDate(isoDateFromDays(days));
  setEtaNote('');
}

// A computed t, its date, and the note when there's no arrival. Null blanks all three.
function renderFormulaDaysField(proj) {
  const arrives = proj !== null && proj.status !== 'reached' && proj.status !== 'unreachable';
  setComputedField('formula-days', arrives ? String(Math.round(proj.days)) : '');
  setEtaDate(arrives ? proj.etaIso : '');
  setEtaNote(formulaEtaNote(proj));
}

function formulaEtaNote(proj) {
  if (proj?.status === 'reached') return 'already there';
  if (proj?.status !== 'unreachable') return '';
  // A proportional journey has no plateau, so it gives its own reason.
  return proj.journey === 'pct'
    ? `never — ${proj.reason}`
    : `never — plateaus at ${Math.round(proj.equilibriumKg * 10) / 10} kg`;
}

// t when the forecast arrives, else null.
function projectionDays(proj) {
  return proj.status === 'ok' ? proj.days : null;
}

// TAU with a typed t has no closed form: D×(1 − e^(−B×t/ρ)) = (m − m_g)×B has B inside and
// outside the exponential. Bisection finds it (one sign change over B ≥ minB), or null
// when no τ ≥ 0 works. `minB` is B at τ = 0: the BMR's per-kg term over (1 − f).
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

// The glycogen + water swing (why m and m̄ differ day to day), or null when an input is
// missing. Glycogen sits in skeletal muscle (s, about 40–50% of LBM) and the liver, so
// g_musc is a muscle-tissue density applied to s × LBM. LBM is derived here, not read off
// its box, which may not have rendered yet this pass.
function readGlycogenSwingFormula() {
  const skeletalFrac = formulaNumber('formula-glycogen-skeletal-frac');
  const gPerKgMuscle = formulaNumber('formula-glycogen-per-kg-muscle');
  const liverG = formulaNumber('formula-glycogen-liver');
  const waterRatio = formulaNumber('formula-glycogen-water-ratio');
  if (skeletalFrac === null || gPerKgMuscle === null || liverG === null || waterRatio === null) return null;

  const lean = readTuneLbm();
  if (lean === null) return null;
  const { lbmKg } = lean;
  const muscleKg = Math.round((lbmKg * (skeletalFrac / 100)) * 10) / 10;
  if (muscleKg <= 0) return null;

  const glycogenG = Math.round(gPerKgMuscle * muscleKg + liverG);
  return {
    lbmKg, skeletalFrac, muscleKg, gPerKgMuscle, liverG, glycogenG,
    waterRatio, swingKg: Math.round((glycogenG * (1 + waterRatio)) / 100) / 10,
  };
}

// The m_musc, m_gly and ΔM_gly boxes and their rows; dashes when an input is missing.
// Like every render*Field here, box and row come from one read.
function renderGlycogenSwingField() {
  const swing = readGlycogenSwingFormula();
  setComputedFields(['formula-glycogen-muscle', 'formula-glycogen-g', 'formula-glycogen-swing'],
    swing && [swing.muscleKg, swing.glycogenG, swing.swingKg]);
  if (swing === null) return [];

  const { lbmKg, skeletalFrac, muscleKg, gPerKgMuscle, liverG, glycogenG, waterRatio, swingKg } = swing;
  return [
    ['m_musc', `${skeletalFrac}% × ${lbmKg}  =  ${muscleKg} kg`],
    ['m_gly', `${gPerKgMuscle} × ${muscleKg} + ${liverG}  =  ${glycogenG} g`],
    ['ΔM_gly', `${glycogenG} × (1 + ${waterRatio}) / 1000  =  ${swingKg} kg`],
  ];
}

// Writes each box its value, or dashes them all when `values` is null.
function setComputedFields(ids, values) {
  ids.forEach((id, i) => setComputedField(id, values === null ? '—' : String(values[i])));
}

// m̄, h, sex and Tune's LBM at 0.1 kg (rounded first so the trace's × LBM lines multiply
// out), or null when an input is missing.
function readTuneLbm() {
  const bodyMassKg = formulaBodyMassKg();
  const heightCm = formulaNumber('formula-height');
  const sex = document.getElementById('formula-sex').value;
  if (bodyMassKg === null || heightCm === null) return null;
  const raw = tuneLeanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return { bodyMassKg, heightCm, sex, lbmKg: Math.round(raw * 10) / 10 };
}

// The protein band from LBM at the current mass, or null when an input is missing. Save
// writes grams, which stay put as you diet until re-saved.
function readProteinFormula() {
  const perKgMin = formulaNumber('formula-protein-per-kg-min');
  const perKgMax = formulaNumber('formula-protein-per-kg-max');
  if (perKgMin === null || perKgMax === null) return null;
  const lean = readTuneLbm();
  if (lean === null) return null;

  // Sorted, so a band typed backwards still works.
  const low = Math.min(perKgMin, perKgMax);
  const high = Math.max(perKgMin, perKgMax);
  return {
    ...lean, perKgMin: low, perKgMax: high,
    minG: Math.round(lean.lbmKg * low),
    maxG: Math.round(lean.lbmKg * high),
  };
}

// The Boer LBM box and its row.
function renderLbmField() {
  const bodyMassKg = formulaBodyMassKg();
  const heightCm = formulaNumber('formula-height');
  const sex = document.getElementById('formula-sex').value;
  const raw = bodyMassKg === null || heightCm === null ? NaN : boerLeanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(raw) || raw <= 0) {
    setComputedField('formula-lbm', '—');
    return [];
  }

  const lbmKg = Math.round(raw * 10) / 10;
  setComputedField('formula-lbm', String(lbmKg));

  const coefficients = sex === 'male'
    ? `0.407 × ${bodyMassKg} + 0.267 × ${heightCm} − 19.2`
    : `0.252 × ${bodyMassKg} + 0.473 × ${heightCm} − 48.3`;
  return [['LBM_boer', `${coefficients}  =  ${lbmKg} kg`]];
}

// Red lines for the body-shape checks. Waist: the Lancet commission's (2025) for white
// adults. WHR: the WHO's. BF%: the common "obese" cut-offs. WHtR: waist under half height.
const WAIST_CM_MAX_MALE = 102;
const WAIST_CM_MAX_FEMALE = 88;
const WHR_MAX_MALE = 0.90;
const WHR_MAX_FEMALE = 0.85;
const WHTR_MAX = 0.5;
const BF_PCT_MAX_MALE = 25;
const BF_PCT_MAX_FEMALE = 32;

// Body Roundness Index (Thomas et al., 2013); waist and height in the same unit.
function bodyRoundnessIndex(waistCm, heightCm) {
  const ratio = (waistCm / (2 * Math.PI)) / (0.5 * heightCm);
  return 364.2 - 365.5 * Math.sqrt(1 - ratio ** 2);
}

// The WHtR, WHR and BRI boxes and their rows, plus C_waist's red flag. A blank input dashes its box.
function renderBodyShapeFields() {
  const heightCm = formulaNumber('formula-height');
  const waistCm = formulaNumber('formula-waist');
  const hipCm = formulaNumber('formula-hip');
  const male = document.getElementById('formula-sex').value === 'male';
  const rows = [];
  const show = (id, value, outside) => {
    setComputedField(id, value === null ? '—' : String(value));
    document.getElementById(id).classList.toggle('formula-out-of-band', outside);
  };
  const verdict = (ratio, max) => (ratio >= max ? `at or over ${max}` : `under ${max}`);

  const waistMax = male ? WAIST_CM_MAX_MALE : WAIST_CM_MAX_FEMALE;
  document.getElementById('formula-waist').classList.toggle('formula-out-of-band', waistCm !== null && waistCm >= waistMax);

  if (waistCm !== null && heightCm !== null && heightCm > 0) {
    const whtr = Math.round((waistCm / heightCm) * 100) / 100;
    show('formula-whtr', whtr, whtr >= WHTR_MAX);
    rows.push(['WHtR', `${waistCm} / ${heightCm}  =  ${whtr} — ${verdict(whtr, WHTR_MAX)}`]);
    // Undefined once the waist's radius passes half the height.
    const bri = bodyRoundnessIndex(waistCm, heightCm);
    if (Number.isFinite(bri)) {
      const briShown = Math.round(bri * 10) / 10;
      show('formula-bri', briShown, false);
      rows.push(['BRI', `364.2 − 365.5 × √(1 − (${waistCm}/2π)² / (0.5 × ${heightCm})²)  =  ${briShown}`]);
    } else {
      show('formula-bri', null, false);
    }
  } else {
    show('formula-whtr', null, false);
    show('formula-bri', null, false);
  }

  if (waistCm !== null && hipCm !== null && hipCm > 0) {
    const whr = Math.round((waistCm / hipCm) * 100) / 100;
    const whrMax = male ? WHR_MAX_MALE : WHR_MAX_FEMALE;
    show('formula-whr', whr, whr >= whrMax);
    rows.push(['WHR', `${waistCm} / ${hipCm}  =  ${whr} — ${verdict(whr, whrMax)}`]);
  } else {
    show('formula-whr', null, false);
  }
  return rows;
}

// The BF% and LBM_navy boxes and their rows. BF% is rounded first so the trace multiplies out.
function renderNavyFields() {
  const heightCm = formulaNumber('formula-height');
  const neckCm = formulaNumber('formula-neck');
  const waistCm = formulaNumber('formula-waist');
  const hipCm = formulaNumber('formula-hip');
  const sex = document.getElementById('formula-sex').value;
  const male = sex === 'male';
  const raw = (heightCm === null || neckCm === null || waistCm === null || (!male && hipCm === null))
    ? null
    : navyBodyFatPct(sex, heightCm, neckCm, waistCm, hipCm);
  const bfEl = document.getElementById('formula-bf-pct-navy');
  if (raw === null || !Number.isFinite(raw)) {
    setComputedFields(['formula-bf-pct-navy', 'formula-lbm-navy'], null);
    bfEl.classList.remove('formula-out-of-band');
    return [];
  }

  const bfPct = Math.round(raw * 10) / 10;
  setComputedField('formula-bf-pct-navy', String(bfPct));
  const bfMax = male ? BF_PCT_MAX_MALE : BF_PCT_MAX_FEMALE;
  const bfHigh = bfPct > bfMax;
  bfEl.classList.toggle('formula-out-of-band', bfHigh);
  const bfVerdict = bfHigh ? `above the ${bfMax}% line` : `at or under the ${bfMax}% line`;
  const bfRow = male
    ? ['BF%', `495 / (1.0324 − 0.19077 × log10(${waistCm} − ${neckCm}) + 0.15456 × log10(${heightCm})) − 450  =  ${bfPct}% — ${bfVerdict}`]
    : ['BF%', `495 / (1.29579 − 0.35004 × log10(${waistCm} + ${hipCm} − ${neckCm}) + 0.22100 × log10(${heightCm})) − 450  =  ${bfPct}% — ${bfVerdict}`];

  const bodyMassKg = formulaBodyMassKg();
  if (bodyMassKg === null) {
    setComputedField('formula-lbm-navy', '—');
    return [bfRow];
  }
  const fatKg = Math.round(bodyMassKg * bfPct) / 100;
  const fatKgShown = Math.round(fatKg * 10) / 10;
  const lbmNavyKg = Math.round((bodyMassKg - fatKgShown) * 10) / 10;
  setComputedField('formula-lbm-navy', String(lbmNavyKg));
  return [
    bfRow,
    ['m_fat', `${bodyMassKg} × ${bfPct} / 100  =  ${fatKgShown} kg`],
    ['LBM_navy', `${bodyMassKg} − ${fatKgShown}  =  ${lbmNavyKg} kg`],
  ];
}

// Fiber, fat and carbs read Eᵢₙ off its box, which holds this render's value by the
// time they run.

// Fiber: a floor per 1000 kcal eaten, a ceiling per kg of body mass.
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

// A % of Eᵢₙ band (the AMDR) in grams at `kcalPerG`, from the `formula-<name>-pct-min/max` boxes.
function readMacroPctBand(name, kcalPerG) {
  const einKcal = formulaNumber('formula-ein');
  const pctMin = formulaNumber(`formula-${name}-pct-min`);
  const pctMax = formulaNumber(`formula-${name}-pct-max`);
  if (einKcal === null || pctMin === null || pctMax === null) return null;

  return {
    einKcal, pctMin, pctMax, kcalPerG,
    minG: Math.round((pctMin / 100) * einKcal / kcalPerG),
    maxG: Math.round((pctMax / 100) * einKcal / kcalPerG),
  };
}

// A % band's rows, labelled `symbol`_min/_max.
const macroPctRows = (symbol) => ({ einKcal, pctMin, pctMax, kcalPerG, minG, maxG }) => [
  [`${symbol}_min`, `(${pctMin}% × ${einKcal}) / ${kcalPerG}  =  ${minG} g/day`],
  [`${symbol}_max`, `(${pctMax}% × ${einKcal}) / ${kcalPerG}  =  ${maxG} g/day`],
];

// Each gram band: its two boxes and rows, and what Save writes (box field → Settings key,
// the Micronutrients row its minimum becomes, its label in the toast).
const MACRO_BANDS = [
  {
    block: 'Protein band', label: 'Protein', nutrient: 'Protein', read: readProteinFormula,
    ids: ['formula-protein-min', 'formula-protein-max'],
    rows: ({ lbmKg, perKgMin, perKgMax, minG, maxG }) => [
      ['P_min', `${perKgMin} × ${lbmKg}  =  ${minG} g/day`],
      ['P_max', `${perKgMax} × ${lbmKg}  =  ${maxG} g/day`],
    ],
    keys: { perKgMin: 'PROTEIN_G_PER_KG_LBM_MIN', perKgMax: 'PROTEIN_G_PER_KG_LBM_MAX', minG: 'PROTEIN_DESIRED_G_MIN', maxG: 'PROTEIN_DESIRED_G_MAX' },
  },
  {
    block: 'Fiber band', label: 'Fiber', nutrient: 'Fiber, total dietary', read: readFiberFormula,
    ids: ['formula-fiber-min', 'formula-fiber-max'],
    rows: ({ bodyMassKg, einKcal, perKcalMin, perKgMax, minG, maxG }) => [
      ['F_min', `${perKcalMin} × (${einKcal} / 1000)  =  ${minG} g/day`],
      ['F_max', `${perKgMax} × ${bodyMassKg}  =  ${maxG} g/day`],
    ],
    keys: { perKcalMin: 'FIBER_G_PER_1000_KCAL_MIN', perKgMax: 'FIBER_G_PER_KG_MAX', minG: 'FIBER_DESIRED_G_MIN', maxG: 'FIBER_DESIRED_G_MAX' },
  },
  {
    block: 'Fat band', label: 'Fat', nutrient: 'Total lipid (fat)', read: () => readMacroPctBand('fat', KCAL_PER_G_FAT),
    ids: ['formula-fat-min', 'formula-fat-max'],
    rows: macroPctRows('G'),
    keys: { pctMin: 'FAT_PCT_OF_KCAL_MIN', pctMax: 'FAT_PCT_OF_KCAL_MAX', minG: 'FAT_DESIRED_G_MIN', maxG: 'FAT_DESIRED_G_MAX' },
  },
  {
    block: 'Carb band', label: 'Carbs', nutrient: 'Carbohydrate, by difference', read: () => readMacroPctBand('carb', KCAL_PER_G_CARB),
    ids: ['formula-carb-min', 'formula-carb-max'],
    rows: macroPctRows('C'),
    keys: { pctMin: 'CARB_PCT_OF_KCAL_MIN', pctMax: 'CARB_PCT_OF_KCAL_MAX', minG: 'CARB_DESIRED_G_MIN', maxG: 'CARB_DESIRED_G_MAX' },
  },
];

// A band's two boxes and its rows; dashes when an input is missing.
function renderMacroBand({ read, ids, rows }) {
  const band = read();
  setComputedFields(ids, band && [band.minG, band.maxG]);
  return band === null ? [] : rows(band);
}

// The unit-pair syncs write the kilograms raw, not via setComputedField: those boxes are
// settings-backed, and a privacy-masked value would read as invalid and disable Save.

// A typed BMI_g → m_g, before anything reads m_g.
function syncHealthyMassFromBmi() {
  if (!healthyBmiIsTyped()) return;
  const bmi = formulaNumber('formula-healthy-bmi');
  const heightCm = formulaNumber('formula-height');
  if (bmi === null || heightCm === null || heightCm <= 0) return;
  document.getElementById('formula-healthy').value = String(bodyMassKgFromBmi(bmi, heightCm));
}

// The BMI_des box and row. Traced from the kilograms whichever box was typed, since the
// sheet runs on them.
function renderHealthyBmiField() {
  const healthyKg = formulaNumber('formula-healthy');
  const heightCm = formulaNumber('formula-height');
  const el = document.getElementById('formula-healthy-bmi');
  const typed = healthyBmiIsTyped();

  if (healthyKg === null || heightCm === null || heightCm <= 0) {
    if (!typed) setComputedField('formula-healthy-bmi', '');
    el.classList.remove('formula-out-of-band');
    return [];
  }

  const bmi = computeBmi(healthyKg, heightCm);
  if (!typed) setComputedField('formula-healthy-bmi', String(bmi));
  const verdict = bmiVerdict(bmi);
  el.classList.toggle('formula-out-of-band', verdict.outside);
  return [['BMI_des', `${healthyKg} / (${heightCm / 100})²  =  ${bmi} kg/m² — ${verdict.text}`]];
}

// A typed Δm% → Δm at the current m̄, so 1% keeps meaning 1% as the mass changes.
function syncWeeklyLossFromPct() {
  if (!weeklyLossPctIsTyped()) return;
  const kg = weeklyFatLossKgFromPct(formulaNumber('formula-weekly-loss-pct'), formulaBodyMassKg());
  if (kg === null) return;
  document.getElementById('formula-weekly-loss').value = String(kg);
}

// Whether t is measured along a proportional journey: when the % is held (FIXED_PCT or a %
// pin), matching the saved plan's forecast. Only forward solves (rate → t) follow this;
// the ones that solve from a typed t use the constant-Eᵢₙ model.
function formulaJourneyIsProportional() {
  return currentSolveFor() === 'FIXED_PCT' || currentPinMode() === 'pct';
}

// The forecast in that journey. A % ≤ 0 never arrives proportionally, so it falls back
// to the constant-Eᵢₙ form, which reports a hold or gain.
function formulaProjection(args, weeklyPct) {
  if (formulaJourneyIsProportional() && weeklyPct !== null && weeklyPct > 0) {
    return projectHealthyDaysAtFixedPct({
      bodyMassKg: args.bodyMassKg, healthyKg: args.healthyKg, weeklyPct,
    });
  }
  return projectHealthyDays(args);
}

// The t row, in whichever journey produced it.
function formulaDaysRow(proj, { bodyMassKg, healthyKg, weeklyPct, bRounded, eqRounded }) {
  if (proj.status !== 'ok') return [];
  if (proj.journey === 'pct') {
    return [['t', `7 × ln(${bodyMassKg} / ${healthyKg}) / −ln(1 − ${weeklyPct}/100)  =  ${Math.round(proj.days)} days`]];
  }
  return [['t', `(7700 / ${bRounded}) × ln[(${bodyMassKg} − ${eqRounded}) / (${healthyKg} − ${eqRounded})]  =  ${Math.round(proj.days)} days`]];
}

// The 0.5–1%/week band's verdict on a rate. Only `over` warns: slow is fine, and a
// negative rate is a deliberate lean bulk.
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

// The Δm% box (coloured by its verdict) and its row.
function renderWeeklyLossPctField() {
  const bodyMassKg = formulaBodyMassKg();
  const weeklyLossKg = formulaNumber('formula-weekly-loss');
  const derivedPct = weeklyFatLossPct(weeklyLossKg, bodyMassKg);
  const pctIsTyped = weeklyLossPctIsTyped();
  const pct = weeklyLossPctInPlay(weeklyLossKg, bodyMassKg);
  const pctEl = document.getElementById('formula-weekly-loss-pct');

  if (pct === null) {
    if (!pctIsTyped) setComputedField('formula-weekly-loss-pct', '');
    pctEl.classList.remove('formula-pct-over');
    return [];
  }

  if (!pctIsTyped) setComputedField('formula-weekly-loss-pct', String(pct));
  const verdict = weeklyLossPctVerdict(pct);
  pctEl.classList.toggle('formula-pct-over', verdict.over);

  // Traced from the kilograms whichever box was typed, since the sheet runs on them.
  if (derivedPct === null) return [];
  return [['Δm%', `100 × ${weeklyLossKg} / ${bodyMassKg}  =  ${derivedPct} %/week — ${verdict.text}`]];
}

// One equation's BMR row, substituted.
function formulaBmrRow(bmr, { bodyMassKg, heightCm, age, sex, formula }) {
  if (formula === 'katch') {
    return ['BMR_kat', `370 + 21.6 × ${bmrLeanBodyMassKg(bodyMassKg, heightCm, sex)}  =  ${Math.round(bmr)} kcal/day — Katch-McArdle, from lean mass`];
  }
  const sigma = sex === 'male' ? '+ 5' : '− 161';
  return ['BMR_mif', `10 × ${bodyMassKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(bmr)} kcal/day — Mifflin-St Jeor`];
}

// Both BMR lines: the active equation first, then the other one (Mifflin needs an age).
function formulaBmrRows(bmr, profile) {
  const other = profile.formula === 'katch' ? 'mifflin' : 'katch';
  const rows = [formulaBmrRow(bmr, profile)];
  if (other === 'katch' || profile.age !== null) {
    const otherBmr = bmrKcal(profile.bodyMassKg, profile.heightCm, profile.age, profile.sex, other);
    rows.push(formulaBmrRow(otherBmr, { ...profile, formula: other }));
  }
  return rows;
}

// Three decimals, as the trace prints (1 − f), η and the decay factor.
function roundTo3(x) {
  return Math.round(x * 1000) / 1000;
}

// The A and B rows under the active equation and LBM choice, then "/ (1 − f)" unless f = 0.
function formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }) {
  const { a, b, tefDivisor: divisor, formula } = coefficients;
  const lbm = tuneLeanBodyMassCoefficients(sex, heightCm);
  const sigma = sex === 'male' ? '+ 5' : '− 161';
  const navy = lbm.formula === 'navy';
  const aTerms = formula === 'katch'
    ? (navy ? '370' : `370 + 21.6 × (${lbm.perCm} × ${heightCm} − ${Math.abs(lbm.constant)})`)
    : `6.25 × ${heightCm} − 5 × ${age} ${sigma}`;
  const bTerms = formula === 'katch'
    ? `21.6 × ${navy ? `(1 − ${lbm.bfPct}/100)` : lbm.perKg} + ${met} × ${tau} × ${kappa} / 200`
    : `10 + ${met} × ${tau} × ${kappa} / 200`;
  const byDivisor = divisor === 1 ? '' : `, all / ${roundTo3(divisor)}`;
  return [
    ['A', `${aTerms}${byDivisor}  =  ${Math.round(a)} kcal/day`],
    ['B', `${bTerms}${byDivisor}  =  ${Math.round(b * 100) / 100} kcal/day per kg`],
  ];
}

// The TEI row from a plan: the plain sum, divided by (1 − f) when there's a thermic share.
function formulaEinRow({ coefficients: { tefDivisor: divisor }, bmr, activityKcal, deficit, intakeKcal }) {
  const sum = `${Math.round(bmr)} + ${Math.round(activityKcal)} − ${Math.round(deficit)}`;
  const shown = divisor === 1 ? sum : `(${sum}) / ${roundTo3(divisor)}`;
  return ['TEI', `${shown}  =  ${Math.round(intakeKcal)} kcal/day`];
}

// The D row solved from a plan's intake (DELTA_M): BMR + AEE − TEI × (1 − f).
function formulaDeficitRow({ coefficients: { tefDivisor: divisor }, bmr, activityKcal, deficit, intakeKcal }) {
  const intake = divisor === 1 ? `${Math.round(intakeKcal)}` : `${Math.round(intakeKcal)}×${roundTo3(divisor)}`;
  return ['D', `${Math.round(bmr)} + ${Math.round(activityKcal)} − ${intake}  =  ${Math.round(deficit)} kcal/day`];
}

// λ and λt_max.
function readAdaptationInputs() {
  return {
    pctPerWeek: formulaNumber('formula-adapt-per-week'),
    pctCap: formulaNumber('formula-adapt-cap'),
  };
}

// TEF = f × Eᵢₙ, read off the boxes (Eᵢₙ already holds this render's value).
function readTefFormula() {
  const einKcal = formulaNumber('formula-ein');
  const tefPct = formulaNumber('formula-tef-pct');
  if (einKcal === null || tefPct === null) return null;
  return { einKcal, tefPct, tefKcal: Math.round(einKcal * (tefPct / 100)) };
}

function renderTefField() {
  const tef = readTefFormula();
  setComputedFields(['formula-tef'], tef && [tef.tefKcal]);
  // No row at f = 0.
  if (tef === null || tef.tefKcal <= 0) return [];
  const { einKcal, tefPct, tefKcal } = tef;
  return [['TEF', `${tefPct}% × ${einKcal}  =  ${tefKcal} kcal/day`]];
}

// The SD box and its η/SD rows when D is built forward from a rate. `sleepInfo` is
// calorieDesiredDetail's result or TAU's equivalent, both computed under the preview
// overlay, so a typed γ is honoured. Null dashes the box.
function renderSleepDeprivationField(sleepInfo) {
  if (sleepInfo === null) {
    setComputedField('formula-deprivation-effect', '—');
    return [];
  }
  const { rawDeficit, sleepDeprivationEffectKcal, factor, pctPerHour, planSleepHours, sleepDesiredHours } = sleepInfo;
  setComputedField('formula-deprivation-effect', String(sleepDeprivationEffectKcal));
  // No rows when sleep costs nothing.
  if (sleepDeprivationEffectKcal <= 0) return [];
  const factorRounded = roundTo3(factor);
  return [
    ['η', `1 − (${pctPerHour}/100) × max(0, ${sleepDesiredHours} − ${planSleepHours})  =  ${factorRounded}`],
    ['SD', `${Math.round(rawDeficit)} / ${factorRounded} − ${Math.round(rawDeficit)}  =  ${sleepDeprivationEffectKcal} kcal/day`],
  ];
}

// The D line from a rate, divided by η when short sleep costs something.
function formulaDeficitTraceLine(sleepInfo) {
  const raw = `${sleepInfo.weeklyFatLossKg} × 7700 / 7`;
  if (sleepInfo.sleepDeprivationEffectKcal <= 0) return `${raw}  =  ${Math.round(sleepInfo.deficit)} kcal/day`;
  return `(${raw}) / ${roundTo3(sleepInfo.factor)}  =  ${Math.round(sleepInfo.deficit)} kcal/day`;
}

// When D is solved from a given intake, short sleep doesn't enlarge it; it makes less of
// it real fat loss. Returns that shortfall (kcal/day, set in the SD box) and its row.
function reverseSleepDeprivation(deficit, preview) {
  const sleepDesiredHours = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
  const kcal = sleepDeprivationKcal(deficit, preview.PLAN_SLEEP_HOURS, sleepDesiredHours) ?? 0;
  setComputedField('formula-deprivation-effect', String(kcal));
  const rows = kcal > 0 ? [['SD', `|${Math.round(deficit)}| × (1 − η)  =  ${kcal} kcal/day of it not real fat loss`]] : [];
  return { kcal, rows };
}

// The AEE row.
function formulaActivityRow({ met, bodyMassKg, kappa }, tau, activityKcal) {
  return ['AEE', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`];
}

// B and m∞ = (TEI − A) / B as the trace prints them.
function roundedPlateau({ a, b }, intakeKcal) {
  return { bRounded: Math.round(b * 100) / 100, eqRounded: Math.round(((intakeKcal - a) / b) * 10) / 10 };
}

// The m∞ row from a plan.
function formulaPlateauRow({ coefficients, intakeKcal }) {
  const { bRounded, eqRounded } = roundedPlateau(coefficients, intakeKcal);
  return ['m∞', `(${Math.round(intakeKcal)} − ${Math.round(coefficients.a)}) / ${bRounded}  =  ${eqRounded} kg`];
}

// The D_bmr% box and row: how far TEI sits below BMR. Red past DEFICIT_VS_BMR_PCT_CEILING
// as a warning only. Reads `plan`, which holds the figures this render actually used.
function renderDeficitVsBmrField(plan) {
  const el = document.getElementById('formula-deficit-bmr-pct');
  if (plan === null || !Number.isFinite(plan.bmr) || plan.bmr === 0) {
    setComputedField('formula-deficit-bmr-pct', '—');
    el.classList.remove('formula-pct-over');
    return [];
  }

  const { bmr, intakeKcal } = plan;
  const pct = deficitVsBmrPct(bmr, intakeKcal);
  setComputedField('formula-deficit-bmr-pct', String(pct));
  el.classList.toggle('formula-pct-over', pct > DEFICIT_VS_BMR_PCT_CEILING);

  return [['D_bmr%', `(${Math.round(bmr)} − ${Math.round(intakeKcal)}) / ${Math.round(bmr)} × 100  =  ${pct} %`]];
}

// BMR_avg over Tune's figures, with BMR_adp as of today (t itself depends on the BMR).
let tuneBmrAverage = null;

// BMR_cal clamped as Physique stores it, so Tune and Health agree. Null without a calibration.
function tuneClampedBmrCal(bmr, calibration, parts) {
  if (!calibration?.result.ok) return null;
  const figures = Object.fromEntries(parts.map(([key, v]) => [key, Math.round(v)]));
  return clampBmrCal(Math.round(bmr + calibration.result.offsetKcal), figures);
}

function computeTuneBmrAverage({ bodyMassKg, heightCm, age, sex, bmr, calibration }) {
  const parts = [];
  if (age !== null) parts.push(['BMR_mif', bmrKcal(bodyMassKg, heightCm, age, sex, 'mifflin')]);
  parts.push(['BMR_kat', bmrKcal(bodyMassKg, heightCm, age, sex, 'katch')]);
  const { pctPerWeek, pctCap } = readAdaptationInputs();
  const bodyMassEntries = physiqueAsHealthEntries().filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const daysOnDiet = daysSinceFirstWeighIn(bodyMassEntries);
  if (pctPerWeek !== null && pctCap !== null && daysOnDiet !== null) {
    parts.push(['BMR_adp', bmr * (1 - adaptationFraction(daysOnDiet, pctPerWeek, pctCap))]);
  }
  const bmrCal = tuneClampedBmrCal(bmr, calibration, parts);
  if (bmrCal !== null) parts.splice(parts.length - (parts.at(-1)[0] === 'BMR_adp' ? 1 : 0), 0, ['BMR_cal', bmrCal]);
  const rounded = parts.filter(([, v]) => Number.isFinite(v)).map(([key, v]) => [key, Math.round(v)]);
  if (!rounded.length) return null;
  const avg = Math.round(rounded.reduce((sum, [, v]) => sum + v, 0) / rounded.length);
  return { avg, parts: rounded, daysOnDiet };
}

function bmrAverageRows() {
  if (!tuneBmrAverage) return [];
  const { avg, parts, daysOnDiet } = tuneBmrAverage;
  // Names which BMRs went in only when one is missing; BMR_adp's day always.
  const notes = [];
  if (parts.length < BMR_AVERAGED_KEYS.length) notes.push(`over ${parts.map(([key]) => key).join(', ')}`);
  if (parts.some(([key]) => key === 'BMR_adp')) notes.push(`BMR_adp as of day ${daysOnDiet}`);
  return [['BMR_avg', `(${parts.map(([, v]) => v).join(' + ')}) / ${parts.length}  =  ${avg} kcal/day${notes.length ? ` — ${notes.join(', ')}` : ''}`]];
}

// The AEE, M, D boxes and the adaptation pair (BMR_adp, m∞_adp) with their rows. λt is
// taken at this render's t, or at the cap when there's no arrival.
function renderCorrectionFields(plan) {
  const bmrEl = 'formula-bmr-adapt';
  const plateauEl = 'formula-plateau-adapt';
  const { pctPerWeek, pctCap } = readAdaptationInputs();

  if (plan === null) {
    setComputedFields(['formula-bmr-mifflin', 'formula-bmr-katch', 'formula-activity-kcal', 'formula-maintenance', 'formula-deficit', bmrEl, plateauEl], null);
    renderSleepDeprivationField(null);
    return [];
  }

  const { intakeKcal, coefficients, bmr, activityKcal, deficit, days, journey } = plan;
  const rows = [];

  // Boxes only; the modes print their rows.
  setComputedField('formula-activity-kcal', String(Math.round(activityKcal)));
  setComputedField('formula-maintenance', String(Math.round(bmr + activityKcal)));
  setComputedField('formula-deficit', String(Math.round(deficit)));

  if (pctPerWeek === null || pctCap === null || bmr === null) {
    setComputedFields([bmrEl, plateauEl], null);
    return rows;
  }

  const atCap = days === null;
  const fraction = adaptationFraction(atCap ? Infinity : days, pctPerWeek, pctCap);
  const adaptedBmr = bmr * (1 - fraction);
  const lostPct = Math.round(fraction * 1000) / 10;
  setComputedField(bmrEl, String(Math.round(adaptedBmr)));
  rows.push(['BMR_adp', `${Math.round(bmr)} × (1 − ${lostPct}/100)  =  ${Math.round(adaptedBmr)} kcal/day — ${atCap ? `at the ${pctCap}% ceiling` : `by day ${Math.round(days)}`}`]);

  // A proportional journey has no plateau, so no overshoot.
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

// Tune's typed lean-mass choice and girths, laid over the settings for one read.
function tuneLeanOverrides() {
  const typed = (id) => formulaNumber(id) ?? '';
  return {
    [LBM_FORMULA_KEY]: currentLbmFormula(),
    NECK_CM: typed('formula-neck'), WAIST_CM: typed('formula-waist'), HIP_CM: typed('formula-hip'),
  };
}

function tuneLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  return withFormulaOverrides(tuneLeanOverrides(), () => leanBodyMassKg(bodyMassKg, heightCm, sex));
}

function tuneLeanBodyMassCoefficients(sex, heightCm) {
  return withFormulaOverrides(tuneLeanOverrides(), () => leanBodyMassCoefficients(sex, heightCm));
}

// Every BMR, A and B on the sheet reads LBM, so the whole render runs on Tune's lean-mass choice.
function renderFormulaPreview() {
  withFormulaOverrides(tuneLeanOverrides(), renderFormulaPreviewOnLeanChoice);
}

function renderFormulaPreviewOnLeanChoice() {
  // Unit pairs first, so a typed BMI_g or Δm% is in kilograms before anything reads them.
  syncHealthyMassFromBmi();
  syncWeeklyLossFromPct();
  const { mode, preview, bodyMassKg, heightCm, age, sex, formula, einKcal, days, invalid } = readFormulaInputs();
  const noteEl = document.getElementById('formula-profile-note');
  const saveBtn = document.getElementById('formula-save-btn');

  // On failure only Eᵢₙ and t are cleared. A computed settings-backed field (τ, Δm, m_g)
  // keeps its last value: blanking it would make it read as invalid on every later render.
  const computedNow = computedIdsForMode(mode);
  const showFailure = (message) => {
    if (computedNow.includes('formula-ein')) setComputedField('formula-ein', '—');
    if (computedNow.includes('formula-days')) renderFormulaDaysField(null);
    renderFormulaSubstituted(null);
    noteEl.textContent = message;
  };

  if (invalid.length) {
    showFailure(`Needs a number in: ${invalid.join(', ')}.`);
    saveBtn.disabled = true;
    return;
  }

  const met = withFormulaOverrides(preview, activityMet);
  const kappa = preview.KCAL_PER_MET_KG_MIN;
  const bmr = bmrKcal(bodyMassKg, heightCm, age, sex, formula);
  const tef = preview[TEF_PERCENT_KEY];

  // Both equations' boxes, whichever is active (Mifflin needs an age).
  setComputedField('formula-bmr-mifflin', age === null ? '—' : String(Math.round(bmrKcal(bodyMassKg, heightCm, age, sex, 'mifflin'))));
  setComputedField('formula-bmr-katch', String(Math.round(bmrKcal(bodyMassKg, heightCm, age, sex, 'katch'))));
  // BMR_cal over n_p × L_p, and BMR_avg with the ratio its basis previews on (never saved).
  const calibration = tuneBmrCalibration();
  tuneBmrAverage = computeTuneBmrAverage({ bodyMassKg, heightCm, age, sex, bmr, calibration });
  const tuneBmrCal = tuneBmrAverage?.parts.find(([key]) => key === 'BMR_cal')?.[1];
  setComputedField('formula-bmr-cal', tuneBmrCal !== undefined ? String(tuneBmrCal) : '—');
  setComputedField('formula-bmr-avg', tuneBmrAverage ? String(tuneBmrAverage.avg) : '—');
  if (tuneBmrAverage && bmr > 0) preview[BMR_AVG_RATIO_PREVIEW_KEY] = tuneBmrAverage.avg / bmr;
  renderBmrCalibrationWeeks(calibration ? calibration.result.weeks : [], 'formula-cal-weeks-body');
  renderBmrCalibrationSubstituted(calibration ? calibration.result : { ok: false }, 'formula-cal-substituted');

  // What the coefficients and forecast need, less τ (which a mode may solve for).
  const profile = {
    heightCm, age, sex, met, kappa, formula, tef, bodyMassKg,
  };
  const bmrRows = formulaBmrRows(bmr, { bodyMassKg, heightCm, age, sex, formula });
  const affineRows = (coefficients, tau) => formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa });
  const plateauRows = (plan, tau) => [...affineRows(plan.coefficients, tau), formulaPlateauRow(plan)];
  const projectionArgs = (intakeKcal, healthyKg, tau) => ({ intakeKcal, bodyMassKg, healthyKg, tau, ...profile });
  const context = {
    preview, profile, bodyMassKg, einKcal, days, bmrRows, affineRows, plateauRows, projectionArgs,
    // BMR under the chosen basis, as calorieDesiredDetail uses, so every mode's t agrees.
    basisBmr: withFormulaOverrides(preview, () => applyBmrBasis(bmr)),
    coefficientsAt: (tau) => withFormulaOverrides(preview, () => maintenanceAffineCoefficients({ ...profile, tau })),
    // "Arrived" allows for the glycogen swing, as the forecast chart does.
    arrivalKg: (healthyKg) => arrivalHealthyKg(healthyKg, bodyMassKg, heightCm, sex, healthyKg < bodyMassKg),
    // t along whichever journey formulaProjection picks.
    projectForward: (intakeKcal, healthyKg, tau, weeklyPct) => withFormulaOverrides(
      preview, () => formulaProjection(projectionArgs(intakeKcal, healthyKg, tau), weeklyPct),
    ),
    // A, B and m∞ describe the constant-intake plateau, which a proportional journey lacks; then t.
    journeyRows: (proj, plan, tau, healthyKg, weeklyPct) => [
      ...(proj.journey === 'pct' ? [] : plateauRows(plan, tau)),
      ...formulaDaysRow(proj, { bodyMassKg, healthyKg, weeklyPct, ...roundedPlateau(plan.coefficients, plan.intakeKcal) }),
    ],
    // D built forward from a known Δm, and TEI from it.
    forwardRows: (plan, tau, sleepInfo) => [
      ...bmrRows,
      formulaActivityRow(profile, tau, plan.activityKcal),
      ...renderSleepDeprivationField(sleepInfo),
      ...renderWeeklyLossPctField(),
      ['D', formulaDeficitTraceLine(sleepInfo)],
      ...renderTefField(),
      formulaEinRow(plan),
      ...renderHealthyBmiField(),
    ],
  };

  noteEl.textContent = '';
  saveBtn.disabled = false;
  const solved = TUNE_MODE_SOLVERS[mode](context);
  if (solved === null) {
    showFailure("Can't compute from these values.");
    return;
  }
  renderFormulaSubstituted(solved.rows, solved.plan);
}

// Each mode fills its own boxes and returns its rows and the plan it solved, or null when
// these values give no answer. `c` is the context renderFormulaPreviewOnLeanChoice builds.
const TUNE_MODE_SOLVERS = {
  EIN: solveTuneIntake,
  FIXED_PCT: solveTuneIntake,
  TAU: solveTuneActivity,
  HEALTHY_MASS: solveTuneHealthyMass,
  DELTA_M: solveTuneWeeklyLoss,
};

// EIN and FIXED_PCT share the arithmetic: Δm (typed, or from the held %) gives Eᵢₙ and t.
function solveTuneIntake(c) {
  const { preview, bodyMassKg } = c;
  const tau = preview.ACTIVITY_DESIRED_MIN;
  const forecastHealthyKg = c.arrivalKg(preview.BODY_MASS_HEALTHY_KG);
  const detail = withFormulaOverrides(preview, () => calorieDesiredDetail(bodyMassKg));
  if (detail === null) return null;
  const weeklyPct = weeklyLossPctInPlay(detail.weeklyFatLossKg, bodyMassKg);
  const coefficients = c.coefficientsAt(tau);
  const proj = c.projectForward(detail.kcal, forecastHealthyKg, tau, weeklyPct);
  setComputedField('formula-ein', String(Math.round(detail.kcal)));
  renderFormulaDaysField(proj);

  // `detail` already carries the sleep-adjusted deficit.
  const plan = {
    intakeKcal: detail.kcal, coefficients, bmr: detail.bmr, activityKcal: detail.activityKcal, deficit: detail.deficit,
  };
  return {
    rows: [...c.forwardRows(plan, tau, detail), ...c.journeyRows(proj, plan, tau, forecastHealthyKg, weeklyPct)],
    plan: { ...plan, days: projectionDays(proj), journey: proj.journey },
  };
}

function solveTuneActivity(c) {
  const { preview, profile, bodyMassKg, basisBmr, einKcal, days } = c;
  const { met, kappa } = profile;
  const deltaM = preview.WEEKLY_FAT_LOSS_KG;
  const healthyKg = preview.BODY_MASS_HEALTHY_KG;
  const fromEin = dualKnownField.TAU === 'ein';

  // Δm is known either way, so the sleep adjustment runs forward, under the overlay so
  // a typed γ counts.
  const planSleepHours = preview.PLAN_SLEEP_HOURS;
  const sleepDesiredHours = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
  const rawDeficit = (deltaM * GENERIC_KCAL_PER_KG_FAT) / 7;
  const { deficitKcal: deficit, sleepDeprivationEffectKcal, factor, pctPerHour } = withFormulaOverrides(
    preview, () => sleepAdjustedDeficitKcal(rawDeficit, planSleepHours, sleepDesiredHours),
  );
  const sleepInfo = {
    weeklyFatLossKg: deltaM, rawDeficit, deficit, sleepDeprivationEffectKcal, factor, pctPerHour, planSleepHours, sleepDesiredHours,
  };

  // The divisor and BMR per-kg term don't depend on τ, so τ = 0 is a placeholder.
  const shape = maintenanceAffineCoefficients({ ...profile, tau: 0 });
  const divisor = shape.tefDivisor;

  let tau;
  if (fromEin) {
    // Eᵢₙ×(1−f) = BMR + m·MET·τ·κ/ε − D  ⇒  m·MET·τ·κ/ε = Eᵢₙ×(1−f) + D − BMR
    const activityKcalNeeded = einKcal * divisor + deficit - basisBmr;
    tau = Math.round((activityKcalNeeded * ML_O2_PER_KCAL) / (met * bodyMassKg * kappa));
  } else {
    // Typed t: find B numerically on the TEF-scaled identity, then undo the divisor and
    // the BMR term to get τ.
    const B = solveBForTypedDays({
      deficit: deficit / divisor,
      massToLose: bodyMassKg - healthyKg,
      t: days,
      rho: GENERIC_KCAL_PER_KG_FAT,
      minB: shape.bBmr / divisor,
    });
    tau = B === null ? NaN : Math.round((B * divisor - shape.bBmr) / ((met * kappa) / ML_O2_PER_KCAL));
  }
  if (!Number.isFinite(tau) || tau < 0) return null;
  setComputedField('formula-activity-min', String(tau));

  const coefficients = c.coefficientsAt(tau);
  const activityKcal = withFormulaOverrides(
    { ...preview, ACTIVITY_DESIRED_MIN: tau },
    () => activityDesiredKcal(bodyMassKg),
  );
  // With t typed, Eᵢₙ is what the solved τ implies.
  const intakeKcal = fromEin ? einKcal : (basisBmr + activityKcal - deficit) / divisor;

  // Forward (Eᵢₙ known): t follows the journey and arrival rule. Typed t: stay in the
  // constant-Eᵢₙ model and the typed m_g that τ was fitted to.
  const weeklyPct = weeklyLossPctInPlay(deltaM, bodyMassKg);
  const forecastHealthyKg = fromEin ? c.arrivalKg(healthyKg) : healthyKg;
  const proj = fromEin
    ? c.projectForward(intakeKcal, forecastHealthyKg, tau, weeklyPct)
    : withFormulaOverrides(preview, () => projectHealthyDays(c.projectionArgs(intakeKcal, forecastHealthyKg, tau)));
  if (fromEin) {
    renderFormulaDaysField(proj);
  } else {
    setComputedField('formula-ein', String(Math.round(intakeKcal)));
    setTypedDaysEta(days);
  }

  const plan = { intakeKcal, coefficients, bmr: basisBmr, activityKcal, deficit };
  return {
    rows: [
      ...(fromEin ? [] : [['τ', `solved numerically so that m(t=${days}) = ${healthyKg} kg`]]),
      ...c.forwardRows(plan, tau, sleepInfo),
      ...c.journeyRows(proj, plan, tau, forecastHealthyKg, weeklyPct),
    ],
    plan: { ...plan, days: fromEin ? projectionDays(proj) : days, journey: proj.journey },
  };
}

// Eᵢₙ and t typed: m_g from the decay identity projectHealthyDays inverts.
function solveTuneHealthyMass(c) {
  const { preview, bodyMassKg, basisBmr, einKcal, days } = c;
  const tau = preview.ACTIVITY_DESIRED_MIN;
  const coefficients = c.coefficientsAt(tau);
  const { a, b } = coefficients;
  const equilibriumKg = (einKcal - a) / b;
  const mG = equilibriumKg + (bodyMassKg - equilibriumKg) * Math.exp((-b * days) / GENERIC_KCAL_PER_KG_FAT);
  if (!Number.isFinite(mG)) return null;
  const mGRounded = Math.round(mG * 10) / 10;
  setComputedField('formula-healthy', String(mGRounded));
  setTypedDaysEta(days);

  // No BMR/AEE/D rows: they describe today's mass, not m_g. D at today's mass still
  // drives the boxes and the reverse SD row.
  const activityKcal = withFormulaOverrides(preview, () => activityDesiredKcal(bodyMassKg));
  const deficit = basisBmr + activityKcal - einKcal * coefficients.tefDivisor;
  const sleep = reverseSleepDeprivation(deficit, preview);
  const plan = {
    intakeKcal: einKcal, coefficients, bmr: basisBmr, activityKcal, deficit, days, journey: 'intake',
  };
  const { bRounded, eqRounded } = roundedPlateau(coefficients, einKcal);
  return {
    rows: [
      ...renderTefField(),
      ...c.plateauRows(plan, tau),
      ['m_des', `${eqRounded} + (${bodyMassKg} − ${eqRounded}) × e^(−${bRounded}×${days}/7700)  =  ${mGRounded} kg`],
      ...sleep.rows,
      ...renderHealthyBmiField(),
      ...renderWeeklyLossPctField(),
    ],
    plan,
  };
}

// Δm from Eᵢₙ, typed or solved from t and m_g. Δm doesn't affect timing, so neither
// direction needs a numerical solve.
function solveTuneWeeklyLoss(c) {
  const { preview, profile, bodyMassKg, basisBmr, einKcal, days } = c;
  const tau = preview.ACTIVITY_DESIRED_MIN;
  const healthyKg = preview.BODY_MASS_HEALTHY_KG;
  const coefficients = c.coefficientsAt(tau);
  const { a, b } = coefficients;
  const activityKcal = withFormulaOverrides(preview, () => activityDesiredKcal(bodyMassKg));
  const fromEin = dualKnownField.DELTA_M === 'ein';

  // Typed t: m∞ from the decay identity, then Eᵢₙ = A + B×m∞.
  const decay = fromEin ? null : Math.exp((-b * days) / GENERIC_KCAL_PER_KG_FAT);
  const intakeKcal = fromEin ? einKcal : a + b * ((healthyKg - bodyMassKg * decay) / (1 - decay));
  if (!Number.isFinite(intakeKcal)) return null;

  const deficit = basisBmr + activityKcal - intakeKcal * coefficients.tefDivisor;
  // Three decimals, so a % pin round-trips without shifting t by a day.
  const deltaMSolved = Math.round((deficit * 7 / GENERIC_KCAL_PER_KG_FAT) * 1000) / 1000;
  if (!Number.isFinite(deltaMSolved)) return null;
  setComputedField('formula-weekly-loss', String(deltaMSolved));
  const sleep = reverseSleepDeprivation(deficit, preview);

  const plan = { intakeKcal, coefficients, bmr: basisBmr, activityKcal, deficit };
  const deficitRows = [...c.bmrRows, formulaActivityRow(profile, tau, activityKcal), formulaDeficitRow(plan)];
  const deltaMRow = ['Δm', `${Math.round(deficit)} × 7 / 7700  =  ${deltaMSolved} kg/week`];

  if (fromEin) {
    // t is projected at the % the solved Δm implies (its box is a render behind).
    const weeklyPct = weeklyFatLossPct(deltaMSolved, bodyMassKg);
    const forecastHealthyKg = c.arrivalKg(healthyKg);
    const proj = c.projectForward(intakeKcal, forecastHealthyKg, tau, weeklyPct);
    renderFormulaDaysField(proj);
    return {
      rows: [
        ...deficitRows,
        ...renderTefField(),
        deltaMRow,
        ...sleep.rows,
        ...c.journeyRows(proj, plan, tau, forecastHealthyKg, weeklyPct),
        ...renderHealthyBmiField(),
        ...renderWeeklyLossPctField(),
      ],
      plan: { ...plan, days: projectionDays(proj), journey: proj.journey },
    };
  }

  setTypedDaysEta(days);
  setComputedField('formula-ein', String(Math.round(intakeKcal)));
  const { bRounded, eqRounded } = roundedPlateau(coefficients, intakeKcal);
  const decayRounded = roundTo3(decay);
  return {
    rows: [
      ...c.affineRows(coefficients, tau),
      ['m∞', `(${healthyKg} − ${bodyMassKg}×${decayRounded}) / (1 − ${decayRounded})  =  ${eqRounded} kg`],
      ['TEI', `${Math.round(a)} + ${bRounded} × ${eqRounded}  =  ${Math.round(intakeKcal)} kcal/day`],
      ...renderTefField(),
      ...deficitRows,
      deltaMRow,
      ...sleep.rows,
      ...renderHealthyBmiField(),
      ...renderWeeklyLossPctField(),
    ],
    plan: { ...plan, days, journey: 'intake' },
  };
}
