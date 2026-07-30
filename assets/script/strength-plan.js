// The Activity Plan panel's tables (Leg/Push/Pull strength days, plus the
// NEAT table below them) each tick off what was actually done, then hand a
// computed duration + notes straight to the existing Health Log "Log Entry"
// modal (wellness.js) — this module never writes to the sheet itself, it
// only pre-fills that modal's fields and lets the user review/edit before
// saving, same as any other manual entry.

// Seconds per rep at a controlled lifting tempo for a strength row — a rough
// estimate the user can freely overwrite in the modal's Amount field before
// saving, this just saves typing on the common case. Only time actually
// under tension counts toward duration/calories (see estimateWorkoutMinutes
// below) — rest between sets, warm-up, and moving between machines are real
// gym-visit time but aren't activity, so they're deliberately left out
// rather than inflating the logged number.
const WORKOUT_REP_SEC = 3;

// A ticked row's own active seconds: sets × reps × rep time for a strength
// row (data-sets/data-reps), sets × data-hold for an isometric HOLD row
// (Plank — held for a set number of seconds rather than repped, so the
// per-rep tempo above doesn't apply and its seconds are already the active
// time), a flat data-minutes for a fixed-duration NEAT row (Swim), or
// data-steps converted via the same steps↔minutes ratio the Activity chart
// already uses (toActivityMinutes, charts.js — ~100 steps/min) for a
// step-count row (Walk) — net of rest in every case, so the total is time
// actually spent moving, not time spent at the gym.
function activeSecondsForBox(box) {
  if (box.dataset.steps !== undefined) return toActivityMinutes(Number(box.dataset.steps), 'steps') * 60;
  if (box.dataset.minutes !== undefined) return Number(box.dataset.minutes) * 60;
  if (box.dataset.hold !== undefined) return Number(box.dataset.sets) * Number(box.dataset.hold);
  const sets = Number(box.dataset.sets);
  const reps = Number(box.dataset.reps);
  return sets * reps * WORKOUT_REP_SEC;
}

function estimateWorkoutMinutes(checkedBoxes) {
  const seconds = checkedBoxes.reduce((sum, box) => sum + activeSecondsForBox(box), 0);
  return Math.max(1, Math.round(seconds / 60));
}

// One combined button below every table (rather than one per table) since a
// real session often mixes strength exercises across Leg/Push/Pull days with
// a NEAT/Cardio activity. Grouped by table here so describeWorkout can tell
// whether any strength day was ticked — the Notes lines themselves (below,
// in logWorkout) are flat, with no per-table/day label.
function collectCheckedByDay() {
  return [...document.querySelectorAll('.workout-day table')]
    .map((table) => ({ day: table.dataset.day, boxes: [...table.querySelectorAll('.workout-check:checked')] }))
    .filter((group) => group.boxes.length > 0);
}

// Bodyweight Day counts as strength: crunches, planks and push-ups are
// resistance work against body weight, not NEAT or cardio, so a session that
// includes them should still describe itself as "Strength Training".
const STRENGTH_DAY_NAMES = new Set(['Leg Day', 'Push Day', 'Pull Day', 'Dumbbell Day', 'Bodyweight Day']);

// Description defaults to "Strength Training" whenever any strength exercise
// is ticked (even alongside a NEAT/Cardio activity — it's the dominant,
// longer part of most mixed sessions). A strength-free session instead names
// the table(s) it came from — "NEAT" or "Cardio" (or "NEAT + Cardio" if both
// were ticked) — not the specific activity ticked within them (e.g. "Walk"),
// since NEAT/Cardio may hold more than one activity later and the table name
// is the stable category.
function describeWorkout(groups) {
  if (groups.some((g) => STRENGTH_DAY_NAMES.has(g.day))) return 'Strength Training';
  return groups.map((g) => g.day).join(' + ');
}

function logWorkout() {
  const groups = collectCheckedByDay();
  if (groups.length === 0) {
    alert('Tick at least one exercise before logging a workout.');
    return;
  }

  const allBoxes = groups.flatMap((group) => group.boxes);
  const minutes = estimateWorkoutMinutes(allBoxes);
  const notes = allBoxes
    .map((box) => {
      const cells = box.closest('tr').children;
      const name = cells[0].textContent.trim();
      let quantity;
      if (box.dataset.steps !== undefined) quantity = `${box.dataset.steps}step`;
      else if (box.dataset.minutes !== undefined) quantity = `${box.dataset.minutes}min`;
      // A hold row's TOTAL held seconds, in the same "<number><unit>  Name"
      // shape as the min/step rows — not the "3 × 45 sec" the cell displays,
      // which wouldn't survive the round trip: activity-estimator.js parses
      // these lines back on Recalculate, and its sets×reps pattern requires two
      // bare numbers, so a trailing " sec" would silently make the line
      // unparseable and drop the exercise from the recalculated total.
      else if (box.dataset.hold !== undefined) quantity = `${activeSecondsForBox(box)}sec`;
      // Read off the DISPLAYED "Sets × Reps" cell, which makes the visible plan
      // the authority — so every strength row's data-sets/data-reps must match
      // what its own cell shows. They didn't for 22 of the original 24 rows
      // (e.g. a row displaying "3 × 10" carried data-reps="11"), and since
      // estimateWorkoutMinutes above reads the ATTRIBUTES while this note reads
      // the TEXT, Log Workout and a later Recalculate disagreed by ~6% on the
      // same ticked exercises despite the two paths claiming to mirror each
      // other exactly. Keep any new row's attributes and display in step.
      else quantity = cells[1].textContent.trim().replace(/\s*×\s*/, '×');
      return `${quantity}  ${name}`;
    })
    .join('\n');

  openWellnessForm(null);
  document.getElementById('wellness-category').value = 'Activity';
  onCategoryChange();
  document.getElementById('wellness-description').value = describeWorkout(groups);
  document.getElementById('wellness-unit').value = 'min';
  document.getElementById('wellness-amount').value = String(minutes);
  document.getElementById('wellness-notes').value = notes;

  // Immediately run the same Activity Calculate the 🧮 button triggers
  // (activity-estimator.js) so the modal opens already showing the real
  // duration/calorie-burn pair instead of making the user click Calculate
  // themselves right after Log Workout filled the note in. If it can't run
  // (e.g. no Weight logged yet) it leaves the plain-minutes prefill above in
  // place and surfaces its own error explaining why.
  calculateWellnessActivity();
}

function initWorkoutPlan() {
  document.getElementById('log-workout-btn').addEventListener('click', logWorkout);
}
