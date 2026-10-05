// Watch List page: the Watchlist tab and each stock's latest moves. Prices load
// when this page opens (registerPageShow), not with Finance; 🔬 opens Market.
// Alerts (column F, JSON) are checked on every Finance load for alerted stocks only.

const WATCHLIST_HEADERS = ['Symbol', 'Name', 'Exchange', 'Currency', 'Notes', 'Alerts'];
const WATCHLIST_RANGE = () => `'${CONFIG.SHEETS.WATCHLIST}'!A2:F`;
const ALERT_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const alertResults = new Map(); // symbol -> checkAlerts() results
let alertCheckToken = 0;

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
      alerts: parseAlerts(row[5]),
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
    tbody.appendChild(renderEmptyRow(8, 'No stocks yet — click ➕ to add one (e.g. AAPL, or SHOP.TO for the TSX).'));
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
    if (activeAlerts(w).length) {
      actions.append(makeRowActionButton({ emoji: '✅', title: 'Dismiss until the rule clears and is met again', onClick: () => dismissWatchlistAlerts(w) }));
    }
    actions.append(
      makeRowActionButton({ emoji: '🔬', title: 'Open on Market', onClick: () => selectMarketSymbol(w.symbol) }),
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editWatchlist(w) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteWatchlistEntry(w) }),
    );
    tr.append(makeCell(w.symbol), makeCell(w.name, w.notes || w.name), close, day, month, year, alertCell(w), actions);
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
  checkWatchlistAlerts();
}

// --- Alerts -------------------------------------------------------------------

const ALERT_RULES = ['below', 'above', 'belowAvg', 'aboveAvg', 'belowStop'];

function parseAlerts(text) {
  if (!text) return null;
  try {
    const raw = typeof text === 'string' ? JSON.parse(text) : text;
    const price = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) > 0 ? Number(v) : null);
    const alerts = {
      below: price(raw.below),
      above: price(raw.above),
      belowAvg: !!raw.belowAvg,
      aboveAvg: !!raw.aboveAvg,
      belowStop: !!raw.belowStop,
      dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.filter((r) => ALERT_RULES.includes(r)) : [],
    };
    return hasAlertRules(alerts) ? alerts : null;
  } catch {
    return null;
  }
}

function hasAlertRules(a) {
  return !!a && (a.below !== null || a.above !== null || a.belowAvg || a.aboveAvg || a.belowStop);
}

function alertsCell(alerts) {
  return hasAlertRules(alerts) ? JSON.stringify(alerts) : '';
}

// Met and not dismissed.
function activeAlerts(w) {
  const results = alertResults.get(w.symbol) || [];
  return results.filter((r) => r.met === true && !w.alerts?.dismissed.includes(r.rule));
}

function alertLabels(alerts) {
  if (!alerts) return [];
  return [
    alerts.below !== null && { rule: 'below', label: `<${alerts.below.toFixed(2)}` },
    alerts.above !== null && { rule: 'above', label: `>${alerts.above.toFixed(2)}` },
    alerts.belowAvg && { rule: 'belowAvg', label: '<avg' },
    alerts.aboveAvg && { rule: 'aboveAvg', label: '>avg' },
    alerts.belowStop && { rule: 'belowStop', label: '<stop' },
  ].filter(Boolean);
}

function alertText(w, r) {
  const money = (v) => formatMoney(v, w.currency, { mask: false });
  const name = { below: '', above: '', belowAvg: `the ${r.basis || 'long-term average'} `, aboveAvg: `the ${r.basis || 'long-term average'} `, belowStop: 'the trailing stop ' }[r.rule];
  const side = r.rule.startsWith('above') ? 'above' : 'below';
  if (r.met === null) return `${w.symbol}: close ${side} ${name.trim() || 'the level'} — needs more price history`;
  return `${w.symbol}: close ${money(r.close)} ${r.met ? 'is' : 'is not'} ${side} ${name}${money(r.level)} (${r.date})`;
}

// Gray while waiting, red when met (until dismissed).
function alertCell(w) {
  const td = document.createElement('td');
  const labels = alertLabels(w.alerts);
  if (!labels.length) {
    td.textContent = '—';
    return td;
  }
  const results = alertResults.get(w.symbol) || [];
  labels.forEach(({ rule, label }, i) => {
    if (i) td.append(' · ');
    const span = document.createElement('span');
    const r = results.find((x) => x.rule === rule);
    const dismissed = w.alerts.dismissed.includes(rule);
    span.textContent = label;
    span.className = r?.met === true && !dismissed ? 'expense' : 'neutral';
    span.title = r ? `${alertText(w, r)}${r.met === true && dismissed ? ' — dismissed' : ''}` : 'Not checked yet';
    td.appendChild(span);
  });
  return td;
}

