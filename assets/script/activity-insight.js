// The Health Insight panel's Activity mode: a plain-language workout-performance
// snapshot (consistency, activity-type breakdown, total resistance volume, and a
// per-muscle-group last-trained/volume breakdown). The muscle-group detail is
// this mode's own contribution — the Wellness mode's activity section only
// reports totals by description (NEAT/Cardio/Strength Training). Everything else
// is borrowed: aggregateWindow/previousDateRange/formatDateRangeLabel/
// formatActivityBreakdownLines/formatProfileLines from insight.js,
// parseWorkoutNoteLines from activity-estimator.js. insight-panel.js drives it.

// Stable display order — also the iteration order for the muscle-group
// breakdown before it's re-sorted most-neglected-first.
const MUSCLE_GROUPS = ['Legs', 'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'];

// Keyed by the exact exercise name text as it appears in the Activity Plan
// tables (index.html) — same convention activity-estimator.js's EXERCISE_MET
// uses. NEAT/Cardio activities (Walk, Swim, Running) aren't muscle-specific
// resistance work, so they're deliberately not mapped here — they still
// count toward the overall consistency/activity-type totals below via
// aggregateWindow, just not toward any muscle group's volume.
const EXERCISE_MUSCLE_GROUP = {
  'Leg Press': 'Legs',
  'Leg Extension (quads)': 'Legs',
  'Leg Curl (hamstrings)': 'Legs',
  'Hip Abduction machine': 'Legs',
  'Hip Adduction machine': 'Legs',
  'Calf Raise machine': 'Legs',
  'Chest Press machine': 'Chest',
  'Pec Deck / Chest Fly machine': 'Chest',
  'Shoulder Press machine': 'Shoulders',
  'Left Lateral Raise machine (or cable)': 'Shoulders',
  'Right Lateral Raise machine (or cable)': 'Shoulders',
  'Cable Tricep Pushdown': 'Triceps',
  'Lat Pulldown': 'Back',
  'Seated Row machine': 'Back',
  'Rear Delt Fly machine (or cable)': 'Shoulders',
  'Cable Bicep Curl': 'Biceps',
  'Dumbbell Goblet Squat': 'Legs',
  'Dumbbell Bench Press': 'Chest',
  'Dumbbell Row': 'Back',
  'Dumbbell Shoulder Press': 'Shoulders',
  'Dumbbell Romanian Deadlift': 'Legs',
  'Dumbbell Lateral Raise': 'Shoulders',
  'Dumbbell Bicep Curl': 'Biceps',
  'Dumbbell Tricep Extension': 'Triceps',
};

// Total resistance-training REPS logged in [fromIso, toIso], across every
// exercise (mapped or not) — the simple whole-body volume-trend figure,
// independent of the per-muscle breakdown below.
//
// Reps rather than sets because the workout note records total reps per exercise
// ("30x Leg Press"): 30 could have been 3x10 or 5x6, so a set count is no longer
// recoverable from the log. Reps are the finer figure of the two and the older
// two-number lines convert into them exactly (3x10 = 30 reps, done by
// parseWorkoutNoteLines), so volume stays comparable across entries logged either
// side of that format change — which matters here, since this figure's whole job
// is a current-vs-previous-period comparison.
function sumStrengthRepsInWindow(fromIso, toIso) {
  let total = 0;
  getDatedWellnessEntries()
    .filter((e) => isActivityCategory(e.category) && e.date >= fromIso && e.date <= toIso && e.notes.trim())
    .forEach((e) => {
      parseWorkoutNoteLines(e.notes).forEach((line) => {
        if (line.type === 'reps') total += line.reps;
      });
    });
  return total;
}

// Per muscle group: reps performed (see sumStrengthRepsInWindow for why reps
// rather than sets) and sessions (distinct dates trained) in
// [fromIso, toIso], plus the last-trained date searched across the entry's
// *full* history — so a long-neglected muscle still reads correctly even
// when it falls outside the selected range, rather than showing as "never
// logged" just because the picked window happens to be short. Sorted
// most-neglected-first (never logged, then longest gap, then lowest volume)
// so the muscle needing attention next always leads the list.
function computeMuscleGroupRows(fromIso, toIso) {
  const stats = new Map(MUSCLE_GROUPS.map((m) => [m, { repsInRange: 0, sessionDatesInRange: new Set(), lastTrainedDate: null }]));

  getDatedWellnessEntries()
    .filter((e) => isActivityCategory(e.category) && e.notes.trim())
    .forEach((e) => {
      parseWorkoutNoteLines(e.notes)
        .filter((line) => line.type === 'reps')
        .forEach((line) => {
          const muscle = EXERCISE_MUSCLE_GROUP[line.name];
          if (!muscle) return;
          const s = stats.get(muscle);
          if (!s.lastTrainedDate || e.date > s.lastTrainedDate) s.lastTrainedDate = e.date;
          if (e.date >= fromIso && e.date <= toIso) {
            s.repsInRange += line.reps;
            s.sessionDatesInRange.add(e.date);
          }
        });
    });

  const todayIso = isoFromDate(new Date());
  return MUSCLE_GROUPS.map((muscle) => {
    const s = stats.get(muscle);
    const daysSinceLastTrained = s.lastTrainedDate
      ? Math.round((dateFromIso(todayIso) - dateFromIso(s.lastTrainedDate)) / 86400000)
      : null;
    return {
      muscle,
      repsInRange: s.repsInRange,
      sessionsInRange: s.sessionDatesInRange.size,
      lastTrainedDate: s.lastTrainedDate,
      daysSinceLastTrained,
    };
  }).sort((a, b) => {
    if (a.lastTrainedDate === null || b.lastTrainedDate === null) {
      if (a.lastTrainedDate === b.lastTrainedDate) return 0;
      return a.lastTrainedDate === null ? -1 : 1;
    }
    if (a.daysSinceLastTrained !== b.daysSinceLastTrained) return b.daysSinceLastTrained - a.daysSinceLastTrained;
    return a.repsInRange - b.repsInRange;
  });
}

