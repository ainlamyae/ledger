// Ideal/day targets for the Health Insight Micronutrients table
// (micronutrient-insight.js). Defaults are the FDA's 2016 Daily Values (21
// CFR 101.9(c)), plus ALA's NASEM Adequate Intake since omega-3 isn't on the
// FDA label at all. Not personalized — sex/age/body mass aren't factored in.
// Only nutrients with an official reference are listed; the rest of what FDC
// reports (fatty-acid isomers, amino acids, individual sugars...) has none.
//
// Override via a MICRONUTRIENT_DAILY_TARGETS_JSON Setting, same shape as
// below — only the names it sets are replaced. Keyed by exact FDC nutrient name.
//
// `kind`: 'floor' = get enough of (gap = too low), 'ceiling' = limit (gap =
// too high, e.g. sodium/saturated fat), 'reference' = shown, not flagged.
const NUTRIENT_DAILY_TARGETS_DEFAULT = {
  'Total lipid (fat)': { unit: 'g', amount: 78, kind: 'reference' },
  'Fatty acids, total saturated': { unit: 'g', amount: 20, kind: 'ceiling' },
  'Cholesterol': { unit: 'mg', amount: 300, kind: 'ceiling' },
  'Sodium, Na': { unit: 'mg', amount: 2300, kind: 'ceiling' },
  'Chloride': { unit: 'mg', amount: 2300, kind: 'reference' },
  'Carbohydrate, by difference': { unit: 'g', amount: 275, kind: 'reference' },
  'Fiber, total dietary': { unit: 'g', amount: 28, kind: 'floor' },
  'Protein': { unit: 'g', amount: 50, kind: 'floor' },
  'Vitamin D (D2 + D3)': { unit: 'µg', amount: 20, kind: 'floor' },
  'Calcium, Ca': { unit: 'mg', amount: 1300, kind: 'floor' },
  'Iron, Fe': { unit: 'mg', amount: 18, kind: 'floor' },
  'Potassium, K': { unit: 'mg', amount: 4700, kind: 'floor' },
  'Vitamin A, RAE': { unit: 'µg', amount: 900, kind: 'floor' },
  'Vitamin C, total ascorbic acid': { unit: 'mg', amount: 90, kind: 'floor' },
  'Vitamin E (alpha-tocopherol)': { unit: 'mg', amount: 15, kind: 'floor' },
  'Vitamin K (phylloquinone)': { unit: 'µg', amount: 120, kind: 'floor' },
  'Thiamin': { unit: 'mg', amount: 1.2, kind: 'floor' },
  'Riboflavin': { unit: 'mg', amount: 1.3, kind: 'floor' },
  'Niacin': { unit: 'mg', amount: 16, kind: 'floor' },
  'Vitamin B-6': { unit: 'mg', amount: 1.7, kind: 'floor' },
  'Folate, DFE': { unit: 'µg', amount: 400, kind: 'floor' },
  'Vitamin B-12': { unit: 'µg', amount: 2.4, kind: 'floor' },
  'Biotin': { unit: 'µg', amount: 30, kind: 'floor' },
  'Pantothenic acid': { unit: 'mg', amount: 5, kind: 'floor' },
  'Phosphorus, P': { unit: 'mg', amount: 1250, kind: 'floor' },
  'Iodine, I': { unit: 'µg', amount: 150, kind: 'floor' },
  'Magnesium, Mg': { unit: 'mg', amount: 420, kind: 'floor' },
  'Zinc, Zn': { unit: 'mg', amount: 11, kind: 'floor' },
  'Selenium, Se': { unit: 'µg', amount: 55, kind: 'floor' },
  'Copper, Cu': { unit: 'mg', amount: 0.9, kind: 'floor' },
  'Manganese, Mn': { unit: 'mg', amount: 2.3, kind: 'floor' },
  'Chromium, Cr': { unit: 'µg', amount: 35, kind: 'floor' },
  'Molybdenum, Mo': { unit: 'µg', amount: 45, kind: 'floor' },
  'Choline, total': { unit: 'mg', amount: 550, kind: 'floor' },
  // EPA/DHA get no target: the only cited figure (DGA, ~250mg/day) is for the
  // two combined, and FDC reports them as separate rows.
  'PUFA 18:3 n-3 c,c,c (ALA)': { unit: 'g', amount: 1.6, kind: 'floor' },
  // NASEM 2004 Adequate Intake, total water from food AND beverages — men's
  // figure (3.7L), the higher of the two sexes, kept as one fixed number like
  // everything else here. Only accurate if drinks are logged as Consumption
  // lines too: FDC's "Water" is the water content of whatever was actually
  // priced, not a separate hydration tracker, and NASEM says ~80% of total
  // water normally comes from drinking water/beverages, not food.
  'Water': { unit: 'g', amount: 3700, kind: 'floor' },
  // FDA consumer guidance (not a formal DRI): up to ~400mg/day is not
  // associated with adverse effects in most healthy adults.
  'Caffeine': { unit: 'mg', amount: 400, kind: 'ceiling' },
  // No alcohol target: even a "moderate" ceiling reads as an allowance, and zero has
  // no downside.
  // NASEM 2005 indispensable-amino-acid RDA (mg/kg body mass/day),
  // multiplied by a 70kg reference adult — an actual computation, not a
  // published fixed figure like everything else above, since amino acid
  // needs scale with body size more directly than a vitamin's. Approximate
  // for anyone far from 70kg. Methionine, Cysteine, Phenylalanine and
  // Tyrosine are deliberately excluded: NASEM only publishes COMBINED
  // Methionine+Cysteine and Phenylalanine+Tyrosine requirements, and FDC
  // reports each amino acid as its own row — splitting a combined figure
  // between two rows would be a guess, the same reason EPA/DHA have none.
  'Histidine': { unit: 'g', amount: 0.98, kind: 'floor' },
  'Isoleucine': { unit: 'g', amount: 1.33, kind: 'floor' },
  'Leucine': { unit: 'g', amount: 2.94, kind: 'floor' },
  'Lysine': { unit: 'g', amount: 2.66, kind: 'floor' },
  'Threonine': { unit: 'g', amount: 1.4, kind: 'floor' },
  'Tryptophan': { unit: 'g', amount: 0.35, kind: 'floor' },
  'Valine': { unit: 'g', amount: 1.68, kind: 'floor' },
};

