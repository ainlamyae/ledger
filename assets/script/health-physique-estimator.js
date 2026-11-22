// Physique's 🧮 Calculate: the AI (ai.js) splits an ingredient list; each item is
// priced from the Nutrition table, else from USDA (checked against the AI's guess).
// Also draws the breakdown table. Driven by health-physique-breakdown.js.

const NUTRITION_TABLE_SOURCE_LABEL = CONFIG.SHEETS.NUTRITION;

// Every name the Nutrition tab has had; saved breakdowns still hold each.
const NUTRITION_TABLE_SOURCE_LABELS = [NUTRITION_TABLE_SOURCE_LABEL, 'Nutrition', 'Nutrition Facts'];

// The label each pricing path stores in a breakdown row's `source`.
const BREAKDOWN_SOURCE_LABELS = {
  'nutrition-table-count': NUTRITION_TABLE_SOURCE_LABEL,
  'nutrition-table-grams': NUTRITION_TABLE_SOURCE_LABEL,
  'usda/ai': 'USDA',
  'usda-unreachable': 'AI estimate (offline)',
};

// Optional macros: Nutrition row / anchor / USDA field -> breakdown row key.
const BREAKDOWN_MACRO_KEY = { fiber: 'fiber', fat: 'fat', carb: 'carbohydrate' };
const TYPED_MACRO_FIELDS = Object.keys(BREAKDOWN_MACRO_KEY);

// Optional breakdown row keys, summed when merging and in the Total row.
const OPTIONAL_TOTAL_KEYS = ['fiber', 'fat', 'carbohydrate', 'tef'];

// USDA nutrient name for each optional macro.
const USDA_MACRO_NUTRIENT = {
  fiber: 'Fiber, total dietary',
  fat: 'Total lipid (fat)',
  carb: 'Carbohydrate, by difference',
};

function roundPlaces(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// '' rather than "[]" for an empty breakdown.
function breakdownToJson(breakdown) {
  return (breakdown && breakdown.length) ? JSON.stringify(breakdown) : '';
}

// Grams per unit of a counted Nutrition row ("31g (1 scoop)" -> 31), else null.
function nutritionGramsPerUnit(entry) {
  const grams = parseGramsFromAmount(entry.amount);
  const count = parseCountFromAmount(entry.amount);
  return grams !== null && count !== null && count > 0 ? grams / count : null;
}

// A saved "×2" amount as grams from its Nutrition row; null when not convertible.
function breakdownAmountInGrams(name, amount) {
  const match = String(amount || '').trim().match(/^×(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const entry = findNutritionEntry(name);
  const perUnit = entry ? nutritionGramsPerUnit(entry) : null;
  return perUnit === null ? null : `${roundPlaces(parseFloat(match[1]) * perUnit, 1)}g`;
}

// Sum of two optional macros; undefined when neither has one.
function sumOptional(a, b) {
  if (a === undefined && b === undefined) return undefined;
  return roundPlaces((a || 0) + (b || 0), 2);
}

// A breakdown Amount's number, "×3" or "50g" alike.
function breakdownQuantity(amount) {
  return parseFloat(amount.replace('×', ''));
}

// Display only: same ingredient and amount type (grams vs "×N") merge into one row.
function mergeDuplicateBreakdownRows(rows) {
  const merged = new Map();

  rows.forEach((row) => {
    const isCount = row.amount.startsWith('×');
    const key = `${row.name.toLowerCase()}|${isCount ? 'count' : 'grams'}`;
    const quantity = breakdownQuantity(row.amount);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...row, quantity });
      return;
    }

    existing.quantity += quantity;
    existing.calories += row.calories;
    existing.protein = roundPlaces(existing.protein + row.protein, 1);
    OPTIONAL_TOTAL_KEYS.forEach((field) => { existing[field] = sumOptional(existing[field], row[field]); });
    existing.amount = isCount ? `×${existing.quantity}` : `${roundPlaces(existing.quantity, 1)}g`;
    if (existing.source !== row.source) existing.source = `${existing.source} + ${row.source}`;
    existing.noteLine = `${existing.noteLine}\n${row.noteLine}`;
    if (!existing.newRow && row.newRow) existing.newRow = row.newRow;
  });

  // Merging can change which row has the most calories.
  return [...merged.values()]
    .sort((a, b) => b.calories - a.calories)
    .map(({ quantity, ...row }) => row);
}

function usdaMacroPer100g(candidate, nutrientName) {
  const nutrient = candidate.nutrients.find((n) => n.name === nutrientName);
  return nutrient ? nutrient.amountPer100g : null;
}

