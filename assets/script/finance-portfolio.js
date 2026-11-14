// Portfolio: the Trade tab (buys, sells, splits per Account), holdings at average
// cost (finance-portfolio-math.js) and gain/loss in CAD. Prices load when the page opens.

const TRADE_HEADERS = ['Date', 'Account', 'Symbol', 'Action', 'Quantity', 'Price', 'Fees', 'Currency', 'Notes', 'FX to CAD'];
const tradeSheetRange = (cells) => `'${CONFIG.SHEETS.TRADES}'!${cells}`;
const TRADES_RANGE = () => tradeSheetRange('A2:J');
const TRADE_PAGE_SIZE = 50;
const TRADE_TABLE_COLUMNS = 9; // the holdings and trades tables alike
const NO_TRADES_TEXT = 'No trades yet — click 📝 to log a buy.';
const FX_DECIMALS_SCALE = 10000; // a looked-up FX rate keeps 4 decimals
const PORTFOLIO_RANGES = MARKET_RANGES.filter((r) => !r.intraday);

let allTrades = [];
let tradesSheetId = null;
let editingTradeRow = null;
let tradeListenersAttached = false;
let tradeSort = { key: 'date', dir: -1 };
let tradePage = 1;
let editTrade = null;
let portfolioRangeSlug = 'all';
let portfolioGainChart = null;
let portfolioValueChart = null;
const portfolioBars = new Map(); // symbol -> daily bars
let portfolioFx = null;          // USD/CAD daily bars
const portfolioHiddenSeries = new Set();
let portfolioAccountHoldings = new Map(); // account -> holdings (CAD), for writeHoldingsToMarketValue

function tradeField(name) {
  return document.getElementById(`trade-${name}`);
}

async function ensureTradesTab() {
  tradesSheetId = await ensureSheetTab(CONFIG.SHEETS.TRADES, TRADE_HEADERS);
}

// Columns A–J of one trade.
function tradeRowValues(t) {
  return [t.date, t.account, t.symbol, t.action, t.quantity, t.action === 'Split' ? '' : t.price, t.fees, t.currency, t.notes, t.fx ?? ''];
}

async function initTrades(forceRefresh = false) {
  portfolioRangeSlug = readMarketPref('ledger_portfolio_range', 'all');
  await refreshTrades();

  if (tradeListenersAttached) return;
  tradeListenersAttached = true;
  document.getElementById('add-trade-btn').addEventListener('click', () => openTradeForm());
  editTrade = routedRowEdit('portfolio', () => allTrades, (t) => `${t.date} ${t.action} ${t.symbol}`, openTradeForm);
  tradeField('cancel-btn').addEventListener('click', closeTradeForm);
  tradeField('action').addEventListener('change', syncTradeActionFields);
  tradeField('symbol').addEventListener('change', () => {
    const symbol = normalizeSymbol(tradeField('symbol').value);
    if (symbol) tradeField('currency').value = isCanadianSymbol(symbol) ? 'CAD' : (allWatchlist.find((w) => w.symbol === symbol)?.currency || 'USD');
  });
  onFormSubmit('trade-form', submitTradeForm);
  makeSortableHeaders('#trades-table', tradeSort, () => { tradePage = 1; renderTrades(); });
  onAsyncClick('portfolio-write-mv-btn', writeHoldingsToMarketValue);
  registerPageShow('portfolio', loadPortfolioPrices);
}

async function refreshTrades() {
  if (!(await sheetTabExists(CONFIG.SHEETS.TRADES))) {
    allTrades = [];
    tradesSheetId = null;
  } else {
    const resp = await getValues(TRADES_RANGE(), VALUE_PARAMS);
    allTrades = (resp.values || []).map((row, i) => {
      const symbol = String(row[2] || '').trim().toUpperCase();
      const currency = row[7] || symbolCurrency(symbol);
      const fx = Number(row[9]);
      return {
        row: i + 2,
        date: String(row[0] || '').slice(0, 10),
        account: String(row[1] || ''),
        symbol,
        action: String(row[3] || 'Buy'),
        quantity: Number(row[4]),
        price: Number(row[5]) || 0,
        fees: Number(row[6]) || 0,
        currency,
        notes: row[8] || '',
        fx: currency === 'CAD' ? 1 : (Number.isFinite(fx) && fx > 0 ? fx : null),
      };
    }).filter((t) => t.symbol && t.date);
  }
  renderTrades();
  renderPortfolio();
}

