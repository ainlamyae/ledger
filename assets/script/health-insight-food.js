// The Health Insight panel's Food mode: every ingredient logged (Physique's
// 🧮 Calculate breakdown) over the range, totalled per ingredient, for the model
// to infer nutrient gaps from its own food knowledge. The Micronutrient mode
// (health-insight-micronutrient.js) is the one built on measured totals.

// The Breakdown's own per-item macros, summed where present.
const FOOD_MACROS = ['fiber', 'fat', 'carbohydrate', 'tef'];

// Sums each breakdown item across the window's Calories; Protein entries, keyed
// by lowercase-trimmed name. Exact match on purpose: "egg"/"eggs" as two lines is
// harmless here. `breakdowns`: sum these instead of the window (a dateless Pattern's own).
function aggregateFoodIntake(from, to, breakdowns = null) {
  const byName = new Map();

  (breakdowns ? breakdowns.map((breakdown) => ({ breakdown })) : physiqueAsHealthEntries()
    .filter((e) => e.category === 'Calories; Protein' && e.date >= from && e.date <= to))
    .forEach((e) => {
      (e.breakdown || []).forEach((item) => {
        const key = String(item.name || '').trim().toLowerCase();
        if (!key) return;
        if (!byName.has(key)) {
          byName.set(key, { name: item.name.trim(), calories: 0, protein: 0, grams: 0, count: 0, breakdownMacros: {} });
        }
        const agg = byName.get(key);
        agg.calories += item.calories || 0;
        agg.protein += item.protein || 0;
        // The stand-in for a food with no Nutrition row, or a macro its row lacks.
        FOOD_MACROS.forEach((macro) => {
          const value = Number(item[macro]);
          if (item[macro] !== undefined && item[macro] !== null && Number.isFinite(value)) {
            agg.breakdownMacros[macro] = (agg.breakdownMacros[macro] || 0) + value;
          }
        });
        const { grams, count } = parseBreakdownAmount(item.amount);
        if (grams !== null) agg.grams += grams;
        if (count !== null) agg.count += count;
      });
    });

  // Highest-calorie ingredient first, like the Physique breakdown table.
  return [...byName.values()]
    .map((agg) => {
      let grams = agg.grams;
      let count = agg.count;
      if (count > 0) {
        const converted = convertCountToGrams(agg.name, count);
        if (converted !== null) {
          grams += converted;
          count = 0;
        }
      }
      return {
        name: agg.name,
        // The matching Nutrition row's Group; blank lands in Unclassified.
        group: findNutritionEntry(agg.name)?.group || '',
        calories: Math.round(agg.calories),
        protein: Math.round(agg.protein * 10) / 10,
        amountLabel: formatAggregatedAmount(grams, count),
        // Raw totals too: the Micronutrient mode scales by them.
        grams,
        count,
        breakdownMacros: agg.breakdownMacros,
      };
    })
    .sort((a, b) => b.calories - a.calories);
}

const FOOD_UNCLASSIFIED_LABEL = 'Unclassified';

// The rows bucketed by Group with per-group totals, biggest first and
// Unclassified last; ingredients keep their calorie order inside each.
function groupFoodIntakeByGroup(rows) {
  const byClass = new Map();
  rows.forEach((r) => {
    const key = r.group || FOOD_UNCLASSIFIED_LABEL;
    if (!byClass.has(key)) byClass.set(key, { group: key, items: [], calories: 0, protein: 0 });
    const group = byClass.get(key);
    group.items.push(r);
    group.calories += r.calories;
    group.protein += r.protein;
  });

  return [...byClass.values()]
    .map((g) => ({ ...g, protein: Math.round(g.protein * 10) / 10 }))
    .sort((a, b) => {
      const aUnknown = a.group === FOOD_UNCLASSIFIED_LABEL;
      const bUnknown = b.group === FOOD_UNCLASSIFIED_LABEL;
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      return b.calories - a.calories;
    });
}

function formatFoodGroupSummary(group) {
  const n = group.items.length;
  return `${group.group} — ${n} ingredient${n === 1 ? '' : 's'}, ${group.calories} kcal, ${group.protein} g protein`;
}

// A count (e.g. 23 eggs) in grams, from the Nutrition row's per-unit weight
// ("58g (1x)"); null without a row or a gram figure, leaving the count as is.
function convertCountToGrams(name, count) {
  const tableEntry = findNutritionEntry(name);
  if (!tableEntry) return null;
  const tableGrams = parseGramsFromAmount(tableEntry.amount);
  if (tableGrams === null) return null;
  const tableCount = parseCountFromAmount(tableEntry.amount) || 1;
  return (tableGrams / tableCount) * count;
}

