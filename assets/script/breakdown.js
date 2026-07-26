// The Breakdown tab as an editable table: one row per Category × Type, with the
// four period totals the sheet computes for it.
//
// The money is NOT the app's to write. Columns C-F are the spreadsheet's own
// formulas (the same figures Financial Indicators charts, read via app.js's
// INSIGHT_RANGE), so every write here is scoped to A:B — the two text columns
// that name the row. That's the whole design constraint: an edit renames a
// category or type and lets the sheet recompute, and nothing in this file can
// replace a formula with the number it happened to produce.
//
// A2:F — Category, Type, Last Month, Last Quarter, Last Year, Lifelong.
const BREAKDOWN_RANGE = `'${CONFIG.SHEETS.INSIGHT}'!A2:F200`;
const BREAKDOWN_PAGE_SIZE = 100;

// The four money columns, in sheet order — used for the table, the sort keys and
// the modal's read-only summary, so the order is stated once.
const BREAKDOWN_AMOUNT_FIELDS = [
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'lastQuarter', label: 'Last Quarter' },
  { key: 'lastYear', label: 'Last Year' },
  { key: 'lifelong', label: 'Lifelong' },
];

let allBreakdownRows = [];
let breakdownSheetId = null;
let editingBreakdownRow = null;
let breakdownListenersAttached = false;
let bSort = { key: null, dir: 1 };
let bCurrentPage = 1;

async function initBreakdown(forceRefresh = false) {
  if (!breakdownListenersAttached) {
    breakdownListenersAttached = true;

    document.getElementById('add-breakdown-btn').addEventListener('click', () => openBreakdownForm(null));
    document.getElementById('breakdown-cancel-btn').addEventListener('click', closeBreakdownForm);
    onFormSubmit('breakdown-form', submitBreakdownForm);
    document.getElementById('breakdown-search').addEventListener('input', () => {
      bCurrentPage = 1;
      renderBreakdownList();
    });

    makeSortableHeaders('#breakdown-table', bSort, () => {
      bCurrentPage = 1;
      renderBreakdownList();
    });
  }

  await refreshBreakdown(forceRefresh);
}

async function refreshBreakdown(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('breakdown');
  if (!values) {
    const resp = await getValues(BREAKDOWN_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('breakdown', values);
  }

  allBreakdownRows = values
    .map((row, i) => ({
      row: i + 2,
      category: (row[0] || '').trim(),
      // Blank on purpose for a category's own total row — kept as '' rather than
      // normalised to a dash, because that blank is what the sheet reads as "this
      // is the total", and it's what an edit writes back.
      type: (row[1] || '').trim(),
      ...Object.fromEntries(BREAKDOWN_AMOUNT_FIELDS.map((f, col) => {
        const cell = row[col + 2];
        return [f.key, (cell !== undefined && cell !== '') ? Number(cell) : null];
      })),
    }))
    // A row with no category is spacing on the sheet, not data.
    .filter((b) => b.category);

  renderBreakdownList();
}

function getFilteredBreakdownRows() {
  const search = document.getElementById('breakdown-search').value.trim().toLowerCase();
  const filtered = allBreakdownRows.filter((b) => !search
    || b.category.toLowerCase().includes(search)
    || b.type.toLowerCase().includes(search));

  const { key, dir } = bSort;
  if (!key) return filtered;

  const isAmount = BREAKDOWN_AMOUNT_FIELDS.some((f) => f.key === key);
  return [...filtered].sort((a, b) => (isAmount
    // Nulls sort as 0, the same as the blank cell they came from reads on the sheet.
    ? ((a[key] ?? 0) - (b[key] ?? 0)) * dir
    : String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' }) * dir));
}

// Same red/green split the Accounts table uses, so a figure means the same thing
// in both places. A spend is negative on this tab, so most of it is red.
//
// Always `num`, colour or not: .income/.expense right-align as a side effect of
// their own rule, so a $0.00 with neither would be the one cell in the column
// hanging off the left edge — and on this tab, most of a quiet month is zeros.
function breakdownAmountCell(value) {
  const cell = makeCell(value !== null ? formatCurrency(value) : '—');
  cell.className = 'num';
  if (value !== null && value !== 0) cell.classList.add(value < 0 ? 'expense' : 'income');
  return cell;
}

function renderBreakdownList() {
  const tbody = document.getElementById('breakdown-body');
  tbody.innerHTML = '';

  const filtered = getFilteredBreakdownRows();
  const totalPages = Math.max(1, Math.ceil(filtered.length / BREAKDOWN_PAGE_SIZE));
  bCurrentPage = Math.min(bCurrentPage, totalPages);

  const start = (bCurrentPage - 1) * BREAKDOWN_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + BREAKDOWN_PAGE_SIZE);

  if (pageItems.length === 0) {
    tbody.appendChild(renderEmptyRow(7, allBreakdownRows.length === 0
      ? `No rows yet — the "${CONFIG.SHEETS.INSIGHT}" tab is where each spending category and its types are listed.`
      : 'No rows match your search.'));
  }

  pageItems.forEach((b) => {
    const tr = document.createElement('tr');

    tr.append(
      makeCell(b.category),
      makeCell(b.type || '—', b.type ? undefined : `Every Type under ${b.category}, totalled`),
      ...BREAKDOWN_AMOUNT_FIELDS.map((f) => breakdownAmountCell(b[f.key])),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openBreakdownForm(b) }),
      // Copies the row's formulas, not their current values: a plain append would
      // land a row with four empty money columns. See duplicateBreakdownRow.
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => duplicateBreakdownRow(b) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteBreakdownRow(b) }),
    );
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  renderPager('breakdown-pagination', {
    page: bCurrentPage,
    totalPages,
    onChange: (p) => {
      bCurrentPage = p;
      renderBreakdownList();
    },
  });
}

