// "🥗 Food Insight" panel: aggregates every ingredient logged (via the
// Health Log's 🧮 Calculate breakdown) over a lookback window into one
// per-ingredient total, then sends that list plus an optional free-text
// question to Groq for a nutrient-gap read. Separate feature/panel from
// insight.js by design — no vitamin/mineral data exists anywhere in this
// app (usda.js only extracts kcal/protein), so this leans entirely on the
// model's own general food-composition knowledge, same trust level the app
// already extends it via item.kcalPer100gFallback in calorie-estimator.js.
// Unlike insight.js, its last result IS persisted — to the Settings tab, as
// FOOD_INSIGHT_LAST_RESULT/FOOD_INSIGHT_LAST_GENERATED_AT — so the panel
// still shows something on a fresh page load instead of going blank.
// Wired up by initFoodInsightPanel(), called from app.js.

// Default span of the From/To date pickers on first load — otherwise
// identical in meaning to the old fixed 7-day lookback.
const FOOD_INSIGHT_LOOKBACK_DEFAULT_DAYS = 7;
const FOOD_INSIGHT_DEFAULT_QUESTION = 'What vitamins or minerals might be missing from this diet?';

// Sums each Calculate-derived breakdown item across every Calories; Protein
// entry in the window, grouped by lowercase-trimmed ingredient name. Exact
// match (not the trailing-s fold nutrition.js's findNutritionEntry uses) —
// that fold exists to prevent duplicate *catalog* rows; here "egg"/"eggs"
// showing as two summary lines is a harmless cosmetic difference, not a
// data-quality problem, so the simpler/more predictable exact match wins.
// Entries with no breakdown (entry.breakdown === []) are silently skipped.
function aggregateFoodIntake(from, to) {
  const byName = new Map();

  getDatedWellnessEntries()
    .filter((e) => e.category === 'Calories; Protein' && e.date >= from && e.date <= to)
    .forEach((e) => {
      (e.breakdown || []).forEach((item) => {
        const key = String(item.name || '').trim().toLowerCase();
        if (!key) return;
        if (!byName.has(key)) {
          byName.set(key, { name: item.name.trim(), calories: 0, protein: 0, grams: 0, count: 0 });
        }
        const agg = byName.get(key);
        agg.calories += item.calories || 0;
        agg.protein += item.protein || 0;
        const { grams, count } = parseBreakdownAmount(item.amount);
        if (grams !== null) agg.grams += grams;
        if (count !== null) agg.count += count;
      });
    });

  // Highest-calorie ingredient first — matches calorie-estimator.js's own
  // breakdown table ordering (sortedMacros).
  return [...byName.values()]
    .map((agg) => {
      let grams = agg.grams;
      let count = agg.count;
      if (count > 0) {
        const converted = convertCountToGrams(agg.name, count);
        if (converted !== null) {
          grams += converted;
          count = 0;
        }
      }
      return {
        name: agg.name,
        calories: Math.round(agg.calories),
        protein: Math.round(agg.protein * 10) / 10,
        amountLabel: formatAggregatedAmount(grams, count),
      };
    })
    .sort((a, b) => b.calories - a.calories);
}

// Converts a unit count (e.g. 23 eggs) to grams using the Nutrition Facts
// table's own per-unit weight for that ingredient (e.g. "1x (58g)" -> 58g
// each), so the summary reads in one consistent unit instead of a bare,
// hard-to-picture count — the count-branch Amount format ("×N") never
// carries a real weight itself (see calorie-estimator.js), only the
// Nutrition Facts row does. Returns null (leaving the count as-is for
// display) if there's no matching row or its Amount has no gram figure —
// e.g. an ingredient banked via a fresh USDA/AI miss that hasn't been
// reviewed/saved yet (see the Calculate breakdown's "＋ Save" button).
function convertCountToGrams(name, count) {
  const tableEntry = findNutritionEntry(name);
  if (!tableEntry) return null;
  const tableGrams = parseGramsFromAmount(tableEntry.amount);
  if (tableGrams === null) return null;
  const tableCount = parseCountFromAmount(tableEntry.amount) || 1;
  return (tableGrams / tableCount) * count;
}