// A breakdown amount is exactly "×N" or "Ng" (health-physique-estimator.js), not
// the freeform Nutrition Amount that parseGramsFromAmount/parseCountFromAmount read.
function parseBreakdownAmount(amount) {
  const str = String(amount || '').trim();
  const countMatch = str.match(/^×(\d+(?:\.\d+)?)$/);
  if (countMatch) return { grams: null, count: parseFloat(countMatch[1]) };
  const gramsMatch = str.match(/^(\d+(?:\.\d+)?)g$/i);
  if (gramsMatch) return { grams: parseFloat(gramsMatch[1]), count: null };
  return { grams: null, count: null };
}

// One name can be logged by weight on one day and by count on another: show both.
function formatAggregatedAmount(grams, count) {
  const parts = [];
  if (grams > 0) parts.push(`${Math.round(grams)}g`);
  if (count > 0) parts.push(`×${Math.round(count * 10) / 10}`);
  return parts.length ? parts.join(', ') : '—';
}

const FOOD_TABLE_COLUMN_COUNT = 8;

// TEF in whole kcal, the rest in grams to 0.1; absent reads "—", not a zero.
function formatFoodMacro(macro, value) {
  if (value === undefined || value === null) return '—';
  return macro === 'tef' ? String(Math.round(value)) : value.toFixed(1);
}

function foodMacroCells(values) {
  return FOOD_MACROS.map((macro) => makeCell(formatFoodMacro(macro, values[macro])));
}

function foodTableRow(className, cells) {
  const tr = document.createElement('tr');
  if (className) tr.className = className;
  tr.append(...cells);
  return tr;
}

// The ingredient table (grouped as the prompt groups them) and the profile
// lines sent with it. Unmasked: it shows the request to its own owner.
function renderFoodInsightPreview(rows, from, to) {
  renderInsightLines(document.getElementById('insight-food-profile'), currentProfileLines());

  const tbody = document.getElementById('insight-food-body');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.appendChild(renderEmptyRow(FOOD_TABLE_COLUMN_COUNT, `No Calculate-derived ingredients logged from ${from} to ${to}.`));
    return;
  }

  let totalCalories = 0;
  let totalProtein = 0;
  // A macro stays absent (not zero) when no ingredient has it.
  const totals = {};

  groupFoodIntakeByGroup(rows).forEach((g) => {
    const groupCell = makeCell(formatFoodGroupSummary(g));
    groupCell.colSpan = FOOD_TABLE_COLUMN_COUNT;
    tbody.appendChild(foodTableRow('insight-food-group-row', [groupCell]));

    g.items.forEach((r) => {
      const macros = estimateMacrosForFoodRow(r) || {};
      tbody.appendChild(foodTableRow('', [
        makeCell(r.name),
        makeCell(r.amountLabel),
        makeCell(String(r.calories)),
        makeCell(String(r.protein)),
        ...foodMacroCells(macros),
      ]));

      totalCalories += r.calories;
      totalProtein += r.protein;
      FOOD_MACROS.forEach((macro) => {
        if (macros[macro] !== undefined) totals[macro] = (totals[macro] || 0) + macros[macro];
      });
    });
  });

  // Averaged over days with Calculate data, not the range's calendar length.
  const daysLogged = countMicronutrientLoggedDays(from, to);
  const perDay = {};
  FOOD_MACROS.forEach((macro) => {
    perDay[macro] = (totals[macro] !== undefined && daysLogged > 0) ? totals[macro] / daysLogged : null;
  });

  tbody.appendChild(foodTableRow('insight-food-total-row', [
    makeCell('Total'),
    makeCell(''),
    makeCell(String(Math.round(totalCalories))),
    makeCell((Math.round(totalProtein * 10) / 10).toFixed(1)),
    ...foodMacroCells(totals),
  ]));

  tbody.appendChild(foodTableRow('insight-food-average-row', [
    makeCell('Avg/day', `Averaged over ${daysLogged} day${daysLogged === 1 ? '' : 's'} logged in this range, not the range's calendar length`),
    makeCell(''),
    makeCell(daysLogged > 0 ? String(Math.round(totalCalories / daysLogged)) : '—'),
    makeCell(daysLogged > 0 ? (totalProtein / daysLogged).toFixed(1) : '—'),
    ...foodMacroCells(perDay),
  ]));

  // What this body aims for: Tune's calorie and protein/fiber figures, and the
  // FDA Daily Value for fat/carbohydrate. TEF has no desired figure.
  const healthEntries = physiqueAsHealthEntries();
  const calorieDesired = getCalorieDesired(healthEntries);
  const proteinBand = getProteinDesiredBandG(healthEntries);
  const fiberBand = getFiberDesiredBandG(healthEntries);
  const dailyDesired = nutrientDailyDesired();

  tbody.appendChild(foodTableRow('insight-food-ideal-row', [
    makeCell('Ideal/day', `${calorieDesired.full} desired calories, current protein/fiber bands and Fat/Carbohydrate FDA Daily Values — from Tune and Settings, not this range's data`),
    makeCell(''),
    makeCell(String(Math.round(calorieDesired.kcal))),
    makeCell(formatProteinDesiredBand(proteinBand)),
    makeCell(formatProteinDesiredBand(fiberBand)),
    makeCell(String(dailyDesired[WELLNESS_FAT_NUTRIENT]?.amount ?? '—')),
    makeCell(String(dailyDesired[WELLNESS_CARB_NUTRIENT]?.amount ?? '—')),
    makeCell('—'),
  ]));
}

