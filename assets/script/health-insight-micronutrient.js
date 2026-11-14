// The Health Insight panel's Micronutrient mode: Food mode's per-ingredient
// totals (aggregateFoodIntake) scaled against each ingredient's banked USDA
// panel in Nutrition, so the model judges real amounts rather than guessing them.
// Only ingredients with a Nutrition row and a pulled panel contribute; the rest
// are listed as missing so an unpriced nutrient never reads as zero.

// FDC's fatty-acid names don't say "Omega-3"; display labels only, keyed by FDC name.
const NUTRIENT_DISPLAY_NAME = {
  'PUFA 18:3 n-3 c,c,c (ALA)': 'Omega-3, ALA',
  'PUFA 18:4': 'Omega-3, SDA',
  'PUFA 20:3 n-3': 'Omega-3, ETE',
  'PUFA 20:5 n-3 (EPA)': 'Omega-3, EPA',
  'PUFA 22:5 n-3 (DPA)': 'Omega-3, DPA',
  'PUFA 22:6 n-3 (DHA)': 'Omega-3, DHA',
};

// USDA's undifferentiated fatty acids (SR Legacy) and the specific one each counts
// as when a panel has no specific figure.
const GENERIC_PUFA_AS = {
  'PUFA 18:3': 'PUFA 18:3 n-3 c,c,c (ALA)',
  'PUFA 18:2': 'PUFA 18:2 n-6 c,c',
};

// A nutrient's name cell; its hover lists each source ("Ingredient (amount eaten):
// nutrient amount"), and a tap toggles the same list open for touch screens.
function nutrientNameCell(n) {
  const td = makeCell(n.displayName);
  if (n.sources && n.sources.length) {
    const lines = n.sources.map((s) => `${s.from}: ${s.amount} ${n.unit}`);
    td.title = lines.join('\n');
    td.classList.add('nutrient-name-cell');
    const sources = document.createElement('div');
    sources.className = 'nutrient-sources';
    lines.forEach((line) => {
      const row = document.createElement('div');
      row.textContent = line;
      sources.appendChild(row);
    });
    td.appendChild(sources);
    td.addEventListener('click', () => td.classList.toggle('nutrient-sources-open'));
  }
  return td;
}

// Sort group for reference-only rows: vitamins 0, the omega-3 family 1, the rest 2.
function nutrientFamilyRank(name) {
  if (/^Vitamin\b/.test(name)) return 0;
  if (/Omega-3/.test(NUTRIENT_DISPLAY_NAME[name] || '') || /\bn-3\b/.test(name)) return 1;
  return 2;
}

// The last Nutrition Facts line, when other nutrients follow it (both tables draw a rule there).
function endsNutritionFactsLines(nutrients, i) {
  return nutrients[i].factsLine && i + 1 < nutrients.length && !nutrients[i + 1].factsLine;
}

// The last nutrient with a desired amount, when a reference-only one follows it.
function endsDesiredNutrients(nutrients, i) {
  const next = nutrients[i + 1];
  return !!next && !next.factsLine && next.ideal === null && !nutrients[i].factsLine && nutrients[i].ideal !== null;
}

// One row's class for either rule; both draw the same line.
function nutrientSectionEnd(nutrients, i) {
  return endsNutritionFactsLines(nutrients, i) || endsDesiredNutrients(nutrients, i);
}

// Days in [from, to] with a Calculate breakdown: the per-day divisor, so a
// sparsely logged range doesn't understate the average.
function countMicronutrientLoggedDays(from, to) {
  const dates = new Set();
  physiqueAsHealthEntries()
    .filter((e) => e.category === 'Calories; Protein' && e.date >= from && e.date <= to && (e.breakdown || []).length)
    .forEach((e) => dates.add(e.date));
  return dates.size;
}

// How many times its Nutrition row's reference Amount was eaten, by weight and/or
// count. The reference count is Amount's leading count, else 1 only when Amount
// has no grams (the estimator's own rule); 0 when neither scales.
function micronutrientScaleFactor(entry, row) {
  const referenceGrams = parseGramsFromAmount(entry.amount);
  const explicitCount = parseCountFromAmount(entry.amount);
  const referenceCount = explicitCount !== null ? explicitCount : (referenceGrams === null ? 1 : null);

  let scale = 0;
  if (referenceGrams !== null && row.grams > 0) scale += row.grams / referenceGrams;
  if (referenceCount !== null && row.count > 0) scale += row.count / referenceCount;
  return scale;
}

