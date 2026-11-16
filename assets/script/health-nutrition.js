// Nutrition: the personal ingredient catalogue Physique's 🧮 Calculate
// (health-physique-estimator.js) checks before falling back to an AI/USDA estimate.

// Read with its header row: columns are found by name, so a moved column can't shift data.
const NUTRITION_RANGE = nutritionA1('A1:ZZ');
const NUTRITION_COLUMNS = [
  { key: 'group', header: 'Group' },
  { key: 'name', header: 'Name' },
  { key: 'amount', header: 'Amount' },
  { key: 'calories', header: 'Calories' },
  { key: 'protein', header: 'Protein' },
  { key: 'fiber', header: 'Fiber' },
  { key: 'fat', header: 'Fat' },
  { key: 'carb', header: 'Carbohydrate' },
  { key: 'tef', header: 'TEF' },
  { key: 'proteinPercent', header: 'Percent' },
  { key: 'micronutrients', header: 'Micronutrients' },
];
const NUTRITION_DEFAULT_COLUMNS = Object.fromEntries(NUTRITION_COLUMNS.map(({ key }, i) => [key, i]));
// key -> 0-based column, from the header row. `legacyVerified` is the old Verification column.
let nutritionColumnIndex = NUTRITION_DEFAULT_COLUMNS;
// The header row and widest row as last read, for ensureNutritionColumns.
let nutritionHeaderRow = null;
let nutritionUsedWidth = 0;
// Row deletes sent, and the count when the last read started (migrateNutritionAmountOrder).
let nutritionRowDeletes = 0;
let nutritionRowDeletesAtRead = 0;
const N_PAGE_SIZE = 25;

// The optional typed macros (form/table label for each); null falls back to an estimate.
const NUTRITION_MACRO_LABELS = { fiber: 'Fiber', fat: 'Fat', carb: 'Carb', tef: 'TEF' };
const NUTRITION_MACRO_KEYS = Object.keys(NUTRITION_MACRO_LABELS);

// Left lowercase by titleCaseIngredientName unless one leads the name.
const NUTRITION_TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in',
  'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'with', 'yet',
]);

// "chicken  AND rice" -> "Chicken and Rice", so casing alone can't fragment the catalogue.
// Shared by the form's Norm and Physique's bulk Capitalize Names.
function titleCaseIngredientName(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, i) => (i > 0 && NUTRITION_TITLE_CASE_MINOR_WORDS.has(word.toLowerCase()))
      ? word.toLowerCase()
      : word.replace(/\b\p{L}/u, (ch) => ch.toUpperCase()))
    .join(' ');
}

// Amount is freeform label text. Calculate scales by weight when it holds a gram
// figure ("100g", "1 scoop (32g)"), otherwise by its leading count ("2 eggs"; 1 if none).
const NUTRITION_GRAMS_PATTERN = /(\d+(?:\.\d+)?)\s*(?:grams?|gr|g)\b/i;
function parseGramsFromAmount(amount) {
  const match = String(amount || '').match(NUTRITION_GRAMS_PATTERN);
  return match ? parseFloat(match[1]) : null;
}

