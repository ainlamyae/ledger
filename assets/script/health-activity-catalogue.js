// The exercise catalogue: one row per movement on the 'Activity' sheet tab. The
// one source for the plan table, Workouts, METs, muscle groups and figures.
//
// Columns: Category · Group · Name · Unit · "Sets x Reps, Rest" · Image · MET ·
// Muscle Group · Load (the sheet's Weight) · Weekly Desired. Name is the join key:
// it must match what the workout note lines carry.

// Sheet row of the first catalogue entry; row 1 is the header.
const ACTIVITY_FIRST_ROW = 2;
const ACTIVITIES_RANGE = `'${CONFIG.SHEETS.ACTIVITIES}'!A${ACTIVITY_FIRST_ROW}:J`;

// Compendium 02054 general value, for a name the sheet doesn't price. Not
// health-math.js's ACTIVITY_MET_FALLBACK, which is the daily activity's intensity.
const EXERCISE_MET_FALLBACK = 3.5;

let allActivities = [];
let activitiesByName = new Map();
let activitiesDataLoaded = false;
let activityListenersAttached = false;
let activitiesSheetId = null;
let editingActivityRow = null;
// The entry being edited, so Update knows the OLD name to sweep Physique for
// (null for Add and Duplicate).
let editingActivityEntry = null;

async function fetchActivitiesSheetId() {
  const metadata = await getSpreadsheetMetadata();
  return findSheetId(metadata, CONFIG.SHEETS.ACTIVITIES);
}

// "3 x 10, 90 sec" -> { amount: "3 x 10", rest: "90 sec", restSec: 90 }. Split on
// the LAST comma, so a hold's "3 x 45 sec, 45 sec" divides correctly.
function splitAmountAndRest(cell) {
  const text = String(cell || '').trim();
  const comma = text.lastIndexOf(',');
  if (comma === -1) return { amount: text, rest: '', restSec: null };

  const rest = text.slice(comma + 1).trim();
  const restMatch = /(\d+)/.exec(rest);
  return { amount: text.slice(0, comma).trim(), rest, restSec: restMatch ? Number(restMatch[1]) : null };
}

// The amount read by the row's Unit: a hold, reps, steps or minutes.
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

function activityCellText(row, index) {
  return String(row[index] || '').trim();
}

// A number, or null for a blank cell.
function activityCellNumber(row, index) {
  return (row[index] !== undefined && row[index] !== '') ? Number(row[index]) : null;
}

function activityFromSheetRow(row, i) {
  const unit = activityCellText(row, 3).toLowerCase();
  const { amount, rest, restSec } = splitAmountAndRest(row[4]);
  return {
    // The sheet row an edit or delete addresses.
    row: i + ACTIVITY_FIRST_ROW,
    category: activityCellText(row, 0),
    group: activityCellText(row, 1),
    name: activityCellText(row, 2),
    unit,
    amount,
    rest,
    restSec,
    quantity: parseActivityAmount(amount, unit),
    image: activityCellText(row, 5),
    met: activityCellNumber(row, 6),
    muscleGroup: activityCellText(row, 7),
    weight: activityCellText(row, 8),
    // Desired sessions/week for the row's Group (Activity Rotation chart). Every
    // row in a Group carries it; see trackedActivityGroups.
    weeklyDesired: activityCellNumber(row, 9),
  };
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
    // Live, so a pasted path previews before Save.
    document.getElementById('activity-image').addEventListener('input', renderActivityImagePreview);
    // A path to nothing hides the preview rather than showing a broken image.
    document.getElementById('activity-image-preview').addEventListener('error', () => {
      document.getElementById('activity-image-preview').hidden = true;
    });
  }

  const resp = await getValues(ACTIVITIES_RANGE, VALUE_PARAMS);
  allActivities = (resp.values || []).map(activityFromSheetRow).filter((a) => a.name);
  activitiesByName = new Map(allActivities.map((a) => [a.name.toLowerCase(), a]));
  activitiesDataLoaded = true;

  renderActivityPlanTables();
  renderInstructionList();
}

