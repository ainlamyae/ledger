// The exercise catalogue: one row per movement, read from the 'Activity'
// sheet tab. Single source for what used to live in five places at once — the
// Activity Plan's static tables, the Instruction modal's name list, the MET
// table (activity-estimator.js), the muscle-group map (activity-insight.js)
// and the gif/jpg animation list (strength-plan.js).
//
// Columns: Category · Group · Name · Unit · "Sets x Reps, Rest" · Image ·
// MET · Muscle Group · Load (the sheet's Weight column). Name is the join key everything else matches
// on — it has to be exactly what the workout note lines carry.

const ACTIVITIES_RANGE = `'${CONFIG.SHEETS.ACTIVITIES}'!A2:J`;

// Compendium 02054 general value, for a name the sheet doesn't price.
// Distinct from charts.js's ACTIVITY_MET_FALLBACK, which is the assumed
// intensity for the daily activity TARGET rather than any one exercise.
const EXERCISE_MET_FALLBACK = 3.5;

let allActivities = [];
let activitiesByName = new Map();
let activitiesDataLoaded = false;
let activityListenersAttached = false;
let activitiesSheetId = null;
let editingActivityRow = null;
// The entry being edited, kept alongside editingActivityRow so Update knows the
// OLD name to sweep Physique for after Save rewrites the row (null in Add/
// Duplicate mode — there's nothing already logged under this row to propagate
// from). Mirrors nutrition.js's nutritionFormEntry.
let editingActivityEntry = null;

async function fetchActivitiesSheetId() {
  const metadata = await getSpreadsheetMetadata();
  return findSheetId(metadata, CONFIG.SHEETS.ACTIVITIES);
}

// "3 x 10, 90 sec" -> { amount: "3 x 10", rest: "90 sec", restSec: 90 }. Split
// on the LAST comma, so a hold row's own "3 x 45 sec, 45 sec" still divides
// where it should.
function splitAmountAndRest(cell) {
  const text = String(cell || '').trim();
  const comma = text.lastIndexOf(',');
  if (comma === -1) return { amount: text, rest: '', restSec: null };

  const rest = text.slice(comma + 1).trim();
  const restMatch = /(\d+)/.exec(rest);
  return { amount: text.slice(0, comma).trim(), rest, restSec: restMatch ? Number(restMatch[1]) : null };
}

// The quantity half of that cell, read according to the row's own Unit — which
// is what tells "3 x 45 sec" (a hold) from "3 x 15" (reps), and a step count
// from a minute count.
function parseActivityAmount(amount, unit) {
  const holdMatch = /^(\d+)\s*[x×]\s*(\d+)\s*sec$/i.exec(amount);
  const repsMatch = /^(\d+)\s*[x×]\s*(\d+)$/.exec(amount);
  const plainMatch = /^(\d+)/.exec(amount);

  if (unit === 'sec' && holdMatch) return { sets: Number(holdMatch[1]), hold: Number(holdMatch[2]) };
  if (unit === 'step' && plainMatch) return { steps: Number(plainMatch[1]) };
  if (unit === 'min' && plainMatch) return { minutes: Number(plainMatch[1]) };
  if (repsMatch) return { sets: Number(repsMatch[1]), reps: Number(repsMatch[2]) };
  return {};
}

