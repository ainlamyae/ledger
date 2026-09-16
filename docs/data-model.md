# Data Model

[← Back to README](../README.md)

One Google Sheet per user, cloned from the template, with these tabs.

## `Transaction`

| Column | Type | Notes |
|---|---|---|
| A — Date | Date | ISO format |
| B — Account | Text | Must match a name in `Account` column A |
| C — Payee | Text | Merchant / person / institution |
| D — Category | Text | Must match a category in `Breakdown` column A |
| E — Description | Text | Optional detail; its `Type - ` prefix drives the Type donuts |
| F — Amount | Number | Positive = income, negative = expense — the sign alone defines the type |

## `Account`

| Cell/Column | Type | Notes |
|---|---|---|
| D1 | Number (formula) | Net Worth, e.g. `=ROUND(SUM(D3:D100),2)` |
| Row 2 | Header | `Account \| Institute \| Type \| Balance \| Market Value` |
| A3:A | Text | Account name — also the dropdown source for `Transaction` |
| B3:B | Text | Institution |
| C3:C | Text | `Cash`, `Chequing`, `Saving`, `Credit`, `Investment`, `Person`, `Other`, … |
| D3:D | Number | Balance — the deposited/book figure that ties out to transaction history |
| E3:E | Number, optional | Market Value — today's redemption/cash-out value, where it differs from Balance (interest-bearing or investment accounts). Blank means "not tracked" and renders as `—`; not included in any sheet formula |

- **Reconciliation** — computed client-side, not a sheet formula: `D1` (recorded balances) minus `Statement`'s last row, Cumulative column (transaction history). Non-zero means a balance is wrong or a transaction is missing. Uses Balance, not Market Value — Market Value is informational only.
- **Your own formulas in these cells survive an edit.** Any of the five columns may hold a formula (a Market Value written as `=D7*1.02`, a balance summing another tab). The list reads the *computed* numbers, so the edit form takes a second single-row read rendered as **formulas** and shows a formula cell as its formula text; leaving the box alone sends that text back verbatim. Editing an account used to write the computed figure into all five cells, replacing the formula with whatever it produced that day. You can also type a new formula into Balance or Market Value — anything starting with `=` that isn't plain arithmetic goes to the sheet as a formula, while `=5000-1234.56` is still evaluated here and stored as a plain number.

## `Statement` (formula-driven)

`SUMIFS` against `Transaction`; row 1 is the header.

| Column | Contents |
|---|---|
| A | Month label |
| B | Income |
| C | Expenses |
| D onward | One column per category in `Breakdown` column A, matched by header name |
| Second-to-last | Saved (income − expenses) |
| Last | Cumulative savings |

- Category columns are matched by name; `Income`/`Expenses` are excluded even if `Breakdown` lists them.
- `Saved`/`Cumulative` are always the last two columns, so inserting a category doesn't break them.
- The summary cards' quarter average is the mean of the **3 rows before** the active month. Still computed for both Income and Expenditure — Income's is a tooltip and a Financial Insight figure rather than a second number on the card.

## `Breakdown` (formula-driven)

- Per-category, per-`Type` spend for the Type donuts. Data starts at row 2.
- Columns: Category, Type, Last Month, Last Quarter, Last Year, Lifelong.
- `Type` is a free-text prefix on `Transactions.Description`, not a column.
- Column A is the source of the app-wide category list; the form isn't limited to it.
- A blank `Type` row holds the category's overall total (the "Untyped" remainder).

## `eTimeSheet`

- One row per logged day: Company, Date, Day, Start, End, Break, Duration, Task.
- A weekday with a Task note but no times is a holiday; one with neither is a missed entry.

## `Activity`

The exercise catalogue — one row per movement, and the single source for what used to be spread across five places (the Activity Plan's static tables, the Instruction modal's list, the MET table, the muscle-group map, and the gif/jpg animation list). Not in the template by default; add the tab and header row. Editable from the Activity Plan panel (Add Activity, and ✏️ / 📋 / 🗑️ per row) as well as directly on the sheet.

