# Health — Nutrition

[Docs](../../README.md) › Guide › Health

Nutrition is your ingredient catalogue: the foods Physique's Calculate prices Consumption from, with their macros and micronutrients.

## At a glance

- **Address:** `/health/nutrition/`; the add form is `/health/nutrition/add/`.
- **One row per ingredient:** calories, protein, fiber, fat, carbohydrate and TEF for a stated Amount, plus a full micronutrient panel.
- **🧲 Complete:** fills an ingredient from USDA FoodData Central, scaled to its Amount.
- **📷 Scan:** reads a Nutrition Facts label photo with the AI.
- **📝 Log:** adds ticked ingredients to today's Consumption.

## What it shows

- **Ingredients table:** 25 per page.

| Column | Meaning |
|---|---|
| Group | Free-text group (Dairy, Poultry, Grain) |
| Name | Ingredient name |
| Amount | Portion the figures are for, grams first (`325g (1x)`) |
| Cal | Calories (kcal) |
| Pro | Protein (g) |
| DF, Fat, Carb | Dietary fiber, fat, carbohydrate (g): your typed figure, else from the micronutrient panel |
| TEF | Thermic effect of food (kcal): typed, else estimated from the macros |
| % | Protein %: its share of your desired protein, for Protein Source Rotation |

- **Default order:** ingredients in today's Consumption first (tinted green), then protein high to low, then Name A–Z.
- **Protein Source Rotation:** a copy of the Chart page's card, on the same range, below the table.
- **Add/Edit form:** Group, Name, Protein % and Amount, then one row per value: tick, name, box, unit.
  - **Fixed rows:** Calories, Protein, Dietary Fiber, Fat, Carbohydrates, TEF.
  - **Below a divider:** one row per micronutrient pulled (Iron, Vitamin C, …), Nutrition Facts lines first, every box editable.

## Actions

- **📝 Log (header):** appends each ticked ingredient to today's Consumption as `g name` (or `x name` for a counted food) and opens the day form.
  - You type the amount in front, then Calculate and Save; nothing is written until then.
- **➕ Add:** opens a blank ingredient form.
- **Search:** matches Group or Name, so `dairy` shows the whole group.
- **Bulk actions** (tick rows):
  - **🔗 Merge Selected:** merges near-duplicate rows; matching is exact text, never fuzzy.
  - **🔠 Capitalize Names:** capitalizes each word, skipping small joining words; local only.
  - **🧲 Complete:** fills each row's unticked values from its top generic USDA match.
- **Form buttons:**
  - **📷 Scan:** a label photo fills the unticked rows; %DV-only lines are converted with Health Canada Daily Values.
  - **🧲 Complete:** lists USDA's top 10 matches (generic, survey and branded) closest first; the one you click fills the unticked rows.
  - **📏 Norm:** capitalizes Name and rescales Amount and every value to 100 g.
  - **🔄 Update** (Edit only): saves, then rewrites every Physique day that used the old name, renaming and repricing those lines.
  - **📝 Log:** adds this ingredient to today's Consumption.
  - **💾 Save:** saves this row only.

## Rules & calculations

- **Ticked rows are locked:** Complete and Scan never overwrite them; Amount is always kept.
- **Gram figure:** `100g`, `100 g`, `100gr`, `100 gram` and `100 grams` all count; a bare `100` is a count, not grams.
- **Grams first:** `1x (325g)` is turned around to `325g (1x)` when saved.
- **Complete needs grams:** without a gram figure in Amount it stops with "Amount has no gram figure to scale from".
- **TEF:** a blank TEF uses protein, carbohydrate and fat at their Atwater kcal/g times each macro's TEF share (set in Settings).
- **Protein %:** shares are scaled so the tracked ingredients add to 100 %.
- **Update reprices** only lines whose unit can be rescaled by grams or count; for others (cup, tbsp) only the name changes.
- **Formulas:** see [Health formulas](../../reference/health-formulas.md).

## Data

- **Nutrition tab:** Group, Name, Amount, Calories, Protein, Fiber, Fat, Carbohydrate, TEF, Percent, Micronutrients.
  - **Micronutrients:** JSON of the six fixed values then every micronutrient, each `{amount, unit, locked}`.
  - **Matched by header name;** a missing column is added after the last used one, never over yours.
- **Physique tab:** Consumption and Breakdown, for Log and Update.
- **Columns in full:** see [Data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/health-nutrition.js` | Table, form, Complete, Scan, Norm, Update, Log |
| `assets/script/health-nutrition-usda.js` | USDA FoodData Central lookups |
| `assets/script/health-chart-protein-rotation.js` | Protein Source Rotation card |

## Related

- [Physique](physique.md): where ingredients are logged and priced.
- [Insight](insight.md): the Food and Micronutrient modes.
- [Chart](chart.md): Protein Source Rotation and the macro charts.
