const TRANSACTIONS_RANGE = `${CONFIG.SHEETS.TRANSACTIONS}!A2:F`;
const PAGE_SIZE = 25;

let allTransactions = [];
let accountOptions = [];
let categoryOptions = [];
let transactionsSheetId = null;
let editingRow = null;
let currentPage = 1;
let listenersAttached = false;
let txSort = { key: null, dir: 1 };

async function initTransactions(forceRefresh = false) {
  let lists = forceRefresh ? null : getCached('lists');

  if (!lists) {
    const [meta, listsResp] = await Promise.all([
      getSpreadsheetMetadata(),
      batchGetValues([`'${CONFIG.SHEETS.ACCOUNTS}'!A3:A100`, `${CONFIG.SHEETS.CATEGORIES}!A2:A`], VALUE_PARAMS),
    ]);

    const sheet = meta.sheets.find((s) => s.properties.title === CONFIG.SHEETS.TRANSACTIONS);
    if (!sheet) {
      const available = meta.sheets.map((s) => s.properties.title).join(', ');
      throw new Error(`Sheet tab "${CONFIG.SHEETS.TRANSACTIONS}" not found. Available tabs: ${available}`);
    }
    lists = {
      transactionsSheetId: sheet.properties.sheetId,
      accountOptions: (listsResp.valueRanges[0].values || []).map((r) => r[0]).filter(Boolean),
      categoryOptions: (listsResp.valueRanges[1].values || []).map((r) => r[0]).filter(Boolean),
    };
    setCached('lists', lists);
  }

  transactionsSheetId = lists.transactionsSheetId;
  accountOptions = lists.accountOptions;
  categoryOptions = lists.categoryOptions;

  populateCategoryFilter();
  await refreshTransactions(forceRefresh);

  if (!listenersAttached) {
    listenersAttached = true;
    document.getElementById('add-transaction-btn').addEventListener('click', () => openTransactionForm());
    document.getElementById('tx-cancel-btn').addEventListener('click', closeTransactionForm);
    document.getElementById('tx-form').addEventListener('submit', submitTransactionForm);
    document.getElementById('tx-search').addEventListener('input', () => {
      currentPage = 1;
      renderTransactions();
    });
    document.getElementById('tx-category-filter').addEventListener('change', () => {
      currentPage = 1;
      renderTransactions();
    });
    setupTransactionSorting();
  }
}

function setupTransactionSorting() {
  document.querySelectorAll('#transactions-table th.sortable').forEach((th) => {
    const label = document.createElement('span');
    label.textContent = th.textContent;

    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';

    th.textContent = '';
    th.append(label, indicator);

    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (txSort.key === key) {
        txSort.dir *= -1;
      } else {
        txSort.key = key;
        txSort.dir = 1;
      }
      updateTransactionSortIndicators();
      currentPage = 1;
      renderTransactions();
    });
  });
}

function updateTransactionSortIndicators() {
  document.querySelectorAll('#transactions-table th.sortable').forEach((th) => {
    const indicator = th.querySelector('.sort-indicator');
    if (th.dataset.sort === txSort.key) {
      indicator.textContent = txSort.dir === 1 ? ' ▲' : ' ▼';
    } else {
      indicator.textContent = '';
    }
  });
}

async function refreshTransactions(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('transactions');

  if (!values) {
    const resp = await getValues(TRANSACTIONS_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('transactions', values);
  }

  allTransactions = values.map((row, i) => ({
    row: i + 2,
    date: row[0] || '',
    account: row[1] || '',
    payee: row[2] || '',
    description: row[3] || '',
    amount: Number(row[4]) || 0,
    category: row[5] || '',
  }));
  renderTransactions();
}

async function refreshAccountOptions() {
  const { valueRanges } = await batchGetValues(
    [`'${CONFIG.SHEETS.ACCOUNTS}'!A3:A100`, `${CONFIG.SHEETS.CATEGORIES}!A2:A`],
    VALUE_PARAMS
  );

  accountOptions = (valueRanges[0].values || []).map((r) => r[0]).filter(Boolean);
  categoryOptions = (valueRanges[1].values || []).map((r) => r[0]).filter(Boolean);

  setCached('lists', { transactionsSheetId, accountOptions, categoryOptions });
  populateCategoryFilter();
}

function populateCategoryFilter() {
  const select = document.getElementById('tx-category-filter');
  select.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Categories';
  select.appendChild(allOption);

  categoryOptions.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });
}

