const TRANSACTIONS_RANGE = sheetRange(CONFIG.SHEETS.TRANSACTIONS, 'A2:F');
const PAGE_SIZE = 25;
// The account names, and Breakdown's categories (repeated once per Type, so deduped).
const TRANSACTION_OPTION_RANGES = [sheetRange(CONFIG.SHEETS.ACCOUNTS, 'A3:A'), sheetRange(CONFIG.SHEETS.INSIGHT, 'A2:A')];
const TX_AMOUNT_ERROR = 'Amount must be a number or a simple expression, e.g. =-9.97-1.30';
// Filter controls; any change resets the page and selection.
const TRANSACTION_FILTER_EVENTS = [
  ['tx-account-filter', 'change'], ['tx-payee-filter', 'input'], ['tx-category-filter', 'change'],
  ['tx-description-filter', 'input'], ['export-date-from', 'input'], ['export-date-to', 'input'],
];

let allTransactions = [];
let editTransaction = null;
let accountOptions = [];
let categoryOptions = [];
let transactionsSheetId = null;
let editingRow = null;
// Account and amount the edited row had when opened, to reverse on save.
let editingOriginal = null;
let currentPage = 1;
let listenersAttached = false;
let txSort = { key: null, dir: 1 };
let selectedRows = new Set();
// Tells "not loaded yet" from "loaded, zero transactions" (like physiqueDataLoaded).
let transactionsDataLoaded = false;

// --- Helpers shared by the Finance transaction, account and breakdown files ---

// Rounded to the cent, so float sums like 32.799999999999996 don't reach the sheet.
function roundMoneyCents(value) {
  return Math.round(value * 100) / 100;
}

// A batchUpdate request deleting one 1-based sheet row.
function sheetRowDeleteRequest(sheetId, row) {
  return { deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } };
}

// Red for a negative amount, green otherwise.
function amountSignClass(value) {
  return value < 0 ? 'expense' : 'income';
}

// Fills a datalist with the non-blank values, most used first.
function fillFrequencyDatalist(datalistId, values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));

  const datalist = document.getElementById(datalistId);
  datalist.innerHTML = '';
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([value]) => {
      const option = document.createElement('option');
      option.value = value;
      datalist.appendChild(option);
    });
}

// --- Transactions ---

// Columns A–F, in sheet order.
const TRANSACTION_FIELDS = ['date', 'account', 'payee', 'category', 'description', 'amount'];

// Rows are written USER_ENTERED so Date parses; text is kept exactly as typed.
function transactionCellValue(field, value) {
  return field === 'date' || field === 'amount' ? value : sheetText(value);
}

function transactionRowValues(t) {
  return TRANSACTION_FIELDS.map((field) => transactionCellValue(field, t[field]));
}

function transactionRowRange(row, lastColumn = 'F') {
  return sheetRange(CONFIG.SHEETS.TRANSACTIONS, `A${row}:${lastColumn}${row}`);
}

// Per-cell writes of just `fields`, so other cells (a formula Amount) are left alone.
function transactionFieldUpdates(transactions, fields) {
  return transactions.flatMap((t) => fields.map((field) => ({
    range: sheetRange(CONFIG.SHEETS.TRANSACTIONS, `${String.fromCharCode(65 + TRANSACTION_FIELDS.indexOf(field))}${t.row}`),
    values: [[transactionCellValue(field, t[field])]],
  })));
}

function selectedTransactions() {
  return allTransactions.filter((t) => selectedRows.has(t.row));
}

function transactionPageSlice(list) {
  return list.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
}

