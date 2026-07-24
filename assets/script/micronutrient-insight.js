// The Health Insight panel's Micronutrients mode: unlike Food mode (which asks
// the model to guess at vitamin/mineral content from general food knowledge),
// this one is built on REAL numbers — it takes the same per-ingredient totals
// food-insight.js's aggregateFoodIntake already computes for the picked range,
// looks each ingredient up in the Nutrition table (nutrition.js), and scales
// whatever USDA-sourced panel Pull Micronutrients banked in its Micronutrients
// column (JSON, per that row's own reference Amount) to how much was actually
// eaten — the same scaling math calorie-estimator.js already applies to
// Calories/Protein. The AI is asked to judge sufficiency against standard
// dietary reference intakes, not to estimate the amounts themselves.
//
// Coverage is necessarily partial: only ingredients that have BOTH a Nutrition
// row AND an already-pulled Micronutrients cell contribute. That's tracked
// explicitly (not silently dropped) so the prompt — and the report it
// produces — can say what's measured vs. what's simply not priced yet, rather
// than reading a genuinely unpriced nutrient as a confirmed zero.

// FDC's names for these are pure chemistry (fatty-acid carbon count/bond
// notation) — "Omega-3" doesn't appear anywhere in them, so it's added for
// display only. Keyed by the exact FDC name; matching/lookup elsewhere still
// uses that raw name, only the rendered label changes.
const NUTRIENT_DISPLAY_NAME = {
  'PUFA 18:3 n-3 c,c,c (ALA)': 'PUFA 18:3 n-3 c,c,c (ALA, Omega-3)',
  'PUFA 18:4': 'PUFA 18:4 (Omega-3)',
  'PUFA 20:3 n-3': 'PUFA 20:3 n-3 (Omega-3)',
  'PUFA 20:5 n-3 (EPA)': 'PUFA 20:5 n-3 (EPA, Omega-3)',
  'PUFA 22:5 n-3 (DPA)': 'PUFA 22:5 n-3 (DPA, Omega-3)',
  'PUFA 22:6 n-3 (DHA)': 'PUFA 22:6 n-3 (DHA, Omega-3)',
};

// Every date in [from, to] that actually has a Calculate-derived breakdown —
// the denominator for each nutrient's per-day average. Deliberately the same
// "was Calculate actually run that day" bar aggregateFoodIntake's own source
// rows require, not just the fixed length of the picked range, so a sparsely
// logged window doesn't understate the daily average.
function countMicronutrientLoggedDays(from, to) {
  const dates = new Set();
  physiqueAsWellnessEntries()
    .filter((e) => e.category === 'Calories; Protein' && e.date >= from && e.date <= to && (e.breakdown || []).length)
    .forEach((e) => dates.add(e.date));
  return dates.size;
}

// One ingredient's contribution to the running nutrient totals: how many
// times over its own Nutrition-row reference Amount was actually eaten in the
// window, by weight and/or by count (an ingredient logged inconsistently
// across days can carry both). Same precedence calorie-estimator.js's
// tableCount uses — an explicit leading count in Amount, or (only when Amount
// has no gram figure at all) an implicit reference count of 1 — so a
// gram-only row never double-counts against a stray count total. Returns 0
// when neither applies (e.g. the row's Amount can't be scaled at all).
function micronutrientScaleFactor(entry, row) {
  const referenceGrams = parseGramsFromAmount(entry.amount);
  const explicitCount = parseCountFromAmount(entry.amount);
  const referenceCount = explicitCount !== null ? explicitCount : (referenceGrams === null ? 1 : null);

  let scale = 0;
  if (referenceGrams !== null && row.grams > 0) scale += row.grams / referenceGrams;
  if (referenceCount !== null && row.count > 0) scale += row.count / referenceCount;
  return scale;
}