// Constant daily intake not logged day by day (supplements, water, tea): a JSON
// object keyed by FDC name, each { unit, amount } per day. Added once per logged
// day; never touches Calories In. Missing or unparseable = nothing added.
const DAILY_SUPPLEMENTS_KEY = 'DAILY_SUPPLEMENTS';
const DAILY_SUPPLEMENTS_LABEL = 'Daily supplements & drinks';

function dailySupplements() {
  const raw = getSettingString(DAILY_SUPPLEMENTS_KEY, null);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const out = {};
    Object.entries(parsed || {}).forEach(([name, v]) => {
      const amount = Number(v && v.amount);
      if (v && v.unit && Number.isFinite(amount) && amount > 0) out[name] = { unit: standardUnit(v.unit), amount };
    });
    return out;
  } catch {
    return {};
  }
}

// A nutrient amount in another unit: g/mg/µg, plus vitamin D's IU (IU is per
// vitamin, so only D converts). Null when the units can't convert.
const VITAMIN_D_IU_PER_UG = 40;
function convertNutrientAmount(name, amount, fromUnit, toUnit) {
  if (standardUnit(fromUnit) === standardUnit(toUnit)) return amount;
  const vitaminD = /^Vitamin D\b/.test(name);
  const asMass = (unit, value) => {
    if (vitaminD && standardUnit(unit) === 'IU') return { unit: 'µg', value: value / VITAMIN_D_IU_PER_UG };
    const u = massUnit(unit);
    return u ? { unit: u, value } : null;
  };
  const from = asMass(fromUnit, amount);
  if (!from) return null;
  if (vitaminD && standardUnit(toUnit) === 'IU') return from.value * MASS_UNIT_GRAMS[from.unit] / MASS_UNIT_GRAMS['µg'] * VITAMIN_D_IU_PER_UG;
  const to = massUnit(toUnit);
  return to ? from.value * MASS_UNIT_GRAMS[from.unit] / MASS_UNIT_GRAMS[to] : null;
}

const roundThousandth = (value) => Math.round(value * 1000) / 1000;

