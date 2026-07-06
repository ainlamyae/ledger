const CSV_HEADER = ['Date', 'Account', 'Payee', 'Category', 'Amount', 'Description'];

let csvListenersAttached = false;
let exportFilterCount = 0;

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Field-specific operator lists for the export filter builder. Amount is
// numeric (comparison operators); the rest are plain text (substring/exact
// match), matched case-insensitively.
const EXPORT_FILTER_FIELDS = {
  account: { label: 'Account', type: 'text', list: 'export-account-options' },
  payee: { label: 'Payee', type: 'text', list: 'tx-payee-options' },
  description: { label: 'Description', type: 'text', list: 'tx-description-options' },
  category: { label: 'Category', type: 'text', list: 'tx-category-options' },
  amount: { label: 'Amount', type: 'number', list: null },
};

const EXPORT_FILTER_OPERATORS = {
  text: [
    { value: 'contains', label: 'Contains' },
    { value: 'not_contains', label: 'Does not contain' },
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Not equals' },
  ],
  number: [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'gte', label: '>=' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '<=' },
  ],
};

function exportFilterMatches(transaction, filter) {
  if (!String(filter.value).trim()) return true;

  const fieldDef = EXPORT_FILTER_FIELDS[filter.field];
  const rawValue = transaction[filter.field];

  if (fieldDef.type === 'number') {
    const target = Number(filter.value);
    if (Number.isNaN(target)) return true;
    const amount = Number(rawValue) || 0;
    switch (filter.operator) {
      case 'eq': return amount === target;
      case 'neq': return amount !== target;
      case 'gt': return amount > target;
      case 'gte': return amount >= target;
      case 'lt': return amount < target;
      case 'lte': return amount <= target;
      default: return true;
    }
  }

  const haystack = String(rawValue || '').toLowerCase();
  const needle = filter.value.trim().toLowerCase();
  switch (filter.operator) {
    case 'contains': return haystack.includes(needle);
    case 'not_contains': return !haystack.includes(needle);
    case 'equals': return haystack === needle;
    case 'not_equals': return haystack !== needle;
    default: return true;
  }
}

// Combines filters left to right with each row's own join type (AND/OR),
// e.g. [A, {OR, B}, {AND, C}] evaluates as (A OR B) AND C.
function transactionMatchesExportFilters(transaction, filters) {
  if (filters.length === 0) return true;

  let result = exportFilterMatches(transaction, filters[0]);
  for (let i = 1; i < filters.length; i++) {
    const match = exportFilterMatches(transaction, filters[i]);
    result = filters[i].join === 'OR' ? (result || match) : (result && match);
  }
  return result;
}

function getExportFilters() {
  return [...document.querySelectorAll('.export-filter-row')].map((row) => ({
    join: row.dataset.join || 'AND',
    field: row.querySelector('.export-filter-field').value,
    operator: row.querySelector('.export-filter-operator').value,
    value: row.querySelector('.export-filter-value').value,
  }));
}

function renderExportFilterOperators(row) {
  const field = row.querySelector('.export-filter-field').value;
  const fieldDef = EXPORT_FILTER_FIELDS[field];
  const operatorSelect = row.querySelector('.export-filter-operator');
  operatorSelect.innerHTML = '';
  EXPORT_FILTER_OPERATORS[fieldDef.type].forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    operatorSelect.appendChild(option);
  });

  const valueInput = row.querySelector('.export-filter-value');
  valueInput.type = fieldDef.type === 'number' ? 'number' : 'text';
  if (fieldDef.type === 'number') {
    valueInput.removeAttribute('list');
    valueInput.step = '0.01';
  } else {
    valueInput.setAttribute('list', fieldDef.list);
    valueInput.removeAttribute('step');
  }
}

function addExportFilterRow() {
  const isFirst = exportFilterCount === 0;
  exportFilterCount++;

  const row = document.createElement('div');
  row.className = 'export-filter-row';
  row.dataset.join = 'AND';

  if (!isFirst) {
    const joinSelect = document.createElement('select');
    joinSelect.className = 'export-filter-join';
    ['AND', 'OR'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      joinSelect.appendChild(option);
    });
    joinSelect.addEventListener('change', () => {
      row.dataset.join = joinSelect.value;
      resetTransactionsPageAndRender();
    });
    row.appendChild(joinSelect);
  }

  const fieldSelect = document.createElement('select');
  fieldSelect.className = 'export-filter-field';
  Object.entries(EXPORT_FILTER_FIELDS).forEach(([value, { label }]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    fieldSelect.appendChild(option);
  });

  const operatorSelect = document.createElement('select');
  operatorSelect.className = 'export-filter-operator';
  operatorSelect.addEventListener('change', resetTransactionsPageAndRender);

  const valueInput = document.createElement('input');
  valueInput.className = 'export-filter-value';
  valueInput.placeholder = 'Value';
  valueInput.addEventListener('input', resetTransactionsPageAndRender);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn export-filter-remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove filter';
  removeBtn.setAttribute('aria-label', 'Remove filter');
  removeBtn.addEventListener('click', () => {
    row.remove();
    exportFilterCount--;
    resetTransactionsPageAndRender();
  });

  fieldSelect.addEventListener('change', () => {
    renderExportFilterOperators(row);
    resetTransactionsPageAndRender();
  });

  row.append(fieldSelect, operatorSelect, valueInput, removeBtn);
  document.getElementById('export-filters').appendChild(row);
  renderExportFilterOperators(row);
  resetTransactionsPageAndRender();
}

// Keeps the filter builder's account suggestions in sync with whatever
// accounts currently exist, same as the transaction form's own datalist.
function syncExportAccountOptions() {
  const accountDatalist = document.getElementById('export-account-options');
  accountDatalist.innerHTML = '';
  accountOptions.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    accountDatalist.appendChild(option);
  });
}

function exportTransactionsCSV() {
  const rows = getFilteredTransactions()
    .map((t) => [t.date, t.account, t.payee, t.category, t.amount, t.description]);

  if (rows.length === 0) {
    alert('No transactions match the selected filters.');
    return;
  }

  const csv = [CSV_HEADER, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

async function importTransactionsCSV(file) {
  const text = await file.text();
  const rows = parseCSV(text);
  if (!rows.length) {
    alert('The CSV file is empty.');
    return;
  }

  const first = rows[0].map((c) => c.trim().toLowerCase());
  const dataRows = first[0] === 'date' ? rows.slice(1) : rows;

  const values = dataRows
    .filter((r) => r.length >= 6 && r[0])
    .map((r) => [r[0], r[1], r[2], r[3], r[5], Number(r[4]) || 0]);

  if (!values.length) {
    alert('No valid transaction rows found in the CSV.');
    return;
  }

  await appendValues(TRANSACTIONS_RANGE, values);
  await refreshTransactions(true);
  alert(`Imported ${values.length} transaction(s).`);
}

function initCsvControls() {
  if (csvListenersAttached) return;
  csvListenersAttached = true;

  document.getElementById('export-csv-btn').addEventListener('click', exportTransactionsCSV);
  document.getElementById('export-add-filter-btn').addEventListener('click', addExportFilterRow);
  document.getElementById('export-form').addEventListener('submit', (e) => e.preventDefault());

  const fileInput = document.getElementById('import-csv-input');
  document.getElementById('import-csv-btn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      await importTransactionsCSV(file);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  });
}
