// Duration + calorie-burn estimation behind Physique's 🧮 Calculate, for the
// Workout side — the Activity counterpart to
// calorie-estimator.js. Understands the Activity Plan's standardized workout
// note (see strength-plan.js's logWorkout): one line per ticked row —
// "Nx  Exercise Name" (total reps) for a strength row, "Nsec  Exercise Name" for an
// isometric hold (Plank), "Nmin  Activity Name" for a fixed-duration row
// (Swim), or "Nstep  Activity Name" for a step-count row (Walk). Wired up by physique.js, and called
// directly by strength-plan.js's logWorkout() right after it fills the
// Workout field in.

// MET values and the default for an unlisted name now live on the Activities
// sheet tab (activities.js) — activityMet() reads them, so adding an exercise
// there prices it without a code change.

// Matches one standardized workout note line — a strength row ("30x Leg
// Press"), an isometric hold ("135sec Plank"), a fixed-duration NEAT row
// ("30min Swim"), or a step-count row ("6000step Walk"). Any line matching none of these (e.g. a blank line,
// or a leftover day-header line from an older-format saved entry) is skipped.
// The gap is `\s+`, so entries saved back when Log Workout emitted two spaces
// still parse identically to the single-spaced ones it writes now.
//
// Strength rows carry TOTAL REPS with x as the unit ("30x"), in the same
// <number><unit> shape as the other three. Both `x` and `×` are accepted, since
// Log Workout wrote the `×` form before the plan tables switched to a plain
// ASCII x — a note already on the sheet has to keep parsing, or Recalculate
// would silently drop every strength line from an older entry. The two-number
// "3x10" form Log Workout wrote earlier still matches too, normalized to the same
// total-rep figure (3 × 10 = 30) rather than kept as a separate shape, so nothing
// downstream has to handle two strength forms. None of the three can be confused:
// the total-rep form has whitespace after the x, the two-number one has a digit.
const REPS_NOTE_LINE_PATTERN = /^(\d+)[x×]\s+(.+)$/;
const LEGACY_SETS_REPS_NOTE_LINE_PATTERN = /^(\d+)[x×](\d+)\s+(.+)$/;
const DURATION_NOTE_LINE_PATTERN = /^(\d+)min\s+(.+)$/;
const STEPS_NOTE_LINE_PATTERN = /^(\d+)step\s+(.+)$/;
// An isometric hold row's total held seconds ("135sec Plank") — seconds
// rather than minutes because a hold is typically well under a minute per set,
// and rounding 3 × 45 sec to whole minutes would lose most of the precision.
// Distinct prefix from "step"/"min" so the three can't be confused.
const HOLD_NOTE_LINE_PATTERN = /^(\d+)sec\s+(.+)$/;

function parseWorkoutNoteLines(notes) {
  return notes
    .split('\n')
    .map((raw) => {
      const line = raw.trim();
      const repsMatch = REPS_NOTE_LINE_PATTERN.exec(line);
      if (repsMatch) {
        return { type: 'reps', reps: Number(repsMatch[1]), name: repsMatch[2].trim() };
      }
      const legacyMatch = LEGACY_SETS_REPS_NOTE_LINE_PATTERN.exec(line);
      if (legacyMatch) {
        return { type: 'reps', reps: Number(legacyMatch[1]) * Number(legacyMatch[2]), name: legacyMatch[3].trim() };
      }
      const durationMatch = DURATION_NOTE_LINE_PATTERN.exec(line);
      if (durationMatch) {
        return { type: 'duration', minutes: Number(durationMatch[1]), name: durationMatch[2].trim() };
      }
      const stepsMatch = STEPS_NOTE_LINE_PATTERN.exec(line);
      if (stepsMatch) {
        return { type: 'steps', steps: Number(stepsMatch[1]), name: stepsMatch[2].trim() };
      }
      const holdMatch = HOLD_NOTE_LINE_PATTERN.exec(line);
      if (holdMatch) {
        return { type: 'hold', seconds: Number(holdMatch[1]), name: holdMatch[2].trim() };
      }
      return null;
    })
    .filter(Boolean);
}

// A parsed line's active seconds, net of rest — the one place the plan's
// duration math lives, read by both Log Workout's prefill and Calculate so the
// two can't drift apart on the same exercises. Steps convert via the same
// steps↔minutes ratio the Activity chart uses (toActivityMinutes, charts.js).
function activeSecondsForNoteLine(line) {
  if (line.type === 'reps') return line.reps * WORKOUT_REP_SEC;
  if (line.type === 'steps') return toActivityMinutes(line.steps, 'steps') * 60;
  // Already the total active time — the note carries seconds directly.
  if (line.type === 'hold') return line.seconds;
  return line.minutes * 60;
}

function workoutNoteMinutes(notes) {
  const seconds = parseWorkoutNoteLines(notes).reduce((sum, line) => sum + activeSecondsForNoteLine(line), 0);
  return Math.max(1, Math.round(seconds / 60));
}

// Sums duration and calorie burn across every parsed line. Each line's own MET
// is applied only to its own active seconds.
function estimateWorkoutActivity(notes, weightKg) {
  const lines = parseWorkoutNoteLines(notes);
  if (lines.length === 0) {
    throw new Error("Couldn't find any exercises in Notes — log via the Activity Plan's Log a Workout button, or write one \"Nx  Exercise Name\" / \"Nsec  Exercise Name\" / \"Nmin  Activity Name\" / \"Nstep  Activity Name\" line per row.");
  }

  let totalSeconds = 0;
  let calories = 0;
  const unmatchedNames = [];
  // Per line as well as the totals, so a day mixing categories can be
  // apportioned across them (physique.js's activity split) rather than being
  // labelled with whichever one happened to win.
  const perLine = [];

  lines.forEach((line) => {
    if (!activityByName(line.name)) unmatchedNames.push(line.name);
    const met = exerciseMet(line.name);
    const activeSeconds = activeSecondsForNoteLine(line);
    const lineKcal = metKcal(met, weightKg, activeSeconds / 60);

    totalSeconds += activeSeconds;
    calories += lineKcal;
    perLine.push({
      name: line.name,
      category: activityCategory(line.name),
      seconds: activeSeconds,
      calories: lineKcal,
    });
  });

  return {
    minutes: Math.max(1, Math.round(totalSeconds / 60)),
    calories: Math.round(calories),
    unmatchedNames,
    perLine,
  };
}

// Latest logged body mass (kg), read off the Physique tab — same lookup
// insight.js's currentWeightKg uses. Null if none has ever been logged.
function getLatestWeightKg() {
  const weightEntries = physiqueAsWellnessEntries()
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return weightEntries.length ? weightEntries[weightEntries.length - 1].amount : null;
}