async function initActivities(forceRefresh = false) {
  if (!activityListenersAttached) {
    activityListenersAttached = true;
    document.getElementById('add-activity-btn').addEventListener('click', () => openActivityForm(null));
    // health/activity/<name>/ opens that activity's Edit, …/duplicate/ its 📋.
    registerRecordRoute('activity', (slug, sub) => {
      const activity = allActivities.find((a) => routeSlug(a.name) === slug);
      if (!activity || (sub && sub !== 'duplicate')) return null;
      openActivityForm(activity, Boolean(sub));
      return activity.name;
    });
    document.getElementById('activity-cancel-btn').addEventListener('click', closeActivityForm);
    document.getElementById('activity-log-btn').addEventListener('click', logActivityFromForm);
    onAsyncClick('activity-update-btn', updateActivityAndPropagate);
    onFormSubmit('activity-form', submitActivityForm);
    // Live, not just on open — pasting a new path should preview it before Save,
    // same as the Instruction modal's own figures do once saved.
    document.getElementById('activity-image').addEventListener('input', renderActivityImagePreview);
    // A path pointing at nothing hides the preview rather than showing a broken-
    // image icon — same guard the Instruction modal's own figure uses.
    document.getElementById('activity-image-preview').addEventListener('error', () => {
      document.getElementById('activity-image-preview').hidden = true;
    });
  }

  const resp = await getValues(ACTIVITIES_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

  allActivities = values
    .map((row, i) => {
      const name = String(row[2] || '').trim();
      const unit = String(row[3] || '').trim().toLowerCase();
      const { amount, rest, restSec } = splitAmountAndRest(row[4]);
      return {
        // The sheet row this came from — what an edit or delete addresses. The
        // range starts at A2, so the first parsed entry is row 2.
        row: i + 2,
        category: String(row[0] || '').trim(),
        group: String(row[1] || '').trim(),
        name,
        unit,
        amount,
        rest,
        restSec,
        quantity: parseActivityAmount(amount, unit),
        image: String(row[5] || '').trim(),
        met: (row[6] !== undefined && row[6] !== '') ? Number(row[6]) : null,
        muscleGroup: String(row[7] || '').trim(),
        weight: String(row[8] || '').trim(),
        // Desired sessions/week for this row's Group — read by the Activity
        // Rotation chart (activity-rotation.js). Shared by every row in a
        // Group (Leg Day's five exercises all carry the same figure), so a
        // Group counts as tracked once ANY of its rows sets it; see
        // trackedActivityGroups for how the duplicates are reconciled.
        weeklyTarget: (row[9] !== undefined && row[9] !== '') ? Number(row[9]) : null,
      };
    })
    .filter((a) => a.name);

  activitiesByName = new Map(allActivities.map((a) => [a.name.toLowerCase(), a]));
  activitiesDataLoaded = true;

  renderActivityPlanTables();
  renderInstructionList();
}

// Case-insensitive: a workout note line is typed by hand, and "bench press"
// should price the same as "Bench Press" rather than falling to the
// unmatched-name fallback over casing alone.
function activityByName(name) {
  return activitiesByName.get(String(name || '').toLowerCase()) ?? null;
}

// Category is what the Physical Activity chart stacks by. 'Other' covers a
// name the sheet doesn't list, so an unrecognized line is visible as its own
// segment rather than silently folded into a real category.
function activityCategory(name) {
  return activityByName(name)?.category || 'Other';
}

// Named for the exercise, not the day: charts.js's activityMet() is the
// target-intensity MET and takes no argument.
function exerciseMet(name) {
  const met = activityByName(name)?.met;
  return (met !== null && met !== undefined && Number.isFinite(met)) ? met : EXERCISE_MET_FALLBACK;
}

function activityMuscleGroup(name) {
  return activityByName(name)?.muscleGroup || '';
}

// Every muscle group the sheet actually names, in the order it names them —
// so filling a blank cell with a group that didn't exist before (e.g. 'Core')
// starts reporting without a code change.
function activityMuscleGroups() {
  const groups = [];
  allActivities.forEach((a) => {
    if (a.muscleGroup && !groups.includes(a.muscleGroup)) groups.push(a.muscleGroup);
  });
  return groups;
}

// --- Activity Plan tables ------------------------------------------------
//
// Rebuilt from the sheet in the shape strength-plan.js already reads: a
// `.workout-day` block per Group, each holding a table whose data-day is the
// group name and whose checkbox carries the quantity attributes. Because both
// the displayed cell and those attributes now come from one cell, they can no
// longer drift apart — which they had, on 24 of 34 rows.

function groupInOrder(items, key) {
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item[key])) groups.set(item[key], []);
    groups.get(item[key]).push(item);
  });
  return groups;
}

function makeActivityCheckbox(activity) {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'workout-check';

  const { sets, reps, hold, steps, minutes } = activity.quantity;
  if (sets !== undefined) box.dataset.sets = sets;
  if (reps !== undefined) box.dataset.reps = reps;
  if (hold !== undefined) box.dataset.hold = hold;
  if (steps !== undefined) box.dataset.steps = steps;
  if (minutes !== undefined) box.dataset.minutes = minutes;
  if (activity.restSec !== null) box.dataset.rest = activity.restSec;

  return box;
}

// Muscle Group/Rest/Load, checked across every row of one table SHAPE
// (every strength day together, or NEAT+Cardio together) rather than table by
// table — so a column with real data somewhere in that shape (e.g. Muscle
// Group, blank on Bodyweight Day's own rows but filled on every other
// strength day) still renders, while one nothing in that shape has ever
// filled in (Rest/Load on every NEAT/Cardio row; Load everywhere, before
// it's ever been typed once) is dropped instead of rendering as a permanently
// empty column. Deciding per shape, not per table, is also what keeps Leg Day
// and Bodyweight Day showing the same columns in the same order as each other.
// "Rhomboids, Trapezius, Latissimus Dorsi" (Seated Row's actual value) is
// long enough to widen the Muscle Group column past what any other cell
// needs. Truncated for display only — the full text is in the title
// attribute, same convention truncateSettingValue (settings-panel.js) uses
// for an overlong Settings value.
const ACTIVITY_MUSCLE_GROUP_DISPLAY_MAX = 16;

