// One row per day: sleep window, body mass, what was eaten and what was
// burned. The tab every chart, today-tile, Insight mode and Activity Plan tick
// reads, via the physiqueAsWellnessEntries() adapter below.

const PHYSIQUE_RANGE = `'${CONFIG.SHEETS.PHYSIQUE}'!A2:K`;
const P_PAGE_SIZE = 31;

let allPhysiqueEntries = [];
// Flips true once refreshPhysique has run at least once — lets a click racing
// the initial fetch tell "still loading" apart from "genuinely nothing
// logged", same job the other modules' own loaded flags do.
let physiqueDataLoaded = false;
// Memoized physiqueAsWellnessEntries() result, dropped on every refresh.
let physiqueEntriesCache = null;
let physiqueListenersAttached = false;
let pSort = { key: 'date', dir: -1 };
let pCurrentPage = 1;
let physiqueSheetId = null;
let editingPhysiqueRow = null;
let selectedPhysiqueRows = new Set();

async function fetchPhysiqueSheetId() {
  const metadata = await getSpreadsheetMetadata();
  return findSheetId(metadata, CONFIG.SHEETS.PHYSIQUE);
}

// Time cells come back as FORMATTED_STRING, so what arrives depends on the
// column's own number format — "23:30", "23:30:00" or "11:30:00 PM" are all
// possible. Normalize to the HH:MM an <input type="time"> wants, and leave
// anything unrecognized alone rather than mangling it.
function normalizeTimeCell(value) {
  const str = String(value || '').trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(str);
  if (!m) return str;

  let hour = Number(m[1]);
  const meridiem = m[3] && m[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

function numberCell(value) {
  return (value !== undefined && value !== '' && !Number.isNaN(Number(value))) ? Number(value) : null;
}

// Parses "HH:MM" (1 or 2-digit hour) into minutes since midnight, or null if
// malformed.
function parseClockTime(str) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(str).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatClockTime24(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// Hours between a bed time and a wake time, wrapping past midnight (wake <= bed
// means the wake happened the next calendar day).
function sleepDurationHours(bedMin, wakeMin) {
  const diff = wakeMin <= bedMin ? wakeMin + 1440 - bedMin : wakeMin - bedMin;
  return Math.round((diff / 60) * 10) / 10;
}

// The two activity categories physiqueAsWellnessEntries emits and every
// activity consumer (charts.js, activity-insight.js) filters on.
function isActivityCategory(category) {
  return category === 'Activity' || category === 'Activity; Calories';
}

async function initPhysique(forceRefresh = false) {
  if (!physiqueListenersAttached) {
    physiqueListenersAttached = true;

    document.getElementById('add-physique-btn').addEventListener('click', () => openPhysiqueForm(null));
    document.getElementById('physique-cancel-btn').addEventListener('click', closePhysiqueForm);
    document.getElementById('physique-calc-btn').addEventListener('click', calculatePhysiqueDay);
    document.getElementById('physique-is-pattern').addEventListener('change', syncPhysiquePatternMode);
    onFormSubmit('physique-form', submitPhysiqueForm);

    ['physique-search', 'physique-date-from', 'physique-date-to'].forEach((id) => {
      document.getElementById(id).addEventListener('input', () => {
        pCurrentPage = 1;
        selectedPhysiqueRows.clear();
        renderPhysiqueList();
      });
    });

    makeSortableHeaders('#physique-table', pSort, () => {
      pCurrentPage = 1;
      selectedPhysiqueRows.clear();
      renderPhysiqueList();
    });

    document.getElementById('physique-select-all').addEventListener('change', (e) => {
      const pageRows = getFilteredPhysiqueEntries().slice((pCurrentPage - 1) * P_PAGE_SIZE, pCurrentPage * P_PAGE_SIZE);
      pageRows.forEach((p) => (e.target.checked ? selectedPhysiqueRows.add(p.row) : selectedPhysiqueRows.delete(p.row)));
      renderPhysiqueList();
    });
    onAsyncClick('physique-bulk-calc-btn', bulkCalculatePhysique);
  }

  await refreshPhysique(forceRefresh);
}

async function refreshPhysique(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('physique');
  if (!values) {
    const resp = await getValues(PHYSIQUE_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('physique', values);
  }

  allPhysiqueEntries = values
    .map((row, i) => ({
      row: i + 2,
      date: String(row[0] || '').trim(),
      bedtime: normalizeTimeCell(row[1]),
      wakeTime: normalizeTimeCell(row[2]),
      bodyMass: numberCell(row[3]),
      consumption: row[4] || '',
      breakdown: row[5] || '',
      caloriesIn: numberCell(row[6]),
      proteinIn: numberCell(row[7]),
      workout: row[8] || '',
      duration: numberCell(row[9]),
      caloriesOut: numberCell(row[10]),
    }))
    // A row with nothing in it at all isn't a logged day — but a dateless row
    // that carries anything is a pattern, so every column counts here, not
    // just the date.
    .filter((p) => PHYSIQUE_FIELDS.some(({ key }) => p[key] !== null && String(p[key]).trim() !== ''));

  physiqueEntriesCache = null;
  physiqueDataLoaded = true;

  renderPhysiqueList();
  renderWellnessCharts(physiqueAsWellnessEntries());
  // Ticks the Activity Plan rows already in today's Workout cell
  // (strength-plan.js) — here rather than in the plan's own init so a save
  // re-marks the row it just wrote.
  renderWorkoutPlanProgress();
  logPhysiqueDataGaps();
}

// --- Physique as chart input --------------------------------------------
//
// charts.js, insight.js and protein-rotation.js all consume a per-EVENT row
// shape ({date, category, amount, amount2, unit, notes, breakdown,
// sleepBedMin/WakeMin}). Rather than rewrite six charts plus the projection
// and energy-balance math, each Physique day is expanded back into up to four
// such rows — so every consumer works unchanged off a per-day tab.
//
// Memoized because aggregateWindow (insight.js) reads it repeatedly per run.

// A day's activity split across the categories its Workout lines belong to
// (Strength / Cardio / NEAT, per the Activities sheet), so the Physical
// Activity chart stacks real composition instead of labelling a mixed day with
// whichever category happened to win.
//
// The day's own stored Duration and Calories Out are apportioned by each
// category's share of active seconds, rather than recomputed — that keeps a
// hand-edited total exact, and the largest category absorbs the rounding
// remainder so the parts still sum to the whole.
function physiqueActivityByCategory(p) {
  const lines = parseWorkoutNoteLines(p.workout);
  if (!lines.length) return [{ category: 'Other', minutes: p.duration, calories: p.caloriesOut }];

  const secondsByCategory = new Map();
  lines.forEach((line) => {
    const category = activityCategory(line.name);
    secondsByCategory.set(category, (secondsByCategory.get(category) || 0) + activeSecondsForNoteLine(line));
  });

  const totalSeconds = [...secondsByCategory.values()].reduce((sum, s) => sum + s, 0);
  if (totalSeconds <= 0) return [{ category: 'Other', minutes: p.duration, calories: p.caloriesOut }];

  const shares = [...secondsByCategory.entries()].map(([category, seconds]) => ({
    category,
    seconds,
    minutes: p.duration === null ? null : Math.round((p.duration * seconds) / totalSeconds),
    calories: p.caloriesOut === null ? null : Math.round((p.caloriesOut * seconds) / totalSeconds),
  }));

  const biggest = shares.reduce((a, b) => (a.seconds >= b.seconds ? a : b));
  ['minutes', 'calories'].forEach((field) => {
    const total = field === 'minutes' ? p.duration : p.caloriesOut;
    if (total === null) return;
    biggest[field] += total - shares.reduce((sum, s) => sum + s[field], 0);
  });

  return shares;
}

function physiqueAsWellnessEntries() {
  if (physiqueEntriesCache) return physiqueEntriesCache;

  const entries = [];
  allPhysiqueEntries.filter((p) => p.date).forEach((p) => {
    const base = {
      row: p.row, date: p.date, time: '', description: '', notes: '',
      amount: null, amount2: null, unit: '', unit2: null,
      sleepBedMin: null, sleepWakeMin: null, breakdown: [],
    };

    const bed = parseClockTime(p.bedtime);
    const wake = parseClockTime(p.wakeTime);
    // Both clock times or nothing — a day missing either has no duration to
    // derive, and Physique has no duration-only form to fall back on.
    if (bed !== null && wake !== null) {
      entries.push({
        ...base, category: 'Sleep', description: 'Sleep Duration', unit: 'hr',
        amount: sleepDurationHours(bed, wake), sleepBedMin: bed, sleepWakeMin: wake,
      });
    }

    if (p.bodyMass !== null) {
      entries.push({ ...base, category: 'Weight', description: 'Body Mass', amount: p.bodyMass, unit: 'kg' });
    }

    if (p.caloriesIn !== null || p.proteinIn !== null) {
      entries.push({
        ...base, category: 'Calories; Protein', description: 'Consumption',
        amount: p.caloriesIn, amount2: p.proteinIn, unit: 'kcal', unit2: 'g',
        notes: p.consumption, breakdown: parsePhysiqueBreakdown(p.breakdown),
      });
    }

    // One entry per activity category, so a day of lifting plus a swim reads as
    // two stacked segments rather than one merged label.
    //
    // The Workout text rides on the FIRST of them only: it describes the whole
    // day, and activity-insight.js re-parses it for rep volume and muscle
    // groups — repeating it per category would count every rep twice.
    if (p.workout.trim() || p.duration !== null || p.caloriesOut !== null) {
      physiqueActivityByCategory(p).forEach(({ category, minutes, calories }, i) => {
        entries.push({
          ...base, category: 'Activity; Calories', description: category,
          amount: minutes, amount2: calories, unit: 'min', unit2: 'kcal',
          notes: i === 0 ? p.workout : '',
        });
      });
    }
  });

  physiqueEntriesCache = entries;
  return entries;
}

// Today's day row, whatever state it's in — what Log a Workout extends rather
// than appending a second row for the same date (which the duplicate-date
// guard would refuse to save anyway).
function todaysPhysiqueDay() {
  const today = isoFromDate(new Date());
  return allPhysiqueEntries.find((p) => p.date === today) ?? null;
}

// Which days came across incomplete. console only — a chart gap is otherwise
// indistinguishable from a day genuinely not logged.
function logPhysiqueDataGaps() {
  const days = allPhysiqueEntries.filter((p) => p.date);
  if (!days.length) return;

  const count = (predicate) => days.filter(predicate).length;
  console.debug('[physique] gaps:', {
    days: days.length,
    noSleepTimes: count((p) => parseClockTime(p.bedtime) === null || parseClockTime(p.wakeTime) === null),
    noBodyMass: count((p) => p.bodyMass === null),
    noCaloriesIn: count((p) => p.caloriesIn === null),
    noProteinIn: count((p) => p.proteinIn === null),
    noBreakdown: count((p) => p.caloriesIn !== null && !parsePhysiqueBreakdown(p.breakdown).length),
    noActivityDuration: count((p) => p.workout.trim() && p.duration === null),
    noCaloriesOut: count((p) => p.workout.trim() && p.caloriesOut === null),
    // Nothing the Activity Plan can recognize, so it contributes no rep
    // volume, no muscle group and no derived activity label.
    unparseableWorkout: count((p) => p.workout.trim() && parseWorkoutNoteLines(p.workout).length === 0),
    // Parsed fine but isn't on the Activities tab — priced at the fallback
    // MET, no muscle group, and stacked under 'Other' on the chart. Almost
    // always a spelling drift between a logged line and the sheet's Name.
    unmatchedExerciseNames: [...new Set(
      days.flatMap((p) => parseWorkoutNoteLines(p.workout).map((line) => line.name))
        .filter((name) => !activityByName(name)),
    )],
  });
}

const PHYSIQUE_NUMERIC_KEYS = ['bodyMass', 'caloriesIn', 'proteinIn', 'duration', 'caloriesOut'];

function getFilteredPhysiqueEntries() {
  const search = document.getElementById('physique-search').value.trim().toLowerCase();
  const dateFrom = document.getElementById('physique-date-from').value;
  const dateTo = document.getElementById('physique-date-to').value;

  const filtered = allPhysiqueEntries
    // Pattern rows (no date) are date-agnostic templates, so an active
    // date-range filter shouldn't hide them.
    .filter((p) => !p.date || ((!dateFrom || p.date >= dateFrom) && (!dateTo || p.date <= dateTo)))
    .filter((p) => {
      if (!search) return true;
      return [p.date, p.consumption, p.breakdown, p.workout]
        .some((field) => field.toLowerCase().includes(search));
    });

  const { key, dir } = pSort;
  return [...filtered].sort((a, b) => {
    // Patterns always float to the top, whichever column and direction is sorted.
    if (!a.date !== !b.date) return a.date ? 1 : -1;
    if (PHYSIQUE_NUMERIC_KEYS.includes(key)) return ((a[key] ?? 0) - (b[key] ?? 0)) * dir;
    return String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' }) * dir;
  });
}

// [text, tooltip] for the Breakdown column: how many items the stored JSON
// holds, and their names on hover. A cell that doesn't parse shows as-is, so a
// hand-mangled one is visible rather than silently reading as empty.
function breakdownCell(raw) {
  if (!raw) return ['—'];
  const items = parsePhysiqueBreakdown(raw);
  if (!items.length) return ['⚠️ unreadable', raw];
  return [`${items.length} item${items.length === 1 ? '' : 's'}`, items.map((b) => b.name).join(', ')];
}

// A day's sleep length from its two clock times.
function physiqueSleepHours(p) {
  const bed = parseClockTime(p.bedtime);
  const wake = parseClockTime(p.wakeTime);
  if (bed === null || wake === null) return null;
  return sleepDurationHours(bed, wake);
}

function renderPhysiqueList() {
  const tbody = document.getElementById('physique-body');
  tbody.innerHTML = '';

  const entries = getFilteredPhysiqueEntries();
  const totalPages = Math.max(1, Math.ceil(entries.length / P_PAGE_SIZE));
  pCurrentPage = Math.min(pCurrentPage, totalPages);

  const start = (pCurrentPage - 1) * P_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + P_PAGE_SIZE);

  if (pageEntries.length === 0) {
    const message = allPhysiqueEntries.length === 0
      ? 'No days logged yet — click "Log a Day" to get started.'
      : 'No days match this filter.';
    tbody.appendChild(renderEmptyRow(13, message));
  }

  pageEntries.forEach((p) => {
    const tr = document.createElement('tr');

    const num = (value) => {
      if (value === null) return '—';
      return privacyMode ? maskDigits(String(value)) : String(value);
    };
    // Consumption and Workout are multi-line lists — flattened to one line for
    // the cell, with the full text kept in the tooltip.
    const truncate = (text) => {
      const flat = text.replace(/\s*\n+\s*/g, ' · ').trim();
      return flat.length > 24 ? `${flat.slice(0, 24)}…` : flat;
    };

    const sleepHours = physiqueSleepHours(p);
    const sleepTitle = sleepHours !== null ? `${sleepHours} hr of sleep` : '';
    const [breakdownText, breakdownTitle] = breakdownCell(p.breakdown);

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedPhysiqueRows.has(p.row);
    checkbox.setAttribute('aria-label', 'Select day');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedPhysiqueRows.add(p.row);
      else selectedPhysiqueRows.delete(p.row);
      updatePhysiqueSelectAllCheckbox(pageEntries);
      updatePhysiqueBulkActionsUI();
    });
    checkboxCell.appendChild(checkbox);

    tr.append(
      checkboxCell,
      makeCell(p.date || '🔁 Pattern'),
      makeCell(p.bedtime || '—', sleepTitle),
      makeCell(p.wakeTime || '—', sleepTitle),
      makeCell(num(p.bodyMass)),
      makeCell(privacyMode ? maskText(truncate(p.consumption)) : truncate(p.consumption),
        privacyMode ? maskText(p.consumption) : p.consumption),
      // Raw JSON would be noise in a cell — the item count is the useful
      // summary, with the ingredient names on hover.
      makeCell(breakdownText, privacyMode && breakdownTitle ? maskText(breakdownTitle) : breakdownTitle),
      makeCell(num(p.caloriesIn)),
      makeCell(num(p.proteinIn)),
      makeCell(truncate(p.workout), p.workout),
      makeCell(num(p.duration)),
      makeCell(num(p.caloriesOut)),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openPhysiqueForm(p) }),
      // How a pattern becomes a real day: duplicate it, and the copy opens
      // dated today with the template's contents intact.
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => openPhysiqueForm(p, true) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deletePhysiqueEntry(p) }),
    );
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  updatePhysiqueSelectAllCheckbox(pageEntries);
  updatePhysiqueBulkActionsUI();

  renderPager('physique-pagination', {
    page: pCurrentPage,
    totalPages,
    onChange: (page) => {
      pCurrentPage = page;
      selectedPhysiqueRows.clear();
      renderPhysiqueList();
    },
  });
}

