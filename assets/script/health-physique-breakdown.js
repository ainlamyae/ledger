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

// Draws the shared breakdown table (health-physique-estimator.js), or hides it
// when there's nothing to show.
function renderPhysiqueBreakdown(breakdown, calories, protein) {
  if (breakdown.length) {
    renderCalcBreakdown(breakdown, calories || 0, protein || 0, 'physique');
  } else {
    hideCalcBreakdown('physique');
  }
}

// Writes Calories In/Protein In/Fiber/Fat/Carbohydrate/TEF from a breakdown, so
// Save matches the table. A macro nothing measured keeps its field as it was.
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

// The Workout's table: one row per exercise and the MET it was priced at. Not
// stored: it's rebuilt from the Workout text (health-activity-estimator.js).
function renderPhysiqueActivityBreakdown(perLine, minutes, calories, bodyMassKg) {
  const tbody = document.getElementById('physique-activity-breakdown-body');
  tbody.innerHTML = '';

  perLine.forEach((line) => {
    appendTableRow(tbody, '', [
      makeCell(titleCaseIngredientName(line.name)),
      makeCell(line.quantity),
      makeCell(String(line.met)),
      makeCell(activityLineMinutes(line.seconds)),
      makeCell(String(Math.round(line.calories))),
      activitySourceCell(line),
    ]);
  });

  appendTableRow(tbody, 'calc-breakdown-total', [
    makeCell('Total'),
    makeCell(''),
    makeCell(''),
    makeCell(String(minutes)),
    makeCell(String(calories)),
    makeCell(''),
  ]);

  // Today's workout goal at today's body mass, as the Physical Activity tile
  // reads it (health-math.js). Only on today's form.
  if (physiqueField('date').value === isoFromDate(new Date())) {
    const desireMin = Math.round(getActivityDesiredMin(bodyMassKg));
    const desireKcal = Math.round(getActivityDesiredKcal(bodyMassKg));
    appendTableRow(tbody, 'calc-breakdown-desired', [
      makeCell('Desire', 'Workout duration/burn goal — from Tune and Settings, not today\'s Workout'),
      makeCell(''),
      makeCell(''),
      makeCell(String(desireMin)),
      makeCell(String(desireKcal)),
      makeCell(''),
    ]);
  }

  document.getElementById('physique-activity-breakdown').hidden = document.getElementById('physique-is-pattern').checked;
}

// Last column, as Consumption's sourceCell: ✅ on the Activity sheet; AI for an
// AI-priced exercise, with 💾 and ✏️; Default for EXERCISE_MET_FALLBACK.
function activitySourceCell(line) {
  const cell = document.createElement('td');
  const label = document.createElement('span');
  if (line.source === 'table') {
    label.textContent = '✅';
    label.title = 'In your Activity sheet';
  } else if (line.source === 'ai') {
    label.textContent = 'AI';
    label.title = 'Not in your Activity sheet yet — MET estimated by AI';
  } else {
    label.textContent = 'Default';
    label.title = `Not in your Activity sheet — priced at the default MET (${EXERCISE_MET_FALLBACK}); 🧮 Calculate asks AI for it`;
  }
  cell.appendChild(label);
  if (line.source === 'ai') {
    cell.append(' ', makeSaveActivityGuessButton(line.guess), ' ', makeEditActivityGuessButton(line.guess));
  }
  return cell;
}

// The guess as an Activity sheet row, in readActivityFormFields' column order.
function activityGuessRowValues(guess) {
  return [
    guess.category || 'Other',
    guess.group || 'Other',
    guess.name,
    guess.unit,
    [guess.amount, guess.rest].filter(Boolean).join(', '),
    '',
    guess.met,
    guess.muscleGroup,
    '',
    '',
  ];
}

// After the Activity sheet gains a row, the open day reprices from it, so the
// row's AI turns to ✅.
async function reloadActivitiesIntoPhysique(name) {
  forgetActivityGuess(name);
  await initActivities(true);
  if (!document.getElementById('physique-modal').hidden) runPhysiqueWorkoutCalc(false);
}

