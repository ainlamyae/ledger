// Nutrition: a personal, editable ingredient database Physique's
// 🧮 Calculate button (calorie-estimator.js) checks before falling back to
// the AI/USDA estimate — once an ingredient's real calories/protein (from
// the specific brand/product actually bought) is recorded here, it's reused
// instead of being re-guessed every time.

// A2:L — Classification, Name, Amount, Calories, Protein, Fiber, Fat,
// Carbohydrate, TEF, Verification, Percent, Micronutrients.
const NUTRITION_RANGE = `'${CONFIG.SHEETS.NUTRITION}'!A2:L`;
const N_PAGE_SIZE = 25;

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
let nSort = { key: 'name', dir: 1 };
let nCurrentPage = 1;
let nutritionSheetId = null;
let editingNutritionRow = null;
let selectedNutritionRows = new Set();
// Holds the micronutrient panel bundled with whichever USDA candidate 🔍 Look
// Up last applied — the search response already carries every candidate's
// full nutrient panel, so applying one is free, no second lookup. Deferred to
// Save rather than written immediately (Edit mode used to write straight to
// the sheet on pull) so browsing candidates before picking one doesn't fire a
// write per click. Cleared whenever the form opens or closes so a stale pull
// can't leak into the next ingredient.
let pendingIngredientMicronutrients = null;
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
// that row, per 📊 Count Uses beside Search. UI-only — never written to the
// sheet — and null until that button's been clicked at least once this
// session, so "never logged" (0) reads differently from "haven't checked
// yet" (—). Recomputing is cheap enough (refreshPhysique is cached) to just
// throw away and redo on every click rather than trying to keep it in sync
// with edits in between.
let nutritionUsageCounts = null;

async function fetchNutritionSheetId() {
  const metadata = await getSpreadsheetMetadata();
  return findSheetId(metadata, CONFIG.SHEETS.NUTRITION);
}

