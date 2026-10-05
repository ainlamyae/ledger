// Market: the Watchlist tab, each stock's latest moves, and one price chart with
// 1d…All ranges. Prices load when this page opens (registerPageShow), not with Finance.

const WATCHLIST_HEADERS = ['Symbol', 'Name', 'Exchange', 'Currency', 'Notes'];
const WATCHLIST_RANGE = () => `'${CONFIG.SHEETS.WATCHLIST}'!A2:E`;

let allWatchlist = [];
let watchlistSheetId = null;
let editingWatchlistRow = null;
let watchlistListenersAttached = false;
let watchlistSort = { key: null, dir: 1 };
let editWatchlist = null;
let marketPriceChart = null;
const marketBars = new Map(); // symbol -> daily result from getDailyBars
let marketSymbol = null;
let marketRangeSlug = '1y';

function readMarketPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function writeMarketPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

async function initWatchlist(forceRefresh = false) {
  marketRangeSlug = readMarketPref('ledger_market_range', '1y');
  marketSymbol = readMarketPref('ledger_market_symbol', null);
  await refreshWatchlist();

  if (watchlistListenersAttached) return;
  watchlistListenersAttached = true;
  document.getElementById('add-watchlist-btn').addEventListener('click', () => openWatchlistForm());
  editWatchlist = routedRowEdit('market', () => allWatchlist, (w) => w.symbol, openWatchlistForm);
  document.getElementById('watchlist-cancel-btn').addEventListener('click', closeWatchlistForm);
  onFormSubmit('watchlist-form', submitWatchlistForm);
  makeSortableHeaders('#watchlist-table', watchlistSort, renderWatchlist);
  document.getElementById('watchlist-symbol').addEventListener('input', debounceSymbolSearch);
  document.getElementById('watchlist-symbol').addEventListener('change', fillWatchlistFromSearch);
  registerPageShow('market', loadMarketPrices);
}

async function refreshWatchlist() {
  if (!(await sheetTabExists(CONFIG.SHEETS.WATCHLIST))) {
    allWatchlist = [];
    watchlistSheetId = null;
  } else {
    const resp = await getValues(WATCHLIST_RANGE(), VALUE_PARAMS);
    allWatchlist = (resp.values || []).map((row, i) => ({
      row: i + 2,
      symbol: String(row[0] || '').trim().toUpperCase(),
      name: row[1] || '',
      exchange: row[2] || '',
      currency: row[3] || symbolCurrency(String(row[0] || '')),
      notes: row[4] || '',
    })).filter((w) => w.symbol);
  }
  if (!marketSymbol || !allWatchlist.some((w) => w.symbol === marketSymbol)) marketSymbol = allWatchlist[0]?.symbol || null;
  renderWatchlist();
  syncAnalysisSymbolOptions();
}

function sortedWatchlist() {
  if (!watchlistSort.key) return allWatchlist;
  const { key, dir } = watchlistSort;
  return [...allWatchlist].sort((a, b) => a[key].localeCompare(b[key], undefined, { sensitivity: 'base' }) * dir);
}

function renderWatchlist() {
  const tbody = document.getElementById('watchlist-body');
  tbody.innerHTML = '';
  if (!allWatchlist.length) {
    tbody.appendChild(renderEmptyRow(7, 'No stocks yet — click ➕ to add one (e.g. AAPL, or SHOP.TO for the TSX).'));
    return;
  }
  sortedWatchlist().forEach((w) => {
    const tr = document.createElement('tr');
    tr.classList.toggle('today-row', w.symbol === marketSymbol);
    tr.title = `Show ${w.symbol} on the chart`;
    tr.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      selectMarketSymbol(w.symbol);
    });
    const bars = marketBars.get(w.symbol)?.bars || [];
    const close = makeCell(bars.length ? formatMoney(bars.at(-1).c, w.currency, { mask: false }) : '—');
    close.classList.add('num');
    const day = document.createElement('td');
    const month = document.createElement('td');
    const year = document.createElement('td');
    setPercentCell(day, barChange(bars, 1));
    setPercentCell(month, barChange(bars, 21));
    setPercentCell(year, barChange(bars, 252));
    const actions = document.createElement('td');
    actions.className = 'workout-actions-cell';
    actions.append(
      makeRowActionButton({ emoji: '🔬', title: 'Analyze', onClick: () => openStockAnalysis(w.symbol) }),
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editWatchlist(w) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteWatchlistEntry(w) }),
    );
    tr.append(makeCell(w.symbol), makeCell(w.name, w.notes || w.name), close, day, month, year, actions);
    tbody.appendChild(tr);
  });
}