function nutrientDailyTargets() {
  const raw = getSettingString('MICRONUTRIENT_DAILY_TARGETS_JSON', null);
  if (!raw) return NUTRIENT_DAILY_TARGETS_DEFAULT;
  try {
    // The setting is the whole list, not overrides on top of the defaults: a nutrient
    // deleted from it has no target. The defaults above only stand in until the key
    // exists (and seed it, patchMicronutrientDailyTargetAmounts below).
    const targets = JSON.parse(raw);
    Object.values(targets).forEach((t) => { if (t && t.unit) t.unit = standardUnit(t.unit); });
    return targets;
  } catch {
    return NUTRIENT_DAILY_TARGETS_DEFAULT;
  }
}

// Patches one or more nutrients' `amount` inside the MICRONUTRIENT_DAILY_TARGETS_JSON
// override, preserving each one's unit/kind (and every other nutrient) untouched — the
// Tune's Save calls this so this table's own Protein/Fiber rows track the
// band it just computed instead of sitting on the shipped FDA Daily Value forever. An
// entry gains an override even if the setting was never customized before, since the
// starting point is the shipped default for whichever name isn't already overridden.
function patchMicronutrientDailyTargetAmounts(patch) {
  const raw = getSettingString('MICRONUTRIENT_DAILY_TARGETS_JSON', null);
  // The setting is the whole list (nutrientDailyTargets), so a first write starts
  // from every default rather than just the patched names.
  let overrides = { ...NUTRIENT_DAILY_TARGETS_DEFAULT };
  if (raw) {
    try {
      overrides = JSON.parse(raw);
    } catch {
      overrides = { ...NUTRIENT_DAILY_TARGETS_DEFAULT };
    }
  }
  Object.entries(patch).forEach(([name, amount]) => {
    const base = overrides[name] || NUTRIENT_DAILY_TARGETS_DEFAULT[name] || { unit: 'g', kind: 'floor' };
    overrides[name] = { ...base, amount };
  });
  return JSON.stringify(overrides);
}

const NUTRIENT_GAP_SEVERE_FLOOR_RATIO = 0.5;
const NUTRIENT_GAP_MILD_FLOOR_RATIO = 0.8;

// Only flags a genuine shortfall on a get-enough-of nutrient — running OVER an
// ideal (a ceiling nutrient like sodium/alcohol, or a floor nutrient eaten well
// past its target) is never colored, even though it may be worth noting in the
// AI report; the row coloring is reserved for "a lot less than the ideal/day".
function nutrientGapSeverity(kind, avgPerDay, targetAmount) {
  if (kind !== 'floor') return null;
  if (!targetAmount || avgPerDay === null) return null;
  const ratio = avgPerDay / targetAmount;

  if (ratio < NUTRIENT_GAP_SEVERE_FLOOR_RATIO) return 'severe';
  if (ratio < NUTRIENT_GAP_MILD_FLOOR_RATIO) return 'mild';
  return null;
}
