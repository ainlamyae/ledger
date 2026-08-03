
// A corrupt or hand-mangled cell degrades to "no breakdown" rather than
// failing the form.
function parsePhysiqueBreakdown(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Draws the shared breakdown table (calorie-estimator.js) under the Breakdown
// field, or hides it when there's nothing parseable to show. renderCalcBreakdown
// itself merges same-name rows and sorts highest calories first for display,
// so an entry saved before that existed (or hand-edited out of order) still
// shows correctly without touching the stored JSON's own order. Each row's
// Carbohydrate/Fat/TEF cells come along for free once estimateTefBreakdown
// (micronutrient-insight.js) has annotated the breakdown array passed in —
// this function itself just draws whatever's already on the rows.
function renderPhysiqueBreakdown(breakdown, calories, protein) {
  if (breakdown.length) {
    renderCalcBreakdown(breakdown, calories || 0, protein || 0, 'physique');
  } else {
    hideCalcBreakdown('physique');
  }
}

// Re-derives Calories In/Protein In/Fiber/Fat/Carbohydrate/TEF straight from
// an already-drawn Consumption breakdown array — the same tail end of
// calculatePhysiqueDay (above) runs once a fresh Calculate has its own
// figures, but this is for when something else changes a row's numbers
// afterwards without a full re-Calculate (currently just the ✏️ button on a
// breakdown row, calorie-estimator.js's applyEditedRowToBreakdown), so what
// Save eventually writes matches what the table now shows rather than the
// stale figures the original Calculate produced.
function syncPhysiqueTotalsFromBreakdown(breakdown, calories, protein) {
  physiqueField('calories-in').value = calories;
  physiqueField('protein-in').value = protein.toFixed(1);

  const tef = estimateTefBreakdown(breakdown);
  const dayMacros = sumBreakdownMacros(breakdown);
  if (dayMacros.fiber !== null) physiqueField('fiber').value = dayMacros.fiber;
  if (dayMacros.fat !== null) physiqueField('fat').value = dayMacros.fat;
  if (dayMacros.carbohydrate !== null) physiqueField('carbohydrate').value = dayMacros.carbohydrate;
  if (tef) physiqueField('tef').value = tef.tefKcal;
}

// The Workout counterpart to the breakdown table above: one row per parsed
// exercise, the MET it was priced at, and the same summed Total row — which is
// where the day's duration and burn are now read, the two fields themselves
// being hidden.
//
// Nothing here is stored. Unlike Breakdown there's no JSON column behind it:
// the whole table is local arithmetic over the Workout text
// (activity-estimator.js), so it can be rebuilt on demand and never has to be
// kept in step with a saved copy of itself.
function renderPhysiqueActivityBreakdown(perLine, minutes, calories, bodyMassKg) {
  const tbody = document.getElementById('physique-activity-breakdown-body');
  tbody.innerHTML = '';

  perLine.forEach((line) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(line.name),
      makeCell(line.quantity),
      makeCell(String(line.met)),
      makeCell(activityLineMinutes(line.seconds)),
      makeCell(String(Math.round(line.calories))),
    );
    tbody.appendChild(tr);
  });

  const totalRow = document.createElement('tr');
  totalRow.className = 'calc-breakdown-total';
  totalRow.append(
    makeCell('Total'),
    makeCell(''),
    makeCell(''),
    makeCell(String(minutes)),
    makeCell(String(calories)),
  );
  tbody.appendChild(totalRow);

  // ACTIVITY_TARGET_MIN's minutes/kcal at today's body mass — same pinned-vs-flat
  // rule the Physical Activity tile/chart use (getActivityTargetMin/Kcal, charts.js),
  // so this row can't drift from what "hitting the workout goal" means elsewhere.
  const targetRow = document.createElement('tr');
  targetRow.className = 'calc-breakdown-target';
  targetRow.append(
    makeCell('Target', 'Workout duration/burn goal — from the Health Formula Playground and Settings, not today\'s Workout'),
    makeCell(''),
    makeCell(''),
    makeCell(String(Math.round(getActivityTargetMin(bodyMassKg)))),
    makeCell(String(Math.round(getActivityTargetKcal(bodyMassKg)))),
  );
  tbody.appendChild(targetRow);

  document.getElementById('physique-activity-breakdown').hidden = false;
}

