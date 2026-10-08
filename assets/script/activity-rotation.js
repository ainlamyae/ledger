// "Activity Rotation" panel: for every Activity Group (Leg Day, Push Day,
// Pull Day, Cardio, NEAT, ...) that has a Weekly Target set on any of its
// rows (activities.js), shows a horizontal bar — sessions actually logged for
// that Group in the lookback window vs. a live target scaled off the weekly
// figure — so a low/empty bar flags "you're behind on this one." Weekly
// Target is typed on the Activity sheet tab, same cell repeated across every
// exercise row that shares a Group (e.g. every NEAT row carries "7"); see
// trackedActivityGroups for how that duplication is reconciled. Beside the
// bars, a three-ring donut splits the same Groups by share of the weekly
// target — outermost ring the reference split, middle ring the 4 weeks ending
// on the To date, inner ring the last week of it — so a Group's short-term
// and medium-term rotation can both be read against what it's actually
// supposed to be. Wired up by initActivityRotationPanel(), called from app.js.
//
// A "session" of a Group is any day whose Workout notes include at least one
// exercise belonging to it — a mixed day (e.g. a lift plus a walk) counts as
// one session for EACH Group it touches, not just the dominant one.

const ACTIVITY_UNCLASSIFIED_LABEL = 'Unclassified';

// One row per distinct Group across the Activity sheet, Weekly Target being
// the sole "is this tracked" switch — same role activityRotationPalette's
// protein-rotation counterpart gives proteinPercent. Every row that shares a
// Group is expected to carry the same figure (it's typed once, then copied
// down); when rows disagree anyway, the max survives rather than whichever
// row happened to load first, so a typed number is never silently dropped.
function trackedActivityGroups() {
  const groups = new Map();
  allActivities.forEach((a) => {
    if (!a.group) return;
    const existing = groups.get(a.group) || { classification: a.category || ACTIVITY_UNCLASSIFIED_LABEL, weeklyTarget: null };
    if (a.weeklyTarget !== null && a.weeklyTarget > 0) {
      existing.weeklyTarget = existing.weeklyTarget === null ? a.weeklyTarget : Math.max(existing.weeklyTarget, a.weeklyTarget);
    }
    groups.set(a.group, existing);
  });

  return [...groups.entries()]
    .filter(([, v]) => v.weeklyTarget !== null)
    .map(([name, v]) => ({ name, classification: v.classification, weeklyTarget: v.weeklyTarget }));
}

// Sessions actually logged per Group over the lookback window — one day's
// Workout note can credit more than one Group (a lift plus a walk logged the
// same day), so this counts DISTINCT DAYS touching a Group, not exercise
// lines, or a day with three leg exercises would over-count as three sessions.
function actualSessionsByGroup(from, to) {
  const sessionsByGroup = new Map();
  allPhysiqueEntries
    .filter((p) => p.date >= from && p.date <= to && p.workout && p.workout.trim())
    .forEach((p) => {
      const groupsToday = new Set();
      parseWorkoutNoteLines(p.workout).forEach((line) => {
        const group = activityByName(line.name)?.group;
        if (group) groupsToday.add(group);
      });
      groupsToday.forEach((g) => sessionsByGroup.set(g, (sessionsByGroup.get(g) || 0) + 1));
    });
  return sessionsByGroup;
}

// One row per tracked Group: sessions actually logged this window vs. its
// Weekly Target scaled to the window length (weeklyTarget × lookbackDays/7),
// so a 10-day window still reads "on track" at 10 rather than demanding a
// full 7 more sessions on top of the last full week. Sorted by remaining gap
// (target minus actual) descending, grouped by classification first — same
// to-do-list read as Protein Source Rotation.
function computeActivityRotationRows(from, to) {
  const lookbackDays = datesInRange(from, to).length;
  const sources = trackedActivityGroups();
  const sessionsByGroup = actualSessionsByGroup(from, to);

  const rows = sources.map((s) => {
    const actualSessions = sessionsByGroup.get(s.name) || 0;
    const targetSessions = s.weeklyTarget * (lookbackDays / 7);
    return {
      name: s.name,
      classification: s.classification,
      actualSessions,
      targetSessions: Math.round(targetSessions * 10) / 10,
      weeklyTarget: s.weeklyTarget,
      actualPercentOfTarget: targetSessions > 0 ? Math.round((actualSessions / targetSessions) * 1000) / 10 : 0,
    };
  });

  return sortActivityRowsByClassificationThenGap(rows);
}

