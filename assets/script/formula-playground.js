// "Formula" in the Health Indicators heading: shows the daily calorie
// bound as a formula with its three tunable inputs editable, recomputes the
// figure as you type, and can write the values back to the Settings tab.
//
// The point is that the bound is the one number in the app derived from settings
// you can't see the effect of until you save them — this makes the arithmetic and
// the sensitivity visible first. It computes with the SAME functions the charts
// use (calorieBoundDetail via a temporary settings overlay), so the preview can't
// drift from what saving would actually produce.

// Editable rows: the Settings key, its input, and the fallback shown when the key
// isn't set. Order matches the formula's own term order.
const FORMULA_FIELDS = [
  { key: 'KCAL_PER_MET_KG_MIN', inputId: 'formula-met-o2', fallback: () => MET_ML_O2_PER_KG_MIN_DEFAULT },
  // activityMet() as the fallback, not the bare constant — it also honours the
  // ACTIVITY_MET_DEFAULT spelling an existing sheet may use instead.
  { key: 'ACTIVITY_MET', inputId: 'formula-met', fallback: () => activityMet() },
  { key: 'ACTIVITY_TARGET_MIN', inputId: 'formula-activity-min', fallback: () => ACTIVITY_TARGET_MIN_DEFAULT },
  // No default: an unset WEEKLY_FAT_LOSS_KG is exactly what makes the bound
  // uncomputable and sends the charts to the flat CALORIE_TARGET_KCAL, so the
  // playground opens on 0 (maintenance) rather than inventing a deficit.
  { key: 'WEEKLY_FAT_LOSS_KG', inputId: 'formula-weekly-loss', fallback: () => 0 },
  { key: 'WEIGHT_GOAL_KG', inputId: 'formula-goal', fallback: () => WEIGHT_GOAL_KG_DEFAULT },
];

