
function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values, avg) {
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function minutesToClock(mins) {
  const wrapped = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

// Chart.js has no distribution plot, so: equal-width bins across the values' own range,
// plus a normal curve at the same mean/stdev scaled to the tallest bar. The curve is a
// shape overlay, not a second count axis.
function buildDistribution(values, binCount, formatLabel) {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values) > min ? Math.max(...values) : min + 1;
  const avg = mean(values);
  const sd = stdDev(values, avg);
  const binWidth = (max - min) / binCount;

  const counts = new Array(binCount).fill(0);
  values.forEach((v) => {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / binWidth));
    counts[idx]++;
  });

  const labels = counts.map((_, i) => formatLabel(min + binWidth * (i + 0.5)));

  // Bars are a % of all days, not raw counts, so the curve scales to the same peak.
  const percentages = counts.map((c) => (c / values.length) * 100);

  const peakPercentage = Math.max(...percentages);
  const normalPdf = (x) => (sd ? (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - avg) ** 2) / (2 * sd ** 2)) : 0);
  const peakPdf = normalPdf(avg) || 1;
  const curve = counts.map((_, i) => (normalPdf(min + binWidth * (i + 0.5)) / peakPdf) * peakPercentage);

  return { labels, counts, percentages, curve };
}

// Shared across all 4 Work Pattern Analysis bar charts so bars look the same
// thickness regardless of how many bars/bins each one happens to have (the
// 3 histograms have 10 bins, the Average Hours per Day chart has 5).
const WORK_PATTERN_BAR_THICKNESS = 18;

// Fixed height for the x-axis label row on the same 4 charts, so their plot
// areas line up even though Average Hours per Day's labels ("Last Quarter",
// "Last Year"...) are longer than the histograms' clock-time/hour labels and
// would otherwise wrap or reserve more vertical space, shrinking its bars.
const WORK_PATTERN_X_AXIS_HEIGHT = 80;

function fixWorkPatternXAxisHeight(scale) {
  scale.height = WORK_PATTERN_X_AXIS_HEIGHT;
}

const distributionCharts = {};

function renderDistributionChart(canvasId, dist) {
  const ctx = document.getElementById(canvasId);
  if (!dist) {
    if (distributionCharts[canvasId]) distributionCharts[canvasId].destroy();
    return;
  }

  distributionCharts[canvasId] = upsertChart(distributionCharts[canvasId], ctx, {
    data: {
      labels: dist.labels,
      datasets: [
        { type: 'bar', label: 'Days', data: dist.percentages, counts: dist.counts, backgroundColor: 'rgba(59, 130, 246, .5)', order: 2, maxBarThickness: WORK_PATTERN_BAR_THICKNESS },
        { type: 'line', label: 'Normal Distribution', data: dist.curve, borderColor: '#dc2626', pointRadius: 0, tension: .4, order: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.dataset.label === 'Days',
          callbacks: { label: (item) => `${item.dataset.counts[item.dataIndex]} day(s) (${item.raw.toFixed(1)}%)` },
        },
      },
      scales: {
        x: { afterFit: fixWorkPatternXAxisHeight },
        y: { beginAtZero: true, ticks: { callback: (value) => `${value}%` } },
      },
    },
  });
}

const STANDARD_WORKDAY_MINUTES = 8 * 60;

// Signed tally of (shift − 8h) over qualifying entries: a real Start/End, not today's
// possibly-unfinished shift, not a weekend, and a non-negative duration. A missed
// weekday is excluded rather than counted as −8h — no data isn't leaving early — and a
// weekend shift doesn't count either way, since no 8h baseline was expected there.
// `days` is a trailing window (lifelong if falsy), matching averageDailyHours.
function computeOvertimeMinutes(entries, days) {
  const todayIso = isoFromDate(new Date());
  const windowStartIso = days
    ? isoFromDate(new Date(new Date().setDate(new Date().getDate() - (days - 1))))
    : null;

  const qualifying = entries.filter((e) =>
    e.start && e.end && e.date !== todayIso && !isWeekend(e.date)
    && (!windowStartIso || e.date >= windowStartIso)
    && computeDurationMinutes(e.start, e.end, e.breakMinutes) >= 0
  );

  const minutes = qualifying.reduce(
    (sum, e) => sum + (computeDurationMinutes(e.start, e.end, e.breakMinutes) - STANDARD_WORKDAY_MINUTES),
    0
  );

  return { minutes, count: qualifying.length };
}