// Case-insensitive, since note lines are typed by hand.
function activityByName(name) {
  return activitiesByName.get(String(name || '').toLowerCase()) ?? null;
}

// What the Physical Activity chart stacks by; 'Other' for a name the sheet lacks.
function activityCategory(name) {
  return activityByName(name)?.category || 'Other';
}

// The exercise's MET. health-math.js's activityMet() is the day's desired intensity.
function exerciseMet(name) {
  const met = activityByName(name)?.met;
  return Number.isFinite(met) ? met : EXERCISE_MET_FALLBACK;
}

function activityMuscleGroup(name) {
  return activityByName(name)?.muscleGroup || '';
}

// Every muscle group the sheet names, in sheet order, so a new one reports
// without a code change.
function activityMuscleGroups() {
  const groups = [];
  allActivities.forEach((a) => {
    if (a.muscleGroup && !groups.includes(a.muscleGroup)) groups.push(a.muscleGroup);
  });
  return groups;
}

// --- Activity Plan table ------------------------------------------------
//
// Each row's checkbox carries the quantity health-activity.js reads.

function groupInOrder(items, key) {
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item[key])) groups.set(item[key], []);
    groups.get(item[key]).push(item);
  });
  return groups;
}

// Copied onto the checkbox's dataset when present, in this order.
const ACTIVITY_QUANTITY_KEYS = ['sets', 'reps', 'hold', 'steps', 'minutes'];

function makeActivityCheckbox(activity) {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'workout-check';

  ACTIVITY_QUANTITY_KEYS.forEach((key) => {
    if (activity.quantity[key] !== undefined) box.dataset[key] = activity.quantity[key];
  });
  if (activity.restSec !== null) box.dataset.rest = activity.restSec;

  return box;
}

// Seated Row's "Rhomboids, Trapezius, Latissimus Dorsi" would widen the column;
// the full text stays in the title.
const ACTIVITY_MUSCLE_GROUP_DISPLAY_MAX = 16;

function truncateMuscleGroup(text) {
  return text.length > ACTIVITY_MUSCLE_GROUP_DISPLAY_MAX
    ? `${text.slice(0, ACTIVITY_MUSCLE_GROUP_DISPLAY_MAX)}…`
    : text;
}

// Muscle Group, Rest and Load show only when some row fills them, so no column
// renders permanently empty.
function activityPlanColumnVisibility(activities) {
  return {
    muscleGroup: activities.some((a) => a.muscleGroup),
    rest: activities.some((a) => a.rest),
    weight: activities.some((a) => a.weight),
  };
}

// The columns after Activity. `visibleKey` names an optional one's
// columnVisibility flag; Amount always shows.
const ACTIVITY_PLAN_META_COLUMNS = [
  { visibleKey: 'muscleGroup', label: 'Muscle Group', className: 'workout-muscle-group-cell',
    cell: (a) => makeCell(truncateMuscleGroup(a.muscleGroup), a.muscleGroup) },
  { visibleKey: 'weight', label: 'Load', cell: (a) => makeCell(a.weight) },
  { label: 'Amount', className: 'workout-quantity-cell', cell: (a) => makeCell(a.amount) },
  { visibleKey: 'rest', label: 'Rest', cell: (a) => makeCell(a.rest) },
];

// The route step for an activity's own form page.
function activityRouteStep(activity) {
  return { slug: routeSlug(activity.name), label: activity.name };
}

// Opens an activity's Edit (or Duplicate) as a routed page.
function openActivityFormPage(activity, duplicate = false) {
  const extra = duplicate ? [{ slug: 'duplicate', label: 'Duplicate' }] : [];
  routeRecordEdit('activity', activityRouteStep(activity), ...extra);
  openActivityForm(activity, duplicate);
}