async function initNutrition(forceRefresh = false) {
  if (!nutritionListenersAttached) {
    nutritionListenersAttached = true;

    document.getElementById('add-nutrition-btn').addEventListener('click', () => openNutritionForm(null));
    document.getElementById('nutrition-cancel-btn').addEventListener('click', closeNutritionForm);
    onFormSubmit('nutrition-form', submitNutritionForm);
    document.getElementById('nutrition-pull-micros-single-btn').addEventListener('click', pullMicronutrientsForForm);

    document.getElementById('nutrition-search').addEventListener('input', () => {
      nCurrentPage = 1;
      selectedNutritionRows.clear();
      renderNutritionList();
    });
    document.getElementById('nutrition-usage-btn').addEventListener('click', refreshNutritionUsageCounts);

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
  let values = forceRefresh ? null : getCached('nutrition');
  if (!values) {
    const resp = await getValues(NUTRITION_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('nutrition', values);
  }

  allNutritionEntries = values
    .map((row, i) => ({
      row: i + 2,
      // Column A: free-text grouping for the ingredient (e.g. "Dairy",
      // "Poultry"). Never written by the app's own fallback — a row it banks
      // is left blank for you to classify.
      classification: (row[0] || '').trim(),
      name: (row[1] || '').trim(),
      amount: row[2] || '',
      calories: (row[3] !== undefined && row[3] !== '') ? Number(row[3]) : null,
      protein: (row[4] !== undefined && row[4] !== '') ? Number(row[4]) : null,
      // Columns F-I: hand-typed Fiber/Fat/Carbohydrate (g) and TEF (kcal) for
      // this row's own Amount — null means "not typed", which is what tells
      // resolvedNutritionMacros to fall back to the 🧬 Micronutrients-derived
      // estimate/TEF formula instead of trusting a real number.
      fiber: (row[5] !== undefined && row[5] !== '') ? Number(row[5]) : null,
      fat: (row[6] !== undefined && row[6] !== '') ? Number(row[6]) : null,
      carb: (row[7] !== undefined && row[7] !== '') ? Number(row[7]) : null,
      tef: (row[8] !== undefined && row[8] !== '') ? Number(row[8]) : null,
      // Column J: blank means computed by the USDA/AI fallback, "1" means
      // you've checked it against the label on your own purchased
      // ingredient — never written by the app itself, only by hand here.
      verified: String(row[9] || '').trim() === '1',
      // Column K: blank means "not tracked" — protein-rotation.js's Protein
      // Source Rotation chart only includes rows with a number here: what
      // % of your (live, body-mass/activity-driven) protein target this
      // ingredient should cover, e.g. 10 for "turkey = 10% of my protein".
      proteinPercent: (row[10] !== undefined && row[10] !== '') ? Number(row[10]) : null,
      // Column L: JSON object of the full USDA nutrient panel (macros AND
      // micros), scaled to this row's own Amount — written only by Pull
      // Micronutrients below, never by hand. Kept as the raw string here;
      // parsed on demand (parseMicronutrients) so a malformed cell can't
      // break the whole list render.
      micronutrients: (row[11] || '').trim(),
    }))
    .filter((n) => n.name);

  nutritionDataLoaded = true;
  renderNutritionList();
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

// How many nutrients Pull Micronutrients has banked for this row — 0 for
// "never pulled", the same count the Micronutrients cell itself displays.
function micronutrientCount(n) {
  const parsed = parseMicronutrients(n.micronutrients);
  return parsed ? Object.keys(parsed).length : 0;
}

// null before 📊 Count Uses has run this session (see nutritionUsageCounts
// above), otherwise how many Consumption lines resolved to this row —
// 0 is a real, meaningful answer here ("never logged, safe to remove"), so
// it's kept distinct from "not computed yet" rather than defaulting to it.
function nutritionUsageCount(n) {
  return nutritionUsageCounts ? (nutritionUsageCounts.get(n.row) ?? 0) : null;
}

// One Fiber/Fat/Carb/TEF table cell: "—" when there's neither a typed figure
// nor anything to estimate from, otherwise the resolved number with a
// tooltip saying whether it's yours or an estimate (custom typed/estimated
// tooltip text for TEF, since its estimate is a formula rather than a raw
// 🧬 Micronutrients read).
function nutritionMacroCell(value, isTyped, typedTooltip = 'Typed by you.', estimateTooltip = 'Estimated from 🧬 Micronutrients — select this row and click 🧬 Pull Micronutrients below if it hasn\'t been pulled yet.') {
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
    if (key === 'verified') return ((a.verified ? 1 : 0) - (b.verified ? 1 : 0)) * dir;
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
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}

function micronutrientsCell(n) {
  const parsed = parseMicronutrients(n.micronutrients);
  if (!parsed) return makeCell('—', 'Not pulled yet — select this row and click 🧬 Pull Micronutrients below');

  const names = Object.keys(parsed).sort((a, b) => a.localeCompare(b));
  const tooltip = names
    .map((name) => `${name}: ${parsed[name].amount} ${parsed[name].unit}`)
    .join('\n');
  return makeCell(`${names.length} nutrients`, tooltip);
}

// "—" (with a hint to run it) before 📊 Count Uses has computed anything this
// session, otherwise the count itself — 0 included, since that's exactly the
// "never logged, safe to remove" case the button exists to surface.
function usesCell(n) {
  const count = nutritionUsageCount(n);
  if (count === null) return makeCell('—', 'Click 📊 Count Uses beside Search to fill this in');
  return makeCell(String(count), `Appears in ${count} logged Consumption line${count === 1 ? '' : 's'} across your Physique days`);
}

function renderNutritionList() {
  const tbody = document.getElementById('nutrition-body');
  tbody.innerHTML = '';

  const filtered = getFilteredNutritionEntries();
  const totalPages = Math.max(1, Math.ceil(filtered.length / N_PAGE_SIZE));
  nCurrentPage = Math.min(nCurrentPage, totalPages);

  const start = (nCurrentPage - 1) * N_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + N_PAGE_SIZE);

  if (pageItems.length === 0) {
    const message = allNutritionEntries.length === 0
      ? 'No ingredients yet — they\'re added automatically the first time Calculate looks one up, or click "Add" in the panel heading to add one yourself.'
      : 'No ingredients match your search.';
    tbody.appendChild(renderEmptyRow(15, message));
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
      makeCell(n.verified ? '✅' : '', n.verified ? 'Verified against the label on your own purchased ingredient' : 'From the USDA/AI fallback — not yet checked against a real label'),
      makeCell(n.proteinPercent !== null ? `${n.proteinPercent}%` : '—', 'Tracked by the Protein Source Rotation chart when set — the % of your protein target this ingredient should cover'),
      micronutrientsCell(n),
      usesCell(n),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openNutritionForm(n) }),
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
  pendingIngredientMicronutrients = null;
  nutritionFormSaveCallback = onSaved;

  // entry.row is what actually decides Add vs Edit above — a synthetic
  // entry with no row (calorie-estimator.js's ✏️ button, prefilling a
  // not-yet-banked estimate) still adds a new row on Save, so the title
  // should say so too rather than calling it an edit of something that
  // doesn't exist on the sheet yet.
  document.getElementById('nutrition-modal-title').textContent = (entry && entry.row) ? 'Edit Ingredient' : 'Add Ingredient';
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
  document.getElementById('nutrition-verified').checked = entry ? entry.verified : false;
  document.getElementById('nutrition-protein-percent').value = (entry && entry.proteinPercent !== null) ? entry.proteinPercent : '';

  renderNutritionMicronutrientsDetails(entry);

  clearFieldError('nutrition-form-error');
  document.getElementById('nutrition-modal').hidden = false;
}

// The ingredient form's collapsed-by-default Micronutrients disclosure —
// hidden entirely when there's nothing pulled yet, open state left alone once
// expanded across renders within one 🔍 Look Up's refresh. Prefers whatever
// pendingIngredientMicronutrients holds (a candidate applied this session,
// not yet saved) over the row's own saved panel, since that's the fresher
// figure Save is about to commit.
function renderNutritionMicronutrientsDetails(entry) {
  const parsed = pendingIngredientMicronutrients ?? (entry ? parseMicronutrients(entry.micronutrients) : null);
  renderMicronutrientsList(parsed);
}

function renderMicronutrientsList(parsed) {
  const details = document.getElementById('nutrition-micronutrients-details');
  const list = document.getElementById('nutrition-micronutrients-list');
  list.innerHTML = '';

  if (!parsed) {
    details.hidden = true;
    return;
  }

  Object.keys(parsed).sort((a, b) => a.localeCompare(b)).forEach((name) => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    const valueSpan = document.createElement('span');
    valueSpan.textContent = `${parsed[name].amount} ${parsed[name].unit}`;
    li.append(nameSpan, valueSpan);
    list.appendChild(li);
  });
  details.hidden = false;
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
  pendingIngredientMicronutrients = null;
  nutritionFormSaveCallback = null;
}

