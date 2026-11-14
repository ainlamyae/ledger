// Market indicators and signals. Pure functions; bars are { d, o, h, l, c, v } ascending, c adjusted.
const MM_TRADING_DAYS = 252;
const MM_RATIO_MIN_CLOSES = 64; // a quarter of returns for Sharpe/Sortino
const MM_MOMENTUM_MIN_BARS = MM_TRADING_DAYS + 1;
const MM_MONTH_BARS = 21;

function mmResult(value, needs, have) {
  return { value, needs, have };
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
  return { macd, signal, hist };
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

// 4 ATRs suits holds of weeks to months; 2.5 stopped out QQQ 15 times in a year.
const MARKET_ATR_MULT_DEFAULT = 4;

// Trailing stop: highest close of the last `lookback` days − k × ATR14 (chandelier exit).
function trailingStopSeries(bars, k = MARKET_ATR_MULT_DEFAULT, lookback = 22) {
  const atrs = atrSeries(bars, 14);
  return bars.map((_, i) => {
    if (atrs[i] === null || i < lookback - 1) return null;
    let high = -Infinity;
    for (let j = i - lookback + 1; j <= i; j++) high = Math.max(high, bars[j].c);
    return high - k * atrs[i];
  });
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
  return { mid, upper, lower };
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

// Annualized excess daily return per unit of deviation(returns, dailyRf).
function mmAnnualizedRatio(closes, rfAnnualPct, deviation) {
  if (closes.length < MM_RATIO_MIN_CLOSES) return mmResult(null, MM_RATIO_MIN_CLOSES, closes.length);
  const r = simpleReturns(closes);
  const rf = rfAnnualPct / 100 / MM_TRADING_DAYS;
  const d = deviation(r, rf);
  const v = d ? ((mmMean(r) - rf) / d) * Math.sqrt(MM_TRADING_DAYS) : null;
  return mmResult(v, MM_RATIO_MIN_CLOSES, closes.length);
}

function sharpeRatio(closes, rfAnnualPct = 0) {
  return mmAnnualizedRatio(closes, rfAnnualPct, (r) => mmSampleSd(r));
}

// Downside deviation averages over all N returns, not just the negative ones.
function sortinoRatio(closes, rfAnnualPct = 0) {
  return mmAnnualizedRatio(closes, rfAnnualPct, (r, rf) => Math.sqrt(mmMean(r.map((x) => Math.min(0, x - rf) ** 2))));
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
  if (bars.length < MM_MOMENTUM_MIN_BARS) return mmResult(null, MM_MOMENTUM_MIN_BARS, bars.length);
  const t = bars.length - 1;
  return mmResult(bars[t - MM_MONTH_BARS].c / bars[t - MM_TRADING_DAYS].c - 1, MM_MOMENTUM_MIN_BARS, bars.length);
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
  if (bars.length < MM_TRADING_DAYS) return mmResult(null, MM_TRADING_DAYS, bars.length);
  let hi = -Infinity;
  for (let i = bars.length - MM_TRADING_DAYS; i < bars.length; i++) hi = Math.max(hi, bars[i].h);
  return mmResult(bars[bars.length - 1].c / hi, MM_TRADING_DAYS, bars.length);
}

// SMA200 when there's enough daily history, else Faber's 10-month SMA (from monthlyBars if given).
function trendFilter(bars, monthlyBars = null) {
  const have = bars.length;
  if (have >= 200) {
    const close = bars[have - 1].c;
    const sma = mmMean(bars.slice(-200).map((b) => b.c));
    return { value: close > sma, close, sma, needs: 200, have, basis: 'SMA200' };
  }
  const me = monthEndCloses(monthlyBars && monthlyBars.length ? monthlyBars : bars);
  if (me.length >= 10) {
    const close = me[me.length - 1].c;
    const sma = mmMean(me.slice(-10).map((x) => x.c));
    return { value: close > sma, close, sma, needs: 10, have: me.length, basis: '10-month SMA' };
  }
  return { value: null, close: have ? bars[have - 1].c : null, sma: null, needs: 200, have, basis: 'SMA200' };
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

function computeSignals({ bars, benchmarkBars, monthlyBars, riskFreePct = 0, atrMult = MARKET_ATR_MULT_DEFAULT, riskPct = 1, equity }) {
  const closes = bars.map((b) => b.c);
  const trend = trendFilter(bars, monthlyBars);
  const momentum = mmMomentum(bars, monthlyBars);
  const bench = benchmarkBars && benchmarkBars.length ? mmMomentum(benchmarkBars, null) : null;
  // Short of history: the stock's shortfall first, then the benchmark's.
  let relative;
  if (momentum.value === null) relative = { value: null, needs: momentum.needs, have: momentum.have };
  else if (!bench) relative = { value: null, needs: MM_MOMENTUM_MIN_BARS, have: 0 };
  else if (bench.value === null) relative = { value: null, needs: bench.needs, have: bench.have };
  else relative = { value: momentum.value - bench.value, needs: momentum.needs, have: momentum.have };
  const high52 = fiftyTwoWeekRatio(bars);
  const vol63 = annualVolatility(closes, 63);
  const vol252 = annualVolatility(closes, MM_TRADING_DAYS);
  const atr = atrSeries(bars, 14).at(-1) ?? null;
  const close = closes.length ? closes.at(-1) : null;
  const stop = trailingStopSeries(bars, atrMult).at(-1) ?? null;
  // Trailing stop: for a holder. Entry stop: where a buy made today would exit; sizes it.
  const risk = close !== null && atr !== null ? atrMult * atr : null;
  const entryStop = risk !== null ? close - risk : null;
  const shares = equity && risk ? Math.floor((equity * riskPct) / 100 / risk) : null;
  const checks = {
    trend: trend.value,
    momentum: momentum.value === null ? null : momentum.value > 0,
    relative: relative.value === null ? null : relative.value > 0,
    high52: high52.value === null ? null : high52.value >= 0.9,
  };
  const spike = fiveDaySpike(closes);
  return {
    trend,
    momentum,
    relative,
    high52,
    vol63,
    vol252,
    atr,
    mdd1y: maxDrawdown(closes.slice(-MM_TRADING_DAYS)),
    sharpe: sharpeRatio(closes.slice(-MM_MOMENTUM_MIN_BARS), riskFreePct),
    sortino: sortinoRatio(closes.slice(-MM_MOMENTUM_MIN_BARS), riskFreePct),
    beta: betaVs(bars, benchmarkBars || []),
    spike,
    close,
    stop,
    entryStop,
    shares,
    riskAmount: shares !== null ? shares * risk : null,
    checks,
    verdict: verdictFromChecks(checks, { vol63: vol63.value, vol252: vol252.value, spike }),
  };
}

// Watchlist alerts on the latest daily close. rules: { below, above, belowAvg, aboveAvg, belowStop }.
// Each result: { rule, label, met (null = can't tell yet), close, level, date, basis }.
function checkAlerts(rules, bars, monthlyBars = null, atrMult = MARKET_ATR_MULT_DEFAULT) {
  if (!rules || !bars || !bars.length) return [];
  const last = bars[bars.length - 1];
  const close = last.c;
  const date = String(last.d).slice(0, 10);
  const fmt = (v) => v.toFixed(2);
  const out = [];
  const add = (rule, label, level, met, basis = null) => out.push({ rule, label, met, close, level, date, basis });
  if (Number.isFinite(rules.below)) add('below', `<${fmt(rules.below)}`, rules.below, close < rules.below);
  if (Number.isFinite(rules.above)) add('above', `>${fmt(rules.above)}`, rules.above, close > rules.above);
  if (rules.belowAvg || rules.aboveAvg) {
    const trend = trendFilter(bars, monthlyBars);
    const sma = trend.sma;
    if (rules.belowAvg) add('belowAvg', '<avg', sma, sma === null ? null : close < sma, trend.basis);
    if (rules.aboveAvg) add('aboveAvg', '>avg', sma, sma === null ? null : close > sma, trend.basis);
  }
  if (rules.belowStop) {
    const stop = trailingStopSeries(bars, atrMult).at(-1);
    add('belowStop', '<stop', stop, stop === null ? null : close < stop);
  }
  return out;
}

// The AI's last "Alerts: below=…; above=…; belowAvg=yes; …" line, or null.
function parseAlertLine(text) {
  const line = String(text || '').split('\n').reverse().find((l) => /^\s*alerts\s*:/i.test(l));
  if (!line) return null;
  const pairs = Object.fromEntries(line.replace(/^\s*alerts\s*:/i, '').split(';')
    .map((p) => p.split('=').map((x) => x.trim().toLowerCase()))
    .filter((p) => p.length === 2 && p[0]));
  const price = (v) => {
    const n = Number(String(v || '').replace(/[^0-9.]/g, ''));
    return v && v !== 'none' && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  const yes = (v) => v === 'yes' || v === 'true';
  const out = {
    below: price(pairs.below),
    above: price(pairs.above),
    belowAvg: yes(pairs.belowavg),
    aboveAvg: yes(pairs.aboveavg),
    belowStop: yes(pairs.belowstop),
  };
  return out.below !== null || out.above !== null || out.belowAvg || out.aboveAvg || out.belowStop ? out : null;
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
  return { label, passed, available, notes };
}
