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

// Mirrors updateTimesheetLiveDuration's live read-out, just off Bedtime/Wake-up
// Time instead of Start/End — same wraparound sleepDurationHours already gives
// the Sleep chart, read back live as the two clock fields are typed.
function updatePhysiqueSleepDuration() {
  const bed = parseClockTime(physiqueField('bedtime').value);
  const wake = parseClockTime(physiqueField('wake-time').value);
  const sleepHours = (bed !== null && wake !== null) ? sleepDurationHours(bed, wake) : null;
  document.getElementById('physique-sleep-duration').textContent = sleepHours !== null ? `${sleepHours} hr` : '—';
  updatePhysiqueSleepDeprivation(sleepHours);
}

// Same dailyEnergyBalanceKcal the Status card's own Sleep Deprivation tile runs
// (wellness-charts.js), just off the form's own typed fields rather than a
// saved entry — so what's about to be saved already shows what a short night
// is costing (or adding to) this day's balance. Falls back to '—' whenever a
// piece it needs (profile, body mass, calories in) isn't there yet.
function updatePhysiqueSleepDeprivation(sleepHours) {
  const el = document.getElementById('physique-sleep-deprivation');
  if (!el) return;

  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const bodyMassKg = evaluateNumberExpression(physiqueField('body-mass').value.trim());
  const intake = evaluateNumberExpression(physiqueField('calories-in').value.trim());
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  if (!haveProfile || !bodyMassKg || !intake || sleepHours === null) {
    el.textContent = '—';
    return;
  }

  const maintenance = Math.round(bmrKcal(bodyMassKg, heightCm, age, sex));
  const activity = evaluateNumberExpression(physiqueField('calories-out').value.trim()) || 0;
  const typedTef = evaluateNumberExpression(physiqueField('tef').value.trim());
  const tef = typedTef || Math.round(intake * (1 - tefDivisor()));
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  const { deprivationKcal } = dailyEnergyBalanceKcal(Math.round(intake), maintenance, activity, tef, sleepHours, sleepTarget);
  el.textContent = deprivationKcal !== null ? `${deprivationKcal} kcal` : '—';
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
    document.getElementById('today-physique-btn').addEventListener('click', () => openPhysiqueForm(todaysPhysiqueDay()));
    document.getElementById('health-reminder-log-btn').addEventListener('click', () => openPhysiqueForm(todaysPhysiqueDay()));
    document.getElementById('physique-cancel-btn').addEventListener('click', closePhysiqueForm);
    document.getElementById('physique-micro-close-btn').addEventListener('click', () => {
      document.getElementById('physique-micro-modal').hidden = true;
    });
    document.getElementById('physique-calc-btn').addEventListener('click', calculatePhysiqueDay);
    document.getElementById('physique-scan-btn').addEventListener('click', () => document.getElementById('physique-scan-input').click());
    document.getElementById('physique-scan-input').addEventListener('change', handlePhysiqueScanInput);
    document.getElementById('physique-combine-btn').addEventListener('click', combineAndSortPhysiqueConsumptionField);
    physiqueField('consumption').addEventListener('input', syncPhysiqueCombineButtonVisibility);
    setupConsumptionAutocomplete();
    document.getElementById('physique-form-micro-btn').addEventListener('click', openPhysiqueMicronutrientsFromForm);
    document.getElementById('physique-is-pattern').addEventListener('change', syncPhysiquePatternMode);
    ['bedtime', 'wake-time'].forEach((id) => physiqueField(id).addEventListener('input', updatePhysiqueSleepDuration));
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
  // Same reason, for Nutrition's own tint/label pair (nutrition.js):
  // .nutrition-row-logged on any row already in today's Consumption
  // breakdown, and the Log/Log More label. A full re-render rather than just
  // the label, since the tint itself reads todaysPhysiqueDay() too — but
  // only once Nutrition has data of its own to draw; before that,
  // initNutrition's own first render already picks up whatever Physique
  // state landed by then (see nutritionDataLoaded's own load-order comment,
  // nutrition.js), and re-rendering an empty table here would show the
  // "no ingredients yet" empty state rather than just doing nothing.
  if (nutritionDataLoaded) renderNutritionList();
  else updateNutritionLogButtonLabel();
  logPhysiqueDataGaps();
  checkHealthReminder();
}

