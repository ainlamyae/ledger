const CSV_HEADER = ['Date', 'Account', 'Payee', 'Description', 'Amount', 'Category'];

let csvListenersAttached = false;

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function exportTransactionsCSV() {
  const rows = allTransactions
    .slice()
    .sort((a, b) => a.row - b.row)
    .map((t) => [t.date, t.account, t.payee, t.description, t.amount, t.category]);

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
    .map((r) => [r[0], r[1], r[2], r[3], Number(r[4]) || 0, r[5]]);

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
