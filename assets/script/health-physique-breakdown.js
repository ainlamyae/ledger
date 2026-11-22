// A text's trimmed, non-empty lines.
function nonEmptyLines(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

// A corrupt cell reads as no breakdown rather than failing the form.
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
  ['fiber', 'fat', 'carbohydrate'].forEach((key) => {
    if (dayMacros[key] !== null) physiqueField(key).value = dayMacros[key];
  });
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

  document.getElementById('physique-activity-breakdown').hidden = physiquePatternMode;
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

// `item` at `amount`, its figures `from`'s times `scale` (`macroKeys` maps from's keys to the row's).
function scaledBreakdownRow(item, amount, from, scale, macroKeys) {
  const row = { ...item, amount, calories: Math.round(from.calories * scale), protein: roundPlaces(from.protein * scale, 1) };
  Object.entries(macroKeys).forEach(([fromKey, rowKey]) => {
    delete row[rowKey];
    if (from[fromKey] !== null && from[fromKey] !== undefined) row[rowKey] = roundPlaces(from[fromKey] * scale, 2);
  });
  return row;
}

const SAME_KEYS = Object.fromEntries(OPTIONAL_TOTAL_KEYS.map((key) => [key, key]));

// Consumption is the reference: a saved row takes the line's grams. A Nutrition
// row is repriced from the sheet as it is now; any other row is rescaled.
function matchBreakdownToLine(item, line) {
  const { anchors } = stripLeadingIngredientTokens(line);
  if (Object.keys(anchors).length) return matchAnchoredRow(item, anchors);

  const grams = consumptionLineGrams(line);
  const amount = grams !== null ? `${roundPlaces(grams, 1)}g` : item.amount;

  const entry = NUTRITION_TABLE_SOURCE_LABELS.includes(item.source) && findNutritionEntry(item.name);
  if (entry) {
    const parsed = parseBreakdownAmount(amount);
    const scale = micronutrientScaleFactor(entry, { grams: parsed.grams || 0, count: parsed.count || 0 });
    if (scale > 0) return scaledBreakdownRow(item, amount, entry, scale, BREAKDOWN_MACRO_KEY);
  }

  const savedGrams = parseBreakdownAmount(item.amount).grams;
  if (grams === null || !savedGrams || Math.abs(grams - savedGrams) < 0.05) return item;
  return scaledBreakdownRow(item, amount, item, grams / savedGrams, SAME_KEYS);
}

// Typed anchors are the reference: their numbers stand, and a Nutrition row by weight
// re-derives the grams (and other macros) at its current density.
function matchAnchoredRow(item, anchors) {
  const entry = NUTRITION_TABLE_SOURCE_LABELS.includes(item.source) && findNutritionEntry(item.name);
  const tableGrams = entry ? parseGramsFromAmount(entry.amount) : null;
  let ref = null;
  if (anchors.kcal !== undefined && entry?.calories > 0) ref = anchors.kcal / entry.calories;
  else if (anchors.protein !== undefined && entry?.protein > 0) ref = anchors.protein / entry.protein;
  if (ref === null || !tableGrams) return item;

  const row = scaledBreakdownRow(item, `${roundPlaces(ref * tableGrams, 1)}g`, entry, ref, BREAKDOWN_MACRO_KEY);
  if (anchors.kcal !== undefined) row.calories = Math.round(anchors.kcal);
  if (anchors.protein !== undefined) row.protein = roundPlaces(anchors.protein, 1);
  Object.entries(BREAKDOWN_MACRO_KEY).forEach(([field, key]) => {
    if (anchors[field] !== undefined) row[key] = roundPlaces(anchors[field], 2);
  });
  return row;
}

// Re-estimates only the Consumption lines that changed: a line matching a saved
// item's noteLine reuses its numbers, so editing one ingredient costs one lookup.
async function estimateConsumptionIncrementally(consumption, savedBreakdownRaw) {
  const lines = nonEmptyLines(consumption);

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
    if (matches && matches.length && !nowInNutrition(matches[0])) reused.push(matchBreakdownToLine(matches.shift(), line));
    else staleLines.push(line);
  });

  const fresh = staleLines.length
    ? await estimateCaloriesAndProtein(staleLines.join('\n'), { autoBank: false })
    : { calories: 0, protein: 0, breakdown: [], usdaUnreachable: false };

  // Always the rows' own sum: a fresh run's unrounded total would shift by 1 once its rows are reused.
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

