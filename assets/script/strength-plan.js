// The gym plan tables in the Health section (Leg/Push/Pull day) each tick
// off the exercises actually done, then hand a computed duration + notes
// straight to the existing Health Log "Log Entry" modal (wellness.js) —
// this module never writes to the sheet itself, it only pre-fills that
// modal's fields and lets the user review/edit before saving, same as any
// other manual entry.

// Seconds per rep at a controlled lifting tempo, and a flat per-exercise
// allowance for walking to/adjusting the next machine — both rough
// estimates the user can freely overwrite in the modal's Amount field
// before saving, this just saves typing on the common case.
const WORKOUT_REP_SEC = 3;
const WORKOUT_TRANSITION_SEC = 90;
const WORKOUT_WARMUP_SEC = 300;

// Sums (sets × reps × rep time) + (rests between sets) for every ticked
// row, plus one transition gap between each ticked exercise and a fixed
// warm-up allowance — mirrors how the sets/reps/rest table was reasoned
// about above, just applied only to what was actually done today.
function estimateWorkoutMinutes(checkedBoxes) {
  let seconds = WORKOUT_WARMUP_SEC;

  checkedBoxes.forEach((box, i) => {
    const sets = Number(box.dataset.sets);
    const reps = Number(box.dataset.reps);
    const rest = Number(box.dataset.rest);
    seconds += sets * reps * WORKOUT_REP_SEC + (sets - 1) * rest;
    if (i > 0) seconds += WORKOUT_TRANSITION_SEC;
  });

  return Math.max(1, Math.round(seconds / 60));
}

// One combined button below all three tables (rather than one per table)
// since a real gym session often mixes exercises across Leg/Push/Pull days
// — each table's ticked rows become their own "Day: exercise, exercise"
// clause in the notes, so the mix is still legible even though it's logged
// as a single entry.
function collectCheckedByDay() {
  return [...document.querySelectorAll('.workout-day table')]
    .map((table) => ({ day: table.dataset.day, boxes: [...table.querySelectorAll('.workout-check:checked')] }))
    .filter((group) => group.boxes.length > 0);
}

function logWorkout() {
  const groups = collectCheckedByDay();
  if (groups.length === 0) {
    alert('Tick at least one exercise before logging a workout.');
    return;
  }

  const allBoxes = groups.flatMap((group) => group.boxes);
  const minutes = estimateWorkoutMinutes(allBoxes);
  const notes = groups
    .map((group) => `${group.day}: ${group.boxes.map((box) => box.closest('tr').children[0].textContent.trim()).join(', ')}`)
    .join('; ');

  openWellnessForm(null);
  document.getElementById('wellness-category').value = 'Activity';
  onCategoryChange();
  document.getElementById('wellness-description').value = 'Strength Training';
  document.getElementById('wellness-unit').value = 'min';
  document.getElementById('wellness-amount').value = String(minutes);
  document.getElementById('wellness-notes').value = notes;
}

function initWorkoutPlan() {
  document.getElementById('log-workout-btn').addEventListener('click', logWorkout);
}
