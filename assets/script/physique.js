// One row per day: sleep window, body mass, what was eaten and what was
// burned. The tab every chart, today-tile, Insight mode and Activity Plan tick
// reads, via the physiqueAsWellnessEntries() adapter below.

// Read with its header row: columns are found by name (PHYSIQUE_COLUMNS), so
// reordering them on the sheet can't make the app write into the wrong cell.
const PHYSIQUE_RANGE = `'${CONFIG.SHEETS.PHYSIQUE}'!A1:Z`;

// Sheet columns by header. The first name is the current one, the rest older
// names still recognised. This order is the fallback when there's no header row.
const PHYSIQUE_COLUMNS = [
  { key: 'date', headers: ['Date'] },
  { key: 'bodyMass', headers: ['Body Mass'] },
  // JSON of the day's four BMR figures (see "Stored BMR" below).
  { key: 'bmr', headers: ['BMR'] },
  { key: 'bedtime', headers: ['Bed', 'Bedtime'] },
  { key: 'wakeTime', headers: ['Wake', 'Wake-up Time'] },
  // Stored rather than recomputed per render: written on every save (physiqueRowCells).
  { key: 'sleep', headers: ['Sleep'] },
  { key: 'deprivation', headers: ['Deprivation'] },
  { key: 'consumption', headers: ['Consumption'] },
  { key: 'breakdown', headers: ['Breakdown'] },
  { key: 'caloriesIn', headers: ['TEI', 'Calories In'] },
  { key: 'proteinIn', headers: ['Protein', 'Protein In'] },
  { key: 'fiber', headers: ['Dietary Fiber', 'Fiber'] },
  { key: 'fat', headers: ['Fat'] },
  { key: 'carbohydrate', headers: ['Carbohydrate'] },
  { key: 'tef', headers: ['TEF'] },
  { key: 'workout', headers: ['Workout'] },
  { key: 'duration', headers: ['Duration', 'Activity Duration'] },
  { key: 'caloriesOut', headers: ['AEE', 'Calories Out'] },
];
const PHYSIQUE_DEFAULT_COLUMNS = Object.fromEntries(PHYSIQUE_COLUMNS.map(({ key }, i) => [key, i]));
// key -> 0-based column, from the header row (refreshPhysique).
let physiqueColumnIndex = PHYSIQUE_DEFAULT_COLUMNS;
// 4 weeks of dated days per page. Pattern rows (no date) are date-agnostic
// templates rather than a day, so they're excluded from this count and shown
// on every page in full instead of being paginated away — see
// getPhysiquePageEntries.
const P_PAGE_SIZE = 28;

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

  // The same derivation Save stores (physiqueDerivedFigures), off the typed fields.
  const read = (id) => evaluateNumberExpression(physiqueField(id).value.trim());
  const intake = read('calories-in');
  const day = {
    date: physiqueField('date').value || isoFromDate(new Date()),
    bodyMass: read('body-mass') || null,
    caloriesIn: intake ? Math.round(intake) : null,
    caloriesOut: read('calories-out') || 0,
    tef: read('tef') || null,
  };
  // A pattern has no date, so no BMR.
  const bmr = document.getElementById('physique-is-pattern').checked ? {} : physiqueBmrForSave(day.date, day.bodyMass);
  const deprivationKcal = physiqueDeprivationKcal(day, sleepHours, bmr);
  el.textContent = deprivationKcal !== null ? `${deprivationKcal} kcal` : '—';

  // The four BMR figures Save will store, one line at the end of the form.
  [['mif', 'BMR_mif'], ['kat', 'BMR_kat'], ['cal', 'BMR_cal'], ['adp', 'BMR_adp']].forEach(([id, key]) => {
    const text = bmr[key] !== undefined ? `${bmr[key]} kcal` : '—';
    document.getElementById(`physique-bmr-${id}`).textContent = privacyMode ? maskDigits(text) : text;
  });
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
    // Today's address is its date, the same one the row's own Edit uses, whether or
    // not today is logged yet.
    document.getElementById('today-physique-btn').addEventListener('click', () => {
      routeRecordEdit('physique', todayPhysiqueRouteStep());
      openPhysiqueForm(todaysPhysiqueDay());
    });
    // health/physique/<date or pattern-N>/ opens that row's Edit; …/micronutrients/ its 🧬 view.
    // Today's date opens a new Log while today isn't logged, and the old …/today/
    // address lands on today's date.
    registerRecordRoute('physique', (slug, sub) => {
      const today = todayPhysiqueRouteStep();
      if (!sub && (slug === 'today' || (slug === today.slug && !todaysPhysiqueDay()))) {
        openPhysiqueForm(todaysPhysiqueDay());
        return today;
      }
      const p = allPhysiqueEntries.find((e) => physiqueRouteStep(e).slug === slug);
      if (!p || (sub && sub !== 'micronutrients')) return null;
      if (sub) openPhysiqueMicronutrients(p);
      else openPhysiqueForm(p);
      return physiqueRouteStep(p).label;
    });
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
    // Date and body mass move the BMR line too.
    ['bedtime', 'wake-time', 'date', 'body-mass'].forEach((id) => physiqueField(id).addEventListener('input', updatePhysiqueSleepDuration));
    document.getElementById('physique-is-pattern').addEventListener('change', updatePhysiqueSleepDuration);
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
      const { pageEntries } = getPhysiquePageEntries();
      pageEntries.forEach((p) => (e.target.checked ? selectedPhysiqueRows.add(p.row) : selectedPhysiqueRows.delete(p.row)));
      renderPhysiqueList();
    });
    onAsyncClick('physique-bulk-calc-btn', bulkCalculatePhysique);
    onAsyncClick('physique-bulk-combine-btn', bulkCombineAndSortPhysique);
    document.getElementById('physique-export-csv-btn').addEventListener('click', exportPhysiqueCSV);
  }

  await refreshPhysique(forceRefresh);
}