async function initTransactions(forceRefresh = false) {
  const [meta, listsResp] = await Promise.all([
    getSpreadsheetMetadata(),
    batchGetValues(TRANSACTION_OPTION_RANGES, VALUE_PARAMS),
  ]);

  const sheetId = findSheetId(meta, CONFIG.SHEETS.TRANSACTIONS);
  applyTransactionOptionLists(listsResp.valueRanges);
  transactionsSheetId = sheetId;
  await refreshTransactions(forceRefresh);

  if (!listenersAttached) {
    listenersAttached = true;
    document.getElementById('add-transaction-btn').addEventListener('click', () => openTransactionForm());
    editTransaction = routedRowEdit('transaction', () => allTransactions, (t) => `${t.date} ${t.payee}`, (t) => openTransactionForm(t), {
      duplicate: (t) => openTransactionForm(t, true),
    });
    // finance/transaction/bulk-edit/ while rows are ticked.
    registerRecordRoute('transaction', (slug, sub) => {
      if (slug !== 'bulk-edit' || sub || !selectedRows.size) return null;
      openBulkEditForm();
      return 'Bulk Edit';
    });
    document.getElementById('tx-cancel-btn').addEventListener('click', closeTransactionForm);
    document.getElementById('tx-tax-btn').addEventListener('click', applyTaxToAmount);
    onFormSubmit('tx-form', submitTransactionForm);

    // Whether the balance can be updated depends on the account, so re-check on change.
    document.getElementById('tx-account').addEventListener('change', syncUpdateBalanceBox);
    document.getElementById('tx-account').addEventListener('change', syncTxAccountBalance);
    document.getElementById('tx-update-balance').addEventListener('change', (e) => {
      updateBalanceWanted = e.target.checked;
    });

    TRANSACTION_FILTER_EVENTS.forEach(([id, type]) => {
      document.getElementById(id).addEventListener(type, resetTransactionsPageAndRender);
    });

    makeSortableHeaders('#transactions-table', txSort, resetTransactionsPageAndRender);
    setupBulkActions();
  }
}

function setupBulkActions() {
  document.getElementById('tx-select-all').addEventListener('change', (e) => {
    transactionPageSlice(getFilteredTransactions())
      .forEach((t) => (e.target.checked ? selectedRows.add(t.row) : selectedRows.delete(t.row)));
    renderTransactions();
  });

  onAsyncClick('tx-bulk-delete-btn', bulkDeleteTransactions);
  document.getElementById('tx-bulk-edit-btn').addEventListener('click', () => {
    routeRecordEdit('transaction', { slug: 'bulk-edit', label: 'Bulk Edit' });
    openBulkEditForm();
  });
  document.getElementById('tx-bulk-edit-cancel-btn').addEventListener('click', closeBulkEditForm);
  onFormSubmit('tx-bulk-edit-form', submitBulkEditForm);
}

function updateBulkActionsUI() {
  const selected = selectedTransactions();
  document.getElementById('tx-bulk-actions').hidden = selected.length === 0;
  const total = selected.reduce((sum, t) => sum + t.amount, 0);
  document.getElementById('tx-bulk-summary').textContent =
    selected.length > 0 ? `${selected.length} selected — total ${formatCurrency(total)}` : '';
}

