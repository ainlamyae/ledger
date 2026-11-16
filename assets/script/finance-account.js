const ACCOUNTS_RANGE = sheetRange(CONFIG.SHEETS.ACCOUNTS, 'A3:F');
// Reads a cell as its formula text rather than its computed value.
const ACCOUNT_FORMULA_PARAMS = { valueRenderOption: 'FORMULA' };

// Every box on the form, in the sheet's column order, so a row read back lines up by index.
const ACCOUNT_FIELD_IDS = [
  'account-name', 'account-institution', 'account-type', 'account-balance', 'account-current-value', 'account-payment-day',
];

let allAccounts = [];
let editAccount = null;
let accountsSheetId = null;
let editingAccountRow = null;
// Box id -> the formula it was opened with (see openAccountForm).
let editingAccountFormulas = {};
let accountListenersAttached = false;
let accountSort = { key: null, dir: 1 };
// Balance column as the sheet holds it (name -> raw cell), so a formula balance can be
// told from a typed number; the UNFORMATTED list can't. Read lazily, only for the
// transaction form's "Update the account balance" box.
let accountBalanceCells = null;
// Tells "not loaded yet" from "loaded, zero accounts" (like physiqueDataLoaded).
let accountsDataLoaded = false;

async function initAccountManager(forceRefresh = false) {
  accountsSheetId = findSheetId(await getSpreadsheetMetadata(), CONFIG.SHEETS.ACCOUNTS);

  await refreshAccountsList(forceRefresh);

  if (!accountListenersAttached) {
    accountListenersAttached = true;
    document.getElementById('add-account-btn').addEventListener('click', () => openAccountForm());
    editAccount = routedRowEdit('account', () => allAccounts, (a) => a.name, openAccountForm);
    document.getElementById('account-cancel-btn').addEventListener('click', closeAccountForm);
    onFormSubmit('account-form', submitAccountForm);
    makeSortableHeaders('#accounts-table', accountSort, renderAccountsList);

    document.getElementById('transfer-funds-btn').addEventListener('click', openTransferForm);
    document.getElementById('transfer-cancel-btn').addEventListener('click', closeTransferForm);
    ['transfer-from', 'transfer-to', 'transfer-payoff'].forEach((id) => {
      document.getElementById(id).addEventListener('change', syncTransferPayoff);
    });
    onFormSubmit('transfer-form', submitTransferForm);
  }
}

// Money columns: the label a non-numeric cell keeps, and the figure to sort by.
const ACCOUNT_NUMERIC_SORTS = {
  balance: { text: 'balanceText', value: (a) => a.balance },
  currentValue: { text: 'currentValueText', value: (a) => a.currentValue ?? a.balance },
};

function getSortedAccounts() {
  if (!accountSort.key) return allAccounts;

  const { key, dir } = accountSort;
  const numeric = ACCOUNT_NUMERIC_SORTS[key];
  return [...allAccounts].sort((a, b) => {
    if (!numeric) return a[key].localeCompare(b[key], undefined, { sensitivity: 'base' }) * dir;
    // A label ("Closed") has no rank: it stays at the end in either direction.
    if (!!a[numeric.text] !== !!b[numeric.text]) return a[numeric.text] ? 1 : -1;
    return (numeric.value(a) - numeric.value(b)) * dir;
  });
}

// One Account row. Non-numeric text ("Closed") reads as 0 but keeps its label; a
// blank Market Value means "not tracked" (null, shown as —), unlike a real 0.
function parseAccountRow(row, i) {
  const balanceNum = Number(row[3]);
  const hasCurrentValue = row[4] !== undefined && row[4] !== '';
  const currentValueNum = hasCurrentValue ? Number(row[4]) : null;

  return {
    row: i + 3,
    name: cellText(row[0]),
    institution: cellText(row[1]),
    type: cellText(row[2]),
    balance: Number.isFinite(balanceNum) ? balanceNum : 0,
    balanceText: Number.isFinite(balanceNum) ? null : (row[3] || null),
    currentValue: Number.isFinite(currentValueNum) ? currentValueNum : null,
    currentValueText: hasCurrentValue && !Number.isFinite(currentValueNum) ? row[4] : null,
    paymentDay: parsePaymentDay(row[5]),
  };
}

