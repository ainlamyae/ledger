// One row per day: sleep window, body mass, what was eaten and what was
// burned. The tab every chart, today-tile, Insight mode and Activity Plan tick
// reads, via the physiqueAsWellnessEntries() adapter below.

// A2:O — Date, Bedtime, Wake-up Time, Body Mass, Consumption, Breakdown,
// Calories In, Protein In, Fiber, Fat, Carbohydrate, TEF, Workout, Activity
// Duration, Calories Out.
const PHYSIQUE_RANGE = `'${CONFIG.SHEETS.PHYSIQUE}'!A2:O`;
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
    document.getElementById('physique-micro-close-btn').addEventListener('click', () => {
      document.getElementById('physique-micro-modal').hidden = true;
    });
    document.getElementById('physique-calc-btn').addEventListener('click', calculatePhysiqueDay);
    document.getElementById('physique-combine-btn').addEventListener('click', combineAndSortPhysiqueConsumptionField);
    document.getElementById('physique-form-micro-btn').addEventListener('click', openPhysiqueMicronutrientsFromForm);
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
    onAsyncClick('physique-bulk-combine-btn', bulkCombineAndSortPhysique);
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
      fiber: numberCell(row[8]),
      fat: numberCell(row[9]),
      carbohydrate: numberCell(row[10]),
      tef: numberCell(row[11]),
      workout: row[12] || '',
      duration: numberCell(row[13]),
      caloriesOut: numberCell(row[14]),
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
// sleepBedMin/WakeMin, tefKcal}). Rather than rewrite six charts plus the
// projection and energy-balance math, each Physique day is expanded back into
// up to four such rows — so every consumer works unchanged off a per-day tab.
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
      entries.push({ ...base, category: 'Body Mass', description: 'Body Mass', amount: p.bodyMass, unit: 'kg' });
    }

    if (p.caloriesIn !== null || p.proteinIn !== null) {
      entries.push({
        ...base, category: 'Calories; Protein', description: 'Consumption',
        amount: p.caloriesIn, amount2: p.proteinIn, unit: 'kcal', unit2: 'g',
        notes: p.consumption, breakdown: parsePhysiqueBreakdown(p.breakdown),
        // This day's own measured TEF (column L), or null when it hasn't been
        // calculated — charts.js falls back to the flat TEF_PERCENT_OF_INTAKE
        // estimate on null rather than treating it as a measured zero.
        tefKcal: p.tef,
        // This day's own persisted Fiber (column I) — hand-typed or last
        // backfilled from the breakdown, same as tefKcal above. Read by the
        // Health tiles' Fiber card.
        fiberG: p.fiber,
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

const PHYSIQUE_NUMERIC_KEYS = ['bodyMass', 'caloriesIn', 'proteinIn', 'fiber', 'fat', 'carbohydrate', 'duration', 'caloriesOut', 'tef'];

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

// Day-level Fiber/Fat/Carbohydrate totals from an already-parsed breakdown
// array — the same fiber/fat/carbohydrate estimateTefBreakdown annotates each
// item with (micronutrient-insight.js). Used by Calculate/bulk-recalculate to
// fill columns I/J/K alongside TEF (column L); unlike TEF's own persisted
// figure this is never read back off the sheet — it's always recomputed from
// the freshest breakdown at hand. Each field stays null when nothing in the
// breakdown carries that macro (no 🧬 Micronutrients pulled and nothing typed
// on any matched Nutrition row) — reads as "not measured" rather than a
// confident zero, same rule the per-ingredient tables follow.
function sumBreakdownMacros(items) {
  let fiber = null;
  let fat = null;
  let carbohydrate = null;
  (items || []).forEach((item) => {
    if (item.fiber !== undefined) fiber = Math.round(((fiber || 0) + item.fiber) * 10) / 10;
    if (item.fat !== undefined) fat = Math.round(((fat || 0) + item.fat) * 10) / 10;
    if (item.carbohydrate !== undefined) carbohydrate = Math.round(((carbohydrate || 0) + item.carbohydrate) * 10) / 10;
  });
  return { fiber, fat, carbohydrate };
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
      ? 'No days logged yet — click "Log" in the panel heading to get started.'
      : 'No days match this filter.';
    tbody.appendChild(renderEmptyRow(14, message));
  }

  // Same tint the Activity Plan uses for a row already logged today (.today-row and
  // .workout-row-logged share one declaration): in both places it marks the row the
  // day's logging lands on. Recomputed per render rather than cached, so a tab left
  // open across midnight moves the mark on its next redraw.
  const todayIso = isoFromDate(new Date());

  pageEntries.forEach((p) => {
    const tr = document.createElement('tr');
    // Pattern rows carry no date, so they never match.
    if (p.date === todayIso) tr.classList.add('today-row');

    const num = (value) => {
      if (value === null) return '—';
      return privacyMode ? maskDigits(String(value)) : String(value);
    };
    const time = (value) => {
      if (!value) return '—';
      return privacyMode ? maskDigits(value) : value;
    };

    const sleepHours = physiqueSleepHours(p);
    const sleepTitle = sleepHours !== null ? `${sleepHours} hr of sleep` : '';
    const maskedSleepTitle = privacyMode ? maskDigits(sleepTitle) : sleepTitle;

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
      makeCell(time(p.bedtime), maskedSleepTitle),
      makeCell(time(p.wakeTime), maskedSleepTitle),
      makeCell(num(p.bodyMass)),
      makeCell(num(p.caloriesIn)),
      makeCell(num(p.proteinIn)),
      makeCell(num(p.fiber)),
      makeCell(num(p.fat)),
      makeCell(num(p.carbohydrate)),
      makeCell(num(p.tef), p.tef !== null
        ? undefined
        : 'Not calculated yet — select this day and click TEF below (needs 🧬 Micronutrients pulled for its ingredients)'),
      makeCell(num(p.duration)),
      makeCell(num(p.caloriesOut)),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openPhysiqueForm(p) }),
      // How a pattern becomes a real day: duplicate it, and the copy opens
      // dated today with the template's contents intact.
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => openPhysiqueForm(p, true) }),
      makeRowActionButton({ emoji: '🧬', title: 'Micronutrients', onClick: () => openPhysiqueMicronutrients(p) }),
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
  document.getElementById('physique-bulk-combine-btn').disabled = !selected.some(eligibleForBulkCombine);
}

