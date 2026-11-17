# Data model

[Docs](../README.md) › Reference

Every tab of the Google Sheet behind Ledger, column by column.

## At a glance

- **One sheet per user:** cloned from the template; tab names live only in `CONFIG.SHEETS` (`config.js`).
- **Finance:** Transaction, Account, Statement, Breakdown, Watchlist, Trade, Analysis.
- **Health:** Physique (one row per day), Nutrition (ingredients), Activity (exercise catalogue).
- **Track and Other:** eTimeSheet, Travel, Application, LeetCode, Contact, Setting.
- **Read and write rules:** typed text stays as typed, columns found by header, appends after the last data row; see [Data access](../development/data-access.md).

## Tab index

| `CONFIG.SHEETS` key | Tab | Created by | Used by |
|---|---|---|---|
| `TRANSACTIONS` | `Transaction` | Template | Finance › Transaction, Chart, Car Service |
| `REPORT` | `Statement` | Template (formulas) | Finance summary cards and charts |
| `BALANCE`, `ACCOUNTS` | `Account` | Template | Finance › Account, net worth |
| `INSIGHT` | `Breakdown` | Template (formulas) | Finance › Breakdown, Type donuts, category list |
| `WORK_TIME` | `eTimeSheet` | Template | Track › Work Time |
| `PHYSIQUE` | `Physique` | You (add tab + header) | Every Health chart, tile and Insight mode |
| `ACTIVITIES` | `Activity` | You (add tab + header) | Health › Activity, Workouts, MET prices |
| `NUTRITION` | `Nutrition` | You (add tab + header) | Health › Nutrition, 🧮 Calculate |
| `CONTACTS` | `Contact` | You (add tab) | Other › Contact |
| `SETTINGS` | `Setting` | You (optional) | Every setting key |
| `TRAVEL` | `Travel` | Template | Track › Travel |
| `APPLICATIONS` | `Application` | Template | Track › Application |
| `LEETCODE` | `LeetCode` | The app | Track › LeetCode |
| `WATCHLIST` | `Watchlist` | The app | Finance › Watch List, Market's stock picker |
| `TRADES` | `Trade` | The app | Finance › Portfolio |
| `STOCK_ANALYSIS` | `Analysis` | The app | Finance › Market |

## Transaction

- **Rows:** one per transaction, header in row 1, data from row 2 (`A2:F`).
- **Type:** the sign of Amount alone decides income (positive) or expense (negative).

| Column | Type | Notes |
|---|---|---|
| A — Date | Date | ISO; written `USER_ENTERED` so Statement's formulas see a real date |
| B — Account | Text | A name from `Account` column A |
| C — Payee | Text | Merchant, person or institution |
| D — Category | Text | A category from `Breakdown` column A (the form also accepts new ones) |
| E — Description | Text | Optional; a `Type - ` prefix feeds the Type donuts; `@12345km` feeds Car Service |
| F — Amount | Number | Positive income, negative expense; a typed formula is kept unless the amount changes |

## Account

- **Layout:** `D1` holds net worth (e.g. `=ROUND(SUM(D3:D100),2)`), row 2 the header, accounts from row 3 (`A3:F`).
- **Formulas survive an edit:** the form reads each cell as a formula and sends it back unchanged unless you edit it.
- **Typed formulas:** `=` plus plain arithmetic is evaluated and stored as a number; any other `=` text is stored as a formula.
- **Reconciliation:** `D1` minus Statement's last Cumulative value; non-zero means a balance or a transaction is wrong.

| Column | Type | Notes |
|---|---|---|
| A — Account | Text | Account name; the Transaction form's account list |
| B — Institute | Text | Institution |
| C — Type | Text | `Cash`, `Chequing`, `Saving`, `Credit`, `Investment`, `Person`, `Other`, … |
| D — Balance | Number | Book balance that ties out to transaction history |
| E — Market Value | Number, optional | Cash-out value where it differs; blank shows `—`; never in a formula |
| F — Payment Day | Number, optional | Day of month (1–31) a negative balance is paid; drives the red `Pay <n>d` badge |