// Identical grouping/ordering rule to protein-rotation.js's
// sortByClassificationThenGap, just over session counts instead of grams.
function sortActivityRowsByClassificationThenGap(rows) {
  const gap = (r) => r.targetSessions - r.actualSessions;

  const groupGap = new Map();
  rows.forEach((r) => groupGap.set(r.classification, (groupGap.get(r.classification) || 0) + gap(r)));

  return [...rows].sort((a, b) => {
    if (a.classification === b.classification) return gap(b) - gap(a);
    const aUnknown = a.classification === ACTIVITY_UNCLASSIFIED_LABEL;
    const bUnknown = b.classification === ACTIVITY_UNCLASSIFIED_LABEL;
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
    return groupGap.get(b.classification) - groupGap.get(a.classification);
  });
}

// One hue per classification (the Activity sheet's Category column), stepped
// lightness within it — same convention as proteinRotationPalette, shared by
// the bars and the donut so a Group keeps one colour everywhere in the panel.
function activityRotationPalette(rows) {
  const classifications = [...new Set(rows.map((r) => r.classification))];
  const hueFor = (c) => Math.round((classifications.indexOf(c) * 360) / classifications.length);
  const seen = new Map();

  const barColors = rows.map((r) => {
    const n = seen.get(r.classification) || 0;
    seen.set(r.classification, n + 1);
    return seriesColor(hueFor(r.classification), { lightness: '--chart-series-light', shade: n % 4 });
  });

  return {
    barColors,
    legend: classifications.map((name) => ({ name, color: seriesColor(hueFor(name), { lightness: '--chart-series-light' }) })),
  };
}

// Same two time-windowed rings as PROTEIN_ROTATION_DONUT_RINGS, both ending on
// the To date the bars use.
const ACTIVITY_ROTATION_DONUT_RINGS = [
  { label: 'Last 4 weeks', days: 28 },
  { label: 'Last week', days: 7 },
];

function activityRotationWindow(toIso, days) {
  const to = dateFromIso(toIso);
  if (!toIso || Number.isNaN(to.getTime())) return { from: null, to: null };
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));
  return { from: isoFromDate(from), to: toIso };
}

// Two independent sets of chart instances: the Indicator panel's own, and the
// GYM modal's copy of the same card (instruction-rotation-card, index.html) —
// same data and functions, a different pair of canvases, so each needs its
// own upsertChart handle rather than sharing one (reusing one would destroy
// whichever copy wasn't rendered most recently the next time the other redraws).
const activityRotationCharts = {
  indicator: { chart: null, donut: null },
  gym: { chart: null, donut: null },
};
const ACTIVITY_ROTATION_DEFAULT_IDS = {
  chart: 'activity-rotation-chart', donut: 'activity-rotation-donut', legend: 'activity-rotation-legend',
};
// The GYM modal's copy (instruction-rotation-card, index.html) — shared by
// initActivityRotationPanel's boot-time render (app.js) and the post-load
// refresh once Physique/Activities data is actually in (app.js), so the two
// can't drift onto different element ids.
const ACTIVITY_ROTATION_GYM_IDS = {
  chart: 'activity-rotation-chart-gym', donut: 'activity-rotation-donut-gym', legend: 'activity-rotation-legend-gym',
};