async function refreshPhysique(forceRefresh = false) {
  // A new key: the cached copy now includes the header row.
  const resp = await getValues(PHYSIQUE_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

  // Row 1 is always the header, as before.
  physiqueColumnIndex = physiqueColumnsFromHeader(values[0] || []);
  const cell = (row, key) => (physiqueColumnIndex[key] === undefined ? undefined : row[physiqueColumnIndex[key]]);

  allPhysiqueEntries = values.slice(1)
    .map((row, i) => ({
      row: i + 2,
      // Every cell as read, so a write keeps columns this app doesn't know about.
      cells: row,
      date: String(cell(row, 'date') || '').trim(),
      bedtime: normalizeTimeCell(cell(row, 'bedtime')),
      wakeTime: normalizeTimeCell(cell(row, 'wakeTime')),
      bodyMass: numberCell(cell(row, 'bodyMass')),
      sleep: numberCell(cell(row, 'sleep')),
      deprivation: numberCell(cell(row, 'deprivation')),
      bmr: parsePhysiqueBmr(cell(row, 'bmr')),
      consumption: cell(row, 'consumption') || '',
      breakdown: cell(row, 'breakdown') || '',
      caloriesIn: numberCell(cell(row, 'caloriesIn')),
      proteinIn: numberCell(cell(row, 'proteinIn')),
      fiber: numberCell(cell(row, 'fiber')),
      fat: numberCell(cell(row, 'fat')),
      carbohydrate: numberCell(cell(row, 'carbohydrate')),
      tef: numberCell(cell(row, 'tef')),
      workout: cell(row, 'workout') || '',
      duration: numberCell(cell(row, 'duration')),
      caloriesOut: numberCell(cell(row, 'caloriesOut')),
    }))
    // A row with nothing in it at all isn't a logged day — but a dateless row
    // that carries anything is a pattern, so every column counts here, not
    // just the date.
    .filter((p) => PHYSIQUE_FIELDS.some(({ key }) => p[key] !== null && String(p[key]).trim() !== ''));

  physiqueEntriesCache = null;
  physiqueDatedCache = null;
  bmrFiguresCache = new Map();
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
  if (nutritionDataLoaded) {
    // Today's logged days just changed, so the memoized Uses counts are stale —
    // drop them so renderNutritionList recounts against current Physique.
    nutritionUsageCounts = null;
    renderNutritionList();
  } else updateNutritionLogButtonLabel();
  logPhysiqueDataGaps();
  checkHealthReminder();
  backfillPhysiqueDerivedFigures();
}

// Header row -> { key: column }. Without a recognisable Date header the
// columns are taken in PHYSIQUE_COLUMNS order.
function physiqueColumnsFromHeader(headerRow) {
  const names = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  const index = {};
  PHYSIQUE_COLUMNS.forEach(({ key, headers }) => {
    const i = names.findIndex((name) => headers.some((h) => h.toLowerCase() === name));
    if (i !== -1) index[key] = i;
  });
  return index.date === undefined ? PHYSIQUE_DEFAULT_COLUMNS : index;
}

function physiqueColumnLetter(i) {
  let letters = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

// --- Stored BMR ------------------------------------------------------------
//
// Each day's BMR cell holds {"BMR_mif","BMR_kat","BMR_cal","BMR_adp"} (kcal),
// computed once on save and read by every per-day display. A key is left out
// when its inputs are missing.

const BMR_EQUATION_KEYS = { mifflin: 'BMR_mif', katch: 'BMR_kat' };
const BMR_DEFINITIONS = {
  BMR_mif: 'Mifflin-St Jeor BMR',
  BMR_kat: 'Katch-McArdle BMR',
  BMR_cal: 'Calibrated BMR',
  BMR_adp: 'Adapted BMR by t',
};

// "BMR_kat (Katch-McArdle BMR)" — the label (definition) form every hover uses.
function bmrHoverLabel(key) {
  return `${key} (${BMR_DEFINITIONS[key]})`;
}
// Set while every day is being recomputed, so lookups ignore stale stored values.
let ignoreStoredBmr = false;
// date -> figures, and dated rows oldest first; both dropped on every refresh.
let bmrFiguresCache = new Map();
let physiqueDatedCache = null;

function parsePhysiqueBmr(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function physiqueDatedAscending() {
  if (!physiqueDatedCache) {
    physiqueDatedCache = allPhysiqueEntries.filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date));
  }
  return physiqueDatedCache;
}

// The latest dated row on or before `date`, so a day with no row carries the last one forward.
function physiqueRowAsOf(date) {
  let found = null;
  for (const p of physiqueDatedAscending()) {
    if (p.date > date) break;
    found = p;
  }
  return found;
}

// The day's own weigh-in, else the latest earlier one — the mass the charts use.
function physiqueBodyMassAsOf(date) {
  let mass = null;
  for (const p of physiqueDatedAscending()) {
    if (p.date > date) break;
    if (p.bodyMass !== null) mass = p.bodyMass;
  }
  return mass;
}

function physiqueFirstWeighInDate() {
  return physiqueDatedAscending().find((p) => p.bodyMass !== null)?.date ?? null;
}

// BMR_mif, BMR_kat and BMR_adp for a day at `bodyMassKg`, age as of that day.
function physiqueBaseBmrFigures(date, bodyMassKg) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const sex = getSettingString('SEX', null);
  if (!date || bodyMassKg === null || heightCm === null || (sex !== 'male' && sex !== 'female')) return {};
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null), dateFromIso(date));

  const figures = {};
  if (age !== null) figures.BMR_mif = Math.round(bmrKcal(bodyMassKg, heightCm, age, sex, 'mifflin'));
  figures.BMR_kat = Math.round(bmrKcal(bodyMassKg, heightCm, age, sex, 'katch'));

  const plain = figures[BMR_EQUATION_KEYS[bmrFormula()]];
  const firstWeighIn = physiqueFirstWeighInDate();
  if (plain !== undefined && firstWeighIn) {
    const daysOnDiet = Math.max(0, Math.round((parseIsoDateUTC(date) - parseIsoDateUTC(firstWeighIn)) / 86400000));
    const fraction = adaptationFraction(daysOnDiet,
      getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT),
      getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT));
    figures.BMR_adp = Math.round(plain * (1 - fraction));
  }
  return figures;
}

