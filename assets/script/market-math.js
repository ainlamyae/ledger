// Market indicators and signals. Pure functions; bars are { d, o, h, l, c, v } ascending, c adjusted.
const MM_TRADING_DAYS = 252;

function mmResult(value, needs, have) {
  return { value: value, needs: needs, have: have };
}

function mmMean(xs) {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : null;
}

function mmSampleSd(xs) {
  if (xs.length < 2) return null;
  const m = mmMean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
  return Math.sqrt(s / (xs.length - 1));
}

function smaSeries(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

// Named to avoid charts-base.js's emaSeries. Seeded with SMA(n).
function emaStdSeries(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const a = 2 / (n + 1);
  let e = mmMean(values.slice(0, n));
  out[n - 1] = e;
  for (let i = n; i < values.length; i++) {
    e = a * values[i] + (1 - a) * e;
    out[i] = e;
  }
  return out;
}

function rsiSeries(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gain += ch; else loss -= ch;
  }
  gain /= n; loss /= n;
  const rsi = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[n] = rsi();
  for (let i = n + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(ch, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-ch, 0)) / n;
    out[i] = rsi();
  }
  return out;
}

function macdSeries(closes, fast = 12, slow = 26, sig = 9) {
  const ef = emaStdSeries(closes, fast);
  const es = emaStdSeries(closes, slow);
  const macd = closes.map((_, i) => (ef[i] === null || es[i] === null ? null : ef[i] - es[i]));
  const start = macd.findIndex((x) => x !== null);
  const signal = new Array(closes.length).fill(null);
  if (start >= 0) {
    const s = emaStdSeries(macd.slice(start), sig);
    for (let i = 0; i < s.length; i++) signal[start + i] = s[i];
  }
  const hist = macd.map((m, i) => (m === null || signal[i] === null ? null : m - signal[i]));
  return { macd: macd, signal: signal, hist: hist };
}

function atrSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length < n) return out;
  const tr = bars.map((b, i) => {
    if (i === 0) return b.h - b.l;
    const pc = bars[i - 1].c;
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  });
  let atr = mmMean(tr.slice(0, n));
  out[n - 1] = atr;
  for (let i = n; i < bars.length; i++) {
    atr = (atr * (n - 1) + tr[i]) / n;
    out[i] = atr;
  }
  return out;
}

// Population sigma, as Bollinger defined it.
function bollingerSeries(closes, n = 20, k = 2) {
  const mid = smaSeries(closes, n);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (closes[j] - mid[i]) * (closes[j] - mid[i]);
    const sd = Math.sqrt(s / n);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid: mid, upper: upper, lower: lower };
}

function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
}

function simpleReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] / closes[i - 1] - 1);
  return out;
}

function annualVolatility(closes, window) {
  const needs = window + 1;
  if (closes.length < needs) return mmResult(null, needs, closes.length);
  const sd = mmSampleSd(logReturns(closes.slice(-needs)));
  return mmResult(sd === null ? null : sd * Math.sqrt(MM_TRADING_DAYS), needs, closes.length);
}

function maxDrawdown(closes) {
  if (closes.length < 2) return mmResult(null, 2, closes.length);
  let peak = closes[0], mdd = 0;
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > peak) peak = closes[i];
    mdd = Math.max(mdd, 1 - closes[i] / peak);
  }
  return mmResult(mdd, 2, closes.length);
}

function sharpeRatio(closes, rfAnnualPct = 0) {
  if (closes.length < 64) return mmResult(null, 64, closes.length);
  const r = simpleReturns(closes);
  const sd = mmSampleSd(r);
  const v = sd ? ((mmMean(r) - rfAnnualPct / 100 / MM_TRADING_DAYS) / sd) * Math.sqrt(MM_TRADING_DAYS) : null;
  return mmResult(v, 64, closes.length);
}

// Downside deviation averages over all N returns, not just the negative ones.
function sortinoRatio(closes, rfAnnualPct = 0) {
  if (closes.length < 64) return mmResult(null, 64, closes.length);
  const r = simpleReturns(closes);
  const rf = rfAnnualPct / 100 / MM_TRADING_DAYS;
  const dd = Math.sqrt(mmMean(r.map((x) => Math.min(0, x - rf) ** 2)));
  const v = dd ? ((mmMean(r) - rf) / dd) * Math.sqrt(MM_TRADING_DAYS) : null;
  return mmResult(v, 64, closes.length);
}

function betaVs(stockBars, marketBars, minAligned = 126) {
  const m = new Map();
  for (const b of marketBars || []) m.set(b.d, b.c);
  const s = [], k = [];
  for (const b of stockBars || []) {
    if (m.has(b.d)) { s.push(b.c); k.push(m.get(b.d)); }
  }
  if (s.length < minAligned) return mmResult(null, minAligned, s.length);
  const rs = simpleReturns(s), rm = simpleReturns(k);
  const ms = mmMean(rs), mm = mmMean(rm);
  let cov = 0, vr = 0;
  for (let i = 0; i < rs.length; i++) {
    cov += (rs[i] - ms) * (rm[i] - mm);
    vr += (rm[i] - mm) * (rm[i] - mm);
  }
  return mmResult(vr ? cov / vr : null, minAligned, s.length);
}

function momentum12_1(bars) {
  if (bars.length < 253) return mmResult(null, 253, bars.length);
  const t = bars.length - 1;
  return mmResult(bars[t - 21].c / bars[t - 252].c - 1, 253, bars.length);
}

