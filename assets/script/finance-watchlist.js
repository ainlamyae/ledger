// Watch List page: the Watchlist tab and each stock's latest moves. Prices load
// when this page opens (registerPageShow), not with Finance; 🔬 opens Market.
// Alerts (column F, JSON) are checked on every Finance load for alerted stocks only.

const WATCHLIST_HEADERS = ['Symbol', 'Name', 'Exchange', 'Currency', 'Notes', 'Alerts'];
const watchlistSheetRange = (cells) => sheetRange(CONFIG.SHEETS.WATCHLIST, cells);
const WATCHLIST_RANGE = () => watchlistSheetRange('A2:F');
const ALERT_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const ALERT_SMA_DAYS = 200; // fewer daily bars than this: the average needs monthly bars
const SYMBOL_SEARCH_DELAY_MS = 500;
const SYMBOL_SEARCH_MIN_CHARS = 2;
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

function watchlistField(name) {
  return document.getElementById(`watchlist-${name}`);
}

async function ensureWatchlistTab() {
  watchlistSheetId = await ensureSheetTab(CONFIG.SHEETS.WATCHLIST, WATCHLIST_HEADERS);
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
  watchlistField('symbol').addEventListener('input', debounceSymbolSearch);
  watchlistField('symbol').addEventListener('change', fillWatchlistFromSearch);
  registerPageShow('watchlist', loadWatchlistPrices);
}

async function refreshWatchlist() {
  // The id is re-read each time, as the spreadsheet may have been switched.
  const tab = (await getSpreadsheetMetadata()).sheets.find((s) => s.properties.title === CONFIG.SHEETS.WATCHLIST);
  watchlistSheetId = tab ? tab.properties.sheetId : null;
  if (!tab) {
    allWatchlist = [];
  } else {
    const resp = await getValues(WATCHLIST_RANGE(), VALUE_PARAMS);
    allWatchlist = (resp.values || []).map((row, i) => ({
      row: i + 2,
      symbol: cellText(row[0]).trim().toUpperCase(),
      name: cellText(row[1]),
      exchange: cellText(row[2]),
      currency: cellText(row[3]) || symbolCurrency(cellText(row[0])),
      notes: cellText(row[4]),
      alerts: parseAlerts(row[5]),
    })).filter((w) => w.symbol);
  }
  renderWatchlist();
  syncAnalysisSymbolOptions();
}

// Columns A–F of one entry.
function watchlistRowValues(w) {
  return [w.symbol, w.name, w.exchange, w.currency, w.notes, alertsCell(w.alerts)];
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
    // 1d, ~1m (21 trading days), ~1y (252).
    const changes = [1, 21, 252].map((back) => {
      const td = document.createElement('td');
      setPercentCell(td, barChange(bars, back));
      return td;
    });
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
    tr.append(makeCell(w.symbol), makeCell(w.name, w.notes || w.name), close, ...changes, alertCell(w), actions);
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
  const average = `the ${r.basis || 'long-term average'} `;
  const name = { below: '', above: '', belowAvg: average, aboveAvg: average, belowStop: 'the trailing stop ' }[r.rule];
  const side = r.rule.startsWith('above') ? 'above' : 'below';
  if (r.met === null) return `${w.symbol}: close ${side} ${name.trim() || 'the level'} — needs more price history`;
  return `${w.symbol}: close ${money(r.close)} ${r.met ? 'is' : 'is not'} ${side} ${name}${money(r.level)} (${shortYearDate(r.date)})`;
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

// Short (TSX) daily history: the long average needs month-end bars.
function needsMonthlyBars(daily) {
  return daily.partial && daily.bars.length < ALERT_SMA_DAYS;
}

function alertAtrMult() {
  return getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT);
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
      const needsMonthly = (w.alerts.belowAvg || w.alerts.aboveAvg) && needsMonthlyBars(daily);
      const monthly = needsMonthly ? await getMonthlyBars(w.symbol).catch(() => null) : null;
      alertResults.set(w.symbol, checkAlerts(w.alerts, daily.bars, monthly, alertAtrMult()));
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
    await writeWatchlistAlerts(w, true).catch((err) => {
      setMarketStatus('watchlist-status', `Couldn't re-arm ${w.symbol}'s dismissed alert: ${err.message}`);
    });
  }
}

