// Earlier versions cached sheet data under these keys; the sheet is now read every load.
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

// A numeric field's value, allowing arithmetic with an optional "=" (e.g.
// "=5000-1234.56"); null if it isn't a number or expression.
function evaluateNumberExpression(input) {
  const expr = input.trim().replace(/^=/, '');
  if (!expr) return 0;
  const result = evaluateArithmetic(expr);
  // Rounded to the cent, so float noise never reaches the sheet.
  return result === null ? null : Math.round(result * 100) / 100;
}

// Parses + - * / ( ) and decimals without eval, which the CSP blocks. Null if invalid.
function evaluateArithmetic(input) {
  const tokens = String(input).match(/\d+\.?\d*|\.\d+|[+\-*/()]|\S/g) || [];
  let pos = 0;
  const factor = () => {
    const token = tokens[pos++];
    if (token === '-') return -factor();
    if (token === '+') return factor();
    if (token === '(') {
      const value = sum();
      if (tokens[pos++] !== ')') throw new Error('paren');
      return value;
    }
    if (token === undefined || !/^[\d.]+$/.test(token)) throw new Error('token');
    return Number(token);
  };
  const product = () => {
    let value = factor();
    while (tokens[pos] === '*' || tokens[pos] === '/') value = tokens[pos++] === '*' ? value * factor() : value / factor();
    return value;
  };
  const sum = () => {
    let value = product();
    while (tokens[pos] === '+' || tokens[pos] === '-') value = tokens[pos++] === '+' ? value + product() : value - product();
    return value;
  };
  try {
    const value = sum();
    return pos === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

// The account menu's Clear cache: drops Cache Storage, service workers, legacy keys
// and the HTTP cache's copy of every own script/stylesheet, then reloads, so old
// scripts can't outlive an update. Sign-in and preferences are kept.
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
