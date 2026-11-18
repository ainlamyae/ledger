﻿// One row per day: sleep, body mass, what was eaten and burned. Charts, tiles,
// Insight and the Activity Plan read it through physiqueAsHealthEntries().

// Read with its header row, so columns are found by name, not position.
const PHYSIQUE_RANGE = sheetRange(CONFIG.SHEETS.PHYSIQUE, 'A1:ZZ');

// Sheet columns by header: current name first, then older ones. This order is
// the fallback when there's no header row.
const PHYSIQUE_COLUMNS = [
  { key: 'date', headers: ['Date'] },
  { key: 'bodyMass', headers: ['Body Mass'] },
  // JSON of the day's BMR figures and body-mass figures (see "Stored BMR" / "Stored body mass").
  { key: 'bmr', headers: ['Derived', 'BMR'] },
  { key: 'bedtime', headers: ['Bed', 'Bedtime'] },
  { key: 'wakeTime', headers: ['Wake', 'Wake-up Time'] },
  // Written on every save (physiqueRowValues), not recomputed per render.
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

function hasPhysiqueColumn(key) {
  return physiqueColumnIndex[key] !== undefined;
}

// 4 weeks of dated days per page; patterns show on every page (getPhysiquePageEntries).
const P_PAGE_SIZE = 28;
// The list table's column count, for its empty-state row.
const PHYSIQUE_TABLE_COLUMNS = 14;
const PHYSIQUE_DAY_MS = 86400000;
const MINUTES_PER_DAY = 1440;
const GRAMS_PER_KG = 1000;

let allPhysiqueEntries = [];
// True once refreshPhysique has run, so "still loading" differs from "nothing logged".
let physiqueDataLoaded = false;
// Memoized physiqueAsHealthEntries() result, dropped on every refresh.
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

// Time cells arrive in the column's own format ("23:30", "23:30:00", "11:30:00 PM").
// Normalized to the HH:MM an <input type="time"> wants; anything else is left alone.
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

// A sheet cell as a number, or null. Not "numberCell": finance-portfolio.js owns that name.
function physiqueNumber(value) {
  return (value !== undefined && value !== '' && !Number.isNaN(Number(value))) ? Number(value) : null;
}

// "HH:MM" (1 or 2-digit hour) -> minutes since midnight, or null if malformed.
function parseClockTime(str) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(str).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatClockTime24(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// Hours from bed to wake; wake <= bed means it was the next calendar day.
function sleepDurationHours(bedMin, wakeMin) {
  const diff = wakeMin <= bedMin ? wakeMin + MINUTES_PER_DAY - bedMin : wakeMin - bedMin;
  return Math.round((diff / 60) * 10) / 10;
}

// Live read-out as Bed/Wake are typed (like updateWorkTimeLiveDuration).
function updatePhysiqueSleepDuration() {
  return updatePhysiqueSleepDeprivation(physiqueSleepHours({
    bedtime: physiqueField('bedtime').value,
    wakeTime: physiqueField('wake-time').value,
  }));
}

// The form's live energy table: the Status card's figures (setStatusEnergyTile)
// off the typed fields, so a short night's cost shows before Save. Blank where an
// input is missing. Returns D and its desire, for the save's warning.
function updatePhysiqueSleepDeprivation(sleepHours) {
  const el = document.getElementById('physique-sleep-deprivation');
  if (!el) return null;

  // The derivation Save stores (physiqueDerivedFigures), off the typed fields.
  const read = (id) => evaluateNumberExpression(physiqueField(id).value.trim());
  const intake = read('calories-in');
  const day = {
    date: physiqueField('date').value || localIso(),
    bodyMass: read('body-mass') || null,
    caloriesIn: intake ? Math.round(intake) : null,
    caloriesOut: read('calories-out') || 0,
    tef: read('tef') || null,
  };
  const isPattern = document.getElementById('physique-is-pattern').checked;
  // A pattern has no date, so no BMR.
  const bmr = isPattern ? {} : physiqueBmrForSave(day.date, day.bodyMass);
  // No Bed/Wake yet: SD = 0, so D and Δm′ still show.
  const energy = physiqueEnergyBalance(day, sleepHours, bmr, { sleepOptional: true });
  el.textContent = energy ? `${energy.deprivationKcal}` : sleepHours === null ? '0' : '';

  // Blank for null/undefined; digits masked in privacy mode.
  const show = (id, value) => setMaskedText(id, value !== null && value !== undefined ? `${value}` : '');

  // TEF and AEE are expenditures, so shown negative like the Status card's rows.
  show('physique-tei', day.caloriesIn);
  // Needs only intake, not the sleep times D does.
  const tefKcal = energy ? energy.tef : day.tef ?? (day.caloriesIn !== null ? Math.round(day.caloriesIn * (1 - tefDivisor())) : null);
  show('physique-tef-derived', tefKcal !== null ? -tefKcal : null);
  show('physique-aee', `${day.caloriesOut > 0 ? '-' : ''}${day.caloriesOut}`);

  // D (Balance) and Δm′, the mass change it implies in g/day.
  const deltaMassPrimeG = energy ? Math.round((energy.balance / GENERIC_KCAL_PER_KG_FAT) * GRAMS_PER_KG) : null;
  show('physique-balance', energy ? energy.balance : null);
  show('physique-mass-delta-prime', deltaMassPrimeG);

  // The Mass figures Save will store (the saved ones while Body Mass is unchanged).
  const mass = isPattern ? {} : physiqueMassForSave(day.date, day.bodyMass);
  const showsMassDelta = mass.m_d !== undefined && !massChangeStoredInGrams(mass);
  [
    ['mass-reading', day.bodyMass ?? undefined],
    ['mass-mean', mass.m_avg],
    ['mass-delta', showsMassDelta ? mass.m_d : undefined],
    ['mass-bmi', mass.BMI],
  ].forEach(([id, value]) => setMaskedText(`physique-${id}`, value !== undefined ? `${value}` : ''));

  // Only the Tune's picked BMR row shows; negative, as an expenditure.
  const shownBmrKey = selectedBmrKey(bmr);
  BMR_JSON_ORDER.forEach((key) => {
    const id = `physique-bmr-${key.replace('BMR_', '')}`;
    setMaskedText(id, bmr[key] !== undefined ? `${-bmr[key]}` : '');
    document.getElementById(id).parentElement.hidden = key !== shownBmrKey;
  });

  // M = BMR + AEE, signed as expenditure.
  const bmrShown = bmr[shownBmrKey];
  const maintenanceKcal = bmrShown !== undefined ? -Math.round(bmrShown + day.caloriesOut) : null;
  show('physique-maintenance', maintenanceKcal);

  // The day's macros off its breakdown, floored as the Intake Macros card does.
  const breakdown = parsePhysiqueBreakdown(document.getElementById('physique-breakdown').value);
  const macroG = {};
  [['protein', 'protein'], ['fiber', 'fiber'], ['fat', 'fat'], ['carb', 'carbohydrate']].forEach(([id, key]) => {
    const rows = breakdown.filter((r) => Number.isFinite(r[key]));
    if (rows.length) macroG[id] = Math.floor(rows.reduce((sum, r) => sum + r[key], 0));
    show(`physique-macro-${id}`, rows.length ? macroG[id] : null);
  });

  // Desire: the plan figure each row is read against (as setStatusEnergyTile pairs
  // them). Moves with Body Mass only, not with Calories In/Out.
  const heightCm = getSetting('HEIGHT_CM', null);
  const healthyMassKg = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  const healthEntries = physiqueAsHealthEntries();
  const planMassKg = planBodyMassKg(healthEntries);
  const calDesired = getCalorieDesired(healthEntries);
  const digDesired = Math.round(calDesired.kcal * (1 - tefDivisor()));
  // At the latest reading on or before the day when it has none of its own.
  const actMassKg = day.bodyMass ?? physiqueBodyMassAsOf(day.date);
  const actDesiredKcal = actMassKg !== null ? Math.round(getActivityDesiredKcal(actMassKg)) : null;
  const weeklyFatLossKg = weeklyFatLossKgAt(planMassKg);
  const desiredKgPerDay = weeklyFatLossKg !== null ? Math.round((-weeklyFatLossKg / 7) * 1000) / 1000 : null;
  const desiredGPerDay = weeklyFatLossKg !== null ? Math.round((-weeklyFatLossKg / 7) * GRAMS_PER_KG) : null;
  const bmiDesired = heightCm !== null ? computeBmi(healthyMassKg, heightCm) : null;

  // The healthy mass ± glycogen swing, as the Progress meter shows it.
  const swingKg = glycogenSwingKg(day.bodyMass, heightCm, getSettingString('SEX', null));
  show('physique-mass-reading-desire', swingKg === null ? healthyMassKg : `${healthyMassKg} ± ${Math.round(swingKg * 10) / 10}`);
  show('physique-mass-mean-desire', healthyMassKg);
  show('physique-mass-delta-desire', desiredKgPerDay);
  show('physique-mass-bmi-desire', bmiDesired);
  const bands = {
    protein: getProteinDesiredBandG(healthEntries),
    fiber: getFiberDesiredBandG(healthEntries),
    fat: getFatDesiredBandG(healthEntries),
    carb: getCarbDesiredBandG(healthEntries),
  };
  Object.entries(bands).forEach(([id, band]) => show(`physique-macro-${id}-desire`, formatProteinDesiredBand(band)));
  show('physique-tei-desire', calDesired.kcal);
  show('physique-tef-desire', -digDesired);
  show('physique-aee-desire', actDesiredKcal !== null ? -actDesiredKcal : null);
  show('physique-sleep-deprivation-desire', 0);
  const mDesired = bmrShown !== undefined && actDesiredKcal !== null ? -Math.round(bmrShown + actDesiredKcal) : null;
  show('physique-maintenance-desire', mDesired);
  const balanceDesired = desiredBalanceKcal(planMassKg);
  show('physique-balance-desire', balanceDesired);
  show('physique-mass-delta-prime-desire', desiredGPerDay);

  // Remain = Desire − Amount (a band's floor for macros); blank once Amount is past Desire.
  // `dir` is the way Amount moves toward Desire (+1 up, −1 down; kcal out are negative).
  const downward = bodyMassHealthyIsDownward(healthEntries);
  const massDir = downward ? -1 : 1;
  const rateDir = (desire) => Math.sign(desire || 0) || massDir;
  const sdKcal = energy ? energy.deprivationKcal : sleepHours === null ? 0 : null;
  const known = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
  [
    ['mass-reading', day.bodyMass, healthyMassKg, 1, massDir],
    ['mass-mean', mass.m_avg, healthyMassKg, 1, massDir],
    ['mass-delta', showsMassDelta ? mass.m_d : null, desiredKgPerDay, 3, rateDir(desiredKgPerDay)],
    ['mass-bmi', mass.BMI, bmiDesired, 1, massDir],
    ...Object.entries(bands).map(([id, band]) => [`macro-${id}`, macroG[id], band.min, 0, 1]),
    ['tei', day.caloriesIn, calDesired.kcal, 0, 1],
    ['tef-derived', tefKcal !== null ? -tefKcal : null, -digDesired, 0, massDir],
    ['aee', -day.caloriesOut, actDesiredKcal !== null ? -actDesiredKcal : null, 0, -1],
    ['sleep-deprivation', sdKcal, 0, 0, -1],
    ['maintenance', maintenanceKcal, mDesired, 0, -1],
    ['balance', energy ? energy.balance : null, balanceDesired, 0, rateDir(balanceDesired)],
    ['mass-delta-prime', deltaMassPrimeG, desiredGPerDay, 0, rateDir(desiredGPerDay)],
  ].forEach(([id, amount, desire, digits, dir]) => {
    const scale = 10 ** digits;
    const passed = known(amount) && known(desire) && dir * (amount - desire) > 0;
    show(`physique-${id}-remain`, known(amount) && known(desire) && !passed ? Math.round((desire - amount) * scale) / scale : null);
  });

  // Amount green/red by the Status and Intake Macros cards' rules (health-chart.js).
  const towardHealthy = (v, healthy) => (downward ? v <= healthy : v >= healthy);
  const bandTone = (g, band, within) => (within(g, band) || g > band.max ? 'income' : 'expense');
  const isCut = getCalorieDesiredKind(healthEntries) === 'max';
  const carbTone = (g) => (withinCarbBand(g, bands.carb) ? 'income' : g > bands.carb.max ? 'expense' : 'neutral');
  const balanceGood = energy ? (balanceDesired !== null
    ? (isCut ? energy.balance <= balanceDesired : energy.balance >= balanceDesired)
    : (isCut ? energy.balance < 0 : energy.balance > 0)) : null;
  // BMR: the calibrated BMR above the mean of Mifflin-St Jeor and Katch-McArdle.
  const bmrGood = [bmr.BMR_cal, bmr.BMR_mif, bmr.BMR_kat].every(Number.isFinite)
    ? bmr.BMR_cal > (bmr.BMR_mif + bmr.BMR_kat) / 2 : null;
  [
    ['mass-reading', day.bodyMass !== null ? towardHealthy(day.bodyMass, healthyMassKg) : null],
    ['mass-mean', mass.m_avg !== undefined ? towardHealthy(mass.m_avg, healthyMassKg) : null],
    ['mass-delta', showsMassDelta && mass.m_d !== 0 ? (downward ? mass.m_d < 0 : mass.m_d > 0) : null],
    ['mass-bmi', mass.BMI !== undefined && bmiDesired !== null ? towardHealthy(mass.BMI, bmiDesired) : null],
    ['macro-protein', macroG.protein !== undefined ? bandTone(macroG.protein, bands.protein, withinProteinBand) : null],
    ['macro-fiber', macroG.fiber !== undefined ? bandTone(macroG.fiber, bands.fiber, withinFiberBand) : null],
    ['macro-fat', macroG.fat !== undefined ? bandTone(macroG.fat, bands.fat, withinFatBand) : null],
    ['macro-carb', macroG.carb !== undefined ? carbTone(macroG.carb) : null],
    ['tei', day.caloriesIn !== null ? withinCalorieDesired(day.caloriesIn, calDesired) : null],
    // TEF past its desire toward the mass goal (more when losing); M at least its desire (AEE's test).
    ['tef-derived', tefKcal !== null ? (downward ? tefKcal >= digDesired : tefKcal <= digDesired) : null],
    ['aee', actDesiredKcal !== null ? day.caloriesOut >= actDesiredKcal : null],
    ['sleep-deprivation', sdKcal !== null ? sdKcal <= 0 : null],
    ...BMR_JSON_ORDER.map((key) => [`bmr-${key.replace('BMR_', '')}`, bmrGood]),
    ['maintenance', bmrShown !== undefined && actDesiredKcal !== null ? day.caloriesOut >= actDesiredKcal : null],
    ['balance', balanceGood],
    // Δm′ is D in grams, so it reads as D does.
    ['mass-delta-prime', balanceGood],
  ].forEach(([id, good]) => {
    const cell = document.getElementById(`physique-${id}`);
    cell.classList.remove('income', 'expense', 'neutral');
    const tone = good === null ? null : typeof good === 'string' ? good : good ? 'income' : 'expense';
    if (tone) cell.classList.add(tone);
    // The row's last cell: ✅ for green, ❌ otherwise (Carb under its band too).
    cell.parentElement.lastElementChild.textContent = tone === 'income' ? '✅' : tone ? '❌' : '';
  });
  return { balance: energy ? energy.balance : null, balanceDesired };
}

// The activity categories physiqueAsHealthEntries emits, which every activity consumer filters on.
function isActivityCategory(category) {
  return category === 'Activity' || category === 'Activity; Calories';
}

// Back to `page` with nothing selected.
function showPhysiquePage(page) {
  pCurrentPage = page;
  selectedPhysiqueRows.clear();
  renderPhysiqueList();
}

async function initPhysique(forceRefresh = false) {
  if (!physiqueListenersAttached) {
    physiqueListenersAttached = true;

    document.getElementById('add-physique-btn').addEventListener('click', () => openPhysiqueForm(null));
    // Today's address is its date, logged yet or not.
    document.getElementById('today-physique-btn').addEventListener('click', () => {
      routeRecordEdit('physique', todayPhysiqueRouteStep());
      openPhysiqueForm(todaysPhysiqueDay());
    });
    // health/physique/<date or pattern-N>/ opens that row's Edit, with …/micronutrients/
    // and …/duplicate/ below it. Today's date (or the old …/today/) opens a new Log
    // while today isn't logged.
    registerRecordRoute('physique', (slug, sub) => {
      const today = todayPhysiqueRouteStep();
      if (!sub && (slug === 'today' || (slug === today.slug && !todaysPhysiqueDay()))) {
        openPhysiqueForm(todaysPhysiqueDay());
        return today;
      }
      const p = allPhysiqueEntries.find((e) => physiqueRouteStep(e).slug === slug);
      if (!p || (sub && sub !== 'micronutrients' && sub !== 'duplicate')) return null;
      if (sub === 'micronutrients') openPhysiqueMicronutrients(p);
      else openPhysiqueForm(p, sub === 'duplicate');
      return physiqueRouteStep(p).label;
    });
    document.getElementById('physique-cancel-btn').addEventListener('click', closePhysiqueForm);
    const closeOnClick = (btnId, modalId) => document.getElementById(btnId).addEventListener('click', () => {
      document.getElementById(modalId).hidden = true;
    });
    closeOnClick('physique-micro-close-btn', 'physique-micro-modal');
    document.getElementById('physique-micro-range-btn').addEventListener('click', openPhysiqueMicronutrientsRange);
    closeOnClick('physique-micro-range-close-btn', 'physique-micro-range-modal');
    document.getElementById('physique-calc-btn').addEventListener('click', calculatePhysiqueDay);
    document.getElementById('physique-scan-btn').addEventListener('click', () => document.getElementById('physique-scan-input').click());
    document.getElementById('physique-scan-input').addEventListener('change', handlePhysiqueScanInput);
    setupConsumptionAutocomplete();
    setupWorkoutAutocomplete();
    document.getElementById('physique-form-micro-btn').addEventListener('click', openPhysiqueMicronutrientsFromForm);
    document.getElementById('physique-is-pattern').addEventListener('change', syncPhysiquePatternMode);
    // Date and body mass move the BMR line too.
    ['bedtime', 'wake-time', 'date', 'body-mass'].forEach((id) => physiqueField(id).addEventListener('input', updatePhysiqueSleepDuration));
    document.getElementById('physique-is-pattern').addEventListener('change', updatePhysiqueSleepDuration);
    onFormSubmit('physique-form', submitPhysiqueForm);

    document.getElementById('physique-search').addEventListener('input', () => showPhysiquePage(1));
    makeSortableHeaders('#physique-table', pSort, () => showPhysiquePage(1));

    document.getElementById('physique-select-all').addEventListener('change', (e) => {
      const { pageEntries } = getPhysiquePageEntries();
      pageEntries.forEach((p) => (e.target.checked ? selectedPhysiqueRows.add(p.row) : selectedPhysiqueRows.delete(p.row)));
      renderPhysiqueList();
    });
    onAsyncClick('physique-bulk-calc-btn', bulkCalculatePhysique);
  }

  await refreshPhysique(forceRefresh);
}

const physiqueTextCell = cellText;

// Entry key -> cell parser, in the entry's own key order.
const PHYSIQUE_CELL_PARSERS = {
  date: (value) => physiqueTextCell(value).trim(),
  bedtime: normalizeTimeCell,
  wakeTime: normalizeTimeCell,
  bodyMass: physiqueNumber,
  sleep: physiqueNumber,
  deprivation: physiqueNumber,
  bmr: parsePhysiqueBmr,
  consumption: physiqueTextCell,
  breakdown: physiqueTextCell,
  caloriesIn: physiqueNumber,
  proteinIn: physiqueNumber,
  fiber: physiqueNumber,
  fat: physiqueNumber,
  carbohydrate: physiqueNumber,
  tef: physiqueNumber,
  workout: physiqueTextCell,
  duration: physiqueNumber,
  caloriesOut: physiqueNumber,
};

async function refreshPhysique(forceRefresh = false) {
  // Re-resolved on use, so a spreadsheet switch can't keep the old tab's id.
  physiqueSheetId = null;
  const deletesAtRead = physiqueRowDeletes;
  const resp = await getValues(PHYSIQUE_RANGE, VALUE_PARAMS);
  physiqueRowDeletesAtRead = deletesAtRead;
  const values = resp.values || [];

  // Row 1 is always the header.
  physiqueColumnIndex = physiqueColumnsFromHeader(values[0] || []);
  const cell = (row, key) => (hasPhysiqueColumn(key) ? row[physiqueColumnIndex[key]] : undefined);
  const parsers = Object.entries(PHYSIQUE_CELL_PARSERS);

  allPhysiqueEntries = values.slice(1)
    .map((row, i) => ({
      row: i + 2,
      // Every cell as read.
      cells: row,
      ...Object.fromEntries(parsers.map(([key, parse]) => [key, parse(cell(row, key))])),
    }))
    // An empty row isn't a day, but a dateless row with anything in it is a pattern.
    .filter((p) => PHYSIQUE_FIELDS.some(({ key }) => p[key] !== null && String(p[key]).trim() !== ''))
    // The body-mass figures ride in the same Derived cell.
    .map((p) => ({ ...p, mass: massFiguresOf(p.bmr) }));

  physiqueEntriesCache = null;
  physiqueDatedCache = null;
  bmrFiguresCache = new Map();
  physiqueDataLoaded = true;

  renderPhysiqueList();
  renderHealthCharts(physiqueAsHealthEntries());
  // Here rather than in their own inits, so a save re-marks what it just wrote:
  // the Activity Plan's ticks and Nutrition's logged-today tint.
  renderWorkoutPlanProgress();
  // Only once Nutrition has its own data; before that its first render picks this up.
  if (nutritionDataLoaded) {
    // Today's days changed, so the memoized Uses counts are stale.
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

// Kept for track-leetcode.js.
function physiqueColumnLetter(i) {
  return sheetColumnLetter(i);
}

// --- Stored body mass --------------------------------------------------------
//
// Each day's Derived cell also holds {"m","BMI","m_avg","m_d"} as of that day: the
// reading (its own, else the latest earlier), BMI at m_avg, the L_p-day rolling average
// and the smoothed trend's slope in kg/day. Worked out on save (or on load for older
// days), then only read. A changed reading rewrites the days after it; a changed L_p
// or height rewrites every day.
const MASS_JSON_ORDER = ['m', 'BMI', 'm_avg', 'm_d'];

// m_d as g/day for display, from its stored kg/day.
function massChangeGPerDay(mass) {
  return mass?.m_d === undefined || mass?.m_d === null ? null : Math.round(mass.m_d * GRAMS_PER_KG);
}

// A cell written while m_d was in g/day: no body changes by 1 kg a day, so that's grams.
function massChangeStoredInGrams(mass) {
  return mass?.m_d !== undefined && Math.abs(mass.m_d) >= 1;
}

// The body-mass figures stored in a Derived cell, or null when it has none yet.
function massFiguresOf(bmr) {
  if (!bmr || bmr.m === undefined) return null;
  return Object.fromEntries(MASS_JSON_ORDER.filter((k) => bmr[k] !== undefined).map((k) => [k, bmr[k]]));
}

function computePhysiqueMassFigures(date, bodyMassKg = undefined) {
  if (!date) return {};
  const readings = physiqueDatedAscending()
    .filter((p) => p.date < date && p.bodyMass !== null)
    .map((p) => ({ category: 'Body Mass', date: p.date, amount: p.bodyMass }));
  const own = bodyMassKg !== undefined
    ? bodyMassKg
    : allPhysiqueEntries.find((p) => p.date === date)?.bodyMass ?? null;
  if (own !== null && own !== undefined) readings.push({ category: 'Body Mass', date, amount: own });
  if (!readings.length) return {};

  const figures = { m: readings[readings.length - 1].amount };
  const mAvg = smoothedBodyMassKg(readings);
  if (mAvg !== null) figures.m_avg = mAvg;
  const heightCm = getSetting('HEIGHT_CM', null);
  if (mAvg !== null && heightCm !== null) figures.BMI = computeBmi(mAvg, heightCm);
  const trend = computeBodyMassTrend(bodyMassByDateMap(readings));
  const trendDates = [...trend.keys()].sort();
  const slope = trendDates.length ? computeBodyMassTrendSlopeGramsPerDay(trend).get(trendDates.at(-1)) : null;
  // Stored in kg/day like every other body-mass figure (the slope comes in g/day).
  if (slope !== null && slope !== undefined) figures.m_d = Math.round(slope) / GRAMS_PER_KG;
  return figures;
}

// The dated row already saved for `date`, if any.
function savedPhysiqueDay(date) {
  return allPhysiqueEntries.find((p) => p.date && p.date === date);
}

// What a save stores for `date`: the saved figures while its Body Mass is unchanged.
function physiqueMassForSave(date, bodyMassKg) {
  if (!date) return {};
  const saved = savedPhysiqueDay(date);
  if (saved?.mass && !massChangeStoredInGrams(saved.mass) && (saved.bodyMass ?? null) === (bodyMassKg ?? null)) {
    return { ...saved.mass };
  }
  return computePhysiqueMassFigures(date, bodyMassKg ?? null);
}

// The stored figures for `date`, else the latest dated day before it with some.
function storedMassAsOf(date) {
  const days = physiqueDatedAscending();
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].date <= date && days[i].mass && days[i].mass.m !== undefined) return days[i].mass;
  }
  return null;
}

function storedMassByDate() {
  return new Map(physiqueDatedAscending().filter((p) => p.mass).map((p) => [p.date, p.mass]));
}

// After a changed reading, rewrites the later days whose average or trend it moved.
async function recomputeStoredMassAfter(fromDate) {
  if (physiqueBatchRunning || !hasPhysiqueColumn('bmr')) return;
  const data = [];
  physiqueDatedAscending().filter((p) => p.date > fromDate).forEach((p) => {
    const figures = computePhysiqueMassFigures(p.date);
    if (JSON.stringify(figures) !== JSON.stringify(p.mass || {})) {
      data.push(physiqueCellUpdate('bmr', p.row, { ...(p.bmr || {}), ...figures }));
    }
  });
  await runPhysiqueBatch(data, 'recomputed Mass after a changed body-mass reading');
}

// --- Stored BMR ------------------------------------------------------------
//
// Each day's Derived cell holds {"BMR_mif","BMR_kat","BMR_cal","BMR_adp","BMR_avg"} (kcal),
// computed on save and read by every per-day display. A key is left out when its
// inputs are missing.

const BMR_EQUATION_KEYS = { mifflin: 'BMR_mif', katch: 'BMR_kat' };
const BMR_DEFINITIONS = {
  BMR_mif: 'Mifflin-St Jeor BMR',
  BMR_kat: 'Katch-McArdle BMR',
  BMR_cal: 'Calibrated BMR',
  BMR_adp: 'Adapted BMR by t',
  BMR_avg: 'Average BMR',
};

// "BMR_kat (Katch-McArdle BMR)": the label (definition) form every hover uses.
function bmrHoverLabel(key) {
  return `${key} (${BMR_DEFINITIONS[key]})`;
}

// The active equation's figure (BMR_mif or BMR_kat).
function plainBmrOf(figures) {
  return figures[BMR_EQUATION_KEYS[bmrFormula()]];
}

// Whole days from one ISO date to another.
function physiqueDaysBetween(fromIso, toIso) {
  return Math.round((parseIsoDateUTC(toIso) - parseIsoDateUTC(fromIso)) / PHYSIQUE_DAY_MS);
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

// The day's own body-mass reading, else the latest earlier one — the mass the charts use.
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

  const plain = plainBmrOf(figures);
  const firstWeighIn = physiqueFirstWeighInDate();
  if (plain !== undefined && firstWeighIn) {
    const daysOnDiet = Math.max(0, physiqueDaysBetween(firstWeighIn, date));
    const fraction = adaptationFraction(daysOnDiet,
      getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT),
      getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT));
    figures.BMR_adp = Math.round(plain * (1 - fraction));
  }
  return figures;
}