// Every nutrient eaten in [from, to], scaled per ingredient, plus the daily
// supplements; `contributing`/`missing` say which ingredients made it in.
// `breakdowns`: as aggregateFoodIntake's, each counted as one day.
function aggregateMicronutrientIntake(from, to, breakdowns = null) {
  const rows = aggregateFoodIntake(from, to, breakdowns);
  const daysLogged = breakdowns
    ? breakdowns.filter((b) => b.length).length
    : countMicronutrientLoggedDays(from, to);

  const totals = new Map();
  const contributing = new Set();
  const missing = new Set();

  rows.forEach((row) => {
    const entry = findNutritionEntry(row.name);
    const parsed = entry ? parseMicronutrients(entry.micronutrients) : null;
    const scale = parsed ? micronutrientScaleFactor(entry, row) : 0;
    if (scale <= 0) {
      missing.add(row.name);
      return;
    }

    contributing.add(row.name);
    const source = row.amountLabel ? `${row.name} (${row.amountLabel})` : row.name;
    Object.entries(parsed).forEach(([rawName, v]) => {
      // A panel with only the generic 18:3/18:2 counts it as ALA/LA, as in food it nearly all is.
      const specific = GENERIC_PUFA_AS[rawName];
      const name = specific && !(specific in parsed) ? specific : rawName;
      if (!totals.has(name)) totals.set(name, { unit: v.unit, total: 0, sources: [] });
      const amount = v.amount * scale;
      totals.get(name).total += amount;
      if (amount > 0) totals.get(name).sources.push({ from: source, amount });
    });
  });

  // Read once: nutrientDailyDesired() re-parses a Setting on every call.
  const dailyDesired = nutrientDailyDesired();

  // Supplements add amount × days, in the unit food already uses for that
  // nutrient (else its desired unit); a unit that can't convert is skipped.
  const supplementPerDay = new Map();
  if (daysLogged > 0) {
    Object.entries(dailySupplements()).forEach(([name, s]) => {
      const unit = totals.get(name)?.unit || dailyDesired[name]?.unit || s.unit;
      const perDay = convertNutrientAmount(name, s.amount, s.unit, unit);
      if (perDay === null) return;
      if (!totals.has(name)) totals.set(name, { unit, total: 0, sources: [] });
      totals.get(name).total += perDay * daysLogged;
      totals.get(name).sources.push({ from: `${DAILY_SUPPLEMENTS_LABEL} (${daysLogged} ${daysLogged === 1 ? 'day' : 'days'})`, amount: perDay * daysLogged });
      supplementPerDay.set(name, perDay);
    });
  }
  if (supplementPerDay.size) contributing.add(DAILY_SUPPLEMENTS_LABEL);
  // The Nutrition Facts lines lead, in label order and under the label's names.
  const factsRanks = nutritionFactsRanks([...totals.keys()]);
  // EPA and DHA follow the Omega-3, ALA line (fractional ranks) and join that block.
  const alaRank = NUTRITION_FACTS_ORDER.findIndex((l) => l.label === 'Omega-3, ALA');
  ['PUFA 20:5 n-3 (EPA)', 'PUFA 22:6 n-3 (DHA)'].forEach((name, i) => {
    if (alaRank >= 0 && totals.has(name)) factsRanks.set(name, { rank: alaRank + (i + 1) / 10, label: NUTRIENT_DISPLAY_NAME[name] });
  });
  const nutrients = [...totals.entries()]
    .map(([name, v]) => {
      const perDay = daysLogged > 0 ? roundThousandth(v.total / daysLogged) : null;
      const desired = dailyDesired[name] || null;
      return {
        name,
        displayName: factsRanks.get(name)?.label || NUTRIENT_DISPLAY_NAME[name] || name,
        factsLine: factsRanks.has(name),
        unit: v.unit,
        total: roundThousandth(v.total),
        perDay,
        supplementPerDay: supplementPerDay.has(name) ? roundThousandth(supplementPerDay.get(name)) : null,
        // The name cell's hover, largest share first.
        sources: v.sources
          .map((s) => ({ from: s.from, amount: roundThousandth(s.amount) }))
          .sort((a, b) => b.amount - a.amount),
        ideal: desired ? desired.amount : null,
        idealUnit: desired ? desired.unit : null,
        kind: desired ? desired.kind : null,
        severity: desired ? nutrientGapSeverity(desired.kind, perDay, desired.amount) : null,
      };
    })
    // Zero with no (or a zero) desired amount says nothing; zero against a real one is a gap.
    .filter((n) => n.total !== 0 || (n.ideal !== null && n.ideal !== 0))
    // Facts lines in label order; then those with a desired amount; then the rest:
    // supplemented first, then by family. Alphabetical within each.
    .sort((a, b) => {
      const aRank = factsRanks.get(a.name)?.rank ?? Infinity;
      const bRank = factsRanks.get(b.name)?.rank ?? Infinity;
      if (aRank !== bRank) return aRank - bRank;
      const aHasIdeal = a.ideal !== null;
      const bHasIdeal = b.ideal !== null;
      if (aHasIdeal !== bHasIdeal) return aHasIdeal ? -1 : 1;
      if (!aHasIdeal) {
        const aHasSupp = a.supplementPerDay !== null;
        const bHasSupp = b.supplementPerDay !== null;
        if (aHasSupp !== bHasSupp) return aHasSupp ? -1 : 1;
        if (!aHasSupp) {
          const groupDiff = nutrientFamilyRank(a.name) - nutrientFamilyRank(b.name);
          if (groupDiff) return groupDiff;
        }
      }
      return a.name.localeCompare(b.name);
    });

  return {
    nutrients,
    daysLogged,
    contributing: [...contributing].sort(),
    missing: [...missing].sort(),
  };
}