function heldSymbols() {
  return [...new Set(allTrades.map((t) => t.symbol))];
}

// The page opened: bars for every traded symbol, USD/CAD if any USD trade, then draw.
async function loadPortfolioPrices() {
  renderPortfolio();
  if (!allTrades.length) return;
  const problems = [];
  const symbols = heldSymbols();
  for (const [i, symbol] of symbols.entries()) {
    try {
      const result = await getDailyBars(symbol, {
        onWait: (s, name) => setMarketStatus('portfolio-status', `Waiting for ${name}'s per-minute limit (${s} s)… loading prices ${i + 1}/${symbols.length}`),
      });
      portfolioBars.set(symbol, result.bars);
      marketBars.set(symbol, result);
      if (result.error) problems.push(marketErrorText(result.error));
      if (result.partial) problems.push(`${symbol}: only the last ~100 trading days of TSX prices so far; older days use trade prices.`);
    } catch (err) {
      problems.push(marketErrorText(err));
    }
  }
  if (allTrades.some((t) => t.currency === 'USD')) {
    try {
      portfolioFx = await getUsdCadSeries();
    } catch (err) {
      problems.push(`USD/CAD: ${marketErrorText(err)}`);
    }
  }
  setMarketStatus('portfolio-status', [...new Set(problems)].join(' '));
  renderPortfolio();
}

function lastFx() {
  return portfolioFx?.length ? portfolioFx.at(-1).c : null;
}

function currentHoldings() {
  return computeHoldings(allTrades, { fxFallback: lastFx() || 1 });
}

function renderPortfolio() {
  const holdings = [...currentHoldings().values()];
  const fxNow = lastFx();
  let value = 0, cost = 0, unrealized = 0, realized = 0, missing = false;
  const rows = holdings.map((h) => {
    const bars = portfolioBars.get(h.symbol);
    const close = bars?.length ? bars.at(-1).c : null;
    const fx = h.currency === 'CAD' ? 1 : fxNow;
    const v = holdingValue(h, close, fx ?? NaN);
    realized += h.realizedCad;
    if (h.shares > 0) {
      cost += h.acbCad;
      if (v.marketValueCad !== null && fx !== null) {
        value += v.marketValueCad;
        unrealized += v.unrealizedCad;
      } else missing = true;
    }
    return { h, close, v };
  });

  const setCard = (id, amount, signed = false) => {
    const el = document.getElementById(id);
    el.textContent = holdings.length ? formatMoney(amount, 'CAD') : '—';
    el.classList.toggle('income', signed && holdings.length > 0 && amount >= 0);
    el.classList.toggle('expense', signed && amount < 0);
  };
  setCard('portfolio-value', value);
  setCard('portfolio-cost', cost);
  setCard('portfolio-unrealized', unrealized, true);
  setCard('portfolio-realized', realized, true);
  // Cleared once every holding has a price, so a resolved warning doesn't linger.
  document.getElementById('portfolio-value').title = missing ? 'Some holdings have no price yet and are left out' : '';

  renderHoldingsTable(rows);
  renderPortfolioAccounts(rows, fxNow);
  renderPortfolioCharts();
  const warnings = holdings.flatMap((h) => h.warnings);
  if (warnings.length) setMarketStatus('portfolio-status', warnings.join(' '));
}

function moneyCell(value, currency, signed = false) {
  const td = makeCell(value === null || !Number.isFinite(value) ? '—' : formatMoney(value, currency));
  td.classList.add('num');
  if (signed && Number.isFinite(value)) td.classList.add(value < 0 ? 'expense' : 'income');
  return td;
}

function numberCell(value, digits = 4) {
  const text = Number.isFinite(value) ? String(Math.round(value * 10 ** digits) / 10 ** digits) : '—';
  const td = makeCell(privacyMode ? maskDigits(text) : text);
  td.classList.add('num');
  return td;
}

