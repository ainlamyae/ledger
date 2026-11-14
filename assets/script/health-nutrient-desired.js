// Desired amounts per day for the Micronutrients Insight table, keyed by exact FDC
// nutrient name: the FDA's 2016 Daily Values (21 CFR 101.9(c)) plus the NASEM
// figures noted below. Not personalized. A nutrient with no published reference
// (fatty-acid isomers, individual sugars...) is left out.
// A MICRONUTRIENT_DAILY_DESIRED_JSON Setting of the same shape replaces the whole list.
//
// `kind`: 'floor' = get enough of, 'ceiling' = limit (e.g. sodium), 'reference' = shown, not flagged.
const NUTRIENT_DAILY_DESIRED_DEFAULT = {
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
  // No EPA/DHA: the only cited figure (~250mg/day) is for the two combined, and FDC
  // reports them separately.
  'PUFA 18:3 n-3 c,c,c (ALA)': { unit: 'g', amount: 1.6, kind: 'floor' },
  // NASEM 2004 Adequate Intake for total water, food and drinks (men's 3.7L, the
  // higher). Only meaningful if drinks are logged too: FDC's Water is what the
  // logged food holds, and ~80% normally comes from drinks.
  'Water': { unit: 'g', amount: 3700, kind: 'floor' },
  // FDA consumer guidance, not a DRI: up to ~400mg/day is safe for most adults.
  'Caffeine': { unit: 'mg', amount: 400, kind: 'ceiling' },
  // No alcohol: even a "moderate" ceiling reads as an allowance.
  // NASEM 2005 indispensable-amino-acid RDA (mg/kg/day) times a 70kg reference adult,
  // so approximate far from 70kg. Methionine, Cysteine, Phenylalanine and Tyrosine
  // are left out: NASEM only gives them in pairs, which FDC reports as separate rows.
  'Histidine': { unit: 'g', amount: 0.98, kind: 'floor' },
  'Isoleucine': { unit: 'g', amount: 1.33, kind: 'floor' },
  'Leucine': { unit: 'g', amount: 2.94, kind: 'floor' },
  'Lysine': { unit: 'g', amount: 2.66, kind: 'floor' },
  'Threonine': { unit: 'g', amount: 1.4, kind: 'floor' },
  'Tryptophan': { unit: 'g', amount: 0.35, kind: 'floor' },
  'Valine': { unit: 'g', amount: 1.68, kind: 'floor' },
};

function nutrientDailyDesired() {
  const raw = getSettingString('MICRONUTRIENT_DAILY_DESIRED_JSON', null);
  if (!raw) return NUTRIENT_DAILY_DESIRED_DEFAULT;
  try {
    // The whole list, not overrides: a nutrient deleted from it has no desired amount.
    const desired = JSON.parse(raw);
    Object.values(desired).forEach((entry) => { if (entry && entry.unit) entry.unit = standardUnit(entry.unit); });
    return desired;
  } catch {
    return NUTRIENT_DAILY_DESIRED_DEFAULT;
  }
}

// The MICRONUTRIENT_DAILY_DESIRED_JSON value with each patched name's `amount` set,
// unit/kind and every other nutrient kept. Tune's Save uses it so Protein/Fiber track
// its band. With no valid setting yet, it starts from the whole default list.
function patchMicronutrientDailyDesiredAmounts(patch) {
  const raw = getSettingString('MICRONUTRIENT_DAILY_DESIRED_JSON', null);
  let overrides;
  try {
    overrides = raw ? JSON.parse(raw) : { ...NUTRIENT_DAILY_DESIRED_DEFAULT };
  } catch {
    overrides = { ...NUTRIENT_DAILY_DESIRED_DEFAULT };
  }
  Object.entries(patch).forEach(([name, amount]) => {
    const base = overrides[name] || NUTRIENT_DAILY_DESIRED_DEFAULT[name] || { unit: 'g', kind: 'floor' };
    overrides[name] = { ...base, amount };
  });
  return JSON.stringify(overrides);
}

const NUTRIENT_GAP_SEVERE_FLOOR_RATIO = 0.5;
const NUTRIENT_GAP_MILD_FLOOR_RATIO = 0.8;

// Flags only a shortfall on a floor nutrient; running over any desired amount is
// never colored.
function nutrientGapSeverity(kind, avgPerDay, desiredAmount) {
  if (kind !== 'floor') return null;
  if (!desiredAmount || avgPerDay === null) return null;
  const ratio = avgPerDay / desiredAmount;

  if (ratio < NUTRIENT_GAP_SEVERE_FLOOR_RATIO) return 'severe';
  if (ratio < NUTRIENT_GAP_MILD_FLOOR_RATIO) return 'mild';
  return null;
}
