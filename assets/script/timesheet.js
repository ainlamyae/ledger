const TIMESHEET_RANGE = `${CONFIG.SHEETS.TIMESHEET}!A2:H`;
const TS_PAGE_SIZE = 28;

let allTimeEntries = [];
let timesheetListenersAttached = false;
let tsSort = { dir: -1 };
let tsCurrentPage = 1;

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// A pre-existing Start/End cell can carry Sheets' own default time number
// format (e.g. "9:40:00 AM") — the first USER_ENTERED write of a bare "09:40"
// got auto-detected as a time value and the cell reformatted around it, so
// FORMATTED_STRING reads it back dressed in seconds and/or AM/PM instead of
// what was actually typed. Strips both back down to a plain 24-hour "HH:mm",
// same tolerance parseBreakMinutes already applies to Break.
function normalizeTimeString(raw) {
  if (!raw) return '';
  const match = String(raw).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return raw;
  let hour = Number(match[1]);
  const ampm = match[3] ? match[3].toUpperCase() : null;
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
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

// Same as minutesToHm, but always shows a sign — a bare "6h" reads as neutral,
// while the overtime summary needs +/- to be unambiguous at a glance.
function signedMinutesToHm(mins) {
  return mins >= 0 ? `+${minutesToHm(mins)}` : minutesToHm(mins);
}

// The Break field itself is already an "HH:mm" time input, but its value
// still needs normalizing (zero-padding, rounding) into the exact "H:MM"
// string the sheet write needs (see submitTimesheetForm's comment on why
// that format is required).
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
    onFormSubmit('timesheet-form', submitTimesheetForm);
    document.getElementById('timesheet-holiday').addEventListener('change', () => {
      toggleTimesheetHolidayFields();
      updateTimesheetLiveDuration();
    });
    ['timesheet-start', 'timesheet-end', 'timesheet-break-h', 'timesheet-break-m'].forEach((id) => {
      document.getElementById(id).addEventListener('input', updateTimesheetLiveDuration);
    });
    document.getElementById('timesheet-date-from').addEventListener('input', () => {
      tsCurrentPage = 1;
      renderTimesheetList();
    });
    document.getElementById('timesheet-date-to').addEventListener('input', () => {
      tsCurrentPage = 1;
      renderTimesheetList();
    });
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
  th.setAttribute('tabindex', '0');

  const updateIndicator = () => { indicator.textContent = tsSort.dir === 1 ? ' ▲' : ' ▼'; };
  updateIndicator();

  th.addEventListener('click', () => {
    tsSort.dir *= -1;
    updateIndicator();
    tsCurrentPage = 1;
    renderTimesheetList();
  });
  th.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      th.click();
    }
  });
}

// Defaults the filter to 1 week back through 2 weeks out from today, but
// only the first time — never stomps a date range the user already set
// themselves. Anchored directly on today (not rounded to a weekday) so the
// split is exactly 1 week back / 2 weeks out regardless of what day of the
// week today happens to be.
function setDefaultTimesheetDateRange() {
  const fromInput = document.getElementById('timesheet-date-from');
  const toInput = document.getElementById('timesheet-date-to');
  if (fromInput.value || toInput.value) return;

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 7);
  const toDate = new Date(today);
  toDate.setDate(today.getDate() + 14);
  fromInput.value = isoFromDate(fromDate);
  toInput.value = isoFromDate(toDate);
}

// Company/Start/End/Break/Date are read and written as plain text/numbers
// the app fully owns (e.g. "09:00", not an Excel time-of-day cell), the same
// way Transactions' Date column is a plain ISO string. Day (C) and Duration
// (G) are never read or written — Duration is always computed client-side
// from Start/End/Break, and Day only matters when appending a brand-new row
// that has no formula to backfill it.
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
      company: (row[0] || '').trim(),
      date: row[1] || '',
      start: normalizeTimeString(row[3]),
      end: normalizeTimeString(row[4]),
      breakMinutes: parseBreakMinutes(row[5]),
      task: row[7] || '',
    }))
    .filter((e) => e.date);

  setDefaultTimesheetDateRange();
  populateTimesheetCompanyOptions();
  renderTimesheetList();
  renderTimesheetDistributionCharts(allTimeEntries);
  renderTimesheetDailyAverageChart(allTimeEntries);
  renderTimesheetOvertimeSummary(entriesForLastCompany(allTimeEntries));
  checkTimesheetReminder();
}