function truncateMuscleGroup(text) {
  return text.length > ACTIVITY_MUSCLE_GROUP_DISPLAY_MAX
    ? `${text.slice(0, ACTIVITY_MUSCLE_GROUP_DISPLAY_MAX)}…`
    : text;
}

function activityPlanColumnVisibility(activities) {
  return {
    muscleGroup: activities.some((a) => a.muscleGroup),
    rest: activities.some((a) => a.rest),
    weight: activities.some((a) => a.weight),
  };
}

function makeActivityTable(group, rows, columnVisibility) {
  // A rep/hold group gets the Sets x Reps + Rest pair; an amount-based one
  // (steps, minutes) has no sets and no rest to show.
  const isStrength = rows.some((a) => a.quantity.sets !== undefined);

  const table = document.createElement('table');
  // table-compact: same dense/no-border look every other data table in the
  // app shares (styles.css) — the default padding/row-border read as loose
  // once these tables carry their own checkbox/actions columns.
  table.className = `table-compact ${isStrength ? 'workout-table-strength' : 'workout-table-neat'}`;
  table.dataset.day = group;

  // The checkbox column is first and unlabelled, same as every other
  // selectable table in the app (Nutrition, Physique). The row actions column
  // is last and unlabelled too. strength-plan.js reads a ticked row's name
  // from children[1] (Name never moves) and its quantity from the
  // "workout-quantity-cell" class rather than a fixed index — the column's
  // position among Muscle Group/Load/Rest shifts with columnVisibility, so
  // only a class survives that the way workout-muscle-group-cell already
  // does below.
  //
  // Every column between Name and the actions column gets a shared
  // "workout-meta-cell" class, and Muscle Group/quantity their own class on
  // top — nth-child can't target these reliably on mobile any more now that a
  // table's own column count depends on columnVisibility, so mobile's
  // font-size/hide rules key off these classes instead of position.
  const headers = [{ label: '', className: 'workout-check-col' }, { label: isStrength ? 'Exercise/Machine' : 'Activity' }];
  if (columnVisibility.muscleGroup) headers.push({ label: 'Muscle Group', className: 'workout-meta-cell workout-muscle-group-cell' });
  if (columnVisibility.weight) headers.push({ label: 'Load', className: 'workout-meta-cell' });
  headers.push({ label: isStrength ? 'Sets x Reps' : 'Amount', className: 'workout-meta-cell workout-quantity-cell' });
  if (columnVisibility.rest) headers.push({ label: 'Rest', className: 'workout-meta-cell' });
  headers.push({ label: '' });

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach(({ label, className }) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (className) th.className = className;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  rows.forEach((activity) => {
    const tr = document.createElement('tr');

    const checkCell = document.createElement('td');
    checkCell.className = 'workout-check-cell';
    checkCell.appendChild(makeActivityCheckbox(activity));
    tr.appendChild(checkCell);

    const cells = [makeCell(activity.name)];
    if (columnVisibility.muscleGroup) {
      cells.push(makeCell(truncateMuscleGroup(activity.muscleGroup), activity.muscleGroup));
    }
    if (columnVisibility.weight) cells.push(makeCell(activity.weight));
    const quantityCell = makeCell(activity.amount);
    quantityCell.classList.add('workout-quantity-cell');
    cells.push(quantityCell);
    if (columnVisibility.rest) cells.push(makeCell(activity.rest));
    // Cells 1..n-1 are the same conditionally-shown group the headers above
    // are classed for (cells[0] is the Name column, never classed).
    cells.slice(1).forEach((cell) => cell.classList.add('workout-meta-cell'));
    if (columnVisibility.muscleGroup) cells[1].classList.add('workout-muscle-group-cell');
    tr.append(...cells);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'workout-actions-cell';
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => {
        routeRecordEdit('activity', { slug: routeSlug(activity.name), label: activity.name });
        openActivityForm(activity);
      } }),
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => {
        routeRecordEdit('activity', { slug: routeSlug(activity.name), label: activity.name }, { slug: 'duplicate', label: 'Duplicate' });
        openActivityForm(activity, true);
      } }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteActivity(activity) }),
    );
    tr.appendChild(actionsCell);

    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  return table;
}

// Sort activities by rotation completion: least done (biggest gap) first.
// Groups with no Weekly Target (untracked) fall to the end in sheet order.
// Shared by the plan tables and the Instructions modal.
function sortActivitiesByRotation(activities) {
  const rotationRows = computeActivityRotationRows(wellnessDateRange());
  const groupRank = new Map(rotationRows.map((r, i) => [r.name, i]));
  return [...activities].sort((a, b) => {
    const ra = groupRank.has(a.group) ? groupRank.get(a.group) : Infinity;
    const rb = groupRank.has(b.group) ? groupRank.get(b.group) : Infinity;
    return ra - rb;
  });
}