// One table for every activity, Category and Group first. health-activity.js
// and the mobile rules find cells by class, not position.
function makeActivityTable(rows, columnVisibility) {
  const table = document.createElement('table');
  table.className = 'table-compact workout-table-strength';

  const metaColumns = ACTIVITY_PLAN_META_COLUMNS
    .filter((c) => !c.visibleKey || columnVisibility[c.visibleKey]);
  const headers = [
    { label: '', className: 'workout-check-col' },
    { label: 'Category' },
    { label: 'Group' },
    { label: 'Activity' },
    ...metaColumns.map((c) => ({ label: c.label, className: c.className ? `workout-meta-cell ${c.className}` : 'workout-meta-cell' })),
    { label: '' },
  ];

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
  rows.forEach((activity, i) => {
    const tr = document.createElement('tr');
    // A line where the Group changes, as Breakdown does per Category.
    if (i > 0 && activity.group !== rows[i - 1].group) tr.classList.add('workout-group-start');

    const checkCell = document.createElement('td');
    checkCell.className = 'workout-check-cell';
    checkCell.appendChild(makeActivityCheckbox(activity));
    tr.appendChild(checkCell);

    const nameCell = makeCell(activity.name);
    nameCell.className = 'workout-name-cell';
    tr.append(makeCell(activity.category), makeCell(activity.group), nameCell);

    tr.append(...metaColumns.map((c) => {
      const cell = c.cell(activity);
      if (c.className) cell.classList.add(c.className);
      cell.classList.add('workout-meta-cell');
      return cell;
    }));

    const actionsCell = document.createElement('td');
    actionsCell.className = 'workout-actions-cell';
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openActivityFormPage(activity) }),
      makeRowActionButton({ emoji: '📋', title: 'Duplicate', onClick: () => openActivityFormPage(activity, true) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteActivity(activity) }),
    );
    tr.appendChild(actionsCell);

    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  return table;
}

// Least-done Group (biggest rotation gap) first; untracked Groups last, in
// sheet order. Shared by the plan table and Workouts.
function sortActivitiesByRotation(activities) {
  const rotationRows = computeActivityRotationRows(healthDateRange());
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
    empty.textContent = `No activities yet — click "Add Activity" above, or add rows to the "${CONFIG.SHEETS.ACTIVITIES}" tab directly (Category, Group, Name, Unit, "Sets x Reps, Rest", Image, MET, Muscle Group, Weight, Weekly Desired).`;
    container.appendChild(empty);
    return;
  }

  const sorted = sortActivitiesByRotation(allActivities);
  // Category, then Group, in rotation order.
  const rows = [...groupInOrder(sorted, 'category').values()]
    .flatMap((categoryRows) => [...groupInOrder(categoryRows, 'group').values()].flat());

  const day = document.createElement('div');
  day.className = 'workout-day panel-section card';
  const heading = document.createElement('h3');
  heading.textContent = 'Plan';
  day.appendChild(heading);
  const wrap = document.createElement('div');
  wrap.className = 'table-responsive';
  wrap.appendChild(makeActivityTable(rows, activityPlanColumnVisibility(rows)));
  day.appendChild(wrap);
  container.appendChild(day);

  // The rebuild dropped today's tints; put them back.
  renderWorkoutPlanProgress();
}

// --- Add / Edit / Duplicate / Delete --------------------------------------
//
// Same shape as Nutrition's ingredient form (health-nutrition.js).

function openActivityForm(activity, duplicate = false) {
  editingActivityRow = (activity && !duplicate) ? activity.row : null;
  editingActivityEntry = (activity && !duplicate) ? activity : null;
  // Update needs a saved row to propagate from.
  document.getElementById('activity-update-btn').hidden = !editingActivityEntry;

  setActivityField('category', activity?.category);
  setActivityField('group', activity?.group);
  // Name is the join key, so a duplicate needs a different one.
  setActivityField('name', activity ? (duplicate ? `${activity.name} (copy)` : activity.name) : '');
  setActivityField('unit', activity?.unit || 'x');
  setActivityField('amount', activity?.amount);
  setActivityField('rest', activity?.rest);
  setActivityField('met', activity?.met);
  setActivityField('image', activity?.image);
  setActivityField('muscle-group', activity?.muscleGroup);
  setActivityField('weight', activity?.weight);
  setActivityField('weekly-desired', activity?.weeklyDesired);
  renderActivityImagePreview();

  renderActivityDatalist('activity-category-options', 'category');
  renderActivityDatalist('activity-group-options', 'group');
  renderActivityDatalist('activity-muscle-group-options', 'muscleGroup');

  updateActivityLogButtonLabel();
  clearFieldError('activity-form-error');
  document.getElementById('activity-modal').hidden = false;
}

