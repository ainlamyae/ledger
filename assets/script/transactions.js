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
let selectedRows = new Set();
let transactionsDirtyFromAdd = false;
// Same purpose as physique.js's physiqueDataLoaded — lets a click that races
// the initial fetch (e.g. Financial Insight) tell "not loaded yet" apart
// from "loaded, zero transactions".
let transactionsDataLoaded = false;

async function initTransactions(forceRefresh = false) {
  let lists = forceRefresh ? null : getCached('lists');

  if (!lists) {
    const [meta, listsResp] = await Promise.all([
      getSpreadsheetMetadata(),
      batchGetValues([`'${CONFIG.SHEETS.ACCOUNTS}'!A3:A100`, `${CONFIG.SHEETS.INSIGHT}!A2:A200`], VALUE_PARAMS),
    ]);

    lists = {
      transactionsSheetId: findSheetId(meta, CONFIG.SHEETS.TRANSACTIONS),
      accountOptions: (listsResp.valueRanges[0].values || []).map((r) => r[0]).filter(Boolean),
      // Insight!A2:A200 repeats each category once per Type plus one
      // blank-Type total row, so collapse to a unique list.
      categoryOptions: [...new Set((listsResp.valueRanges[1].values || []).map((r) => r[0]).filter(Boolean))],
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
    onFormSubmit('tx-form', submitTransactionForm);

    // Deferred full refresh when the modal closes after a keepOpen add sequence.
    // Covers all close paths: Cancel button, Escape key, and normal Save.
    new MutationObserver(() => {
      const modal = document.getElementById('tx-modal');
      if (modal.hidden && transactionsDirtyFromAdd) {
        transactionsDirtyFromAdd = false;
        refreshTransactions(true);
      }
    }).observe(document.getElementById('tx-modal'), { attributes: true, attributeFilter: ['hidden'] });
    document.getElementById('tx-search').addEventListener('input', resetTransactionsPageAndRender);
    document.getElementById('tx-category-filter').addEventListener('change', resetTransactionsPageAndRender);
    document.getElementById('export-date-from').addEventListener('input', resetTransactionsPageAndRender);
    document.getElementById('export-date-to').addEventListener('input', resetTransactionsPageAndRender);

    document.getElementById('tx-advanced-filters-toggle').addEventListener('click', () => {
      const panel = document.getElementById('tx-advanced-filters');
      panel.hidden = !panel.hidden;
    });

    setupTransactionSorting();
    setupBulkActions();
  }
}

function setupBulkActions() {
  document.getElementById('tx-select-all').addEventListener('change', (e) => {
    const pageRows = getFilteredTransactions().slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    pageRows.forEach((t) => (e.target.checked ? selectedRows.add(t.row) : selectedRows.delete(t.row)));
    renderTransactions();
  });

  onAsyncClick('tx-bulk-delete-btn', bulkDeleteTransactions);
  document.getElementById('tx-bulk-edit-btn').addEventListener('click', openBulkEditForm);
  document.getElementById('tx-bulk-edit-cancel-btn').addEventListener('click', closeBulkEditForm);
  onFormSubmit('tx-bulk-edit-form', submitBulkEditForm);
}

function updateBulkActionsUI() {
  const bar = document.getElementById('tx-bulk-actions');
  const selected = allTransactions.filter((t) => selectedRows.has(t.row));

  bar.hidden = selected.length === 0;
  const total = selected.reduce((sum, t) => sum + t.amount, 0);
  document.getElementById('tx-bulk-summary').textContent =
    selected.length > 0 ? `${selected.length} selected — total ${formatCurrency(total)}` : '';
}

function setupTransactionSorting() {
  makeSortableHeaders('#transactions-table', txSort, () => {
    currentPage = 1;
    selectedRows.clear();
    renderTransactions();
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
    category: row[3] || '',
    description: row[4] || '',
    amount: Number(row[5]) || 0,
  }));
  transactionsDataLoaded = true;
  renderTransactions();
  populateAutocompleteOptions();
  syncExportAccountOptions();
}

// Fills the Payee/Description datalists with previously used values so the
// browser can suggest and auto-correct entries (including voice dictation)
// against the user's own history. Most frequently used values come first.
function populateAutocompleteOptions() {
  const fillDatalist = (datalistId, values) => {
    const counts = new Map();
    values.forEach((value) => {
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);

    const datalist = document.getElementById(datalistId);
    datalist.innerHTML = '';
    sorted.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      datalist.appendChild(option);
    });
  };

  fillDatalist('tx-payee-options', allTransactions.map((t) => t.payee));
  fillDatalist('tx-description-options', allTransactions.map((t) => t.description));
  // Categories come from both the Insight sheet's known list and whatever
  // has actually been typed on past transactions (e.g. "Income"), so the
  // suggestions aren't limited to a hardcoded or sheet-only set.
  fillDatalist('tx-category-options', [...categoryOptions, ...allTransactions.map((t) => t.category)]);
}

