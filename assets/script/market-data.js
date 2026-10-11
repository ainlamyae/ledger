// Stock prices and news, straight from the browser: Twelve Data (US), Alpha Vantage
// (TSX/TSXV, free plan) and Finnhub (headlines). Bars are kept in IndexedDB, so a
// symbol's history is fetched once and then only topped up.

const MARKET_PROVIDERS = {
  td: { name: 'Twelve Data', keySetting: 'TWELVE_DATA_API_KEY', perMinute: 8, perDay: 800 },
  av: { name: 'Alpha Vantage', keySetting: 'ALPHA_VANTAGE_API_KEY', perMinute: 5, perDay: 25, minGapMs: 1500 },
  fh: { name: 'Finnhub', keySetting: 'FINNHUB_API_KEY', perMinute: 50, perDay: Infinity },
};
const MARKET_DB_NAME = 'ledger-market';
const MARKET_QUOTA_KEY = 'ledger_market_quota';
const MARKET_RECHECK_MS = 30 * 60 * 1000;
const MARKET_INTRADAY_TTL_MS = { '5min': 5 * 60 * 1000, '30min': 15 * 60 * 1000 };

class MarketDataError extends Error {
  // kind: missing-key | rate-minute | rate-day | unsupported | not-found | network
  constructor(kind, provider, message) {
    super(message);
    this.kind = kind;
    this.provider = provider;
  }
}

// --- Symbols ----------------------------------------------------------------

// Accepts Google-style "TSE: AC" / "TSXV:XYZ" / "NASDAQ:AAPL" too.
function normalizeSymbol(input) {
  const text = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  const match = text.match(/^([A-Z]+):(.+)$/);
  if (!match) return text;
  const [, exchange, ticker] = match;
  if (['TSE', 'TSX'].includes(exchange)) return `${ticker}.TO`;
  if (['TSXV', 'CVE'].includes(exchange)) return `${ticker}.V`;
  return ticker;
}

function isCanadianSymbol(symbol) {
  return /\.(TO|V)$/i.test(symbol);
}

function marketProviderFor(symbol) {
  return isCanadianSymbol(symbol) ? 'av' : 'td';
}

// SHOP.TO -> SHOP.TRT, XYZ.V -> XYZ.TRV (Alpha Vantage's suffixes).
function alphaVantageSymbol(symbol) {
  return symbol.replace(/\.TO$/i, '.TRT').replace(/\.V$/i, '.TRV');
}

function symbolCurrency(symbol, fallback = 'USD') {
  return isCanadianSymbol(symbol) ? 'CAD' : fallback;
}

// --- IndexedDB cache --------------------------------------------------------

let marketDbPromise = null;

