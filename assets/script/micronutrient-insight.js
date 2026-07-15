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

  const nutrients = [...totals.entries()]
    .map(([name, v]) => ({
      name,
      unit: v.unit,
      total: Math.round(v.total * 1000) / 1000,
      perDay: daysLogged > 0 ? Math.round((v.total / daysLogged) * 1000) / 1000 : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    nutrients,
    daysLogged,
    contributing: [...contributing].sort(),
    missing: [...missing].sort(),
  };
}

// The one line every render of this mode leads with — what the totals below
// actually cover, since "18 nutrients, none of them showing iron" means
// something very different depending on whether any iron-rich ingredient was
// even priced this round.
function formatMicronutrientCoverageLine(data) {
  if (data.nutrients.length === 0) {
    return data.missing.length
      ? `No micronutrient data for this window yet — ${data.missing.length} ingredient(s) logged (${data.missing.join(', ')}), but none have been priced via Nutrition's 🧬 Pull Micronutrients.`
      : 'No Calculate-derived ingredients logged in this window.';
  }

  const covered = `Based on ${data.contributing.length} ingredient${data.contributing.length === 1 ? '' : 's'} with pulled micronutrient data, over ${data.daysLogged} day${data.daysLogged === 1 ? '' : 's'} logged.`;
  if (data.missing.length === 0) return covered;
  return `${covered} ${data.missing.length} ingredient${data.missing.length === 1 ? '' : 's'} logged but not yet priced for micronutrients (excluded from totals below): ${data.missing.join(', ')}.`;
}

function renderMicronutrientInsightPreview(data) {
  renderInsightLines(document.getElementById('insight-micro-profile'), [
    ...formatProfileLines(gatherProfileSnapshot()),
    formatMicronutrientCoverageLine(data),
  ]);

  const tbody = document.getElementById('insight-micro-body');
  tbody.innerHTML = '';

  if (data.nutrients.length === 0) {
    tbody.appendChild(renderEmptyRow(3, 'Nothing to show — see the coverage note above.'));
    return;
  }

  data.nutrients.forEach((n) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(n.name),
      makeCell(`${n.total} ${n.unit}`),
      makeCell(n.perDay !== null ? `${n.perDay} ${n.unit}` : '—'),
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
  const header = `Real, measured nutrient totals (from USDA FoodData Central, via each ingredient's own Nutrition-table entry) for the ingredients logged from ${from} to ${to} that have been priced for micronutrients — name: total over the period (average per day):`;
  const body = data.nutrients.length
    ? data.nutrients.map((n) => `  - ${n.name}: ${n.total} ${n.unit} total (${n.perDay !== null ? `${n.perDay} ${n.unit}/day avg` : 'no logged days to average over'})`).join('\n')
    : '(none — see the coverage note above)';
  const q = (question && question.trim()) ? question.trim() : MICRONUTRIENT_INSIGHT_DEFAULT_QUESTION;
  return `${profile}\n\n${coverage}\n\n${header}\n${body}\n\nQuestion: ${q}`;
}

const MICRONUTRIENT_INSIGHT_SYSTEM_PROMPT = `You are a nutrition-savvy assistant reviewing REAL, measured micronutrient totals — vitamins, minerals, and other nutrients — someone actually ate over a recent period. Unlike a rough estimate, these figures come from USDA FoodData Central, matched to the exact ingredients and amounts the user logged, so treat the numbers themselves as trustworthy for whatever they cover.

Coverage is the one thing that is NOT complete, and a coverage line before the nutrient list says exactly how partial it is: it names how many ingredients contributed real data and, when relevant, lists ingredients that were logged but excluded because they have not been priced yet (via the app's own Pull Micronutrients action). This is the most important caveat in the whole report — a nutrient that is low or absent from the list may genuinely be low, or may simply be undercounted because a rich source of it was logged but not yet priced. Read the excluded-ingredient names for hints: if a plausible source of a nutrient you'd flag as short is sitting in that excluded list, say so explicitly ("X wasn't counted because it hasn't been priced yet, and it's a likely source of Y") rather than presenting the gap as certain. Never treat a nutrient missing from the list as confirmed zero intake.

Each nutrient line gives a total for the whole period AND an average per day — use the per-day figure to judge adequacy, since dietary reference intakes are per-day amounts, not per-period totals.

The report is preceded by the user's age, sex, height, current body mass and BMI. Use it: reference intakes for iron, calcium, sodium, folate, B12 and most other nutrients differ meaningfully by sex and age (e.g. iron needs are markedly higher for a menstruating woman than for a man of the same age). Any profile field may read "not set" or "not logged" — say what you'd need rather than assuming a figure, and where a judgment genuinely depends on a missing field (e.g. sex for iron), say so.

Compare each covered nutrient's daily average against standard adult dietary reference intakes (RDA/AI), adjusted for the profile above where those intakes differ by sex/age. Flag both directions — a nutrient running low AND one running unusually high (e.g. sodium, or a fat-soluble vitamin like A or D, which can build up) both matter. You are not a doctor — do not diagnose a deficiency or excess as a medical condition, and do not recommend supplement doses; suggest specific food-based ways to close a real gap instead.

Write a short plain-text report with exactly these five sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall picture this data shows, naming the coverage level (e.g. "based on N ingredients, M not yet priced") so the reader knows how complete a picture this is.
Going well: nutrients that look adequately covered at this daily average, given the profile.
Needs attention: nutrients that look short OR unusually high at this daily average — for a short one, note if an excluded (not-yet-priced) ingredient might already cover it in reality.
Suggestions: 2-4 concrete, specific food-based ways to close the likely real gaps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line. If an excluded ingredient looks like it would close a gap, the first suggestion can simply be to price it via Pull Micronutrients rather than eat something new.
Answer: directly answers the question included below.

Keep the whole report under 250 words.`;