// Categories and types already in use, most-used first — the same guard against
// fragmenting a free-text column into "Grocery"/"grocery" that the Nutrition and
// Activity forms use. Types are offered across every category rather than only
// the one being edited: the same word ("Electronics", "Cleaning") is deliberately
// reused under several.
function renderBreakdownDatalist(datalistId, values) {
  const counts = new Map();
  values.filter(Boolean).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));

  const dl = document.getElementById(datalistId);
  dl.innerHTML = '';
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([value]) => {
      const opt = document.createElement('option');
      opt.value = value;
      dl.appendChild(opt);
    });
}

function openBreakdownForm(entry) {
  editingBreakdownRow = entry ? entry.row : null;

  document.getElementById('breakdown-modal-title').textContent = entry ? 'Edit Breakdown Row' : 'Add Breakdown Row';
  document.getElementById('breakdown-category').value = entry ? entry.category : '';
  document.getElementById('breakdown-type').value = entry ? entry.type : '';
  renderBreakdownDatalist('breakdown-category-options', allBreakdownRows.map((b) => b.category));
  renderBreakdownDatalist('breakdown-type-options', allBreakdownRows.map((b) => b.type));

  // The amounts are shown so the row is identifiable, and shown as text so it's
  // clear they aren't fields: this form writes columns A and B and nothing else.
  // On a new row there are none yet — what it says instead is where the ones it
  // will have come from.
  document.getElementById('breakdown-amounts-note').textContent = entry
    ? `${BREAKDOWN_AMOUNT_FIELDS.map((f) => `${f.label} ${entry[f.key] !== null ? formatCurrency(entry[f.key]) : '—'}`).join(' · ')}`
      + ` — computed by the ${CONFIG.SHEETS.INSIGHT} tab's own formulas, and left untouched by this form.`
    : `The four totals come from the ${CONFIG.SHEETS.INSIGHT} tab's own formulas:`
      + ' this copies them from an existing row of the same shape, so the new row computes itself.';

  clearFieldError('breakdown-form-error');
  document.getElementById('breakdown-modal').hidden = false;
}

function closeBreakdownForm() {
  document.getElementById('breakdown-modal').hidden = true;
  editingBreakdownRow = null;
}