async function refreshAccountsList(forceRefresh = false) {
  // A refetch can change which balances are formulas.
  accountBalanceCells = null;

  const resp = await getValues(ACCOUNTS_RANGE, VALUE_PARAMS);
  allAccounts = (resp.values || []).map(parseAccountRow);

  accountsDataLoaded = true;
  renderAccountPaymentBadge();
  renderAccountsList();
  renderAccountCompositionChart(allAccounts);
}

// 1–31, or null. 31 means the month's last day in a shorter month.
function parsePaymentDay(value) {
  const day = Number(value);
  return value !== '' && value !== undefined && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

// That day in the month `monthOffset` from today's, clamped to the month's length.
function paymentDueDate(day, monthOffset = 0) {
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + monthOffset + 1, 0).getDate();
  return new Date(today.getFullYear(), today.getMonth() + monthOffset, Math.min(day, lastDay));
}

// The badge shows only this many days after the payment day.
const PAYMENT_BADGE_DAYS = 3;

// 1–3 days past this month's payment day, still owing, nothing in since last month's: { days, dueIso }.
// Null until transactions load, so it never flags a payment it can't see.
function accountPaymentOverdue(account) {
  if (account.paymentDay === null || account.balance >= 0 || !transactionsDataLoaded) return null;
  const todayIso = isoFromDate(new Date());
  const dueIso = isoFromDate(paymentDueDate(account.paymentDay));
  if (todayIso <= dueIso) return null;
  if (daysFromTodayIso(dueIso) * -1 > PAYMENT_BADGE_DAYS) return null;
  const previousDueIso = isoFromDate(paymentDueDate(account.paymentDay, -1));
  const paid = allTransactions.some((t) => t.account === account.name && t.amount > 0
    && t.date > previousDueIso && t.date <= todayIso);
  if (paid) return null;
  return { days: daysFromTodayIso(dueIso) * -1, dueIso };
}

function paymentBadgeText(due) {
  return `Pay ${due.days}d`;
}

function paymentBadgeElement(due) {
  const el = document.createElement('span');
  el.className = 'page-badge';
  el.textContent = paymentBadgeText(due);
  el.title = `Payment day was ${due.dueIso}, ${due.days} day${due.days === 1 ? '' : 's'} ago, and no payment into this account since last month's`;
  return el;
}

// The Account tile's badge holds the A≠T check and overdue payments together.
const accountBadgeParts = { reconcile: null, payment: null };

function setAccountBadgePart(part, badge) {
  accountBadgeParts[part] = badge;
  const parts = Object.values(accountBadgeParts).filter(Boolean);
  setPageBadge('finance', 'account', parts.length === 0 ? null : {
    text: parts.map((p) => p.text).join(' · '),
    title: parts.map((p) => p.title).join('\n'),
  });
}

function renderAccountPaymentBadge() {
  const overdue = allAccounts
    .map((account) => ({ account, due: accountPaymentOverdue(account) }))
    .filter((x) => x.due);
  if (overdue.length === 0) {
    setAccountBadgePart('payment', null);
    return;
  }
  const oldest = Math.max(...overdue.map((x) => x.due.days));
  setAccountBadgePart('payment', {
    text: paymentBadgeText({ days: oldest }),
    title: `Payment day passed unpaid: ${overdue.map((x) => `${x.account.name} (${x.due.dueIso})`).join(', ')}`,
  });
}

// A money cell: a label ("Closed") as-is and neutral, a figure signed red/green,
// and no figure as — with no colour.
function accountMoneyCell(value, text) {
  if (text !== null) {
    const cell = makeCell(text);
    cell.className = 'neutral';
    return cell;
  }
  const cell = makeCell(value !== null ? formatCurrency(value) : '—');
  if (value !== null) cell.className = amountSignClass(value);
  return cell;
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
    const due = accountPaymentOverdue(account);
    if (due) nameCell.append(' ', paymentBadgeElement(due));

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editAccount(account) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteAccount(account.row) }),
    );

    tr.append(
      nameCell,
      makeCell(account.institution),
      makeCell(account.type),
      accountMoneyCell(account.balance, account.balanceText),
      accountMoneyCell(account.currentValue, account.currentValueText),
      actionsCell,
    );
    tbody.appendChild(tr);
  });

  renderAccountsTotalRow(sortedAccounts.length > 0);
}

