const ACCOUNTS_RANGE = `'${CONFIG.SHEETS.ACCOUNTS}'!A3:D100`;

let allAccounts = [];
let accountsSheetId = null;
let editingAccountRow = null;
let accountListenersAttached = false;
let accountSort = { key: null, dir: 1 };

async function initAccountManager(forceRefresh = false) {
  let meta = forceRefresh ? null : getCached('accounts-meta');

  if (!meta) {
    const spreadsheet = await getSpreadsheetMetadata();
    meta = { accountsSheetId: findSheetId(spreadsheet, CONFIG.SHEETS.ACCOUNTS) };
    setCached('accounts-meta', meta);
  }

  accountsSheetId = meta.accountsSheetId;

  await refreshAccountsList(forceRefresh);

  if (!accountListenersAttached) {
    accountListenersAttached = true;
    document.getElementById('add-account-btn').addEventListener('click', () => openAccountForm());
    document.getElementById('account-cancel-btn').addEventListener('click', closeAccountForm);
    onFormSubmit('account-form', submitAccountForm);
    setupAccountSorting();
  }
}

function setupAccountSorting() {
  makeSortableHeaders('#accounts-table', accountSort, renderAccountsList);
}

function getSortedAccounts() {
  if (!accountSort.key) return allAccounts;

  const { key, dir } = accountSort;
  return [...allAccounts].sort((a, b) => {
    if (key === 'balance') return (a.balance - b.balance) * dir;
    return a[key].localeCompare(b[key], undefined, { sensitivity: 'base' }) * dir;
  });
}

async function refreshAccountsList(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('account-list');

  if (!values) {
    const resp = await getValues(ACCOUNTS_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('account-list', values);
  }

  allAccounts = values.map((row, i) => ({
    row: i + 3,
    name: row[0] || '',
    institution: row[1] || '',
    type: row[2] || '',
    balance: Number(row[3]) || 0,
  }));

  renderAccountsList();
  renderAccountCompositionChart(allAccounts);
}

function renderAccountsList() {
  const tbody = document.getElementById('accounts-list-body');
  tbody.innerHTML = '';

  const sortedAccounts = getSortedAccounts();
  if (sortedAccounts.length === 0) {
    tbody.appendChild(renderEmptyRow(5, 'No accounts yet — add your first one above.'));
  }

  sortedAccounts.forEach((account) => {
    const tr = document.createElement('tr');

    const nameCell = makeCell(account.name);
    const institutionCell = makeCell(account.institution);
    const typeCell = makeCell(account.type);

    const balanceCell = makeCell(formatCurrency(account.balance));
    balanceCell.className = account.balance < 0 ? 'expense' : 'income';

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openAccountForm(account) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteAccount(account.row) }),
    );

    tr.append(nameCell, institutionCell, typeCell, balanceCell, actionsCell);
    tbody.appendChild(tr);
  });
}

function openAccountForm(account) {
  editingAccountRow = account ? account.row : null;

  document.getElementById('account-modal-title').textContent = account ? 'Edit Account' : 'Add Account';
  document.getElementById('account-name').value = account ? account.name : '';
  document.getElementById('account-institution').value = account ? account.institution : '';
  document.getElementById('account-type').value = account ? account.type : '';
  document.getElementById('account-balance').value = account ? account.balance.toFixed(2) : '0.00';

  clearFieldError('account-form-error');
  document.getElementById('account-modal').hidden = false;
}

function closeAccountForm() {
  document.getElementById('account-modal').hidden = true;
  editingAccountRow = null;
}

async function submitAccountForm(event) {
  event.preventDefault();

  const balance = evaluateNumberExpression(document.getElementById('account-balance').value);
  if (balance === null) {
    showFieldError('account-form-error', 'Balance must be a number or a simple expression, e.g. =5000-1234.56');
    return;
  }

  const values = [[
    document.getElementById('account-name').value,
    document.getElementById('account-institution').value,
    document.getElementById('account-type').value,
    balance,
  ]];

  try {
    if (editingAccountRow) {
      await updateValues(`'${CONFIG.SHEETS.ACCOUNTS}'!A${editingAccountRow}:D${editingAccountRow}`, values);
    } else {
      await appendValues(ACCOUNTS_RANGE, values);
    }
    closeAccountForm();
    await refreshAccountsList(true);
    await refreshAccountOptions();
    await refreshNetWorth();
  } catch (err) {
    showFieldError('account-form-error', err.message);
  }
}

async function deleteAccount(row) {
  await confirmAndDelete('Delete this account?', async () => {
    await batchUpdate([{
      deleteDimension: {
        range: { sheetId: accountsSheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
      },
    }]);
    await refreshAccountsList(true);
    await refreshAccountOptions();
    await refreshNetWorth();
  });
}
