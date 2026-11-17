# Health — Activity

[Docs](../../README.md) › Guide › Health

Activity is your exercise catalogue and plan, with Workouts, a picture guide for each group, and quick logging into today's Physique row.

## At a glance

- **Address:** `/health/activity/`; Workouts is `/health/activity/workouts/` and the add form `/health/activity/add/`.
- **One table:** every activity on the Activity tab, grouped by Category then Group.
- **📝 Log:** sends ticked activities to today's Physique Workout, priced like Calculate.
- **💪 Workouts:** one tile per Group; each group page shows a card per exercise with its figure.
- **Activity Rotation:** a copy of the Chart page's card sits at the top of Activity and on the Workouts tiles page.

## What it shows

- **Plan table:** a tick box, Category, Group, Activity, then Muscle Group, Load, Amount and Rest where any row uses them.
  - A line marks each change of Group.
  - **Amount:** sets × reps (`3 x 10`) or a single amount (`10000 step`, `30 min`).
  - **Row actions:** ✏️ Edit, 📋 Duplicate, 🗑️ Delete.
- **Logged today:** rows already in today's Workout are ticked and tinted green; the marks survive a reload and clear at midnight.
- **Workouts tiles:** one per Group (strength days, Cardio, NEAT), in a card titled **Workouts**, with Activity Rotation below.
- **Group page** (`/health/activity/workouts/<group>/`): one card per exercise.
  - **Card:** the name, then `Load · 3 x 10 · 90 sec rest`, then its figure with the muscle worked marked in red.
  - **Figure:** an animated loop or a start-and-finish still; an activity with no image keeps an empty box.

## Actions

- **📝 Log (header):** opens today's Physique form with the newly ticked lines added and the workout half of Calculate run; nothing is written until 💾 Save.
  - Free text already in today's Workout is kept; the hover says whether today already has lines.
- **➕ Add:** opens a blank activity form.
- **💪 Workouts:** opens the Workouts tiles.
- **Workouts quick log:** tap cards (or their corner tick) to pick them, then 📝 saves them straight into today's Physique row, with an undo toast.
  - Needs a body mass on record; cards already logged today are green and can't be picked again.
  - **✏️** on a card opens that activity's Edit page; closing it returns to the group.
- **Activity form:** Category, Weekly Desired, Group, Name, Muscle Group, Unit, Sets x Reps, Rest, Load, MET, Image.
  - **Image:** a path or URL, previewed under the field.
  - **🔄 Update** (Edit only): saves, then renames and reprices every Physique day whose Workout used the old name.
  - **📝 Log:** logs what is typed as one line of today's workout without saving it to the catalogue.
  - **💾 Save:** saves the row.

## Rules & calculations

- **Name is the key:** a second activity with an existing name is refused; 📋 Duplicate fills in `… (copy)` so it saves cleanly.
- **Deleting:** days already logged keep their lines but lose that MET, and stack under `Other` if recalculated.
- **Unit:** `x` reps, `sec` timed hold, `step` step count, `min` fixed duration.
- **Duration:** active time only, with no rest or transitions.
  - Each rep takes `WORKOUT_REP_SEC` seconds (default 3), and steps count at `WORKOUT_STEPS_PER_MIN` (default 100).
- **Burn:** MET × body mass × active minutes × κ ÷ ε (κ and ε as in Tune); a blank MET uses 3.5.
- **Walk's MET:** also the MET Tune uses for the desired activity.
- **Weekly Desired:** sessions per week for the whole Group; blank leaves the Group out of Activity Rotation.
- **Formulas:** see [Health formulas](../../reference/health-formulas.md).

## Data

- **Activity tab:** Category, Group, Name, Unit, Sets x Reps + Rest (one cell), Image, MET, Muscle Group, Weight (shown as **Load**), Weekly Desired.
- **Physique tab:** Workout, Duration and AEE for today's row.
- **Images:** `assets/images/activities/<slug>.gif` or `.jpg`, loaded only when Workouts first opens.
- **Columns in full:** see [Data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/health-activity-catalogue.js` | Plan table, activity form, Workouts tiles and cards |
| `assets/script/health-activity.js` | Log and Workouts quick log (`applyWorkoutLines`, `quickLogWorkoutLines`) |
| `assets/script/health-activity-estimator.js` | Active time per line and AI exercise estimates |
| `assets/script/health-chart-activity-rotation.js` | Activity Rotation card |

## Related

- [Physique](physique.md): where workouts are logged and priced.
- [Chart](chart.md): Physical Activity and Activity Rotation.
- [Insight](insight.md): the Activity mode.