- **`Pay <n>d` badge:** shows for 3 days after the Payment Day when the balance is still below 0 and nothing came in since the previous one.

## Statement

- **Formula-driven:** `SUMIFS` over Transaction, one row per month, row 1 the header (read as `A1:ZZ149`).

| Column | Contents |
|---|---|
| A | Month label |
| B | Income |
| C | Expenses |
| D onward | One column per `Breakdown` category, matched by header name |
| Second-to-last | Saved (income − expenses) |
| Last | Cumulative savings |

- **Category columns:** matched by name; `Income` and `Expenses` are skipped even if Breakdown lists them.
- **Saved and Cumulative:** always the last two columns, so a new category column can't break them.
- **Quarter average:** the summary cards average the 3 rows before the active month.

## Breakdown

- **Formula-driven:** per-category, per-type spend for the Type donuts; data from row 2 (`A2:F`).
- **Category list:** column A is the app-wide category list.
- **Types:** a free-text prefix on Transaction's Description, not a Transaction column.
- **Blank Type row:** the category's overall total (the "Untyped" remainder).

| Column | Contents |
|---|---|
| A — Category | Category name |
| B — Type | Type prefix, or blank for the total |
| C — Last Month | Formula |
| D — Last Quarter | Formula |
| E — Last Year | Formula |
| F — Lifelong | Formula |

## eTimeSheet

- **Rows:** one per logged day, data from row 2 (`A2:H`).
- **Holiday:** a weekday with a Task but no times; a weekday with neither is a missed entry.

| Column | Notes |
|---|---|
| A — Company | Text |
| B — Date | Date |
| C — Day | Weekday name |
| D — Start | `HH:MM` |
| E — End | `HH:MM` |
| F — Break | Minutes |
| G — Duration | Hours worked |
| H — Task | Note; a holiday's name |

## Physique

- **Rows:** one per date; saving onto a logged date merges into that row instead of adding one.
- **Pattern rows:** a blank Date is a reusable pattern; kept at the top and left out of every chart and Insight mode.
- **Columns by header:** found by row-1 name, so they can move; old names still match; unknown columns are left alone.
- **Hidden totals:** TEI to TEF and Duration/AEE are filled by 🧮 Calculate; the form shows them only in its breakdown tables.
- **Arithmetic:** every number field accepts an expression such as `30+15`.

| Column | Header (old name) | Type | Notes |
|---|---|---|---|
| A | Date | Date | ISO; blank marks a pattern |
| B | Body Mass | Number | kg |
| C | Derived (BMR) | JSON | The day's BMR and body-mass figures; see below |
| D | Bed (Bedtime) | Time | `HH:MM` |
| E | Wake (Wake-up Time) | Time | `HH:MM` |
| F | Sleep | Number | Hours, wake − bed across midnight; written on every save |
| G | Deprivation | Number | kcal, the day's Sleep Deprivation Effect; written on every save |
| H | Consumption | Text | One food per line |
| I | Breakdown | JSON | Calculate's per-item table; see below |
| J | TEI (Calories In) | Number | kcal |
| K | Protein (Protein In) | Number | g |
| L | Dietary Fiber (Fiber) | Number | g, summed from the day's Breakdown items |
| M | Fat | Number | g |
| N | Carbohydrate | Number | g |
| O | TEF | Number | kcal, measured from the items' macros; blank when nothing is measurable |
| P | Workout | Text | One activity per line |
| Q | Duration (Activity Duration) | Number | Minutes |
| R | AEE (Calories Out) | Number | kcal |

