// AI-powered calorie estimation for the Health Log's 🧮 Calculate button:
// parses a freeform ingredient description (Groq), cross-checks each item's
// calorie density against real nutrition data (USDA FoodData Central), and
// fills the Log Entry form in with the result. Wired up by wellness.js —
// see its 'wellness-calc-btn' click listener in initWellness().

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
// usdaUnreachable} or throws (bad/empty input, Groq failure, etc.).
async function estimateCaloriesAndProtein(notesText) {
  const notes = notesText.trim();
  if (!notes) throw new Error('No ingredients to calculate from.');

  // The Groq/USDA round trip isn't guaranteed bit-for-bit reproducible
  // (batched GPU inference means even temperature 0 + a fixed seed can
  // shift slightly run to run) — cache by the exact ingredient text so the
  // same input always yields the same result instead of a fresh roll each click.
  // Cache key versioned to "v2" because older cached entries only carry
  // {calories, notes} (no protein) — reusing "v1" text produced a literal
  // "undefined" protein value once this field was added.
  const cacheKey = `calc-calories-v2:${notes.toLowerCase()}`;
  let result = getCached(cacheKey, Infinity);
  let usdaUnreachable = false;

  if (!result) {
    const { items, notes: standardizedNotes } = await groqExtractIngredients(notes);

    let usdaFailureCount = 0;
    const perItemMacros = await Promise.all(items.map(async (item) => {
      const candidates = await usdaLookupKcalCandidates(item.query).catch(() => {
        usdaFailureCount++;
        return [];
      });
      const { kcal, protein } = pickPlausibleMacros(candidates, item.kcalPer100gFallback, item.proteinPer100gFallback);
      const grams = item.grams;
      const itemCalories = (kcal * grams) / 100;
      const itemProtein = (protein * grams) / 100;
      console.debug(`[calc] ${item.query}: ${JSON.stringify({
        grams,
        kcalPer100gFallback: item.kcalPer100gFallback,
        proteinPer100gFallback: item.proteinPer100gFallback,
        usdaCandidates: candidates,
        kcalPer100gUsed: kcal,
        proteinPer100gUsed: protein,
        itemCalories,
        itemProtein,
      })}`);
      return { itemCalories, itemProtein };
    }));
    const calories = Math.round(perItemMacros.reduce((sum, m) => sum + m.itemCalories, 0));
    const protein = Math.round(perItemMacros.reduce((sum, m) => sum + m.itemProtein, 0));
    console.debug('[calc] total kcal:', calories, 'total protein g:', protein);

    // Every lookup failed — almost certainly a network/DNS problem, not a
    // "no match" case. This ran on pure LLM guesses with zero real
    // grounding, so don't cache it: a retry once connectivity is back
    // should get a real, properly-grounded number instead of replaying
    // this ungrounded one forever.
    usdaUnreachable = items.length > 0 && usdaFailureCount === items.length;

    result = { calories, protein, notes: standardizedNotes };
    if (!usdaUnreachable) setCached(cacheKey, result);
  }

  return { ...result, usdaUnreachable };
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
    const { calories, protein, notes: standardizedNotes, usdaUnreachable } = await estimateCaloriesAndProtein(notes);

    const description = document.getElementById('wellness-description').value;
    document.getElementById('wellness-category').value = 'Calories; Protein';
    onCategoryChange();
    document.getElementById('wellness-description').value = description;
    document.getElementById('wellness-amount').value = `${calories}; ${protein}`;
    document.getElementById('wellness-unit').value = 'kcal; g';
    document.getElementById('wellness-notes').value = standardizedNotes;

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
