const REPORT_RANGE = `'${CONFIG.SHEETS.REPORT}'!A2:L149`;
const BENCHMARKS_RANGE = `'${CONFIG.SHEETS.BENCHMARKS}'!A1:K5`;
const BALANCE_RANGE = `'${CONFIG.SHEETS.BALANCE}'!A1:D1`;
const CATEGORIES_RANGE = `${CONFIG.SHEETS.CATEGORIES}!A2:B`;

// Monthly Summary columns D-J hold per-category expense totals.
const EXPENSE_CATEGORY_COLUMNS = [
  { name: 'Fee', index: 3 },
  { name: 'Grocery', index: 4 },
  { name: 'Transportation', index: 5 },
  { name: 'Personal & Household', index: 6 },
  { name: 'Medical', index: 7 },
  { name: 'Application', index: 8 },
  { name: 'Donation', index: 9 },
];

const CURRENCY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function formatCurrency(value) {
  return CURRENCY_FORMAT.format(value);
}

let currentReport = null;

// 'Account Balance'!D1 holds the pre-computed net worth total.
function parseBalance(balanceRows) {
  return (balanceRows[0] && balanceRows[0][3]) || 0;
}

function setSignedInUI(signedIn) {
  document.getElementById('gate').hidden = signedIn;
  document.getElementById('dashboard').hidden = !signedIn;
  document.getElementById('main-nav').hidden = !signedIn;
  document.getElementById('signin-btn').hidden = signedIn;
  document.getElementById('signout-btn').hidden = !signedIn;
  document.getElementById('refresh-btn').hidden = !signedIn;
}

function handleAuthChange(token, error) {
  setSignedInUI(token !== null);

  const status = document.getElementById('auth-status');
  if (error) {
    status.hidden = false;
    status.textContent = `Sign-in failed: ${error.type || error.error || 'unknown error'}${error.message ? ` — ${error.message}` : ''}`;
  } else {
    status.hidden = true;
    status.textContent = '';
  }

  if (token) loadDashboard();
}

async function loadReport(forceRefresh) {
  if (!forceRefresh) {
    const cached = getCached('report');
    if (cached) return cached;
  }

  const { valueRanges } = await batchGetValues([REPORT_RANGE, BENCHMARKS_RANGE, BALANCE_RANGE, CATEGORIES_RANGE], VALUE_PARAMS);
  const reportRows = valueRanges[0].values || [];
  const benchmarkRows = valueRanges[1].values || [];
  const balanceRows = valueRanges[2].values || [];
  const categoryRows = valueRanges[3].values || [];

  let activeIndex = reportRows.length - 1;
  for (let i = reportRows.length - 1; i >= 0; i--) {
    if (reportRows[i][1] || reportRows[i][2]) {
      activeIndex = i;
      break;
    }
  }

  const current = reportRows[activeIndex];

  const categoryColors = {};
  categoryRows.forEach((row) => {
    if (row[0]) categoryColors[row[0]] = row[1] || '#9ca3af';
  });

  const incomeExpenseTrend = reportRows
    .slice(0, activeIndex + 1)
    .map((row) => ({ label: row[0], income: row[1] || 0, expenses: row[2] || 0 }));

  const savingsTrend = reportRows
    .slice(0, activeIndex + 1)
    .map((row) => ({ label: row[0], cumulative: row[11] || 0 }));

  const categoryTrend = reportRows
    .slice(0, activeIndex + 1)
    .map((row) => ({
      label: row[0],
      categories: EXPENSE_CATEGORY_COLUMNS.map((c) => ({
        name: c.name,
        value: Math.abs(row[c.index] || 0),
        color: categoryColors[c.name] || '#9ca3af',
      })),
    }));

  // Benchmarks!A1:K5 — row 1 is the header (B-K = Income..Saved column names),
  // rows 2-5 are Last Month / Last Quarter Average / Last Year Average / Lifelong Average,
  // already pre-computed by spreadsheet formulas.
  const benchmarkCols = {};
  (benchmarkRows[0] || []).forEach((name, i) => { if (name) benchmarkCols[name] = i; });
  const [, lastMonthRow = [], quarterAvgRow = [], yearAvgRow = [], lifelongAvgRow = []] = benchmarkRows;

  const categoryComparison = EXPENSE_CATEGORY_COLUMNS
    .map((c) => {
      const col = benchmarkCols[c.name];
      const lastMonth = Math.abs(lastMonthRow[col] || 0);
      const quarterAvg = Math.abs(quarterAvgRow[col] || 0);
      const yearAvg = Math.abs(yearAvgRow[col] || 0);
      const lifelongAvg = Math.abs(lifelongAvgRow[col] || 0);
      return { name: c.name, color: categoryColors[c.name] || '#9ca3af', lastMonth, quarterAvg, yearAvg, lifelongAvg };
    });

  const netWorth = parseBalance(balanceRows);

  const report = {
    month: current[0],
    income: current[1] || 0,
    expenses: current[2] || 0,
    saved: current[10] || 0,
    incomeExpenseTrend,
    savingsTrend,
    categoryTrend,
    categoryComparison,
    netWorth,
  };

  setCached('report', report);
  return report;
}

function renderSummaryCards(data) {
  document.getElementById('net-worth').textContent = formatCurrency(data.netWorth);
  document.getElementById('income-label').textContent = `Income (${data.month})`;
  document.getElementById('income-value').textContent = formatCurrency(data.income);
  document.getElementById('expenses-label').textContent = `Expenses (${data.month})`;
  document.getElementById('expenses-value').textContent = formatCurrency(data.expenses);

  const savingsEl = document.getElementById('savings-value');
  savingsEl.textContent = formatCurrency(data.saved);
  savingsEl.classList.toggle('income', data.saved >= 0);
  savingsEl.classList.toggle('expense', data.saved < 0);
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
      renderSpendingTrendChart(report.categoryComparison);
      renderIncomeExpenseChart(report.incomeExpenseTrend);
      renderExpenseBreakdownTrendChart(report.categoryTrend);
      renderSavingsTrendChart(report.savingsTrend);
      setLastUpdated();
    }),
    initTransactions(forceRefresh),
    initAccountManager(forceRefresh),
  ]);

  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (errors.length) {
    console.error('Failed to load dashboard data:', errors);
    showDashboardError(errors.join('; '));
  }

  loading.hidden = true;
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
}

window.addEventListener('load', () => {
  initAuth(handleAuthChange);

  document.getElementById('signin-btn').addEventListener('click', signIn);
  document.getElementById('gate-signin-btn').addEventListener('click', signIn);
  document.getElementById('signout-btn').addEventListener('click', signOut);
  document.getElementById('refresh-btn').addEventListener('click', () => {
    clearCache();
    loadDashboard(true);
  });
  document.getElementById('clear-cache-btn').addEventListener('click', hardRefresh);

  initCsvControls();
  setupScrollSpy();

  document.getElementById('footer-year').textContent = new Date().getFullYear();
});
