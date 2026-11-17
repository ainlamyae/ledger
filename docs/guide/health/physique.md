# Health — Physique

[Docs](../../README.md) › Guide › Health

Physique is the daily log: one row per day holding body mass, sleep, food and workout, which every Health page reads.

## At a glance

- **Address:** `/health/physique/`; a day opens at `/health/physique/<date>/`.
- **One row per day:** saving onto a day already logged merges into it instead of adding a second row.
- **🧮 Calculate:** prices Consumption and Workout into calories, macros, TEF, duration and burn.
- **Patterns:** dateless template rows you can duplicate into a real day.
- **Stored, not recalculated:** Sleep, Deprivation and the day's BMR and body-mass figures are worked out once and saved.

## What it shows

- **Log table:** 28 days per page, newest first, plus every Pattern row at the top of each page.

| Column | Meaning |
|---|---|
| Date | The day |
| m | Body mass (kg) |
| S | Hours slept (hover for bed and wake times) |
| SD | Sleep Deprivation Effect (kcal) |
| TEI | Total Energy Intake (kcal) |
| Pro, DF, Fat, Crb | Protein, dietary fiber, fat, carbohydrate (g) |
| TEF | Thermic effect of food (kcal) |
| Dur | Active minutes |
| AEE | Activity Energy Expenditure (kcal) |

- **Today's row:** tinted green.
- **Log form:** a **Pattern** tick, then three dropdowns (open by default only on today's form).
  - **Day:** Date, Body Mass, Bed, Wake; the sleep duration updates live as you type.
  - **Consumption:** one food per line, with ingredient names suggested from Nutrition as you type.
  - **Workout:** one exercise per line, with names suggested from the Activity tab, keeping the amount (`36x row` → `36x Seated Row machine`).
- **Consumption Breakdown:** each food's Amount, Cal, Pro, DF, Fat, Crb and TEF, a Total row, and a source column.
  - **Source:** ✅ for a Nutrition match; otherwise `USDA` or `AI estimate (offline)`, with 💾 to save it to Nutrition and ✏️ to fix it first.
- **Workout Breakdown:** each exercise's Amount, MET, Dur and Cal, a Total row, and a source column.
  - **Source:** ✅ for an Activity match; **AI** for an AI-estimated MET (💾 save, ✏️ fix first); **Default** for MET 3.5.
- **Desire row:** on today's form only, under each Total, the day's desired figures.
- **Summary:** the Status card's rows worked out from the open form: m, m̄, Δm, BMI, Pro, DF, Fat, Crb, TEI, TEF, AEE, SD, BMR, M, D, Δm′.
  - **Columns:** Name, Amount, Desire, Remain (Desire − Amount, blank once met), Unit and a ✅/❌ mark.
- **🧬 Micronutrients:** a day's real nutrient totals: Nutrient, Amount, Supp / day, Ideal / day.

## Actions

- **📝 Log:** opens a blank day form.
- **📍 Today:** opens today's row, or a new form dated today.
- **🧬 (header):** nutrient totals over a range (1d, 1w default, 1m, 3m, 6m, 1y, All), with Total (period), Avg / day, Supp / day and Ideal / day.
- **Row actions:** ✏️ Edit, 📋 Duplicate, 🧬 Micronutrients, 🗑️ Delete.
- **📷 Scan:** pick a meal photo; the AI lists the foods with portions, appends them to Consumption and runs Calculate.
- **🧬 (form):** the day's Micronutrients view; the day must be saved first.
- **🧮 Calculate:** prices both text boxes and tidies them.
  - **Consumption:** merges duplicate lines, sorts by calories (highest first) and capitalizes names.
  - **Workout:** merges lines for the same exercise and unit, sorts by burn and title-cases names.
  - **Unknown foods:** priced from USDA, else by the AI; unknown exercises get an AI-estimated MET.
- **💾 Save:** writes the day; on a day already logged, the first Save merges that row into the form and the second commits.
- **Bulk 🧮 Calculate:** tick rows, then recalculate those days at once; lines already priced are reused, and it is one undo.
- **Search:** filters by date, consumption, breakdown or workout.

## Rules & calculations

- **Scaling groups:** wrap lines in `( … )/n` or `( … )*n` to share or multiply a portion; Calculate writes back the scaled lines.
- **Amounts in grams:** a counted food is stored by its Nutrition gram figure (`31g (1 scoop)` → `31g`).
- **Pricing:** each line keeps its saved numbers until its text changes; a food added to Nutrition later turns ✅ on the next Calculate.
- **Burn:** each day uses its own body mass, else the latest earlier one.
- **Duration:** active time only; rest and transitions are left out.
- **Patterns:** save Date, Body Mass, Bed, Wake, Workout, Duration and AEE blank, and never show in charts or Insight.
- **Stored figures:** a changed profile or BMR setting rewrites every day's figures in one request.
- **Warning:** saving a day short of its desired deficit glows the page edge red and shakes the form.
- **Confetti:** saving today's body mass closer to the healthy body mass than the last reading drops confetti.
- **Formulas:** see [Health formulas](../../reference/health-formulas.md).

## Data

- **Physique tab:** Date, Body Mass, Derived, Bed, Wake, Sleep, Deprivation, Consumption, Breakdown, TEI, Protein, Dietary Fiber, Fat, Carbohydrate, TEF, Workout, Duration, AEE.
  - **Matched by header name,** so you can reorder columns; your own extra columns and formulas are never touched.
  - **Derived:** JSON of the day's BMR_mif, BMR_kat, BMR_cal, BMR_adp and m, BMI, m_avg, m_d.
- **Nutrition and Activity tabs:** looked up by Calculate.
- **Browser:** AI exercise guesses are kept in `localStorage` (`ledger_activity_guesses`).
- **Columns in full:** see [Data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/health-physique.js` | Table, form, save, stored figures, micronutrient views |
| `assets/script/health-physique-breakdown.js` | Consumption pricing and tidy-up |
| `assets/script/health-physique-estimator.js` | USDA and AI food estimates |
| `assets/script/health-activity-estimator.js` | AI exercise estimates |

## Related

- [Today](today.md): today's figures from this log.
- [Nutrition](nutrition.md) and [Activity](activity.md): the catalogues Calculate reads.
- [Insight](insight.md): the Micronutrient mode uses the same nutrient tables.
