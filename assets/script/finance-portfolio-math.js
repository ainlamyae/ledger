// Pure portfolio math: ACB holdings, realized/unrealized gains, value series. No DOM.

const PORTFOLIO_EPS = 1e-9;

function sortTrades(trades) {
  return trades.slice().sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.row || 0) - (b.row || 0));
}

// CAD per unit of trade currency; null when a USD rate is missing.
function tradeFx(t) {
  if (t.currency === 'CAD') return 1;
  const fx = Number(t.fx);
  return Number.isFinite(fx) && fx > 0 ? fx : null;
}

function newHolding(key, account, t) {
  return {
    key, account, symbol: t.symbol, currency: t.currency,
    shares: 0, acb: 0, acbCad: 0, realized: 0, realizedCad: 0, fees: 0,
    firstDate: t.date, lastDate: t.date, warnings: [],
  };
}

// Applies one trade to a holding in place.
function applyTrade(h, t, fxFallback) {
  let q = Number(t.quantity);
  if (!Number.isFinite(q) || q <= 0) {
    h.warnings.push(`Row ${t.row}: invalid quantity`);
    return;
  }
  let fx = tradeFx(t);
  if (fx == null) {
    fx = fxFallback;
    h.warnings.push(`Row ${t.row}: no FX rate`);
  }
  const p = Number(t.price) || 0;
  const fees = Number(t.fees) || 0;
  h.lastDate = t.date;
  if (t.action === 'Buy') {
    const cost = q * p + fees;
    h.shares += q;
    h.acb += cost;
    h.acbCad += cost * fx;
    h.fees += fees;
  } else if (t.action === 'Sell') {
    if (q > h.shares + PORTFOLIO_EPS) {
      h.warnings.push(`Row ${t.row}: sells ${q} but only ${h.shares} held`);
      q = h.shares;
    }
    if (h.shares <= 0) return;
    const avg = h.acb / h.shares;
    const avgCad = h.acbCad / h.shares;
    const proceeds = q * p - fees;
    h.realized += proceeds - avg * q;
    h.realizedCad += proceeds * fx - avgCad * q;
    h.acb -= avg * q;
    h.acbCad -= avgCad * q;
    h.shares -= q;
    h.fees += fees;
    if (h.shares < PORTFOLIO_EPS) h.shares = h.acb = h.acbCad = 0;
  } else if (t.action === 'Split') {
    h.shares *= q;
  }
}

function computeHoldings(trades, { pooled = false, registeredAccounts = new Set(), fxFallback = 1 } = {}) {
  const out = new Map();
  for (const t of sortTrades(trades)) {
    if (pooled && registeredAccounts.has(t.account)) continue;
    const key = pooled ? t.symbol : `${t.account}|${t.symbol}`;
    let h = out.get(key);
    if (!h) { h = newHolding(key, pooled ? null : t.account, t); out.set(key, h); }
    applyTrade(h, t, fxFallback);
  }
  return out;
}

function holdingValue(h, lastClose, fxToday) {
  const avgCost = h.shares > 0 ? h.acb / h.shares : null;
  if (!Number.isFinite(lastClose)) {
    return { marketValue: null, marketValueCad: null, unrealized: null, unrealizedCad: null, avgCost };
  }
  const fx = Number.isFinite(fxToday) ? fxToday : 1;
  const marketValue = h.shares * lastClose;
  const marketValueCad = marketValue * fx;
  return {
    marketValue, marketValueCad,
    unrealized: marketValue - h.acb,
    unrealizedCad: marketValueCad - h.acbCad,
    avgCost,
  };
}

// Close of the last bar on or before date (bars ascending), else null.
function priceOn(bars, date) {
  if (!bars || !bars.length) return null;
  let lo = 0, hi = bars.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (String(bars[mid].d).slice(0, 10) <= date) { hit = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return hit < 0 ? null : bars[hit].c;
}

// FX on or before date; 1 when there is no series (CAD).
function fxOn(series, date) {
  if (series == null) return 1;
  return priceOn(series, date);
}

function buildPortfolioSeries(trades, barsBySymbol, fxSeries, { from = null } = {}) {
  const sorted = sortTrades(trades);
  const res = { dates: [], marketValueCad: [], costBasisCad: [], unrealizedCad: [], realizedCumCad: [], totalGainCad: [], estimated: [] };
  if (!sorted.length) return res;
  const getBars = (s) => (barsBySymbol instanceof Map ? barsBySymbol.get(s) : barsBySymbol && barsBySymbol[s]) || null;

  let start = sorted[0].date;
  if (from && from > start) start = from;
  const dateSet = new Set();
  for (const s of new Set(sorted.map((t) => t.symbol))) {
    for (const b of getBars(s) || []) dateSet.add(String(b.d).slice(0, 10));
  }
  // No bars at all: fall back to trade dates.
  if (!dateSet.size) for (const t of sorted) dateSet.add(t.date);
  res.dates = [...dateSet].filter((d) => d >= start).sort();

  const holdings = new Map();
  const lastTrade = new Map(); // symbol -> { price, fx }
  let ti = 0;
  for (const d of res.dates) {
    while (ti < sorted.length && sorted[ti].date <= d) {
      const t = sorted[ti++];
      const key = `${t.account}|${t.symbol}`;
      let h = holdings.get(key);
      if (!h) { h = newHolding(key, t.account, t); holdings.set(key, h); }
      const prev = lastTrade.get(t.symbol) || {};
      applyTrade(h, t, prev.fx || 1);
      const p = Number(t.price);
      const fx = tradeFx(t);
      lastTrade.set(t.symbol, {
        price: t.action !== 'Split' && Number.isFinite(p) && p > 0 ? p : prev.price,
        fx: fx != null ? fx : prev.fx,
      });
    }
    let mv = 0, cost = 0, realized = 0, est = false;
    for (const h of holdings.values()) {
      cost += h.acbCad;
      realized += h.realizedCad;
      if (h.shares <= 0) continue;
      const last = lastTrade.get(h.symbol) || {};
      let price = priceOn(getBars(h.symbol), d);
      if (price == null) { price = last.price || 0; est = true; }
      let fx = 1;
      if (h.currency === 'USD') {
        fx = fxOn(fxSeries || [], d);
        if (fx == null) fx = last.fx || 1;
      }
      mv += h.shares * price * fx;
    }
    res.marketValueCad.push(mv);
    res.costBasisCad.push(cost);
    res.unrealizedCad.push(mv - cost);
    res.realizedCumCad.push(realized);
    res.totalGainCad.push(mv - cost + realized);
    res.estimated.push(est);
  }
  return res;
}
