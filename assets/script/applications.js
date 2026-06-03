const APPLICATIONS_RANGE = `'${CONFIG.SHEETS.APPLICATIONS}'!A2:E`;

let allApplications = [];
let applicationsListenersAttached = false;
let applicationsSheetId = null;
let editingApplicationRow = null;
const expandedApplicationRows = new Set();

async function fetchApplicationsSheetId() {
  const { sheets } = await getSpreadsheetMetadata();
  const sheet = sheets.find((s) => s.properties.title === CONFIG.SHEETS.APPLICATIONS);
  if (!sheet) throw new Error(`Sheet "${CONFIG.SHEETS.APPLICATIONS}" not found`);
  return sheet.properties.sheetId;
}

async function initApplications(forceRefresh = false) {
  if (!applicationsListenersAttached) {
    applicationsListenersAttached = true;

    document.getElementById('add-application-btn').addEventListener('click', () => openApplicationForm(null));
    document.getElementById('application-cancel-btn').addEventListener('click', closeApplicationForm);
    document.getElementById('application-form').addEventListener('submit', submitApplicationForm);

    document.getElementById('applications-search').addEventListener('input', renderApplicationsList);
  }

  await refreshApplications(forceRefresh);
}

// Applications!A2:E isn't a flat table: a row starting a new application has
// both Type (col D) and App Number (col E) set, and is optionally followed by
// status-update rows that only carry Date + Action, until the next
// application's header row. The sheet's last two rows are whole-column
// SUM/DATEDIF footer formulas ("Total Waiting time" / "Total Time in
// Canada") rather than data, so any row whose Action mentions "Total" is
// skipped entirely instead of being treated as an update.
function parseApplications(rows) {
  const applications = [];
  let current = null;

  rows.forEach((row, i) => {
    const sheetRow = i + 2;
    const delay = row[0];
    const date = row[1] || '';
    const action = row[2] || '';
    const type = row[3] || '';
    const appNumber = row[4] || '';

    if (/total/i.test(action)) return;

    if (type && appNumber) {
      current = { headerRow: sheetRow, lastRow: sheetRow, delayDays: delay || '', date, action, type, appNumber, updates: [] };
      applications.push(current);
    } else if (current && (date || action)) {
      current.updates.push({ row: sheetRow, date, action });
      current.lastRow = sheetRow;
    }
  });

  return applications;
}

