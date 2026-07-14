// AI-powered calorie estimation behind Physique's 🧮 Calculate:
// parses a freeform ingredient description (Groq), checks each item against
// the personal Nutrition table (nutrition.js) first, and only for a
// miss there cross-checks calorie density against real nutrition data (USDA
// FoodData Central) — banking that result back into the table for next time
// — before handing the result back. Wired up by physique.js, which runs it
// over the Consumption field one day at a time.

// JSON-encodes a breakdown array for the Physique tab's Breakdown column, or
// '' for "nothing to save" (an empty cell reads back as [] either way, so
// there's no ambiguity, just a tidier sheet).
function breakdownToJson(breakdown) {
  return (breakdown && breakdown.length) ? JSON.stringify(breakdown) : '';
}

// For renderCalcBreakdown's table ONLY — never applied to the saved breakdown
// itself (see the caution there). Two Consumption lines for the same
// ingredient (e.g. "38g onion" and "28g onion", typed separately) merge into
// one displayed row rather than showing twice — the Total already treats
// them as one, so the split served no purpose. Grouped by name AND amount
// type (grams vs count, "×N"), since those aren't the same quantity and
// summing them would be meaningless. Density is recomputed off the merged
// calories/grams rather than kept from either original row, so it stays the
// true rate for the combined amount.
function mergeDuplicateBreakdownRows(rows) {
  const merged = new Map();

  rows.forEach((row) => {
    const isCount = row.amount.startsWith('×');
    const key = `${row.name.toLowerCase()}|${isCount ? 'count' : 'grams'}`;
    const quantity = parseFloat(row.amount.replace('×', ''));
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...row, quantity });
      return;
    }

    existing.quantity += quantity;
    existing.calories += row.calories;
    existing.protein = Math.round((existing.protein + row.protein) * 10) / 10;
    existing.amount = isCount ? `×${existing.quantity}` : `${Math.round(existing.quantity * 10) / 10}g`;
    // Count-based density is per-unit, not per-gram, so a merged unit count
    // still charges the same per-unit rate rather than a recomputed one.
    if (!isCount) existing.density = `${Math.round((existing.calories / existing.quantity) * 1000) / 10} kcal/100g`;
    if (existing.source !== row.source) existing.source = `${existing.source} + ${row.source}`;
    existing.noteLine = `${existing.noteLine}\n${row.noteLine}`;
    if (!existing.newRow && row.newRow) existing.newRow = row.newRow;
  });

  // Re-sorted since merging can change which row has the most calories.
  return [...merged.values()]
    .sort((a, b) => b.calories - a.calories)
    .map(({ quantity, ...row }) => row);
}

// USDA search can rank a token-overlap false match above the actual food (e.g.
// "soybeans" → "Oil, soybean" at 884 kcal/100g instead of the bean at ~140).
// Trust a database candidate only if it's in the same ballpark as the model's
// own estimate for this food; otherwise the candidates are probably all
// off-category and the model's estimate is the safer number to use. Protein
// is read off that same trusted/untrusted candidate rather than picked
// independently, since a false-match candidate is wrong for both macros at once.
function pickPlausibleMacros(candidates, kcalFallback, proteinFallback) {
  if (!candidates.length) return { kcal: kcalFallback, protein: proteinFallback };

  const best = candidates.reduce((a, b) =>
    Math.abs(Math.log(a.kcalPer100g / kcalFallback)) < Math.abs(Math.log(b.kcalPer100g / kcalFallback)) ? a : b
  );
  const ratio = best.kcalPer100g / kcalFallback;
  const trusted = ratio <= 2.5 && ratio >= 1 / 2.5;
  return {
    kcal: trusted ? best.kcalPer100g : kcalFallback,
    protein: (trusted && best.proteinPer100g !== null) ? best.proteinPer100g : proteinFallback,
  };
}