// A leading number that isn't itself the gram figure: "1 (50g)" counts 1, "250g" none.
// The lookahead + \1 makes the digits atomic, so "100g" can't backtrack to a count of 10.
const NUTRITION_LEADING_COUNT_PATTERN = /^\s*(?=(\d+(?:\.\d+)?))\1(?!\s*(?:grams?|gr|g)\b)/i;
// Grams lead Amount ("325g (1x)", "31g (1 scoop)"), so the count is tried as an "Nx",
// then a number opening a parenthesis, then a leading number.
const NUTRITION_X_COUNT_PATTERN = /(\d+(?:\.\d+)?)\s*x\b/i;
const NUTRITION_PAREN_COUNT_PATTERN = /\(\s*(?=(\d+(?:\.\d+)?))\1(?!\s*(?:grams?|gr|g)\b)/i;
const NUTRITION_COUNT_PATTERNS = [NUTRITION_X_COUNT_PATTERN, NUTRITION_PAREN_COUNT_PATTERN, NUTRITION_LEADING_COUNT_PATTERN];
function nutritionCountPattern(amount) {
  const text = String(amount || '');
  return NUTRITION_COUNT_PATTERNS.find((pattern) => pattern.test(text)) || null;
}
function parseCountFromAmount(amount) {
  const pattern = nutritionCountPattern(amount);
  return pattern ? parseFloat(String(amount).match(pattern)[1]) : null;
}

// "1x (325g)" -> "325g (1x)": a count-first Amount ending in "(Ng)" gets its grams
// moved to the front; anything else is returned as typed.
const NUTRITION_COUNT_FIRST_PATTERN = /^\s*(\d+(?:\.\d+)?(?!\d|\.\d|\s*(?:grams?|gr|g)\b)[^()]*?)\s*\(\s*(\d+(?:\.\d+)?)\s*(?:grams?|gr|g)\s*\)\s*$/i;
function gramsFirstAmount(amount) {
  const match = String(amount || '').match(NUTRITION_COUNT_FIRST_PATTERN);
  return match ? `${match[2]}g (${match[1]})` : amount;
}

let allNutritionEntries = [];
// Tells "still loading" apart from an empty catalogue.
let nutritionDataLoaded = false;
let nutritionListenersAttached = false;
// Default: used today first, then protein high to low, then name A–Z.
let nSort = { key: 'today', dir: 1 };
let nCurrentPage = 1;
let nutritionSheetId = null;
let editingNutritionRow = null;
// The entry the form opened on (null in Add), for Update's old name.
let nutritionFormEntry = null;
let selectedNutritionRows = new Set();
// Panel copies of the top rows (Protein, Fiber, Fat, Carb, Energy), held aside while
// the form is open so Save writes them back without listing them twice.
let nutritionFormPanelExtras = {};
// One-shot hook fired with the saved fields after Save lands (Physique's ✏️ uses it).
// Cleared by the save and by closeNutritionForm, so it can't fire for a later form.
let nutritionFormSaveCallback = null;
// Reset by health-physique.js; nothing reads it since the Uses column was retired.
let nutritionUsageCounts = null;

// The Nutrition sheet's A1 reference for `ref`.
function nutritionA1(ref) {
  return sheetRange(CONFIG.SHEETS.NUTRITION, ref);
}

function nutritionPluralS(count) {
  return count === 1 ? '' : 's';
}

async function fetchNutritionSheetId() {
  const metadata = await getSpreadsheetMetadata();
  return findSheetId(metadata, CONFIG.SHEETS.NUTRITION);
}

async function initNutrition(forceRefresh = false) {
  if (!nutritionListenersAttached) {
    nutritionListenersAttached = true;

    document.getElementById('add-nutrition-btn').addEventListener('click', () => openNutritionForm(null));
    // health/nutrition/<name>/ opens that ingredient's Edit.
    registerRecordRoute('nutrition', (slug, sub) => {
      const n = allNutritionEntries.find((e) => routeSlug(e.name) === slug);
      if (!n || sub) return null;
      openNutritionForm(n);
      return n.name;
    });
    document.getElementById('nutrition-cancel-btn').addEventListener('click', closeNutritionForm);
    onFormSubmit('nutrition-form', submitNutritionForm);
    document.getElementById('nutrition-pull-micros-single-btn').addEventListener('click', pullMicronutrientsForForm);
    document.getElementById('nutrition-usda-choices').addEventListener('click', pickNutritionUsdaChoice);
    document.getElementById('nutrition-scan-btn').addEventListener('click', () => document.getElementById('nutrition-scan-input').click());
    document.getElementById('nutrition-scan-input').addEventListener('change', scanNutritionLabel);
    document.getElementById('nutrition-normalize-btn').addEventListener('click', normalizeIngredientForm);
    document.getElementById('nutrition-log-btn').addEventListener('click', logNutritionFromForm);
    onAsyncClick('nutrition-update-btn', updateNutritionEntryAndPropagate);

    document.getElementById('nutrition-search').addEventListener('input', () => showNutritionPage(1));

    setupNutritionSorting();
    setupNutritionBulkActions();
  }

  await refreshNutrition(forceRefresh);
}

function setupNutritionBulkActions() {
  document.getElementById('nutrition-select-all').addEventListener('change', (e) => {
    nutritionPageItems(getFilteredNutritionEntries())
      .forEach((n) => (e.target.checked ? selectedNutritionRows.add(n.row) : selectedNutritionRows.delete(n.row)));
    renderNutritionList();
  });

  onAsyncClick('nutrition-bulk-merge-btn', mergeSelectedNutritionEntries);
  onAsyncClick('nutrition-bulk-capitalize-btn', capitalizeSelectedNutritionNames);
  onAsyncClick('nutrition-pull-micros-btn', pullMicronutrientsForSelected);
  document.getElementById('log-nutrition-btn').addEventListener('click', logSelectedNutrition);
}

function setupNutritionSorting() {
  makeSortableHeaders('#nutrition-table', nSort, () => showNutritionPage(1));
}

// Moves to `page`, dropping the selection.
function showNutritionPage(page) {
  nCurrentPage = page;
  selectedNutritionRows.clear();
  renderNutritionList();
}

function nutritionPageItems(entries) {
  const start = (nCurrentPage - 1) * N_PAGE_SIZE;
  return entries.slice(start, start + N_PAGE_SIZE);
}

// The ticked entries, in sheet order.
function selectedNutritionEntries() {
  return allNutritionEntries.filter((n) => selectedNutritionRows.has(n.row)).sort((a, b) => a.row - b.row);
}

async function refreshNutrition(forceRefresh = false) {
  // Re-resolved on use, so a spreadsheet switch can't keep the old tab's id.
  nutritionSheetId = null;
  const deletesAtRead = nutritionRowDeletes;
  const resp = await getValues(NUTRITION_RANGE, VALUE_PARAMS);
  nutritionRowDeletesAtRead = deletesAtRead;
  const values = resp.values || [];
  const header = values[0] || [];

  nutritionColumnIndex = nutritionColumnsFromHeader(header);
  nutritionHeaderRow = header;
  nutritionUsedWidth = Math.max(0, ...values.map((row) => row.length));
  renameLegacyGroupHeader(header);
  const cell = (row, key) => (nutritionColumnIndex[key] === undefined ? undefined : row[nutritionColumnIndex[key]]);
  const numberOrNull = (v) => (v !== undefined && v !== '' ? Number(v) : null);

  allNutritionEntries = values.slice(1)
    .map((row, i) => ({
      row: i + 2,
      // Every cell as read.
      cells: row,
      // Free-text grouping (e.g. "Dairy"); blank on rows the app banks.
      group: cellText(cell(row, 'group')).trim(),
      name: cellText(cell(row, 'name')).trim(),
      amount: cellText(cell(row, 'amount')),
      calories: numberOrNull(cell(row, 'calories')),
      protein: numberOrNull(cell(row, 'protein')),
      // Typed Fiber/Fat/Carb (g) and TEF (kcal); null falls back to resolvedNutritionMacros.
      fiber: numberOrNull(cell(row, 'fiber')),
      fat: numberOrNull(cell(row, 'fat')),
      carb: numberOrNull(cell(row, 'carb')),
      tef: numberOrNull(cell(row, 'tef')),
      // Old Verification column: "1" locks Amount–Carbohydrates (nutritionLockedNames).
      verified: cellText(cell(row, 'legacyVerified')).trim() === '1',
      // % of desired protein this ingredient should cover; blank = untracked by Protein Source Rotation.
      proteinPercent: numberOrNull(cell(row, 'proteinPercent')),
      // JSON: the six top values, then the micronutrients, each with its lock tick.
      micronutrients: cellText(cell(row, 'micronutrients')).trim(),
    }))
    .filter((n) => n.name);
  migrateNutritionAmountOrder();

  nutritionDataLoaded = true;
  renderNutritionList();
}

// Header row -> { key: column }; without a Name header, NUTRITION_COLUMNS order.
function nutritionColumnsFromHeader(headerRow) {
  const names = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  const index = {};
  NUTRITION_COLUMNS.forEach(({ key, header }) => {
    const i = names.indexOf(header.toLowerCase());
    if (i !== -1) index[key] = i;
  });
  const legacy = names.indexOf('verification');
  if (legacy !== -1) index.legacyVerified = legacy;
  // Group was called Classification (renameLegacyGroupHeader renames it).
  const classification = names.indexOf('classification');
  if (index.group === undefined && classification !== -1) index.group = classification;
  return index.name === undefined ? NUTRITION_DEFAULT_COLUMNS : index;
}

// Renames an old "Classification" header cell to Group; a failure retries next load.
function renameLegacyGroupHeader(headerRow) {
  const i = headerRow.findIndex((h) => String(h ?? '').trim().toLowerCase() === 'classification');
  if (i === -1) return;
  updateValues(nutritionA1(`${sheetColumnLetter(i)}1`), [['Group']]).catch(() => {});
}

// Rewrites old count-first Amounts ("1x (325g)") grams-first, in one batch; a
// failed write retries next load.
function migrateNutritionAmountOrder() {
  if (nutritionColumnIndex.amount === undefined) return;
  const changed = allNutritionEntries.filter((n) => gramsFirstAmount(n.amount) !== n.amount);
  if (changed.length === 0) return;
  changed.forEach((n) => { n.amount = gramsFirstAmount(n.amount); });
  // A delete sent since the read shifts the rows; its reload migrates instead.
  if (nutritionRowDeletes !== nutritionRowDeletesAtRead) return;
  batchUpdateValues(changed.map((n) => ({ range: nutritionCellRange('amount', n.row), values: [[n.amount]] })), 'RAW')
    .catch(() => {});
}

// Column letter(s) for a 0-based index (0 -> A, 26 -> AA), for any tab.
function sheetColumnLetter(i) {
  let letters = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

// The A1 range for one key's cell on `row`.
function nutritionCellRange(key, row) {
  return nutritionA1(`${sheetColumnLetter(nutritionColumnIndex[key])}${row}`);
}

function nutritionCellValue(entry, key) {
  const value = entry[key];
  return value === null || value === undefined ? '' : value;
}

// Only the app's columns, RAW (none is a date or formula): "1/2" or "711" stays as
// typed, and the user's own columns are never rewritten.
async function writeNutritionRow(row, entry) {
  const data = NUTRITION_COLUMNS
    .filter(({ key }) => nutritionColumnIndex[key] !== undefined)
    .map(({ key }) => ({ range: nutritionCellRange(key, row), values: [[nutritionCellValue(entry, key)]] }));
  await batchUpdateValues(data, 'RAW');
}

// A new row has nothing to keep, so the columns between the app's go blank.
async function appendNutritionRow(entry) {
  const width = Math.max(...NUTRITION_COLUMNS.map(({ key }) => nutritionColumnIndex[key] ?? -1)) + 1;
  const cells = Array(width).fill('');
  NUTRITION_COLUMNS.forEach(({ key }) => {
    if (nutritionColumnIndex[key] !== undefined) cells[nutritionColumnIndex[key]] = nutritionCellValue(entry, key);
  });
  await appendValues(nutritionA1(`A:${sheetColumnLetter(width - 1)}`), [cells], 'RAW');
}

// Fiber/Fat/Carb grams from the row's pulled 🧬 Micronutrients panel; null when never pulled.
function computedNutritionMacros(n) {
  const parsed = parseMicronutrients(n.micronutrients);
  if (!parsed) return { fiber: null, fat: null, carb: null };
  const amountOf = (name) => (parsed[name] ? parsed[name].amount : null);
  return {
    fiber: amountOf('Fiber, total dietary'),
    fat: amountOf('Total lipid (fat)'),
    carb: amountOf('Carbohydrate, by difference'),
  };
}

// Fiber/Fat/Carb/TEF: the typed figure, else the panel estimate (TEF: the formula on
// typed Protein plus the resolved Carb/Fat). Same order as resolveIngredientMacros.
function resolvedNutritionMacros(n) {
  const computed = computedNutritionMacros(n);
  const fiber = n.fiber !== null ? n.fiber : computed.fiber;
  const fat = n.fat !== null ? n.fat : computed.fat;
  const carb = n.carb !== null ? n.carb : computed.carb;

  let tef = n.tef;
  const tefTyped = n.tef !== null;
  if (tef === null && n.protein !== null) tef = Math.round(tefFromMacros(n.protein, carb, fat));

  return {
    fiber, fat, carb, tef,
    typed: { fiber: n.fiber !== null, fat: n.fat !== null, carb: n.carb !== null, tef: tefTyped },
  };
}

const NUTRITION_TYPED_TOOLTIP = 'Typed by you.';
const NUTRITION_ESTIMATE_TOOLTIP = 'Estimated from 🧬 Micronutrients — select this row and click Complete below if it hasn\'t been pulled yet.';
const NUTRITION_TEF_ESTIMATE_TOOLTIP = 'Estimated: Protein (typed) plus Carb/Fat (typed or from 🧬 Micronutrients) at the Atwater/TEF-share rates set in Settings.';

// One Fiber/Fat/Carb/TEF table cell, its hover saying typed or estimated.
function nutritionMacroCell(value, isTyped, typedTooltip = NUTRITION_TYPED_TOOLTIP, estimateTooltip = NUTRITION_ESTIMATE_TOOLTIP) {
  if (value === null) return makeCell('—', 'Not typed — and nothing to estimate from yet.');
  return makeCell(String(value), isTyped ? typedTooltip : estimateTooltip);
}

function getFilteredNutritionEntries() {
  const search = document.getElementById('nutrition-search').value.trim().toLowerCase();
  // Group too, so "dairy" pulls up the whole group.
  const filtered = allNutritionEntries.filter((n) => !search
    || n.name.toLowerCase().includes(search)
    || n.group.toLowerCase().includes(search));

  const { key, dir } = nSort;
  const usedToday = key === 'today' ? todaysUsedNutritionRows() : null;
  return [...filtered].sort((a, b) => {
    if (key === 'today') {
      return (usedToday.has(b.row) - usedToday.has(a.row))
        || ((b.protein ?? 0) - (a.protein ?? 0))
        || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }
    if (key === 'calories' || key === 'protein' || key === 'proteinPercent') return ((a[key] ?? 0) - (b[key] ?? 0)) * dir;
    if (NUTRITION_MACRO_KEYS.includes(key)) {
      return ((resolvedNutritionMacros(a)[key] ?? 0) - (resolvedNutritionMacros(b)[key] ?? 0)) * dir;
    }
    return String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' }) * dir;
  });
}

// The Micronutrients cell keyed by USDA name: top rows under their panel name (Calories
// and TEF dropped), old lock list skipped. Malformed JSON reads as "nothing pulled".
function parseMicronutrients(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const nutrients = {};
    Object.entries(parsed).forEach(([name, info]) => {
      if (name === NUTRITION_LOCK_KEY || !info || typeof info !== 'object') return;
      const top = nutritionTopRow(name);
      if ((top && !top.panel) || info.amount === null) return;
      nutrients[top ? top.panel : name] = { amount: info.amount, unit: standardUnit(info.unit) };
    });
    return Object.keys(nutrients).length ? nutrients : null;
  } catch {
    return null;
  }
}

// Form rows: a ticked row is locked and Complete never overwrites it. "_locked"
// is the old lock list, still read from cells saved before per-entry ticks.
const NUTRITION_LOCK_KEY = '_locked';
const NUTRITION_TOP_ROWS = [
  { name: 'Calories', unit: 'kcal', key: 'calories', inputId: 'nutrition-calories', lockId: 'nutrition-lock-calories' },
  { name: 'Protein', unit: 'g', key: 'protein', inputId: 'nutrition-protein', lockId: 'nutrition-lock-protein', panel: 'Protein' },
  { name: 'Dietary Fiber', unit: 'g', key: 'fiber', inputId: 'nutrition-fiber', lockId: 'nutrition-lock-fiber', panel: 'Fiber, total dietary' },
  { name: 'Fat', unit: 'g', key: 'fat', inputId: 'nutrition-fat', lockId: 'nutrition-lock-fat', panel: 'Total lipid (fat)' },
  { name: 'Carbohydrates', unit: 'g', key: 'carb', inputId: 'nutrition-carb', lockId: 'nutrition-lock-carb', panel: 'Carbohydrate, by difference' },
  { name: 'TEF', unit: 'kcal', key: 'tef', inputId: 'nutrition-tef', lockId: 'nutrition-lock-tef' },
];
// What an old "Verified" ✓ vouched for: the label's own figures, not TEF.
const NUTRITION_LABEL_ROWS = ['Calories', 'Protein', 'Dietary Fiber', 'Fat', 'Carbohydrates'];
const NUTRITION_TOP_PANEL_KEYS = new Set([...NUTRITION_TOP_ROWS.map((r) => r.panel).filter(Boolean), 'Energy']);

function nutritionTopRow(name) {
  return NUTRITION_TOP_ROWS.find((r) => r.name === name);
}

// A top row's USDA panel name (Calories is "Energy"); any other name as given.
function nutritionPanelName(name) {
  return name === 'Calories' ? 'Energy' : nutritionTopRow(name)?.panel ?? name;
}

// A row's locked names: each entry's own `locked` flag, else the older "_locked"
// list, else an old Verified meaning Amount–Carbohydrates.
function nutritionLockedNames(n) {
  let raw = null;
  try { raw = JSON.parse(n.micronutrients || 'null'); } catch { raw = null; }
  if (raw && typeof raw === 'object') {
    const flagged = Object.entries(raw).filter(([, info]) => info && typeof info === 'object' && 'locked' in info);
    if (flagged.length) return new Set(flagged.filter(([, info]) => info.locked).map(([name]) => name));
    if (Array.isArray(raw[NUTRITION_LOCK_KEY])) return new Set(raw[NUTRITION_LOCK_KEY]);
  }
  return new Set(n.verified ? NUTRITION_LABEL_ROWS : []);
}

// The six top values as the form shows them, keyed by row name.
function nutritionTopValues(n) {
  const macros = resolvedNutritionMacros(n);
  return {
    Calories: n.calories, Protein: n.protein,
    'Dietary Fiber': macros.fiber, Fat: macros.fat, Carbohydrates: macros.carb, TEF: macros.tef,
  };
}

// The Micronutrients cell: the six top values by form name, then the panel (minus
// its own copies of the top values), each with its `locked` tick. '' when empty.
function nutritionColumnL(top, panel, locked) {
  const out = {};
  NUTRITION_TOP_ROWS.forEach((row) => {
    out[row.name] = { amount: top[row.name] ?? null, unit: row.unit, locked: locked.has(row.name) };
  });
  Object.entries(panel || {}).forEach(([name, info]) => {
    if (NUTRITION_TOP_PANEL_KEYS.has(name)) return;
    out[name] = { amount: info.amount, unit: info.unit, locked: locked.has(name) };
  });
  const empty = Object.values(out).every((e) => e.amount === null && !e.locked);
  return empty ? '' : JSON.stringify(out);
}

function renderNutritionList() {
  const tbody = document.getElementById('nutrition-body');
  tbody.innerHTML = '';

  const filtered = getFilteredNutritionEntries();
  const totalPages = Math.max(1, Math.ceil(filtered.length / N_PAGE_SIZE));
  nCurrentPage = Math.min(nCurrentPage, totalPages);
  const pageItems = nutritionPageItems(filtered);

  if (pageItems.length === 0) {
    const message = allNutritionEntries.length === 0
      ? 'No ingredients yet — they\'re added automatically the first time Calculate looks one up, or click "Add" in the panel heading to add one yourself.'
      : 'No ingredients match your search.';
    tbody.appendChild(renderEmptyRow(13, message));
  }

  // Once per render: it walks today's whole breakdown.
  const usedToday = todaysUsedNutritionRows();

  pageItems.forEach((n) => {
    const tr = document.createElement('tr');
    tr.classList.toggle('nutrition-row-logged', usedToday.has(n.row));

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedNutritionRows.has(n.row);
    checkbox.setAttribute('aria-label', 'Select ingredient');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedNutritionRows.add(n.row);
      else selectedNutritionRows.delete(n.row);
      updateNutritionSelectAllCheckbox(pageItems);
      updateNutritionBulkActionsUI();
    });
    checkboxCell.appendChild(checkbox);

    const isUsable = parseGramsFromAmount(n.amount) !== null || parseCountFromAmount(n.amount) !== null;
    const unusable = n.amount && !isUsable;
    const amountCell = makeCell(
      unusable ? `${n.amount} ⚠️` : (n.amount || '—'),
      unusable ? 'No gram mass or count found — Calculate will skip this row and re-estimate instead' : undefined
    );

    const macros = resolvedNutritionMacros(n);

    tr.append(
      checkboxCell,
      makeCell(n.group || '—'),
      makeCell(n.name),
      amountCell,
      makeCell(n.calories !== null ? String(n.calories) : '—'),
      makeCell(n.protein !== null ? String(n.protein) : '—'),
      nutritionMacroCell(macros.fiber, macros.typed.fiber),
      nutritionMacroCell(macros.fat, macros.typed.fat),
      nutritionMacroCell(macros.carb, macros.typed.carb),
      nutritionMacroCell(macros.tef, macros.typed.tef, NUTRITION_TYPED_TOOLTIP, NUTRITION_TEF_ESTIMATE_TOOLTIP),
      makeCell(n.proteinPercent !== null ? `${n.proteinPercent}%` : '—', 'Tracked by the Protein Source Rotation chart when set — the % of your desired protein this ingredient should cover'),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => {
        routeRecordEdit('nutrition', { slug: routeSlug(n.name), label: n.name });
        openNutritionForm(n);
      } }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteNutritionEntry(n) }),
    );
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  updateNutritionSelectAllCheckbox(pageItems);
  updateNutritionBulkActionsUI();
  renderNutritionPagination(totalPages);
}