// Asked when the question box is left blank (this mode inlines its question).
const FOOD_INSIGHT_DEFAULT_QUESTION = 'What vitamins or minerals might be missing from this diet?';

// Profile, then the grouped ingredient list, then the question. The profile
// leads: nutrient needs differ by sex, age and body.
function formatFoodInsightPrompt(rows, from, to, question) {
  const profile = currentProfileLines().join('\n');
  const header = `Aggregated ingredients logged from ${from} to ${to}, grouped by the Group each ingredient is filed under in the user's own ingredient catalog. Each group line gives that group's ingredient count and totals, followed by its ingredients (name (total amount): total calories, total protein, estimated TEF where measured):`;
  const groups = groupFoodIntakeByGroup(rows);
  const body = groups.length
    ? groups.map((g) => [
      formatFoodGroupSummary(g),
      // TEF only where measured, like the table's "—".
      ...g.items.map((r) => {
        const tef = estimateTefForFoodRow(r);
        const tefPart = tef !== null ? `, ~${tef} kcal TEF (thermic effect of food)` : '';
        return `  - ${r.name} (${r.amountLabel}): ${r.calories} kcal, ${r.protein} g protein${tefPart}`;
      }),
    ].join('\n')).join('\n\n')
    : '(no Calculate-derived ingredient breakdown logged in this window)';
  return `${profile}\n\n${header}\n${body}\n\nQuestion: ${insightQuestionOrDefault(question, FOOD_INSIGHT_DEFAULT_QUESTION)}`;
}

const FOOD_INSIGHT_SYSTEM_PROMPT = `You are a nutrition-savvy assistant reviewing a plain list of foods someone logged over a recent period — each ingredient's total amount eaten and the total calories/protein it contributed. No vitamin or mineral data is provided; none was measured. Use your general knowledge of typical food composition to infer which vitamins/minerals this pattern of eating is likely rich in or short on, and answer the user's specific question.

The ingredients are grouped under the Group the user files each one under in their own catalog, and each group line carries that group's ingredient count and calorie/protein totals. Read the diet at that level too, not just ingredient by ingredient: which food groups carry most of the calories and protein, which groups are thin or missing entirely, and how varied the ingredients are within each. A whole group that is absent is usually a stronger signal about likely nutrient gaps than any single ingredient. A group named "Unclassified" is not a food group — those are simply ingredients the user has not classified yet, so judge them individually and do not read anything into the label itself.

The list is preceded by their age, sex, height, current body mass and BMI. Use it: reference intakes for iron, calcium, folate, B12 and protein differ by sex and age, and whether a day's total food is a lot or a little depends on the body eating it. Any of those fields may read "not set" or "not logged" — that means the app doesn't have it, so say what you'd need rather than assuming a figure.

Be explicit that this is an inference from typical food composition, not a lab-measured nutrient analysis, and that specific products/brands/preparation can vary. You are not a doctor — do not diagnose a deficiency or recommend supplement dosages; suggest food-based ways to close likely gaps instead.

Write a short plain-text report with exactly these five sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only. Within a section, if you're naming more than one distinct point, put each one on its own line — never run multiple points together in one paragraph, with or without a bullet character.

Overview: one or two sentences on the overall inferred nutrient picture this pattern of eating suggests, naming which groups the diet leans on most.
Going well: vitamins/minerals this pattern likely covers well, and which groups supply them.
Needs attention: vitamins/minerals this pattern likely falls short on, naming any group that is thin or missing.
Suggestions: 2-4 concrete, specific food-based ways to close the likely gaps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.
Answer: directly answers the question included below.

Keep the whole report under 250 words.`;