function selectMarketSymbol(symbol) {
  marketSymbol = symbol;
  writeMarketPref('ledger_market_symbol', symbol);
  renderWatchlist();
  drawMarketChart();
}

// The page opened: every watchlist symbol's daily bars (cache first), then the chart.
async function loadMarketPrices() {
  if (!allWatchlist.length) {
    setMarketStatus('market-status', '');
    renderMarketRangeButtons();
    return;
  }
  drawMarketChart();
  const problems = [];
  for (const [i, w] of allWatchlist.entries()) {
    try {
      const result = await getDailyBars(w.symbol, {
        onWait: (s, name) => setMarketStatus('market-status', `Waiting for ${name}'s per-minute limit (${s} s)… ${i + 1}/${allWatchlist.length}`),
      });
      marketBars.set(w.symbol, result);
      if (result.error) problems.push(marketErrorText(result.error));
    } catch (err) {
      problems.push(marketErrorText(err));
    }
    renderWatchlist();
    if (w.symbol === marketSymbol) drawMarketChart();
  }
  setMarketStatus('market-status', [...new Set(problems)].join(' '));
}

function renderMarketRangeButtons() {
  const canadian = marketSymbol && isCanadianSymbol(marketSymbol);
  renderRangeButtons('market-range', MARKET_RANGES, marketRangeSlug, (slug) => {
    marketRangeSlug = slug;
    writeMarketPref('ledger_market_range', slug);
    drawMarketChart();
  }, canadian ? new Set(['1d']) : new Set());
}

async function drawMarketChart() {
  renderMarketRangeButtons();
  const title = document.getElementById('market-chart-title');
  if (!marketSymbol) {
    title.textContent = 'Price';
    return;
  }
  const entry = allWatchlist.find((w) => w.symbol === marketSymbol);
  title.textContent = entry?.name ? `${marketSymbol} — ${entry.name}` : marketSymbol;
  const range = marketRange(marketRangeSlug);
  const symbol = marketSymbol;
  try {
    let bars;
    let currency = entry?.currency || symbolCurrency(symbol);
    if (range.intraday && !isCanadianSymbol(symbol)) {
      const result = await getIntradayBars(symbol, range.intraday);
      bars = result.bars;
      if (range.slug === '1d' && bars.length) {
        const lastDay = bars.at(-1).d.slice(0, 10);
        bars = bars.filter((b) => b.d.startsWith(lastDay));
      }
      currency = result.currency || currency;
    } else {
      const daily = marketBars.get(symbol) || await getDailyBars(symbol);
      marketBars.set(symbol, daily);
      const monthly = daily.partial && ['2y', '5y', '10y', 'all'].includes(range.slug) ? await getMonthlyBars(symbol).catch(() => null) : null;
      bars = barsForRange(daily.bars, monthly, range);
      if (daily.partial && rangeStartDate(range) && daily.bars[0]?.d > rangeStartDate(range) && !monthly) {
        setMarketStatus('market-status', `${symbol}: Alpha Vantage's free plan gives the last ~100 trading days; older days build up as you come back.`);
      }
    }
    if (symbol !== marketSymbol) return;
    const change = bars.length > 1 ? bars.at(-1).c / bars[0].c - 1 : null;
    const token = change !== null && change < 0 ? '--chart-bad' : '--chart-good';
    const color = chartColor(token);
    marketPriceChart = marketLineChart(marketPriceChart, 'market-price-chart', bars.map((b) => b.d), [{
      label: `${symbol} (close)`,
      data: bars.map((b) => b.c),
      color,
      fill: true,
      fillColor: chartColor(token, 0.1),
    }], { money: currency, intraday: !!range.intraday && !isCanadianSymbol(symbol) });
  } catch (err) {
    setMarketStatus('market-status', marketErrorText(err));
  }
}

// --- Watchlist form ---------------------------------------------------------

let symbolSearchTimer = null;
let lastSymbolResults = [];

function debounceSymbolSearch() {
  clearTimeout(symbolSearchTimer);
  const query = document.getElementById('watchlist-symbol').value.trim();
  if (query.length < 2) return;
  symbolSearchTimer = setTimeout(async () => {
    try {
      lastSymbolResults = await searchSymbols(query);
      const list = document.getElementById('watchlist-symbol-options');
      list.innerHTML = '';
      lastSymbolResults.forEach((r) => {
        const option = document.createElement('option');
        option.value = r.symbol;
        option.label = `${r.name} · ${r.exchange} · ${r.currency}`;
        list.appendChild(option);
      });
    } catch (err) {
      if (err.kind === 'missing-key') showFieldError('watchlist-form-error', marketErrorText(err));
    }
  }, 500);
}