function updateNutritionSelectAllCheckbox(pageItems) {
  const selectAll = document.getElementById('nutrition-select-all');
  const selectedOnPage = pageItems.filter((n) => selectedNutritionRows.has(n.row)).length;
  selectAll.checked = pageItems.length > 0 && selectedOnPage === pageItems.length;
  selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageItems.length;
}

function updateNutritionBulkActionsUI() {
  const bar = document.getElementById('nutrition-bulk-actions');
  const count = selectedNutritionRows.size;
  bar.hidden = count === 0;
  document.getElementById('nutrition-bulk-summary').textContent = count > 0 ? `${count} selected` : '';
  document.getElementById('nutrition-bulk-merge-btn').disabled = count < 2;
  updateNutritionLogButtonLabel();
}

// A 📝 button whose hover says whether today's Consumption already has lines.
function setNutritionLogButtonHover(btnId, subject) {
  const today = todaysPhysiqueDay();
  const hasToday = Boolean(today && today.consumption && today.consumption.trim());
  const btn = document.getElementById(btnId);
  btn.textContent = '📝';
  btn.title = hasToday
    ? `Add ${subject} to today's Consumption`
    : `Log ${subject} as today's Consumption`;
}

function updateNutritionLogButtonLabel() {
  setNutritionLogButtonHover('log-nutrition-btn', 'the ticked ingredients');
}

// "x" for a per-each row (Amount has an "Nx" count, e.g. "58g (1x)"), else "g".
function nutritionLogUnit(amount) {
  return NUTRITION_X_COUNT_PATTERN.test(String(amount || '')) ? 'x' : 'g';
}

// Appends `lines` to today's Consumption and opens the day's form on them, with no
// Calculate: the user types each amount first. `beforeOpen` runs once routed.
function logToTodaysConsumption(lines, beforeOpen = () => {}) {
  const today = todaysPhysiqueDay();
  const consumption = [today?.consumption ?? '', ...lines]
    .filter((part) => part.trim())
    .join('\n');

  routeRecordEdit('physique', todayPhysiqueRouteStep());
  beforeOpen();
  openPhysiqueForm(today);
  if (today) setPhysiqueFormHint("Add to Today's Consumption");
  physiqueField('consumption').value = consumption;
}

// Logs the ticked ingredients as bare "g name" / "x name" lines.
function logSelectedNutrition() {
  const selected = selectedNutritionEntries();
  if (selected.length === 0) {
    alert('Tick at least one ingredient before logging it to Consumption.');
    return;
  }

  logToTodaysConsumption(selected.map((n) => `${nutritionLogUnit(n.amount)} ${n.name}`));

  selectedNutritionRows.clear();
  renderNutritionList();
}