// The active equation's BMR plus the offset Calibrate measures over the n_p × L_p
// days ending the day before `date`. Undefined inside the first n_p × L_p days of
// data, or when that window has too little logged.
function physiqueCalibratedBmr(date, plainBmr) {
  if (plainBmr === undefined) return undefined;
  const periodCount = getSetting(BMR_CALIBRATION_PERIOD_COUNT_KEY, BMR_CALIBRATION_PERIOD_COUNT_DEFAULT);
  const periodDays = getSetting(BMR_CALIBRATION_PERIOD_DAYS_KEY, BMR_CALIBRATION_PERIOD_DAYS_DEFAULT);
  const firstDate = physiqueDatedAscending()[0]?.date;
  if (!firstDate) return undefined;
  const daysOfData = Math.round((parseIsoDateUTC(date) - parseIsoDateUTC(firstDate)) / 86400000);
  if (daysOfData < periodCount * periodDays) return undefined;
  const result = computeBmrCalibration(null, periodDays, isoDatePlusDays(date, -1), periodCount);
  return result.ok ? Math.round(plainBmr + result.offsetKcal) : undefined;
}

// All four figures for a day, computed fresh. `bodyMassKg` overrides the
// carried-forward mass (a day being saved with its own new weigh-in).
function computePhysiqueBmrFigures(date, bodyMassKg = physiqueBodyMassAsOf(date)) {
  const figures = physiqueBaseBmrFigures(date, bodyMassKg);
  const calibrated = physiqueCalibratedBmr(date, figures[BMR_EQUATION_KEYS[bmrFormula()]]);
  if (calibrated !== undefined) figures.BMR_cal = calibrated;
  return figures;
}

