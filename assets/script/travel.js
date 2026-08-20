const TRAVEL_RANGE = `'${CONFIG.SHEETS.TRAVEL}'!A2:H`;
const TRAVEL_PAGE_SIZE = 25;

let allTravel = [];
let travelListenersAttached = false;
let travelSort = { key: null, dir: 1 };
let travelCurrentPage = 1;
let travelSheetId = null;
let editingTravelRow = null;

async function fetchTravelSheetId() {
  const metadata = await getSpreadsheetMetadata();
  return findSheetId(metadata, CONFIG.SHEETS.TRAVEL);
}

async function initTravel(forceRefresh = false) {
  if (!travelListenersAttached) {
    travelListenersAttached = true;

    document.getElementById('add-travel-btn').addEventListener('click', () => openTravelForm(null));
    document.getElementById('travel-cancel-btn').addEventListener('click', closeTravelForm);
    onFormSubmit('travel-form', submitTravelForm);

    document.getElementById('travel-search').addEventListener('input', () => {
      travelCurrentPage = 1;
      renderTravelList();
    });

    setupTravelSorting();
  }

  await refreshTravel(forceRefresh);
}

function setupTravelSorting() {
  makeSortableHeaders('#travel-table', travelSort, () => {
    travelCurrentPage = 1;
    renderTravelList();
  });
}

async function refreshTravel(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('travel');
  if (!values) {
    const resp = await getValues(TRAVEL_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('travel', values);
  }

  allTravel = values
    .map((row, i) => ({
      row: i + 2,
      countryCity: row[0] || '',
      port: row[1] || '',
      type: row[2] || '',
      via: row[3] || '',
      date: row[4] || '',
      time: row[5] || '',
      reason: row[6] || '',
      detail: row[7] || '',
    }))
    .filter((t) => t.countryCity || t.port);

  renderTravelList();
  renderCountryDaysList(computeCountryDays(allTravel, getSettingString('BIRTH_DATE', '')));
  renderWorldMapChart(getVisitedCountries(allTravel));
}

function getFilteredTravel() {
  const search = document.getElementById('travel-search').value.trim().toLowerCase();

  const filtered = allTravel.filter((t) => {
    if (!search) return true;
    return [t.countryCity, t.port, t.type, t.via, t.reason, t.detail]
      .some((field) => field.toLowerCase().includes(search));
  });

  if (!travelSort.key) return [...filtered].reverse();

  const { key, dir } = travelSort;
  return [...filtered].sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' }) * dir);
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

    tr.append(
      makeCell(t.date),
      makeCell(t.type),
      makeCell(t.countryCity),
      makeCell(t.port),
      makeCell(t.via),
      makeCell(t.reason),
      makeCell(t.detail),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openTravelForm(t) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteTravelEntry(t) }),
    );
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  renderTravelPagination(totalPages);
}

function renderTravelPagination(totalPages) {
  renderPager('travel-pagination', {
    page: travelCurrentPage,
    totalPages,
    onChange: (p) => {
      travelCurrentPage = p;
      renderTravelList();
    },
  });
}

const TRAVEL_FIELD_IDS = ['country-city', 'port', 'type', 'via', 'date', 'time', 'reason', 'detail'];

function openTravelForm(travel) {
  editingTravelRow = travel ? travel.row : null;

  document.getElementById('travel-modal-title').textContent = travel ? 'Edit Travel Entry' : 'Log a Travel Entry';

  const values = travel
    ? [travel.countryCity, travel.port, travel.type, travel.via, travel.date, travel.time, travel.reason, travel.detail]
    : ['', '', '', '', '', '', '', ''];

  TRAVEL_FIELD_IDS.forEach((id, i) => {
    document.getElementById(`travel-${id}`).value = values[i];
  });

  clearFieldError('travel-form-error');
  document.getElementById('travel-modal').hidden = false;
}

function closeTravelForm() {
  document.getElementById('travel-modal').hidden = true;
}

async function submitTravelForm(event) {
  event.preventDefault();

  const rowData = TRAVEL_FIELD_IDS.map((id) => document.getElementById(`travel-${id}`).value.trim());

  try {
    if (editingTravelRow !== null) {
      await updateValues(`'${CONFIG.SHEETS.TRAVEL}'!A${editingTravelRow}:H${editingTravelRow}`, [rowData]);
    } else {
      await appendValues(TRAVEL_RANGE, [rowData]);
    }
    await refreshTravel(true);
    closeTravelForm();
  } catch (err) {
    showFieldError('travel-form-error', err.message);
  }
}

async function deleteTravelEntry(travel) {
  await confirmAndDelete(`Delete this travel entry (${travel.countryCity || travel.port})?`, async () => {
    if (!travelSheetId) travelSheetId = await fetchTravelSheetId();
    await batchUpdate([{
      deleteDimension: {
        range: {
          sheetId: travelSheetId,
          dimension: 'ROWS',
          startIndex: travel.row - 1,
          endIndex: travel.row,
        },
      },
    }]);
    await refreshTravel(true);
  }, "Couldn't delete travel entry");
}