// The 🧬 row action: this day's own real, measured nutrient totals — the same
// USDA-sourced numbers and FDA Daily Value comparison the Health Insight
// panel's Micronutrients mode computes for a picked range (micronutrient-insight.js),
// just narrowed to this one day by aggregating over [p.date, p.date]. Total and
// per-day average always end up equal for a single day, so the table collapses
// Health Insight's four columns down to three: Nutrient, Amount, Ideal / day.
function openPhysiqueMicronutrients(p) {
  document.getElementById('physique-micro-title').textContent = formTitleWithDate('Micronutrients', p.date);

  const data = aggregateMicronutrientIntake(p.date, p.date);

  const tbody = document.getElementById('physique-micro-body');
  tbody.innerHTML = '';

  if (data.nutrients.length === 0) {
    tbody.appendChild(renderEmptyRow(3, 'Nothing to show — see the coverage note above.'));
  } else {
    data.nutrients.forEach((n) => {
      const tr = document.createElement('tr');
      if (n.severity === 'severe') tr.classList.add('nutrient-gap-severe');
      else if (n.severity === 'mild') tr.classList.add('nutrient-gap-mild');
      tr.append(
        makeCell(n.displayName),
        makeCell(`${n.total} ${n.unit}`),
        makeCell(n.ideal !== null ? `${n.ideal} ${n.idealUnit}` : '—'),
      );
      tbody.appendChild(tr);
    });
  }

  document.getElementById('physique-micro-modal').hidden = false;
}

