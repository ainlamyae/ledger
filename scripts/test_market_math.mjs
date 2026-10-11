// Run: node scripts/test_market_math.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../assets/script/market-math.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ Math, console });
vm.runInContext(src, ctx);
const M = ctx;

let n = 0;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const test = (name, fn) => { fn(); n++; };

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const day = (i) => new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const toBars = (closes) => closes.map((c, i) => ({ d: day(i), o: c, h: c, l: c, c, v: 0 }));

test('SMA', () => {
  const s = M.smaSeries(range(1, 10), 5);
  close(s[9], 8);
  for (let i = 0; i < 4; i++) assert.equal(s[i], null);
  close(s[4], 3);
});

test('EMA', () => {
  const e = M.emaStdSeries(range(1, 10), 3);
  close(e[9], 9);
  assert.equal(e[1], null);
  close(e[2], 2);
});

test('RSI rising = 100', () => {
  const r = M.rsiSeries(range(1, 30));
  assert.equal(r[13], null);
  close(r[14], 100);
  close(r[29], 100);
});

test('constant series: ATR 0, flat Bollinger', () => {
  const c = new Array(40).fill(50);
  close(M.atrSeries(toBars(c))[39], 0);
  const b = M.bollingerSeries(c);
  close(b.upper[39], 50); close(b.lower[39], 50); close(b.mid[39], 50);
});

test('Bollinger 1..20 population sigma', () => {
  const b = M.bollingerSeries(range(1, 20), 20, 2);
  const sd = Math.sqrt(399 / 12);
  close(sd, 5.766281, 1e-6);
  close(b.mid[19], 10.5);
  close(b.upper[19], 10.5 + 2 * sd);
  close(b.lower[19], 10.5 - 2 * sd);
});

test('MACD shape', () => {
  const m = M.macdSeries(range(1, 60));
  assert.equal(m.macd[24], null);
  assert.notEqual(m.macd[25], null);
  assert.equal(m.signal[32], null);
  close(m.hist[33], m.macd[33] - m.signal[33]);
});

test('max drawdown', () => {
  close(M.maxDrawdown([100, 120, 90, 130, 65]).value, 0.5);
});

test('beta', () => {
  const N = 140;
  const mk = [100], s2 = [50], s1 = [80];
  for (let i = 1; i < N; i++) {
    const r = i % 2 ? 0.01 : -0.005;
    mk.push(mk[i - 1] * (1 + r));
    s2.push(s2[i - 1] * (1 + 2 * r));
    s1.push(s1[i - 1] * (1 + r + 0.002));
  }
  const mb = toBars(mk);
  close(M.betaVs(toBars(s2), mb).value, 2);
  close(M.betaVs(toBars(s1), mb).value, 1);
  // Unaligned dates are dropped
  const partial = toBars(s2).filter((_, i) => i % 7 !== 3);
  assert.ok(M.betaVs(partial, mb).have < N);
});

test('momentum and 52-week ratio on 1.001^t', () => {
  const bars = toBars(range(0, 299).map((t) => 1.001 ** t));
  close(M.momentum12_1(bars).value, 1.001 ** 231 - 1, 1e-9);
  close(M.fiftyTwoWeekRatio(bars).value, 1);
  assert.equal(M.trendFilter(bars).value, true);
  assert.equal(M.trendFilter(bars).basis, 'SMA200');
});

test('monthly momentum and month-ends', () => {
  const bars = toBars(range(0, 399).map((t) => 100 + t));
  const me = M.monthEndCloses(bars);
  assert.equal(me[0].d, '2020-01-31');
  assert.equal(me[1].d, '2020-02-29');
  const p = me.map((x) => x.c);
  const m = p.length - 1;
  close(M.momentum12_1Monthly(me).value, p[m - 1] / p[m - 12] - 1);
  close(M.momentum12_1Monthly(p).value, p[m - 1] / p[m - 12] - 1);
});

test('trend falls back to 10-month SMA', () => {
  // Monthly bars: 12 month-ends, rising
  const bars = range(1, 12).map((m) => ({ d: `2024-${String(m).padStart(2, '0')}-28`, c: m, h: m, l: m, o: m, v: 0 }));
  const t = M.trendFilter(bars);
  assert.equal(t.basis, '10-month SMA');
  assert.equal(t.value, true);
  close(t.sma, 7.5);
});

test('ATR true range with gaps', () => {
  const up = [{ d: '2024-01-01', h: 10, l: 9, c: 9.5 }, { d: '2024-01-02', h: 12, l: 11.5, c: 12 }];
  const a = M.atrSeries(up, 1);
  close(a[0], 1);
  close(a[1], 2.5); // |h - prevC|
  const down = [{ d: '2024-01-01', h: 10, l: 9, c: 9.5 }, { d: '2024-01-02', h: 8, l: 7, c: 7.5 }];
  close(M.atrSeries(down, 1)[1], 2.5); // |l - prevC|
  // Wilder smoothing n=2: seed mean(1, 2.5), then (1.75 + TR) / 2
  const three = [...up, { d: '2024-01-03', h: 12.5, l: 12, c: 12.2 }];
  close(M.atrSeries(three, 2)[2], (1.75 + 0.5) / 2);
});