async function refreshTransactions(forceRefresh = false) {
  const resp = await getValues(TRANSACTIONS_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

  allTransactions = values.map((row, i) => ({
    row: i + 2,
    date: cellText(row[0]),
    account: cellText(row[1]),
    payee: cellText(row[2]),
    category: cellText(row[3]),
    description: cellText(row[4]),
    amount: Number(row[5]) || 0,
  }));
  transactionsDataLoaded = true;
  // Overdue payments need the transactions to see whether one was paid.
  if (accountsDataLoaded) {
    renderAccountPaymentBadge();
    renderAccountsList();
  }
  renderTransactions();
  updateTransactionStaleBadge();
  renderCarService();
  populateAutocompleteOptions();
  syncExportAccountOptions();
}

// A red "<days>d" badge on the Transaction tile once the newest date is this old.
const TRANSACTION_STALE_DAYS = 30;

function updateTransactionStaleBadge() {
  const last = allTransactions.reduce((max, t) => (/^\d{4}-\d{2}-\d{2}/.test(t.date) && t.date > max ? t.date : max), '');
  const days = last ? Math.round((dateFromIso(isoFromDate(new Date())) - dateFromIso(last.slice(0, 10))) / MS_PER_DAY) : 0;
  setPageBadge('finance', 'transaction', days > TRANSACTION_STALE_DAYS
    ? { text: `${days}d`, title: `Last transaction logged ${days} days ago (${last.slice(0, 10)})` }
    : null);
}

// Past values as suggestions, so typing (and dictation) matches the user's own history.
function populateAutocompleteOptions() {
  fillFrequencyDatalist('tx-payee-options', allTransactions.map((t) => t.payee));
  fillFrequencyDatalist('tx-description-options', allTransactions.map((t) => t.description));
  // Breakdown's list plus whatever was typed on past rows (e.g. "Income").
  fillFrequencyDatalist('tx-category-options', [...categoryOptions, ...allTransactions.map((t) => t.category)]);
}

async function refreshAccountOptions() {
  const { valueRanges } = await batchGetValues(TRANSACTION_OPTION_RANGES, VALUE_PARAMS);
  applyTransactionOptionLists(valueRanges);
  syncExportAccountOptions();
}

// Reads TRANSACTION_OPTION_RANGES' result into the option lists and their filters.
function applyTransactionOptionLists(valueRanges) {
  accountOptions = (valueRanges[0].values || []).map((r) => cellText(r[0])).filter(Boolean);
  categoryOptions = [...new Set((valueRanges[1].values || []).map((r) => cellText(r[0])).filter(Boolean))];
  populateTransactionFilter('tx-account-filter', 'All Accounts', accountOptions);
  populateTransactionFilter('tx-category-filter', 'All Categories', categoryOptions);
}

// A filter select: an "all" option (value '') then one per value.
function populateTransactionFilter(selectId, allLabel, values) {
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  [['', allLabel], ...values.map((value) => [value, value])].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
}

function getFilteredTransactions() {
  const account = document.getElementById('tx-account-filter').value;
  // Substring, so part of a payee narrows before one is picked from the list.
  const payee = document.getElementById('tx-payee-filter').value.trim().toLowerCase();
  const category = document.getElementById('tx-category-filter').value;
  const description = document.getElementById('tx-description-filter').value.trim().toLowerCase();
  const dateFrom = document.getElementById('export-date-from').value;
  const dateTo = document.getElementById('export-date-to').value;
  const advancedFilters = getExportFilters();

  const filtered = allTransactions
    .filter((t) => !account || t.account === account)
    .filter((t) => !payee || t.payee.toLowerCase().includes(payee))
    .filter((t) => !category || t.category === category)
    .filter((t) => !description || t.description.toLowerCase().includes(description))
    .filter((t) => (!dateFrom || t.date >= dateFrom) && (!dateTo || t.date <= dateTo))
    .filter((t) => transactionMatchesExportFilters(t, advancedFilters));

  if (!txSort.key) return filtered.reverse();

  const { key, dir } = txSort;
  return [...filtered].sort((a, b) => {
    if (key === 'amount') return (a.amount - b.amount) * dir;
    return String(a[key]).localeCompare(String(b[key]), undefined, { sensitivity: 'base' }) * dir;
  });
}

// Any filter or sort change invalidates the current page and selection.
function resetTransactionsPageAndRender() {
  currentPage = 1;
  selectedRows.clear();
  renderTransactions();
}

// Display-only truncation; the full text is in the cell's title and the form.
const TRANSACTION_PAYEE_DISPLAY_MAX = 16;
const TRANSACTION_DESCRIPTION_DISPLAY_MAX = 32;
const TRANSACTION_TABLE_COLUMNS = 8;

function truncateTransactionText(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function renderTransactions() {
  const filtered = getFilteredTransactions();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const pageItems = transactionPageSlice(filtered);

  const tbody = document.getElementById('transactions-body');
  tbody.innerHTML = '';

  if (pageItems.length === 0) {
    const message = allTransactions.length === 0
      ? 'No transactions yet — add your first one above.'
      : 'No transactions match your search/filter.';
    tbody.appendChild(renderEmptyRow(TRANSACTION_TABLE_COLUMNS, message));
  }

  const sameReceipt = (a, b) => a && b && a.date === b.date && a.account === b.account && a.payee === b.payee;
  let receiptTotal = 0;
  let receiptLines = 0;

  pageItems.forEach((t, i) => {
    const tr = document.createElement('tr');
    // A line where the receipt (date, account or payee) changes.
    const prev = pageItems[i - 1];
    if (prev && !sameReceipt(prev, t)) tr.classList.add('tx-receipt-start');
    receiptTotal += t.amount;
    receiptLines += 1;

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

    const amountCell = makeCell(formatCurrency(t.amount));
    amountCell.className = amountSignClass(t.amount);

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editTransaction(t) }),
      makeRowActionButton({
        emoji: '📋',
        title: 'Duplicate (hold to make several)',
        onClick: () => editTransaction(t, 'duplicate'),
        onLongPress: () => duplicateTransactionMany(t),
      }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteTransaction(t.row) }),
    );

    tr.append(
      checkboxCell,
      makeCell(t.date),
      makeCell(t.account),
      makeCell(truncateTransactionText(t.payee, TRANSACTION_PAYEE_DISPLAY_MAX), t.payee),
      makeCell(t.category),
      makeCell(truncateTransactionText(t.description, TRANSACTION_DESCRIPTION_DISPLAY_MAX), t.description),
      amountCell,
      actionsCell,
    );
    tbody.appendChild(tr);

    // UI-only total under a receipt of 2+ lines; not a sheet row.
    if (sameReceipt(t, pageItems[i + 1])) return;
    if (receiptLines > 1) tbody.appendChild(renderReceiptTotalRow(receiptTotal));
    receiptTotal = 0;
    receiptLines = 0;
  });

  updateSelectAllCheckbox(pageItems);
  updateBulkActionsUI();
  renderPagination(totalPages);
}