// Form field id suffix → entry property, in column order (A–O). submitPhysiqueForm
// and openPhysiqueForm both walk this array positionally, so its order IS the
// sheet's column order — reordering this list is what reorders the write.
const PHYSIQUE_FIELDS = [
  { id: 'date', key: 'date' },
  { id: 'bedtime', key: 'bedtime' },
  { id: 'wake-time', key: 'wakeTime' },
  { id: 'body-mass', key: 'bodyMass', numeric: true },
  { id: 'consumption', key: 'consumption' },
  { id: 'breakdown', key: 'breakdown' },
  { id: 'calories-in', key: 'caloriesIn', numeric: true },
  { id: 'protein-in', key: 'proteinIn', numeric: true },
  { id: 'fiber', key: 'fiber', numeric: true },
  { id: 'fat', key: 'fat', numeric: true },
  { id: 'carbohydrate', key: 'carbohydrate', numeric: true },
  { id: 'tef', key: 'tef', numeric: true },
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
  const baseTitle = duplicate ? 'Duplicate Physique' : (entry ? 'Edit Physique' : 'Log a Physique');

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

  // Only a real Edit gets the date suffix — Log and Duplicate both start on
  // today's date too (syncPhysiquePatternMode just filled it in above), but
  // that's a default still waiting to be changed or saved, not a date this
  // day is actually logged under yet. Same "is this really an existing row"
  // read editingPhysiqueRow above uses.
  document.getElementById('physique-modal-title').textContent = (entry && !duplicate)
    ? formTitleWithDate(baseTitle, physiqueField('date').value)
    : baseTitle;

  // A saved breakdown is shown as its table straight away on Edit, so an
  // existing day can be checked without re-running Calculate. The activity
  // table has no saved form, so it's recomputed from the Workout text instead —
  // which also reprices Activity Duration and Calories Out at current settings,
  // so Save persists the figures on screen rather than the older ones behind
  // them. Body Mass is filled in by the loop above, which is what prices it.
  const openedBreakdown = entry ? parsePhysiqueBreakdown(entry.breakdown) : [];
  // Freshens fiber/fat/carbohydrate/tef against whatever's typed on the
  // Nutrition row (or its pulled 🧬 Micronutrients) right now, same as the
  // old standalone TEF table did on open.
  estimateTefBreakdown(openedBreakdown);
  renderPhysiqueBreakdown(openedBreakdown, entry ? entry.caloriesIn : 0, entry ? entry.proteinIn : 0);
  refreshPhysiqueActivityBreakdown();

  clearFieldError('physique-form-error');
  document.getElementById('physique-modal').hidden = false;
}

function closePhysiqueForm() {
  document.getElementById('physique-modal').hidden = true;
  hideCalcBreakdown('physique');
  hidePhysiqueActivityBreakdown();
}

// A whole day, not one meal, so a per-meal ceiling would fire
// on every normal day here.
const PHYSIQUE_DAY_CALORIE_CEILING = 6000;

// Body mass for the burn formula: this day's own field first, else the most
// recent day that recorded one.
function physiqueBodyMassKg() {
  const typed = evaluateNumberExpression(physiqueField('body-mass').value.trim());
  return typed || physiqueBodyMassKgFromLog();
}

// The most recent day that recorded a body mass. Null if none ever has.
function physiqueBodyMassKgFromLog() {
  const lastLogged = allPhysiqueEntries
    .filter((p) => p.date && p.bodyMass !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
  return lastLogged ? lastLogged.bodyMass : null;
}

// A day's raw A–O cells — what an undo writes straight back, and the starting
// point a recalculation overwrites only the derived columns of.
function physiqueRowValues(p) {
  return [p.date, p.bedtime, p.wakeTime, p.bodyMass ?? '', p.consumption, p.breakdown,
    p.caloriesIn ?? '', p.proteinIn ?? '', p.fiber ?? '', p.fat ?? '', p.carbohydrate ?? '', p.tef ?? '',
    p.workout, p.duration ?? '', p.caloriesOut ?? ''];
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
// field, or hides it when there's nothing parseable to show. renderCalcBreakdown
// itself merges same-name rows and sorts highest calories first for display,
// so an entry saved before that existed (or hand-edited out of order) still
// shows correctly without touching the stored JSON's own order. Each row's
// Carbohydrate/Fat/TEF cells come along for free once estimateTefBreakdown
// (micronutrient-insight.js) has annotated the breakdown array passed in —
// this function itself just draws whatever's already on the rows.
function renderPhysiqueBreakdown(breakdown, calories, protein) {
  if (breakdown.length) {
    renderCalcBreakdown(breakdown, calories || 0, protein || 0, 'physique');
  } else {
    hideCalcBreakdown('physique');
  }
}

// Re-derives Calories In/Protein In/Fiber/Fat/Carbohydrate/TEF straight from
// an already-drawn Consumption breakdown array — the same tail end of
// calculatePhysiqueDay (above) runs once a fresh Calculate has its own
// figures, but this is for when something else changes a row's numbers
// afterwards without a full re-Calculate (currently just the ✏️ button on a
// breakdown row, calorie-estimator.js's applyEditedRowToBreakdown), so what
// Save eventually writes matches what the table now shows rather than the
// stale figures the original Calculate produced.
function syncPhysiqueTotalsFromBreakdown(breakdown, calories, protein) {
  physiqueField('calories-in').value = calories;
  physiqueField('protein-in').value = protein.toFixed(1);

  const tef = estimateTefBreakdown(breakdown);
  const dayMacros = sumBreakdownMacros(breakdown);
  if (dayMacros.fiber !== null) physiqueField('fiber').value = dayMacros.fiber;
  if (dayMacros.fat !== null) physiqueField('fat').value = dayMacros.fat;
  if (dayMacros.carbohydrate !== null) physiqueField('carbohydrate').value = dayMacros.carbohydrate;
  if (tef) physiqueField('tef').value = tef.tefKcal;
}

// The Workout counterpart to the breakdown table above: one row per parsed
// exercise, the MET it was priced at, and the same summed Total row — which is
// where the day's duration and burn are now read, the two fields themselves
// being hidden.
//
// Nothing here is stored. Unlike Breakdown there's no JSON column behind it:
// the whole table is local arithmetic over the Workout text
// (activity-estimator.js), so it can be rebuilt on demand and never has to be
// kept in step with a saved copy of itself.
function renderPhysiqueActivityBreakdown(perLine, minutes, calories) {
  const tbody = document.getElementById('physique-activity-breakdown-body');
  tbody.innerHTML = '';

  perLine.forEach((line) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(line.name),
      makeCell(line.quantity),
      makeCell(String(line.met)),
      makeCell(activityLineMinutes(line.seconds)),
      makeCell(String(Math.round(line.calories))),
    );
    tbody.appendChild(tr);
  });

  const totalRow = document.createElement('tr');
  totalRow.className = 'calc-breakdown-total';
  totalRow.append(
    makeCell('Total'),
    makeCell(''),
    makeCell(''),
    makeCell(String(minutes)),
    makeCell(String(calories)),
  );
  tbody.appendChild(totalRow);

  document.getElementById('physique-activity-breakdown').hidden = false;
}