function marketDb() {
  if (!marketDbPromise) {
    marketDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(MARKET_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('series', { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    marketDbPromise.catch(() => { marketDbPromise = null; });
  }
  return marketDbPromise;
}

async function readSeries(key) {
  try {
    const db = await marketDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction('series').objectStore('series').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeSeries(record) {
  try {
    const db = await marketDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('series', 'readwrite');
      tx.objectStore('series').put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[market] cache write failed', err);
  }
}

// Clear cache and sign-out: which tickers you follow stays off a shared browser.
async function clearMarketCache() {
  try {
    if (marketDbPromise) (await marketDbPromise).close();
  } catch { /* already closed */ }
  marketDbPromise = null;
  try { localStorage.removeItem(MARKET_QUOTA_KEY); } catch { /* storage blocked */ }
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(MARKET_DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

// --- Rate limits ------------------------------------------------------------

const marketMinuteStamps = { td: [], av: [], fh: [] };
const marketInFlight = new Map();

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function readQuota() {
  try {
    const q = JSON.parse(localStorage.getItem(MARKET_QUOTA_KEY) || '{}');
    return q.day === utcDay() ? q : { day: utcDay(), counts: {}, exhausted: {} };
  } catch {
    return { day: utcDay(), counts: {}, exhausted: {} };
  }
}

function writeQuota(q) {
  try { localStorage.setItem(MARKET_QUOTA_KEY, JSON.stringify(q)); } catch { /* storage blocked */ }
}

function markDayExhausted(provider) {
  const q = readQuota();
  q.exhausted[provider] = true;
  writeQuota(q);
}

// Waits for a free slot in the provider's minute window, counting the call.
async function takeMarketSlot(provider, onWait) {
  const limits = MARKET_PROVIDERS[provider];
  const q = readQuota();
  if (q.exhausted[provider] || (q.counts[provider] || 0) >= limits.perDay) {
    throw new MarketDataError('rate-day', provider, `${limits.name}'s ${limits.perDay} calls for today are used up; resets 00:00 UTC.`);
  }
  for (;;) {
    const now = Date.now();
    const stamps = marketMinuteStamps[provider].filter((t) => now - t < 60000);
    marketMinuteStamps[provider] = stamps;
    const gapMs = limits.minGapMs && stamps.length ? limits.minGapMs - (now - stamps.at(-1)) : 0;
    if (stamps.length < limits.perMinute && gapMs <= 0) break;
    if (stamps.length < limits.perMinute) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      continue;
    }
    const waitMs = 60000 - (now - stamps[0]) + 250;
    onWait?.(Math.ceil(waitMs / 1000), limits.name);
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 1000)));
  }
  marketMinuteStamps[provider].push(Date.now());
  q.counts[provider] = (q.counts[provider] || 0) + 1;
  writeQuota(q);
}

// One GET per URL at a time; a second caller shares the first's answer.
async function marketFetch(provider, url, onWait) {
  if (marketInFlight.has(url)) return marketInFlight.get(url);
  const run = (async () => {
    await takeMarketSlot(provider, onWait);
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new MarketDataError('network', provider, `Couldn't reach ${MARKET_PROVIDERS[provider].name}.`);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok && !body) throw new MarketDataError('network', provider, `${MARKET_PROVIDERS[provider].name} error ${res.status}.`);
    return body;
  })();
  marketInFlight.set(url, run);
  try {
    return await run;
  } finally {
    marketInFlight.delete(url);
  }
}

function marketKey(provider) {
  const { keySetting, name } = MARKET_PROVIDERS[provider];
  const key = getSettingString(keySetting, null);
  if (!key) throw new MarketDataError('missing-key', provider, `Add a ${keySetting} setting to load ${name} data.`);
  return key;
}

// --- Provider calls ---------------------------------------------------------

// Twelve Data's error body: { status: 'error', code, message }.
function checkTwelveData(body, symbol) {
  if (body?.status !== 'error') return body;
  const msg = body.message || 'Twelve Data error';
  if (body.code === 429) {
    if (/day/i.test(msg)) {
      markDayExhausted('td');
      throw new MarketDataError('rate-day', 'td', "Twelve Data's daily limit is used up; resets 00:00 UTC.");
    }
    throw new MarketDataError('rate-minute', 'td', 'Twelve Data per-minute limit hit; try again in a minute.');
  }
  if (body.code === 400 || body.code === 404) throw new MarketDataError('not-found', 'td', `${symbol}: ${msg}`);
  if (body.code === 403) throw new MarketDataError('unsupported', 'td', `${symbol}: ${msg}`);
  throw new MarketDataError('network', 'td', msg);
}

function twelveDataBars(body) {
  return (body.values || []).map((v) => ({
    d: v.datetime,
    o: Number(v.open), h: Number(v.high), l: Number(v.low), c: Number(v.close), v: Number(v.volume) || 0,
  })).sort((a, b) => a.d.localeCompare(b.d));
}

async function fetchTwelveData(symbol, interval, { startDate = null, outputsize = 5000, onWait } = {}) {
  const params = new URLSearchParams({ symbol, interval, outputsize: String(outputsize), order: 'ASC', apikey: marketKey('td') });
  if (startDate) params.set('start_date', startDate);
  const body = checkTwelveData(await marketFetch('td', `https://api.twelvedata.com/time_series?${params}`, onWait), symbol);
  return { bars: twelveDataBars(body), currency: body.meta?.currency || null, exchange: body.meta?.exchange || null };
}

// Alpha Vantage answers 200 with Information/Note when limited or premium-only.
function checkAlphaVantage(body, symbol) {
  if (body?.['Error Message']) throw new MarketDataError('not-found', 'av', `${symbol}: not found on Alpha Vantage.`);
  const info = body?.Information || body?.Note;
  if (info) {
    if (/per second|more sparingly/i.test(info)) {
      throw new MarketDataError('rate-minute', 'av', 'Alpha Vantage allows 1 request per second; reload in a moment.');
    }
    if (/requests per day|daily rate limit/i.test(info)) {
      markDayExhausted('av');
      throw new MarketDataError('rate-day', 'av', "Alpha Vantage's 25 calls for today are used up; resets 00:00 UTC.");
    }
    throw new MarketDataError('unsupported', 'av', `Alpha Vantage: ${info}`);
  }
  return body;
}

function alphaVantageBars(series, closeField) {
  return Object.entries(series || {}).map(([d, v]) => ({
    d,
    o: Number(v['1. open']), h: Number(v['2. high']), l: Number(v['3. low']),
    c: Number(v[closeField]), v: Number(v['5. volume'] ?? v['6. volume']) || 0,
  })).sort((a, b) => a.d.localeCompare(b.d));
}

async function fetchAlphaVantage(symbol, fn, onWait) {
  const params = new URLSearchParams({ function: fn, symbol: alphaVantageSymbol(symbol), apikey: marketKey('av') });
  if (fn === 'TIME_SERIES_DAILY') params.set('outputsize', 'compact');
  return checkAlphaVantage(await marketFetch('av', `https://www.alphavantage.co/query?${params}`, onWait), symbol);
}

// --- Public API -------------------------------------------------------------

function mergeBars(older, newer) {
  const byDate = new Map(older.map((b) => [b.d, b]));
  newer.forEach((b) => byDate.set(b.d, b));
  return [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d));
}

function localIso(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// The newest session a daily series should hold by now: today after 16:30, else the
// last weekday before today (holidays just cost one recheck per 30 min).
function expectedLatestSession(now = new Date()) {
  const d = new Date(now);
  const afterClose = now.getHours() * 60 + now.getMinutes() >= 16 * 60 + 30;
  if (!(afterClose && d.getDay() >= 1 && d.getDay() <= 5)) {
    do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6);
  }
  return localIso(d);
}

// { bars, currency, provider, partial, stale, fetchedAt, error }.
async function getDailyBars(symbol, { onWait } = {}) {
  symbol = symbol.trim().toUpperCase();
  const provider = marketProviderFor(symbol);
  const key = `${provider}:${symbol}:1day`;
  const cached = await readSeries(key);
  const fresh = cached && (cached.lastBarDate >= expectedLatestSession() || Date.now() - cached.checkedAt < MARKET_RECHECK_MS);
  if (fresh) return { ...cached, provider, stale: false };

  try {
    let fetched;
    if (provider === 'td') {
      const start = cached?.lastBarDate || null;
      fetched = await fetchTwelveData(symbol, '1day', { startDate: start, outputsize: start ? 300 : 5000, onWait });
    } else {
      const body = await fetchAlphaVantage(symbol, 'TIME_SERIES_DAILY', onWait);
      fetched = { bars: alphaVantageBars(body['Time Series (Daily)'], '4. close'), currency: 'CAD' };
    }
    if (!fetched.bars.length && !cached) throw new MarketDataError('not-found', provider, `${symbol}: no prices returned.`);
    const bars = mergeBars(cached?.bars || [], fetched.bars);
    const record = {
      key,
      bars,
      currency: fetched.currency || cached?.currency || symbolCurrency(symbol),
      lastBarDate: bars.at(-1)?.d.slice(0, 10) || null,
      fetchedAt: Date.now(),
      checkedAt: Date.now(),
      partial: provider === 'av',
    };
    await writeSeries(record);
    return { ...record, provider, stale: false };
  } catch (err) {
    // Saved bars beat an error; the caller shows why they're old.
    if (cached && err instanceof MarketDataError) return { ...cached, provider, stale: true, error: err };
    throw err;
  }
}

// Month-end bars back to the listing (Alpha Vantage, free), for TSX's long ranges
// and its 10-month SMA / 12-1 momentum. Twelve Data symbols use their daily bars.
async function getMonthlyBars(symbol, { onWait } = {}) {
  symbol = symbol.trim().toUpperCase();
  if (marketProviderFor(symbol) !== 'av') return null;
  const key = `av:${symbol}:1month`;
  const cached = await readSeries(key);
  if (cached && Date.now() - cached.checkedAt < 24 * 60 * 60 * 1000) return cached.bars;
  try {
    const body = await fetchAlphaVantage(symbol, 'TIME_SERIES_MONTHLY_ADJUSTED', onWait);
    const bars = alphaVantageBars(body['Monthly Adjusted Time Series'], '5. adjusted close');
    await writeSeries({ key, bars, checkedAt: Date.now() });
    return bars;
  } catch (err) {
    if (cached) return cached.bars;
    throw err;
  }
}

// 1d / 1w views: Twelve Data only.
async function getIntradayBars(symbol, interval, { onWait } = {}) {
  symbol = symbol.trim().toUpperCase();
  if (marketProviderFor(symbol) !== 'td') {
    throw new MarketDataError('unsupported', 'av', 'Intraday prices aren\'t available for TSX on free plans.');
  }
  const key = `td:${symbol}:${interval}`;
  const cached = await readSeries(key);
  if (cached && Date.now() - cached.fetchedAt < MARKET_INTRADAY_TTL_MS[interval]) return cached;
  try {
    const fetched = await fetchTwelveData(symbol, interval, { outputsize: interval === '5min' ? 160 : 140, onWait });
    const record = { key, bars: fetched.bars, currency: fetched.currency, fetchedAt: Date.now(), checkedAt: Date.now() };
    await writeSeries(record);
    return record;
  } catch (err) {
    if (cached && err instanceof MarketDataError) return { ...cached, stale: true, error: err };
    throw err;
  }
}

// CAD per USD, daily.
async function getUsdCadSeries({ onWait } = {}) {
  const key = 'td:USD/CAD:1day';
  const cached = await readSeries(key);
  if (cached && (cached.lastBarDate >= expectedLatestSession() || Date.now() - cached.checkedAt < MARKET_RECHECK_MS)) return cached.bars;
  try {
    const start = cached?.lastBarDate || null;
    const fetched = await fetchTwelveData('USD/CAD', '1day', { startDate: start, outputsize: start ? 300 : 5000, onWait });
    const bars = mergeBars(cached?.bars || [], fetched.bars);
    await writeSeries({ key, bars, lastBarDate: bars.at(-1)?.d || null, fetchedAt: Date.now(), checkedAt: Date.now() });
    return bars;
  } catch (err) {
    if (cached) return cached.bars;
    throw err;
  }
}

// [{ symbol, name, exchange, currency, country }]; TSX hits come back as .TO.
async function searchSymbols(query, { onWait } = {}) {
  const params = new URLSearchParams({ symbol: query.trim(), outputsize: '12', apikey: marketKey('td') });
  const body = checkTwelveData(await marketFetch('td', `https://api.twelvedata.com/symbol_search?${params}`, onWait), query);
  return (body.data || [])
    .filter((r) => /^(Common Stock|ETF|REIT|American Depositary Receipt)/i.test(r.instrument_type || 'Common Stock'))
    .map((r) => {
      const tsx = /^(TSX|XTSE)$/i.test(r.exchange) || r.mic_code === 'XTSE';
      const tsxv = /^(TSXV|XTSX)$/i.test(r.exchange) || r.mic_code === 'XTSX';
      return {
        symbol: tsx ? `${r.symbol}.TO` : tsxv ? `${r.symbol}.V` : r.symbol,
        name: r.instrument_name,
        exchange: r.exchange,
        currency: r.currency,
        country: r.country,
      };
    });
}

const marketNewsCache = new Map();

// Finnhub headlines, newest first: [{ date, source, headline, url }].
async function getCompanyNews(symbol, days = 30, { onWait } = {}) {
  symbol = symbol.trim().toUpperCase();
  if (isCanadianSymbol(symbol)) throw new MarketDataError('unsupported', 'fh', "Finnhub's free plan has no news for TSX stocks.");
  const cacheKey = `${symbol}:${days}`;
  const hit = marketNewsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.items;
  const to = localIso();
  const from = localIso(new Date(Date.now() - days * 86400000));
  const params = new URLSearchParams({ symbol, from, to, token: marketKey('fh') });
  const body = await marketFetch('fh', `https://finnhub.io/api/v1/company-news?${params}`, onWait);
  if (!Array.isArray(body)) throw new MarketDataError('unsupported', 'fh', body?.error ? `Finnhub: ${body.error}` : `No Finnhub news for ${symbol}.`);
  const items = body
    .map((n) => ({ date: localIso(new Date(n.datetime * 1000)), source: n.source, headline: n.headline, url: n.url }))
    .sort((a, b) => b.date.localeCompare(a.date));
  marketNewsCache.set(cacheKey, { at: Date.now(), items });
  return items;
}