// USDA can rank a false match first ("soybeans" -> soybean oil), so a candidate is
// trusted only near the AI's kcal guess. Fiber/fat/carb have no AI fallback.
function pickPlausibleMacros(candidates, kcalFallback, proteinFallback) {
  const best = pickPlausibleUsdaCandidate(candidates, kcalFallback);
  if (!best) return { kcal: kcalFallback, protein: proteinFallback, fiber: null, fat: null, carb: null, candidate: null };
  return {
    candidate: best,
    kcal: best.kcalPer100g,
    protein: best.proteinPer100g !== null ? best.proteinPer100g : proteinFallback,
    fiber: usdaMacroPer100g(best, USDA_MACRO_NUTRIENT.fiber),
    fat: usdaMacroPer100g(best, USDA_MACRO_NUTRIENT.fat),
    carb: usdaMacroPer100g(best, USDA_MACRO_NUTRIENT.carb),
  };
}

// A name's words, lowercase with a trailing "s" folded ("Apples" -> apple).
function ingredientNameWords(name) {
  return new Set(String(name || '').toLowerCase().split(/[^\p{L}\d]+/u).filter(Boolean).map(foldTrailingS));
}

// The AI's items in their segments' order: each segment takes the free item sharing
// the most name words, ties by position; ones sharing none keep the order left.
function pairItemsToSegments(items, segments) {
  const segmentWords = segments.map((s) => ingredientNameWords(extractIngredientName(s)));
  const itemWords = items.map((item) => ingredientNameWords(item.query));
  const pairs = [];
  segmentWords.forEach((sw, s) => itemWords.forEach((iw, i) => {
    const score = [...sw].filter((w) => iw.has(w)).length;
    if (score > 0) pairs.push({ s, i, score });
  }));
  pairs.sort((a, b) => b.score - a.score || Math.abs(a.s - a.i) - Math.abs(b.s - b.i));

  const paired = new Array(segments.length).fill(null);
  const taken = new Set();
  pairs.forEach(({ s, i }) => {
    if (paired[s] !== null || taken.has(i)) return;
    paired[s] = items[i];
    taken.add(i);
  });
  const rest = items.filter((_, i) => !taken.has(i));
  return paired.map((item) => item ?? rest.shift());
}

