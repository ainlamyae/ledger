// "Activity Rotation" panel: one bar per Activity Group with a Weekly Desired
// set (health-activity-catalogue.js), sessions logged in the window vs. that
// figure scaled to the window, plus the same three-ring donut as Protein Source
// Rotation. A "session" is any day whose Workout notes touch the Group, so a
// mixed day counts once for EACH Group it touches. Shared rotation code lives
// in health-chart-protein-rotation.js.

// One row per Group with a Weekly Desired. Rows sharing a Group should carry
// the same copied-down figure; if they disagree, the max wins.
function trackedActivityGroups() {
  const groups = new Map();
  allActivities.forEach((a) => {
    if (!a.group) return;
    const existing = groups.get(a.group) || { classification: a.category || ROTATION_UNCLASSIFIED_LABEL, weeklyDesired: null };
    if (a.weeklyDesired !== null && a.weeklyDesired > 0) {
      existing.weeklyDesired = existing.weeklyDesired === null ? a.weeklyDesired : Math.max(existing.weeklyDesired, a.weeklyDesired);
    }
    groups.set(a.group, existing);
  });

  return [...groups.entries()]
    .filter(([, v]) => v.weeklyDesired !== null)
    .map(([name, v]) => ({ name, classification: v.classification, weeklyDesired: v.weeklyDesired }));
}

// Distinct days touching each Group, so three leg exercises in a day are one session.
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

// One row per tracked Group: sessions logged vs. Weekly Desired scaled to the
// window length. Most sessions still owed first; Unclassified last.
function computeActivityRotationRows(from, to) {
  const lookbackDays = datesInRange(from, to).length;
  const sessionsByGroup = actualSessionsByGroup(from, to);

  const rows = trackedActivityGroups().map((s) => {
    const actualSessions = sessionsByGroup.get(s.name) || 0;
    const desiredSessions = s.weeklyDesired * (lookbackDays / DAYS_PER_WEEK);
    return {
      name: s.name,
      classification: s.classification,
      actualSessions,
      desiredSessions: roundTenth(desiredSessions),
      weeklyDesired: s.weeklyDesired,
      actualPercentOfDesired: desiredSessions > 0 ? percentTenth(actualSessions, desiredSessions) : 0,
    };
  });

  const gap = (r) => r.desiredSessions - r.actualSessions;
  return rows.sort((a, b) => compareUnclassifiedLast(a.classification, b.classification) || gap(b) - gap(a));
}

// Separate chart handles per copy (Chart panel, GYM modal, Activity page), or
// redrawing one copy would destroy another's chart.
const activityRotationCharts = {
  chart: { chart: null, donut: null },
  gym: { chart: null, donut: null },
  activity: { chart: null, donut: null },
};
const ACTIVITY_ROTATION_DEFAULT_IDS = {
  chart: 'activity-rotation-chart', donut: 'activity-rotation-donut', legend: 'activity-rotation-legend',
};
const ACTIVITY_ROTATION_GYM_IDS = {
  chart: 'activity-rotation-chart-gym', donut: 'activity-rotation-donut-gym', legend: 'activity-rotation-legend-gym',
};
const ACTIVITY_ROTATION_ACTIVITY_IDS = {
  chart: 'activity-rotation-chart-activity', donut: 'activity-rotation-donut-activity', legend: 'activity-rotation-legend-activity',
};

function renderActivityRotationDonut(rows, barColors, toIso, slot, ids) {
  renderRotationDonut(activityRotationCharts[slot], ids.donut, rows, barColors, toIso, {
    referenceValue: (r) => r.weeklyDesired,
    countsBetween: actualSessionsByGroup,
    ringValue: (r, sessions) => sessions.get(r.name) || 0,
    emptyText: ['No sessions logged for a tracked', 'Group in these 4 weeks'],
    tooltipTitle: (r) => r.classification,
    referenceUnit: ' sessions/week desired',
    windowUnit: ' sessions',
  });
}

function renderActivityRotationChart({ from, to }, slot = 'chart', ids = ACTIVITY_ROTATION_DEFAULT_IDS) {
  const rows = computeActivityRotationRows(from, to);
  const actualData = rows.map((r) => r.actualSessions);
  const { barColors, legend } = rotationPalette(rows, 'classification');

  renderCategoryLegend(ids.legend, legend);

  renderRotationBars(activityRotationCharts[slot], ids.chart, {
    labels: rows.map((r) => r.name),
    datasets: [{ type: 'bar', label: 'Done', data: actualData, backgroundColor: barColors, order: 2 }],
    actualData,
    desiredData: rows.map((r) => r.desiredSessions),
    stacked: false,
    emptyText: 'No Activity Groups tracked yet — open Activity, edit a row, and set its Weekly Desired',
    unit: 'sessions',
    tooltip: {
      title: (items) => {
        const row = rows[items[0].dataIndex];
        return `${row.name} — ${row.classification}`;
      },
      label: (item) => {
        const row = rows[item.dataIndex];
        const value = item.dataset.label === 'Done'
          ? `${item.formattedValue} sessions done (${row.actualPercentOfDesired}% of desired this window)`
          : `${item.formattedValue} sessions desired this window (${row.weeklyDesired}/week)`;
        return `${item.dataset.label}: ${maskRotationValue(value)}`;
      },
    },
  });

  renderActivityRotationDonut(rows, barColors, to, slot, ids);
}

// Boot-time render, before data loads; app.js re-renders every copy once
// Physique and Activities are in.
function initActivityRotationPanel() {
  renderActivityRotationChart(healthDateRange());
  renderActivityRotationChart(healthDateRange(), 'gym', ACTIVITY_ROTATION_GYM_IDS);
  renderActivityRotationChart(healthDateRange(), 'activity', ACTIVITY_ROTATION_ACTIVITY_IDS);
}