// Accepts numbers or { d, c } month-end rows.
function momentum12_1Monthly(monthEndCloses) {
  const p = monthEndCloses.map((x) => (typeof x === 'number' ? x : x.c));
  if (p.length < 13) return mmResult(null, 13, p.length);
  const m = p.length - 1;
  return mmResult(p[m - 1] / p[m - 12] - 1, 13, p.length);
}

function monthEndCloses(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const next = bars[i + 1];
    if (!next || next.d.slice(0, 7) !== bars[i].d.slice(0, 7)) out.push({ d: bars[i].d, c: bars[i].c });
  }
  return out;
}

function fiftyTwoWeekRatio(bars) {
  if (bars.length < 252) return mmResult(null, 252, bars.length);
  let hi = -Infinity;
  for (let i = bars.length - 252; i < bars.length; i++) hi = Math.max(hi, bars[i].h);
  return mmResult(bars[bars.length - 1].c / hi, 252, bars.length);
}

// SMA200 when there's enough daily history, else Faber's 10-month SMA (from monthlyBars if given).
function trendFilter(bars, monthlyBars = null) {
  const have = bars.length;
  if (have >= 200) {
    const close = bars[have - 1].c;
    const sma = mmMean(bars.slice(-200).map((b) => b.c));
    return { value: close > sma, close: close, sma: sma, needs: 200, have: have, basis: 'SMA200' };
  }
  const me = monthEndCloses(monthlyBars && monthlyBars.length ? monthlyBars : bars);
  if (me.length >= 10) {
    const close = me[me.length - 1].c;
    const sma = mmMean(me.slice(-10).map((x) => x.c));
    return { value: close > sma, close: close, sma: sma, needs: 10, have: me.length, basis: '10-month SMA' };
  }
  return { value: null, close: have ? bars[have - 1].c : null, sma: null, needs: 200, have: have, basis: 'SMA200' };
}

// Sigma from the 63 log returns before the 5-day move, so the spike doesn't inflate its own yardstick.
function fiveDaySpike(closes) {
  if (closes.length < 69) return null;
  const t = closes.length - 1;
  const sd = mmSampleSd(logReturns(closes.slice(t - 68, t - 4)));
  if (!sd) return null;
  return Math.log(closes[t] / closes[t - 5]) > 2 * sd * Math.sqrt(5);
}

function mmMomentum(bars, monthlyBars) {
  const daily = momentum12_1(bars || []);
  if (daily.value !== null) return daily;
  const src = monthlyBars && monthlyBars.length ? monthlyBars : bars || [];
  const monthly = momentum12_1Monthly(monthEndCloses(src));
  return monthly.value !== null ? monthly : daily;
}

function computeSignals({ bars, benchmarkBars, monthlyBars, riskFreePct = 0, atrMult = 2.5, riskPct = 1, equity }) {
  const closes = bars.map((b) => b.c);
  const trend = trendFilter(bars, monthlyBars);
  const momentum = mmMomentum(bars, monthlyBars);
  const bench = benchmarkBars && benchmarkBars.length ? mmMomentum(benchmarkBars, null) : null;
  const relative = momentum.value === null || !bench || bench.value === null
    ? { value: null, needs: momentum.value === null ? momentum.needs : bench ? bench.needs : 253, have: momentum.value === null ? momentum.have : bench ? bench.have : 0 }
    : { value: momentum.value - bench.value, needs: momentum.needs, have: momentum.have };
  const high52 = fiftyTwoWeekRatio(bars);
  const vol63 = annualVolatility(closes, 63);
  const vol252 = annualVolatility(closes, 252);
  const atrs = atrSeries(bars, 14);
  const atr = atrs.length ? atrs[atrs.length - 1] : null;
  const close = closes.length ? closes[closes.length - 1] : null;
  const risk = atr !== null ? atrMult * atr : null;
  const shares = equity && risk ? Math.floor((equity * riskPct) / 100 / risk) : null;
  const checks = {
    trend: trend.value,
    momentum: momentum.value === null ? null : momentum.value > 0,
    relative: relative.value === null ? null : relative.value > 0,
    high52: high52.value === null ? null : high52.value >= 0.9,
  };
  const spike = fiveDaySpike(closes);
  return {
    trend: trend,
    momentum: momentum,
    relative: relative,
    high52: high52,
    vol63: vol63,
    vol252: vol252,
    atr: atr,
    mdd1y: maxDrawdown(closes.slice(-252)),
    sharpe: sharpeRatio(closes.slice(-253), riskFreePct),
    sortino: sortinoRatio(closes.slice(-253), riskFreePct),
    beta: betaVs(bars, benchmarkBars || []),
    spike: spike,
    close: close,
    stop: close !== null && risk !== null ? close - risk : null,
    shares: shares,
    riskAmount: shares !== null ? shares * risk : null,
    checks: checks,
    verdict: verdictFromChecks(checks, { vol63: vol63.value, vol252: vol252.value, spike: spike }),
  };
}

function verdictFromChecks(checks, { vol63, vol252, spike } = {}) {
  const all = [checks.trend, checks.momentum, checks.relative, checks.high52];
  const passed = all.filter((x) => x === true).length;
  const available = all.filter((x) => x !== null && x !== undefined).length;
  let label;
  if (checks.trend === null || checks.trend === undefined) label = 'Insufficient history';
  else if (checks.trend === false) label = 'Unfavourable';
  else label = [checks.momentum, checks.relative, checks.high52].filter((x) => x === true).length >= 2 ? 'Favourable' : 'Mixed';
  const notes = [];
  if (vol63 != null && vol252 != null && vol63 > 1.25 * vol252) notes.push('high-volatility regime, size down');
  if (spike === true) notes.push("don't chase last week's spike");
  return { label: label, passed: passed, available: available, notes: notes };
}