function renderNutritionPagination(totalPages) {
  renderPager('nutrition-pagination', {
    page: nCurrentPage,
    totalPages,
    onChange: showNutritionPage,
  });
}

function openNutritionForm(entry, onSaved = null) {
  editingNutritionRow = entry ? entry.row : null;
  nutritionFormSaveCallback = onSaved;
  nutritionFormEntry = entry || null;

  // Update needs a saved row: a synthetic entry with no row (Physique's ✏️) is an Add.
  document.getElementById('nutrition-update-btn').hidden = !(entry && entry.row);
  document.getElementById('nutrition-group').value = entry ? entry.group : '';
  renderNutritionGroupOptions();
  document.getElementById('nutrition-name').value = entry ? entry.name : '';
  document.getElementById('nutrition-amount').value = entry ? entry.amount : '';
  document.getElementById('nutrition-usda-source').hidden = true;
  hideNutritionUsdaChoices();
  document.getElementById('nutrition-calories').value = (entry && entry.calories !== null) ? entry.calories : '';
  document.getElementById('nutrition-protein').value = (entry && entry.protein !== null) ? entry.protein : '';
  // Prefilled with what the table shows (typed or estimated), so Save keeps it as-is.
  const macros = entry ? resolvedNutritionMacros(entry) : { fiber: null, fat: null, carb: null, tef: null };
  NUTRITION_MACRO_KEYS.forEach((key) => { document.getElementById(`nutrition-${key}`).value = macros[key] ?? ''; });
  const locked = entry ? nutritionLockedNames(entry) : new Set();
  NUTRITION_TOP_ROWS.forEach((row) => { document.getElementById(row.lockId).checked = locked.has(row.name); });
  document.getElementById('nutrition-protein-percent').value = (entry && entry.proteinPercent !== null) ? entry.proteinPercent : '';

  renderNutritionMicroRows(entry ? parseMicronutrients(entry.micronutrients) : null, locked);

  updateNutritionFormLogButtonLabel();
  clearFieldError('nutrition-form-error');
  document.getElementById('nutrition-modal').hidden = false;
}

function updateNutritionFormLogButtonLabel() {
  setNutritionLogButtonHover('nutrition-log-btn', 'this ingredient');
}

// Logs the form's Name/Amount as one Consumption line, saved to the catalogue or not.
function logNutritionFromForm() {
  const name = document.getElementById('nutrition-name').value.trim();
  const amount = document.getElementById('nutrition-amount').value.trim();
  if (!name) {
    showFieldError('nutrition-form-error', 'Enter a Name before logging it to Consumption.');
    return;
  }

  // Closed once routed, so this form hands its history entry to the day's.
  logToTodaysConsumption([`${nutritionLogUnit(amount)} ${name}`], closeNutritionForm);
}

// The Canadian Nutrition Facts lines, in order. `names` are the spellings a line may
// carry (a top row's name, or USDA names, which vary by data source); the first one
// present is used. Shown under `label` in the form, Micronutrients Insight and
// Physique's 🧬 view; the saved data keeps its own names.
const NUTRITION_FACTS_ORDER = [
  { label: 'Calories', names: ['Calories'] },
  { label: 'Fat', names: ['Fat'] },
  { label: 'Saturated', names: ['Fatty acids, total saturated'] },
  { label: 'Trans', names: ['Fatty acids, total trans'] },
  { label: 'Polyunsaturated', names: ['Fatty acids, total polyunsaturated'] },
  { label: 'Omega-6', names: ['PUFA 18:2 n-6 c,c', 'PUFA 18:2'] }, // linoleic acid
  { label: 'Omega-3, ALA', names: ['PUFA 18:3 n-3 c,c,c (ALA)', 'PUFA 18:3'] }, // alpha-linolenic acid
  { label: 'Monounsaturated', names: ['Fatty acids, total monounsaturated'] },
  { label: 'Carbohydrate', names: ['Carbohydrates'] },
  { label: 'Fibre', names: ['Dietary Fiber'] },
  { label: 'Soluble Fibre', names: ['Fiber, soluble'] },
  { label: 'Insoluble Fibre', names: ['Fiber, insoluble'] },
  { label: 'Sugars', names: ['Sugars, total including NLEA', 'Total Sugars', 'Sugars, Total'] },
  { label: 'Sugar Alcohols', names: ['Sugar alcohols'] },
  { label: 'Starch', names: ['Starch'] },
  { label: 'Protein', names: ['Protein'] },
  { label: 'Cholesterol', names: ['Cholesterol'] },
  { label: 'Sodium', names: ['Sodium, Na'] },
  { label: 'Potassium', names: ['Potassium, K'] },
  { label: 'Calcium', names: ['Calcium, Ca'] },
  { label: 'Iron', names: ['Iron, Fe'] },
];

// USDA panel name -> { rank, label } for the Nutrition Facts lines present in `names`
// (one name per line: the first of its spellings present).
function nutritionFactsRanks(names) {
  const present = new Set(names);
  const ranks = new Map();
  NUTRITION_FACTS_ORDER.forEach(({ label, names: spellings }, rank) => {
    const found = spellings.map(nutritionPanelName).find((n) => present.has(n));
    if (found) ranks.set(found, { rank, label });
  });
  return ranks;
}

// Lays out the form's value rows: TEF, then the Nutrition Facts lines (top rows and
// micronutrients alike), then under the divider every other micronutrient
// alphabetically, the zero ones last under their own rule. Top-row panel entries
// go to nutritionFormPanelExtras instead of being listed twice.
function renderNutritionMicroRows(panel, locked) {
  const box = document.getElementById('nutrition-fields');
  box.querySelectorAll('.nutrition-micro-row').forEach((el) => el.remove());
  nutritionFormPanelExtras = {};
  const microNames = [];
  Object.keys(panel || {}).sort((a, b) => a.localeCompare(b)).forEach((name) => {
    if (NUTRITION_TOP_PANEL_KEYS.has(name)) nutritionFormPanelExtras[name] = { ...panel[name] };
    else microNames.push(name);
  });

  // Lock tick, name, typeable box, unit.
  const microRow = (name, displayName = name) => {
    const label = document.createElement('label');
    label.className = 'formula-row nutrition-micro-row';
    const lock = document.createElement('input');
    lock.type = 'checkbox';
    lock.dataset.lockName = name;
    lock.checked = locked.has(name);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'formula-name';
    nameSpan.textContent = displayName;
    if (displayName !== name) label.title = name;
    const value = document.createElement('input');
    value.type = 'text';
    value.dataset.microName = name;
    value.dataset.unit = panel[name].unit;
    value.value = panel[name].amount;
    const unit = document.createElement('span');
    unit.className = 'formula-unit';
    unit.textContent = panel[name].unit;
    label.append(lock, nameSpan, value, unit);
    return label;
  };
  // A top row's static label, shown under the line's `label` when given.
  const topRow = (name, label = null) => {
    const row = nutritionTopRow(name);
    if (!row) return null;
    const el = document.getElementById(row.inputId).closest('label');
    el.querySelector('.formula-name').textContent = label ?? row.name;
    return el;
  };

  const ordered = [topRow('TEF')];
  const placed = new Set();
  NUTRITION_FACTS_ORDER.forEach(({ label, names }) => {
    const top = names.map((n) => topRow(n, label)).find(Boolean);
    if (top) {
      ordered.push(top);
      return;
    }
    const name = names.find((n) => microNames.includes(n));
    if (name) {
      ordered.push(microRow(name, label));
      placed.add(name);
    }
  });

  // The rest: non-zero first, each half alphabetical.
  const rest = microNames.filter((name) => !placed.has(name))
    .sort((a, b) => (Number(panel[a].amount) === 0) - (Number(panel[b].amount) === 0));
  const divider = document.getElementById('nutrition-micro-divider');
  divider.hidden = rest.length === 0;
  box.append(...ordered, divider);

  // A rule before the first zero row, unless every row is zero or none is.
  const firstZero = rest.findIndex((name) => Number(panel[name].amount) === 0);
  rest.forEach((name, i) => {
    if (i === firstZero && i > 0) {
      const rule = document.createElement('hr');
      rule.className = 'formula-divider nutrition-micro-row';
      box.appendChild(rule);
    }
    box.appendChild(microRow(name));
  });
}

// Every ticked row's name (top rows and micronutrients).
function nutritionFormLockedNames() {
  return new Set([...document.querySelectorAll('#nutrition-fields input[type="checkbox"][data-lock-name]:checked')]
    .map((box) => box.dataset.lockName));
}

// A micronutrient box's number at full precision (USDA runs to 4 decimals); an
// arithmetic expression falls back to the shared evaluator.
function microAmountValue(raw) {
  const text = raw.trim();
  if (!text) return null;
  const plain = Number(text);
  return Number.isFinite(plain) ? plain : evaluateNumberExpression(text);
}

// Rounded to the 4 decimals micronutrient amounts are kept at.
function roundNutrientAmount(value) {
  return Math.round(value * 10000) / 10000;
}

// The panel as the form shows it: the typed micro rows plus the held top-row entries.
function readNutritionFormPanel() {
  const panel = {};
  document.querySelectorAll('#nutrition-fields .nutrition-micro-row input[type="text"]').forEach((input) => {
    const value = microAmountValue(input.value);
    if (value !== null) panel[input.dataset.microName] = { amount: value, unit: input.dataset.unit };
  });
  Object.entries(nutritionFormPanelExtras).forEach(([name, info]) => { panel[name] = { ...info }; });
  return panel;
}

