const TIMESHEET_RANGE = `${CONFIG.SHEETS.TIMESHEET}!A2:G`;

let allTimeEntries = [];
let timesheetListenersAttached = false;
let tsSort = { dir: -1 };

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// The Break cell is plain minutes once the app has written it, but a
// pre-existing Excel-style duration-formatted cell (e.g. a Break column
// carried over from before this app touched the sheet) comes back from
// Sheets as a formatted "H:MM" or "H:MM:SS" string instead of a number —
// parse both.
function parseBreakMinutes(raw) {
  if (!raw) return 0;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber)) return asNumber;

  const parts = String(raw).split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  const [h, m, s] = parts;
  return h * 60 + (m || 0) + (s ? s / 60 : 0);
}

function minutesToHm(mins) {
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(Math.round(mins));
  return `${sign}${Math.floor(abs / 60)}h ${abs % 60}m`;
}

// For the Break field's <input type="time">, which holds an HH:MM duration
// rather than a clock time — same control as Start/End for visual
// consistency, just reinterpreted.
function minutesToTimeInput(mins) {
  const abs = Math.max(0, Math.round(mins));
  return `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function computeDurationMinutes(start, end, breakMinutes) {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  if (startMin === null || endMin === null) return null;
  return endMin - startMin - (breakMinutes || 0);
}

// Appending "T00:00:00" parses the date in the local timezone instead of
// UTC, so the weekday/weekend check below can't land a day off.
function dateFromIso(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

// date.toISOString() converts through UTC, which can shift the calendar
// date by one near midnight depending on the local timezone offset — this
// reads the Date object's own local year/month/day instead.
function isoFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayNameFromDate(dateStr) {
  return dateFromIso(dateStr).toLocaleDateString(undefined, { weekday: 'long' });
}

function isWeekend(dateStr) {
  const day = dateFromIso(dateStr).getDay();
  return day === 0 || day === 6;
}

async function initTimeSheet(forceRefresh = false) {
  // Attached before the data fetch below — a failed/slow refresh must never
  // leave the form controls permanently dead.
  if (!timesheetListenersAttached) {
    timesheetListenersAttached = true;

    document.getElementById('log-today-btn').addEventListener('click', () => {
      openTimesheetForm(isoFromDate(new Date()));
    });
    document.getElementById('timesheet-reminder-log-btn').addEventListener('click', () => {
      openTimesheetForm(isoFromDate(new Date()));
    });
    document.getElementById('timesheet-reminder-enable-btn').addEventListener('click', async () => {
      await Notification.requestPermission();
      checkTimesheetReminder();
    });
    document.getElementById('timesheet-cancel-btn').addEventListener('click', closeTimesheetForm);
    document.getElementById('timesheet-form').addEventListener('submit', submitTimesheetForm);
    document.getElementById('timesheet-holiday').addEventListener('change', toggleTimesheetHolidayFields);
    document.getElementById('timesheet-date-from').addEventListener('input', renderTimesheetList);
    document.getElementById('timesheet-date-to').addEventListener('input', renderTimesheetList);
    setupTimesheetSorting();
  }

  await refreshTimeSheet(forceRefresh);
}

function setupTimesheetSorting() {
  const th = document.querySelector('#timesheet-table th.sortable');
  const label = document.createElement('span');
  label.textContent = th.textContent;
  const indicator = document.createElement('span');
  indicator.className = 'sort-indicator';
  th.textContent = '';
  th.append(label, indicator);

  const updateIndicator = () => { indicator.textContent = tsSort.dir === 1 ? ' ▲' : ' ▼'; };
  updateIndicator();

  th.addEventListener('click', () => {
    tsSort.dir *= -1;
    updateIndicator();
    renderTimesheetList();
  });
}

// Defaults the filter to the trailing 2 weeks, but only the first time —
// never stomps a date range the user already set themselves.
function setDefaultTimesheetDateRange() {
  const fromInput = document.getElementById('timesheet-date-from');
  const toInput = document.getElementById('timesheet-date-to');
  if (fromInput.value || toInput.value) return;

  const today = new Date();
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(today.getDate() - 13);
  fromInput.value = isoFromDate(twoWeeksAgo);
  toInput.value = isoFromDate(today);
}

// Start/End/Break/Date are read and written as plain text/numbers the app
// fully owns (e.g. "09:00", not an Excel time-of-day cell), the same way
// Transactions' Date column is a plain ISO string. Day (B) and Duration (F)
// are never read or written — Duration is always computed client-side from
// Start/End/Break, and Day only matters when appending a brand-new row that
// has no formula to backfill it.
async function refreshTimeSheet(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('timesheet');

  if (!values) {
    const resp = await getValues(TIMESHEET_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('timesheet', values);
  }

  allTimeEntries = values
    .map((row, i) => ({
      row: i + 2,
      date: row[0] || '',
      start: row[2] || '',
      end: row[3] || '',
      breakMinutes: parseBreakMinutes(row[4]),
      task: row[6] || '',
    }))
    .filter((e) => e.date);

  setDefaultTimesheetDateRange();
  renderTimesheetList();
  renderTimesheetDistributionCharts(allTimeEntries);
  renderTimesheetDailyAverageChart(allTimeEntries);
  checkTimesheetReminder();
}

// A weekday with neither a logged entry nor a holiday/day-off note for
// today means today hasn't been logged yet — surface a banner, and (once
// the user has opted in) a real OS notification. Browsers block requesting
// Notification permission outside a direct user gesture, so it can only be
// offered via the banner's own button, never automatically on load.
function checkTimesheetReminder() {
  const banner = document.getElementById('timesheet-reminder-banner');
  const today = isoFromDate(new Date());

  if (isWeekend(today) || allTimeEntries.some((e) => e.date === today)) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;

  const enableBtn = document.getElementById('timesheet-reminder-enable-btn');
  if (!('Notification' in window)) {
    enableBtn.hidden = true;
  } else if (Notification.permission === 'granted') {
    enableBtn.hidden = true;
    if (localStorage.getItem('ledger_last_reminder_notified') !== today) {
      new Notification('Ledger', { body: "You haven't logged today's hours yet." });
      localStorage.setItem('ledger_last_reminder_notified', today);
    }
  } else {
    enableBtn.hidden = false;
  }
}

function getFilteredTimeEntries() {
  const dateFrom = document.getElementById('timesheet-date-from').value;
  const dateTo = document.getElementById('timesheet-date-to').value;

  return allTimeEntries
    .filter((e) => (!dateFrom || e.date >= dateFrom) && (!dateTo || e.date <= dateTo))
    .sort((a, b) => a.date.localeCompare(b.date) * tsSort.dir);
}

function renderTimesheetList() {
  const tbody = document.getElementById('timesheet-body');
  tbody.innerHTML = '';

  getFilteredTimeEntries().forEach((e) => {
    const tr = document.createElement('tr');
    const weekend = isWeekend(e.date);

    const dateCell = document.createElement('td');
    dateCell.textContent = e.date;

    const dayCell = document.createElement('td');
    dayCell.textContent = dayNameFromDate(e.date);

    const startCell = document.createElement('td');
    const endCell = document.createElement('td');
    const breakCell = document.createElement('td');
    const durationCell = document.createElement('td');
    const taskCell = document.createElement('td');

    // A weekday with no clock-in but a Task note is a holiday/day off (the
    // same free-text convention Transactions uses for Type); blank Task on
    // a weekday instead flags an entry nobody filled in yet.
    const noTimes = !e.start && !e.end;
    const isHoliday = !weekend && noTimes && e.task;
    const isNoEntry = !weekend && noTimes && !e.task;

    startCell.textContent = noTimes ? '—' : e.start.slice(0, 5);
    endCell.textContent = noTimes ? '—' : e.end.slice(0, 5);
    breakCell.textContent = noTimes ? '—' : (e.breakMinutes ? `${e.breakMinutes}m` : '—');
    taskCell.textContent = e.task.length > 30 ? `${e.task.slice(0, 30)}…` : e.task;
    taskCell.title = e.task;

    if (isHoliday) {
      durationCell.textContent = '🏖 Holiday';
      durationCell.classList.add('timesheet-holiday-badge');
    } else if (isNoEntry) {
      durationCell.textContent = '—';
      durationCell.classList.add('timesheet-no-entry');
    } else {
      const durationMin = computeDurationMinutes(e.start, e.end, e.breakMinutes);
      durationCell.textContent = durationMin !== null ? minutesToHm(durationMin) : '—';
    }

    const actionsCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.addEventListener('click', () => openTimesheetForm(e.date));
    actionsCell.appendChild(editBtn);

    tr.append(dateCell, dayCell, startCell, endCell, breakCell, durationCell, taskCell, actionsCell);
    if (weekend || isNoEntry) tr.classList.add('timesheet-no-entry');
    tbody.appendChild(tr);
  });
}

function toggleTimesheetHolidayFields() {
  const holiday = document.getElementById('timesheet-holiday').checked;
  ['timesheet-start', 'timesheet-end', 'timesheet-break'].forEach((id) => {
    const el = document.getElementById(id);
    el.disabled = holiday;
    if (holiday) el.value = id === 'timesheet-break' ? '00:00' : '';
  });
}

function openTimesheetForm(dateStr) {
  const existing = allTimeEntries.find((e) => e.date === dateStr);

  document.getElementById('timesheet-modal-title').textContent = `Log Time — ${dateStr}`;
  document.getElementById('timesheet-date').value = dateStr;
  document.getElementById('timesheet-start').value = existing?.start || '';
  document.getElementById('timesheet-end').value = existing?.end || '';
  document.getElementById('timesheet-break').value = minutesToTimeInput(existing?.breakMinutes || 0);
  document.getElementById('timesheet-task').value = existing?.task || '';

  const isHoliday = !!(existing && !existing.start && !existing.end && existing.task);
  document.getElementById('timesheet-holiday').checked = isHoliday;
  toggleTimesheetHolidayFields();

  document.getElementById('timesheet-form-error').hidden = true;
  document.getElementById('timesheet-modal').hidden = false;
}

function closeTimesheetForm() {
  document.getElementById('timesheet-modal').hidden = true;
}

// Keeps the sheet's "one row per calendar day" shape intact: if logging a
// new date leaves a gap since the last entry already in the sheet (e.g. a
// skipped weekend, or any other unlogged stretch), fill every missing day
// in between with a blank row before appending the new one.
async function backfillMissingDates(targetDate) {
  const existingDates = new Set(allTimeEntries.map((e) => e.date));
  const priorDates = [...existingDates].filter((d) => d < targetDate).sort();
  if (priorDates.length === 0) return;

  const lastDate = priorDates[priorDates.length - 1];
  const cursor = dateFromIso(lastDate);
  cursor.setDate(cursor.getDate() + 1);
  const target = dateFromIso(targetDate);

  const rows = [];
  while (cursor < target) {
    const iso = isoFromDate(cursor);
    if (!existingDates.has(iso)) rows.push([iso, dayNameFromDate(iso), '', '', '', '', '']);
    cursor.setDate(cursor.getDate() + 1);
  }

  if (rows.length) await appendValues(TIMESHEET_RANGE, rows);
}

async function submitTimesheetForm(event) {
  event.preventDefault();

  const date = document.getElementById('timesheet-date').value;
  const holiday = document.getElementById('timesheet-holiday').checked;
  const start = holiday ? '' : document.getElementById('timesheet-start').value;
  const end = holiday ? '' : document.getElementById('timesheet-end').value;
  const breakMinutes = holiday ? 0 : (timeToMinutes(document.getElementById('timesheet-break').value) || 0);
  const task = document.getElementById('timesheet-task').value;

  const errorEl = document.getElementById('timesheet-form-error');
  if (!holiday && start && end && timeToMinutes(end) <= timeToMinutes(start)) {
    errorEl.textContent = 'End time must be after Start time.';
    errorEl.hidden = false;
    return;
  }

  try {
    const existing = allTimeEntries.find((e) => e.date === date);

    if (existing) {
      // Two calls so Duration (F), sitting between Break (E) and Task (G),
      // is never touched.
      await updateValues(`${CONFIG.SHEETS.TIMESHEET}!C${existing.row}:E${existing.row}`, [[start, end, breakMinutes]]);
      await updateValues(`${CONFIG.SHEETS.TIMESHEET}!G${existing.row}`, [[task]]);
    } else {
      await backfillMissingDates(date);
      await appendValues(TIMESHEET_RANGE, [[date, dayNameFromDate(date), start, end, breakMinutes, '', task]]);
    }

    await refreshTimeSheet(true);
    closeTimesheetForm();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}
