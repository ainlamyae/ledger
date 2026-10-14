// Duration + calorie-burn estimation behind Physique's 🧮 Calculate, for the
// Workout side — the Activity counterpart to
// health-physique-estimator.js. Understands the Activity Plan's standardized workout
// note (see health-activity.js's logWorkout): one line per ticked row —
// "Nx  Exercise Name" (total reps) for a strength row, "Nsec  Exercise Name" for an
// isometric hold (Plank), "Nmin  Activity Name" for a fixed-duration row
// (Swim), or "Nstep  Activity Name" for a step-count row (Walk). Wired up by health-physique.js, and called
// directly by health-activity.js's logWorkout() right after it fills the
// Workout field in.

// MET values and the default for an unlisted name now live on the Activities
// sheet tab (health-activity-catalogue.js) — activityMet() reads them, so adding an exercise
// there prices it without a code change.

// How long each note-line unit actually takes. Only the two units that need
// converting are tunable — seconds per rep here, steps per minute via
// WORKOUT_STEPS_PER_MIN (toActivityMinutes, health-chart.js). A "135sec" hold and a
// "30min" swim already carry their own time, so there's nothing to set on those.
//
// Seconds per rep is a lifting tempo, and 3 s is a brisk one — a machine rep
// taken under control is closer to 4-5 s, which on a 200-rep session is the
// difference between 10 and 17 minutes. Set WORKOUT_REP_SEC on the Settings tab
// to your own tempo.
//
// Only time actually under tension counts, at whatever tempo is set: rest
// between sets, warm-up and moving between machines are real gym-visit time but
// aren't activity, so they stay out rather than inflating the logged number.
const WORKOUT_REP_SEC_DEFAULT = 3;

function workoutRepSec() {
  return getSetting('WORKOUT_REP_SEC', WORKOUT_REP_SEC_DEFAULT);
}

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
// steps↔minutes ratio the Activity chart uses (toActivityMinutes, health-chart.js),
// which reads WORKOUT_STEPS_PER_MIN.
function activeSecondsForNoteLine(line) {
  if (line.type === 'reps') return line.reps * workoutRepSec();
  if (line.type === 'steps') return toActivityMinutes(line.steps, 'steps') * 60;
  // Already the total active time — the note carries seconds directly.
  if (line.type === 'hold') return line.seconds;
  return line.minutes * 60;
}

function workoutNoteMinutes(notes) {
  const seconds = parseWorkoutNoteLines(notes).reduce((sum, line) => sum + activeSecondsForNoteLine(line), 0);
  return Math.max(1, Math.round(seconds / 60));
}

// The Activity sheet's Unit for a parsed note line's type.
const NOTE_LINE_TYPE_TO_UNIT = { reps: 'x', hold: 'sec', duration: 'min', steps: 'step' };

// The AI's catalogue row for each exercise name the Activity sheet doesn't list
// (ai.js's aiEstimateActivities), keyed by lower-cased name. Kept in this
// browser, so a day priced with one still prices the same when it's reopened —
// opening a day reprices its Workout, and without the guess a new name would
// drop back to EXERCISE_MET_FALLBACK. A name saved to the sheet (💾) reads from
// there instead, so its guess is dropped.
const ACTIVITY_GUESSES_KEY = 'ledger_activity_guesses';

function readActivityGuesses() {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(ACTIVITY_GUESSES_KEY) || '{}')));
  } catch {
    return new Map();
  }
}

const activityGuesses = readActivityGuesses();

function writeActivityGuesses() {
  try {
    localStorage.setItem(ACTIVITY_GUESSES_KEY, JSON.stringify(Object.fromEntries(activityGuesses)));
  } catch {}
}

function activityGuess(name) {
  return activityGuesses.get(String(name || '').toLowerCase()) ?? null;
}

function forgetActivityGuess(name) {
  if (activityGuesses.delete(String(name || '').toLowerCase())) writeActivityGuesses();
}

// 🧮 Calculate's AI step for the Workout: asks for a catalogue row for each name
// in `notes` that's neither on the Activity sheet nor already guessed. Returns
// warnings for the form's message line, never throws — a failed call just leaves
// those lines at the default MET, as before.
async function guessUnknownActivities(notes) {
  const seen = new Set();
  const unknown = parseWorkoutNoteLines(notes).filter((line) => {
    const key = line.name.toLowerCase();
    if (seen.has(key) || activityByName(line.name) || activityGuess(line.name)) return false;
    seen.add(key);
    return true;
  });
  if (!unknown.length) return [];

  const distinct = (key) => [...new Set(allActivities.map((a) => a[key]).filter(Boolean))];
  try {
    const guesses = await aiEstimateActivities(
      unknown.map((line) => ({ name: line.name, unit: NOTE_LINE_TYPE_TO_UNIT[line.type] })),
      { categories: distinct('category'), groups: distinct('group'), muscleGroups: distinct('muscleGroup') },
    );
    unknown.forEach((line) => {
      const guess = guesses.find((g) => g.name.toLowerCase() === line.name.toLowerCase());
      if (guess) activityGuesses.set(line.name.toLowerCase(), { ...guess, name: line.name, unit: NOTE_LINE_TYPE_TO_UNIT[line.type] });
    });
    writeActivityGuesses();
    return [];
  } catch (err) {
    return [`⚠️ Workout AI: ${err.message}`];
  }
}

// Sums duration and calorie burn across every parsed line. Each line's own MET
// is applied only to its own active seconds: the Activity sheet's, else the AI's
// guess (guessUnknownActivities), else EXERCISE_MET_FALLBACK.
function estimateWorkoutActivity(notes, bodyMassKg) {
  const lines = parseWorkoutNoteLines(notes);
  if (lines.length === 0) {
    throw new Error("Couldn't find any exercises in Notes — log via the Activity panel's Log button, or write one \"Nx  Exercise Name\" / \"Nsec  Exercise Name\" / \"Nmin  Activity Name\" / \"Nstep  Activity Name\" line per row.");
  }

  let totalSeconds = 0;
  let calories = 0;
  const unmatchedNames = [];
  // Per line as well as the totals: this is what the Physique form's activity
  // table shows (health-physique.js's renderPhysiqueActivityBreakdown), and it's the
  // grain a day mixing categories has to be read at — a mixed day apportioned
  // across its categories rather than labelled with whichever one won.
  const perLine = [];

  lines.forEach((line) => {
    const inTable = Boolean(activityByName(line.name));
    const guess = inTable ? null : activityGuess(line.name);
    if (!inTable && !guess) unmatchedNames.push(line.name);
    const met = guess ? guess.met : exerciseMet(line.name);
    const activeSeconds = activeSecondsForNoteLine(line);
    const lineKcal = metKcal(met, bodyMassKg, activeSeconds / 60);

    totalSeconds += activeSeconds;
    calories += lineKcal;
    perLine.push({
      name: line.name,
      category: guess?.category || activityCategory(line.name),
      // Where the MET came from, for the table's last column: ✅ for the
      // Activity sheet, AI (with 💾 and ✏️) for a guess, Default otherwise.
      source: inTable ? 'table' : (guess ? 'ai' : 'default'),
      guess,
      // The note's own quantity token ("30x", "135sec"), so a table row can be
      // matched back to the Workout line it was priced from at a glance.
      quantity: workoutNoteQuantityForLine(line),
      met,
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
