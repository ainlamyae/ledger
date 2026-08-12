const ACCOUNTS_RANGE = `'${CONFIG.SHEETS.ACCOUNTS}'!A3:E100`;

// Every box on the form, in the sheet's own column order — so the row read back
// from the sheet lines up with them by index.
const ACCOUNT_FIELD_IDS = [
  'account-name', 'account-institution', 'account-type', 'account-balance', 'account-current-value',
];

let allAccounts = [];
let accountsSheetId = null;
let editingAccountRow = null;
// Which of those boxes were seeded with a formula rather than a value, and what
// that formula was — see openAccountForm.
let editingAccountFormulas = {};
let accountListenersAttached = false;
let accountSort = { key: null, dir: 1 };
// Same purpose as physique.js's physiqueDataLoaded: lets a click that races
// the initial fetch (e.g. Financial Insight, loaded before this resolves)
// tell "not loaded yet" apart from "loaded, zero accounts".
let accountsDataLoaded = false;

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
    // Non-numeric cells (e.g. "Closed") have no meaningful rank — pin them to
    // the end regardless of sort direction rather than let dir flip them to
    // the top.
    if (key === 'balance') {
      if (!!a.balanceText !== !!b.balanceText) return a.balanceText ? 1 : -1;
      return (a.balance - b.balance) * dir;
    }
    if (key === 'currentValue') {
      if (!!a.currentValueText !== !!b.currentValueText) return a.currentValueText ? 1 : -1;
      return ((a.currentValue ?? a.balance) - (b.currentValue ?? b.balance)) * dir;
    }
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

  allAccounts = values.map((row, i) => {
    const balanceNum = Number(row[3]);
    const hasCurrentValue = row[4] !== undefined && row[4] !== '';
    const currentValueNum = hasCurrentValue ? Number(row[4]) : null;

    return {
      row: i + 3,
      name: row[0] || '',
      institution: row[1] || '',
      type: row[2] || '',
      // Non-numeric text (e.g. "Closed") sorts/charts as 0 but keeps its own
      // label — balanceText/currentValueText, set below — for display.
      balance: Number.isFinite(balanceNum) ? balanceNum : 0,
      balanceText: Number.isFinite(balanceNum) ? null : (row[3] || null),
      // Blank means "not tracked" (e.g. Chequing/Credit) — distinct from an
      // actual 0, so it renders as '—' instead of a misleading $0.00.
      currentValue: Number.isFinite(currentValueNum) ? currentValueNum : null,
      currentValueText: hasCurrentValue && !Number.isFinite(currentValueNum) ? row[4] : null,
    };
  });

  accountsDataLoaded = true;
  renderAccountsList();
  renderAccountCompositionChart(allAccounts);
}

function renderAccountsList() {
  const tbody = document.getElementById('accounts-list-body');
  tbody.innerHTML = '';

  const sortedAccounts = getSortedAccounts();
  if (sortedAccounts.length === 0) {
    tbody.appendChild(renderEmptyRow(6, 'No accounts yet — add your first one above.'));
  }

  sortedAccounts.forEach((account) => {
    const tr = document.createElement('tr');

    const nameCell = makeCell(account.name);
    const institutionCell = makeCell(account.institution);
    const typeCell = makeCell(account.type);

    const balanceCell = makeCell(account.balanceText !== null ? account.balanceText : formatCurrency(account.balance));
    balanceCell.className = account.balanceText !== null ? 'account-closed' : (account.balance < 0 ? 'expense' : 'income');

    const currentValueCell = makeCell(
      account.currentValueText !== null ? account.currentValueText
        : account.currentValue !== null ? formatCurrency(account.currentValue) : '—'
    );
    if (account.currentValueText !== null) {
      currentValueCell.className = 'account-closed';
    } else if (account.currentValue !== null) {
      currentValueCell.className = account.currentValue < 0 ? 'expense' : 'income';
    }

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openAccountForm(account) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteAccount(account.row) }),
    );

    tr.append(nameCell, institutionCell, typeCell, balanceCell, currentValueCell, actionsCell);
    tbody.appendChild(tr);
  });

  renderAccountsTotalRow(sortedAccounts.length > 0);
}

// "Closed"/non-numeric cells already normalize to balance: 0 / currentValue:
// null (refreshAccountsList above), so this is a plain sum — no text-cell
// special-casing needed, same as the sheet's own SUM() would ignore them.
function renderAccountsTotalRow(hasAccounts) {
  const row = document.getElementById('accounts-total-row');
  row.hidden = !hasAccounts;
  if (!hasAccounts) return;

  const balanceSum = allAccounts.reduce((sum, a) => sum + a.balance, 0);
  const currentValueSum = allAccounts.reduce((sum, a) => sum + (a.currentValue !== null ? a.currentValue : 0), 0);

  const balanceCell = document.getElementById('accounts-total-balance');
  balanceCell.textContent = formatCurrency(balanceSum);
  balanceCell.className = balanceSum < 0 ? 'expense' : 'income';

  const currentValueCell = document.getElementById('accounts-total-current-value');
  currentValueCell.textContent = formatCurrency(currentValueSum);
  currentValueCell.className = currentValueSum < 0 ? 'expense' : 'income';
}

