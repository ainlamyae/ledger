// The Health Insight panel's Food mode: aggregates every ingredient logged (via
// Physique's 🧮 Calculate breakdown) over the picked range into one
// per-ingredient total, and phrases it for a nutrient-gap read. No vitamin or
// mineral data exists anywhere in this app (usda.js only extracts kcal/protein),
// so this leans entirely on the model's own food-composition knowledge — the
// same trust level item.kcalPer100gFallback already extends it in
// calorie-estimator.js. insight-panel.js drives it; the shared profile block and
// the report renderer come from insight.js.

// Sums each Calculate-derived breakdown item across every Calories; Protein
// entry in the window, grouped by lowercase-trimmed ingredient name. Exact
// match (not the trailing-s fold nutrition.js's findNutritionEntry uses) —
// that fold exists to prevent duplicate *catalog* rows; here "egg"/"eggs"
// showing as two summary lines is a harmless cosmetic difference, not a
// data-quality problem, so the simpler/more predictable exact match wins.
// Entries with no breakdown (entry.breakdown === []) are silently skipped.
function aggregateFoodIntake(from, to) {
  const byName = new Map();

  physiqueAsWellnessEntries()
    .filter((e) => e.category === 'Calories; Protein' && e.date >= from && e.date <= to)
    .forEach((e) => {
      (e.breakdown || []).forEach((item) => {
        const key = String(item.name || '').trim().toLowerCase();
        if (!key) return;
        if (!byName.has(key)) {
          byName.set(key, { name: item.name.trim(), calories: 0, protein: 0, grams: 0, count: 0 });
        }
        const agg = byName.get(key);
        agg.calories += item.calories || 0;
        agg.protein += item.protein || 0;
        const { grams, count } = parseBreakdownAmount(item.amount);
        if (grams !== null) agg.grams += grams;
        if (count !== null) agg.count += count;
      });
    });

  // Highest-calorie ingredient first — matches calorie-estimator.js's own
  // breakdown table ordering (sortedMacros).
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
        // Column A of the Nutrition row this ingredient matches. Blank
        // when the ingredient isn't in the table yet, or is but hasn't been
        // classified — both land in the Unclassified bucket below.
        classification: findNutritionEntry(agg.name)?.classification || '',
        calories: Math.round(agg.calories),
        protein: Math.round(agg.protein * 10) / 10,
        amountLabel: formatAggregatedAmount(grams, count),
      };
    })
    .sort((a, b) => b.calories - a.calories);
}

const FOOD_UNCLASSIFIED_LABEL = 'Unclassified';

// The same ingredients bucketed by classification, each bucket carrying its own
// totals — "which food groups is this diet actually built on" is a different
// question from "which single ingredients dominate", and only the grouped view
// can answer it. Ingredients keep their calorie ordering inside each bucket.
function groupFoodIntakeByClassification(rows) {
  const byClass = new Map();
  rows.forEach((r) => {
    const key = r.classification || FOOD_UNCLASSIFIED_LABEL;
    if (!byClass.has(key)) byClass.set(key, { classification: key, items: [], calories: 0, protein: 0 });
    const group = byClass.get(key);
    group.items.push(r);
    group.calories += r.calories;
    group.protein += r.protein;
  });

  return [...byClass.values()]
    .map((g) => ({ ...g, protein: Math.round(g.protein * 10) / 10 }))
    // Biggest calorie contributor first, but the unclassified bucket always
    // sinks to the bottom — it's a gap in the catalog, not a food group.
    .sort((a, b) => {
      const aUnknown = a.classification === FOOD_UNCLASSIFIED_LABEL;
      const bUnknown = b.classification === FOOD_UNCLASSIFIED_LABEL;
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      return b.calories - a.calories;
    });
}

function formatFoodGroupSummary(group) {
  const n = group.items.length;
  return `${group.classification} — ${n} ingredient${n === 1 ? '' : 's'}, ${group.calories} kcal, ${group.protein} g protein`;
}