// A day's figures as stored on its row (or the latest earlier row). Days not
// stored yet are computed, without BMR_cal — that needs the stored history.
function bmrFiguresForDate(date) {
  if (bmrFiguresCache.has(date)) return bmrFiguresCache.get(date);
  const stored = ignoreStoredBmr ? null : physiqueRowAsOf(date)?.bmr;
  const figures = stored && Object.keys(stored).length
    ? stored
    : physiqueBaseBmrFigures(date, physiqueBodyMassAsOf(date));
  bmrFiguresCache.set(date, figures);
  return figures;
}

// One figure from a day's set for `basis` ('bmr', 'bmr_cal', 'bmr_adp'). Plain
// BMR stands in for a missing BMR_cal/BMR_adp, as before. Null without a profile.
function pickBmrForBasis(figures, basis = bmrBasis()) {
  const plain = figures[BMR_EQUATION_KEYS[bmrFormula()]];
  if (plain === undefined) return null;
  if (basis === 'bmr_adp') return figures.BMR_adp ?? plain;
  if (basis === 'bmr_cal') return figures.BMR_cal ?? plain;
  return plain;
}

function storedBmrForDate(date, basis = bmrBasis()) {
  return pickBmrForBasis(bmrFiguresForDate(date), basis);
}

// A day's SD off its own TEI, AEE, TEF and stored BMR — the same
// dailyEnergyBalanceKcal the Status card uses. Null without a BMR, TEI or sleep.
function physiqueDeprivationKcal(day, sleepHours, bmrFigures) {
  const maintenance = pickBmrForBasis(bmrFigures);
  if (maintenance === null || day.caloriesIn === null || sleepHours === null) return null;
  return dailyEnergyBalanceKcal(
    day.caloriesIn,
    maintenance,
    day.caloriesOut ?? 0,
    day.tef !== null ? day.tef : Math.round(day.caloriesIn * (1 - tefDivisor())),
    sleepHours,
    getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT),
  ).deprivationKcal;
}

// The BMR figures a save stores for `date`: its own weigh-in, else the latest earlier one.
// Only a changed Body Mass recomputes a stored day; otherwise its cell is kept as is.
function physiqueBmrForSave(date, bodyMassKg) {
  if (!date) return {};
  const saved = allPhysiqueEntries.find((p) => p.date && p.date === date);
  if (saved?.bmr && (saved.bodyMass ?? null) === (bodyMassKg ?? null)) return { ...saved.bmr };
  const bmr = computePhysiqueBmrFigures(date, bodyMassKg ?? physiqueBodyMassAsOf(isoDatePlusDays(date, -1)));
  // A BMR_cal already stored for this date is kept as is (only a settings change rewrites it).
  if (saved?.bmr?.BMR_cal !== undefined) bmr.BMR_cal = saved.bmr.BMR_cal;
  return bmr;
}

// Sleep, BMR and Deprivation as stored — computed here, once per save.
function physiqueDerivedFigures(day) {
  const sleep = physiqueSleepHours(day);
  const bmr = physiqueBmrForSave(day.date, day.bodyMass);
  return { sleep, bmr, deprivation: physiqueDeprivationKcal(day, sleep, bmr) };
}

const BMR_JSON_ORDER = ['BMR_mif', 'BMR_kat', 'BMR_cal', 'BMR_adp'];

function physiqueCellValue(key, value) {
  if (key !== 'bmr') return value ?? '';
  const present = BMR_JSON_ORDER.filter((k) => value?.[k] !== undefined);
  return present.length ? JSON.stringify(Object.fromEntries(present.map((k) => [k, value[k]]))) : '';
}

// A day's cells in the sheet's own column order. Unknown columns keep what
// was read; Sleep/BMR/Deprivation are recomputed from the day's other fields.
function physiqueRowCells(day) {
  const values = { ...day, ...physiqueDerivedFigures(day) };
  const cells = [...(day.cells || [])];
  PHYSIQUE_COLUMNS.forEach(({ key }) => {
    const i = physiqueColumnIndex[key];
    if (i === undefined) return;
    while (cells.length < i) cells.push('');
    cells[i] = physiqueCellValue(key, values[key]);
  });
  return cells;
}