// One decimal rather than whole minutes: a strength line is often well under a
// minute of active time, and rounding each row to 0 or 1 would leave the rows
// looking nothing like the Total they add up to.
function activityLineMinutes(seconds) {
  return String(Math.round(seconds / 6) / 10);
}

// The same estimate 🧮 Calculate runs, run when the form opens so a saved day
// arrives showing its table — and so what the table shows is what Save writes.
// Repricing on open is the point, not a side effect: the estimate is pure local
// arithmetic over the day's own Workout and Body Mass, so a day opened after
// WORKOUT_REP_SEC (or an Activities MET) changed is worth more than the figure
// it was saved with. A workout that can't be priced writes nothing at all, so a
// hand-typed one keeps whatever it was saved with either way.
//
// Warnings are dropped rather than shown: the form has just opened, and
// openPhysiqueForm clears the error line straight after this anyway. Pressing
// Calculate is what surfaces them.
function refreshPhysiqueActivityBreakdown() {
  runPhysiqueWorkoutCalc(false);
}

function hidePhysiqueActivityBreakdown() {
  document.getElementById('physique-activity-breakdown').hidden = true;
  document.getElementById('physique-activity-breakdown-body').innerHTML = '';
}

// Re-estimates only the Consumption lines that actually changed.
//
// Every breakdown item records the standardized line it produced (noteLine,
// calorie-estimator.js), and Calculate writes those same lines back into
// Consumption — so on a second run, any line still matching one of them is
// already solved and its numbers are reused verbatim. Only the leftovers go to
// Groq/USDA, which is what makes editing one ingredient in a ten-line day cost
// one lookup instead of ten.
//
// A saved breakdown from before noteLine existed simply matches nothing and
// the whole day re-estimates, exactly as it used to.
async function estimateConsumptionIncrementally(consumption, savedBreakdownRaw) {
  const lines = consumption.split('\n').map((line) => line.trim()).filter(Boolean);

  // Each saved item can back at most one line, so the same ingredient typed
  // twice re-estimates its second occurrence rather than double-counting one
  // result.
  const pool = new Map();
  parsePhysiqueBreakdown(savedBreakdownRaw).forEach((item) => {
    if (!item.noteLine) return;
    if (!pool.has(item.noteLine)) pool.set(item.noteLine, []);
    pool.get(item.noteLine).push(item);
  });

  const reused = [];
  const staleLines = [];
  lines.forEach((line) => {
    const matches = pool.get(line);
    if (matches && matches.length) reused.push(matches.shift());
    else staleLines.push(line);
  });

  const fresh = staleLines.length
    ? await estimateCaloriesAndProtein(staleLines.join('\n'), { autoBank: false })
    : { calories: 0, protein: 0, breakdown: [], usdaUnreachable: false };

  // Nothing reused means this is an ordinary full Calculate — pass its own
  // totals straight through, so the same text gives the same figures here as
  // on a first run. A mixed run has to re-sum the per-item numbers
  // instead, which can differ by a fraction of a kcal from a single-pass
  // total (each item is already rounded).
  if (!reused.length) {
    return { ...fresh, reusedCount: 0, estimatedCount: fresh.breakdown.length };
  }

  const breakdown = [...reused, ...fresh.breakdown].sort((a, b) => b.calories - a.calories);
  return {
    calories: Math.round(breakdown.reduce((total, i) => total + i.calories, 0)),
    protein: Math.round(breakdown.reduce((total, i) => total + i.protein, 0) * 10) / 10,
    breakdown,
    usdaUnreachable: fresh.usdaUnreachable,
    reusedCount: reused.length,
    estimatedCount: fresh.breakdown.length,
  };
}

