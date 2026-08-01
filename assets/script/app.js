const REPORT_RANGE = `'${CONFIG.SHEETS.REPORT}'!A1:Z149`;
const BALANCE_RANGE = `'${CONFIG.SHEETS.BALANCE}'!A1:D1`;
const INSIGHT_RANGE = `${CONFIG.SHEETS.INSIGHT}!A2:F200`;
const RECONCILIATION_RANGE = `'${CONFIG.SHEETS.RECONCILIATION}'!B5`;
const SETTINGS_RANGE = `${CONFIG.SHEETS.SETTINGS}!A2:C`;

const CURRENCY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Amounts are shown by default each time the dashboard loads; clicking the
// privacy FAB hides them for the rest of the session (for reading the
// dashboard somewhere it can be seen over your shoulder).
let privacyMode = false;

// Replaces every digit with '*', so masked values keep their currency
// symbol, sign, and separators (e.g. "$1,234.56" -> "$*,***.**").
function maskDigits(str) {
  return String(str).replace(/[0-9]/g, '*');
}

// Same idea as maskDigits, but for arbitrary free text (e.g. Health Log
// Notes) rather than a formatted number — digits alone would leave every
// word fully readable, so every non-whitespace character is replaced
// instead, keeping only the word/line shape visible.
function maskText(str) {
  return String(str).replace(/\S/g, '*');
}

function formatCurrency(value) {
  const formatted = CURRENCY_FORMAT.format(value);
  return privacyMode ? maskDigits(formatted) : formatted;
}

// Shared by the Transactions, Accounts, and Time Log tables for the "no
// rows to show" case, so an empty sheet (or filter with no matches) doesn't
// just render a blank table.
function renderEmptyRow(colspan, message) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = colspan;
  td.className = 'empty-state';
  td.textContent = message;
  tr.appendChild(td);
  return tr;
}

let undoToastTimer = null;

// Shared by single and bulk transaction delete. Re-showing the toast before
// the previous one's timer fires (e.g. deleting twice in quick succession)
// clears the old timer so it can't dismiss the new toast early.
function showUndoToast(message, onUndo) {
  clearTimeout(undoToastTimer);

  const toast = document.getElementById('undo-toast');
  document.getElementById('undo-toast-message').textContent = message;

  const btn = document.getElementById('undo-toast-btn');
  const newBtn = btn.cloneNode(true);
  btn.replaceWith(newBtn);
  newBtn.addEventListener('click', () => {
    clearTimeout(undoToastTimer);
    toast.hidden = true;
    onUndo();
  });

  toast.hidden = false;
  undoToastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
}

let currentReport = null;

// 'Account Balance'!D1 holds the pre-computed net worth total.
function parseBalance(balanceRows) {
  return (balanceRows[0] && balanceRows[0][3]) || 0;
}

// 'Insight'!A2:F200 — Category, Type, Last Month, Last Quarter, Last Year,
// Lifelong, pre-computed by spreadsheet formulas. Rows with a blank Type
// hold the category's overall total (used as the "Untyped" remainder).
function parseTypeBreakdown(insightRows) {
  const breakdown = {};

  insightRows.forEach((row) => {
    const category = row[0];
    if (!category) return;

    const type = row[1] || '';
    const stats = {
      lastMonth: row[2] || 0,
      lastQuarter: row[3] || 0,
      lastYear: row[4] || 0,
      lifelong: row[5] || 0,
    };

    if (!breakdown[category]) breakdown[category] = { types: [], total: null };
    if (type) {
      // Skip types that have never had any spend (e.g. a retired type whose
      // Insight row still exists with all-zero figures) so they don't clutter
      // the legend/donuts.
      if (stats.lifelong) breakdown[category].types.push({ name: type, ...stats });
    } else {
      breakdown[category].total = stats;
    }
  });

  return breakdown;
}

const SHORTCUT_MODAL_IDS = ['tx-modal', 'tx-bulk-edit-modal', 'account-modal', 'timesheet-modal', 'wellness-modal', 'wellness-bulk-edit-modal', 'nutrition-modal', 'shortcuts-modal'];

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