// The 8h/day overtime pace and the "log today" reminder should reflect only
// your current employer — entries from a company you've since left would
// otherwise skew both. "Last company" is whichever company appears on the
// most recently dated entry, on or before today, that has one; if no entry
// has a company yet (e.g. existing data written before this column existed),
// nothing is filtered out. Future-dated rows are excluded even if they carry
// a company — a day that hasn't happened yet (e.g. a pre-filled placeholder
// row for the rest of the year) hasn't actually been "logged" and shouldn't
// be able to define your current employer.
function getLastCompany(entries) {
  const today = isoFromDate(new Date());
  const withCompany = entries.filter((e) => e.company && e.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  return withCompany.length ? withCompany[0].company : null;
}

function entriesForLastCompany(entries) {
  const lastCompany = getLastCompany(entries);
  return lastCompany ? entries.filter((e) => e.company === lastCompany) : entries;
}

// Fills the Company datalist with previously used values, most frequent
// first, the same convention as Transactions' Payee/Description datalists.
function populateTimesheetCompanyOptions() {
  const counts = new Map();
  allTimeEntries.forEach(({ company }) => {
    if (!company) return;
    counts.set(company, (counts.get(company) || 0) + 1);
  });

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);

  const datalist = document.getElementById('timesheet-company-options');
  datalist.innerHTML = '';
  sorted.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    datalist.appendChild(option);
  });
}

// A weekday with neither a logged entry nor a holiday/day-off note for
// today means today hasn't been logged yet — surface a banner, and (once
// the user has opted in) a real OS notification. Browsers block requesting
// Notification permission outside a direct user gesture, so it can only be
// offered via the banner's own button, never automatically on load.
function checkTimesheetReminder() {
  const banner = document.getElementById('timesheet-reminder-banner');
  const today = isoFromDate(new Date());

  if (isWeekend(today) || entriesForLastCompany(allTimeEntries).some((e) => e.date === today)) {
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

  const entries = getFilteredTimeEntries();
  const totalPages = Math.max(1, Math.ceil(entries.length / TS_PAGE_SIZE));
  tsCurrentPage = Math.min(tsCurrentPage, totalPages);

  const start = (tsCurrentPage - 1) * TS_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + TS_PAGE_SIZE);

  if (pageEntries.length === 0) {
    const message = allTimeEntries.length === 0
      ? 'No time logged yet — click "Log" in the panel heading above.'
      : 'No entries match this date range.';
    tbody.appendChild(renderEmptyRow(9, message));
  }

  // Same tint the Activity Plan uses for a row already logged today, and the
  // Physique table for today's day row. Read per render, so a tab left open across
  // midnight moves the mark on its next redraw.
  const todayIso = isoFromDate(new Date());

  pageEntries.forEach((e) => {
    const tr = document.createElement('tr');
    const weekend = isWeekend(e.date);

    const companyCell = document.createElement('td');
    const firstSpace = e.company.indexOf(' ');
    companyCell.textContent = firstSpace === -1 ? e.company : `${e.company.slice(0, firstSpace)}…`;
    companyCell.title = e.company;

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
    actionsCell.appendChild(makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openTimesheetForm(e.date) }));

    tr.append(companyCell, dateCell, dayCell, startCell, endCell, breakCell, durationCell, taskCell, actionsCell);
    if (weekend) tr.classList.add('timesheet-weekend');
    else if (isHoliday) tr.classList.add('timesheet-holiday');
    else if (isNoEntry) tr.classList.add('timesheet-no-entry');
    // Not part of that chain: today can also be a weekend or a holiday, and both
    // marks are worth keeping. The green lands on the cells (.today-row > td) while
    // weekend/holiday tint the row itself, so today's tint paints over theirs while
    // their muted text colour survives.
    if (e.date === todayIso) tr.classList.add('today-row');
    tbody.appendChild(tr);
  });

  renderTsPagination(totalPages);
}

function renderTsPagination(totalPages) {
  renderPager('ts-pagination', {
    page: tsCurrentPage,
    totalPages,
    onChange: (p) => {
      tsCurrentPage = p;
      renderTimesheetList();
    },
  });
}

function toggleTimesheetHolidayFields() {
  const holiday = document.getElementById('timesheet-holiday').checked;
  ['timesheet-start', 'timesheet-end', 'timesheet-break-h', 'timesheet-break-m'].forEach((id) => {
    const el = document.getElementById(id);
    el.disabled = holiday;
    if (holiday) el.value = id.startsWith('timesheet-break') ? '0' : '';
  });
}