// Per-macro TEF shares of that macro's own calories, as Settings (percent).
const TEF_PROTEIN_SHARE_KEY = 'TEF_PROTEIN_PERCENT';
const TEF_CARB_SHARE_KEY = 'TEF_CARB_PERCENT';
const TEF_FAT_SHARE_KEY = 'TEF_FAT_PERCENT';
const TEF_PROTEIN_SHARE_DEFAULT = 25;
const TEF_CARB_SHARE_DEFAULT = 7.5;
const TEF_FAT_SHARE_DEFAULT = 2;

// Atwater factors (kcal/g) and TEF shares, keyed by FDC name. Read on every call
// so an edited Setting applies without a reload.
function tefMacroRate() {
  return {
    Protein: { label: 'Protein', kcalPerGram: 4, tefShare: getSetting(TEF_PROTEIN_SHARE_KEY, TEF_PROTEIN_SHARE_DEFAULT) / 100 },
    'Carbohydrate, by difference': { label: 'Carbohydrate', kcalPerGram: 4, tefShare: getSetting(TEF_CARB_SHARE_KEY, TEF_CARB_SHARE_DEFAULT) / 100 },
    'Total lipid (fat)': { label: 'Fat', kcalPerGram: 9, tefShare: getSetting(TEF_FAT_SHARE_KEY, TEF_FAT_SHARE_DEFAULT) / 100 },
  };
}

// TEF in kcal (unrounded) of these grams; missing Carb/Fat count as 0.
function tefFromMacros(protein, carb, fat) {
  const rate = tefMacroRate();
  const carbRate = rate['Carbohydrate, by difference'];
  const fatRate = rate['Total lipid (fat)'];
  return protein * rate.Protein.kcalPerGram * rate.Protein.tefShare
    + (carb || 0) * carbRate.kcalPerGram * carbRate.tefShare
    + (fat || 0) * fatRate.kcalPerGram * fatRate.tefShare;
}

// A breakdown item rebuilt in the Nutrition table's key order (Amount, Calories,
// Protein, Fiber, Fat, Carb, TEF, Source, then anything else), with these macros.
function orderedBreakdownItem(item, macros) {
  const { name, amount, calories, protein, fiber, fat, carbohydrate, tef, source, ...rest } = item;
  const rebuilt = { name, amount, calories, protein };
  FOOD_MACROS.forEach((macro) => {
    if (macros[macro] !== undefined) rebuilt[macro] = macros[macro];
  });
  rebuilt.source = source;
  return Object.assign(rebuilt, rest);
}

// A row priced outside Nutrition (USDA/AI): TEF from its own Protein/Carb/Fat.
// Null without a Protein figure.
function withOwnMacroTef(item) {
  if (typeof item.protein !== 'number') return null;
  const tefRaw = tefFromMacros(item.protein, item.carbohydrate, item.fat);
  const macros = { fiber: item.fiber, fat: item.fat, carbohydrate: item.carbohydrate, tef: Math.round(tefRaw) };
  return { row: orderedBreakdownItem(item, macros), tefRaw };
}

function nutritionEntryHasMacroData(entry) {
  return !!(parseMicronutrients(entry.micronutrients)
    || entry.fiber !== null || entry.fat !== null || entry.carb !== null || entry.tef !== null);
}

// A Nutrition row's typed-over-estimated macros (resolvedNutritionMacros) scaled
// to the amount eaten; a field neither source has stays absent, not zero.
function scaledNutritionMacros(entry, scale) {
  const resolved = resolvedNutritionMacros(entry);
  const macros = {};
  if (resolved.fiber !== null) macros.fiber = Math.round(resolved.fiber * scale * 100) / 100;
  if (resolved.fat !== null) macros.fat = Math.round(resolved.fat * scale * 100) / 100;
  if (resolved.carb !== null) macros.carbohydrate = Math.round(resolved.carb * scale * 100) / 100;
  const tefRaw = resolved.tef !== null ? resolved.tef * scale : null;
  if (tefRaw !== null) macros.tef = Math.round(tefRaw);
  return { macros, tefRaw };
}