// Whichever of BMR_mif, BMR_kat and BMR_adp the day has: what BMR_cal is clamped to,
// and averaged before there's an offset to measure (physiqueCalibratedBmr).
function physiqueBmrEquationValues(figures) {
  return [figures.BMR_mif, figures.BMR_kat, figures.BMR_adp].filter((v) => v !== undefined);
}

// The active equation's BMR plus Calibrate's offset over the full L_p-day periods
// so far, up to n_p, so BMR_cal ramps up from the 2nd period instead of waiting for
// all n_p. In the 1st period (nothing to measure yet) it's the plain average of the
// day's equations, so BMR_cal always has a value.
function physiqueCalibratedBmr(date, plainBmr, figures) {
  if (plainBmr === undefined) return undefined;
  const periodCount = getSetting(BMR_CALIBRATION_PERIOD_COUNT_KEY, BMR_CALIBRATION_PERIOD_COUNT_DEFAULT);
  const periodDays = getSetting(BMR_CALIBRATION_PERIOD_DAYS_KEY, BMR_CALIBRATION_PERIOD_DAYS_DEFAULT);
  const firstDate = physiqueDatedAscending()[0]?.date;
  const daysOfData = firstDate ? physiqueDaysBetween(firstDate, date) : 0;
  const availablePeriods = firstDate ? Math.min(Math.floor(daysOfData / periodDays), periodCount) : 0;
  if (availablePeriods < 1) {
    const equations = physiqueBmrEquationValues(figures);
    return equations.length ? Math.round(equations.reduce((sum, v) => sum + v, 0) / equations.length) : undefined;
  }
  const result = computeBmrCalibration(null, periodDays, isoDatePlusDays(date, -1), availablePeriods);
  return result.ok ? Math.round(plainBmr + result.offsetKcal) : undefined;
}

