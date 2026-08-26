// The app keeps no copy of sheet data any more: every load reads the sheet. This
// clears what earlier versions stored under ledger_cache_*, so a stale copy can't
// linger in browser storage.
try {
  Object.keys(localStorage)
    .filter((key) => key.startsWith('ledger_cache_'))
    .forEach((key) => localStorage.removeItem(key));
} catch {
  // Storage blocked: nothing could have been stored there either.
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