// `relocate`: a background write finds the row by symbol first, as a delete since the
// last read shifts rows; a stock no longer listed is skipped.
async function writeWatchlistAlerts(w, relocate = false) {
  let row = w.row;
  if (relocate) {
    const resp = await getValues(WATCHLIST_RANGE(), VALUE_PARAMS);
    const i = (resp.values || []).findIndex((r) => cellText(r[0]).trim().toUpperCase() === w.symbol);
    if (i === -1) return;
    row = i + 2;
  }
  await updateValues(watchlistSheetRange(`F${row}`), [[alertsCell(w.alerts)]], 'RAW');
}

// Column F's header goes in with the first stock that has rules.
function isFirstAlerted(alerts) {
  return hasAlertRules(alerts) && !allWatchlist.some((w) => w.alerts);
}

function writeAlertsHeader() {
  return updateValues(watchlistSheetRange('F1'), [['Alerts']], 'RAW');
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

// Rules from outside the form (the AI's suggestion).
async function saveWatchlistAlerts(w, alerts) {
  const next = parseAlerts(alerts);
  if (isFirstAlerted(next)) await writeAlertsHeader();
  w.alerts = next;
  await writeWatchlistAlerts(w);
  alertResults.delete(w.symbol);
  await checkWatchlistAlerts();
}

// The form's hint: the stock's current levels, from saved prices.
async function showWatchlistAlertLevels(symbol) {
  const hint = watchlistField('alert-levels');
  const base = "Alerts: a red badge on Watch List and Market when a rule is met on a day's close.";
  hint.textContent = base;
  if (!symbol) return;
  try {
    const daily = marketBars.get(symbol) || await getDailyBars(symbol, { maxAgeMs: Infinity });
    const monthly = needsMonthlyBars(daily) ? await getMonthlyBars(symbol).catch(() => null) : null;
    const r = checkAlerts({ belowAvg: true, belowStop: true }, daily.bars, monthly, alertAtrMult());
    if (r.length < 2 || normalizeSymbol(watchlistField('symbol').value) !== symbol) return;
    const cur = daily.currency || symbolCurrency(symbol);
    const money = (v) => (v === null ? 'n/a' : formatMoney(v, cur, { mask: false }));
    const [avg, stop] = r;
    hint.textContent = `${base} Now (${shortYearDate(avg.date)}): close ${money(avg.close)} · trailing stop ${money(stop.level)} · ${avg.basis} ${money(avg.level)}.`;
  } catch { /* no saved prices yet */ }
}

// --- Watchlist form ---------------------------------------------------------

let symbolSearchTimer = null;
let lastSymbolResults = [];

function debounceSymbolSearch() {
  clearTimeout(symbolSearchTimer);
  const query = watchlistField('symbol').value.trim();
  if (query.length < SYMBOL_SEARCH_MIN_CHARS) return;
  symbolSearchTimer = setTimeout(async () => {
    try {
      lastSymbolResults = await searchSymbols(query);
      const list = watchlistField('symbol-options');
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
  }, SYMBOL_SEARCH_DELAY_MS);
}

function fillWatchlistFromSearch() {
  const symbol = normalizeSymbol(watchlistField('symbol').value);
  const hit = lastSymbolResults.find((r) => r.symbol === symbol);
  watchlistField('currency').value = hit?.currency === 'CAD' || isCanadianSymbol(symbol) ? 'CAD' : 'USD';
  if (!hit) return;
  const name = watchlistField('name');
  if (!name.value) name.value = hit.name;
  watchlistField('exchange').value = hit.exchange;
}

function openWatchlistForm(entry = null) {
  editingWatchlistRow = entry?.row ?? null;
  ['symbol', 'name', 'exchange'].forEach((key) => { watchlistField(key).value = entry?.[key] || ''; });
  watchlistField('currency').value = entry?.currency || 'USD';
  watchlistField('notes').value = entry?.notes || '';
  const a = entry?.alerts;
  watchlistField('alert-below').value = a?.below ?? '';
  watchlistField('alert-above').value = a?.above ?? '';
  watchlistField('alert-below-avg').checked = !!a?.belowAvg;
  watchlistField('alert-above-avg').checked = !!a?.aboveAvg;
  watchlistField('alert-below-stop').checked = !!a?.belowStop;
  showWatchlistAlertLevels(entry?.symbol || null);
  clearFieldError('watchlist-form-error');
  watchlistField('modal').hidden = false;
}

function closeWatchlistForm() {
  watchlistField('modal').hidden = true;
  editingWatchlistRow = null;
}

async function submitWatchlistForm() {
  const fail = (message) => showFieldError('watchlist-form-error', message);
  const symbol = normalizeSymbol(watchlistField('symbol').value);
  if (!/^[A-Z0-9.\-^=/]{1,15}$/.test(symbol)) return fail('Enter a symbol, e.g. AAPL, SHOP.TO or TSE: AC.');
  if (allWatchlist.some((w) => w.symbol === symbol && w.row !== editingWatchlistRow)) {
    return fail(`${symbol} is already on the watchlist.`);
  }
  const price = (id) => {
    const v = watchlistField(id).value.trim();
    return v === '' ? null : Number(v);
  };
  const below = price('alert-below');
  const above = price('alert-above');
  if ([below, above].some((v) => v !== null && !(v > 0))) return fail('Alert prices must be above 0.');
  // A new price already met on the latest close would show at once, so it can't warn of anything.
  const lastClose = marketBars.get(symbol)?.bars?.at(-1)?.c;
  const previous = allWatchlist.find((w) => w.row === editingWatchlistRow)?.alerts;
  if (Number.isFinite(lastClose) && below !== null && below !== previous?.below && below >= lastClose) {
    return fail(`"Close below" must be under the latest close (${lastClose.toFixed(2)}).`);
  }
  if (Number.isFinite(lastClose) && above !== null && above !== previous?.above && above <= lastClose) {
    return fail(`"Close above" must be over the latest close (${lastClose.toFixed(2)}).`);
  }
  const alerts = {
    below,
    above,
    belowAvg: watchlistField('alert-below-avg').checked,
    aboveAvg: watchlistField('alert-above-avg').checked,
    belowStop: watchlistField('alert-below-stop').checked,
  };
  // A dismissal survives a save only for a rule left unchanged.
  alerts.dismissed = previous ? previous.dismissed.filter((r) => previous[r] === alerts[r]) : [];
  const values = watchlistRowValues({
    symbol,
    name: watchlistField('name').value.trim(),
    exchange: watchlistField('exchange').value.trim(),
    currency: isCanadianSymbol(symbol) ? 'CAD' : watchlistField('currency').value,
    notes: watchlistField('notes').value.trim(),
    alerts,
  });
  try {
    await ensureWatchlistTab();
    if (isFirstAlerted(alerts)) await writeAlertsHeader();
    const editingRow = editingWatchlistRow;
    if (editingRow) await updateValues(watchlistSheetRange(`A${editingRow}:F${editingRow}`), [values], 'RAW');
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
    if (watchlistSheetId === null) await ensureWatchlistTab();
    await batchUpdate([sheetRowDeleteRequest(watchlistSheetId, entry.row)]);
    await refreshWatchlist();
    updateWatchlistAlertBadges();
    showUndoToast(`${entry.symbol} removed.`, async () => {
      try {
        await appendValues(WATCHLIST_RANGE(), [watchlistRowValues(entry)], 'RAW');
        await refreshWatchlist();
        checkWatchlistAlerts();
      } catch (err) {
        alert(`Failed to restore: ${err.message}`);
      }
    });
  }, "Couldn't remove the stock");
}