// BMR_cal comes from measured data, so a thin or noisy window can swing it far.
// Clamped to the day's equations, min − 10% to max + 10%.
const BMR_CAL_CLAMP_PCT = 0.10;
function clampBmrCal(bmrCal, figures) {
  const equations = physiqueBmrEquationValues(figures);
  if (!equations.length) return bmrCal;
  const lower = Math.round(Math.min(...equations) * (1 - BMR_CAL_CLAMP_PCT));
  const upper = Math.round(Math.max(...equations) * (1 + BMR_CAL_CLAMP_PCT));
  return Math.min(upper, Math.max(lower, bmrCal));
}

// All of a day's BMR figures, computed fresh. `bodyMassKg` overrides the
// carried-forward mass (a day saved with its own new reading).
function computePhysiqueBmrFigures(date, bodyMassKg = physiqueBodyMassAsOf(date)) {
  const figures = physiqueBaseBmrFigures(date, bodyMassKg);
  const calibrated = physiqueCalibratedBmr(date, plainBmrOf(figures), figures);
  if (calibrated !== undefined) figures.BMR_cal = clampBmrCal(calibrated, figures);
  const avg = bmrAverageOf(figures);
  if (avg !== null) figures.BMR_avg = avg;
  return figures;
}

// A day's figures as stored on its row (or the latest earlier row). Days not
// stored yet are computed, without BMR_cal — that needs the stored history.
function bmrFiguresForDate(date) {
  if (bmrFiguresCache.has(date)) return bmrFiguresCache.get(date);
  const stored = ignoreStoredBmr ? null : physiqueRowAsOf(date)?.bmr;
  const base = stored && Object.keys(stored).length
    ? stored
    : physiqueBaseBmrFigures(date, physiqueBodyMassAsOf(date));
  // A day stored before BMR_avg existed gets it from its other four.
  const avg = base.BMR_avg === undefined ? bmrAverageOf(base) : null;
  const figures = avg === null ? base : { ...base, BMR_avg: avg };
  bmrFiguresCache.set(date, figures);
  return figures;
}

