const WELLNESS_RANGE = `'${CONFIG.SHEETS.WELLNESS}'!A2:G`;
const W_PAGE_SIZE = 28;
const WEIGHT_GOAL_KG = 82;

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
let wellnessProjectionChart = null;

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

    const dupBtn = document.createElement('button');
    dupBtn.className = 'btn';
    dupBtn.textContent = '📋';
    dupBtn.title = 'Duplicate';
    dupBtn.setAttribute('aria-label', 'Duplicate');
    dupBtn.addEventListener('click', () => openWellnessForm(e, true));

    actionsCell.append(editBtn, dupBtn, deleteBtn);
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

function openWellnessForm(entry, duplicate = false) {
  const now = new Date();
  const today = wIsoFromDate(now);
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
  renderWellnessProjectionChart();
}

function renderWellnessWeightChart() {
  const ctx = document.getElementById('wellness-weight-chart');
  if (wellnessWeightChart) wellnessWeightChart.destroy();

  const dates = lastNDates(7);
  const byDate = new Map();
  allWellnessEntries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .forEach((e) => byDate.set(e.date, e.amount));

  wellnessWeightChart = new Chart(ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'line',
          label: 'Weight',
          data: dates.map((d) => byDate.get(d) ?? null),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, .1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          spanGaps: true,
          order: 2,
        },
        {
          type: 'line',
          label: `${WEIGHT_GOAL_KG} kg goal`,
          data: new Array(7).fill(WEIGHT_GOAL_KG),
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
        x: { ticks: { maxRotation: 0 } },
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
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Calories',
          data: dates.map((d) => byDate.get(d) || 0),
          backgroundColor: '#f59e0b',
          order: 2,
        },
        {
          type: 'line',
          label: '2000 kcal target',
          data: new Array(7).fill(2000),
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
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Activity',
          data: activityData,
          backgroundColor: '#10b981',
          order: 2,
        },
        {
          type: 'line',
          label: '100 min target',
          data: new Array(7).fill(100),
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

function linearRegressionSlope(xs, ys) {
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function calcProjection() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = wIsoFromDate(today);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - 14);
  const cutoffIso = wIsoFromDate(cutoff);

  const weightEntries = allWellnessEntries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (weightEntries.length < 2) return null;

  const lastWeight = weightEntries[weightEntries.length - 1].amount;
  if (Math.abs(lastWeight - WEIGHT_GOAL_KG) < 0.1) return { status: 'reached' };

  const recentEntries = allWellnessEntries.filter((e) => e.date >= cutoffIso && e.date <= todayIso);

  const caloriesByDate = new Map();
  const activityByDate = new Map();
  const sleepByDate = new Map();

  recentEntries.forEach((e) => {
    if (e.category === 'Calories' && e.amount !== null) {
      caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
    } else if (e.category === 'Activity' && e.amount !== null) {
      const mins = toActivityMinutes(e.amount, e.unit);
      activityByDate.set(e.date, (activityByDate.get(e.date) || 0) + mins);
    } else if (e.category === 'Sleep' && e.amount !== null) {
      sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
    }
  });

  const avg = (map) => [...map.values()].reduce((a, b) => a + b, 0) / map.size;

  let slope;
  let method;

  if (caloriesByDate.size > 0 || activityByDate.size > 0) {
    const avgCalories = caloriesByDate.size > 0 ? avg(caloriesByDate) : 2000;
    const avgActivityMins = activityByDate.size > 0 ? avg(activityByDate) : 0;
    const avgSleep = sleepByDate.size > 0 ? avg(sleepByDate) : 8;

    // Negative balance = caloric deficit = weight loss
    const balance = avgCalories - (2000 + avgActivityMins * 5);
    const baseSlope = balance / 7700;
    const sleepRatio = Math.min(1.0, Math.max(0.7, avgSleep / 8));
    slope = baseSlope * sleepRatio;

    const allPresent = caloriesByDate.size > 0 && activityByDate.size > 0 && sleepByDate.size > 0;
    method = allPresent ? 'full' : 'partial';
  } else {
    const src = weightEntries.filter((e) => e.date >= cutoffIso);
    const data = src.length >= 2 ? src : weightEntries;
    slope = linearRegressionSlope(data.map((_, i) => i), data.map((e) => e.amount));
    method = 'weight-only';
  }

  if (slope === 0) return { status: 'no-change', method };

  const goingDown = WEIGHT_GOAL_KG < lastWeight;
  if ((goingDown && slope > 0) || (!goingDown && slope < 0)) return { status: 'wrong-direction', method };

  const daysToGoal = Math.round((WEIGHT_GOAL_KG - lastWeight) / slope);
  const etaDate = new Date(today);
  etaDate.setDate(today.getDate() + daysToGoal);

  const cappedDays = Math.min(daysToGoal, 365);
  const projectedPoints = [];
  for (let d = 0; d <= cappedDays; d += 7) {
    const pd = new Date(today);
    pd.setDate(today.getDate() + d);
    projectedPoints.push({ date: wIsoFromDate(pd), weight: Math.round((lastWeight + slope * d) * 10) / 10 });
  }
  if (daysToGoal <= 365) {
    projectedPoints.push({ date: wIsoFromDate(etaDate), weight: WEIGHT_GOAL_KG });
  }

  return { status: 'ok', slope, daysToGoal, etaDate, projectedPoints, method };
}

function renderWellnessProjectionChart() {
  const ctx = document.getElementById('wellness-projection-chart');
  if (wellnessProjectionChart) wellnessProjectionChart.destroy();

  const etaEl = document.getElementById('weight-projection-eta');
  etaEl.textContent = '';

  const weightEntries = allWellnessEntries
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (weightEntries.length < 2) return;

  const proj = calcProjection();
  if (!proj) return;

  if (proj.status === 'reached') { etaEl.textContent = 'Goal reached! 🎉'; return; }
  if (proj.status === 'no-change') { etaEl.textContent = 'No net change at current habits'; return; }
  if (proj.status === 'wrong-direction') { etaEl.textContent = 'Current habits trend away from goal — projection unavailable'; return; }

  const histLabels = weightEntries.map((e) => e.date);
  const projLabels = proj.projectedPoints.map((p) => p.date);
  const allLabels = [...new Set([...histLabels, ...projLabels])].sort();

  const histMap = new Map(weightEntries.map((e) => [e.date, e.amount]));
  const projMap = new Map(proj.projectedPoints.map((p) => [p.date, p.weight]));
  const lastDate = histLabels[histLabels.length - 1];
  const lastWeight = weightEntries[weightEntries.length - 1].amount;

  wellnessProjectionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Actual Weight',
          data: allLabels.map((d) => histMap.get(d) ?? null),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          fill: false,
          tension: 0.3,
          pointRadius: 2,
          spanGaps: false,
          order: 3,
        },
        {
          label: 'Projected',
          data: allLabels.map((d) => {
            if (d < lastDate) return null;
            if (d === lastDate) return lastWeight;
            return projMap.get(d) ?? null;
          }),
          borderColor: '#6366f1',
          borderDash: [6, 4],
          fill: false,
          tension: 0,
          pointRadius: 0,
          spanGaps: false,
          order: 2,
        },
        {
          label: `${WEIGHT_GOAL_KG} kg goal`,
          data: allLabels.map(() => WEIGHT_GOAL_KG),
          borderColor: '#dc2626',
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 14, font: { size: 11 } } },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 10, maxRotation: 0 } },
        y: {
          beginAtZero: false,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: (v) => `${v} kg` },
        },
      },
    },
  });

  const etaStr = proj.etaDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const note = proj.method === 'weight-only' ? ' · weight trend only'
    : proj.method === 'partial' ? ' · partial habit data' : '';
  etaEl.textContent = `Projected to reach ${WEIGHT_GOAL_KG} kg on ${etaStr} (~${proj.daysToGoal} days)${note}`;
}
