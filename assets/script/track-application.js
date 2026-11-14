// Row 1 is the header, so data (and a new application's insert) starts here.
const APPLICATIONS_FIRST_ROW = 2;
const APPLICATIONS_SHEET = `'${CONFIG.SHEETS.APPLICATIONS}'`;
const APPLICATIONS_RANGE = `${APPLICATIONS_SHEET}!A${APPLICATIONS_FIRST_ROW}:E`;
// The sheet's own spelling.
const APPLICATION_DEFAULT_ACTION = 'Submited';

let allApplications = [];
let editApplication = null;
let applicationsListenersAttached = false;
let applicationsSheetId = null;
let editingApplicationRow = null;
const expandedApplicationRows = new Set();

// Fetched once, then cached.
async function getApplicationsSheetId() {
  if (!applicationsSheetId) {
    const metadata = await getSpreadsheetMetadata();
    applicationsSheetId = findSheetId(metadata, CONFIG.SHEETS.APPLICATIONS);
  }
  return applicationsSheetId;
}

async function initApplications(forceRefresh = false) {
  if (!applicationsListenersAttached) {
    applicationsListenersAttached = true;

    document.getElementById('add-application-btn').addEventListener('click', () => openApplicationForm(null));
    editApplication = routedRowEdit('application', () => allApplications, (a) => `${a.type} ${a.appNumber}`, openApplicationForm);
    document.getElementById('application-cancel-btn').addEventListener('click', closeApplicationForm);
    onFormSubmit('application-form', submitApplicationForm);

    document.getElementById('applications-search').addEventListener('input', renderApplicationsList);
  }

  await refreshApplications(forceRefresh);
}

// Not a flat table: a header row (Type and App Number set) starts an application,
// followed by status-update rows with only Date + Action. The sheet's "Total …"
// footer formula rows are skipped.
function parseApplications(rows) {
  const applications = [];
  let current = null;

  rows.forEach((row, i) => {
    const sheetRow = i + APPLICATIONS_FIRST_ROW;
    const [delay = '', date = '', action = '', type = '', appNumber = ''] = row.map((cell) => cell || '');

    if (/total/i.test(action)) return;

    if (type && appNumber) {
      current = { headerRow: sheetRow, lastRow: sheetRow, delayDays: delay, date, action, type, appNumber, updates: [] };
      applications.push(current);
    } else if (current && (date || action)) {
      current.updates.push({ row: sheetRow, date, action });
      current.lastRow = sheetRow;
    }
  });

  return applications;
}

async function refreshApplications() {
  const resp = await getValues(APPLICATIONS_RANGE, VALUE_PARAMS);
  allApplications = parseApplications(resp.values || []);
  renderApplicationsList();
}

// Unparseable dates sort as oldest.
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

// `new Date('YYYY-MM-DD')` is UTC midnight, a day early west of UTC: build a local date.
function isSameDayAsToday(dateStr) {
  if (!dateStr) return false;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
  const d = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(dateStr);

  return !Number.isNaN(d.getTime()) && d.toDateString() === new Date().toDateString();
}

// Ongoing while its submission or any update is dated today; a closed one stops moving.
function isApplicationOngoing(app) {
  return isSameDayAsToday(app.date) || app.updates.some((u) => isSameDayAsToday(u.date));
}

function applicationEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderApplicationsList() {
  const container = document.getElementById('applications-list');
  container.innerHTML = '';

  const filtered = getFilteredApplications();

  if (filtered.length === 0) {
    const message = allApplications.length === 0
      ? 'No applications yet — click "Log" in the panel heading to get started.'
      : 'No applications match your search.';
    container.appendChild(applicationEl('div', 'empty-state', message));
    return;
  }

  const renderGroup = (title, apps) => {
    if (apps.length === 0) return;
    container.appendChild(applicationEl('h3', 'applications-group-title', `${title} (${apps.length})`));
    apps.forEach((app) => container.appendChild(buildApplicationCard(app)));
  };

  renderGroup('Ongoing', filtered.filter(isApplicationOngoing));
  renderGroup('Closed', filtered.filter((app) => !isApplicationOngoing(app)));
}