// Comma/newline only: " and " would split "macaroni and cheese".
function splitNotesIntoSegments(notes) {
  return notes.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

// Every spelling of each unit by canonical form. Order matters for the regexes below.
const UNIT_SPELLINGS = {
  x: ['x'],
  g: ['g', 'gram', 'grams'],
  kg: ['kg', 'kilogram', 'kilograms'],
  mg: ['mg', 'milligram', 'milligrams'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  ml: ['ml', 'milliliter', 'milliliters'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  cup: ['cup', 'cups'],
  tbsp: ['tbsp', 'tbsps', 'tablespoon', 'tablespoons'],
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons'],
  slice: ['slice', 'slices'],
  piece: ['piece', 'pieces'],
  serving: ['serving', 'servings'],
  scoop: ['scoop', 'scoops'],
  spray: ['spray', 'sprays'],
  shot: ['shot', 'shots'],
  can: ['can', 'cans'],
  clove: ['clove', 'cloves'],
};

// Spelling -> canonical unit, so a saved note always reads one way ("shots" -> "shot").
const UNIT_CANONICAL = Object.fromEntries(
  Object.entries(UNIT_SPELLINGS).flatMap(([canonical, spellings]) => spellings.map((s) => [s, canonical])),
);

// Real units only; "x" is a placeholder and joins the leading pattern alone.
const INGREDIENT_UNIT_WORDS_BASE = Object.entries(UNIT_SPELLINGS)
  .filter(([canonical]) => canonical !== 'x')
  .flatMap(([, spellings]) => spellings)
  .join('|');

// Units counted one by one: the typed number is trusted over the AI's count.
const COUNT_LIKE_UNITS = new Set(
  ['x', 'piece', 'serving', 'scoop', 'slice', 'spray', 'shot', 'can', 'clove'].flatMap((u) => UNIT_SPELLINGS[u]),
);

// Fixed weight for a unit the AI can only guess: a standard 30 g/ml shot.
const UNIT_TO_GRAMS = { shot: 30, shots: 30 };

// Mass units only: volume units need the food's density, i.e. a USDA/AI lookup.
const PHYSIQUE_MASS_UNIT_TO_GRAMS = { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592 };

// Grams per one of a typed mass unit, any spelling; undefined otherwise.
function massUnitGrams(unit) {
  return PHYSIQUE_MASS_UNIT_TO_GRAMS[UNIT_CANONICAL[unit]];
}

// A leading energy amount is an anchor ("300kcal cookie"). "cal" means kcal; kJ converts.
const KJ_PER_KCAL = 4.184;
const ENERGY_UNIT_TO_KCAL = {
  kcal: 1, kcals: 1, calories: 1, calorie: 1, cals: 1, cal: 1,
  kilojoules: 1 / KJ_PER_KCAL, kilojoule: 1 / KJ_PER_KCAL, kj: 1 / KJ_PER_KCAL,
};

// Anchor words per macro ("100kcal 5p 4fiber 5fat 8carb bar"), longest first.
const MACRO_ANCHOR_WORDS = {
  kcal: Object.keys(ENERGY_UNIT_TO_KCAL),
  protein: ['p', 'pro'],
  fiber: ['fiber', 'df'],
  fat: ['fat'],
  carb: ['carb', 'carbs'],
};
const MACRO_UNIT_WORDS = Object.values(MACRO_ANCHOR_WORDS).flat().join('|');
const MACRO_UNIT_TO_FIELD = Object.fromEntries(
  Object.entries(MACRO_ANCHOR_WORDS).flatMap(([field, words]) => words.map((word) => [word, field])),
);
// One anchor token; a segment may hold several.
const MACRO_TOKEN_PATTERN = new RegExp(`^\\s*([\\d.]+)\\s*(${MACRO_UNIT_WORDS})\\b\\.?\\s*`, 'i');
// Leading quantity plus optional unit ("100g egg white" -> "egg white"). "x" lets a
// tidied "1x apple" re-parse.
const INGREDIENT_UNIT_WORDS = `x|${MACRO_UNIT_WORDS}|${INGREDIENT_UNIT_WORDS_BASE}`;
const INGREDIENT_QUANTITY_PATTERN = new RegExp(
  `^\\s*([\\d.]+)(?:\\s*[-/]\\s*[\\d.]+)?\\s*(${INGREDIENT_UNIT_WORDS})?\\b\\.?\\s*`, 'i'
);

// "200/5g bar" (200g split 5 ways) is divided here, not by the AI. Unit-glued only.
const DIVISION_QUANTITY_PATTERN = new RegExp(
  `(^|[,\\n]\\s*)([\\d.]+)\\s*/\\s*([\\d.]+)\\s*(${INGREDIENT_UNIT_WORDS})\\b`, 'gi'
);
function resolveDivisionQuantities(notes) {
  return notes.replace(DIVISION_QUANTITY_PATTERN, (full, lead, num, denom, unit, offset, text) => {
    const denomNum = parseFloat(denom);
    if (!denomNum) return full;
    // Rounded by the food's density; the name is the rest of its line.
    const name = extractIngredientName(text.slice(offset + full.length).split(/[,\n]/)[0]);
    return `${lead}${roundConsumptionQuantity(parseFloat(num) / denomNum, unit, name)}${unit}`;
  });
}

// A unit word ending the name ("watermelon slice") is dropped too.
const TRAILING_UNIT_PATTERN = new RegExp(`\\s+(?:${INGREDIENT_UNIT_WORDS_BASE})\\s*$`, 'i');
// A size word changes weight, not the food. "mini" stays: it's its own product.
const SIZE_DESCRIPTOR_WORDS = 'extra small|extra large|small|medium|large|big|jumbo|tiny';
const LEADING_DESCRIPTOR_PATTERN = new RegExp(`^(?:${SIZE_DESCRIPTOR_WORDS})\\s+`, 'i');

// Splits a segment's leading quantity/anchors from its name. Anchors sum by field;
// quantity/unit echo the first anchor, or null when several macros were typed.
function stripLeadingIngredientTokens(segment) {
  let rest = segment;
  const anchors = {};
  let firstQuantity = null;
  let firstUnit = null;
  let match = rest.match(MACRO_TOKEN_PATTERN);
  while (match) {
    const unit = match[2].toLowerCase();
    const field = MACRO_UNIT_TO_FIELD[unit];
    const rawValue = parseFloat(match[1]);
    const value = field === 'kcal' ? rawValue * ENERGY_UNIT_TO_KCAL[unit] : rawValue;
    anchors[field] = (anchors[field] || 0) + value;
    if (firstUnit === null) { firstQuantity = rawValue; firstUnit = unit; }
    rest = rest.slice(match[0].length);
    match = rest.match(MACRO_TOKEN_PATTERN);
  }
  if (firstUnit !== null) {
    const singleAnchor = Object.keys(anchors).length === 1;
    return { rest, quantity: singleAnchor ? firstQuantity : null, unit: singleAnchor ? firstUnit : null, anchors };
  }

  const plain = segment.match(INGREDIENT_QUANTITY_PATTERN);
  if (!plain) return { rest: segment, quantity: null, unit: null, anchors: {} };
  return {
    rest: segment.slice(plain[0].length),
    quantity: parseFloat(plain[1]),
    unit: plain[2] ? plain[2].toLowerCase() : null,
    anchors: {},
  };
}

function extractIngredientName(segment) {
  return stripLeadingIngredientTokens(segment).rest
    .replace(LEADING_DESCRIPTOR_PATTERN, '')
    .replace(TRAILING_UNIT_PATTERN, '')
    .trim();
}

function extractIngredientQuantity(segment) {
  const { rest, ...quantity } = stripLeadingIngredientTokens(segment);
  return quantity;
}

// A typed anchor's amount for `field` (kcal already converted), or null.
function typedAnchor({ anchors }, field) {
  return (anchors && anchors[field] !== undefined) ? Math.max(0, anchors[field]) : null;
}

// Typed anchors as canonical note text ("100kcal 5p"), '' when none. kJ reads back as kcal.
const ANCHOR_NOTE_WORD = { kcal: 'kcal', protein: 'p', fiber: 'fiber', fat: 'fat', carb: 'carb' };
function anchorNoteText(anchors) {
  return Object.entries(anchors || {})
    .map(([field, value]) => `${roundPlaces(value, 2)}${ANCHOR_NOTE_WORD[field]}`)
    .join(' ');
}

// Grams holding `amount` of a macro at `per100g`; a zero density keeps the AI's grams.
function gramsForAnchor(amount, per100g, fallbackGrams) {
  return per100g > 0 ? (amount / per100g) * 100 : fallbackGrams;
}

// Whether a Nutrition Amount counts in `unit` ("5g (1cup)" names cup).
function amountNamesUnit(amount, unit) {
  // A weight is never a serving: "200g" on a "50g (1x)" row is 200 g, not 200 eggs.
  if (massUnitGrams(unit)) return false;
  const spellings = (unit && UNIT_SPELLINGS[UNIT_CANONICAL[unit]]) || [];
  return spellings.some((s) => new RegExp(`\\d\\s*${s}\\b`, 'i').test(String(amount || '')));
}

// Grams a Consumption line means: its typed weight, or its count of a Nutrition
// row's named unit; null otherwise.
function consumptionLineGrams(line) {
  const { quantity, unit } = extractIngredientQuantity(line);
  if (quantity === null || !unit) return null;
  const perGram = massUnitGrams(unit);
  if (perGram) return quantity * perGram;
  const entry = findNutritionEntry(extractIngredientName(line));
  const perUnit = entry && amountNamesUnit(entry.amount, unit) ? nutritionGramsPerUnit(entry) : null;
  return perUnit === null ? null : quantity * perUnit;
}

// The USDA food Calculate priced each new ingredient from, by lowercase name.
const usdaCandidateByName = new Map();

// Calories/protein for a Consumption text; no DOM. Throws on empty input or AI
// failure. autoBank saves each USDA/AI miss to Nutrition at once; the form passes
// false and offers 💾 per row, so a typo isn't banked.
async function estimateCaloriesAndProtein(notesText, { autoBank = true } = {}) {
  const notes = resolveDivisionQuantities(notesText.trim());
  if (!notes) throw new Error('No ingredients to calculate from.');

  const extraction = await aiExtractIngredients(notes);
  const { items } = extraction;

  // Names come from the user's text, paired by position; else the AI's "query".
  const segments = splitNotesIntoSegments(notes);
  const pairingReliable = segments.length === items.length;
  // The AI may list them in another order: reordered to their lines by name.
  if (pairingReliable) items.splice(0, items.length, ...pairItemsToSegments(items, segments));
  const segmentQuantities = pairingReliable ? segments.map(extractIngredientQuantity) : [];
  const resolvedNames = items.map((item, i) =>
    pairingReliable ? extractIngredientName(segments[i]) : item.query
  );

  // What the user typed beats the AI: a shot's fixed weight, a count unit's number.
  if (pairingReliable) {
    items.forEach((item, i) => {
      const { quantity, unit } = segmentQuantities[i];
      if (!unit) return;
      if (UNIT_TO_GRAMS[unit]) item.grams = (quantity ?? 1) * UNIT_TO_GRAMS[unit];
      // A typed weight is the amount eaten, not the AI's guess.
      const perGram = massUnitGrams(unit);
      if (perGram && quantity !== null) item.grams = quantity * perGram;
      if (COUNT_LIKE_UNITS.has(unit)) item.count = quantity ?? 1;
    });
  }

  let usdaAttempts = 0;
  let usdaFailureCount = 0;
  // Misses to bank into Nutrition (autoBank only).
  const newNutritionRows = [];

  const perItemMacros = await Promise.all(items.map(async (item, i) => {
    const grams = item.grams;
    const name = resolvedNames[i];
    const parsed = pairingReliable ? segmentQuantities[i] : null;
    const { quantity: originalQuantity, unit: originalUnit } = parsed || { quantity: null, unit: null };
    const typed = (field) => (parsed ? typedAnchor(parsed, field) : null);

    // A Nutrition row always wins, scaled by count when usable, else by weight.
    // A row with neither counts as 1.
    const tableEntry = findNutritionEntry(name);
    const tableGrams = tableEntry ? parseGramsFromAmount(tableEntry.amount) : null;
    let tableCount = null;
    if (tableEntry && tableEntry.amount) {
      const explicitCount = parseCountFromAmount(tableEntry.amount);
      tableCount = explicitCount !== null ? explicitCount : (tableGrams === null ? 1 : null);
    }

    // An anchored line ("300kcal cookie") derives the amount from the macro: energy,
    // else protein. The row needs a positive figure; weight beats count.
    const energyKcal = typed('kcal');
    const proteinG = typed('protein');
    const anchored = energyKcal !== null || proteinG !== null;
    const tableAnchorUsable = !!tableEntry && (
      (energyKcal !== null && tableEntry.calories > 0) || (proteinG !== null && tableEntry.protein > 0)
    );
    // "1 cup" against a "5g (1cup)" row is one serving, not the AI's cup.
    if (!anchored && tableCount !== null && amountNamesUnit(tableEntry.amount, originalUnit)) {
      item.count = originalQuantity ?? 1;
    }
    // A bare number ("3 eggs") on a counted row is that many, whatever the AI counted.
    if (!anchored && tableCount !== null && !originalUnit && originalQuantity !== null) item.count = originalQuantity;
    const useTableCount = tableCount !== null
      && (!anchored ? item.count !== null : (tableAnchorUsable && tableGrams === null));
    const useTableGrams = tableGrams !== null && (!anchored || tableAnchorUsable);
    const anchoredGrams = (kcalPer100g, proteinPer100g) => {
      if (energyKcal !== null) return gramsForAnchor(energyKcal, kcalPer100g, grams);
      if (proteinG !== null) return gramsForAnchor(proteinG, proteinPer100g, grams);
      return grams;
    };

    let itemCalories;
    let itemProtein;
    let source;
    let amount;
    let kcal;
    let protein;
    // Set only for a USDA/AI miss: the row 💾 would bank.
    let newRow = null;
    let usedCount = null;
    let usedGrams = grams;
    // Typed fiber/fat/carb win on every path; USDA only fills gaps.
    const extras = {};
    TYPED_MACRO_FIELDS.forEach((field) => {
      const value = typed(field);
      if (value !== null) extras[field] = value;
    });

    if (useTableCount) {
      const kcalPerUnit = tableEntry.calories / tableCount;
      const proteinPerUnit = tableEntry.protein / tableCount;
      if (energyKcal !== null) usedCount = kcalPerUnit > 0 ? energyKcal / kcalPerUnit : 0;
      else if (proteinG !== null) usedCount = proteinPerUnit > 0 ? proteinG / proteinPerUnit : 0;
      else usedCount = item.count;
      usedCount = roundPlaces(usedCount, 2);
      itemCalories = kcalPerUnit * usedCount;
      itemProtein = proteinPerUnit * usedCount;
      source = 'nutrition-table-count';
      // Grams when the row has a weight per unit; the note line keeps the count.
      const gramsPerUnit = nutritionGramsPerUnit(tableEntry);
      amount = gramsPerUnit !== null
        ? `${roundPlaces(usedCount * gramsPerUnit, 1)}g`
        : `×${usedCount}`;
    } else if (useTableGrams) {
      kcal = (tableEntry.calories / tableGrams) * 100;
      protein = (tableEntry.protein / tableGrams) * 100;
      usedGrams = anchoredGrams(kcal, protein);
      source = 'nutrition-table-grams';
    } else {
      usdaAttempts++;
      let candidates = [];
      let lookupFailed = false;
      try {
        candidates = await usdaLookupKcalCandidates(item.query);
      } catch {
        usdaFailureCount++;
        lookupFailed = true;
      }
      const picked = pickPlausibleMacros(candidates, item.kcalPer100gFallback, item.proteinPer100gFallback);
      ({ kcal, protein } = picked);
      if (picked.candidate) usdaCandidateByName.set(name.toLowerCase(), picked.candidate);
      usedGrams = anchoredGrams(kcal, protein);
      TYPED_MACRO_FIELDS.forEach((field) => {
        if (extras[field] === undefined && picked[field] !== null) extras[field] = (picked[field] * usedGrams) / 100;
      });
      source = lookupFailed ? 'usda-unreachable' : 'usda/ai';

      // Never banks an offline guess. Per 100g under the user's name, for reuse.
      if (!lookupFailed) {
        newRow = { name, amount: '100g', calories: Math.round(kcal), protein: Math.round(protein) };
        TYPED_MACRO_FIELDS.forEach((field) => {
          if (extras[field] !== undefined) newRow[field] = roundPlaces((extras[field] / usedGrams) * 100, 1);
        });
        if (autoBank) newNutritionRows.push(newRow);
      }
    }
    // Both weight paths price per 100g.
    if (!useTableCount) {
      itemCalories = (kcal * usedGrams) / 100;
      itemProtein = (protein * usedGrams) / 100;
      amount = `${roundPlaces(usedGrams, 1)}g`;
    }

    // A typed anchor stands exactly as typed, without rounding drift.
    if (energyKcal !== null) itemCalories = energyKcal;
    if (proteinG !== null) itemProtein = proteinG;

    // Tidied note line: typed anchors and units stay (canonical, glued: "100kcal 5p",
    // "50g"); a bare count becomes what Calculate resolved.
    const anchorText = parsed ? anchorNoteText(parsed.anchors) : '';
    let noteQuantity;
    if (anchorText) {
      noteQuantity = anchorText;
    } else if (originalUnit && !anchored) {
      noteQuantity = `${originalQuantity ?? 1}${UNIT_CANONICAL[originalUnit] || originalUnit}`;
    } else if (source === 'nutrition-table-count') {
      noteQuantity = `${usedCount ?? originalQuantity ?? 1}x`;
    } else {
      noteQuantity = amount;
    }
    const noteLine = `${noteQuantity} ${name}`;

    console.debug(`[calc] ${name}: ${JSON.stringify({
      query: item.query,
      grams,
      count: item.count,
      energyKcal,
      proteinG,
      usedGrams,
      usedCount,
      source,
      kcalPer100gFallback: item.kcalPer100gFallback,
      proteinPer100gFallback: item.proteinPer100gFallback,
      kcalPer100gUsed: kcal,
      proteinPer100gUsed: protein,
      itemCalories,
      itemProtein,
    })}`);
    return { name, amount, source, itemCalories, itemProtein, extras, noteLine, newRow };
  }));
  const calories = Math.round(perItemMacros.reduce((sum, m) => sum + m.itemCalories, 0));
  // One decimal, as each row: the Total must match the rows added by hand.
  const protein = roundPlaces(perItemMacros.reduce((sum, m) => sum + m.itemProtein, 0), 1);
  console.debug('[calc] total kcal:', calories, 'total protein g:', protein);

  // Highest calories first, for both the table and the tidied notes.
  const sortedMacros = [...perItemMacros].sort((a, b) => b.itemCalories - a.itemCalories);

  const breakdown = sortedMacros.map((m) => {
    const row = {
      name: m.name,
      amount: m.amount,
      calories: Math.round(m.itemCalories),
      protein: roundPlaces(m.itemProtein, 1),
      source: BREAKDOWN_SOURCE_LABELS[m.source] || m.source,
      // Lets the next Calculate reuse an unchanged line.
      noteLine: m.noteLine,
      // Only a still-unbanked miss keeps one; it's what shows 💾.
      newRow: autoBank ? null : m.newRow,
    };
    // Left unset when unknown, so estimateTefBreakdown can still fill it from Nutrition.
    TYPED_MACRO_FIELDS.forEach((field) => {
      if (m.extras[field] !== undefined) row[BREAKDOWN_MACRO_KEY[field]] = roundPlaces(m.extras[field], 2);
    });
    return row;
  });

  // Every USDA lookup failed: almost surely offline, so nothing gets banked.
  const usdaUnreachable = usdaAttempts > 0 && usdaFailureCount === usdaAttempts;

  const dedupedNewRows = [...new Map(newNutritionRows.map((r) => [r.name.toLowerCase(), r])).values()];
  if (dedupedNewRows.length) {
    await Promise.all(dedupedNewRows.map(bankNewNutritionRow));
    await refreshNutrition(true);
  }

  // One ingredient per line, quantity glued to its unit.
  const standardizedNotes = sortedMacros.map((m) => m.noteLine).join('\n');

  return { calories, protein, breakdown, standardizedNotes, usdaUnreachable };
}

// The USDA panel for a new row as its Micronutrients cell ('' if none). After a
// reload the candidate is looked up again.
async function usdaMicronutrientsForNewRow(newRow) {
  let candidate = usdaCandidateByName.get(newRow.name.toLowerCase());
  if (!candidate) {
    try {
      candidate = pickPlausibleUsdaCandidate(await usdaLookupKcalCandidates(newRow.name), newRow.calories);
    } catch {
      candidate = null;
    }
  }
  const grams = parseGramsFromAmount(newRow.amount);
  if (!candidate || !candidate.nutrients.length || !grams) return '';
  const panel = nutrientPanelFromCandidate(candidate, grams);
  const top = nutritionTopValues({
    calories: newRow.calories, protein: newRow.protein,
    ...newRowOptionalMacros(newRow), tef: null,
    micronutrients: JSON.stringify(panel),
  });
  return nutritionColumnL(top, panel, new Set());
}

// Adds a new row to Nutrition with its USDA panel.
async function bankNewNutritionRow(newRow) {
  return addNutritionEntry({ ...newRow, micronutrients: await usdaMicronutrientsForNewRow(newRow) });
}

// A new row's fiber/fat/carb, null when unknown.
function newRowOptionalMacros(newRow) {
  return { fiber: newRow.fiber ?? null, fat: newRow.fat ?? null, carb: newRow.carb ?? null };
}

// 💾 on a USDA/AI row: banks it as-is, then every line of that food reads ✅.
function makeAddToNutritionButton(row, breakdown, totalCalories, totalProtein, form) {
  const btn = document.createElement('button');
  btn.type = 'button';
  // Sits beside ✏️, so styled like it.
  btn.className = 'btn row-action-btn';
  btn.textContent = '💾';
  btn.title = `Not in your Nutrition table yet — save "${row.name}" (${row.newRow.amount}, ${row.newRow.calories} kcal, ${row.newRow.protein}g protein) so it's a trusted lookup next time instead of a fresh guess`;
  btn.setAttribute('aria-label', `Save ${row.name} to Nutrition`);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      await bankNewNutritionRow(row.newRow);
      await refreshNutrition(true);
      const savedName = row.newRow.name;
      breakdown.forEach((r) => {
        if (r.newRow && r.newRow.name === savedName) {
          r.newRow = null;
          r.source = NUTRITION_TABLE_SOURCE_LABEL;
        }
      });
      renderCalcBreakdown(breakdown, totalCalories, totalProtein, form);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '💾';
      showFieldError(`${form}-form-error`, err.message);
    }
  });
  return btn;
}

