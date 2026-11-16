const WORK_TIME_RANGE = sheetRange(CONFIG.SHEETS.WORK_TIME, 'A2:H');
const TS_PAGE_SIZE = 28;
const WORK_TIME_TASK_DISPLAY_MAX = 30;
// The table's default date range around today.
const WORK_TIME_DEFAULT_DAYS_BACK = 7;
const WORK_TIME_DEFAULT_DAYS_AHEAD = 14;
// The form fields a holiday blanks and disables (suffixes of work-time-*).
const WORK_TIME_SHIFT_FIELDS = ['start', 'end', 'break-h', 'break-m'];

let allTimeEntries = [];
let workTimeListenersAttached = false;
let tsSort = { key: 'date', dir: -1 };
let tsCurrentPage = 1;

function workTimeField(name) {
  return document.getElementById(`work-time-${name}`);
}

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// A cell Sheets once auto-formatted as a time reads back as e.g. "9:40:00 AM";
// strips it back to the 24-hour "HH:mm" that was typed.
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

// Plain minutes, or an older duration-formatted cell's "H:MM" / "H:MM:SS".
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

// Always signed, so the overtime summary's +/- is unambiguous.
function signedMinutesToHm(mins) {
  return mins >= 0 ? `+${minutesToHm(mins)}` : minutesToHm(mins);
}

// The zero-padded "HH:MM" Break string the sheet write needs (see submitWorkTimeForm).
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

// Local midnight, not UTC, so the weekday can't land a day off.
function dateFromIso(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

// The Date's local calendar date; toISOString() would go through UTC.
function isoFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// True where the browser's locale writes the day before the month (20/11/2026).
function localeDayFirst() {
  const parts = new Intl.DateTimeFormat().formatToParts(new Date(2026, 10, 20));
  return parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month');
}

// A date cell as yyyy-mm-dd, from ISO or a display format ("20/11/2026",
// "11/20/2026", "Nov 20, 2026"), so a date input can show it. Else returned as read.
function sheetDateIso(value) {
  const text = cellText(value).trim();
  const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : text);
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[ T])/.exec(text);
  if (m) return iso(m[1], Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const dayFirst = a > 12 || (b <= 12 && localeDayFirst());
    return dayFirst ? iso(m[3], b, a) : iso(m[3], a, b);
  }
  if (/[a-z]/i.test(text) && /\d{4}/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return isoFromDate(date);
  }
  return text;
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

// No clock-in but a Task note: a holiday or day off.
function isHolidayEntry(entry) {
  return !!entry && !entry.start && !entry.end && !!entry.task;
}

async function initWorkTime(forceRefresh = false) {
  // Before the fetch, so a failed refresh never leaves the controls dead.
  if (!workTimeListenersAttached) {
    workTimeListenersAttached = true;
    const rerenderFromFirstPage = () => {
      tsCurrentPage = 1;
      renderWorkTimeList();
    };

    document.getElementById('log-today-btn').addEventListener('click', () => {
      openWorkTimeForm(isoFromDate(new Date()));
    });
    // track/work-time/<date>/ opens that day's Edit, logged or not.
    registerRecordRoute('work-time', (slug, sub) => {
      if (sub || !/^\d{4}-\d{2}-\d{2}$/.test(slug)) return null;
      openWorkTimeForm(slug);
      return slug;
    });
    workTimeField('cancel-btn').addEventListener('click', closeWorkTimeForm);
    onFormSubmit('work-time-form', submitWorkTimeForm);
    workTimeField('holiday').addEventListener('change', () => {
      toggleWorkTimeHolidayFields();
      updateWorkTimeLiveDuration();
    });
    WORK_TIME_SHIFT_FIELDS.forEach((name) => workTimeField(name).addEventListener('input', updateWorkTimeLiveDuration));
    ['date-from', 'date-to'].forEach((name) => workTimeField(name).addEventListener('input', rerenderFromFirstPage));
    makeSortableHeaders('#work-time-table', tsSort, rerenderFromFirstPage);
  }

  await refreshWorkTime(forceRefresh);
}