async function refreshAccountOptions() {
  const { valueRanges } = await batchGetValues(
    [`'${CONFIG.SHEETS.ACCOUNTS}'!A3:A100`, `${CONFIG.SHEETS.INSIGHT}!A2:A200`],
    VALUE_PARAMS
  );

  accountOptions = (valueRanges[0].values || []).map((r) => r[0]).filter(Boolean);
  categoryOptions = [...new Set((valueRanges[1].values || []).map((r) => r[0]).filter(Boolean))];

  setCached('lists', { transactionsSheetId, accountOptions, categoryOptions });
  populateCategoryFilter();
  syncExportAccountOptions();
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
  const dateFrom = document.getElementById('export-date-from').value;
  const dateTo = document.getElementById('export-date-to').value;
  const advancedFilters = getExportFilters();

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
    })
    .filter((t) => (!dateFrom || t.date >= dateFrom) && (!dateTo || t.date <= dateTo))
    .filter((t) => transactionMatchesExportFilters(t, advancedFilters));

  if (!txSort.key) return filtered.reverse();

  const { key, dir } = txSort;
  return [...filtered].sort((a, b) => {
    if (key === 'amount') return (a.amount - b.amount) * dir;
    return String(a[key]).localeCompare(String(b[key]), undefined, { sensitivity: 'base' }) * dir;
  });
}

// Reflects the *full* filtered set (all matches, not just the current
// page) so it always matches what Export CSV will actually produce.
function updateFilterSummary(filtered) {
  const total = filtered.reduce((sum, t) => sum + t.amount, 0);
  document.getElementById('export-summary-text').textContent =
    `${filtered.length} transaction${filtered.length === 1 ? '' : 's'} — total ${formatCurrency(total)}`;
}

// Shared by every filter control (search, category, date range, advanced
// filters) — a changed filter invalidates the current page/selection.
function resetTransactionsPageAndRender() {
  currentPage = 1;
  selectedRows.clear();
  renderTransactions();
}

function renderTransactions() {
  const filtered = getFilteredTransactions();
  updateFilterSummary(filtered);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('transactions-body');
  tbody.innerHTML = '';

  if (pageItems.length === 0) {
    const message = allTransactions.length === 0
      ? 'No transactions yet — add your first one above.'
      : 'No transactions match your search/filter.';
    tbody.appendChild(renderEmptyRow(8, message));
  }

  pageItems.forEach((t) => {
    const tr = document.createElement('tr');

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedRows.has(t.row);
    checkbox.setAttribute('aria-label', 'Select transaction');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedRows.add(t.row);
      else selectedRows.delete(t.row);
      updateBulkActionsUI();
      updateSelectAllCheckbox(pageItems);
    });
    checkboxCell.appendChild(checkbox);

    const dateCell = document.createElement('td');
    dateCell.textContent = t.date;

    const accountCell = document.createElement('td');
    accountCell.textContent = t.account;

    const payeeCell = document.createElement('td');
    payeeCell.textContent = t.payee;
    payeeCell.title = t.payee;

    const descCell = document.createElement('td');
    descCell.textContent = t.description;
    descCell.title = t.description;

    const categoryCell = document.createElement('td');
    categoryCell.textContent = t.category;

    const amountCell = document.createElement('td');
    amountCell.textContent = formatCurrency(t.amount);
    amountCell.className = t.amount >= 0 ? 'income' : 'expense';

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openTransactionForm(t) }),
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => openTransactionForm(t, true) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteTransaction(t.row) }),
    );

    tr.append(checkboxCell, dateCell, accountCell, payeeCell, categoryCell, descCell, amountCell, actionsCell);
    tbody.appendChild(tr);
  });

  updateSelectAllCheckbox(pageItems);
  updateBulkActionsUI();
  renderPagination(totalPages);
}

function updateSelectAllCheckbox(pageItems) {
  const selectAll = document.getElementById('tx-select-all');
  const selectedOnPage = pageItems.filter((t) => selectedRows.has(t.row)).length;
  selectAll.checked = pageItems.length > 0 && selectedOnPage === pageItems.length;
  selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageItems.length;
}