- **Derived keys:** `BMR_mif`, `BMR_kat`, `BMR_cal`, `BMR_adp`, `BMR_avg` (kcal) and `m`, `BMI`, `m_avg`, `m_d` (kg, kg/m², kg, kg/day).
- **When Derived is written:** on every save, for blank cells on load, and for every day when a setting it depends on changes or Tune's 🔄 Update runs.
- **`BMR_cal` kept:** a re-save keeps a day's stored value; only a settings change rewrites it.
- **Breakdown items:** `{name, amount, calories, protein, fiber, fat, carbohydrate, tef, source, noteLine, newRow}`, in Nutrition's column order.
- **Item amount:** grams (`"62g"`) when the food's Nutrition row gives a weight; `"×N"` only when it doesn't.
- **Item macros:** fiber, fat, carbohydrate and tef appear only when the ingredient has a typed figure or pulled 🧬 Micronutrients.
- **`noteLine`:** the standardised line an item came from, so a re-run of 🧮 Calculate reuses unchanged lines.
- **Sleep and Deprivation backfill:** blank cells that can be computed are filled once on load in one batch.
- **TEF fallback:** a day with blank TEF uses `TEF_PERCENT_OF_INTAKE` × TEI wherever TEF is needed.

## Nutrition

- **Rows:** one per ingredient, header in row 1; columns found by header name (`A1:ZZ`).
- **Lookup:** the name you typed, case-insensitive; exact match first, then with a trailing "s" removed.
- **Typed over estimated:** a typed Fiber/Fat/Carbohydrate/TEF wins; otherwise they come from 🧬 Micronutrients and Atwater × TEF share.
- **New rows:** added by ➕ Add, by 💾 or ✏️ on a breakdown row, or banked by Calculate (always per 100 g).

| Column | Type | Notes |
|---|---|---|
| Group | Text | `Dairy`, `Poultry`, …; groups Food insight and Protein Source Rotation |
| Name | Text | Matched against your typed food text |
| Amount | Text | Grams first: `100g`, `32g (1 scoop)`; or a count: `1 rice cake` |
| Calories | Number | kcal for the Amount |
| Protein | Number | g for the Amount |
| Fiber | Number, optional | g |
| Fat | Number, optional | g |
| Carbohydrate | Number, optional | g |
| TEF | Number, optional | kcal |
| Percent | Number, optional | Share of desired protein; blank leaves it out of Protein Source Rotation |
| Micronutrients | JSON | One `{amount, unit, locked}` per nutrient, scaled to Amount |

- **Micronutrients order:** first Calories, Protein, Dietary Fiber, Fat, Carbohydrates, TEF, then every USDA nutrient.
- **Units:** `g`, `mg`, `µg`, `IU`, `kcal`, never USDA's upper case.
- **Locked:** `locked: true` marks a ticked row that 🧲 Complete never overwrites.

## Activity

- **Rows:** one per exercise, header in row 1, data from row 2 (`A2:J`); read by position.
- **Join key:** Name must match the Workout lines; an unknown name is priced at MET 3.5, has no muscle group and stacks as `Other`.
- **Missing tab:** plan tables are empty and everything stacks as `Other`; charts still draw.

| Column | Type | Notes |
|---|---|---|
| A — Category | Text | `Strength`, `Cardio`, `NEAT`, …; what Physical Activity stacks by |
| B — Group | Text | The plan sub-table and Workouts group |
| C — Name | Text | Join key |
| D — Unit | Text | `x` (reps), `sec` (hold), `step`, `min` |
| E — Sets x Reps, Rest | Text | `3 x 10, 90 sec`, `3 x 45 sec, 45 sec`, `6000 step`; split on the last comma |
| F — Image | Text | URL or repo path of the figure; blank is label-only |
| G — MET | Number | Metabolic equivalent for the burn formula; the `Walk` row sets desired activity |
| H — Muscle Group | Text | Feeds the neglected-muscle insight |
| I — Weight | Text | Shown as **Load** (`45 lbs`, `20kg`) |
| J — Weekly Desired | Number | Sessions/week for the Group; blank leaves it out of Activity Rotation; max wins |

## Contact

- **Rows:** one per contact, data from row 2 (`A2:U`), written `RAW`.
- **Starting point:** `scripts/merge_contacts.py` builds a deduplicated list to paste in.