// Broken into its named terms rather than shown as one long line: each is a
// separate published formula with its own source, and the substituted figures
// below are labelled with the same symbols so the two read together. No blank
// lines between the blocks — the four-space indent on every formula line is
// what separates it from the heading above it, so the spacers only added height.
const FORMULA_EXPRESSION = `Resting metabolic rate — Mifflin-St Jeor (1990)
    BMR  =  10×m  +  6.25×h  −  5×a  +  σ
Activity burn at the daily target — ACSM metabolic equation
    Eₐ   =  MET × m × τ × κ / ε
Daily energy deficit implied by the weekly fat-loss goal
    D    =  (Δm × ρ) / 7
Proposed daily intake
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
// preview goes through the real calorieBoundDetail/metKcal path instead of a
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

// Every box maps to a Settings key except current weight, which is a Physique
// measurement — it belongs here because both terms of the formula scale with it,
// but there is no setting to write it to.
//
// `preview` always carries the typed age as a BIRTH_DATE so the calculation runs
// through the real ageFromBirthDate path; `overrides` (what Save writes) only
// includes BIRTH_DATE when the typed age actually differs from the stored date's,
// so saving an untouched age can't replace a real birth date with a synthetic one
// that merely happens to yield the same number of years.
function readFormulaInputs() {
  const overrides = {};
  const invalid = [];
  FORMULA_FIELDS.forEach((field) => {
    const num = formulaNumber(field.inputId);
    if (num === null) invalid.push(field.key);
    else overrides[field.key] = num;
  });

  const weightKg = formulaNumber('formula-weight');
  const heightCm = formulaNumber('formula-height');
  const age = formulaNumber('formula-age');
  const sex = document.getElementById('formula-sex').value;
  if (weightKg === null) invalid.push('current body mass');
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

  return { overrides, preview, weightKg, heightCm, age, sex, invalid };
}

// The projection itself lives in charts.js as projectPlanDays, shared with the Body
// Mass Trend forecast so the date shown here and the one on that chart are the same
// arithmetic. This module only supplies the live inputs.

// The formula with every symbol replaced by the figure actually used, so a
// surprising total can be traced to whichever input produced it.
function renderFormulaSubstituted(detail, proj, { preview, weightKg, heightCm, age, sex }) {
  const el = document.getElementById('formula-substituted');
  el.innerHTML = '';
  if (detail === null) return;

  const met = withFormulaOverrides(preview, activityMet);
  const deficit = (preview.WEEKLY_FAT_LOSS_KG * GENERIC_KCAL_PER_KG_FAT) / 7;
  // The sex term is the one addend that can be negative, so it carries its own
  // sign rather than being joined with a fixed '+'.
  const sigma = sex === 'male' ? '+ 5' : '− 161';
  const rows = [
    ['BMR', `10 × ${weightKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(detail.bmr)} kcal/day`],
    ['Eₐ', `${met} × ${weightKg} × ${preview.ACTIVITY_TARGET_MIN} × ${preview.KCAL_PER_MET_KG_MIN} / 200  =  ${Math.round(detail.activityKcal)} kcal/day`],
    ['D', `${preview.WEEKLY_FAT_LOSS_KG} × 7700 / 7  =  ${Math.round(deficit)} kcal/day`],
    ['Eᵢₙ', `${Math.round(detail.bmr)} + ${Math.round(detail.activityKcal)} − ${Math.round(deficit)}  =  ${detail.kcal} kcal/day`],
  ];

  const goalKg = preview.WEIGHT_GOAL_KG;
  rows.push(
    ['A', `6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(proj.a)} kcal/day`],
    ['B', `10 + ${met} × ${preview.ACTIVITY_TARGET_MIN} × ${preview.KCAL_PER_MET_KG_MIN} / 200  =  ${Math.round(proj.b * 100) / 100} kcal/day per kg`],
    ['m∞', `(${detail.kcal} − ${Math.round(proj.a)}) / ${Math.round(proj.b * 100) / 100}  =  ${Math.round(proj.equilibriumKg * 10) / 10} kg`],
  );
  if (proj.status === 'ok') {
    rows.push(['t', `(7700 / ${Math.round(proj.b * 100) / 100}) × ln[(${weightKg} − ${Math.round(proj.equilibriumKg * 10) / 10}) / (${goalKg} − ${Math.round(proj.equilibriumKg * 10) / 10})]  =  ${Math.round(proj.days)} days`]);
  }

  rows.forEach(([label, value]) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    p.append(strong, document.createTextNode(privacyMode ? maskDigits(value) : value));
    el.appendChild(p);
  });
}

// Days plus the date it lands on, or why there isn't one.
function renderFormulaDays(proj) {
  const el = document.getElementById('formula-days-value');
  if (proj === null) {
    el.textContent = '—';
    return;
  }
  if (proj.status === 'reached') {
    el.textContent = 'already there';
    return;
  }
  if (proj.status === 'unreachable') {
    const text = `never — levels off at ${Math.round(proj.equilibriumKg * 10) / 10} kg`;
    el.textContent = privacyMode ? maskDigits(text) : text;
    return;
  }
  const text = `${Math.round(proj.days)} days → ${proj.etaIso}`;
  el.textContent = privacyMode ? maskDigits(text) : text;
}

function renderFormulaPreview() {
  const resultEl = document.getElementById('formula-result-value');
  const noteEl = document.getElementById('formula-profile-note');
  const saveBtn = document.getElementById('formula-save-btn');
  const { preview, weightKg, heightCm, age, sex, invalid } = readFormulaInputs();

  if (invalid.length) {
    resultEl.textContent = '—';
    renderFormulaDays(null);
    document.getElementById('formula-substituted').innerHTML = '';
    noteEl.textContent = `Needs a number in: ${invalid.join(', ')}.`;
    saveBtn.disabled = true;
    return;
  }
  saveBtn.disabled = false;

  const detail = withFormulaOverrides(preview, () => calorieBoundDetail(weightKg));
  if (detail === null) {
    resultEl.textContent = '—';
    renderFormulaDays(null);
    document.getElementById('formula-substituted').innerHTML = '';
    noteEl.textContent = "Can't compute from these values.";
    return;
  }

  const text = `${detail.kcal} kcal`;
  resultEl.textContent = privacyMode ? maskDigits(text) : text;

  // Clear any earlier invalid-input message.
  noteEl.textContent = '';

  const proj = projectPlanDays({
    intakeKcal: detail.kcal,
    weightKg,
    heightCm,
    age,
    sex,
    met: withFormulaOverrides(preview, activityMet),
    tau: preview.ACTIVITY_TARGET_MIN,
    kappa: preview.KCAL_PER_MET_KG_MIN,
    goalKg: preview.WEIGHT_GOAL_KG,
  });
  renderFormulaDays(proj);
  renderFormulaSubstituted(detail, proj, { preview, weightKg, heightCm, age, sex });
}

function loadFormulaInputsFromSettings() {
  FORMULA_FIELDS.forEach((field) => {
    document.getElementById(field.inputId).value = formulaFieldValue(field);
  });
  // Seeded from the same places the charts read, so the figure shown on open
  // matches the one on the Caloric Intake line before anything is touched.
  document.getElementById('formula-weight').value = latestWeightKg(physiqueAsWellnessEntries()) ?? '';
  document.getElementById('formula-height').value = getSetting('HEIGHT_CM', null) ?? '';
  document.getElementById('formula-age').value = ageFromBirthDate(getSettingString('BIRTH_DATE', null)) ?? '';
  // Falls back to male only because the formula needs one of the two — an unset
  // SEX has no neutral value to substitute here.
  const sex = getSettingString('SEX', null);
  document.getElementById('formula-sex').value = sex === 'female' ? 'female' : 'male';
}

function openFormulaPlayground() {
  clearFieldError('formula-status');
  document.getElementById('formula-expression').textContent = FORMULA_EXPRESSION;
  loadFormulaInputsFromSettings();
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

  [...FORMULA_FIELDS.map((f) => f.inputId), 'formula-weight', 'formula-height', 'formula-age'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderFormulaPreview);
  });
  document.getElementById('formula-sex').addEventListener('change', renderFormulaPreview);

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