// Prices the Workout field, writing both the hidden Activity Duration and
// Calories Out fields (columns N and O on Save) and the table they're read from,
// so the two can't disagree. Warnings are returned rather than shown — 🧮
// Calculate merges them with the food side's, Log a Workout (strength-plan.js)
// shows them on their own, and opening the form
// (refreshPhysiqueActivityBreakdown) drops them.
//
// Nothing is written unless the estimate succeeds: a day whose Workout is free
// text, or which has no body mass to price it, keeps the pair it was saved with.
//
// Synchronous: unlike the food estimator this is pure local arithmetic, no
// Groq or USDA involved.
// Workout's counterpart to combineAndSortConsumptionText: two lines for the
// same exercise sum into one rather than staying split. Unlike Consumption,
// "same" also needs the same quantity TYPE — two "Nx Push-ups" lines sum
// their reps, but "Nx Push-ups" and "Nmin Push-ups" don't merge, since
// summing a rep count into a minute figure (or vice-versa) wouldn't mean
// anything as one quantity token. A line the parser doesn't recognize at all
// passes through unmerged, same as Consumption's own unparseable-line
// fallback — nothing typed ever just vanishes.
function combineWorkoutText(text) {
  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!rawLines.length) return { text, combinedCount: 0 };

  const groups = new Map();
  let unmergeable = 0;
  rawLines.forEach((raw) => {
    const [parsed] = parseWorkoutNoteLines(raw);
    const key = parsed ? `${parsed.name.toLowerCase()}|${parsed.type}` : `unmergeable-${unmergeable++}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { parsed, raw });
      return;
    }
    if (parsed.type === 'reps') existing.parsed.reps += parsed.reps;
    else if (parsed.type === 'duration') existing.parsed.minutes += parsed.minutes;
    else if (parsed.type === 'steps') existing.parsed.steps += parsed.steps;
    else existing.parsed.seconds += parsed.seconds;
  });
  const combinedCount = rawLines.length - groups.size;

  const rebuilt = [...groups.values()].map((g) => (g.parsed ? `${workoutNoteQuantityForLine(g.parsed)} ${g.parsed.name}` : g.raw));
  return { text: rebuilt.join('\n'), combinedCount };
}

// reorderWorkoutField: rewrite the Workout box itself into the combined,
// sorted order, not just the table below it — only on an explicit Calculate
// click. The table sorts either way (harmless, nothing typed gets touched),
// but the on-open refresh (refreshPhysiqueActivityBreakdown) leaves the box
// exactly as saved, so opening a day never silently reorders or merges text
// you didn't ask it to.
function runPhysiqueWorkoutCalc(reorderWorkoutField) {
  const messages = [];
  const workout = physiqueField('workout').value.trim();
  if (!workout) {
    hidePhysiqueActivityBreakdown();
    return messages;
  }

  // Without the catalogue every exercise would price at EXERCISE_MET_FALLBACK,
  // and since this runs on open and its result is what Save writes, that would
  // quietly flatten a real day's burn to the default. Better to show nothing.
  if (!activitiesDataLoaded) {
    hidePhysiqueActivityBreakdown();
    messages.push('⚠️ Workout skipped — loading catalogue.');
    return messages;
  }

  const bodyMassKg = physiqueBodyMassKg();
  if (bodyMassKg === null) {
    hidePhysiqueActivityBreakdown();
    messages.push(physiqueDataLoaded
      ? '⚠️ Workout skipped — needs Body Mass.'
      : '⚠️ Workout skipped — loading data.');
    return messages;
  }

  try {
    let combinedCount = 0;
    let estimateSource = workout;
    if (reorderWorkoutField) {
      const combined = combineWorkoutText(workout);
      estimateSource = combined.text;
      combinedCount = combined.combinedCount;
    }

    const { minutes, calories, unmatchedNames, perLine } = estimateWorkoutActivity(estimateSource, bodyMassKg);
    // Highest-burn exercise first, same "biggest contributor at the top"
    // read Combine & Sort gives Consumption.
    const sortedPerLine = [...perLine].sort((a, b) => b.calories - a.calories);
    if (reorderWorkoutField) {
      // Rebuilt from quantity + name rather than kept as the original lines,
      // same as Combine & Sort rebuilds Consumption — quantity is recovered
      // in the same token shape parsing expects (workoutNoteQuantityForLine),
      // so a later Calculate reads this box back exactly as it would the
      // original.
      physiqueField('workout').value = sortedPerLine.map((line) => `${line.quantity} ${line.name}`).join('\n');
      if (combinedCount > 0) messages.push(`🔗 ${combinedCount} workout lines combined.`);
    }
    physiqueField('activity-duration').value = minutes;
    physiqueField('calories-out').value = calories;
    renderPhysiqueActivityBreakdown(sortedPerLine, minutes, calories, bodyMassKg);
    if (unmatchedNames.length) {
      messages.push(`⚠️ Couldn't find ${unmatchedNames.map((n) => `"${n}"`).join(', ')} in the Activity Plan — used a default MET.`);
    }
  } catch (err) {
    hidePhysiqueActivityBreakdown();
    messages.push(`⚠️ Workout: ${err.message}`);
  }
  return messages;
}

