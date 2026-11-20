// Row 1 is the header, so data (and a new application's insert) starts here.
const APPLICATIONS_FIRST_ROW = 2;
const applicationsRange = (a1) => sheetRange(CONFIG.SHEETS.APPLICATIONS, a1);
const APPLICATIONS_RANGE = applicationsRange(`A${APPLICATIONS_FIRST_ROW}:E`);
// The sheet's own spelling.
const APPLICATION_DEFAULT_ACTION = 'Submited';
// Form fields, as application-<id>.
const APPLICATION_FIELD_IDS = ['type', 'number', 'date', 'action'];

let allApplications = [];
let editApplication = null;
let applicationsListenersAttached = false;
let applicationsSheetId = null;
let editingApplicationRow = null;
const expandedApplicationRows = new Set();

// Fetched on first use after each refresh.
async function getApplicationsSheetId() {
  if (applicationsSheetId === null) {
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

// A row with Type and App Number starts an application; Date + Action rows below are
// its updates. "Total …" footer rows are skipped.
function parseApplications(rows) {
  const applications = [];
  let current = null;

  rows.forEach((row, i) => {
    const sheetRow = i + APPLICATIONS_FIRST_ROW;
    // Delay is the sheet's number (0 shows nothing); the rest is text.
    const delay = row[0] || '';
    const [rawDate, action, type, appNumber] = [1, 2, 3, 4].map((col) => cellText(row[col]));
    const date = sheetDateIso(rawDate);

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
  // Re-looked up on the next add or delete, in case the spreadsheet changed.
  applicationsSheetId = null;
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
  const header = applicationEl('div', 'app-card-header');
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  const setExpanded = (expanded) => {
    card.classList.toggle('collapsed', !expanded);
    header.setAttribute('aria-expanded', String(expanded));
  };
  setExpanded(expandedApplicationRows.has(app.headerRow));

  const icon = applicationEl('span', 'panel-toggle-icon app-card-toggle-icon', '▾');

  const status = latestStatus(app);
  const delay = app.delayDays !== '' ? ` · Delay ${app.delayDays}d` : '';
  const title = applicationEl('div', 'app-card-title');
  title.append(
    applicationEl('strong', '', `${app.type} — ${app.appNumber}`),
    applicationEl('span', 'app-card-meta', `Submitted ${shortYearDate(app.date)}${delay} · Latest: ${status.action} (${shortYearDate(status.date)})`),
  );

  const actions = applicationEl('div', 'app-card-actions');
  actions.append(
    makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: (e) => { e.stopPropagation(); editApplication(app); } }),
    makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: (e) => { e.stopPropagation(); return deleteApplication(app); } }),
  );
  header.append(icon, title, actions);

  const toggle = () => {
    const expanded = card.classList.contains('collapsed');
    setExpanded(expanded);
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
      item.append(applicationEl('span', 'app-history-date', shortYearDate(u.date)), applicationEl('span', 'app-history-action', u.action));
      list.appendChild(item);
    });
    body.appendChild(list);
  }

  card.append(header, body);
  return card;
}

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

  // USER_ENTERED so Date stays a real date for the sheet's formulas; the text is quoted.
  const cells = [date, sheetText(action), sheetText(type), sheetText(appNumber)];
  try {
    if (editingApplicationRow !== null) {
      await updateValues(applicationsRange(`B${editingApplicationRow}:E${editingApplicationRow}`), [cells]);
    } else {
      const sheetId = await getApplicationsSheetId();
      // Insert at the top rather than append, so the footer formulas shift down intact.
      await batchUpdate([{
        insertDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: APPLICATIONS_FIRST_ROW - 1, endIndex: APPLICATIONS_FIRST_ROW },
          inheritFromBefore: false,
        },
      }]);
      await writeInsertedApplication(sheetId, ['', ...cells]);
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

// A failed write takes back the blank row it was inserted for, and says which step failed.
async function writeInsertedApplication(sheetId, rowCells) {
  try {
    await updateValues(applicationsRange(`A${APPLICATIONS_FIRST_ROW}:E${APPLICATIONS_FIRST_ROW}`), [rowCells]);
  } catch (err) {
    const undone = await batchUpdate([sheetRowDeleteRequest(sheetId, APPLICATIONS_FIRST_ROW)]).then(() => true, () => false);
    throw new Error(`Couldn't write the new application (${err.message}); ${undone
      ? 'its inserted row was removed'
      : `a blank row is left at row ${APPLICATIONS_FIRST_ROW}`}.`);
  }
}

async function deleteApplication(app) {
  const historyNote = app.updates.length > 0 ? ` and its ${app.updates.length} status update(s)` : '';

  await confirmAndDelete(`Delete "${app.type} — ${app.appNumber}"${historyNote}? This cannot be undone.`, async () => {
    const sheetId = await getApplicationsSheetId();
    // Bottom-up, so each deletion leaves the rows above in place.
    const requests = [];
    for (let row = app.lastRow; row >= app.headerRow; row--) requests.push(sheetRowDeleteRequest(sheetId, row));
    await batchUpdate(requests);
    expandedApplicationRows.delete(app.headerRow);
    await refreshApplications();
  }, "Couldn't delete application");
}