function renderActivityPlanTables() {
  const container = document.getElementById('activity-plan-tables');
  container.innerHTML = '';

  if (!allActivities.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = `No activities yet — click "Add Activity" above, or add rows to the "${CONFIG.SHEETS.ACTIVITIES}" tab directly (Category, Group, Name, Unit, "Sets x Reps, Rest", Image, MET, Muscle Group, Weight, Weekly Target).`;
    container.appendChild(empty);
    return;
  }

  const sorted = sortActivitiesByRotation(allActivities);

  const strengthCols = activityPlanColumnVisibility(sorted.filter((a) => a.quantity.sets !== undefined));
  const amountCols = activityPlanColumnVisibility(sorted.filter((a) => a.quantity.sets === undefined));

  groupInOrder(sorted, 'category').forEach((categoryRows, category) => {
    const heading = document.createElement('h3');
    heading.textContent = category;
    container.appendChild(heading);

    groupInOrder(categoryRows, 'group').forEach((rows, group) => {
      const day = document.createElement('div');
      day.className = 'workout-day';

      // A category whose only group repeats its own name (NEAT, Cardio) would
      // just print the heading twice.
      if (group && group !== category) {
        const groupHeading = document.createElement('h4');
        groupHeading.textContent = group;
        day.appendChild(groupHeading);
      }

      const wrap = document.createElement('div');
      wrap.className = 'table-responsive';
      const isStrength = rows.some((a) => a.quantity.sets !== undefined);
      wrap.appendChild(makeActivityTable(group, rows, isStrength ? strengthCols : amountCols));
      day.appendChild(wrap);

      container.appendChild(day);
    });
  });

  // The tables were just rebuilt from scratch, so today's ticks and tints went
  // with them — put them back. Matters most after an edit here: the plan
  // shouldn't look like nothing was logged just because a row was renamed.
  renderWorkoutPlanProgress();
}

// --- Add / Edit / Duplicate / Delete --------------------------------------
//
// The catalogue was read-only in the UI until now: changing an exercise meant
// opening the sheet. Same shape as Nutrition's ingredient form
// (nutrition.js), which is the other user-owned catalogue the app reads.

function openActivityForm(activity, duplicate = false) {
  editingActivityRow = (activity && !duplicate) ? activity.row : null;
  editingActivityEntry = (activity && !duplicate) ? activity : null;
  // Only meaningful once there's a saved row (and an old name/MET) to propagate
  // FROM — an Add or Duplicate has nothing on the Physique sheet to find yet.
  document.getElementById('activity-update-btn').hidden = !editingActivityEntry;
  document.getElementById('activity-modal-title').textContent =
    duplicate ? 'Duplicate Activity' : (activity ? 'Edit Activity' : 'Add Activity');

  // Category and Group are prefilled on a plain Add too — a new exercise is
  // nearly always another one in the group you were just looking at, and the
  // datalists carry the rest.
  setActivityField('category', activity?.category);
  setActivityField('group', activity?.group);
  // A duplicate has to land on a different Name: it's the join key, so two rows
  // sharing one would make the second shadow the first everywhere.
  setActivityField('name', activity ? (duplicate ? `${activity.name} (copy)` : activity.name) : '');
  setActivityField('unit', activity?.unit || 'x');
  setActivityField('amount', activity?.amount);
  setActivityField('rest', activity?.rest);
  setActivityField('met', activity?.met);
  setActivityField('image', activity?.image);
  setActivityField('muscle-group', activity?.muscleGroup);
  setActivityField('weight', activity?.weight);
  setActivityField('weekly-target', activity?.weeklyTarget);
  renderActivityImagePreview();

  renderActivityDatalist('activity-category-options', 'category');
  renderActivityDatalist('activity-group-options', 'group');
  renderActivityDatalist('activity-muscle-group-options', 'muscleGroup');

  updateActivityLogButtonLabel();
  clearFieldError('activity-form-error');
  document.getElementById('activity-modal').hidden = false;
}

// Always 📝; the hover says whether today's workout already has lines, as
// logWorkout's own button does (strength-plan.js).
function updateActivityLogButtonLabel() {
  const btn = document.getElementById('activity-log-btn');
  const hasToday = loggedWorkoutQuantities().size > 0;
  btn.textContent = '📝';
  btn.title = hasToday
    ? "Add this activity to today's workout"
    : "Log this activity as today's workout";
}

// The quantity half of a workout note line ("30x", "6000step") for whatever's
// currently typed in the form — same cases workoutNoteQuantityForBox
// (strength-plan.js) reads off a ticked plan row, just off the form's own
// Unit/Sets x Reps fields instead of a checkbox's dataset.
function workoutNoteQuantityForForm(unit, amount) {
  const { sets, reps, hold, steps, minutes } = parseActivityAmount(amount, unit);
  if (steps !== undefined) return `${steps}step`;
  if (minutes !== undefined) return `${minutes}min`;
  if (hold !== undefined) return `${sets * hold}sec`;
  if (reps !== undefined) return `${sets * reps}x`;
  return amount.trim().replace(REPS_SEPARATOR_PATTERN, 'x');
}

