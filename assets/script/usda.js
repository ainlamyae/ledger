const USDA_FDC_API = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// Returns the top few candidates rather than trusting foods[0] blindly — USDA's
// relevance ranking can surface a wildly different product for a plain query
// (e.g. "soybeans" ranks "Oil, soybean" above the actual bean). The caller
// picks among these using its own plausibility check.
async function usdaLookupKcalCandidates(query) {
  const apiKey = getSettingString('USDA_FDC_API_KEY', null);
  if (!apiKey) throw new Error('Add a USDA_FDC_API_KEY setting first (Settings panel).');

  const params = new URLSearchParams({
    api_key: apiKey,
    query,
    pageSize: '5',
    dataType: 'Foundation,SR Legacy',
  });

  const res = await fetch(`${USDA_FDC_API}?${params}`);
  if (!res.ok) throw new Error(`USDA FoodData Central error ${res.status}`);

  const data = await res.json();
  return (data.foods || [])
    .map((food) => {
      const energy = food.foodNutrients?.find((n) => n.nutrientName === 'Energy' && n.unitName === 'KCAL');
      if (!energy) return null;
      const protein = food.foodNutrients?.find((n) => n.nutrientName === 'Protein' && n.unitName === 'G');
      return { description: food.description, kcalPer100g: energy.value, proteinPer100g: protein ? protein.value : null };
    })
    .filter(Boolean);
}
