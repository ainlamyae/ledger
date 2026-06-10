// AI-powered calorie estimation for the Health Log's 🧮 Calculate button:
// parses a freeform ingredient description (Groq), checks each item against
// the personal Nutrition Facts table (nutrition.js) first, and only for a
// miss there cross-checks calorie density against real nutrition data (USDA
// FoodData Central) — banking that result back into the table for next time
// — before filling the Log Entry form in with the result. Wired up by
// wellness.js — see its 'wellness-calc-btn' click listener in initWellness().

// Generous ceiling for a single logged entry (well above a realistic single
// meal/snack) — a backstop that flags any extraction bug producing an
// implausible number, whether or not we've seen that specific failure mode yet.
const WELLNESS_CALORIE_SANITY_CEILING = 3000;

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

// Pure calorie/protein estimation core — no DOM reads or writes — shared by
// the single-entry Calculate button (below) and the Health Log table's bulk
// Recalculate action (wellness.js). Returns {calories, protein, notes,
// breakdown, usdaUnreachable} or throws (bad/empty input, Groq failure, etc.).
async function estimateCaloriesAndProtein(notesText) {
  const notes = notesText.trim();
  if (!notes) throw new Error('No ingredients to calculate from.');

  // Only the ingredient SPLIT (Groq) is cached by exact text — that round
  // trip isn't guaranteed bit-for-bit reproducible (batched GPU inference
  // means even temperature 0 + a fixed seed can shift slightly run to run),
  // so caching it keeps repeat clicks on the same Notes splitting into the
  // same items/quantities instead of a fresh roll each time. The macro
  // LOOKUP below this is deliberately never cached: it always re-checks the
  // Nutrition Facts table fresh, so adding or editing a table row and
  // recalculating the exact same Notes text picks up the change immediately
  // instead of silently replaying a result computed before that row existed
  // or was corrected.
  const extractCacheKey = `calc-extract-v1:${notes.toLowerCase()}`;
  let extraction = getCached(extractCacheKey, Infinity);
  if (!extraction) {
    extraction = await groqExtractIngredients(notes);
    setCached(extractCacheKey, extraction);
  }
  const { items, notes: standardizedNotes } = extraction;

  let usdaAttempts = 0;
  let usdaFailureCount = 0;
  // Ingredients that missed the Nutrition Facts table this round and had
  // to be estimated via USDA/AI — saved back to the table below so the
  // same food is a trusted lookup hit next time instead of a fresh guess.
  const newNutritionRows = [];

  const perItemMacros = await Promise.all(items.map(async (item) => {
    const grams = item.grams;

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
    const tableEntry = findNutritionEntry(item.query);
    const tableGrams = tableEntry ? parseGramsFromAmount(tableEntry.amount) : null;
    let tableCount = null;
    if (tableEntry && tableEntry.amount) {
      const explicitCount = parseCountFromAmount(tableEntry.amount);
      tableCount = explicitCount !== null ? explicitCount : (tableGrams === null ? 1 : null);
    }

    let itemCalories;
    let itemProtein;
    let source;
    let amount;
    let kcal;
    let protein;

    if (tableEntry && tableCount !== null && item.count !== null) {
      itemCalories = (tableEntry.calories / tableCount) * item.count;
      itemProtein = (tableEntry.protein / tableCount) * item.count;
      source = 'nutrition-table-count';
      amount = `×${item.count}`;
    } else if (tableEntry && tableGrams !== null) {
      kcal = (tableEntry.calories / tableGrams) * 100;
      protein = (tableEntry.protein / tableGrams) * 100;
      itemCalories = (kcal * grams) / 100;
      itemProtein = (protein * grams) / 100;
      source = 'nutrition-table-grams';
      amount = `${Math.round(grams * 10) / 10}g`;
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
      itemCalories = (kcal * grams) / 100;
      itemProtein = (protein * grams) / 100;
      source = lookupFailed ? 'usda-unreachable' : 'usda/ai';
      amount = `${Math.round(grams * 10) / 10}g`;

      // A failed lookup ran on a pure ungrounded AI guess — don't bank
      // that into the table as if it were verified. New rows are always
      // banked by weight (grams), even for a food that happened to be
      // logged by count this time — a stable per-100g figure is reusable
      // regardless of how the next mention phrases the quantity.
      if (!lookupFailed) {
        newNutritionRows.push({ name: item.query, amount: '100g', calories: Math.round(kcal), protein: Math.round(protein) });
      }
    }

    console.debug(`[calc] ${item.query}: ${JSON.stringify({
      grams,
      count: item.count,
      source,
      kcalPer100gFallback: item.kcalPer100gFallback,
      proteinPer100gFallback: item.proteinPer100gFallback,
      kcalPer100gUsed: kcal,
      proteinPer100gUsed: protein,
      itemCalories,
      itemProtein,
    })}`);
    return { name: item.query, amount, source, itemCalories, itemProtein };
  }));
  const calories = Math.round(perItemMacros.reduce((sum, m) => sum + m.itemCalories, 0));
  const protein = Math.round(perItemMacros.reduce((sum, m) => sum + m.itemProtein, 0));
  console.debug('[calc] total kcal:', calories, 'total protein g:', protein);

  // Per-item lines the modal shows after Calculate so the final Amount can
  // be sanity-checked by eye/pure arithmetic before saving, rather than
  // trusting the combined total blind — each row also names its source
  // (the personal table vs. a USDA/AI estimate) since that's the actual
  // trust distinction, not "AI did the math" (the summation itself is
  // always plain JS — the AI only ever supplies a per-item density
  // estimate, and only when there's no table match).
  const SOURCE_LABELS = {
    'nutrition-table-count': 'Nutrition Facts',
    'nutrition-table-grams': 'Nutrition Facts',
    'usda/ai': 'USDA estimate',
    'usda-unreachable': 'AI estimate (offline)',
  };
  const breakdown = perItemMacros.map((m) => ({
    name: m.name,
    amount: m.amount,
    calories: Math.round(m.itemCalories),
    protein: Math.round(m.itemProtein * 10) / 10,
    source: SOURCE_LABELS[m.source] || m.source,
  }));

  // Every USDA lookup that was actually attempted failed — almost certainly
  // a network/DNS problem, not a "no match" case. This ran on pure LLM
  // guesses with zero real grounding, so don't bank any of its numbers into
  // the Nutrition Facts table as if they were verified: a retry once
  // connectivity is back should get a real, properly-grounded number
  // instead of replaying this ungrounded one forever.
  const usdaUnreachable = usdaAttempts > 0 && usdaFailureCount === usdaAttempts;

  const dedupedNewRows = [...new Map(newNutritionRows.map((r) => [r.name.toLowerCase(), r])).values()];
  if (dedupedNewRows.length) {
    await Promise.all(dedupedNewRows.map((r) => addNutritionEntry(r)));
    await refreshNutrition(true);
  }

  return { calories, protein, notes: standardizedNotes, breakdown, usdaUnreachable };
}

