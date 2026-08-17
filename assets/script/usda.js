const USDA_FDC_SEARCH_API = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// Returns the top few candidates rather than trusting foods[0] blindly — USDA's
// relevance ranking can surface a wildly different product for a plain query
// (e.g. "soybeans" ranks "Oil, soybean" above the actual bean). The caller
// picks among these using its own plausibility check.
//
// `nutrients` carries every OTHER figure the search response returned for
// this food (vitamins, minerals, amino acids...), unused by Calculate's own
// kcal/protein-only path but read by nutrition.js's Pull Micronutrients. A
// Foundation/SR Legacy result already comes back with dozens of these in
// this same response — a separate per-food /food/{fdcId} request was tried
// first and dropped: it 404s unreliably even against USDA's own documented
// example, and is redundant anyway since this search response already has
// the full panel.
async function usdaLookupKcalCandidates(query) {
  const apiKey = getSettingString('USDA_FDC_API_KEY', null);
  if (!apiKey) throw new Error('Add a USDA_FDC_API_KEY setting first (Settings panel).');

  const params = new URLSearchParams({
    api_key: apiKey,
    query,
    pageSize: '5',
    dataType: 'Foundation,SR Legacy',
  });

  const res = await fetch(`${USDA_FDC_SEARCH_API}?${params}`);
  if (!res.ok) throw new Error(`USDA FoodData Central error ${res.status}`);

  const data = await res.json();
  return (data.foods || [])
    .map((food) => {
      const energy = food.foodNutrients?.find((n) => n.nutrientName === 'Energy' && n.unitName === 'KCAL');
      if (!energy) return null;
      const protein = food.foodNutrients?.find((n) => n.nutrientName === 'Protein' && n.unitName === 'G');
      return {
        description: food.description,
        fdcId: food.fdcId,
        kcalPer100g: energy.value,
        proteinPer100g: protein ? protein.value : null,
        nutrients: (food.foodNutrients || [])
          .filter((n) => n.nutrientName && Number.isFinite(n.value))
          .map((n) => ({ name: n.nutrientName, unit: String(n.unitName || '').toUpperCase(), amountPer100g: n.value })),
      };
    })
    .filter(Boolean);
}

// Picks whichever candidate's energy is closest (on a log scale, so 2x over
// and 2x under count equally far) to a known reference kcal/100g, but only if
// it's within a 2.5x band either way — otherwise USDA's relevance ranking has
// probably surfaced the wrong food entirely (see usdaLookupKcalCandidates),
// and returning it would be worse than returning nothing. Shared by
// calorie-estimator.js's Calculate fallback (compares against the AI's own
// estimate) and nutrition.js's Pull Micronutrients (compares against the
// row's own logged Calories) — same trust question, two different reference
// numbers.
function pickPlausibleUsdaCandidate(candidates, kcalPer100gReference) {
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) =>
    Math.abs(Math.log(a.kcalPer100g / kcalPer100gReference)) < Math.abs(Math.log(b.kcalPer100g / kcalPer100gReference)) ? a : b
  );
  const ratio = best.kcalPer100g / kcalPer100gReference;
  return (ratio <= 2.5 && ratio >= 1 / 2.5) ? best : null;
}