// The modal's own Log button — logs whatever's currently typed as one line of
// today's workout, the same way ticking this row in the Activity Plan and
// clicking its Log button would, without requiring the row to be saved to the
// catalogue first.
function logActivityFromForm() {
  const name = activityFieldValue('name');
  const amount = activityFieldValue('amount');
  if (!name || !amount) {
    showFieldError('activity-form-error', 'Enter a Name and Sets x Reps (or an amount) before logging.');
    return;
  }

  if (loggedWorkoutQuantities().has(name)) {
    alert(`"${name}" is already in today's workout — edit that line from the Physique panel to change it.`);
    return;
  }

  const line = `${workoutNoteQuantityForForm(activityFieldValue('unit'), amount)} ${name}`;
  // Set before the close, so this form hands its history entry to the day's.
  routeRecordEdit('physique', todayPhysiqueRouteStep());
  closeActivityForm();
  applyWorkoutLines([line]);
}

function setActivityField(id, value) {
  document.getElementById(`activity-${id}`).value =
    (value === null || value === undefined) ? '' : String(value);
}

function activityFieldValue(id) {
  return document.getElementById(`activity-${id}`).value.trim();
}

// Shows what's currently typed in Image under the field itself, so a path
// can be checked before Save rather than only after — the 'error' listener
// wired in initActivities hides it again if the path resolves to nothing.
function renderActivityImagePreview() {
  const img = document.getElementById('activity-image-preview');
  const src = activityFieldValue('image');
  if (!src) {
    img.hidden = true;
    img.removeAttribute('src');
    return;
  }
  img.src = src;
  img.hidden = false;
}

// Values already in use for a free-text column, most-used first — the same
// guard against fragmenting into "Push"/"push"/"Pusg" that Nutrition's
// Classification datalist provides.
function renderActivityDatalist(datalistId, key) {
  const counts = new Map();
  allActivities.forEach((a) => {
    if (a[key]) counts.set(a[key], (counts.get(a[key]) || 0) + 1);
  });

  const dl = document.getElementById(datalistId);
  dl.innerHTML = '';
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([value]) => {
      const opt = document.createElement('option');
      opt.value = value;
      dl.appendChild(opt);
    });
}

function closeActivityForm() {
  document.getElementById('activity-modal').hidden = true;
  editingActivityRow = null;
  editingActivityEntry = null;
}

// Reads and validates every field of the Add/Edit Activity form, shared by
// Save (submitActivityForm) and Update (updateActivityAndPropagate) so the two
// can't drift on what counts as a valid activity. Shows its own field error and
// returns { ok: false } on the first problem found. Mirrors nutrition.js's
// readNutritionFormFields.
function readActivityFormFields() {
  const name = activityFieldValue('name');
  const category = activityFieldValue('category');
  const group = activityFieldValue('group');
  const metRaw = activityFieldValue('met');

  if (!name || !category || !group) {
    showFieldError('activity-form-error', 'Category, Group and Name are all required — Group is the sub-table this row renders into.');
    return { ok: false };
  }

  // Name is the join key for the note lines, the MET lookup, the muscle-group
  // map and the plan's own ticks, so a second row under an existing name
  // wouldn't be a duplicate — it would be invisible.
  const clash = allActivities.find((a) => a.row !== editingActivityRow
    && a.name.toLowerCase() === name.toLowerCase());
  if (clash) {
    showFieldError('activity-form-error', `"${clash.name}" is already in the plan — Name is what every logged line matches on, so it has to be unique. Edit that row, or give this one a different name.`);
    return { ok: false };
  }

  const met = metRaw ? evaluateNumberExpression(metRaw) : null;
  if (metRaw && met === null) {
    showFieldError('activity-form-error', 'MET must be a number (e.g. 5 or 3.8), or blank to use the default.');
    return { ok: false };
  }

  const weeklyTargetRaw = activityFieldValue('weekly-target');
  const weeklyTarget = weeklyTargetRaw ? evaluateNumberExpression(weeklyTargetRaw) : null;
  if (weeklyTargetRaw && weeklyTarget === null) {
    showFieldError('activity-form-error', 'Weekly Target must be a number (e.g. 7), or blank to leave this Group out of Activity Rotation.');
    return { ok: false };
  }

  // Column E is one cell holding both halves, split on its LAST comma — so the
  // rest half is joined back on the same way, and a hold's own "3 x 45 sec"
  // amount keeps its internal spacing intact.
  const rest = activityFieldValue('rest');
  const amount = activityFieldValue('amount');
  const amountAndRest = [amount, rest].filter(Boolean).join(', ');

  const values = [
    category,
    group,
    name,
    activityFieldValue('unit'),
    amountAndRest,
    activityFieldValue('image'),
    met !== null ? met : '',
    activityFieldValue('muscle-group'),
    activityFieldValue('weight'),
    weeklyTarget !== null ? weeklyTarget : '',
  ];

  return { ok: true, name, met, values };
}