function fillWatchlistFromSearch() {
  const symbol = document.getElementById('watchlist-symbol').value.trim().toUpperCase();
  const hit = lastSymbolResults.find((r) => r.symbol === symbol);
  document.getElementById('watchlist-currency').value = hit?.currency === 'CAD' || isCanadianSymbol(symbol) ? 'CAD' : 'USD';
  if (!hit) return;
  const name = document.getElementById('watchlist-name');
  if (!name.value) name.value = hit.name;
  document.getElementById('watchlist-exchange').value = hit.exchange;
}

function openWatchlistForm(entry = null) {
  editingWatchlistRow = entry?.row ?? null;
  document.getElementById('watchlist-modal-title').textContent = entry ? 'Edit Watchlist Stock' : 'Add to Watchlist';
  document.getElementById('watchlist-symbol').value = entry?.symbol || '';
  document.getElementById('watchlist-name').value = entry?.name || '';
  document.getElementById('watchlist-exchange').value = entry?.exchange || '';
  document.getElementById('watchlist-currency').value = entry?.currency || 'USD';
  document.getElementById('watchlist-notes').value = entry?.notes || '';
  clearFieldError('watchlist-form-error');
  document.getElementById('watchlist-modal').hidden = false;
}

function closeWatchlistForm() {
  document.getElementById('watchlist-modal').hidden = true;
  editingWatchlistRow = null;
}

async function submitWatchlistForm() {
  const symbol = document.getElementById('watchlist-symbol').value.trim().toUpperCase();
  if (!/^[A-Z0-9.\-^=/]{1,15}$/.test(symbol)) {
    showFieldError('watchlist-form-error', 'Enter a symbol, e.g. AAPL or SHOP.TO.');
    return;
  }
  if (allWatchlist.some((w) => w.symbol === symbol && w.row !== editingWatchlistRow)) {
    showFieldError('watchlist-form-error', `${symbol} is already on the watchlist.`);
    return;
  }
  const values = [
    symbol,
    document.getElementById('watchlist-name').value.trim(),
    document.getElementById('watchlist-exchange').value.trim(),
    isCanadianSymbol(symbol) ? 'CAD' : document.getElementById('watchlist-currency').value,
    document.getElementById('watchlist-notes').value.trim(),
  ];
  try {
    watchlistSheetId = await ensureSheetTab(CONFIG.SHEETS.WATCHLIST, WATCHLIST_HEADERS);
    const editingRow = editingWatchlistRow;
    if (editingRow) await updateValues(`'${CONFIG.SHEETS.WATCHLIST}'!A${editingRow}:E${editingRow}`, [values], 'RAW');
    else await appendValues(WATCHLIST_RANGE(), [values], 'RAW');
    await refreshWatchlist();
    const saved = allWatchlist.find((w) => w.symbol === symbol);
    if (saved) {
      openWatchlistForm(saved);
      stayOnSavedForm('watchlist-modal', { slug: routeSlug(saved.symbol), label: saved.symbol });
    }
    showFormSaved('watchlist-form-error');
    if (!editingRow) selectMarketSymbol(symbol);
    loadMarketPrices();
  } catch (err) {
    showFieldError('watchlist-form-error', err.message);
  }
}

async function deleteWatchlistEntry(entry) {
  await confirmAndDelete(`Remove ${entry.symbol} from the watchlist? Its trades in Portfolio stay.`, async () => {
    if (watchlistSheetId === null) watchlistSheetId = await ensureSheetTab(CONFIG.SHEETS.WATCHLIST, WATCHLIST_HEADERS);
    await batchUpdate([{
      deleteDimension: { range: { sheetId: watchlistSheetId, dimension: 'ROWS', startIndex: entry.row - 1, endIndex: entry.row } },
    }]);
    await refreshWatchlist();
    drawMarketChart();
    showUndoToast(`${entry.symbol} removed.`, async () => {
      await appendValues(WATCHLIST_RANGE(), [[entry.symbol, entry.name, entry.exchange, entry.currency, entry.notes]], 'RAW');
      await refreshWatchlist();
      drawMarketChart();
    });
  }, "Couldn't remove the stock");
}