function makeSaveActivityGuessButton(guess) {
  return makeRowActionButton({
    emoji: '💾',
    title: `Not in your Activity sheet yet — save "${guess.name}" (MET ${guess.met}, ${guess.category || 'Other'} · ${guess.group || 'Other'}) so it's a trusted lookup next time instead of a fresh guess`,
    onClick: async () => {
      try {
        if (!activityByName(guess.name)) await appendValues(ACTIVITIES_RANGE, [activityGuessRowValues(guess)], 'RAW');
        await reloadActivitiesIntoPhysique(guess.name);
      } catch (err) {
        showFieldError('physique-form-error', err.message);
      }
    },
  });
}

// Opens the Activity Plan's Add form, filled with the guess, under the
// activity's own address; its Save reprices the day (submitActivityForm).
function makeEditActivityGuessButton(guess) {
  return makeRowActionButton({
    emoji: '✏️',
    title: `Not quite right? Fix "${guess.name}" before saving — Save adds it to your Activity sheet and reprices this line`,
    onClick: () => {
      routeRecordEdit('activity', { slug: routeSlug(guess.name), label: guess.name });
      openActivityForm(null);
      const [category, group, name, unit] = activityGuessRowValues(guess);
      setActivityField('category', category);
      setActivityField('group', group);
      setActivityField('name', name);
      setActivityField('unit', unit);
      setActivityField('amount', guess.amount);
      setActivityField('rest', guess.rest);
      setActivityField('met', guess.met);
      setActivityField('muscle-group', guess.muscleGroup);
    },
  });
}

// One decimal: a strength line is often under a minute.
function activityLineMinutes(seconds) {
  return String(Math.round(seconds / 6) / 10);
}

// Reprices the Workout when the form opens, so the table shows what Save will
// write. Warnings are dropped; Calculate is what shows them.
function refreshPhysiqueActivityBreakdown() {
  runPhysiqueWorkoutCalc(false);
}

function hidePhysiqueActivityBreakdown() {
  document.getElementById('physique-activity-breakdown').hidden = true;
  document.getElementById('physique-activity-breakdown-body').innerHTML = '';
}

// Re-estimates only the Consumption lines that changed: a line matching a saved
// item's noteLine reuses its numbers, so editing one ingredient costs one lookup.
async function estimateConsumptionIncrementally(consumption, savedBreakdownRaw) {
  const lines = consumption.split('\n').map((line) => line.trim()).filter(Boolean);

  // Each saved item backs at most one line, so a repeated line isn't double-counted.
  const pool = new Map();
  parsePhysiqueBreakdown(savedBreakdownRaw).forEach((item) => {
    if (!item.noteLine) return;
    if (!pool.has(item.noteLine)) pool.set(item.noteLine, []);
    pool.get(item.noteLine).push(item);
  });

  const reused = [];
  const staleLines = [];
  // An estimate whose food has since been saved to Nutrition is re-priced from it.
  const nowInNutrition = (item) =>
    !NUTRITION_TABLE_SOURCE_LABELS.includes(item.source) && findNutritionEntry(item.name);
  lines.forEach((line) => {
    const matches = pool.get(line);
    if (matches && matches.length && !nowInNutrition(matches[0])) reused.push(matches.shift());
    else staleLines.push(line);
  });

  const fresh = staleLines.length
    ? await estimateCaloriesAndProtein(staleLines.join('\n'), { autoBank: false })
    : { calories: 0, protein: 0, breakdown: [], usdaUnreachable: false };

  // Nothing reused: pass the full run's own totals through. A mixed run re-sums
  // the already-rounded items.
  if (!reused.length) {
    return { ...fresh, reusedCount: 0, estimatedCount: fresh.breakdown.length };
  }

  const breakdown = [...reused, ...fresh.breakdown].sort((a, b) => b.calories - a.calories);
  const { calories, protein } = breakdownTotals(breakdown);
  return {
    calories,
    protein,
    breakdown,
    usdaUnreachable: fresh.usdaUnreachable,
    reusedCount: reused.length,
    estimatedCount: fresh.breakdown.length,
  };
}