// Deterministic (non-AI) split of the Notes text into per-ingredient segments
// — used to recover each AI-extracted item's identity from the user's OWN
// text rather than the model's "query" field (see estimateCaloriesAndProtein
// below). Split on comma/newline only (not " and " — that would wrongly
// split e.g. "macaroni and cheese").
function splitNotesIntoSegments(notes) {
  return notes.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

// Strips a leading quantity — a number (e.g. "2", "1.5", "2-3") plus an
// optional unit glued directly onto it with no space (e.g. "100g", "30ml")
// — off a segment, leaving just the food name portion. This is what's
// matched against the Nutrition table and what a new row gets banked
// under, instead of the model's own "query" phrasing. Without the unit list
// here, "100g egg white" would strip only "100" and leave "g egg white" as
// the name — a real bug that banked a bogus "g egg white" row alongside an
// existing "egg white" one instead of matching it.
const INGREDIENT_UNIT_WORDS_BASE = 'g|gram|grams|kg|kilogram|kilograms|mg|milligram|milligrams|oz|ounce|ounces|lb|lbs|pound|pounds|ml|milliliter|milliliters|l|liter|liters|litre|litres|cup|cups|tbsp|tbsps|tablespoon|tablespoons|tsp|tsps|teaspoon|teaspoons|slice|slices|piece|pieces|serving|servings|scoop|scoops|spray|sprays|shot|shots|can|cans|clove|cloves';
// An energy "unit" is an anchor, not a quantity: "300kcal cookie" says how
// much energy was eaten, not how much cookie — so Calculate runs its usual
// scaling backwards (density → how much of the food that is) and rewrites
// the note with the real weight/count it worked out. Longest spelling first
// so the capture group reads the whole word. Leading-only, like "x": a
// trailing "calories" belongs to a food's name, not to a unit slot.
// "cal"/"cals" are food labelling's usual shorthand for kilocalories, not
// gram-calories, so they map 1:1 to kcal; kJ (EU labels) is converted.
const ENERGY_UNIT_TO_KCAL = {
  kcal: 1, kcals: 1, calories: 1, calorie: 1, cals: 1, cal: 1,
  kilojoules: 1 / 4.184, kilojoule: 1 / 4.184, kj: 1 / 4.184,
};
const ENERGY_UNIT_WORDS = 'kcal|kcals|calories|calorie|cals|cal|kilojoules|kilojoule|kj';
// A protein anchor, same idea as the energy one above but for grams of
// protein: "20p chicken" means 20g of protein were eaten, not 20g of chicken.
const PROTEIN_UNIT_WORDS = 'p';
// "x" is a placeholder pseudo-unit (see below) — included in the LEADING
// pattern only (not the trailing one) so a note already standardized once
// (e.g. "1x apple") still parses correctly on a later re-Calculate, instead
// of leaving "1x" stuck in the name.
const INGREDIENT_UNIT_WORDS = `x|${ENERGY_UNIT_WORDS}|${PROTEIN_UNIT_WORDS}|${INGREDIENT_UNIT_WORDS_BASE}`;
const INGREDIENT_QUANTITY_PATTERN = new RegExp(
  `^\\s*([\\d.]+)(?:\\s*[-/]\\s*[\\d.]+)?\\s*(${INGREDIENT_UNIT_WORDS})?\\b\\.?\\s*`, 'i'
);

// A quantity written as a division ("200/5g bar" — a 200g bar split 5 ways)
// is resolved to one number before Groq ever sees the text, rather than
// trusting an LLM to do the arithmetic itself. Only a unit-glued fraction
// matches — a bare "2-3" (range/uncertainty, not arithmetic) is untouched.
const DIVISION_QUANTITY_PATTERN = new RegExp(
  `(^|[,\\n]\\s*)([\\d.]+)\\s*/\\s*([\\d.]+)\\s*(${INGREDIENT_UNIT_WORDS})\\b`, 'gi'
);
function resolveDivisionQuantities(notes) {
  return notes.replace(DIVISION_QUANTITY_PATTERN, (full, lead, num, denom, unit) => {
    const denomNum = parseFloat(denom);
    if (!denomNum) return full;
    return `${lead}${Math.round((parseFloat(num) / denomNum) * 100) / 100}${unit}`;
  });
}

// A trailing descriptive unit word (e.g. "watermelon slice") is dropped too
// — the leading pattern above only strips a unit stuck to the number, this
// catches the same word when it shows up at the end of the name instead.
const TRAILING_UNIT_PATTERN = new RegExp(`\\s+(?:${INGREDIENT_UNIT_WORDS_BASE})\\s*$`, 'i');
// A generic size adjective right after the quantity (e.g. "1 small onion")
// doesn't change what the food IS or its per-100g density — only its
// weight, which an actual gram figure already conveys once Calculate
// determines one — so it's dropped from the identity/name entirely rather
// than kept as a second, redundant size signal alongside a real weight.
// Deliberately excludes words like "mini" that usually denote a distinct
// discrete product (a mini muffin has its own, quite different, calorie
// count from a regular one — not just a smaller version of the same food).
const SIZE_DESCRIPTOR_WORDS = 'extra small|extra large|small|medium|large|big|jumbo|tiny';
const LEADING_DESCRIPTOR_PATTERN = new RegExp(`^(?:${SIZE_DESCRIPTOR_WORDS})\\s+`, 'i');
function extractIngredientName(segment) {
  return segment
    .replace(INGREDIENT_QUANTITY_PATTERN, '')
    .replace(LEADING_DESCRIPTOR_PATTERN, '')
    .replace(TRAILING_UNIT_PATTERN, '')
    .trim();
}

// A fixed real-world weight for a unit the AI otherwise has to guess at
// (a "shot" gives no hint of its own) — 30g/ml is the standard single-shot
// pour, so it's used to compute grams directly instead of trusting Groq's
// estimate for it. Only "shot"/"shots" is hardcoded like this; other units
// (cup, tbsp, ...) vary too much by ingredient density to do the same.
const UNIT_TO_GRAMS = { shot: 30, shots: 30 };
// Units naturally counted one-by-one (plus the "x" placeholder) — when the
// user types one of these, the count is already known exactly from the
// number they typed, so it's trusted over Groq's own "count" extraction,
// which can (as observed with "spray") decide a unit isn't discrete at all
// and silently fall back to a raw gram guess — ignoring a Nutrition
// row's own per-unit count entirely. Deliberately excludes weight/volume
// units (g, cup, tbsp, ...): those describe a measured amount, not "how
// many", so forcing a count from them wouldn't mean anything.
const COUNT_LIKE_UNITS = new Set(['x', 'piece', 'pieces', 'serving', 'servings', 'scoop', 'scoops', 'slice', 'slices', 'spray', 'sprays', 'shot', 'shots', 'can', 'cans', 'clove', 'cloves']);
function extractIngredientQuantity(segment) {
  const match = segment.match(INGREDIENT_QUANTITY_PATTERN);
  if (!match) return { quantity: null, unit: null };
  return { quantity: parseFloat(match[1]), unit: match[2] ? match[2].toLowerCase() : null };
}

// The calorie figure this item was anchored to, or null if the user gave a
// normal quantity instead. Everything downstream works in kcal, so a kJ
// amount is converted here rather than carrying its own unit around.
function extractEnergyTarget({ quantity, unit }) {
  if (!unit || ENERGY_UNIT_TO_KCAL[unit] === undefined) return null;
  return Math.max(0, (quantity ?? 0) * ENERGY_UNIT_TO_KCAL[unit]);
}

// The inverse of the usual grams → calories scaling: how much of a food of
// known density adds up to a target calorie count. A zero/unknown density
// (e.g. "300kcal water" — a contradiction) would divide to Infinity, so it
// falls back to the AI's own gram estimate for the item instead.
function gramsForEnergy(energyKcal, kcalPer100g, fallbackGrams) {
  return kcalPer100g > 0 ? (energyKcal / kcalPer100g) * 100 : fallbackGrams;
}

// Protein-anchor equivalent of extractEnergyTarget/gramsForEnergy above —
// "20p chicken" gives the protein grams eaten instead of a weight, so the
// weight is derived the same way, off protein density instead of calorie density.
function extractProteinTarget({ quantity, unit }) {
  if (unit !== 'p') return null;
  return Math.max(0, quantity ?? 0);
}
function gramsForProtein(proteinG, proteinPer100g, fallbackGrams) {
  return proteinPer100g > 0 ? (proteinG / proteinPer100g) * 100 : fallbackGrams;
}

// Canonical display form for the Notes standardization below — collapses
// plurals/synonyms/abbreviation variants to one spelling (e.g. "shots" and
// "shot" both -> "shot") so the same unit always reads the same way in a
// saved note, regardless of how it was typed.
const UNIT_CANONICAL = {
  x: 'x',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece',
  serving: 'serving', servings: 'serving',
  scoop: 'scoop', scoops: 'scoop',
  spray: 'spray', sprays: 'spray',
  shot: 'shot', shots: 'shot',
  can: 'can', cans: 'can',
  clove: 'clove', cloves: 'clove',
};

// Pure calorie/protein estimation core — no DOM reads or writes — shared by
// the single-day Calculate button and the Physique table's bulk
// Recalculate action (wellness.js). Returns {calories, protein, breakdown,
// usdaUnreachable} or throws (bad/empty input, Groq failure, etc.). Never
// touches the Notes text itself — the caller's notes are the ones saved,
// verbatim, no matter what the AI extraction below returns.
// autoBank: whether a miss (USDA/AI-only estimate) gets saved to the
// Nutrition table immediately. The interactive Calculate button (see
// physique.js's Calculate) sets this false and instead surfaces an "Add"
// button per row in the breakdown, so a typo'd/misphrased name (e.g. "oilve
// oil" not matching an existing "olive oil" row) is caught and fixed by hand
// — recalculate after editing Notes — rather than silently banking a
// same-food duplicate row under the wrong name. Bulk Calculate (physique.js's
// bulkCalculatePhysique) has no per-row review UI, so it leaves this true.
async function estimateCaloriesAndProtein(notesText, { autoBank = true } = {}) {
  const notes = resolveDivisionQuantities(notesText.trim());
  if (!notes) throw new Error('No ingredients to calculate from.');

  // Only the ingredient SPLIT (Groq) is cached by exact text — that round
  // trip isn't guaranteed bit-for-bit reproducible (batched GPU inference
  // means even temperature 0 + a fixed seed can shift slightly run to run),
  // so caching it keeps repeat clicks on the same Notes splitting into the
  // same items/quantities instead of a fresh roll each time. The macro
  // LOOKUP below this is deliberately never cached: it always re-checks the
  // Nutrition table fresh, so adding or editing a table row and
  // recalculating the exact same Notes text picks up the change immediately
  // instead of silently replaying a result computed before that row existed
  // or was corrected.
  // Cache key versioned to "v2": v1 entries carry a "notes" field that no
  // longer exists.
  const extractCacheKey = `calc-extract-v2:${notes.toLowerCase()}`;
  let extraction = getCached(extractCacheKey, Infinity);
  if (!extraction) {
    extraction = await groqExtractIngredients(notes);
    setCached(extractCacheKey, extraction);
  }
  const { items } = extraction;

  // The model's own "query" field is intentionally NOT trusted as an item's
  // identity — it's free to phrase it however suits a database search (e.g.
  // "egg" -> "egg, whole"), and using it for the Nutrition match/bank
  // below would let the AI silently rename what the user typed. Instead,
  // deterministically split the user's OWN text the same way and, whenever
  // that split lines up 1:1 with the model's items (the overwhelmingly
  // common case — one segment per item), pair them by position and use the
  // user's own text as that item's name. If the model split/merged
  // differently this one time, there's no safe way to attribute a name back
  // to a specific segment, so fall back to "query" for just this item rather
  // than guess wrong.
  const segments = splitNotesIntoSegments(notes);
  const pairingReliable = segments.length === items.length;
  const segmentQuantities = pairingReliable ? segments.map(extractIngredientQuantity) : [];
  const resolvedNames = items.map((item, i) =>
    pairingReliable ? extractIngredientName(segments[i]) : item.query
  );

  // Override Groq's own gram-weight guess for units with a fixed real-world
  // weight (currently just "shot" — see UNIT_TO_GRAMS), and override its
  // "count" for any discrete unit (see COUNT_LIKE_UNITS) with what the user
  // actually typed — both deterministic and always right, instead of a
  // per-call AI guess for something that isn't actually in question. Same
  // 1:1 pairing guard as resolvedNames above.
  if (pairingReliable) {
    items.forEach((item, i) => {
      const { quantity, unit } = segmentQuantities[i];
      if (unit && UNIT_TO_GRAMS[unit]) {
        item.grams = (quantity ?? 1) * UNIT_TO_GRAMS[unit];
      }
      if (unit && COUNT_LIKE_UNITS.has(unit)) {
        item.count = quantity ?? 1;
      }
    });
  }

  let usdaAttempts = 0;
  let usdaFailureCount = 0;
  // Ingredients that missed the Nutrition table this round and had
  // to be estimated via USDA/AI — saved back to the table below so the
  // same food is a trusted lookup hit next time instead of a fresh guess.
  const newNutritionRows = [];

  const perItemMacros = await Promise.all(items.map(async (item, i) => {
    const grams = item.grams;
    const name = resolvedNames[i];
    const { quantity: originalQuantity, unit: originalUnit } = pairingReliable ? segmentQuantities[i] : { quantity: null, unit: null };

    // A previously-verified (or manually entered, brand-matched) row
    // always wins over a fresh guess — skip USDA/plausibility-checking
    // entirely for this item. Matched by count first when possible — a
    // discrete/whole-unit food (e.g. "1 rice cake", or "1 (50g)" — a
    // leading count *and* a reference gram figure) is scaled by unit count
    // (Amount's leading number vs. the AI's estimated count eaten), since
    // multiplying by an exact count is more reliable than trusting the
    // AI's estimated total gram weight for an item it may not know the
    // typical weight of. Only when no count is usable (a plain weight like
    // "250g" with no leading count, or the AI couldn't extract a
    // whole-unit count this time) does it fall back to weight: a gram
    // figure in Amount scaled against the AI's estimated grams eaten. A
    // row with neither usable is treated as a miss, same as no row at all.
    // Matched by the user's OWN name (see resolvedNames above) — never by
    // the model's "query" — so the AI can't opportunistically match (or
    // bank a new row under) a name it invented instead of what was typed.
    const tableEntry = findNutritionEntry(name);
    const tableGrams = tableEntry ? parseGramsFromAmount(tableEntry.amount) : null;
    let tableCount = null;
    if (tableEntry && tableEntry.amount) {
      const explicitCount = parseCountFromAmount(tableEntry.amount);
      tableCount = explicitCount !== null ? explicitCount : (tableGrams === null ? 1 : null);
    }

    // An energy-anchored item ("300kcal cookie") uses the same three sources
    // in the same order of trust, just read backwards — the calories are
    // already known exactly, and it's the weight/count that gets derived
    // from the density. Two things differ from the normal path:
    //  - the table row has to carry a positive calorie figure to divide by,
    //    otherwise there's nothing to convert against and it's treated as a
    //    miss (falls through to USDA/AI) rather than dividing by zero;
    //  - weight wins over count here, the reverse of the precedence below.
    //    "300kcal cookie" is most useful rewritten as the weight to put on
    //    the scale, so ×N is only used for a row that has no gram figure at
    //    all (e.g. "1 rice cake") and therefore can't express one.
    const energyKcal = pairingReliable ? extractEnergyTarget(segmentQuantities[i]) : null;
    // Protein anchor ("20p chicken") — same backwards read as the energy
    // anchor above, off protein density instead of calorie density. The two
    // are mutually exclusive (one unit per segment), so at most one is set.
    const proteinG = pairingReliable ? extractProteinTarget(segmentQuantities[i]) : null;
    const anchored = energyKcal !== null || proteinG !== null;
    const tableAnchorUsable = !!tableEntry && (
      (energyKcal !== null && tableEntry.calories > 0) || (proteinG !== null && tableEntry.protein > 0)
    );
    const useTableCount = !!tableEntry && tableCount !== null
      && (!anchored ? item.count !== null : (tableAnchorUsable && tableGrams === null));
    const useTableGrams = !!tableEntry && tableGrams !== null && (!anchored || tableAnchorUsable);

    let itemCalories;
    let itemProtein;
    let source;
    let amount;
    let kcal;
    let protein;
    // Shown as its own "Density" column in the Calculate breakdown
    // table so the actual figure applied (not just the final total) is
    // visible without needing DevTools — this is what distinguishes "the
    // math is right but the stored density is wrong" from "the wrong branch
    // fired" when a total looks implausible.
    let density;
    // Set only for a fresh USDA/AI miss (never for a Nutrition hit) —
    // the not-yet-saved row this item would bank, surfaced in the breakdown
    // as an opt-in "Add" button when autoBank is false.
    let newRow = null;
    // The quantity actually used, once an energy anchor has been resolved
    // against a density — the AI's own grams/count estimate otherwise. Read
    // back below to rewrite this item's Notes line in the resolved unit.
    let usedCount = null;
    let usedGrams = grams;

    if (useTableCount) {
      const kcalPerUnit = tableEntry.calories / tableCount;
      const proteinPerUnit = tableEntry.protein / tableCount;
      if (energyKcal !== null) usedCount = kcalPerUnit > 0 ? energyKcal / kcalPerUnit : 0;
      else if (proteinG !== null) usedCount = proteinPerUnit > 0 ? proteinG / proteinPerUnit : 0;
      else usedCount = item.count;
      usedCount = Math.round(usedCount * 100) / 100;
      itemCalories = kcalPerUnit * usedCount;
      itemProtein = proteinPerUnit * usedCount;
      source = 'nutrition-table-count';
      amount = `×${usedCount}`;
      density = `${Math.round(kcalPerUnit * 10) / 10} kcal/unit`;
    } else if (useTableGrams) {
      kcal = (tableEntry.calories / tableGrams) * 100;
      protein = (tableEntry.protein / tableGrams) * 100;
      if (energyKcal !== null) usedGrams = gramsForEnergy(energyKcal, kcal, grams);
      else if (proteinG !== null) usedGrams = gramsForProtein(proteinG, protein, grams);
      itemCalories = (kcal * usedGrams) / 100;
      itemProtein = (protein * usedGrams) / 100;
      source = 'nutrition-table-grams';
      amount = `${Math.round(usedGrams * 10) / 10}g`;
      density = `${Math.round(kcal * 10) / 10} kcal/100g`;
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
      ({ kcal, protein } = pickPlausibleMacros(candidates, item.kcalPer100gFallback, item.proteinPer100gFallback));
      if (energyKcal !== null) usedGrams = gramsForEnergy(energyKcal, kcal, grams);
      else if (proteinG !== null) usedGrams = gramsForProtein(proteinG, protein, grams);
      itemCalories = (kcal * usedGrams) / 100;
      itemProtein = (protein * usedGrams) / 100;
      source = lookupFailed ? 'usda-unreachable' : 'usda/ai';
      amount = `${Math.round(usedGrams * 10) / 10}g`;
      density = `${Math.round(kcal * 10) / 10} kcal/100g`;

      // A failed lookup ran on a pure ungrounded AI guess — don't bank
      // that into the table as if it were verified. New rows are always
      // banked by weight (grams), even for a food that happened to be
      // logged by count this time — a stable per-100g figure is reusable
      // regardless of how the next mention phrases the quantity. Banked
      // under the user's own name (never item.query) so the exact text
      // they typed is what matches next time.
      if (!lookupFailed) {
        newRow = { name, amount: '100g', calories: Math.round(kcal), protein: Math.round(protein) };
        if (autoBank) newNutritionRows.push(newRow);
      }
    }

    // Standardized Notes line for this item: if the user typed a real unit
    // themselves (e.g. "50 g yogurt"), keep it — canonicalized and glued
    // straight to the number, no space (e.g. "50g"). Otherwise there was
    // just a bare count ("1 apple", "3 egg") or a calorie anchor ("300kcal
    // cookie") — replace that placeholder with whatever Calculate actually
    // determined: the real gram weight for a weight-resolved item
    // (Nutrition or USDA/AI), or the matched unit count for a
    // count-resolved one, since that's more informative than leaving "1x"
    // (or the calorie target, which the Amount field now carries anyway) in
    // the saved note once the real number is known.
    let noteQuantity;
    if (originalUnit && !anchored) {
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
    return { name, amount, source, density, itemCalories, itemProtein, noteLine, newRow };
  }));
  const calories = Math.round(perItemMacros.reduce((sum, m) => sum + m.itemCalories, 0));
  const protein = Math.round(perItemMacros.reduce((sum, m) => sum + m.itemProtein, 0));
  console.debug('[calc] total kcal:', calories, 'total protein g:', protein);

  // Highest-calorie ingredient first — both the breakdown table and the
  // standardized Notes below are built from this order, so what's saved to
  // Notes matches what's shown on screen.
  const sortedMacros = [...perItemMacros].sort((a, b) => b.itemCalories - a.itemCalories);

  // Per-item lines the modal shows after Calculate so the final Amount can
  // be sanity-checked by eye/pure arithmetic before saving, rather than
  // trusting the combined total blind — each row also names its source
  // (the personal table vs. a USDA/AI estimate) since that's the actual
  // trust distinction, not "AI did the math" (the summation itself is
  // always plain JS — the AI only ever supplies a per-item density
  // estimate, and only when there's no table match).
  const SOURCE_LABELS = {
    'nutrition-table-count': NUTRITION_TABLE_SOURCE_LABEL,
    'nutrition-table-grams': NUTRITION_TABLE_SOURCE_LABEL,
    'usda/ai': 'USDA estimate',
    'usda-unreachable': 'AI estimate (offline)',
  };
  const breakdown = sortedMacros.map((m) => ({
    name: m.name,
    amount: m.amount,
    calories: Math.round(m.itemCalories),
    protein: Math.round(m.itemProtein * 10) / 10,
    density: m.density,
    source: SOURCE_LABELS[m.source] || m.source,
    // The standardized Notes line this item produced. Stored so a later
    // Calculate can tell which lines are untouched and reuse their numbers
    // instead of re-extracting the lot (physique.js's incremental path). A
    // breakdown saved before this field existed simply never matches, so it
    // re-estimates in full — the old behaviour, not a failure.
    noteLine: m.noteLine,
    // Already banked (autoBank) or never eligible (a table hit) — only a
    // still-pending miss carries a newRow, which is what renderCalcBreakdown
    // uses to decide whether to show an "Add" button for this row.
    newRow: autoBank ? null : m.newRow,
  }));

  // Every USDA lookup that was actually attempted failed — almost certainly
  // a network/DNS problem, not a "no match" case. This ran on pure LLM
  // guesses with zero real grounding, so don't bank any of its numbers into
  // the Nutrition table as if they were verified: a retry once
  // connectivity is back should get a real, properly-grounded number
  // instead of replaying this ungrounded one forever.
  const usdaUnreachable = usdaAttempts > 0 && usdaFailureCount === usdaAttempts;

  const dedupedNewRows = [...new Map(newNutritionRows.map((r) => [r.name.toLowerCase(), r])).values()];
  if (dedupedNewRows.length) {
    await Promise.all(dedupedNewRows.map((r) => addNutritionEntry(r)));
    await refreshNutrition(true);
  }

  // Deterministic reformat of the user's own text — no AI involved — one
  // ingredient per line, quantity+unit glued with no space (e.g. "50g", "2x").
  const standardizedNotes = sortedMacros.map((m) => m.noteLine).join('\n');

  return { calories, protein, breakdown, standardizedNotes, usdaUnreachable };
}

// A row.newRow means this item missed the Nutrition table and was
// estimated fresh (USDA/AI) rather than looked up — nothing is banked
// automatically (see estimateCaloriesAndProtein's autoBank param), so the
// user reviews it here: either click 💾 to bank it as-is, or leave it
// and fix/retype the ingredient in Notes then Calculate again if the name
// was wrong (e.g. a typo not matching an existing row).
function makeAddToNutritionButton(row, breakdown, totalCalories, totalProtein, target) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = '💾';
  btn.title = `Not in your Nutrition table yet — save "${row.name}" (${row.newRow.amount}, ${row.newRow.calories} kcal, ${row.newRow.protein}g protein) so it's a trusted lookup next time instead of a fresh guess`;
  btn.setAttribute('aria-label', `Save ${row.name} to Nutrition`);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      await addNutritionEntry(row.newRow);
      await refreshNutrition(true);
      // Same food may appear more than once in one breakdown (e.g. split
      // across two Notes lines) — clear all matching rows' newRow so a
      // second click can't bank the same name twice in one go.
      breakdown.forEach((r) => { if (r.newRow && r.newRow.name === row.newRow.name) r.newRow = null; });
      renderCalcBreakdown(breakdown, totalCalories, totalProtein, target);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '💾';
      showFieldError(`${target}-form-error`, err.message);
    }
  });
  return btn;
}

