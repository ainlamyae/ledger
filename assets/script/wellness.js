const WELLNESS_RANGE = `'${CONFIG.SHEETS.WELLNESS}'!A2:H`;
const W_PAGE_SIZE = 28;

const CATEGORY_DEFAULTS = {
  Sleep:    { unit: 'hr',   descriptions: ['Sleep Duration'] },
  Weight:   { unit: 'kg',   descriptions: ['Morning Weight', 'Evening Weight'] },
  Calories: { unit: 'kcal', descriptions: ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Beverage', 'Other'] },
  Activity: { unit: 'steps', descriptions: ['Walk', 'Run', 'Workout', 'Cycling', 'Swimming', 'HIIT', 'Yoga', 'Strength Training', 'Basketball', 'Stretching'] },
  // Composite category written by the Calculate button (calorie-estimator.js):
  // one log entry carrying both macros, Amount/Unit each holding a ';'-joined
  // pair ("320; 10" / "kcal; g") rather than a plain single number.
  'Calories; Protein': { unit: 'kcal; g', descriptions: ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Beverage', 'Other'] },
  // Same idea, for the Activity side — written by the Calculate button
  // (activity-estimator.js) once it can derive both a duration and a
  // calorie burn (currently just Strength Training, from the workout note).
  'Activity; Calories': { unit: 'min; kcal', descriptions: ['Walk', 'Run', 'Workout', 'Cycling', 'Swimming', 'HIIT', 'Yoga', 'Strength Training', 'Basketball', 'Stretching'] },
};

// True for the composite "Calories; Protein" category (or any future
// ';'-joined category) — these rows carry paired Amount/Unit values instead
// of a single number, and need their own parse/validate/display path.
function isCompositeCategory(category) {
  return category.includes(';');
}

// Accepted separators between a Sleep entry's bed and wake time. '/' is the
// canonical, always-written form; ';' is also accepted on read/input since a
// few rows ended up saved that way (edited directly in the Sheet) — saving
// one of those again through the app normalizes it back to '/'.
const SLEEP_PAIR_SEPARATOR = /[/;]/;

// Parses "HH:MM" (1 or 2-digit hour) into minutes since midnight, or null if
// malformed — the shared validator for both typing a Sleep bed/wake pair into
// the Amount field and re-parsing it back out of the sheet on load.
function parseClockTime(str) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(str.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function formatClockTime24(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
// Duration in hours between a bed time and a wake time, wrapping past
// midnight (wake <= bed means the wake happened the next calendar day).
function sleepDurationHours(bedMin, wakeMin) {
  const diff = wakeMin <= bedMin ? wakeMin + 1440 - bedMin : wakeMin - bedMin;
  return Math.round((diff / 60) * 10) / 10;
}

// Round-trips an entry's Amount/Unit back into the raw ';'-joined form the
// sheet stores (or a plain value for non-composite entries) — used both to
// repopulate the edit form and to snapshot a row before bulk Recalculate
// overwrites it, so an undo can restore the exact original cell text.
function rawAmountString(e) {
  if (e.sleepBedMin !== null && e.sleepBedMin !== undefined && e.sleepWakeMin !== null && e.sleepWakeMin !== undefined) {
    return `${formatClockTime24(e.sleepBedMin)}/${formatClockTime24(e.sleepWakeMin)}`;
  }
  if (e.amount === null) return '';
  return e.amount2 !== null ? `${e.amount}; ${e.amount2}` : String(e.amount);
}
function rawUnitString(e) {
  return e.unit2 ? `${e.unit}; ${e.unit2}` : e.unit;
}
function rawBreakdownString(e) {
  return breakdownToJson(e.breakdown);
}

function isActivityCategory(category) {
  return category === 'Activity' || category === 'Activity; Calories';
}

// Food entries and Activity/workout entries can both be (re)estimated from
// Notes — anything else (Sleep, Weight, a category-less row) has no formula
// to re-derive from.
function eligibleForRecalc(e) {
  return (e.category === 'Calories' || e.category === 'Calories; Protein' || isActivityCategory(e.category)) && e.notes.trim();
}

// Merge is scoped to the calorie/protein entries the user actually asked to
// combine — summing e.g. two Weight readings wouldn't be meaningful the
// same way, so Sleep/Weight/Activity aren't offered here.
function mergeableCategory(category) {
  return category === 'Calories' || category === 'Calories; Protein';
}

let allWellnessEntries = [];
let wellnessListenersAttached = false;
// Flips true once refreshWellness has populated allWellnessEntries at least
// once — lets a click that races the initial page-load fetch (e.g. Log
// Workout's auto-Calculate reading Weight entries) tell "still loading" apart
// from "genuinely nothing logged", instead of reporting the empty in-memory
// array as if it were the real answer.
let wellnessDataLoaded = false;
let wSort = { dir: -1 };
let wCurrentPage = 1;
let wellnessSheetId = null;
let editingWellnessRow = null;
let selectedWellnessRows = new Set();

async function fetchWellnessSheetId() {
  const metadata = await getSpreadsheetMetadata();
  return findSheetId(metadata, CONFIG.SHEETS.WELLNESS);
}

// The 🧮 Calculate button means something different per category: food
// (calorie-estimator.js) vs. workout (activity-estimator.js). Dispatched by
// whatever's currently selected rather than two separate buttons, since only
// one of Amount's two numbers ever needs computing at a time.
function handleCalculateClick() {
  const category = document.getElementById('wellness-category').value;
  if (category === 'Activity' || category === 'Activity; Calories') {
    calculateWellnessActivity();
  } else {
    calculateWellnessCalories();
  }
}

async function initWellness(forceRefresh = false) {
  if (!wellnessListenersAttached) {
    wellnessListenersAttached = true;

    document.getElementById('add-wellness-btn').addEventListener('click', () => openWellnessForm(null));
    document.getElementById('wellness-cancel-btn').addEventListener('click', closeWellnessForm);
    document.getElementById('wellness-form').addEventListener('submit', submitWellnessForm);
    document.getElementById('wellness-category').addEventListener('change', onCategoryChange);
    document.getElementById('wellness-is-pattern').addEventListener('change', syncWellnessPatternMode);
    document.getElementById('wellness-calc-btn').addEventListener('click', handleCalculateClick);
    // A real edit (not Calculate's own auto-fill, which sets .value
    // directly and doesn't fire 'input') means the shown breakdown no
    // longer reflects what's in the field.
    document.getElementById('wellness-notes').addEventListener('input', hideCalcBreakdown);

    document.getElementById('wellness-search').addEventListener('input', () => {
      wCurrentPage = 1;
      selectedWellnessRows.clear();
      renderWellnessList();
    });
    document.getElementById('wellness-date-from').addEventListener('input', () => {
      wCurrentPage = 1;
      selectedWellnessRows.clear();
      renderWellnessList();
    });
    document.getElementById('wellness-date-to').addEventListener('input', () => {
      wCurrentPage = 1;
      selectedWellnessRows.clear();
      renderWellnessList();
    });
    document.getElementById('wellness-category-filter').addEventListener('change', () => {
      wCurrentPage = 1;
      selectedWellnessRows.clear();
      renderWellnessList();
    });

    setupWellnessSorting();
    setupWellnessBulkActions();
  }

  await refreshWellness(forceRefresh);
}

function setupWellnessBulkActions() {
  document.getElementById('wellness-select-all').addEventListener('change', (e) => {
    const pageRows = getFilteredWellnessEntries().slice((wCurrentPage - 1) * W_PAGE_SIZE, wCurrentPage * W_PAGE_SIZE);
    pageRows.forEach((entry) => (e.target.checked ? selectedWellnessRows.add(entry.row) : selectedWellnessRows.delete(entry.row)));
    renderWellnessList();
  });

  document.getElementById('wellness-bulk-edit-btn').addEventListener('click', openWellnessBulkEditForm);
  document.getElementById('wellness-bulk-edit-cancel-btn').addEventListener('click', closeWellnessBulkEditForm);
  document.getElementById('wellness-bulk-edit-form').addEventListener('submit', submitWellnessBulkEditForm);
  document.getElementById('wellness-bulk-recalc-btn').addEventListener('click', bulkRecalculateWellness);
  document.getElementById('wellness-bulk-merge-btn').addEventListener('click', mergeSelectedWellnessEntries);
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
    selectedWellnessRows.clear();
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
    .map((row, i) => {
      const category = row[2] || '';
      const rawAmount = row[4];
      const rawUnit = row[5] || '';
      let amount = null;
      let amount2 = null;
      let unit = rawUnit;
      let unit2 = null;
      let sleepBedMin = null;
      let sleepWakeMin = null;

      if (isCompositeCategory(category)) {
        if (rawAmount !== undefined && rawAmount !== '') {
          const [a1, a2] = String(rawAmount).split(';').map((s) => Number(s.trim()));
          amount = Number.isNaN(a1) ? null : a1;
          amount2 = Number.isNaN(a2) ? null : a2;
        }
        const [u1, u2] = rawUnit.split(';').map((s) => s.trim());
        unit = u1 || '';
        unit2 = u2 || null;
      } else if (category === 'Sleep' && typeof rawAmount === 'string' && SLEEP_PAIR_SEPARATOR.test(rawAmount)) {
        // Bed/wake pair typed as "HH:MM/HH:MM" (or, for a few rows edited
        // directly in the Sheet, "HH:MM; HH:MM") instead of a plain duration
        // — a legacy plain-number Sleep cell comes back from
        // UNFORMATTED_VALUE as a JS number, not a string, so the typeof
        // check above already keeps this branch from ever misfiring on an
        // old entry.
        const [bedStr, wakeStr] = rawAmount.split(SLEEP_PAIR_SEPARATOR).map((s) => s.trim());
        const bedMin = parseClockTime(bedStr);
        const wakeMin = parseClockTime(wakeStr);
        if (bedMin !== null && wakeMin !== null) {
          sleepBedMin = bedMin;
          sleepWakeMin = wakeMin;
          amount = sleepDurationHours(bedMin, wakeMin);
        } else {
          amount = null; // corrupt cell degrades gracefully, same as the breakdown JSON parse below
        }
      } else {
        amount = (rawAmount !== undefined && rawAmount !== '') ? Number(rawAmount) : null;
      }

      // Saved by calorie-estimator.js's Calculate button (column H) so an
      // existing entry's breakdown can be shown again on Edit without
      // re-running Groq/USDA — invalid/blank just means "no breakdown yet",
      // not a load error, so a corrupt cell degrades to [] rather than
      // failing the whole row.
      let breakdown = [];
      if (row[7]) {
        try {
          breakdown = JSON.parse(row[7]);
        } catch {
          breakdown = [];
        }
      }

      return {
        row: i + 2,
        date: row[0] || '',
        time: String(row[1] || '').slice(0, 5),
        category,
        description: row[3] || '',
        amount,
        amount2,
        unit,
        unit2,
        sleepBedMin,
        sleepWakeMin,
        notes: row[6] || '',
        breakdown,
      };
    });
  // A blank date (column A) marks a reusable "pattern" row — a template a
  // user can Duplicate and assign a real date to later, rather than a
  // logged event. Kept in allWellnessEntries so it's editable/duplicable
  // like any other row, but every chart/insight/calibration consumer must
  // use getDatedWellnessEntries() instead so an undated template can never
  // be mistaken for a logged sample (e.g. sorting first as the "earliest"
  // date, or corrupting a calibration interval).

  wellnessDataLoaded = true;
  renderWellnessList();
  renderWellnessCharts(getDatedWellnessEntries());
}

function getDatedWellnessEntries() {
  return allWellnessEntries.filter((e) => e.date);
}

function getFilteredWellnessEntries() {
  const search = document.getElementById('wellness-search').value.trim().toLowerCase();
  const dateFrom = document.getElementById('wellness-date-from').value;
  const dateTo = document.getElementById('wellness-date-to').value;
  const catFilter = document.getElementById('wellness-category-filter').value;

  return allWellnessEntries
    // Pattern rows (no date) are date-agnostic templates, so an active
    // date-range filter shouldn't hide them.
    .filter((e) => !e.date || ((!dateFrom || e.date >= dateFrom) && (!dateTo || e.date <= dateTo)))
    .filter((e) => !catFilter || e.category === catFilter)
    .filter((e) => {
      if (!search) return true;
      return (
        e.description.toLowerCase().includes(search) ||
        e.notes.toLowerCase().includes(search) ||
        e.unit.toLowerCase().includes(search) ||
        e.category.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => {
      // Patterns always float to the top, regardless of sort direction.
      if (!a.date !== !b.date) return a.date ? 1 : -1;
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
    tbody.appendChild(renderEmptyRow(9, message));
  }

  let previousDate = null;

  pageEntries.forEach((e) => {
    const tr = document.createElement('tr');

    // A thicker top border where the date changes from the row above makes
    // day boundaries visible at a glance — skipped for the first row on the
    // page, since there's no prior row on the same page to compare against.
    if (previousDate !== null && e.date !== previousDate) tr.classList.add('wellness-day-boundary');
    previousDate = e.date;

    const notesShort = e.notes.length > 20 ? `${e.notes.slice(0, 20)}…` : e.notes;
    const amountText = e.category === 'Sleep' && e.sleepBedMin !== null
      ? `${formatClockTime24(e.sleepBedMin)} / ${formatClockTime24(e.sleepWakeMin)}`
      : e.amount !== null
        ? (e.amount2 !== null ? `${e.amount} / ${e.amount2}` : String(e.amount))
        : '—';
    const unitText = e.unit2 ? `${e.unit} / ${e.unit2}` : e.unit;

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedWellnessRows.has(e.row);
    checkbox.setAttribute('aria-label', 'Select entry');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedWellnessRows.add(e.row);
      else selectedWellnessRows.delete(e.row);
      updateWellnessSelectAllCheckbox(pageEntries);
      updateWellnessBulkActionsUI();
    });
    checkboxCell.appendChild(checkbox);

    tr.append(
      checkboxCell,
      makeCell(e.date || '🔁 Pattern'),
      makeCell(e.time || '—'),
      makeCell(e.category),
      makeCell(e.description),
      makeCell(privacyMode ? maskDigits(amountText) : amountText),
      makeCell(unitText),
      makeCell(privacyMode ? maskText(notesShort) : notesShort, privacyMode ? maskText(e.notes) : e.notes),
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

  updateWellnessSelectAllCheckbox(pageEntries);
  updateWellnessBulkActionsUI();
  renderWellnessPagination(totalPages);
}

function updateWellnessSelectAllCheckbox(pageEntries) {
  const selectAll = document.getElementById('wellness-select-all');
  const selectedOnPage = pageEntries.filter((e) => selectedWellnessRows.has(e.row)).length;
  selectAll.checked = pageEntries.length > 0 && selectedOnPage === pageEntries.length;
  selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageEntries.length;
}

function updateWellnessBulkActionsUI() {
  const bar = document.getElementById('wellness-bulk-actions');
  const selected = allWellnessEntries.filter((e) => selectedWellnessRows.has(e.row));
  const count = selected.length;
  bar.hidden = count === 0;
  document.getElementById('wellness-bulk-summary').textContent = count > 0 ? `${count} selected` : '';

  const eligibleRecalcCount = selected.filter(eligibleForRecalc).length;
  document.getElementById('wellness-bulk-recalc-btn').disabled = eligibleRecalcCount === 0;

  const categories = new Set(selected.map((e) => e.category));
  const mergeOk = count >= 2 && categories.size === 1 && mergeableCategory(selected[0].category);
  document.getElementById('wellness-bulk-merge-btn').disabled = !mergeOk;
}

function renderWellnessPagination(totalPages) {
  renderPager('wellness-pagination', {
    page: wCurrentPage,
    totalPages,
    onChange: (p) => {
      wCurrentPage = p;
      selectedWellnessRows.clear();
      renderWellnessList();
    },
  });
}

// Pattern entries carry no date or time, so both inputs are disabled (and
// the date's required attribute dropped) whenever "Pattern" is checked —
// disabled inputs don't submit their value, but submitWellnessForm also
// blanks them explicitly in case the browser still reports one.
function syncWellnessPatternMode() {
  const isPattern = document.getElementById('wellness-is-pattern').checked;
  const dateInput = document.getElementById('wellness-entry-date');
  const timeInput = document.getElementById('wellness-entry-time');
  dateInput.disabled = isPattern;
  dateInput.required = !isPattern;
  timeInput.disabled = isPattern;
  if (isPattern) {
    dateInput.value = '';
    timeInput.value = '';
  } else if (!dateInput.value) {
    dateInput.value = isoFromDate(new Date());
  }
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
  document.getElementById('wellness-is-pattern').checked = entry ? !entry.date : false;
  syncWellnessPatternMode();
  document.getElementById('wellness-category').value = entry ? entry.category : '';
  document.getElementById('wellness-amount').value = entry ? rawAmountString(entry) : '';
  document.getElementById('wellness-notes').value = entry ? entry.notes : '';

  onCategoryChange();

  // Restore the entry's own description and unit (onCategoryChange sets category defaults)
  document.getElementById('wellness-description').value = entry ? entry.description : '';
  document.getElementById('wellness-unit').value = entry
    ? rawUnitString(entry)
    : document.getElementById('wellness-unit').value;

  clearFieldError('wellness-form-error');
  // A saved breakdown (column H) is shown immediately on Edit/Duplicate —
  // no need to re-run Groq/USDA just to see what Calculate found last time
  // — and carried through untouched if the user hits Save without
  // recalculating. Any other case (new entry, or an entry with none saved)
  // just clears it, same as before.
  if (entry && entry.breakdown.length && entry.category === 'Calories; Protein') {
    currentCalcBreakdown = entry.breakdown;
    renderCalcBreakdown(entry.breakdown, entry.amount, entry.amount2);
  } else {
    hideCalcBreakdown();
  }
  document.getElementById('wellness-modal').hidden = false;
}

function closeWellnessForm() {
  document.getElementById('wellness-modal').hidden = true;
  hideCalcBreakdown();
}

function onCategoryChange() {
  const cat = document.getElementById('wellness-category').value;
  const defaults = CATEGORY_DEFAULTS[cat] || { unit: '', descriptions: [] };

  document.getElementById('wellness-unit').value = defaults.unit;
  document.getElementById('wellness-amount').placeholder =
    cat === 'Sleep' ? 'e.g. 7.5, or 23:30/07:00 for bed/wake' : '';

  // Historical descriptions for this category, sorted by frequency (most used first).
  // 'Calories' and 'Calories; Protein' share one history — they're the same kind
  // of entry (a meal), just with/without a protein estimate attached — so
  // switching between them (e.g. via the Calculate button) doesn't wipe out
  // years of description suggestions just because the composite category is new.
  const relatedCategories = (cat === 'Calories' || cat === 'Calories; Protein')
    ? ['Calories', 'Calories; Protein']
    : [cat];
  const counts = new Map();
  allWellnessEntries
    .filter((e) => relatedCategories.includes(e.category) && e.description)
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

  // Disabled inputs are excluded from .value in most browsers, but reading
  // it explicitly here (rather than trusting that) keeps a pattern's date
  // blank even if the checkbox and field ever fall out of sync.
  const isPattern = document.getElementById('wellness-is-pattern').checked;
  const date = isPattern ? '' : document.getElementById('wellness-entry-date').value;
  const time = isPattern ? '' : document.getElementById('wellness-entry-time').value;
  const category = document.getElementById('wellness-category').value;
  const description = document.getElementById('wellness-description').value;
  const amountRaw = document.getElementById('wellness-amount').value;
  const unit = document.getElementById('wellness-unit').value;
  const notes = document.getElementById('wellness-notes').value;

  let amount;
  if (isCompositeCategory(category)) {
    const parts = amountRaw.split(';').map((s) => s.trim());
    const [calRaw, protRaw] = parts;
    const cal = calRaw ? evaluateNumberExpression(calRaw) : null;
    const prot = protRaw ? evaluateNumberExpression(protRaw) : null;
    if (parts.length !== 2 || cal === null || prot === null) {
      showFieldError('wellness-form-error', 'Amount must be two numbers separated by ";" (e.g. 320; 10).');
      return;
    }
    amount = `${cal}; ${prot}`;
  } else if (category === 'Sleep' && SLEEP_PAIR_SEPARATOR.test(amountRaw)) {
    const parts = amountRaw.split(SLEEP_PAIR_SEPARATOR).map((s) => s.trim());
    const [bedMin, wakeMin] = parts.map((s) => parseClockTime(s));
    if (parts.length !== 2 || bedMin === null || wakeMin === null) {
      showFieldError('wellness-form-error', 'Bed/wake time must be HH:MM/HH:MM (e.g. 23:30/07:00 — "HH:MM; HH:MM" also works).');
      return;
    }
    if (bedMin === wakeMin) {
      showFieldError('wellness-form-error', 'Bed and wake time cannot be the same.');
      return;
    }
    amount = `${formatClockTime24(bedMin)}/${formatClockTime24(wakeMin)}`;
  } else {
    const evaluated = evaluateNumberExpression(amountRaw);
    if (amountRaw && evaluated === null) {
      showFieldError('wellness-form-error', 'Amount must be a number (e.g. 94 or 30+15).');
      return;
    }
    amount = evaluated !== null ? evaluated : '';
  }

  // Only a Calories; Protein entry can have a meaningful breakdown — if the
  // category got changed away from it after a Calculate, don't carry a
  // stale one along for the ride.
  const breakdownStr = (category === 'Calories; Protein') ? breakdownToJson(currentCalcBreakdown) : '';
  const rowData = [date, time, category, description, amount, unit, notes, breakdownStr];

  try {
    if (editingWellnessRow !== null) {
      await updateValues(`'${CONFIG.SHEETS.WELLNESS}'!A${editingWellnessRow}:H${editingWellnessRow}`, [rowData]);
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

// Writes each snapshot's original values back to its own row — unlike
// restoring a delete, these rows still exist, so undo is just an updateValues
// per row (same idea as transactions.js's restoreBulkEdit).
async function restoreWellnessSnapshots(snapshots) {
  try {
    await Promise.all(snapshots.map((s) =>
      updateValues(`'${CONFIG.SHEETS.WELLNESS}'!A${s.row}:H${s.row}`,
        [[s.date, s.time, s.category, s.description, s.amount, s.unit, s.notes, s.breakdown]])));
    await refreshWellness(true);
  } catch (err) {
    alert(`Failed to restore: ${err.message}`);
  }
}

async function bulkRecalculateWellness() {
  const selected = allWellnessEntries.filter((e) => selectedWellnessRows.has(e.row));
  const eligible = selected.filter(eligibleForRecalc);
  const skipped = selected.length - eligible.length;

  if (eligible.length === 0) {
    alert('None of the selected entries have Notes to recalculate — only Calories / Calories; Protein / Activity / Activity; Calories entries with Notes are eligible.');
    return;
  }

  const btn = document.getElementById('wellness-bulk-recalc-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;

  const snapshots = eligible.map((e) => ({
    row: e.row, date: e.date, time: e.time, category: e.category,
    description: e.description, amount: rawAmountString(e), unit: rawUnitString(e), notes: e.notes,
    breakdown: rawBreakdownString(e),
  }));

  // Same latest-Weight lookup calculateWellnessActivity uses for a single
  // entry — computed once here rather than per row, since it's the same
  // "right now" bodyweight either way and doesn't vary per selected entry.
  const weightKg = getLatestWeightKg();

  let done = 0;
  const succeededSnapshots = [];
  const results = await Promise.allSettled(eligible.map(async (e, i) => {
    try {
      if (isActivityCategory(e.category)) {
        if (weightKg === null) throw new Error('Log your weight first — the calorie formula needs it.');
        const { minutes, calories } = estimateWorkoutActivity(e.notes, weightKg);
        await updateValues(`'${CONFIG.SHEETS.WELLNESS}'!A${e.row}:H${e.row}`,
          [[e.date, e.time, 'Activity; Calories', e.description, `${minutes}; ${calories}`, 'min; kcal', e.notes, '']]);
      } else {
        const { calories, protein, standardizedNotes, breakdown } = await estimateCaloriesAndProtein(e.notes);
        await updateValues(`'${CONFIG.SHEETS.WELLNESS}'!A${e.row}:H${e.row}`,
          [[e.date, e.time, 'Calories; Protein', e.description, `${calories}; ${protein}`, 'kcal; g', standardizedNotes, breakdownToJson(breakdown)]]);
      }
      succeededSnapshots.push(snapshots[i]);
    } finally {
      done++;
      btn.textContent = `Recalculating ${done}/${eligible.length}…`;
    }
  }));

  btn.disabled = false;
  btn.textContent = originalLabel;

  selectedWellnessRows.clear();
  await refreshWellness(true);

  const failed = results.filter((r) => r.status === 'rejected').length;
  const succeeded = succeededSnapshots.length;
  const parts = [`${succeeded} entr${succeeded === 1 ? 'y' : 'ies'} recalculated`];
  if (skipped) parts.push(`${skipped} skipped (no notes / not a Calories or Activity entry)`);
  if (failed) parts.push(`${failed} failed`);

  showUndoToast(`${parts.join(', ')}.`, () => restoreWellnessSnapshots(succeededSnapshots));
}

async function mergeSelectedWellnessEntries() {
  const selected = allWellnessEntries.filter((e) => selectedWellnessRows.has(e.row)).sort((a, b) => a.row - b.row);
  if (selected.length < 2) return;

  const categories = new Set(selected.map((e) => e.category));
  if (categories.size > 1) {
    alert('Can only merge entries that share the same category.');
    return;
  }
  const category = selected[0].category;
  if (!mergeableCategory(category)) {
    alert('Merge is only available for Calories / Calories; Protein entries.');
    return;
  }

  const target = selected[0];
  const others = selected.slice(1);
  const hasProtein = category === 'Calories; Protein';

  const totalCalories = selected.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalProtein = hasProtein ? selected.reduce((sum, e) => sum + (e.amount2 || 0), 0) : null;
  const mergedAmount = hasProtein ? `${totalCalories}; ${totalProtein}` : String(totalCalories);
  const mergedUnit = hasProtein ? 'kcal; g' : 'kcal';

  const descriptions = [];
  selected.forEach((e) => {
    if (e.description && !descriptions.includes(e.description)) descriptions.push(e.description);
  });
  const mergedDescription = descriptions.join(', ');

  const notesParts = [];
  selected.forEach((e) => {
    if (e.notes && !notesParts.includes(e.notes)) notesParts.push(e.notes);
  });
  // One entry's ingredients per line (not "; ") — keeps each other entry's
  // list intact as its own block rather than smearing them into one run-on
  // line, and stays consistent with calorie-estimator.js's own one-line-per-
  // ingredient standardized Notes format.
  const mergedNotes = notesParts.join('\n');

  await confirmAndDelete(
    `Merge ${selected.length} ${category} entries into one (${target.date})? Amounts will be summed` +
    `${hasProtein ? ' (calories and protein separately)' : ''}, Notes and differing Descriptions combined, ` +
    `and the other ${others.length} row(s) deleted. This cannot be undone.`,
    async () => {
      if (!wellnessSheetId) wellnessSheetId = await fetchWellnessSheetId();

      // No breakdown carried over — combining several items' breakdowns
      // meaningfully would need a fresh Calculate, not a text merge, so the
      // merged row starts clean rather than keeping just the target's own
      // (now only partially relevant) one.
      await updateValues(`'${CONFIG.SHEETS.WELLNESS}'!A${target.row}:H${target.row}`,
        [[target.date, target.time, category, mergedDescription, mergedAmount, mergedUnit, mergedNotes, '']]);

      const deleteRequests = others
        .map((e) => e.row)
        .sort((a, b) => b - a)
        .map((row) => ({
          deleteDimension: {
            range: { sheetId: wellnessSheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
          },
        }));
      await batchUpdate(deleteRequests);

      selectedWellnessRows.clear();
      await refreshWellness(true);
    },
    "Couldn't merge entries",
  );
}

// A field is prefilled when every selected entry shares the same value for
// it; otherwise it's left blank, meaning "leave unchanged" when
// submitWellnessBulkEditForm reads it back.
function sharedWellnessFieldValue(selected, field) {
  const first = selected[0][field];
  return selected.every((e) => e[field] === first) ? first : '';
}

function openWellnessBulkEditForm() {
  const selected = allWellnessEntries.filter((e) => selectedWellnessRows.has(e.row));
  if (selected.length === 0) return;

  document.getElementById('wellness-bulk-category').value = sharedWellnessFieldValue(selected, 'category');
  document.getElementById('wellness-bulk-description').value = sharedWellnessFieldValue(selected, 'description');
  document.getElementById('wellness-bulk-notes').value = sharedWellnessFieldValue(selected, 'notes');

  clearFieldError('wellness-bulk-edit-form-error');
  document.getElementById('wellness-bulk-edit-modal').hidden = false;
}

function closeWellnessBulkEditForm() {
  document.getElementById('wellness-bulk-edit-modal').hidden = true;
}

async function submitWellnessBulkEditForm(event) {
  event.preventDefault();

  const patch = {};
  const category = document.getElementById('wellness-bulk-category').value;
  if (category) patch.category = category;
  const description = document.getElementById('wellness-bulk-description').value;
  if (description) patch.description = description;
  const notes = document.getElementById('wellness-bulk-notes').value;
  if (notes) patch.notes = notes;

  if (Object.keys(patch).length === 0) {
    showFieldError('wellness-bulk-edit-form-error', 'Change at least one field.');
    return;
  }

  const selected = allWellnessEntries.filter((e) => selectedWellnessRows.has(e.row));
  const snapshots = selected.map((e) => ({
    row: e.row, date: e.date, time: e.time, category: e.category,
    description: e.description, amount: rawAmountString(e), unit: rawUnitString(e), notes: e.notes,
    breakdown: rawBreakdownString(e),
  }));

  try {
    await Promise.all(selected.map((e) => {
      const merged = { ...e, ...patch };
      // A Notes patch invalidates the old breakdown (it no longer describes
      // what's in the field) — anything else patched (category/description)
      // leaves it as-is since Amount/Notes themselves aren't changing.
      const breakdownStr = patch.notes ? '' : rawBreakdownString(e);
      return updateValues(`'${CONFIG.SHEETS.WELLNESS}'!A${e.row}:H${e.row}`,
        [[merged.date, merged.time, merged.category, merged.description, rawAmountString(e), rawUnitString(e), merged.notes, breakdownStr]]);
    }));

    selectedWellnessRows.clear();
    await refreshWellness(true);
    closeWellnessBulkEditForm();
    showUndoToast(`${selected.length} entr${selected.length === 1 ? 'y' : 'ies'} updated.`, () => restoreWellnessSnapshots(snapshots));
  } catch (err) {
    showFieldError('wellness-bulk-edit-form-error', err.message);
  }
}

