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
    document.getElementById('nutrition-usda-btn').addEventListener('click', lookupNutritionFromUsda);
    onAsyncClick('nutrition-pull-micros-single-btn', pullMicronutrientsForEditingRow);

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
  onAsyncClick('nutrition-pull-micros-btn', pullMicronutrientsForSelected);
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
    tbody.appendChild(renderEmptyRow(14, message));
  }

  pageItems.forEach((n) => {
    const tr = document.createElement('tr');

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

function openNutritionForm(entry) {
  editingNutritionRow = entry ? entry.row : null;

  document.getElementById('nutrition-modal-title').textContent = entry ? 'Edit Ingredient' : 'Add Ingredient';
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

  // Pulling only makes sense against a row that already exists (it writes
  // straight to that row's H cell by number) — hidden entirely in Add mode.
  document.getElementById('nutrition-pull-micros-single-btn').hidden = !entry;
  renderNutritionMicronutrientsDetails(entry);

  clearFieldError('nutrition-form-error');
  clearUsdaResults();
  document.getElementById('nutrition-modal').hidden = false;
}

// The Edit Ingredient form's collapsed-by-default Micronutrients disclosure —
// hidden entirely when the row has never been pulled (nothing to show), open
// state left alone once expanded across renders within one Pull click's refresh.
function renderNutritionMicronutrientsDetails(entry) {
  const details = document.getElementById('nutrition-micronutrients-details');
  const list = document.getElementById('nutrition-micronutrients-list');
  list.innerHTML = '';

  const parsed = entry ? parseMicronutrients(entry.micronutrients) : null;
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
  clearUsdaResults();
}

function clearUsdaResults() {
  const results = document.getElementById('nutrition-usda-results');
  results.innerHTML = '';
  results.hidden = true;
}

// Fills Amount/Calories/Protein from the typed Name via USDA FoodData Central
// (the same database and search helper calorie-estimator.js already uses).
//
// Unlike Calculate, there's no AI estimate here to sanity-check a result
// against — so pickPlausibleMacros's trust test can't run, and USDA's relevance
// ranking is genuinely capable of putting "Oil, soybean" (884 kcal) above the
// bean (~140) for "soybeans". Every candidate is therefore listed for the user
// to judge, with the top one applied so the common case is still one click.
async function lookupNutritionFromUsda() {
  const btn = document.getElementById('nutrition-usda-btn');
  const name = document.getElementById('nutrition-name').value.trim();

  if (!name) {
    showFieldError('nutrition-form-error', 'Type an ingredient name first — that name is what gets looked up.');
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Looking up…';
  clearFieldError('nutrition-form-error');
  clearUsdaResults();

  try {
    const candidates = await usdaLookupKcalCandidates(name);
    if (candidates.length === 0) {
      showFieldError('nutrition-form-error', `No USDA match for "${name}" — try a plainer, more generic name (not a brand), or fill the figures in by hand.`);
      return;
    }
    renderUsdaCandidates(candidates);
    applyUsdaCandidate(candidates[0]);
  } catch (err) {
    showFieldError('nutrition-form-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function renderUsdaCandidates(candidates) {
  const results = document.getElementById('nutrition-usda-results');

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = candidates.length === 1
    ? 'USDA FoodData Central match, per 100 g — applied below.'
    : 'USDA FoodData Central matches, per 100 g. The first is applied below; pick another if it describes your ingredient better.';
  results.appendChild(hint);

  candidates.forEach((candidate) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn usda-candidate';
    btn.dataset.description = candidate.description;
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = `${candidate.description} — ${Math.round(candidate.kcalPer100g)} kcal, ${formatUsdaProtein(candidate)}`;
    btn.addEventListener('click', () => applyUsdaCandidate(candidate));
    results.appendChild(btn);
  });

  results.hidden = false;
}

function formatUsdaProtein(candidate) {
  return candidate.proteinPer100g !== null
    ? `${Math.round(candidate.proteinPer100g * 10) / 10} g protein`
    : 'no protein figure';
}

// USDA reports per 100 g, so Amount is set to match — it's the quantity the
// Calories/Protein actually describe, and the same shape Calculate banks its
// own USDA-derived rows in, which keeps every auto-filled row scalable.
//
// Name is left as typed and Verified is left alone: a database figure is not a
// label checked against your own purchased product, which is the only thing
// that tick is supposed to mean.
function applyUsdaCandidate(candidate) {
  document.getElementById('nutrition-amount').value = '100g';
  document.getElementById('nutrition-calories').value = String(Math.round(candidate.kcalPer100g));
  document.getElementById('nutrition-protein').value = candidate.proteinPer100g !== null
    ? String(Math.round(candidate.proteinPer100g * 10) / 10)
    : '';

  document.querySelectorAll('#nutrition-usda-results .usda-candidate').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.description === candidate.description));
  });

  if (candidate.proteinPer100g === null) {
    showFieldError('nutrition-form-error', `"${candidate.description}" has no protein figure in USDA — fill Protein in yourself before saving.`);
  } else {
    clearFieldError('nutrition-form-error');
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
  // Micronutrients (L, machine-written only by Pull Micronutrients) sits at
  // the very end rather than splitting the row in two — one write instead of
  // two, and L is never touched here either way.
  const rowData = [
    classification, name, amount, calories, protein,
    fiber !== null ? fiber : '', fat !== null ? fat : '', carb !== null ? carb : '', tef !== null ? tef : '',
    verified ? '1' : '', proteinPercent !== null ? proteinPercent : '',
  ];

  try {
    if (editingNutritionRow) {
      await ensureNutritionColumns();
      await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!A${editingNutritionRow}:K${editingNutritionRow}`, [rowData]);
    } else {
      if (fiber !== null || fat !== null || carb !== null || tef !== null) await ensureNutritionColumns();
      await appendValues(NUTRITION_RANGE, [rowData]);
    }
    closeNutritionForm();
    await refreshNutrition(true);
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

// Core single-row pull, shared by the bulk button below and the single-row
// one in the Edit Ingredient modal: looks up USDA, resolves a trustworthy
// candidate (or asks via confirm() when its energy doesn't match this row's
// own Calories), and writes the scaled nutrient panel to column L. Never
// throws — a lookup/network failure is folded into `reason` too — so neither
// caller needs its own try/catch around the USDA round trip.
//
// Columns A-K are never part of the write — the update below is scoped to
// L{row}:L{row} only, so Calories/Protein/Fiber/Fat/Carb/TEF/Verified stay
// exactly as they were, no matter how trusted the USDA match is or whether
// the row is verified.
async function pullMicronutrientsForEntry(n) {
  // USDA's figures are per 100 g — a row with no gram figure in Amount
  // (e.g. a bare count like "2 eggs") has nothing to scale them against.
  const grams = parseGramsFromAmount(n.amount);
  if (grams === null) return { applied: false, reason: 'Amount has no gram figure to scale from' };
  const kcalPer100gReference = (n.calories / grams) * 100;

  try {
    const candidates = await usdaLookupKcalCandidates(n.name);
    if (candidates.length === 0) return { applied: false, reason: 'no USDA match' };

    let candidate = pickPlausibleUsdaCandidate(candidates, kcalPer100gReference);
    if (!candidate) {
      const top = candidates[0];
      const apply = confirm(
        `USDA's top match for "${n.name}" is "${top.description}" at ${Math.round(top.kcalPer100g)} kcal/100g — ` +
        `far from this row's own ${Math.round(kcalPer100gReference)} kcal/100g, so it's probably the wrong food. ` +
        `Apply its micronutrients anyway?`
      );
      if (!apply) return { applied: false, reason: "USDA match's energy didn't match — declined" };
      candidate = top;
    }

    if (!candidate.nutrients.length) return { applied: false, reason: 'USDA match has no nutrient detail' };

    const scale = grams / 100;
    const nutrients = {};
    // Alphabetical, not USDA's nutrient-ID order — so both the saved JSON and
    // the Edit Ingredient disclosure list read the same way as everything
    // else in the app.
    [...candidate.nutrients].sort((a, b) => a.name.localeCompare(b.name)).forEach((nut) => {
      nutrients[nut.name] = { amount: Math.round(nut.amountPer100g * scale * 10000) / 10000, unit: nut.unit };
    });

    await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!L${n.row}:L${n.row}`, [[JSON.stringify(nutrients)]]);
    return { applied: true };
  } catch (err) {
    return { applied: false, reason: err.message };
  }
}

// Pulls the full USDA nutrient panel (macros AND micros — vitamins,
// minerals, everything reported) for every selected row via
// pullMicronutrientsForEntry above. Runs one row at a time (not Promise.all)
// so a per-row energy-mismatch confirm() doesn't fire for several rows at
// once, and so a rate-limited USDA key fails predictably rather than in a burst.
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

// Single-row equivalent for the Edit Ingredient modal's own 🧬 button — only
// ever shown there for an already-saved row (see openNutritionForm), since a
// row has to exist to have an H cell to write into. Reads the row's saved
// Amount/Calories, not whatever's currently typed in the form but unsaved —
// Save first if you want a just-edited Amount reflected in the scaling.
async function pullMicronutrientsForEditingRow() {
  if (!editingNutritionRow) return;
  const entry = allNutritionEntries.find((n) => n.row === editingNutritionRow);
  if (!entry) return;

  const errorEl = document.getElementById('nutrition-form-error');
  clearFieldError('nutrition-form-error');
  errorEl.classList.remove('status-ok');

  try {
    await ensureNutritionColumns();
  } catch (err) {
    showFieldError('nutrition-form-error', `Couldn't prepare the Micronutrients column: ${err.message}`);
    return;
  }

  const result = await pullMicronutrientsForEntry(entry);
  if (!result.applied) {
    showFieldError('nutrition-form-error', `Couldn't pull micronutrients for "${entry.name}" — ${result.reason}.`);
    return;
  }

  await refreshNutrition(true);
  renderNutritionMicronutrientsDetails(allNutritionEntries.find((n) => n.row === editingNutritionRow));
  errorEl.textContent = `Pulled micronutrients for "${entry.name}".`;
  errorEl.classList.add('status-ok');
  errorEl.hidden = false;
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
async function addNutritionEntry({ name, amount, calories, protein }) {
  await appendValues(NUTRITION_RANGE, [['', name, amount, calories, protein]]);
}
