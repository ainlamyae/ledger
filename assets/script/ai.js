// One chat call for every AI feature, sent to whichever provider AI_PROVIDER names.
// Each provider's key and models live in Settings, never in the code:
// <PROVIDER>_MODELS is JSON, e.g. {"text": "openai/gpt-oss-120b", "vision": "qwen/qwen3.8-27b"}.
const AI_PROVIDERS = {
  groq: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keySetting: 'GROQ_API_KEY',
    modelsSetting: 'GROQ_MODELS',
    // The free tier allows 1000 output tokens a minute; no thinking spends them.
    visionExtras: { max_tokens: 900, reasoning_effort: 'none' },
  },
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keySetting: 'OPENROUTER_API_KEY',
    modelsSetting: 'OPENROUTER_MODELS',
    visionExtras: {},
    // Optional attribution OpenRouter shows on its dashboard.
    headers: () => ({ 'HTTP-Referer': location.origin, 'X-Title': 'Ledger' }),
  },
};
const AI_SEED = 42;
// How much of an unparseable reply an error message quotes.
const AI_SNIPPET_LENGTH = 300;

function aiProvider() {
  const id = getSettingString('AI_PROVIDER', 'groq').trim().toLowerCase();
  const provider = AI_PROVIDERS[id];
  if (!provider) throw new Error(`AI_PROVIDER must be ${Object.keys(AI_PROVIDERS).join(' or ')}, not "${id}".`);
  return provider;
}

// `role` is a key of the provider's models JSON: "text" or "vision".
function aiModel(provider, role) {
  const raw = getSettingString(provider.modelsSetting, null);
  const example = `{"text": "<model id>", "vision": "<model id>"}`;
  if (!raw) throw new Error(`Add a ${provider.modelsSetting} setting first, e.g. ${example}.`);
  let models;
  try { models = JSON.parse(raw); } catch { throw new Error(`${provider.modelsSetting} isn't valid JSON, e.g. ${example}.`); }
  if (!models?.[role]) throw new Error(`${provider.modelsSetting} has no "${role}" model, e.g. ${example}.`);
  return models[role];
}