| Columns | Fields |
|---|---|
| A–C | First, Middle, Last |
| D–F | Prefix, Tags, Birthday |
| G–I | Phone 1, Phone 2, Phone 3 |
| J–K | Email 1, Email 2 |
| L–P | Street, City, Region, Postal, Country |
| Q–T | Website, LinkedIn, Telegram, Telegram 2 |
| U | Note |

## Travel

- **Rows:** one per movement, data from row 2 (`A2:H`), written `RAW`.
- **Stays:** each Arrival pairs with its next Departure; an open final Arrival counts up to today.

| Column | Notes |
|---|---|
| A — Country/City | Place |
| B — Port | Airport, station or crossing |
| C — Type | `Arrival` or `Departure` |
| D — Via | Carrier or route |
| E — Date | Date |
| F — Time | `HH:MM` |
| G — Reason | Text |
| H — Detail | Text |

## Application

| Column | Notes |
|---|---|
| A — Delay | Number of days (0 shows nothing) |
| B — Date | Date |
| C — Action | Status text |
| D — Type | Set on an application's first row |
| E — App Number | Set on an application's first row |

- **Grouping:** a row with Type and App Number starts an application; the rows under it are its status updates.
- **Footer:** rows whose Action says "Total" are footer formulas and skipped.
- **New applications:** inserted at row 2 so the footer formulas shift down intact.

## LeetCode

- **Rows:** one per solve, written `RAW`; columns found by header, a missing one added after the last used column.
- **Roadmap:** the LeetCode link (or Problem name) ticks the problem off the NeetCode 250 roadmap.

| Header | Notes |
|---|---|
| Date | Date solved |
| Problem | Problem name |
| Category | Roadmap category, e.g. Arrays & Hashing |
| Difficulty | `Easy`, `Medium`, `Hard` |
| LeetCode | Problem link |
| NeetCode Page | Link; an old `NeetCode Video` header is renamed on the next save |
| YouTube Video | Link |
| Duration | The video's minutes; an old `Video Minutes` header is renamed on the next save |
| Notes | Text |

## Watchlist

| Column | Notes |
|---|---|
| A — Symbol | `AAPL`, `SHOP.TO` (TSX) or `XYZ.V` (TSXV) |
| B — Name | Company name |
| C — Exchange | Listing exchange |
| D — Currency | Trading currency |
| E — Notes | Text |
| F — Alerts | JSON of alert rules and dismissals (`RAW`); blank when none |

## Trade

- **Rows:** one per trade, written `RAW`.
- **Split:** Quantity is the ratio (new ÷ old) and Price is blank.

| Column | Notes |
|---|---|
| A — Date | Date |
| B — Account | Account name |
| C — Symbol | Ticker |
| D — Action | `Buy`, `Sell` or `Split` |
| E — Quantity | Shares, or the split ratio |
| F — Price | Per share |
| G — Fees | Commission |
| H — Currency | Trade currency |
| I — Notes | Text |
| J — FX to CAD | Rate on the day; 1 for CAD |

## Analysis

- **Append-only:** the newest row per Symbol is the one Market shows.

| Column | Notes |
|---|---|
| A — Date | Analysis date |
| B — Symbol | Ticker |
| C — Verdict | Signal |
| D — Score | Number |
| E — Close | Closing price |
| F — Stop | Trailing stop |
| G — Report | Full text |

## Setting

- **Columns:** A Key, B Value, C Notes (Notes is never read), data from row 2 (`A2:C`).
- **Optional:** a missing tab or row falls back to the built-in default.
- **Written `RAW`:** a computed value round-trips exactly.
- **Keys:** every key, its default and its page are listed in [Configuration](../development/configuration.md).

## Related

- [Data access](../development/data-access.md): Sheets read/write rules, batching, quota, caching.
- [Configuration](../development/configuration.md): `CONFIG`, `Setting` keys and browser storage.
- [Health formulas](health-formulas.md): every Health formula, constant and default.
- [Conventions](conventions.md): names, units, dates and hover format.