// A plain sum: labels already read as balance 0 / currentValue null, as the sheet's SUM() ignores them.
function renderAccountsTotalRow(hasAccounts) {
  const row = document.getElementById('accounts-total-row');
  row.hidden = !hasAccounts;
  if (!hasAccounts) return;

  const totals = [
    ['accounts-total-balance', allAccounts.reduce((sum, a) => sum + a.balance, 0)],
    ['accounts-total-current-value', allAccounts.reduce((sum, a) => sum + (a.currentValue !== null ? a.currentValue : 0), 0)],
  ];
  totals.forEach(([id, sum]) => {
    const cell = document.getElementById(id);
    cell.textContent = formatCurrency(sum);
    cell.className = amountSignClass(sum);
  });
}

// One row as the sheet holds it (`=D7*1.02` as text), read only as a form opens.
// Best-effort: null (not []) says the read failed, so the form can warn that saving
// would flatten a formula it couldn't see.
async function accountRowCells(row) {
  try {
    const resp = await getValues(sheetRange(CONFIG.SHEETS.ACCOUNTS, `A${row}:F${row}`), ACCOUNT_FORMULA_PARAMS);
    return (resp.values && resp.values[0]) || [];
  } catch (err) {
    console.error('Failed to read account formulas:', err);
    return null;
  }
}