// Each modal manages its own hidden flag from wherever it's opened/closed
// (transactions.js, accounts.js, timesheet.js, etc.) — rather than touching
// every call site, watch the `hidden` attribute here to send focus back to
// whatever triggered the modal once it closes. Focus is deliberately left
// alone on open: auto-focusing any field (even a plain text one) pops the
// keyboard on mobile and, for date/time/select fields, the native picker —
// so the form should just appear with nothing selected.
function setupModalFocusManagement() {
  SHORTCUT_MODAL_IDS.forEach((id) => {
    const modal = document.getElementById(id);
    if (!modal) return;

    let lastFocused = null;
    new MutationObserver(() => {
      if (!modal.hidden) {
        lastFocused = document.activeElement;
      } else if (lastFocused) {
        lastFocused.focus();
        lastFocused = null;
      }
    }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  });
}

// Global shortcuts. Escape always works (even while focus is inside a
// modal's own input, e.g. typing an amount then hitting Escape to cancel);
// the single-letter shortcuts are skipped whenever focus is in a field that
// actually consumes typed characters, so they can't fire while searching or
// filling out a form.
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModal = getOpenModal();
      if (openModal) openModal.hidden = true;
      return;
    }

    // Trap Tab/Shift+Tab inside whichever modal is open, so focus can't
    // escape to the page behind the overlay.
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

    const target = document.activeElement;
    const isTyping = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    if (isTyping) return;

    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('tx-search').focus();
    } else if (e.key === 'n') {
      openTransactionForm();
    } else if (e.key === '?') {
      toggleShortcutsHelp();
    }
  });

  document.getElementById('shortcuts-close-btn').addEventListener('click', toggleShortcutsHelp);
  setupModalFocusManagement();
}