// Always 📝; the hover says whether today's workout already has lines.
function updateActivityLogButtonLabel() {
  const btn = document.getElementById('activity-log-btn');
  const hasToday = loggedWorkoutQuantities().size > 0;
  btn.textContent = '📝';
  btn.title = hasToday
    ? "Add this activity to today's workout"
    : "Log this activity as today's workout";
}

// The note-line quantity ("30x", "6000step") for a Unit and amount, as
// workoutNoteQuantityForBox (health-activity.js) gives for a ticked row.
function workoutNoteQuantityForForm(unit, amount) {
  const { sets, reps, hold, steps, minutes } = parseActivityAmount(amount, unit);
  if (steps !== undefined) return `${steps}step`;
  if (minutes !== undefined) return `${minutes}min`;
  if (hold !== undefined) return `${sets * hold}sec`;
  if (reps !== undefined) return `${sets * reps}x`;
  // Decimal sets/reps ("2.5 x 4") total up the same way a ticked plan row does.
  const totalReps = totalRepsFromSetsCell(amount);
  if (totalReps !== null) return `${totalReps}x`;
  return amount.trim().replace(REPS_SEPARATOR_PATTERN, 'x');
}

// The form's Log button: logs what's typed as one line of today's workout,
// saved to the catalogue or not.
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

// Previews the typed Image path under the field.
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

// Values already in use for a free-text column, most-used first, so "Push"
// doesn't fragment into "push" and "Pusg".
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

// An optional numeric field: its value (null when blank) and whether what's
// typed failed to parse.
function readActivityNumberField(id) {
  const raw = activityFieldValue(id);
  const value = raw ? evaluateNumberExpression(raw) : null;
  return { value, invalid: Boolean(raw) && value === null };
}

// Reads and validates the form for Save and Update alike. Shows the first
// problem and returns { ok: false }.
function readActivityFormFields() {
  const name = activityFieldValue('name');
  const category = activityFieldValue('category');
  const group = activityFieldValue('group');

  if (!name || !category || !group) {
    showFieldError('activity-form-error', 'Category, Group and Name are all required — Group is the sub-table this row renders into.');
    return { ok: false };
  }

  // Name is the join key, so a second row under it would be invisible.
  const clash = allActivities.find((a) => a.row !== editingActivityRow
    && a.name.toLowerCase() === name.toLowerCase());
  if (clash) {
    showFieldError('activity-form-error', `"${clash.name}" is already in the plan — Name is what every logged line matches on, so it has to be unique. Edit that row, or give this one a different name.`);
    return { ok: false };
  }

  const met = readActivityNumberField('met');
  if (met.invalid) {
    showFieldError('activity-form-error', 'MET must be a number (e.g. 5 or 3.8), or blank to use the default.');
    return { ok: false };
  }

  const weeklyDesired = readActivityNumberField('weekly-desired');
  if (weeklyDesired.invalid) {
    showFieldError('activity-form-error', 'Weekly Desired must be a number (e.g. 7), or blank to leave this Group out of Activity Rotation.');
    return { ok: false };
  }

  // Column E holds both halves, split on its last comma, so join them the same way.
  const amountAndRest = [activityFieldValue('amount'), activityFieldValue('rest')].filter(Boolean).join(', ');

  const values = [
    category,
    group,
    name,
    activityFieldValue('unit'),
    amountAndRest,
    activityFieldValue('image'),
    met.value ?? '',
    activityFieldValue('muscle-group'),
    activityFieldValue('weight'),
    weeklyDesired.value ?? '',
  ];

  return { ok: true, name, met: met.value, values };
}