function updatePhysiqueSelectAllCheckbox(pageEntries) {
  const selectAll = document.getElementById('physique-select-all');
  const selectedOnPage = pageEntries.filter((p) => selectedPhysiqueRows.has(p.row)).length;
  selectAll.checked = pageEntries.length > 0 && selectedOnPage === pageEntries.length;
  selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageEntries.length;
}

// A day with neither a Consumption nor a Workout has nothing to recalculate.
function eligibleForBulkCalc(p) {
  return Boolean(p.consumption.trim() || p.workout.trim());
}

function updatePhysiqueBulkActionsUI() {
  const selected = allPhysiqueEntries.filter((p) => selectedPhysiqueRows.has(p.row));
  document.getElementById('physique-bulk-actions').hidden = selected.length === 0;
  document.getElementById('physique-bulk-summary').textContent =
    selected.length ? `${selected.length} selected` : '';
  document.getElementById('physique-bulk-calc-btn').disabled = !selected.some(eligibleForBulkCalc);
}

// Form field id suffix → entry property, in column order (A–K).
const PHYSIQUE_FIELDS = [
  { id: 'date', key: 'date' },
  { id: 'bedtime', key: 'bedtime' },
  { id: 'wake-time', key: 'wakeTime' },
  { id: 'body-mass', key: 'bodyMass', numeric: true },
  { id: 'consumption', key: 'consumption' },
  { id: 'breakdown', key: 'breakdown' },
  { id: 'calories-in', key: 'caloriesIn', numeric: true },
  { id: 'protein-in', key: 'proteinIn', numeric: true },
  { id: 'workout', key: 'workout' },
  { id: 'activity-duration', key: 'duration', numeric: true },
  { id: 'calories-out', key: 'caloriesOut', numeric: true },
];