// POSTs one chat completion and returns { content, provider }.
async function aiChat(role, body) {
  const provider = aiProvider();
  const apiKey = getSettingString(provider.keySetting, null);
  if (!apiKey) throw new Error(`Add a ${provider.keySetting} setting first (Settings panel).`);
  const model = aiModel(provider, role);

  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(provider.headers ? provider.headers() : {}),
    },
    body: JSON.stringify({
      model,
      ...(role === 'vision' ? provider.visionExtras : {}),
      ...body,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `${provider.name} API error ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(`${provider.name} returned no message.`);
  return { content, provider };
}

function aiTextMessages(systemPrompt, userMessage) {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
}

// One user turn holding an image and its instructions.
function aiImageMessages(base64Image, mimeType, text) {
  return [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
      { type: 'text', text },
    ],
  }];
}

function aiUnexpectedResponse(provider, content, reason) {
  const snippet = content.length > AI_SNIPPET_LENGTH ? `${content.slice(0, AI_SNIPPET_LENGTH)}…` : content;
  return new Error(`${provider.name} returned an unexpected response${reason ? ` (${reason})` : ''}: ${snippet}`);
}

// The outermost {...} of a reply, ignoring any words around it; null if none.
// Parsed here rather than via response_format: json_object, whose server-side
// validator hard-rejects output with a stray word around the object.
function aiJsonObjectText(content) {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start === -1 || end <= start ? null : content.slice(start, end + 1);
}

// The reply's JSON object, or a quoted error. `prepare` may repair its text first.
function aiParseJsonReply(provider, content, prepare = (text) => text) {
  const text = aiJsonObjectText(content);
  if (text === null) throw aiUnexpectedResponse(provider, content, 'no JSON object found');
  const prepared = prepare(text);
  try {
    return JSON.parse(prepared);
  } catch (e) {
    throw aiUnexpectedResponse(provider, content, `invalid JSON — ${e.message}`);
  }
}

// The free-text chat call every Insight mode makes. Returns the raw text.
async function aiChatText(systemPrompt, userMessage, temperature = 0.4) {
  const { content } = await aiChat('text', { temperature, messages: aiTextMessages(systemPrompt, userMessage) });
  return content;
}

// Never asks the model to rewrite the user's text: renamed items ("egg" -> "egg,
// whole") used to be written back over what they typed. "query" is only a USDA
// search term; health-physique-estimator.js prefers the user's own text.
const AI_EXTRACT_SYSTEM_PROMPT = `You are a nutrition estimator for a personal health log. The user gives you a freeform
description of food ingredients and amounts (e.g. "2 eggs, 1 slice toast, 1 tbsp butter").

Split it into individual food items. For each item, provide:
- "query": a plain, generic food name suitable for searching a nutrition database (not a brand name)
- "grams": your best real-world estimate of the total gram mass for the stated amount
- "count": how many discrete whole units of this food are described (e.g. 2 for "2 rice cakes", 1 for "a banana", 3 for "3 eggs") — use null if it isn't naturally counted in whole pieces (e.g. a measured/weighed ingredient like "125g ground beef" or "1 cup rice")
- "kcalPer100gFallback": your best estimate of calories per 100g for this food
- "proteinPer100gFallback": your best estimate of grams of protein per 100g for this food

An amount may be given as an energy figure instead of a quantity (e.g. "300kcal cookie", "1200kj rice") — that is how many
calories were eaten, NOT a mass or a count. For those, work "grams" back out from your own kcal-per-100g estimate for the
food, and use null for "count".

Do not calculate the total calories or protein yourself — that happens outside this response.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"items": [{"query": "<generic food name>", "grams": <number>, "count": <number or null>, "kcalPer100gFallback": <number>, "proteinPer100gFallback": <number>}, ...]}`;

// The model sometimes writes its unit arithmetic as a field value ("grams": 2.5 * 0.3):
// invalid JSON, so it's evaluated here (exactly) instead of rejected.
function aiEvaluateArithmeticFields(jsonText) {
  return jsonText.replace(/("(?:grams|count|kcalPer100gFallback|proteinPer100gFallback)"\s*:\s*)([^,}]+)/g, (match, prefix, rawValue) => {
    const trimmed = rawValue.trim();
    if (trimmed === 'null') return match;
    if (!Number.isNaN(Number(trimmed))) return match;
    if (!/^[\d.\s*+\-/()]+$/.test(trimmed)) return match;
    try {
      const value = Function(`"use strict"; return (${trimmed});`)();
      return Number.isFinite(value) ? `${prefix}${value}` : match;
    } catch {
      return match;
    }
  });
}

async function aiExtractIngredients(notesText) {
  const { content, provider } = await aiChat('text', {
    temperature: 0,
    seed: AI_SEED,
    messages: aiTextMessages(AI_EXTRACT_SYSTEM_PROMPT, notesText),
  });
  console.debug('[ai] raw response content:', content);

  const parsed = aiParseJsonReply(provider, content, aiEvaluateArithmeticFields);
  const fail = (reason) => { throw aiUnexpectedResponse(provider, content, reason); };
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) fail('missing "items" array');

  // Coerced, not type-checked: numbers sometimes arrive as strings ("50g").
  // "count" stays null for foods not counted in whole units.
  const items = parsed.items.map((item) => ({
    query: item.query,
    grams: parseFloat(item.grams),
    count: (item.count === null || item.count === undefined || item.count === '') ? null : parseFloat(item.count),
    kcalPer100gFallback: parseFloat(item.kcalPer100gFallback),
    proteinPer100gFallback: parseFloat(item.proteinPer100gFallback),
  }));
  if (items.some((item) =>
    !item.query || Number.isNaN(item.grams) || Number.isNaN(item.kcalPer100gFallback) || Number.isNaN(item.proteinPer100gFallback) ||
    (item.count !== null && Number.isNaN(item.count))
  )) {
    fail('an item is missing query/grams/kcalPer100gFallback/proteinPer100gFallback, or has an invalid count');
  }

  return { items };
}

// The Workout counterpart to aiExtractIngredients: a catalogue row for each exercise
// the Activity sheet lacks, so the day is priced at a real MET and 💾 can save it.
// `lines` is [{ name, unit }] (x, sec, min, step); `catalogue` is the sheet's
// { categories, groups, muscleGroups }, offered for reuse. Returns
// [{ name, met, category, group, muscleGroup, amount, rest }].
async function aiEstimateActivities(lines, catalogue) {
  const list = (values) => (values.length ? values.map((v) => `"${v}"`).join(', ') : '(none yet)');
  const systemPrompt = `You fill in exercise catalogue rows for a personal workout log. For each exercise name given, provide:
- "name": the name exactly as given
- "met": its MET value from the Compendium of Physical Activities (a number, e.g. 3.5 for a general machine exercise, 8 for running)
- "category": one of these existing categories if any fits: ${list(catalogue.categories)}
- "group": one of these existing groups (the plan's sub-tables, e.g. a training day) if any fits, else a short new one: ${list(catalogue.groups)}
- "muscleGroup": one of these existing muscle groups if any fits, else a short new one ("" for cardio): ${list(catalogue.muscleGroups)}
- "amount": a typical prescription in the line's unit — "3 x 10" for x (reps), "3 x 45 sec" for sec (a hold), "30" for min, "6000" for step
- "rest": a typical rest between sets, e.g. "60 sec" ("" for min and step)

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"activities": [{"name": "<as given>", "met": <number>, "category": "<text>", "group": "<text>", "muscleGroup": "<text>", "amount": "<text>", "rest": "<text>"}, ...]}`;

  const { content, provider } = await aiChat('text', {
    temperature: 0,
    seed: AI_SEED,
    messages: aiTextMessages(systemPrompt, lines.map((l) => `${l.name} (unit: ${l.unit})`).join('\n')),
  });

  const parsed = aiParseJsonReply(provider, content);
  if (!Array.isArray(parsed.activities)) throw aiUnexpectedResponse(provider, content, 'missing "activities" array');

  return parsed.activities
    .map((a) => ({
      name: String(a.name || '').trim(),
      met: parseFloat(a.met),
      category: String(a.category || '').trim(),
      group: String(a.group || '').trim(),
      muscleGroup: String(a.muscleGroup || '').trim(),
      amount: String(a.amount || '').trim(),
      rest: String(a.rest || '').trim(),
    }))
    .filter((a) => a.name && Number.isFinite(a.met) && a.met > 0);
}

// Reads a photographed Nutrition Facts label. `nutrients` is [{ name, unit }], the
// only names the model may use. Returns { name, serving, servingGrams, calories,
// nutrients: [{ name, amount, unit, percentDV }] }, per serving as printed.
async function aiReadNutritionLabel(base64Image, mimeType, nutrients) {
  const names = nutrients.map((n) => `- ${n.name}`).join('\n');
  const { content, provider } = await aiChat('vision', {
    temperature: 0,
    messages: aiImageMessages(base64Image, mimeType, `This is a food product's Nutrition Facts label (it may be bilingual English/French, e.g. Canadian).
Read only what is printed; never guess a nutrient that isn't on the label.

For every nutrient line, give its printed amount and unit for one serving, and its printed % Daily Value.
Use null for whichever of the two isn't printed. Name each nutrient with exactly one of these names:
${names}
Skip any printed line that matches none of them.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"name": "<product name if visible, else null>", "serving": "<serving size as printed, e.g. 1 cup (250 mL) or 2 biscuits (30 g)>", "servingGrams": <grams in one serving if printed, else null>, "calories": <number or null>, "nutrients": [{"name": "<one of the names above>", "amount": <number or null>, "unit": "<g, mg or µg, or null>", "percentDV": <number or null>}]}`),
  });

  // Any unreadable reply gets the same reason-less error.
  const text = aiJsonObjectText(content);
  let parsed = null;
  try { parsed = text === null ? null : JSON.parse(text); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.nutrients)) throw aiUnexpectedResponse(provider, content);
  return parsed;
}

// A food photo as an ingredient list in the Consumption textarea's format (one item
// per line, e.g. "250g chicken breast"), ready to append.
async function aiAnalyzeFoodImage(base64Image, mimeType) {
  const { content } = await aiChat('vision', {
    temperature: 0,
    messages: aiImageMessages(base64Image, mimeType, `You are a nutrition assistant. Identify every food item visible in this image and estimate realistic portion sizes.

Return ONLY a plain list, one item per line:
- Weighed items: "<grams>g <food name>"  →  e.g. "250g chicken breast"
- Countable items: "<count> <food name>"  →  e.g. "2 eggs"

No headings, no explanations, no bullet points — just the list.`),
  });

  return content.trim();
}