async function submitBreakdownForm(event) {
  event.preventDefault();

  const category = document.getElementById('breakdown-category').value.trim();
  const type = document.getElementById('breakdown-type').value.trim();
  if (!category) {
    showFieldError('breakdown-form-error', 'Category is what names the row — it can\'t be blank.');
    return;
  }

  try {
    // A:B only, on both paths. Widening either range is what would flatten the
    // formulas in C:F.
    const row = editingBreakdownRow ?? await insertBreakdownRowFrom(type);
    await updateValues(
      `'${CONFIG.SHEETS.INSIGHT}'!A${row}:B${row}`,
      [[category, type]]
    );
    closeBreakdownForm();
    await refreshBreakdown(true);
  } catch (err) {
    showFieldError('breakdown-form-error', err.message);
  }
}

// Which existing row a new one is modelled on. A category's own total row sums
// every Type under it while a typed row sums one of them, so the two carry
// different formulas — matching on whether a Type was given picks a template
// whose arithmetic is the right shape. Last match wins, so a new row lands at the
// bottom of the tab rather than in the middle of an existing category's block.
function breakdownTemplateRow(type) {
  const wantsType = type !== '';
  const candidates = allBreakdownRows.filter((b) => (b.type !== '') === wantsType);
  return (candidates.length ? candidates : allBreakdownRows).slice(-1)[0] || null;
}

// Makes an empty row for the form to fill and returns its row number. The
// formulas are what make this more than an append: a row typed from scratch has
// four blank money columns and stays blank forever, so a template row is copied
// (copyPaste, which rewrites its relative references for the new row) and only
// then are Category/Type overwritten. With nothing to copy — an empty tab — it
// falls back to a plain append, and the four columns are yours to fill in.
async function insertBreakdownRowFrom(type) {
  const template = breakdownTemplateRow(type);
  if (!template) {
    await appendValues(BREAKDOWN_RANGE, [['', '']]);
    const resp = await getValues(BREAKDOWN_RANGE, VALUE_PARAMS);
    return (resp.values || []).length + 1;
  }

  const sheetId = await breakdownSheetIdOrFetch();
  await batchUpdate([
    {
      insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: template.row, endIndex: template.row + 1 },
        inheritFromBefore: true,
      },
    },
    {
      copyPaste: {
        source: { sheetId, startRowIndex: template.row - 1, endRowIndex: template.row, startColumnIndex: 0, endColumnIndex: 6 },
        destination: { sheetId, startRowIndex: template.row, endRowIndex: template.row + 1, startColumnIndex: 0, endColumnIndex: 6 },
        pasteType: 'PASTE_NORMAL',
      },
    },
  ]);
  return template.row + 1;
}

async function breakdownSheetIdOrFetch() {
  if (breakdownSheetId === null) {
    breakdownSheetId = findSheetId(await getSpreadsheetMetadata(), CONFIG.SHEETS.INSIGHT);
  }
  return breakdownSheetId;
}

// Inserts a copy directly below the row, formulas and all. Two requests rather
// than an append: `copyPaste` is what rewrites a formula's relative references
// for its new row, so the copy computes its own four figures instead of either
// arriving empty (a values append) or pointing at the row it came from (pasting
// the formula text). Edit the copy's Category/Type afterwards — that's also how
// a genuinely new row gets made, since a row typed from scratch would have no
// formulas in it at all.
async function duplicateBreakdownRow(entry) {
  const sheetId = await breakdownSheetIdOrFetch();
  const index = entry.row - 1;   // 0-based, as the batchUpdate ranges want it

  await batchUpdate([
    {
      insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: entry.row, endIndex: entry.row + 1 },
        inheritFromBefore: true,
      },
    },
    {
      copyPaste: {
        source: { sheetId, startRowIndex: index, endRowIndex: entry.row, startColumnIndex: 0, endColumnIndex: 6 },
        destination: { sheetId, startRowIndex: entry.row, endRowIndex: entry.row + 1, startColumnIndex: 0, endColumnIndex: 6 },
        pasteType: 'PASTE_NORMAL',
      },
    },
  ]);

  await refreshBreakdown(true);
}

async function deleteBreakdownRow(entry) {
  const label = entry.type ? `${entry.category} / ${entry.type}` : `${entry.category} (total row)`;
  await confirmAndDelete(`Delete "${label}"? Any formula elsewhere that points at this row will lose it.`, async () => {
    const sheetId = await breakdownSheetIdOrFetch();
    await batchUpdate([{
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: entry.row - 1, endIndex: entry.row },
      },
    }]);
    await refreshBreakdown(true);
  });
}