function physiqueField(id) {
  return document.getElementById(`physique-${id}`);
}

// Pattern rows carry no date, so the input is disabled (and its required
// attribute dropped) whenever "Pattern" is checked — disabled inputs don't
// submit their value, but submitPhysiqueForm blanks it explicitly too in case
// the browser still reports one.
function syncPhysiquePatternMode() {
  const isPattern = document.getElementById('physique-is-pattern').checked;
  const dateInput = physiqueField('date');
  dateInput.disabled = isPattern;
  dateInput.required = !isPattern;
  if (isPattern) dateInput.value = '';
  else if (!dateInput.value) dateInput.value = isoFromDate(new Date());
}

function openPhysiqueForm(entry, duplicate = false) {
  editingPhysiqueRow = (entry && !duplicate) ? entry.row : null;
  document.getElementById('physique-modal-title').textContent =
    duplicate ? 'Duplicate Day' : (entry ? 'Edit Day' : 'Log a Day');

  PHYSIQUE_FIELDS.forEach(({ id, key }) => {
    const value = entry ? entry[key] : '';
    physiqueField(id).value = (value === null || value === undefined) ? '' : String(value);
  });

  // A duplicate is always a real day — that's the point of duplicating a
  // pattern — so the copy starts dated today rather than inheriting the
  // template's blank date.
  document.getElementById('physique-is-pattern').checked = entry ? (!entry.date && !duplicate) : false;
  if (duplicate) physiqueField('date').value = isoFromDate(new Date());
  syncPhysiquePatternMode();

  // A saved breakdown is shown as its table straight away on Edit, so an
  // existing day can be checked without re-running Calculate.
  renderPhysiqueBreakdown(
    entry ? parsePhysiqueBreakdown(entry.breakdown) : [],
    entry ? entry.caloriesIn : 0,
    entry ? entry.proteinIn : 0,
  );

  clearFieldError('physique-form-error');
  document.getElementById('physique-modal').hidden = false;
}

