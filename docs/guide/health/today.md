# Health — Today

[Docs](../../README.md) › Guide › Health

The Today cards show the day's energy budget, macros, activity, sleep and progress toward the healthy body mass.

## At a glance

- **Where:** at the top of the Health hub (`/health/`) and in the Health section of the home page.
- **Cards:** Status, Intake Macros, Physical Activity and Sleep side by side; Progress and Micronutrient Gaps full width below.
- **Colours:** a value reads green when it is on the right side of its desired figure, red when not, and muted when nothing is logged.
- **Same maths as the charts:** each card uses the same desired figures as the chart of the same name, so the two can't disagree.
- **Log reminder:** the Physique tile shows a **Log** badge until today has a Physique row, every day of the week.

## What it shows

- **Status:** today's whole energy budget, top to bottom; each row reads `today / desired unit`.

| Row | Meaning | Example |
|---|---|---|
| m | Today's body mass, m̄ (L_p-day average) in brackets, against the healthy body mass ± the glycogen + water swing | `80 (80.6) / 70 ± 1.9 kg` |
| BMI | BMI of m̄ against the BMI of the healthy body mass | `27.9 / 24.2 kg/m²` |
| Δm | Measured change: the slope of the smoothed body-mass trend, against the desired weekly fat loss ÷ 7 | `-108 / -101 g/day` |
| TEI | Total Energy Intake against the desired intake | `706 / 1335 kcal` |
| TEF | Thermic effect of food (digestion), against the TEF the desired intake would cost | `-118 / -167 kcal` |
| AEE | Activity Energy Expenditure against the desired activity burn | `0 / -358 kcal` |
| SD | Sleep Deprivation Effect against 0 (a full night costs nothing) | `16 / 0 kcal` |
| BMR_… | The one BMR picked in Tune, named by its key (`BMR_mif`, `BMR_kat`, `BMR_cal`, `BMR_adp` or `BMR_avg`) | `-1648 kcal` |
| M | Maintenance (BMR + AEE): today's, then with the desired AEE | `-1648 / -2003 kcal` |
| D | The day's net energy balance against the desired balance | `-1058 / -852 kcal` |
| Δm′ | Calculated change: D as fat mass (D ÷ 7700 kcal/kg), against the desired D converted the same way | `-137 / -111 g` |
| ETA | Days to the healthy body mass and the arrival date, as on the Progress card | `102 days (2027-01-27)` |

- **Not logged yet:** an empty day reads as 0 against its desired figure (`0 / 2100 kcal`), not `—`.
- **Row hovers:** each row's tooltip spells out its short label.
- **Intake Macros:** **Pro** (protein), **DF** (dietary fiber), **Fat** and **Crb** (carbohydrate), each as grams against its desired band (`53 / 112~154 g`).
- **Physical Activity:** **Cardio**, **NEAT** and **Strength**, each as `N min (-N kcal)`; informational only, so never coloured.
- **Sleep:** **Window** (bed–wake, `01:16-08:58`) and **Duration** against the desired sleep.
- **Progress:** two bars from the first body-mass reading.
  - **Body-mass bar:** kg lost (or gained on a bulk) and kg left, marked every 2 kg; the bubble shows today's reading with m̄ in brackets (`79.1 (80) kg`).
  - **Time bar:** days elapsed and days ahead, marked every 4 weeks, ending at the projected arrival date.
  - **Fill colour:** blends from red through amber to green as the goal nears; a wrong-direction bar stays red.
  - **Note:** a line appears under the bars only when there is no forecast: reached, no change, wrong direction or levelling off.
- **Micronutrient Gaps:** every nutrient whose last-week average (supplements included) is a mild or severe gap.
  - Shown as `average / ideal unit` (`0.006 / 1.6 g`), largest shortfall first, in two columns (one on a phone).
  - Reads **None** (all met) when there is no gap, and **no logged days** when the week is empty.

## Rules & calculations

- **Δm vs Δm′:** Δm is measured on the scale; Δm′ is worked out from the day's calories. The prime keeps them apart.
- **TEF:** the day's measured TEF if its macros are known, else the TEF share of intake set in Tune.
- **D:** TEI − BMR − AEE − TEF + SD, the same balance the Calorie Balance chart plots for each day.
- **SD colour:** green at 0, through amber to red as the short night costs more.
- **Green or red by goal:**
  - **TEI and D:** on a cut, green at or under the desired figure; on a bulk, at or over it.
  - **TEF:** green when more than desired on a cut, less on a bulk.
  - **AEE and Sleep Duration:** green at or over the desired figure.
- **Macro bands:**
  - **Pro, DF and Fat:** red under the floor, green in the band, still green over the ceiling.
  - **Crb:** muted under the floor, green in the band, red over the ceiling.
- **BMR:** read from today's stored Physique row (or the latest earlier one); a BMR not yet known falls back to the plain equation.
- **ETA:** "arrival" means past the healthy body mass by the glycogen swing, so one water-heavy day can't flip it.
- **Formulas:** see [Health formulas](../../reference/health-formulas.md).

## Data

- **Physique tab:** Date, Body Mass, Derived, Bed, Wake, TEI, Protein, Dietary Fiber, Fat, Carbohydrate, TEF, Workout, Duration, AEE.
- **Nutrition tab:** each ingredient's Micronutrients panel, for the Micronutrient Gaps card.
- **Setting tab:** the plan saved by Tune (healthy body mass, bands, BMR choice, swing) and `DAILY_SUPPLEMENTS`.
- **Columns in full:** see [Data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/health-chart.js` | Fills the four cards (`setStatusEnergyTile`) and Micronutrient Gaps (`renderTodayMicronutrientGaps`) |
| `assets/script/health-chart-projection.js` | Progress bars and the forecast behind ETA |
| `assets/script/health-physique.js` | Physique data and the **Log** badge |
| `assets/script/health-math.js` | Desired figures, m̄, energy balance |

## Related

- [Chart](chart.md): the same figures day by day.
- [Tune](tune.md): where every desired figure is set.
- [Physique](physique.md): logging the day.
- [Home](../home.md): the home page these cards also sit on.