// Converts a unit count (e.g. 23 eggs) to grams using the Nutrition
// table's own per-unit weight for that ingredient (e.g. "1x (58g)" -> 58g
// each), so the summary reads in one consistent unit instead of a bare,
// hard-to-picture count — the count-branch Amount format ("×N") never
// carries a real weight itself (see calorie-estimator.js), only the
// Nutrition row does. Returns null (leaving the count as-is for
// display) if there's no matching row or its Amount has no gram figure —
// e.g. an ingredient banked via a fresh USDA/AI miss that hasn't been
// reviewed/saved yet (see the Calculate breakdown's 💾 button).
function convertCountToGrams(name, count) {
  const tableEntry = findNutritionEntry(name);
  if (!tableEntry) return null;
  const tableGrams = parseGramsFromAmount(tableEntry.amount);
  if (tableGrams === null) return null;
  const tableCount = parseCountFromAmount(tableEntry.amount) || 1;
  return (tableGrams / tableCount) * count;
}

// A Calculate breakdown item's amount is always exactly "×N" (a count-branch
// match, e.g. "×2") or "Ng" (a grams-branch match/USDA estimate, e.g.
// "40.5g") — see calorie-estimator.js's amount assignments. NOT the same
// shape as the freeform Nutrition table Amount field (e.g.
// "1scoop (31g)") that nutrition.js's parseGramsFromAmount/
// parseCountFromAmount are built for — reusing those here would silently
// fail on every "×N" count string (no leading digit for parseCountFromAmount
// to match), so this parses the breakdown's own exact format instead.
function parseBreakdownAmount(amount) {
  const str = String(amount || '').trim();
  const countMatch = str.match(/^×(\d+(?:\.\d+)?)$/);
  if (countMatch) return { grams: null, count: parseFloat(countMatch[1]) };
  const gramsMatch = str.match(/^(\d+(?:\.\d+)?)g$/i);
  if (gramsMatch) return { grams: parseFloat(gramsMatch[1]), count: null };
  return { grams: null, count: null };
}

// A given amount string is grams-only or count-only, never both — but
// nothing stops the same ingredient NAME from being logged once by weight
// and once by count across different entries, so show both totals rather
// than silently dropping one.
function formatAggregatedAmount(grams, count) {
  const parts = [];
  if (grams > 0) parts.push(`${Math.round(grams)}g`);
  if (count > 0) parts.push(`×${Math.round(count * 10) / 10}`);
  return parts.length ? parts.join(', ') : '—';
}

// Renders the (locally computed, not AI) ingredient table, plus the profile
// line that rides along with it in the prompt — the panel shows everything it
// sends, the same rule the other two modes' previews follow, so the profile
// can't be silently attached to the request. Takes the rows the panel already
// gathered rather than re-aggregating them.
function renderFoodInsightPreview(rows, from, to) {
  // Unmasked, like the other modes' previews: this is the request being shown
  // to the person whose data it is, not a dashboard figure the privacy toggle
  // hides from someone glancing over at the charts. Rendered one line per fact
  // by the panel's shared renderer, so the profile block reads the same here as
  // it does inside the Wellness/Activity prompt previews.
  renderInsightLines(document.getElementById('insight-food-profile'), formatProfileLines(gatherProfileSnapshot()));

  const tbody = document.getElementById('insight-food-body');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.appendChild(renderEmptyRow(4, `No Calculate-derived ingredients logged from ${from} to ${to}.`));
    return;
  }

  // Grouped exactly as the prompt groups them, so the preview stays a literal
  // view of what gets sent rather than a differently-shaped summary of it.
  groupFoodIntakeByClassification(rows).forEach((g) => {
    const groupRow = document.createElement('tr');
    groupRow.className = 'insight-food-group-row';
    const groupCell = document.createElement('td');
    groupCell.colSpan = 4;
    groupCell.textContent = formatFoodGroupSummary(g);
    groupRow.appendChild(groupCell);
    tbody.appendChild(groupRow);

    g.items.forEach((r) => {
      const tr = document.createElement('tr');
      tr.append(
        makeCell(r.name),
        makeCell(r.amountLabel),
        makeCell(String(r.calories)),
        makeCell(String(r.protein)),
      );
      tbody.appendChild(tr);
    });
  });
}