// The Add/Edit Ingredient form's own 🧬 Pull Micronutrients button — same
// name, same icon, same job as the bulk one on the Nutrition table (see
// pullNutritionFromUsda), just applied to whatever's currently typed rather
// than a saved row. Amount is read, never written: fill it in with a real
// gram figure first, the same way a row needs one before the bulk button can
// touch it. Deferred to Save (pendingIngredientMicronutrients) rather than
// written immediately — there's no row to write into yet in Add mode, and
// Edit mode stays consistent with it rather than writing early.
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

  document.getElementById('nutrition-calories').value = String(result.calories);
  document.getElementById('nutrition-protein').value = result.protein !== null ? String(result.protein) : '';

  // Fiber/Fat/Carb straight into their own fields too, same as Calories/
  // Protein just above — the panel already carries these (nutrientPanelFromCandidate),
  // so leaving the fields themselves blank and making Save rely on the JSON
  // panel alone (computedNutritionMacros' fallback) meant the numbers were
  // "in" the row without ever actually being visible or hand-correctable here.
  const nutrients = result.nutrients || {};
  const macroField = (nutrientName, fieldId) => {
    const nutrient = nutrients[nutrientName];
    document.getElementById(fieldId).value = nutrient ? String(nutrient.amount) : '';
  };
  macroField('Fiber, total dietary', 'nutrition-fiber');
  macroField('Total lipid (fat)', 'nutrition-fat');
  macroField('Carbohydrate, by difference', 'nutrition-carb');

  pendingIngredientMicronutrients = result.nutrients;
  renderMicronutrientsList(pendingIngredientMicronutrients);

  if (result.protein === null) {
    showFieldError('nutrition-form-error', `"${result.description}" has no protein figure in USDA — fill Protein in yourself before saving.`);
  }
}

