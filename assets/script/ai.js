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

// The free-text chat call every Insight mode makes. Returns the raw text.
async function aiChatText(systemPrompt, userMessage, temperature = 0.4) {
  const { content } = await aiChat('text', {
    temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });
  return content;
}

// Deliberately does NOT ask the model to rewrite/standardize the user's
// ingredient text (an earlier version had a "notes" field for that) — it
// would silently change names (e.g. "egg" -> "egg, whole") which then got
// written back over what the user actually typed. The Notes field is never
// touched by this response now; "query" below is used purely as an internal
// USDA search term (calorie-estimator.js prefers the user's own text for the
// Nutrition table match/lookup whenever the split lines up 1:1).
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

async function aiExtractIngredients(notesText) {
  const { content, provider } = await aiChat('text', {
    temperature: 0,
    seed: AI_SEED,
    messages: [
      { role: 'system', content: AI_EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: notesText },
    ],
  });
  console.debug('[ai] raw response content:', content);

  const fail = (reason) => {
    const snippet = content.length > 300 ? `${content.slice(0, 300)}…` : content;
    throw new Error(`${provider.name} returned an unexpected response (${reason}): ${snippet}`);
  };

  // Not using response_format: json_object — a server-side JSON-mode
  // validator can hard-reject valid-enough output (e.g. if the model adds a
  // stray word around the object) with a generic "Failed to generate JSON"
  // error before we ever see the content. Parsing it ourselves is more
  // forgiving: pull out the outermost {...} and ignore anything around it.
  const jsonStart = content.indexOf('{');
  const jsonEnd = content.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd <= jsonStart) fail('no JSON object found');

  // The model sometimes writes out its unit-conversion arithmetic directly as
  // the field value (e.g. "grams": 2.5 * 0.3) instead of a final number —
  // invalid JSON, but the arithmetic itself is fine. Evaluate it ourselves
  // (exact, unlike asking the model to do it) rather than rejecting it.
  const jsonSlice = content.slice(jsonStart, jsonEnd + 1)
    .replace(/("(?:grams|count|kcalPer100gFallback|proteinPer100gFallback)"\s*:\s*)([^,}]+)/g, (match, prefix, rawValue) => {
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

  let parsed;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (e) {
    fail(`invalid JSON — ${e.message}`);
  }

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) fail('missing "items" array');

  // Coerce rather than strictly type-check — models sometimes emit numeric
  // fields as strings (e.g. "50" or "50g"). "count" is nullable (not every
  // food is naturally counted in whole units), so it's left as null rather
  // than coerced to a number when absent/null.
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

// Reads a photographed Nutrition Facts label. `nutrients` is [{ name, unit }], the
// only names the model may use. Returns { name, serving, servingGrams, calories,
// nutrients: [{ name, amount, unit, percentDV }] }, per serving as printed.
async function aiReadNutritionLabel(base64Image, mimeType, nutrients) {
  const names = nutrients.map((n) => `- ${n.name}`).join('\n');
  const { content, provider } = await aiChat('vision', {
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        {
          type: 'text',
          text: `This is a food product's Nutrition Facts label (it may be bilingual English/French, e.g. Canadian).
Read only what is printed; never guess a nutrient that isn't on the label.

For every nutrient line, give its printed amount and unit for one serving, and its printed % Daily Value.
Use null for whichever of the two isn't printed. Name each nutrient with exactly one of these names:
${names}
Skip any printed line that matches none of them.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"name": "<product name if visible, else null>", "serving": "<serving size as printed, e.g. 1 cup (250 mL) or 2 biscuits (30 g)>", "servingGrams": <grams in one serving if printed, else null>, "calories": <number or null>, "nutrients": [{"name": "<one of the names above>", "amount": <number or null>, "unit": "<g, mg or µg, or null>", "percentDV": <number or null>}]}`,
        },
      ],
    }],
  });

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  let parsed = null;
  try { parsed = start === -1 ? null : JSON.parse(content.slice(start, end + 1)); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.nutrients)) {
    const snippet = content.length > 300 ? `${content.slice(0, 300)}…` : content;
    throw new Error(`${provider.name} returned an unexpected response: ${snippet}`);
  }
  return parsed;
}

// Sends a food photo to the vision model and returns a plain ingredient
// list in the same format the Consumption textarea expects (one item per line,
// e.g. "250g chicken breast" or "2 eggs"), ready to be appended directly.
async function aiAnalyzeFoodImage(base64Image, mimeType) {
  const { content } = await aiChat('vision', {
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        {
          type: 'text',
          text: `You are a nutrition assistant. Identify every food item visible in this image and estimate realistic portion sizes.

Return ONLY a plain list, one item per line:
- Weighed items: "<grams>g <food name>"  →  e.g. "250g chicken breast"
- Countable items: "<count> <food name>"  →  e.g. "2 eggs"

No headings, no explanations, no bullet points — just the list.`,
        },
      ],
    }],
  });

  return content.trim();
}
