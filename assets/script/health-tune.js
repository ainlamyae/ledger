// τ, s and f from their L_p-day logged averages ending yesterday. A box with no
// history is left as is, never blanked: all three are needed to compute Eᵢₙ.
function seedLoggedAverageFields(healthEntries, periodDays) {
  const bodyMassKg = formulaBodyMassKg();

  const avgSleep = trailingSleepHours(healthEntries, periodDays);
  if (avgSleep !== null) document.getElementById('formula-plan-sleep-hours').value = Math.round(avgSleep * 10) / 10;

  // No m̄ yet means no kcal → minutes conversion.
  const avgActivityKcal = bodyMassKg ? trailingActivityKcal(healthEntries, bodyMassKg, periodDays) : null;
  const avgActivityMin = avgActivityKcal !== null ? activityMinutesFromKcal(avgActivityKcal, bodyMassKg) : null;
  if (avgActivityMin !== null) document.getElementById('formula-activity-min').value = Math.round(avgActivityMin);

  const avgTefPct = trailingTefPercent(healthEntries, periodDays);
  if (avgTefPct !== null) document.getElementById('formula-tef-pct').value = Math.round(avgTefPct * 10) / 10;
}

function loadFormulaInputsFromSettings() {
  ALL_FORMULA_FIELDS.forEach((field) => {
    document.getElementById(field.inputId).value = formulaFieldValue(field);
  });
  // m is the latest reading; m̄ is the charts' own average, over the L_p just loaded.
  const healthEntries = physiqueAsHealthEntries();
  document.getElementById('formula-body-mass').value = latestBodyMassKg(healthEntries) ?? TUNE_PROFILE_DEFAULTS.bodyMassKg;
  const periodDays = periodInputValue('formula-cal-period-days', bodyMassSmoothingDays());
  document.getElementById('formula-body-mass-smooth').value =
    smoothedBodyMassKg(healthEntries, periodDays) ?? TUNE_PROFILE_DEFAULTS.smoothBodyMassKg;
  // After m̄, which τ's seed reads off its box.
  seedLoggedAverageFields(healthEntries, periodDays);
  document.getElementById('formula-height').value = getSetting('HEIGHT_CM', null) ?? TUNE_PROFILE_DEFAULTS.heightCm;
  document.getElementById('formula-age').value = ageFromBirthDate(getSettingString('BIRTH_DATE', null)) ?? TUNE_PROFILE_DEFAULTS.age;
  // The formulas need one of the two; unset falls back to male.
  const sex = getSettingString('SEX', null);
  document.getElementById('formula-sex').value = sex === 'female' ? 'female' : 'male';
  // Eᵢₙ is seeded (DELTA_M, the opening mode, solves from it); t isn't. A pinned intake
  // wins, so opening Tune can't replace it; otherwise the plan's own figure.
  const pinnedEin = pinnedCalorieDesiredKcal();
  if (pinnedEin !== null) {
    document.getElementById('formula-ein').value = pinnedEin;
  } else {
    const seedDetail = calorieDesiredDetail(planBodyMassKg(healthEntries));
    document.getElementById('formula-ein').value = seedDetail ? Math.round(seedDetail.kcal) : '';
  }
  // Δm% only when pinned; otherwise the render derives it from the kilograms.
  const pinnedPct = pinnedWeeklyFatLossPct();
  if (pinnedPct !== null) document.getElementById('formula-weekly-loss-pct').value = pinnedPct;
}

