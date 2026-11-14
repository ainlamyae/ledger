// Duration and calorie burn behind Physique's 🧮 Calculate, for the Workout side.
// Reads the Activity Plan's note lines, one per row: "Nx Name" (total reps),
// "Nsec Name" (a hold), "Nmin Name" (a duration) or "Nstep Name" (steps).
// METs come from the Activity sheet (exerciseMet, health-activity-catalogue.js).

// Seconds per rep: a brisk lifting tempo. Override with WORKOUT_REP_SEC in
// Settings. Only time under tension counts; rest between sets is left out.
const WORKOUT_REP_SEC_DEFAULT = 3;

function workoutRepSec() {
  return getSetting('WORKOUT_REP_SEC', WORKOUT_REP_SEC_DEFAULT);
}

// One pattern per note-line shape. The gap is `\s+` so older two-space lines
// still parse; `×` is still read because older notes carry it. The legacy
// "3x10 Name" form is folded into the same total reps (30).
const REPS_NOTE_LINE_PATTERN = /^(\d+)[x×]\s+(.+)$/;
const LEGACY_SETS_REPS_NOTE_LINE_PATTERN = /^(\d+)[x×](\d+)\s+(.+)$/;
const DURATION_NOTE_LINE_PATTERN = /^(\d+)min\s+(.+)$/;
const STEPS_NOTE_LINE_PATTERN = /^(\d+)step\s+(.+)$/;
// Seconds, not minutes: a hold is usually well under a minute per set.
const HOLD_NOTE_LINE_PATTERN = /^(\d+)sec\s+(.+)$/;

// Tried in order; the first match wins.
const NOTE_LINE_PARSERS = [
  [REPS_NOTE_LINE_PATTERN, (m) => ({ type: 'reps', reps: Number(m[1]), name: m[2].trim() })],
  [LEGACY_SETS_REPS_NOTE_LINE_PATTERN, (m) => ({ type: 'reps', reps: Number(m[1]) * Number(m[2]), name: m[3].trim() })],
  [DURATION_NOTE_LINE_PATTERN, (m) => ({ type: 'duration', minutes: Number(m[1]), name: m[2].trim() })],
  [STEPS_NOTE_LINE_PATTERN, (m) => ({ type: 'steps', steps: Number(m[1]), name: m[2].trim() })],
  [HOLD_NOTE_LINE_PATTERN, (m) => ({ type: 'hold', seconds: Number(m[1]), name: m[2].trim() })],
];

// Lines matching no shape (blank, or an old day header) are skipped.
function parseWorkoutNoteLines(notes) {
  return notes
    .split('\n')
    .map((raw) => {
      const line = raw.trim();
      for (const [pattern, build] of NOTE_LINE_PARSERS) {
        const match = pattern.exec(line);
        if (match) return build(match);
      }
      return null;
    })
    .filter(Boolean);
}

// A parsed line's active seconds, net of rest. Shared by Log Workout's prefill
// and Calculate so they can't drift. Steps convert via toActivityMinutes (health-chart.js).
function activeSecondsForNoteLine(line) {
  if (line.type === 'reps') return line.reps * workoutRepSec();
  if (line.type === 'steps') return toActivityMinutes(line.steps, 'steps') * 60;
  if (line.type === 'hold') return line.seconds;
  return line.minutes * 60;
}

// Whole minutes, never below 1.
function roundedActivityMinutes(seconds) {
  return Math.max(1, Math.round(seconds / 60));
}

function workoutNoteMinutes(notes) {
  return roundedActivityMinutes(parseWorkoutNoteLines(notes).reduce((sum, line) => sum + activeSecondsForNoteLine(line), 0));
}

// The Activity sheet's Unit for a parsed note line's type.
const NOTE_LINE_TYPE_TO_UNIT = { reps: 'x', hold: 'sec', duration: 'min', steps: 'step' };

// The AI's catalogue row (aiEstimateActivities) for each name the sheet lacks,
// keyed by lower-cased name. Kept in this browser so a reopened day prices the
// same; saving the name to the sheet (💾) drops its guess.
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

function activityGuessKey(name) {
  return String(name || '').toLowerCase();
}

function activityGuess(name) {
  return activityGuesses.get(activityGuessKey(name)) ?? null;
}

function forgetActivityGuess(name) {
  if (activityGuesses.delete(activityGuessKey(name))) writeActivityGuesses();
}

// 🧮 Calculate's AI step: guesses a row for each name neither on the sheet nor
// guessed yet. Returns warnings and never throws; a failure leaves the default MET.
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

// Sums duration and burn over every line. Each line's MET is the sheet's, else
// the AI's guess, else EXERCISE_MET_FALLBACK.
function estimateWorkoutActivity(notes, bodyMassKg) {
  const lines = parseWorkoutNoteLines(notes);
  if (lines.length === 0) {
    throw new Error("Couldn't find any exercises in Notes — log via the Activity panel's Log button, or write one \"Nx  Exercise Name\" / \"Nsec  Exercise Name\" / \"Nmin  Activity Name\" / \"Nstep  Activity Name\" line per row.");
  }

  let totalSeconds = 0;
  let calories = 0;
  const unmatchedNames = [];
  // Per line too: the Physique form's table reads it, and a mixed day splits by category.
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
      // Where the MET came from: the sheet, an AI guess, or the default.
      source: inTable ? 'table' : (guess ? 'ai' : 'default'),
      guess,
      // The note's own token ("30x", "135sec").
      quantity: workoutNoteQuantityForLine(line),
      met,
      seconds: activeSeconds,
      calories: lineKcal,
    });
  });

  return {
    minutes: roundedActivityMinutes(totalSeconds),
    calories: Math.round(calories),
    unmatchedNames,
    perLine,
  };
}
