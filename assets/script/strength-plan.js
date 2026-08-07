// The Activity Plan panel's tables (Leg/Push/Pull strength days, plus the
// NEAT table below them) each tick off what was actually done, then hand a
// computed duration + notes straight to the existing Health Log "Log Entry"
// modal (wellness.js) — this module never writes to the sheet itself, it
// only pre-fills that modal's fields and lets the user review/edit before
// saving, same as any other manual entry.

// Seconds per rep at a controlled lifting tempo for a strength row — a rough
// estimate the user can freely overwrite in the modal's Amount field before
// saving. Only time actually under tension counts toward duration/calories
// (activeSecondsForNoteLine, activity-estimator.js, times the note lines this
// module writes) — rest between sets, warm-up, and moving between machines are
// real gym-visit time but aren't activity, so they're deliberately left out
// rather than inflating the logged number.
const WORKOUT_REP_SEC = 3;

// Bodyweight Day counts as strength: crunches, planks and push-ups are
// resistance work against body weight, not NEAT or cardio, so a session that
// includes them should still describe itself as "Strength Training".
const STRENGTH_DAY_NAMES = new Set(['Leg Day', 'Push Day', 'Pull Day', 'Dumbbell Day', 'Bodyweight Day']);

// Every plan row, keyed by its exercise name — the same key EXERCISE_MET and
// the standardized note lines use, and unique across all 37 rows. Lets a note
// already on the sheet be traced back to its rows without any DOM tick state,
// which is what makes both the logged-today marks and the merge below work
// after a page reload.
function planRowsByName() {
  const map = new Map();
  document.querySelectorAll('.workout-day table tbody tr').forEach((tr) => {
    const box = tr.querySelector('.workout-check');
    if (box) map.set(tr.children[0].textContent.trim(), { day: tr.closest('table').dataset.day, box, tr });
  });
  return map;
}

// Description is "Strength Training" whenever any strength exercise is in the
// session (even alongside a NEAT/Cardio activity — it's the dominant, longer
// part of most mixed sessions). A strength-free session instead names the
// table(s) it came from — "NEAT" or "Cardio" (or "NEAT + Cardio" if both) — not
// the specific activity within them, since the table name is the stable
// category. Derived from the exercise NAMES rather than the ticked boxes, so a
// session extended later re-describes itself against everything in it, not just
// the rows ticked this time.
function describeExerciseNames(names) {
  const byName = planRowsByName();
  const days = new Set(names.map((name) => byName.get(name)?.day).filter(Boolean));
  if ([...days].some((day) => STRENGTH_DAY_NAMES.has(day))) return 'Strength Training';
  const tableDays = [...document.querySelectorAll('.workout-day table')].map((t) => t.dataset.day);
  return tableDays.filter((day, i) => days.has(day) && tableDays.indexOf(day) === i).join(' + ');
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
// The reps figure is read off the DISPLAYED "Sets x Reps" cell, which makes the
// visible plan the authority — so every strength row's data-sets/data-reps must
// match what its own cell shows. They didn't for 22 of the original 24 rows,
// and since the duration math reads the ATTRIBUTES while this reads the TEXT,
// Log Workout and a later Recalculate disagreed by ~6% on the same exercises.
// Keep any new row's attributes and display in step.
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

// Today's plan-written Activity entry, if there is one — what a second Log a
// Workout extends instead of opening a fresh row. Only a row whose Notes
// actually parse as plan lines qualifies, so a hand-typed Activity entry is
// never silently rewritten. Latest one wins if somehow there are several.
function todaysPlanWorkoutEntry() {
  const today = isoFromDate(new Date());
  return getDatedWellnessEntries()
    .filter((e) => e.date === today
      && (e.category === 'Activity' || e.category === 'Activity; Calories')
      && parseWorkoutNoteLines(e.notes).length > 0)
    .sort((a, b) => a.time.localeCompare(b.time) || a.row - b.row)
    .pop() ?? null;
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

  // Today's note is carried over verbatim and the new lines appended, so any
  // free text on the row survives being extended.
  const existing = todaysPlanWorkoutEntry();
  const notes = [existing?.notes ?? '', ...added].filter((part) => part.trim()).join('\n');
  const names = parseWorkoutNoteLines(notes).map((line) => line.name);

  // Passing the existing entry puts the modal in edit mode, so Save updates
  // today's row rather than appending a second one. Its own date/time are kept
  // as the session's start; the note and amount below are what change.
  openWellnessForm(existing);
  if (existing) document.getElementById('wellness-modal-title').textContent = "Add to Today's Workout";
  document.getElementById('wellness-category').value = 'Activity';
  onCategoryChange();
  document.getElementById('wellness-description').value = describeExerciseNames(names);
  document.getElementById('wellness-unit').value = 'min';
  document.getElementById('wellness-amount').value = String(workoutNoteMinutes(notes));
  document.getElementById('wellness-notes').value = notes;

  // Immediately run the same Activity Calculate the 🧮 button triggers
  // (activity-estimator.js) so the modal opens already showing the real
  // duration/calorie-burn pair instead of making the user click Calculate
  // themselves right after Log Workout filled the note in. If it can't run
  // (e.g. no Weight logged yet) it leaves the plain-minutes prefill above in
  // place and surfaces its own error explaining why.
  calculateWellnessActivity();
}

// Exercise name -> the quantity already logged for it today ("30x", "6000step"),
// read straight off today's entry so it survives a page reload.
function loggedWorkoutQuantities() {
  const entry = todaysPlanWorkoutEntry();
  const byName = new Map();
  if (!entry) return byName;
  parseWorkoutNoteLines(entry.notes).forEach((line) => byName.set(line.name, workoutNoteQuantityForLine(line)));
  return byName;
}

// Ticks every plan row that's already in today's log and labels it with the
// quantity — the visible answer to "did I do this today?", and the state
// logWorkout reads to tell banked work from newly ticked work. Called after
// every wellness refresh (wellness.js), so a save re-marks the rows it just
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

  document.getElementById('log-workout-btn').textContent =
    logged.size ? "Add to Today's Workout" : 'Log a Workout';
}

