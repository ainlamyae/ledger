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

let wellnessWeightChart = null;
let wellnessCaloriesChart = null;
let wellnessSleepChart = null;
let wellnessActivityChart = null;

function wIsoFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function lastNDates(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (n - 1 - i));
    return wIsoFromDate(d);
  });
}

async function fetchWellnessSheetId() {
  const { sheets } = await getSpreadsheetMetadata();
  const sheet = sheets.find((s) => s.properties.title === CONFIG.SHEETS.WELLNESS);
  if (!sheet) throw new Error(`Sheet "${CONFIG.SHEETS.WELLNESS}" not found`);
  return sheet.properties.sheetId;
}

async function initWellness(forceRefresh = false) {
  if (!wellnessListenersAttached) {
    wellnessListenersAttached = true;

    document.getElementById('add-wellness-btn').addEventListener('click', () => openWellnessForm(null));
    document.getElementById('wellness-cancel-btn').addEventListener('click', closeWellnessForm);
    document.getElementById('wellness-form').addEventListener('submit', submitWellnessForm);
    document.getElementById('wellness-category').addEventListener('change', onCategoryChange);

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
  renderWellnessCharts();
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

    const makeCell = (text, title) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (title) td.title = title;
      return td;
    };

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

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.addEventListener('click', () => openWellnessForm(e));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', () => deleteWellnessEntry(e));

    actionsCell.append(editBtn, deleteBtn);
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  renderWellnessPagination(totalPages);
}

function renderWellnessPagination(totalPages) {
  const container = document.getElementById('wellness-pagination');
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const prev = document.createElement('button');
  prev.className = 'btn';
  prev.textContent = '⬅️';
  prev.title = 'Previous page';
  prev.setAttribute('aria-label', 'Previous page');
  prev.disabled = wCurrentPage === 1;
  prev.addEventListener('click', () => { wCurrentPage--; renderWellnessList(); });

  const info = document.createElement('span');
  info.textContent = `${wCurrentPage} of ${totalPages}`;

  const next = document.createElement('button');
  next.className = 'btn';
  next.textContent = '➡️';
  next.title = 'Next page';
  next.setAttribute('aria-label', 'Next page');
  next.disabled = wCurrentPage === totalPages;
  next.addEventListener('click', () => { wCurrentPage++; renderWellnessList(); });

  container.append(prev, info, next);
}

function openWellnessForm(entry) {
  const now = new Date();
  const today = wIsoFromDate(now);
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  editingWellnessRow = entry ? entry.row : null;

  document.getElementById('wellness-modal-title').textContent = entry ? 'Edit Entry' : 'Add Entry';
  document.getElementById('wellness-entry-date').value = entry ? entry.date : today;
  document.getElementById('wellness-entry-time').value = entry ? entry.time : currentTime;
  document.getElementById('wellness-category').value = entry ? entry.category : '';
  document.getElementById('wellness-amount').value = entry && entry.amount !== null ? String(entry.amount) : '';
  document.getElementById('wellness-notes').value = entry ? entry.notes : '';

  onCategoryChange();

  // Restore the entry's own description and unit (onCategoryChange sets category defaults)
  document.getElementById('wellness-description').value = entry ? entry.description : '';
  document.getElementById('wellness-unit').value = entry ? entry.unit : document.getElementById('wellness-unit').value;

  document.getElementById('wellness-form-error').hidden = true;
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

  const dl = document.getElementById('wellness-description-options');
  dl.innerHTML = '';
  defaults.descriptions.forEach((d) => {
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

  const errorEl = document.getElementById('wellness-form-error');

  const amount = evaluateNumberExpression(amountRaw);
  if (amountRaw && amount === null) {
    errorEl.textContent = 'Amount must be a number (e.g. 94 or 30+15).';
    errorEl.hidden = false;
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
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

async function deleteWellnessEntry(entry) {
  if (!confirm(`Delete this ${entry.category} entry from ${entry.date}?`)) return;

  try {
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
  } catch (err) {
    alert(`Couldn't delete entry: ${err.message}`);
  }
}

function renderWellnessCharts() {
  renderWellnessWeightChart();
  renderWellnessCaloriesChart();
  renderWellnessSleepChart();
  renderWellnessActivityChart();
}

function renderWellnessWeightChart() {
  const ctx = document.getElementById('wellness-weight-chart');
  if (wellnessWeightChart) wellnessWeightChart.destroy();

  const entries = allWellnessEntries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  if (entries.length === 0) return;

  wellnessWeightChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: entries.map((e) => e.date),
      datasets: [{
        label: 'Weight',
        data: entries.map((e) => e.amount),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, .1)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 7, maxRotation: 0 } },
        y: {
          beginAtZero: false,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: (v) => `${v} kg` },
        },
      },
    },
  });
}

function renderWellnessCaloriesChart() {
  const ctx = document.getElementById('wellness-calories-chart');
  if (wellnessCaloriesChart) wellnessCaloriesChart.destroy();

  const dates = lastNDates(7);
  const byDate = new Map();
  allWellnessEntries
    .filter((e) => e.category === 'Calories' && e.amount !== null)
    .forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  wellnessCaloriesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [{
        label: 'Calories',
        data: dates.map((d) => byDate.get(d) || 0),
        backgroundColor: '#f59e0b',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: (v) => `${v} kcal` },
        },
      },
    },
  });
}

function renderWellnessSleepChart() {
  const ctx = document.getElementById('wellness-sleep-chart');
  if (wellnessSleepChart) wellnessSleepChart.destroy();

  const dates = lastNDates(7);
  const byDate = new Map();
  allWellnessEntries
    .filter((e) => e.category === 'Sleep' && e.amount !== null)
    .forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  const sleepData = dates.map((d) => byDate.get(d) || 0);

  wellnessSleepChart = new Chart(ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Sleep',
          data: sleepData,
          backgroundColor: '#6366f1',
          order: 2,
        },
        {
          type: 'line',
          label: '8 hr target',
          data: new Array(7).fill(8),
          borderColor: '#dc2626',
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: (v) => `${v} hr` },
        },
      },
    },
  });
}

// Convert any activity amount to minutes so steps and timed entries
// are comparable on the same chart. ~100 steps/min is a typical walking pace.
function toActivityMinutes(amount, unit) {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'steps' || u === 'step') return Math.round(amount / 100);
  if (u === 'hr' || u === 'hour' || u === 'hours') return Math.round(amount * 60);
  return amount; // 'min' or unknown — use as-is
}

function renderWellnessActivityChart() {
  const ctx = document.getElementById('wellness-activity-chart');
  if (wellnessActivityChart) wellnessActivityChart.destroy();

  const dates = lastNDates(7);
  const byDate = new Map();
  allWellnessEntries
    .filter((e) => e.category === 'Activity' && e.amount !== null)
    .forEach((e) => {
      const mins = toActivityMinutes(e.amount, e.unit);
      byDate.set(e.date, (byDate.get(e.date) || 0) + mins);
    });

  const activityData = dates.map((d) => byDate.get(d) || 0);
  const hasData = activityData.some((v) => v > 0);

  wellnessActivityChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [{
        label: 'Activity',
        data: activityData,
        backgroundColor: '#10b981',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: !hasData,
          text: 'No activity logged yet — add a Walk, Run, or Workout entry to get started',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: (v) => `${v} min` },
        },
      },
    },
  });
}