// Writes `values` over editingActivityRow, or appends a new row.
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
    // A name saved from a day's Workout table now prices from the sheet, not its AI guess.
    forgetActivityGuess(fields.name);
    if (!document.getElementById('physique-modal').hidden) runPhysiqueWorkoutCalc(false);
    const name = fields.name;
    const saved = allActivities.find((a) => a.row === editingRow)
      || allActivities.filter((a) => a.name === name).at(-1);
    if (saved) {
      openActivityForm(saved);
      stayOnSavedForm('activity-modal', activityRouteStep(saved));
    }
    showFormSaved('activity-form-error');
  } catch (err) {
    showFieldError('activity-form-error', err.message);
  }
}

// --- Update: propagate an edited activity into Physique -------------------
//
// Calculate never re-checks an unchanged day, so a renamed or re-MET'd exercise
// would leave past days wrong. Update renames every Workout line under the OLD
// name and reprices those days locally (no AI call).

// "1 line", "3 lines".
function pluralCount(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// A note line rebuilt under a new name, keeping its quantity; null if it doesn't parse.
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

  // Catalogue first, so exerciseMet() reads the saved MET.
  await initActivities(true);
  await refreshPhysique();

  const newName = fields.name;
  // A day's own body mass, else the latest logged; null means rename only.
  const latestBodyMassKg = physiqueBodyMassKgFromLog();
  const candidates = allPhysiqueEntries.filter((p) => p.workout.trim());
  showToast(`Checking ${pluralCount(candidates.length, 'Physique day')}…`);

  let linesRenamed = 0;
  const edits = candidates.map((p) => {
    let mentions = false;
    const newLines = p.workout.split('\n').map((raw) => {
      const line = raw.trim();
      const [parsed] = parseWorkoutNoteLines(line);
      if (!parsed || parsed.name.toLowerCase() !== oldName.toLowerCase()) return raw;
      mentions = true;
      const rebuilt = renamedWorkoutLine(line, newName);
      if (rebuilt === line) return raw;
      linesRenamed += 1;
      return rebuilt;
    });
    if (!mentions) return null;

    const newWorkoutText = newLines.join('\n');
    const textChanged = newWorkoutText !== p.workout;
    const bodyMassKg = p.bodyMass ?? latestBodyMassKg;

    // A MET-only edit with no body mass to price against changes nothing.
    if (!textChanged && bodyMassKg === null) return null;

    const day = physiqueDayCopy(p);
    if (bodyMassKg !== null) repriceWorkoutDay(day, newWorkoutText, bodyMassKg);
    // Rename only: a later Calculate reprices once a body mass exists.
    else day.workout = newWorkoutText;

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
      showToast(`Updating ${done}/${edits.length} Physique days…`);
    }
  }));

  closeActivityForm();
  await refreshPhysique(true);

  const renameNote = linesRenamed ? ` (${pluralCount(linesRenamed, 'line')} renamed)` : '';
  showUndoToast(
    `"${newName}" updated — ${pluralCount(succeeded.length, 'Physique day')} repriced${renameNote}.`,
    () => restorePhysiqueSnapshots(succeeded),
  );
}

// Logged days keep their lines; they just fall to the default MET and 'Other'.
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

// "45 lbs · 3 x 10 · 90 sec rest": Load first, then amount and rest; a missing
// part drops out with its separator.
function instructionPrescription(activity) {
  const prescription = activity.amount
    ? (activity.rest ? `${activity.amount} · ${activity.rest} rest` : activity.amount)
    : '';
  return [activity.weight, prescription].filter(Boolean).join(' · ');
}

// --- Workouts -------------------------------------------------------------
//
// One tile per Group; a group's activities on its own page,
// …/activity/workouts/<group>/ (registerFormSubView, router.js).
let guideGroupSlug = null;

const GUIDE_TICKED_SELECTOR = '#instruction-body .instruction-check:checked';

function guideGroups() {
  return groupInOrder(sortActivitiesByRotation(allActivities), 'group');
}

// The group a page slug names, or null.
function guideGroupName(slug) {
  return [...guideGroups().keys()].find((g) => routeSlug(g) === slug) ?? null;
}