// The amount sits in the 7th of the table's 8 columns.
function renderReceiptTotalRow(total) {
  const tr = document.createElement('tr');
  tr.className = 'tx-receipt-total';
  tr.title = 'Receipt total, shown here only, not a row in the sheet';
  const amountCell = makeCell(formatCurrency(total));
  amountCell.className = 'num';
  tr.append(...Array.from({ length: 6 }, () => document.createElement('td')), amountCell, document.createElement('td'));
  return tr;
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

// `selected` not among `options` is added first, so an edit keeps its value.
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

// The Tax button's local rate (13% is Ontario's HST), read on each use so a Settings change applies at once.
const TAX_RATE_PCT_DEFAULT = 13;

function taxRatePct() {
  return getSetting('TAX_RATE_PCT', TAX_RATE_PCT_DEFAULT);
}

// Adds tax to Amount; the sign carries through (−45.50 becomes −51.42). The box is
// left a plain number, so a second click compounds.
function applyTaxToAmount() {
  const input = document.getElementById('tx-amount');
  const amount = input.value.trim() === '' ? null : evaluateNumberExpression(input.value);
  if (amount === null) {
    showFieldError('tx-form-error', 'Amount needs a number or an expression before tax can be added, e.g. -45.50 or =-9.97-1.30');
    return;
  }

  input.value = roundMoneyCents(amount * (1 + taxRatePct() / 100)).toFixed(2);
  clearFieldError('tx-form-error');
}

// The tick box's own choice, kept across account changes; re-armed per form.
let updateBalanceWanted = true;

// Turns the box off, with the reason, for an account whose Balance can't be added to
// (finance-account.js: accountBalanceCell). Not disabled during the read: save re-checks anyway.
async function syncUpdateBalanceBox() {
  const box = document.getElementById('tx-update-balance');
  const note = document.getElementById('tx-update-balance-note');
  const name = document.getElementById('tx-account').value;

  note.hidden = true;
  if (!name) {
    box.disabled = false;
    box.checked = updateBalanceWanted;
    return;
  }

  const cell = await accountBalanceCell(name);
  // The account may have been changed again while this was out.
  if (document.getElementById('tx-account').value !== name) return;

  box.disabled = !cell.writable;
  box.checked = cell.writable && updateBalanceWanted;
  note.hidden = cell.writable;
  if (!cell.writable) note.textContent = cell.reason;
}

// The chosen account's institution, type and balance after it, as Transfer's From/To.
function syncTxAccountBalance() {
  renderAccountBalanceLabel(document.getElementById('tx-account-balance'), document.getElementById('tx-account').value);
}

function openTransactionForm(transaction, duplicate = false) {
  editingRow = (transaction && !duplicate) ? transaction.row : null;
  // amountText: an Amount box left as opened keeps the cell (it may be a formula).
  editingOriginal = editingRow ? { account: transaction.account, amount: transaction.amount, amountText: String(transaction.amount) } : null;

  document.getElementById('tx-date').value = transaction ? transaction.date : isoFromDate(new Date());
  document.getElementById('tx-payee').value = transaction ? transaction.payee : '';
  document.getElementById('tx-description').value = transaction ? transaction.description : '';
  document.getElementById('tx-amount').value = transaction ? transaction.amount : '';

  populateSelect(document.getElementById('tx-account'), accountOptions, transaction ? transaction.account : '');
  syncTxAccountBalance();
  document.getElementById('tx-category').value = transaction ? transaction.category : '';

  updateBalanceWanted = true;
  document.getElementById('tx-update-balance').checked = true;
  // Not awaited: the box corrects itself once the account is checked.
  syncUpdateBalanceBox();

  // The rate lives in the tooltip, so it stays true for any TAX_RATE_PCT.
  const rate = taxRatePct();
  document.getElementById('tx-tax-btn').title =
    `Add ${rate}% tax to the amount — multiplies it by ${Math.round((1 + rate / 100) * 10000) / 10000}.`;

  clearFieldError('tx-form-error');
  document.getElementById('tx-modal').hidden = false;
}

function closeTransactionForm() {
  document.getElementById('tx-modal').hidden = true;
  editingRow = null;
  editingOriginal = null;
}

// Money in (an Income category, positive amount) earns the confetti. Category is
// free text, so case and stray spaces are ignored.
function isIncomeTransaction(category, amount) {
  return String(category || '').trim().toLowerCase() === 'income' && amount > 0;
}

const DUPLICATE_MANY_MAX = 100;

// 📋 held: appends that many copies and moves the balance by all of them, as the form would.
async function duplicateTransactionMany(t) {
  const answer = prompt(`How many copies of ${t.date} ${t.payee}?`, '2');
  if (answer === null) return;
  const count = Number(answer.trim());
  if (!Number.isInteger(count) || count < 1 || count > DUPLICATE_MANY_MAX) {
    showToast(`Copies must be a whole number from 1 to ${DUPLICATE_MANY_MAX}.`, true);
    return;
  }
  if (!(await ensureAccessToken())) return;

  const row = transactionRowValues(t);
  try {
    await appendValues(TRANSACTIONS_RANGE, Array.from({ length: count }, () => [...row]));
  } catch (err) {
    showToast(`Couldn't duplicate: ${err.message}`, true);
    return;
  }

  // After the rows are in, so a balance problem is reported, not a failed save.
  let balanceNote = '';
  try {
    const result = await addToAccountBalance(t.account, roundMoneyCents(t.amount * count));
    if (!result.writable) balanceNote = ` ${t.account}'s balance was left as it is: ${result.reason}`;
  } catch (err) {
    balanceNote = ` ${t.account}'s balance couldn't be updated: ${err.message}`;
  }

  if (isIncomeTransaction(t.category, t.amount)) Motion.confetti();
  await refreshTransactions(true);
  showToast(`Duplicated ${count}×.${balanceNote}`, !!balanceNote);
}

// [account, change] pairs a save moves balances by: a new row adds its amount; an edit nets old vs new.
function transactionBalanceChanges(original, account, amount) {
  if (!original) return [[account, amount]];
  if (original.account === account) return [[account, roundMoneyCents(amount - original.amount)]];
  const changes = [];
  if (original.account) changes.push([original.account, -original.amount]);
  changes.push([account, amount]);
  return changes;
}

async function submitTransactionForm(event) {
  event.preventDefault();

  const original = editingOriginal;
  const amountText = document.getElementById('tx-amount').value;
  const keepAmount = !!original && amountText.trim() === original.amountText;
  const amount = keepAmount ? original.amount : evaluateNumberExpression(amountText);
  if (amount === null) {
    showFieldError('tx-form-error', TX_AMOUNT_ERROR);
    return;
  }

  const account = document.getElementById('tx-account').value;
  const balanceBox = document.getElementById('tx-update-balance');
  const updateBalance = balanceBox.checked && !balanceBox.disabled;
  const category = document.getElementById('tx-category').value;

  const row = transactionRowValues({
    date: document.getElementById('tx-date').value,
    account,
    payee: document.getElementById('tx-payee').value,
    category,
    description: document.getElementById('tx-description').value,
    amount,
  });
  const values = [row];

  try {
    let savedRow = editingRow;
    if (editingRow) {
      // An unchanged Amount isn't rewritten, so a formula there survives.
      if (keepAmount) await updateValues(transactionRowRange(editingRow, 'E'), [row.slice(0, 5)]);
      else await updateValues(transactionRowRange(editingRow), values);
    } else {
      savedRow = appendedRow(await appendValues(TRANSACTIONS_RANGE, values));
    }

    // Outside the catch below on purpose: the row is saved, so a balance problem must
    // not read as a failed save (inviting a duplicate). Either outcome is said out loud.
    if (updateBalance) {
      for (const [name, change] of transactionBalanceChanges(original, account, amount)) {
        if (!change) continue;
        try {
          const result = await addToAccountBalance(name, change);
          if (!result.writable) alert(`Transaction saved. ${name}'s balance was left as it is: ${result.reason}`);
        } catch (err) {
          console.error('Failed to update account balance:', err);
          alert(`Transaction saved, but ${name}'s balance couldn't be updated: ${err.message}`);
        }
      }
    }

    if (isIncomeTransaction(category, amount)) Motion.confetti();

    await refreshTransactions(true);
    const saved = allTransactions.find((t) => t.row === savedRow);
    if (saved) {
      openTransactionForm(saved);
      stayOnSavedForm('tx-modal', editTransaction.step(saved));
    }
    showFormSaved('tx-form-error');
  } catch (err) {
    showFieldError('tx-form-error', err.message);
  }
}

// Bulk-edit text boxes, in the order they're read; amount is handled on its own.
const BULK_EDIT_FIELDS = ['date', 'account', 'payee', 'description', 'category'];

// A value every selected row shares, else '' (meaning "leave unchanged").
function sharedFieldValue(selected, field) {
  const first = selected[0][field];
  return selected.every((t) => t[field] === first) ? first : '';
}

function openBulkEditForm() {
  const selected = selectedTransactions();
  if (selected.length === 0) return;

  ['date', 'payee', 'description', 'category', 'amount'].forEach((field) => {
    document.getElementById(`tx-bulk-${field}`).value = sharedFieldValue(selected, field);
  });

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
  BULK_EDIT_FIELDS.forEach((field) => {
    const value = document.getElementById(`tx-bulk-${field}`).value;
    if (value) patch[field] = value;
  });

  const amountInput = document.getElementById('tx-bulk-amount').value;
  if (amountInput) {
    const amount = evaluateNumberExpression(amountInput);
    if (amount === null) {
      showFieldError('tx-bulk-edit-form-error', TX_AMOUNT_ERROR);
      return;
    }
    patch.amount = amount;
  }

  if (Object.keys(patch).length === 0) {
    showFieldError('tx-bulk-edit-form-error', 'Change at least one field.');
    return;
  }

  const selected = selectedTransactions();
  const snapshots = selected.map((t) => ({ ...t }));
  const fields = Object.keys(patch);

  try {
    await batchUpdateValues(transactionFieldUpdates(selected.map((t) => ({ ...t, ...patch })), fields));

    // The rows stay ticked, so a second 💾 edits them again.
    await refreshTransactions(true);
    showFormSaved('tx-bulk-edit-form-error');
    showUndoToast(`${selected.length} transaction(s) updated.`, () => restoreBulkEdit(snapshots, fields));
  } catch (err) {
    showFieldError('tx-bulk-edit-form-error', err.message);
  }
}

// The edited rows still exist, so undo writes the edited cells back in place.
async function restoreBulkEdit(snapshots, fields) {
  try {
    await batchUpdateValues(transactionFieldUpdates(snapshots, fields));
    await refreshTransactions(true);
  } catch (err) {
    alert(`Failed to restore: ${err.message}`);
  }
}

async function deleteTransaction(row) {
  const tx = allTransactions.find((t) => t.row === row);

  await confirmAndDelete('Delete this transaction?', async () => {
    await batchUpdate([sheetRowDeleteRequest(transactionsSheetId, row)]);
    await refreshTransactions(true);
    if (tx) showUndoToast('Transaction deleted.', () => restoreTransactions([tx]));
  });
}

async function bulkDeleteTransactions() {
  const selected = selectedTransactions();
  if (selected.length === 0) return;

  await confirmAndDelete(`Delete ${selected.length} selected transaction(s)?`, async () => {
    // Bottom row first, so each later index is still valid within the one batchUpdate.
    const requests = [...selected]
      .sort((a, b) => b.row - a.row)
      .map((t) => sheetRowDeleteRequest(transactionsSheetId, t.row));

    await batchUpdate(requests);
    selectedRows.clear();
    await refreshTransactions(true);
    showUndoToast(`${selected.length} transaction(s) deleted.`, () => restoreTransactions(selected));
  });
}

// Re-appended at the end: the original rows are gone and everything below has shifted up.
async function restoreTransactions(txs) {
  try {
    await appendValues(TRANSACTIONS_RANGE, txs.map(transactionRowValues));
    await refreshTransactions(true);
  } catch (err) {
    alert(`Failed to restore: ${err.message}`);
  }
}