// Groups already in use, most-used first, so the free text doesn't fragment.
function renderNutritionGroupOptions() {
  const counts = new Map();
  allNutritionEntries
    .filter((n) => n.group)
    .forEach((n) => counts.set(n.group, (counts.get(n.group) || 0) + 1));

  const dl = document.getElementById('nutrition-group-options');
  dl.innerHTML = '';
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([value]) => {
      const opt = document.createElement('option');
      opt.value = value;
      dl.appendChild(opt);
    });
}

function closeNutritionForm() {
  document.getElementById('nutrition-modal').hidden = true;
  editingNutritionRow = null;
  nutritionFormPanelExtras = {};
  nutritionFormSaveCallback = null;
  nutritionFormEntry = null;
}

// The form's Complete: lists USDA's top matches (branded foods too) under Amount and
// fills the form from the one clicked. Amount is never written.
const USDA_FORM_SEARCH = { pageSize: 10, dataType: 'Foundation,SR Legacy,Survey (FNDDS),Branded' };
let nutritionUsdaChoices = [];

async function pullMicronutrientsForForm() {
  const btn = document.getElementById('nutrition-pull-micros-single-btn');
  const name = document.getElementById('nutrition-name').value.trim();
  const amount = document.getElementById('nutrition-amount').value.trim();

  clearFieldError('nutrition-form-error');
  hideNutritionUsdaChoices();
  if (!name) {
    showFieldError('nutrition-form-error', 'Type an ingredient name first — that name is what gets looked up.');
    return;
  }
  const grams = parseGramsFromAmount(amount);
  if (grams === null) {
    showFieldError('nutrition-form-error', `Couldn't pull micronutrients for "${name}" — Amount has no gram figure to scale from.`);
    return;
  }

  btn.disabled = true;
  Motion.iconBusy(btn);

  let candidates = [];
  let reason = 'no USDA match';
  try {
    candidates = await usdaLookupKcalCandidates(name, USDA_FORM_SEARCH);
  } catch (err) {
    reason = err.message;
  }

  btn.disabled = false;
  Motion.iconSettle(btn);

  if (!candidates.length) {
    showFieldError('nutrition-form-error', `Couldn't pull micronutrients for "${name}" — ${reason}.`);
    return;
  }

  // Closest to the ticked values first; USDA's order when nothing is ticked.
  const typed = nutritionFormTickedValues();
  const ranked = candidates
    .map((c) => ({ c, match: usdaCandidateMatch(c, grams, typed) }))
    .sort((a, b) => (b.match ?? 0) - (a.match ?? 0));

  nutritionUsdaChoices = ranked.map((r) => r.c);
  const list = document.getElementById('nutrition-usda-choices');
  list.replaceChildren(...ranked.map(({ c, match }, i) => {
    const r = usdaCandidateResult(c, grams);
    const li = document.createElement('li');
    li.dataset.index = String(i);
    li.textContent = [
      c.description, c.brand, c.dataType,
      `${r.calories} kcal, ${r.protein ?? '?'}g protein in ${grams}g`,
      match !== null ? `${Math.round(match * 100)}% match` : '',
    ].filter(Boolean).join(' · ');
    return li;
  }));
  list.hidden = false;
}

// Ticked rows with a typed number, keyed by USDA nutrient name ('Energy' for Calories).
function nutritionFormTickedValues() {
  const locked = nutritionFormLockedNames();
  const panel = readNutritionFormPanel();
  const typed = new Map();
  NUTRITION_TOP_ROWS.forEach((row) => {
    if (!locked.has(row.name) || row.name === 'TEF') return;
    const value = microAmountValue(document.getElementById(row.inputId).value);
    if (value !== null) typed.set(nutritionPanelName(row.name), value);
  });
  locked.forEach((name) => { if (panel[name] && !typed.has(name)) typed.set(name, panel[name].amount); });
  return typed;
}

// 0–1 similarity of a candidate (scaled to grams) to the typed values; a missing figure counts as 0.
function usdaCandidateMatch(candidate, grams, typed) {
  if (!typed.size) return null;
  const scale = grams / 100;
  let total = 0;
  typed.forEach((value, name) => {
    const per100 = name === 'Energy' ? candidate.kcalPer100g : candidate.nutrients.find((n) => n.name === name)?.amountPer100g;
    if (per100 === undefined) return;
    const other = per100 * scale;
    const larger = Math.max(Math.abs(value), Math.abs(other));
    total += larger === 0 ? 1 : 1 - Math.abs(value - other) / larger;
  });
  return total / typed.size;
}

function hideNutritionUsdaChoices() {
  const list = document.getElementById('nutrition-usda-choices');
  list.hidden = true;
  list.replaceChildren();
  nutritionUsdaChoices = [];
}

function pickNutritionUsdaChoice(e) {
  const item = e.target.closest('li');
  const candidate = item && nutritionUsdaChoices[Number(item.dataset.index)];
  if (!candidate) return;
  hideNutritionUsdaChoices();
  const grams = parseGramsFromAmount(document.getElementById('nutrition-amount').value.trim());
  if (grams === null) {
    showFieldError('nutrition-form-error', 'Amount has no gram figure to scale from.');
    return;
  }
  applyNutritionUsdaResult(usdaCandidateResult(candidate, grams));
}

// Fills the form from one picked USDA result.
function applyNutritionUsdaResult(result) {
  // Links the USDA food the figures came from.
  const source = document.getElementById('nutrition-usda-source');
  source.replaceChildren('USDA: ', Object.assign(document.createElement('a'), {
    href: `https://fdc.nal.usda.gov/food-details/${result.fdcId}/nutrients`,
    target: '_blank',
    rel: 'noopener',
    textContent: result.description,
  }));
  source.hidden = false;

  // Ticked rows are kept; the rest take USDA's figure. TEF has none, so an unticked
  // one is re-estimated from the new Protein/Carb/Fat.
  const locked = nutritionFormLockedNames();
  const nutrients = result.nutrients || {};
  NUTRITION_TOP_ROWS.forEach((row) => {
    if (locked.has(row.name) || row.name === 'TEF') return;
    let value = null;
    if (row.name === 'Calories') value = result.calories;
    else if (row.name === 'Protein') value = result.protein;
    else if (row.panel) value = nutrients[row.panel] ? nutrients[row.panel].amount : null;
    document.getElementById(row.inputId).value = value !== null && value !== undefined ? String(value) : '';
  });
  if (!locked.has('TEF')) estimateNutritionFormTef();

  // The new panel, except ticked micronutrient rows keep their own values.
  const current = readNutritionFormPanel();
  const merged = { ...nutrients };
  locked.forEach((name) => { if (current[name]) merged[name] = current[name]; });
  renderNutritionMicroRows(merged, locked);

  if (!locked.has('Protein') && result.protein === null) {
    showFieldError('nutrition-form-error', `"${result.description}" has no protein figure in USDA — fill Protein in yourself before saving.`);
  }
}

// TEF has no label or USDA figure: the estimate from the form's Protein/Carb/Fat.
function estimateNutritionFormTef() {
  const box = (id) => evaluateNumberExpression(document.getElementById(id).value.trim());
  const { tef } = resolvedNutritionMacros({
    protein: box('nutrition-protein'), fiber: box('nutrition-fiber'), fat: box('nutrition-fat'),
    carb: box('nutrition-carb'), tef: null, micronutrients: '',
  });
  document.getElementById('nutrition-tef').value = tef ?? '';
}

// --- Scan: a photographed Nutrition Facts label fills the form ----------------

// The names a label line may map to: the top rows, the micronutrient panel names
// (health-nutrient-desired.js), plus label lines with no desired figure.
function nutritionLabelNames() {
  const top = NUTRITION_TOP_ROWS.filter((r) => r.panel).map((r) => ({ name: r.name, unit: r.unit }));
  const skip = new Set([...NUTRITION_TOP_PANEL_KEYS, 'Protein', 'Water']);
  const micros = Object.entries(NUTRIENT_DAILY_DESIRED_DEFAULT)
    .filter(([name]) => !skip.has(name))
    .map(([name, desired]) => ({ name, unit: desired.unit }));
  const extras = ['Fatty acids, total trans', 'Fatty acids, total monounsaturated', 'Fatty acids, total polyunsaturated',
    'Sugars, total including NLEA', 'Fiber, soluble', 'Fiber, insoluble', 'Sugar alcohols', 'Starch']
    .map((name) => ({ name, unit: 'g' }));
  return [...top, ...micros, ...extras];
}

// Health Canada's Daily Values where they differ from the FDA's, for a line
// printed only as a % DV.
const CANADA_DAILY_VALUES = {
  Fat: { amount: 75, unit: 'g' },
  'Dietary Fiber': { amount: 28, unit: 'g' },
  'Fatty acids, total saturated': { amount: 20, unit: 'g' },
  'Sugars, total including NLEA': { amount: 100, unit: 'g' },
  'Potassium, K': { amount: 3400, unit: 'mg' },
};

const MASS_UNIT_GRAMS = { g: 1, mg: 1e-3, 'µg': 1e-6 };

function massUnit(unit) {
  const u = String(unit || '').trim().toLowerCase();
  if (['mcg', 'ug', 'μg', 'µg'].includes(u)) return 'µg';
  return MASS_UNIT_GRAMS[u] ? u : null;
}