// Asked when the question box is left blank — this mode is the only one that
// inlines the question in its prompt, so it needs something to inline.
const FOOD_INSIGHT_DEFAULT_QUESTION = 'What vitamins or minerals might be missing from this diet?';

// Who's eating it (the shared profile block from insight.js) + the plain-text
// ingredient list + the user's question (or the default). Still no day-by-day
// breakdown — that's what the Wellness mode is for. The profile leads, because
// nutrient adequacy is a per-body judgement: iron and calcium needs differ by
// sex and age, and "is this enough food" can't be read off an ingredient list
// without knowing the body it's feeding.
function formatFoodInsightPrompt(rows, from, to, question) {
  const profile = formatProfileLines(gatherProfileSnapshot()).join('\n');
  const header = `Aggregated ingredients logged from ${from} to ${to}, grouped by the classification each ingredient is filed under in the user's own ingredient catalog. Each group line gives that group's ingredient count and totals, followed by its ingredients (name (total amount): total calories, total protein):`;
  const groups = groupFoodIntakeByClassification(rows);
  const body = groups.length
    ? groups.map((g) => [
      formatFoodGroupSummary(g),
      ...g.items.map((r) => `  - ${r.name} (${r.amountLabel}): ${r.calories} kcal, ${r.protein} g protein`),
    ].join('\n')).join('\n\n')
    : '(no Calculate-derived ingredient breakdown logged in this window)';
  const q = (question && question.trim()) ? question.trim() : FOOD_INSIGHT_DEFAULT_QUESTION;
  return `${profile}\n\n${header}\n${body}\n\nQuestion: ${q}`;
}

const FOOD_INSIGHT_SYSTEM_PROMPT = `You are a nutrition-savvy assistant reviewing a plain list of foods someone logged over a recent period — each ingredient's total amount eaten and the total calories/protein it contributed. No vitamin or mineral data is provided; none was measured. Use your general knowledge of typical food composition to infer which vitamins/minerals this pattern of eating is likely rich in or short on, and answer the user's specific question.

The ingredients are grouped under the classifications the user files them under in their own catalog, and each group line carries that group's ingredient count and calorie/protein totals. Read the diet at that level too, not just ingredient by ingredient: which food groups carry most of the calories and protein, which groups are thin or missing entirely, and how varied the ingredients are within each. A whole group that is absent is usually a stronger signal about likely nutrient gaps than any single ingredient. A group named "Unclassified" is not a food group — those are simply ingredients the user has not classified yet, so judge them individually and do not read anything into the label itself.

The list is preceded by their age, sex, height, current body mass and BMI. Use it: reference intakes for iron, calcium, folate, B12 and protein differ by sex and age, and whether a day's total food is a lot or a little depends on the body eating it. Any of those fields may read "not set" or "not logged" — that means the app doesn't have it, so say what you'd need rather than assuming a figure.

Be explicit that this is an inference from typical food composition, not a lab-measured nutrient analysis, and that specific products/brands/preparation can vary. You are not a doctor — do not diagnose a deficiency or recommend supplement dosages; suggest food-based ways to close likely gaps instead.

Write a short plain-text report with exactly these five sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall inferred nutrient picture this pattern of eating suggests, naming which classifications the diet leans on most.
Going well: vitamins/minerals this pattern likely covers well, and which classifications supply them.
Needs attention: vitamins/minerals this pattern likely falls short on, naming any classification that is thin or missing.
Suggestions: 2-4 concrete, specific food-based ways to close the likely gaps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.
Answer: directly answers the question included below.

Keep the whole report under 250 words.`;
