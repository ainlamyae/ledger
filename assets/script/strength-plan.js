// The Activity Plan panel's tables (Leg/Push/Pull strength days, plus the
// NEAT table below them) each tick off what was actually done, then hand a
// computed duration + workout lines straight to the Physique "Log a Day"
// modal (physique.js) — this module never writes to the sheet itself, it
// only pre-fills that modal's fields and lets the user review/edit before
// saving, same as any other manual entry.

// Duration comes from the note lines this module writes, priced by
// activeSecondsForNoteLine (activity-estimator.js) — including the per-rep
// tempo, which is a Settings value (WORKOUT_REP_SEC) rather than a constant here.

// Every plan row, keyed by its exercise name — the same key the Activities
// sheet and the standardized note lines use. Lets a note already on the sheet
// be traced back to its rows without any DOM tick state, which is what makes
// both the logged-today marks and the merge below work after a page reload.
function planRowsByName() {
  const map = new Map();
  document.querySelectorAll('.workout-day table tbody tr').forEach((tr) => {
    const box = tr.querySelector('.workout-check');
    if (box) map.set(tr.children[0].textContent.trim(), { day: tr.closest('table').dataset.day, box, tr });
  });
  return map;
}

// The separator in a "Sets x Reps" cell and in the note's own rep unit. A plain
// ASCII `x`, which is what the plan tables display and what the note is written
// with — but `×` is accepted everywhere it's READ, since the tables used to show
// it and notes already on the sheet still carry it.
const REPS_SEPARATOR_PATTERN = /\s*[x×]\s*/;

// A "Sets x Reps" cell as one total-rep figure: "3 x 10" -> 30. Returns null if
// the cell isn't two numbers around an x, which leaves the caller writing the
// cell's own text rather than a figure derived from a cell it didn't understand —
// activity-estimator.js still parses that older two-number form, so an
// unrecognized cell degrades to the previous behavior instead of a wrong number.
function totalRepsFromSetsCell(text) {
  const parts = text.trim().split(REPS_SEPARATOR_PATTERN).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts[0] * parts[1];
}

// A ticked row's quantity as the note writes it: a hold row's TOTAL held
// seconds, a strength row's TOTAL REPS ("30x"), a step count, or flat minutes.
// Never the "3 x 10" the cell displays — activity-estimator.js parses these
// lines back on Recalculate against a `<number><unit>` pattern, so a space
// before the unit would silently drop the exercise from the recalculated total,
// and the product saves the reader multiplying to compare one line to another.
//
// The reps figure is read off the DISPLAYED "Sets x Reps" cell. Both that cell
// and the checkbox's own attributes are now built from one Activities-sheet
// cell (activities.js), so they can't disagree the way they did while the plan
// was hand-written markup — 24 of 34 rows had, and since the duration math
// reads the ATTRIBUTES while this reads the TEXT, Log Workout and a later
// Recalculate differed by up to ~15% on the same exercise.
function workoutNoteQuantityForBox(box) {
  if (box.dataset.steps !== undefined) return `${box.dataset.steps}step`;
  if (box.dataset.minutes !== undefined) return `${box.dataset.minutes}min`;
  // An isometric HOLD row (Plank) is held rather than repped, so its total is
  // sets × seconds held and the per-rep tempo doesn't apply.
  if (box.dataset.hold !== undefined) return `${Number(box.dataset.sets) * Number(box.dataset.hold)}sec`;
  const cell = box.closest('tr').children[1].textContent;
  const totalReps = totalRepsFromSetsCell(cell);
  // An unrecognized cell writes its own text with the separator normalized to a
  // bare x — still a format activity-estimator.js reads back.
  return totalReps !== null ? `${totalReps}x` : cell.trim().replace(REPS_SEPARATOR_PATTERN, 'x');
}

// The same quantity string, recovered from a note line already on the sheet.
function workoutNoteQuantityForLine(line) {
  if (line.type === 'steps') return `${line.steps}step`;
  if (line.type === 'duration') return `${line.minutes}min`;
  if (line.type === 'hold') return `${line.seconds}sec`;
  return `${line.reps}x`;
}

// Today's Workout text, if any of it parses as plan lines — what the ticks are
// read from. A hand-typed workout the plan can't recognize reads as nothing
// logged, rather than being mistaken for banked work.
function todaysLoggedWorkoutText() {
  const day = todaysPhysiqueDay();
  return day && parseWorkoutNoteLines(day.workout).length > 0 ? day.workout : '';
}

