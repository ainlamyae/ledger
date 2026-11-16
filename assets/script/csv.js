// [header, record key] per exported column.
const TRANSACTION_CSV_COLUMNS = [['Date', 'date'], ['Account', 'account'], ['Payee', 'payee'], ['Category', 'category'], ['Amount', 'amount'], ['Description', 'description']];

const PHYSIQUE_CSV_COLUMNS = [
  ['Date', 'date'], ['Body Mass', 'bodyMass'], ['Bed', 'bedtime'], ['Wake', 'wakeTime'], ['Sleep (hr)', 'sleep'],
  ['Deprivation (kcal)', 'deprivation'], ['TEI', 'caloriesIn'], ['Protein (g)', 'proteinIn'], ['Dietary Fiber (g)', 'fiber'],
  ['Fat (g)', 'fat'], ['Carbohydrate (g)', 'carbohydrate'], ['TEF', 'tef'], ['Workout', 'workout'], ['Duration (min)', 'duration'], ['AEE', 'caloriesOut'],
];

let csvListenersAttached = false;
let exportFilterCount = 0;

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function todayStamp() {
  return isoFromDate(new Date());
}

// Downloads in-memory text through a throwaway <a> on an object URL.
function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

// Export filter fields: amount compares numbers, the rest match text case-insensitively.
const EXPORT_FILTER_FIELDS = {
  account: { label: 'Account', type: 'text', list: 'export-account-options' },
  payee: { label: 'Payee', type: 'text', list: 'tx-payee-options' },
  description: { label: 'Description', type: 'text', list: 'tx-description-options' },
  category: { label: 'Category', type: 'text', list: 'tx-category-options' },
  amount: { label: 'Amount', type: 'number', list: null },
};

// `test(fieldValue, filterValue)` per operator; an unknown operator matches everything.
const EXPORT_FILTER_OPERATORS = {
  text: [
    { value: 'contains', label: 'Contains', test: (hay, needle) => hay.includes(needle) },
    { value: 'not_contains', label: 'Does not contain', test: (hay, needle) => !hay.includes(needle) },
    { value: 'equals', label: 'Equals', test: (hay, needle) => hay === needle },
    { value: 'not_equals', label: 'Not equals', test: (hay, needle) => hay !== needle },
  ],
  number: [
    { value: 'eq', label: '=', test: (a, b) => a === b },
    { value: 'neq', label: '≠', test: (a, b) => a !== b },
    { value: 'gt', label: '>', test: (a, b) => a > b },
    { value: 'gte', label: '>=', test: (a, b) => a >= b },
    { value: 'lt', label: '<', test: (a, b) => a < b },
    { value: 'lte', label: '<=', test: (a, b) => a <= b },
  ],
};

function exportFilterMatches(transaction, filter) {
  if (!String(filter.value).trim()) return true;

  const fieldDef = EXPORT_FILTER_FIELDS[filter.field];
  const rawValue = transaction[filter.field];
  const operator = EXPORT_FILTER_OPERATORS[fieldDef.type].find((op) => op.value === filter.operator);

  if (fieldDef.type === 'number') {
    const threshold = Number(filter.value);
    if (Number.isNaN(threshold)) return true;
    return operator ? operator.test(Number(rawValue) || 0, threshold) : true;
  }

  const haystack = String(rawValue || '').toLowerCase();
  const needle = filter.value.trim().toLowerCase();
  return operator ? operator.test(haystack, needle) : true;
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

// Appends an <option>; a datalist suggestion leaves `label` off.
function appendOption(parent, value, label) {
  const option = document.createElement('option');
  option.value = value;
  if (label !== undefined) option.textContent = label;
  parent.appendChild(option);
}

function renderExportFilterOperators(row) {
  const field = row.querySelector('.export-filter-field').value;
  const fieldDef = EXPORT_FILTER_FIELDS[field];
  const operatorSelect = row.querySelector('.export-filter-operator');
  operatorSelect.innerHTML = '';
  EXPORT_FILTER_OPERATORS[fieldDef.type].forEach(({ value, label }) => appendOption(operatorSelect, value, label));

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
    ['AND', 'OR'].forEach((value) => appendOption(joinSelect, value, value));
    joinSelect.addEventListener('change', () => {
      row.dataset.join = joinSelect.value;
      resetTransactionsPageAndRender();
    });
    row.appendChild(joinSelect);
  }

  const fieldSelect = document.createElement('select');
  fieldSelect.className = 'export-filter-field';
  Object.entries(EXPORT_FILTER_FIELDS).forEach(([value, { label }]) => appendOption(fieldSelect, value, label));

  const operatorSelect = document.createElement('select');
  operatorSelect.className = 'export-filter-operator';
  operatorSelect.addEventListener('change', resetTransactionsPageAndRender);

  const valueInput = document.createElement('input');
  valueInput.className = 'export-filter-value';
  valueInput.placeholder = 'Value';
  valueInput.addEventListener('input', resetTransactionsPageAndRender);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-danger export-filter-remove';
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

// The account suggestions follow whatever accounts exist now.
function syncExportAccountOptions() {
  const accountDatalist = document.getElementById('export-account-options');
  accountDatalist.innerHTML = '';
  accountOptions.forEach((name) => appendOption(accountDatalist, name));
}

// Downloads `records` by date as `<prefix>-<today>.csv`, or alerts `emptyMessage`.
function downloadRecordsCsv(prefix, columns, records, emptyMessage) {
  const rows = records
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((record) => columns.map(([, key]) => record[key]));

  if (rows.length === 0) {
    alert(emptyMessage);
    return;
  }

  const csv = [columns.map(([header]) => header), ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  downloadTextFile(`${prefix}-${todayStamp()}.csv`, csv, 'text/csv;charset=utf-8;');
}

async function exportTransactionsCSV() {
  if (!confirm('Export every transaction to CSV?')) return;
  if (!transactionsDataLoaded) await initTransactions();
  downloadRecordsCsv('transactions', TRANSACTION_CSV_COLUMNS, [...allTransactions], 'No transactions to export.');
}

async function exportPhysiqueCSV() {
  if (!confirm('Export every Physique day to CSV?')) return;
  // Health's data, read on demand when this page is in another section.
  if (!physiqueDataLoaded) {
    await initActivities();
    await initPhysique();
  }
  downloadRecordsCsv('physique', PHYSIQUE_CSV_COLUMNS, allPhysiqueEntries.filter((p) => p.date), 'No Physique days to export.');
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
        // "" is an escaped quote; a lone " closes the field.
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

  // Drops blank lines.
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

  // The CSV ends Amount, Description; the sheet ends Description, Amount.
  const values = dataRows
    .filter((r) => r.length >= TRANSACTION_CSV_COLUMNS.length && r[0])
    .map((r) => transactionRowValues({ date: r[0], account: r[1], payee: r[2], category: r[3], description: r[5], amount: Number(r[4]) || 0 }));

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

  // Other › Settings: every row, whichever section's data is loaded already.
  onAsyncClick('export-transactions-btn', exportTransactionsCSV);
  onAsyncClick('export-physique-btn', exportPhysiqueCSV);
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
