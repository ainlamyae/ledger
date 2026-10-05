// Nutrition: a personal, editable ingredient database Physique's
// 🧮 Calculate button (calorie-estimator.js) checks before falling back to
// the AI/USDA estimate — once an ingredient's real calories/protein (from
// the specific brand/product actually bought) is recorded here, it's reused
// instead of being re-guessed every time.

// Read with its header row: columns are found by name (NUTRITION_COLUMNS), so a
// column added, removed or moved on the sheet can't shift what lands where.
const NUTRITION_RANGE = `'${CONFIG.SHEETS.NUTRITION}'!A1:Z`;
const NUTRITION_COLUMNS = [
  { key: 'classification', header: 'Classification' },
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
// key -> 0-based column, from the header row (refreshNutrition). `legacyVerified`
// is the old Verification column, read only while the sheet still has it.
let nutritionColumnIndex = NUTRITION_DEFAULT_COLUMNS;
const N_PAGE_SIZE = 25;

// Left lowercase by titleCaseIngredientName unless one leads the name —
// "Peanut Butter and Jelly", not "Peanut Butter And Jelly".
const NUTRITION_TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in',
  'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'with', 'yet',
]);

// Shared by the Nutrition form's own Normalize button and Physique's bulk
// Capitalize Names — collapses stray whitespace and capitalizes each word,
// except a minor joining word (NUTRITION_TITLE_CASE_MINOR_WORDS) unless it
// leads the name, so a name typed/logged in any casing settles on one
// consistent form instead of fragmenting the catalog by casing alone.
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

// Amount is freeform serving-size text so it can read like a real nutrition
// label, and Calculate scales Calories/Protein to whatever quantity was
// actually logged one of two ways:
//  - by weight, if a gram figure appears anywhere in the text (e.g. "100g",
//    "1 scoop (32g)") — scaled against the AI's estimated gram weight of
//    however much was eaten;
//  - by count, for a discrete/whole-unit food with no natural gram figure
//    (e.g. "1 rice cake", "2 eggs") — scaled against the AI's estimated
//    count of whole units eaten, using whatever leading number Amount
//    starts with as the unit count Calories/Protein correspond to (default
//    1 if there isn't one, e.g. Amount is just "rice cake").
// A row with neither is still visible/editable here, just unusable for
// auto-scaling until edited.
const NUTRITION_GRAMS_PATTERN = /(\d+(?:\.\d+)?)\s*g\b/i;
function parseGramsFromAmount(amount) {
  const match = String(amount || '').match(NUTRITION_GRAMS_PATTERN);
  return match ? parseFloat(match[1]) : null;
}

// A leading number only counts as a *count* if it isn't itself the gram
// figure — "250g" is a weight (no count), while "1 (50g)" or "1 scoop
// (31g)" have a genuine leading count of 1 alongside a separate, unrelated
// gram figure later in the string. The negative lookahead tells those apart
// by checking whether "g" immediately follows the leading number.
// The lookahead-then-backreference (\1) makes the digit run atomic: without
// it, \d+ backtracks on a plain weight like "100g" (greedy match "100" fails
// the "not followed by g" check, backtracks to "10", which IS followed by a
// non-"g" char "0" and wrongly passes) — misreading a 100g weight as count 10.
const NUTRITION_LEADING_COUNT_PATTERN = /^\s*(?=(\d+(?:\.\d+)?))\1(?!\s*g\b)/i;
function parseCountFromAmount(amount) {
  const match = String(amount || '').match(NUTRITION_LEADING_COUNT_PATTERN);
  return match ? parseFloat(match[1]) : null;
}

let allNutritionEntries = [];
// Same purpose as physique.js's physiqueDataLoaded: lets a click that races the
// initial fetch say "still loading" instead of treating the empty array as the
// real answer (an untracked ingredient and an unloaded table look identical).
let nutritionDataLoaded = false;
let nutritionListenersAttached = false;
// Default to Uses, highest first (dir -1), so the ingredients you actually log
// sit on the first page — the Uses column is always counted now (see
// renderNutritionList) rather than filled in on demand by a button.
let nSort = { key: 'uses', dir: -1 };
let nCurrentPage = 1;
let nutritionSheetId = null;
let editingNutritionRow = null;
// The entry Normalize needs beyond what's already sitting in the form's own
// fields: a saved-but-not-yet-repulled Micronutrients panel (entry.micronutrients)
// lives only on the entry, never in an input, so there'd be nothing to scale
// without holding onto it. null in Add mode (nothing saved yet to fall back on).
let nutritionFormEntry = null;
let selectedNutritionRows = new Set();
// The panel entries the top rows already show (Protein, Fiber, Fat, Carb, Energy),
// kept aside while the form is open so Save can write them back in step with
// those rows rather than listing them twice.
let nutritionFormPanelExtras = {};
// One-shot hook for a caller that needs to know once the form's Save actually
// lands — currently just calorie-estimator.js's ✏️ button, which uses it to
// fold the corrected numbers back into today's already-drawn Consumption
// breakdown/total instead of leaving them only in the newly-banked Nutrition
// row. Set by openNutritionForm's second argument, fired (with the saved
// row's own field values) right after a successful save, and cleared by both
// a successful save and closeNutritionForm — an open form always
// carries at most whatever the LAST openNutritionForm call armed it with, so
// a Cancel can't fire a stale caller's callback on some later unrelated Add.
let nutritionFormSaveCallback = null;
// Row -> how many Consumption lines (across every Physique day) resolved to
// that row, driving the always-on Uses column (and its default sort). UI-only,
// never written to the sheet. Memoized: computed lazily in renderNutritionList
// once Physique has loaded, and invalidated (set back to null) by both
// refreshNutrition (the ingredient set changed) and refreshPhysique's own
// re-render of this table (the logged days changed) so it's recounted then
// rather than on every keystroke. null before the first count, which reads as
// "—" (Physique not loaded yet) rather than a real 0 ("never logged").
let nutritionUsageCounts = null;

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
    document.getElementById('nutrition-normalize-btn').addEventListener('click', normalizeIngredientForm);
    document.getElementById('nutrition-log-btn').addEventListener('click', logNutritionFromForm);
    onAsyncClick('nutrition-update-btn', updateNutritionEntryAndPropagate);

    document.getElementById('nutrition-search').addEventListener('input', () => {
      nCurrentPage = 1;
      selectedNutritionRows.clear();
      renderNutritionList();
    });

    setupNutritionSorting();
    setupNutritionBulkActions();
  }

  await refreshNutrition(forceRefresh);
}

function setupNutritionBulkActions() {
  document.getElementById('nutrition-select-all').addEventListener('change', (e) => {
    const pageRows = getFilteredNutritionEntries().slice((nCurrentPage - 1) * N_PAGE_SIZE, nCurrentPage * N_PAGE_SIZE);
    pageRows.forEach((n) => (e.target.checked ? selectedNutritionRows.add(n.row) : selectedNutritionRows.delete(n.row)));
    renderNutritionList();
  });

  onAsyncClick('nutrition-bulk-merge-btn', mergeSelectedNutritionEntries);
  onAsyncClick('nutrition-bulk-capitalize-btn', capitalizeSelectedNutritionNames);
  onAsyncClick('nutrition-pull-micros-btn', pullMicronutrientsForSelected);
  document.getElementById('log-nutrition-btn').addEventListener('click', logSelectedNutrition);
}

function setupNutritionSorting() {
  makeSortableHeaders('#nutrition-table', nSort, () => {
    nCurrentPage = 1;
    selectedNutritionRows.clear();
    renderNutritionList();
  });
}