// A row as the SHEET holds it, not as it computes: a cell containing `=D7*1.02`
// comes back as that text rather than as the number it currently evaluates to.
// The list itself is read UNFORMATTED_VALUE, which is what the totals and the
// composition chart need — this is the one place that wants the other rendering,
// so it's a single-row read taken only when a form is about to open.
//
// Best-effort: a failed read leaves the form on the computed figures it always
// showed, which is worse than a formula but better than an edit button that
// doesn't open. null (not []) says it failed, so the form can warn that saving
// would flatten a formula it couldn't read — silence there is indistinguishable
// from a row that simply has no formulas in it.
async function accountRowCells(row) {
  try {
    const resp = await getValues(
      `'${CONFIG.SHEETS.ACCOUNTS}'!A${row}:E${row}`,
      { valueRenderOption: 'FORMULA' }
    );
    return (resp.values && resp.values[0]) || [];
  } catch (err) {
    console.error('Failed to read account formulas:', err);
    return null;
  }
}

// Awaited BEFORE the modal opens rather than filled in behind it: the boxes are
// editable the moment they're visible, and a formula landing in one a moment
// later would overwrite whatever had been typed into it in the meantime.
async function openAccountForm(account) {
  editingAccountRow = account ? account.row : null;
  editingAccountFormulas = {};

  document.getElementById('account-modal-title').textContent = account ? 'Edit Account' : 'Add Account';
  document.getElementById('account-name').value = account ? account.name : '';
  document.getElementById('account-institution').value = account ? account.institution : '';
  document.getElementById('account-type').value = account ? account.type : '';
  document.getElementById('account-balance').value = account ? account.balance.toFixed(2) : '0.00';
  document.getElementById('account-current-value').value =
    account && account.currentValue !== null ? account.currentValue.toFixed(2) : '';

  // Whichever cells are formulas are shown AS their formula, so the form says
  // what the sheet actually holds — and so leaving the box alone sends that
  // same formula back. Editing an account used to write the computed figure
  // into every one of these five cells, which silently replaced a market value
  // like `=D7*1.02` with the number it produced that day and left the sheet no
  // longer updating itself.
  const cells = account ? await accountRowCells(account.row) : [];
  (cells || []).forEach((cell, i) => {
    const id = ACCOUNT_FIELD_IDS[i];
    if (id && typeof cell === 'string' && cell.startsWith('=')) {
      editingAccountFormulas[id] = cell;
      document.getElementById(id).value = cell;
    }
  });

  clearFieldError('account-form-error');
  if (cells === null) {
    showFieldError('account-form-error', "Couldn't read this row's formulas — the boxes show computed values, so saving will replace any formula in this row with its current number.");
  }
  document.getElementById('account-modal').hidden = false;
}

function closeAccountForm() {
  document.getElementById('account-modal').hidden = true;
  editingAccountRow = null;
  editingAccountFormulas = {};
}

// What to send back for one box. Three cases, in this order:
//   - the formula it was loaded with, untouched — returned verbatim, so a
//     round-trip through the form is a no-op on the sheet even when the formula
//     is plain arithmetic the evaluator below could have flattened to a number;
//   - a number or the local calculator shorthand (=5000-1234.56), evaluated
//     here as it always has been, so the sheet keeps a plain value;
//   - anything else starting with `=` — a formula the user typed. It goes over
//     as text and Sheets parses it, the same as typing it into the cell.
function accountCellValue(id) {
  const text = document.getElementById(id).value.trim();
  if (editingAccountFormulas[id] === text) return text;
  const number = evaluateNumberExpression(text);
  if (number !== null) return number;
  return text.startsWith('=') ? text : null;
}

async function submitAccountForm(event) {
  event.preventDefault();

  const balance = accountCellValue('account-balance');
  if (balance === null) {
    showFieldError('account-form-error', 'Balance must be a number, an expression like =5000-1234.56, or a sheet formula.');
    return;
  }

  // Blank stays blank — "not tracked" is a real state for this column, and
  // accountCellValue would read an empty box as the number 0.
  let currentValue = '';
  if (document.getElementById('account-current-value').value.trim() !== '') {
    currentValue = accountCellValue('account-current-value');
    if (currentValue === null) {
      showFieldError('account-form-error', 'Market Value must be a number, an expression like =5000-1234.56, or a sheet formula.');
      return;
    }
  }

  const values = [[
    document.getElementById('account-name').value,
    document.getElementById('account-institution').value,
    document.getElementById('account-type').value,
    balance,
    currentValue,
  ]];

  try {
    if (editingAccountRow) {
      await updateValues(`'${CONFIG.SHEETS.ACCOUNTS}'!A${editingAccountRow}:E${editingAccountRow}`, values);
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