function renderHoldingsTable(rows) {
  const tbody = document.getElementById('holdings-body');
  tbody.innerHTML = '';
  const open = rows.filter(({ h }) => h.shares > 0);
  if (!open.length) {
    tbody.appendChild(renderEmptyRow(TRADE_TABLE_COLUMNS, allTrades.length ? 'No open positions.' : NO_TRADES_TEXT));
    return;
  }
  open.sort((a, b) => (b.v.marketValueCad ?? 0) - (a.v.marketValueCad ?? 0)).forEach(({ h, close, v }) => {
    const tr = document.createElement('tr');
    const pct = v.unrealized !== null && h.acb ? v.unrealized / h.acb : null;
    const pctCell = document.createElement('td');
    setPercentCell(pctCell, pct);
    if (privacyMode && pct !== null) pctCell.textContent = maskDigits(pctCell.textContent);
    tr.append(
      makeCell(h.account),
      makeCell(h.symbol),
      numberCell(h.shares),
      moneyCell(v.avgCost, h.currency),
      moneyCell(close, h.currency),
      moneyCell(v.marketValue, h.currency),
      moneyCell(v.unrealized, h.currency, true),
      pctCell,
      moneyCell(h.realized, h.currency, true),
    );
    tbody.appendChild(tr);
  });
}

// An account's Market Value, else its Balance.
function accountValue(a) {
  return Number.isFinite(a.currentValue) ? a.currentValue : a.balance;
}

// Investment accounts' Market Value (or Balance), the equity Market's position size uses.
function investmentEquityCad() {
  return allAccounts
    .filter((a) => /^investment/i.test(a.type))
    .reduce((sum, a) => sum + (accountValue(a) || 0), 0);
}

function renderPortfolioAccounts(rows, fxNow) {
  const byAccount = new Map();
  rows.forEach(({ h, v }) => {
    if (h.shares <= 0 || v.marketValueCad === null || (h.currency !== 'CAD' && fxNow === null)) return;
    byAccount.set(h.account, (byAccount.get(h.account) || 0) + v.marketValueCad);
  });
  const tbody = document.getElementById('portfolio-accounts-body');
  tbody.innerHTML = '';
  if (!byAccount.size) {
    tbody.appendChild(renderEmptyRow(4, 'Account totals show once prices load.'));
  }
  byAccount.forEach((holdingsCad, name) => {
    const account = allAccounts.find((a) => a.name === name);
    const mv = account ? accountValue(account) : null;
    const tr = document.createElement('tr');
    tr.append(makeCell(name), moneyCell(holdingsCad, 'CAD'), moneyCell(mv, 'CAD'), moneyCell(mv === null ? null : mv - holdingsCad, 'CAD', true));
    tbody.appendChild(tr);
  });
  document.getElementById('portfolio-write-mv-btn').hidden = !(getSetting('PORTFOLIO_WRITE_MARKET_VALUE', 0) === 1 && byAccount.size);
  portfolioAccountHoldings = byAccount;
}

// Opt-in: writes each account's Holdings into Account column E, skipping formulas.
async function writeHoldingsToMarketValue() {
  if (!portfolioAccountHoldings.size) return;
  if (!confirm("Write each account's Holdings (CAD) into its Market Value? Cells holding a formula are left alone.")) return;
  const accountCell = (cells) => `'${CONFIG.SHEETS.ACCOUNTS}'!${cells}`;
  const resp = await getValues(accountCell('A3:E100'), { valueRenderOption: 'FORMULA' });
  const data = [];
  const skipped = [];
  (resp.values || []).forEach((row, i) => {
    const name = row[0];
    if (!portfolioAccountHoldings.has(name)) return;
    const cell = row[4];
    if (typeof cell === 'string' && cell.startsWith('=')) {
      skipped.push(`${name} (E${i + 3} is a formula)`);
      return;
    }
    data.push({ range: accountCell(`E${i + 3}`), values: [[Math.round(portfolioAccountHoldings.get(name) * 100) / 100]] });
  });
  if (data.length) await batchUpdateValues(data, 'RAW');
  await refreshAccountsList(true);
  renderPortfolio();
  setMarketStatus('portfolio-status', `Updated ${data.length} account${data.length === 1 ? '' : 's'}.${skipped.length ? ` Left alone: ${skipped.join(', ')}.` : ''}`);
}