function renderTimesheetOvertimeSummary(entries) {
  const el = document.getElementById('timesheet-overtime-summary');
  el.textContent = '';
  el.classList.remove('warning');

  const total = computeOvertimeMinutes(entries, null);
  if (total.count === 0) return; // not enough logged full days yet — stay blank, same convention as .body-mass-eta

  const year = computeOvertimeMinutes(entries, 365);
  const month = computeOvertimeMinutes(entries, 30);
  const week = computeOvertimeMinutes(entries, 7);

  const icon = total.minutes > 0 ? '⏱️' : '✅';
  const headline = total.minutes > 0
    ? `${signedMinutesToHm(total.minutes)} beyond an 8h/day pace overall`
    : 'At or under an 8h/day pace overall';

  el.textContent = `${icon} ${headline} — Last Year ${signedMinutesToHm(year.minutes)} · Last Month ${signedMinutesToHm(month.minutes)} · Last Week ${signedMinutesToHm(week.minutes)}`;
  el.classList.toggle('warning', total.minutes > 0);
}

function renderTimesheetDistributionCharts(entries) {
  const today = isoFromDate(new Date());
  const worked = entries.filter((e) => e.start && e.end && e.date !== today);

  renderDistributionChart('timesheet-start-distribution-chart', buildDistribution(worked.map((e) => timeToMinutes(e.start)), 10, minutesToClock));
  renderDistributionChart('timesheet-end-distribution-chart', buildDistribution(worked.map((e) => timeToMinutes(e.end)), 10, minutesToClock));

  // Weekends aren't representative shifts, and a negative duration (end before start,
  // or a break longer than the shift) is mis-keyed. Both would skew the bins.
  const durations = worked
    .filter((e) => !isWeekend(e.date))
    .map((e) => computeDurationMinutes(e.start, e.end, e.breakMinutes) / 60)
    .filter((h) => h >= 0);
  renderDistributionChart('timesheet-duration-distribution-chart', buildDistribution(durations, 10, (h) => `${h.toFixed(1)}h`));
}

function isHolidayEntry(entry) {
  return !!entry && !entry.start && !entry.end && !!entry.task;
}

// Hours in the trailing window (or since the first entry) over the working days elapsed
// in it. Weekends and marked holidays leave both numerator and denominator, so they
// can't pull the average down; a weekday with no entry still counts as 0 hours, since
// that's a missed log rather than time off.
function averageDailyHours(entries, days) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let windowStart;
  if (days) {
    windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - (days - 1));
  } else {
    if (entries.length === 0) return 0;
    windowStart = entries.reduce((min, e) => (dateFromIso(e.date) < min ? dateFromIso(e.date) : min), dateFromIso(entries[0].date));
  }

  const byDate = new Map(entries.map((e) => [e.date, e]));

  let totalMinutes = 0;
  let workingDays = 0;
  const cursor = new Date(windowStart);
  while (cursor < today) {
    const iso = isoFromDate(cursor);
    if (!isWeekend(iso)) {
      const entry = byDate.get(iso);
      if (!isHolidayEntry(entry)) {
        workingDays++;
        if (entry?.start && entry?.end) totalMinutes += computeDurationMinutes(entry.start, entry.end, entry.breakMinutes) || 0;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return workingDays ? totalMinutes / 60 / workingDays : 0;
}

let timesheetDailyAverageChart = null;

function renderTimesheetDailyAverageChart(entries) {
  const ctx = document.getElementById('timesheet-daily-average-chart');
  if (entries.length === 0) {
    if (timesheetDailyAverageChart) timesheetDailyAverageChart.destroy();
    return;
  }

  const periods = [
    { label: 'Last Week', days: 7 },
    { label: 'Last Month', days: 30 },
    { label: 'Last Quarter', days: 90 },
    { label: 'Last Year', days: 365 },
    { label: 'Lifelong', days: null },
  ];

  timesheetDailyAverageChart = upsertChart(timesheetDailyAverageChart, ctx, {
    type: 'bar',
    data: {
      labels: periods.map((p) => p.label),
      datasets: [{ label: 'Avg Hours/Day', data: periods.map((p) => averageDailyHours(entries, p.days)), backgroundColor: '#3b82f6', maxBarThickness: WORK_PATTERN_BAR_THICKNESS }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.raw.toFixed(1)}h/day` } },
      },
      scales: {
        x: { afterFit: fixWorkPatternXAxisHeight, ticks: { maxRotation: 90, minRotation: 90 } },
        y: { beginAtZero: true },
      },
    },
  });
}
