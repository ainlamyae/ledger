# Conventions

[Docs](../README.md) › Reference

The one name, unit and format each thing uses everywhere in Ledger.

## At a glance

- **Body mass, never weight:** for the body; an exercise's load is **Load**.
- **Goal words:** the body-mass goal is **healthy**; every other goal is **desired**; no other word for a goal.
- **Hover format:** `label (definition): number unit`, with a sign on negatives only.
- **Dates:** stored and typed as `YYYY-MM-DD`; shown as `YY-MM-DD` in tables and on chart axes.
- **Units:** standard symbols only (`g`, `mg`, `µg`, `IU`, `kcal`).

## Wording

- **Body mass:** the body has body mass, in text, labels, keys and ids.
- **Healthy:** the body-mass goal (`BODY_MASS_HEALTHY_KG`, Healthy Body Mass, healthy BMI band).
- **Desired:** every other goal (desired intake, desired sleep, `SLEEP_DESIRED_HOURS`, Weekly Desired).
- **Load:** an exercise's dumbbell or machine load; the Activity tab's header can stay `Weight`.
- **Physique labels:** form labels match sheet headers: **Bed**, **Wake**, **Sleep**, **Deprivation**.
- **Log:** the button always reads **Log**.
- **Panel headings:** one word: **Activity**, **Nutrition**, **Account**, **Contact**, **Chart**.
- **Search boxes:** read `🔍 Search`; what each one searches is its hover title.
- **Button names:** pages and docs use the app's own names, emoji included (💾 Save, 🧮 Calculate).
- **Tab names:** live only in `CONFIG.SHEETS` (`config.js`), so renaming a tab is one line.

## Abbreviations

| Short | Long | Unit |
|---|---|---|
| m | Body Mass | kg |
| m̄ | L_p-day average body mass | kg |
| BMI | Body Mass Index | kg/m² |
| TEI | Total Energy Intake (Calories In) | kcal |
| AEE | Activity Energy Expenditure (Calories Out) | kcal |
| TEF | Thermic Effect of Food | kcal |
| SD | Sleep Deprivation Effect | kcal |
| D | Balance (daily energy balance; negative is a deficit) | kcal |
| Δm | Changed Mass | g/day or kg/week |
| DF | Dietary Fiber | g |
| LBM | Lean Body Mass | kg |

## BMR names

| Key | Definition |
|---|---|
| `BMR_mif` | Mifflin-St Jeor BMR |
| `BMR_kat` | Katch-McArdle BMR |
| `BMR_cal` | Calibrated BMR |
| `BMR_adp` | Adapted BMR by t |
| `BMR_avg` | Average BMR |

- **Same five names:** in the Physique form, Status card, Tune, Derived cell and every hover.
- **One shown:** where only one BMR appears (Status, Caloric Intake, Calorie Balance), it is the one selected in Tune.

## Units

- **Symbols:** `g`, `mg`, `µg`, `IU`, `kcal`; never USDA's `G`, `MG`, `UG`.
- **Everywhere:** forms, tables, Insight and the sheet itself.
- **Body mass:** stored in kg; its rate of change shows as g/day.

## Dates and times

- **Stored and typed:** `YYYY-MM-DD` (`2026-10-04`) in the sheet and every form field.
- **Shown:** `YY-MM-DD` (`26-10-04`) in tables, chart axes and chart hovers, via `shortYearDate`.
- **Chart x axes:** every dated chart uses `datedCategoryXScale`: eight evenly spaced `YY-MM-DD` ticks at 45°.
- **Word dates:** heatmap month labels only, via `wordDate`: `Aug 26`.
- **Times:** `HH:MM`, 24-hour.
- **Home Date card:** the one exception, reading year, month and day.

## Chart hovers

| Rule | Example |
|---|---|
| `label (definition): number unit` | `TEI (Total Energy Intake): 829 kcal` |
| Sign only on negatives | `D (Balance): -420 kcal`, never `+180` |
| L_p-Day Average is an amount, no `/day` | `1309 kcal`, `134 g`; sleep averages are clock times |
| L_p-Day Trend is a slope, always `/day` | `-71 g/day` |
| Same name everywhere | One series keeps one label across every chart, tile and legend |

- **Legends:** name entries in words (`Healthy Body Mass`, `Mifflin-St Jeor BMR`); hovers keep the symbols.

## Related

- [Design system](design-system.md): colours, type, spacing, tables, buttons, charts.
- [Health formulas](health-formulas.md): every Health formula, constant and default.
- [Data model](data-model.md): every sheet tab, column by column.