function setupAccountMenu() {
  const menu = document.getElementById('account-menu');
  const btn = document.getElementById('account-menu-btn');
  const dropdown = document.getElementById('account-menu-dropdown');

  const closeMenu = () => {
    dropdown.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
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

  document.getElementById('signout-btn').addEventListener('click', closeMenu);

  document.getElementById('refresh-btn').addEventListener('click', () => {
    closeMenu();
    clearCache();
    loadDashboard(true);
  });

  document.getElementById('clear-cache-btn').addEventListener('click', () => {
    closeMenu();
    hardRefresh();
  });

  document.getElementById('open-sheet-btn').addEventListener('click', () => {
    closeMenu();
    window.open(`https://docs.google.com/spreadsheets/d/${getActiveSpreadsheetId()}/edit`, '_blank');
  });

  document.getElementById('switch-sheet-btn').addEventListener('click', async () => {
    closeMenu();
    try {
      await pickSpreadsheet();
      setUIState('dashboard');
      loadDashboard();
    } catch (err) {
      if (err.message !== 'cancelled') alert(`Couldn't switch spreadsheet: ${err.message}`);
    }
  });

  document.getElementById('rename-sheet-btn').addEventListener('click', async () => {
    closeMenu();
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

async function loadReport(forceRefresh) {
  if (!forceRefresh) {
    const cached = getCached('report');
    if (cached) return cached;
  }

  const { valueRanges } = await batchGetValues(
    [REPORT_RANGE, BALANCE_RANGE, INSIGHT_RANGE, RECONCILIATION_RANGE],
    VALUE_PARAMS
  );
  const reportRows = valueRanges[0].values || [];
  const balanceRows = valueRanges[1].values || [];
  const insightRows = valueRanges[2].values || [];
  const reconciliationRows = valueRanges[3].values || [];

  // Insight!A2:F200 lists each category once per Type plus one blank-Type
  // total row, so collapse column A to a unique, order-preserving list.
  const categoryNames = [];
  insightRows.forEach((row) => {
    if (row[0] && !categoryNames.includes(row[0])) categoryNames.push(row[0]);
  });

  // The blank-Type row's Last Month/Last Quarter/Last Year/Lifelong columns
  // are each category's overall spend — the same figures the old Benchmarks
  // sheet duplicated, so they double as the per-category benchmarks too.
  const typeBreakdown = parseTypeBreakdown(insightRows);

  // Row 1 of Monthly Summary holds column headers (Income, Expenses, one
  // column per spending category, Saved, Cumulative) — used below to find
  // each category's column dynamically instead of a hardcoded index.
  const monthlyHeader = reportRows[0] || [];
  const monthlyRows = reportRows.slice(1);

  const monthlyCols = {};
  monthlyHeader.forEach((name, i) => { if (name) monthlyCols[name] = i; });

  // "Saved" and "Cumulative" are always the last two columns of Monthly
  // Summary, regardless of how many category columns precede them. The
  // Sheets API trims each row to its own last non-empty cell, so the header
  // row's length isn't a reliable column count — use the widest data row
  // instead, so adding/removing a category column doesn't break these.
  const dataWidth = monthlyRows.reduce((max, row) => Math.max(max, row.length), 0);
  const savedIndex = dataWidth - 2;
  const cumulativeIndex = dataWidth - 1;

  let activeIndex = monthlyRows.length - 1;
  for (let i = monthlyRows.length - 1; i >= 0; i--) {
    if (monthlyRows[i][1] || monthlyRows[i][2]) {
      activeIndex = i;
      break;
    }
  }

  const current = monthlyRows[activeIndex];

  // Every category in Insight becomes a chart category as long as its name
  // also appears as a column header in Monthly Summary — no hardcoded
  // category list or column indices. Columns A-C (Month, Income, Expenses)
  // are excluded since "Income" may also appear as an Insight category but
  // isn't a spending category.
  const categoryColumns = categoryNames
    .filter((name) => monthlyCols[name] >= 3)
    .map((name) => ({ name, monthlyIndex: monthlyCols[name] }));

  // Order categories by lifelong spend (highest first) so every
  // category-based chart (trend, comparison, breakdown) ranks consistently
  // by overall impact rather than Insight's row order, then assign each a
  // distinct color spread evenly around the color wheel.
  const orderedCategoryColumns = [...categoryColumns]
    .sort((a, b) => {
      const lifelongA = Math.abs(typeBreakdown[a.name]?.total?.lifelong || 0);
      const lifelongB = Math.abs(typeBreakdown[b.name]?.total?.lifelong || 0);
      return lifelongB - lifelongA;
    })
    .map((c, i, arr) => ({ ...c, color: `hsl(${Math.round((i * 360) / arr.length)}, 65%, 55%)` }));

  const incomeExpenseTrend = monthlyRows
    .slice(0, activeIndex + 1)
    .map((row) => ({ label: row[0], income: row[1] || 0, expenses: row[2] || 0 }));

  const savingsTrend = monthlyRows
    .slice(0, activeIndex + 1)
    .map((row) => ({ label: row[0], cumulative: row[cumulativeIndex] || 0 }));

  const categoryTrend = monthlyRows
    .slice(0, activeIndex + 1)
    .map((row) => ({
      label: row[0],
      categories: orderedCategoryColumns.map((c) => ({
        name: c.name,
        value: Math.abs(row[c.monthlyIndex] || 0),
        color: c.color,
      })),
    }));

  const categoryComparison = orderedCategoryColumns
    .map((c) => {
      const total = typeBreakdown[c.name]?.total || {};
      const lastMonth = Math.abs(total.lastMonth || 0);
      const quarterAvg = Math.abs(total.lastQuarter || 0);
      const yearAvg = Math.abs(total.lastYear || 0);
      const lifelongAvg = Math.abs(total.lifelong || 0);
      return { name: c.name, color: c.color, lastMonth, quarterAvg, yearAvg, lifelongAvg };
    });

  const netWorth = parseBalance(balanceRows);
  const missingAmount = Number(reconciliationRows[0]?.[0]) || 0;

  const report = {
    income: current[1] || 0,
    expenses: current[2] || 0,
    saved: current[savedIndex] || 0,
    incomeExpenseTrend,
    savingsTrend,
    categoryTrend,
    categoryComparison,
    // Monthly Summary has one row per month from the first month of data
    // through the current month, so its row count doubles as the number of
    // months to divide the Lifelong total by for a monthly average.
    totalMonths: activeIndex + 1,
    typeBreakdown,
    netWorth,
    missingAmount,
  };

  setCached('report', report);
  return report;
}

let currentSettings = {};

// Last successfully parsed Settings tab, kept so a FAILED refresh can fall
// back to it instead of wiping everything — see the catch below.
let lastLoadedSettings = null;

// 'Settings'!A2:C is optional and user-managed — unlike every other tab, most
// users won't have added it. A failure here is never a dashboard-load failure;
// every reader falls back to its own default via getSetting() below.
//
// A read failure is NOT the same as "there are no settings", though, and
// conflating the two was a real bug: returning {} here — and caching it for
// the full 5-minute TTL — silently wiped every setting in memory on one
// transient read error. Targets reverted to their defaults and Wellness Insight
// reported age and height as "not set" — all while the spreadsheet itself was
// perfectly intact, which is exactly why it looked like a dozen unrelated bugs.
// So: keep the
// last known-good copy, never poison the cache with a failure, and log the
// cause, which used to be discarded entirely by a bare `catch {}`.
async function loadSettings(forceRefresh) {
  if (!forceRefresh) {
    const cached = getCached('settings');
    if (cached) return cached;
  }

  try {
    const resp = await getValues(SETTINGS_RANGE, VALUE_PARAMS);
    const settings = parseSettings(resp.values || []);
    lastLoadedSettings = settings;
    setCached('settings', settings);
    return settings;
  } catch (err) {
    console.error(`Failed to read the "${CONFIG.SHEETS.SETTINGS}" tab — keeping the previously loaded settings:`, err);
    return lastLoadedSettings ?? {};
  }
}

// Row-reduce idiom mirroring parseTypeBreakdown — column A is the key,
// column B its value; column C (Notes) is intentionally never read.
function parseSettings(settingsRows) {
  const settings = {};
  settingsRows.forEach((row) => { if (row[0]) settings[row[0]] = row[1]; });
  return settings;
}

// Looks up a numeric parameter from the Settings tab, falling back to
// `fallback` if the tab/row is missing, the cell is blank, or the value
// isn't a usable number.
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

function renderSummaryCards(data) {
  document.getElementById('net-worth').textContent = formatCurrency(data.netWorth);
  document.getElementById('income-label').textContent = 'Monthly Income';
  document.getElementById('income-value').textContent = formatCurrency(data.income);
  document.getElementById('expenses-label').textContent = 'Monthly Expenditure';
  document.getElementById('expenses-value').textContent = formatCurrency(data.expenses);

  document.getElementById('cashflow-label').textContent = 'Monthly Cash Flow';

  const savingsEl = document.getElementById('savings-value');
  savingsEl.textContent = formatCurrency(data.saved);
  savingsEl.classList.toggle('income', data.saved >= 0);
  savingsEl.classList.toggle('expense', data.saved < 0);
}

// 'Reconciliation'!B5 is the Sheet's pre-computed gap between recorded
// account balances and transaction history. Non-zero means an account
// balance is wrong or a transaction is missing.
function renderReconciliationStatus(missingAmount) {
  const isReconciled = Math.abs(missingAmount) < 0.005;

  const el = document.getElementById('reconciliation-status');
  el.textContent = isReconciled
    ? '✅ Reconciled'
    : `⚠️ Reconciliation off by ${formatCurrency(missingAmount)} — check account balances or look for a missing transaction`;
  el.classList.toggle('warning', !isReconciled);
}

async function refreshNetWorth() {
  const resp = await getValues(BALANCE_RANGE, VALUE_PARAMS);
  const netWorth = parseBalance(resp.values || []);

  if (currentReport) {
    currentReport.netWorth = netWorth;
    setCached('report', currentReport);
  }

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
  document.getElementById('last-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function loadDashboard(forceRefresh = false) {
  const loading = document.getElementById('dashboard-loading');
  loading.hidden = false;
  clearDashboardError();

  // Never throws (see loadSettings). Settings fetches concurrently with
  // every other module below instead of blocking them first — only
  // initWellness (target-line charts) and initTravel (BIRTH_DATE credit)
  // actually read currentSettings, so just those two wait on it.
  const settingsPromise = loadSettings(forceRefresh).then((settings) => {
    currentSettings = settings;
    applySettingsToWidgets();
    renderSavedFoodInsight();
    renderSavedWellnessInsight();
  });

  const wellnessPromise = settingsPromise.then(() => initWellness(forceRefresh));
  const nutritionPromise = initNutrition(forceRefresh);

  // Every module below is an independent API call — fetch them all
  // concurrently so the dashboard doesn't wait on nine round trips in
  // sequence.
  const results = await Promise.allSettled([
    settingsPromise,
    loadReport(forceRefresh).then((report) => {
      currentReport = report;
      renderSummaryCards(report);
      renderSpendingTrendChart(report.categoryComparison, report.totalMonths);
      renderSpendingBreakdownCharts(report.categoryComparison);
      renderTypeBreakdownCharts(report.typeBreakdown);
      renderIncomeExpenseChart(report.incomeExpenseTrend);
      renderExpenseBreakdownTrendChart(report.categoryTrend);
      renderSavingsTrendChart(report.savingsTrend);
      renderReconciliationStatus(report.missingAmount);
      setLastUpdated();
    }),
    initTransactions(forceRefresh),
    initAccountManager(forceRefresh),
    initTimeSheet(forceRefresh),
    wellnessPromise.then(() => {
      // The three AI-read panels' local (free) previews depend on wellness
      // entries that just finished loading above — refresh them now rather
      // than leaving whatever initFoodInsightPanel/initInsightPanel/
      // initActivityInsightPanel rendered at window 'load' time, before any
      // data existed.
      renderFoodInsightPreview(getFoodInsightDateRange());
      renderInsightDataPreview(getInsightDateRange());
      renderActivityInsightDataPreview(getActivityInsightDateRange());
    }),
    nutritionPromise,
    // Protein Source Rotation needs wellness (actual servings eaten),
    // Nutrition Facts (live per-serving calories/protein), and settings
    // (protein target) all loaded — refresh only once all three are in,
    // rather than off just one of them like the two panels above.
    Promise.all([wellnessPromise, nutritionPromise]).then(() => {
      renderProteinRotationChart(getProteinRotationDateRange());
    }),
    initContacts(forceRefresh),
    initSettingsPanel(forceRefresh),
    settingsPromise.then(() => initTravel(forceRefresh)),
    initApplications(forceRefresh),
  ]);

  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (errors.length) {
    console.error('Failed to load dashboard data:', errors);
    showDashboardError(errors.join('; '));
  }

  loading.hidden = true;
}

// Each panel's <h2> toggles its own content, and the FAB flips every panel
// at once between fully expanded and fully collapsed.
// The CSS collapse animation (max-height/opacity, styles.css) only hides
// panel content VISUALLY — it never removes it from the accessibility tree
// or from text selection/"find in page"/copy-paste, since neither property
// implies aria-hidden or display:none. A collapsed table-heavy panel (Health
// Log, Contacts, Settings) has plenty of literal DOM text an a11y-tree-based
// tool can still read even while a sighted user sees nothing; a collapsed
// chart-only panel (canvas has no text content at all) looks "empty" either
// way, which is what made this asymmetry hard to spot visually. `inert`
// (supported in all current major browsers) is the correct fix: it pulls
// the whole subtree out of the accessibility tree, tab order, and text
// selection in one attribute, so collapsed really means collapsed for every
// consumer, not just sighted mouse users.
function setPanelCollapsed(panel, heading, collapsed) {
  panel.classList.toggle('collapsed', collapsed);
  heading.setAttribute('aria-expanded', String(!collapsed));
  [...panel.children].forEach((child) => {
    if (child === heading || child.classList.contains('panel-header')) return;
    if (collapsed) child.setAttribute('inert', '');
    else child.removeAttribute('inert');
  });
}

function setupPanelToggles() {
  const panels = [...document.querySelectorAll('#dashboard .panel')];
  const fab = document.getElementById('toggle-panels-fab');
  const headingsByPanel = new Map();

  // Reflects the panels' actual current state, so the FAB's icon/title are
  // correct no matter how that state changed — its own click, an individual
  // panel heading, or a nav link.
  const updateFab = () => {
    const anyExpanded = panels.some((panel) => !panel.classList.contains('collapsed'));
    fab.textContent = anyExpanded ? '⊟' : '⊞';
    fab.title = anyExpanded ? 'Collapse all panels' : 'Expand all panels';
    fab.setAttribute('aria-label', fab.title);
  };

  panels.forEach((panel, i) => {
    const heading = panel.querySelector('h2');
    if (!heading) return;
    headingsByPanel.set(panel, heading);

    const icon = document.createElement('span');
    icon.className = 'panel-toggle-icon';
    icon.textContent = '▾';
    heading.prepend(icon);

    // Staggered fade/slide-in the first time the dashboard becomes visible.
    panel.style.animationDelay = `${i * 70}ms`;
    panel.classList.add('panel-enter');

    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    setPanelCollapsed(panel, heading, true);

    const toggle = () => {
      setPanelCollapsed(panel, heading, !panel.classList.contains('collapsed'));
      updateFab();
    };

    heading.addEventListener('click', () => {
      // A click that ends a text-selection drag (e.g. the user selecting the
      // heading's label) shouldn't also toggle the panel.
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

  updateFab();

  fab.addEventListener('click', () => {
    const shouldCollapse = panels.some((panel) => !panel.classList.contains('collapsed'));
    panels.forEach((panel) => setPanelCollapsed(panel, headingsByPanel.get(panel), shouldCollapse));
    updateFab();
  });

  // Jumping to a section via the nav also expands its panel(s), since
  // everything starts collapsed. Panel-group targets expand every child
  // panel; a lone .panel target expands directly.
  document.querySelectorAll('#main-nav a').forEach((link) => {
    link.addEventListener('click', () => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;

      const targetPanels = target.classList.contains('panel-group')
        ? [...target.querySelectorAll('.panel')]
        : [target];
      targetPanels.forEach((p) => setPanelCollapsed(p, headingsByPanel.get(p), false));
      updateFab();
    });
  });
}

function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle-btn');

  const updateButton = (dark) => {
    btn.textContent = dark ? '☀️' : '🌙';
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', btn.title);
  };

  updateButton(document.documentElement.dataset.theme === 'dark');

  btn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';

    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('ledger_theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('ledger_theme');
    }

    updateButton(dark);
    applyChartTheme();

    if (!document.getElementById('dashboard').hidden) loadDashboard(false);
  });
}

// Masks every formatted amount on the page (cards, tables, chart ticks,
// and chart tooltips) by re-rendering from cached data with formatCurrency
// in masked mode.
function setupPrivacyToggle() {
  const btn = document.getElementById('privacy-toggle-fab');

  const updateButton = () => {
    btn.textContent = privacyMode ? '🙈' : '👁️';
    btn.title = privacyMode ? 'Show amounts' : 'Hide amounts';
    btn.setAttribute('aria-label', btn.title);
  };

  updateButton();

  btn.addEventListener('click', () => {
    privacyMode = !privacyMode;
    updateButton();
    if (!document.getElementById('dashboard').hidden) loadDashboard(false);
  });
}

function setupScrollSpy() {
  const navLinks = [...document.querySelectorAll('#main-nav a')];
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => link.classList.remove('active'));
      const activeLink = document.querySelector(`#main-nav a[href="#${entry.target.id}"]`);
      if (activeLink) activeLink.classList.add('active');
    });
  }, { rootMargin: '-50% 0px -50% 0px' });

  sections.forEach((section) => observer.observe(section));

  // The widget cards row above the first section can push its midpoint past
  // the viewport's center line, so the observer never fires for it near the
  // top of the page. Force the first nav link active once the user scrolls back up.
  window.addEventListener('scroll', () => {
    if (window.scrollY < sections[0].offsetTop) {
      navLinks.forEach((link) => link.classList.remove('active'));
      navLinks[0].classList.add('active');
    }
  });
}

window.addEventListener('load', () => {
  // Belt-and-suspenders alongside the head script's history.scrollRestoration
  // = 'manual' — guarantees every load starts at the top even if the browser
  // still tried to restore a prior scroll position before this fired.
  window.scrollTo(0, 0);

  initGate();

  document.getElementById('signout-btn').addEventListener('click', signOut);

  setupAccountMenu();
  initCsvControls();
  initInsightPanel();
  initFoodInsightPanel();
  initActivityInsightPanel();
  initProteinRotationPanel();
  initWorkoutPlan();
  setupScrollSpy();
  setupPanelToggles();
  setupThemeToggle();
  setupPrivacyToggle();
  setupKeyboardShortcuts();
  applyChartTheme();
  initWidgets();

  document.getElementById('footer-year').textContent = new Date().getFullYear();
});