function closePhysiqueForm() {
  document.getElementById('physique-modal').hidden = true;
  hideCalcBreakdown('physique');
}

// A whole day, not one meal, so a per-meal ceiling would fire
// on every normal day here.
const PHYSIQUE_DAY_CALORIE_CEILING = 6000;

// Body mass for the burn formula: this day's own field first, else the most
// recent day that recorded one.
function physiqueWeightKg() {
  const typed = evaluateNumberExpression(physiqueField('body-mass').value.trim());
  return typed || physiqueWeightKgFromLog();
}

// The most recent day that recorded a body mass. Null if none ever has.
function physiqueWeightKgFromLog() {
  const lastLogged = allPhysiqueEntries
    .filter((p) => p.date && p.bodyMass !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
  return lastLogged ? lastLogged.bodyMass : null;
}

// A day's raw A–K cells — what an undo writes straight back, and the starting
// point a recalculation overwrites only the derived columns of.
function physiqueRowValues(p) {
  return [p.date, p.bedtime, p.wakeTime, p.bodyMass ?? '', p.consumption, p.breakdown,
    p.caloriesIn ?? '', p.proteinIn ?? '', p.workout, p.duration ?? '', p.caloriesOut ?? ''];
}

// A corrupt or hand-mangled cell degrades to "no breakdown" rather than
// failing the form.
function parsePhysiqueBreakdown(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Draws the shared breakdown table (calorie-estimator.js) under the Breakdown
// field, or hides it when there's nothing parseable to show.
function renderPhysiqueBreakdown(breakdown, calories, protein) {
  if (breakdown.length) renderCalcBreakdown(breakdown, calories || 0, protein || 0, 'physique');
  else hideCalcBreakdown('physique');
}

// Re-estimates only the Consumption lines that actually changed.
//
// Every breakdown item records the standardized line it produced (noteLine,
// calorie-estimator.js), and Calculate writes those same lines back into
// Consumption — so on a second run, any line still matching one of them is
// already solved and its numbers are reused verbatim. Only the leftovers go to
// Groq/USDA, which is what makes editing one ingredient in a ten-line day cost
// one lookup instead of ten.
//
// A saved breakdown from before noteLine existed simply matches nothing and
// the whole day re-estimates, exactly as it used to.
async function estimateConsumptionIncrementally(consumption, savedBreakdownRaw) {
  const lines = consumption.split('\n').map((line) => line.trim()).filter(Boolean);

  // Each saved item can back at most one line, so the same ingredient typed
  // twice re-estimates its second occurrence rather than double-counting one
  // result.
  const pool = new Map();
  parsePhysiqueBreakdown(savedBreakdownRaw).forEach((item) => {
    if (!item.noteLine) return;
    if (!pool.has(item.noteLine)) pool.set(item.noteLine, []);
    pool.get(item.noteLine).push(item);
  });

  const reused = [];
  const staleLines = [];
  lines.forEach((line) => {
    const matches = pool.get(line);
    if (matches && matches.length) reused.push(matches.shift());
    else staleLines.push(line);
  });

  const fresh = staleLines.length
    ? await estimateCaloriesAndProtein(staleLines.join('\n'), { autoBank: false })
    : { calories: 0, protein: 0, breakdown: [], usdaUnreachable: false };

  // Nothing reused means this is an ordinary full Calculate — pass its own
  // totals straight through, so the same text gives the same figures here as
  // on a first run. A mixed run has to re-sum the per-item numbers
  // instead, which can differ by a fraction of a kcal from a single-pass
  // total (each item is already rounded).
  if (!reused.length) {
    return { ...fresh, reusedCount: 0, estimatedCount: fresh.breakdown.length };
  }

  const breakdown = [...reused, ...fresh.breakdown].sort((a, b) => b.calories - a.calories);
  return {
    calories: Math.round(breakdown.reduce((total, i) => total + i.calories, 0)),
    protein: Math.round(breakdown.reduce((total, i) => total + i.protein, 0) * 10) / 10,
    breakdown,
    usdaUnreachable: fresh.usdaUnreachable,
    reusedCount: reused.length,
    estimatedCount: fresh.breakdown.length,
  };
}

// Fills Activity Duration and Calories Out from the Workout field, returning
// any warnings rather than showing them — 🧮 Calculate merges them with the
// food side's, Log a Workout (strength-plan.js) shows them on their own.
// Synchronous: unlike the food estimator this is pure local arithmetic, no
// Groq or USDA involved.
function runPhysiqueWorkoutCalc() {
  const messages = [];
  const workout = physiqueField('workout').value.trim();
  if (!workout) return messages;

  const weightKg = physiqueWeightKg();
  if (weightKg === null) {
    messages.push(physiqueDataLoaded
      ? '⚠️ Workout skipped — fill in Body Mass first, the calorie formula needs it.'
      : '⚠️ Workout skipped — still loading your data, try Calculate again in a moment.');
    return messages;
  }

  try {
    const { minutes, calories, unmatchedNames } = estimateWorkoutActivity(workout, weightKg);
    physiqueField('activity-duration').value = minutes;
    physiqueField('calories-out').value = calories;
    if (unmatchedNames.length) {
      messages.push(`⚠️ Couldn't find ${unmatchedNames.map((n) => `"${n}"`).join(', ')} in the Activity Plan — used a default MET.`);
    }
  } catch (err) {
    messages.push(`⚠️ Workout: ${err.message}`);
  }
  return messages;
}

// Both estimators run together:
// Consumption fills Breakdown/Calories In/Protein In, Workout fills Activity
// Duration/Calories Out. Whichever field is empty is simply skipped, and
// neither side's failure stops the other.
async function calculatePhysiqueDay() {
  const consumption = physiqueField('consumption').value.trim();
  const workout = physiqueField('workout').value.trim();
  const btn = document.getElementById('physique-calc-btn');

  if (!consumption && !workout) {
    showFieldError('physique-form-error', 'Fill in Consumption, Workout, or both first.');
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Calculating…';
  clearFieldError('physique-form-error');

  const messages = runPhysiqueWorkoutCalc();

  if (consumption) {
    try {
      const { calories, protein, breakdown, usdaUnreachable, reusedCount, estimatedCount } =
        await estimateConsumptionIncrementally(consumption, physiqueField('breakdown').value);

      // Rebuilt from the merged breakdown rather than the fresh estimate's own
      // standardizedNotes, which only covers the lines that were re-estimated.
      physiqueField('consumption').value = breakdown.map((i) => i.noteLine || `${i.amount} ${i.name}`).join('\n');
      physiqueField('calories-in').value = calories;
      physiqueField('protein-in').value = protein;
      // Writes the Breakdown field's JSON as well as drawing the table.
      renderPhysiqueBreakdown(breakdown, calories, protein);

      if (reusedCount) {
        messages.push(`♻️ ${reusedCount} unchanged ingredient${reusedCount === 1 ? '' : 's'} reused, ${estimatedCount} re-estimated.`);
      }
      if (usdaUnreachable) {
        messages.push("⚠️ Couldn't reach the nutrition database (network/DNS issue) — this estimate is AI-only and may be less accurate.");
      }
      if (calories > PHYSIQUE_DAY_CALORIE_CEILING) {
        messages.push(`⚠️ ${calories} kcal for one day looks unusually high — double-check before saving.`);
      }
    } catch (err) {
      messages.push(`⚠️ Consumption: ${err.message}`);
    }
  }

  btn.disabled = false;
  btn.textContent = originalLabel;

  if (messages.length) showFieldError('physique-form-error', messages.join(' '));
}

async function submitPhysiqueForm(event) {
  event.preventDefault();

  // Read explicitly rather than trusting that a disabled input reports no
  // value, so a pattern's date stays blank even if field and checkbox ever
  // fall out of sync.
  const isPattern = document.getElementById('physique-is-pattern').checked;

  const rowData = [];
  for (const { id, numeric } of PHYSIQUE_FIELDS) {
    const raw = (isPattern && id === 'date') ? '' : physiqueField(id).value.trim();
    if (!numeric) {
      rowData.push(raw);
      continue;
    }
    const evaluated = raw ? evaluateNumberExpression(raw) : null;
    if (raw && evaluated === null) {
      const label = physiqueField(id).closest('label').firstChild.textContent.trim();
      showFieldError('physique-form-error', `${label} must be a number (e.g. 94 or 30+15).`);
      return;
    }
    rowData.push(evaluated === null ? '' : evaluated);
  }

  // One row per day is the whole point of this tab, so a second row for a
  // date already logged is a mistake rather than a second sample. Patterns are
  // exempt: they're dateless templates, and you can keep as many as you like.
  const date = rowData[0];
  const clash = !isPattern && allPhysiqueEntries.find((p) => p.date === date && p.row !== editingPhysiqueRow);
  if (clash) {
    showFieldError('physique-form-error', `${date} is already logged — edit that row instead.`);
    return;
  }

  try {
    if (editingPhysiqueRow !== null) {
      await updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${editingPhysiqueRow}:K${editingPhysiqueRow}`, [rowData]);
    } else {
      await appendValues(PHYSIQUE_RANGE, [rowData]);
    }
    await refreshPhysique(true);
    closePhysiqueForm();
  } catch (err) {
    showFieldError('physique-form-error', err.message);
  }
}

// --- Bulk Calculate ------------------------------------------------------
//
// The form's 🧮 run one day at a time, over as many selected days as you like.
// Each day goes through the same two estimators and the same incremental
// reuse: a line whose noteLine already matches that day's saved breakdown
// keeps its numbers, so re-running a stretch of days costs a lookup only for
// what actually changed.

// A day's recalculated A–K cells, or null if nothing about it changed.
async function recalculatePhysiqueDay(p, weightKg) {
  const values = physiqueRowValues(p);

  if (p.consumption.trim()) {
    const { calories, protein, breakdown } =
      await estimateConsumptionIncrementally(p.consumption, p.breakdown);
    values[4] = breakdown.map((i) => i.noteLine || `${i.amount} ${i.name}`).join('\n');
    values[5] = breakdownToJson(breakdown);
    values[6] = calories;
    values[7] = protein;
  }

  if (p.workout.trim() && weightKg !== null) {
    const { minutes, calories } = estimateWorkoutActivity(p.workout, weightKg);
    values[9] = minutes;
    values[10] = calories;
  }

  return values;
}

async function bulkCalculatePhysique() {
  const selected = allPhysiqueEntries.filter((p) => selectedPhysiqueRows.has(p.row));
  const eligible = selected.filter(eligibleForBulkCalc);
  const skipped = selected.length - eligible.length;

  if (!eligible.length) {
    alert('None of the selected days have a Consumption or Workout to recalculate.');
    return;
  }

  // One lookup for the whole run rather than per row: it's the same "right
  // now" bodyweight either way, and a day of its own is preferred where it has
  // one (below) so a historical row still uses what it actually recorded.
  const latestWeightKg = physiqueWeightKgFromLog();
  const summaryEl = document.getElementById('physique-bulk-summary');

  const snapshots = eligible.map((p) => ({ row: p.row, values: physiqueRowValues(p) }));

  let done = 0;
  const succeeded = [];
  const results = await Promise.allSettled(eligible.map(async (p, i) => {
    try {
      const values = await recalculatePhysiqueDay(p, p.bodyMass ?? latestWeightKg);
      await updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${p.row}:K${p.row}`, [values]);
      succeeded.push(snapshots[i]);
    } finally {
      done += 1;
      summaryEl.textContent = `Calculating ${done}/${eligible.length}…`;
    }
  }));

  selectedPhysiqueRows.clear();
  await refreshPhysique(true);

  const failed = results.filter((r) => r.status === 'rejected').length;
  const parts = [`${succeeded.length} day${succeeded.length === 1 ? '' : 's'} recalculated`];
  if (skipped) parts.push(`${skipped} skipped (nothing to calculate)`);
  if (failed) parts.push(`${failed} failed`);

  showUndoToast(`${parts.join(', ')}.`, () => restorePhysiqueSnapshots(succeeded));
}

// Each row still exists, so undo is one updateValues per row rather than a
// re-insert.
async function restorePhysiqueSnapshots(snapshots) {
  try {
    await Promise.all(snapshots.map((s) =>
      updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${s.row}:K${s.row}`, [s.values])));
    await refreshPhysique(true);
  } catch (err) {
    alert(`Failed to restore: ${err.message}`);
  }
}

async function deletePhysiqueEntry(entry) {
  const label = entry.date ? `the logged day for ${entry.date}` : 'this pattern row';
  await confirmAndDelete(`Delete ${label}?`, async () => {
    if (!physiqueSheetId) physiqueSheetId = await fetchPhysiqueSheetId();
    await batchUpdate([{
      deleteDimension: {
        range: {
          sheetId: physiqueSheetId,
          dimension: 'ROWS',
          startIndex: entry.row - 1,
          endIndex: entry.row,
        },
      },
    }]);
    await refreshPhysique(true);
  }, "Couldn't delete day");
}