async function refreshApplications(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('applications');
  if (!values) {
    const resp = await getValues(APPLICATIONS_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('applications', values);
  }

  allApplications = parseApplications(values);
  renderApplicationsList();
}

// Malformed/unparseable dates sort as oldest (0) rather than throwing off
// the whole list.
function dateTimestamp(dateStr) {
  const t = new Date(dateStr).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function getFilteredApplications() {
  const search = document.getElementById('applications-search').value.trim().toLowerCase();

  const filtered = search
    ? allApplications.filter((app) => {
        const haystacks = [app.type, app.appNumber, app.action, ...app.updates.map((u) => u.action)];
        return haystacks.some((field) => field.toLowerCase().includes(search));
      })
    : allApplications;

  return [...filtered].sort((a, b) => dateTimestamp(b.date) - dateTimestamp(a.date));
}

function latestStatus(app) {
  if (app.updates.length === 0) return { date: app.date, action: app.action };
  return app.updates[app.updates.length - 1];
}

function renderApplicationsList() {
  const container = document.getElementById('applications-list');
  container.innerHTML = '';

  const filtered = getFilteredApplications();

  if (filtered.length === 0) {
    const message = allApplications.length === 0
      ? 'No applications yet — click "+ Add Application" to get started.'
      : 'No applications match your search.';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = message;
    container.appendChild(empty);
    return;
  }

  filtered.forEach((app) => {
    const card = document.createElement('div');
    card.className = 'app-card';
    if (!expandedApplicationRows.has(app.headerRow)) card.classList.add('collapsed');

    const header = document.createElement('div');
    header.className = 'app-card-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', String(!card.classList.contains('collapsed')));

    const icon = document.createElement('span');
    icon.className = 'panel-toggle-icon app-card-toggle-icon';
    icon.textContent = '▾';

    const title = document.createElement('div');
    title.className = 'app-card-title';
    const status = latestStatus(app);

    const titleMain = document.createElement('strong');
    titleMain.textContent = `${app.type} — ${app.appNumber}`;
    const titleMeta = document.createElement('span');
    titleMeta.className = 'app-card-meta';
    titleMeta.textContent = `Submitted ${app.date}${app.delayDays !== '' ? ` · Delay ${app.delayDays}d` : ''} · Latest: ${status.action} (${status.date})`;

    title.append(titleMain, titleMeta);

    const actions = document.createElement('div');
    actions.className = 'app-card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openApplicationForm(app); });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteApplication(app); });

    actions.append(editBtn, deleteBtn);
    header.append(icon, title, actions);

    const toggle = () => {
      card.classList.toggle('collapsed');
      const expanded = !card.classList.contains('collapsed');
      header.setAttribute('aria-expanded', String(expanded));
      if (expanded) expandedApplicationRows.add(app.headerRow);
      else expandedApplicationRows.delete(app.headerRow);
    };

    header.addEventListener('click', () => {
      if (window.getSelection().toString()) return;
      toggle();
    });
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    const body = document.createElement('div');
    body.className = 'app-card-body';

    if (app.updates.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No status updates recorded yet.';
      body.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'app-history';
      app.updates.forEach((u) => {
        const item = document.createElement('li');
        const date = document.createElement('span');
        date.className = 'app-history-date';
        date.textContent = u.date;
        const action = document.createElement('span');
        action.className = 'app-history-action';
        action.textContent = u.action;
        item.append(date, action);
        list.appendChild(item);
      });
      body.appendChild(list);
    }

    card.append(header, body);
    container.appendChild(card);
  });
}

const APPLICATION_FIELD_IDS = ['type', 'number', 'date', 'action'];

function openApplicationForm(app) {
  editingApplicationRow = app ? app.headerRow : null;

  document.getElementById('application-modal-title').textContent = app ? 'Edit Application' : 'Add Application';

  const values = app ? [app.type, app.appNumber, app.date, app.action] : ['', '', '', 'Submited'];
  APPLICATION_FIELD_IDS.forEach((id, i) => {
    document.getElementById(`application-${id}`).value = values[i];
  });

  document.getElementById('application-form-error').hidden = true;
  document.getElementById('application-modal').hidden = false;
}

function closeApplicationForm() {
  document.getElementById('application-modal').hidden = true;
}

async function submitApplicationForm(event) {
  event.preventDefault();

  const errorEl = document.getElementById('application-form-error');
  const [type, appNumber, date, action] = APPLICATION_FIELD_IDS.map((id) => document.getElementById(`application-${id}`).value.trim());

  try {
    if (editingApplicationRow !== null) {
      await updateValues(`'${CONFIG.SHEETS.APPLICATIONS}'!B${editingApplicationRow}:E${editingApplicationRow}`, [[date, action, type, appNumber]]);
    } else {
      if (!applicationsSheetId) applicationsSheetId = await fetchApplicationsSheetId();

      // Insert a fresh row 2 rather than appending at the bottom, so the new
      // application lands above the existing data and the whole-column
      // SUM/DATEDIF footer formulas (last two rows) shift down and stay intact
      // instead of having a new row written after them.
      await batchUpdate([{
        insertDimension: {
          range: { sheetId: applicationsSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
          inheritFromBefore: false,
        },
      }]);
      await updateValues(`'${CONFIG.SHEETS.APPLICATIONS}'!A2:E2`, [['', date, action, type, appNumber]]);
    }
    await refreshApplications(true);
    closeApplicationForm();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

async function deleteApplication(app) {
  const historyNote = app.updates.length > 0 ? ` and its ${app.updates.length} status update(s)` : '';
  if (!confirm(`Delete "${app.type} — ${app.appNumber}"${historyNote}? This cannot be undone.`)) return;

  try {
    if (!applicationsSheetId) applicationsSheetId = await fetchApplicationsSheetId();
    await batchUpdate([{
      deleteDimension: {
        range: {
          sheetId: applicationsSheetId,
          dimension: 'ROWS',
          startIndex: app.headerRow - 1,
          endIndex: app.lastRow,
        },
      },
    }]);
    expandedApplicationRows.delete(app.headerRow);
    await refreshApplications(true);
  } catch (err) {
    alert(`Couldn't delete application: ${err.message}`);
  }
}