// A label line's amount in `unit`: the printed amount, or its % DV of the daily value.
function labelLineAmount(line, unit) {
  const amount = Number.parseFloat(line.amount);
  const from = massUnit(line.unit) || unit;
  if (Number.isFinite(amount) && MASS_UNIT_GRAMS[from] && MASS_UNIT_GRAMS[unit]) {
    return amount * MASS_UNIT_GRAMS[from] / MASS_UNIT_GRAMS[unit];
  }
  const percent = Number.parseFloat(line.percentDV);
  const dv = CANADA_DAILY_VALUES[line.name] || NUTRIENT_DAILY_DESIRED_DEFAULT[line.name];
  if (!Number.isFinite(percent) || !dv || !MASS_UNIT_GRAMS[dv.unit]) return null;
  return (percent / 100) * dv.amount * MASS_UNIT_GRAMS[dv.unit] / MASS_UNIT_GRAMS[unit];
}

// Small enough for the API, sharp enough to read.
const NUTRITION_SCAN_MAX_SIDE_PX = 1600;
const NUTRITION_SCAN_JPEG_QUALITY = 0.85;

// The photo as base64 JPEG, longest side capped; the raw file if it can't be decoded.
async function labelPhotoBase64(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, NUTRITION_SCAN_MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL('image/jpeg', NUTRITION_SCAN_JPEG_QUALITY).split(',')[1], type: 'image/jpeg' };
  } catch {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return { base64, type: file.type };
  }
}

