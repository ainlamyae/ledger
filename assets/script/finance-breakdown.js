// The Breakdown tab as a table: one row per Category × Type, with four period totals.
//
// Columns C-F are the sheet's own formulas (what Finance's Charts read), so every
// write here is scoped to A:B, the two text columns naming the row. Nothing in this
// file may replace a formula with the number it produced.
//
// A2:F — Category, Type, Last Month, Last Quarter, Last Year, Lifelong.
const BREAKDOWN_RANGE = sheetRange(CONFIG.SHEETS.INSIGHT, 'A2:F');
const BREAKDOWN_PAGE_SIZE = 100;
// A:F, the width a copied row spans.
const BREAKDOWN_COLUMN_COUNT = 6;

// The four money columns in sheet order: the table, the sort keys and the form's summary.
const BREAKDOWN_AMOUNT_FIELDS = [
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'lastQuarter', label: 'Last Quarter' },
  { key: 'lastYear', label: 'Last Year' },
  { key: 'lifelong', label: 'Lifelong' },
];

let allBreakdownRows = [];
let editBreakdown = null;
let breakdownSheetId = null;
let editingBreakdownRow = null;
let breakdownListenersAttached = false;
let bSort = { key: null, dir: 1 };
let bCurrentPage = 1;

async function initBreakdown(forceRefresh = false) {
  // Re-resolved after each load, as the spreadsheet may have been switched.
  breakdownSheetId = null;
  if (!breakdownListenersAttached) {
    breakdownListenersAttached = true;

    document.getElementById('add-breakdown-btn').addEventListener('click', () => openBreakdownForm(null));
    editBreakdown = routedRowEdit('breakdown', () => allBreakdownRows, (b) => [b.category, b.type].filter(Boolean).join(' '), openBreakdownForm);
    document.getElementById('breakdown-cancel-btn').addEventListener('click', closeBreakdownForm);
    onFormSubmit('breakdown-form', submitBreakdownForm);
    document.getElementById('breakdown-search').addEventListener('input', resetBreakdownPageAndRender);
    makeSortableHeaders('#breakdown-table', bSort, resetBreakdownPageAndRender);
  }

  await refreshBreakdown(forceRefresh);
}

function resetBreakdownPageAndRender() {
  bCurrentPage = 1;
  renderBreakdownList();
}

