# Health — Chart

[Docs](../../README.md) › Guide › Health

The Chart page plots every logged day against the plan: body mass, pace, calories, macros, activity, sleep and rotation.

## At a glance

- **Address:** `/health/chart/`; every chart reads the Physique tab, one row per day.
- **One range for all:** 1w, 1m (default), 3m, 6m, 1y, All, each ending today; every chart redraws together.
- **Graded colours:** bars and dots are coloured by how close the day came to its desired figure, in five grades.
- **Averages:** each average line smooths over Tune's period length L_p and is named for it (L_p = 7 reads **7-Day Average**).
- **📤 Screenshot:** saves a PNG of the whole page (share sheet on a phone, a download on a laptop).

## What it shows

- **Daily Progress:** a calendar heatmap (rows Monday to Sunday, one block per month), each day coloured as its Calorie Balance bar.
  - **Hover:** `2026-10-04: -450 kcal · Near desired`; a day with no calories logged is an empty square.
- **Body Mass:** one dot per reading joined by a thin grey line, with the L_p-Day Trend over them.
  - **Axes:** kg on the left, BMI (kg/m²) on the right.
  - **Overlays:** Healthy Body Mass (cyan marks), Healthy BMI (20–25) band, Calorie Trend, Glycogen + Water Swing and Muscle Loss.
  - **Calorie Trend:** body mass walked forward from logged calories alone; its gap to the trend is water, glycogen or missed logging.
  - **Hover:** the reading, BMI, Δm (Changed Mass) in g/day and the Calorie Trend with its slope.
- **Safe Pace:** the two "too harsh a cut" checks Tune makes, read off what actually happened.
  - **Weekly Loss** (left axis, %/wk): the trend's weekly change as a % of body mass.
  - **Deficit vs BMR** (right axis, % BMR): each day's (BMR − intake) ÷ BMR as faint dots, plus its L_p-Day Average.
  - **Zones:** Safe (green) up to the 1 %/wk = 20 % line, Too Fast (red) above, Gaining (amber) below 0.
- **Calorie Balance:** each day's balance D as a bar against the desired balance, with a grams-of-fat twin axis.
  - **Hover:** TEI, the BMR picked in Tune, AEE, TEF and SD (0 when none), then D and the L_p-Day Average.
- **Caloric Intake:** protein, dietary fiber, fat and carbohydrate as stacked kcal, scaled so the stack equals the day's TEI.
  - **Over it:** a graded TEI dot, the L_p-Day Average, the desired cap and a cap at the BMR picked in Tune.
  - **Hover:** `Protein: 480 kcal (120 g)` per segment.
- **Protein, Dietary Fiber, Fat and Carbohydrate Intake:** daily grams against a shaded desired band; grams on the right axis, kcal on the left.
- **Physical Activity:** stacked minutes per activity type (Strength, Cardio, NEAT, …) with a graded burn dot per day.
- **Sleep:** a floating bar from bed to wake per night on a clock axis (right), graded by hours ÷ desired sleep.
  - **Deprivation Effect dot** (left axis, kcal): green at a full night, through amber to full red at 60 kcal/day.
  - **L_p-Day Average Bed & Wake:** two smoothed clock-time lines.
- **Protein Source Rotation:** one bar per Nutrition Group: protein eaten in range, stacked by ingredient, with a red tick at its desired share.
  - **Donut:** reference Protein % (outer), last 4 weeks, last week (inner).
- **Activity Rotation:** one bar per Activity Group: sessions logged in range, with a red tick at its Weekly Desired scaled to the range.
  - **Donut:** Weekly Desired split (outer), last 4 weeks, last week (inner); bars coloured by Category.

## Actions

- **Range:** pick 1w, 1m, 3m, 6m, 1y or All; All starts at the first logged Physique day.
- **Legend switches:** click any legend entry to hide that series or grade; click again to bring it back.
  - The axes refit to what is still shown, and hidden entries stay hidden across range changes until reload.
- **📤 Screenshot:** draws every chart first, then shares or downloads `health-chart-<date>.png`.

## Rules & calculations

- **Grades:** each day's ratio (actual ÷ desired) picks a grade; colours blend smoothly between grades.

| Grade | Ratio from |
|---|---|
| Beat desired | 1.10 |
| Desired met | 0.85 |
| Near desired | 0.60 |
| Short of desired | 0.30 |
| Missed desired | below 0.30 |

- **Lift:** a day is lifted to one grade under its L_p-Day Average's grade, so one off day in a good stretch reads as a dip.
- **Band colours:**
  - **Protein:** red under the band, green in it, darker green over it (a ceiling, not extra credit).
  - **Dietary Fiber:** red under and over the band, green in it.
  - **Fat:** red under, green in, lighter green over (still within healthy limits).
  - **Carbohydrate:** muted under the band (not a deficiency), green in it, red over it.
- **No band saved yet:** Fat falls back to 65 g and Carbohydrate to 275 g (USDA reference values).
- **SD:** added to the balance, never subtracted, since a short night shrinks a deficit and grows a surplus.
- **Trend:** an exponential moving average over L_p days, run on the full history then cropped to the range.
  - It restarts after a gap of more than 14 days without a reading.
- **Shared dates:** every dated chart uses one date list and eight evenly spaced gridlines, so dates line up down the page.
- **Rotation shares:** each ingredient's Protein % is scaled so the tracked ones add to 100 %, then taken of the top of the protein band.
- **Sessions:** a day counts as a session for every Activity Group its Workout touches.
- **Hovers:** every line reads `label (definition): number unit`, with a sign only on negatives.
- **Formulas:** see [Health formulas](../../reference/health-formulas.md).

## Data

- **Physique tab:** every column; see [Physique](physique.md).
- **Nutrition tab:** Group and Percent, for Protein Source Rotation.
- **Activity tab:** Category, Group and Weekly Desired, for Physical Activity and Activity Rotation.
- **Setting tab:** the plan saved by Tune.
- **Columns in full:** see [Data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/health-chart.js` | Range, grades, shared dates; draws every chart (`renderHealthCharts`) |
| `assets/script/health-chart-body-mass.js` | Body Mass |
| `assets/script/health-chart-safe-pace.js` | Safe Pace |
| `assets/script/health-chart-energy-balance.js` | Calorie Balance |
| `assets/script/health-chart-intake.js` | Caloric Intake |
| `assets/script/health-chart-protein.js`, `-fiber.js`, `-fat.js`, `-carb.js` | The four macro charts |
| `assets/script/health-chart-activity.js`, `health-chart-sleep.js` | Physical Activity and Sleep |
| `assets/script/health-chart-heatmap.js` | Daily Progress |
| `assets/script/health-chart-protein-rotation.js`, `health-chart-activity-rotation.js` | The two Rotation charts |
| `assets/script/charts-base.js` | Shared chart helpers, legend switches, screenshot |

## Related

- [Today](today.md): the same figures for today only.
- [Tune](tune.md): sets every desired figure and L_p.
- [Nutrition](nutrition.md) and [Activity](activity.md): each carries a copy of its Rotation card.
- [Design system](../../reference/design-system.md): chart colours and conventions.