function renderActivityRotationDonut(rows, barColors, toIso, target, ids) {
  const ctx = document.getElementById(ids.donut);
  const labels = rows.map((r) => r.name);

  // Not a time window like the two below it — each Group's own Weekly Target,
  // the fixed split the other two rings are read against. No `days`, which
  // the tooltip callback below uses to tell it apart from a sessions-logged ring.
  const referenceRing = {
    label: 'Reference desired',
    data: rows.map((r) => r.weeklyTarget),
    total: rows.reduce((sum, r) => sum + r.weeklyTarget, 0),
  };

  const rings = ACTIVITY_ROTATION_DONUT_RINGS.map((ring) => {
    const { from, to } = activityRotationWindow(toIso, ring.days);
    const sessions = from ? actualSessionsByGroup(from, to) : new Map();
    const data = rows.map((r) => sessions.get(r.name) || 0);
    return { ...ring, data, total: data.reduce((sum, v) => sum + v, 0) };
  });

  const hasData = rings.some((ring) => ring.total > 0);
  const allRings = [referenceRing, ...rings];

  activityRotationCharts[target].donut = upsertChart(activityRotationCharts[target].donut, ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: allRings.map((ring) => ({ data: ring.data, backgroundColor: barColors })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'point' },
      plugins: {
        legend: { display: false },
        title: {
          display: rows.length > 0 && !hasData,
          text: ['No sessions logged for a tracked', 'Group in these 4 weeks'],
          color: Chart.defaults.color,
          font: { size: chartFontSize() },
          padding: { top: 40 },
        },
        tooltip: {
          callbacks: {
            title: (items) => rows[items[0].dataIndex].classification,
            label: (item) => {
              const ring = allRings[item.datasetIndex];
              if (ring.days === undefined) {
                const value = `${item.formattedValue} sessions/week desired`;
                return `${labels[item.dataIndex]} — ${ring.label}: ${privacyMode ? maskDigits(value) : value}`;
              }
              const pct = ring.total ? Math.round((item.raw / ring.total) * 1000) / 10 : 0;
              const value = `${item.formattedValue} sessions (${pct}% of the window)`;
              return `${labels[item.dataIndex]} — ${ring.label}: ${privacyMode ? maskDigits(value) : value}`;
            },
          },
        },
      },
    },
  });
}

function renderActivityRotationChart({ from, to }, target = 'indicator', ids = ACTIVITY_ROTATION_DEFAULT_IDS) {
  const ctx = document.getElementById(ids.chart);
  const rows = computeActivityRotationRows(from, to);

  const labels = rows.map((r) => r.name);
  const actualData = rows.map((r) => r.actualSessions);
  const targetData = rows.map((r) => r.targetSessions);
  const { barColors, legend } = activityRotationPalette(rows);

  renderCategoryLegend(ids.legend, legend);

  const hasData = labels.length > 0;
  const maxValue = Math.ceil(Math.max(1, ...actualData, ...targetData)) + 1;

  activityRotationCharts[target].chart = upsertChart(activityRotationCharts[target].chart, ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Done', data: actualData, backgroundColor: barColors, order: 2 },
        {
          type: 'line',
          label: 'Desired',
          data: targetData,
          showLine: false,
          pointStyle: 'line',
          rotation: 90,
          pointRadius: 12,
          borderWidth: 3,
          borderColor: chartColor('--chart-bad'),
          backgroundColor: chartColor('--chart-bad'),
          order: 1,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: !hasData,
          text: 'No Activity Groups tracked yet — open Activity, edit a row, and set its Weekly Target',
          color: Chart.defaults.color,
          font: { size: chartFontSize() },
          padding: { top: 40 },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const row = rows[items[0].dataIndex];
              return `${row.name} — ${row.classification}`;
            },
            label: (item) => {
              const row = rows[item.dataIndex];
              const value = item.dataset.label === 'Done'
                ? `${item.formattedValue} sessions done (${row.actualPercentOfTarget}% of desired this window)`
                : `${item.formattedValue} sessions desired this window (${row.weeklyTarget}/week)`;
              return `${item.dataset.label}: ${privacyMode ? maskDigits(value) : value}`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          max: maxValue,
          ticks: { callback: maskedUnitTick('sessions', 1), maxRotation: 45, minRotation: 45 },
        },
        y: { afterFit: fixTrendYAxisWidth, ticks: { autoSkip: false } },
      },
    },
  });

  renderActivityRotationDonut(rows, barColors, to, target, ids);
}

// No From/To pair of its own, same as Protein Source Rotation: the Health
// Indicator panel's wellnessDateRange() (wellness-charts.js) is the one
// window every chart in it reads, and initWellnessRangeControl() redraws this
// on a change. This first call runs at boot, before Physique/Activities data
// has loaded — app.js's own Promise.all([physiquePromise, activitiesPromise])
// callback re-renders both copies again once it's actually in, which is the
// render that puts real bars (rather than "No Activity Groups tracked yet")
// on screen either copy first shows. The GYM modal's own copy
// (instruction-rotation-card, index.html) otherwise doesn't redraw again after
// that — same one-time-build idiom upsertChart's own IntersectionObserver
// already gives a chart sitting behind a collapsed panel or, here, a closed
// modal, just for the whole render rather than only the Chart.js construction.
function initActivityRotationPanel() {
  renderActivityRotationChart(wellnessDateRange());
  renderActivityRotationChart(wellnessDateRange(), 'gym', ACTIVITY_ROTATION_GYM_IDS);
}