function renderPortfolioCharts() {
  const range = PORTFOLIO_RANGES.find((r) => r.slug === portfolioRangeSlug) || PORTFOLIO_RANGES.at(-1);
  renderRangeButtons('portfolio-range', PORTFOLIO_RANGES, range.slug, (slug) => {
    portfolioRangeSlug = slug;
    writeMarketPref('ledger_portfolio_range', slug);
    renderPortfolioCharts();
  });
  if (!allTrades.length) return;
  const series = buildPortfolioSeries(allTrades, portfolioBars, portfolioFx, { from: rangeStartDate(range) });
  const gain = [
    { label: 'Total gain (unrealized + realized)', data: series.totalGainCad, color: chartColor('--chart-blue') },
    { label: 'Unrealized (open positions)', data: series.unrealizedCad, color: chartColor('--chart-good'), dash: true },
    { label: 'Realized (from sells, cumulative)', data: series.realizedCumCad, color: chartColor('--chart-purple'), dash: true },
  ];
  const value = [
    { label: 'Market value', data: series.marketValueCad, color: chartColor('--chart-blue') },
    { label: 'Cost basis (ACB)', data: series.costBasisCad, color: desiredMarkColor(), dash: true },
  ];
  const draw = () => {
    const visible = (list) => list.map((s) => ({ ...s, hidden: portfolioHiddenSeries.has(s.label) }));
    portfolioGainChart = marketLineChart(portfolioGainChart, 'portfolio-gain-chart', series.dates, visible(gain), { money: 'CAD', mask: true });
    portfolioValueChart = marketLineChart(portfolioValueChart, 'portfolio-value-chart', series.dates, visible(value), { money: 'CAD', mask: true });
    renderSeriesLegend('portfolio-gain-legend', gain, portfolioHiddenSeries, draw);
    renderSeriesLegend('portfolio-value-legend', value, portfolioHiddenSeries, draw);
  };
  draw();
}

// --- Trades table -----------------------------------------------------------

function sortedTrades() {
  const { key, dir } = tradeSort;
  return [...allTrades].sort((a, b) => (String(a[key]).localeCompare(String(b[key])) || a.row - b.row) * dir);
}

function renderTrades() {
  const tbody = document.getElementById('trades-body');
  tbody.innerHTML = '';
  if (!allTrades.length) {
    tbody.appendChild(renderEmptyRow(TRADE_TABLE_COLUMNS, NO_TRADES_TEXT));
    renderPager('trades-pagination', { page: 1, totalPages: 1, onChange: () => {} });
    return;
  }
  const list = sortedTrades();
  const totalPages = Math.max(1, Math.ceil(list.length / TRADE_PAGE_SIZE));
  tradePage = Math.min(tradePage, totalPages);
  list.slice((tradePage - 1) * TRADE_PAGE_SIZE, tradePage * TRADE_PAGE_SIZE).forEach((t) => {
    const tr = document.createElement('tr');
    const actions = document.createElement('td');
    actions.className = 'workout-actions-cell';
    actions.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editTrade(t) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteTrade(t) }),
    );
    const split = t.action === 'Split';
    tr.append(
      makeCell(t.date), makeCell(t.account, t.notes || t.account), makeCell(t.symbol), makeCell(t.action),
      numberCell(t.quantity),
      split ? makeCell('') : moneyCell(t.price, t.currency),
      split ? makeCell('') : moneyCell(t.fees, t.currency),
      numberCell(t.fx ?? NaN),
      actions,
    );
    tbody.appendChild(tr);
  });
  renderPager('trades-pagination', { page: tradePage, totalPages, onChange: (p) => { tradePage = p; renderTrades(); } });
}

// --- Trade form -------------------------------------------------------------

function tradeAccountOptions() {
  const invest = allAccounts.filter((a) => /^investment/i.test(a.type)).map((a) => a.name);
  return [...invest, ...allAccounts.map((a) => a.name).filter((n) => !invest.includes(n))];
}

function syncTradeActionFields() {
  const split = tradeField('action').value === 'Split';
  tradeField('quantity-label').textContent = split ? 'Split ratio (new ÷ old)' : 'Quantity';
  ['price', 'fees', 'fx'].forEach((name) => { tradeField(name).disabled = split; });
}

