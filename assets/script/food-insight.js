// "🥗 Food Insight" button: aggregates every ingredient logged (via the
// Health Log's 🧮 Calculate breakdown) over a lookback window into one
// per-ingredient total, then sends that list plus an optional free-text
// question to Groq for a nutrient-gap read. Separate feature/modal from
// insight.js by design — no vitamin/mineral data exists anywhere in this
// app (usda.js only extracts kcal/protein), so this leans entirely on the
// model's own general food-composition knowledge, same trust level the app
// already extends it via item.kcalPer100gFallback in calorie-estimator.js.
// Wired up by initFoodInsightPanel(), called from app.js.

const FOOD_INSIGHT_LOOKBACK_DEFAULT = 7;
const FOOD_INSIGHT_DEFAULT_QUESTION = 'What vitamins or minerals might be missing from this diet?';

// Sums each Calculate-derived breakdown item across every Calories; Protein
// entry in the window, grouped by lowercase-trimmed ingredient name. Exact
// match (not the trailing-s fold nutrition.js's findNutritionEntry uses) —
// that fold exists to prevent duplicate *catalog* rows; here "egg"/"eggs"
// showing as two summary lines is a harmless cosmetic difference, not a
// data-quality problem, so the simpler/more predictable exact match wins.
// Entries with no breakdown (entry.breakdown === []) are silently skipped.
function aggregateFoodIntake(lookbackDays) {
  const dates = lastNDates(lookbackDays);
  const from = dates[0];
  const to = dates[dates.length - 1];

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

function currentFoodInsightLookbackDays() {
  return Number(document.getElementById('food-insight-lookback').value) || FOOD_INSIGHT_LOOKBACK_DEFAULT;
}

// Renders the (locally computed, not AI) ingredient table.
function renderFoodInsightPreview(lookbackDays) {
  const tbody = document.getElementById('food-insight-ingredients-body');
  tbody.innerHTML = '';
  const rows = aggregateFoodIntake(lookbackDays);

  if (rows.length === 0) {
    tbody.appendChild(renderEmptyRow(4, `No Calculate-derived ingredients logged in the last ${lookbackDays} days.`));
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

// Plain-text ingredient list + the user's question (or the default). Kept
// intentionally simple — ingredient totals only, no day-by-day breakdown
// (that's what Insight is for).
function formatFoodInsightPrompt(rows, lookbackDays, question) {
  const header = `Aggregated ingredients logged over the last ${lookbackDays} days (name: total amount, total calories, total protein):`;
  const body = rows.length
    ? rows.map((r) => `- ${r.name} (${r.amountLabel}): ${r.calories} kcal, ${r.protein} g protein`).join('\n')
    : '(no Calculate-derived ingredient breakdown logged in this window)';
  const q = (question && question.trim()) ? question.trim() : FOOD_INSIGHT_DEFAULT_QUESTION;
  return `${header}\n${body}\n\nQuestion: ${q}`;
}

const FOOD_INSIGHT_SYSTEM_PROMPT = `You are a nutrition-savvy assistant reviewing a plain list of foods someone logged over a recent period — each ingredient's total amount eaten and the total calories/protein it contributed. No vitamin or mineral data is provided; none was measured. Use your general knowledge of typical food composition to infer which vitamins/minerals this pattern of eating is likely rich in or short on, and answer the user's specific question.

Be explicit that this is an inference from typical food composition, not a lab-measured nutrient analysis, and that specific products/brands/preparation can vary. You are not a doctor — do not diagnose a deficiency or recommend supplement dosages; suggest food-based ways to close likely gaps instead.

Write a short plain-text answer. Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only. Keep it under 250 words.`;

async function generateFoodInsight(lookbackDays, question) {
  const apiKey = getSettingString('GROQ_API_KEY', null);
  if (!apiKey) throw new Error('Add a GROQ_API_KEY setting first (Settings panel).');

  const rows = aggregateFoodIntake(lookbackDays);
  const userMessage = formatFoodInsightPrompt(rows, lookbackDays, question);

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

// Same untrusted-model-output safety rule as insight.js's renderInsightText
// — one <p> per non-blank line via textContent, never innerHTML. Not
// shared with renderInsightText: that function's job is bolding insight.js's
// 4 fixed section labels, which don't apply to this feature's freeform Q&A
// response — duplicating this ~10-line helper matches how the app already
// keeps small per-feature render helpers local rather than growing a shared
// grab-bag module.
function renderFoodInsightText(container, text) {
  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const p = document.createElement('p');
    p.textContent = line;
    container.appendChild(p);
  });
}

async function runFoodInsightGeneration(lookbackDays, question) {
  const body = document.getElementById('food-insight-body');
  const btn = document.getElementById('food-insight-generate-btn');
  const select = document.getElementById('food-insight-lookback');
  const textarea = document.getElementById('food-insight-question');

  body.innerHTML = '';
  clearFieldError('food-insight-status');

  const loading = document.createElement('p');
  loading.className = 'hint';
  loading.textContent = `Analyzing your last ${lookbackDays} days of food…`;
  body.appendChild(loading);

  btn.disabled = true;
  select.disabled = true;
  textarea.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Generating…';

  try {
    const text = await generateFoodInsight(lookbackDays, question);
    body.innerHTML = '';
    renderFoodInsightText(body, text);
  } catch (err) {
    body.innerHTML = '';
    showFieldError('food-insight-status', err.message);
  } finally {
    btn.disabled = false;
    select.disabled = false;
    textarea.disabled = false;
    btn.textContent = originalLabel;
  }
}

function openFoodInsightModal() {
  document.getElementById('food-insight-modal').hidden = false;
  clearFieldError('food-insight-status');
  document.getElementById('food-insight-question').value = '';
  renderFoodInsightPreview(currentFoodInsightLookbackDays());

  const body = document.getElementById('food-insight-body');
  body.innerHTML = '';
  const placeholder = document.createElement('p');
  placeholder.className = 'hint';
  placeholder.textContent = 'Review the ingredients above, optionally ask a question, then click "Send to AI".';
  body.appendChild(placeholder);
}

function closeFoodInsightModal() {
  document.getElementById('food-insight-modal').hidden = true;
}

function initFoodInsightPanel() {
  document.getElementById('food-insight-btn').addEventListener('click', openFoodInsightModal);
  document.getElementById('food-insight-close-btn').addEventListener('click', closeFoodInsightModal);
  document.getElementById('food-insight-generate-btn').addEventListener('click', () => {
    runFoodInsightGeneration(currentFoodInsightLookbackDays(), document.getElementById('food-insight-question').value);
  });
  document.getElementById('food-insight-lookback').addEventListener('change', () => {
    renderFoodInsightPreview(currentFoodInsightLookbackDays());
  });
}