// Unlike the timesheet reminder (weekdays only, scoped to one employer),
// there's no day this doesn't apply to — everyone eats every day — so this
// is just "does today have a Physique row yet".
function checkHealthReminder() {
  const banner = document.getElementById('health-reminder-banner');
  const today = isoFromDate(new Date());
  banner.hidden = allPhysiqueEntries.some((p) => p.date === today);
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
        // Same shape, one column over (J) — read by the Wellness Fat Intake chart.
        fatG: p.fat,
        // Same shape, one column over again (K) — read by the Wellness Carb Intake chart.
        carbG: p.carbohydrate,
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

  // Read once per render rather than per row — same profile every row's
  // Depr figure would read anyway, off the same settings the Status card's
  // own Sleep Deprivation tile uses.
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  pageEntries.forEach((p) => {
    const tr = document.createElement('tr');
    // Pattern rows carry no date, so they never match.
    if (p.date === todayIso) tr.classList.add('today-row');

    const num = (value) => {
      if (value === null) return '—';
      return privacyMode ? maskDigits(String(value)) : String(value);
    };
    const sleepHours = physiqueSleepHours(p);
    // Wake minus bed, not the two clock times — those still open on Edit
    // (the form's own Bedtime/Wake-up Time fields), same as every other
    // computed table figure that keeps its raw inputs one click away rather
    // than in the table itself.
    const sleepTitle = sleepHours !== null
      ? `${sleepHours} hr of sleep (${p.bedtime} → ${p.wakeTime}) — open Edit to change the clock times`
      : '';
    const maskedSleepTitle = privacyMode ? maskDigits(sleepTitle) : sleepTitle;

    // Same dailyEnergyBalanceKcal the Status card's own Sleep Deprivation tile
    // and every chart run — off this day's own Body Mass, Calories In,
    // Calories Out and TEF, so it can't disagree with what those already show
    // for the same day. Null (shown as —) without a profile, body mass or
    // Calories In to work from.
    const deprivationKcal = (haveProfile && p.bodyMass !== null && p.caloriesIn !== null && sleepHours !== null)
      ? dailyEnergyBalanceKcal(
        p.caloriesIn,
        Math.round(bmrKcal(p.bodyMass, heightCm, age, sex)),
        p.caloriesOut ?? 0,
        p.tef !== null ? p.tef : Math.round(p.caloriesIn * (1 - tefDivisor())),
        sleepHours,
        sleepTarget,
      ).deprivationKcal
      : null;
    const deprivationText = deprivationKcal !== null ? String(deprivationKcal) : '—';
    const deprivationTitle = deprivationKcal !== null
      ? `Sleep Deprivation Effect: ${deprivationKcal} kcal`
      : 'Not calculable — needs a profile (Settings), this day\'s Body Mass and Calories In';
    const maskedDeprivationTitle = privacyMode ? maskDigits(deprivationTitle) : deprivationTitle;

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
      makeCell(num(p.bodyMass)),
      makeCell(num(sleepHours), maskedSleepTitle),
      makeCell(privacyMode ? maskDigits(deprivationText) : deprivationText, maskedDeprivationTitle),
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
  syncPhysiqueCombineButtonVisibility();
  updatePhysiqueSleepDuration();

  clearFieldError('physique-form-error');
  document.getElementById('physique-modal').hidden = false;
}

function closePhysiqueForm() {
  document.getElementById('physique-modal').hidden = true;
  hideCalcBreakdown('physique');
  hidePhysiqueActivityBreakdown();
  hideConsumptionSuggestions();
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
  updatePhysiqueSleepDuration();

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
    // Same combine + highest-burn-first sort the form's own Calculate button
    // runs (runPhysiqueWorkoutCalc/combineWorkoutText) — bulk Calculate
    // rewrites column M too, not just the Duration/Calories Out it already
    // wrote, so a repeated exercise logged across several lines collapses
    // here the same way it would through the form.
    const { text: combinedWorkout } = combineWorkoutText(p.workout);
    const { minutes, calories, perLine } = estimateWorkoutActivity(combinedWorkout, bodyMassKg);
    const sortedPerLine = [...perLine].sort((a, b) => b.calories - a.calories);
    values[12] = sortedPerLine.map((line) => `${line.quantity} ${line.name}`).join('\n');
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
