# Track

[Docs](../README.md) › Guide

The Track section logs everything outside health and money: LeetCode practice, work hours, car service, travel and applications.

## At a glance

- **Hub:** `/track/` has tiles for LeetCode, Work Time, Car Service, Travel and Application; no glance cards.
- **LeetCode:** progress through the NeetCode 250, a daily heatmap, the roadmap and a Python cheat sheet.
- **Work Time:** hours logged per day, with arrival, departure and overtime charts.
- **Car Service:** service history read from Transportation transactions, and a forecast of the next services.
- **Travel** and **Application:** a trip log with a country map, and application status cards.
- **Reminders:** LeetCode, Work Time and Car Service badge their tiles; Work Time and Car Service can also notify in Chrome.

## LeetCode

### What it shows

- **Progress:** three bars, as Health's Progress card.
  - **Problems:** `45/250`, then solved and left; a mark every 25.
  - **Video time:** hours watched of all 250 problems' videos (a solve's Duration, else its video's), and hours to watch.
  - **Time:** days since the first solve and days ahead at your recent pace, with the finish date.
- **Daily Progress:** a heatmap of 7 day rows (Monday first) by weeks, from the first solve to today.
  - **Shade:** by that day's video minutes; hover reads `2026-08-23: 11 solves · 245 min`.
- **Roadmap:** NeetCode's roadmap graph, one node per category with `9/13` and a progress bar.
  - **Summary line:** `Solved 45/250 · Easy 27/60 · Medium 17/155 · Hard 1/35`.
  - **Rims:** green when a category is finished, blue on the one that's open.
- **Category cards:** one table per category (`5/22 solved`), one open at a time, all closed on load.
  - **Columns:** ✅ once solved, else its count among the unsolved (1, 2, …), Solved (first date, `×2` when solved again), Problem, Difficulty, Duration, then the row's buttons.
- **Cheat Sheet:** every Python construct the 250 solutions use, by topic from basic to advanced.
- **Badge:** a number on the tile, the solves today still owes to match the last 7 days' average.

### Actions

- **📝 Log** (`/track/leetcode/log/`): Date, Problem, Category, Difficulty, links, Duration (minutes) and Notes.
  - **A row's 📝** opens the form prefilled from that problem.
- **Row buttons:** 🎥 YouTube video, 📄 NeetCode page, 🔗 LeetCode problem; these work signed out.
  - **✏️ / 🗑️** on a solved row edit or delete its latest solve.
- **Roadmap node:** click to open that category's card.
- **🖨️ Print Cheat Sheet:** prints only the cheat sheet, fitted to one Letter page.

### Rules & calculations

- **Your own log:** only NeetCode 250 problems you've logged count, so it can differ from LeetCode's own total.
- **Pace:** new problems a day, the faster of the last 7 days (with today) and the 7 days before; no solves leaves it `—`.
- **Badge:** last 7 days' average (today excluded, rounded up) − today's solves; clears once today matches it.

## Work Time

### What it shows

- **Charts:** Arrival, Departure and Hours Worked distributions, and Daily Hours Average over Last Week, Month, Quarter, Year and Lifelong.
- **Log card:** an overtime line, then the table: Date, Day, Company, Start, End, Break, Duration, Task.
- **Overtime line:** time beyond an 8h/day pace overall, then Last Year, Last Month and Last Week.
- **Badge:** `3d` on an unlogged weekday (days since the last logged day); it opens today's form.

### Actions

- **📝 Log** (`/track/work-time/log/`): Company, Date, Holiday / day off, Start, End, Break (h and m), Task.
  - **Log Time:** a live duration preview under the times.
- **✏️:** edits a day; saving a date that already exists updates that row.
- **From / To:** the table's date range, by default the last 7 days through today.
- **Next holiday:** the first weekday holiday after today is pinned as the top row, above a line, when the range doesn't already show it.
- **Reminder:** account menu → **Enable notifications**; Chrome then shows "Work Time: log today" once a day.

### Rules & calculations

- **Company:** suggests past companies, most used first; charts, overtime and the badge use only your current one.
- **Holiday:** a day with a Task but no Start or End; it counts as logged and leaves the averages.
- **Overtime:** sum of (shift − 8h) over full weekday shifts, skipping today; a missed weekday isn't counted as −8h.
- **Daily average:** an unlogged weekday counts as 0 hours; weekends and holidays are left out.
- **Gaps:** logging a new day adds blank rows for any skipped dates before it.

## Car Service

### What it shows

- **Odometer & Service chart:** logged readings (solid), a linear forecast (dashed), past services (filled dots), next ones (hollow).
  - **Hover:** e.g. `Oil Change (done): 28,902 km`; predictions over 2 years out stay off the chart.