async function refreshBreakdown(forceRefresh = false) {
  const resp = await getValues(BREAKDOWN_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

  allBreakdownRows = values
    .map((row, i) => ({
      row: i + 2,
      category: cellText(row[0]).trim(),
      // Blank is a category's total row; kept '' since that's what the sheet reads and an edit writes back.
      type: cellText(row[1]).trim(),
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
    // Nulls sort as 0, as their blank cells read on the sheet.
    ? ((a[key] ?? 0) - (b[key] ?? 0)) * dir
    : String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' }) * dir));
}

// Red/green as on Accounts. Always `num`: .income/.expense right-align, so an
// uncoloured $0.00 would otherwise hang left.
function breakdownAmountCell(value) {
  const cell = makeCell(value !== null ? formatCurrency(value) : '—');
  cell.className = 'num';
  if (value !== null && value !== 0) cell.classList.add(amountSignClass(value));
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

  let prevCategory = null;
  pageItems.forEach((b) => {
    const tr = document.createElement('tr');
    if (prevCategory !== null && b.category !== prevCategory) tr.classList.add('breakdown-category-start');
    prevCategory = b.category;

    tr.append(
      makeCell(b.category),
      makeCell(b.type || '—', b.type ? undefined : `Every Type under ${b.category}, totalled`),
      ...BREAKDOWN_AMOUNT_FIELDS.map((f) => breakdownAmountCell(b[f.key])),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editBreakdown(b) }),
      // Copies the formulas, not their values (see duplicateBreakdownRow).
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

function openBreakdownForm(entry) {
  editingBreakdownRow = entry ? entry.row : null;

  document.getElementById('breakdown-category').value = entry ? entry.category : '';
  document.getElementById('breakdown-type').value = entry ? entry.type : '';
  // Used values first, so free text doesn't fragment; types from every category, as words repeat across them.
  fillFrequencyDatalist('breakdown-category-options', allBreakdownRows.map((b) => b.category));
  fillFrequencyDatalist('breakdown-type-options', allBreakdownRows.map((b) => b.type));

  // The amounts are text, not fields: this form writes A and B only.
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
    // A:B only, on both paths: a wider range would flatten C:F's formulas. RAW: plain text.
    let row = editingBreakdownRow;
    if (row === null) row = await insertBreakdownRowFrom(category, type);
    else await updateValues(sheetRange(CONFIG.SHEETS.INSIGHT, `A${row}:B${row}`), [[category, type]], 'RAW');
    await refreshBreakdown(true);
    const saved = allBreakdownRows.find((b) => b.row === row);
    if (saved) {
      openBreakdownForm(saved);
      stayOnSavedForm('breakdown-modal', editBreakdown.step(saved));
    }
    showFormSaved('breakdown-form-error');
  } catch (err) {
    showFieldError('breakdown-form-error', err.message);
  }
}

// The row a new one copies: a total row (blank Type) and a typed row carry
// differently shaped formulas, so match on that. The last match, so the new row
// lands at the bottom.
function breakdownTemplateRow(type) {
  const wantsType = type !== '';
  const candidates = allBreakdownRows.filter((b) => (b.type !== '') === wantsType);
  return (candidates.length ? candidates : allBreakdownRows).slice(-1)[0] || null;
}

// Adds the named row, returning its row number: a copy of a template row (so it has
// formulas), or on an empty tab a plain append with no formulas.
async function insertBreakdownRowFrom(category, type) {
  const template = breakdownTemplateRow(type);
  if (!template) return appendedRow(await appendValues(BREAKDOWN_RANGE, [[category, type]], 'RAW'));

  await copyBreakdownRowBelow(template.row, [category, type]);
  return template.row + 1;
}

async function breakdownSheetIdOrFetch() {
  if (breakdownSheetId === null) {
    breakdownSheetId = findSheetId(await getSpreadsheetMetadata(), CONFIG.SHEETS.INSIGHT);
  }
  return breakdownSheetId;
}

// Inserts a copy of a 1-based row directly below it. copyPaste, not an append,
// because it rewrites the formulas' relative references for the new row.
// `names` ([Category, Type]) go in the same request, so a failure leaves no stray copy.
async function copyBreakdownRowBelow(row, names = null) {
  const sheetId = await breakdownSheetIdOrFetch();
  const columns = { startColumnIndex: 0, endColumnIndex: BREAKDOWN_COLUMN_COUNT };
  const requests = [
    {
      insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: row, endIndex: row + 1 },
        inheritFromBefore: true,
      },
    },
    {
      copyPaste: {
        source: { sheetId, startRowIndex: row - 1, endRowIndex: row, ...columns },
        destination: { sheetId, startRowIndex: row, endRowIndex: row + 1, ...columns },
        pasteType: 'PASTE_NORMAL',
      },
    },
  ];
  if (names) {
    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: row, columnIndex: 0 },
        // An empty value clears the cell (a total row's blank Type).
        rows: [{ values: names.map((text) => (text ? { userEnteredValue: { stringValue: text } } : {})) }],
        fields: 'userEnteredValue',
      },
    });
  }
  await batchUpdate(requests);
}

// A copy computes its own figures; edit its Category/Type afterwards.
async function duplicateBreakdownRow(entry) {
  try {
    await copyBreakdownRowBelow(entry.row);
    await refreshBreakdown(true);
  } catch (err) {
    showToast(`Couldn't duplicate: ${err.message}`, true);
  }
}

async function deleteBreakdownRow(entry) {
  const label = entry.type ? `${entry.category} / ${entry.type}` : `${entry.category} (total row)`;
  await confirmAndDelete(`Delete "${label}"? Any formula elsewhere that points at this row will lose it.`, async () => {
    const sheetId = await breakdownSheetIdOrFetch();
    await batchUpdate([sheetRowDeleteRequest(sheetId, entry.row)]);
    await refreshBreakdown(true);
  });
}