// Fills the form from the label, as Complete does from USDA: ticked rows are kept,
// other micronutrients already in the form stay. A blank Name and Amount take the
// label's; a typed gram Amount rescales the label's per-serving figures to it.
async function scanNutritionLabel(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  const btn = document.getElementById('nutrition-scan-btn');
  btn.disabled = true;
  Motion.iconBusy(btn);
  clearFieldError('nutrition-form-error');

  try {
    const names = nutritionLabelNames();
    const { base64, type } = await labelPhotoBase64(file);
    const label = await aiReadNutritionLabel(base64, type, names);
    const units = new Map(names.map((n) => [n.name, n.unit]));
    // The model sometimes echoes a unit after the name: "Fat (g)".
    const knownName = (name) => (units.has(name) ? name : String(name || '').replace(/\s*\([^)]*\)\s*$/, ''));
    const lines = label.nutrients
      .map((line) => ({ ...line, name: knownName(line.name) }))
      .filter((line) => units.has(line.name));
    if (!lines.length && !Number.isFinite(Number.parseFloat(label.calories))) {
      throw new Error("couldn't find a Nutrition Facts table in that photo");
    }

    const nameField = document.getElementById('nutrition-name');
    if (!nameField.value.trim() && label.name) nameField.value = titleCaseIngredientName(label.name);
    const amountField = document.getElementById('nutrition-amount');
    const labelGrams = Number.parseFloat(label.servingGrams) || parseGramsFromAmount(label.serving || '');
    let factor = 1;
    if (!amountField.value.trim()) {
      if (label.serving) amountField.value = label.serving;
    } else {
      const typedGrams = parseGramsFromAmount(amountField.value);
      if (typedGrams && labelGrams) factor = typedGrams / labelGrams;
    }
    const scaled = (value) => Number((value * factor).toFixed(4));

    const locked = nutritionFormLockedNames();
    const calories = Number.parseFloat(label.calories);
    if (!locked.has('Calories') && Number.isFinite(calories)) {
      document.getElementById('nutrition-calories').value = String(scaled(calories));
    }
    const panel = readNutritionFormPanel();
    lines.forEach((line) => {
      if (locked.has(line.name)) return;
      const unit = units.get(line.name);
      const amount = labelLineAmount(line, unit);
      if (amount === null) return;
      const top = nutritionTopRow(line.name);
      if (top) document.getElementById(top.inputId).value = String(scaled(amount));
      else panel[line.name] = { amount: scaled(amount), unit };
    });
    if (!locked.has('TEF')) estimateNutritionFormTef();
    renderNutritionMicroRows(panel, locked);
  } catch (err) {
    console.error('[Scan Label]', err);
    showFieldError('nutrition-form-error', `Scan failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    Motion.iconSettle(btn);
  }
}

// Norm: title-cases Name, then rescales the form in place to a 100g Amount. Needs a
// real gram figure: a count-only Amount like "2 eggs" has no 100g equivalent.
function normalizeIngredientForm() {
  clearFieldError('nutrition-form-error');

  const nameField = document.getElementById('nutrition-name');
  nameField.value = titleCaseIngredientName(nameField.value);

  const amountField = document.getElementById('nutrition-amount');
  const grams = parseGramsFromAmount(amountField.value);
  if (!grams) {
    showFieldError('nutrition-form-error', 'Amount needs a gram figure (e.g. "33g") before it can be normalized to 100g.');
    return;
  }
  // A count scales too ("68g (2x)" -> "100g (2.94x)"), kept to 2 decimals, so the
  // count per gram stays fixed.
  const count = parseCountFromAmount(amountField.value);

  const factor = 100 / grams;
  amountField.value = amountField.value.replace(NUTRITION_GRAMS_PATTERN, (full, num) => full.replace(num, '100'));
  if (count !== null) {
    const newCount = Math.round(count * factor * 100) / 100;
    amountField.value = amountField.value.replace(nutritionCountPattern(amountField.value), (full, num) => full.replace(num, String(newCount)));
  }

  // kcal rows (Calories, TEF) to whole numbers, gram rows to 1 decimal. Protein % is
  // a share of intake, not a per-Amount figure, so it doesn't move.
  NUTRITION_TOP_ROWS.forEach((row) => {
    const field = document.getElementById(row.inputId);
    const raw = field.value.trim();
    if (!raw) return;
    const value = evaluateNumberExpression(raw);
    if (value === null) return;
    const decimals = row.unit === 'kcal' ? 0 : 1;
    field.value = String(Math.round(value * factor * 10 ** decimals) / 10 ** decimals);
  });

  // Micronutrient rows and the held top-row panel entries scale the same way.
  document.querySelectorAll('#nutrition-fields .nutrition-micro-row input[type="text"]').forEach((input) => {
    const value = microAmountValue(input.value);
    if (value !== null) input.value = String(roundNutrientAmount(value * factor));
  });
  Object.values(nutritionFormPanelExtras).forEach((info) => {
    info.amount = roundNutrientAmount(info.amount * factor);
  });
}

// Reads and validates the form for Save and Update alike. On the first problem it
// shows the error and returns { ok: false }.
function readNutritionFormFields() {
  const group = document.getElementById('nutrition-group').value.trim();
  const name = document.getElementById('nutrition-name').value.trim();
  const amount = gramsFirstAmount(document.getElementById('nutrition-amount').value.trim());
  const calories = evaluateNumberExpression(document.getElementById('nutrition-calories').value);
  const protein = evaluateNumberExpression(document.getElementById('nutrition-protein').value);
  const proteinPercentRaw = document.getElementById('nutrition-protein-percent').value.trim();
  const proteinPercent = proteinPercentRaw ? evaluateNumberExpression(proteinPercentRaw) : null;

  if (!name) {
    showFieldError('nutrition-form-error', 'Name is required.');
    return { ok: false };
  }
  if (calories === null || protein === null) {
    showFieldError('nutrition-form-error', 'Calories and Protein must be numbers.');
    return { ok: false };
  }
  if (proteinPercentRaw && proteinPercent === null) {
    showFieldError('nutrition-form-error', 'Protein % must be a number.');
    return { ok: false };
  }

  // Optional: blank is null, anything else must be a number.
  const macros = {};
  for (const key of NUTRITION_MACRO_KEYS) {
    const raw = document.getElementById(`nutrition-${key}`).value.trim();
    const value = raw ? evaluateNumberExpression(raw) : null;
    if (raw && value === null) {
      showFieldError('nutrition-form-error', `${NUTRITION_MACRO_LABELS[key]} must be a number.`);
      return { ok: false };
    }
    macros[key] = value;
  }
  const { fiber, fat, carb, tef } = macros;

  // Micronutrients carries the panel and the ticked rows' names.
  const panel = readNutritionFormPanel();
  const top = nutritionTopValues({ calories, protein, fiber, fat, carb, tef, micronutrients: JSON.stringify(panel) });
  const micronutrients = nutritionColumnL(top, panel, nutritionFormLockedNames());

  return { ok: true, group, name, amount, calories, protein, fiber, fat, carb, tef, proteinPercent, micronutrients };
}

// Writes the form's fields over `editingNutritionRow`, or appends a new row.
async function saveNutritionFormFields(fields) {
  await ensureNutritionColumns();
  if (editingNutritionRow) await writeNutritionRow(editingNutritionRow, fields);
  else await appendNutritionRow(fields);
}

async function submitNutritionForm(event) {
  event.preventDefault();

  const fields = readNutritionFormFields();
  if (!fields.ok) return;
  const { name, amount, calories, protein, fiber, fat, carb, tef } = fields;

  try {
    const editingRow = editingNutritionRow;
    await saveNutritionFormFields(fields);
    // Once only: the form stays open, and a second Save mustn't fold it in again.
    const onSaved = nutritionFormSaveCallback;
    nutritionFormSaveCallback = null;
    await refreshNutrition(true);
    if (onSaved) onSaved({ name, amount, calories, protein, fiber, fat, carb, tef });
    const saved = allNutritionEntries.find((n) => n.row === editingRow)
      || allNutritionEntries.filter((n) => n.name === name).at(-1);
    if (saved) {
      openNutritionForm(saved);
      stayOnSavedForm('nutrition-modal', { slug: routeSlug(saved.name), label: saved.name });
    }
    showFormSaved('nutrition-form-error');
  } catch (err) {
    showFieldError('nutrition-form-error', err.message);
  }
}

// --- Update: propagate an edited ingredient into Physique ---------------
//
// Calculate reuses a day's saved Breakdown by exact noteLine match, so a renamed or
// re-priced ingredient would leave past days wrong. Update fixes them locally (no
// AI/USDA call): every Consumption line and Breakdown item under the OLD name is
// renamed, and repriced where its gram or count figure can be scaled.

// The same "same ingredient" rule as findNutritionEntry: case-insensitive, then a
// trailing-"s" fold.
function nutritionNamesMatch(a, b) {
  const ta = String(a || '').trim().toLowerCase();
  const tb = String(b || '').trim().toLowerCase();
  if (!ta || !tb) return false;
  return ta === tb || foldTrailingS(ta) === foldTrailingS(tb);
}

// One Consumption line under the new name, quantity/unit kept, in Calculate's
// "<quantity><unit> <name>" shape. Null when the line has no parseable quantity.
function renamedConsumptionLine(line, newName) {
  const { quantity, unit } = extractIngredientQuantity(line);
  if (quantity === null) return null;
  const unitText = unit ? (UNIT_CANONICAL[unit] || unit) : '';
  return `${Math.round(quantity * 100) / 100}${unitText} ${newName}`.trim();
}

// Reprices one Breakdown item off its own resolved amount ("150g" / "×3"), by grams
// then by count as Calculate's table hit does. Renamed (noteLine too) even when it
// can't be rescaled; the SAME item comes back when nothing changes, for `!==` checks.
function repriceBreakdownItemAgainstEntry(item, entry) {
  const renamed = entry.name !== item.name;
  const grams = parseGramsFromAmount(item.amount);
  const count = parseCountFromAmount(item.amount);
  const tableGrams = parseGramsFromAmount(entry.amount);
  const explicitCount = parseCountFromAmount(entry.amount);
  const tableCount = explicitCount !== null ? explicitCount : (tableGrams === null ? 1 : null);

  // How much the entry's figures cover, and how much the item ate, in one unit.
  let basis = null;
  let eaten = null;
  if (grams !== null && tableGrams) {
    basis = tableGrams;
    eaten = grams;
  } else if (count !== null && tableCount) {
    basis = tableCount;
    eaten = count;
  }
  const repriced = basis !== null;

  if (!renamed && !repriced) return item;
  return {
    ...item,
    name: entry.name,
    calories: repriced ? Math.round((entry.calories / basis) * eaten) : item.calories,
    protein: repriced ? Math.round(((entry.protein / basis) * eaten) * 10) / 10 : item.protein,
    noteLine: (renamed && item.noteLine) ? item.noteLine.replace(item.name, entry.name) : item.noteLine,
    source: repriced ? NUTRITION_TABLE_SOURCE_LABEL : item.source,
  };
}

// The Edit form's Update: saves like Save, then rewrites every Physique day naming
// the OLD name. Consumption text always; Breakdown and day totals only where an item
// was repriced (a hand-typed day with no Breakdown keeps its totals).
async function updateNutritionEntryAndPropagate() {
  if (!editingNutritionRow || !nutritionFormEntry) return;
  const oldName = nutritionFormEntry.name;

  const fields = readNutritionFormFields();
  if (!fields.ok) return;

  clearFieldError('nutrition-form-error');
  try {
    await saveNutritionFormFields(fields);
  } catch (err) {
    showFieldError('nutrition-form-error', err.message);
    return;
  }

  await refreshNutrition(true);
  await refreshPhysique();

  const updatedEntry = { name: fields.name, amount: fields.amount, calories: fields.calories, protein: fields.protein };
  const candidates = allPhysiqueEntries.filter((p) => p.consumption.trim());
  showToast(`Checking ${candidates.length} Physique day${nutritionPluralS(candidates.length)}…`);

  let linesChanged = 0;
  const edits = candidates.map((p) => {
    const oldBreakdown = parsePhysiqueBreakdown(p.breakdown);
    let textTouched = false;
    let breakdownTouched = false;

    const newLines = p.consumption.split('\n').map((raw) => {
      const line = raw.trim();
      if (!line || !nutritionNamesMatch(extractIngredientName(line), oldName)) return raw;
      const rebuilt = renamedConsumptionLine(line, updatedEntry.name);
      if (rebuilt === null || rebuilt === line) return raw;
      textTouched = true;
      linesChanged += 1;
      return rebuilt;
    });

    const newBreakdown = oldBreakdown.map((item) => {
      if (!nutritionNamesMatch(item.name, oldName)) return item;
      const repriced = repriceBreakdownItemAgainstEntry(item, updatedEntry);
      if (repriced !== item) breakdownTouched = true;
      return repriced;
    });

    if (!textTouched && !breakdownTouched) return null;

    const day = physiqueDayCopy(p);
    day.consumption = newLines.join('\n');
    if (breakdownTouched) {
      const tef = estimateTefBreakdown(newBreakdown);
      const dayMacros = sumBreakdownMacros(newBreakdown);
      day.breakdown = breakdownToJson(newBreakdown);
      day.caloriesIn = Math.round(newBreakdown.reduce((sum, i) => sum + i.calories, 0));
      day.proteinIn = Math.round(newBreakdown.reduce((sum, i) => sum + i.protein, 0) * 10) / 10;
      if (dayMacros.fiber !== null) day.fiber = dayMacros.fiber;
      if (dayMacros.fat !== null) day.fat = dayMacros.fat;
      if (dayMacros.carbohydrate !== null) day.carbohydrate = dayMacros.carbohydrate;
      if (tef) day.tef = tef.tefKcal;
    }

    return { row: p.row, day, snapshot: physiqueDayCopy(p) };
  }).filter(Boolean);

  if (!edits.length) {
    closeNutritionForm();
    await refreshNutrition(true);
    alert(`Saved "${updatedEntry.name}" — no Physique day mentions "${oldName}" yet.`);
    return;
  }

  let done = 0;
  const succeeded = [];
  const results = await Promise.allSettled(edits.map(async (e) => {
    try {
      await writePhysiqueRow(e.row, e.day);
      succeeded.push({ row: e.row, values: e.snapshot });
    } finally {
      done += 1;
      showToast(`Updating ${done}/${edits.length} Physique days…`);
    }
  }));

  closeNutritionForm();
  await refreshNutrition(true);
  await refreshPhysique(true);

  // Reported like bulk Calculate's, so a failed day isn't taken as rewritten.
  const failed = results.filter((r) => r.status === 'rejected').length;
  const failedNote = failed ? `, ${failed} failed` : '';
  showUndoToast(
    `"${updatedEntry.name}" updated — ${succeeded.length} Physique day${nutritionPluralS(succeeded.length)} (${linesChanged} line${nutritionPluralS(linesChanged)}) rewritten${failedNote}.`,
    () => restorePhysiqueSnapshots(succeeded),
  );
}

async function deleteNutritionEntry(entry) {
  await confirmAndDelete(`Delete "${entry.name}" from Nutrition?`, async () => {
    if (nutritionSheetId === null) nutritionSheetId = await fetchNutritionSheetId();
    nutritionRowDeletes += 1;
    await batchUpdate([sheetRowDeleteRequest(nutritionSheetId, entry.row)]);
    selectedNutritionRows.delete(entry.row);
    await refreshNutrition(true);
  }, "Couldn't delete ingredient");
}

// Merges the selected (near-)duplicates into the lowest row: its blanks are filled
// from the others, nothing is summed, and the others' rows are deleted.
async function mergeSelectedNutritionEntries() {
  const selected = selectedNutritionEntries();
  if (selected.length < 2) return;

  const kept = selected[0];
  const others = selected.slice(1);
  const merged = { ...kept };
  ['group', 'amount'].forEach((key) => {
    if (!merged[key]) merged[key] = (others.find((o) => o[key]) || {})[key] || '';
  });
  ['calories', 'protein', 'proteinPercent', ...NUTRITION_MACRO_KEYS].forEach((key) => {
    if (merged[key] === null) merged[key] = (others.find((o) => o[key] !== null) || {})[key] ?? null;
  });

  await confirmAndDelete(
    `Merge ${selected.length} ingredients into "${kept.name}"? ` +
    `${others.map((o) => o.name).join(', ')} will be combined into "${kept.name}" and their rows deleted. ` +
    `Fields already filled on "${kept.name}" are kept as-is; blanks are filled in from the others. This cannot be undone.`,
    async () => {
      if (nutritionSheetId === null) nutritionSheetId = await fetchNutritionSheetId();
      if (NUTRITION_MACRO_KEYS.some((key) => merged[key] !== null)) await ensureNutritionColumns();

      await writeNutritionRow(kept.row, merged);

      // Bottom-up, so each delete leaves the next row's index intact.
      const deleteRequests = others
        .map((o) => o.row)
        .sort((a, b) => b - a)
        .map((row) => sheetRowDeleteRequest(nutritionSheetId, row));
      nutritionRowDeletes += 1;
      await batchUpdate(deleteRequests);

      selectedNutritionRows.clear();
      await refreshNutrition(true);
    },
    "Couldn't merge ingredients",
  );
}

// Title-cases every selected Name (titleCaseIngredientName) and writes back only the
// ones that change. Local only.
async function capitalizeSelectedNutritionNames() {
  const btn = document.getElementById('nutrition-bulk-capitalize-btn');
  const statusEl = document.getElementById('nutrition-pull-status');
  const rows = selectedNutritionEntries();
  if (rows.length === 0) return;

  const changed = rows
    .map((n) => ({ n, newName: titleCaseIngredientName(n.name) }))
    .filter(({ n, newName }) => newName !== n.name);

  statusEl.hidden = true;
  if (!changed.length) {
    showToast(`Already capitalized — no changes across ${rows.length} selected.`);
    return;
  }

  const originalLabel = btn.textContent;
  let written = 0;
  try {
    for (let i = 0; i < changed.length; i++) {
      const { n, newName } = changed[i];
      btn.textContent = `Capitalizing ${i + 1} of ${changed.length}…`;
      await updateValues(nutritionCellRange('name', n.row), [[newName]], 'RAW');
      written += 1;
    }
    showToast(`Capitalized ${changed.length} of ${rows.length} selected ingredient name${nutritionPluralS(changed.length)}.`);
  } catch (err) {
    // Says how far it got, since the names before the failure did change.
    showToast(`Capitalized ${written} of ${changed.length} name${nutritionPluralS(changed.length)}, then failed: ${err.message}`, true);
  } finally {
    btn.textContent = originalLabel;
  }
  selectedNutritionRows.clear();
  await refreshNutrition(true);
}

// Missing app headers go after the last used column, with the grid widened to fit
// (Sheets rejects writes past it), in one request; the index updates before the write.
async function ensureNutritionColumns() {
  const metadata = await getSpreadsheetMetadata();
  const sheetId = findSheetId(metadata, CONFIG.SHEETS.NUTRITION);
  const sheet = metadata.sheets.find((s) => s.properties.sheetId === sheetId);
  const columnCount = sheet.properties.gridProperties.columnCount;
  nutritionSheetId = sheetId;

  // Not loaded yet (a Calculate banking a row): the header row alone.
  if (nutritionHeaderRow === null) {
    nutritionHeaderRow = ((await getValues(nutritionA1('A1:ZZ1'), VALUE_PARAMS)).values || [])[0] || [];
    nutritionUsedWidth = nutritionHeaderRow.length;
  }
  const index = nutritionColumnsFromHeader(nutritionHeaderRow);
  // No Name header: the columns are taken by position, so no header is added.
  const missing = index === NUTRITION_DEFAULT_COLUMNS ? [] : NUTRITION_COLUMNS.filter(({ key }) => index[key] === undefined);
  const start = Math.max(nutritionUsedWidth, ...Object.values(index).map((i) => i + 1));
  missing.forEach(({ key }, i) => { index[key] = start + i; });
  const width = Math.max(...Object.values(index)) + 1;

  const requests = [];
  if (columnCount < width) {
    requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: width - columnCount } });
  }
  if (missing.length) {
    requests.push({
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: start },
        rows: [{ values: missing.map(({ header }) => ({ userEnteredValue: { stringValue: header } })) }],
        fields: 'userEnteredValue',
      },
    });
  }
  if (!requests.length) {
    nutritionColumnIndex = index;
    return;
  }
  await batchUpdate(requests);

  const header = [...nutritionHeaderRow];
  missing.forEach(({ key, header: label }) => { header[index[key]] = label; });
  nutritionHeaderRow = header;
  nutritionUsedWidth = Math.max(nutritionUsedWidth, width);
  nutritionColumnIndex = index;
}

// Bulk Complete's lookup: USDA's top match for `name`, scaled to Amount's gram figure
// (no gram figure is a failure, not a 100g guess). Writes nothing and never throws:
// every failure comes back as { applied: false, reason }.
async function pullNutritionFromUsda(name, amount) {
  const grams = parseGramsFromAmount(amount);
  if (grams === null) return { applied: false, reason: 'Amount has no gram figure to scale from' };

  try {
    const candidates = await usdaLookupKcalCandidates(name);
    if (candidates.length === 0) return { applied: false, reason: 'no USDA match' };
    return usdaCandidateResult(candidates[0], grams);
  } catch (err) {
    return { applied: false, reason: err.message };
  }
}

// One USDA candidate scaled to a gram amount, in pullNutritionFromUsda's result shape.
function usdaCandidateResult(candidate, grams) {
  const scale = grams / 100;
  return {
    applied: true,
    description: candidate.description,
    fdcId: candidate.fdcId,
    calories: Math.round(candidate.kcalPer100g * scale),
    protein: candidate.proteinPer100g !== null ? Math.round(candidate.proteinPer100g * scale * 10) / 10 : null,
    nutrients: candidate.nutrients.length ? nutrientPanelFromCandidate(candidate, grams) : null,
  };
}

// A USDA candidate's per-100g panel scaled to `grams`, alphabetical by name.
function nutrientPanelFromCandidate(candidate, grams) {
  const scale = grams / 100;
  const nutrients = {};
  [...candidate.nutrients].sort((a, b) => a.name.localeCompare(b.name)).forEach((nut) => {
    nutrients[nut.name] = { amount: roundNutrientAmount(nut.amountPer100g * scale), unit: nut.unit };
  });
  return nutrients;
}

// Bulk Complete for one saved row: the same rule as the form — ticked values are kept.
async function pullMicronutrientsForEntry(n) {
  const result = await pullNutritionFromUsda(n.name, n.amount);
  if (!result.applied) return result;

  const locked = nutritionLockedNames(n);
  const calories = locked.has('Calories') ? n.calories : result.calories;
  const protein = locked.has('Protein') ? n.protein : result.protein;
  const old = parseMicronutrients(n.micronutrients) || {};
  const merged = result.nutrients ? { ...result.nutrients } : { ...old };
  locked.forEach((name) => { if (old[name]) merged[name] = old[name]; });
  // Ticked top values stay; the rest come from this pull, TEF re-estimated.
  const before = nutritionTopValues(n);
  const keep = (name) => (locked.has(name) ? before[name] : null);
  const top = nutritionTopValues({
    calories, protein, fiber: keep('Dietary Fiber'), fat: keep('Fat'), carb: keep('Carbohydrates'), tef: keep('TEF'),
    micronutrients: JSON.stringify(merged),
  });
  const writes = NUTRITION_TOP_ROWS
    .filter((row) => !locked.has(row.name))
    .map((row) => ({ range: nutritionCellRange(row.key, n.row), values: [[top[row.name] ?? '']] }));
  writes.push({ range: nutritionCellRange('micronutrients', n.row), values: [[nutritionColumnL(top, merged, locked)]] });
  await batchUpdateValues(writes);
  return { applied: true };
}

// Bulk Complete: one row at a time, so a rate-limited USDA key fails predictably.
async function pullMicronutrientsForSelected() {
  const btn = document.getElementById('nutrition-pull-micros-btn');
  const statusEl = document.getElementById('nutrition-pull-status');
  const rows = selectedNutritionEntries();
  if (rows.length === 0) return;

  statusEl.hidden = true;

  try {
    await ensureNutritionColumns();
  } catch (err) {
    showToast(`Couldn't prepare the Micronutrients column: ${err.message}`, true);
    return;
  }

  const originalLabel = btn.textContent;
  let pulled = 0;
  const skipped = [];

  for (let i = 0; i < rows.length; i++) {
    const n = rows[i];
    btn.textContent = `🧲 ${i + 1}/${rows.length}`;
    const result = await pullMicronutrientsForEntry(n);
    if (result.applied) pulled++;
    else skipped.push(`${n.name} (${result.reason})`);
  }

  btn.textContent = originalLabel;
  const pulledText = `Pulled micronutrients for ${pulled} ingredient${nutritionPluralS(pulled)}`;
  showToast(skipped.length
    ? `${pulledText} — skipped: ${skipped.join('; ')}`
    : `${pulledText}.`, skipped.length > 0);

  await refreshNutrition(true);
}