// Seeds the filter around today, once; never overrides a range the user set.
function setDefaultWorkTimeDateRange() {
  const fromInput = workTimeField('date-from');
  const toInput = workTimeField('date-to');
  if (fromInput.value || toInput.value) return;

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - WORK_TIME_DEFAULT_DAYS_BACK);
  const toDate = new Date(today);
  toDate.setDate(today.getDate() + WORK_TIME_DEFAULT_DAYS_AHEAD);
  fromInput.value = isoFromDate(fromDate);
  toInput.value = isoFromDate(toDate);
}

// Day (C) and Duration (G) are never read: Duration is computed here, and Day is
// only written on a new row.
async function refreshWorkTime(forceRefresh = false) {
  const resp = await getValues(WORK_TIME_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

  allTimeEntries = values
    .map((row, i) => ({
      row: i + 2,
      company: cellText(row[0]).trim(),
      date: sheetDateIso(row[1]),
      start: normalizeTimeString(row[3]),
      end: normalizeTimeString(row[4]),
      breakMinutes: parseBreakMinutes(row[5]),
      task: cellText(row[7]),
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

// The company on the latest entry dated on or before today. Future rows (e.g.
// pre-filled placeholders) haven't been worked, so they can't name it.
function getLastCompany(entries) {
  const today = isoFromDate(new Date());
  const withCompany = entries.filter((e) => e.company && e.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  return withCompany.length ? withCompany[0].company : null;
}

// Only the current employer's entries; all of them if none has a company yet.
function entriesForLastCompany(entries) {
  const lastCompany = getLastCompany(entries);
  return lastCompany ? entries.filter((e) => e.company === lastCompany) : entries;
}

// Previously used companies, most frequent first.
function populateWorkTimeCompanyOptions() {
  const counts = new Map();
  allTimeEntries.forEach(({ company }) => {
    if (!company) return;
    counts.set(company, (counts.get(company) || 0) + 1);
  });

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);

  const datalist = workTimeField('company-options');
  datalist.innerHTML = '';
  sorted.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    datalist.appendChild(option);
  });
}

// A weekday with nothing logged today: a red "<days>d" badge (days since the last
// logged day) opening today, and once allowed one notification a day. A holiday counts.
function checkWorkTimeReminder() {
  const today = isoFromDate(new Date());
  const entries = entriesForLastCompany(allTimeEntries).filter((e) => e.date <= today);
  if (isWeekend(today) || !entries.length || entries.some((e) => e.date === today)) {
    setPageBadge('track', 'work-time', null);
    return;
  }
  const last = entries.reduce((max, e) => (e.date > max ? e.date : max), '');
  const days = Math.round((dateFromIso(today) - dateFromIso(last)) / MS_PER_DAY);
  setPageBadge('track', 'work-time', { text: `${days}d`, title: `Today's hours aren't logged; last logged ${days} days ago (${last})`, record: today });
  if ('Notification' in window && Notification.permission === 'granted'
    && localStorage.getItem('ledger_last_reminder_notified') !== today) {
    new Notification('Ledger', { body: 'Work Time: log today' });
    localStorage.setItem('ledger_last_reminder_notified', today);
  }
}

function getFilteredTimeEntries() {
  const dateFrom = workTimeField('date-from').value;
  const dateTo = workTimeField('date-to').value;

  return allTimeEntries
    .filter((e) => (!dateFrom || e.date >= dateFrom) && (!dateTo || e.date <= dateTo))
    .sort((a, b) => a.date.localeCompare(b.date) * tsSort.dir);
}

function renderWorkTimeList() {
  const tbody = workTimeField('body');
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

  // Read per render, so a tab left open past midnight moves the mark.
  const todayIso = isoFromDate(new Date());

  pageEntries.forEach((e) => {
    const tr = document.createElement('tr');
    const weekend = isWeekend(e.date);
    // A weekday without times is a holiday, or (no Task either) not filled in yet.
    const noTimes = !e.start && !e.end;
    const isHoliday = !weekend && isHolidayEntry(e);
    const isNoEntry = !weekend && noTimes && !e.task;

    const firstSpace = e.company.indexOf(' ');
    const company = firstSpace === -1 ? e.company : `${e.company.slice(0, firstSpace)}…`;
    const task = e.task.length > WORK_TIME_TASK_DISPLAY_MAX ? `${e.task.slice(0, WORK_TIME_TASK_DISPLAY_MAX)}…` : e.task;

    const durationCell = document.createElement('td');
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

    tr.append(
      makeCell(company, e.company),
      makeCell(e.date),
      makeCell(dayNameFromDate(e.date)),
      makeCell(noTimes ? '—' : e.start.slice(0, 5)),
      makeCell(noTimes ? '—' : e.end.slice(0, 5)),
      makeCell(noTimes || !e.breakMinutes ? '—' : `${e.breakMinutes}m`),
      durationCell,
      makeCell(task, e.task),
      actionsCell,
    );
    // A weekend and a holiday are both a day off here.
    if (weekend || isHoliday) tr.classList.add('work-time-off');
    else if (isNoEntry) tr.classList.add('work-time-no-entry');
    // Separate: today's tint lands on the cells, so it shows over a day off's row tint.
    if (e.date === todayIso) tr.classList.add('today-row');
    tbody.appendChild(tr);
  });

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
  const holiday = workTimeField('holiday').checked;
  WORK_TIME_SHIFT_FIELDS.forEach((name) => {
    const el = workTimeField(name);
    el.disabled = holiday;
    if (holiday) el.value = name.startsWith('break') ? '0' : '';
  });
}

function workTimeBreakMinutesFromInputs() {
  const h = Number(workTimeField('break-h').value) || 0;
  const m = Number(workTimeField('break-m').value) || 0;
  return h * 60 + m;
}

function updateWorkTimeLiveDuration() {
  const liveDuration = workTimeField('live-duration');
  if (workTimeField('holiday').checked) {
    liveDuration.textContent = '🏖 Holiday';
    return;
  }

  const durationMin = computeDurationMinutes(workTimeField('start').value, workTimeField('end').value, workTimeBreakMinutesFromInputs());
  liveDuration.textContent = durationMin !== null ? minutesToHm(durationMin) : '—';
}

function openWorkTimeForm(dateStr) {
  const existing = allTimeEntries.find((e) => e.date === dateStr);

  workTimeField('company').value = existing?.company || getLastCompany(allTimeEntries) || '';
  workTimeField('date').value = dateStr;
  workTimeField('start').value = existing?.start || '';
  workTimeField('end').value = existing?.end || '';
  const breakMinutes = Math.max(0, Math.round(existing?.breakMinutes || 0));
  workTimeField('break-h').value = Math.floor(breakMinutes / 60);
  workTimeField('break-m').value = breakMinutes % 60;
  workTimeField('task').value = existing?.task || '';

  workTimeField('holiday').checked = isHolidayEntry(existing);
  toggleWorkTimeHolidayFields();
  updateWorkTimeLiveDuration();

  clearFieldError('work-time-form-error');
  workTimeField('modal').hidden = false;
}

function closeWorkTimeForm() {
  workTimeField('modal').hidden = true;
}

// Keeps one row per calendar day: blank rows for every missing day between the
// last earlier entry and the new date.
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

  // RAW like the main append: a parsed date could read back as "19/11/2026".
  if (rows.length) await appendValues(WORK_TIME_RANGE, rows, 'RAW');
}

async function submitWorkTimeForm(event) {
  event.preventDefault();

  const company = workTimeField('company').value.trim();
  const date = workTimeField('date').value;
  const holiday = workTimeField('holiday').checked;
  const start = holiday ? '' : workTimeField('start').value;
  const end = holiday ? '' : workTimeField('end').value;
  // Written as "HH:MM", not minutes: a duration-formatted Break cell would read
  // a bare 15 as 15 days.
  const breakValue = minutesToTimeInput(holiday ? 0 : workTimeBreakMinutesFromInputs());
  const task = workTimeField('task').value;

  if (!holiday && start && end && timeToMinutes(end) <= timeToMinutes(start)) {
    showFieldError('work-time-form-error', 'End time must be after Start time.');
    return;
  }

  try {
    const existing = allTimeEntries.find((e) => e.date === date);

    if (existing) {
      const cells = (a1) => sheetRange(CONFIG.SHEETS.WORK_TIME, a1);
      const row = existing.row;
      // One request, skipping Day (C) and Duration (G). RAW: USER_ENTERED would turn
      // "09:40" into a time cell that reads back reformatted.
      await batchUpdateValues([
        { range: cells(`A${row}`), values: [[company]] },
        { range: cells(`D${row}:F${row}`), values: [[start, end, breakValue]] },
        { range: cells(`H${row}`), values: [[task]] },
      ], 'RAW');
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