// Renders the per-item breakdown table under Notes so the combined Amount
// can be checked by eye/pure arithmetic before saving — the Total row uses
// the exact same rounded totals written into the Amount field, not a
// re-sum of the (individually rounded, so slightly lossy) per-item rows.
// `target` names the form whose table to draw into — currently only Physique's
// (physique.js), which keeps the same JSON in a field of its own and so gets it
// rewritten here too.
// Source and Save are one column, because they're two halves of the same fact
// and can never both carry content: a Nutrition hit is already banked by
// definition (it's where the numbers came from) and so never gets a newRow,
// while every estimate carries one until it's banked. Merging them drops a whole
// column, and on a day that came entirely from your own table the column is one
// tick wide.
//
// A tick for the case that needs no words. It was the widest label here and by
// far the most common, so it cost the most space to say the least. An estimate
// keeps its wording — which estimator ran, and whether USDA was reachable, is
// the part actually worth reading — followed by 💾 while it's still bankable.
//
// Matched on the rendered label rather than the raw source key so a breakdown
// already saved on the sheet collapses too, and translated at render time only —
// the stored JSON keeps the descriptive string.
// Named off CONFIG.SHEETS rather than spelled out, so renaming the tab renames
// the label with it — this is the one string in the app that has to agree with a
// tab name, and it shouldn't be a second place to remember.
const NUTRITION_TABLE_SOURCE_LABEL = CONFIG.SHEETS.NUTRITION;