function getFilteredTransactions() {
  const search = document.getElementById('tx-search').value.trim().toLowerCase();
  const category = document.getElementById('tx-category-filter').value;

  const filtered = allTransactions
    .filter((t) => !category || t.category === category)
    .filter((t) => {
      if (!search) return true;
      return (
        t.payee.toLowerCase().includes(search) ||
        t.description.toLowerCase().includes(search) ||
        t.account.toLowerCase().includes(search) ||
        t.category.toLowerCase().includes(search)
      );
    });

  if (!txSort.key) return filtered.reverse();

  const { key, dir } = txSort;
  return [...filtered].sort((a, b) => {
    if (key === 'amount') return (a.amount - b.amount) * dir;
    return String(a[key]).localeCompare(String(b[key]), undefined, { sensitivity: 'base' }) * dir;
  });
}

function renderTransactions() {
  const filtered = getFilteredTransactions();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('transactions-body');
  tbody.innerHTML = '';

  pageItems.forEach((t) => {
    const tr = document.createElement('tr');

    const dateCell = document.createElement('td');
    dateCell.textContent = t.date;

    const payeeCell = document.createElement('td');
    payeeCell.textContent = t.payee;

    const descCell = document.createElement('td');
    descCell.textContent = t.description;

    const categoryCell = document.createElement('td');
    categoryCell.textContent = t.category;

    const amountCell = document.createElement('td');
    amountCell.textContent = formatCurrency(t.amount);
    amountCell.className = t.amount >= 0 ? 'income' : 'expense';

    const actionsCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.addEventListener('click', () => openTransactionForm(t));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', () => deleteTransaction(t.row));

    actionsCell.append(editBtn, deleteBtn);

    tr.append(dateCell, payeeCell, descCell, categoryCell, amountCell, actionsCell);
    tbody.appendChild(tr);
  });

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = document.getElementById('tx-pagination');
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const prev = document.createElement('button');
  prev.className = 'btn';
  prev.textContent = 'Prev';
  prev.disabled = currentPage === 1;
  prev.addEventListener('click', () => {
    currentPage--;
    renderTransactions();
  });

  const info = document.createElement('span');
  info.textContent = `Page ${currentPage} of ${totalPages}`;

  const next = document.createElement('button');
  next.className = 'btn';
  next.textContent = 'Next';
  next.disabled = currentPage === totalPages;
  next.addEventListener('click', () => {
    currentPage++;
    renderTransactions();
  });

  container.append(prev, info, next);
}

function populateSelect(select, options, selected) {
  select.innerHTML = '';
  const values = !selected || options.includes(selected) ? options : [selected, ...options];

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    if (value === selected) option.selected = true;
    select.appendChild(option);
  });
}

function openTransactionForm(transaction) {
  editingRow = transaction ? transaction.row : null;

  document.getElementById('tx-modal-title').textContent = transaction ? 'Edit Transaction' : 'Add Transaction';
  document.getElementById('tx-date').value = transaction ? transaction.date : new Date().toISOString().slice(0, 10);
  document.getElementById('tx-payee').value = transaction ? transaction.payee : '';
  document.getElementById('tx-description').value = transaction ? transaction.description : '';
  document.getElementById('tx-amount').value = transaction ? transaction.amount : '';

  populateSelect(document.getElementById('tx-account'), accountOptions, transaction ? transaction.account : '');
  populateSelect(document.getElementById('tx-category'), categoryOptions, transaction ? transaction.category : '');

  document.getElementById('tx-save-add-btn').hidden = !!transaction;

  document.getElementById('tx-form-error').hidden = true;
  document.getElementById('tx-modal').hidden = false;
}

function closeTransactionForm() {
  document.getElementById('tx-modal').hidden = true;
  editingRow = null;
}

async function submitTransactionForm(event) {
  event.preventDefault();

  const keepOpen = event.submitter?.id === 'tx-save-add-btn';

  const values = [[
    document.getElementById('tx-date').value,
    document.getElementById('tx-account').value,
    document.getElementById('tx-payee').value,
    document.getElementById('tx-description').value,
    Number(document.getElementById('tx-amount').value),
    document.getElementById('tx-category').value,
  ]];

  try {
    if (editingRow) {
      await updateValues(`${CONFIG.SHEETS.TRANSACTIONS}!A${editingRow}:F${editingRow}`, values);
    } else {
      await appendValues(TRANSACTIONS_RANGE, values);
    }
    await refreshTransactions(true);

    if (keepOpen) {
      document.getElementById('tx-description').value = '';
      document.getElementById('tx-amount').value = '';
      document.getElementById('tx-form-error').hidden = true;
      document.getElementById('tx-description').focus();
    } else {
      closeTransactionForm();
    }
  } catch (err) {
    const errorEl = document.getElementById('tx-form-error');
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

async function deleteTransaction(row) {
  if (!confirm('Delete this transaction?')) return;

  try {
    await batchUpdate([{
      deleteDimension: {
        range: { sheetId: transactionsSheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
      },
    }]);
    await refreshTransactions(true);
  } catch (err) {
    alert(`Failed to delete: ${err.message}`);
  }
}