// Alerted stocks only: saved prices up to 4 h old, then each rule on the latest close.
async function checkWatchlistAlerts() {
  const token = ++alertCheckToken;
  const alerted = allWatchlist.filter((w) => w.alerts);
  for (const w of alerted) {
    try {
      const daily = await getDailyBars(w.symbol, { maxAgeMs: ALERT_MAX_AGE_MS });
      if (token !== alertCheckToken) return;
      marketBars.set(w.symbol, daily);
      const needsMonthly = (w.alerts.belowAvg || w.alerts.aboveAvg) && daily.bars.length < 200 && daily.partial;
      const monthly = needsMonthly ? await getMonthlyBars(w.symbol).catch(() => null) : null;
      alertResults.set(w.symbol, checkAlerts(w.alerts, daily.bars, monthly, getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT)));
    } catch (err) {
      console.warn(`[alerts] ${w.symbol}: ${err.message}`);
    }
  }
  if (token !== alertCheckToken) return;
  await clearStaleDismissals(alerted);
  renderWatchlist();
  updateWatchlistAlertBadges();
}

// A dismissed rule that no longer holds is re-armed, so it can fire again.
async function clearStaleDismissals(alerted) {
  for (const w of alerted) {
    const results = alertResults.get(w.symbol) || [];
    const keep = w.alerts.dismissed.filter((rule) => results.find((r) => r.rule === rule)?.met !== false);
    if (keep.length === w.alerts.dismissed.length) continue;
    w.alerts.dismissed = keep;
    await writeWatchlistAlerts(w).catch((err) => console.warn(`[alerts] ${w.symbol}: ${err.message}`));
  }
}

function writeWatchlistAlerts(w) {
  return updateValues(`'${CONFIG.SHEETS.WATCHLIST}'!F${w.row}`, [[alertsCell(w.alerts)]], 'RAW');
}

async function dismissWatchlistAlerts(w) {
  const met = activeAlerts(w).map((r) => r.rule);
  w.alerts.dismissed = [...new Set([...w.alerts.dismissed, ...met])];
  try {
    await writeWatchlistAlerts(w);
  } catch (err) {
    setMarketStatus('watchlist-status', `Couldn't save the dismissal: ${err.message}`);
  }
  renderWatchlist();
  updateWatchlistAlertBadges();
}

// The red badge for Watch List and Market: first met rule, "+N" for the rest.
function watchlistAlertBadge() {
  const lines = [];
  let first = null;
  allWatchlist.forEach((w) => activeAlerts(w).forEach((r) => {
    if (!first) first = `${w.symbol}${r.label}`;
    lines.push(alertText(w, r));
  }));
  if (!first) return null;
  return { text: lines.length > 1 ? `${first} +${lines.length - 1}` : first, title: lines.join('\n') };
}

function updateWatchlistAlertBadges() {
  setPageBadge('finance', 'watchlist', watchlistAlertBadge());
  updateAnalysisAgeBadge();
}

// Rules from outside the form (the AI's suggestion); writes F1's header the first time.
async function saveWatchlistAlerts(w, alerts) {
  const next = parseAlerts(alerts);
  if (next && !allWatchlist.some((x) => x.alerts)) {
    await updateValues(`'${CONFIG.SHEETS.WATCHLIST}'!F1`, [['Alerts']], 'RAW');
  }
  w.alerts = next;
  await writeWatchlistAlerts(w);
  alertResults.delete(w.symbol);
  await checkWatchlistAlerts();
}