// Today's figures at m̄, computed as the Tune does; cached per mass and settings.
function todayBmrFigures() {
  const date = localIso();
  const mass = planBodyMassKg(physiqueAsHealthEntries());
  const key = `today:${date}:${mass}:${JSON.stringify(currentSettings)}`;
  if (!bmrFiguresCache.has(key)) bmrFiguresCache.set(key, computePhysiqueBmrFigures(date, mass ?? undefined));
  return bmrFiguresCache.get(key);
}

// One figure from a day's set for `basis` ('bmr', 'bmr_cal', 'bmr_adp', 'bmr_avg'). Plain
// BMR stands in for a missing one. Null without a profile.
function pickBmrForBasis(figures, basis = bmrBasis()) {
  const plain = plainBmrOf(figures);
  if (plain === undefined) return null;
  if (basis === 'bmr_adp') return figures.BMR_adp ?? plain;
  if (basis === 'bmr_cal') return figures.BMR_cal ?? plain;
  if (basis === 'bmr_avg') return figures.BMR_avg ?? bmrAverageOf(figures) ?? plain;
  return plain;
}

// The key of the figure pickBmrForBasis returns: Tune's basis, else the equation.
function selectedBmrKey(figures) {
  const basisKey = { bmr_cal: 'BMR_cal', bmr_adp: 'BMR_adp', bmr_avg: 'BMR_avg' }[bmrBasis()];
  const basisValue = basisKey === 'BMR_avg' ? figures.BMR_avg ?? bmrAverageOf(figures) : figures[basisKey];
  return basisKey && basisValue != null ? basisKey : BMR_EQUATION_KEYS[bmrFormula()];
}

function storedBmrForDate(date, basis = bmrBasis()) {
  return pickBmrForBasis(bmrFiguresForDate(date), basis);
}

// A day's energy balance off its TEI, AEE, TEF and stored BMR (the Status card's
// dailyEnergyBalanceKcal). Null without a BMR, TEI or sleep; with sleepOptional,
// no Bed/Wake counts as SD = 0 (the form's live table).
function physiqueEnergyBalance(day, sleepHours, bmrFigures, { sleepOptional = false } = {}) {
  const maintenance = pickBmrForBasis(bmrFigures);
  if (maintenance === null || day.caloriesIn === null || (sleepHours === null && !sleepOptional)) return null;
  const tef = day.tef !== null ? day.tef : Math.round(day.caloriesIn * (1 - tefDivisor()));
  return {
    tef,
    ...dailyEnergyBalanceKcal(
      day.caloriesIn,
      maintenance,
      day.caloriesOut ?? 0,
      tef,
      sleepHours,
      getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT),
    ),
  };
}

function physiqueDeprivationKcal(day, sleepHours, bmrFigures) {
  return physiqueEnergyBalance(day, sleepHours, bmrFigures)?.deprivationKcal ?? null;
}

