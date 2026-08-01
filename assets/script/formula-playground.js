
function loadFormulaInputsFromSettings() {
  [...FORMULA_FIELDS, ...PROTEIN_FORMULA_FIELDS, ...FIBER_FORMULA_FIELDS, ...FAT_FORMULA_FIELDS, ...CARB_FORMULA_FIELDS, ...ADAPT_FORMULA_FIELDS].forEach((field) => {
    document.getElementById(field.inputId).value = formulaFieldValue(field);
  });
  // Seeded from the same places the charts read, so the figure shown on open
  // matches the one on the Caloric Intake line before anything is touched.
  //
  // Both mass boxes, from the two functions that define them: the raw one is the last
  // weigh-in, shown only for comparison, and m̄ is planBodyMassKg — the same rolling average
  // the tile and the chart target are computed at, so the modal opens agreeing with them.
  const wellnessEntries = physiqueAsWellnessEntries();
  document.getElementById('formula-body-mass').value = latestBodyMassKg(wellnessEntries) ?? '';
  document.getElementById('formula-body-mass-smooth').value = planBodyMassKg(wellnessEntries) ?? '';
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
  // And the target pair, always on kilograms: BODY_MASS_TARGET_KG is what the sheet stores,
  // so the kilograms are the known on open and the BMI is derived from them.
  targetMassKnownField = 'kg';
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
  // Also from the sheet rather than a fixed default: which BMR equation is in force is a
  // saved decision, and opening the modal on the other one would misdescribe every figure
  // behind it until something was touched.
  document.querySelector(`input[name="formula-bmr-formula"][value="${bmrFormula()}"]`).checked = true;
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

  // Same shape as protein just above: both coefficients, and the grams they produced —
  // FIBER_TARGET_G_MIN/MAX is what the tile and the chart actually read.
  const fiber = readFiberFormula();
  if (fiber !== null) {
    overrides.FIBER_G_PER_1000_KCAL_MIN = fiber.perKcalMin;
    overrides.FIBER_G_PER_KG_MAX = fiber.perKgMax;
    overrides.FIBER_TARGET_G_MIN = fiber.minG;
    overrides.FIBER_TARGET_G_MAX = fiber.maxG;
  }

  // Same shape again: both coefficients (as the % of Eᵢₙ they are), and the grams they
  // produced — FAT_TARGET_G_MIN/MAX so anything that reads it later has the same
  // reasoning-next-to-result the protein/fiber bands do, even though nothing reads it yet.
  const fat = readFatFormula();
  if (fat !== null) {
    overrides.FAT_PCT_OF_KCAL_MIN = fat.pctMin;
    overrides.FAT_PCT_OF_KCAL_MAX = fat.pctMax;
    overrides.FAT_TARGET_G_MIN = fat.minG;
    overrides.FAT_TARGET_G_MAX = fat.maxG;
  }

  // Same shape again: both coefficients (as the % of Eᵢₙ they are), and the grams they
  // produced — CARB_TARGET_G_MIN/MAX so the Carbohydrate Intake chart reads the same band this
  // sheet just computed.
  const carb = readCarbFormula();
  if (carb !== null) {
    overrides.CARB_PCT_OF_KCAL_MIN = carb.pctMin;
    overrides.CARB_PCT_OF_KCAL_MAX = carb.pctMax;
    overrides.CARB_TARGET_G_MIN = carb.minG;
    overrides.CARB_TARGET_G_MAX = carb.maxG;
  }

  // Keeps the Micronutrients table's own Protein/Fiber/Fat/Carb rows (and their gap-severity
  // coloring) in step with the band just computed above, instead of leaving them on
  // whatever flat FDA Daily Value MICRONUTRIENT_DAILY_TARGETS_JSON shipped or was last
  // typed with. The band's MIN is what's written — kind stays 'floor'/'reference' either
  // way, and that's the "did you get enough" question gap severity actually asks; the full
  // min~max band still shows everywhere else (the tile, the chart, Food Insight's
  // Ideal/day row), all read straight from PROTEIN_TARGET_G_MIN/MAX, FIBER_TARGET_G_MIN/MAX,
  // FAT_TARGET_G_MIN/MAX and CARB_TARGET_G_MIN/MAX rather than from this JSON.
  const micronutrientPatch = {};
  if (protein !== null) micronutrientPatch['Protein'] = protein.minG;
  if (fiber !== null) micronutrientPatch['Fiber, total dietary'] = fiber.minG;
  if (fat !== null) micronutrientPatch['Total lipid (fat)'] = fat.minG;
  if (carb !== null) micronutrientPatch['Carbohydrate, by difference'] = carb.minG;
  if (Object.keys(micronutrientPatch).length > 0) {
    overrides.MICRONUTRIENT_DAILY_TARGETS_JSON = patchMicronutrientDailyTargetAmounts(micronutrientPatch);
  }

  // The adaptation pair, saved the same way and for the same reason as the per-kg protein
  // rule: they change no target, but the Health Plan prompt quotes them, so the sheet has to
  // remember what the plateau caveat was computed with. Each only when it holds a number —
  // a blank one is left alone rather than written as an empty cell.
  ADAPT_FORMULA_FIELDS.forEach((field) => {
    const value = formulaNumber(field.inputId);
    if (value !== null) overrides[field.key] = value;
  });

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
    const fiberNote = fiber === null
      ? ' The fiber band was left alone — it needs body mass, Eᵢₙ and both coefficients.'
      : ` Fiber target is now ${fiber.minG}–${fiber.maxG} g/day, from ${fiber.perKcalMin} g per 1,000 kcal and ${fiber.perKgMax} g per kg body weight.`;
    const fatNote = fat === null
      ? ' The fat band was left alone — it needs Eᵢₙ and both percentages.'
      : ` Fat target is now ${fat.minG}–${fat.maxG} g/day, from ${fat.pctMin}–${fat.pctMax}% of ${fat.einKcal} kcal at ${KCAL_PER_G_FAT} kcal/g.`;
    const carbNote = carb === null
      ? ' The carb band was left alone — it needs Eᵢₙ and both percentages.'
      : ` Carb target is now ${carb.minG}–${carb.maxG} g/day, from ${carb.pctMin}–${carb.pctMax}% of ${carb.einKcal} kcal at ${KCAL_PER_G_CARB} kcal/g.`;
    const micronutrientNote = Object.keys(micronutrientPatch).length > 0
      ? ' The Micronutrients table’s Protein/Fiber/Fat/Carb floors now match these too.'
      : '';
    // Which BMR equation is now in force, and whether digestion is being counted — the two
    // choices that move every calorie figure in the app at once, so a save that changed one
    // shouldn't leave you guessing which numbers just moved and why.
    const modelNote = currentBmrFormula() === 'katch'
      ? 'BMR now comes from Katch-McArdle (370 + 21.6 × LBM), so age no longer enters the target.'
      : 'BMR stays on Mifflin-St Jeor.';
    const tefSaved = formulaNumber('formula-tef-pct');
    const tefNote = tefSaved ? ` The thermic effect of food is counted at ${tefSaved}% of intake, which lifts every target accordingly.` : '';
    showFieldError('formula-status', `Saved — ${intakeNote} ${activityNote} ${proteinNote}${fiberNote}${fatNote}${carbNote}${micronutrientNote} ${modelNote}${tefNote}`);
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
  // formula-body-mass is NOT here: it's the raw weigh-in, readonly and read by nothing —
  // m̄ below it is the box every identity is evaluated at, so it's the one that re-renders.
  //
  // m_g is left out for the same reason Δm is, and wired with BMI_g below: both have to
  // record which of their pair is the known BEFORE the render, and a plain render-only
  // listener firing first would let the previous known overwrite the box being typed into.
  [...FORMULA_FIELDS.map((f) => f.inputId).filter((id) => id !== 'formula-weekly-loss' && id !== 'formula-target'),
    ...PROTEIN_FORMULA_FIELDS.map((f) => f.inputId),
    ...FIBER_FORMULA_FIELDS.map((f) => f.inputId),
    ...FAT_FORMULA_FIELDS.map((f) => f.inputId),
    ...CARB_FORMULA_FIELDS.map((f) => f.inputId),
    ...ADAPT_FORMULA_FIELDS.map((f) => f.inputId),
    'formula-body-mass-smooth', 'formula-height', 'formula-age',
    'formula-glycogen-skeletal-frac', 'formula-glycogen-per-kg-muscle', 'formula-glycogen-liver',
    'formula-glycogen-water-ratio'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderFormulaPreview);
  });
  document.getElementById('formula-sex').addEventListener('change', renderFormulaPreview);

  // Switching BMR equations re-derives everything: the figure, A and B, the plateau and the
  // arrival date, and (under Katch) whether a blank age is even a problem — so it goes
  // through the same full render a typed input does, not a cosmetic swap of one line.
  document.querySelectorAll('input[name="formula-bmr-formula"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      clearFieldError('formula-status');
      renderFormulaPreview();
    });
  });

  // Either box can be the one you fill in; typing into it makes it the known and pushes
  // the other one. No mode check needed: in DELTA_M both are readonly, and a readonly
  // input fires no input event.
  [['formula-weekly-loss', 'kg'], ['formula-weekly-loss-pct', 'pct']].forEach(([id, field]) => {
    document.getElementById(id).addEventListener('input', () => {
      weeklyLossKnownField = field;
      renderFormulaPreview();
    });
  });

  // The target's own pair, the same way: type kilograms and the BMI follows, type a BMI and
  // the kilograms follow. No mode check needed here either — in TARGET_MASS both are readonly,
  // and a readonly input fires no input event.
  [['formula-target', 'kg'], ['formula-target-bmi', 'bmi']].forEach(([id, field]) => {
    document.getElementById(id).addEventListener('input', () => {
      targetMassKnownField = field;
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