// Grams-per-unit for mass units only — a fixed unit-to-unit conversion, not
// an ingredient-specific one, so it's safe to apply without knowing what the
// ingredient even is. Deliberately excludes volume units (cup, tbsp, ml, ...):
// converting those to grams needs the ingredient's density, which is exactly
// the kind of lookup that requires Groq/USDA, i.e. what this button exists to
// avoid. A line in one of those units just won't get a local calorie figure.
const PHYSIQUE_MASS_UNIT_TO_GRAMS = { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592 };

// Best-effort calorie figure for one Consumption line, straight off the
// Nutrition table — the same two lookup paths calorie-estimator.js's
// Calculate uses for an exact table hit (by weight or by unit count), minus
// its USDA/AI fallback for a miss. Returns null (not 0) when there's nothing
// local to go on, so a genuinely unknown ingredient doesn't masquerade as a
// 0-calorie one and sort to the bottom for the wrong reason.
function localIngredientCalories(quantity, unit, name) {
  if (quantity === null) return null;
  const entry = findNutritionEntry(name);
  if (!entry || !entry.calories) return null;

  if (unit && COUNT_LIKE_UNITS.has(unit)) {
    const tableCount = parseCountFromAmount(entry.amount);
    return tableCount ? (entry.calories / tableCount) * quantity : null;
  }

  const gramsPerUnit = PHYSIQUE_MASS_UNIT_TO_GRAMS[unit];
  if (gramsPerUnit === undefined) return null;
  const tableGrams = parseGramsFromAmount(entry.amount);
  return tableGrams ? (entry.calories / tableGrams) * (quantity * gramsPerUnit) : null;
}

// Local-only tidy-up for a Consumption block: combines lines that are really
// the same entry typed twice (e.g. two separate "38g onion" additions through
// the day) and orders the rest by calories, the same "highest first" order
// Calculate itself settles on. Two lines only combine when their extracted
// name AND unit both match exactly — no unit conversion is attempted, so
// "100g rice" and "1cup rice" stay separate rather than guessing a conversion
// between them. A line with no parseable quantity (rare — Consumption is
// meant to always lead with an amount) is left exactly as typed and never
// merged with anything. Pure text in, text out — no DOM, so both the modal's
// own Combine & Sort button (below) and the bulk one further down share the
// exact same logic instead of two copies that could drift apart.
function combineAndSortConsumptionText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { text, combinedCount: 0 };

  const groups = new Map();
  let unmergeable = 0;
  lines.forEach((line) => {
    const { quantity, unit } = extractIngredientQuantity(line);
    const name = extractIngredientName(line);
    const key = quantity === null ? `unmergeable-${unmergeable++}` : `${name.toLowerCase()}|${unit || ''}`;
    const existing = groups.get(key);
    if (existing) existing.quantity += quantity;
    else groups.set(key, { quantity, unit, name, raw: line });
  });
  const combinedCount = lines.length - groups.size;

  const rebuilt = [...groups.values()].map((g) => {
    if (g.quantity === null) return g.raw;
    const unitText = g.unit ? (UNIT_CANONICAL[g.unit] || g.unit) : '';
    return `${Math.round(g.quantity * 100) / 100}${unitText} ${g.name}`.trim();
  });

  const scored = rebuilt.map((line) => {
    const { quantity, unit } = extractIngredientQuantity(line);
    return { line, calories: localIngredientCalories(quantity, unit, extractIngredientName(line)) };
  });
  // Unranked (no local match) lines sort after every ranked one, keeping
  // their relative order among themselves — Array#sort is stable, and
  // there's nothing here to break a tie between two nulls.
  scored.sort((a, b) => (b.calories ?? -Infinity) - (a.calories ?? -Infinity));

  return { text: scored.map((s) => s.line).join('\n'), combinedCount };
}