function renderPagination(totalPages) {
  renderPager('tx-pagination', {
    page: currentPage,
    totalPages,
    onChange: (p) => {
      currentPage = p;
      selectedRows.clear();
      renderTransactions();
    },
  });
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

function openTransactionForm(transaction, duplicate = false) {
  editingRow = (transaction && !duplicate) ? transaction.row : null;

  const title = duplicate ? 'Duplicate Transaction' : (transaction ? 'Edit Transaction' : 'Log a Transaction');
  document.getElementById('tx-modal-title').textContent = title;
  document.getElementById('tx-date').value = transaction ? transaction.date : new Date().toISOString().slice(0, 10);
  document.getElementById('tx-payee').value = transaction ? transaction.payee : '';
  document.getElementById('tx-description').value = transaction ? transaction.description : '';
  document.getElementById('tx-amount').value = transaction ? transaction.amount : '';

  populateSelect(document.getElementById('tx-account'), accountOptions, transaction ? transaction.account : '');
  document.getElementById('tx-category').value = transaction ? transaction.category : '';

  // A duplicate is a new row (like Add), not an in-place edit, so "Save & Add
  // Another" should be offered just like it is for a brand-new transaction.
  document.getElementById('tx-save-add-btn').hidden = !!transaction && !duplicate;

  clearFieldError('tx-form-error');
  document.getElementById('tx-modal').hidden = false;
}

function closeTransactionForm() {
  document.getElementById('tx-modal').hidden = true;
  editingRow = null;
}

async function submitTransactionForm(event) {
  event.preventDefault();

  const keepOpen = event.submitter?.id === 'tx-save-add-btn';

  const amount = evaluateNumberExpression(document.getElementById('tx-amount').value);
  if (amount === null) {
    showFieldError('tx-form-error', 'Amount must be a number or a simple expression, e.g. =-9.97-1.30');
    return;
  }

  const values = [[
    document.getElementById('tx-date').value,
    document.getElementById('tx-account').value,
    document.getElementById('tx-payee').value,
    document.getElementById('tx-category').value,
    document.getElementById('tx-description').value,
    amount,
  ]];

  try {
    if (editingRow) {
      await updateValues(`${CONFIG.SHEETS.TRANSACTIONS}!A${editingRow}:F${editingRow}`, values);
    } else {
      await appendValues(TRANSACTIONS_RANGE, values);
    }
    if (keepOpen) {
      // Optimistic local append — no API re-fetch, no datalist rebuild, no .focus() call.
      // Rebuilding datalists while a form input is focused freezes iOS WebKit.
      // The deferred MutationObserver on tx-modal triggers a full refresh on close.
      const [date, account, payee, category, description, amt] = values[0];
      const nextRow = allTransactions.length > 0 ? allTransactions[allTransactions.length - 1].row + 1 : 2;
      allTransactions.push({ row: nextRow, date, account, payee, category, description, amount: amt });
      renderTransactions();
      document.getElementById('tx-description').value = '';
      document.getElementById('tx-amount').value = '';
      clearFieldError('tx-form-error');
      transactionsDirtyFromAdd = true;
    } else {
      await refreshTransactions(true);
      closeTransactionForm();
    }
  } catch (err) {
    showFieldError('tx-form-error', err.message);
  }
}

// A field is prefilled when every selected transaction shares the same
// value for it; otherwise it's left blank, meaning "leave unchanged" when
// submitBulkEditForm reads it back.
function sharedFieldValue(selected, field) {
  const first = selected[0][field];
  return selected.every((t) => t[field] === first) ? first : '';
}

function openBulkEditForm() {
  const selected = allTransactions.filter((t) => selectedRows.has(t.row));
  if (selected.length === 0) return;

  document.getElementById('tx-bulk-date').value = sharedFieldValue(selected, 'date');
  document.getElementById('tx-bulk-payee').value = sharedFieldValue(selected, 'payee');
  document.getElementById('tx-bulk-description').value = sharedFieldValue(selected, 'description');
  document.getElementById('tx-bulk-category').value = sharedFieldValue(selected, 'category');

  const sharedAmount = selected.every((t) => t.amount === selected[0].amount) ? selected[0].amount : '';
  document.getElementById('tx-bulk-amount').value = sharedAmount;

  const accountSelect = document.getElementById('tx-bulk-account');
  const sharedAccount = sharedFieldValue(selected, 'account');
  populateSelect(accountSelect, accountOptions, sharedAccount || undefined);
  accountSelect.insertAdjacentHTML('afterbegin', '<option value="">— Leave unchanged —</option>');
  if (!sharedAccount) accountSelect.value = '';

  clearFieldError('tx-bulk-edit-form-error');
  document.getElementById('tx-bulk-edit-modal').hidden = false;
}

function closeBulkEditForm() {
  document.getElementById('tx-bulk-edit-modal').hidden = true;
}

async function submitBulkEditForm(event) {
  event.preventDefault();

  const patch = {};

  const date = document.getElementById('tx-bulk-date').value;
  if (date) patch.date = date;
  const account = document.getElementById('tx-bulk-account').value;
  if (account) patch.account = account;
  const payee = document.getElementById('tx-bulk-payee').value;
  if (payee) patch.payee = payee;
  const description = document.getElementById('tx-bulk-description').value;
  if (description) patch.description = description;
  const category = document.getElementById('tx-bulk-category').value;
  if (category) patch.category = category;

  const amountInput = document.getElementById('tx-bulk-amount').value;
  if (amountInput) {
    const amount = evaluateNumberExpression(amountInput);
    if (amount === null) {
      showFieldError('tx-bulk-edit-form-error', 'Amount must be a number or a simple expression, e.g. =-9.97-1.30');
      return;
    }
    patch.amount = amount;
  }

  if (Object.keys(patch).length === 0) {
    showFieldError('tx-bulk-edit-form-error', 'Change at least one field.');
    return;
  }

  const selected = allTransactions.filter((t) => selectedRows.has(t.row));
  const snapshots = selected.map((t) => ({ ...t }));

  try {
    await Promise.all(selected.map((t) => {
      const merged = { ...t, ...patch };
      return updateValues(`${CONFIG.SHEETS.TRANSACTIONS}!A${t.row}:F${t.row}`,
        [[merged.date, merged.account, merged.payee, merged.category, merged.description, merged.amount]]);
    }));

    selectedRows.clear();
    await refreshTransactions(true);
    closeBulkEditForm();
    showUndoToast(`${selected.length} transaction(s) updated.`, () => restoreBulkEdit(snapshots));
  } catch (err) {
    showFieldError('tx-bulk-edit-form-error', err.message);
  }
}

// Unlike restoreTransactions (which re-appends deleted rows at the end since
// their original rows are gone), a bulk edit's rows still exist — restoring
// just means writing each snapshot's values back in place.
async function restoreBulkEdit(snapshots) {
  try {
    await Promise.all(snapshots.map((t) =>
      updateValues(`${CONFIG.SHEETS.TRANSACTIONS}!A${t.row}:F${t.row}`,
        [[t.date, t.account, t.payee, t.category, t.description, t.amount]])));
    await refreshTransactions(true);
  } catch (err) {
    alert(`Failed to restore: ${err.message}`);
  }
}

async function deleteTransaction(row) {
  const tx = allTransactions.find((t) => t.row === row);

  await confirmAndDelete('Delete this transaction?', async () => {
    await batchUpdate([{
      deleteDimension: {
        range: { sheetId: transactionsSheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
      },
    }]);
    await refreshTransactions(true);
    if (tx) showUndoToast('Transaction deleted.', () => restoreTransactions([tx]));
  });
}

async function bulkDeleteTransactions() {
  const selected = allTransactions.filter((t) => selectedRows.has(t.row));
  if (selected.length === 0) return;

  await confirmAndDelete(`Delete ${selected.length} selected transaction(s)?`, async () => {
    // Descending by row so each request's startIndex/endIndex is still valid
    // by the time the API processes the next one in the same batchUpdate call.
    const requests = [...selected]
      .sort((a, b) => b.row - a.row)
      .map((t) => ({
        deleteDimension: {
          range: { sheetId: transactionsSheetId, dimension: 'ROWS', startIndex: t.row - 1, endIndex: t.row },
        },
      }));

    await batchUpdate(requests);
    selectedRows.clear();
    await refreshTransactions(true);
    showUndoToast(`${selected.length} transaction(s) deleted.`, () => restoreTransactions(selected));
  });
}

// Restores deleted transactions by re-appending their data — they land back
// at the end of the sheet rather than their original row, since Sheets rows
// are addressed by position and deleteDimension has already shifted
// everything below them.
async function restoreTransactions(txs) {
  const values = txs.map((t) => [t.date, t.account, t.payee, t.category, t.description, t.amount]);
  try {
    await appendValues(TRANSACTIONS_RANGE, values);
    await refreshTransactions(true);
  } catch (err) {
    alert(`Failed to restore: ${err.message}`);
  }
}