// A Calculate breakdown item's amount is always exactly "×N" (a count-branch
// match, e.g. "×2") or "Ng" (a grams-branch match/USDA estimate, e.g.
// "40.5g") — see calorie-estimator.js's amount assignments. NOT the same
// shape as the freeform Nutrition Facts table Amount field (e.g.
// "1scoop (31g)") that nutrition.js's parseGramsFromAmount/
// parseCountFromAmount are built for — reusing those here would silently
// fail on every "×N" count string (no leading digit for parseCountFromAmount
// to match), so this parses the breakdown's own exact format instead.
function parseBreakdownAmount(amount) {
  const str = String(amount || '').trim();
  const countMatch = str.match(/^×(\d+(?:\.\d+)?)$/);
  if (countMatch) return { grams: null, count: parseFloat(countMatch[1]) };
  const gramsMatch = str.match(/^(\d+(?:\.\d+)?)g$/i);
  if (gramsMatch) return { grams: parseFloat(gramsMatch[1]), count: null };
  return { grams: null, count: null };
}

// A given amount string is grams-only or count-only, never both — but
// nothing stops the same ingredient NAME from being logged once by weight
// and once by count across different entries, so show both totals rather
// than silently dropping one.
function formatAggregatedAmount(grams, count) {
  const parts = [];
  if (grams > 0) parts.push(`${Math.round(grams)}g`);
  if (count > 0) parts.push(`×${Math.round(count * 10) / 10}`);
  return parts.length ? parts.join(', ') : '—';
}

// Renders the (locally computed, not AI) ingredient table, plus the profile
// line that now rides along with it in the prompt — the panel shows everything
// it sends, the same rule Wellness/Activity Insight's data previews follow, so
// the profile can't be silently attached to the request.
function renderFoodInsightPreview({ from, to }) {
  // Unmasked, like the other two panels' data previews: this is the request
  // being shown to the person whose data it is, not a dashboard figure the
  // privacy toggle hides from someone glancing over at the charts.
  const profileEl = document.getElementById('food-insight-profile');
  profileEl.textContent = `Sent with your food: ${formatProfileLines(gatherProfileSnapshot()).join(' · ')}`;

  const tbody = document.getElementById('food-insight-ingredients-body');
  tbody.innerHTML = '';
  const rows = aggregateFoodIntake(from, to);

  if (rows.length === 0) {
    tbody.appendChild(renderEmptyRow(4, `No Calculate-derived ingredients logged from ${from} to ${to}.`));
    return;
  }

  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(r.name),
      makeCell(r.amountLabel),
      makeCell(String(r.calories)),
      makeCell(String(r.protein)),
    );
    tbody.appendChild(tr);
  });
}

// Who's eating it (the shared profile block from insight.js) + the plain-text
// ingredient list + the user's question (or the default). Still no day-by-day
// breakdown — that's what Wellness Insight is for. The profile leads, because
// nutrient adequacy is a per-body judgement: iron and calcium needs differ by
// sex and age, and "is this enough food" can't be read off an ingredient list
// without knowing the body it's feeding.
function formatFoodInsightPrompt(rows, from, to, question) {
  const profile = formatProfileLines(gatherProfileSnapshot()).join('\n');
  const header = `Aggregated ingredients logged from ${from} to ${to} (name: total amount, total calories, total protein):`;
  const body = rows.length
    ? rows.map((r) => `- ${r.name} (${r.amountLabel}): ${r.calories} kcal, ${r.protein} g protein`).join('\n')
    : '(no Calculate-derived ingredient breakdown logged in this window)';
  const q = (question && question.trim()) ? question.trim() : FOOD_INSIGHT_DEFAULT_QUESTION;
  return `${profile}\n\n${header}\n${body}\n\nQuestion: ${q}`;
}

const FOOD_INSIGHT_SYSTEM_PROMPT = `You are a nutrition-savvy assistant reviewing a plain list of foods someone logged over a recent period — each ingredient's total amount eaten and the total calories/protein it contributed. No vitamin or mineral data is provided; none was measured. Use your general knowledge of typical food composition to infer which vitamins/minerals this pattern of eating is likely rich in or short on, and answer the user's specific question.

The list is preceded by their age, sex, height, current weight and BMI. Use it: reference intakes for iron, calcium, folate, B12 and protein differ by sex and age, and whether a day's total food is a lot or a little depends on the body eating it. Any of those fields may read "not set" or "not logged" — that means the app doesn't have it, so say what you'd need rather than assuming a figure.

Be explicit that this is an inference from typical food composition, not a lab-measured nutrient analysis, and that specific products/brands/preparation can vary. You are not a doctor — do not diagnose a deficiency or recommend supplement dosages; suggest food-based ways to close likely gaps instead.

Write a short plain-text report with exactly these five sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall inferred nutrient picture this pattern of eating suggests.
Going well: vitamins/minerals this pattern likely covers well.
Needs attention: vitamins/minerals this pattern likely falls short on.
Suggestions: 2-4 concrete, specific food-based ways to close the likely gaps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.
Answer: directly answers the question included below.

Keep the whole report under 250 words.`;