function openFormulaPlayground() {
  clearFieldError('formula-status');
  document.querySelector('input[name="formula-solve-for"][value="DELTA_M"]').checked = true;
  const pctPinned = pinnedWeeklyFatLossPct() !== null;
  // Each open starts fresh: every pair's known is whichever the sheet stores.
  dualKnownField.TAU = 'ein';
  dualKnownField.DELTA_M = 'ein';
  weeklyLossKnownField = pctPinned ? 'pct' : 'kg';
  healthyMassKnownField = 'kg';
  const check = (name, value) => { document.querySelector(`input[name="${name}"][value="${value}"]`).checked = true; };
  // The radios show what's saved; Save keeps the two pins exclusive.
  check('formula-pin-mode', pctPinned ? 'pct' : (pinnedCalorieDesiredKcal() !== null ? 'intake' : 'deficit'));
  check('formula-activity-pin-mode', pinnedActivityDesiredKcal() !== null ? 'calorie' : 'time');
  // The saved equation, or the saved basis layered on it.
  lastExplicitBmrFormula = bmrFormula();
  check('formula-bmr-formula', BMR_BASIS_RADIO_VALUES.includes(bmrBasis()) ? bmrBasis() : bmrFormula());
  check('formula-lbm-formula', lbmFormula());
  loadFormulaInputsFromSettings();
  applySolveForMode('DELTA_M');
  renderFormulaPreview();
}

// Eᵢₙ as shown, typed or computed, so a pin is exactly the number on screen.
function formulaEinKcal() {
  const shown = evaluateNumberExpression(document.getElementById('formula-ein').value.trim());
  return (shown !== null && shown > 0) ? Math.round(shown) : null;
}