// One decimal rather than whole minutes: a strength line is often well under a
// minute of active time, and rounding each row to 0 or 1 would leave the rows
// looking nothing like the Total they add up to.
function activityLineMinutes(seconds) {
  return String(Math.round(seconds / 6) / 10);
}

// The same estimate 🧮 Calculate runs, run when the form opens so a saved day
// arrives showing its table — and so what the table shows is what Save writes.
// Repricing on open is the point, not a side effect: the estimate is pure local
// arithmetic over the day's own Workout and Body Mass, so a day opened after
// WORKOUT_REP_SEC (or an Activities MET) changed is worth more than the figure
// it was saved with. A workout that can't be priced writes nothing at all, so a
// hand-typed one keeps whatever it was saved with either way.
//
// Warnings are dropped rather than shown: the form has just opened, and
// openPhysiqueForm clears the error line straight after this anyway. Pressing
// Calculate is what surfaces them.
function refreshPhysiqueActivityBreakdown() {
  runPhysiqueWorkoutCalc();
}

function hidePhysiqueActivityBreakdown() {
  document.getElementById('physique-activity-breakdown').hidden = true;
  document.getElementById('physique-activity-breakdown-body').innerHTML = '';
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

// Prices the Workout field, writing both the hidden Activity Duration and
// Calories Out fields (columns N and O on Save) and the table they're read from,
// so the two can't disagree. Warnings are returned rather than shown — 🧮
// Calculate merges them with the food side's, Log a Workout (strength-plan.js)
// shows them on their own, and opening the form
// (refreshPhysiqueActivityBreakdown) drops them.
//
// Nothing is written unless the estimate succeeds: a day whose Workout is free
// text, or which has no body mass to price it, keeps the pair it was saved with.
//
// Synchronous: unlike the food estimator this is pure local arithmetic, no
// Groq or USDA involved.
function runPhysiqueWorkoutCalc() {
  const messages = [];
  const workout = physiqueField('workout').value.trim();
  if (!workout) {
    hidePhysiqueActivityBreakdown();
    return messages;
  }

  // Without the catalogue every exercise would price at EXERCISE_MET_FALLBACK,
  // and since this runs on open and its result is what Save writes, that would
  // quietly flatten a real day's burn to the default. Better to show nothing.
  if (!activitiesDataLoaded) {
    hidePhysiqueActivityBreakdown();
    messages.push('⚠️ Workout skipped — loading catalogue.');
    return messages;
  }

  const bodyMassKg = physiqueBodyMassKg();
  if (bodyMassKg === null) {
    hidePhysiqueActivityBreakdown();
    messages.push(physiqueDataLoaded
      ? '⚠️ Workout skipped — needs Body Mass.'
      : '⚠️ Workout skipped — loading data.');
    return messages;
  }

  try {
    const { minutes, calories, unmatchedNames, perLine } = estimateWorkoutActivity(workout, bodyMassKg);
    physiqueField('activity-duration').value = minutes;
    physiqueField('calories-out').value = calories;
    renderPhysiqueActivityBreakdown(perLine, minutes, calories);
    if (unmatchedNames.length) {
      messages.push(`⚠️ Couldn't find ${unmatchedNames.map((n) => `"${n}"`).join(', ')} in the Activity Plan — used a default MET.`);
    }
  } catch (err) {
    hidePhysiqueActivityBreakdown();
    messages.push(`⚠️ Workout: ${err.message}`);
  }
  return messages;
}

// Grams-per-unit for mass units only — a fixed unit-to-unit conversion, not
// an ingredient-specific one, so it's safe to apply without knowing what the
// ingredient even is. Deliberately excludes volume units (cup, tbsp, ml, ...):
// converting those to grams needs the ingredient's density, which is exactly
// the kind of lookup that requires Groq/USDA, i.e. what this button exists to
// avoid. A line in one of those units just won't get a local calorie figure.
const PHYSIQUE_MASS_UNIT_TO_GRAMS = { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592 };

// Best-effort calorie figure for one Consumption line, straight off the
// Nutrition table — the same two lookup paths calorie-estimator.js's
// Calculate uses for an exact table hit (by weight or by unit count), minus
// its USDA/AI fallback for a miss. Returns null (not 0) when there's nothing
// local to go on, so a genuinely unknown ingredient doesn't masquerade as a
// 0-calorie one and sort to the bottom for the wrong reason.
function localIngredientCalories(quantity, unit, name) {
  if (quantity === null) return null;
  const entry = findNutritionEntry(name);
  if (!entry || !entry.calories) return null;

  if (unit && COUNT_LIKE_UNITS.has(unit)) {
    const tableCount = parseCountFromAmount(entry.amount);
    return tableCount ? (entry.calories / tableCount) * quantity : null;
  }

  const gramsPerUnit = PHYSIQUE_MASS_UNIT_TO_GRAMS[unit];
  if (gramsPerUnit === undefined) return null;
  const tableGrams = parseGramsFromAmount(entry.amount);
  return tableGrams ? (entry.calories / tableGrams) * (quantity * gramsPerUnit) : null;
}

// Local-only tidy-up for a Consumption block: combines lines that are really
// the same entry typed twice (e.g. two separate "38g onion" additions through
// the day) and orders the rest by calories, the same "highest first" order
// Calculate itself settles on. Two lines only combine when their extracted
// name AND unit both match exactly — no unit conversion is attempted, so
// "100g rice" and "1cup rice" stay separate rather than guessing a conversion
// between them. A line with no parseable quantity (rare — Consumption is
// meant to always lead with an amount) is left exactly as typed and never
// merged with anything. Pure text in, text out — no DOM, so both the modal's
// own Combine & Sort button (below) and the bulk one further down share the
// exact same logic instead of two copies that could drift apart.
function combineAndSortConsumptionText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { text, combinedCount: 0 };

  const groups = new Map();
  let unmergeable = 0;
  lines.forEach((line) => {
    const { quantity, unit } = extractIngredientQuantity(line);
    const name = extractIngredientName(line);
    const key = quantity === null ? `unmergeable-${unmergeable++}` : `${name.toLowerCase()}|${unit || ''}`;
    const existing = groups.get(key);
    if (existing) existing.quantity += quantity;
    else groups.set(key, { quantity, unit, name, raw: line });
  });
  const combinedCount = lines.length - groups.size;

  const rebuilt = [...groups.values()].map((g) => {
    if (g.quantity === null) return g.raw;
    const unitText = g.unit ? (UNIT_CANONICAL[g.unit] || g.unit) : '';
    return `${Math.round(g.quantity * 100) / 100}${unitText} ${g.name}`.trim();
  });

  const scored = rebuilt.map((line) => {
    const { quantity, unit } = extractIngredientQuantity(line);
    return { line, calories: localIngredientCalories(quantity, unit, extractIngredientName(line)) };
  });
  // Unranked (no local match) lines sort after every ranked one, keeping
  // their relative order among themselves — Array#sort is stable, and
  // there's nothing here to break a tie between two nulls.
  scored.sort((a, b) => (b.calories ?? -Infinity) - (a.calories ?? -Infinity));

  return { text: scored.map((s) => s.line).join('\n'), combinedCount };
}

