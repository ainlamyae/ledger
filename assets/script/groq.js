const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
// A stronger model needs far fewer hand-written rules to get food/portion
// estimates right (see the trimmed prompt below). Its own run-to-run variance
// no longer matters for determinism — the exact-text result cache in
// wellness.js guarantees a consistent repeat answer regardless of the model.
const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_SEED = 42;

const GROQ_EXTRACT_SYSTEM_PROMPT = `You are a nutrition estimator for a personal health log. The user gives you a freeform
description of food ingredients and amounts (e.g. "2 eggs, 1 slice toast, 1 tbsp butter").

Split it into individual food items. For each item, provide:
- "query": a plain, generic food name suitable for searching a nutrition database (not a brand name)
- "grams": your best real-world estimate of the total gram weight for the stated amount
- "kcalPer100gFallback": your best estimate of calories per 100g for this food

Do not calculate the total calories yourself — that happens outside this response.
Also rewrite the whole description as a short, standardized summary (e.g. "2 eggs, 1 toast, 1 tbsp butter").

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"items": [{"query": "<generic food name>", "grams": <number>, "kcalPer100gFallback": <number>}, ...],
 "notes": "<short standardized ingredient summary>"}`;

async function groqExtractIngredients(notesText) {
  const apiKey = getSettingString('GROQ_API_KEY', null);
  if (!apiKey) throw new Error('Add a GROQ_API_KEY setting first (Settings panel).');

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      seed: GROQ_SEED,
      messages: [
        { role: 'system', content: GROQ_EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: notesText },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices[0].message.content;
  console.debug('[groq] raw response content:', content);

  const fail = (reason) => {
    const snippet = content.length > 300 ? `${content.slice(0, 300)}…` : content;
    throw new Error(`Groq returned an unexpected response (${reason}): ${snippet}`);
  };

  // Not using response_format: json_object — Groq's server-side JSON-mode
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
    .replace(/("(?:grams|kcalPer100gFallback)"\s*:\s*)([^,}]+)/g, (match, prefix, rawValue) => {
      const trimmed = rawValue.trim();
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
  if (!parsed.notes) fail('missing "notes"');

  // Coerce rather than strictly type-check — models sometimes emit numeric
  // fields as strings (e.g. "50" or "50g").
  const items = parsed.items.map((item) => ({
    query: item.query,
    grams: parseFloat(item.grams),
    kcalPer100gFallback: parseFloat(item.kcalPer100gFallback),
  }));
  if (items.some((item) => !item.query || Number.isNaN(item.grams) || Number.isNaN(item.kcalPer100gFallback))) {
    fail('an item is missing query/grams/kcalPer100gFallback');
  }

  return { items, notes: parsed.notes };
}