// ✏️ on a USDA/AI row: Nutrition's Add form prefilled with the guess; Save banks
// the fix and reprices this line.
function makeEditNewRowButton(row, breakdown, form) {
  return makeRowActionButton({
    emoji: '✏️',
    title: `Not quite right? Fix "${row.name}"'s numbers before saving — Save banks the correction and updates this line`,
    onClick: () => {
      const consumedAmount = row.amount;
      // A page over the day's, under the ingredient's own address.
      routeRecordEdit('nutrition', { slug: routeSlug(row.name), label: row.name });
      openNutritionForm({
        row: null,
        group: '',
        name: row.name,
        amount: row.newRow.amount,
        calories: row.newRow.calories,
        protein: row.newRow.protein,
        ...newRowOptionalMacros(row.newRow),
        tef: null,
        verified: false,
        proteinPercent: null,
        micronutrients: null,
      }, (saved) => applyEditedRowToBreakdown(row, saved, consumedAmount, breakdown, form));
    },
  });
}

// Saved Amount -> eaten amount: by weight, else count, else 1.
function scaleFactorBetweenAmounts(basisAmount, consumedAmount) {
  const basisGrams = parseGramsFromAmount(basisAmount);
  const consumedGrams = parseGramsFromAmount(consumedAmount);
  if (basisGrams && consumedGrams !== null) return consumedGrams / basisGrams;

  const basisCount = parseCountFromAmount(basisAmount);
  const consumedCount = parseCountFromAmount(consumedAmount);
  if (basisCount && consumedCount !== null) return consumedCount / basisCount;

  return 1;
}