// Shows a group's page (or the tiles alone, for null) and puts it in the address.
function showGuideGroup(slug) {
  const name = guideGroupName(slug);
  guideGroupSlug = name === null ? null : slug;
  renderInstructionList();
  if (!document.getElementById('activity-instruction-modal').hidden) {
    setFormSubView(guideGroupSlug, name);
  }
}

// The figure, or an empty box of the same size when there's no image or it 404s.
function makeInstructionFigure(activity) {
  const blank = () => {
    const box = document.createElement('div');
    box.className = 'instruction-figure';
    return box;
  };
  if (!activity.image) return blank();
  const figure = document.createElement('img');
  figure.className = 'instruction-figure';
  figure.src = activity.image;
  figure.alt = `${activity.name}, movement guide`;
  figure.loading = 'lazy';
  figure.addEventListener('error', () => figure.replaceWith(blank()), { once: true });
  return figure;
}

// One activity's card: tick and ✏️ in the corners, name, prescription, figure.
function makeInstructionCard(activity, isLogged) {
  const li = document.createElement('li');
  li.className = 'card';
  // A card already in today's workout is tinted and can't be ticked.
  li.classList.toggle('instruction-logged', isLogged);
  const tick = document.createElement('input');
  tick.type = 'checkbox';
  tick.className = 'instruction-check';
  tick.dataset.name = activity.name;
  tick.disabled = isLogged;
  tick.title = isLogged ? "Already in today's workout" : 'Tick to log with 📝';
  tick.setAttribute('aria-label', `Log ${activity.name}`);
  tick.addEventListener('change', updateGuideLogButton);
  const edit = makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: (event) => {
    event.stopPropagation();
    openActivityFormPage(activity);
  } });
  edit.classList.add('instruction-edit');
  li.append(tick, edit);
  // The whole card toggles its tick: one tap per activity at the gym.
  li.addEventListener('click', (event) => {
    if (event.target === tick || tick.disabled) return;
    tick.checked = !tick.checked;
    updateGuideLogButton();
  });

  const figure = makeInstructionFigure(activity);
  const label = document.createElement('h3');
  label.textContent = activity.name;
  li.append(label);

  // Read mid-set, so it's in the text colour, not muted.
  const prescription = instructionPrescription(activity);
  if (prescription) {
    const meta = document.createElement('span');
    meta.className = 'instruction-activity-meta instruction-activity-prescription';
    meta.textContent = prescription;
    li.appendChild(meta);
  }

  li.appendChild(figure);
  return li;
}

function renderInstructionList() {
  const tiles = document.getElementById('instruction-groups');
  const body = document.getElementById('instruction-body');
  tiles.innerHTML = '';
  body.innerHTML = '';
  const groups = guideGroups();
  // The tiles (with the Rotation card) alone on Workouts' page, a group's list alone on its own.
  document.getElementById('instruction-groups-card').hidden = guideGroupSlug !== null;
  body.hidden = guideGroupSlug === null;
  document.getElementById('instruction-rotation-card').hidden = guideGroupSlug !== null;

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
    rows.forEach((activity) => list.appendChild(makeInstructionCard(activity, logged.has(activity.name))));
    body.append(list);
  });
  updateGuideLogButton();
}

// 📝 shows on a group's page and is live once something is ticked.
function updateGuideLogButton() {
  const btn = document.getElementById('guide-log-btn');
  const ticked = document.querySelectorAll(GUIDE_TICKED_SELECTOR).length;
  btn.hidden = guideGroupSlug === null;
  btn.disabled = ticked === 0;
  btn.title = ticked ? `Log ${ticked} ticked to today's workout` : 'Tick activities to log them';
}

// Saves the ticked activities straight into today's workout; the page stays put.
async function logGuideTicks() {
  const btn = document.getElementById('guide-log-btn');
  const lines = [...document.querySelectorAll(GUIDE_TICKED_SELECTOR)]
    .map((box) => activityByName(box.dataset.name))
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
