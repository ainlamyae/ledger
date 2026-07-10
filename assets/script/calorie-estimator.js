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
// off-category and the model's estimate is the safer number to use.
function pickPlausibleKcal(candidates, fallback) {
  if (!candidates.length) return fallback;

  const best = candidates.reduce((a, b) =>
    Math.abs(Math.log(a.kcalPer100g / fallback)) < Math.abs(Math.log(b.kcalPer100g / fallback)) ? a : b
  );
  const ratio = best.kcalPer100g / fallback;
  return (ratio <= 2.5 && ratio >= 1 / 2.5) ? best.kcalPer100g : fallback;
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
    // The Groq/USDA round trip isn't guaranteed bit-for-bit reproducible
    // (batched GPU inference means even temperature 0 + a fixed seed can
    // shift slightly run to run) — cache by the exact ingredient text so the
    // same input always yields the same result instead of a fresh roll each click.
    const cacheKey = `calc-calories:${notes.toLowerCase()}`;
    let result = getCached(cacheKey, Infinity);
    let usdaUnreachable = false;

    if (!result) {
      const { items, notes: standardizedNotes } = await groqExtractIngredients(notes);

      let usdaFailureCount = 0;
      const perItemCalories = await Promise.all(items.map(async (item) => {
        const candidates = await usdaLookupKcalCandidates(item.query).catch(() => {
          usdaFailureCount++;
          return [];
        });
        const kcal = pickPlausibleKcal(candidates, item.kcalPer100gFallback);
        const grams = item.grams;
        const itemCalories = (kcal * grams) / 100;
        console.debug(`[calc] ${item.query}: ${JSON.stringify({
          grams,
          kcalPer100gFallback: item.kcalPer100gFallback,
          usdaCandidates: candidates,
          kcalPer100gUsed: kcal,
          itemCalories,
        })}`);
        return itemCalories;
      }));
      const calories = Math.round(perItemCalories.reduce((sum, c) => sum + c, 0));
      console.debug('[calc] total kcal:', calories);

      // Every lookup failed — almost certainly a network/DNS problem, not a
      // "no match" case. This ran on pure LLM guesses with zero real
      // grounding, so don't cache it: a retry once connectivity is back
      // should get a real, properly-grounded number instead of replaying
      // this ungrounded one forever.
      usdaUnreachable = items.length > 0 && usdaFailureCount === items.length;

      result = { calories, notes: standardizedNotes };
      if (!usdaUnreachable) setCached(cacheKey, result);
    }

    const { calories, notes: standardizedNotes } = result;

    const description = document.getElementById('wellness-description').value;
    document.getElementById('wellness-category').value = 'Calories';
    onCategoryChange(); // clears Description as a side effect — restore it below
    document.getElementById('wellness-description').value = description;
    document.getElementById('wellness-amount').value = String(calories);
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