// Persists `values` (from readActivityFormFields) to editingActivityRow if it's
// set, else appends a new row — the sheet write shared by Save and Update.
async function saveActivityFormFields(values) {
  if (editingActivityRow !== null) {
    await updateValues(`'${CONFIG.SHEETS.ACTIVITIES}'!A${editingActivityRow}:J${editingActivityRow}`, [values]);
  } else {
    await appendValues(ACTIVITIES_RANGE, [values]);
  }
}

async function submitActivityForm(event) {
  event.preventDefault();

  const fields = readActivityFormFields();
  if (!fields.ok) return;

  try {
    const editingRow = editingActivityRow;
    await saveActivityFormFields(fields.values);
    await initActivities(true);
    const name = fields.values[0];
    const saved = allActivities.find((a) => a.row === editingRow)
      || allActivities.filter((a) => a.name === name).at(-1);
    if (saved) {
      openActivityForm(saved);
      stayOnSavedForm('activity-modal', { slug: routeSlug(saved.name), label: saved.name });
    }
    showFormSaved('activity-form-error');
  } catch (err) {
    showFieldError('activity-form-error', err.message);
  }
}

// --- Update: propagate an edited activity into Physique -------------------
//
// Ordinary Calculate reuses a day's already-priced Workout as-is, so it never
// re-checks an unchanged day against the Activity Plan — a renamed or re-MET'd
// exercise otherwise leaves every past day quietly wrong (priced at the old
// MET, or falling to 'Other' once the name no longer matches) until someone
// notices. This button is the one path that reaches back and fixes them,
// entirely locally (no Groq/USDA call): find every Workout line still under the
// activity's OLD name, rename it to the new name, and reprice that whole day's
// Duration and Calories Out at the new MET — the same combine + highest-burn-
// first pass bulk Calculate runs (recalculatePhysiqueDay, physique.js).

// Rebuilds one Workout note line under the activity's new name, keeping
// whatever quantity/unit it already had — the same "<quantity> <name>" shape
// Log Workout and Calculate both write. Null when the line doesn't parse as a
// workout note line at all (a blank or hand-typed line left exactly as-is).
function renamedWorkoutLine(line, newName) {
  const [parsed] = parseWorkoutNoteLines(line);
  if (!parsed) return null;
  return `${workoutNoteQuantityForLine(parsed)} ${newName}`;
}

async function updateActivityAndPropagate() {
  if (editingActivityRow === null || !editingActivityEntry) return;
  const oldName = editingActivityEntry.name;

  const fields = readActivityFormFields();
  if (!fields.ok) return;

  clearFieldError('activity-form-error');
  try {
    await saveActivityFormFields(fields.values);
  } catch (err) {
    showFieldError('activity-form-error', err.message);
    return;
  }

  // Refresh the catalogue first so exerciseMet() below reads the just-saved MET
  // when it reprices each day, and Physique so the sweep sees current days.
  await initActivities(true);
  await refreshPhysique();

  const newName = fields.name;
  // A day's own recorded body mass is preferred where it has one, falling back
  // to the latest logged — the same choice bulk Calculate makes. Null only when
  // no day has ever recorded one, in which case a day can still be renamed but
  // not repriced (there's nothing to price calories against).
  const latestBodyMassKg = physiqueBodyMassKgFromLog();
  const candidates = allPhysiqueEntries.filter((p) => p.workout.trim());
  showFieldError('activity-form-error', `Checking ${candidates.length} Physique day${candidates.length === 1 ? '' : 's'}…`);

  let linesRenamed = 0;
  const edits = candidates.map((p) => {
    let mentions = false;
    const newLines = p.workout.split('\n').map((raw) => {
      const line = raw.trim();
      const [parsed] = parseWorkoutNoteLines(line);
      if (!parsed || parsed.name.toLowerCase() !== oldName.toLowerCase()) return raw;
      mentions = true;
      const rebuilt = renamedWorkoutLine(line, newName);
      if (!rebuilt || rebuilt === line) return raw;
      linesRenamed += 1;
      return rebuilt;
    });
    if (!mentions) return null;

    const newWorkoutText = newLines.join('\n');
    const textChanged = newWorkoutText !== p.workout;
    const bodyMassKg = p.bodyMass ?? latestBodyMassKg;

    // MET-only edit (name unchanged) on a day with no body mass to price
    // against has nothing to do — skip it rather than write the row back
    // unchanged.
    if (!textChanged && bodyMassKg === null) return null;

    const day = physiqueDayCopy(p);
    if (bodyMassKg !== null) {
      const { text: combined } = combineWorkoutText(newWorkoutText);
      const { minutes, calories, perLine } = estimateWorkoutActivity(combined, bodyMassKg);
      const sortedPerLine = [...perLine].sort((a, b) => b.calories - a.calories);
      day.workout = sortedPerLine.map((l) => `${l.quantity} ${l.name}`).join('\n');
      day.duration = minutes;
      day.caloriesOut = calories;
    } else {
      // Rename only — leave the stale Duration/Calories Out for a later
      // Calculate (once a body mass exists) to reprice.
      day.workout = newWorkoutText;
    }

    return { row: p.row, day, snapshot: physiqueDayCopy(p) };
  }).filter(Boolean);

  if (!edits.length) {
    closeActivityForm();
    alert(`Saved "${newName}" — no Physique day mentions "${oldName}" yet.`);
    return;
  }

  let done = 0;
  const succeeded = [];
  await Promise.allSettled(edits.map(async (e) => {
    try {
      await writePhysiqueRow(e.row, e.day);
      succeeded.push({ row: e.row, values: e.snapshot });
    } finally {
      done += 1;
      showFieldError('activity-form-error', `Updating ${done}/${edits.length} Physique days…`);
    }
  }));

  closeActivityForm();
  await refreshPhysique(true);

  const dayCount = `${succeeded.length} Physique day${succeeded.length === 1 ? '' : 's'}`;
  const renameNote = linesRenamed ? ` (${linesRenamed} line${linesRenamed === 1 ? '' : 's'} renamed)` : '';
  showUndoToast(
    `"${newName}" updated — ${dayCount} repriced${renameNote}.`,
    () => restorePhysiqueSnapshots(succeeded),
  );
}

