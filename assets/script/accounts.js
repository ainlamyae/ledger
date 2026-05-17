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
    const sheet = spreadsheet.sheets.find((s) => s.properties.title === CONFIG.SHEETS.ACCOUNTS);
    if (!sheet) {
      const available = spreadsheet.sheets.map((s) => s.properties.title).join(', ');
      throw new Error(`Sheet tab "${CONFIG.SHEETS.ACCOUNTS}" not found. Available tabs: ${available}`);
    }
    meta = { accountsSheetId: sheet.properties.sheetId };
    setCached('accounts-meta', meta);
  }

  accountsSheetId = meta.accountsSheetId;

  await refreshAccountsList(forceRefresh);

  if (!accountListenersAttached) {
    accountListenersAttached = true;
    document.getElementById('add-account-btn').addEventListener('click', () => openAccountForm());
    document.getElementById('account-cancel-btn').addEventListener('click', closeAccountForm);
    document.getElementById('account-form').addEventListener('submit', submitAccountForm);
    setupAccountSorting();
  }
}

function setupAccountSorting() {
  document.querySelectorAll('#accounts-table th.sortable').forEach((th) => {
    const label = document.createElement('span');
    label.textContent = th.textContent;

    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';

    th.textContent = '';
    th.append(label, indicator);

    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (accountSort.key === key) {
        accountSort.dir *= -1;
      } else {
        accountSort.key = key;
        accountSort.dir = 1;
      }
      updateAccountSortIndicators();
      renderAccountsList();
    });
  });
}

function updateAccountSortIndicators() {
  document.querySelectorAll('#accounts-table th.sortable').forEach((th) => {
    const indicator = th.querySelector('.sort-indicator');
    if (th.dataset.sort === accountSort.key) {
      indicator.textContent = accountSort.dir === 1 ? ' ▲' : ' ▼';
    } else {
      indicator.textContent = '';
    }
  });
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
}

function renderAccountsList() {
  const tbody = document.getElementById('accounts-list-body');
  tbody.innerHTML = '';

  getSortedAccounts().forEach((account) => {
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = account.name;

    const institutionCell = document.createElement('td');
    institutionCell.textContent = account.institution;

    const typeCell = document.createElement('td');
    typeCell.textContent = account.type;

    const balanceCell = document.createElement('td');
    balanceCell.textContent = formatCurrency(account.balance);
    balanceCell.className = account.balance < 0 ? 'expense' : 'income';

    const actionsCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.addEventListener('click', () => openAccountForm(account));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', () => deleteAccount(account.row));

    actionsCell.append(editBtn, deleteBtn);

    tr.append(nameCell, institutionCell, typeCell, balanceCell, actionsCell);
    tbody.appendChild(tr);
  });
}

function openAccountForm(account) {
  editingAccountRow = account ? account.row : null;

  const typeSelect = document.getElementById('account-type');
  const validTypes = [...typeSelect.options].map((o) => o.value);

  document.getElementById('account-modal-title').textContent = account ? 'Edit Account' : 'Add Account';
  document.getElementById('account-name').value = account ? account.name : '';
  document.getElementById('account-institution').value = account ? account.institution : '';
  typeSelect.value = account && validTypes.includes(account.type) ? account.type : validTypes[0];
  document.getElementById('account-balance').value = account ? account.balance : 0;

  document.getElementById('account-form-error').hidden = true;
  document.getElementById('account-modal').hidden = false;
}

function closeAccountForm() {
  document.getElementById('account-modal').hidden = true;
  editingAccountRow = null;
}

async function submitAccountForm(event) {
  event.preventDefault();

  const values = [[
    document.getElementById('account-name').value,
    document.getElementById('account-institution').value,
    document.getElementById('account-type').value,
    Number(document.getElementById('account-balance').value) || 0,
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
    const errorEl = document.getElementById('account-form-error');
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

async function deleteAccount(row) {
  if (!confirm('Delete this account?')) return;

  try {
    await batchUpdate([{
      deleteDimension: {
        range: { sheetId: accountsSheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
      },
    }]);
    await refreshAccountsList(true);
    await refreshAccountOptions();
    await refreshNetWorth();
  } catch (err) {
    alert(`Failed to delete: ${err.message}`);
  }
}
