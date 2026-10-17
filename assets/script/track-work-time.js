const WORK_TIME_RANGE = `${CONFIG.SHEETS.WORK_TIME}!A2:H`;
const TS_PAGE_SIZE = 28;

let allTimeEntries = [];
let workTimeListenersAttached = false;
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
// string the sheet write needs (see submitWorkTimeForm's comment on why
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

// Local "YYYY-MM-DD HH:mm", for timestamps shown to the user.
function localTimestamp(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${isoFromDate(date)} ${hh}:${mm}`;
}

function dayNameFromDate(dateStr) {
  return dateFromIso(dateStr).toLocaleDateString(undefined, { weekday: 'long' });
}

function isWeekend(dateStr) {
  const day = dateFromIso(dateStr).getDay();
  return day === 0 || day === 6;
}

async function initWorkTime(forceRefresh = false) {
  // Attached before the data fetch below — a failed/slow refresh must never
  // leave the form controls permanently dead.
  if (!workTimeListenersAttached) {
    workTimeListenersAttached = true;

    document.getElementById('log-today-btn').addEventListener('click', () => {
      openWorkTimeForm(isoFromDate(new Date()));
    });
    // track/work-time/<date>/ opens that day's Edit, logged or not.
    registerRecordRoute('work-time', (slug, sub) => {
      if (sub || !/^\d{4}-\d{2}-\d{2}$/.test(slug)) return null;
      openWorkTimeForm(slug);
      return slug;
    });
    document.getElementById('work-time-cancel-btn').addEventListener('click', closeWorkTimeForm);
    onFormSubmit('work-time-form', submitWorkTimeForm);
    document.getElementById('work-time-holiday').addEventListener('change', () => {
      toggleWorkTimeHolidayFields();
      updateWorkTimeLiveDuration();
    });
    ['work-time-start', 'work-time-end', 'work-time-break-h', 'work-time-break-m'].forEach((id) => {
      document.getElementById(id).addEventListener('input', updateWorkTimeLiveDuration);
    });
    document.getElementById('work-time-date-from').addEventListener('input', () => {
      tsCurrentPage = 1;
      renderWorkTimeList();
    });
    document.getElementById('work-time-date-to').addEventListener('input', () => {
      tsCurrentPage = 1;
      renderWorkTimeList();
    });
    setupWorkTimeSorting();
  }

  await refreshWorkTime(forceRefresh);
}

function setupWorkTimeSorting() {
  const th = document.querySelector('#work-time-table th.sortable');
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
    renderWorkTimeList();
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
function setDefaultWorkTimeDateRange() {
  const fromInput = document.getElementById('work-time-date-from');
  const toInput = document.getElementById('work-time-date-to');
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
async function refreshWorkTime(forceRefresh = false) {
  const resp = await getValues(WORK_TIME_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

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

  setDefaultWorkTimeDateRange();
  populateWorkTimeCompanyOptions();
  renderWorkTimeList();
  renderWorkTimeDistributionCharts(allTimeEntries);
  renderWorkTimeDailyAverageChart(allTimeEntries);
  renderWorkTimeOvertimeSummary(entriesForLastCompany(allTimeEntries));
  checkWorkTimeReminder();
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
function populateWorkTimeCompanyOptions() {
  const counts = new Map();
  allTimeEntries.forEach(({ company }) => {
    if (!company) return;
    counts.set(company, (counts.get(company) || 0) + 1);
  });

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);

  const datalist = document.getElementById('work-time-company-options');
  datalist.innerHTML = '';
  sorted.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    datalist.appendChild(option);
  });
}

// A weekday with nothing logged for today: a red "<days>d" badge (days since the
// last logged day, like the other badges) opening today's day, and (once allowed
// in the account menu) one Chrome notification a day. A logged holiday counts.
function checkWorkTimeReminder() {
  const today = isoFromDate(new Date());
  const entries = entriesForLastCompany(allTimeEntries).filter((e) => e.date <= today);
  if (isWeekend(today) || !entries.length || entries.some((e) => e.date === today)) {
    setPageBadge('track', 'work-time', null);
    return;
  }
  const last = entries.reduce((max, e) => (e.date > max ? e.date : max), '');
  const days = Math.round((dateFromIso(today) - dateFromIso(last)) / 86400000);
  setPageBadge('track', 'work-time', { text: `${days}d`, title: `Today's hours aren't logged; last logged ${days} days ago (${last})`, record: today });
  if ('Notification' in window && Notification.permission === 'granted'
    && localStorage.getItem('ledger_last_reminder_notified') !== today) {
    new Notification('Ledger', { body: 'Work Time: log today' });
    localStorage.setItem('ledger_last_reminder_notified', today);
  }
}

function getFilteredTimeEntries() {
  const dateFrom = document.getElementById('work-time-date-from').value;
  const dateTo = document.getElementById('work-time-date-to').value;

  return allTimeEntries
    .filter((e) => (!dateFrom || e.date >= dateFrom) && (!dateTo || e.date <= dateTo))
    .sort((a, b) => a.date.localeCompare(b.date) * tsSort.dir);
}

function renderWorkTimeList() {
  const tbody = document.getElementById('work-time-body');
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
      durationCell.classList.add('work-time-holiday-badge');
    } else if (isNoEntry) {
      durationCell.textContent = '—';
      durationCell.classList.add('work-time-no-entry');
    } else {
      const durationMin = computeDurationMinutes(e.start, e.end, e.breakMinutes);
      durationCell.textContent = durationMin !== null ? minutesToHm(durationMin) : '—';
    }

    const actionsCell = document.createElement('td');
    actionsCell.appendChild(makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => {
      routeRecordEdit('work-time', { slug: e.date, label: e.date });
      openWorkTimeForm(e.date);
    } }));

    tr.append(companyCell, dateCell, dayCell, startCell, endCell, breakCell, durationCell, taskCell, actionsCell);
    // A weekend and a holiday are the same thing to this table: a day off.
    if (weekend || isHoliday) tr.classList.add('work-time-off');
    else if (isNoEntry) tr.classList.add('work-time-no-entry');
    // Not part of that chain: today can also be a day off, and both marks are worth
    // keeping. The green lands on the cells (.today-row > td) while a day off tints
    // the row itself, so today's tint paints over it while its muted text survives.
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
      renderWorkTimeList();
    },
  });
}

function toggleWorkTimeHolidayFields() {
  const holiday = document.getElementById('work-time-holiday').checked;
  ['work-time-start', 'work-time-end', 'work-time-break-h', 'work-time-break-m'].forEach((id) => {
    const el = document.getElementById(id);
    el.disabled = holiday;
    if (holiday) el.value = id.startsWith('work-time-break') ? '0' : '';
  });
}

function workTimeBreakMinutesFromInputs() {
  const h = Number(document.getElementById('work-time-break-h').value) || 0;
  const m = Number(document.getElementById('work-time-break-m').value) || 0;
  return h * 60 + m;
}

function updateWorkTimeLiveDuration() {
  const liveDuration = document.getElementById('work-time-live-duration');
  if (document.getElementById('work-time-holiday').checked) {
    liveDuration.textContent = '🏖 Holiday';
    return;
  }

  const start = document.getElementById('work-time-start').value;
  const end = document.getElementById('work-time-end').value;
  const breakMinutes = workTimeBreakMinutesFromInputs();
  const durationMin = computeDurationMinutes(start, end, breakMinutes);
  liveDuration.textContent = durationMin !== null ? minutesToHm(durationMin) : '—';
}

function openWorkTimeForm(dateStr) {
  const existing = allTimeEntries.find((e) => e.date === dateStr);

  document.getElementById('work-time-modal-title').textContent = formTitleWithDate('Log a Work Time', dateStr);
  document.getElementById('work-time-company').value = existing?.company || getLastCompany(allTimeEntries) || '';
  document.getElementById('work-time-date').value = dateStr;
  document.getElementById('work-time-start').value = existing?.start || '';
  document.getElementById('work-time-end').value = existing?.end || '';
  const breakMinutes = Math.max(0, Math.round(existing?.breakMinutes || 0));
  document.getElementById('work-time-break-h').value = Math.floor(breakMinutes / 60);
  document.getElementById('work-time-break-m').value = breakMinutes % 60;
  document.getElementById('work-time-task').value = existing?.task || '';

  const isHoliday = !!(existing && !existing.start && !existing.end && existing.task);
  document.getElementById('work-time-holiday').checked = isHoliday;
  toggleWorkTimeHolidayFields();
  updateWorkTimeLiveDuration();

  clearFieldError('work-time-form-error');
  document.getElementById('work-time-modal').hidden = false;
}

function closeWorkTimeForm() {
  document.getElementById('work-time-modal').hidden = true;
}

// Keeps the sheet's "one row per calendar day" shape intact: if logging a
// new date leaves a gap since the last entry already in the sheet (e.g. a
// skipped weekend, or any other unlogged stretch), fill every missing day
// in between with a blank row before appending the new one.
async function backfillMissingDates(untilDate) {
  const existingDates = new Set(allTimeEntries.map((e) => e.date));
  const priorDates = [...existingDates].filter((d) => d < untilDate).sort();
  if (priorDates.length === 0) return;

  const lastDate = priorDates[priorDates.length - 1];
  const cursor = dateFromIso(lastDate);
  cursor.setDate(cursor.getDate() + 1);
  const endDate = dateFromIso(untilDate);

  const rows = [];
  while (cursor < endDate) {
    const iso = isoFromDate(cursor);
    if (!existingDates.has(iso)) rows.push(['', iso, dayNameFromDate(iso), '', '', '', '', '']);
    cursor.setDate(cursor.getDate() + 1);
  }

  if (rows.length) await appendValues(WORK_TIME_RANGE, rows);
}

async function submitWorkTimeForm(event) {
  event.preventDefault();

  const company = document.getElementById('work-time-company').value.trim();
  const date = document.getElementById('work-time-date').value;
  const holiday = document.getElementById('work-time-holiday').checked;
  const start = holiday ? '' : document.getElementById('work-time-start').value;
  const end = holiday ? '' : document.getElementById('work-time-end').value;
  // The Break field is two hours/minutes number inputs in the UI, but is
  // written to the sheet as an "H:MM" time string, not a raw minutes count:
  // some Break cells carry pre-existing Excel-style duration formatting, and
  // Sheets reinterprets a plain integer written into those as a count of
  // days (e.g. 15 minutes becomes a 15-day duration). A time-string literal
  // parses correctly under that formatting either way.
  const breakValue = minutesToTimeInput(holiday ? 0 : workTimeBreakMinutesFromInputs());
  const task = document.getElementById('work-time-task').value;

  if (!holiday && start && end && timeToMinutes(end) <= timeToMinutes(start)) {
    showFieldError('work-time-form-error', 'End time must be after Start time.');
    return;
  }

  try {
    const existing = allTimeEntries.find((e) => e.date === date);

    if (existing) {
      // Three calls so Day (C) and Duration (G), which this app never
      // writes, are never touched.
      await updateValues(`${CONFIG.SHEETS.WORK_TIME}!A${existing.row}`, [[company]]);
      // RAW, not the default USER_ENTERED: a bare "09:40" written USER_ENTERED
      // gets auto-detected as a time value and the cell reformatted around it
      // (seconds, AM/PM), so the next read back returns that reformatted
      // string instead of what was typed — the same class of bug documented
      // on the Settings tab's writes (see other-settings.js).
      await updateValues(`${CONFIG.SHEETS.WORK_TIME}!D${existing.row}:F${existing.row}`, [[start, end, breakValue]], 'RAW');
      await updateValues(`${CONFIG.SHEETS.WORK_TIME}!H${existing.row}`, [[task]]);
    } else {
      await backfillMissingDates(date);
      await appendValues(WORK_TIME_RANGE, [[company, date, dayNameFromDate(date), start, end, breakValue, '', task]], 'RAW');
    }

    await refreshWorkTime(true);
    openWorkTimeForm(date);
    stayOnSavedForm('work-time-modal', { slug: date, label: date });
    showFormSaved('work-time-form-error');
  } catch (err) {
    showFieldError('work-time-form-error', err.message);
  }
}
