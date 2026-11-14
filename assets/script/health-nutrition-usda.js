const USDA_FDC_SEARCH_API = 'https://api.nal.usda.gov/fdc/v1/foods/search';
// A candidate further than this factor from the reference kcal/100g is the wrong food.
const USDA_KCAL_PLAUSIBLE_RATIO = 2.5;

// The top few candidates, not foods[0]: USDA's ranking can put a different food first
// ("soybeans" ranks "Oil, soybean" above the bean), so the caller picks among them.
// `nutrients` is every other figure in the search response, for Complete's full
// panel; the per-food /food/{fdcId} endpoint 404s unreliably and adds nothing.
// The form's picker passes a wider search (pageSize 10, branded foods too).
async function usdaLookupKcalCandidates(query, { pageSize = 5, dataType = 'Foundation,SR Legacy' } = {}) {
  const apiKey = getSettingString('USDA_FDC_API_KEY', null);
  if (!apiKey) throw new Error('Add a USDA_FDC_API_KEY setting first (Settings panel).');

  const params = new URLSearchParams({
    api_key: apiKey,
    query,
    pageSize: String(pageSize),
    dataType,
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
        brand: food.brandName || food.brandOwner || '',
        dataType: food.dataType || '',
        kcalPer100g: energy.value,
        proteinPer100g: protein ? protein.value : null,
        nutrients: (food.foodNutrients || [])
          .filter((n) => n.nutrientName && Number.isFinite(n.value))
          .map((n) => ({ name: n.nutrientName, unit: standardUnit(n.unitName), amountPer100g: n.value })),
      };
    })
    .filter(Boolean);
}

// The candidate closest in energy (on a log scale, so 2x over and under are equally
// far) to a reference kcal/100g, or null when even that one is outside the plausible
// band. Physique passes the AI's estimate, or the Calories of a row being banked.
function pickPlausibleUsdaCandidate(candidates, kcalPer100gReference) {
  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) =>
    Math.abs(Math.log(a.kcalPer100g / kcalPer100gReference)) < Math.abs(Math.log(b.kcalPer100g / kcalPer100gReference)) ? a : b
  );
  const ratio = best.kcalPer100g / kcalPer100gReference;
  return (ratio <= USDA_KCAL_PLAUSIBLE_RATIO && ratio >= 1 / USDA_KCAL_PLAUSIBLE_RATIO) ? best : null;
}
