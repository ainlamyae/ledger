const TRAVEL_RANGE = `'${CONFIG.SHEETS.TRAVEL}'!A2:H`;
const TRAVEL_PAGE_SIZE = 25;

let allTravel = [];
let travelListenersAttached = false;
let travelSort = { key: null, dir: 1 };
let travelCurrentPage = 1;
let travelSheetId = null;
let editingTravelRow = null;

async function fetchTravelSheetId() {
  const { sheets } = await getSpreadsheetMetadata();
  const sheet = sheets.find((s) => s.properties.title === CONFIG.SHEETS.TRAVEL);
  if (!sheet) throw new Error(`Sheet "${CONFIG.SHEETS.TRAVEL}" not found`);
  return sheet.properties.sheetId;
}

async function initTravel(forceRefresh = false) {
  if (!travelListenersAttached) {
    travelListenersAttached = true;

    document.getElementById('add-travel-btn').addEventListener('click', () => openTravelForm(null));
    document.getElementById('travel-cancel-btn').addEventListener('click', closeTravelForm);
    document.getElementById('travel-form').addEventListener('submit', submitTravelForm);

    document.getElementById('travel-search').addEventListener('input', () => {
      travelCurrentPage = 1;
      renderTravelList();
    });

    setupTravelSorting();
  }

  await refreshTravel(forceRefresh);
}

function setupTravelSorting() {
  document.querySelectorAll('#travel-table th.sortable').forEach((th) => {
    const label = document.createElement('span');
    label.textContent = th.textContent;
    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';
    th.textContent = '';
    th.append(label, indicator);
    th.setAttribute('tabindex', '0');

    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (travelSort.key === key) {
        travelSort.dir *= -1;
      } else {
        travelSort.key = key;
        travelSort.dir = 1;
      }
      updateTravelSortIndicators();
      travelCurrentPage = 1;
      renderTravelList();
    });
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
    });
  });
  updateTravelSortIndicators();
}

function updateTravelSortIndicators() {
  document.querySelectorAll('#travel-table th.sortable').forEach((th) => {
    const indicator = th.querySelector('.sort-indicator');
    if (!indicator) return;
    indicator.textContent = th.dataset.sort === travelSort.key ? (travelSort.dir === 1 ? ' ▲' : ' ▼') : '';
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
      ? 'No travel entries yet — click "+ Add Travel Entry" to get started.'
      : 'No travel entries match your search.';
    tbody.appendChild(renderEmptyRow(8, message));
  }

  pageItems.forEach((t) => {
    const tr = document.createElement('tr');

    const makeCell = (text) => {
      const td = document.createElement('td');
      td.textContent = text;
      return td;
    };

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

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.addEventListener('click', () => openTravelForm(t));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', () => deleteTravelEntry(t));

    actionsCell.append(editBtn, deleteBtn);
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  renderTravelPagination(totalPages);
}

function renderTravelPagination(totalPages) {
  const container = document.getElementById('travel-pagination');
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const prev = document.createElement('button');
  prev.className = 'btn';
  prev.textContent = '⬅️';
  prev.title = 'Previous page';
  prev.setAttribute('aria-label', 'Previous page');
  prev.disabled = travelCurrentPage === 1;
  prev.addEventListener('click', () => { travelCurrentPage--; renderTravelList(); });

  const info = document.createElement('span');
  info.textContent = `${travelCurrentPage} of ${totalPages}`;

  const next = document.createElement('button');
  next.className = 'btn';
  next.textContent = '➡️';
  next.title = 'Next page';
  next.setAttribute('aria-label', 'Next page');
  next.disabled = travelCurrentPage === totalPages;
  next.addEventListener('click', () => { travelCurrentPage++; renderTravelList(); });

  container.append(prev, info, next);
}

const TRAVEL_FIELD_IDS = ['country-city', 'port', 'type', 'via', 'date', 'time', 'reason', 'detail'];

function openTravelForm(travel) {
  editingTravelRow = travel ? travel.row : null;

  document.getElementById('travel-modal-title').textContent = travel ? 'Edit Travel Entry' : 'Add Travel Entry';

  const values = travel
    ? [travel.countryCity, travel.port, travel.type, travel.via, travel.date, travel.time, travel.reason, travel.detail]
    : ['', '', '', '', '', '', '', ''];

  TRAVEL_FIELD_IDS.forEach((id, i) => {
    document.getElementById(`travel-${id}`).value = values[i];
  });

  document.getElementById('travel-form-error').hidden = true;
  document.getElementById('travel-modal').hidden = false;
}

function closeTravelForm() {
  document.getElementById('travel-modal').hidden = true;
}

async function submitTravelForm(event) {
  event.preventDefault();

  const errorEl = document.getElementById('travel-form-error');
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
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

async function deleteTravelEntry(travel) {
  if (!confirm(`Delete this travel entry (${travel.countryCity || travel.port})?`)) return;

  try {
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
  } catch (err) {
    alert(`Couldn't delete travel entry: ${err.message}`);
  }
}