test('one bar short -> null with needs', () => {
  const c = (k) => range(1, k).map((x) => 100 + Math.sin(x));
  let r = M.annualVolatility(c(63), 63); assert.equal(r.value, null); assert.equal(r.needs, 64);
  assert.notEqual(M.annualVolatility(c(64), 63).value, null);
  r = M.maxDrawdown([1]); assert.equal(r.value, null); assert.equal(r.needs, 2);
  r = M.sharpeRatio(c(63)); assert.equal(r.value, null); assert.equal(r.needs, 64);
  assert.notEqual(M.sharpeRatio(c(64)).value, null);
  r = M.sortinoRatio(c(63)); assert.equal(r.value, null); assert.equal(r.needs, 64);
  assert.notEqual(M.sortinoRatio(c(64)).value, null);
  r = M.betaVs(toBars(c(125)), toBars(c(125).map((x) => x * 2 + Math.cos(x)))); assert.equal(r.value, null); assert.equal(r.needs, 126);
  assert.notEqual(M.betaVs(toBars(c(126)), toBars(c(126).map((x) => x * 2 + Math.cos(x)))).value, null);
  r = M.momentum12_1(toBars(c(252))); assert.equal(r.value, null); assert.equal(r.needs, 253);
  assert.notEqual(M.momentum12_1(toBars(c(253))).value, null);
  r = M.momentum12_1Monthly(c(12)); assert.equal(r.value, null); assert.equal(r.needs, 13);
  assert.notEqual(M.momentum12_1Monthly(c(13)).value, null);
  r = M.fiftyTwoWeekRatio(toBars(c(251))); assert.equal(r.value, null); assert.equal(r.needs, 252);
  assert.notEqual(M.fiftyTwoWeekRatio(toBars(c(252))).value, null);
  r = M.trendFilter(toBars(c(199))); assert.equal(r.value, null); assert.equal(r.needs, 200);
  assert.notEqual(M.trendFilter(toBars(c(200))).value, null);
  assert.equal(M.fiveDaySpike(c(68)), null);
  assert.notEqual(M.fiveDaySpike(c(69)), null);
});

test('five-day spike', () => {
  const base = range(0, 99).map((i) => 100 * (1 + (i % 2 ? 0.01 : -0.01)));
  assert.equal(M.fiveDaySpike(base), false);
  const spiked = [...base];
  for (let i = 95; i < 100; i++) spiked[i] = base[94] * 1.03 ** (i - 94);
  assert.equal(M.fiveDaySpike(spiked), true);
});

test('verdict truth table', () => {
  const vals = [true, false, null];
  for (const trend of vals) for (const momentum of vals) for (const relative of vals) for (const high52 of vals) {
    const v = M.verdictFromChecks({ trend, momentum, relative, high52 }, {});
    const others = [momentum, relative, high52].filter((x) => x === true).length;
    const expected = trend === null ? 'Insufficient history' : trend === false ? 'Unfavourable' : others >= 2 ? 'Favourable' : 'Mixed';
    assert.equal(v.label, expected, JSON.stringify({ trend, momentum, relative, high52 }));
    const all = [trend, momentum, relative, high52];
    assert.equal(v.passed, all.filter((x) => x === true).length);
    assert.equal(v.available, all.filter((x) => x !== null).length);
    assert.equal(v.notes.length, 0);
  }
});

test('verdict notes', () => {
  const ck = { trend: true, momentum: true, relative: true, high52: true };
  assert.equal(M.verdictFromChecks(ck, { vol63: 0.3, vol252: 0.2, spike: false }).notes[0], 'high-volatility regime, size down');
  assert.equal(M.verdictFromChecks(ck, { vol63: 0.25, vol252: 0.2 }).notes.length, 0);
  assert.equal(M.verdictFromChecks(ck, { vol63: 0.3, vol252: null }).notes.length, 0);
  const both = M.verdictFromChecks(ck, { vol63: 0.3, vol252: 0.2, spike: true }).notes;
  assert.equal(both.length, 2);
  assert.equal(both[1], "don't chase last week's spike");
});

test('trailingStopSeries', () => {
  const c = [...range(1, 30), 25, 24, 23];
  const bars = c.map((x, i) => ({ d: day(i), o: x, h: x + 1, l: x - 1, c: x, v: 0 }));
  const stops = M.trailingStopSeries(bars, 2, 22);
  assert.equal(stops[20], null);
  const atr = M.atrSeries(bars, 14);
  close(stops[21], 22 - 2 * atr[21]);
  close(stops.at(-1), 30 - 2 * atr.at(-1)); // keeps the 22-day high after a drop
  const crashed = M.computeSignals({ bars: [...bars, { d: day(40), o: 5, h: 6, l: 4, c: 5, v: 0 }], equity: 100000 });
  assert.equal(crashed.shares, null); // close below the stop
});

test('computeSignals', () => {
  const N = 300;
  const p = [100], q = [100];
  for (let i = 1; i < N; i++) {
    const r = i % 2 ? 0.012 : -0.008;
    q.push(q[i - 1] * (1 + r / 2));
    p.push(p[i - 1] * (1 + r));
  }
  const bars = p.map((c, i) => ({ d: day(i), o: c, h: c * 1.01, l: c * 0.99, c, v: 0 }));
  const bench = toBars(q);
  const s = M.computeSignals({ bars, benchmarkBars: bench, riskFreePct: 2, equity: 100000 });
  assert.equal(s.checks.trend, true);
  assert.equal(s.checks.momentum, true);
  assert.equal(s.checks.relative, true);
  assert.equal(s.verdict.label, 'Favourable');
  close(s.beta.value, 2, 1e-9);
  close(s.stop, Math.max(...p.slice(-22)) - 4 * s.atr); // default MARKET_ATR_MULT
  assert.equal(s.shares, Math.floor(1000 / (s.close - s.stop)));
  close(s.riskAmount, s.shares * (s.close - s.stop));
  assert.notEqual(s.sharpe.value, null);
  assert.notEqual(s.vol63.value, null);
  const short = M.computeSignals({ bars: bars.slice(0, 30) });
  assert.equal(short.verdict.label, 'Insufficient history');
  assert.equal(short.shares, null);
  assert.equal(short.relative.value, null);
});

console.log(`All market-math tests passed (${n})`);