// Fiber/Fat/Carbohydrate/TEF for one day's breakdown, written back onto each item
// (in place, in the Nutrition table's key order). Each item uses its Nutrition
// row when it has usable data, else its own USDA/AI macros; an item with
// neither is left alone. Returns { tefKcal }, or null when nothing was measurable
// (callers then use the flat TEF_PERCENT_OF_INTAKE estimate).
function estimateTefBreakdown(breakdown) {
  let totalTefRaw = 0;
  let matched = false;

  (breakdown || []).forEach((item, i) => {
    const entry = findNutritionEntry(item.name);
    const { grams, count } = parseBreakdownAmount(item.amount);
    const scale = entry ? micronutrientScaleFactor(entry, { grams: grams || 0, count: count || 0 }) : 0;
    const hasData = entry && nutritionEntryHasMacroData(entry);

    if (scale <= 0 || !hasData) {
      const own = withOwnMacroTef(item);
      if (!own) return;
      breakdown[i] = own.row;
      totalTefRaw += own.tefRaw;
      matched = true;
      return;
    }

    const { macros, tefRaw } = scaledNutritionMacros(entry, scale);
    if (tefRaw !== null) totalTefRaw += tefRaw;
    breakdown[i] = orderedBreakdownItem(item, macros);
    matched = true;
  });

  return matched ? { tefKcal: Math.round(totalTefRaw) } : null;
}

// {fiber, fat, carbohydrate, tef} for one aggregateFoodIntake row: each from its
// Nutrition row when it has one, else the logged Breakdown's own figures. Null
// when neither has any.
function estimateMacrosForFoodRow(row) {
  const fromBreakdown = {};
  Object.entries(row.breakdownMacros || {}).forEach(([macro, value]) => {
    fromBreakdown[macro] = macro === 'tef' ? Math.round(value) : Math.round(value * 100) / 100;
  });
  const fromTable = estimateMacrosFromNutritionRow(row) || {};
  const result = { ...fromBreakdown, ...fromTable };
  return Object.keys(result).length ? result : null;
}

function estimateMacrosFromNutritionRow(row) {
  const entry = findNutritionEntry(row.name);
  if (!entry) return null;

  const scale = micronutrientScaleFactor(entry, row);
  if (scale <= 0 || !nutritionEntryHasMacroData(entry)) return null;

  const { macros } = scaledNutritionMacros(entry, scale);
  return Object.keys(macros).length ? macros : null;
}

function estimateTefForFoodRow(row) {
  const macros = estimateMacrosForFoodRow(row);
  return (macros && macros.tef !== undefined) ? macros.tef : null;
}

// What the totals cover, leading every render of this mode.
function formatMicronutrientCoverageLine(data) {
  if (data.nutrients.length === 0) return 'No Calculate-derived ingredients logged in this window.';
  return `Based on ${data.contributing.length} ingredient${data.contributing.length === 1 ? '' : 's'} with pulled micronutrient data, over ${data.daysLogged} day${data.daysLogged === 1 ? '' : 's'} logged.`;
}

const MICRONUTRIENT_TABLE_COLUMN_COUNT = 5;
const amountWithUnit = (value, unit) => (value !== null ? `${value} ${unit}` : '—');

function renderMicronutrientInsightPreview(data) {
  renderInsightLines(document.getElementById('insight-micro-profile'), [
    ...currentProfileLines(),
    formatMicronutrientCoverageLine(data),
  ]);

  const tbody = document.getElementById('insight-micro-body');
  tbody.innerHTML = '';

  if (data.nutrients.length === 0) {
    tbody.appendChild(renderEmptyRow(MICRONUTRIENT_TABLE_COLUMN_COUNT, 'Nothing to show — see the coverage note above.'));
    return;
  }

  data.nutrients.forEach((n, i) => {
    const tr = document.createElement('tr');
    if (n.severity === 'severe' || n.severity === 'mild') tr.classList.add('nutrient-gap');
    if (nutrientSectionEnd(data.nutrients, i)) tr.classList.add('nutrient-facts-end');
    tr.append(
      nutrientNameCell(n),
      makeCell(amountWithUnit(n.total, n.unit)),
      makeCell(amountWithUnit(n.perDay, n.unit)),
      makeCell(amountWithUnit(n.supplementPerDay, n.unit)),
      makeCell(amountWithUnit(n.ideal, n.idealUnit)),
    );
    tbody.appendChild(tr);
  });
}

