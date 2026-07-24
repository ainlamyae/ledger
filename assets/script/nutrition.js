// Nutrition Facts: a personal, editable ingredient database the Health Log's
// 🧮 Calculate button (calorie-estimator.js) checks before falling back to
// the AI/USDA estimate — once an ingredient's real calories/protein (from
// the specific brand/product actually bought) is recorded here, it's reused
// instead of being re-guessed every time.

const NUTRITION_RANGE = `'${CONFIG.SHEETS.NUTRITION}'!A2:E`;
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
    document.getElementById('nutrition-form').addEventListener('submit', submitNutritionForm);

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

  document.getElementById('nutrition-bulk-merge-btn').addEventListener('click', mergeSelectedNutritionEntries);
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
      name: (row[0] || '').trim(),
      amount: row[1] || '',
      calories: (row[2] !== undefined && row[2] !== '') ? Number(row[2]) : null,
      protein: (row[3] !== undefined && row[3] !== '') ? Number(row[3]) : null,
      // Column E: blank means computed by the USDA/AI fallback, "1" means
      // you've checked it against the label on your own purchased
      // ingredient — never written by the app itself, only by hand here.
      verified: String(row[4] || '').trim() === '1',
    }))
    .filter((n) => n.name);

  renderNutritionList();
}

function getFilteredNutritionEntries() {
  const search = document.getElementById('nutrition-search').value.trim().toLowerCase();
  const filtered = allNutritionEntries.filter((n) => !search || n.name.toLowerCase().includes(search));

  const { key, dir } = nSort;
  return [...filtered].sort((a, b) => {
    if (key === 'calories' || key === 'protein') return ((a[key] ?? 0) - (b[key] ?? 0)) * dir;
    if (key === 'verified') return ((a.verified ? 1 : 0) - (b.verified ? 1 : 0)) * dir;
    return String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' }) * dir;
  });
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
      ? 'No ingredients yet — they\'re added automatically the first time Calculate looks one up, or click "+ Add Ingredient" to add one yourself.'
      : 'No ingredients match your search.';
    tbody.appendChild(renderEmptyRow(7, message));
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
      (n.amount && !isUsable) ? 'No gram weight or leading count found — Calculate will skip this row and re-estimate instead' : undefined
    );

    tr.append(
      checkboxCell,
      makeCell(n.name),
      amountCell,
      makeCell(n.calories !== null ? String(n.calories) : '—'),
      makeCell(n.protein !== null ? String(n.protein) : '—'),
      makeCell(n.verified ? '✅' : '', n.verified ? 'Verified against the label on your own purchased ingredient' : 'From the USDA/AI fallback — not yet checked against a real label'),
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
  document.getElementById('nutrition-name').value = entry ? entry.name : '';
  document.getElementById('nutrition-amount').value = entry ? entry.amount : '';
  document.getElementById('nutrition-calories').value = (entry && entry.calories !== null) ? entry.calories : '';
  document.getElementById('nutrition-protein').value = (entry && entry.protein !== null) ? entry.protein : '';
  document.getElementById('nutrition-verified').checked = entry ? entry.verified : false;

  clearFieldError('nutrition-form-error');
  document.getElementById('nutrition-modal').hidden = false;
}

function closeNutritionForm() {
  document.getElementById('nutrition-modal').hidden = true;
  editingNutritionRow = null;
}

async function submitNutritionForm(event) {
  event.preventDefault();

  const name = document.getElementById('nutrition-name').value.trim();
  const amount = document.getElementById('nutrition-amount').value.trim();
  const calories = evaluateNumberExpression(document.getElementById('nutrition-calories').value);
  const protein = evaluateNumberExpression(document.getElementById('nutrition-protein').value);
  const verified = document.getElementById('nutrition-verified').checked;

  if (!name) {
    showFieldError('nutrition-form-error', 'Name is required.');
    return;
  }
  if (calories === null || protein === null) {
    showFieldError('nutrition-form-error', 'Calories and Protein must be numbers.');
    return;
  }

  const values = [[name, amount, calories, protein, verified ? '1' : '']];

  try {
    if (editingNutritionRow) {
      await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!A${editingNutritionRow}:E${editingNutritionRow}`, values);
    } else {
      await appendValues(NUTRITION_RANGE, values);
    }
    closeNutritionForm();
    await refreshNutrition(true);
  } catch (err) {
    showFieldError('nutrition-form-error', err.message);
  }
}

async function deleteNutritionEntry(entry) {
  await confirmAndDelete(`Delete "${entry.name}" from Nutrition Facts?`, async () => {
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
// Health Log's numeric-reading merge, these are catalog entries, not
// measurements).
async function mergeSelectedNutritionEntries() {
  const selected = allNutritionEntries.filter((n) => selectedNutritionRows.has(n.row)).sort((a, b) => a.row - b.row);
  if (selected.length < 2) return;

  const target = selected[0];
  const others = selected.slice(1);
  const merged = { ...target };
  if (!merged.amount) merged.amount = (others.find((o) => o.amount) || {}).amount || '';
  if (merged.calories === null) merged.calories = (others.find((o) => o.calories !== null) || {}).calories ?? null;
  if (merged.protein === null) merged.protein = (others.find((o) => o.protein !== null) || {}).protein ?? null;
  // A row verified against a real label stays verified even if it's merged
  // with unverified fallback duplicates — never the other way around.
  merged.verified = merged.verified || others.some((o) => o.verified);

  await confirmAndDelete(
    `Merge ${selected.length} ingredients into "${target.name}"? ` +
    `${others.map((o) => o.name).join(', ')} will be combined into "${target.name}" and their rows deleted. ` +
    `Fields already filled on "${target.name}" are kept as-is; blanks are filled in from the others. This cannot be undone.`,
    async () => {
      if (!nutritionSheetId) nutritionSheetId = await fetchNutritionSheetId();

      await updateValues(`'${CONFIG.SHEETS.NUTRITION}'!A${target.row}:E${target.row}`,
        [[merged.name, merged.amount, merged.calories, merged.protein, merged.verified ? '1' : '']]);

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
async function addNutritionEntry({ name, amount, calories, protein }) {
  await appendValues(NUTRITION_RANGE, [[name, amount, calories, protein]]);
}
