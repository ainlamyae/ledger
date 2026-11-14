// The Activity Plan: tick what was done, then hand the note lines and a duration
// to the Physique form (health-physique.js) for review, or save them straight to
// today's row (Workouts' 📝). Durations come from activeSecondsForNoteLine
// (health-activity-estimator.js).

// A plan row's exercise name, the key the sheet and the note lines share.
function planRowName(tr) {
  return tr.querySelector('.workout-name-cell').textContent.trim();
}

// Every plan row by name, so today's note can be traced back to its rows after a reload.
function planRowsByName() {
  const map = new Map();
  document.querySelectorAll('.workout-day table tbody tr').forEach((tr) => {
    const box = tr.querySelector('.workout-check');
    if (box) map.set(planRowName(tr), { box, tr });
  });
  return map;
}

// The x in "Sets x Reps" and in the note's rep unit. `×` is still read, since
// older notes carry it.
const REPS_SEPARATOR_PATTERN = /\s*[x×]\s*/;

// "3 x 10" -> 30, or null if the cell isn't two numbers around an x.
function totalRepsFromSetsCell(text) {
  const parts = text.trim().split(REPS_SEPARATOR_PATTERN).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts[0] * parts[1];
}

// A ticked row's note quantity: total held seconds, total reps ("30x"), steps
// or minutes. No space before the unit, or the estimator won't parse it back.
// Reps come from the displayed cell, which shares its sheet cell with the box's data.
function workoutNoteQuantityForBox(box) {
  if (box.dataset.steps !== undefined) return `${box.dataset.steps}step`;
  if (box.dataset.minutes !== undefined) return `${box.dataset.minutes}min`;
  // A hold is held, not repped, so the per-rep tempo doesn't apply.
  if (box.dataset.hold !== undefined) return `${Number(box.dataset.sets) * Number(box.dataset.hold)}sec`;
  // By class: the column's position moves with the table's optional columns.
  const cell = box.closest('tr').querySelector('.workout-quantity-cell').textContent;
  const totalReps = totalRepsFromSetsCell(cell);
  // An unrecognized cell is written as typed, with a bare x.
  return totalReps !== null ? `${totalReps}x` : cell.trim().replace(REPS_SEPARATOR_PATTERN, 'x');
}

// The same quantity string, recovered from a note line already on the sheet.
function workoutNoteQuantityForLine(line) {
  if (line.type === 'steps') return `${line.steps}step`;
  if (line.type === 'duration') return `${line.minutes}min`;
  if (line.type === 'hold') return `${line.seconds}sec`;
  return `${line.reps}x`;
}

// Today's Workout text if any of it parses as plan lines; free text reads as nothing logged.
function todaysLoggedWorkoutText() {
  const day = todaysPhysiqueDay();
  return day && parseWorkoutNoteLines(day.workout).length > 0 ? day.workout : '';
}

// The day's Workout text with `lines` appended, blank parts dropped.
function appendWorkoutLines(workout, lines) {
  return [workout ?? '', ...lines].filter((part) => part.trim()).join('\n');
}

// Combines and prices `workoutText` onto `day`, highest burn first, the way
// bulk Calculate does.
function repriceWorkoutDay(day, workoutText, bodyMassKg) {
  const { text } = combineWorkoutText(workoutText);
  const { minutes, calories, perLine } = estimateWorkoutActivity(text, bodyMassKg);
  day.workout = [...perLine].sort((a, b) => b.calories - a.calories)
    .map((line) => `${line.quantity} ${line.name}`).join('\n');
  day.duration = minutes;
  day.caloriesOut = calories;
}

// Appends note lines to today's Workout and opens the Physique form on today
// (edit mode, so Save updates the day), pre-running Calculate. Shared by
// logWorkout and the Activity form's own Log button.
function applyWorkoutLines(lines) {
  const today = todaysPhysiqueDay();
  const workout = appendWorkoutLines(today?.workout, lines);

  routeRecordEdit('physique', todayPhysiqueRouteStep());
  openPhysiqueForm(today);
  if (today) setPhysiqueFormHint("Add to Today's Workout");
  physiqueField('workout').value = workout;
  physiqueField('activity-duration').value = String(workoutNoteMinutes(workout));

  // If Calculate can't run (no body mass yet), the plain-minutes prefill stays.
  const messages = runPhysiqueWorkoutCalc();
  if (messages.length) showToast(messages.join(' '));
}

