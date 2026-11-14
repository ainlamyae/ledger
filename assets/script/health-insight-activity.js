// The Health Insight panel's Activity mode: consistency, the activity-type
// breakdown, resistance volume, and each muscle group's last-trained gap and
// exercises. Muscle groups and the exercise -> group mapping come from the
// Activities sheet (health-activity-catalogue.js), in the sheet's order.

// Total resistance reps in [fromIso, toIso], mapped or not. Reps, not sets: the
// note stores total reps ("30x Leg Press"), and older "3x10" lines convert exactly.
function sumStrengthRepsInWindow(fromIso, toIso) {
  let total = 0;
  physiqueAsHealthEntries()
    .filter((e) => isActivityCategory(e.category) && e.date >= fromIso && e.date <= toIso && e.notes.trim())
    .forEach((e) => {
      parseWorkoutNoteLines(e.notes).forEach((line) => {
        if (line.type === 'reps') total += line.reps;
      });
    });
  return total;
}

// Per muscle group: reps and sessions in range, and the last-trained date over the
// whole history (so a long-neglected group isn't "never logged" on a short range).
// Most neglected first: never logged, then longest gap, then lowest volume.
function computeMuscleGroupRows(fromIso, toIso) {
  const stats = new Map(activityMuscleGroups().map((m) => [m, {
    repsInRange: 0, sessionDatesInRange: new Set(), lastTrainedDate: null, exerciseReps: new Map(),
  }]));

  physiqueAsHealthEntries()
    .filter((e) => isActivityCategory(e.category) && e.notes.trim())
    .forEach((e) => {
      parseWorkoutNoteLines(e.notes)
        .filter((line) => line.type === 'reps')
        .forEach((line) => {
          const muscle = activityMuscleGroup(line.name);
          if (!muscle) return;
          const s = stats.get(muscle);
          if (!s.lastTrainedDate || e.date > s.lastTrainedDate) s.lastTrainedDate = e.date;
          if (e.date >= fromIso && e.date <= toIso) {
            s.repsInRange += line.reps;
            s.sessionDatesInRange.add(e.date);
            // One figure per movement across the range.
            s.exerciseReps.set(line.name, (s.exerciseReps.get(line.name) || 0) + line.reps);
          }
        });
    });

  const todayIso = isoFromDate(new Date());
  return [...stats.keys()].map((muscle) => {
    const s = stats.get(muscle);
    const daysSinceLastTrained = s.lastTrainedDate
      ? Math.round((dateFromIso(todayIso) - dateFromIso(s.lastTrainedDate)) / INSIGHT_MS_PER_DAY)
      : null;
    return {
      muscle,
      repsInRange: s.repsInRange,
      sessionsInRange: s.sessionDatesInRange.size,
      lastTrainedDate: s.lastTrainedDate,
      daysSinceLastTrained,
      // Heaviest movement first.
      exercises: [...s.exerciseReps.entries()]
        .map(([name, reps]) => ({ name, reps }))
        .sort((a, b) => b.reps - a.reps),
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

// One row per logged activity day, newest first. Resistance sessions are kept so
// summariseRoutineActivity can tell them apart by content.
function computeActivitySessionDays(fromIso, toIso) {
  const byDate = new Map();
  const entries = physiqueAsHealthEntries();
  const bodyMassKg = latestBodyMassKg(entries);

  entries
    .filter((e) => isActivityCategory(e.category) && e.amount !== null && e.date >= fromIso && e.date <= toIso)
    .forEach((e) => {
      if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date, sessions: [], mins: 0, kcal: 0 });
      const day = byDate.get(e.date);
      const mins = toActivityMinutes(e.amount, e.unit);
      const kcal = Math.round(activityEntryKcal(e, bodyMassKg));
      day.sessions.push({
        description: e.description || 'Other',
        mins,
        kcal,
        // The note's lines in logged order.
        items: e.notes.trim() ? parseWorkoutNoteLines(e.notes) : [],
      });
      day.mins += mins;
      day.kcal += kcal;
    });

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// Wellness's current-vs-previous aggregation for this range, plus the
// muscle-group and volume figures above.
function gatherActivityInsightMetrics(fromIso, toIso) {
  const dates = datesInRange(fromIso, toIso);
  const lookbackDays = dates.length;
  const prevRange = previousDateRange(fromIso, toIso);
  const current = aggregateWindow(dates);
  const previous = aggregateWindow(prevRange);

  return {
    lookbackDays,
    profile: gatherProfileSnapshot(),
    bodyMassHealthyKg: bodyMassHealthySettingKg(),
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
    sessionDays: computeActivitySessionDays(fromIso, toIso),
  };
}

// One summary row per type with no resistance work (walk, swim). Resistance is
// listed under its muscle groups instead. Judged by content, not by name.
function summariseRoutineActivity(sessionDays) {
  const byDescription = new Map();
  sessionDays.forEach((day) => day.sessions.forEach((s) => {
    if (!byDescription.has(s.description)) byDescription.set(s.description, []);
    byDescription.get(s.description).push({ ...s, date: day.date });
  }));

  return [...byDescription.keys()].sort()
    .filter((description) => !byDescription.get(description).some((s) => s.items.some((i) => i.type === 'reps')))
    .map((description) => {
      const sessions = byDescription.get(description);
      const steps = sessions.map((s) => s.items.filter((i) => i.type === 'steps').reduce((sum, i) => sum + i.steps, 0));
      return {
        description,
        days: new Set(sessions.map((s) => s.date)).size,
        mins: sessions.map((s) => s.mins),
        kcal: sessions.map((s) => s.kcal),
        steps: steps.some((v) => v > 0) ? steps : null,
      };
    });
}

// "94-109 (avg 100)", or just "100" when every day was the same.
function formatRange(values, unit) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const avgValue = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return lo === hi ? `${lo} ${unit}` : `${lo}-${hi} ${unit} (avg ${avgValue})`;
}

function formatRoutineActivityLines(routine, lookbackDays) {
  if (routine.length === 0) return [];
  return [
    'Routine activity — every logged type with no resistance work, summarised not listed per day:',
    ...routine.map((r) => {
      const steps = r.steps ? `, ${formatRange(r.steps, 'steps/day')}` : '';
      return `  - ${r.description}: ${r.days}/${lookbackDays} days, ${formatRange(r.mins, 'min net/day')}, ${formatRange(r.kcal, 'kcal/day')}${steps}`;
    }),
  ];
}

// Exercises listed under the group they trained: the question is what each muscle has had.
function formatMuscleGroupLines(rows) {
  return rows.map((r) => {
    const last = r.lastTrainedDate
      ? `last trained ${r.daysSinceLastTrained} day${r.daysSinceLastTrained === 1 ? '' : 's'} ago`
      : 'never logged';
    const exercises = r.exercises.length
      ? ` — ${r.exercises.map((x) => `${x.reps}x ${x.name}`).join(', ')}`
      : '';
    return `${r.muscle}: ${r.repsInRange} reps, ${r.sessionsInRange} session${r.sessionsInRange === 1 ? '' : 's'}, ${last}${exercises}`;
  });
}

function formatActivityInsightPrompt(m) {
  return [
    ...formatProfileLines(m.profile, m.bodyMassHealthyKg),
    '',
    `Total resistance-training reps, all muscle groups: ${m.totalRepsInRange} — previous period: ${m.prevTotalRepsInRange}`,
    ...formatActivityBreakdownLines(m),
    '',
    ...formatRoutineActivityLines(summariseRoutineActivity(m.sessionDays), m.lookbackDays),
    '',
    'Muscle group breakdown, most neglected first, with the exercises that built it:',
    ...formatMuscleGroupLines(m.muscleRows),
  ].join('\n');
}

const ACTIVITY_INSIGHT_SYSTEM_PROMPT = `You are a supportive strength-training coach reviewing someone's own self-tracked workout log. You are not a doctor — do not diagnose injuries or prescribe rehab; if something sounds like pain or an injury, tell them to see a professional instead of advising around it.

You'll be given: their age, sex, height, current body mass and BMI (any of which may read "not set" — treat that as missing, never guess a value, and note it if it matters to your answer); their total resistance-training rep volume this period vs. the immediately preceding period of the same length; the same activity-type breakdown (minutes/day and kcal/day burned by type, e.g. NEAT/Cardio/Strength Training) the app's Wellness Insight also reports; a routine-activity summary; and a muscle-group breakdown covering Legs, Chest, Back, Shoulders, Biceps, and Triceps, sorted most-neglected-first. A muscle marked "never logged" has no training history in the data at all — treat that as a real gap to flag, not a rounding artifact.

EVERY minute figure in this data is NET ACTIVE time — the time actually spent working, measured exercise by exercise. It is NOT session wall-clock: rest between sets, setup, changing and travel are all excluded. A resistance session logged as 8 net minutes is therefore a normal session, not a token one, and a per-type average of "7 min/day" can represent a full workout. Judge training by REP VOLUME and by which muscle groups were hit — never by whether the minutes look short against gym-session norms, and never suggest simply spending more minutes as an end in itself. Recommend more volume, better coverage or more frequency instead.

Note also that a per-type "min/day" average is taken over the days that TYPE was logged, not over the whole period; the "[only N/M days logged]" marker tells you how many days that is.

Every volume figure is a TOTAL rep count: each exercise's reps summed across all of its sets for the period. The log stores only that total (a workout note reads "30x Leg Press"), so the number of sets and the reps per set cannot be recovered from it. Do not infer, restate or ask for a sets-by-reps figure, do not assume a default set count, and express any volume you recommend as a total rep count as well.

Activity is reported in two parts. "Routine activity" covers every logged type that carries no resistance work — walking, swimming, general NEAT — given once per type as a days-logged count with the range and average per day, rather than repeated for each date. Read those as a background habit; the days-logged count tells you how often it happened, so do not treat a summarised type as a one-off.

The muscle-group breakdown then carries the resistance work itself: after each group's reps, session count and last-trained gap, it lists the individual exercises that trained it and the total reps of each, heaviest first. Use those exercise names — they are the movements this person actually has access to and performs, so ground your read and any recommendation in them (which movements carry a group's volume, which groups rest on a single exercise, which have been dropped) rather than proposing unfamiliar lifts or reasoning only from the aggregate figures. An exercise can appear under more than one group only if it was logged under both; each group's list is its own.

Write a short plain-text report with exactly these four sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only. Within a section, if you're naming more than one distinct point, put each one on its own line — never run multiple points together in one paragraph, with or without a bullet character.

Overview: one or two sentences on the overall picture — consistency and volume trend vs. the previous period.
Going well: what's on track — muscle groups being trained regularly, volume holding or increasing.
Needs attention: which muscle group(s) are most neglected (longest gap or lowest volume), any volume decline vs. the previous period, and any group resting on too few exercises.
Suggestions: 2-4 concrete, specific next steps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — prioritize the most neglected muscle group(s) for the next session, name actual exercises from their own breakdown, and give any desired amount as total reps rather than sets by reps or as minutes.

If an additional question from the user is included after the data, also answer it directly in a fifth section, "Answer: text".

Keep the whole report under 250 words.`;