function buildApplicationCard(app) {
  const card = applicationEl('div', 'app-card');
  if (!expandedApplicationRows.has(app.headerRow)) card.classList.add('collapsed');

  const header = applicationEl('div', 'app-card-header');
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', String(!card.classList.contains('collapsed')));

  const icon = applicationEl('span', 'panel-toggle-icon app-card-toggle-icon', '▾');

  const status = latestStatus(app);
  const delay = app.delayDays !== '' ? ` · Delay ${app.delayDays}d` : '';
  const title = applicationEl('div', 'app-card-title');
  title.append(
    applicationEl('strong', '', `${app.type} — ${app.appNumber}`),
    applicationEl('span', 'app-card-meta', `Submitted ${app.date}${delay} · Latest: ${status.action} (${status.date})`),
  );

  const actions = applicationEl('div', 'app-card-actions');
  actions.append(
    makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: (e) => { e.stopPropagation(); editApplication(app); } }),
    makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: (e) => { e.stopPropagation(); return deleteApplication(app); } }),
  );
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

  const body = applicationEl('div', 'app-card-body');

  if (app.updates.length === 0) {
    body.appendChild(applicationEl('p', 'hint', 'No status updates recorded yet.'));
  } else {
    const list = applicationEl('ul', 'app-history');
    app.updates.forEach((u) => {
      const item = document.createElement('li');
      item.append(applicationEl('span', 'app-history-date', u.date), applicationEl('span', 'app-history-action', u.action));
      list.appendChild(item);
    });
    body.appendChild(list);
  }

  card.append(header, body);
  return card;
}

const APPLICATION_FIELD_IDS = ['type', 'number', 'date', 'action'];

function openApplicationForm(app) {
  editingApplicationRow = app ? app.headerRow : null;

  const values = app ? [app.type, app.appNumber, app.date, app.action] : ['', '', '', APPLICATION_DEFAULT_ACTION];
  APPLICATION_FIELD_IDS.forEach((id, i) => {
    document.getElementById(`application-${id}`).value = values[i];
  });

  clearFieldError('application-form-error');
  document.getElementById('application-modal').hidden = false;
}

function closeApplicationForm() {
  document.getElementById('application-modal').hidden = true;
}

async function submitApplicationForm(event) {
  event.preventDefault();

  const [type, appNumber, date, action] = APPLICATION_FIELD_IDS.map((id) => document.getElementById(`application-${id}`).value.trim());

  try {
    if (editingApplicationRow !== null) {
      await updateValues(`${APPLICATIONS_SHEET}!B${editingApplicationRow}:E${editingApplicationRow}`, [[date, action, type, appNumber]]);
    } else {
      const sheetId = await getApplicationsSheetId();
      // Insert at the top rather than append, so the footer formulas shift down intact.
      await batchUpdate([{
        insertDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: APPLICATIONS_FIRST_ROW - 1, endIndex: APPLICATIONS_FIRST_ROW },
          inheritFromBefore: false,
        },
      }]);
      await updateValues(`${APPLICATIONS_SHEET}!A${APPLICATIONS_FIRST_ROW}:E${APPLICATIONS_FIRST_ROW}`, [['', date, action, type, appNumber]]);
    }
    await refreshApplications();
    const saved = allApplications.find((a) => a.headerRow === (editingApplicationRow ?? APPLICATIONS_FIRST_ROW));
    if (saved) {
      openApplicationForm(saved);
      stayOnSavedForm('application-modal', editApplication.step(saved));
    }
    showFormSaved('application-form-error');
  } catch (err) {
    showFieldError('application-form-error', err.message);
  }
}

async function deleteApplication(app) {
  const historyNote = app.updates.length > 0 ? ` and its ${app.updates.length} status update(s)` : '';

  await confirmAndDelete(`Delete "${app.type} — ${app.appNumber}"${historyNote}? This cannot be undone.`, async () => {
    const sheetId = await getApplicationsSheetId();
    await batchUpdate([{
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: app.headerRow - 1, endIndex: app.lastRow },
      },
    }]);
    expandedApplicationRows.delete(app.headerRow);
    await refreshApplications();
  }, "Couldn't delete application");
}
