// To ZZ: past ~21 categories Statement's Saved/Cumulative columns pass Z.
const REPORT_RANGE = sheetRange(CONFIG.SHEETS.REPORT, 'A1:ZZ149');
const BALANCE_RANGE = sheetRange(CONFIG.SHEETS.BALANCE, 'A1:D1');
const REPORT_TRANSACTIONS_RANGE = sheetRange(CONFIG.SHEETS.TRANSACTIONS, 'A2:F');
// Breakdown's Category and Type names only; the amounts come from Transaction.
const REPORT_TYPE_NAMES_RANGE = sheetRange(CONFIG.SHEETS.INSIGHT, 'A2:B');
const SETTINGS_RANGE = sheetRange(CONFIG.SHEETS.SETTINGS, 'A2:C');

const CURRENCY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Wide enough for the sidebar to hold the settings switches.
const SIDEBAR_MEDIA_QUERY = '(min-width: 1180px)';

// The switches' last values (0/1), so they work before sign-in; Settings replaces
// them on load. index.html's head reads this key before first paint.
const SWITCHES_KEY = 'ledger_switches';

function readCachedSwitches() {
  try {
    return JSON.parse(localStorage.getItem(SWITCHES_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function cacheSwitches() {
  try {
    localStorage.setItem(SWITCHES_KEY, JSON.stringify(
      Object.fromEntries(VISIBILITY_SWITCHES.map((s) => [s.key, s.isOn() ? 1 : 0]))
    ));
  } catch {}
}

// Best-effort save to Settings; signed out it stays in this browser.
function saveSwitchSetting(values) {
  cacheSwitches();
  if (!isSignedIn() || !getActiveSpreadsheetId()) return;
  saveSettingValues(values).catch((err) => {
    console.error(`Failed to save ${Object.keys(values).join(', ')} setting:`, err);
  });
}

// Amounts show unless SHOW_AMOUNTS is 0; widgets and bulbs start off until set to 1.
let privacyMode;
let widgetsVisible;
let bulbsVisible;
{
  const cached = readCachedSwitches();
  privacyMode = cached.SHOW_AMOUNTS === 0;
  widgetsVisible = cached.SHOW_WIDGETS === 1;
  bulbsVisible = cached.SHOW_BULBS === 1;
}

// Keeps the symbol, sign and separators: "$1,234.56" -> "$*,***.**".
function maskDigits(str) {
  return String(str).replace(/[0-9]/g, '*');
}

// For free text, where masking digits alone would leave every word readable.
function maskText(str) {
  return String(str).replace(/\S/g, '*');
}

function formatCurrency(value) {
  const formatted = CURRENCY_FORMAT.format(value);
  return privacyMode ? maskDigits(formatted) : formatted;
}

// A stock's own currency: "$1,234.56" for CAD, "US$1,234.56" for USD.
const MONEY_FORMATS = new Map();

function formatMoney(value, currency = 'CAD', { mask = true } = {}) {
  if (!MONEY_FORMATS.has(currency)) {
    MONEY_FORMATS.set(currency, new Intl.NumberFormat('en-CA', { style: 'currency', currency }));
  }
  const formatted = MONEY_FORMATS.get(currency).format(value);
  return mask && privacyMode ? maskDigits(formatted) : formatted;
}

// A table's "no rows to show" row, so an empty table isn't just blank.
function renderEmptyRow(colspan, message) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colspan;
  td.className = 'empty-state';
  td.textContent = message;
  tr.appendChild(td);
  return tr;
}

const UNDO_TOAST_MS = 6000;
const TOAST_BASE_MS = 2000;
const TOAST_MS_PER_CHAR = 50;
const TOAST_MIN_MS = 3000;
const ERROR_TOAST_MIN_MS = 6000;
const TOAST_MAX_MS = 12000;

let undoToastTimer = null;

// A new toast clears the old timer so it can't dismiss the new one early.
function showUndoToast(message, onUndo, error = false) {
  clearTimeout(undoToastTimer);

  const toast = document.getElementById('undo-toast');
  toast.classList.toggle('toast-error', error);
  document.getElementById('undo-toast-message').textContent = message;

  // A fresh button drops the previous toast's Undo listener.
  const oldBtn = document.getElementById('undo-toast-btn');
  const btn = oldBtn.cloneNode(true);
  oldBtn.replaceWith(btn);
  btn.hidden = !onUndo;
  btn.addEventListener('click', () => {
    clearTimeout(undoToastTimer);
    toast.hidden = true;
    onUndo();
  });

  toast.hidden = false;
  // Longer messages stay longer: 3s to 12s without Undo, errors 6s or more.
  const minMs = error ? ERROR_TOAST_MIN_MS : TOAST_MIN_MS;
  const ms = onUndo
    ? UNDO_TOAST_MS
    : Math.min(Math.max(TOAST_BASE_MS + message.length * TOAST_MS_PER_CHAR, minMs), TOAST_MAX_MS);
  undoToastTimer = setTimeout(() => { toast.hidden = true; }, ms);
}

// The same box with no Undo: results, progress and (red) errors.
function showToast(message, error = false) {
  showUndoToast(message, null, error);
}

let currentReport = null;

// The Account tab's D1 holds the pre-computed net worth total.
function parseBalance(balanceRows) {
  return balanceRows[0]?.[3] || 0;
}

const SHORTCUT_MODAL_IDS = ['tx-modal', 'tx-bulk-edit-modal', 'account-modal', 'breakdown-modal', 'work-time-modal', 'nutrition-modal', 'shortcuts-modal'];

function toggleShortcutsHelp() {
  const modal = document.getElementById('shortcuts-modal');
  modal.hidden = !modal.hidden;
}

function getOpenModal() {
  return SHORTCUT_MODAL_IDS.map((id) => document.getElementById(id)).find((m) => m && !m.hidden);
}

function focusableElements(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.offsetParent !== null);
}

// Watches each modal's `hidden` so focus returns to whatever opened it on
// close. Focus is left alone on open: focusing a field pops the mobile
// keyboard or a native picker.
function setupModalFocusManagement() {
  SHORTCUT_MODAL_IDS.forEach((id) => {
    const modal = document.getElementById(id);
    if (!modal) return;

    let lastFocused = null;
    new MutationObserver(() => {
      if (!modal.hidden) {
        lastFocused = document.activeElement;
        document.body.classList.add('modal-open');
      } else {
        if (lastFocused) {
          lastFocused.focus();
          lastFocused = null;
        }
        if (!getOpenModal()) document.body.classList.remove('modal-open');
      }
    }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  });
}

// Escape works even inside a field; the single-letter shortcuts don't fire
// while focus is in something that takes typing.
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModal = getOpenModal();
      if (openModal) openModal.hidden = true;
      return;
    }

    // Keep Tab/Shift+Tab inside the open modal.
    if (e.key === 'Tab') {
      const openModal = getOpenModal();
      if (!openModal) return;
      const focusable = focusableElements(openModal);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    const focused = document.activeElement;
    const isTyping = focused && (['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName) || focused.isContentEditable);
    if (isTyping) return;

    // Both work from any page: in place on Finance, elsewhere by going to the
    // Transaction page or its Log form.
    const txPanel = document.querySelector('#finance > .panel[data-route="transaction"]');
    const onFinance = !window.ledgerSectionPage || window.ledgerSectionPage.section === 'finance';
    if (e.key === '/') {
      e.preventDefault();
      const search = document.getElementById('tx-payee-filter');
      if (search.offsetParent) search.focus();
      else if (window.ledgerSectionPage?.section === 'finance') {
        navigateSectionPage(txPanel);
        search.focus();
      } else location.href = routeUrl(txPanel);
    } else if (e.key === 'n') {
      // Via the button, so it passes the same auth gate a click does.
      if (onFinance) document.getElementById('add-transaction-btn').click();
      else location.href = routeUrl(txPanel, [{ slug: 'log' }]);
    } else if (e.key === '?') {
      toggleShortcutsHelp();
    }
  });

  document.getElementById('shortcuts-close-btn').addEventListener('click', toggleShortcutsHelp);
  setupModalFocusManagement();
}

// Chrome only lets a click ask for notifications, so the account menu offers it
// until it has been answered; Work Time's and Car Service's reminders then use it.
function setupNotificationsButton() {
  const btn = document.getElementById('notifications-btn');
  const sync = () => { btn.hidden = !('Notification' in window) || Notification.permission !== 'default'; };
  sync();
  btn.addEventListener('click', async () => {
    await Notification.requestPermission();
    sync();
  });
}

// The settings switches sit in the sidebar on a wide screen with it open, and
// in the account menu otherwise. page-nav.js's setSideNavOpen calls this too.
function placeSettingsSwitches() {
  const switches = document.getElementById('settings-switches');
  if (!switches) return;
  const inSidebar = window.matchMedia(SIDEBAR_MEDIA_QUERY).matches
    && document.documentElement.dataset.sideNav !== 'closed';
  if (inSidebar) {
    document.querySelector('.header-actions').prepend(switches);
  } else {
    document.querySelector('#account-menu-dropdown .account-menu-info').after(switches);
  }
}

function setupAccountMenu() {
  placeSettingsSwitches();
  window.matchMedia(SIDEBAR_MEDIA_QUERY).addEventListener('change', placeSettingsSwitches);

  const menu = document.getElementById('account-menu');
  const btn = document.getElementById('account-menu-btn');
  const dropdown = document.getElementById('account-menu-dropdown');

  const closeMenu = () => {
    dropdown.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  // A menu item closes the menu, then does its job.
  const onMenuItem = (id, action) => {
    document.getElementById(id).addEventListener('click', () => {
      closeMenu();
      action();
    });
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.hidden;
    dropdown.hidden = isOpen;
    btn.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  // Sign-out itself is bootDashboard's listener.
  onMenuItem('signout-btn', () => {});
  onMenuItem('refresh-btn', () => loadDashboard(true));
  onMenuItem('clear-cache-btn', clearCacheAndReload);
  onMenuItem('open-sheet-btn', () => {
    window.open(`https://docs.google.com/spreadsheets/d/${getActiveSpreadsheetId()}/edit`, '_blank');
  });

  onMenuItem('switch-sheet-btn', async () => {
    try {
      await pickAndLoadSpreadsheet();
    } catch (err) {
      if (err.message !== 'cancelled') alert(`Couldn't switch spreadsheet: ${err.message}`);
    }
  });

  onMenuItem('rename-sheet-btn', async () => {
    try {
      const currentName = await getActiveSpreadsheetName();
      const newName = prompt('Rename your Ledger spreadsheet', currentName);
      if (!newName || newName === currentName) return;
      await renameActiveSpreadsheet(newName);
    } catch (err) {
      alert(`Couldn't rename the spreadsheet: ${err.message}`);
    }
  });
}

async function loadReport() {
  const { valueRanges } = await batchGetValues(
    [REPORT_RANGE, BALANCE_RANGE, REPORT_TRANSACTIONS_RANGE, REPORT_TYPE_NAMES_RANGE],
    VALUE_PARAMS
  );
  const [reportRows, balanceRows, transactionRows, typeNameRows] = valueRanges.map((r) => r.values || []);

  // Row 1 names the columns: Income, Expenses, one per category, Saved, Cumulative.
  const monthlyHeader = reportRows[0] || [];
  const monthlyRows = reportRows.slice(1);

  // Saved is second-last; the API trims rows, so the widest row gives the width.
  const dataWidth = monthlyRows.reduce((max, row) => Math.max(max, row.length), 0);
  const savedIndex = dataWidth - 2;

  // The latest month with any income or expenses.
  const lastActive = monthlyRows.findLastIndex((row) => row[1] || row[2]);
  const activeIndex = lastActive === -1 ? monthlyRows.length - 1 : lastActive;
  const current = monthlyRows[activeIndex];

  // Spending categories: the columns between Expenses (C) and Saved.
  const categoryNames = monthlyHeader
    .slice(3, Math.max(3, savedIndex))
    .map((name) => cellText(name).trim())
    .filter(Boolean);

  const charts = buildFinanceChartData(transactionRows, typeNameRows, categoryNames);
  const netWorth = parseBalance(balanceRows);

  return {
    income: current[1] || 0,
    expenses: current[2] || 0,
    saved: current[savedIndex] || 0,
    quarterAverage: quarterAverages(monthlyRows, activeIndex),
    ...charts,
    netWorth,
    // Non-zero means a wrong balance or a missing transaction.
    missingAmount: Math.round((netWorth - charts.transactionTotal) * 100) / 100,
  };
}

let currentSettings = {};

// Last good Settings read, so a failed refresh doesn't wipe it.
let lastLoadedSettings = null;

// The Settings tab is optional, so a failure never fails the dashboard. A failed
// read keeps the last good copy rather than wiping every setting in memory.
async function loadSettings() {
  try {
    const resp = await getValues(SETTINGS_RANGE, VALUE_PARAMS);
    lastLoadedSettings = parseSettings(resp.values || []);
    return lastLoadedSettings;
  } catch (err) {
    console.error(`Failed to read the "${CONFIG.SHEETS.SETTINGS}" tab — keeping the previously loaded settings:`, err);
    return lastLoadedSettings ?? {};
  }
}

// Column A is the key, B its value; C (Notes) is never read. A later duplicate wins.
function parseSettings(settingsRows) {
  const settings = {};
  settingsRows.forEach((row) => { if (row[0]) settings[row[0]] = row[1]; });
  return settings;
}

// A numeric setting, or `fallback` if it's missing, blank or not a number.
function getSetting(key, fallback) {
  const raw = currentSettings[key];
  const num = Number(raw);
  return raw !== undefined && raw !== '' && !Number.isNaN(num) ? num : fallback;
}

// Same as getSetting(), but for non-numeric values (e.g. BIRTH_DATE).
function getSettingString(key, fallback) {
  const raw = currentSettings[key];
  return raw !== undefined && raw !== '' ? raw : fallback;
}

// First of `keys` that's set: a renamed setting's current name, then its old ones.
function getSettingStringAny(keys, fallback) {
  for (const key of keys) {
    const value = getSettingString(key, null);
    if (value !== null) return value;
  }
  return fallback;
}

// Monthly income and expenses over up to three months BEFORE the active one,
// so a part-way month isn't its own benchmark; null in the first month.
function quarterAverages(monthlyRows, activeIndex) {
  const prior = monthlyRows.slice(Math.max(0, activeIndex - 3), activeIndex);
  if (prior.length === 0) return null;

  const mean = (col) => prior.reduce((sum, row) => sum + (Number(row[col]) || 0), 0) / prior.length;
  return { income: mean(1), expenses: mean(2), months: prior.length };
}

function renderSummaryCards(data) {
  const avg = data.quarterAverage;
  const priorMonths = avg ? `previous ${avg.months} month${avg.months === 1 ? '' : 's'}` : null;

  document.getElementById('net-worth').textContent = formatCurrency(data.netWorth);

  // The month's own figure; its average is only in the hover, since lumpy
  // income makes an ordinary month read as a shortfall against it.
  const renderMonthCard = (labelId, label, valueId, key) => {
    document.getElementById(labelId).textContent = label;
    const el = document.getElementById(valueId);
    el.textContent = formatCurrency(data[key]);
    el.title = avg
      ? `This month. Average of the ${priorMonths}: ${formatCurrency(avg[key])}`
      : 'This month — no earlier months to average yet';
  };
  renderMonthCard('income-label', 'Monthly Income', 'income-value', 'income');
  renderMonthCard('expenses-label', 'Monthly Expenditure', 'expenses-value', 'expenses');

  document.getElementById('cashflow-label').textContent = 'Monthly Cash Flow';
  const savingsEl = document.getElementById('savings-value');
  savingsEl.textContent = formatCurrency(data.saved);
  savingsEl.classList.toggle('income', data.saved >= 0);
  savingsEl.classList.toggle('expense', data.saved < 0);
}

// Under half a cent counts as reconciled.
const RECONCILED_EPSILON = 0.005;

function renderReconciliationStatus(missingAmount) {
  const gap = Math.abs(missingAmount);
  const above = missingAmount > 0;

  // A>T: accounts above the transactions' total; A<T: below.
  setAccountBadgePart('reconcile', gap < RECONCILED_EPSILON ? null : {
    // Whole dollars rounded up (a few cents still show $1); the exact figure in its hover.
    text: `A${above ? '>' : '<'}T ${formatCurrency(Math.ceil(gap)).replace(/\.00$/, '')}`,
    title: `Accounts ${above ? 'above' : 'below'} the transactions by ${formatCurrency(gap)}`,
  });
}

async function refreshNetWorth() {
  const resp = await getValues(BALANCE_RANGE, VALUE_PARAMS);
  const netWorth = parseBalance(resp.values || []);
  if (currentReport) currentReport.netWorth = netWorth;
  document.getElementById('net-worth').textContent = formatCurrency(netWorth);
}

function clearDashboardError() {
  document.getElementById('dashboard-error')?.remove();
}

function showDashboardError(message) {
  clearDashboardError();

  const dashboard = document.getElementById('dashboard');
  const banner = document.createElement('div');
  banner.id = 'dashboard-error';
  banner.className = 'status error-banner';

  const text = document.createElement('span');
  text.textContent = `Failed to load data: ${message}`;

  const retryBtn = document.createElement('button');
  retryBtn.className = 'btn';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', () => loadDashboard(true));

  banner.append(text, retryBtn);
  dashboard.prepend(banner);
}

function setLastUpdated() {
  document.getElementById('last-updated').textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour12: false })}`;
}

async function loadDashboard(forceRefresh = false) {
  clearDashboardError();
  // Refresh re-reads everything, the tab list included (sheets.js shares one per load).
  if (forceRefresh) resetSheetReads();
  const requestsBefore = sheetsRequestCount;
  // When this load's data reading started, after the page and sign-in were ready.
  const dataStart = performance.now();

  // Wrapped whole: no caller catches, so a throw would leave placeholders up silently.
  try {
    // Never throws; only what reads currentSettings waits on it.
    const settingsPromise = loadSettings().then((settings) => {
      currentSettings = settings;
      // Each switch is on unless its setting is 0.
      VISIBILITY_SWITCHES.forEach((s) => {
        s.set(getSetting(s.key, 1) !== 0);
        syncSwitch(s);
        s.apply?.();
      });
      cacheSwitches();
      applySettingsToWidgets();
      renderInsightAgeBadges();
    });

    // Blocks load only on a section page; home reads just what its glance cards
    // and tile badges need.
    const loadBlocks = Boolean(window.ledgerSectionPage);
    const section = window.ledgerSectionPage?.section ?? null;
    const home = section === null;
    const shows = (id) => loadBlocks && (home || section === id);
    const needsHealth = home || section === 'health';
    const needsReport = home || section === 'finance';
    const done = Promise.resolve();

    // Activities lands BEFORE Physique, which memoizes each workout's category
    // from it. allSettled: a bad Activities tab costs that split, not Physique.
    const activitiesPromise = needsHealth ? initActivities(forceRefresh) : done;
    const physiquePromise = needsHealth
      ? Promise.allSettled([settingsPromise, activitiesPromise]).then(() => initPhysique(forceRefresh))
      : done;
    const reportPromise = needsReport ? loadReport().then((report) => {
      currentReport = report;
      renderSummaryCards(report);
      renderSpendingTrendChart(report.categoryComparison, report.lifelongMonths);
      renderSpendingBreakdownCharts(report.categoryComparison);
      renderTypeBreakdownCharts(report.typeBreakdown);
      renderFinanceTrendCharts(report);
      renderFinanceGlanceNetWorthChart(report.netWorthDays);
      renderReconciliationStatus(report.missingAmount);
    }) : done;

    const nutritionPromise = shows('health') ? initNutrition(forceRefresh) : done;
    const detailPromises = [
      ...(shows('health') ? [
        nutritionPromise,
        // Once, if missing: the glycogen swing as a saved setting from now on.
        physiquePromise.then(() => seedGlycogenSwingSetting()).catch((err) => console.error('Saving GLYCOGEN_SWING_KG failed:', err)),
        // Protein Rotation needs Physique (servings), Nutrition (per serving) and settings.
        Promise.all([physiquePromise, nutritionPromise]).then(() => {
          renderProteinRotationChart(healthDateRange());
          renderProteinRotationChart(healthDateRange(), 'nutrition', PROTEIN_ROTATION_NUTRITION_IDS);
          // Needs both tabs: the grams come from each food's Nutrition row.
          convertPhysiqueBreakdownAmountsToGrams().then(fillPhysiqueMissingTef);
        }),
        // Activity Rotation needs Physique (Workout notes) and Activities (Group, Weekly Desired).
        Promise.all([physiquePromise, activitiesPromise]).then(() => {
          renderActivityRotationChart(healthDateRange());
          // The GYM and Activity modals' copies rendered at boot, before this data.
          renderActivityRotationChart(healthDateRange(), 'gym', ACTIVITY_ROTATION_GYM_IDS);
          renderActivityRotationChart(healthDateRange(), 'activity', ACTIVITY_ROTATION_ACTIVITY_IDS);
          renderActivityPlanTables();
          renderInstructionList();
        }),
      ] : []),
      // Car Service (Track) is drawn from Transactions; home reads it for its tile badge.
      ...((shows('finance') || shows('track') || home) ? [initTransactions(forceRefresh)] : []),
      // Work Time and LeetCode (solves-owed) for their tile badges.
      ...(home && !shows('track') ? [initWorkTime(forceRefresh), initLeetcode()] : []),
      // Accounts for the Account tile's Pay badge.
      ...(home && !shows('finance') ? [initAccountManager(forceRefresh)] : []),
      // Watchlist alerts badge the Watch List and Market tiles; the price check
      // runs in the background once the keys (settings) are in.
      ...((shows('finance') || home) ? [initWatchlist(forceRefresh).then(() => {
        settingsPromise.then(() => checkWatchlistAlerts()).catch(() => {});
        return initStockAnalysisLog();
      })] : []),
      ...(shows('finance') ? [
        initAccountManager(forceRefresh),
        initBreakdown(forceRefresh),
        initTrades(forceRefresh),
      ] : []),
      ...(shows('track') ? [
        initWorkTime(forceRefresh),
        settingsPromise.then(() => initTravel(forceRefresh)),
        initApplications(forceRefresh),
        initLeetcode(),
        initContacts(forceRefresh),
      ] : []),
      // Other's Settings block (saving a setting from anywhere loads it on its own).
      ...(shows('other') ? [initSettingsPanel(forceRefresh)] : []),
    ];

    const results = await Promise.allSettled([
      settingsPromise,
      reportPromise,
      activitiesPromise,
      physiquePromise,
      ...detailPromises,
    ]);

    setLastUpdated();
    console.info(`[sheets] ${section || 'home'} load: ${sheetsRequestCount - requestsBefore} requests`);
    // Splits a slow sign-in from slow Sheets reads.
    console.info(`[load] ${section || 'home'}: page + sign-in ${Math.round(dataStart)} ms, data ${Math.round(performance.now() - dataStart)} ms, total ${Math.round(performance.now())} ms`);
    const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    if (errors.length) {
      console.error('Failed to load dashboard data:', errors);
      showDashboardError(errors.join('; '));
    }
  } catch (err) {
    console.error('Failed to load dashboard:', err);
    showDashboardError(err.message);
  }
  // A Tune opened before the data arrived was seeded from nothing; reseed it.
  if (!document.getElementById('health-tune-panel').classList.contains('collapsed')) openFormulaPlayground();
  routerDataLoaded();
}

// `inert`, not just the CSS collapse, so a folded panel's content also leaves
// the accessibility tree, tab order and find-in-page.
function setPanelCollapsed(panel, heading, collapsed) {
  panel.classList.toggle('collapsed', collapsed);
  heading.setAttribute('aria-expanded', String(!collapsed));
  [...panel.children].forEach((child) => {
    if (child === heading || child.classList.contains('panel-header')) return;
    if (collapsed) child.setAttribute('inert', '');
    else child.removeAttribute('inert');
  });
}

// Each panel's <h2> toggles its own content.
function setupPanelToggles() {
  const panels = [...document.querySelectorAll('#dashboard .panel')];

  panels.forEach((panel, i) => {
    const heading = panel.querySelector('h2');
    if (!heading) return;

    const icon = document.createElement('span');
    icon.className = 'panel-toggle-icon';
    icon.textContent = '▾';
    heading.prepend(icon);

    // Staggered fade/slide-in the first time the dashboard becomes visible.
    Motion.enterPanel(panel, i);

    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    setPanelCollapsed(panel, heading, true);

    // One block open at a time, so the address names the open one. On a section
    // page a block is a page of its own (page-nav.js), so its heading doesn't fold it.
    const toggle = () => {
      if (window.ledgerSectionPage) return;
      const expanding = panel.classList.contains('collapsed');
      if (expanding) {
        panels.forEach((other) => {
          const otherHeading = other.querySelector('h2');
          if (other !== panel && otherHeading && !other.classList.contains('collapsed')) {
            setPanelCollapsed(other, otherHeading, true);
          }
        });
      }
      setPanelCollapsed(panel, heading, !expanding);
      routerPanelToggled(panel);
    };

    heading.addEventListener('click', () => {
      // A click ending a text selection on the heading isn't a toggle.
      if (window.getSelection().toString()) return;
      toggle();
    });
    heading.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  toggle.checked = document.documentElement.dataset.theme === 'dark';

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('ledger_theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('ledger_theme');
    }

    applyChartTheme();

    if (!document.getElementById('dashboard').hidden) loadDashboard(false);
  });
}

// Mirrors the head script's pre-paint guess on <html>, so a stale cache corrects itself at once.
function setVisibilityPref(name, visible) {
  if (visible) {
    document.documentElement.removeAttribute(`data-${name}-pref`);
  } else {
    document.documentElement.setAttribute(`data-${name}-pref`, 'hidden');
  }
}

// The widget row. Section pages hide it themselves (section-page.js), whatever this says.
function applyWidgetsVisibility() {
  if (window.ledgerSectionPage) return;
  document.querySelectorAll('#dashboard .widget-cards').forEach((row) => {
    row.hidden = !widgetsVisible;
  });
  setVisibilityPref('widgets', widgetsVisible);
}

// Home page only; section pages keep their cards.
function applyBulbsVisibility() {
  if (window.ledgerSectionPage) return;
  setVisibilityPref('bulbs', bulbsVisible);
}

// The Amounts, Widgets and Bulbs switches, in this order everywhere (cache,
// Settings load, setup). `apply` shows the change; Amounts re-renders instead.
const VISIBILITY_SWITCHES = [
  { id: 'privacy-toggle', key: 'SHOW_AMOUNTS', isOn: () => !privacyMode, set: (on) => { privacyMode = !on; }, remasks: true },
  { id: 'widgets-toggle', key: 'SHOW_WIDGETS', isOn: () => widgetsVisible, set: (on) => { widgetsVisible = on; }, apply: applyWidgetsVisibility },
  { id: 'bulbs-toggle', key: 'SHOW_BULBS', isOn: () => bulbsVisible, set: (on) => { bulbsVisible = on; }, apply: applyBulbsVisibility },
];

function syncSwitch(s) {
  document.getElementById(s.id).checked = s.isOn();
}

function setupVisibilitySwitches() {
  VISIBILITY_SWITCHES.forEach((s) => {
    syncSwitch(s);
    document.getElementById(s.id).addEventListener('change', (e) => {
      s.set(e.target.checked);
      syncSwitch(s);
      s.apply?.();
      // Re-render masked or not; signed out there are no amounts yet.
      if (s.remasks && isSignedIn() && !document.getElementById('dashboard').hidden) loadDashboard(false);
      saveSwitchSetting({ [s.key]: s.isOn() ? 1 : 0 });
    });
  });
}

function setupScrollSpy() {
  const navLinks = [...document.querySelectorAll('#main-nav a[data-section]')];
  // The Ledger tab is current on the home page, a section's tab on its pages.
  document.querySelector('#main-nav .nav-home')?.classList.toggle('active', !window.ledgerSectionPage);

  const setActive = (id) => {
    navLinks.forEach((link) => link.classList.toggle('active', link.dataset.section === id));
  };

  // A section page has one section, so its tab simply stays active.
  const onlySection = document.documentElement.dataset.section;
  if (onlySection) {
    setActive(onlySection);
    return;
  }

  const sections = navLinks
    .map((link) => document.getElementById(link.dataset.section))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) setActive(entry.target.id);
    });
  }, { rootMargin: '-50% 0px -50% 0px' });

  sections.forEach((section) => observer.observe(section));

  // The widget row can keep the first section's midpoint below the centre
  // line near the top, so the observer never fires for it there.
  window.addEventListener('scroll', () => {
    if (window.scrollY < sections[0].offsetTop) setActive(navLinks[0].dataset.section);
  });
}

// Anything that opens a form or edits the sheet. Read-only actions are left
// out: a sign-in popup just to look something up would be worse.
const AUTH_GATED_SELECTOR = [
  '.panel-header-btn',            // every panel's Log / Add
  '.row-action-btn',              // ✏️ / 📋 / 🗑️ on every table row
  '#physique-bulk-calc-btn',
  '#nutrition-bulk-merge-btn',
  '#tx-bulk-edit-btn',
  '#tx-bulk-delete-btn',
  '#contacts-bulk-merge-btn',
  '#contacts-bulk-delete-btn',
  '#import-csv-btn',
  '#formula-save-btn',            // Tune's Save
  '#portfolio-write-mv-btn',
  '#analysis-generate-btn',       // saves its read to the Analysis tab
  '#analysis-apply-alerts-btn',   // writes the AI's alerts to the Watchlist tab
].join(', ');

// Reads but never writes: the Instruction modal is the Activities tab already in memory.
const AUTH_GATE_EXEMPT_IDS = ['activity-instruction-btn'];

// Gets a live token BEFORE a form opens, so an expired one can't fail a filled-in
// Save. A capture-phase listener stops the click, awaits the token, then
// re-dispatches it; matching on class covers rows rendered later.
function setupAuthGatedActions() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest(AUTH_GATED_SELECTOR);
    if (!btn || AUTH_GATE_EXEMPT_IDS.includes(btn.id) || btn.dataset.noAuth === '1') return;
    // authChecked marks the re-dispatched click; authPending swallows the impatient
    // second click while the first one's token request is still open.
    if (btn.dataset.authChecked === '1' || btn.dataset.authPending === '1' || btn.disabled) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    // Not withButtonBusy: row actions wrap their own handlers in it, and it
    // would drop the re-dispatched click.
    btn.dataset.authPending = '1';
    ensureAccessToken().then((token) => {
      delete btn.dataset.authPending;
      // No token: handleAuthChange has already shown the sign-out.
      if (!token) return;

      // The flag lets the same click through once; the next real click is gated again.
      btn.dataset.authChecked = '1';
      btn.click();
      delete btn.dataset.authChecked;
    });
  }, true);
}

// The view the address names: block toggles, then the tiles and breadcrumb the
// hub/page views show (page-nav.js), then the router reading the address.
function routeDashboard() {
  Motion.init();
  setupPanelToggles();
  initPageNav();
  initRouter();
}

function bootDashboard() {
  // With the head script's scrollRestoration = 'manual': every load starts at the top.
  window.scrollTo(0, 0);

  initGate();

  document.getElementById('signout-btn').addEventListener('click', signOut);

  setupAccountMenu();
  setupAuthGatedActions();
  initCsvControls();
  initInsightPanel();
  initFormulaPlayground();
  initBmrCalibration();
  // Before the panel below it: this fills the From/To pair every Health Chart
  // chart reads, and its first render is one of the readers.
  initHealthRangeControl();
  initPageScreenshots();
  initProteinRotationPanel();
  initActivityRotationPanel();
  initFinancialInsight();
  initStockAnalysis();
  initWorkoutPlan();
  setupScrollSpy();
  // A section page has routed already (routeDashboard, before this boot step).
  if (!window.ledgerSectionPage) routeDashboard();
  setupThemeToggle();
  setupVisibilitySwitches();
  setupNotificationsButton();
  setupKeyboardShortcuts();
  applyChartTheme();
  initWidgets();

  document.getElementById('footer-year').textContent = new Date().getFullYear();
  // Stamped by scripts/hooks/post-commit; see docs/development/versioning.md.
  if (typeof APP_VERSION !== 'undefined') document.getElementById('footer-version').textContent = `v${APP_VERSION}`;
}

// A section page builds this markup after its own load, so it starts the page
// itself. Elsewhere DOMContentLoaded, so images and the chart CDN aren't awaited.
if (window.ledgerSectionPage) {
  window.ledgerSectionPage.onRoute(routeDashboard);
  window.ledgerSectionPage.onBoot(bootDashboard);
}
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootDashboard);
else bootDashboard();