async function refreshNutrition(forceRefresh = false) {
  // A new key: the cached copy now includes the header row.
  let values = forceRefresh ? null : getCached('nutritionWithHeader');
  if (!values) {
    const resp = await getValues(NUTRITION_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('nutritionWithHeader', values);
  }

  nutritionColumnIndex = nutritionColumnsFromHeader(values[0] || []);
  const cell = (row, key) => (nutritionColumnIndex[key] === undefined ? undefined : row[nutritionColumnIndex[key]]);
  const numberOrNull = (v) => (v !== undefined && v !== '' ? Number(v) : null);

  allNutritionEntries = values.slice(1)
    .map((row, i) => ({
      row: i + 2,
      // Every cell as read, so a write keeps columns this app doesn't know about.
      cells: row,
      // Free-text grouping (e.g. "Dairy"); a row the app banks is left blank.
      classification: (cell(row, 'classification') || '').trim(),
      name: (cell(row, 'name') || '').trim(),
      amount: cell(row, 'amount') || '',
      calories: numberOrNull(cell(row, 'calories')),
      protein: numberOrNull(cell(row, 'protein')),
      // Typed Fiber/Fat/Carbohydrate (g) and TEF (kcal); null falls back to the
      // Micronutrients-derived estimate (resolvedNutritionMacros).
      fiber: numberOrNull(cell(row, 'fiber')),
      fat: numberOrNull(cell(row, 'fat')),
      carb: numberOrNull(cell(row, 'carb')),
      tef: numberOrNull(cell(row, 'tef')),
      // The old Verification column, while the sheet still has it: "1" reads as
      // Amount–Carbohydrates locked (nutritionLockedNames).
      verified: String(cell(row, 'legacyVerified') || '').trim() === '1',
      // Blank means "not tracked" by Protein Source Rotation; a number is the % of
      // your protein target this ingredient should cover.
      proteinPercent: numberOrNull(cell(row, 'proteinPercent')),
      // JSON: the six top values, then the micronutrients, each with its lock tick.
      micronutrients: (cell(row, 'micronutrients') || '').trim(),
    }))
    .filter((n) => n.name);

  nutritionDataLoaded = true;
  // The ingredient set may have changed, so the memoized Uses counts are stale
  // — drop them and let renderNutritionList recount against current Physique.
  nutritionUsageCounts = null;
  renderNutritionList();
}

// Header row -> { key: column }. Without a recognisable Name header the columns
// are taken in NUTRITION_COLUMNS order.
function nutritionColumnsFromHeader(headerRow) {
  const names = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  const index = {};
  NUTRITION_COLUMNS.forEach(({ key, header }) => {
    const i = names.indexOf(header.toLowerCase());
    if (i !== -1) index[key] = i;
  });
  const legacy = names.indexOf('verification');
  if (legacy !== -1) index.legacyVerified = legacy;
  return index.name === undefined ? NUTRITION_DEFAULT_COLUMNS : index;
}

// Column letter(s) for a 0-based index.
function nutritionColumnLetter(i) {
  let letters = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

// An entry's cells in the sheet's own column order; columns this app doesn't know
// (including an old Verification) keep what was read.
function nutritionRowCells(entry) {
  const cells = [...(entry.cells || [])];
  NUTRITION_COLUMNS.forEach(({ key }) => {
    const i = nutritionColumnIndex[key];
    if (i === undefined) return;
    while (cells.length < i) cells.push('');
    const value = entry[key];
    cells[i] = value === null || value === undefined ? '' : value;
  });
  return cells;
}

// The A1 range for one key's cell on `row`.
function nutritionCellRange(key, row) {
  const ref = `${nutritionColumnLetter(nutritionColumnIndex[key])}${row}`;
  return `'${CONFIG.SHEETS.NUTRITION}'!${ref}`;
}

async function writeNutritionRow(row, entry) {
  const cells = nutritionRowCells(entry);
  await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!A${row}:${nutritionColumnLetter(cells.length - 1)}${row}`, [cells]);
}

async function appendNutritionRow(entry) {
  const cells = nutritionRowCells(entry);
  await appendValues(`'${CONFIG.SHEETS.NUTRITION}'!A:${nutritionColumnLetter(cells.length - 1)}`, [cells]);
}

// Fiber/Fat/Carb grams read straight off this row's pulled 🧬 Micronutrients
// panel (already scaled to Amount — see column L comment below) — the
// estimate resolvedNutritionMacros below falls back to on any of Fiber/Fat/
// Carb/TEF (F:I) you haven't typed a real number into yourself. All null on
// a row that's never had Pull Micronutrients run.
function computedNutritionMacros(n) {
  const parsed = parseMicronutrients(n.micronutrients);
  if (!parsed) return { fiber: null, fat: null, carb: null };
  return {
    fiber: parsed['Fiber, total dietary'] ? parsed['Fiber, total dietary'].amount : null,
    fat: parsed['Total lipid (fat)'] ? parsed['Total lipid (fat)'].amount : null,
    carb: parsed['Carbohydrate, by difference'] ? parsed['Carbohydrate, by difference'].amount : null,
  };
}

// Fiber/Fat/Carb/TEF for this row's own Amount: your own typed figure
// (columns F-I) when you've saved one, otherwise the 🧬 Micronutrients
// estimate above (Fiber/Fat/Carb) or the Atwater/TEF-share formula (TEF) —
// same fallback order Physique's per-ingredient breakdown uses
// (resolveIngredientMacros, micronutrient-insight.js), so typing a real
// number here is what overrides the estimate everywhere it's used. TEF uses
// this row's own typed Protein (never the panel's Protein figure — Protein
// here is the value you typed and Calculate scales from, so it's what
// should drive TEF too) together with whichever Carb/Fat this same
// resolution just settled on.
function resolvedNutritionMacros(n) {
  const computed = computedNutritionMacros(n);
  const fiber = n.fiber !== null ? n.fiber : computed.fiber;
  const fat = n.fat !== null ? n.fat : computed.fat;
  const carb = n.carb !== null ? n.carb : computed.carb;

  let tef = n.tef;
  let tefTyped = n.tef !== null;
  if (tef === null && n.protein !== null) {
    const rate = tefMacroRate();
    tef = Math.round(
      n.protein * rate.Protein.kcalPerGram * rate.Protein.tefShare
      + (carb || 0) * rate['Carbohydrate, by difference'].kcalPerGram * rate['Carbohydrate, by difference'].tefShare
      + (fat || 0) * rate['Total lipid (fat)'].kcalPerGram * rate['Total lipid (fat)'].tefShare
    );
  }

  return {
    fiber, fat, carb, tef,
    typed: { fiber: n.fiber !== null, fat: n.fat !== null, carb: n.carb !== null, tef: tefTyped },
  };
}

// Non-zero micronutrients (not the top values): what the Micro cell shows and sorts by.
function micronutrientCount(n) {
  const parsed = parseMicronutrients(n.micronutrients) || {};
  return Object.entries(parsed)
    .filter(([name, info]) => !NUTRITION_TOP_PANEL_KEYS.has(name) && Number(info.amount) !== 0).length;
}

// null before the Uses count has first run (Physique not loaded yet — see
// nutritionUsageCounts above), otherwise how many Consumption lines resolved to
// this row — 0 is a real, meaningful answer here ("never logged, safe to
// remove"), so it's kept distinct from "not computed yet" rather than
// defaulting to it.
function nutritionUsageCount(n) {
  return nutritionUsageCounts ? (nutritionUsageCounts.get(n.row) ?? 0) : null;
}

// One Fiber/Fat/Carb/TEF table cell: "—" when there's neither a typed figure
// nor anything to estimate from, otherwise the resolved number with a
// tooltip saying whether it's yours or an estimate (custom typed/estimated
// tooltip text for TEF, since its estimate is a formula rather than a raw
// 🧬 Micronutrients read).
function nutritionMacroCell(value, isTyped, typedTooltip = 'Typed by you.', estimateTooltip = 'Estimated from 🧬 Micronutrients — select this row and click Complete below if it hasn\'t been pulled yet.') {
  if (value === null) return makeCell('—', 'Not typed — and nothing to estimate from yet.');
  return makeCell(String(value), isTyped ? typedTooltip : estimateTooltip);
}

function getFilteredNutritionEntries() {
  const search = document.getElementById('nutrition-search').value.trim().toLowerCase();
  const filtered = allNutritionEntries.filter((n) => !search
    || n.name.toLowerCase().includes(search)
    // Classification too, so a group can be pulled up as a set ("dairy")
    // the same way a single ingredient can.
    || n.classification.toLowerCase().includes(search));

  const { key, dir } = nSort;
  return [...filtered].sort((a, b) => {
    if (key === 'micronutrients') return (micronutrientCount(a) - micronutrientCount(b)) * dir;
    if (key === 'uses') return ((nutritionUsageCount(a) ?? -1) - (nutritionUsageCount(b) ?? -1)) * dir;
    if (key === 'calories' || key === 'protein' || key === 'proteinPercent') return ((a[key] ?? 0) - (b[key] ?? 0)) * dir;
    if (key === 'fiber' || key === 'fat' || key === 'carb' || key === 'tef') {
      return ((resolvedNutritionMacros(a)[key] ?? 0) - (resolvedNutritionMacros(b)[key] ?? 0)) * dir;
    }
    return String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' }) * dir;
  });
}

// Malformed JSON in column L (should never happen — only Pull Micronutrients
// writes it — but a hand-edited cell shouldn't be able to break the list
// render) reads back as "nothing pulled yet" rather than throwing.
function parseMicronutrients(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // Readers look nutrients up by USDA name: the top rows are handed back under it
    // (Calories and TEF aren't nutrients), the old lock list is dropped.
    const nutrients = {};
    Object.entries(parsed).forEach(([name, info]) => {
      if (name === NUTRITION_LOCK_KEY || !info || typeof info !== 'object') return;
      const top = NUTRITION_TOP_ROWS.find((r) => r.name === name);
      if ((top && !top.panel) || info.amount === null) return;
      nutrients[top ? top.panel : name] = { amount: info.amount, unit: info.unit };
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
// The values an old "Verified" ✓ vouched for — the label's own figures, not TEF.
const NUTRITION_LABEL_ROWS = ['Calories', 'Protein', 'Dietary Fiber', 'Fat', 'Carbohydrates'];
const NUTRITION_TOP_PANEL_KEYS = new Set([...NUTRITION_TOP_ROWS.map((r) => r.panel).filter(Boolean), 'Energy']);

// A row's locked names: each entry's own `locked` flag. Older cells carried one
// "_locked" list instead, and before that an old Verified meant Amount–Carbohydrates.
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

// The six top values as the form shows them: typed Calories/Protein, and
// Fiber/Fat/Carb/TEF typed or estimated (resolvedNutritionMacros).
function nutritionTopValues(n) {
  const macros = resolvedNutritionMacros(n);
  return {
    Calories: n.calories, Protein: n.protein,
    'Dietary Fiber': macros.fiber, Fat: macros.fat, Carbohydrates: macros.carb, TEF: macros.tef,
  };
}

// The Micronutrients cell: the six top values first, by their form name, then the
// micronutrients; every entry carries its own `locked` tick. `top` maps row name ->
// amount (null when blank); the panel's own copies of the top values are dropped.
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

function micronutrientsCell(n) {
  const parsed = parseMicronutrients(n.micronutrients);
  if (!parsed) return makeCell('—', 'Not pulled yet — select this row and click Complete below');

  const names = Object.keys(parsed).sort((a, b) => a.localeCompare(b));
  const tooltip = names
    .map((name) => `${name}: ${parsed[name].amount} ${parsed[name].unit}`)
    .join('\n');
  return makeCell(String(micronutrientCount(n)), tooltip);
}

// "—" (with a hint to run it) before 📊 Count Uses has computed anything this
// session, otherwise the count itself — 0 included, since that's exactly the
// "never logged, safe to remove" case the button exists to surface.
function usesCell(n) {
  const count = nutritionUsageCount(n);
  if (count === null) return makeCell('—', 'Counted once your Physique days have loaded');
  return makeCell(String(count), `Appears in ${count} logged Consumption line${count === 1 ? '' : 's'} across your Physique days`);
}

function renderNutritionList() {
  const tbody = document.getElementById('nutrition-body');
  tbody.innerHTML = '';

  // Count Uses once Physique is loaded, memoized until the next invalidation
  // (refreshNutrition / refreshPhysique both reset this to null) — so the
  // always-on Uses column and its default sort have real numbers without
  // recounting on every search keystroke. Stays null (reads "—") until the
  // first load, since an empty allPhysiqueEntries would otherwise count
  // everything as a real 0.
  if (physiqueDataLoaded && nutritionUsageCounts === null) {
    nutritionUsageCounts = computeNutritionUsageCounts();
  }

  const filtered = getFilteredNutritionEntries();
  const totalPages = Math.max(1, Math.ceil(filtered.length / N_PAGE_SIZE));
  nCurrentPage = Math.min(nCurrentPage, totalPages);

  const start = (nCurrentPage - 1) * N_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + N_PAGE_SIZE);

  if (pageItems.length === 0) {
    const message = allNutritionEntries.length === 0
      ? 'No ingredients yet — they\'re added automatically the first time Calculate looks one up, or click "Add" in the panel heading to add one yourself.'
      : 'No ingredients match your search.';
    tbody.appendChild(renderEmptyRow(14, message));
  }

  // Computed once per render, not per row — todaysUsedNutritionRows walks
  // today's whole breakdown, and this loop shouldn't repeat that per item.
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
    const amountCell = makeCell(
      (n.amount && !isUsable) ? `${n.amount} ⚠️` : (n.amount || '—'),
      (n.amount && !isUsable) ? 'No gram mass or leading count found — Calculate will skip this row and re-estimate instead' : undefined
    );

    const macros = resolvedNutritionMacros(n);

    tr.append(
      checkboxCell,
      makeCell(n.classification || '—'),
      makeCell(n.name),
      amountCell,
      makeCell(n.calories !== null ? String(n.calories) : '—'),
      makeCell(n.protein !== null ? String(n.protein) : '—'),
      nutritionMacroCell(macros.fiber, macros.typed.fiber),
      nutritionMacroCell(macros.fat, macros.typed.fat),
      nutritionMacroCell(macros.carb, macros.typed.carb),
      nutritionMacroCell(macros.tef, macros.typed.tef, 'Typed by you.', 'Estimated: Protein (typed) plus Carb/Fat (typed or from 🧬 Micronutrients) at the Atwater/TEF-share rates set in Settings.'),
      makeCell(n.proteinPercent !== null ? `${n.proteinPercent}%` : '—', 'Tracked by the Protein Source Rotation chart when set — the % of your protein target this ingredient should cover'),
      micronutrientsCell(n),
      usesCell(n),
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

// Mirrors log-workout-btn's Log/Log More toggle in strength-plan.js: "Log"
// while today's Physique row has no Consumption yet, "Log More" once it
// does — there's no per-ingredient "already logged" state to compare against
// the way workout rows have (the same ingredient can legitimately appear
// twice in one day at different amounts), so this reads coarser, off the
// whole day rather than off which rows are ticked.
function updateNutritionLogButtonLabel() {
  const today = todaysPhysiqueDay();
  const hasToday = Boolean(today && today.consumption && today.consumption.trim());
  const btn = document.getElementById('log-nutrition-btn');
  btn.textContent = hasToday ? 'Log More' : 'Log';
  btn.title = hasToday
    ? "Add the ticked ingredients to today's Consumption"
    : "Log the ticked ingredients as today's Consumption";
}

// "x" for a discrete/per-each row — Amount stored the same way Edit
// Ingredient shows it, e.g. "1x (58g)" — "g" for everything else. Reuses
// the same unit extraction a typed Consumption line itself goes through
// (extractIngredientQuantity, calorie-estimator.js), so a bare "x egg" line
// asks for the same kind of number egg's own Amount already counts in.
function nutritionLogUnit(amount) {
  return extractIngredientQuantity(amount).unit === 'x' ? 'x' : 'g';
}

// Appends the ticked catalogue ingredients to Consumption as bare "g name"
// (or, for a per-each row, "x name") lines and opens the Physique form on
// them — same shape as logWorkout in strength-plan.js, but without its
// auto-Calculate step: a set/rep count is already known when a workout row
// is ticked, while a serving size here isn't, so the line is left for the
// user to type an amount at its front before running Calculate themselves.
function logSelectedNutrition() {
  const selected = allNutritionEntries
    .filter((n) => selectedNutritionRows.has(n.row))
    .sort((a, b) => a.row - b.row);
  if (selected.length === 0) {
    alert('Tick at least one ingredient before logging it to Consumption.');
    return;
  }

  const today = todaysPhysiqueDay();
  const consumption = [today?.consumption ?? '', ...selected.map((n) => `${nutritionLogUnit(n.amount)} ${n.name}`)]
    .filter((part) => part.trim())
    .join('\n');

  openPhysiqueForm(today);
  if (today) document.getElementById('physique-modal-title').textContent = "Add to Today's Consumption";
  physiqueField('consumption').value = consumption;

  selectedNutritionRows.clear();
  renderNutritionList();
}

function renderNutritionPagination(totalPages) {
  renderPager('nutrition-pagination', {
    page: nCurrentPage,
    totalPages,
    onChange: (p) => {
      nCurrentPage = p;
      selectedNutritionRows.clear();
      renderNutritionList();
    },
  });
}

function openNutritionForm(entry, onSaved = null) {
  editingNutritionRow = entry ? entry.row : null;
  nutritionFormSaveCallback = onSaved;
  nutritionFormEntry = entry || null;

  // entry.row is what actually decides Add vs Edit above — a synthetic
  // entry with no row (calorie-estimator.js's ✏️ button, prefilling a
  // not-yet-banked estimate) still adds a new row on Save, so the title
  // should say so too rather than calling it an edit of something that
  // doesn't exist on the sheet yet.
  document.getElementById('nutrition-modal-title').textContent = (entry && entry.row) ? 'Edit Ingredient' : 'Add Ingredient';
  // Only meaningful once there's a saved row (and an old name/amount/macros)
  // to propagate FROM — an Add has nothing on the Physique sheet to find yet.
  document.getElementById('nutrition-update-btn').hidden = !(entry && entry.row);
  document.getElementById('nutrition-classification').value = entry ? entry.classification : '';
  renderNutritionClassificationOptions();
  document.getElementById('nutrition-name').value = entry ? entry.name : '';
  document.getElementById('nutrition-amount').value = entry ? entry.amount : '';
  document.getElementById('nutrition-calories').value = (entry && entry.calories !== null) ? entry.calories : '';
  document.getElementById('nutrition-protein').value = (entry && entry.protein !== null) ? entry.protein : '';
  // Pre-filled from whatever resolvedNutritionMacros would already show in
  // the table (your own typed figure, or the 🧬 Micronutrients/TEF-formula
  // estimate) so Save commits that number as-is unless you change it first.
  const macros = entry ? resolvedNutritionMacros(entry) : { fiber: null, fat: null, carb: null, tef: null };
  document.getElementById('nutrition-fiber').value = macros.fiber ?? '';
  document.getElementById('nutrition-fat').value = macros.fat ?? '';
  document.getElementById('nutrition-carb').value = macros.carb ?? '';
  document.getElementById('nutrition-tef').value = macros.tef ?? '';
  const locked = entry ? nutritionLockedNames(entry) : new Set();
  NUTRITION_TOP_ROWS.forEach((row) => { document.getElementById(row.lockId).checked = locked.has(row.name); });
  document.getElementById('nutrition-protein-percent').value = (entry && entry.proteinPercent !== null) ? entry.proteinPercent : '';

  renderNutritionMicroRows(entry ? parseMicronutrients(entry.micronutrients) : null, locked);

  updateNutritionFormLogButtonLabel();
  clearFieldError('nutrition-form-error');
  document.getElementById('nutrition-modal').hidden = false;
}

// The Edit/Add Ingredient form's own Log button, mirroring the activity
// form's (logActivityFromForm, activities.js): "Log" while today's Physique
// row has no Consumption yet, "Log More" once it does — same coarse,
// whole-day read as the table's log-nutrition-btn (updateNutritionLogButtonLabel),
// since one ingredient can legitimately be logged twice in a day.
function updateNutritionFormLogButtonLabel() {
  const today = todaysPhysiqueDay();
  const hasToday = Boolean(today && today.consumption && today.consumption.trim());
  const btn = document.getElementById('nutrition-log-btn');
  btn.textContent = hasToday ? 'Log More' : 'Log';
  btn.title = hasToday
    ? "Add this ingredient to today's Consumption"
    : "Log this ingredient as today's Consumption";
}

// Logs whatever's currently typed in the form as one line of today's
// Consumption — the same bare "g name" (or "x name" for a per-each row) line
// logSelectedNutrition appends off a ticked table row, just off the form's own
// Name/Amount fields and without requiring the row to be saved to the
// catalogue first (same shape as logActivityFromForm in activities.js).
function logNutritionFromForm() {
  const name = document.getElementById('nutrition-name').value.trim();
  const amount = document.getElementById('nutrition-amount').value.trim();
  if (!name) {
    showFieldError('nutrition-form-error', 'Enter a Name before logging it to Consumption.');
    return;
  }

  const today = todaysPhysiqueDay();
  const consumption = [today?.consumption ?? '', `${nutritionLogUnit(amount)} ${name}`]
    .filter((part) => part.trim())
    .join('\n');

  closeNutritionForm();
  openPhysiqueForm(today);
  if (today) document.getElementById('physique-modal-title').textContent = "Add to Today's Consumption";
  physiqueField('consumption').value = consumption;
}

// The pulled micronutrient rows, appended to the form's fields table under its
// divider: lock tick, name, typeable box, unit. Top-row panel entries are held
// aside in nutritionFormPanelExtras instead of listed twice.
function renderNutritionMicroRows(panel, locked) {
  const box = document.getElementById('nutrition-fields');
  box.querySelectorAll('.nutrition-micro-row').forEach((el) => el.remove());
  nutritionFormPanelExtras = {};
  const shown = [];
  Object.keys(panel || {}).sort((a, b) => a.localeCompare(b)).forEach((name) => {
    if (NUTRITION_TOP_PANEL_KEYS.has(name)) nutritionFormPanelExtras[name] = { ...panel[name] };
    else shown.push(name);
  });
  // Zero amounts go last; each half stays alphabetical.
  shown.sort((a, b) => (Number(panel[a].amount) === 0) - (Number(panel[b].amount) === 0));
  document.getElementById('nutrition-micro-divider').hidden = shown.length === 0;

  shown.forEach((name) => {
    const label = document.createElement('label');
    label.className = 'formula-row nutrition-micro-row';
    const lock = document.createElement('input');
    lock.type = 'checkbox';
    lock.dataset.lockName = name;
    lock.checked = locked.has(name);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'formula-name';
    nameSpan.textContent = name;
    const value = document.createElement('input');
    value.type = 'text';
    value.dataset.microName = name;
    value.dataset.unit = panel[name].unit;
    value.value = panel[name].amount;
    const unit = document.createElement('span');
    unit.className = 'formula-unit';
    unit.textContent = panel[name].unit;
    label.append(lock, nameSpan, value, unit);
    box.appendChild(label);
  });
}

// Every ticked row's name (top rows and micronutrients).
function nutritionFormLockedNames() {
  return new Set([...document.querySelectorAll('#nutrition-fields input[type="checkbox"][data-lock-name]:checked')]
    .map((box) => box.dataset.lockName));
}

// The micronutrient panel as the form shows it: the typed micro rows, plus the
// top-row panel entries kept as they were (their own columns hold the typed figures).
// A micronutrient box's number at full precision (USDA amounts run to 4 decimals);
// an arithmetic expression falls back to the shared evaluator.
function microAmountValue(raw) {
  const text = raw.trim();
  if (!text) return null;
  const plain = Number(text);
  return Number.isFinite(plain) ? plain : evaluateNumberExpression(text);
}

function readNutritionFormPanel() {
  const panel = {};
  document.querySelectorAll('#nutrition-fields .nutrition-micro-row input[type="text"]').forEach((input) => {
    const value = microAmountValue(input.value);
    if (value !== null) panel[input.dataset.microName] = { amount: value, unit: input.dataset.unit };
  });
  Object.entries(nutritionFormPanelExtras).forEach(([name, info]) => { panel[name] = { ...info }; });
  return panel;
}

// Classifications already in use, most-used first — same idea as the Health
// Log's description suggestions, so a free-text column doesn't fragment into
// "Dairy"/"dairy"/"Diary" over time.
function renderNutritionClassificationOptions() {
  const counts = new Map();
  allNutritionEntries
    .filter((n) => n.classification)
    .forEach((n) => counts.set(n.classification, (counts.get(n.classification) || 0) + 1));

  const dl = document.getElementById('nutrition-classification-options');
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

// The Add/Edit Ingredient form's own Complete button — the same job as the bulk
// one on the Nutrition table (pullNutritionFromUsda), on whatever's typed. Amount
// is read, never written; the result lands in the form and is saved by Save.
async function pullMicronutrientsForForm() {
  const btn = document.getElementById('nutrition-pull-micros-single-btn');
  const name = document.getElementById('nutrition-name').value.trim();
  const amount = document.getElementById('nutrition-amount').value.trim();

  clearFieldError('nutrition-form-error');
  if (!name) {
    showFieldError('nutrition-form-error', 'Type an ingredient name first — that name is what gets looked up.');
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Pulling…';

  const result = await pullNutritionFromUsda(name, amount);

  btn.disabled = false;
  btn.textContent = originalLabel;

  if (!result.applied) {
    showFieldError('nutrition-form-error', `Couldn't pull micronutrients for "${name}" — ${result.reason}.`);
    return;
  }

  // Ticked rows are kept as typed; every other row takes the USDA figure. TEF has no
  // USDA figure, so an unticked one gets the estimate from the new Protein/Carb/Fat.
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
  if (!locked.has('TEF')) {
    const box = (id) => evaluateNumberExpression(document.getElementById(id).value.trim());
    const { tef } = resolvedNutritionMacros({
      protein: box('nutrition-protein'), fiber: box('nutrition-fiber'), fat: box('nutrition-fat'),
      carb: box('nutrition-carb'), tef: null, micronutrients: '',
    });
    document.getElementById('nutrition-tef').value = tef ?? '';
  }

  // The new panel, except ticked micronutrient rows keep their own values.
  const current = readNutritionFormPanel();
  const merged = { ...nutrients };
  locked.forEach((name) => { if (current[name]) merged[name] = current[name]; });
  renderNutritionMicroRows(merged, locked);

  if (!locked.has('Protein') && result.protein === null) {
    showFieldError('nutrition-form-error', `"${result.description}" has no protein figure in USDA — fill Protein in yourself before saving.`);
  }
}

// Rescales the form in place to a 100g Amount — same "scale everything to
// match a new gram figure" idea pullNutritionFromUsda already does against
// USDA's per-100g panel, just applied to whatever's currently typed instead
// of a USDA candidate. Requires a real gram figure to scale from (same
// parseGramsFromAmount Calculate and Pull Micronutrients both depend on);
// there's no sane 100g equivalent for a count-only Amount like "2 eggs".
function normalizeIngredientForm() {
  clearFieldError('nutrition-form-error');

  // Name gets standardized regardless of whether Amount has a gram figure —
  // "chicken and rice" / " Chicken  AND  rice " -> "Chicken and Rice",
  // collapsing stray whitespace, capitalizing each word, and lowercasing
  // minor joining words (unless one leads the name) the same way every
  // time, so near-duplicate casing doesn't fragment the catalog the way
  // mergeNutritionDuplicates already guards against for near-duplicate text.
  const nameField = document.getElementById('nutrition-name');
  nameField.value = titleCaseIngredientName(nameField.value);

  const amountField = document.getElementById('nutrition-amount');
  const grams = parseGramsFromAmount(amountField.value);
  if (!grams) {
    showFieldError('nutrition-form-error', 'Amount needs a gram figure (e.g. "33g") before it can be normalized to 100g.');
    return;
  }
  // A leading count (e.g. the "2" in "2x (68g)") describes how many of the
  // thing add up to that gram figure — its count-per-gram density has to stay
  // fixed too, or "2x (68g)" -> "2x (100g)" would silently read as more food
  // than the (unscaled) Calories/Protein actually correspond to. Kept to 2
  // decimals (not rounded to a whole unit) so the count stays exact rather
  // than quietly drifting the density it's meant to preserve.
  const count = parseCountFromAmount(amountField.value);

  const factor = 100 / grams;
  amountField.value = amountField.value.replace(NUTRITION_GRAMS_PATTERN, (full, num) => full.replace(num, '100'));
  if (count !== null) {
    const newCount = Math.round(count * factor * 100) / 100;
    amountField.value = amountField.value.replace(NUTRITION_LEADING_COUNT_PATTERN, (full, num) => full.replace(num, String(newCount)));
  }

  // Calories/TEF as whole kcal, everything else to 1 decimal — same
  // precision pullNutritionFromUsda already writes these fields at.
  const scaleField = (id, decimals) => {
    const field = document.getElementById(id);
    const raw = field.value.trim();
    if (!raw) return;
    const value = evaluateNumberExpression(raw);
    if (value === null) return;
    const rounded = Math.round(value * factor * 10 ** decimals) / 10 ** decimals;
    field.value = String(rounded);
  };
  scaleField('nutrition-calories', 0);
  scaleField('nutrition-protein', 1);
  scaleField('nutrition-fiber', 1);
  scaleField('nutrition-fat', 1);
  scaleField('nutrition-carb', 1);
  scaleField('nutrition-tef', 0);
  // Protein % is a share of total protein intake, not a per-Amount figure —
  // it doesn't move when Amount does.

  // Micronutrient rows and the held top-row panel entries scale the same way.
  document.querySelectorAll('#nutrition-fields .nutrition-micro-row input[type="text"]').forEach((input) => {
    const value = microAmountValue(input.value);
    if (value !== null) input.value = String(Math.round(value * factor * 10000) / 10000);
  });
  Object.values(nutritionFormPanelExtras).forEach((info) => {
    info.amount = Math.round(info.amount * factor * 10000) / 10000;
  });
}

// Reads and validates every hand-editable field of the Add/Edit Ingredient
// form, shared by Save (submitNutritionForm) and Update
// (updateNutritionEntryAndPropagate) so the two can't drift on what counts as
// a valid ingredient. Shows its own field error and returns { ok: false } on
// the first problem found — the caller just needs to check `ok` and return.
function readNutritionFormFields() {
  const classification = document.getElementById('nutrition-classification').value.trim();
  const name = document.getElementById('nutrition-name').value.trim();
  const amount = document.getElementById('nutrition-amount').value.trim();
  const calories = evaluateNumberExpression(document.getElementById('nutrition-calories').value);
  const protein = evaluateNumberExpression(document.getElementById('nutrition-protein').value);
  const proteinPercentRaw = document.getElementById('nutrition-protein-percent').value.trim();
  const proteinPercent = proteinPercentRaw ? evaluateNumberExpression(proteinPercentRaw) : null;

  const readOptionalNumber = (id, label) => {
    const raw = document.getElementById(id).value.trim();
    if (!raw) return { ok: true, value: null };
    const value = evaluateNumberExpression(raw);
    if (value === null) {
      showFieldError('nutrition-form-error', `${label} must be a number.`);
      return { ok: false };
    }
    return { ok: true, value };
  };

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

  const fiberResult = readOptionalNumber('nutrition-fiber', 'Fiber');
  if (!fiberResult.ok) return { ok: false };
  const fatResult = readOptionalNumber('nutrition-fat', 'Fat');
  if (!fatResult.ok) return { ok: false };
  const carbResult = readOptionalNumber('nutrition-carb', 'Carb');
  if (!carbResult.ok) return { ok: false };
  const tefResult = readOptionalNumber('nutrition-tef', 'TEF');
  if (!tefResult.ok) return { ok: false };
  const fiber = fiberResult.value;
  const fat = fatResult.value;
  const carb = carbResult.value;
  const tef = tefResult.value;

  // Micronutrients carries the panel and the ticked rows' names.
  const panel = readNutritionFormPanel();
  const top = nutritionTopValues({ calories, protein, fiber, fat, carb, tef, micronutrients: JSON.stringify(panel) });
  const micronutrients = nutritionColumnL(top, panel, nutritionFormLockedNames());

  return { ok: true, classification, name, amount, calories, protein, fiber, fat, carb, tef, proteinPercent, micronutrients };
}

// Persists the form's fields (readNutritionFormFields) to `editingNutritionRow`
// if it's set, else appends a new row — the actual sheet write shared by Save
// and Update, which differ only in what runs after it lands.
async function saveNutritionFormFields(fields) {
  await ensureNutritionColumns();
  const existing = allNutritionEntries.find((n) => n.row === editingNutritionRow);
  const entry = { ...fields, cells: existing ? existing.cells : [] };
  if (editingNutritionRow) await writeNutritionRow(editingNutritionRow, entry);
  else await appendNutritionRow(entry);
}

async function submitNutritionForm(event) {
  event.preventDefault();

  const fields = readNutritionFormFields();
  if (!fields.ok) return;
  const { name, amount, calories, protein, fiber, fat, carb, tef } = fields;

  try {
    await saveNutritionFormFields(fields);
    // Captured before closeNutritionForm, which clears it — closing the form
    // on a successful save shouldn't itself be what silences the callback.
    const onSaved = nutritionFormSaveCallback;
    closeNutritionForm();
    await refreshNutrition(true);
    if (onSaved) onSaved({ name, amount, calories, protein, fiber, fat, carb, tef });
  } catch (err) {
    showFieldError('nutrition-form-error', err.message);
  }
}

// --- Update: propagate an edited ingredient into Physique ---------------
//
// Ordinary Calculate reuses a day's already-saved Breakdown by exact noteLine
// text match (estimateConsumptionIncrementally, physique-breakdown.js), so it
// never re-checks an unchanged line against the Nutrition table — a renamed
// or re-priced ingredient otherwise leaves every past day quietly wrong until
// someone notices. This button is the one path that reaches back and fixes
// them, entirely locally (no Groq/USDA call): find every Consumption line and
// Breakdown item still under the ingredient's OLD name, rename it, and — for
// whichever ones carry a gram or count figure Amount can be scaled against —
// reprice its Calories/Protein too.

// Same "is this the same ingredient" rule findNutritionEntry uses: exact,
// case-insensitive, falling back to a trailing-"s" fold — matching a second,
// looser way here would let this button and the rest of the app disagree
// about what counts as the same food.
function nutritionNamesMatch(a, b) {
  const ta = String(a || '').trim().toLowerCase();
  const tb = String(b || '').trim().toLowerCase();
  if (!ta || !tb) return false;
  return ta === tb || foldTrailingS(ta) === foldTrailingS(tb);
}

// Rebuilds one Consumption line under the ingredient's new name, keeping
// whatever quantity/unit it already had — the same "<quantity><unit> <name>"
// shape Tidy and Calculate both write (combineAndSortConsumptionText,
// physique-breakdown.js), so a line this touches reads exactly like one
// either of them would have produced. Null when the line's quantity can't be
// parsed at all — the rare hand-typed line with no leading amount, left
// exactly as typed rather than mangled, same as Tidy leaves it.
function renamedConsumptionLine(line, newName) {
  const { quantity, unit } = extractIngredientQuantity(line);
  if (quantity === null) return null;
  const unitText = unit ? (UNIT_CANONICAL[unit] || unit) : '';
  return `${Math.round(quantity * 100) / 100}${unitText} ${newName}`.trim();
}

// Reprices one Breakdown item against the just-saved entry it resolved to,
// off the item's OWN already-resolved amount ("150g" / "×3" — never a fresh
// re-extraction of the Consumption text) using the same grams/count scaling
// calorie-estimator.js's table-hit branch runs. Renames the item (and patches
// its noteLine so a later Calculate's reuse-by-noteLine still recognizes it)
// even when neither figure could be rescaled — a plain rename still has to
// reach the item for it to keep resolving to this row next time. Returns the
// SAME item, unchanged, when there's nothing to do, so the caller can tell
// whether anything actually changed with `!==`.
function repriceBreakdownItemAgainstEntry(item, entry) {
  const renamed = entry.name !== item.name;
  const grams = parseGramsFromAmount(item.amount);
  const count = parseCountFromAmount(item.amount);
  const tableGrams = parseGramsFromAmount(entry.amount);
  const explicitCount = parseCountFromAmount(entry.amount);
  const tableCount = explicitCount !== null ? explicitCount : (tableGrams === null ? 1 : null);

  let calories = item.calories;
  let protein = item.protein;
  let repriced = false;
  if (grams !== null && tableGrams) {
    calories = Math.round((entry.calories / tableGrams) * grams);
    protein = Math.round(((entry.protein / tableGrams) * grams) * 10) / 10;
    repriced = true;
  } else if (count !== null && tableCount) {
    calories = Math.round((entry.calories / tableCount) * count);
    protein = Math.round(((entry.protein / tableCount) * count) * 10) / 10;
    repriced = true;
  }

  if (!renamed && !repriced) return item;
  return {
    ...item,
    name: entry.name,
    calories,
    protein,
    noteLine: (renamed && item.noteLine) ? item.noteLine.replace(item.name, entry.name) : item.noteLine,
    source: repriced ? NUTRITION_TABLE_SOURCE_LABEL : item.source,
  };
}

// The Edit Ingredient form's Update button (openNutritionForm only shows it
// once there's a saved row — an Add has no old name to search Physique for).
// Saves the form exactly like Save, then sweeps every Physique day for the
// OLD name and rewrites whatever it finds — Consumption text always, and a
// day's Breakdown/totals too wherever a matched item could actually be
// repriced (never blanking Calories In/Protein In on a day that was only ever
// hand-typed and has no Breakdown to derive them from).
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
  showFieldError('nutrition-form-error', `Checking ${candidates.length} Physique day${candidates.length === 1 ? '' : 's'}…`);

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
  await Promise.allSettled(edits.map(async (e) => {
    try {
      await writePhysiqueRow(e.row, e.day);
      succeeded.push({ row: e.row, values: e.snapshot });
    } finally {
      done += 1;
      showFieldError('nutrition-form-error', `Updating ${done}/${edits.length} Physique days…`);
    }
  }));

  closeNutritionForm();
  await refreshNutrition(true);
  await refreshPhysique(true);

  showUndoToast(
    `"${updatedEntry.name}" updated — ${succeeded.length} Physique day${succeeded.length === 1 ? '' : 's'} (${linesChanged} line${linesChanged === 1 ? '' : 's'}) rewritten.`,
    () => restorePhysiqueSnapshots(succeeded),
  );
}