function timesheetBreakMinutesFromInputs() {
  const h = Number(document.getElementById('timesheet-break-h').value) || 0;
  const m = Number(document.getElementById('timesheet-break-m').value) || 0;
  return h * 60 + m;
}

function updateTimesheetLiveDuration() {
  const liveDuration = document.getElementById('timesheet-live-duration');
  if (document.getElementById('timesheet-holiday').checked) {
    liveDuration.textContent = '🏖 Holiday';
    return;
  }

  const start = document.getElementById('timesheet-start').value;
  const end = document.getElementById('timesheet-end').value;
  const breakMinutes = timesheetBreakMinutesFromInputs();
  const durationMin = computeDurationMinutes(start, end, breakMinutes);
  liveDuration.textContent = durationMin !== null ? minutesToHm(durationMin) : '—';
}

function openTimesheetForm(dateStr) {
  const existing = allTimeEntries.find((e) => e.date === dateStr);

  document.getElementById('timesheet-modal-title').textContent = `Log Time — ${dateStr}`;
  document.getElementById('timesheet-company').value = existing?.company || getLastCompany(allTimeEntries) || '';
  document.getElementById('timesheet-date').value = dateStr;
  document.getElementById('timesheet-start').value = existing?.start || '';
  document.getElementById('timesheet-end').value = existing?.end || '';
  const breakMinutes = Math.max(0, Math.round(existing?.breakMinutes || 0));
  document.getElementById('timesheet-break-h').value = Math.floor(breakMinutes / 60);
  document.getElementById('timesheet-break-m').value = breakMinutes % 60;
  document.getElementById('timesheet-task').value = existing?.task || '';

  const isHoliday = !!(existing && !existing.start && !existing.end && existing.task);
  document.getElementById('timesheet-holiday').checked = isHoliday;
  toggleTimesheetHolidayFields();
  updateTimesheetLiveDuration();

  clearFieldError('timesheet-form-error');
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
    if (!existingDates.has(iso)) rows.push(['', iso, dayNameFromDate(iso), '', '', '', '', '']);
    cursor.setDate(cursor.getDate() + 1);
  }

  if (rows.length) await appendValues(TIMESHEET_RANGE, rows);
}

async function submitTimesheetForm(event) {
  event.preventDefault();

  const company = document.getElementById('timesheet-company').value.trim();
  const date = document.getElementById('timesheet-date').value;
  const holiday = document.getElementById('timesheet-holiday').checked;
  const start = holiday ? '' : document.getElementById('timesheet-start').value;
  const end = holiday ? '' : document.getElementById('timesheet-end').value;
  // The Break field is two hours/minutes number inputs in the UI, but is
  // written to the sheet as an "H:MM" time string, not a raw minutes count:
  // some Break cells carry pre-existing Excel-style duration formatting, and
  // Sheets reinterprets a plain integer written into those as a count of
  // days (e.g. 15 minutes becomes a 15-day duration). A time-string literal
  // parses correctly under that formatting either way.
  const breakValue = minutesToTimeInput(holiday ? 0 : timesheetBreakMinutesFromInputs());
  const task = document.getElementById('timesheet-task').value;

  if (!holiday && start && end && timeToMinutes(end) <= timeToMinutes(start)) {
    showFieldError('timesheet-form-error', 'End time must be after Start time.');
    return;
  }

  try {
    const existing = allTimeEntries.find((e) => e.date === date);

    if (existing) {
      // Three calls so Day (C) and Duration (G), which this app never
      // writes, are never touched.
      await updateValues(`${CONFIG.SHEETS.TIMESHEET}!A${existing.row}`, [[company]]);
      // RAW, not the default USER_ENTERED: a bare "09:40" written USER_ENTERED
      // gets auto-detected as a time value and the cell reformatted around it
      // (seconds, AM/PM), so the next read back returns that reformatted
      // string instead of what was typed — the same class of bug documented
      // on the Settings tab's writes (see settings-panel.js).
      await updateValues(`${CONFIG.SHEETS.TIMESHEET}!D${existing.row}:F${existing.row}`, [[start, end, breakValue]], 'RAW');
      await updateValues(`${CONFIG.SHEETS.TIMESHEET}!H${existing.row}`, [[task]]);
    } else {
      await backfillMissingDates(date);
      await appendValues(TIMESHEET_RANGE, [[company, date, dayNameFromDate(date), start, end, breakValue, '', task]], 'RAW');
    }

    await refreshTimeSheet(true);
    closeTimesheetForm();
  } catch (err) {
    showFieldError('timesheet-form-error', err.message);
  }
}