async function submitNutritionForm(event) {
  event.preventDefault();

  const classification = document.getElementById('nutrition-classification').value.trim();
  const name = document.getElementById('nutrition-name').value.trim();
  const amount = document.getElementById('nutrition-amount').value.trim();
  const calories = evaluateNumberExpression(document.getElementById('nutrition-calories').value);
  const protein = evaluateNumberExpression(document.getElementById('nutrition-protein').value);
  const verified = document.getElementById('nutrition-verified').checked;
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
    return;
  }
  if (calories === null || protein === null) {
    showFieldError('nutrition-form-error', 'Calories and Protein must be numbers.');
    return;
  }
  if (proteinPercentRaw && proteinPercent === null) {
    showFieldError('nutrition-form-error', 'Protein % must be a number.');
    return;
  }

  const fiberResult = readOptionalNumber('nutrition-fiber', 'Fiber');
  if (!fiberResult.ok) return;
  const fatResult = readOptionalNumber('nutrition-fat', 'Fat');
  if (!fatResult.ok) return;
  const carbResult = readOptionalNumber('nutrition-carb', 'Carb');
  if (!carbResult.ok) return;
  const tefResult = readOptionalNumber('nutrition-tef', 'TEF');
  if (!tefResult.ok) return;
  const fiber = fiberResult.value;
  const fat = fatResult.value;
  const carb = carbResult.value;
  const tef = tefResult.value;

  // Every hand-editable field (A-K) is one contiguous range now that
  // Micronutrients (L) sits at the very end rather than splitting the row in
  // two. L itself is only ever included here when 🔍 Look Up applied a fresh
  // candidate this session (pendingIngredientMicronutrients) — otherwise the
  // write is scoped to A:K so an Edit save can't blank out a panel pulled in
  // an earlier session.
  const rowData = [
    classification, name, amount, calories, protein,
    fiber !== null ? fiber : '', fat !== null ? fat : '', carb !== null ? carb : '', tef !== null ? tef : '',
    verified ? '1' : '', proteinPercent !== null ? proteinPercent : '',
  ];
  if (pendingIngredientMicronutrients) rowData.push(JSON.stringify(pendingIngredientMicronutrients));

  try {
    if (editingNutritionRow) {
      await ensureNutritionColumns();
      const lastCol = pendingIngredientMicronutrients ? 'L' : 'K';
      await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!A${editingNutritionRow}:${lastCol}${editingNutritionRow}`, [rowData]);
    } else {
      if (fiber !== null || fat !== null || carb !== null || tef !== null || pendingIngredientMicronutrients) await ensureNutritionColumns();
      await appendValues(NUTRITION_RANGE, [rowData]);
    }
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
  // A row verified against a real label stays verified even if it's merged
  // with unverified fallback duplicates — never the other way around.
  merged.verified = merged.verified || others.some((o) => o.verified);
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

      await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!A${target.row}:K${target.row}`, [[
        merged.classification, merged.name, merged.amount, merged.calories, merged.protein,
        merged.fiber !== null ? merged.fiber : '', merged.fat !== null ? merged.fat : '', merged.carb !== null ? merged.carb : '', merged.tef !== null ? merged.tef : '',
        merged.verified ? '1' : '', merged.proteinPercent !== null ? merged.proteinPercent : '',
      ]]);

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
  if (columnCount >= 12) return;

  const sheetId = findSheetId(metadata, CONFIG.SHEETS.NUTRITION);
  nutritionSheetId = sheetId;
  await batchUpdate([{
    appendDimension: { sheetId, dimension: 'COLUMNS', length: 12 - columnCount },
  }]);

  const headers = [['F1', 'Fiber'], ['G1', 'Fat'], ['H1', 'Carbohydrate'], ['I1', 'TEF']];
  await Promise.all(headers.map(([cell, label]) => updateValues(`'${CONFIG.SHEETS.NUTRITION}'!${cell}`, [[label]])));
}

// The one 🧬 Pull Micronutrients job, shared byte-for-byte by the bulk button
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

// Bulk wrapper: resolves and writes straight to this existing row's own
// Calories/Protein (D:E) and, when USDA had nutrient detail, Micronutrients
// (L) — Amount, Fiber/Fat/Carb/TEF and Verified are never part of either
// write, so nothing else about the row moves.
async function pullMicronutrientsForEntry(n) {
  const result = await pullNutritionFromUsda(n.name, n.amount);
  if (!result.applied) return result;

  await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!D${n.row}:E${n.row}`, [[result.calories, result.protein !== null ? result.protein : '']]);
  if (result.nutrients) {
    await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!L${n.row}:L${n.row}`, [[JSON.stringify(result.nutrients)]]);
  }
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

// 📊 Count Uses, beside Search — UI-only (nutritionUsageCounts is never
// written to the sheet), so it's fine to just throw the last count away and
// redo it in full on every click rather than trying to track edits in
// between. Physique isn't otherwise loaded by this panel, so this pulls it
// in itself the first time (refreshPhysique is cached, so a click made after
// visiting Physique already is effectively free).
async function refreshNutritionUsageCounts() {
  const btn = document.getElementById('nutrition-usage-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Counting…';
  try {
    await refreshPhysique();
    nutritionUsageCounts = computeNutritionUsageCounts();
    // Mutated in place, not reassigned — makeSortableHeaders (ui-helpers.js)
    // closed over this exact object when the column headers were wired up,
    // so a new object here would desync the header's own click handler from
    // what getFilteredNutritionEntries reads on the very next sort click.
    nSort.key = 'uses';
    nSort.dir = 1;
    updateSortIndicators('#nutrition-table', nSort);
    nCurrentPage = 1;
    renderNutritionList();
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
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
  const hasMacros = fiber !== undefined || fat !== undefined || carb !== undefined;
  if (hasMacros) await ensureNutritionColumns();
  const row = hasMacros
    ? ['', name, amount, calories, protein, fiber ?? '', fat ?? '', carb ?? '']
    : ['', name, amount, calories, protein];
  await appendValues(NUTRITION_RANGE, [row]);
}
