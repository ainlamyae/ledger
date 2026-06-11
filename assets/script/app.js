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

let currentReport = null;

// Balance!A5 holds the net worth total; A7:B26 holds one row per account
// (A = balance, B = account name).
function parseBalance(balanceRows) {
  const netWorth = (balanceRows[4] && balanceRows[4][0]) || 0;
  const accounts = balanceRows
    .slice(6)
    .map((row, i) => ({ row: 7 + i, name: row && row[1], balance: (row && row[0]) || 0 }))
    .filter((account) => account.name);

  return { netWorth, accounts };
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

  const sumCategory = (months, name) => months.reduce((acc, month) => {
    const entry = month.categories.find((cat) => cat.name === name);
    return acc + (entry ? entry.value : 0);
  }, 0);

  const recentCategoryTrend = categoryTrend.slice(-12);
  const quarterCategoryTrend = categoryTrend.slice(-4);
  const categoryComparison = EXPENSE_CATEGORY_COLUMNS
    .map((c) => {
      const lastMonth = Math.abs(current[c.index] || 0);
      const yearAvg = recentCategoryTrend.length ? sumCategory(recentCategoryTrend, c.name) / recentCategoryTrend.length : 0;
      const quarterAvg = quarterCategoryTrend.length ? sumCategory(quarterCategoryTrend, c.name) / quarterCategoryTrend.length : 0;
      const diff = lastMonth - yearAvg;
      const pct = yearAvg > 0 ? (diff / yearAvg) * 100 : (lastMonth > 0 ? 100 : 0);
      return { name: c.name, color: categoryColors[c.name] || '#9ca3af', lastMonth, quarterAvg, yearAvg, diff, pct };
    })
    .filter((c) => c.lastMonth > 0 || c.quarterAvg > 0 || c.yearAvg > 0);

  const { netWorth, accounts } = parseBalance(balanceRows);

  const report = {
    month: current[0],
    income: current[1] || 0,
    expenses: current[2] || 0,
    saved: current[12] || 0,
    last12,
    savingsTrend,
    categoryTrend,
    categoryBreakdown,
    categoryComparison,
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

function renderCategoryComparison(categories) {
  const container = document.getElementById('category-comparison');
  container.innerHTML = '';

  if (!categories.length) {
    container.innerHTML = '<p class="hint">No category data yet.</p>';
    return;
  }

  categories.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'cat-compare-row';

    const name = document.createElement('div');
    name.className = 'cat-compare-name';

    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.style.background = cat.color;

    name.append(dot, document.createTextNode(cat.name));

    const values = document.createElement('div');
    values.className = 'cat-compare-values';

    const last = document.createElement('span');
    last.textContent = formatCurrency(cat.lastMonth);

    const quarter = document.createElement('span');
    quarter.className = 'cat-compare-avg';
    quarter.textContent = `4mo avg ${formatCurrency(cat.quarterAvg)}`;

    const avg = document.createElement('span');
    avg.className = 'cat-compare-avg';
    avg.textContent = `12mo avg ${formatCurrency(cat.yearAvg)}`;

    const change = document.createElement('span');
    change.className = 'cat-compare-change';
    if (Math.abs(cat.diff) < 0.005) {
      change.textContent = '0%';
      change.classList.add('flat');
    } else {
      const sign = cat.diff > 0 ? '+' : '';
      change.textContent = `${sign}${cat.pct.toFixed(0)}%`;
      change.classList.add(cat.diff > 0 ? 'increase' : 'decrease');
    }

    values.append(last, quarter, avg, change);
    row.append(name, values);
    container.appendChild(row);
  });
}

function renderAccountsPanel(accounts) {
  const container = document.getElementById('accounts-panel');
  container.innerHTML = '';
  accounts.forEach((account) => container.appendChild(renderAccountRow(account)));
}

function renderAccountRow(account) {
  const row = document.createElement('div');
  row.className = 'account';

  const name = document.createElement('span');
  name.textContent = account.name;

  const actions = document.createElement('div');
  actions.className = 'account-actions';

  const value = document.createElement('strong');
  value.textContent = formatCurrency(account.balance);
  if (account.balance < 0) value.classList.add('expense');

  const editBtn = document.createElement('button');
  editBtn.className = 'btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => row.replaceWith(renderAccountEditRow(account)));

  actions.append(value, editBtn);
  row.append(name, actions);
  return row;
}

function renderAccountEditRow(account) {
  const row = document.createElement('div');
  row.className = 'account';

  const name = document.createElement('span');
  name.textContent = account.name;

  const actions = document.createElement('div');
  actions.className = 'account-actions';

  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.value = account.balance;
  input.className = 'account-balance-input';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const balance = Number(input.value) || 0;
    saveBtn.disabled = true;

    try {
      await updateValues(`${CONFIG.SHEETS.BALANCE}!A${account.row}`, [[balance]]);
      await refreshBalances();
    } catch (err) {
      alert(`Failed to update balance: ${err.message}`);
      saveBtn.disabled = false;
    }
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => row.replaceWith(renderAccountRow(account)));

  actions.append(input, saveBtn, cancelBtn);
  row.append(name, actions);

  input.focus();
  input.select();

  return row;
}

async function refreshBalances() {
  const resp = await getValues(BALANCE_RANGE, VALUE_PARAMS);
  const { netWorth, accounts } = parseBalance(resp.values || []);

  if (currentReport) {
    currentReport.netWorth = netWorth;
    currentReport.accounts = accounts;
    setCached('report', currentReport);
  }

  document.getElementById('net-worth').textContent = formatCurrency(netWorth);
  renderAccountsPanel(accounts);
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
    currentReport = report;
    renderSummaryCards(report);
    renderCategoryComparisonChart(report.categoryComparison);
    renderCategoryComparison(report.categoryComparison);
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

  try {
    await initAccountManager(forceRefresh);
  } catch (err) {
    console.error('Failed to load accounts:', err);
    showDashboardError(err.message);
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

  initCsvControls();
  setupScrollSpy();
});
