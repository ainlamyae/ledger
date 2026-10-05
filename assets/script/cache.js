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

// The account menu's Clear cache. The app keeps no cache of its own, but the browser
// still holds its copies of the app's files, and an old service worker or Cache
// Storage entry can outlive an update — which is what ran new markup against old
// scripts after a pull. This clears all of it: Cache Storage, any service worker,
// leftover ledger_cache_* keys, and the HTTP cache's copy of every script and
// stylesheet on the page (re-fetched with cache: 'reload', which replaces the stored
// copy), then reloads. Sign-in and preferences in localStorage are kept.
async function clearCacheAndReload() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
    Object.keys(localStorage)
      .filter((key) => key.startsWith('ledger_cache_'))
      .forEach((key) => localStorage.removeItem(key));

    const ownFiles = [
      location.href,
      new URL('index.html', document.baseURI).href,
      ...[...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
        .map((el) => el.src || el.href),
    ].filter((url) => new URL(url).origin === location.origin);
    await Promise.all([...new Set(ownFiles)].map((url) => fetch(url, { cache: 'reload' }).catch(() => {})));
  } catch (err) {
    console.warn('Clear cache: some steps failed, reloading anyway —', err);
  }
  location.reload();
}