// The modal's own Combine & Sort button — same tidy-up as the bulk action
// below, run on just the one Consumption box being edited right now, so it
// can be cleaned up before Calculate ever runs rather than only after saving.
function combineAndSortPhysiqueConsumptionField() {
  const field = physiqueField('consumption');
  if (!field.value.trim()) {
    showFieldError('physique-form-error', 'Fill in Consumption first.');
    return;
  }

  const { text, combinedCount } = combineAndSortConsumptionText(field.value);
  field.value = text;
  clearFieldError('physique-form-error');
  if (combinedCount > 0) {
    showFieldError('physique-form-error', `🔗 ${combinedCount} combined.`);
  }
}

// The form's own 🧬 action — same view the table row's button opens
// (openPhysiqueMicronutrients), reachable without closing back out to the
// row. Only meaningful for a day already on the sheet: aggregateMicronutrientIntake
// reads the SAVED Physique rows (physiqueAsWellnessEntries), not whatever's
// currently typed in this form, so a still-unsaved Log/Duplicate has nothing
// yet to look up.
function openPhysiqueMicronutrientsFromForm() {
  const entry = allPhysiqueEntries.find((p) => p.row === editingPhysiqueRow);
  if (!entry) {
    showFieldError('physique-form-error', 'Save this day first — Micronutrients reads the saved log.');
    return;
  }
  openPhysiqueMicronutrients(entry);
}