// Renders the per-item breakdown table under Notes so the combined Amount
// can be checked by eye/pure arithmetic before saving — the Total row uses
// the exact same rounded totals written into the Amount field, not a
// re-sum of the (individually rounded, so slightly lossy) per-item rows.
function renderCalcBreakdown(breakdown, totalCalories, totalProtein) {
  const tbody = document.getElementById('wellness-calc-breakdown-body');
  tbody.innerHTML = '';

  breakdown.forEach((row) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(row.name),
      makeCell(row.amount),
      makeCell(String(row.calories)),
      makeCell(String(row.protein)),
      makeCell(row.source),
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
  );
  tbody.appendChild(totalRow);

  document.getElementById('wellness-calc-breakdown').hidden = false;
}

// Stale once Notes changes by hand (it no longer reflects what's in the
// field) — called on every real Notes edit and whenever the Log Entry
// modal opens fresh for a different entry (see wellness.js).
function hideCalcBreakdown() {
  document.getElementById('wellness-calc-breakdown').hidden = true;
  document.getElementById('wellness-calc-breakdown-body').innerHTML = '';
}

async function calculateWellnessCalories() {
  const notes = document.getElementById('wellness-notes').value.trim();
  const btn = document.getElementById('wellness-calc-btn');

  if (!notes) {
    showFieldError('wellness-form-error', 'Type ingredients and amounts in Notes first.');
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Calculating…';
  clearFieldError('wellness-form-error');

  try {
    const { calories, protein, notes: standardizedNotes, breakdown, usdaUnreachable } = await estimateCaloriesAndProtein(notes);

    const description = document.getElementById('wellness-description').value;
    document.getElementById('wellness-category').value = 'Calories; Protein';
    onCategoryChange();
    document.getElementById('wellness-description').value = description;
    document.getElementById('wellness-amount').value = `${calories}; ${protein}`;
    document.getElementById('wellness-unit').value = 'kcal; g';
    document.getElementById('wellness-notes').value = standardizedNotes;
    renderCalcBreakdown(breakdown, calories, protein);

    const warnings = [];
    if (usdaUnreachable) {
      warnings.push("⚠️ Couldn't reach the nutrition database (network/DNS issue) — this estimate is AI-only and may be less accurate.");
    }
    if (calories > WELLNESS_CALORIE_SANITY_CEILING) {
      warnings.push(`⚠️ This estimate (${calories} kcal) looks unusually high — double-check before saving.`);
    }
    if (warnings.length) {
      showFieldError('wellness-form-error', warnings.join(' '));
    }
  } catch (err) {
    showFieldError('wellness-form-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}