// Workouts' 📝: the same appended lines, priced and saved straight to today's
// row. Undo writes the day back (or empties a row this created).
async function quickLogWorkoutLines(lines) {
  const today = todaysPhysiqueDay();
  const day = today
    ? physiqueDayCopy(today)
    : { cells: [], ...Object.fromEntries(PHYSIQUE_FIELDS.map(({ key, numeric }) => [key, numeric ? null : ''])),
      date: isoFromDate(new Date()) };
  const workout = appendWorkoutLines(day.workout, lines);

  const bodyMassKg = day.bodyMass ?? physiqueBodyMassKgFromLog();
  if (bodyMassKg === null) throw new Error('Log a body mass first: the burn is priced from it.');
  repriceWorkoutDay(day, workout, bodyMassKg);

  if (today) await writePhysiqueRow(today.row, day);
  else await appendPhysiqueRow(day);
  await refreshPhysique(true);

  const before = today ?? { ...day, workout: '', duration: null, caloriesOut: null };
  const row = today?.row ?? todaysPhysiqueDay()?.row;
  const what = lines.length === 1 ? lines[0].replace(/^\S+\s+/, '') : `${lines.length} activities`;
  showUndoToast(`${what} logged to today.`, () => {
    if (row) restorePhysiqueSnapshots([{ row, values: physiqueDayCopy(before) }]);
  });
}

// One button for every table. Rows already logged today are skipped, so a
// session can be logged gradually into the same row.
function logWorkout() {
  const logged = loggedWorkoutQuantities();
  const added = [...document.querySelectorAll('.workout-check:checked')]
    .map((box) => ({ name: planRowName(box.closest('tr')), box }))
    .filter(({ name }) => !logged.has(name))
    .map(({ name, box }) => `${workoutNoteQuantityForBox(box)} ${name}`);

  if (added.length === 0) {
    alert(logged.size
      ? "Everything ticked is already in today's workout — tick another exercise to add it."
      : 'Tick at least one exercise before logging a workout.');
    return;
  }

  applyWorkoutLines(added);
}

// Exercise name -> today's logged quantity ("30x", "6000step"), read off today's row.
function loggedWorkoutQuantities() {
  const byName = new Map();
  parseWorkoutNoteLines(todaysLoggedWorkoutText())
    .forEach((line) => byName.set(line.name, workoutNoteQuantityForLine(line)));
  return byName;
}

// Tints every plan row already in today's log. Runs after every Physique
// refresh, so the marks clear by themselves at the date rollover.
function renderWorkoutPlanProgress() {
  const logged = loggedWorkoutQuantities();

  planRowsByName().forEach(({ box, tr }, name) => {
    const quantity = logged.get(name);
    tr.classList.toggle('workout-row-logged', quantity !== undefined);
    // A logged row's tick clears; an unsaved tick survives a background refresh.
    if (quantity !== undefined) box.checked = false;
  });

  const logBtn = document.getElementById('log-workout-btn');
  logBtn.textContent = '📝';
  logBtn.title = logged.size
    ? "Add the newly ticked activities to today's workout"
    : "Log the ticked activities as today's workout";
}

function initWorkoutPlan() {
  document.getElementById('log-workout-btn').addEventListener('click', logWorkout);

  // The button sits beside the <h2>, not in it: the h2 toggles the panel.
  const instructionModal = document.getElementById('activity-instruction-modal');
  document.getElementById('activity-instruction-btn').addEventListener('click', () => {
    // Opens on the tiles, or on a group when its address was loaded (…/workouts/push-day/).
    const sub = takeInitialFormSub('workouts');
    guideGroupSlug = sub && guideGroupName(sub) !== null ? sub : null;
    renderInstructionList();
    instructionModal.hidden = false;
  });
  registerFormSubView('workouts', showGuideGroup, guideGroupName);
  document.getElementById('guide-log-btn').addEventListener('click', logGuideTicks);
  // ❌ goes back one level: a group's page to the tiles, the tiles out of Workouts.
  document.getElementById('activity-instruction-close-btn').addEventListener('click', () => {
    if (guideGroupSlug !== null) showGuideGroup(null);
    else instructionModal.hidden = true;
  });
}