// Awaited before the modal opens, so a formula can't land over something already typed.
async function openAccountForm(account) {
  editingAccountRow = account ? account.row : null;
  editingAccountFormulas = {};

  const values = account
    ? [account.name, account.institution, account.type, account.balance.toFixed(2),
      account.currentValue !== null ? account.currentValue.toFixed(2) : '',
      account.paymentDay !== null ? account.paymentDay : '']
    : ['', '', '', '0.00', '', ''];
  ACCOUNT_FIELD_IDS.forEach((id, i) => { document.getElementById(id).value = values[i]; });

  // A formula cell shows as its formula, so leaving the box alone sends it back
  // instead of flattening it to today's number.
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

// What one box saves as: its untouched opening formula verbatim; else a number or
// calculator shorthand (=5000-1234.56) evaluated here; else a typed `=` formula as
// text for Sheets to parse; else null (invalid).
function accountCellValue(id) {
  const text = document.getElementById(id).value.trim();
  if (editingAccountFormulas[id] === text) return text;
  const number = evaluateNumberExpression(text);
  if (number !== null) return number;
  return text.startsWith('=') ? text : null;
}

// Everything that shows the account list or its names.
async function refreshAfterAccountChange() {
  await refreshAccountsList(true);
  await refreshAccountOptions();
  await refreshNetWorth();
}

async function submitAccountForm(event) {
  event.preventDefault();

  const balance = accountCellValue('account-balance');
  if (balance === null) {
    showFieldError('account-form-error', 'Balance must be a number, an expression like =5000-1234.56, or a sheet formula.');
    return;
  }

  // Blank stays blank ("not tracked"); accountCellValue would read it as 0.
  let currentValue = '';
  if (document.getElementById('account-current-value').value.trim() !== '') {
    currentValue = accountCellValue('account-current-value');
    if (currentValue === null) {
      showFieldError('account-form-error', 'Market Value must be a number, an expression like =5000-1234.56, or a sheet formula.');
      return;
    }
  }

  const paymentDayText = document.getElementById('account-payment-day').value.trim();
  const paymentDay = paymentDayText === '' ? '' : parsePaymentDay(paymentDayText);
  if (paymentDay === null) {
    showFieldError('account-form-error', 'Payment Day must be a whole day of the month, 1 to 31, or blank.');
    return;
  }

  // USER_ENTERED for the Balance/Market Value formulas; the text stays as typed.
  const values = [[
    sheetText(document.getElementById('account-name').value),
    sheetText(document.getElementById('account-institution').value),
    sheetText(document.getElementById('account-type').value),
    balance,
    currentValue,
    paymentDay,
  ]];

  try {
    let row = editingAccountRow;
    if (row) {
      await updateValues(sheetRange(CONFIG.SHEETS.ACCOUNTS, `A${row}:F${row}`), values);
    } else {
      row = appendedRow(await appendValues(ACCOUNTS_RANGE, values));
    }
    await refreshAfterAccountChange();
    const saved = allAccounts.find((a) => a.row === row);
    if (saved) {
      await openAccountForm(saved);
      stayOnSavedForm('account-modal', editAccount.step(saved));
    }
    showFormSaved('account-form-error');
  } catch (err) {
    showFieldError('account-form-error', err.message);
  }
}

async function loadAccountBalanceCells() {
  if (accountBalanceCells) return accountBalanceCells;

  const resp = await getValues(sheetRange(CONFIG.SHEETS.ACCOUNTS, 'A3:D'), ACCOUNT_FORMULA_PARAMS);

  accountBalanceCells = new Map();
  (resp.values || []).forEach((row) => {
    if (cellText(row[0])) accountBalanceCells.set(cellText(row[0]), row[3]);
  });
  return accountBalanceCells;
}

// Whether this app may add to an account's Balance, and if not, why. A formula
// balance (`=SUMIF(Transaction!…)`) already counts the new row, so adding would
// count it twice, and writing over it would lose the sheet's own arithmetic.
async function accountBalanceCell(name) {
  // Not a length check: an empty list before the first fetch isn't "no such account".
  if (!accountsDataLoaded) {
    return { writable: false, reason: `The ${CONFIG.SHEETS.ACCOUNTS} tab hasn't finished loading, so no balance is touched.` };
  }

  const account = allAccounts.find((a) => a.name === name);
  if (!account) {
    return { writable: false, reason: `"${name}" isn't a row on the ${CONFIG.SHEETS.ACCOUNTS} tab, so it has no balance to update.` };
  }

  let cell;
  try {
    cell = (await loadAccountBalanceCells()).get(name);
  } catch (err) {
    console.error('Failed to read account balances:', err);
    return { writable: false, reason: `Couldn't read ${name}'s balance from the sheet (${err.message}), so it's left as it is.` };
  }

  if (typeof cell === 'string' && cell.trim().startsWith('=')) {
    return { writable: false, reason: `${name}'s balance is a formula on the sheet, which keeps itself up to date — adding to it here would count this transaction twice.` };
  }

  // Blank starts from 0; other text ("Closed") is a label, not an amount.
  const raw = cell === undefined || cell === null ? '' : cell;
  const current = raw === '' ? 0 : Number(raw);
  if (!Number.isFinite(current)) {
    return { writable: false, reason: `${name}'s balance reads "${raw}" rather than an amount, so there's nothing to add to.` };
  }

  return { writable: true, row: account.row, current };
}

// Moves an account's Balance by a signed amount, to the cent. A balance it won't
// touch returns the {writable, reason} verdict rather than throwing: the caller's
// transaction is already saved and has to say so.
async function addToAccountBalance(name, amount) {
  const cell = await accountBalanceCell(name);
  if (!cell.writable) return cell;

  const next = roundMoneyCents(cell.current + amount);
  await updateValues(sheetRange(CONFIG.SHEETS.ACCOUNTS, `D${cell.row}`), [[next]]);

  await refreshAccountsList(true);
  await refreshNetWorth();
  return { writable: true, from: cell.current, to: next };
}

// Transfer writes straight to both Balance cells — no Transaction rows, as it's the
// automated form of editing the two balances by hand.

// The figure that zeroes `toName`'s balance ("pay off full balance").
function transferPayoffAmount(toName) {
  const toAccount = allAccounts.find((a) => a.name === toName);
  if (!toAccount) return null;
  return roundMoneyCents(-toAccount.balance);
}

function openTransferForm() {
  const names = allAccounts.map((a) => a.name);
  populateSelect(document.getElementById('transfer-from'), names);
  populateSelect(document.getElementById('transfer-to'), names);
  document.getElementById('transfer-amount').value = '';
  document.getElementById('transfer-amount').disabled = false;
  document.getElementById('transfer-payoff').checked = false;
  syncTransferBalances();
  clearFieldError('transfer-form-error');
  document.getElementById('transfer-modal').hidden = false;
}

// "Institution Type: Balance" after an account select (Transfer, Log); negative in
// red, a label ("Closed") as-is.
function renderAccountBalanceLabel(el, name) {
  el.textContent = '';
  const account = allAccounts.find((a) => a.name === name);
  if (!account) return;
  const label = [account.institution, account.type].filter(Boolean).join(' ');
  const balance = document.createElement('span');
  balance.textContent = account.balanceText !== null ? account.balanceText : formatCurrency(account.balance);
  if (account.balanceText === null && account.balance < 0) balance.className = 'expense';
  el.append(label ? `${label}: ` : '', balance);
}

function syncTransferBalances() {
  ['from', 'to'].forEach((side) => {
    renderAccountBalanceLabel(document.getElementById(`transfer-${side}-balance`), document.getElementById(`transfer-${side}`).value);
  });
}

function closeTransferForm() {
  document.getElementById('transfer-modal').hidden = true;
}

// Payoff ticked: Amount holds the payoff figure for the current To, locked. Unticked:
// back to manual entry. Re-run on From/To changes so the figure never goes stale.
function syncTransferPayoff() {
  syncTransferBalances();

  const amountBox = document.getElementById('transfer-amount');
  const checked = document.getElementById('transfer-payoff').checked;

  if (!checked) {
    amountBox.disabled = false;
    return;
  }

  const amount = transferPayoffAmount(document.getElementById('transfer-to').value);
  amountBox.disabled = true;
  amountBox.value = amount === null ? '' : amount.toFixed(2);
}

async function submitTransferForm(event) {
  event.preventDefault();

  const from = document.getElementById('transfer-from').value;
  const to = document.getElementById('transfer-to').value;
  if (!from || !to) {
    showFieldError('transfer-form-error', 'Pick a From and a To account.');
    return;
  }
  if (from === to) {
    showFieldError('transfer-form-error', 'From and To must be different accounts.');
    return;
  }

  const payoff = document.getElementById('transfer-payoff').checked;
  const amount = payoff
    ? transferPayoffAmount(to)
    : evaluateNumberExpression(document.getElementById('transfer-amount').value);

  if (amount === null || amount <= 0) {
    showFieldError('transfer-form-error', 'Amount must be a positive number — check the To account actually has a balance to pay off.');
    return;
  }

  // Both legs checked before either is written, so a formula balance can't leave half a transfer.
  const cells = await Promise.all([accountBalanceCell(from), accountBalanceCell(to)]);
  const refused = cells.find((cell) => !cell.writable);
  if (refused) {
    showFieldError('transfer-form-error', refused.reason);
    return;
  }

  // Two writes, one per leg, so a failure says which leg and what was applied.
  const [fromCell, toCell] = cells;
  const writeLeg = (cell, change) => updateValues(
    sheetRange(CONFIG.SHEETS.ACCOUNTS, `D${cell.row}`), [[roundMoneyCents(cell.current + change)]]);
  try {
    await writeLeg(fromCell, -amount);
  } catch (err) {
    showFieldError('transfer-form-error', `Nothing was transferred: ${from}'s balance couldn't be lowered (${err.message}).`);
    return;
  }

  let failure = null;
  try {
    await writeLeg(toCell, amount);
  } catch (err) {
    failure = `Half applied: ${from}'s balance went down by ${formatCurrency(amount)}, but ${to}'s couldn't be raised (${err.message}). Add ${formatCurrency(amount)} to ${to} by hand.`;
  }
  // The amount clears either way, so a second 💾 can't repeat the transfer.
  document.getElementById('transfer-amount').value = '';
  document.getElementById('transfer-payoff').checked = false;

  try {
    await refreshAccountsList(true);
    await refreshNetWorth();
  } catch (err) {
    failure = failure || `Transferred, but the accounts couldn't reload: ${err.message}`;
  }
  if (failure) showFieldError('transfer-form-error', failure);
  else showFormSaved('transfer-form-error');
}

async function deleteAccount(row) {
  await confirmAndDelete('Delete this account?', async () => {
    await batchUpdate([sheetRowDeleteRequest(accountsSheetId, row)]);
    await refreshAfterAccountChange();
  });
}