// Same exercise and quantity type sum ("30x" and "10min" don't); unparsed lines stay.
function combineWorkoutText(text) {
  const rawLines = nonEmptyLines(text);
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
    // Rounded: decimal minutes would add to "0.30000000000000004min".
    existing.parsed[field] = roundPlaces(existing.parsed[field] + parsed[field], 2);
  });
  const combinedCount = rawLines.length - groups.size;

  const rebuilt = [...groups.values()].map((g) => (g.parsed ? `${workoutNoteQuantityForLine(g.parsed)} ${g.parsed.name}` : g.raw));
  return { text: rebuilt.join('\n'), combinedCount };
}

// The Workout rewritten as priced lines ("30x Push Up"), then any unread line as typed.
function rebuiltWorkoutText(sortedPerLine, typedWorkout) {
  const priced = sortedPerLine.map((line) => `${line.quantity} ${titleCaseIngredientName(line.name)}`);
  return [...priced, ...unparsedWorkoutLines(typedWorkout)].join('\n');
}

// Prices the Workout into Activity Duration/Calories Out and the table; returns
// warnings. reorderWorkoutField (Calculate only) also combines and sorts the text.
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
      physiqueField('workout').value = rebuiltWorkoutText(sortedPerLine, workout);
      if (combinedCount > 0) messages.push(`🔗 ${combinedCount} workout lines combined.`);
    }
    const unread = unparsedWorkoutLines(workout);
    if (unread.length) messages.push(`⚠️ Not read, not counted: ${unread.map((l) => `"${l}"`).join(', ')}.`);
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

// Most kcal one rounding step of a split quantity may hide.
const CONSUMPTION_ROUNDING_KCAL = 2;

// Decimals a split quantity keeps: 0 for light foods (1g onion), more for dense
// ones (1.5g oil); 1 when the Nutrition table can't price it.
function consumptionQuantityPlaces(unit, name) {
  const kcalPerUnit = localIngredientCalories(1, unit, name);
  if (kcalPerUnit === null) return 1;
  let places = 0;
  while (places < 2 && kcalPerUnit / 10 ** places > CONSUMPTION_ROUNDING_KCAL) places++;
  return places;
}

// Never rounds a split down to 0 (0.33g onion stays 0.3g, not 0g).
function roundConsumptionQuantity(quantity, unit, name) {
  let places = consumptionQuantityPlaces(unit, name);
  while (places < 2 && quantity > 0 && roundPlaces(quantity, places) === 0) places++;
  return roundPlaces(quantity, places);
}

// A Consumption line rebuilt as "<quantity><canonical unit> <name>".
function consumptionLineText(quantity, unit, name) {
  const unitText = unit ? (UNIT_CANONICAL[unit] || unit) : '';
  return `${roundConsumptionQuantity(quantity, unit, name)}${unitText} ${name}`.trim();
}

