const TRAVEL_RANGE = sheetRange(CONFIG.SHEETS.TRAVEL, 'A2:H');
const TRAVEL_PAGE_SIZE = 25;
// Sheet columns A–H, in order; each has a travel-<kebab-case> form field.
const TRAVEL_FIELD_KEYS = ['countryCity', 'port', 'type', 'via', 'date', 'time', 'reason', 'detail'];
const TRAVEL_TABLE_KEYS = ['date', 'type', 'countryCity', 'port', 'via', 'reason', 'detail'];
const TRAVEL_SEARCH_KEYS = ['countryCity', 'port', 'type', 'via', 'reason', 'detail'];

let allTravel = [];
let editTravel = null;
let travelListenersAttached = false;
let travelSort = { key: null, dir: 1 };
let travelCurrentPage = 1;
let travelSheetId = null;
let editingTravelRow = null;

// "countryCity" -> the travel-country-city input.
function travelFieldId(key) {
  return `travel-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

async function initTravel(forceRefresh = false) {
  if (!travelListenersAttached) {
    travelListenersAttached = true;
    const rerenderFromFirstPage = () => {
      travelCurrentPage = 1;
      renderTravelList();
    };

    document.getElementById('add-travel-btn').addEventListener('click', () => openTravelForm(null));
    editTravel = routedRowEdit('travel', () => allTravel, (t) => `${t.date} ${t.countryCity}`, openTravelForm);
    document.getElementById('travel-cancel-btn').addEventListener('click', closeTravelForm);
    onFormSubmit('travel-form', submitTravelForm);
    document.getElementById('travel-search').addEventListener('input', rerenderFromFirstPage);
    makeSortableHeaders('#travel-table', travelSort, rerenderFromFirstPage);
  }

  await refreshTravel(forceRefresh);
}

async function refreshTravel(forceRefresh = false) {
  // Re-looked up on the next delete, in case the spreadsheet changed.
  travelSheetId = null;
  const resp = await getValues(TRAVEL_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

  allTravel = values
    .map((row, i) => {
      const fields = TRAVEL_FIELD_KEYS.map((key, col) => [key, travelCellValue(key, row[col])]);
      return { row: i + 2, ...Object.fromEntries(fields) };
    })
    .filter((t) => t.countryCity || t.port);

  renderTravelList();
  renderCountryDaysList(computeCountryDays(allTravel, getSettingString('BIRTH_DATE', '')));
  renderWorldMapChart(getVisitedCountries(allTravel));
}

// Older rows were USER_ENTERED, so Date/Time may read in a display format.
function travelCellValue(key, value) {
  if (key === 'date') return sheetDateIso(value);
  if (key === 'time') return normalizeTimeCell(value);
  return cellText(value);
}

// Newest (last sheet row) first until a column is sorted.
function getFilteredTravel() {
  const search = document.getElementById('travel-search').value.trim().toLowerCase();

  const filtered = allTravel.filter((t) => !search
    || TRAVEL_SEARCH_KEYS.some((key) => t[key].toLowerCase().includes(search)));

  if (!travelSort.key) return filtered.reverse();

  const { key, dir } = travelSort;
  return filtered.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' }) * dir);
}

function renderTravelList() {
  const tbody = document.getElementById('travel-body');
  tbody.innerHTML = '';

  const filtered = getFilteredTravel();
  const totalPages = Math.max(1, Math.ceil(filtered.length / TRAVEL_PAGE_SIZE));
  travelCurrentPage = Math.min(travelCurrentPage, totalPages);

  const start = (travelCurrentPage - 1) * TRAVEL_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + TRAVEL_PAGE_SIZE);

  if (pageItems.length === 0) {
    const message = allTravel.length === 0
      ? 'No travel entries yet — click "Log" in the panel heading to get started.'
      : 'No travel entries match your search.';
    tbody.appendChild(renderEmptyRow(8, message));
  }

  pageItems.forEach((t) => {
    const tr = document.createElement('tr');
    tr.append(...TRAVEL_TABLE_KEYS.map((key) => makeCell(key === 'date' ? shortYearDate(t[key]) : t[key])));

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editTravel(t) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteTravelEntry(t) }),
    );
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  renderPager('travel-pagination', {
    page: travelCurrentPage,
    totalPages,
    onChange: (p) => {
      travelCurrentPage = p;
      renderTravelList();
    },
  });
}

function openTravelForm(travel) {
  editingTravelRow = travel ? travel.row : null;
  TRAVEL_FIELD_KEYS.forEach((key) => {
    document.getElementById(travelFieldId(key)).value = travel ? travel[key] : '';
  });

  clearFieldError('travel-form-error');
  document.getElementById('travel-modal').hidden = false;
}

function closeTravelForm() {
  document.getElementById('travel-modal').hidden = true;
}

async function submitTravelForm(event) {
  event.preventDefault();

  const rowData = TRAVEL_FIELD_KEYS.map((key) => document.getElementById(travelFieldId(key)).value.trim());

  try {
    let row = editingTravelRow;
    if (row !== null) {
      // RAW: nothing here needs parsing, and "1/2" or "=x" must stay as typed.
      await updateValues(sheetRange(CONFIG.SHEETS.TRAVEL, `A${row}:H${row}`), [rowData], 'RAW');
    } else {
      row = appendedRow(await appendValues(TRAVEL_RANGE, [rowData], 'RAW'));
    }
    await refreshTravel(true);
    const saved = allTravel.find((t) => t.row === row);
    if (saved) {
      openTravelForm(saved);
      stayOnSavedForm('travel-modal', editTravel.step(saved));
    }
    showFormSaved('travel-form-error');
  } catch (err) {
    showFieldError('travel-form-error', err.message);
  }
}

async function deleteTravelEntry(travel) {
  await confirmAndDelete(`Delete this travel entry (${travel.countryCity || travel.port})?`, async () => {
    if (travelSheetId === null) travelSheetId = findSheetId(await getSpreadsheetMetadata(), CONFIG.SHEETS.TRAVEL);
    await batchUpdate([sheetRowDeleteRequest(travelSheetId, travel.row)]);
    await refreshTravel(true);
  }, "Couldn't delete travel entry");
}
