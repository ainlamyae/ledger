// Duration + calorie-burn estimation for the Health Log's 🧮 Calculate button
// when the current category is Activity — the Activity counterpart to
// calorie-estimator.js. Understands the Activity Plan's standardized workout
// note (see strength-plan.js's logWorkout): one line per ticked row —
// "Nx  Exercise Name" (total reps) for a strength row, "Nsec  Exercise Name" for an
// isometric hold (Plank), "Nmin  Activity Name" for a fixed-duration row
// (Swim), or "Nstep  Activity Name" for a step-count row (Walk). Wired up by wellness.js — see its calc-btn click dispatcher in
// initWellness() — and called directly by strength-plan.js's logWorkout()
// right after it fills the note in.

// Calories come from charts.js's metKcal(). Applied only to ACTIVE time — rest
// between sets, warm-up and walking between machines aren't activity, so they
// aren't charged a MET.
//
// Strength rows: two sourced MET values, not a fabricated per-machine number
// for each. 5.0 (code 02052, compound/explosive-effort resistance work) for
// multi-joint, large-muscle-group presses/pulls; 3.5 (code 02054, "multiple
// exercises, 8-15 reps, varied resistance" — the Compendium's own
// general/default resistance-training value) for single-joint isolation
// machines.
//
// NEAT rows: 6.0 for Swim ("swimming, leisurely, general" — general
// recreational effort) and 3.0 for Walk ("walking, 2.5 mph, level, firm
// surface" — a leisurely pace, not the 3.5 "moderate 3 mph" value used
// initially, which overshot: cross-checked against an external reference of
// ~45 kcal for 1000 leisurely-paced steps at 89 kg, MET 3.0 combined with the
// app's existing 100 steps/min pace assumption (toActivityMinutes, charts.js)
// lands at ~44.5 kcal — MET 3.5 would have overshot to ~52).
//
// Cardio rows: 7.0 for Running (code 12020, "running, jog, general" — a
// moderate recreational jogging pace, same leisurely-effort framing as Swim/
// Walk above rather than a competitive-pace running value).
//
// Keyed by the exact name text as it appears in the Activity Plan tables
// (index.html), so a name typo/mismatch is caught explicitly (falls back to
// EXERCISE_MET_DEFAULT with a surfaced warning) rather than silently
// mis-costed.
const EXERCISE_MET = {
  'Leg Press': 5.0,
  'Chest Press machine': 5.0,
  'Shoulder Press machine': 5.0,
  'Lat Pulldown': 5.0,
  'Seated Row machine': 5.0,
  'Leg Extension (quads)': 3.5,
  'Leg Curl (hamstrings)': 3.5,
  'Hip Abduction machine': 3.5,
  'Hip Adduction machine': 3.5,
  'Calf Raise machine': 3.5,
  'Pec Deck / Chest Fly machine': 3.5,
  'Left Lateral Raise machine (or cable)': 3.5,
  'Right Lateral Raise machine (or cable)': 3.5,
  'Cable Tricep Pushdown': 3.5,
  'Rear Delt Fly machine (or cable)': 3.5,
  'Cable Bicep Curl': 3.5,
  'Dumbbell Goblet Squat': 5.0,
  'Dumbbell Bench Press': 5.0,
  'Dumbbell Row': 5.0,
  'Dumbbell Shoulder Press': 5.0,
  'Dumbbell Romanian Deadlift': 5.0,
  'Dumbbell Lateral Raise': 3.5,
  'Dumbbell Bicep Curl': 3.5,
  'Dumbbell Tricep Extension': 3.5,
  // Day 5, bodyweight/no-equipment. Deliberately reusing the same two sourced
  // values as the machine/dumbbell rows above rather than introducing new
  // per-exercise numbers: multi-joint, large-muscle-group movements get the
  // 5.0 compound value, and core/isolation work plus the isometric holds get
  // the 3.5 general resistance-training value. A plank has no distinct
  // Compendium entry of its own, and 3.5 (its general resistance-training
  // value, also this table's default) is the closest sourced figure — better
  // than inventing a plank-specific MET.
  'Push-up': 5.0,
  'Bodyweight Squat': 5.0,
  'Mountain Climber': 5.0,
  Crunch: 3.5,
  Plank: 3.5,
  'Side Plank (both sides)': 3.5,
  'Leg Raise': 3.5,
  'Glute Bridge': 3.5,
  'Bird Dog (both sides)': 3.5,
  Superman: 3.5,
  Swim: 6.0,
  Walk: 3.0,
  Running: 7.0,
};
// Compendium 02054 general value — used for any name not in the table above
// (a hand-typed or future-added one) so a miss still gets a reasonable
// estimate instead of blocking Calculate entirely.
const EXERCISE_MET_DEFAULT = 3.5;

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

  lines.forEach((line) => {
    if (!(line.name in EXERCISE_MET)) unmatchedNames.push(line.name);
    const met = EXERCISE_MET[line.name] ?? EXERCISE_MET_DEFAULT;
    const activeSeconds = activeSecondsForNoteLine(line);

    totalSeconds += activeSeconds;
    calories += metKcal(met, weightKg, activeSeconds / 60);
  });

  return {
    minutes: Math.max(1, Math.round(totalSeconds / 60)),
    calories: Math.round(calories),
    unmatchedNames,
  };
}

// Latest logged Weight entry's amount (kg) — same lookup insight.js's
// currentWeightKg uses. Null if no Weight has ever been logged.
function getLatestWeightKg() {
  const weightEntries = getDatedWellnessEntries()
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return weightEntries.length ? weightEntries[weightEntries.length - 1].amount : null;
}

function calculateWellnessActivity() {
  const notes = document.getElementById('wellness-notes').value.trim();
  const btn = document.getElementById('wellness-calc-btn');

  if (!notes) {
    showFieldError('wellness-form-error', 'Type or log a workout in Notes first.');
    return;
  }

  // A click that races the page's initial data fetch (e.g. clicking Log
  // Workout right after opening the app) would otherwise see an empty
  // allWellnessEntries and wrongly report "no weight logged" even for
  // someone who logs it every day — wellnessDataLoaded (wellness.js) tells
  // that apart from an honest, fully-loaded miss.
  if (!wellnessDataLoaded) {
    showFieldError('wellness-form-error', 'Still loading your data — try again in a moment.');
    return;
  }

  const weightKg = getLatestWeightKg();
  if (weightKg === null) {
    showFieldError('wellness-form-error', 'Log your body mass first (Health Log → Body Mass) — the calorie formula needs it.');
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Calculating…';
  clearFieldError('wellness-form-error');

  try {
    const { minutes, calories, unmatchedNames } = estimateWorkoutActivity(notes, weightKg);

    const description = document.getElementById('wellness-description').value;
    document.getElementById('wellness-category').value = 'Activity; Calories';
    onCategoryChange();
    document.getElementById('wellness-description').value = description;
    document.getElementById('wellness-amount').value = `${minutes}; ${calories}`;
    document.getElementById('wellness-unit').value = 'min; kcal';

    if (unmatchedNames.length) {
      showFieldError('wellness-form-error', `⚠️ Couldn't find ${unmatchedNames.map((n) => `"${n}"`).join(', ')} in the Activity Plan — used a default MET for it.`);
    }
  } catch (err) {
    showFieldError('wellness-form-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}