// Rows today's SAVED breakdown resolved to, which tint .nutrition-row-logged. A line
// not yet Calculated has no match until Calculate prices it.
function todaysUsedNutritionRows() {
  const today = todaysPhysiqueDay();
  const rows = new Set();
  if (!today) return rows;
  parsePhysiqueBreakdown(today.breakdown).forEach((item) => {
    const entry = findNutritionEntry(item.name);
    if (entry) rows.add(entry.row);
  });
  return rows;
}

// Naive singular fold for "egg"/"eggs"; only a fallback after an exact match fails.
function foldTrailingS(s) {
  return s.length > 1 && s.endsWith('s') ? s.slice(0, -1) : s;
}

// Calculate's catalogue lookup: case-insensitive exact name, then with a trailing "s"
// folded off both sides, so "2 eggs" still hits an "egg" row.
function findNutritionEntry(name) {
  const query = String(name || '').trim().toLowerCase();
  if (!query) return null;
  const exact = allNutritionEntries.find((n) => n.name.toLowerCase() === query);
  if (exact) return exact;
  const nameFolded = foldTrailingS(query);
  return allNutritionEntries.find((n) => foldTrailingS(n.name.toLowerCase()) === nameFolded) || null;
}

// Banks a fallback-computed ingredient (Group left blank: there's no basis to guess
// one). The caller refreshes once after a batch. The grid is widened only when
// Fiber/Fat/Carb or Micronutrients is supplied.
async function addNutritionEntry({ name, amount, calories, protein, fiber, fat, carb, micronutrients }) {
  if (fiber !== undefined || fat !== undefined || carb !== undefined || micronutrients) await ensureNutritionColumns();
  await appendNutritionRow({ group: '', name, amount, calories, protein, fiber, fat, carb, micronutrients });
}
