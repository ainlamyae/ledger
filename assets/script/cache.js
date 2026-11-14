// Earlier versions kept copies of sheet data under these keys; the app now reads
// the sheet on every load.
const LEGACY_CACHE_PREFIX = 'ledger_cache_';

function clearLegacyCacheKeys() {
  Object.keys(localStorage)
    .filter((key) => key.startsWith(LEGACY_CACHE_PREFIX))
    .forEach((key) => localStorage.removeItem(key));
}

// So a stale copy can't linger in browser storage.
try {
  clearLegacyCacheKeys();
} catch {
  // Storage blocked: nothing could have been stored there either.
}

// Lets a numeric field accept simple arithmetic, optionally prefixed with "="
// (e.g. "=5000-1234.56"), so quick math needs no calculator. Returns null if the
// input isn't a valid number/expression.
function evaluateNumberExpression(input) {
  const expr = input.trim().replace(/^=/, '');
  if (!expr) return 0;
  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

  try {
    const result = Function(`"use strict"; return (${expr});`)();
    // Rounded to the cent, so float noise (0.1 + 0.2) never reaches the sheet.
    return typeof result === 'number' && Number.isFinite(result) ? Math.round(result * 100) / 100 : null;
  } catch {
    return null;
  }
}

// The account menu's Clear cache. An old service worker or Cache Storage entry can
// outlive an update and run new markup against old scripts, so this clears Cache
// Storage, service workers, leftover ledger_cache_* keys and the HTTP cache's copy
// of every own script and stylesheet (re-fetched with cache: 'reload'), then
// reloads. Sign-in and preferences in localStorage are kept.
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
    clearLegacyCacheKeys();
    await clearMarketCache();

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