| Column | Type | Notes |
|---|---|---|
| A — Category | Text | `Strength`, `Cardio`, `NEAT`, … **What the Physical Activity chart stacks by** |
| B — Group | Text | Free text; the Activity Plan sub-table this row renders into, and its heading |
| C — Name | Text | The join key — must match the workout note lines exactly. A name not listed here is priced at the fallback MET, gets no muscle group, and stacks under `Other` |
| D — Unit | Text | `x` (reps), `sec` (hold), `step`, `min`. Tells `3 x 45 sec` (a hold) from `3 x 15` (reps) |
| E — Sets x Reps, Rest | Text | `3 x 10, 90 sec` · `3 x 45 sec, 45 sec` · `6000 step` · `30 min`. Split on the **last** comma; the rest half is optional. Both halves show in the plan table's two columns and under the Instruction modal's figures |
| F — Image | Text | URL or repo-relative path to the Instruction modal's figure. Blank means label-only. Also previewed live under the Edit/Add Activity form's own Image field, so a path can be checked before Save — `renderActivityImagePreview` in `activities.js`, hidden again if the path 404s |
| G — MET | Number | Metabolic equivalent for the burn formula |
| H — Muscle Group | Text | Drives the neglected-muscle Insight, and shown under each Instruction modal figure's name. The reported groups are whatever this column names, so a new one needs no code change |
| I — Weight | Text | Freeform, e.g. `45 lbs` or `20kg`. Shown in the Instruction modal, leading the Sets x Reps/Rest line (`45 lbs · 3 x 15 · 60 sec rest`) rather than trailing it, and as its own column in the plan table when any row in the group has one |

- Both the displayed cell and the checkbox's quantity attributes are built from column E, so they can no longer disagree — they had, on 24 of 34 rows, which made Log a Workout and a later Recalculate differ by up to ~15% on the same exercise.
- A missing or unreadable tab costs the plan tables and the category split (everything lands under `Other`); the charts still render.

## `Physique`

One row per **day**, rather than one row per logged event. **This is the tab every chart, today-tile, Insight mode, Protein Source Rotation and Activity Plan tick reads.** Not in the template by default; add the tab and header row.

| Column | Type | Notes |
|---|---|---|
| A — Date | Date | ISO. One row per date — saving onto a date already logged **merges** into that row rather than adding a second (see below). **Blank marks a reusable pattern row** — excluded from every chart and Insight mode, always sorted to the top, and exempt from the one-row-per-date rule |
| B — Bedtime | Time | `HH:MM` |
| C — Wake-up Time | Time | `HH:MM`. The table shows one **Sleep** column, not these two — wake minus bed, wrapping past midnight, with the raw clock times on hover and on Edit |
| D — Body Mass | Number | kg |
| E — Consumption | Text | Free text, one food per line |
| F — Breakdown | Text (JSON) | Calculate's per-item breakdown — `{name, amount, calories, protein, fiber, fat, carbohydrate, tef, source, noteLine, newRow}` per row, in that key order (matching `Nutrition`'s own column order below), with `fiber`/`fat`/`carbohydrate`/`tef` present only once that ingredient has a typed figure on its `Nutrition` row or its 🧬 Micronutrients has been pulled. Rendered as one table under the form; the table lists it as an item count with the names on hover |
| G — Calories In | Number | kcal. Hidden on the form — Calculate fills it, and the breakdown table's Total row is where you read it |
| H — Protein In | Number | grams. Hidden on the form, same as Calories In |
| I — Fiber | Number | grams. Hidden on the form, same as Calories In — summed from the day's own Breakdown items (their own typed Fiber, or their pulled 🧬 Micronutrients) |
| J — Fat | Number | grams. Hidden on the form, same as Fiber |
| K — Carbohydrate | Number | grams. Hidden on the form, same as Fiber |
| L — TEF | Number | kcal. Estimated Thermic Effect of Food, from the day's own Breakdown ingredients' protein/carb/fat grams (their own typed figures on `Nutrition`, or their pulled 🧬 Micronutrients panel) times Atwater (4/4/9 kcal/g) and each macro's TEF share — `TEF_PROTEIN_PERCENT`/`TEF_CARB_PERCENT`/`TEF_FAT_PERCENT` Settings, defaulting to 25% / 7.5% / 2%. Hidden on the form, same as Calories In — Calculate (single-day or the bulk bar's) fills it, writing each row's own Fiber/Fat/Carbohydrate/TEF into the breakdown table alongside Cal/Pro, whenever the ingredients have macros pulled or typed; otherwise it's left as-is. Null on a day with no measurable ingredients, not a confident zero. A day logged before this column existed is caught up the same way — re-run Calculate on it (single-day or bulk). Calorie Balance and State Trend & Forecast's Calorie-Implied Trajectory use this day's own figure when it's set, falling back to `TEF_PERCENT_OF_INTAKE` (flat % of that day's Calories In) otherwise |
| M — Workout | Text | Free text, one activity per line |
| N — Activity Duration | Number | minutes. Hidden on the form — read off the activity table's Total row |
| O — Calories Out | Number | kcal. Hidden on the form, same as Activity Duration |