// --- Bulk Combine & Sort --------------------------------------------------
//
// Sits beside 🧮 Calculate in the same bulk actions bar, but never touches
// Groq/USDA: for each selected day, combineAndSortConsumptionText tidies just
// that day's Consumption column locally and writes it straight back, the same
// per-row read/write bulkCalculatePhysique uses. Calories In/Protein In are
// untouched — combining/reordering lines doesn't change the day's totals,
// only their arrangement, so there's nothing for Calculate's actual estimate
// to redo here.
function eligibleForBulkCombine(p) {
  return Boolean(p.consumption.trim());
}

async function bulkCombineAndSortPhysique() {
  const selected = allPhysiqueEntries.filter((p) => selectedPhysiqueRows.has(p.row));
  const eligible = selected.filter(eligibleForBulkCombine);
  const skipped = selected.length - eligible.length;

  if (!eligible.length) {
    alert('None of the selected days have a Consumption to combine/sort.');
    return;
  }

  const summaryEl = document.getElementById('physique-bulk-summary');
  const snapshots = eligible.map((p) => ({ row: p.row, values: physiqueRowValues(p) }));

  let done = 0;
  let combinedTotal = 0;
  let changedCount = 0;
  const succeeded = [];
  const results = await Promise.allSettled(eligible.map(async (p, i) => {
    try {
      const { text, combinedCount } = combineAndSortConsumptionText(p.consumption);
      if (text !== p.consumption) {
        const values = physiqueRowValues(p);
        values[4] = text;
        await updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${p.row}:O${p.row}`, [values]);
        changedCount += 1;
        combinedTotal += combinedCount;
        succeeded.push(snapshots[i]);
      }
    } finally {
      done += 1;
      summaryEl.textContent = `Combining ${done}/${eligible.length}…`;
    }
  }));

  selectedPhysiqueRows.clear();
  await refreshPhysique(true);

  const failed = results.filter((r) => r.status === 'rejected').length;
  const parts = [`${changedCount} day${changedCount === 1 ? '' : 's'} tidied (${combinedTotal} duplicate line${combinedTotal === 1 ? '' : 's'} combined)`];
  if (skipped) parts.push(`${skipped} skipped (nothing to combine)`);
  if (failed) parts.push(`${failed} failed`);

  showUndoToast(`${parts.join(', ')}.`, () => restorePhysiqueSnapshots(succeeded));
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
      physiqueField('protein-in').value = protein.toFixed(1);

      // Annotates each matched row with fiber/fat/carbohydrate/tef BEFORE
      // drawing the table, so DF/Fat/Carb/TEF show up in the same pass as
      // Cal/Pro rather than a second one. Only when it's actually measurable —
      // a day whose ingredients have no 🧬 Micronutrients pulled yet leaves
      // each field exactly as it was (blank, or whatever a previous Calculate
      // last wrote) rather than overwriting a real figure with nothing.
      const tef = estimateTefBreakdown(breakdown);
      const dayMacros = sumBreakdownMacros(breakdown);
      if (dayMacros.fiber !== null) physiqueField('fiber').value = dayMacros.fiber;
      if (dayMacros.fat !== null) physiqueField('fat').value = dayMacros.fat;
      if (dayMacros.carbohydrate !== null) physiqueField('carbohydrate').value = dayMacros.carbohydrate;
      if (tef) physiqueField('tef').value = tef.tefKcal;
      // Writes the Breakdown field's JSON as well as drawing the table.
      renderPhysiqueBreakdown(breakdown, calories, protein);

      if (reusedCount) {
        messages.push(`♻️ ${reusedCount} reused, ${estimatedCount} new.`);
      }
      if (usdaUnreachable) {
        messages.push('⚠️ No DB — AI only.');
      }
      if (calories > PHYSIQUE_DAY_CALORIE_CEILING) {
        messages.push(`⚠️ ${calories} kcal, check.`);
      }
    } catch (err) {
      messages.push(`⚠️ Consumption: ${err.message}`);
    }
  }

  btn.disabled = false;
  btn.textContent = originalLabel;

  if (messages.length) showFieldError('physique-form-error', messages.join(' '));
}

// Folds a day already on the sheet into the open form, so what was typed is
// added to that day rather than refused for clashing with it.
//
// How each field merges follows from what the field IS. Consumption, Workout and
// Breakdown are lists, so they concatenate — the saved lines first, then what was
// just typed, verbatim: a food genuinely eaten twice in a day is two lines, and
// Combine & Sort is there for when it isn't. Calories In / Protein In, TEF and
// Duration / Calories Out are totals OVER those lists, so they add up. Bedtime,
// Wake-up Time and Body Mass are single facts about the day rather than running
// tallies, so a value typed here wins and the saved one only fills a blank.
//
// Nothing is written to the sheet: the merged day sits in the form, and the
// second Save is what commits it.
function mergePhysiqueEntryIntoForm(saved) {
  // Body mass first — refreshPhysiqueActivityBreakdown below prices the merged
  // workout against whatever this field ends up holding.
  fillPhysiqueFieldIfBlank('bedtime', saved.bedtime);
  fillPhysiqueFieldIfBlank('wake-time', saved.wakeTime);
  fillPhysiqueFieldIfBlank('body-mass', saved.bodyMass);

  addToPhysiqueTotal('calories-in', saved.caloriesIn);
  addToPhysiqueTotal('protein-in', saved.proteinIn);
  // Provisional — a linear sum of the two days' own Fiber/Fat/Carbohydrate/TEF,
  // same as the other totals here. Replaced below by the exact figures if the
  // merged breakdown's own macros can be re-estimated straight away.
  addToPhysiqueTotal('fiber', saved.fiber);
  addToPhysiqueTotal('fat', saved.fat);
  addToPhysiqueTotal('carbohydrate', saved.carbohydrate);
  addToPhysiqueTotal('tef', saved.tef);
  addToPhysiqueTotal('activity-duration', saved.duration);
  addToPhysiqueTotal('calories-out', saved.caloriesOut);

  appendToPhysiqueLines('consumption', saved.consumption);
  appendToPhysiqueLines('workout', saved.workout);

  // Both breakdowns end up in one table, which is also what rewrites the
  // Breakdown field's JSON — so a later Calculate can still match a saved line
  // by noteLine and reuse its numbers instead of paying for it again.
  const mergedBreakdown = [...parsePhysiqueBreakdown(saved.breakdown), ...parsePhysiqueBreakdown(physiqueField('breakdown').value)];
  // Fiber/Fat/Carbohydrate/TEF are linear in each macro's own grams, so
  // re-running them on the combined breakdown gives the same numbers the sums
  // above already estimated — but exactly, off the actual merged ingredient
  // list, rather than trusting rounded figures added together. Run before
  // rendering so DF/Fat/Carb/TEF are on the rows the table is about to draw.
  const tef = estimateTefBreakdown(mergedBreakdown);
  const dayMacros = sumBreakdownMacros(mergedBreakdown);
  if (dayMacros.fiber !== null) physiqueField('fiber').value = dayMacros.fiber;
  if (dayMacros.fat !== null) physiqueField('fat').value = dayMacros.fat;
  if (dayMacros.carbohydrate !== null) physiqueField('carbohydrate').value = dayMacros.carbohydrate;
  if (tef) physiqueField('tef').value = tef.tefKcal;
  renderPhysiqueBreakdown(
    mergedBreakdown,
    evaluateNumberExpression(physiqueField('calories-in').value.trim()),
    evaluateNumberExpression(physiqueField('protein-in').value.trim()),
  );
  // Reprices Duration and Calories Out off the merged Workout text, replacing
  // the summed figures above with a single estimate of the combined session.
  // Where it can't run (no body mass on file) the sums stand.
  refreshPhysiqueActivityBreakdown();

  editingPhysiqueRow = saved.row;
  document.getElementById('physique-modal-title').textContent = 'Edit Physique';
  showFieldError('physique-form-error', `↩︎ Merged — Save again.`);
}

function fillPhysiqueFieldIfBlank(id, savedValue) {
  const field = physiqueField(id);
  if (!field.value.trim() && savedValue !== null && savedValue !== undefined) {
    field.value = String(savedValue);
  }
}

// One decimal, the precision the calorie estimator itself rounds protein to.
// Blank stays blank rather than becoming 0, so an untouched field doesn't start
// claiming a zero the day didn't record. Protein always shows that decimal
// (22.0, not 22) since it's the one field summed from already-rounded,
// one-decimal per-ingredient figures; the others stay whole-number display.
function addToPhysiqueTotal(id, savedNumber) {
  const field = physiqueField(id);
  const total = (savedNumber ?? 0) + (evaluateNumberExpression(field.value.trim()) ?? 0);
  if (!total) {
    field.value = '';
    return;
  }
  const rounded = Math.round(total * 10) / 10;
  field.value = id === 'protein-in' ? rounded.toFixed(1) : String(rounded);
}

function appendToPhysiqueLines(id, savedText) {
  const field = physiqueField(id);
  field.value = [String(savedText ?? '').trim(), field.value.trim()].filter(Boolean).join('\n');
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

  // One row per day is the whole point of this tab, so a date already logged
  // isn't a second sample — it's more of the same day. The first Save on a
  // collision therefore writes nothing: it folds the row already on the sheet
  // into the form, switches to editing that row, and leaves the combined day on
  // screen to check. Saving again writes it, because editingPhysiqueRow now
  // excludes that row from this very lookup.
  //
  // Patterns are exempt: they're dateless templates, and you can keep as many
  // as you like.
  const date = rowData[0];
  const clash = !isPattern && allPhysiqueEntries.find((p) => p.date === date && p.row !== editingPhysiqueRow);
  if (clash) {
    mergePhysiqueEntryIntoForm(clash);
    return;
  }

  try {
    if (editingPhysiqueRow !== null) {
      await updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${editingPhysiqueRow}:O${editingPhysiqueRow}`, [rowData]);
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

// A day's recalculated A–O cells, or null if nothing about it changed.
async function recalculatePhysiqueDay(p, bodyMassKg) {
  const values = physiqueRowValues(p);

  if (p.consumption.trim()) {
    const { calories, protein, breakdown } =
      await estimateConsumptionIncrementally(p.consumption, p.breakdown);
    // Annotates each matched row with fiber/fat/carbohydrate/tef before the
    // JSON is stringified, so column F carries them too, not just I/J/K/L.
    // Only overwritten when measurable — leaves an unpriced day's existing
    // cells (blank, or a manual/earlier figure) alone rather than blanking them.
    const tef = estimateTefBreakdown(breakdown);
    const dayMacros = sumBreakdownMacros(breakdown);
    if (dayMacros.fiber !== null) values[8] = dayMacros.fiber;
    if (dayMacros.fat !== null) values[9] = dayMacros.fat;
    if (dayMacros.carbohydrate !== null) values[10] = dayMacros.carbohydrate;
    if (tef) values[11] = tef.tefKcal;
    values[4] = breakdown.map((i) => i.noteLine || `${i.amount} ${i.name}`).join('\n');
    values[5] = breakdownToJson(breakdown);
    values[6] = calories;
    values[7] = protein;
  }

  if (p.workout.trim() && bodyMassKg !== null) {
    const { minutes, calories } = estimateWorkoutActivity(p.workout, bodyMassKg);
    values[13] = minutes;
    values[14] = calories;
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
  // now" body mass either way, and a day of its own is preferred where it has
  // one (below) so a historical row still uses what it actually recorded.
  const latestBodyMassKg = physiqueBodyMassKgFromLog();
  const summaryEl = document.getElementById('physique-bulk-summary');

  const snapshots = eligible.map((p) => ({ row: p.row, values: physiqueRowValues(p) }));

  let done = 0;
  const succeeded = [];
  const results = await Promise.allSettled(eligible.map(async (p, i) => {
    try {
      const values = await recalculatePhysiqueDay(p, p.bodyMass ?? latestBodyMassKg);
      await updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${p.row}:O${p.row}`, [values]);
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
      updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${s.row}:O${s.row}`, [s.values])));
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