// The quantity field each parsed workout line type sums.
const WORKOUT_QUANTITY_FIELD = { reps: 'reps', duration: 'minutes', steps: 'steps', hold: 'seconds' };

// Workout's combineAndSortConsumptionText: lines for the same exercise and
// quantity type sum ("30x" and "10min" of one exercise don't). An unparsed line
// passes through as typed.
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
    const field = WORKOUT_QUANTITY_FIELD[parsed.type];
    existing.parsed[field] += parsed[field];
  });
  const combinedCount = rawLines.length - groups.size;

  const rebuilt = [...groups.values()].map((g) => (g.parsed ? `${workoutNoteQuantityForLine(g.parsed)} ${g.parsed.name}` : g.raw));
  return { text: rebuilt.join('\n'), combinedCount };
}

// Prices the Workout into the hidden Activity Duration/Calories Out fields and
// the table, returning warnings for the caller to show. A Workout that can't be
// priced writes nothing. reorderWorkoutField (an explicit Calculate only) also
// rewrites the box combined and sorted; opening a day never touches its text.
function runPhysiqueWorkoutCalc(reorderWorkoutField) {
  const messages = [];
  const workout = physiqueField('workout').value.trim();
  if (!workout) {
    // No table (and no 0 Total against the Desire) until there's a workout.
    hidePhysiqueActivityBreakdown();
    return messages;
  }

  // Without the catalogue every line would price at the default MET, and Save
  // would write that flattened burn.
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
    // Highest burn first, as Consumption sorts by calories.
    const sortedPerLine = [...perLine].sort((a, b) => b.calories - a.calories);
    if (reorderWorkoutField) {
      // Rebuilt in the token shape parsing expects, names title-cased.
      physiqueField('workout').value = sortedPerLine.map((line) => `${line.quantity} ${titleCaseIngredientName(line.name)}`).join('\n');
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

// Mass units only: volume units need the food's density, i.e. a USDA/AI lookup.
const PHYSIQUE_MASS_UNIT_TO_GRAMS = { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592 };

// A line's calories from the Nutrition table alone (by count or by mass), or
// null (not 0) when it can't be priced locally.
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

// A Consumption line rebuilt as "<quantity><canonical unit> <name>".
function consumptionLineText(quantity, unit, name) {
  const unitText = unit ? (UNIT_CANONICAL[unit] || unit) : '';
  return `${Math.round(quantity * 100) / 100}${unitText} ${name}`.trim();
}

// Tidies a Consumption block: lines with the same name AND unit combine (no unit
// conversion), names are title-cased, and lines sort by calories, highest first.
// A line with no quantity stays as typed. caloriesForName supplies the ranking
// (Calculate passes the breakdown's, so the field sorts like the table);
// localIngredientCalories covers any name it doesn't.
function combineAndSortConsumptionText(text, caloriesForName = null) {
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

  const rebuilt = [...groups.values()].map((g) => (
    g.quantity === null ? g.raw : consumptionLineText(g.quantity, g.unit, titleCaseIngredientName(g.name))
  ));

  const scored = rebuilt.map((line) => {
    const { quantity, unit } = extractIngredientQuantity(line);
    const name = extractIngredientName(line);
    const supplied = caloriesForName ? caloriesForName(name) : null;
    return { line, calories: supplied ?? localIngredientCalories(quantity, unit, name) };
  });
  // Unranked lines go last, in their own order (the sort is stable).
  scored.sort((a, b) => (b.calories ?? -Infinity) - (a.calories ?? -Infinity));

  return { text: scored.map((s) => s.line).join('\n'), combinedCount };
}

// Name -> calories over a breakdown, duplicates summed and case ignored, as the
// table merges them; null for a name not in it.
function breakdownCaloriesLookup(breakdown) {
  const byName = new Map();
  breakdown.forEach((item) => {
    const key = item.name.toLowerCase();
    byName.set(key, (byName.get(key) || 0) + (item.calories || 0));
  });
  return (name) => (byName.has(name.toLowerCase()) ? byName.get(name.toLowerCase()) : null);
}

// Per-line name suggestions for the Consumption and Workout textareas: a
// <datalist> only completes a whole <input>, and each line here is its own entry.
const SUGGESTION_LIMIT = 8;
// Lets a mousedown on a suggestion land before blur hides the list.
const SUGGESTION_BLUR_DELAY_MS = 150;

function isPhoneSuggestionViewport() {
  return window.matchMedia('(max-width: 820px)').matches;
}

function unpinSuggestions(list) {
  list.classList.remove('autocomplete-suggestions--pinned');
  list.style.removeProperty('--suggestions-top');
  list.style.removeProperty('--suggestions-max-height');
}

// On a phone the list sits above the caret's line (below when there's more room),
// clear of that line and the keyboard; desktop keeps the plain dropdown.
function positionPinnedSuggestions(list, field) {
  if (list.hidden) return;
  if (!isPhoneSuggestionViewport() || !window.visualViewport) {
    unpinSuggestions(list);
    return;
  }
  const vv = window.visualViewport;
  const style = getComputedStyle(field);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const line = field.value.slice(0, field.selectionStart).split('\n').length - 1;
  // Fixed positions, rects and vv.offsetTop are all in layout-viewport coordinates.
  const lineTop = field.getBoundingClientRect().top + field.clientTop
    + parseFloat(style.paddingTop) + line * lineHeight - field.scrollTop;
  const above = lineTop - vv.offsetTop;
  const below = vv.offsetTop + vv.height - (lineTop + lineHeight);
  const wanted = list.scrollHeight;
  const useAbove = above >= wanted || above >= below;
  const height = Math.max(0, Math.min(wanted, useAbove ? above : below));
  list.classList.add('autocomplete-suggestions--pinned');
  list.style.setProperty('--suggestions-top', `${useAbove ? lineTop - height : lineTop + lineHeight}px`);
  list.style.setProperty('--suggestions-max-height', `${height}px`);
}

// The caret line's start and its text up to the caret.
function caretLinePrefix(field) {
  const before = field.value.slice(0, field.selectionStart);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { lineStart, prefix: before.slice(lineStart) };
}

// Prefix matches before substring ones, as a browser's datalist ranks them.
// An exact match is already typed, so it isn't offered.
function rankSuggestionNames(names, query) {
  const starts = [];
  const contains = [];
  names.forEach((name) => {
    const lower = name.toLowerCase();
    if (!name || lower === query) return;
    if (lower.startsWith(query)) starts.push(name);
    else if (lower.includes(query)) contains.push(name);
  });
  return [...starts, ...contains];
}

// One textarea's dropdown. currentLine() gives the caret line's {nameStart,
// query}; suggest(query) the names to offer. Accepting replaces only the name.
function createLineAutocomplete({ fieldId, listId, currentLine, suggest }) {
  let matches = [];
  let activeIndex = -1;
  const field = () => physiqueField(fieldId);
  const list = () => document.getElementById(listId);
  const position = () => positionPinnedSuggestions(list(), field());

  function hide() {
    const el = list();
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
    unpinSuggestions(el);
    matches = [];
    activeIndex = -1;
  }

  function render() {
    const { query } = currentLine();
    if (!query) { hide(); return; }
    matches = suggest(query);
    if (!matches.length) { hide(); return; }
    const el = list();
    el.innerHTML = '';
    matches.forEach((name) => {
      const li = document.createElement('li');
      li.textContent = name;
      li.dataset.name = name;
      el.appendChild(li);
    });
    activeIndex = -1;
    el.hidden = false;
    position();
  }

  function apply(name) {
    const input = field();
    const { nameStart } = currentLine();
    const before = input.value.slice(0, nameStart);
    const after = input.value.slice(input.selectionEnd);
    input.value = `${before}${name}${after}`;
    const caret = before.length + name.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    hide();
  }

  function onKey(e) {
    const el = list();
    if (el.hidden || !matches.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const count = matches.length;
      activeIndex = e.key === 'ArrowDown'
        ? (activeIndex + 1) % count
        : (activeIndex - 1 + count) % count;
      [...el.children].forEach((li, i) => li.classList.toggle('active', i === activeIndex));
      el.children[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Only an arrow-picked suggestion; otherwise the key acts as usual.
      if (activeIndex < 0) { hide(); return; }
      e.preventDefault();
      apply(matches[activeIndex]);
    } else if (e.key === 'Escape') {
      hide();
    }
  }

  function setup() {
    const input = field();
    input.addEventListener('input', render);
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', () => setTimeout(hide, SUGGESTION_BLUR_DELAY_MS));
    list().addEventListener('mousedown', (e) => {
      const item = e.target.closest('li');
      if (!item) return;
      e.preventDefault(); // keeps focus (and the caret) on the textarea
      apply(item.dataset.name);
    });
    // A phone keyboard resizes the visual viewport, so the list tracks it live.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', position);
      window.visualViewport.addEventListener('scroll', position);
    }
  }

  return { setup, hide };
}

// Consumption offers Nutrition names, matched on what follows the line's quantity.
const consumptionAutocomplete = createLineAutocomplete({
  fieldId: 'consumption',
  listId: 'physique-consumption-suggestions',
  currentLine: () => {
    const { lineStart, prefix } = caretLinePrefix(physiqueField('consumption'));
    return {
      nameStart: lineStart + (prefix.length - stripLeadingIngredientTokens(prefix).rest.length),
      query: extractIngredientName(prefix).toLowerCase(),
    };
  },
  suggest: (query) => rankSuggestionNames(allNutritionEntries.map((n) => n.name), query).slice(0, SUGGESTION_LIMIT),
});

// Workout offers Activity sheet names, after the line's amount ("36x ", "3x10 ",
// "30min ", "10000step ", "45sec ").
const WORKOUT_LINE_AMOUNT_PATTERN = /^\s*\d+(?:[x×]\d+)?(?:[x×]|min|step|sec)?\s+/i;
const workoutAutocomplete = createLineAutocomplete({
  fieldId: 'workout',
  listId: 'physique-workout-suggestions',
  currentLine: () => {
    const { lineStart, prefix } = caretLinePrefix(physiqueField('workout'));
    const amount = prefix.match(WORKOUT_LINE_AMOUNT_PATTERN)?.[0] ?? '';
    return { nameStart: lineStart + amount.length, query: prefix.slice(amount.length).trim().toLowerCase() };
  },
  // A name can repeat on the sheet; it is offered once.
  suggest: (query) => [...new Set(rankSuggestionNames(allActivities.map((a) => String(a.name || '').trim()), query))]
    .slice(0, SUGGESTION_LIMIT),
});

function setupConsumptionAutocomplete() {
  consumptionAutocomplete.setup();
}

function hideConsumptionSuggestions() {
  consumptionAutocomplete.hide();
}

function setupWorkoutAutocomplete() {
  workoutAutocomplete.setup();
}

function hideWorkoutSuggestions() {
  workoutAutocomplete.hide();
}

// The form's 🧬, for a day already saved: it reads the saved log, not the form.
function openPhysiqueMicronutrientsFromForm() {
  const entry = allPhysiqueEntries.find((p) => p.row === editingPhysiqueRow);
  if (!entry) {
    showFieldError('physique-form-error', 'Save this day first — Micronutrients reads the saved log.');
    return;
  }
  openPhysiqueMicronutrients(entry, true);
}

async function handlePhysiqueScanInput(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  const btn = document.getElementById('physique-scan-btn');
  btn.disabled = true;
  Motion.iconBusy(btn);

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const ingredientText = await aiAnalyzeFoodImage(base64, file.type);

    // Appends to the open form's Consumption rather than replacing it.
    const consumptionField = physiqueField('consumption');
    consumptionField.value = consumptionField.value.trim()
      ? `${consumptionField.value.trim()}\n${ingredientText}`
      : ingredientText;
    await calculatePhysiqueDay();
  } catch (err) {
    console.error('[Scan Food]', err);
    showFieldError('physique-form-error', `Scan failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    Motion.iconSettle(btn);
  }
}

// "(<lines>)/<n>" or "(<lines>)*<n>" (× or x too): a shared portion or several
// servings. "(" opens a line and ")<op><n>" ends one, so groups can sit among
// plain lines.
const CONSUMPTION_SCALE_GROUP_RE = /^\(([\s\S]*?)\)[ \t]*([/*×x])[ \t]*([\d.]+)[ \t]*$/gm;

// Each grouped line with its quantity scaled; a line with no quantity stays as
// typed. Null when the field has no group, so Calculate leaves it alone.
function applyConsumptionScaling(text) {
  let found = false;
  const scaled = text.replace(CONSUMPTION_SCALE_GROUP_RE, (group, lines, op, n) => {
    const by = parseFloat(n);
    if (!by) return group;
    found = true;
    const factor = op === '/' ? 1 / by : by;
    return lines.split('\n').map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return trimmed;

      const { quantity, unit } = extractIngredientQuantity(trimmed);
      if (quantity === null) return trimmed;
      return consumptionLineText(quantity * factor, unit, extractIngredientName(trimmed));
    }).filter(Boolean).join('\n');
  });
  return found ? scaled : null;
}

// Both estimators: Consumption fills Breakdown/Calories In/Protein In, Workout
// fills Activity Duration/Calories Out. An empty side is skipped, and neither
// side's failure stops the other.
async function calculatePhysiqueDay() {
  const scaled = applyConsumptionScaling(physiqueField('consumption').value);
  if (scaled !== null) {
    physiqueField('consumption').value = scaled;
  }

  const consumption = physiqueField('consumption').value.trim();
  const workout = physiqueField('workout').value.trim();
  const btn = document.getElementById('physique-calc-btn');

  if (!consumption && !workout) {
    showFieldError('physique-form-error', 'Fill in Consumption, Workout, or both first.');
    return;
  }

  btn.disabled = true;
  Motion.iconBusy(btn);
  clearFieldError('physique-form-error');

  // New exercise names go to the AI first, so the pass below prices them.
  const workoutAiMessages = (workout && activitiesDataLoaded) ? await guessUnknownActivities(workout) : [];
  const messages = [...workoutAiMessages, ...runPhysiqueWorkoutCalc(true)];

  if (consumption) {
    try {
      const { calories, protein, breakdown, usdaUnreachable, reusedCount, estimatedCount } =
        await estimateConsumptionIncrementally(consumption, physiqueField('breakdown').value);

      // Title-cased like the Consumption lines below; noteLine too, so the next
      // Calculate's reuse still matches.
      breakdown.forEach((item) => {
        const titleCased = titleCaseIngredientName(item.name);
        if (titleCased === item.name) return;
        if (item.noteLine) item.noteLine = item.noteLine.replace(item.name, titleCased);
        item.name = titleCased;
      });

      // Rebuilt from the whole breakdown (the fresh run's notes cover only the
      // re-estimated lines), then combined, sorted and capitalised.
      const rebuiltConsumption = breakdown.map((i) => i.noteLine || `${i.amount} ${i.name}`).join('\n');
      const { text: sortedConsumption, combinedCount } =
        combineAndSortConsumptionText(rebuiltConsumption, breakdownCaloriesLookup(breakdown));
      physiqueField('consumption').value = sortedConsumption;
      if (combinedCount > 0) messages.push(`🔗 ${combinedCount} combined.`);
      // Annotates the rows with fiber/fat/carbohydrate/TEF before the table draws.
      syncPhysiqueTotalsFromBreakdown(breakdown, calories, protein);
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

  updatePhysiqueSleepDuration();

  btn.disabled = false;
  Motion.iconSettle(btn);

  if (messages.length) showToast(messages.join(' '));
}
