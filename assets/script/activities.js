// The exercise catalogue: one row per movement, read from the 'Activities'
// sheet tab. Single source for what used to live in five places at once — the
// Activity Plan's static tables, the Instruction modal's name list, the MET
// table (activity-estimator.js), the muscle-group map (activity-insight.js)
// and the gif/jpg animation list (strength-plan.js).
//
// Columns: Category · Group · Name · Unit · "Sets x Reps, Rest" · Image ·
// MET · Muscle Group. Name is the join key everything else matches on — it has
// to be exactly what the workout note lines carry.

const ACTIVITIES_RANGE = `'${CONFIG.SHEETS.ACTIVITIES}'!A2:H`;

// Compendium 02054 general value, for a name the sheet doesn't price.
// Distinct from charts.js's ACTIVITY_MET_FALLBACK, which is the assumed
// intensity for the daily activity TARGET rather than any one exercise.
const EXERCISE_MET_FALLBACK = 3.5;

let allActivities = [];
let activitiesByName = new Map();
let activitiesDataLoaded = false;

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
  let values = forceRefresh ? null : getCached('activities');
  if (!values) {
    const resp = await getValues(ACTIVITIES_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('activities', values);
  }

  allActivities = values
    .map((row) => {
      const name = String(row[2] || '').trim();
      const unit = String(row[3] || '').trim().toLowerCase();
      const { amount, rest, restSec } = splitAmountAndRest(row[4]);
      return {
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
      };
    })
    .filter((a) => a.name);

  activitiesByName = new Map(allActivities.map((a) => [a.name, a]));
  activitiesDataLoaded = true;

  renderActivityPlanTables();
  renderInstructionList();
}

function activityByName(name) {
  return activitiesByName.get(name) ?? null;
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

function makeActivityTable(group, rows) {
  // A rep/hold group gets the Sets x Reps + Rest pair; an amount-based one
  // (steps, minutes) has no sets and no rest to show.
  const isStrength = rows.some((a) => a.quantity.sets !== undefined);

  const table = document.createElement('table');
  table.className = isStrength ? 'workout-table-strength' : 'workout-table-neat';
  table.dataset.day = group;

  const headers = isStrength
    ? ['Exercise/Machine', 'Sets x Reps', 'Rest', 'Done']
    : ['Activity', 'Amount', 'Done'];

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach((label, i) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (i === headers.length - 1) th.className = 'workout-check-col';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  rows.forEach((activity) => {
    const tr = document.createElement('tr');
    tr.append(makeCell(activity.name), makeCell(activity.amount));
    if (isStrength) tr.appendChild(makeCell(activity.rest));

    const checkCell = document.createElement('td');
    checkCell.className = 'workout-check-cell';
    checkCell.appendChild(makeActivityCheckbox(activity));
    tr.appendChild(checkCell);

    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  return table;
}

function renderActivityPlanTables() {
  const container = document.getElementById('activity-plan-tables');
  container.innerHTML = '';

  if (!allActivities.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = `No activities yet — add rows to the "${CONFIG.SHEETS.ACTIVITIES}" tab (Category, Group, Name, Unit, "Sets x Reps, Rest", Image, MET, Muscle Group).`;
    container.appendChild(empty);
    return;
  }

  groupInOrder(allActivities, 'category').forEach((categoryRows, category) => {
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
      wrap.appendChild(makeActivityTable(group, rows));
      day.appendChild(wrap);

      container.appendChild(day);
    });
  });
}

// "3 x 10 · 90 sec rest", or the amount alone for a row with no rest to take
// (steps, minutes). Both halves come from the single cell splitAmountAndRest
// already divides, so the modal shows exactly what the plan table's Sets x Reps
// and Rest columns do.
function instructionPrescription(activity) {
  if (!activity.amount) return '';
  return activity.rest ? `${activity.amount} · ${activity.rest} rest` : activity.amount;
}

// The Instruction modal's list, grouped the same way. Figures come from the
// sheet's Image column — the slug guessing and the hand-maintained list of
// which movements were animated are both gone.
function renderInstructionList() {
  const body = document.getElementById('instruction-body');
  body.innerHTML = '';

  groupInOrder(allActivities.filter((a) => a.image), 'group').forEach((rows, group) => {
    const heading = document.createElement('h3');
    heading.textContent = group;

    const list = document.createElement('ul');
    list.className = 'instruction-activities';

    rows.forEach((activity) => {
      const li = document.createElement('li');

      const figure = document.createElement('img');
      figure.className = 'instruction-figure';
      figure.src = activity.image;
      figure.alt = `${activity.name}, movement guide`;
      figure.loading = 'lazy';
      // An Image cell pointing at nothing leaves the label standing on its
      // own, rather than a broken-image icon.
      figure.addEventListener('error', () => figure.remove(), { once: true });

      const label = document.createElement('span');
      label.className = 'instruction-activity-name';
      label.textContent = activity.name;

      li.append(figure, label);

      // The name is what you scan for, so the rest of the row sits under it at
      // plain weight: what the movement trains, then how much of it to do. A
      // line whose cell is blank on the sheet is skipped rather than printed
      // empty.
      [activity.muscleGroup, instructionPrescription(activity)]
        .filter(Boolean)
        .forEach((text) => {
          const meta = document.createElement('span');
          meta.className = 'instruction-activity-meta';
          meta.textContent = text;
          li.appendChild(meta);
        });

      list.appendChild(li);
    });

    body.append(heading, list);
  });
}