// Which stored labels mean "came from your own table". More than one because the
// label is written verbatim into every saved breakdown, so each name the tab has
// ever had is still out there on the sheet — dropping one would turn a saved ✅
// back into the words it was collapsed from, on rows nothing has touched since.
const NUTRITION_TABLE_SOURCE_LABELS = [NUTRITION_TABLE_SOURCE_LABEL, 'Nutrition', 'Nutrition Facts'];

function sourceCell(row, breakdown, totalCalories, totalProtein, target) {
  const cell = document.createElement('td');
  const fromTable = NUTRITION_TABLE_SOURCE_LABELS.includes(row.source);

  const label = document.createElement('span');
  label.textContent = fromTable ? '✅' : row.source;
  label.title = row.source;
  cell.appendChild(label);

  if (row.newRow) {
    cell.append(' ', makeAddToNutritionButton(row, breakdown, totalCalories, totalProtein, target));
  }
  return cell;
}

// "213.4 kcal/100g" -> "213.4", and "52 kcal/unit" -> "52". The unit was the
// same eight characters on nearly every row, so it moves to the column header's
// tooltip and the cell keeps only the figure.
//
// The two bases aren't marked apart in this column because the Amount column
// beside it already does: a count-priced row reads "×2" and a weight-priced one
// "120g", so which figure this is follows from the row itself. The full string
// is on hover, and the stored JSON carries it verbatim.
const DENSITY_SUFFIXES = [' kcal/100g', ' kcal/unit'];