- Every numeric field accepts an arithmetic expression (`30+15`).
- **Saving onto a date already logged merges, in two steps.** The first Save writes nothing: it folds the row already on the sheet into the open form, switches to editing that row, and leaves the combined day on screen with a note. The second Save commits it — `editingPhysiqueRow` is now set, which excludes that row from the collision lookup. How each field merges follows from what it is: Consumption, Workout and Breakdown are lists and concatenate (saved lines first, then the new ones, verbatim — a food eaten twice really is two lines, and **Combine & Sort** exists for when it isn't); Calories In / Protein In / Fiber / Fat / Carbohydrate / TEF and Duration / Calories Out are totals over those lists and add up (Fiber/Fat/Carbohydrate/TEF are then replaced with the exact figures re-estimated off the merged Breakdown, where that's possible); Bedtime, Wake-up Time and Body Mass are single facts, so a typed value wins and the saved one only fills a blank. Duration and Calories Out are then repriced off the merged Workout as one session, with the sums standing if there's no body mass to price them.
- **Pattern** on the form saves a dateless template — a meal or session you repeat — that 📋 Duplicate turns into a real day, dated today with its contents intact. Patterns never reach a chart, tile or Insight mode.
- **Calculate** runs both estimators at once: Consumption fills Breakdown, Calories In and Protein In (`calorie-estimator.js`), and also writes each row's own Fiber/Fat/Carbohydrate/TEF (`estimateTefBreakdown`, `micronutrient-insight.js`) for whatever already has a typed `Nutrition` figure or pulled 🧬 Micronutrients; Workout fills Activity Duration and Calories Out (`activity-estimator.js`). The breakdown table is `renderCalcBreakdown` (`calorie-estimator.js`), drawn into this form via its `target` argument — 💾 banks a new ingredient to `Nutrition` from here too. Editing Consumption never touches the breakdown; it goes stale until you press Calculate again.
- **One breakdown table, one row per ingredient**: Name, Amount, Cal, Pro, DF, Fat, Carb, TEF, Source. DF/Fat/Carb/TEF read "—" rather than a confident 0 on a row whose ingredient has neither a typed figure nor 🧬 Micronutrients pulled. The table is display-shortened, never data-shortened: a `Nutrition` source renders as ✅ (the common, trusted case), and every float (DF, Fat, Carb, and the merged Total row) rounds to 1 decimal for compactness — the saved JSON keeps the fuller value, so an already-saved breakdown re-renders identically without its stored values changing.
- **Source and Save are one column.** They can never both carry content: a Nutrition hit *is* the banked row, so it never gets a `newRow`, while an estimate carries one until 💾 banks it. So the cell is either a lone ✅ or the estimator's name followed by 💾.
- **Column widths come from the content, not an even split.** Every column but Name is bounded by its own header — the abbreviated `Cal`/`Pro`/`DF`/`Fat`/`Carb`/`TEF` headers are each wider than the figure they hold — so each is pinned to its content with `nowrap` and Name takes `width: 100%` of the remainder, on a compact table with tighter padding and no per-row border than the app's other tables carry.
- **Each side gets a table, and all totals are read off them** — the number fields behind them are hidden. Under Consumption sits the breakdown (per ingredient, summed to Calories In / Protein In / Fiber / Fat / Carbohydrate / TEF); under Workout, the activity table (per exercise: quantity, the MET it was priced at, minutes and kcal, summed to Activity Duration / Calories Out — `renderPhysiqueActivityBreakdown`, `physique.js`). The activity table is stored nowhere: it's local arithmetic over the Workout text, so opening a day recomputes it (`refreshPhysiqueActivityBreakdown`) rather than reading a saved copy — **and that recompute writes N and O**, so Save persists the figures on screen instead of the older ones behind them. Opening a day after changing `WORKOUT_REP_SEC` or an Activities MET and saving it is therefore enough to reprice it. A workout the parser can't read (or a day with no body mass to price it) writes nothing and keeps the pair it was saved with. Per-row minutes carry one decimal, since a strength line is often well under a minute of active time; rounding means the rows can add up a hair off the Total.
- **The main Physique table also shows DF/Fat/Carbohydrate** between Protein In and TEF, summed from each day's own Breakdown items (`physiqueDayMacros` via `sumBreakdownMacros`) — a quick-glance read of the same figures Calculate persists into I/J/K, not a separately-computed estimate.
- **The table's own column order is Date, m, Sleep, then the rest** — not the sheet's A–O order (which keeps Bedtime/Wake-up Time ahead of Body Mass) — followed by a computed **SD** column: that day's Sleep Deprivation Effect in kcal (`dailyEnergyBalanceKcal`, off the day's own Body Mass, Calories In, Calories Out and TEF against the profile's BMR), shown without a sign and reading `—` without a profile, a logged Body Mass or Calories In to work from. The same figure is echoed live in the Log form beside **Sleep Duration**, off whatever's typed so far rather than a saved day. The headers are abbreviated to fit the narrow columns — **m** (Body Mass), **SD** (Sleep Deprivation), **TEI** (Calories In / Total Energy Intake) and **AEE** (Calories Out / Activity Energy Expenditure) — each spelled out in its own `title` tooltip.
- **Calculate is incremental.** Each breakdown item records the standardized line it produced (`noteLine`), and Calculate writes those lines back into Consumption — so on a re-run, any line still matching one of them reuses its numbers verbatim and only the leftovers reach Groq/USDA. Editing one ingredient in a ten-line day costs one lookup, not ten; re-running an unchanged day costs none. A breakdown saved before `noteLine` existed matches nothing and re-estimates in full, exactly as it used to. The same ingredient typed twice reuses one saved item and re-estimates the other, rather than double-counting one result. When nothing is reused the estimator's own totals pass straight through, so a first Calculate is exact; a mixed run re-sums the (already rounded) per-item figures and can differ by a fraction. Either field can be left empty — only the filled side runs, and neither side's failure stops the other. The burn formula takes body mass from this day's own field, falling back to the most recent day that recorded one.
- **Fiber/Fat/Carbohydrate/TEF** (`estimateTefBreakdown`, `micronutrient-insight.js`) read each Breakdown ingredient's own typed Fiber/Fat/Carbohydrate/TEF from its `Nutrition` row when one's been saved, otherwise its pulled 🧬 Micronutrients panel (Fiber/Fat/Carbohydrate) and the Atwater/TEF-share formula (TEF), scaled to how much of it was actually logged (the same per-ingredient scaling `aggregateMicronutrientIntake` uses for the Health Insight Micronutrients mode). It rebuilds each matching breakdown row (in the same field order as `Nutrition`'s own columns) rather than a separate table — a day whose ingredients have nothing measurable is left exactly as it was, reading as "not measured" rather than a measured zero. There's no standalone TEF action any more (single-day or bulk); Calculate runs it as part of the same pass that fills Cal/Pro, so catching up an old day just means re-running Calculate on it.
- **TEF_PROTEIN_PERCENT / TEF_CARB_PERCENT / TEF_FAT_PERCENT** Settings tune each macro's TEF share of its own calories — default 25% / 7.5% / 2%, the commonly-cited per-macro figures. Not in the template; add rows for them via the Settings panel's **Add** button only if you want to change the defaults.

## `Nutrition`

One row per ingredient. Data starts at row 2. Not in the template by default — add the tab and header row.

| Column | Type | Notes |
|---|---|---|
| A — Classification | Text | Free-text grouping (`Dairy`, `Poultry`, `Grain`). Drives the Food insight grouping and Protein Source Rotation colours. Left blank by Calculate's auto-bank |
| B — Name | Text | Matched case-insensitively against the text *you typed*, never the AI's rephrasing |
| C — Amount | Text | Needs a gram figure (`100g`, `1 scoop (32g)`) to scale by weight, or a leading count (`1 rice cake`) to scale by count |
| D — Calories | Number | kcal for the stated Amount |
| E — Protein | Number | grams for the stated Amount |
| F — Fiber | Number | grams for the stated Amount. Optional — typed by hand, pre-filled in the Edit Ingredient form from the pulled 🧬 Micronutrients panel (column L) when you haven't typed one yourself |
| G — Fat | Number | grams. Same as Fiber |
| H — Carbohydrate | Number | grams. Same as Fiber |
| I — TEF | Number | kcal. Same as Fiber, except its estimate (when you haven't typed one) is the Atwater/TEF-share formula over this row's own Protein plus whichever Fat/Carbohydrate this same resolution just settled on, not a raw Micronutrients read |
| J — Verification | Text | `1` = you checked it against a real label. Only ever set by hand — never by Calculate or the USDA lookup |
| K — Percent | Number | Blank excludes the ingredient from Protein Source Rotation; a number is its % share of your protein target |
| L — Micronutrients | Text (JSON) | Full USDA nutrient panel (macros and micros), scaled to this row's own Amount — written only by 🧬 Pull Micronutrients (form or bulk table action), never by hand |

- **Fiber/Fat/Carbohydrate/TEF resolve typed-over-estimated** (`resolvedNutritionMacros`, `nutrition.js`): your own saved figure when there is one, otherwise Fiber/Fat/Carbohydrate read off the pulled Micronutrients panel and TEF computed from Atwater/TEF-share — same fallback order the Physique breakdown table uses per-ingredient. The Edit Ingredient form pre-fills all four from this same resolution, so opening a row, reviewing the estimate and hitting Save is what "confirms" it as a typed figure from then on.
- **Protein/100kcal** used to be a computed Density column; removed in favor of the Fiber/Fat/Carbohydrate/TEF columns above.
- Rows are added three ways: manually, via the breakdown's 💾 button (or ✏️, which opens the same Add Ingredient form pre-filled before banking — see [Food logging](health-formulas.md#food-logging-calculate)), or auto-banked by Recalculate Selected — a fresh row this way carries Classification (blank) through Protein always, and Fiber/Fat/Carb too whenever a typed anchor or a fresh USDA lookup supplied one that Calculate run; TEF/Verification/Percent/Micronutrients are still left for you (or 🧬 Pull Micronutrients) to fill in.
- Lookup tries exact match, then folds a trailing "s" off both sides, before reporting a miss.

## `Contact`

- One row per contact, columns A–U: names, prefix, tags, birthday, 3 phones, 2 emails, address, links, note.
- Not in the template by default; `scripts/merge_contacts.py` builds a deduplicated starting point.

## `Travel`

- One row per movement: Country/City, Port, Type (Arrival/Departure), Via, Date, Time, Reason, Detail.
- Arrivals are paired with their closing Departure; an open-ended final Arrival counts up to today.

## `Application`

- Columns A–E: Delay, Date, Action, Type, App Number.
- A row with both Type and App Number starts an application; following rows are its status updates.
- New applications are inserted at row 2 so the sheet's footer formulas shift down intact.

## `Setting` (optional, user-managed)

- Columns A/B/C — Key, Value, Notes. Notes is never read by the app.
- Missing tab or row falls back to hardcoded defaults.
- Written with `RAW` so a computed value round-trips byte-for-byte.
- `TAX_RATE_PCT` — the rate the Transaction form's **Tax** button applies. Defaults to `13`.

---

