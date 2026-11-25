# Health — Insight

[Docs](../../README.md) › Guide › Health

Insight sends a chosen slice of your Health data to an AI model and shows its read, with seven modes for different questions.

## At a glance

- **Address:** `/health/insight/`; each mode is its own page (`/health/insight/plan/`).
- **Seven modes:** Plan, Wellness, Food, Micronutrient, Activity, Protein, Pattern.
- **Preview first:** a mode shows exactly what would be sent; 🤖 Send to AI sends that same data.
- **Your own key:** uses Groq or OpenRouter, whichever `AI_PROVIDER` names.
- **Stale badge:** a mode last generated more than 30 days ago shows a red `<days>d` badge on its tile.

## What it shows

- **Range card:** 1w (default), 1m, 3m, 6m, 1y, All, each ending today; picking one reloads the open mode.
- **Insight card:** the seven mode tiles.
- **Ask card:** an optional question box and a **Prompt template** dropdown.
  - **Prompt template:** the full system prompt and user message, with on-screen data shown as `[data shown above]`.
- **Data card:** the data the mode will send, as lines or a table.
- **Response card:** the AI's answer, with when it was generated.

| Mode | What it sends | What it asks |
|---|---|---|
| Plan | Tune's saved plan, its equations and worked figures, plus Wellness's data for the range | Is the plan feasible, given what is actually logged? |
| Wellness | The range's averages against the equal-length period before it | How is it going, and what to change? |
| Food | Ingredients eaten, grouped by Group, with Calories, Protein, Fiber, Fat, Carbohydrate and TEF | What to eat more or less of |
| Micronutrient | Real nutrient totals from each ingredient's USDA panel, against ideal daily amounts | Which nutrients fall short |
| Activity | Rep volume against the period before, routine activities, and each muscle group with its exercises | Which muscles are neglected |
| Protein | Each tracked ingredient's desired protein share against what was eaten | How well eating matched the rotation |
| Pattern | Per-period averages (m, Δm, ΔM, BMRs, SD, macros, AEE by type, D, Offset) | Which habits line up with more fat loss and a higher BMR |

## Actions

- **Pick a range, then a mode tile:** loads that mode's data; nothing is computed before a tile is clicked.
- **Type a question:** optional; it is added to the prompt.
- **🤖 Send to AI:** sends the previewed data and shows the answer; the button stays off until a mode is loaded.
- **Pattern: period length:** an editable row above the table, starting at Tune's L_p; changing it re-splits the periods.
- **Micronutrient: hover a nutrient's name:** lists the ingredients that gave it; on a phone, tap the dotted name.
- **❌ Close:** leaves the page.

## Rules & calculations

- **Profile block:** every mode except Plan starts with age, sex, height, body mass with healthy body mass, and BMI.
- **Coverage:** where only some days are logged, the prompt says `[only N/M days logged]`.
- **Plan:** read from saved settings and m̄, not Tune's unsaved boxes, using the same functions as Tune.
  - It asks for **Verdict / What works / Risks / Do this / Avoid this**.
- **Food:** groups sorted by calories, `Unclassified` last; the table ends with Total and Avg/day rows.
  - **Avg/day:** divides by the days that have calculated data, not the range's calendar length.
- **Micronutrient:** sums real panel data only, so coverage is partial; the AI is told a missing nutrient is not a zero.
  - **Daily supplements:** each nutrient in `DAILY_SUPPLEMENTS` is added once per logged day, shown as **Supp / day**.
  - **Gaps:** a nutrient well under its Ideal / day is flagged red (mild or severe); running over is never flagged.
  - **Order:** Nutrition Facts lines first, then nutrients with an ideal, then the rest, each alphabetical.
  - **Hidden:** a nutrient at 0 with no ideal figure is left out.
- **Activity:** minutes are net active time, so the AI judges training by reps and muscle coverage, not time.
- **Protein:** uses the same figures as Protein Source Rotation, largest shortfall first.
- **Pattern:** periods with no logged day are greyed out and left out of the prompt.
- **Ideal / day:** mostly the FDA Daily Values, for a general adult; Tune's Save copies each macro band's minimum in.
- **Units:** shown once, in each row's last column; numbers keep at most 4 significant digits (1000+ whole), an Ideal in another unit is converted, and a missing value is a blank cell.
- **Safe output:** the answer is shown as plain text, never as HTML.

## Data

- **Physique, Nutrition and Activity tabs:** the logged days, ingredients and exercises for the range.
- **Setting tab:**
  - read: the plan, `DAILY_SUPPLEMENTS`, `MICRONUTRIENT_DAILY_DESIRED_JSON` and `AI_PROVIDER`;
  - written: each mode's last answer and time (`INSIGHT_<MODE>_LAST_RESULT`, `INSIGHT_<MODE>_LAST_GENERATED_AT`).
- **Columns and keys in full:** see [Data model](../../reference/data-model.md) and [Configuration](../../development/configuration.md).

## Code

| File | Role |
|---|---|
| `assets/script/health-insight.js` | Range, mode tiles, preview, send, badges (`INSIGHT_MODES`) |
| `assets/script/health-insight-plan.js` | Plan |
| `assets/script/health-insight-wellness.js` | Wellness |
| `assets/script/health-insight-food.js` | Food |
| `assets/script/health-insight-micronutrient.js` | Micronutrient totals and gaps |
| `assets/script/health-insight-activity.js`, `health-insight-protein.js`, `health-insight-pattern.js` | Activity, Protein, Pattern |
| `assets/script/health-nutrient-desired.js` | Ideal daily amounts and gap severity |

## Related

- [Tune](tune.md): the plan the Plan mode sends.
- [Physique](physique.md): the 🧬 Micronutrients views share this table.
- [Today](today.md): Micronutrient Gaps uses the same gap rule.
- [Configuration](../../development/configuration.md): AI keys and provider.