// Reuses insight.js's own aggregateWindow/previousDateRange/
// formatDateRangeLabel — the exact same current-vs-previous-period
// computation the Wellness mode already runs, just for this mode's own
// selected range — plus the new muscle-group/volume metrics above.
function gatherActivityInsightMetrics(fromIso, toIso) {
  const dates = datesInRange(fromIso, toIso);
  const lookbackDays = dates.length;
  const rangeLabel = formatDateRangeLabel(fromIso, toIso, lookbackDays);
  const current = aggregateWindow(dates);
  const previous = aggregateWindow(previousDateRange(fromIso, toIso));
  const prevRange = previousDateRange(fromIso, toIso);

  return {
    lookbackDays,
    rangeLabel,
    // Same age/sex/height/weight/BMI block the Wellness and Food modes send
    // (insight.js) — training volume, rest needs and what counts as a heavy session
    // all depend on the body doing the lifting, so the coach shouldn't be
    // reasoning about this log without knowing whose it is.
    profile: gatherProfileSnapshot(),
    activityDaysLogged: current.activityDaysLogged,
    prevActivityDaysLogged: previous.activityDaysLogged,
    avgActivityMins: current.avgActivityMins,
    prevAvgActivityMins: previous.avgActivityMins,
    avgActivityKcal: current.avgActivityKcal,
    prevAvgActivityKcal: previous.avgActivityKcal,
    activityByDescription: current.activityByDescription,
    prevActivityByDescription: previous.activityByDescription,
    muscleRows: computeMuscleGroupRows(fromIso, toIso),
    totalRepsInRange: sumStrengthRepsInWindow(fromIso, toIso),
    prevTotalRepsInRange: prevRange.length ? sumStrengthRepsInWindow(prevRange[0], prevRange[prevRange.length - 1]) : 0,
  };
}

function formatMuscleGroupLines(rows, rangeLabel) {
  return rows.map((r) => {
    const last = r.lastTrainedDate
      ? `last trained ${r.daysSinceLastTrained} day${r.daysSinceLastTrained === 1 ? '' : 's'} ago (${r.lastTrainedDate})`
      : 'never logged';
    return `${r.muscle}: ${r.repsInRange} reps, ${r.sessionsInRange} session${r.sessionsInRange === 1 ? '' : 's'} in ${rangeLabel} — ${last}`;
  });
}

function formatActivityInsightPrompt(m) {
  const consistencyLine = `Workout days logged (${m.rangeLabel}): ${m.activityDaysLogged}/${m.lookbackDays} — previous period: ${m.prevActivityDaysLogged}/${m.lookbackDays}`;
  const volumeLine = `Total resistance-training reps, all muscle groups (${m.rangeLabel}): ${m.totalRepsInRange} — previous period: ${m.prevTotalRepsInRange}`;

  const lines = [
    ...formatProfileLines(m.profile),
    '',
    consistencyLine,
    volumeLine,
    ...formatActivityBreakdownLines(m),
    '',
    `Muscle group breakdown (${m.rangeLabel}), most neglected first:`,
    ...formatMuscleGroupLines(m.muscleRows, m.rangeLabel),
  ];

  return lines.join('\n');
}

const ACTIVITY_INSIGHT_SYSTEM_PROMPT = `You are a supportive strength-training coach reviewing someone's own self-tracked workout log. You are not a doctor — do not diagnose injuries or prescribe rehab; if something sounds like pain or an injury, tell them to see a professional instead of advising around it.

You'll be given: their age, sex, height, current body mass and BMI (any of which may read "not set" — treat that as missing, never guess a value, and note it if it matters to your answer); how many days they logged any activity this period vs. the immediately preceding period of the same length; their total resistance-training rep volume this period vs. that previous period; the same activity-type breakdown (minutes/day and kcal/day burned by type, e.g. NEAT/Cardio/Strength Training) the app's Wellness Insight also reports; and a muscle-group breakdown (reps performed and sessions this period, plus days since it was actually last trained) covering Legs, Chest, Back, Shoulders, Biceps, and Triceps, sorted most-neglected-first. A muscle marked "never logged" has no training history in the data at all — treat that as a real gap to flag, not a rounding artifact.

Every volume figure is a TOTAL rep count: each exercise's reps summed across all of its sets for the period. The log stores only that total (a workout note reads "30x Leg Press"), so the number of sets and the reps per set cannot be recovered from it. Do not infer, restate or ask for a sets-by-reps figure, do not assume a default set count, and express any volume you recommend as a total rep count as well.

Write a short plain-text report with exactly these four sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall picture — consistency and volume trend vs. the previous period.
Going well: what's on track — muscle groups being trained regularly, volume holding or increasing.
Needs attention: which muscle group(s) are most neglected (longest gap or lowest volume) and any consistency or volume decline vs. the previous period.
Suggestions: 2-4 concrete, specific next steps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — prioritize the most neglected muscle group(s) for the next session, and give any target as total reps rather than sets by reps.

If an additional question from the user is included after the data, also answer it directly in a fifth section, "Answer: text".

Keep the whole report under 250 words.`;