// Hidden whenever running Combine & Sort would be a no-op — the box already
// reads exactly the way combineAndSortConsumptionText would rewrite it, same
// lines in the same order — so the button only ever appears when clicking it
// would actually change something.
function syncPhysiqueCombineButtonVisibility() {
  const field = physiqueField('consumption');
  const btn = document.getElementById('physique-combine-btn');
  const current = field.value.trim();
  if (!current) {
    btn.hidden = true;
    return;
  }
  const normalizedCurrent = current.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  const { text } = combineAndSortConsumptionText(field.value);
  btn.hidden = text === normalizedCurrent;
}

// Ingredient-name suggestions for the Consumption textarea, scoped to
// whichever line the caret is on — a <datalist> (tx-payee-options in
// transactions.js) only ever suggests a whole <input>'s value, and Consumption
// is a multi-line textarea where each line is its own "1x apple"-style entry,
// so this is a hand-rolled dropdown instead. Source list is the Nutrition
// catalogue (allNutritionEntries, nutrition.js) — the same names Log/Add
// ingredient and Calculate itself resolve Consumption lines against.
let consumptionSuggestionMatches = [];
let consumptionSuggestionIndex = -1;

function consumptionSuggestionsList() {
  return document.getElementById('physique-consumption-suggestions');
}

function setupConsumptionAutocomplete() {
  physiqueField('consumption').addEventListener('input', renderConsumptionSuggestions);
  physiqueField('consumption').addEventListener('keydown', handleConsumptionSuggestionKey);
  // Deferred so a mousedown on a suggestion (which fires blur first) still
  // lands — applyConsumptionSuggestion below already hides the list itself,
  // this is only the fallback for e.g. Tab-ing or clicking away.
  physiqueField('consumption').addEventListener('blur', () => setTimeout(hideConsumptionSuggestions, 150));

  consumptionSuggestionsList().addEventListener('mousedown', (e) => {
    const item = e.target.closest('li');
    if (!item) return;
    e.preventDefault(); // keeps focus (and the caret position) on the textarea
    applyConsumptionSuggestion(item.dataset.name);
  });

  // The keyboard opening/closing on mobile resizes the visual viewport, not
  // the layout one — this is what lets positionConsumptionSuggestions track
  // it live instead of just placing it once on show.
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', positionConsumptionSuggestions);
    window.visualViewport.addEventListener('scroll', positionConsumptionSuggestions);
  }
}

function isMobileConsumptionViewport() {
  return window.matchMedia('(max-width: 820px)').matches;
}

// Desktop keeps the plain dropdown (CSS: right under the line you're typing).
// On a narrow viewport with a real on-screen keyboard, pin it to the bottom
// of the visual viewport instead — same spot Description's native datalist
// bar shows on iPhone, just not OS-native since a <datalist> can't attach to
// a <textarea> (see the comment above consumptionSuggestionMatches).
function positionConsumptionSuggestions() {
  const list = consumptionSuggestionsList();
  if (list.hidden) return;

  if (!isMobileConsumptionViewport() || !window.visualViewport) {
    list.classList.remove('autocomplete-suggestions--pinned');
    list.style.removeProperty('bottom');
    return;
  }

  const vv = window.visualViewport;
  const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);

  list.classList.add('autocomplete-suggestions--pinned');
  list.style.bottom = `${keyboardHeight}px`;
}

// The line the caret's currently on, split at the caret — "prefix" is what's
// been typed so far on that line, which is what gets matched against and,
// on accept, replaced.
function currentConsumptionLinePrefix() {
  const field = physiqueField('consumption');
  const before = field.value.slice(0, field.selectionStart);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { lineStart, prefix: before.slice(lineStart) };
}