// One combined button below every table (rather than one per table) since a real
// session often mixes strength exercises across Leg/Push/Pull days with a
// NEAT/Cardio activity.
//
// Rows already in today's log are ticked by renderWorkoutPlanProgress and skipped
// here — ticking is how the plan shows what's banked, so only the boxes ticked
// since the last save are new work. That's what lets a gym session be logged
// gradually: tick what's done, save, tick more, save again into the same row.
function logWorkout() {
  const logged = loggedWorkoutQuantities();
  const added = [...document.querySelectorAll('.workout-check:checked')]
    .map((box) => ({ name: box.closest('tr').children[0].textContent.trim(), box }))
    .filter(({ name }) => !logged.has(name))
    .map(({ name, box }) => `${workoutNoteQuantityForBox(box)} ${name}`);

  if (added.length === 0) {
    alert(logged.size
      ? "Everything ticked is already in today's workout — tick another exercise to add it."
      : 'Tick at least one exercise before logging a workout.');
    return;
  }

  // Today's Workout text is carried over verbatim and the new lines appended,
  // so any free text on the row survives being extended.
  const today = todaysPhysiqueDay();
  const workout = [today?.workout ?? '', ...added].filter((part) => part.trim()).join('\n');

  // Passing today's row puts the form in edit mode, so Save updates that day
  // rather than appending a second one — which the duplicate-date guard would
  // refuse anyway. Everything already logged for the day (meals, body mass) is
  // left exactly as it is; only the workout side changes.
  openPhysiqueForm(today);
  if (today) document.getElementById('physique-modal-title').textContent = "Add to Today's Workout";
  physiqueField('workout').value = workout;
  physiqueField('activity-duration').value = String(workoutNoteMinutes(workout));

  // Immediately run the workout half of Calculate so the form opens already
  // showing the real duration/burn pair instead of making the user click it
  // themselves. If it can't run (no body mass yet) the plain-minutes prefill
  // above stays and the reason is surfaced.
  const messages = runPhysiqueWorkoutCalc();
  if (messages.length) showFieldError('physique-form-error', messages.join(' '));
}

// Exercise name -> the quantity already logged for it today ("30x", "6000step"),
// read straight off today's Physique row so it survives a page reload.
function loggedWorkoutQuantities() {
  const byName = new Map();
  parseWorkoutNoteLines(todaysLoggedWorkoutText())
    .forEach((line) => byName.set(line.name, workoutNoteQuantityForLine(line)));
  return byName;
}

// Ticks every plan row that's already in today's log and labels it with the
// quantity — the visible answer to "did I do this today?", and the state
// logWorkout reads to tell banked work from newly ticked work. Called after
// every Physique refresh (physique.js), so a save re-marks the rows it just
// wrote and the marks clear by themselves at the date rollover.
function renderWorkoutPlanProgress() {
  const logged = loggedWorkoutQuantities();

  planRowsByName().forEach(({ box, tr }, name) => {
    const quantity = logged.get(name);
    const wasLogged = tr.classList.contains('workout-row-logged');
    tr.classList.toggle('workout-row-logged', quantity !== undefined);
    // Only a row that was marked gets unticked when it drops out of the log
    // (a rollover past midnight, or the entry being deleted) — anything the
    // user ticked but hasn't saved yet has to survive a background refresh.
    if (quantity !== undefined) box.checked = true;
    else if (wasLogged) box.checked = false;

    // The tint is what separates a banked row from one the user just ticked —
    // both are checked, so the checkbox alone can't say which is which.
    box.title = quantity !== undefined ? `Already logged today: ${quantity}` : '';
  });

  // Short either way — the heading line holds three buttons, and a phone runs out of
  // room long before "Add to Today's Workout" fits. "Log More", not "Add": the panel's
  // other button is already Add (a catalogue row), and these two do different things.
  const logBtn = document.getElementById('log-workout-btn');
  logBtn.textContent = logged.size ? 'Log More' : 'Log';
  logBtn.title = logged.size
    ? "Add the newly ticked activities to today's workout"
    : "Log the ticked activities as today's workout";
}

function initWorkoutPlan() {
  document.getElementById('log-workout-btn').addEventListener('click', logWorkout);

  // A sibling of the <h2>, not a child of it — the h2 is the collapse toggle, so
  // a button inside it would close the panel on the way to opening the modal.
  const instructionModal = document.getElementById('activity-instruction-modal');
  document.getElementById('activity-instruction-btn').addEventListener('click', () => {
    instructionModal.hidden = false;
  });
  document.getElementById('activity-instruction-close-btn').addEventListener('click', () => {
    instructionModal.hidden = true;
  });
}
