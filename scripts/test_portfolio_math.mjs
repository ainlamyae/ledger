// Tests for assets/script/portfolio-math.js, loaded via node:vm.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../assets/script/portfolio-math.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ Math, console, Map, Set });
vm.runInContext(src, ctx);
const { computeHoldings, holdingValue, priceOn, buildPortfolioSeries } = ctx;

let n = 0;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const test = (name, fn) => { fn(); n++; };
const T = (row, date, action, quantity, price, fees = 0, o = {}) =>
  ({ row, date, account: 'TFSA', symbol: 'XYZ', action, quantity, price, fees, currency: 'CAD', fx: 1, ...o });
const one = (m) => [...m.values()][0];

test('worked example', () => {
  const h = one(computeHoldings([
    T(1, '2024-01-01', 'Buy', 100, 10, 10),
    T(2, '2024-02-01', 'Buy', 50, 12, 10),
    T(3, '2024-03-01', 'Sell', 60, 15, 10),
  ]));
  close(h.shares, 90);
  close(h.acb, 972);
  close(h.acb / h.shares, 10.8);
  close(h.realized, 242);
  close(holdingValue(h, 11, 1).avgCost, 10.8);
});

test('USD with fx', () => {
  const usd = { currency: 'USD', symbol: 'AAPL' };
  const buy = T(1, '2024-01-01', 'Buy', 10, 100, 0, { ...usd, fx: 1.35 });
  close(one(computeHoldings([buy])).acbCad, 1350);
  const h = one(computeHoldings([buy, T(2, '2024-02-01', 'Sell', 5, 120, 0, { ...usd, fx: 1.40 })]));
  close(h.realized, 100);
  close(h.realizedCad, 165);
  close(h.acbCad, 675);
  const v = holdingValue(h, 130, 1.4);
  close(v.unrealized, 5 * 130 - 500);
  close(v.unrealizedCad, 5 * 130 * 1.4 - 675);
  assert.equal(holdingValue(h, NaN, 1).marketValue, null);
});

test('USD missing fx falls back and warns', () => {
  const h = one(computeHoldings([T(1, '2024-01-01', 'Buy', 1, 100, 0, { currency: 'USD', fx: null })], { fxFallback: 1.3 }));
  close(h.acbCad, 130);
  assert.ok(h.warnings.some((w) => w.includes('no FX rate')));
});

test('full exit resets; split', () => {
  const h = one(computeHoldings([T(1, '2024-01-01', 'Buy', 10, 10, 1), T(2, '2024-01-02', 'Sell', 10, 12, 1)]));
  assert.equal(h.shares, 0); assert.equal(h.acb, 0); assert.equal(h.acbCad, 0);
  close(h.realized, 120 - 1 - 101);
  const s = one(computeHoldings([T(1, '2024-01-01', 'Buy', 10, 10, 0), T(2, '2024-01-02', 'Split', 4, 0, 0)]));
  close(s.shares, 40); close(s.acb, 100); close(s.acb / s.shares, 2.5);
});

test('oversell warns and clamps', () => {
  const h = one(computeHoldings([T(1, '2024-01-01', 'Buy', 5, 10, 0), T(2, '2024-01-02', 'Sell', 8, 12, 0)]));
  assert.equal(h.shares, 0);
  close(h.realized, 10);
  assert.ok(h.warnings.some((w) => w.startsWith('Row 2: sells 8 but only 5 held')));
});

test('invalid quantity warns and skips', () => {
  const h = one(computeHoldings([T(1, '2024-01-01', 'Buy', 0, 10, 0)]));
  assert.equal(h.shares, 0);
  assert.equal(h.warnings.length, 1);
});

test('pooled', () => {
  const m = computeHoldings([
    T(1, '2024-01-01', 'Buy', 10, 10, 0, { account: 'Cash' }),
    T(2, '2024-01-02', 'Buy', 10, 20, 0, { account: 'Margin' }),
    T(3, '2024-01-03', 'Buy', 99, 5, 0, { account: 'RRSP' }),
  ], { pooled: true, registeredAccounts: new Set(['RRSP']) });
  assert.equal(m.size, 1);
  const h = m.get('XYZ');
  assert.equal(h.account, null);
  close(h.shares, 20); close(h.acb, 300);
  const split = computeHoldings([T(1, '2024-01-01', 'Buy', 1, 1, 0, { account: 'A' }), T(2, '2024-01-01', 'Buy', 1, 1, 0, { account: 'B' })]);
  assert.equal(split.size, 2);
});

test('priceOn', () => {
  const bars = [{ d: '2024-01-02', c: 1 }, { d: '2024-01-04', c: 2 }, { d: '2024-01-08', c: 3 }];
  assert.equal(priceOn(bars, '2024-01-01'), null);
  assert.equal(priceOn(bars, '2024-01-02'), 1);
  assert.equal(priceOn(bars, '2024-01-05'), 2);
  assert.equal(priceOn(bars, '2024-12-31'), 3);
  assert.equal(priceOn([], '2024-01-01'), null);
});

test('buildPortfolioSeries', () => {
  const bars = [1, 2, 3, 4, 5].map((i) => ({ d: `2024-01-0${i}T00:00:00Z`, c: 10 + i }));
  const r = buildPortfolioSeries([T(1, '2024-01-02', 'Buy', 10, 12, 0)], { XYZ: bars }, null);
  assert.equal(r.dates.length, 4);
  assert.equal(r.dates[0], '2024-01-02');
  close(r.marketValueCad[3], 10 * 15);
  for (let i = 0; i < r.dates.length; i++) close(r.totalGainCad[i], r.unrealizedCad[i] + r.realizedCumCad[i]);
  assert.ok(r.estimated.every((e) => !e));

  const r2 = buildPortfolioSeries([
    T(1, '2024-01-02', 'Buy', 10, 12, 0),
    T(2, '2024-01-03', 'Buy', 2, 50, 0, { symbol: 'NOBARS' }),
    T(3, '2024-01-04', 'Sell', 5, 14, 0),
  ], new Map([['XYZ', bars]]), null);
  assert.equal(r2.estimated[0], false);
  assert.equal(r2.estimated[1], true);
  close(r2.marketValueCad[3], 5 * 15 + 2 * 50);
  close(r2.realizedCumCad[3], 5 * 14 - 60);
  for (let i = 0; i < r2.dates.length; i++) close(r2.totalGainCad[i], r2.unrealizedCad[i] + r2.realizedCumCad[i]);
});

console.log(`All portfolio-math tests passed (${n})`);