// The BMR figures a save stores for `date`, at its own reading else the latest earlier one.
// Only a changed Body Mass recomputes a stored day.
function physiqueBmrForSave(date, bodyMassKg) {
  if (!date) return {};
  const saved = savedPhysiqueDay(date);
  const bmr = saved?.bmr && (saved.bodyMass ?? null) === (bodyMassKg ?? null)
    ? { ...saved.bmr }
    : computePhysiqueBmrFigures(date, bodyMassKg ?? physiqueBodyMassAsOf(isoDatePlusDays(date, -1)));
  // A stored BMR_cal is kept (only a settings change rewrites it).
  if (saved?.bmr?.BMR_cal !== undefined) bmr.BMR_cal = saved.bmr.BMR_cal;
  // BMR_avg from the figures actually kept, BMR_cal included.
  const avg = bmrAverageOf(bmr);
  if (avg !== null) bmr.BMR_avg = avg;
  return bmr;
}

// Sleep, BMR, Deprivation and Mass as stored, computed once per save.
function physiqueDerivedFigures(day) {
  const sleep = physiqueSleepHours(day);
  const bmr = physiqueBmrForSave(day.date, day.bodyMass);
  const mass = physiqueMassForSave(day.date, day.bodyMass);
  return { sleep, bmr: { ...bmr, ...mass }, deprivation: physiqueDeprivationKcal(day, sleep, bmr) };
}

const BMR_JSON_ORDER = ['BMR_mif', 'BMR_kat', 'BMR_cal', 'BMR_adp', 'BMR_avg'];
// Key order of a written Derived cell.
const DERIVED_JSON_ORDER = [...BMR_JSON_ORDER, ...MASS_JSON_ORDER];

// A day's stored Sleep, else from its clock times.
function physiqueStoredSleepHours(p) {
  return p.sleep ?? physiqueSleepHours(p);
}

// Free text in a row that stays USER_ENTERED for its Date/Bed/Wake: quoted, so
// "1/2 cup" or "=..." is kept as typed.
const PHYSIQUE_TEXT_KEYS = new Set(['consumption', 'breakdown', 'workout']);

function physiqueCellValue(key, value) {
  if (PHYSIQUE_TEXT_KEYS.has(key)) return sheetText(value);
  if (key !== 'bmr') return value ?? '';
  const present = DERIVED_JSON_ORDER.filter((k) => value?.[k] !== undefined);
  return present.length ? JSON.stringify(Object.fromEntries(present.map((k) => [k, value[k]]))) : '';
}

// A day's values by key; Sleep, BMR, Deprivation and Mass recomputed from its other fields.
function physiqueRowValues(day) {
  return { ...day, ...physiqueDerivedFigures(day) };
}

// Only the app's own columns, one cell each, so the user's columns (formulas
// included) are never rewritten.
async function writePhysiqueRow(row, day) {
  const values = physiqueRowValues(day);
  const data = PHYSIQUE_COLUMNS
    .filter(({ key }) => hasPhysiqueColumn(key))
    .map(({ key }) => physiqueCellUpdate(key, row, values[key]));
  await batchUpdateValues(data);
}

// A new row has nothing to keep, so the columns between the app's go blank.
async function appendPhysiqueRow(day) {
  const values = physiqueRowValues(day);
  const width = Math.max(...PHYSIQUE_COLUMNS.map(({ key }) => physiqueColumnIndex[key] ?? -1)) + 1;
  const cells = Array(width).fill('');
  PHYSIQUE_COLUMNS.forEach(({ key }) => {
    if (hasPhysiqueColumn(key)) cells[physiqueColumnIndex[key]] = physiqueCellValue(key, values[key]);
  });
  await appendValues(sheetRange(CONFIG.SHEETS.PHYSIQUE, `A:${sheetColumnLetter(width - 1)}`), [cells]);
}

// Cell ranges the one-off fills have written to this spreadsheet, so a second load
// racing the first write can't send them again.
const physiqueBackfilledCells = new Set();
let physiqueBackfillSpreadsheetId = null;

function physiqueCellRange(key, row) {
  return sheetRange(CONFIG.SHEETS.PHYSIQUE, `${sheetColumnLetter(physiqueColumnIndex[key])}${row}`);
}

function physiqueCellUpdate(key, row, value) {
  return { range: physiqueCellRange(key, row), values: [[physiqueCellValue(key, value)]] };
}

// Counts row deletes sent. Background writes address rows from the last read, so
// a delete sent since then would shift them: they wait for that delete's reload.
let physiqueRowDeletes = 0;
let physiqueRowDeletesAtRead = 0;

function physiqueRowsShiftedSinceRead() {
  return physiqueRowDeletes !== physiqueRowDeletesAtRead;
}

// Writes `data` in one request and reloads; one run at a time. False on failure
// (or when a delete has moved the rows since the read).
let physiqueBatchRunning = false;
async function runPhysiqueBatch(data, label) {
  if (!data.length) return true;
  if (physiqueRowsShiftedSinceRead()) return false;
  physiqueBatchRunning = true;
  try {
    await batchUpdateValues(data);
    // A write re-reads the whole tab, so it should only happen while something is missing or changed.
    console.info(`[physique] ${label}: ${data.length} cells (this load writes and re-reads Physique)`);
    await refreshPhysique(true);
    return true;
  } catch (err) {
    console.error(`Physique ${label} failed:`, err);
    return false;
  } finally {
    physiqueBatchRunning = false;
  }
}

// A one-off fill's cells not yet sent to this spreadsheet, in one batch.
async function runPhysiqueBackfill(data, label) {
  // Ranges don't name the spreadsheet, so a switch starts the record afresh.
  const spreadsheetId = getActiveSpreadsheetId();
  if (spreadsheetId !== physiqueBackfillSpreadsheetId) {
    physiqueBackfilledCells.clear();
    physiqueBackfillSpreadsheetId = spreadsheetId;
  }
  // Left unmarked, so the delete's reload sends them at the right rows.
  if (physiqueRowsShiftedSinceRead()) return;
  const fresh = data.filter((d) => !physiqueBackfilledCells.has(d.range));
  fresh.forEach((d) => physiqueBackfilledCells.add(d.range));
  await runPhysiqueBatch(fresh, label);
}

