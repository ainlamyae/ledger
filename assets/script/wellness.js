const WELLNESS_RANGE = `'${CONFIG.SHEETS.WELLNESS}'!A2:G`;
const W_PAGE_SIZE = 28;

const CATEGORY_DEFAULTS = {
  Sleep:    { unit: 'hr',   descriptions: ['Sleep Duration'] },
  Weight:   { unit: 'kg',   descriptions: ['Morning Weight', 'Evening Weight'] },
  Calories: { unit: 'kcal', descriptions: ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Beverage', 'Other'] },
  Activity: { unit: 'steps', descriptions: ['Walk', 'Run', 'Workout', 'Cycling', 'Swimming', 'HIIT', 'Yoga', 'Strength Training', 'Basketball', 'Stretching'] },
};

let allWellnessEntries = [];
let wellnessListenersAttached = false;
let wSort = { dir: -1 };
let wCurrentPage = 1;
let wellnessSheetId = null;
let editingWellnessRow = null;

async function fetchWellnessSheetId() {
  const metadata = await getSpreadsheetMetadata();
  return findSheetId(metadata, CONFIG.SHEETS.WELLNESS);
}

async function initWellness(forceRefresh = false) {
  if (!wellnessListenersAttached) {
    wellnessListenersAttached = true;

    document.getElementById('add-wellness-btn').addEventListener('click', () => openWellnessForm(null));
    document.getElementById('wellness-cancel-btn').addEventListener('click', closeWellnessForm);
    document.getElementById('wellness-form').addEventListener('submit', submitWellnessForm);
    document.getElementById('wellness-category').addEventListener('change', onCategoryChange);
    document.getElementById('wellness-calc-btn').addEventListener('click', calculateWellnessCalories);

    document.getElementById('wellness-date-from').addEventListener('input', () => {
      wCurrentPage = 1;
      renderWellnessList();
    });
    document.getElementById('wellness-date-to').addEventListener('input', () => {
      wCurrentPage = 1;
      renderWellnessList();
    });
    document.getElementById('wellness-category-filter').addEventListener('change', () => {
      wCurrentPage = 1;
      renderWellnessList();
    });

    setupWellnessSorting();
  }

  await refreshWellness(forceRefresh);
}

function setupWellnessSorting() {
  const th = document.querySelector('#wellness-table th.sortable');
  if (!th) return;

  const label = document.createElement('span');
  label.textContent = th.textContent;
  const indicator = document.createElement('span');
  indicator.className = 'sort-indicator';
  th.textContent = '';
  th.append(label, indicator);
  th.setAttribute('tabindex', '0');

  const updateIndicator = () => { indicator.textContent = wSort.dir === 1 ? ' ▲' : ' ▼'; };
  updateIndicator();

  th.addEventListener('click', () => {
    wSort.dir *= -1;
    updateIndicator();
    wCurrentPage = 1;
    renderWellnessList();
  });
  th.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
  });
}

async function refreshWellness(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('wellness');
  if (!values) {
    const resp = await getValues(WELLNESS_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('wellness', values);
  }

  allWellnessEntries = values
    .map((row, i) => ({
      row: i + 2,
      date: row[0] || '',
      time: String(row[1] || '').slice(0, 5),
      category: row[2] || '',
      description: row[3] || '',
      amount: (row[4] !== undefined && row[4] !== '') ? Number(row[4]) : null,
      unit: row[5] || '',
      notes: row[6] || '',
    }))
    .filter((e) => e.date);

  renderWellnessList();
  renderWellnessCharts(allWellnessEntries);
}

function getFilteredWellnessEntries() {
  const dateFrom = document.getElementById('wellness-date-from').value;
  const dateTo = document.getElementById('wellness-date-to').value;
  const catFilter = document.getElementById('wellness-category-filter').value;

  return allWellnessEntries
    .filter((e) => (!dateFrom || e.date >= dateFrom) && (!dateTo || e.date <= dateTo))
    .filter((e) => !catFilter || e.category === catFilter)
    .sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp * wSort.dir;
      return a.time.localeCompare(b.time) * wSort.dir;
    });
}

function renderWellnessList() {
  const tbody = document.getElementById('wellness-body');
  tbody.innerHTML = '';

  const entries = getFilteredWellnessEntries();
  const totalPages = Math.max(1, Math.ceil(entries.length / W_PAGE_SIZE));
  wCurrentPage = Math.min(wCurrentPage, totalPages);

  const start = (wCurrentPage - 1) * W_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + W_PAGE_SIZE);

  if (pageEntries.length === 0) {
    const message = allWellnessEntries.length === 0
      ? 'No wellness entries yet — click "+ Add Entry" to get started.'
      : 'No entries match this filter.';
    tbody.appendChild(renderEmptyRow(8, message));
  }

  pageEntries.forEach((e) => {
    const tr = document.createElement('tr');

    const notesShort = e.notes.length > 20 ? `${e.notes.slice(0, 20)}…` : e.notes;

    tr.append(
      makeCell(e.date),
      makeCell(e.time || '—'),
      makeCell(e.category),
      makeCell(e.description),
      makeCell(e.amount !== null ? String(e.amount) : '—'),
      makeCell(e.unit),
      makeCell(notesShort, e.notes),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openWellnessForm(e) }),
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => openWellnessForm(e, true) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteWellnessEntry(e) }),
    );
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  renderWellnessPagination(totalPages);
}