function densityCell(density) {
  const text = String(density || '');
  const suffix = DENSITY_SUFFIXES.find((s) => text.endsWith(s));
  return suffix
    ? makeCell(text.slice(0, -suffix.length), text)
    : makeCell(text);
}

function renderCalcBreakdown(breakdown, totalCalories, totalProtein, target = 'physique') {
  const tbody = document.getElementById(`${target}-calc-breakdown-body`);
  tbody.innerHTML = '';

  // Merged for DISPLAY only — two Notes lines for the same ingredient (e.g.
  // two "onion" lines) show as one summed row. The saved `breakdown` itself
  // stays one entry per line: physique.js's incremental re-estimate matches
  // saved items back to Notes lines by exact noteLine, and merging that
  // field would make a duplicated ingredient re-estimate from scratch (an
  // extra Groq/USDA lookup) on every future Calculate instead of reusing it.
  mergeDuplicateBreakdownRows(breakdown).forEach((row) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(row.name),
      makeCell(row.amount),
      makeCell(String(row.calories)),
      makeCell(String(row.protein)),
      densityCell(row.density),
      sourceCell(row, breakdown, totalCalories, totalProtein, target),
    );
    tbody.appendChild(tr);
  });

  const totalRow = document.createElement('tr');
  totalRow.className = 'calc-breakdown-total';
  totalRow.append(
    makeCell('Total'),
    makeCell(''),
    makeCell(String(totalCalories)),
    makeCell(String(totalProtein)),
    makeCell(''),
    makeCell(''),
  );
  tbody.appendChild(totalRow);

  // Physique stores the same JSON in a visible field rather than a hidden
  // column, so every re-render (including 💾 clearing a row's newRow) keeps
  // that field in step with the table above it.
  if (target === 'physique') {
    document.getElementById('physique-breakdown').value = breakdownToJson(breakdown);
  }

  document.getElementById(`${target}-calc-breakdown`).hidden = false;
}

// Tears the table down when there's nothing parseable to show. Only the table:
// Physique's Breakdown field is the user's to edit, so physique.js clears that
// explicitly where it's actually meant.
function hideCalcBreakdown(target = 'physique') {
  document.getElementById(`${target}-calc-breakdown`).hidden = true;
  document.getElementById(`${target}-calc-breakdown-body`).innerHTML = '';
}