// Deleting the catalogue row doesn't touch a workout already logged against
// it — that's free text on a Physique day. It just stops being priced by its
// own MET and stacks under 'Other', which the confirmation says out loud.
async function deleteActivity(activity) {
  await confirmAndDelete(
    `Delete "${activity.name}" from the Activity Plan? Days already logged against it keep their lines, but will be priced at the default MET if recalculated.`,
    async () => {
      if (!activitiesSheetId) activitiesSheetId = await fetchActivitiesSheetId();
      await batchUpdate([{
        deleteDimension: {
          range: { sheetId: activitiesSheetId, dimension: 'ROWS', startIndex: activity.row - 1, endIndex: activity.row },
        },
      }]);
      await initActivities(true);
    },
    "Couldn't delete activity",
  );
}

// "45 lbs · 3 x 10 · 90 sec rest" — Load leads, so it reads left of the
// Sets x Reps it applies to rather than trailing after Rest where it'd read
// as an afterthought. Amount/Rest come from the single cell
// splitAmountAndRest already divides, so that half shows exactly what the
// plan table's Sets x Reps and Rest columns do; Load is its own column
// (row[8]), blank on any activity that doesn't load one (steps, minutes).
// Either half missing just drops out rather than leaving a stray separator.
function instructionPrescription(activity) {
  const prescription = activity.amount
    ? (activity.rest ? `${activity.amount} · ${activity.rest} rest` : activity.amount)
    : '';
  return [activity.weight, prescription].filter(Boolean).join(' · ');
}

// GYM: one tile per Group (Insight's tile style), and under them the chosen
// group's activities — figure, name, muscle group, then load, sets x reps and rest.
// Each group is a page of its own, …/activity/gym/<group>/ (registerFormSubView,
// router.js); GYM's own address shows just the tiles. Figures come from the
// sheet's Image column.
let guideGroupSlug = null;

function guideGroups() {
  // The gym's: every strength activity (Sets x Reps, as the plan's strength tables
  // tell them apart), pictured or not. NEAT and Cardio stay out.
  return groupInOrder(sortActivitiesByRotation(allActivities).filter((a) => a.quantity.sets !== undefined), 'group');
}

// The group a page slug names, or null.
function guideGroupName(slug) {
  return [...guideGroups().keys()].find((g) => routeSlug(g) === slug) ?? null;
}

// Shows a group's page (or the tiles alone, for null) and puts it in the address.
function showGuideGroup(slug) {
  const groups = guideGroups();
  const name = [...groups.keys()].find((g) => routeSlug(g) === slug) ?? null;
  guideGroupSlug = name === null ? null : slug;
  renderInstructionList();
  if (!document.getElementById('activity-instruction-modal').hidden) {
    setFormSubView(guideGroupSlug, name);
  }
}