async function generateFoodInsight(from, to, question) {
  const apiKey = getSettingString('GROQ_API_KEY', null);
  if (!apiKey) throw new Error('Add a GROQ_API_KEY setting first (Settings panel).');

  const rows = aggregateFoodIntake(from, to);
  const userMessage = formatFoodInsightPrompt(rows, from, to, question);

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: FOOD_INSIGHT_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function runFoodInsightGeneration(from, to, question) {
  const body = document.getElementById('food-insight-body');
  const btn = document.getElementById('food-insight-generate-btn');
  const fromEl = document.getElementById('food-insight-date-from');
  const toEl = document.getElementById('food-insight-date-to');
  const textarea = document.getElementById('food-insight-question');

  body.innerHTML = '';
  clearFieldError('food-insight-status');

  const loading = document.createElement('p');
  loading.className = 'hint';
  loading.textContent = `Analyzing ${from} to ${to}…`;
  body.appendChild(loading);

  btn.disabled = true;
  fromEl.disabled = true;
  toEl.disabled = true;
  textarea.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Generating…';

  try {
    const text = await generateFoodInsight(from, to, question);
    body.innerHTML = '';
    renderInsightText(body, text);

    // Persisted so a fresh page load still shows the last read instead of
    // going blank — unlike insight.js's Wellness Insight, this is the one
    // feature the user asked to survive a reload. Generation is still never
    // automatic; this only fires from an explicit Send to AI click.
    const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
    try {
      await saveSettingValues({
        FOOD_INSIGHT_LAST_RESULT: text,
        FOOD_INSIGHT_LAST_GENERATED_AT: generatedAt,
      });
      renderFoodInsightGeneratedAt(generatedAt);
    } catch (saveErr) {
      showFieldError('food-insight-status', `Generated, but couldn't save it: ${saveErr.message}`);
    }
  } catch (err) {
    body.innerHTML = '';
    showFieldError('food-insight-status', err.message);
  } finally {
    btn.disabled = false;
    fromEl.disabled = false;
    toEl.disabled = false;
    textarea.disabled = false;
    btn.textContent = originalLabel;
  }
}

function renderFoodInsightGeneratedAt(timestamp) {
  const el = document.getElementById('food-insight-generated-at');
  if (!timestamp) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `Last generated ${timestamp}`;
}

// Restores the last AI result (if any) from the Settings tab on page load,
// so the panel shows the previous read instead of an empty placeholder.
function renderSavedFoodInsight() {
  const body = document.getElementById('food-insight-body');
  const text = getSettingString('FOOD_INSIGHT_LAST_RESULT', null);

  body.innerHTML = '';
  if (!text) {
    const placeholder = document.createElement('p');
    placeholder.className = 'hint';
    placeholder.textContent = 'Review the ingredients above, optionally ask a question, then click "Send to AI".';
    body.appendChild(placeholder);
    renderFoodInsightGeneratedAt(null);
    return;
  }

  renderInsightText(body, text);
  renderFoodInsightGeneratedAt(getSettingString('FOOD_INSIGHT_LAST_GENERATED_AT', null));
}

// Set by initFoodInsightPanel() to the getter initDateRangeControl()
// (charts.js) returns — same shared From/To wiring insight.js and
// protein-rotation.js use.
let getFoodInsightDateRange = () => ({ from: null, to: null });

function initFoodInsightPanel() {
  clearFieldError('food-insight-status');
  getFoodInsightDateRange = initDateRangeControl('food-insight-date-from', 'food-insight-date-to', FOOD_INSIGHT_LOOKBACK_DEFAULT_DAYS, () => {
    renderFoodInsightPreview(getFoodInsightDateRange());
  });
  renderFoodInsightPreview(getFoodInsightDateRange());
  renderSavedFoodInsight();

  document.getElementById('food-insight-generate-btn').addEventListener('click', () => {
    const { from, to } = getFoodInsightDateRange();
    runFoodInsightGeneration(from, to, document.getElementById('food-insight-question').value);
  });
}