// The Instruction modal's figures are committed under assets/images/activities,
// one per exercise. Both fetch scripts derive their filenames the same way, so
// this slug has to match theirs — it's the only thing tying a plan row to its
// picture, and a row whose name is edited here loses its figure until the file
// is renamed to suit.
function activitySlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Deferred to the first open of the modal: the figures are nothing the dashboard
// needs until it's asked for, and lazy loading keeps the ones below the fold off
// the wire entirely.
let activityFiguresDrawn = false;

// Movements that have an animated loop rather than a still guide. Kept as an
// explicit list so the page never probes for a file that isn't there: guessing
// would cost a 404 on every still. scripts/fetch_activity_animations.mjs prints
// this list when it runs, and the two have to agree.
const ACTIVITY_ANIMATIONS = new Set([
  'leg-press', 'leg-extension-quads', 'leg-curl-hamstrings', 'hip-abduction-machine',
  'chest-press-machine', 'shoulder-press-machine', 'pec-deck-chest-fly-machine',
  'cable-tricep-pushdown', 'lat-pulldown', 'seated-row-machine',
  'left-lateral-raise-machine-or-cable', 'dumbbell-goblet-squat', 'dumbbell-bench-press', 'dumbbell-lateral-raise', 'leg-raise',
  'rear-delt-fly-machine-or-cable', 'cable-bicep-curl',
  'dumbbell-bicep-curl', 'bird-dog-both-sides', 'push-up',
  'hip-adduction-machine', 'calf-raise-machine', 'dumbbell-row',
]);

function renderActivityFigures() {
  if (activityFiguresDrawn) return;
  activityFiguresDrawn = true;

  document.querySelectorAll('.instruction-activities li').forEach((li) => {
    const name = li.textContent.trim();
    const slug = activitySlug(name);
    // An animated movement is a .gif and a still one a .jpg — nothing else about
    // them differs, since a browser loops a GIF in a plain <img> on its own.
    const animated = ACTIVITY_ANIMATIONS.has(slug);

    const figure = document.createElement('img');
    figure.className = 'instruction-figure';
    figure.src = `assets/images/activities/${slug}.${animated ? 'gif' : 'jpg'}`;
    figure.alt = animated ? `${name}, animated` : `${name}, start and finish positions`;
    figure.loading = 'lazy';
    // A name in the plan with no figure filed under its slug leaves the label
    // standing on its own, rather than a broken-image icon.
    figure.addEventListener('error', () => figure.remove(), { once: true });

    const label = document.createElement('span');
    label.className = 'instruction-activity-name';
    label.textContent = name;

    li.textContent = '';
    li.append(figure, label);
  });
}

function initWorkoutPlan() {
  document.getElementById('log-workout-btn').addEventListener('click', logWorkout);

  // A sibling of the <h2>, not a child of it — the h2 is the collapse toggle, so
  // a button inside it would close the panel on the way to opening the modal.
  const instructionModal = document.getElementById('activity-instruction-modal');
  document.getElementById('activity-instruction-btn').addEventListener('click', () => {
    renderActivityFigures();
    instructionModal.hidden = false;
  });
  document.getElementById('activity-instruction-close-btn').addEventListener('click', () => {
    instructionModal.hidden = true;
  });
}