async function saveFormulaSettings() {
  const { overrides, invalid, bodyMassKg } = readFormulaInputs();
  if (invalid.length) return;

  // Pin the intake, the % or the deficit; each excludes the others. Pinning the deficit
  // blanks both keys, leaving WEEKLY_FAT_LOSS_KG in force. A key is only written when it
  // changes, so an unpinned sheet gains no blank rows.
  const pinMode = currentPinMode();
  const pinned = pinMode === 'intake';
  const pctPinned = pinMode === 'pct';
  const einKcal = formulaEinKcal();
  if (pinned && einKcal === null) {
    showFieldError('formula-status', "Can't pin a daily intake while TEI has no value — fill the other inputs in first, or pin the deficit instead.");
    return;
  }
  const pctToPin = formulaNumber('formula-weekly-loss-pct');
  if (pctPinned && pctToPin === null) {
    showFieldError('formula-status', "Can't pin a fat-loss percentage while Δm% has no value — it needs a body mass and a weekly rate, or pin the deficit instead.");
    return;
  }
  if (pinned || pinnedCalorieDesiredKcal() !== null) {
    overrides[CALORIE_DESIRED_PIN_KEY] = pinned ? einKcal : '';
  }
  if (pctPinned || pinnedWeeklyFatLossPct() !== null) {
    overrides[WEEKLY_FAT_LOSS_PCT_PIN_KEY] = pctPinned ? pctToPin : '';
  }

  // Activity: pin the burn the typed τ implies, or blank it so τ is held.
  const activityPinned = checkedRadioValue('formula-activity-pin-mode') === 'calorie';
  const activityKcalToPin = activityPinned
    ? Math.round(withFormulaOverrides(overrides, () => activityDesiredKcal(bodyMassKg)))
    : null;
  if (activityPinned || pinnedActivityDesiredKcal() !== null) {
    overrides[ACTIVITY_DESIRED_PIN_KEY] = activityPinned ? activityKcalToPin : '';
  }

  // Each macro band saves its coefficients beside the grams they give; its minimum
  // also becomes that nutrient's row in the Micronutrients table.
  const bands = MACRO_BANDS.map((band) => ({ ...band, values: band.read() }));
  const micronutrientPatch = {};
  bands.forEach(({ keys, nutrient, values }) => {
    if (values === null) return;
    Object.entries(keys).forEach(([field, key]) => { overrides[key] = values[field]; });
    micronutrientPatch[nutrient] = values.minG;
  });
  if (Object.keys(micronutrientPatch).length > 0) {
    overrides.MICRONUTRIENT_DAILY_DESIRED_JSON = patchMicronutrientDailyDesiredAmounts(micronutrientPatch);
  }

  // Adaptation and girths: only boxes holding a number.
  [...ADAPT_FORMULA_FIELDS, ...NAVY_FORMULA_FIELDS].forEach((field) => {
    const value = formulaNumber(field.inputId);
    if (value !== null) overrides[field.key] = value;
  });

  // The BMR_cal window only; each day's BMR_cal lives in Physique's Derived column.
  const calibration = tuneBmrCalibration();
  if (calibration) {
    overrides[BMR_CALIBRATION_PERIOD_COUNT_KEY] = calibration.periodCount;
    overrides[BMR_CALIBRATION_PERIOD_DAYS_KEY] = calibration.periodDays;
  }

  const saveBtn = document.getElementById('formula-save-btn');
  const statusEl = document.getElementById('formula-status');
  saveBtn.disabled = true;
  Motion.iconBusy(saveBtn);
  clearFieldError('formula-status');
  statusEl.classList.remove('status-ok');

  try {
    // The MET box is a preview-only what-if; the Activity sheet's Walk row is its home.
    delete overrides[ACTIVITY_MET_PREVIEW_KEY];
    // Tune's ΔM_gly becomes the swing every display reads (GLYCOGEN_SWING_KG).
    const swing = readGlycogenSwingFormula();
    if (swing) overrides[GLYCOGEN_SWING_KEY] = swing.swingKg;
    await saveSettingValues(overrides);
    // Settings are already refreshed; re-render so everything agrees with them.
    applySettingsToWidgets();
    renderHealthCharts(physiqueAsHealthEntries());
    loadFormulaInputsFromSettings();
    applySolveForMode(currentSolveFor());
    renderFormulaPreview();
    statusEl.classList.add('status-ok');
    // One short line: what was pinned, the new bands, the BMR model.
    const band = (name, b) => (b === null ? `${name} unchanged` : `${name} ${b.minG}–${b.maxG} g`);
    const tefSaved = formulaNumber('formula-tef-pct');
    const notes = [
      pinned ? `Intake pinned at ${einKcal} kcal` : null,
      pctPinned && !pinned ? `Fat loss pinned at ${pctToPin}%/week` : null,
      activityPinned ? `Activity pinned at ${activityKcalToPin} kcal/day` : null,
      ...bands.map(({ label, values }) => band(label, values)),
      `BMR: ${currentBmrFormula() === 'katch' ? 'Katch-McArdle' : 'Mifflin-St Jeor'}`,
      tefSaved ? `TEF ${tefSaved}%` : null,
      !calibration ? null : calibration.result.ok
        ? `BMR_cal ${calibration.result.bmrCal} kcal/day`
        : 'BMR_cal unchanged',
    ].filter(Boolean);
    showToast(`Saved — ${notes.join(' · ')}`);
  } catch (err) {
    showFieldError('formula-status', err.message);
  } finally {
    saveBtn.disabled = false;
    Motion.iconSettle(saveBtn);
  }
}

