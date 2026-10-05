// Watch List page: the Watchlist tab and each stock's latest moves. Prices load
// when this page opens (registerPageShow), not with Finance; a row opens Market.

const WATCHLIST_HEADERS = ['Symbol', 'Name', 'Exchange', 'Currency', 'Notes'];
const WATCHLIST_RANGE = () => `'${CONFIG.SHEETS.WATCHLIST}'!A2:E`;

let allWatchlist = [];
let watchlistSheetId = null;
let editingWatchlistRow = null;
let watchlistListenersAttached = false;
let watchlistSort = { key: null, dir: 1 };
let editWatchlist = null;
const marketBars = new Map(); // symbol -> daily result from getDailyBars

function readMarketPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function writeMarketPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

async function initWatchlist(forceRefresh = false) {
  await refreshWatchlist();

  if (watchlistListenersAttached) return;
  watchlistListenersAttached = true;
  document.getElementById('add-watchlist-btn').addEventListener('click', () => openWatchlistForm());
  editWatchlist = routedRowEdit('watchlist', () => allWatchlist, (w) => w.symbol, openWatchlistForm);
  document.getElementById('watchlist-cancel-btn').addEventListener('click', closeWatchlistForm);
  onFormSubmit('watchlist-form', submitWatchlistForm);
  makeSortableHeaders('#watchlist-table', watchlistSort, renderWatchlist);
  document.getElementById('watchlist-symbol').addEventListener('input', debounceSymbolSearch);
  document.getElementById('watchlist-symbol').addEventListener('change', fillWatchlistFromSearch);
  registerPageShow('watchlist', loadWatchlistPrices);
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
    tr.classList.toggle('today-row', w.symbol === analysisSymbol);
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
      makeRowActionButton({ emoji: '🔬', title: 'Open on Market', onClick: () => selectMarketSymbol(w.symbol) }),
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editWatchlist(w) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteWatchlistEntry(w) }),
    );
    tr.append(makeCell(w.symbol), makeCell(w.name, w.notes || w.name), close, day, month, year, actions);
    tbody.appendChild(tr);
  });
}

// 🔬: open Market on that stock.
function selectMarketSymbol(symbol) {
  analysisSymbol = symbol;
  writeMarketPref('ledger_market_symbol', symbol);
  const panel = routedPanel('market');
  if (window.ledgerSectionPage && panel) navigateSectionPage(panel);
  else if (panel) location.href = routeUrl(panel);
}

// Close and changes for each watchlist row (cache first).
async function loadWatchlistPrices() {
  const problems = [];
  for (const [i, w] of allWatchlist.entries()) {
    try {
      const result = await getDailyBars(w.symbol, {
        onWait: (s, name) => setMarketStatus('watchlist-status', `Waiting for ${name}'s per-minute limit (${s} s)… ${i + 1}/${allWatchlist.length}`),
      });
      marketBars.set(w.symbol, result);
      if (result.error) problems.push(marketErrorText(result.error));
    } catch (err) {
      problems.push(marketErrorText(err));
    }
    renderWatchlist();
  }
  setMarketStatus('watchlist-status', [...new Set(problems)].join(' '));
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
  const symbol = normalizeSymbol(document.getElementById('watchlist-symbol').value);
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
  const symbol = normalizeSymbol(document.getElementById('watchlist-symbol').value);
  if (!/^[A-Z0-9.\-^=/]{1,15}$/.test(symbol)) {
    showFieldError('watchlist-form-error', 'Enter a symbol, e.g. AAPL, SHOP.TO or TSE: AC.');
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
    loadWatchlistPrices();
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
    showUndoToast(`${entry.symbol} removed.`, async () => {
      await appendValues(WATCHLIST_RANGE(), [[entry.symbol, entry.name, entry.exchange, entry.currency, entry.notes]], 'RAW');
      await refreshWatchlist();
    });
  }, "Couldn't remove the stock");
}
