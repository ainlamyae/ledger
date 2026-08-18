const CACHE_PREFIX = 'ledger_cache_';
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key, ttlMs = CACHE_TTL_MS) {
  const raw = localStorage.getItem(CACHE_PREFIX + key);
  if (!raw) return null;

  try {
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > ttlMs) return null;
    return data;
  } catch {
    return null;
  }
}

// A write failure here (most commonly QuotaExceededError — a Nutrition row's
// banked Micronutrients JSON can be large, and enough of them blow past
// localStorage's ~5-10MB origin quota) must never break the caller: every
// call site already has the real data in memory from the fetch that just
// succeeded, and was only ever going to use this as a warm-start for next
// time. Losing that warm start is fine; surfacing "Failed to load data" for
// a load that actually succeeded is not.
function setCached(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (err) {
    console.warn(`setCached(${key}) skipped — ${err.message}`);
  }
}

function clearCache() {
  Object.keys(localStorage)
    .filter((key) => key.startsWith(CACHE_PREFIX))
    .forEach((key) => localStorage.removeItem(key));
}

// Lets a numeric field (account balance, transaction amount) accept a simple
// arithmetic expression — optionally prefixed with "=" — so quick math (e.g.
// "=5000-1234.56" for credit card spend, or "=-9.97-1.30" to add tax) doesn't
// need a separate calculator. Returns null if the input isn't a valid
// number/expression.
function evaluateNumberExpression(input) {
  const expr = input.trim().replace(/^=/, '');
  if (!expr) return 0;
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

  try {
    const result = Function(`"use strict"; return (${expr});`)();
    // Round to the nearest cent so float arithmetic (e.g. 0.1 + 0.2) doesn't
    // write sub-cent precision to the sheet.
    return typeof result === 'number' && Number.isFinite(result) ? Math.round(result * 100) / 100 : null;
  } catch {
    return null;
  }
}

async function hardRefresh() {
  clearCache();

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
  }

  location.reload();
}