function renderConsumptionSuggestions() {
  const { prefix } = currentConsumptionLinePrefix();
  const query = extractIngredientName(prefix).toLowerCase();
  if (!query) { hideConsumptionSuggestions(); return; }

  // Prefix matches ("a" -> "apple") before substring matches ("a" -> "salad"),
  // same ranking a browser's own datalist applies.
  const starts = [];
  const contains = [];
  allNutritionEntries.forEach((n) => {
    const name = n.name.toLowerCase();
    if (name === query) return; // already typed in full — nothing to suggest
    if (name.startsWith(query)) starts.push(n.name);
    else if (name.includes(query)) contains.push(n.name);
  });
  consumptionSuggestionMatches = [...starts, ...contains].slice(0, 8);
  if (consumptionSuggestionMatches.length === 0) { hideConsumptionSuggestions(); return; }

  const list = consumptionSuggestionsList();
  list.innerHTML = '';
  consumptionSuggestionMatches.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    li.dataset.name = name;
    list.appendChild(li);
  });
  consumptionSuggestionIndex = -1;
  list.hidden = false;
  positionConsumptionSuggestions();
}

function hideConsumptionSuggestions() {
  const list = consumptionSuggestionsList();
  list.hidden = true;
  list.innerHTML = '';
  list.classList.remove('autocomplete-suggestions--pinned');
  list.style.removeProperty('bottom');
  consumptionSuggestionMatches = [];
  consumptionSuggestionIndex = -1;
}

function handleConsumptionSuggestionKey(e) {
  const list = consumptionSuggestionsList();
  if (list.hidden || consumptionSuggestionMatches.length === 0) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const count = consumptionSuggestionMatches.length;
    consumptionSuggestionIndex = e.key === 'ArrowDown'
      ? (consumptionSuggestionIndex + 1) % count
      : (consumptionSuggestionIndex - 1 + count) % count;
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === consumptionSuggestionIndex));
    list.children[consumptionSuggestionIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    applyConsumptionSuggestion(consumptionSuggestionMatches[consumptionSuggestionIndex] ?? consumptionSuggestionMatches[0]);
  } else if (e.key === 'Escape') {
    hideConsumptionSuggestions();
  }
}

// Replaces just the name portion of the current line — everything after
// whatever quantity/unit (extractIngredientQuantity's own leading tokens)
// already parsed off the front — leaving the quantity typed and the rest of
// the textarea untouched.
function applyConsumptionSuggestion(name) {
  const field = physiqueField('consumption');
  const { lineStart, prefix } = currentConsumptionLinePrefix();
  const nameStart = lineStart + (prefix.length - stripLeadingIngredientTokens(prefix).rest.length);

  const before = field.value.slice(0, nameStart);
  const after = field.value.slice(field.selectionEnd);
  field.value = `${before}${name}${after}`;

  const caret = before.length + name.length;
  field.setSelectionRange(caret, caret);
  field.focus();

  hideConsumptionSuggestions();
  syncPhysiqueCombineButtonVisibility();
}

// The modal's own Combine & Sort button — same tidy-up as the bulk action
// below, run on just the one Consumption box being edited right now, so it
// can be cleaned up before Calculate ever runs rather than only after saving.
function combineAndSortPhysiqueConsumptionField() {
  const field = physiqueField('consumption');
  if (!field.value.trim()) {
    showFieldError('physique-form-error', 'Fill in Consumption first.');
    return;
  }

  const { text, combinedCount } = combineAndSortConsumptionText(field.value);
  field.value = text;
  clearFieldError('physique-form-error');
  if (combinedCount > 0) {
    showFieldError('physique-form-error', `🔗 ${combinedCount} combined.`);
  }
  syncPhysiqueCombineButtonVisibility();
}

// The form's own 🧬 action — same view the table row's button opens
// (openPhysiqueMicronutrients), reachable without closing back out to the
// row. Only meaningful for a day already on the sheet: aggregateMicronutrientIntake
// reads the SAVED Physique rows (physiqueAsWellnessEntries), not whatever's
// currently typed in this form, so a still-unsaved Log/Duplicate has nothing
// yet to look up.
function openPhysiqueMicronutrientsFromForm() {
  const entry = allPhysiqueEntries.find((p) => p.row === editingPhysiqueRow);
  if (!entry) {
    showFieldError('physique-form-error', 'Save this day first — Micronutrients reads the saved log.');
    return;
  }
  openPhysiqueMicronutrients(entry);
}