async function writePhysiqueRow(row, day) {
  const cells = physiqueRowCells(day);
  await updateValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A${row}:${physiqueColumnLetter(cells.length - 1)}${row}`, [cells]);
}

async function appendPhysiqueRow(day) {
  const cells = physiqueRowCells(day);
  await appendValues(`'${CONFIG.SHEETS.PHYSIQUE}'!A:${physiqueColumnLetter(cells.length - 1)}`, [cells]);
}

// "row:key" cells the backfill has written this session, so a second load racing
// the first write can't send the same cells again.
const physiqueBackfilledCells = new Set();

function physiqueCellUpdate(key, row, value) {
  const ref = `${physiqueColumnLetter(physiqueColumnIndex[key])}${row}`;
  return { range: `'${CONFIG.SHEETS.PHYSIQUE}'!${ref}`, values: [[physiqueCellValue(key, value)]] };
}

// Writes `data` in one request and reloads; one run at a time. False on failure.
let physiqueBatchRunning = false;
async function runPhysiqueBatch(data, label) {
  if (!data.length) return true;
  physiqueBatchRunning = true;
  try {
    await batchUpdateValues(data);
    console.info(`[physique] ${label}: ${data.length} cells`);
    await refreshPhysique(true);
    return true;
  } catch (err) {
    console.error(`Physique ${label} failed:`, err);
    return false;
  } finally {
    physiqueBatchRunning = false;
  }
}

// One-off fill for days saved before Sleep/BMR/Deprivation were stored: blank
// cells only, oldest day first, in one request. Nothing to do once all are filled.
async function backfillPhysiqueDerivedFigures() {
  if (physiqueBatchRunning) return;
  const has = (key) => physiqueColumnIndex[key] !== undefined;
  const data = [];
  physiqueDatedAscending().forEach((p) => {
    const sleep = p.sleep ?? physiqueSleepHours(p);
    if (has('sleep') && p.sleep === null && sleep !== null) data.push(physiqueCellUpdate('sleep', p.row, sleep));

    let figures = p.bmr;
    if (has('bmr') && !figures) {
      figures = computePhysiqueBmrFigures(p.date);
      if (Object.keys(figures).length) data.push(physiqueCellUpdate('bmr', p.row, figures));
    } else if (has('bmr') && figures.BMR_cal === undefined) {
      // A day that now has enough history gets its BMR_cal once, then keeps it.
      const calibrated = physiqueCalibratedBmr(p.date, figures[BMR_EQUATION_KEYS[bmrFormula()]]);
      if (calibrated !== undefined) {
        figures = { ...figures, BMR_cal: calibrated };
        data.push(physiqueCellUpdate('bmr', p.row, figures));
      }
    }
    if (has('deprivation') && p.deprivation === null) {
      const deprivation = physiqueDeprivationKcal(p, sleep, figures || bmrFiguresForDate(p.date));
      if (deprivation !== null) data.push(physiqueCellUpdate('deprivation', p.row, deprivation));
    }
  });
  const fresh = data.filter((d) => !physiqueBackfilledCells.has(d.range));
  fresh.forEach((d) => physiqueBackfilledCells.add(d.range));
  await runPhysiqueBatch(fresh, 'stored missing Sleep/BMR/Deprivation');
}

// One-off rewrite of saved Breakdown amounts still in units ("×1") into grams, from
// each food's Nutrition row (breakdownAmountInGrams). Needs Nutrition loaded, so
// app.js runs it once both tabs are in. Foods whose row gives no weight keep "×N".
async function convertPhysiqueBreakdownAmountsToGrams() {
  if (physiqueBatchRunning || physiqueColumnIndex.breakdown === undefined) return;
  const data = [];
  allPhysiqueEntries.forEach((p) => {
    let changed = false;
    const items = parsePhysiqueBreakdown(p.breakdown).map((item) => {
      const grams = breakdownAmountInGrams(item.name, item.amount);
      if (grams === null) return item;
      changed = true;
      return { ...item, amount: grams };
    });
    if (changed) data.push(physiqueCellUpdate('breakdown', p.row, breakdownToJson(items)));
  });
  const fresh = data.filter((d) => !physiqueBackfilledCells.has(d.range));
  fresh.forEach((d) => physiqueBackfilledCells.add(d.range));
  await runPhysiqueBatch(fresh, 'converted Breakdown amounts to grams');
}

// Settings that change a stored BMR or Deprivation.
const PHYSIQUE_BMR_SETTING_KEYS = ['HEIGHT_CM', 'BIRTH_DATE', 'SEX', BMR_FORMULA_KEY, BMR_BASIS_KEY,
  ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_CAP_KEY, BMR_CALIBRATION_PERIOD_COUNT_KEY,
  BMR_CALIBRATION_PERIOD_DAYS_KEY, 'SLEEP_TARGET_HOURS', TEF_PERCENT_KEY];

// Rewrites every day's BMR and Deprivation, in one request, when a saved setting
// they depend on changed (saveSettingValues / submitSettingForm, settings-panel.js).
// `force` skips the changed-keys check (Calibrate's Update). Resolves to the
// number of days rewritten, or null when the write failed.
async function recomputeStoredPhysiqueBmr(changedKeys, { force = false } = {}) {
  if (!physiqueDataLoaded || physiqueBatchRunning) return 0;
  if (!force && !changedKeys.some((key) => PHYSIQUE_BMR_SETTING_KEYS.includes(key))) return 0;
  if (physiqueColumnIndex.bmr === undefined && physiqueColumnIndex.deprivation === undefined) return 0;

  ignoreStoredBmr = true;
  bmrFiguresCache = new Map();
  const data = [];
  try {
    physiqueDatedAscending().forEach((p) => {
      const figures = computePhysiqueBmrFigures(p.date);
      if (physiqueColumnIndex.bmr !== undefined) data.push(physiqueCellUpdate('bmr', p.row, figures));
      if (physiqueColumnIndex.deprivation !== undefined) {
        data.push(physiqueCellUpdate('deprivation', p.row,
          physiqueDeprivationKcal(p, p.sleep ?? physiqueSleepHours(p), figures)));
      }
    });
  } finally {
    ignoreStoredBmr = false;
    bmrFiguresCache = new Map();
  }
  const ok = await runPhysiqueBatch(data, 'recomputed BMR/Deprivation');
  return ok ? physiqueDatedAscending().length : null;
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

// Patterns always sort to the top of getFilteredPhysiqueEntries() and never
// count against a page's P_PAGE_SIZE dated days — a template isn't a day, and
// there's usually only a handful of them, so hiding one behind pagination
// would bury a row meant to always be at hand. Shared by the render and the
// header select-all checkbox so both agree on exactly what's on the page.
function getPhysiquePageEntries() {
  const entries = getFilteredPhysiqueEntries();
  const patterns = entries.filter((p) => !p.date);
  const dated = entries.filter((p) => p.date);

  const totalPages = Math.max(1, Math.ceil(dated.length / P_PAGE_SIZE));
  pCurrentPage = Math.min(pCurrentPage, totalPages);

  const start = (pCurrentPage - 1) * P_PAGE_SIZE;
  return { pageEntries: [...patterns, ...dated.slice(start, start + P_PAGE_SIZE)], totalPages };
}

function renderPhysiqueList() {
  const tbody = document.getElementById('physique-body');
  tbody.innerHTML = '';

  const { pageEntries, totalPages } = getPhysiquePageEntries();

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

  pageEntries.forEach((p, i) => {
    const tr = document.createElement('tr');
    // Pattern rows carry no date, so they never match.
    if (p.date === todayIso) tr.classList.add('today-row');
    // One line per week, same idea as Work Time's weekend tint but a border
    // instead. Newest-first, a Mon-Sun week reads top to bottom as Sun, Sat,
    // ... Mon — so the line has to land on the SUNDAY row (top of the older
    // week), not Monday: that's what puts it between this week's Monday
    // (the row just above, oldest day of the more recent week) and the older
    // week's Sunday, instead of slicing a week in half. T00:00:00 keeps the
    // parse in the local timezone, same reasoning as timesheet.js's
    // dateFromIso.
    const isWeekBoundary = p.date && new Date(`${p.date}T00:00:00`).getDay() === 0;
    // Same line, on the first actual day after the pattern rows: patterns
    // always sort to the top regardless of column/direction (see the
    // comparator above), so this is just "has a date, the row before it
    // didn't" — no separate pass over the list needed.
    const afterPatterns = p.date && i > 0 && !pageEntries[i - 1].date;
    if (isWeekBoundary || afterPatterns) tr.classList.add('physique-week-start');

    const num = (value) => {
      if (value === null) return '—';
      return privacyMode ? maskDigits(String(value)) : String(value);
    };
    const int = (value) => {
      if (value === null) return '—';
      const s = String(Math.round(value));
      return privacyMode ? maskDigits(s) : s;
    };
    // The stored figures; computed here only for a day not yet saved with them.
    const sleepHours = p.sleep ?? physiqueSleepHours(p);
    // Wake minus bed, not the two clock times — those still open on Edit
    // (the form's own Bedtime/Wake-up Time fields), same as every other
    // computed table figure that keeps its raw inputs one click away rather
    // than in the table itself.
    const sleepTitle = sleepHours !== null
      ? `${sleepHours} hr of sleep (${p.bedtime} → ${p.wakeTime}) — open Edit to change the clock times`
      : '';
    const maskedSleepTitle = privacyMode ? maskDigits(sleepTitle) : sleepTitle;

    const deprivationKcal = p.deprivation ?? physiqueDeprivationKcal(p, sleepHours, p.date ? bmrFiguresForDate(p.date) : {});
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
      makeCell(int(p.proteinIn)),
      makeCell(int(p.fiber)),
      makeCell(int(p.fat)),
      makeCell(int(p.carbohydrate)),
      makeCell(num(p.tef), p.tef !== null
        ? undefined
        : 'Not calculated yet — select this day and click TEF below (needs 🧬 Micronutrients pulled for its ingredients)'),
      makeCell(num(p.duration)),
      makeCell(num(p.caloriesOut)),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => {
        routeRecordEdit('physique', physiqueRouteStep(p));
        openPhysiqueForm(p);
      } }),
      // How a pattern becomes a real day: duplicate it, and the copy opens
      // dated today with the template's contents intact.
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => openPhysiqueForm(p, true) }),
      makeRowActionButton({ emoji: '🧬', title: 'Micronutrients', onClick: () => openPhysiqueMicronutrients(p, true) }),
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
// `routed`: give it the day's address (…/<date>/micronutrients/) as it opens.
function openPhysiqueMicronutrients(p, routed = false) {
  if (routed) routeRecordEdit('physique', physiqueRouteStep(p), { slug: 'micronutrients', label: 'Micronutrients' });
  document.getElementById('physique-micro-title').textContent = formTitleWithDate('Micronutrients', p.date);

  // A Pattern has no date to look up, so it reads its own Breakdown.
  const data = p.date
    ? aggregateMicronutrientIntake(p.date, p.date)
    : aggregateMicronutrientIntake(null, null, [parsePhysiqueBreakdown(p.breakdown)]);

  const tbody = document.getElementById('physique-micro-body');
  tbody.innerHTML = '';

  if (data.nutrients.length === 0) {
    tbody.appendChild(renderEmptyRow(3, 'Nothing to show — see the coverage note above.'));
  } else {
    data.nutrients.forEach((n, i) => {
      const tr = document.createElement('tr');
      if (n.severity === 'severe') tr.classList.add('nutrient-gap-severe');
      else if (n.severity === 'mild') tr.classList.add('nutrient-gap-mild');
      if (nutrientSectionEnd(data.nutrients, i)) tr.classList.add('nutrient-facts-end');
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

// Form field id suffix → entry property. Where each lands on the sheet is
// PHYSIQUE_COLUMNS' job, not this list's order.
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

// A copy of a day to change fields on and pass to writePhysiqueRow — also what
// an undo writes straight back.
function physiqueDayCopy(p) {
  return { ...p };
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

  // An edit keeps the row's other cells (columns this app doesn't know about).
  const editing = allPhysiqueEntries.find((p) => p.row === editingPhysiqueRow);
  const day = { cells: editing ? editing.cells : [] };
  for (const { id, key, numeric } of PHYSIQUE_FIELDS) {
    const raw = (isPattern && id === 'date') ? '' : physiqueField(id).value.trim();
    if (!numeric) {
      day[key] = raw;
      continue;
    }
    const evaluated = raw ? evaluateNumberExpression(raw) : null;
    if (raw && evaluated === null) {
      const label = physiqueField(id).closest('label').firstChild.textContent.trim();
      showFieldError('physique-form-error', `${label} must be a number (e.g. 94 or 30+15).`);
      return;
    }
    day[key] = evaluated;
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
  const { date } = day;
  const clash = !isPattern && allPhysiqueEntries.find((p) => p.date === date && p.row !== editingPhysiqueRow);
  if (clash) {
    mergePhysiqueEntryIntoForm(clash);
    return;
  }

  try {
    if (editingPhysiqueRow !== null) {
      await writePhysiqueRow(editingPhysiqueRow, day);
    } else {
      await appendPhysiqueRow(day);
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

// A day with its derived fields recalculated.
async function recalculatePhysiqueDay(p, bodyMassKg) {
  const day = physiqueDayCopy(p);

  if (p.consumption.trim()) {
    const { calories, protein, breakdown } =
      await estimateConsumptionIncrementally(p.consumption, p.breakdown);
    // Annotates each matched row with fiber/fat/carbohydrate/tef before the
    // JSON is stringified, so Breakdown carries them too, not just their own columns.
    // Only overwritten when measurable — leaves an unpriced day's existing
    // cells (blank, or a manual/earlier figure) alone rather than blanking them.
    const tef = estimateTefBreakdown(breakdown);
    const dayMacros = sumBreakdownMacros(breakdown);
    if (dayMacros.fiber !== null) day.fiber = dayMacros.fiber;
    if (dayMacros.fat !== null) day.fat = dayMacros.fat;
    if (dayMacros.carbohydrate !== null) day.carbohydrate = dayMacros.carbohydrate;
    if (tef) day.tef = tef.tefKcal;
    day.consumption = breakdown.map((i) => i.noteLine || `${i.amount} ${i.name}`).join('\n');
    day.breakdown = breakdownToJson(breakdown);
    day.caloriesIn = calories;
    day.proteinIn = protein;
  }

  if (p.workout.trim() && bodyMassKg !== null) {
    // Same combine + highest-burn-first sort the form's own Calculate button
    // runs (runPhysiqueWorkoutCalc/combineWorkoutText) — bulk Calculate
    // rewrites Workout too, not just the Duration/AEE it already
    // wrote, so a repeated exercise logged across several lines collapses
    // here the same way it would through the form.
    const { text: combinedWorkout } = combineWorkoutText(p.workout);
    const { minutes, calories, perLine } = estimateWorkoutActivity(combinedWorkout, bodyMassKg);
    const sortedPerLine = [...perLine].sort((a, b) => b.calories - a.calories);
    day.workout = sortedPerLine.map((line) => `${line.quantity} ${line.name}`).join('\n');
    day.duration = minutes;
    day.caloriesOut = calories;
  }

  return day;
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

  const snapshots = eligible.map((p) => ({ row: p.row, values: physiqueDayCopy(p) }));

  let done = 0;
  const succeeded = [];
  const results = await Promise.allSettled(eligible.map(async (p, i) => {
    try {
      const day = await recalculatePhysiqueDay(p, p.bodyMass ?? latestBodyMassKg);
      await writePhysiqueRow(p.row, day);
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

// Each row still exists, so undo is one write per row rather than a
// re-insert. `values` is the day as it was (physiqueDayCopy).
async function restorePhysiqueSnapshots(snapshots) {
  try {
    await Promise.all(snapshots.map((s) => writePhysiqueRow(s.row, s.values)));
    await refreshPhysique(true);
  } catch (err) {
    alert(`Failed to restore: ${err.message}`);
  }
}

// A row's address step: its date, or pattern-<n> by sheet order for a Pattern.
function todayPhysiqueRouteStep() {
  const today = isoFromDate(new Date());
  return { slug: today, label: today };
}

function physiqueRouteStep(entry) {
  if (entry.date) return { slug: entry.date, label: entry.date };
  const n = allPhysiqueEntries.filter((e) => !e.date).indexOf(entry) + 1;
  return { slug: `pattern-${n}`, label: `Pattern ${n}` };
}

function physiquePatternLabel(entry) {
  const snippet = (text) => {
    const first = text.split('\n')[0].trim();
    return first.length > 45 ? first.slice(0, 45) + '…' : first;
  };
  const parts = [];
  if (entry.consumption) parts.push(`Consumption: "${snippet(entry.consumption)}"`);
  if (entry.workout)     parts.push(`Workout: "${snippet(entry.workout)}"`);
  if (entry.bodyMass !== null)  parts.push(`Body Mass: ${entry.bodyMass}`);
  if (entry.caloriesIn !== null) parts.push(`Cal In: ${entry.caloriesIn}`);
  return parts.length ? parts.join(' · ') : 'no details';
}

async function deletePhysiqueEntry(entry) {
  const label = entry.date
    ? `the logged day for ${entry.date}`
    : `pattern (${physiquePatternLabel(entry)})`;
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