- **Predicted:** Date, Odometer, Service, Basis; an overdue one reads "… — overdue".
- **Done:** Date, Odometer, Service.
- **Badge:** `5d` when a service is due within 7 days, `-3d` once overdue; the full list is on hover.

### Actions

- **Log a service:** add a Transportation transaction whose Description holds the odometer, e.g. `Service Oil Change @28902km`.
- **Reminder:** with notifications on, Chrome shows "Car service 5d: Rust+Tires" once a day.

### Rules & calculations

- **Forecast:** a least-squares km-per-day line, anchored at the latest reading; a km rule's date is when it reaches that km.
- **Service type:** from Description keywords (oil, changeover, rust, rotation, cabin, air filter…); anything else is Other.

| Service | When | Source |
|---|---|---|
| Oil change | Your own average km between oil changes (8,000 km until there's history) | Your own history |
| Tire rotation + inspection | Every 8,000 km; a tire changeover also counts as one | Toyota |
| Brake measure, valve and battery check | Every 32,000 km | Toyota |
| Cabin air filter, engine air filter, brake fluid | Every 48,000 km | Toyota |
| Coolant | First at 160,000 km | Toyota |
| Spark plugs | At 193,000 km | Toyota |
| Winter tires on | By 1 Dec | TD |
| Winter tires off | After 31 Mar, on your average spring changeover date | TD |
| Rust protection | Yearly, on the day of the winter changeover | Your own history |
| Replace tire set | At 6 years old, or sooner when worn | Toyota |

- **Schedule:** Toyota's 2023 Corolla (Canada) km schedule; one-offs (diagnostics, balancing) are history only.

## Travel

### What it shows

- **Time Spent by Country:** a flag tile per country with the total time spent there.
- **Countries Visited:** a world map shading every country you've been to.
- **Log table:** Date, Type, "Country, City", Port, Via, Reason, Detail; sortable, 25 rows a page.

### Actions

- **📝 Log** (`/track/travel/log/`): "Country, City", Port, Type (Departure or Arrival), Via, Date, Time, Reason, Detail.
- **🔍 Search:** country, city, port, via, reason or detail.
- **Row buttons:** ✏️ edit, 🗑️ delete.

### Rules & calculations

- **Time per country:** each Arrival opens a stay that the next Departure closes; an open stay runs to today.
- **Before the first trip:** if the log starts with a Departure, that country counts from `BIRTH_DATE`.

## Applications

### What it shows

- **Cards:** one per application (`Type — App Number`), with Submitted date, Delay and the latest status.
- **Groups:** Ongoing and Closed, each with its count.
- **Expand:** click a card to see its status updates.

### Actions

- **📝 Log** (`/track/application/log/`): Type (e.g. Visa 6, Work Permit), App Number, Submitted Date, Action (default "Submited").
- **🔍 Search:** type, app number or status.
- **Card buttons:** ✏️ edit, 🗑️ delete.

### Rules & calculations

- **Ongoing:** an application with its submission or any update dated today; the rest are Closed.
- **In the sheet:** Delay and later status rows are kept on the sheet itself, not entered here.

## Data

| Tab | Columns used |
|---|---|
| LeetCode | Date, Problem, Category, Difficulty, LeetCode, NeetCode Page, YouTube Video, Duration, Notes (created on first save) |
| eTimeSheet | Company, Date, Day, Start, End, Break, Duration, Task |
| Transaction | Transportation rows with `@<km>km` in Description (Car Service has no tab of its own) |
| Travel | "Country, City", Port, Type, Via, Date, Time, Reason, Detail |
| Application | Delay, Date, Action, Type, App Number |
| Setting | `BIRTH_DATE` (Travel) |

- **Columns in full:** see the [data model](../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/track-leetcode.js` | LeetCode page, progress, heatmap and badge |
| `assets/script/track-leetcode-roadmap.js` | The NeetCode 250 list and roadmap layout |
| `assets/script/track-leetcode-cheatsheet.js` | Python cheat sheet |
| `assets/script/track-work-time.js` | Work Time table, form and reminder |
| `assets/script/track-work-time-chart.js` | Distributions, averages and overtime |
| `assets/script/track-car-service.js` | Car Service forecast, tables and reminder |
| `assets/script/track-travel.js` | Travel table and form |
| `assets/script/track-travel-chart.js` | Time per country and the map |
| `assets/script/track-application.js` | Application cards and form |

## Related

- [Finance — Overview](finance/overview.md): Transportation transactions feed Car Service.
- [Navigation](navigation.md): badges and notifications.
- [Data model](../reference/data-model.md): every sheet tab, column by column.