// Same name and unit combine, names title-case, lines sort by calories (from
// caloriesForName, else the Nutrition table). Unquantified lines stay as typed.
function combineAndSortConsumptionText(text, caloriesForName = null) {
  const lines = nonEmptyLines(text);
  if (!lines.length) return { text, combinedCount: 0 };

  const groups = new Map();
  let unmergeable = 0;
  lines.forEach((line) => {
    const { quantity, unit } = extractIngredientQuantity(line);
    const name = extractIngredientName(line);
    const key = quantity === null ? `unmergeable-${unmergeable++}` : `${name.toLowerCase()}|${unit || ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.merged = true;
    } else groups.set(key, { quantity, unit, name, raw: line });
  });
  const combinedCount = lines.length - groups.size;

  // An uncombined line stays as is, so it still matches its row's noteLine next pass.
  const rebuilt = [...groups.values()].map((g) => (
    g.merged ? consumptionLineText(g.quantity, g.unit, titleCaseIngredientName(g.name)) : g.raw
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
  return (name) => byName.get(name.toLowerCase()) ?? null;
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

// Cap on Calculate's passes, in case a line never settles.
const PHYSIQUE_CALC_MAX_PASSES = 5;

// Calculate's Consumption side, shared by the form and Bulk Calculate; no DOM.
// Repeats until the tidied text stops changing, so one run applies every change.
async function settleConsumption(consumption, savedBreakdownRaw) {
  let text = (applyConsumptionScaling(consumption) ?? consumption).trim();
  let breakdownRaw = savedBreakdownRaw;
  let combinedCount = 0;
  let estimatedCount = 0;
  let usdaUnreachable = false;
  let reusedCount = 0;
  let result;
  for (let i = 0; i < PHYSIQUE_CALC_MAX_PASSES; i++) {
    let pass;
    try {
      pass = await estimateConsumptionIncrementally(text, breakdownRaw);
    } catch (err) {
      // A later pass failing keeps the earlier pass's result.
      if (!result) throw err;
      break;
    }
    result = pass;
    // Only the first pass counts: later passes re-price lines Calculate itself combined.
    if (i === 0) {
      reusedCount = result.reusedCount;
      estimatedCount = result.estimatedCount;
    }
    usdaUnreachable = usdaUnreachable || result.usdaUnreachable;

    // Title-cased, noteLine too, so the next pass's reuse still matches.
    result.breakdown.forEach((item) => {
      const titleCased = titleCaseIngredientName(item.name);
      if (titleCased === item.name) return;
      if (item.noteLine) item.noteLine = item.noteLine.replace(item.name, titleCased);
      item.name = titleCased;
    });

    // Rebuilt from the whole breakdown, then combined and sorted.
    const rebuilt = result.breakdown.map((item) => item.noteLine || `${item.amount} ${item.name}`).join('\n');
    const tidied = combineAndSortConsumptionText(rebuilt, breakdownCaloriesLookup(result.breakdown));
    combinedCount += tidied.combinedCount;
    // Combined lines keep their priced rows, summed, so the next pass reuses them.
    breakdownRaw = breakdownToJson(mergeCombinedBreakdownRows(result.breakdown, tidied.text));
    const settled = tidied.text.trim() === text;
    text = tidied.text.trim();
    if (settled) break;
  }
  return { ...result, text, combinedCount, estimatedCount, reusedCount, usdaUnreachable };
}

// combineAndSortConsumptionText's grouping key, or null for an unquantified line.
function consumptionLineKey(line) {
  const { quantity, unit } = extractIngredientQuantity(line);
  return quantity === null ? null : `${extractIngredientName(line).toLowerCase()}|${unit || ''}`;
}

// Rows summed into one, backing `line`.
function sumBreakdownRows(rows, line) {
  const amounts = rows.map((row) => parseBreakdownAmount(row.amount));
  const sum = (key) => amounts.reduce((total, a) => total + (a[key] || 0), 0);
  let amount = rows[0].amount;
  if (amounts.every((a) => a.grams !== null)) amount = `${roundPlaces(sum('grams'), 1)}g`;
  else if (amounts.every((a) => a.count !== null)) amount = `×${roundPlaces(sum('count'), 2)}`;
  const merged = {
    ...rows[0],
    amount,
    calories: rows.reduce((total, row) => total + (row.calories || 0), 0),
    protein: roundPlaces(rows.reduce((total, row) => total + (row.protein || 0), 0), 1),
    source: [...new Set(rows.map((row) => row.source))].join(' + '),
    noteLine: line,
    newRow: rows.find((row) => row.newRow)?.newRow || null,
  };
  OPTIONAL_TOTAL_KEYS.forEach((key) => {
    const value = rows.reduce((total, row) => sumOptional(total, row[key]), undefined);
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  });
  return merged;
}

// The breakdown lined up with the tidied text: a line Calculate combined gets its
// source rows summed instead of a fresh lookup.
function mergeCombinedBreakdownRows(breakdown, text) {
  const lines = nonEmptyLines(text);
  const kept = breakdown.filter((item) => lines.includes(item.noteLine));
  const groups = new Map();
  breakdown.filter((item) => !kept.includes(item)).forEach((item) => {
    const key = item.noteLine ? consumptionLineKey(item.noteLine) : null;
    if (key === null) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const merged = [];
  lines.forEach((line) => {
    if (kept.some((item) => item.noteLine === line)) return;
    const rows = groups.get(consumptionLineKey(line));
    if (rows?.length) merged.push(sumBreakdownRows(rows, line));
  });
  return [...kept, ...merged];
}

// Consumption emptied: the Breakdown and the totals it wrote go too. Typed totals
// with no Breakdown behind them stay. True when anything was cleared.
function clearConsumptionDerivedFields() {
  if (!physiqueField('breakdown').value) return false;
  ['breakdown', 'calories-in', 'protein-in', 'fiber', 'fat', 'carbohydrate', 'tef'].forEach((id) => {
    physiqueField(id).value = '';
  });
  hideCalcBreakdown('physique');
  return true;
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

  const cleared = !consumption && clearConsumptionDerivedFields();
  if (!consumption && !workout) {
    if (cleared) updatePhysiqueSleepDuration();
    else showFieldError('physique-form-error', 'Fill in Consumption, Workout, or both first.');
    return;
  }

  btn.disabled = true;
  Motion.iconBusy(btn);
  clearFieldError('physique-form-error');
  const messages = [];
  try {
    await calculatePhysiqueSides(consumption, workout, messages);
  } finally {
    btn.disabled = false;
    Motion.iconSettle(btn);
  }
  if (messages.length) showToast(orderCalcMessages(messages).join(' '));
}

// Warnings first, then the rest, then ♻️ reused last.
function orderCalcMessages(messages) {
  const rank = (m) => (m.startsWith('⚠️') ? 0 : m.startsWith('♻️') ? 2 : 1);
  return [...messages].sort((a, b) => rank(a) - rank(b));
}

// calculatePhysiqueDay's work, pushing its warnings onto `messages`.
async function calculatePhysiqueSides(consumption, workout, messages) {
  // New exercise names go to the AI first, so the pass below prices them.
  const workoutAiMessages = (workout && activitiesDataLoaded) ? await guessUnknownActivities(workout) : [];
  messages.push(...workoutAiMessages, ...runPhysiqueWorkoutCalc(true));

  if (consumption) {
    try {
      const settled = await settleConsumption(consumption, physiqueField('breakdown').value);
      const { breakdown, calories, protein } = settled;
      physiqueField('consumption').value = settled.text;
      // Adds fiber/fat/carb/TEF, then writes the Breakdown JSON and table.
      syncPhysiqueTotalsFromBreakdown(breakdown, calories, protein);
      renderPhysiqueBreakdown(breakdown, calories, protein);

      if (settled.combinedCount > 0) messages.push(`🔗 ${settled.combinedCount} combined.`);
      // "M new" sits with the regular messages; "♻️ N reused" comes last.
      if (settled.reusedCount) {
        if (settled.estimatedCount) messages.push(`${settled.estimatedCount} new.`);
        messages.push(`♻️ ${settled.reusedCount} reused.`);
      }
      if (settled.usdaUnreachable) messages.push('⚠️ No DB — AI only.');
      if (calories > PHYSIQUE_DAY_CALORIE_CEILING) messages.push(`⚠️ ${calories} kcal, check.`);
    } catch (err) {
      messages.push(`⚠️ Consumption: ${err.message}`);
    }
  }

  updatePhysiqueSleepDuration();
}