// Asked when the question box is left blank, as in Food mode.
const MICRONUTRIENT_INSIGHT_DEFAULT_QUESTION = 'Is this amount enough? What is missing, and what should I eat to fix it?';

function formatMicronutrientInsightPrompt(data, { from, to, question }) {
  const profile = currentProfileLines().join('\n');
  const coverage = formatMicronutrientCoverageLine(data);
  const header = `Real, measured nutrient totals (from USDA FoodData Central, via each ingredient's own Nutrition-table entry) for the ingredients logged from ${from} to ${to} that have been priced for micronutrients — name: total over the period (average per day), ideal/day (a fixed FDA Daily Value, not personalized to this user), and whether the app's own math already flags a gap:`;
  const body = data.nutrients.length
    ? data.nutrients.map((n) => {
      const avgPart = n.perDay !== null ? `${n.perDay} ${n.unit}/day avg` : 'no logged days to average over';
      const idealPart = n.ideal !== null
        ? `, ideal ${n.ideal} ${n.idealUnit}/day (${n.kind === 'ceiling' ? 'limit' : n.kind})`
        : ', no established daily value';
      const gapPart = n.severity ? `, ${n.severity.toUpperCase()} GAP` : '';
      return `  - ${n.displayName}: ${n.total} ${n.unit} total (${avgPart})${idealPart}${gapPart}`;
    }).join('\n')
    : '(none — see the coverage note above)';
  return `${profile}\n\n${coverage}\n\n${header}\n${body}\n\nQuestion: ${insightQuestionOrDefault(question, MICRONUTRIENT_INSIGHT_DEFAULT_QUESTION)}`;
}

const MICRONUTRIENT_INSIGHT_SYSTEM_PROMPT = `You are a nutrition-savvy assistant reviewing REAL, measured micronutrient totals — vitamins, minerals, and other nutrients — someone actually ate over a recent period. Unlike a rough estimate, these figures come from USDA FoodData Central, matched to the exact ingredients and amounts the user logged, so treat the numbers themselves as trustworthy for whatever they cover. A nutrient that's low or missing from the list may genuinely be low, or may simply not have been priced yet — never treat a nutrient missing from the list as confirmed zero intake.

Each nutrient line gives a total for the whole period AND an average per day, plus (where one exists) an ideal/day figure and whether the app's own math already flags a gap — use the per-day figure against the ideal to judge adequacy, since dietary reference intakes are per-day amounts, not per-period totals.

The ideal/day figure is a FIXED FDA Daily Value (a general adult reference from a 2,000 kcal diet), NOT personalized to this user's own sex/age/body mass. SEVERE GAP / MILD GAP flags are already computed by the app, but only for running well UNDER the ideal on a get-enough-of nutrient — the app deliberately does not flag running over, even on a limit-type nutrient like sodium or saturated fat, so judge any excess yourself from the raw per-day figure rather than expecting a flag for it. Treat the flags themselves as a starting point, not the final word: the report is preceded by the user's age, sex, height, current body mass and BMI, and reference intakes for iron, calcium, sodium, folate, B12 and most other nutrients differ meaningfully by sex and age (e.g. iron needs are markedly higher for a menstruating woman than for a man of the same age) — say explicitly when the fixed ideal is likely too low or too high for THIS person given their profile, rather than repeating the flag uncritically. A nutrient with "no established daily value" has no official reference — don't invent one. Any profile field may read "not set" or "not logged" — say what you'd need rather than assuming a figure.

You are not a doctor — do not diagnose a deficiency or excess as a medical condition, and do not recommend supplement doses; suggest specific food-based ways to close a real, flagged gap instead.

Write a short plain-text report with exactly these five sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only. Within a section, if you're naming more than one distinct point, put each one on its own line — never run multiple points together in one paragraph, with or without a bullet character.

Overview: one or two sentences on the overall picture this data shows, naming how many ingredients it's based on.
Going well: nutrients that look adequately covered at this daily average, given the profile.
Needs attention: nutrients that look short OR unusually high at this daily average.
Suggestions: 2-4 concrete, specific food-based ways to close the likely real gaps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.
Answer: directly answers the question included below.

Keep the whole report under 250 words.`;