// Sums every nutrient across every ingredient logged in [from, to] that has
// both a Nutrition row and an already-pulled Micronutrients panel, scaled to
// how much of that ingredient was actually eaten. `contributing`/`missing`
// name which ingredients did and didn't make it in, so the caller can be
// upfront about coverage instead of presenting a silently partial total.
function aggregateMicronutrientIntake(from, to) {
  const rows = aggregateFoodIntake(from, to);
  const daysLogged = countMicronutrientLoggedDays(from, to);

  const totals = new Map();
  const contributing = new Set();
  const missing = new Set();

  rows.forEach((row) => {
    const entry = findNutritionEntry(row.name);
    const parsed = entry ? parseMicronutrients(entry.micronutrients) : null;
    if (!parsed) {
      missing.add(row.name);
      return;
    }

    const scale = micronutrientScaleFactor(entry, row);
    if (scale <= 0) {
      missing.add(row.name);
      return;
    }

    contributing.add(row.name);
    Object.entries(parsed).forEach(([name, v]) => {
      if (!totals.has(name)) totals.set(name, { unit: v.unit, total: 0 });
      totals.get(name).total += v.amount * scale;
    });
  });

  // Read once per aggregation, not once per nutrient — nutrientDailyTargets()
  // (nutrient-targets.js) re-parses a Setting value on every call, and this
  // loop runs over the whole nutrient list.
  const targets = nutrientDailyTargets();
  const nutrients = [...totals.entries()]
    .map(([name, v]) => {
      const perDay = daysLogged > 0 ? Math.round((v.total / daysLogged) * 1000) / 1000 : null;
      const target = targets[name] || null;
      return {
        name,
        displayName: NUTRIENT_DISPLAY_NAME[name] || name,
        unit: v.unit,
        total: Math.round(v.total * 1000) / 1000,
        perDay,
        ideal: target ? target.amount : null,
        idealUnit: target ? target.unit : null,
        kind: target ? target.kind : null,
        severity: target ? nutrientGapSeverity(target.kind, perDay, target.amount) : null,
      };
    })
    // Nutrients with a known target lead (alphabetical), then everything
    // without one (alphabetical) — so the rows worth judging against a goal
    // aren't scattered through dozens of reference-only ones.
    .sort((a, b) => {
      const aHasIdeal = a.ideal !== null;
      const bHasIdeal = b.ideal !== null;
      if (aHasIdeal !== bHasIdeal) return aHasIdeal ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    nutrients,
    daysLogged,
    contributing: [...contributing].sort(),
    missing: [...missing].sort(),
  };
}

// Estimated Thermic Effect of Food share of each macro's OWN calories —
// Settings so they can be retuned without a code change, same idiom
// TEF_PERCENT_KEY (charts.js) already uses for the flat whole-intake figure.
// Defaults are the commonly-cited per-macro TEF shares: Protein 25%,
// Carbohydrate 7.5%, Fat 2%.
const TEF_PROTEIN_SHARE_KEY = 'TEF_PROTEIN_PERCENT';
const TEF_CARB_SHARE_KEY = 'TEF_CARB_PERCENT';
const TEF_FAT_SHARE_KEY = 'TEF_FAT_PERCENT';
const TEF_PROTEIN_SHARE_DEFAULT = 25;
const TEF_CARB_SHARE_DEFAULT = 7.5;
const TEF_FAT_SHARE_DEFAULT = 2;

// Standard Atwater energy factors (kcal/g), keyed by the exact FDC nutrient
// name so this reads straight off the same panel nutrient-targets.js's Daily
// Value table already keys by, no separate lookup needed. tefShare is read
// fresh from Settings on every call rather than baked in here, so a value
// edited in the Settings panel takes effect on the next Calculate/estimate
// without a reload.
function tefMacroRate() {
  return {
    Protein: { label: 'Protein', kcalPerGram: 4, tefShare: getSetting(TEF_PROTEIN_SHARE_KEY, TEF_PROTEIN_SHARE_DEFAULT) / 100 },
    'Carbohydrate, by difference': { label: 'Carbohydrate', kcalPerGram: 4, tefShare: getSetting(TEF_CARB_SHARE_KEY, TEF_CARB_SHARE_DEFAULT) / 100 },
    'Total lipid (fat)': { label: 'Fat', kcalPerGram: 9, tefShare: getSetting(TEF_FAT_SHARE_KEY, TEF_FAT_SHARE_DEFAULT) / 100 },
  };
}

// Estimated Thermic Effect of Food for one day's own Consumption breakdown —
// each ingredient's protein/carb/fat grams, from its own pulled 🧬
// Micronutrients panel scaled to how much of it was actually logged (same
// per-ingredient scaling aggregateMicronutrientIntake uses above, just over
// one day's breakdown array directly instead of aggregateFoodIntake's range
// total, so this also works on a day still open in the form and not yet
// saved). Atwater, not each ingredient's own listed Calories: TEF is defined
// against the macro split, and the two can disagree by a few percent per
// ingredient.
//
// Null when nothing in the breakdown has macros pulled yet, so a day with no
// 🧬 data can fall back to the flat TEF_PERCENT_OF_INTAKE estimate (charts.js)
// instead of reporting a confident zero.
function estimateTefBreakdown(breakdown) {
  const macroGrams = { Protein: 0, 'Carbohydrate, by difference': 0, 'Total lipid (fat)': 0 };
  let matched = false;

  (breakdown || []).forEach((item) => {
    const entry = findNutritionEntry(item.name);
    const parsed = entry ? parseMicronutrients(entry.micronutrients) : null;
    if (!parsed) return;

    const { grams, count } = parseBreakdownAmount(item.amount);
    const scale = micronutrientScaleFactor(entry, { grams: grams || 0, count: count || 0 });
    if (scale <= 0) return;

    Object.keys(macroGrams).forEach((name) => {
      if (!parsed[name]) return;
      macroGrams[name] += parsed[name].amount * scale;
      matched = true;
    });
  });

  if (!matched) return null;

  const rate = tefMacroRate();
  const rows = Object.entries(macroGrams).map(([name, grams]) => {
    const { label, kcalPerGram, tefShare } = rate[name];
    const kcal = grams * kcalPerGram;
    return { name: label, grams, kcal, tef: kcal * tefShare };
  });
  const totalKcal = rows.reduce((sum, r) => sum + r.kcal, 0);
  const totalTef = rows.reduce((sum, r) => sum + r.tef, 0);
  return { rows, totalKcal, tefKcal: Math.round(totalTef) };
}

// Same estimate as estimateTefBreakdown above, but for one aggregateFoodIntake
// row (food-insight.js's Food mode ingredient table) — that row already
// carries its own {name, grams, count} totalled over the whole picked range,
// so this reuses micronutrientScaleFactor directly instead of re-parsing an
// amount string. Null on an ingredient with no 🧬 Micronutrients pulled, same
// "not measured" rather than a confident zero.
function estimateTefForFoodRow(row) {
  const entry = findNutritionEntry(row.name);
  const parsed = entry ? parseMicronutrients(entry.micronutrients) : null;
  if (!parsed) return null;

  const scale = micronutrientScaleFactor(entry, row);
  if (scale <= 0) return null;

  const rate = tefMacroRate();
  let tef = 0;
  let matched = false;
  Object.keys(rate).forEach((name) => {
    if (!parsed[name]) return;
    tef += parsed[name].amount * scale * rate[name].kcalPerGram * rate[name].tefShare;
    matched = true;
  });
  return matched ? Math.round(tef) : null;
}

// The one line every render of this mode leads with — what the totals below
// actually cover, since "18 nutrients, none of them showing iron" means
// something very different depending on whether any iron-rich ingredient was
// even priced this round.
function formatMicronutrientCoverageLine(data) {
  if (data.nutrients.length === 0) return 'No Calculate-derived ingredients logged in this window.';
  return `Based on ${data.contributing.length} ingredient${data.contributing.length === 1 ? '' : 's'} with pulled micronutrient data, over ${data.daysLogged} day${data.daysLogged === 1 ? '' : 's'} logged.`;
}

function renderMicronutrientInsightPreview(data) {
  renderInsightLines(document.getElementById('insight-micro-profile'), [
    ...formatProfileLines(gatherProfileSnapshot()),
    formatMicronutrientCoverageLine(data),
  ]);

  const tbody = document.getElementById('insight-micro-body');
  tbody.innerHTML = '';

  if (data.nutrients.length === 0) {
    tbody.appendChild(renderEmptyRow(4, 'Nothing to show — see the coverage note above.'));
    return;
  }

  data.nutrients.forEach((n) => {
    const tr = document.createElement('tr');
    if (n.severity === 'severe') tr.classList.add('nutrient-gap-severe');
    else if (n.severity === 'mild') tr.classList.add('nutrient-gap-mild');
    tr.append(
      makeCell(n.displayName),
      makeCell(`${n.total} ${n.unit}`),
      makeCell(n.perDay !== null ? `${n.perDay} ${n.unit}` : '—'),
      makeCell(n.ideal !== null ? `${n.ideal} ${n.idealUnit}` : '—'),
    );
    tbody.appendChild(tr);
  });
}

// Asked when the question box is left blank — mirrors Food mode's own
// default-question pattern, since this is the same "is this enough, what's
// short, what should I eat" shape of question the user actually wants.
const MICRONUTRIENT_INSIGHT_DEFAULT_QUESTION = 'Is this amount enough? What is missing, and what should I eat to fix it?';

function formatMicronutrientInsightPrompt(data, { from, to, question }) {
  const profile = formatProfileLines(gatherProfileSnapshot()).join('\n');
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
  const q = (question && question.trim()) ? question.trim() : MICRONUTRIENT_INSIGHT_DEFAULT_QUESTION;
  return `${profile}\n\n${coverage}\n\n${header}\n${body}\n\nQuestion: ${q}`;
}

const MICRONUTRIENT_INSIGHT_SYSTEM_PROMPT = `You are a nutrition-savvy assistant reviewing REAL, measured micronutrient totals — vitamins, minerals, and other nutrients — someone actually ate over a recent period. Unlike a rough estimate, these figures come from USDA FoodData Central, matched to the exact ingredients and amounts the user logged, so treat the numbers themselves as trustworthy for whatever they cover. A nutrient that's low or missing from the list may genuinely be low, or may simply not have been priced yet — never treat a nutrient missing from the list as confirmed zero intake.

Each nutrient line gives a total for the whole period AND an average per day, plus (where one exists) an ideal/day figure and whether the app's own math already flags a gap — use the per-day figure against the ideal to judge adequacy, since dietary reference intakes are per-day amounts, not per-period totals.

The ideal/day figure is a FIXED FDA Daily Value (a general adult reference from a 2,000 kcal diet), NOT personalized to this user's own sex/age/body mass. SEVERE GAP / MILD GAP flags are already computed by the app, but only for running well UNDER the ideal on a get-enough-of nutrient — the app deliberately does not flag running over, even on a limit-type nutrient like sodium or saturated fat, so judge any excess yourself from the raw per-day figure rather than expecting a flag for it. Treat the flags themselves as a starting point, not the final word: the report is preceded by the user's age, sex, height, current body mass and BMI, and reference intakes for iron, calcium, sodium, folate, B12 and most other nutrients differ meaningfully by sex and age (e.g. iron needs are markedly higher for a menstruating woman than for a man of the same age) — say explicitly when the fixed ideal is likely too low or too high for THIS person given their profile, rather than repeating the flag uncritically. A nutrient with "no established daily value" has no official reference — don't invent one. Any profile field may read "not set" or "not logged" — say what you'd need rather than assuming a figure.

You are not a doctor — do not diagnose a deficiency or excess as a medical condition, and do not recommend supplement doses; suggest specific food-based ways to close a real, flagged gap instead.

Write a short plain-text report with exactly these five sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall picture this data shows, naming how many ingredients it's based on.
Going well: nutrients that look adequately covered at this daily average, given the profile.
Needs attention: nutrients that look short OR unusually high at this daily average.
Suggestions: 2-4 concrete, specific food-based ways to close the likely real gaps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.
Answer: directly answers the question included below.

Keep the whole report under 250 words.`;