function renderWellnessPagination(totalPages) {
  renderPager('wellness-pagination', {
    page: wCurrentPage,
    totalPages,
    onChange: (p) => {
      wCurrentPage = p;
      renderWellnessList();
    },
  });
}

function openWellnessForm(entry, duplicate = false) {
  const now = new Date();
  const today = isoFromDate(now);
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  editingWellnessRow = (entry && !duplicate) ? entry.row : null;

  const title = duplicate ? 'Duplicate Entry' : (entry ? 'Edit Entry' : 'Log Entry');
  document.getElementById('wellness-modal-title').textContent = title;
  document.getElementById('wellness-entry-date').value = entry ? entry.date : today;
  document.getElementById('wellness-entry-time').value = entry ? entry.time : currentTime;
  document.getElementById('wellness-category').value = entry ? entry.category : '';
  document.getElementById('wellness-amount').value = entry && entry.amount !== null ? String(entry.amount) : '';
  document.getElementById('wellness-notes').value = entry ? entry.notes : '';

  onCategoryChange();

  // Restore the entry's own description and unit (onCategoryChange sets category defaults)
  document.getElementById('wellness-description').value = entry ? entry.description : '';
  document.getElementById('wellness-unit').value = entry ? entry.unit : document.getElementById('wellness-unit').value;

  clearFieldError('wellness-form-error');
  document.getElementById('wellness-modal').hidden = false;
}

function closeWellnessForm() {
  document.getElementById('wellness-modal').hidden = true;
}

function onCategoryChange() {
  const cat = document.getElementById('wellness-category').value;
  const defaults = CATEGORY_DEFAULTS[cat] || { unit: '', descriptions: [] };

  document.getElementById('wellness-unit').value = defaults.unit;
  document.getElementById('wellness-description').value = '';

  // Historical descriptions for this category, sorted by frequency (most used first)
  const counts = new Map();
  allWellnessEntries
    .filter((e) => e.category === cat && e.description)
    .forEach((e) => counts.set(e.description, (counts.get(e.description) || 0) + 1));
  const historical = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);

  // Merge historical first, then any defaults not already in history
  const seen = new Set(historical);
  const merged = [...historical, ...defaults.descriptions.filter((d) => !seen.has(d))];

  const dl = document.getElementById('wellness-description-options');
  dl.innerHTML = '';
  merged.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    dl.appendChild(opt);
  });
}

async function submitWellnessForm(event) {
  event.preventDefault();

  const date = document.getElementById('wellness-entry-date').value;
  const time = document.getElementById('wellness-entry-time').value;
  const category = document.getElementById('wellness-category').value;
  const description = document.getElementById('wellness-description').value;
  const amountRaw = document.getElementById('wellness-amount').value;
  const unit = document.getElementById('wellness-unit').value;
  const notes = document.getElementById('wellness-notes').value;

  const amount = evaluateNumberExpression(amountRaw);
  if (amountRaw && amount === null) {
    showFieldError('wellness-form-error', 'Amount must be a number (e.g. 94 or 30+15).');
    return;
  }

  const rowData = [date, time, category, description, amount !== null ? amount : '', unit, notes];

  try {
    if (editingWellnessRow !== null) {
      await updateValues(`'${CONFIG.SHEETS.WELLNESS}'!A${editingWellnessRow}:G${editingWellnessRow}`, [rowData]);
    } else {
      await appendValues(WELLNESS_RANGE, [rowData]);
    }
    await refreshWellness(true);
    closeWellnessForm();
  } catch (err) {
    showFieldError('wellness-form-error', err.message);
  }
}

async function deleteWellnessEntry(entry) {
  await confirmAndDelete(`Delete this ${entry.category} entry from ${entry.date}?`, async () => {
    if (!wellnessSheetId) wellnessSheetId = await fetchWellnessSheetId();
    await batchUpdate([{
      deleteDimension: {
        range: {
          sheetId: wellnessSheetId,
          dimension: 'ROWS',
          startIndex: entry.row - 1,
          endIndex: entry.row,
        },
      },
    }]);
    await refreshWellness(true);
  }, "Couldn't delete entry");
}