function initFormulaPlayground() {
  // The equation list, styled like Calculations: headings dark, equations gray.
  const expression = document.getElementById('formula-expression');
  for (const line of FORMULA_EXPRESSION.split('\n')) {
    if (!line.trim()) continue;
    const p = document.createElement('p');
    const text = line.trim().replace(/ {2,}/g, ' ');
    if (/^\s/.test(line)) p.textContent = text;
    else p.append(Object.assign(document.createElement('strong'), { textContent: text }));
    expression.appendChild(p);
  }
  // Reseeds from the sheet each time the Health Tune block is expanded.
  const panel = document.getElementById('health-tune-panel');
  let wasCollapsed = true;
  new MutationObserver(() => {
    const collapsed = panel.classList.contains('collapsed');
    if (wasCollapsed && !collapsed) openFormulaPlayground();
    wasCollapsed = collapsed;
  }).observe(panel, { attributes: true, attributeFilter: ['class'] });

  // A typed m becomes m̄, the mass every formula runs at.
  document.getElementById('formula-body-mass').addEventListener('input', (event) => {
    if (!event.target.value) return;
    document.getElementById('formula-body-mass-smooth').value = event.target.value;
    renderFormulaPreview();
  });
  // A typed L_p re-averages m̄, τ, s and f; registered first so the render reads them.
  document.getElementById('formula-cal-period-days').addEventListener('input', () => {
    const days = periodInputValue('formula-cal-period-days', bodyMassSmoothingDays());
    const healthEntries = physiqueAsHealthEntries();
    document.getElementById('formula-body-mass-smooth').value =
      smoothedBodyMassKg(healthEntries, days) ?? '';
    seedLoggedAverageFields(healthEntries, days);
  });

  // Δm and m_g are wired with their unit pairs below, which record the known first.
  const pairedIds = ['formula-weekly-loss', 'formula-healthy'];
  [...ALL_FORMULA_FIELDS.map((f) => f.inputId).filter((id) => !pairedIds.includes(id)),
    'formula-body-mass-smooth', 'formula-height', 'formula-age',
    'formula-glycogen-skeletal-frac', 'formula-glycogen-per-kg-muscle', 'formula-glycogen-liver',
    'formula-glycogen-water-ratio'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderFormulaPreview);
  });
  document.getElementById('formula-sex').addEventListener('change', renderFormulaPreview);
  document.querySelectorAll('input[name="formula-lbm-formula"]').forEach((radio) => {
    radio.addEventListener('change', renderFormulaPreview);
  });

  // An equation pick is remembered for any basis later layered on it.
  document.querySelectorAll('input[name="formula-bmr-formula"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      clearFieldError('formula-status');
      const value = checkedRadioValue('formula-bmr-formula');
      if (!BMR_BASIS_RADIO_VALUES.includes(value)) lastExplicitBmrFormula = value;
      renderFormulaPreview();
    });
  });

  // Typing Eᵢₙ or t makes it TAU/DELTA_M's known; other modes have no choice to record.
  const markDualKnown = (field) => {
    const mode = currentSolveFor();
    if (isDualSolveMode(mode)) {
      dualKnownField[mode] = field;
      applySolveForMode(mode);
    }
  };
  // Typing either box of a unit pair makes it the known. Readonly boxes fire no input,
  // so no mode check is needed.
  [
    ['formula-weekly-loss', () => { weeklyLossKnownField = 'kg'; }],
    ['formula-weekly-loss-pct', () => { weeklyLossKnownField = 'pct'; }],
    ['formula-healthy', () => { healthyMassKnownField = 'kg'; }],
    ['formula-healthy-bmi', () => { healthyMassKnownField = 'bmi'; }],
    ['formula-ein', () => markDualKnown('ein')],
    ['formula-days', () => markDualKnown('days')],
  ].forEach(([id, markKnown]) => {
    document.getElementById(id).addEventListener('input', () => {
      markKnown();
      renderFormulaPreview();
    });
  });

  // The date is t in another unit. 'change', since a date is complete only once picked.
  document.getElementById('formula-eta').addEventListener('change', (event) => {
    if (event.target.readOnly || !event.target.value) return;
    markDualKnown('days');
    document.getElementById('formula-days').value = String(daysFromTodayIso(event.target.value));
    renderFormulaPreview();
  });

  document.querySelectorAll('input[name="formula-solve-for"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      // FIXED_PCT holds the %, so it pins it too and the save matches the preview.
      if (currentSolveFor() === 'FIXED_PCT') {
        document.querySelector('input[name="formula-pin-mode"][value="pct"]').checked = true;
      }
      applySolveForMode(currentSolveFor());
      clearFieldError('formula-status');
      renderFormulaPreview();
    });
  });

  // A % pin changes the journey t is measured along and makes the % the known.
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
  document.getElementById('formula-save-btn').addEventListener('click', saveFormulaSettings);
}