// One-off fill for days saved before Sleep/BMR/Deprivation/Mass were stored: blank
// cells only, oldest day first. Nothing to do once all are filled.
async function backfillPhysiqueDerivedFigures() {
  if (physiqueBatchRunning) return;
  const has = hasPhysiqueColumn;
  const data = [];
  physiqueDatedAscending().forEach((p) => {
    const sleep = physiqueStoredSleepHours(p);
    if (has('sleep') && p.sleep === null && sleep !== null) data.push(physiqueCellUpdate('sleep', p.row, sleep));

    let figures = p.bmr;
    if (has('bmr') && !figures) {
      figures = computePhysiqueBmrFigures(p.date);
      if (Object.keys(figures).length) data.push(physiqueCellUpdate('bmr', p.row, figures));
    } else if (has('bmr') && figures.BMR_cal === undefined) {
      // A day that now has enough history gets its BMR_cal once, then keeps it.
      const calibrated = physiqueCalibratedBmr(p.date, plainBmrOf(figures), figures);
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
  // Body-mass figures for Derived cells without them (or with m_d still in g/day).
  if (has('bmr')) {
    physiqueDatedAscending().forEach((p) => {
      if (p.mass && !massChangeStoredInGrams(p.mass)) return;
      const figures = computePhysiqueMassFigures(p.date);
      if (!Object.keys(figures).length) return;
      const range = physiqueCellRange('bmr', p.row);
      const pending = data.find((d) => d.range === range);
      // Merged into this day's BMR write above, if any.
      if (pending) pending.values = [[physiqueCellValue('bmr', { ...JSON.parse(pending.values[0][0] || '{}'), ...figures })]];
      else data.push(physiqueCellUpdate('bmr', p.row, { ...(p.bmr || {}), ...figures }));
    });
  }
  await runPhysiqueBackfill(data, 'stored missing Sleep/BMR/Deprivation/body mass');
}

// One-off rewrite of Breakdown amounts still in units ("×1") into grams, from each
// food's Nutrition row; app.js runs it once both tabs are in. No weight keeps "×N".
async function convertPhysiqueBreakdownAmountsToGrams() {
  if (physiqueBatchRunning || !hasPhysiqueColumn('breakdown')) return;
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
  await runPhysiqueBackfill(data, 'converted Breakdown amounts to grams');
}

// One-off fill for days saved while USDA/AI rows got no TEF: those rows' TEF,
// the day's TEF and its Deprivation. Needs Nutrition loaded, like the above.
async function fillPhysiqueMissingTef() {
  if (physiqueBatchRunning || !hasPhysiqueColumn('breakdown')) return;
  const has = hasPhysiqueColumn;
  const data = [];
  allPhysiqueEntries.forEach((p) => {
    const items = parsePhysiqueBreakdown(p.breakdown);
    const before = items.map((item) => item.tef);
    const result = estimateTefBreakdown(items);
    if (!result || !items.some((item, i) => before[i] === undefined && item.tef !== undefined)) return;
    data.push(physiqueCellUpdate('breakdown', p.row, breakdownToJson(items)));
    if (has('tef')) data.push(physiqueCellUpdate('tef', p.row, result.tefKcal));
    if (has('deprivation') && p.date) {
      const day = { ...p, tef: result.tefKcal };
      const deprivation = physiqueDeprivationKcal(day, physiqueStoredSleepHours(p), bmrFiguresForDate(p.date));
      if (deprivation !== null) data.push(physiqueCellUpdate('deprivation', p.row, deprivation));
    }
  });
  await runPhysiqueBackfill(data, 'filled TEF for USDA/AI-priced rows');
}

// Settings that change a stored BMR or Deprivation.
const PHYSIQUE_BMR_SETTING_KEYS = ['HEIGHT_CM', 'BIRTH_DATE', 'SEX', BMR_FORMULA_KEY, BMR_BASIS_KEY,
  ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_CAP_KEY, BMR_CALIBRATION_PERIOD_COUNT_KEY,
  BMR_CALIBRATION_PERIOD_DAYS_KEY, 'SLEEP_DESIRED_HOURS', TEF_PERCENT_KEY];

// Rewrites every day's BMR, Mass and Deprivation in one request when a setting they
// depend on changed. `force` skips that check (Calibrate's Update). Resolves to the
// number of days rewritten, or null when the write failed.
async function recomputeStoredPhysiqueBmr(changedKeys, { force = false } = {}) {
  if (physiqueBatchRunning) return 0;
  if (!force && !changedKeys.some((key) => PHYSIQUE_BMR_SETTING_KEYS.includes(key))) return 0;
  // A page without Physique (e.g. Other's Settings) never loaded it, but must still rewrite it.
  if (!physiqueDataLoaded) {
    await initActivities();
    await initPhysique();
  }
  if (!physiqueDataLoaded || physiqueBatchRunning) return 0;
  if (!hasPhysiqueColumn('bmr') && !hasPhysiqueColumn('deprivation')) return 0;

  ignoreStoredBmr = true;
  bmrFiguresCache = new Map();
  const data = [];
  try {
    physiqueDatedAscending().forEach((p) => {
      const figures = computePhysiqueBmrFigures(p.date);
      // L_p (m_avg, m_d) and height (BMI) are among these settings too.
      if (hasPhysiqueColumn('bmr')) {
        data.push(physiqueCellUpdate('bmr', p.row, { ...figures, ...computePhysiqueMassFigures(p.date) }));
      }
      if (hasPhysiqueColumn('deprivation')) {
        data.push(physiqueCellUpdate('deprivation', p.row, physiqueDeprivationKcal(p, physiqueStoredSleepHours(p), figures)));
      }
    });
  } finally {
    ignoreStoredBmr = false;
    bmrFiguresCache = new Map();
  }
  const ok = await runPhysiqueBatch(data, 'recomputed BMR/Deprivation');
  return ok ? physiqueDatedAscending().length : null;
}

// Every day needs a row (unlike the weekday-only work-time reminder).
function checkHealthReminder() {
  const today = localIso();
  const logged = allPhysiqueEntries.some((p) => p.date === today);
  setPageBadge('health', 'physique', logged ? null : { text: 'Log', title: "Today isn't logged", record: today });
}

// --- Physique as chart input --------------------------------------------
//
// The charts and Insight read per-event rows ({date, category, amount, amount2, unit,
// notes, breakdown, sleepBedMin/WakeMin, tefKcal}), so each day expands into up to
// four of them. Memoized: aggregateWindow reads it repeatedly per run.

// A day's activity split by its Workout lines' categories (per the Activities sheet),
// so the chart stacks the real mix. The stored Duration and Calories Out are shared
// by active seconds, keeping a hand-edited total exact; the largest category takes
// the rounding remainder.
function physiqueActivityByCategory(p) {
  const unsplit = [{ category: 'Other', minutes: p.duration, calories: p.caloriesOut }];
  const lines = parseWorkoutNoteLines(p.workout);
  if (!lines.length) return unsplit;

  const secondsByCategory = new Map();
  lines.forEach((line) => {
    const category = activityCategory(line.name);
    secondsByCategory.set(category, (secondsByCategory.get(category) || 0) + activeSecondsForNoteLine(line));
  });

  const totalSeconds = [...secondsByCategory.values()].reduce((sum, s) => sum + s, 0);
  if (totalSeconds <= 0) return unsplit;

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

function physiqueAsHealthEntries() {
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
    // Both clock times or no sleep entry.
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
        // Null when not calculated: health-math.js then estimates it, not a measured zero.
        tefKcal: p.tef,
        // The day's stored macros, as typed or last calculated.
        fiberG: p.fiber,
        fatG: p.fat,
        carbG: p.carbohydrate,
      });
    }

    // One entry per activity category. The Workout text rides on the first only:
    // health-insight-activity.js re-parses it, and repeating it would count reps twice.
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

// Today's row, which Log a Workout extends rather than adding a second one.
function todaysPhysiqueDay() {
  const today = localIso();
  return allPhysiqueEntries.find((p) => p.date === today) ?? null;
}

// Red pulse when the saved day's D (Balance) is above its desire, i.e. short of the desired deficit.
function warnBalanceShortOfDesire(derived) {
  if (!derived) return;
  const { balance, balanceDesired } = derived;
  if (balance !== null && balanceDesired !== null && balance > balanceDesired) Motion.warn();
}

// Confetti when today's saved body mass is closer to the healthy mass than the last earlier reading.
function celebrateBodyMassProgress(date, bodyMass) {
  const today = localIso();
  if (date !== today || !bodyMass) return;
  const previous = physiqueDatedAscending().filter((p) => p.date < today && p.bodyMass !== null).at(-1)?.bodyMass;
  if (previous == null) return;
  const healthyKg = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  if (Math.abs(bodyMass - healthyKg) < Math.abs(previous - healthyKg)) Motion.confetti();
}

// Which days came across incomplete (console only), since a chart gap looks like an unlogged day.
function logPhysiqueDataGaps() {
  const days = allPhysiqueEntries.filter((p) => p.date);
  if (!days.length) return;

  const count = (predicate) => days.filter(predicate).length;
  console.debug('[physique] gaps:', {
    days: days.length,
    noSleepTimes: count((p) => physiqueSleepHours(p) === null),
    noBodyMass: count((p) => p.bodyMass === null),
    noCaloriesIn: count((p) => p.caloriesIn === null),
    noProteinIn: count((p) => p.proteinIn === null),
    noBreakdown: count((p) => p.caloriesIn !== null && !parsePhysiqueBreakdown(p.breakdown).length),
    noActivityDuration: count((p) => p.workout.trim() && p.duration === null),
    noCaloriesOut: count((p) => p.workout.trim() && p.caloriesOut === null),
    // Nothing the Activity Plan recognizes: no reps, muscle group or label.
    unparseableWorkout: count((p) => p.workout.trim() && parseWorkoutNoteLines(p.workout).length === 0),
    // Not on the Activities tab (usually a spelling drift): fallback MET, 'Other'.
    unmatchedExerciseNames: [...new Set(
      days.flatMap((p) => parseWorkoutNoteLines(p.workout).map((line) => line.name))
        .filter((name) => !activityByName(name)),
    )],
  });
}

const PHYSIQUE_NUMERIC_KEYS = ['bodyMass', 'caloriesIn', 'proteinIn', 'fiber', 'fat', 'carbohydrate', 'duration', 'caloriesOut', 'tef'];

function getFilteredPhysiqueEntries() {
  const search = document.getElementById('physique-search').value.trim().toLowerCase();

  const filtered = allPhysiqueEntries
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

// The day macros Calculate fills from a breakdown estimateTefBreakdown has annotated.
const BREAKDOWN_MACRO_KEYS = ['fiber', 'fat', 'carbohydrate'];

// Day totals of those macros, to 0.1 g. A macro no item carries stays null
// ("not measured"), not a confident zero.
function sumBreakdownMacros(items) {
  const totals = Object.fromEntries(BREAKDOWN_MACRO_KEYS.map((key) => [key, null]));
  (items || []).forEach((item) => {
    BREAKDOWN_MACRO_KEYS.forEach((key) => {
      if (item[key] !== undefined) totals[key] = Math.round(((totals[key] || 0) + item[key]) * 10) / 10;
    });
  });
  return totals;
}

// A day's sleep length from its two clock times.
function physiqueSleepHours(p) {
  const bed = parseClockTime(p.bedtime);
  const wake = parseClockTime(p.wakeTime);
  if (bed === null || wake === null) return null;
  return sleepDurationHours(bed, wake);
}

// Patterns head every page and don't count against P_PAGE_SIZE, so a template is
// never paged away. Shared by the render and select-all so both agree on the page.

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
    tbody.appendChild(renderEmptyRow(PHYSIQUE_TABLE_COLUMNS, message));
  }

  // The Activity Plan's logged-today tint. Read per render, so it moves at midnight.
  const todayIso = localIso();
  const masked = (text) => (privacyMode ? maskDigits(text) : text);
  const num = (value) => (value === null ? '—' : masked(String(value)));
  // Whole grams, floored as the day's breakdown Total shows them.
  const int = (value) => (value === null ? '—' : masked(String(Math.floor(value))));

  pageEntries.forEach((p, i) => {
    const tr = document.createElement('tr');
    if (p.date === todayIso) tr.classList.add('today-row');
    // A line on each Sunday (newest first, that's between two Mon–Sun weeks) and on
    // the first day after the patterns. T00:00:00 keeps the parse local.
    const isWeekBoundary = p.date && new Date(`${p.date}T00:00:00`).getDay() === 0;
    const afterPatterns = p.date && i > 0 && !pageEntries[i - 1].date;
    if (isWeekBoundary || afterPatterns) tr.classList.add('physique-week-start');

    // The stored figures; computed here only for a day not yet saved with them.
    const sleepHours = physiqueStoredSleepHours(p);
    const sleepTitle = sleepHours !== null
      ? `${sleepHours} hr of sleep (${p.bedtime} → ${p.wakeTime}) — open Edit to change the clock times`
      : '';
    const deprivationKcal = p.deprivation ?? physiqueDeprivationKcal(p, sleepHours, p.date ? bmrFiguresForDate(p.date) : {});
    const deprivationTitle = deprivationKcal !== null
      ? `Sleep Deprivation Effect: ${deprivationKcal} kcal`
      : 'Not calculable — needs a profile (Settings), this day\'s Body Mass and Calories In';

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
      makeCell(num(sleepHours), masked(sleepTitle)),
      makeCell(num(deprivationKcal), masked(deprivationTitle)),
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
      // How a pattern becomes a day: the copy opens dated today.
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => {
        routeRecordEdit('physique', physiqueRouteStep(p), { slug: 'duplicate', label: 'Duplicate' });
        openPhysiqueForm(p, true);
      } }),
      makeRowActionButton({ emoji: '🧬', title: 'Micronutrients', onClick: () => openPhysiqueMicronutrients(p, true) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deletePhysiqueEntry(p) }),
    );
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  updatePhysiqueSelectAllCheckbox(pageEntries);
  updatePhysiqueBulkActionsUI();

  renderPager('physique-pagination', { page: pCurrentPage, totalPages, onChange: showPhysiquePage });
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

// One nutrient's table row; `withPerDay` adds the per-day average column.
function physiqueNutrientRow(nutrients, i, withPerDay) {
  const n = nutrients[i];
  const amount = (value, unit) => (value !== null ? `${value} ${unit}` : '—');
  const tr = document.createElement('tr');
  if (n.severity === 'severe' || n.severity === 'mild') tr.classList.add('nutrient-gap');
  if (nutrientSectionEnd(nutrients, i)) tr.classList.add('nutrient-facts-end');
  tr.append(
    nutrientNameCell(n),
    makeCell(`${n.total} ${n.unit}`),
    ...(withPerDay ? [makeCell(amount(n.perDay, n.unit))] : []),
    makeCell(amount(n.supplementPerDay, n.unit)),
    makeCell(amount(n.ideal, n.idealUnit)),
  );
  return tr;
}

// The 🧬 row action: Health Insight's Micronutrients table for this one day (no
// per-day column, as it equals the total). `routed`: open at …/<date>/micronutrients/.
function openPhysiqueMicronutrients(p, routed = false) {
  if (routed) routeRecordEdit('physique', physiqueRouteStep(p), { slug: 'micronutrients', label: 'Micronutrients' });

  // A Pattern has no date to look up, so it reads its own Breakdown.
  const data = p.date
    ? aggregateMicronutrientIntake(p.date, p.date)
    : aggregateMicronutrientIntake(null, null, [parsePhysiqueBreakdown(p.breakdown)]);

  const tbody = document.getElementById('physique-micro-body');
  tbody.innerHTML = '';

  if (data.nutrients.length === 0) {
    tbody.appendChild(renderEmptyRow(4, 'Nothing to show — see the coverage note above.'));
  } else {
    data.nutrients.forEach((n, i) => tbody.appendChild(physiqueNutrientRow(data.nutrients, i, false)));
  }

  document.getElementById('physique-micro-modal').hidden = false;
}

// 🧬 in the header (…/physique/micronutrients/): the same table over a picked
// range, with a per-day average beside each total.
let physiqueMicroRangeSlug = '1w';
// Health Chart's ranges with 1d (today alone) in front.
const PHYSIQUE_MICRO_RANGES = [{ slug: '1d', label: '1d' }, ...HEALTH_RANGES];

function openPhysiqueMicronutrientsRange() {
  renderPhysiqueMicronutrientsRange();
  document.getElementById('physique-micro-range-modal').hidden = false;
}

function renderPhysiqueMicronutrientsRange() {
  renderRangeButtons('physique-micro-range', PHYSIQUE_MICRO_RANGES, physiqueMicroRangeSlug, (slug) => {
    physiqueMicroRangeSlug = slug;
    renderPhysiqueMicronutrientsRange();
  });
  const { from, to } = physiqueMicroRangeSlug === '1d'
    ? { from: localIso(), to: localIso() }
    : healthRangeDates(physiqueMicroRangeSlug);
  const data = aggregateMicronutrientIntake(from, to);
  const tbody = document.getElementById('physique-micro-range-body');
  tbody.innerHTML = '';
  if (data.nutrients.length === 0) {
    tbody.appendChild(renderEmptyRow(5, 'No day in this range has 🧬 Micronutrients pulled.'));
    return;
  }
  data.nutrients.forEach((n, i) => tbody.appendChild(physiqueNutrientRow(data.nutrients, i, true)));
}

// Form field id suffix → entry property (sheet placement is PHYSIQUE_COLUMNS' job).
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

// A pattern has no date, body mass, sleep or workout, so those sections hide and the
// date is disabled. Save blanks them; unticking Pattern brings back what was typed.
function syncPhysiquePatternMode() {
  const isPattern = document.getElementById('physique-is-pattern').checked;
  document.getElementById('physique-day-details').hidden = isPattern;
  document.getElementById('physique-derived').hidden = isPattern;
  document.getElementById('physique-workout-details').hidden = isPattern;
  const workoutTable = document.getElementById('physique-activity-breakdown');
  workoutTable.hidden = isPattern || !document.getElementById('physique-activity-breakdown-body').children.length;
  const dateInput = physiqueField('date');
  dateInput.disabled = isPattern;
  dateInput.required = !isPattern;
  if (isPattern) dateInput.value = '';
  else if (!dateInput.value) dateInput.value = localIso();
}

// What Save will do ("Add to Today's Workout"), on Save's hover. openPhysiqueForm clears it.
function setPhysiqueFormHint(text) {
  document.querySelector('#physique-form button[type="submit"]').title = text;
}

function openPhysiqueForm(entry, duplicate = false) {
  editingPhysiqueRow = (entry && !duplicate) ? entry.row : null;
  setPhysiqueFormHint('');

  PHYSIQUE_FIELDS.forEach(({ id, key }) => {
    const value = entry ? entry[key] : '';
    physiqueField(id).value = (value === null || value === undefined) ? '' : String(value);
  });

  // A duplicate is always a real day, dated today.
  document.getElementById('physique-is-pattern').checked = entry ? (!entry.date && !duplicate) : false;
  if (duplicate) physiqueField('date').value = localIso();
  syncPhysiquePatternMode();

  // Day, Consumption and Workout start collapsed on any day but today; a Pattern opens Consumption too.
  const isToday = physiqueField('date').value === localIso();
  const isPattern = document.getElementById('physique-is-pattern').checked;
  document.getElementById('physique-day-details').open = isToday;
  document.getElementById('physique-consumption-details').open = isToday || isPattern;
  document.getElementById('physique-workout-details').open = isToday;

  // The saved breakdown shows as its table straight away, its macros and TEF freshened
  // from Nutrition. The activity table is recomputed from the Workout text, repricing
  // Duration and Calories Out at the Body Mass filled in above.
  const openedBreakdown = entry ? parsePhysiqueBreakdown(entry.breakdown) : [];
  estimateTefBreakdown(openedBreakdown);
  renderPhysiqueBreakdown(openedBreakdown, entry ? entry.caloriesIn : 0, entry ? entry.proteinIn : 0);
  refreshPhysiqueActivityBreakdown();
  updatePhysiqueSleepDuration();

  clearFieldError('physique-form-error');
  document.getElementById('physique-modal').hidden = false;
}

function closePhysiqueForm() {
  document.getElementById('physique-modal').hidden = true;
  hideCalcBreakdown('physique');
  hidePhysiqueActivityBreakdown();
  hideConsumptionSuggestions();
  hideWorkoutSuggestions();
}

// A whole day's ceiling; a per-meal one would fire on every normal day.
const PHYSIQUE_DAY_CALORIE_CEILING = 6000;

// Body mass for the burn formula: the typed one, else the latest logged.
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

// A copy of a day to change and pass to writePhysiqueRow; also what an undo writes back.
function physiqueDayCopy(p) {
  return { ...p };
}

// Folds a day already on the sheet into the open form instead of refusing the clash.
// Lists (Consumption, Workout, Breakdown) concatenate, saved lines first; totals over
// them add up; single facts (Bed, Wake, Body Mass) keep what was typed, the saved
// value only filling a blank. Nothing is written until the second Save.
function mergePhysiqueEntryIntoForm(saved) {
  // Body mass first: the activity table below prices the merged workout at it.
  fillPhysiqueFieldIfBlank('bedtime', saved.bedtime);
  fillPhysiqueFieldIfBlank('wake-time', saved.wakeTime);
  fillPhysiqueFieldIfBlank('body-mass', saved.bodyMass);

  // Every numeric field but Body Mass is a total. Macros and TEF are provisional
  // here, replaced below by the merged breakdown's exact figures where it has them.
  PHYSIQUE_FIELDS.filter(({ id, numeric }) => numeric && id !== 'body-mass')
    .forEach(({ id, key }) => addToPhysiqueTotal(id, saved[key]));

  appendToPhysiqueLines('consumption', saved.consumption);
  appendToPhysiqueLines('workout', saved.workout);

  // One table for both, which also rewrites the Breakdown JSON, so a later
  // Calculate can still reuse saved lines by noteLine.
  const mergedBreakdown = [...parsePhysiqueBreakdown(saved.breakdown), ...parsePhysiqueBreakdown(physiqueField('breakdown').value)];
  // Annotated before rendering, so the table draws the macro and TEF columns.
  const tef = estimateTefBreakdown(mergedBreakdown);
  const dayMacros = sumBreakdownMacros(mergedBreakdown);
  BREAKDOWN_MACRO_KEYS.forEach((key) => {
    if (dayMacros[key] !== null) physiqueField(key).value = dayMacros[key];
  });
  if (tef) physiqueField('tef').value = tef.tefKcal;
  renderPhysiqueBreakdown(
    mergedBreakdown,
    evaluateNumberExpression(physiqueField('calories-in').value.trim()),
    evaluateNumberExpression(physiqueField('protein-in').value.trim()),
  );
  // Reprices Duration and Calories Out off the merged Workout; without a body mass the sums stand.
  refreshPhysiqueActivityBreakdown();
  updatePhysiqueSleepDuration();

  editingPhysiqueRow = saved.row;
  clearFieldError('physique-form-error');
  showToast('↩︎ Merged — Save again.');
}

function fillPhysiqueFieldIfBlank(id, savedValue) {
  const field = physiqueField(id);
  if (!field.value.trim() && savedValue !== null && savedValue !== undefined) {
    field.value = String(savedValue);
  }
}

// Adds to a field at one decimal. A zero total stays blank, not a recorded 0;
// Protein always shows its decimal (22.0), being summed from one-decimal figures.
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

// Fields a pattern hides, so saves blank (the date explicitly, not trusting a disabled input).
const PHYSIQUE_PATTERN_BLANK_FIELDS = new Set(['date', 'body-mass', 'bedtime', 'wake-time', 'workout', 'activity-duration', 'calories-out']);

async function submitPhysiqueForm(event) {
  event.preventDefault();

  const isPattern = document.getElementById('physique-is-pattern').checked;

  const day = {};
  for (const { id, key, numeric } of PHYSIQUE_FIELDS) {
    const raw = (isPattern && PHYSIQUE_PATTERN_BLANK_FIELDS.has(id)) ? '' : physiqueField(id).value.trim();
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
  if (day.bodyMass !== null && day.bodyMass <= 0) {
    showFieldError('physique-form-error', 'Body Mass must be over 0.');
    return;
  }

  // One row per day: a date already logged is more of that day. The first Save
  // merges it into the form and edits that row; the second Save writes it.
  // Patterns are exempt.
  const { date } = day;
  const clash = !isPattern && allPhysiqueEntries.find((p) => p.date === date && p.row !== editingPhysiqueRow);
  if (clash) {
    mergePhysiqueEntryIntoForm(clash);
    return;
  }

  try {
    const editingRow = editingPhysiqueRow;
    const before = savedPhysiqueDay(date);
    const massChanged = (before?.bodyMass ?? null) !== (day.bodyMass ?? null);
    if (editingRow !== null) {
      await writePhysiqueRow(editingRow, day);
    } else {
      await appendPhysiqueRow(day);
    }
    await refreshPhysique(true);
    // A changed body-mass reading moves the stored Mass figures of the days after it.
    if (date && massChanged) await recomputeStoredMassAfter(date);
    // The saved day: the edited row, else the new date's (a new Pattern, the last one).
    const saved = allPhysiqueEntries.find((p) => p.row === editingRow)
      || (isPattern ? allPhysiqueEntries.filter((p) => !p.date).at(-1) : allPhysiqueEntries.find((p) => p.date === date));
    if (saved) {
      openPhysiqueForm(saved);
      stayOnSavedForm('physique-modal', physiqueRouteStep(saved));
    }
    showFormSaved('physique-form-error');
    if (!isPattern) warnBalanceShortOfDesire(updatePhysiqueSleepDuration());
    // Only a new or changed reading celebrates, so re-saving the same day doesn't.
    if (massChanged) celebrateBodyMassProgress(date, day.bodyMass);

  } catch (err) {
    showFieldError('physique-form-error', err.message);
  }
}

// --- Bulk Calculate ------------------------------------------------------
//
// The form's 🧮 over every selected day. A line whose noteLine matches the day's
// saved breakdown keeps its numbers, so only what changed costs a lookup.

// A day with its derived fields recalculated.
async function recalculatePhysiqueDay(p, bodyMassKg) {
  const day = physiqueDayCopy(p);

  if (p.consumption.trim()) {
    const { calories, protein, breakdown } =
      await estimateConsumptionIncrementally(p.consumption, p.breakdown);
    // Annotated before the JSON is written, so Breakdown carries the macros and TEF
    // too. Each is only overwritten when measurable, never blanked.
    const tef = estimateTefBreakdown(breakdown);
    const dayMacros = sumBreakdownMacros(breakdown);
    BREAKDOWN_MACRO_KEYS.forEach((key) => {
      if (dayMacros[key] !== null) day[key] = dayMacros[key];
    });
    if (tef) day.tef = tef.tefKcal;
    // Tidied as the form's Calculate does: combined, sorted by real calories, capitalized.
    day.consumption = combineAndSortConsumptionText(
      breakdown.map((i) => i.noteLine || `${i.amount} ${i.name}`).join('\n'),
      breakdownCaloriesLookup(breakdown),
    ).text;
    day.breakdown = breakdownToJson(breakdown);
    day.caloriesIn = calories;
    day.proteinIn = protein;
  }

  if (p.workout.trim() && bodyMassKg !== null) {
    // Combined and sorted highest burn first, as the form's Calculate does.
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

  // Looked up once; a day's own reading still wins below.
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

// Undo: one write per row (each still exists). `values` is the day as it was.
async function restorePhysiqueSnapshots(snapshots) {
  try {
    await Promise.all(snapshots.map((s) => writePhysiqueRow(s.row, s.values)));
    await refreshPhysique(true);
  } catch (err) {
    alert(`Failed to restore: ${err.message}`);
  }
}

function todayPhysiqueRouteStep() {
  const today = localIso();
  return { slug: today, label: today };
}

// A row's address step: its date, or pattern-<n> by sheet order for a Pattern.
function physiqueRouteStep(entry) {
  if (entry.date) return { slug: entry.date, label: entry.date };
  const n = allPhysiqueEntries.filter((e) => !e.date).indexOf(entry) + 1;
  return { slug: `pattern-${n}`, label: `Pattern ${n}` };
}

const PATTERN_SNIPPET_CHARS = 45;

function physiquePatternLabel(entry) {
  const snippet = (text) => {
    const first = text.split('\n')[0].trim();
    return first.length > PATTERN_SNIPPET_CHARS ? first.slice(0, PATTERN_SNIPPET_CHARS) + '…' : first;
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
    if (physiqueSheetId === null) physiqueSheetId = await fetchPhysiqueSheetId();
    physiqueRowDeletes += 1;
    await batchUpdate([sheetRowDeleteRequest(physiqueSheetId, entry.row)]);
    await refreshPhysique(true);
  }, "Couldn't delete day");
}