async function deleteNutritionEntry(entry) {
  await confirmAndDelete(`Delete "${entry.name}" from Nutrition?`, async () => {
    if (!nutritionSheetId) nutritionSheetId = await fetchNutritionSheetId();
    await batchUpdate([{
      deleteDimension: {
        range: { sheetId: nutritionSheetId, dimension: 'ROWS', startIndex: entry.row - 1, endIndex: entry.row },
      },
    }]);
    selectedNutritionRows.delete(entry.row);
    await refreshNutrition(true);
  }, "Couldn't delete ingredient");
}

// Consolidates duplicates/near-duplicates (e.g. "Chicken Breast" logged
// once by the app's own fallback and again by hand with slightly different
// text) into one row — target is whichever selected row is lowest, blanks
// on it are filled in from the others, nothing is summed (unlike the
// Physique's numeric-reading rollup, these are catalog entries, not
// measurements).
async function mergeSelectedNutritionEntries() {
  const selected = allNutritionEntries.filter((n) => selectedNutritionRows.has(n.row)).sort((a, b) => a.row - b.row);
  if (selected.length < 2) return;

  const target = selected[0];
  const others = selected.slice(1);
  const merged = { ...target };
  if (!merged.classification) merged.classification = (others.find((o) => o.classification) || {}).classification || '';
  if (!merged.amount) merged.amount = (others.find((o) => o.amount) || {}).amount || '';
  if (merged.calories === null) merged.calories = (others.find((o) => o.calories !== null) || {}).calories ?? null;
  if (merged.protein === null) merged.protein = (others.find((o) => o.protein !== null) || {}).protein ?? null;
  if (merged.proteinPercent === null) merged.proteinPercent = (others.find((o) => o.proteinPercent !== null) || {}).proteinPercent ?? null;
  if (merged.fiber === null) merged.fiber = (others.find((o) => o.fiber !== null) || {}).fiber ?? null;
  if (merged.fat === null) merged.fat = (others.find((o) => o.fat !== null) || {}).fat ?? null;
  if (merged.carb === null) merged.carb = (others.find((o) => o.carb !== null) || {}).carb ?? null;
  if (merged.tef === null) merged.tef = (others.find((o) => o.tef !== null) || {}).tef ?? null;

  await confirmAndDelete(
    `Merge ${selected.length} ingredients into "${target.name}"? ` +
    `${others.map((o) => o.name).join(', ')} will be combined into "${target.name}" and their rows deleted. ` +
    `Fields already filled on "${target.name}" are kept as-is; blanks are filled in from the others. This cannot be undone.`,
    async () => {
      if (!nutritionSheetId) nutritionSheetId = await fetchNutritionSheetId();
      if (merged.fiber !== null || merged.fat !== null || merged.carb !== null || merged.tef !== null) await ensureNutritionColumns();

      await writeNutritionRow(target.row, { ...merged, cells: target.cells });

      const deleteRequests = others
        .map((o) => o.row)
        .sort((a, b) => b - a)
        .map((row) => ({
          deleteDimension: {
            range: { sheetId: nutritionSheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
          },
        }));
      await batchUpdate(deleteRequests);

      selectedNutritionRows.clear();
      await refreshNutrition(true);
    },
    "Couldn't merge ingredients",
  );
}

// Beside 🔗 Merge Selected: title-cases every selected row's Name
// (titleCaseIngredientName — same casing the Add/Edit form's own Normalize
// button applies) and writes back only the rows that actually change,
// leaving every other field untouched. Local only, no AI, no lookup.
async function capitalizeSelectedNutritionNames() {
  const btn = document.getElementById('nutrition-bulk-capitalize-btn');
  const statusEl = document.getElementById('nutrition-pull-status');
  const rows = allNutritionEntries.filter((n) => selectedNutritionRows.has(n.row)).sort((a, b) => a.row - b.row);
  if (rows.length === 0) return;

  const changed = rows
    .map((n) => ({ n, newName: titleCaseIngredientName(n.name) }))
    .filter(({ n, newName }) => newName !== n.name);

  statusEl.hidden = false;
  statusEl.classList.add('status-ok');
  if (!changed.length) {
    statusEl.textContent = `Already capitalized — no changes across ${rows.length} selected.`;
    return;
  }

  const originalLabel = btn.textContent;
  for (let i = 0; i < changed.length; i++) {
    const { n, newName } = changed[i];
    btn.textContent = `Capitalizing ${i + 1} of ${changed.length}…`;
    await updateValues(nutritionCellRange('name', n.row), [[newName]]);
  }
  btn.textContent = originalLabel;

  statusEl.textContent = `Capitalized ${changed.length} of ${rows.length} selected ingredient name${changed.length === 1 ? '' : 's'}.`;
  selectedNutritionRows.clear();
  await refreshNutrition(true);
}

// A sheet created before Fiber/Fat/Carbohydrate/TEF existed has a grid only
// as wide as its last real column — Sheets rejects any write past the grid's
// actual size ("Range exceeds grid limits"), which is stricter than just past
// its data, so writing to F:I needs the grid itself widened first. A no-op
// once the sheet has grown past 11 columns, so this only ever does real work
// once.
async function ensureNutritionColumns() {
  const metadata = await getSpreadsheetMetadata();
  const sheet = metadata.sheets.find((s) => s.properties.title === CONFIG.SHEETS.NUTRITION);
  const columnCount = sheet ? sheet.properties.gridProperties.columnCount : 0;
  if (columnCount >= NUTRITION_COLUMNS.length) return;

  const sheetId = findSheetId(metadata, CONFIG.SHEETS.NUTRITION);
  nutritionSheetId = sheetId;
  await batchUpdate([{
    appendDimension: { sheetId, dimension: 'COLUMNS', length: NUTRITION_COLUMNS.length - columnCount },
  }]);

  const headers = [['F1', 'Fiber'], ['G1', 'Fat'], ['H1', 'Carbohydrate'], ['I1', 'TEF']];
  await Promise.all(headers.map(([cell, label]) => updateValues(`'${CONFIG.SHEETS.NUTRITION}'!${cell}`, [[label]])));
}

// The one Complete job, shared byte-for-byte by the bulk button
// and the Add/Edit Ingredient form's own button — same name, same icon, same
// work: given a Name and an Amount that already carries a real gram figure,
// look up USDA's top match and scale its Calories/Protein/full nutrient panel
// down to that gram figure. Amount itself is never read back out or written —
// there's nothing to scale USDA's per-100g figures against without one
// already there, so a blank/non-gram Amount is a failure, not a 100g guess.
// Never writes anywhere itself (a row that doesn't exist yet — the Add
// Ingredient form — has nowhere to write), and never throws — a lookup/
// network failure folds into `reason` too, so no caller needs its own
// try/catch around the USDA round trip.
async function pullNutritionFromUsda(name, amount) {
  const grams = parseGramsFromAmount(amount);
  if (grams === null) return { applied: false, reason: 'Amount has no gram figure to scale from' };

  try {
    const candidates = await usdaLookupKcalCandidates(name);
    if (candidates.length === 0) return { applied: false, reason: 'no USDA match' };

    const candidate = candidates[0];
    const scale = grams / 100;
    return {
      applied: true,
      description: candidate.description,
      calories: Math.round(candidate.kcalPer100g * scale),
      protein: candidate.proteinPer100g !== null ? Math.round(candidate.proteinPer100g * scale * 10) / 10 : null,
      nutrients: candidate.nutrients.length ? nutrientPanelFromCandidate(candidate, grams) : null,
    };
  } catch (err) {
    return { applied: false, reason: err.message };
  }
}

// Scales one USDA candidate's per-100g nutrient panel to a real gram amount —
// shared by pullNutritionFromUsda above, since it's the one place both
// buttons end up with a USDA candidate and a gram figure needing this shape.
function nutrientPanelFromCandidate(candidate, grams) {
  const scale = grams / 100;
  const nutrients = {};
  // Alphabetical, not USDA's nutrient-ID order — so both the saved JSON and
  // the ingredient form's disclosure list read the same way as everything
  // else in the app.
  [...candidate.nutrients].sort((a, b) => a.name.localeCompare(b.name)).forEach((nut) => {
    nutrients[nut.name] = { amount: Math.round(nut.amountPer100g * scale * 10000) / 10000, unit: nut.unit };
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

// Pulls Calories/Protein and the full USDA nutrient panel (macros AND micros
// — vitamins, minerals, everything reported) for every selected row via
// pullMicronutrientsForEntry above. Runs one row at a time (not Promise.all)
// so a rate-limited USDA key fails predictably rather than in a burst.
async function pullMicronutrientsForSelected() {
  const btn = document.getElementById('nutrition-pull-micros-btn');
  const statusEl = document.getElementById('nutrition-pull-status');
  const rows = allNutritionEntries.filter((n) => selectedNutritionRows.has(n.row)).sort((a, b) => a.row - b.row);
  if (rows.length === 0) return;

  statusEl.hidden = true;

  try {
    await ensureNutritionColumns();
  } catch (err) {
    statusEl.hidden = false;
    statusEl.classList.remove('status-ok');
    statusEl.textContent = `Couldn't prepare the Micronutrients column: ${err.message}`;
    return;
  }

  const originalLabel = btn.textContent;
  let pulled = 0;
  const skipped = [];

  for (let i = 0; i < rows.length; i++) {
    const n = rows[i];
    btn.textContent = `Pulling ${i + 1} of ${rows.length}…`;
    const result = await pullMicronutrientsForEntry(n);
    if (result.applied) pulled++;
    else skipped.push(`${n.name} (${result.reason})`);
  }

  btn.textContent = originalLabel;
  statusEl.hidden = false;
  statusEl.classList.toggle('status-ok', skipped.length === 0);
  statusEl.textContent = skipped.length
    ? `Pulled micronutrients for ${pulled} ingredient${pulled === 1 ? '' : 's'} — skipped: ${skipped.join('; ')}`
    : `Pulled micronutrients for ${pulled} ingredient${pulled === 1 ? '' : 's'}.`;

  await refreshNutrition(true);
}

// Tallies every Consumption line ever logged against the Nutrition row it
// resolved to — one count per line across every Physique day's own
// Breakdown (already the exact table match Calculate itself made, via
// findNutritionEntry — not the free-text Consumption, which may phrase a
// name slightly differently than what actually matched). A day whose
// Breakdown predates some ingredient's rename, or was never Calculated,
// simply doesn't count towards it, same "only as fresh as the last
// Calculate" caveat every other breakdown-derived figure in this app has.
// Same match computeNutritionUsageCounts runs across every day, narrowed to
// today's saved breakdown — what tints a Nutrition row .nutrition-row-logged
// the same way strength-plan.js tints a ticked exercise, so a glance at the
// table says which ingredients today's Consumption already resolved to.
// Reads the SAVED breakdown, not the raw Consumption text: a line typed but
// not yet Calculated (including one this panel's own Log button just added)
// has no name to match until Calculate prices it, same as Activity Plan only
// ticks a row once it's actually in today's saved Workout.
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

// Row -> logged-line count across every Physique day, the always-on Uses
// column's source. Called (and memoized) from renderNutritionList once Physique
// has loaded; reads allPhysiqueEntries directly, so an empty/unloaded Physique
// would count everything as 0 — which is why the caller guards on
// physiqueDataLoaded before trusting the result.
function computeNutritionUsageCounts() {
  const counts = new Map();
  allPhysiqueEntries.forEach((p) => {
    parsePhysiqueBreakdown(p.breakdown).forEach((item) => {
      const entry = findNutritionEntry(item.name);
      if (!entry) return;
      counts.set(entry.row, (counts.get(entry.row) || 0) + 1);
    });
  });
  return counts;
}

// Naive singular fold — just enough to catch "egg"/"eggs"-style plural typos
// (a stray/missing trailing "s") without a full stemming library. Only used
// as a fallback below, after an exact match has already failed.
function foldTrailingS(s) {
  return s.length > 1 && s.endsWith('s') ? s.slice(0, -1) : s;
}

// Used by calorie-estimator.js: exact, case-insensitive name match first —
// the "search + manual edit + merge" tools above are the intended way to
// reconcile near-duplicate names the AI happens to phrase differently. Falls
// back to matching with a trailing "s" folded off both sides, so a note
// typed as "2 eggs" still hits an existing "egg" row (or vice versa) instead
// of banking a same-food duplicate under the pluralized name.
function findNutritionEntry(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  const exact = allNutritionEntries.find((n) => n.name.toLowerCase() === target);
  if (exact) return exact;
  const targetFolded = foldTrailingS(target);
  return allNutritionEntries.find((n) => foldTrailingS(n.name.toLowerCase()) === targetFolded) || null;
}

// Appends a fallback-computed ingredient so it's a trusted lookup hit next
// time. Doesn't refresh allNutritionEntries itself — a Calculate call may
// add several ingredients in one go, so the caller refreshes once at the end.
// Classification (column A) is left blank: the app has no basis for guessing
// one, and a blank is honest about that where a wrong label wouldn't be.
// Fiber/Fat/Carb are optional — only a hand-typed anchor (calorie-estimator.js)
// or an edited row (✏️ on a Calculate breakdown) ever supplies them, so most
// callers still bank the same five-cell row as before and the sheet's grid
// only needs widening (ensureNutritionColumns) when one of the three is set.
async function addNutritionEntry({ name, amount, calories, protein, fiber, fat, carb }) {
  if (fiber !== undefined || fat !== undefined || carb !== undefined) await ensureNutritionColumns();
  await appendNutritionRow({ classification: '', name, amount, calories, protein, fiber, fat, carb });
}