// --- Bulk Combine & Sort --------------------------------------------------
//
// Sits beside 🧮 Calculate in the same bulk actions bar, but never touches
// Groq/USDA: for each selected day, combineAndSortConsumptionText tidies just
// that day's Consumption column locally and writes it straight back, the same
// per-row read/write bulkCalculatePhysique uses. Calories In/Protein In are
// untouched — combining/reordering lines doesn't change the day's totals,
// only their arrangement, so there's nothing for Calculate's actual estimate
// to redo here.
function eligibleForBulkCombine(p) {
  return Boolean(p.consumption.trim());
}

async function bulkCombineAndSortPhysique() {
  const selected = allPhysiqueEntries.filter((p) => selectedPhysiqueRows.has(p.row));
  const eligible = selected.filter(eligibleForBulkCombine);
  const skipped = selected.length - eligible.length;

  if (!eligible.length) {
    alert('None of the selected days have a Consumption to combine/sort.');
    return;
  }

  const summaryEl = document.getElementById('physique-bulk-summary');
  const snapshots = eligible.map((p) => ({ row: p.row, values: physiqueRowValues(p) }));

  let done = 0;
  let combinedTotal = 0;
  let changedCount = 0;
  const succeeded = [];
  const results = await Promise.allSettled(eligible.map(async (p, i) => {
    try {
      const { text, combinedCount } = combineAndSortConsumptionText(p.consumption);
      if (text !== p.consumption) {
        const values = physiqueRowValues(p);
        values[4] = text;
        await updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${p.row}:O${p.row}`, [values]);
        changedCount += 1;
        combinedTotal += combinedCount;
        succeeded.push(snapshots[i]);
      }
    } finally {
      done += 1;
      summaryEl.textContent = `Combining ${done}/${eligible.length}…`;
    }
  }));

  selectedPhysiqueRows.clear();
  await refreshPhysique(true);

  const failed = results.filter((r) => r.status === 'rejected').length;
  const parts = [`${changedCount} day${changedCount === 1 ? '' : 's'} tidied (${combinedTotal} duplicate line${combinedTotal === 1 ? '' : 's'} combined)`];
  if (skipped) parts.push(`${skipped} skipped (nothing to combine)`);
  if (failed) parts.push(`${failed} failed`);

  showUndoToast(`${parts.join(', ')}.`, () => restorePhysiqueSnapshots(succeeded));
}

async function handlePhysiqueScanInput(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  const btn = document.getElementById('physique-scan-btn');
  btn.disabled = true;
  btn.textContent = 'Analyzing…';

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const ingredientText = await groqAnalyzeFoodImage(base64, file.type);

    // Lives inside the already-open Log form now, so it appends to whatever
    // Consumption already holds rather than wiping the rest of the day's
    // fields the way opening a fresh blank form would.
    const consumptionField = physiqueField('consumption');
    consumptionField.value = consumptionField.value.trim()
      ? `${consumptionField.value.trim()}\n${ingredientText}`
      : ingredientText;
    syncPhysiqueCombineButtonVisibility();
    await calculatePhysiqueDay();
  } catch (err) {
    console.error('[Scan Food]', err);
    showFieldError('physique-form-error', `Scan failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan';
  }
}

// A whole Consumption block wrapped as "(<lines>)/<n>" — typed to log a shared
// portion (a recipe split n ways, a fraction of a batch eaten) without hand-dividing
// every line's own amount first. Only the OUTER wrapper is this syntax:
// resolveDivisionQuantities's existing single-line "200/5g" still means what it
// always has, since that's resolved deep inside stripLeadingIngredientTokens on
// each line's own text, never on this wrapper.
const CONSUMPTION_DIVISOR_WRAP_RE = /^\(([\s\S]*)\)\s*\/\s*([\d.]+)\s*$/;

// Rebuilds each wrapped line as its own quantity divided by n, same
// `${quantity}${unit} ${name}` shape combineAndSortConsumptionText's rebuilt lines
// use — so a divided line reads exactly like one typed that way to begin with. A
// line whose quantity can't be parsed (extractIngredientQuantity finds none) is
// left as-is rather than guessed at. Returns null (nothing to do) when the field
// isn't wrapped this way at all, or the divisor is 0/unparseable.
function applyConsumptionDivisor(text) {
  const match = CONSUMPTION_DIVISOR_WRAP_RE.exec(text.trim());
  if (!match) return null;

  const divisor = parseFloat(match[2]);
  if (!divisor) return null;

  return match[1].split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return trimmed;

    const { quantity, unit } = extractIngredientQuantity(trimmed);
    if (quantity === null) return trimmed;

    const name = extractIngredientName(trimmed);
    const unitText = unit ? (UNIT_CANONICAL[unit] || unit) : '';
    return `${Math.round((quantity / divisor) * 100) / 100}${unitText} ${name}`.trim();
  }).join('\n');
}

// Both estimators run together:
// Consumption fills Breakdown/Calories In/Protein In, Workout fills Activity
// Duration/Calories Out. Whichever field is empty is simply skipped, and
// neither side's failure stops the other.
async function calculatePhysiqueDay() {
  const divided = applyConsumptionDivisor(physiqueField('consumption').value);
  if (divided !== null) {
    physiqueField('consumption').value = divided;
    syncPhysiqueCombineButtonVisibility();
  }

  const consumption = physiqueField('consumption').value.trim();
  const workout = physiqueField('workout').value.trim();
  const btn = document.getElementById('physique-calc-btn');

  if (!consumption && !workout) {
    showFieldError('physique-form-error', 'Fill in Consumption, Workout, or both first.');
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Calculating…';
  clearFieldError('physique-form-error');

  const messages = runPhysiqueWorkoutCalc(true);

  if (consumption) {
    try {
      const { calories, protein, breakdown, usdaUnreachable, reusedCount, estimatedCount } =
        await estimateConsumptionIncrementally(consumption, physiqueField('breakdown').value);

      // Rebuilt from the merged breakdown rather than the fresh estimate's own
      // standardizedNotes, which only covers the lines that were re-estimated —
      // then straight through the same tidy-up the Combine & Sort button runs,
      // so Calculate never leaves behind a Consumption box that button would
      // still have something to do to.
      const rebuiltConsumption = breakdown.map((i) => i.noteLine || `${i.amount} ${i.name}`).join('\n');
      const { text: sortedConsumption, combinedCount } = combineAndSortConsumptionText(rebuiltConsumption);
      physiqueField('consumption').value = sortedConsumption;
      syncPhysiqueCombineButtonVisibility();
      if (combinedCount > 0) messages.push(`🔗 ${combinedCount} combined.`);
      physiqueField('calories-in').value = calories;
      physiqueField('protein-in').value = protein.toFixed(1);

      // Annotates each matched row with fiber/fat/carbohydrate/tef BEFORE
      // drawing the table, so DF/Fat/Carb/TEF show up in the same pass as
      // Cal/Pro rather than a second one. Only when it's actually measurable —
      // a day whose ingredients have no 🧬 Micronutrients pulled yet leaves
      // each field exactly as it was (blank, or whatever a previous Calculate
      // last wrote) rather than overwriting a real figure with nothing.
      const tef = estimateTefBreakdown(breakdown);
      const dayMacros = sumBreakdownMacros(breakdown);
      if (dayMacros.fiber !== null) physiqueField('fiber').value = dayMacros.fiber;
      if (dayMacros.fat !== null) physiqueField('fat').value = dayMacros.fat;
      if (dayMacros.carbohydrate !== null) physiqueField('carbohydrate').value = dayMacros.carbohydrate;
      if (tef) physiqueField('tef').value = tef.tefKcal;
      // Writes the Breakdown field's JSON as well as drawing the table.
      renderPhysiqueBreakdown(breakdown, calories, protein);

      if (reusedCount) {
        messages.push(`♻️ ${reusedCount} reused, ${estimatedCount} new.`);
      }
      if (usdaUnreachable) {
        messages.push('⚠️ No DB — AI only.');
      }
      if (calories > PHYSIQUE_DAY_CALORIE_CEILING) {
        messages.push(`⚠️ ${calories} kcal, check.`);
      }
    } catch (err) {
      messages.push(`⚠️ Consumption: ${err.message}`);
    }
  }

  btn.disabled = false;
  btn.textContent = originalLabel;

  if (messages.length) showFieldError('physique-form-error', messages.join(' '));
}