function renderInstructionList() {
  const tiles = document.getElementById('instruction-groups');
  const body = document.getElementById('instruction-body');
  tiles.innerHTML = '';
  body.innerHTML = '';
  const groups = guideGroups();
  // As Insight's modes: the tiles alone on GYM's page, a group's list alone on
  // its own (the breadcrumb's GYM goes back to the tiles).
  tiles.hidden = guideGroupSlug !== null;

  groups.forEach((rows, group) => {
    const slug = routeSlug(group);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'page-tile';
    tile.setAttribute('aria-pressed', String(slug === guideGroupSlug));
    const title = document.createElement('span');
    title.className = 'page-tile-title';
    title.textContent = group;
    tile.appendChild(title);
    tile.addEventListener('click', () => showGuideGroup(slug));
    tiles.appendChild(tile);
  });

  groups.forEach((rows, group) => {
    if (routeSlug(group) !== guideGroupSlug) return;

    const list = document.createElement('ul');
    list.className = 'instruction-activities';

    const logged = loggedWorkoutQuantities();
    rows.forEach((activity) => {
      const li = document.createElement('li');
      // A tick in the figure's corner picks it for 📝 (logGuideTicks); a card already
      // in today's workout is tinted instead, as the plan tables' rows are.
      const isLogged = logged.has(activity.name);
      li.classList.toggle('instruction-logged', isLogged);
      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.className = 'instruction-check';
      tick.dataset.name = activity.name;
      tick.disabled = isLogged;
      tick.title = isLogged ? "Already in today's workout" : 'Tick to log with 📝';
      tick.setAttribute('aria-label', `Log ${activity.name}`);
      tick.addEventListener('change', updateGuideLogButton);
      // ✏️ in the figure's other corner opens the activity's Edit page over this one;
      // its ❌ comes back here.
      const edit = makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: (event) => {
        event.stopPropagation();
        routeRecordEdit('activity', { slug: routeSlug(activity.name), label: activity.name });
        openActivityForm(activity);
      } });
      edit.classList.add('instruction-edit');
      li.append(tick, edit);
      // The whole card toggles its tick: one tap per activity at the gym.
      li.addEventListener('click', (event) => {
        if (event.target === tick || tick.disabled) return;
        tick.checked = !tick.checked;
        updateGuideLogButton();
      });

      // No image (a blank cell, or a path that 404s) keeps the figure's box, empty,
      // so every card in the grid stays the same height.
      const blank = () => {
        const box = document.createElement('div');
        box.className = 'instruction-figure';
        return box;
      };
      let figure = blank();
      if (activity.image) {
        figure = document.createElement('img');
        figure.className = 'instruction-figure';
        figure.src = activity.image;
        figure.alt = `${activity.name}, movement guide`;
        figure.loading = 'lazy';
        figure.addEventListener('error', () => figure.replaceWith(blank()), { once: true });
      }

      const label = document.createElement('span');
      label.className = 'instruction-activity-name';
      label.textContent = activity.name;

      li.append(figure, label);

      // The name is what you scan for, so the rest of the row sits under it at
      // plain (non-bold) font weight: what the movement trains, then how much
      // of it to do (load, sets/reps, rest — see instructionPrescription). A
      // line whose cell is blank on the sheet is skipped rather than printed
      // empty.
      // The prescription is what's read mid-set, so it's in the text colour, not muted.
      [[activity.muscleGroup, ''], [instructionPrescription(activity), ' instruction-activity-prescription']]
        .filter(([text]) => text)
        .forEach(([text, extra]) => {
          const meta = document.createElement('span');
          meta.className = `instruction-activity-meta${extra}`;
          meta.textContent = text;
          li.appendChild(meta);
        });

      list.appendChild(li);
    });

    body.append(list);
  });
  updateGuideLogButton();
}

// 📝 shows on a group's page and is live once something is ticked.
function updateGuideLogButton() {
  const btn = document.getElementById('guide-log-btn');
  const ticked = document.querySelectorAll('#instruction-body .instruction-check:checked').length;
  btn.hidden = guideGroupSlug === null;
  btn.disabled = ticked === 0;
  btn.title = ticked ? `Log ${ticked} ticked to today's workout` : 'Tick activities to log them';
}

// Saves the ticked activities straight into today's workout; the page stays put.
async function logGuideTicks() {
  const btn = document.getElementById('guide-log-btn');
  const lines = [...document.querySelectorAll('#instruction-body .instruction-check:checked')]
    .map((box) => activitiesByName.get(box.dataset.name.toLowerCase()))
    .filter(Boolean)
    .map((a) => `${workoutNoteQuantityForForm(a.unit, a.amount)} ${a.name}`);
  if (!lines.length) return;
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    await quickLogWorkoutLines(lines);
  } catch (err) {
    alert(`Not logged: ${err.message}`);
  } finally {
    btn.textContent = '📝';
    renderInstructionList();
  }
}
