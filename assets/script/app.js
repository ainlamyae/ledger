const REPORT_RANGE = `'${CONFIG.SHEETS.REPORT}'!A1:Z149`;
const BALANCE_RANGE = `'${CONFIG.SHEETS.BALANCE}'!A1:D1`;
const INSIGHT_RANGE = `${CONFIG.SHEETS.INSIGHT}!A2:F200`;
const RECONCILIATION_RANGE = `'${CONFIG.SHEETS.RECONCILIATION}'!B5`;

const CURRENCY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Amounts are hidden by default each time the dashboard loads; clicking
// the privacy FAB reveals them for the rest of the session.
let privacyMode = true;

// Replaces every digit with '*', so masked values keep their currency
// symbol, sign, and separators (e.g. "$1,234.56" -> "$*,***.**").
function maskDigits(str) {
  return String(str).replace(/[0-9]/g, '*');
}

function formatCurrency(value) {
  const formatted = CURRENCY_FORMAT.format(value);
  return privacyMode ? maskDigits(formatted) : formatted;
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

// 'signedOut' -> the landing/sign-in gate.
// 'needsFile' -> signed in, but no spreadsheet selected yet (new user, or
//   returning user who cleared storage / switched browsers).
// 'dashboard' -> signed in with a spreadsheet selected; the normal app.
function setUIState(state) {
  document.getElementById('gate').hidden = state !== 'signedOut';
  document.getElementById('file-gate').hidden = state !== 'needsFile';
  document.getElementById('dashboard').hidden = state !== 'dashboard';
  document.getElementById('main-nav').hidden = state !== 'dashboard';
  document.getElementById('signin-btn').hidden = state !== 'signedOut';
  document.getElementById('account-menu').hidden = state === 'signedOut';
  document.getElementById('refresh-btn').hidden = state !== 'dashboard';
  document.getElementById('toggle-panels-fab').hidden = state !== 'dashboard';
  document.getElementById('privacy-toggle-fab').hidden = state !== 'dashboard';
  document.getElementById('top-banner').hidden = state !== 'dashboard';
}

function handleAuthChange(token, error) {
  const status = document.getElementById('auth-status');
  if (error && !error.silent) {
    status.hidden = false;
    status.textContent = `Sign-in failed: ${error.type || error.error || 'unknown error'}${error.message ? ` — ${error.message}` : ''}`;
  } else {
    status.hidden = true;
    status.textContent = '';
  }

  if (!token) {
    setUIState('signedOut');
    return;
  }

  populateAccountMenu();

  if (getActiveSpreadsheetId()) {
    setUIState('dashboard');
    loadDashboard();
  } else {
    setUIState('needsFile');
  }
}

// Shows the signed-in account's picture (or initials, if it has none/fails
// to load) and name/email in the header dropdown.
async function populateAccountMenu() {
  const info = await fetchUserInfo();
  if (!info) return;

  const img = document.getElementById('account-avatar-img');
  const fallback = document.getElementById('account-avatar-fallback');

  if (info.picture) {
    img.src = info.picture;
    img.hidden = false;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = (info.name || info.email || '?').trim().charAt(0).toUpperCase();
  }

  document.getElementById('account-menu-name').textContent = info.name || '';
  document.getElementById('account-menu-email').textContent = info.email || '';
}

const SHORTCUT_MODAL_IDS = ['tx-modal', 'account-modal', 'timesheet-modal', 'shortcuts-modal'];

function toggleShortcutsHelp() {
  const modal = document.getElementById('shortcuts-modal');
  modal.hidden = !modal.hidden;
}

// Global shortcuts. Escape always works (even while focus is inside a
// modal's own input, e.g. typing an amount then hitting Escape to cancel);
// the single-letter shortcuts are skipped whenever focus is in a field that
// actually consumes typed characters, so they can't fire while searching or
// filling out a form.
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModal = SHORTCUT_MODAL_IDS.map((id) => document.getElementById(id)).find((m) => !m.hidden);
      if (openModal) openModal.hidden = true;
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

function showFileGateStatus(message) {
  const status = document.getElementById('file-gate-status');
  status.hidden = false;
  status.textContent = message;
}

function setupFileGate() {
  document.getElementById('get-template-btn').addEventListener('click', openTemplateCopyLink);

  document.getElementById('select-sheet-btn').addEventListener('click', async () => {
    try {
      await pickSpreadsheet();
      setUIState('dashboard');
      loadDashboard();
    } catch (err) {
      if (err.message !== 'cancelled') showFileGateStatus(`Couldn't select that file: ${err.message}`);
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

function renderSummaryCards(data) {
  document.getElementById('net-worth').textContent = formatCurrency(data.netWorth);
  document.getElementById('income-label').textContent = 'Income';
  document.getElementById('income-value').textContent = formatCurrency(data.income);
  document.getElementById('expenses-label').textContent = 'Expenses';
  document.getElementById('expenses-value').textContent = formatCurrency(data.expenses);

  document.getElementById('cashflow-label').textContent = 'Net Cash Flow';

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

  // Report, transactions, and accounts are independent API calls — fetch
  // them concurrently so the dashboard doesn't wait on three round trips
  // in sequence.
  const results = await Promise.allSettled([
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
    initTransactions(forceRefresh).then(() => {
      renderCommonPayeeChart(allTransactions);
      renderCommonDescriptionChart(allTransactions);
      renderPayeeSpendChart(allTransactions);
    }),
    initAccountManager(forceRefresh),
    initTimeSheet(forceRefresh),
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
function setupPanelToggles() {
  const panels = [...document.querySelectorAll('#dashboard .panel')];
  const fab = document.getElementById('toggle-panels-fab');

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

    const icon = document.createElement('span');
    icon.className = 'panel-toggle-icon';
    icon.textContent = '▾';
    heading.prepend(icon);

    // Staggered fade/slide-in the first time the dashboard becomes visible.
    panel.style.animationDelay = `${i * 70}ms`;
    panel.classList.add('panel-enter');

    panel.classList.add('collapsed');
    heading.addEventListener('click', () => {
      // A click that ends a text-selection drag (e.g. the user selecting the
      // heading's label) shouldn't also toggle the panel.
      if (window.getSelection().toString()) return;
      panel.classList.toggle('collapsed');
      updateFab();
    });
  });

  updateFab();

  fab.addEventListener('click', () => {
    const shouldCollapse = panels.some((panel) => !panel.classList.contains('collapsed'));
    panels.forEach((panel) => panel.classList.toggle('collapsed', shouldCollapse));
    updateFab();
  });

  // Jumping to a section via the nav also expands its panel(s), since
  // everything starts collapsed. "Charts" and "Accounts" are panel-groups
  // wrapping multiple .panel children, so expand all of them; other nav
  // targets are a single .panel and expand directly.
  document.querySelectorAll('#main-nav a').forEach((link) => {
    link.addEventListener('click', () => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;

      if (target.classList.contains('panel-group')) {
        target.querySelectorAll('.panel').forEach((p) => p.classList.remove('collapsed'));
      } else {
        target.classList.remove('collapsed');
      }
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

  // The cards row above #charts can push its midpoint past the viewport's
  // center line, so the observer never fires for it near the top of the
  // page. Force the first nav link active once the user scrolls back up.
  window.addEventListener('scroll', () => {
    if (window.scrollY < sections[0].offsetTop) {
      navLinks.forEach((link) => link.classList.remove('active'));
      navLinks[0].classList.add('active');
    }
  });
}

window.addEventListener('load', () => {
  initAuth(handleAuthChange);

  document.getElementById('signin-btn').addEventListener('click', signIn);
  document.getElementById('signout-btn').addEventListener('click', signOut);

  setupFileGate();
  setupAccountMenu();
  initCsvControls();
  setupScrollSpy();
  setupPanelToggles();
  setupThemeToggle();
  setupPrivacyToggle();
  setupKeyboardShortcuts();
  applyChartTheme();

  document.getElementById('footer-year').textContent = new Date().getFullYear();
});