// A breakdown's Total: whole kcal, protein to one decimal.
function breakdownTotals(breakdown) {
  return {
    calories: Math.round(breakdown.reduce((sum, r) => sum + r.calories, 0)),
    protein: roundPlaces(breakdown.reduce((sum, r) => sum + r.protein, 0), 1),
  };
}

// ✏️'s Save: replaces `row` with the corrected figures at this line's amount, then re-totals.
function applyEditedRowToBreakdown(row, saved, consumedAmount, breakdown, form) {
  const idx = breakdown.indexOf(row);
  if (idx === -1) return;

  const scale = scaleFactorBetweenAmounts(saved.amount, consumedAmount);
  breakdown[idx] = {
    ...scaledBreakdownRow(row, row.amount, saved, scale, BREAKDOWN_MACRO_KEY),
    source: NUTRITION_TABLE_SOURCE_LABEL,
    newRow: null,
  };

  const { calories: totalCalories, protein: totalProtein } = breakdownTotals(breakdown);
  // Before the render, so the drawn table and Breakdown field already match.
  if (form === 'physique') syncPhysiqueTotalsFromBreakdown(breakdown, totalCalories, totalProtein);
  renderCalcBreakdown(breakdown, totalCalories, totalProtein, form);
}

// Source and 💾 share a column. Matched on any past tab name, so old breakdowns read ✅.
function sourceCell(row, breakdown, totalCalories, totalProtein, form) {
  const cell = document.createElement('td');
  const fromTable = NUTRITION_TABLE_SOURCE_LABELS.includes(row.source);

  const label = document.createElement('span');
  label.textContent = fromTable ? '✅' : row.source;
  label.title = row.source;
  cell.appendChild(label);

  if (row.newRow) {
    cell.append(
      ' ', makeAddToNutritionButton(row, breakdown, totalCalories, totalProtein, form),
      ' ', makeEditNewRowButton(row, breakdown, form),
    );
  }
  return cell;
}