function openTradeForm(trade = null) {
  editingTradeRow = trade?.row ?? null;
  const last = allTrades.at(-1);
  populateSelect(tradeField('account'), tradeAccountOptions(), trade?.account || last?.account || '');
  const symbols = tradeField('symbol-options');
  symbols.innerHTML = '';
  [...new Set([...allWatchlist.map((w) => w.symbol), ...heldSymbols()])].forEach((s) => {
    const option = document.createElement('option');
    option.value = s;
    symbols.appendChild(option);
  });
  tradeField('date').value = trade?.date || isoFromDate(new Date());
  tradeField('action').value = trade?.action || 'Buy';
  tradeField('symbol').value = trade?.symbol || '';
  tradeField('quantity').value = trade ? trade.quantity : '';
  tradeField('price').value = trade && trade.action !== 'Split' ? trade.price : '';
  tradeField('fees').value = trade && trade.fees ? trade.fees : '';
  tradeField('currency').value = trade?.currency || 'USD';
  tradeField('fx').value = trade && trade.currency !== 'CAD' && trade.fx ? trade.fx : '';
  tradeField('notes').value = trade?.notes || '';
  syncTradeActionFields();
  clearFieldError('trade-form-error');
  tradeField('modal').hidden = false;
}

function closeTradeForm() {
  tradeField('modal').hidden = true;
  editingTradeRow = null;
}

// Blank -> null, unparseable -> NaN.
function tradeNumber(id) {
  const raw = document.getElementById(id).value.trim();
  if (!raw) return null;
  // Not evaluateNumberExpression: it rounds to cents, and FX and share counts need more.
  const value = Number(raw.replace(/[,\s$]/g, ''));
  return Number.isFinite(value) ? value : NaN;
}

async function submitTradeForm() {
  const fail = (message) => showFieldError('trade-form-error', message);
  const date = tradeField('date').value;
  const action = tradeField('action').value;
  const account = tradeField('account').value;
  const symbol = normalizeSymbol(tradeField('symbol').value);
  const split = action === 'Split';
  const quantity = tradeNumber('trade-quantity');
  const price = split ? null : tradeNumber('trade-price');
  const fees = split ? 0 : (tradeNumber('trade-fees') ?? 0);
  const currency = isCanadianSymbol(symbol) ? 'CAD' : tradeField('currency').value;
  let fx = currency === 'CAD' || split ? 1 : tradeNumber('trade-fx');

  if (!date) return fail('Pick the trade date.');
  if (!account) return fail('Pick the account (add one on the Account page first).');
  if (!symbol) return fail('Enter the symbol, e.g. AAPL or SHOP.TO.');
  if (!(quantity > 0)) return fail(split ? 'Enter the split ratio, e.g. 4 for a 4-for-1.' : 'Enter how many shares.');
  if (!split && !(price > 0)) return fail('Enter the price per share.');
  if (!Number.isFinite(fees) || fees < 0) return fail('Fees must be 0 or more.');

  try {
    if (fx === null) {
      try {
        fx = fxOn(await getUsdCadSeries(), date);
      } catch (err) {
        return fail(`Couldn't look up USD/CAD for ${date} (${marketErrorText(err)}); type the rate in FX to CAD.`);
      }
      if (!fx) return fail(`No USD/CAD rate on or before ${date}; type it in FX to CAD.`);
      fx = Math.round(fx * FX_DECIMALS_SCALE) / FX_DECIMALS_SCALE;
    }
    if (!(fx > 0)) return fail('FX to CAD must be a positive number.');

    const values = tradeRowValues({ date, account, symbol, action, quantity, price, fees, currency, notes: tradeField('notes').value.trim(), fx });
    await ensureTradesTab();
    const editingRow = editingTradeRow;
    let savedRow = editingRow;
    if (editingRow) await updateValues(tradeSheetRange(`A${editingRow}:J${editingRow}`), [values], 'RAW');
    else savedRow = appendedRow(await appendValues(TRADES_RANGE(), [values], 'RAW'));
    await refreshTrades();
    const saved = allTrades.find((t) => t.row === savedRow);
    if (saved) {
      openTradeForm(saved);
      stayOnSavedForm('trade-modal', editTrade.step(saved));
    }
    showFormSaved('trade-form-error');
    if (!portfolioBars.has(symbol)) loadPortfolioPrices();
  } catch (err) {
    fail(err.message);
  }
}

async function deleteTrade(trade) {
  await confirmAndDelete(`Delete the ${trade.action} of ${trade.symbol} on ${trade.date}?`, async () => {
    if (tradesSheetId === null) await ensureTradesTab();
    await deleteSheetRow(tradesSheetId, trade.row);
    await refreshTrades();
    showUndoToast(`${trade.action} of ${trade.symbol} deleted.`, async () => {
      await appendValues(TRADES_RANGE(), [tradeRowValues(trade)], 'RAW');
      await refreshTrades();
    });
  }, "Couldn't delete the trade");
}
