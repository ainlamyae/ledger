const REPORT_RANGE = 'Report!A3:N114';
const BALANCE_RANGE = 'Balance!A1:B26';
const CATEGORIES_RANGE = `${CONFIG.SHEETS.CATEGORIES}!A2:B`;

// Report columns D,E,F,G,I,J,K,L hold per-category expense totals (H is a
// rollup of I:L and is intentionally excluded to avoid double-counting).
const EXPENSE_CATEGORY_COLUMNS = [
  { name: 'Fee', index: 3 },
  { name: 'Grocery', index: 4 },
  { name: 'Transportation', index: 5 },
  { name: 'Personal & Household', index: 6 },
  { name: 'Medical', index: 8 },
  { name: 'Document/Registration', index: 9 },
  { name: 'Donation', index: 10 },
  { name: 'Tax', index: 11 },
];

const CURRENCY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function formatCurrency(value) {
  return CURRENCY_FORMAT.format(value);
}

function setSignedInUI(signedIn) {
  document.getElementById('gate').hidden = signedIn;
  document.getElementById('dashboard').hidden = !signedIn;
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

  const { valueRanges } = await batchGetValues([REPORT_RANGE, BALANCE_RANGE, CATEGORIES_RANGE], VALUE_PARAMS);
  const reportRows = valueRanges[0].values || [];
  const balanceRows = valueRanges[1].values || [];
  const categoryRows = valueRanges[2].values || [];

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

  const last12 = reportRows
    .slice(Math.max(0, activeIndex - 11), activeIndex + 1)
    .map((row) => ({ label: row[0], income: row[1] || 0, expenses: row[2] || 0 }));

  const savingsTrend = reportRows
    .slice(0, activeIndex + 1)
    .map((row) => ({ label: row[0], cumulative: row[13] || 0 }));

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

  const categoryBreakdown = EXPENSE_CATEGORY_COLUMNS
    .map((c) => ({ name: c.name, value: Math.abs(current[c.index] || 0), color: categoryColors[c.name] || '#9ca3af' }))
    .filter((c) => c.value > 0);

  const netWorth = (balanceRows[4] && balanceRows[4][0]) || 0;
  const accounts = balanceRows
    .slice(6)
    .filter((row) => row && row[1])
    .map((row) => ({ name: row[1], balance: row[0] || 0 }));

  const report = {
    month: current[0],
    income: current[1] || 0,
    expenses: current[2] || 0,
    saved: current[12] || 0,
    last12,
    savingsTrend,
    categoryTrend,
    categoryBreakdown,
    netWorth,
    accounts,
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

function renderAccountsPanel(accounts) {
  const container = document.getElementById('accounts-panel');
  container.innerHTML = '';

  accounts.forEach((account) => {
    const row = document.createElement('div');
    row.className = 'account';

    const name = document.createElement('span');
    name.textContent = account.name;

    const value = document.createElement('strong');
    value.textContent = formatCurrency(account.balance);
    if (account.balance < 0) value.classList.add('expense');

    row.append(name, value);
    container.appendChild(row);
  });
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

  try {
    const report = await loadReport(forceRefresh);
    renderSummaryCards(report);
    renderAccountsPanel(report.accounts);
    renderIncomeExpenseChart(report.last12);
    renderExpenseBreakdownChart(report.categoryBreakdown, report.month);
    renderExpenseBreakdownTrendChart(report.categoryTrend);
    renderSavingsTrendChart(report.savingsTrend);
    setLastUpdated();
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    showDashboardError(err.message);
  }

  try {
    await initTransactions(forceRefresh);
  } catch (err) {
    console.error('Failed to load transactions:', err);
    showDashboardError(err.message);
  }

  loading.hidden = true;
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
});