// "—" for a macro not measured yet, rather than a confident 0.
function macroCell(value, decimals = 1) {
  return makeCell(value === undefined ? '—' : value.toFixed(decimals));
}

function appendTableRow(tbody, className, cells) {
  const tr = document.createElement('tr');
  if (className) tr.className = className;
  tr.append(...cells);
  tbody.appendChild(tr);
}

// The per-ingredient table under Consumption. Its Total uses the given totals, not a
// re-sum of rounded rows. Physique also mirrors the JSON into its Breakdown field.
function renderCalcBreakdown(breakdown, totalCalories, totalProtein, form = 'physique') {
  const tbody = document.getElementById(`${form}-calc-breakdown-body`);
  tbody.innerHTML = '';

  const totals = {};
  let totalGrams = 0;
  let totalCount = 0;
  // Gray, so amounts don't read as calories.
  const amountCell = (text) => {
    const td = makeCell(text);
    td.className = 'neutral';
    return td;
  };

  mergeDuplicateBreakdownRows(breakdown).forEach((row) => {
    appendTableRow(tbody, '', [
      makeCell(row.name),
      amountCell(row.amount),
      makeCell(String(row.calories)),
      makeCell(row.protein.toFixed(1)),
      macroCell(row.fiber),
      macroCell(row.fat),
      macroCell(row.carbohydrate),
      macroCell(row.tef, 0),
      sourceCell(row, breakdown, totalCalories, totalProtein, form),
    ]);

    const quantity = breakdownQuantity(row.amount) || 0;
    if (row.amount.startsWith('×')) totalCount += quantity;
    else totalGrams += quantity;
    OPTIONAL_TOTAL_KEYS.forEach((key) => {
      if (row[key] !== undefined) totals[key] = (totals[key] || 0) + row[key];
    });
  });

  // Whole grams, floored as the Derived table shows them.
  const totalCell = (value) => makeCell(value === undefined ? '—' : String(Math.floor(value)));
  // Grams and counts can't add, so each sums on its own: "850g + ×3".
  const totalAmount = [
    totalGrams ? `${roundPlaces(totalGrams, 1)}g` : '',
    totalCount ? `×${roundPlaces(totalCount, 1)}` : '',
  ].filter(Boolean).join(' + ');
  appendTableRow(tbody, 'calc-breakdown-total', [
    makeCell('Total'),
    amountCell(totalAmount),
    totalCell(totalCalories),
    totalCell(totalProtein),
    totalCell(totals.fiber),
    totalCell(totals.fat),
    totalCell(totals.carbohydrate),
    macroCell(totals.tef, 0),
    makeCell(''),
  ]);

  // Today's desired figures, on Physique's form for today only. Fat/Carbohydrate are
  // FDA Daily Values; TEF is the desired calories' digestion cost.
  if (form === 'physique' && physiqueField('date').value === isoFromDate(new Date())) {
    const healthEntries = physiqueAsHealthEntries();
    const calorieDesired = getCalorieDesired(healthEntries);
    const proteinBand = getProteinDesiredBandG(healthEntries);
    const fiberBand = getFiberDesiredBandG(healthEntries);
    const dailyDesired = nutrientDailyDesired();

    const desireCalories = Math.round(calorieDesired.kcal);
    // Null when Settings leaves the nutrient out: shown as —.
    const desireFat = dailyDesired[USDA_MACRO_NUTRIENT.fat]?.amount ?? null;
    const desireCarb = dailyDesired[USDA_MACRO_NUTRIENT.carb]?.amount ?? null;
    const desireTef = Math.round(calorieDesired.kcal * (1 - tefDivisor()));
    appendTableRow(tbody, 'calc-breakdown-desired', [
      makeCell('Desire', `${calorieDesired.full} desired calories, current protein/fiber band floors (${formatProteinDesiredBand(proteinBand)} / ${formatProteinDesiredBand(fiberBand)} full range), Fat/Carbohydrate FDA Daily Values and the TEF their own digestion costs — from Tune and Settings, not today's Consumption`),
      makeCell(''),
      makeCell(String(desireCalories)),
      makeCell(String(proteinBand.min)),
      makeCell(String(fiberBand.min)),
      makeCell(desireFat === null ? '—' : String(desireFat)),
      makeCell(desireCarb === null ? '—' : String(desireCarb)),
      makeCell(desireTef > 0 ? String(desireTef) : '—'),
      makeCell(''),
    ]);
  }

  // Keeps the Breakdown field in step with every redraw (e.g. after 💾).
  if (form === 'physique') {
    document.getElementById('physique-breakdown').value = breakdownToJson(breakdown);
  }

  document.getElementById(`${form}-calc-breakdown`).hidden = false;
}

// Hides only the table; the Breakdown field is the user's to clear.
function hideCalcBreakdown(form = 'physique') {
  document.getElementById(`${form}-calc-breakdown`).hidden = true;
  document.getElementById(`${form}-calc-breakdown-body`).innerHTML = '';
}