// The form's hint: the stock's current levels, from saved prices.
async function showWatchlistAlertLevels(symbol) {
  const hint = document.getElementById('watchlist-alert-levels');
  const base = "Alerts: a red badge on Watch List and Market when a rule is met on a day's close.";
  hint.textContent = base;
  if (!symbol) return;
  try {
    const daily = marketBars.get(symbol) || await getDailyBars(symbol, { maxAgeMs: Infinity });
    const monthly = daily.partial && daily.bars.length < 200 ? await getMonthlyBars(symbol).catch(() => null) : null;
    const r = checkAlerts({ belowAvg: true, belowStop: true }, daily.bars, monthly, getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT));
    if (r.length < 2 || normalizeSymbol(document.getElementById('watchlist-symbol').value) !== symbol) return;
    const cur = daily.currency || symbolCurrency(symbol);
    const money = (v) => (v === null ? 'n/a' : formatMoney(v, cur, { mask: false }));
    const [avg, stop] = r;
    hint.textContent = `${base} Now (${avg.date}): close ${money(avg.close)} · trailing stop ${money(stop.level)} · ${avg.basis} ${money(avg.level)}.`;
  } catch { /* no saved prices yet */ }
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
  const a = entry?.alerts;
  document.getElementById('watchlist-alert-below').value = a?.below ?? '';
  document.getElementById('watchlist-alert-above').value = a?.above ?? '';
  document.getElementById('watchlist-alert-below-avg').checked = !!a?.belowAvg;
  document.getElementById('watchlist-alert-above-avg').checked = !!a?.aboveAvg;
  document.getElementById('watchlist-alert-below-stop').checked = !!a?.belowStop;
  showWatchlistAlertLevels(entry?.symbol || null);
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
  const price = (id) => {
    const v = document.getElementById(id).value.trim();
    return v === '' ? null : Number(v);
  };
  const below = price('watchlist-alert-below');
  const above = price('watchlist-alert-above');
  if ([below, above].some((v) => v !== null && !(v > 0))) {
    showFieldError('watchlist-form-error', 'Alert prices must be above 0.');
    return;
  }
  // A new price already met on the latest close would show at once, so it can't warn of anything.
  const lastClose = marketBars.get(symbol)?.bars?.at(-1)?.c;
  const before = allWatchlist.find((w) => w.row === editingWatchlistRow)?.alerts;
  if (Number.isFinite(lastClose) && below !== null && below !== before?.below && below >= lastClose) {
    showFieldError('watchlist-form-error', `"Close below" must be under the latest close (${lastClose.toFixed(2)}).`);
    return;
  }
  if (Number.isFinite(lastClose) && above !== null && above !== before?.above && above <= lastClose) {
    showFieldError('watchlist-form-error', `"Close above" must be over the latest close (${lastClose.toFixed(2)}).`);
    return;
  }
  const previous = allWatchlist.find((w) => w.row === editingWatchlistRow)?.alerts;
  const alerts = {
    below,
    above,
    belowAvg: document.getElementById('watchlist-alert-below-avg').checked,
    aboveAvg: document.getElementById('watchlist-alert-above-avg').checked,
    belowStop: document.getElementById('watchlist-alert-below-stop').checked,
  };
  // A dismissal survives a save only for a rule left unchanged.
  alerts.dismissed = previous ? previous.dismissed.filter((r) => previous[r] === alerts[r]) : [];
  const values = [
    symbol,
    document.getElementById('watchlist-name').value.trim(),
    document.getElementById('watchlist-exchange').value.trim(),
    isCanadianSymbol(symbol) ? 'CAD' : document.getElementById('watchlist-currency').value,
    document.getElementById('watchlist-notes').value.trim(),
    alertsCell(alerts),
  ];
  try {
    watchlistSheetId = await ensureSheetTab(CONFIG.SHEETS.WATCHLIST, WATCHLIST_HEADERS);
    if (hasAlertRules(alerts) && !allWatchlist.some((w) => w.alerts)) {
      await updateValues(`'${CONFIG.SHEETS.WATCHLIST}'!F1`, [['Alerts']], 'RAW');
    }
    const editingRow = editingWatchlistRow;
    if (editingRow) await updateValues(`'${CONFIG.SHEETS.WATCHLIST}'!A${editingRow}:F${editingRow}`, [values], 'RAW');
    else await appendValues(WATCHLIST_RANGE(), [values], 'RAW');
    alertResults.delete(symbol);
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
    updateWatchlistAlertBadges();
    showUndoToast(`${entry.symbol} removed.`, async () => {
      await appendValues(WATCHLIST_RANGE(), [[entry.symbol, entry.name, entry.exchange, entry.currency, entry.notes, alertsCell(entry.alerts)]], 'RAW');
      await refreshWatchlist();
      checkWatchlistAlerts();
    });
  }, "Couldn't remove the stock");
}
