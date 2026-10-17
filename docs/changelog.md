# Changelog

[← Back to README](../README.md)

Every commit, newest first, with the version it produced (see [Versioning](versioning.md)); major and minor releases in bold. Rewritten on every commit by the post-commit hook (`scripts/version.cjs`); the newest row reads *(this commit)* until the next commit fills in its id.

| Commit | Version | Changes |
|---|---|---|
| (this commit) | **3.16.0** | feat: Tune's Basal metabolic rate gains BMR_avg, the average of BMR_mif, BMR_kat, BMR_cal and BMR_adp (BMR_adp as of today), as a basis the whole plan can run on (the active equation scaled by BMR_avg / equation), with a BMR_avg row under m-inf_adp, its Equations and Calculations lines, a stored BMR_avg in every Physique day's Derived JSON, a Derived and Status row, a fifth Caloric Intake cap and the hovers; the Setting tab's old target keys are renamed with their duplicates merged, every key the app writes has a default Note filled on save and on load; bulk Calculate tidies Consumption and the Tidy button goes, as does Save & Add Another; Transfer, Capitalize Names, Import CSV, Update Market Value and the two contact exports become emoji buttons and Transfer's commit a Save; Amount reads gr, gram and grams as grams; docs |
| `82ef392` | **3.15.0** | feat: "target" leaves the whole project, code, setting keys, ids, classes, file names, comments and docs, for the UI's words: healthy for the body-mass goal (BODY_MASS_HEALTHY_KG, healthyKg) and desired for every other goal (SLEEP_DESIRED_HOURS, getCalorieDesired), health-nutrient-targets.js now health-nutrient-desired.js; every dated Health chart gets a swatch legend under it whose entries click to hide their series or bars/dots of that colour, desired marks turn cyan apart from the 7-Day Average, results read Desired met / Near desired / Missed desired alike, 8 evenly spaced gridlines with the first and last date on the plot edges at every range and a 120px left y axis so Rotation names fit; Body Mass draws Tune's healthy body mass, joins its dots with a thin gray line across gaps, plots a lone old reading, restarts its trend lines after a 14-day gap and draws the Calorie Trend in indigo; Tune opens a fresh user on the user's own figures (m_des 70 kg, L_p 7, n_p 4, gamma 3, kappa 3, walking MET 3, f 13.5, b_min 17, q 30-50, Delta-m% 1, a 170 cm / 35 y / 38-91-99 cm profile); a receipt of 2+ transactions ends in a blue UI-only total, the Pay badge shows only for the 3 days after Payment Day and on the home tile too; docs |
| `7fa8763` | 3.14.1 | refactor: rename every feature file, identifier, comment and doc to the UI section-page scheme (health-/finance-/track-/other-/ledger-*; wellness→health, Indicator→Chart, Timesheet→Work Time, Formula Playground→Tune), shared infra left neutral and the Wellness insight feature kept as-is; split the Health chart module into one file per chart; align the Health Chart vertical gridlines at every range via a fixed y-axis width; printer-friendly @media print rules; Body Mass chart joins its dots with a connecting line; fix the physique data-load crash by coercing text cells to strings; add the system-architecture diagram to the README and correct the social-preview description order; remove the one-off activity-image fetch scripts; add walk/backstroke/run activity gifs |
| `8f4e15c` | **3.14.0** | feat: Breakdown leaves the Finance and home tiles and the sidebar (PAGES_WITHOUT_TILES in page-nav.js; /finance/breakdown/ still opens, and commenting its entry out brings them back); Calculate title-cases each exercise name in a day's Workout box, and the Workout table under it shows names that way, as Consumption does for ingredients; docs |
| `e302853` | **3.13.0** | feat: Tune adds neck, waist and hip under age, U.S. Navy body-fat % (Hodgdon & Beckett) under BMI_des and LBM_navy above the Boer LBM, now LBM_boer, with their Equations and Calculations lines in Variables order; a Lean body mass question above Basal metabolic rate picks Boer or U.S. Navy for Katch-McArdle, A/B, protein and glycogen app-wide (LBM_FORMULA); new settings get a default Note; an account's Payment Day (1-31, Break-sized box) shows a red Pay <n>d badge on its row and the Account tile once passed unpaid; Activity Rotation runs furthest below desired first, like Protein Source Rotation; docs |
| `1c98711` | **3.12.0** | feat: home and hub tiles are liquid-glass capsules (frosted, top shine, lit rim, soft shadow) over their old colour coding, while sidebar links go back to plain list items; Contact, Refresh data, Clear cache and Settings sit above the switches, now named Dark mode, Amounts, Widgets and Bulbs, which show and work before sign-in from this browser's last values (Widgets and Bulbs off by default) and take the Settings tab's once it loads; Market's tile moves beside Snapshot on Finance Insight; Portfolio Allocation is renamed Account Allocation; docs |
| `294eb59` | **3.11.0** | feat: Contact and Settings open from the account menu, and Other leaves the tab bar, sidebar and home page (its /other/ addresses still work); sidebar links are liquid-glass capsules with a lit rim, top shine and a lift on hover, blue glass when selected; docs |
| `7575471` | 3.10.1 | fix: Physique's Derived table shows TEF from intake alone, and before Bed and Wake are typed reads SD as 0 with D and Δm′ worked out from it; ticking Pattern also hides Workout (with its table) and Derived, and a pattern saves Workout, Duration and AEE blank; Protein Source Rotation, Activity Rotation (both copies) and Finance's Cumulative Net Worth sit flush under their headings like every other chart; docs |
| `c1fca6c` | **3.10.0** | feat: a new exercise in a day's Workout is priced by AI on Calculate (MET, Category, Group, Muscle Group, Sets x Reps and Rest), its row showing AI with 💾 to save it to the Activity sheet and ✏️ to fix it first, and ✅ for one already there, as Consumption does for a new ingredient; table columns 5px apart everywhere; commit-msg strips every attribution trailer and refuses a message naming the assistant or its maker, and a new pre-push hook checks each pushed commit's message and author the same way; Add Activity's Save finds the saved row by Name, not Category; docs |
| `810afe0` | **3.9.0** | feat: sidebar's bottom panel holds Refresh data, Clear cache and the show/hide settings as iPhone-style switches (Dark mode, Show amounts, Show widgets, Show bulbs) above an account row with the Google picture, name and email that opens the account menu above it; links scroll on their own above the panel; with the sidebar hidden or below 1180px they sit in the account menu instead; docs |
| `26ac595` | 3.8.1 | chore: version.js and changelog for 3.8.0, which the post-commit hook skipped while WSL had no node |
| `3bff043` | **3.8.0** | feat: sidebar hides with a panel button in the logo row (or Ctrl+.), as in Claude's chat, leaving the Ledger logo as the button to bring it back, remembered before first paint; hub tiles colour-coded by function (gray database, green form, orange chart, purple AI incl. Market and Insight modes); Portfolio between Breakdown and Watch List; Health ranges add 6m and 5y, Finance Indicator adds 5y; Caloric Intake y axis from 0 kcal; Protein Source Rotation scales Protein % to 100% and targets the protein band's top; docs |
| `ce574df` | **3.7.0** | feat: Track LeetCode page with the NeetCode 250 roadmap by category (✅, Solved, Problem, Difficulty, 🎥 NeetCode video and 🔗 LeetCode buttons), one category open at a time; Past Year heatmap and NeetCode's roadmap graph cards; 📝 Log form (Date, Problem, Category, Difficulty, LeetCode, NeetCode Video, Notes) saving to a LeetCode tab with columns found by header; docs |
| `6778708` | **3.6.0** | feat: changelog of every commit with its version, rewritten by the post-commit hook; version counted from 0.0.0 over the whole history with judged legacy commits (Finance Market as 3.0.0); commit-msg strips co-author and Claude/Anthropic attribution, pre-commit refuses a Claude/Anthropic author; docs |
| `3d29342` | **3.5.0** | feat: version from commit messages (Conventional Commits, as in CELPiPi): feat bumps minor, fix/other bumps patch, feat! bumps major; post-commit hook stamps version.js; docs |
| `d3b342b` | **3.4.0** | Weather widget: today's sunrise and sunset on the current-conditions line (icon and temperature, condition on hover) to keep it one line; docs |
| `f6e7172` | **3.3.0** | Range buttons (1w/1m/3m/1y/All) replace From/To on Health Indicator and Health Insight; Finance Indicator 3m/6m/1y/All for Net Worth and Expenditure Trend, uncapped y axis; Settings tabs with own addresses and Note/Key/Value columns; every table fits its content; Protein Source Rotation stacked by ingredient with ingredient legend; Nutrition drops Uses, orders used-today then protein; Transaction line per receipt; docs |
| `98d039f` | **3.2.0** | Watch List price alerts (below/above price, long-term average, trailing stop) with red badges on Watch List and Market, dismiss, 4-hour background check; AI suggests alerts in a fixed line with 📌 apply and checks; entry stop for buying today and position size; Market and Portfolio cards 2x2 on phones; docs |
| `9c9de6e` | **3.1.0** | Finance: Watch List page (🔬 opens Market) and Market page merging the chart with Analysis; watchlist picker; long-term chart lines (SMA200, 52-week high, trailing stop, market) with Chart history sent to AI; trailing stop default 4 ATR; TSE: AC symbol input; Alpha Vantage spacing and TSX news message; docs |
| `ec8a02b` | **3.0.0** | Finance Market, Portfolio and Analysis pages: watchlist and price history, ACB trade log in CAD, evidence-based signals with AI read; smaller phone tab labels; docs |
| `dd64c23` | 2.94.1 | Activity: one table with Category and Group columns, a line at each Group change; docs |
| `ab14cfb` | **2.94.0** | Red day-count badges: Finance Insight Snapshot, Transaction over 30 days, Work Time days since last log; keep Insight badges after tile redraw; docs |
| `499dbab` | **2.93.0** | AI provider switch (Groq or OpenRouter) with models from Settings; 30-day red badges on Insight tiles; docs |
| `17a9186` | 2.92.1 | Tune: shorter variable names and BMR label; Equations in the site font, headings dark, equations gray; docs |
| `97d01de` | **2.92.0** | Tune as four cards with one BMR choice and desired wording; account details beside Account; one side-by-side field gap; docs |
| `576cef7` | **2.91.0** | Workouts (was GYM) with Cardio and NEAT; desktop footer strip as phone; even glass sidebar; sidebar closes open form; m̄ in progress bubble; docs |
| `1757dc0` | 2.90.7 | Phone polish: top safe-area strip, faded footer, lighter bottom bars, plain tab colours, iOS-style search boxes, m row in Derived |
| `b230910` | 2.90.6 | Tiles: neutral gray capsules with 12px labels |
| `0bf460f` | 2.90.5 | Four tiles a row on a phone |
| `573abcf` | 2.90.4 | Body text 13px |
| `30c7e45` | 2.90.3 | Footer "© year ALI — Ledger vX"; author meta and schema.org JSON-LD |
| `495b510` | 2.90.2 | Footer as "Ledger vX • © year ALI"; card text 12px |
| `7828ce2` | 2.90.1 | Body text back to .9rem |
| `fda3563` | **2.90.0** | Track section, Apple-style look, titled tile cards, one type scale |
| `34b46d6` | **2.89.0** | Confetti on saving an income transaction; darker hover shadow |
| `add8449` | **2.88.0** | Nutrition Group, grams-first Amount, Protein Rotation by Group; Pattern form; Finance tweaks |
| `22e9251` | **2.87.0** | Physique: collapsible Derived table with Desire targets, calibration ramp-up/clamp; Activity Rotation on GYM; Body Mass dots |
| `336ca33` | 2.86.3 | Nav: bottom bar through tablet widths, no top-bar gap before the sidebar |
| `fee1a9b` | 2.86.2 | Transaction filters: dates on top, the four filters in a 2x2 grid on phones |
| `af13786` | 2.86.1 | Fix local-date bugs, suggestion placement and stale docs; remove dead code |
| `acc6e00` | **2.86.0** | Automatic version in the footer; confetti fires on save |
| `48d3b73` | **2.85.0** | Split README and features into topic docs; pin phone suggestions to the top; confetti on body-mass progress |
| `58b0af9` | 2.84.8 | Rename Physique's BMR column to Derived, underline Activity table headers |
| `67f4af0` | 2.84.7 | Widgets as bulbs, one gap across the home page |
| `5f35ad6` | 2.84.6 | Same gap from the last bulb to the tiles as between bulbs |
| `bd69616` | 2.84.5 | Charts and GYM activities as bulbs; Micronutrients tables compact |
| `491a949` | 2.84.4 | One font family, Today before GYM, even gap under date rows |
| `9a60118` | 2.84.3 | No auto-zoom on iPhone, header-row lines, Insight views reload in place |
| `179d7ca` | 2.84.2 | Tables size columns by the table alone; cards keep their padding on phones |
| `18d58f2` | 2.84.1 | Tables: fixed row heights, row buttons never stacked |
| `4329dfb` | **2.84.0** | GYM page, quick logging, and one consistent style system |
| `8611166` | 2.83.2 | Day form: Sleep Duration/Deprivation line in the m̄/Δm/BMI style |
| `1e3bab2` | 2.83.1 | README: stored glycogen swing, load timing logs, body-mass and Load wording |
| `779f34b` | **2.83.0** | Finance: Cumulative Net Worth glance card under the summary cards |
| `9a0c01e` | 2.82.9 | Remove Health's Settings block; Other's Settings is the one page |
| `5a81841` | 2.82.8 | Log where a load's time goes |
| `afc1077` | 2.82.7 | Day form: m̄/Δm/BMI line with each unit once |
| `03f8f84` | 2.82.6 | Day form: m_d shown in kg |
| `36109a6` | 2.82.5 | Day form: m_avg/m_d/BMI line, each in its own unit |
| `caacbb7` | 2.82.4 | m_d stored in kg/day like every other body-mass figure |
| `731a08f` | 2.82.3 | Body-mass figures stored in the BMR cell, not a new column |
| `f6e9709` | 2.82.2 | Tune's Update: say it recomputes m_avg too |
| `693b3fd` | 2.82.1 | Activity: an exercise's Weight is shown as Load |
| `93b7edf` | **2.82.0** | Stored Mass column: m, BMI, m_avg and m_d saved per day; body-mass wording |
| `037a685` | 2.81.17 | Glycogen swing saved once as GLYCOGEN_SWING_KG |
| `0603cc8` | 2.81.16 | Phone footer: copyright line 10px lower |
| `25b191f` | 2.81.15 | README: phone footer strip, left-aligned date/time fields |
| `8f63f23` | 2.81.14 | Phone: copyright line in a strip under the bottom bar |
| `bf9b329` | 2.81.13 | Phone: no scroll on a short page, footer resting on the bottom bar |
| `d3a2871` | 2.81.12 | Forms: date and time values pinned left on iOS too |
| `fdad5e1` | 2.81.11 | Forms: date and time values left-aligned |
| `728abd1` | 2.81.10 | README: drop the short-page height note (reverted) |
| `cc31275` | 2.81.9 | Revert "Short pages fit the screen; footer above the phone bottom bar" |
| `d41bf31` | 2.81.8 | README: logged rows, Progress card note |
| `898193d` | 2.81.7 | Progress card: no empty line under the last bar |
| `8ea2c25` | 2.81.6 | Status: one m row with the rolling average in brackets |
| `16e2696` | 2.81.5 | Status: m shows the glycogen/water swing beside its target too |
| `5063e57` | 2.81.4 | Activity: no hover note on a logged row, like Nutrition |
| `bf80acc` | 2.81.3 | Activity: a logged row is green with no tick, like Nutrition |
| `990c0c9` | 2.81.2 | README: Workout suggestions, page height and footer |
| `1b79c86` | 2.81.1 | Short pages fit the screen; footer above the phone bottom bar |
| `ba7d198` | **2.81.0** | Physique form: exercise-name suggestions for Workout |
| `9a96e41` | 2.80.11 | README: actions in one place, phone bar spacing, form button order |
| `dea9713` | 2.80.10 | Phone bottom bar a quarter closer to the bottom edge |
| `b81ce8e` | 2.80.9 | Actions at the top on every page, in the phone bar's order |
| `05b3fca` | 2.80.8 | Reload of a row address: no lowercase name in the breadcrumb |
| `c96dc5c` | 2.80.7 | Ingredient form: Scan before Complete |
| `88dff06` | 2.80.6 | Ingredient form: name and unit columns at the page's text size |
| `734fc1f` | 2.80.5 | Ingredient form: name column as wide as its text |
| `028e3a9` | 2.80.4 | Phone bottom bar: half the gap between buttons and the account circle |
| `39b601a` | 2.80.3 | Phone bar spacing even at both ends; Physique form: Scan first |
| `9298267` | 2.80.2 | README: first-paint layout, Ledger tab, phone bar details |
| `2935134` | 2.80.1 | Hub/page layout from the first paint |
| `e9a7cb5` | **2.80.0** | Car Service: winter changeover and rust protection on 1 Dec |
| `5c14b19` | 2.79.1 | Phone bottom bar: long labels wrap onto two lines |
| `dd9f0eb` | **2.79.0** | Phone tab bar: Ledger tab for the home page |
| `6ce723f` | 2.78.2 | Phone: account avatar the same circle as the bottom bar's close |
| `dd675b3` | 2.78.1 | Hide bulbs: keep the cards on section pages |
| `0f9dc03` | **2.78.0** | Hide bulbs: account-menu toggle for the home page's glance cards |
| `94361bd` | 2.77.3 | Phone bottom bars float above the home indicator |
| `bc7000b` | 2.77.2 | Pill bottom bars, round close, emoji buttons always white |
| `0dfb4a3` | 2.77.1 | Selection-bar buttons and Physique's Today as white emoji |
| `8a5a639` | **2.77.0** | Emoji action buttons, badges, saves stay open, exports in Settings |
| `ff6b189` | 2.76.2 | Phone bottom bars: one height, one button style |
| `1f2f669` | 2.76.1 | Six text colours, thinner tables, home breadcrumb, compact BMR line |
| `d8e42a9` | **2.76.0** | Every form a page, no top bar, Insight mode pages, all styling in styles.css |
| `6ed514d` | 2.75.4 | Breadcrumb: link a row's date over its 🧬 view |
| `ab31f6c` | 2.75.3 | README: batched reads, per-page loading, breadcrumb root |
| `e04dff8` | 2.75.2 | Breadcrumbs start at Ledger, linking to the home page |
| `f23ef38` | 2.75.1 | Contact table: columns fit their text, scrolling sideways |
| `452e084` | **2.75.0** | One bottom bar at a time on phones, ❌ on every page, direct form loads |
| `0b286a8` | 2.74.4 | Section hubs: breadcrumb in place of the centred title |
| `c270135` | 2.74.3 | Health hub: Today as the first tile, before Tune |
| `faf1aa3` | 2.74.2 | Settings tables: actions and key on one line |
| `d6687da` | 2.74.1 | Health hub: keep Today, drop Log |
| `5151fa6` | **2.74.0** | Today and Log on the Health hub |
| `11f41ce` | **2.73.0** | Form pages styled like block pages; home overview with tiles; name-only tiles |
| `ee53d06` | **2.72.0** | Forms open as pages on section pages |
| `de9f488` | 2.71.1 | Finance: Financial Indicator/Insight become Indicator and Insight |
| `cd4c1fa` | **2.71.0** | Section pages as a hub and pages, with a sidebar on wide screens |
| `e61436a` | 2.70.1 | Load only the current section's blocks |
| `51f094a` | **2.70.0** | Batch Sheets reads and share the tab list; add Clear cache |
| `318141b` | 2.69.2 | Pattern table: content width, one line per cell, compact padding |
| `00fde5a` | 2.69.1 | Profile order: sex, height, age, then body mass |
| `1d44063` | **2.69.0** | Health Settings block; read walking MET and BMR_cal from their sheets |
| `301b866` | 2.68.1 | Insight mode names and order, Food macro fallback, consistent hover units |
| `074853b` | **2.68.0** | Nutrition Facts order and names, setting-driven targets, more row addresses |
| `5d914ee` | 2.67.6 | Progress card: regular-weight figures and lost/left, elapsed/ahead labels |
| `15f74df` | 2.67.5 | Remove all caching; smooth m̄ over L_p; Status, Progress and unit cleanups |
| `bbc0454` | 2.67.4 | Car Service: wrap Basis in a narrow column; bump shell cache to v29 |
| `3cfeb76` | 2.67.3 | Stop iOS Safari text inflation (Car Service Basis column) |
| `ae85ea8` | 2.67.2 | Progress card: stat text at the Status rows' font size |
| `906a499` | 2.67.1 | README: Status, Progress card, ingredient form and Pattern micronutrients |
| `b5cfc74` | **2.67.0** | Health glance: drop m̄ and t, Progress card with 10% marks under the cards, tighter stack, Sleep Window first |
| `dfdddee` | **2.66.0** | Physique Patterns: own micronutrients table and pattern-N addresses |
| `84d21c3` | 2.65.2 | Ingredient form: Amount as a stacked field like Classification and Name |
| `1c48fab` | 2.65.1 | Ingredient form: label-matched names and units, fixed right-aligned fields |
| `ad5cbed` | **2.65.0** | Standard units, editable Patterns period length, sheet-matching sleep labels |
| `2ff2f49` | **2.64.0** | Nutrition lock table, per-row edit addresses, Insight prompt templates |
| `8fadc4a` | **2.63.0** | Add Equations and Calculation dropdowns to Tune |
| `ff72b99` | **2.62.0** | Add Car Service reminder flag and daily notification |
| `4da2840` | **2.61.0** | Add Car Service block with service history and predictions; chart hover consistency |
| `01b5e5e` | **2.60.0** | Add block/form addresses, Tune block, and stored per-day BMR in Physique |
| `46ba752` | **2.59.0** | Pin form actions to the bottom on mobile, update balances on edit, add progress bar bands |
| `35d02b6` | 2.58.1 | Sort Activity plan and Instructions modal by rotation completion |
| `84ca421` | **2.58.0** | Add export confirmation dialogs and reorder Status card rows |
| `e5797cc` | 2.57.3 | Fix Breakdown action buttons wrapping on mobile, Sleep header abbreviation, integer macros in Physique table |
| `4f7d5ae` | 2.57.2 | Improve Transaction and Physique UX across filters, exports, and table display |
| `bc859d2` | 2.57.1 | Make forms full-screen on mobile and fix background scroll |
| `2b108c8` | **2.57.0** | Add block-visibility toggle, catalogue propagation, and Health Plan parity |
| `92d7b7c` | 2.56.1 | Make Health Insight tables/profile consistent across modes |
| `cf5e227` | **2.56.0** | Make Health Insight's Patterns period length user-editable |
| `0068746` | **2.55.0** | Add a Patterns mode to Health Insight |
| `eb70213` | **2.54.0** | Add BMR calibration, fix Calculate/basis bugs, and clean up small UX gaps |
| `0ed6ced` | **2.53.0** | Replace the Health Indicator charts' weekly-bucket trend with a continuous EMA |
| `0b35a96` | 2.52.1 | Make the phone bottom nav a real tab bar with thumb-sized tap targets |
| `71a7efb` | **2.52.0** | Overhaul the mobile layout: bottom nav, auto-hiding header, fixed dark-mode colors |
| `5cbc966` | 2.51.2 | Ignore local Claude Code project settings |
| `17c2553` | 2.51.1 | Show 28 dated days plus every Pattern row per Physique page |
| `32853a7` | **2.51.0** | Add a Log button to the Add/Edit Activity modal |
| `59ac8bf` | 2.50.1 | Document that Settings masks API keys/tokens by default |
| `961caa6` | **2.50.0** | Add today's raw body mass to Status, mask secrets in Settings, line off Physique weeks, and harden dashboard loading |
| `9ba1b0d` | 2.49.4 | Drop the visible "Loading your data..." banner and fix the scan's vision model |
| `e148803` | 2.49.3 | Drop the default sign-in banner and let gated actions sign in on click |
| `07ba10e` | 2.49.2 | Fix Physique scan's vision model id, which pointed at a nonexistent Groq model and made every scan fail. The comment above it already named the intended model (Llama 4 Scout); the constant just never matched it. |
| `28928cd` | 2.49.1 | Drop `required` from every form field except Log a Transaction's Date/Account, so a field that doesn't actually need a value stops blocking Save over it. |
| `5972a9d` | **2.49.0** | Add an Activity Rotation chart to Health Indicator, matching Protein Source Rotation's bar+donut shape: a new Weekly Target column on the Activity sheet drives a horizontal bar (sessions logged vs. desired this window, one bar per Group) and a three-ring donut (reference weekly split, last 4 weeks, last week). A session credits every Group a day's Workout notes touch, not just the dominant one. |
| `1b699d3` | 2.48.2 | Fix Delta-m's target to negate WEEKLY_FAT_LOSS_KG the same way D's target already does, so a cut's desired mass change reads negative (losing) instead of positive, and keep the Status/Macros/Activity/Sleep bento as two columns below 640px instead of collapsing to one, with tighter row and card padding so the Status card's longer figures still fit on a phone width. |
| `7da6bda` | 2.48.1 | Split the Status card's BMR row back into BMR/lambda-t/BMR_adp so the adaptation discount and its result are always visible, independent of which basis Balance/Delta-m actually run on. |
| `4e5b229` | **2.48.0** | Add a global BMR/BMR_adp basis toggle to the Formula Playground and wire it through every deficit, calorie target and the forecast's A/B, split the Status card into a Status/Macros/Activity/Sleep bento layout with new BMI and lambda-t rows, standardize chart hover labels to the Playground's symbol vocabulary (TEI/AEE/TEF/SD/D/BMR/BMR_adp) across Body Mass, Calorie Balance, Caloric Intake, Protein/Fiber/Fat/Carb, Activity and Sleep, fix the Body Mass chart's Calorie-Implied Trajectory to reach today instead of stopping at the last weigh-in, add a per-day Adapted BMR dashed line to Caloric Intake, and replace "target" with "desired" across Health Indicator and Health Insight prompts. |
| `8a1e105` | 2.47.1 | Simplify the Status card's Intake separator to / and drop the explicit + on positive figures |
| `661ae92` | **2.47.0** | Rebuild Health Status card as an energy-budget ledger and add Desire/Remain to Physique breakdowns |
| `bc8eac8` | **2.46.0** | Add a Normalize button to the Nutrition ingredient form, a Capitalize Names bulk action to Nutrition, and fold Physique's own capitalize/combine buttons into one Tidy button |
| `467e63f` | **2.45.0** | Resync the Health Formula Playground to the metabolic-model reference notation, add a deficit-vs-BMR warning row, and widen the symbol column |
| `ad59c77` | **2.44.0** | Add account-to-account Transfer, split README into docs/, and give Tune/Today/Transfer their own gray button role |
| `8bb4701` | **2.43.0** | Reorder Physique table columns, add Sleep Deprivation readouts, and gradient the Caloric Intake and progress-meter colors |
| `c0f80b3` | **2.42.0** | Redesign Status card to 5 rows, add Intake/Digestion/Activity/Deprivation mirror rows, fix null-textContent crash, graduate progress bars blue-to-green, and remove the JSON backup export |
| `643e693` | **2.41.0** | Model sleep deprivation's effect on fat loss across Health Indicator, and fix chart x-axis consistency |
| `662522d` | **2.40.0** | Rename the Macros/Activity glance cards to match their charts, add a Cardio/NEAT/Strength breakdown, fix a label typo |
| `65e8ff8` | **2.39.0** | Redesign the Today-at-a-glance cards into Status/Macros/Activity/Sleep, and add a per-day Basal Metabolic Rate marker to Caloric Intake |
| `d2ef687` | **2.38.0** | Rework the Today-at-a-glance cards into Body Mass, Activity, Macros and Sleep, and fix the sign-in check being stuck behind window.load |
| `494ca21` | 2.37.2 | Remove the header global search box |
| `2c1c314` | 2.37.1 | Show the dashboard shell before sign-in, split charts.js/physique.js/formula-playground.js into focused modules with lazy chart loading, and add a health reminder banner, global search, full backup export, and offline app-shell support |
| `cb52eae` | **2.37.0** | Add a Carbohydrate Intake band to Wellness, fix AI report formatting, and rename macro labels for accuracy |
| `4a4f0f9` | 2.36.1 | Give the top nav more breathing room |
| `baec43b` | **2.36.0** | Add a Physique Today button, move Tune/Scan into the day form, add a live Sleep Duration readout, and turn the home page into a lightweight summary |
| `4c6c8e2` | **2.35.0** | Add day-target rows to Physique's Consumption/Workout tables, a Consumption divisor syntax, a muscle-loss fill on State Trend & Forecast, and fix the iOS Scan button |
| `09f9b14` | **2.34.0** | Add food-photo Scan to Physique, directional reconciliation flag, and update README |
| `eae0225` | **2.33.0** | Suggest ingredient names while typing Consumption, mobile-keyboard-aware |
| `45cf99e` | **2.32.0** | Auto-combine Consumption/Workout on Calculate, bound State Trend & Forecast to the panel's From/To, and fill Fat Intake's band |
| `0f34e19` | **2.31.0** | Add a Fat Intake chart to Wellness, with dashed-line band targets |
| `fe5f8ff` | 2.30.1 | Rename Rest & Recovery to Sleep, collapse Physique's Bed/Wake columns into one Sleep hours column, and reorder Physical Activity above Caloric Intake |
| `a349340` | **2.30.0** | Add a Nutrition Log/Log More button and today's-usage row highlight, and reorder the Formula Playground to match its own legend |
| `9edf1ab` | **2.29.0** | Add multi-macro Consumption anchors, an edit-before-banking button, a Nutrition usage count, and a fat band to the Formula Playground |
| `d75629d` | **2.28.0** | Add a fiber band to the Formula Playground, mirroring protein's band |
| `547e319` | **2.27.0** | Unify Nutrition's USDA lookup/pull into one button, add Fiber tracking, and consolidate table styling |
| `ea831fc` | **2.26.0** | Add Fiber/Fat/Carbohydrate columns to Nutrition, Physique and Food Insight |
| `0340a38` | 2.25.1 | Merge Physique's breakdown and TEF tables into one per-ingredient table |
| `3473d09` | **2.25.0** | Add a per-ingredient TEF column to Health Insight's Food mode |
| `d71afb0` | **2.24.0** | Add a per-day TEF column to Physique, measured from real macros where available |
| `2e1e350` | 2.23.2 | Move dark mode and hide-amounts toggles into account menu, drop panel-toggle FAB |
| `ba2ac2b` | 2.23.1 | Speed up first paint, and tune State Trend/Forecast, Sleep, Account and Physique feedback |
| `99e3ebe` | **2.23.0** | Add State Trend & Forecast's smoothed trend line and glycogen/water swing zone to the Body Mass chart |
| `7e21aac` | **2.22.0** | Add a per-day Micronutrients view to Physique, only flag nutrient shortfalls, and date-suffix day-scoped modal titles |
| `5b3bef3` | **2.21.0** | Add glycogen/water swing awareness to Health Indicator scoring and forecast |
| `8c0f54d` | 2.20.3 | Make modal titles consistent, rename Work panel to Work Time, widen the page container, and drop the nutrition Amount hint |
| `4fc1784` | 2.20.2 | Recolor Calorie Balance bars: dark green when a day meets target, red when both the day and its 7-day average miss it |
| `6897258` | 2.20.1 | Fix Calorie Balance tooltip's 7-day fatloss to multiply by 7 |
| `944f197` | **2.20.0** | Add 7-Day Expected Fatloss to the Calorie Balance chart's hover tooltip |
| `f62ce5a` | **2.19.0** | Add a reference-target ring to Protein Source Rotation's donut, and reformat the Activity glance tile's kcal note |
| `a26901f` | 2.18.1 | Fix the glycogen store's muscle-mass basis in the Formula Playground, and widen the symbol column |
| `2bf4622` | **2.18.0** | Make Log Time mobile-friendly again, drop the Monthly Expenditure average, and add a glycogen/water swing to the Formula Playground |
| `bfa6abf` | **2.17.0** | Add a Weight column to the Activity Plan, sort Micronutrients ideal-first, alphabetize pulled micronutrient JSON, and fix Log Time's Start/End/Break formatting |
| `e1017f0` | 2.16.1 | Change Log Time's Break field from a plain-minutes number to an HH:mm text input |
| `343c182` | **2.16.0** | Add Ideal/day targets to Micronutrients, a Muscle Group column to the Activity Plan, and fix a protein-decimal and a Break-field bug |
| `b932300` | **2.15.0** | Add a Micronutrients column to Nutrition, a bulk/single-row pull from USDA's full nutrient panel, and a new Health Insight mode built on the real totals |
| `cbd9614` | **2.14.0** | Color-code Protein's glance tile past its band top, and add a body mass value bubble to the progress bar |
| `4d60ef7` | 2.13.1 | Shorten the Calculate breakdown's USDA source label to just USDA |
| `5f2b3f4` | **2.13.0** | Add a system architecture diagram, a divide-quantity and a protein anchor to Calculate, and mask bed/wake time in privacy mode |
| `5061047` | **2.12.0** | Give each panel group its own address, and let a transaction move its account's balance |
| `9225012` | **2.11.0** | Add four terms to the Formula Playground, and a BMR equation to choose from |
| `850c5df` | 2.10.1 | Sign the Calorie Balance hover, and name its first row like the other charts |
| `4890d35` | **2.10.0** | Fold income into the expenditure trend, and make every legend a switch |
| `d3be16b` | **2.9.0** | Add a Breakdown panel and a Tax button, and rename every sheet tab in one place |
| `9d13d61` | 2.8.1 | Move "where," onto the variable list, and shorten a Nutrition header |
| `04dce45` | **2.8.0** | Add a fat-loss percentage: a Δm% box, a solve mode and a third pin |
| `a8db78e` | 2.7.3 | Show Monthly Income as this month alone |
| `7ab48cb` | 2.7.2 | Shorten the Contact List heading to Contact |
| `170d23f` | 2.7.1 | Move Activity below Nutrition in the Health section |
| `1a6aa52` | **2.7.0** | Renew the token before a form opens, and add a Health Plan feasibility insight |
| `d136751` | **2.6.0** | Cut every panel button to one word, and add a lean-mass protein band to the playground |
| `a95d2e3` | **2.5.0** | Pin the activity target by time or calorie burn, add a Protein Sources AI insight mode, and shorten the Work/Travel/Application panel headings |
| `a067797` | **2.4.0** | Make the Activities catalogue editable, and give Health Indicators one window |
| `57ff399` | **2.3.0** | Merge into an already-logged day instead of refusing the save |
| `93dda88` | 2.2.4 | Size the breakdown columns from their content, and merge Source with Save |
| `081ab57` | 2.2.3 | Make date/time inputs honour their width, and tighten the breakdown table |
| `9d9270c` | 2.2.2 | Keep both .form-row columns exactly half wide on a phone |
| `05f543c` | 2.2.1 | Give every single-line form control one height |
| `59b2006` | **2.2.0** | Read Physique's four totals off tables, and make workout tempo a setting |
| `5533ebd` | **2.1.0** | Turn the Formula Playground into a solve-for-any-field calculator, and let Physique combine/sort duplicate ingredients |
| `33017f6` | 2.0.1 | Unify target/body-mass naming, fix Physique table UI, and merge duplicate ingredient rows |
| `3f61f44` | **2.0.0** | Replace the Health Log with a per-day Physique tab and an Activities catalogue |
| `99b3076` | **1.54.0** | Add an Instruction modal to the Activity Plan |
| `10a3506` | **1.53.0** | Add AI Financial Insight panel; rename Accounts sheet, add Market Value |
| `5ecd51c` | 1.52.3 | Merge spending panels, reorder Historical Trends, drop architecture diagram and emoji |
| `4aa65d4` | 1.52.2 | Remove dashboard screenshot from README |
| `3878b68` | 1.52.1 | Cut the Insight prompts down and halve charts.js's comments |
| `6d3468e` | **1.52.0** | Mark each week's average on the Health Indicators charts |
| `5eadb63` | 1.51.2 | Unify the Health Indicators charts, and rewrite the README as bullets |
| `a9b2b37` | 1.51.1 | Colour buttons by role and show progress on the slow ones |
| `f194588` | **1.51.0** | Classify ingredients, log workouts gradually, and tighten mobile layout |
| `e1af63a` | 1.50.1 | Rename weight to body mass and drive the forecast from the plan |
| `ef522c1` | **1.50.0** | Merge the three AI insight panels and curve the weight forecast |
| `7fde3f4` | 1.49.4 | Remove the Spending Patterns panel |
| `13b73d6` | 1.49.3 | Drop calibration and build the calorie bound from BMR plus activity |
| `df68915` | 1.49.2 | Make the calibration a smoothed three-term energy model |
| `743efd1` | 1.49.1 | Drop the note that narrated a working formula toggle |
| `6e6098e` | **1.49.0** | Give Body Weight its own chart and make the calorie bound per-day |
| `acc1261` | **1.48.0** | Let a food's amount be given as a calorie figure |
| `b9713f4` | **1.47.0** | Turn the calorie target into a max or a min, whichever the goal implies |
| `afd6bc4` | **1.46.0** | Make the protein target a band scaled off goal weight |
| `f345339` | 1.45.11 | Widen the calibrated-maintenance guard so the bars can respond again |
| `123171c` | 1.45.10 | Stop a noisy calibration from wrecking Calorie Deficit & Fat Loss |
| `938c536` | 1.45.9 | Restore the toggle-sensitive right-axis label on Calorie Deficit |
| `19f906d` | 1.45.8 | Cut the commentary in calibration.js and the new chart axis helper |
| `0bfb94a` | 1.45.7 | Drop the axis title added to Calorie Deficit & Fat Loss |
| `5a28353` | 1.45.6 | Tighten the Calorie Deficit axis and de-duplicate its right-axis label |
| `d76aed4` | 1.45.5 | Revert the calibration fit to weighted OLS |
| `899eae0` | 1.45.4 | Always save the fitted calibration, never substitute the generic value |
| `e32604d` | 1.45.3 | Calibrate over multi-week windows instead of refusing noisy data |
| `1a8c088` | 1.45.2 | Regularize the calibration fit with weighted ridge regression |
| `2842bbe` | 1.45.1 | Align Activity Plan data-reps with the displayed sets x reps |
| `2e4a0b9` | **1.45.0** | Add Calorie Deficit & Fat Loss chart, calibrated/generic toggle, Day 5 bodyweight plan |
| `a3e4029` | **1.44.0** | Add Activity Insight AI panel; fix Activity Plan table alignment; make Rest & Recovery axis data-driven; redesign Weight Trend progress meter |
| `fceb649` | **1.43.0** | Replace fixed 7/14/30-day lookback with custom From/To date range on Wellness Insight and Protein Source Rotation; hide landing page feature graphs on mobile |
| `11c4f4a` | 1.42.1 | Change Sleep bed/wake separator to "; " as canonical, "/" as legacy fallback |
| `1af5ea4` | **1.42.0** | Add Activity; Calories calorie-burn tracking; use it in Weight Trend calibration; align Health Metrics chart widths |
| `dd4ff72` | **1.41.0** | Match Wellness Insight styling to Food Insight; add optional question box |
| `ed63c47` | **1.40.0** | Add Sleep bed/wake entry and redesign Rest & Recovery as a floating-bar chart |
| `f13f587` | **1.39.0** | Add plateau alert and Strength Training Plan; fold Time into Other; split gate.js from app.js |
| `23f27c3` | **1.38.0** | Add Protein Source Rotation and Body Composition Change charts; promote Food/Wellness Insight to persistent panels |
| `6f9d624` | **1.37.0** | Redesign landing page as a node graph; add Verified column to Nutrition Facts |
| `87a72fb` | **1.36.0** | Add reusable "pattern" entries to the Health Log |
| `2c9d282` | 1.35.3 | Format Health Metrics chart x-axis dates as "Jun 29" instead of ISO |
| `fd0117c` | 1.35.2 | Remove merge_contacts.py, a one-time local tool no longer needed |
| `ae448e1` | 1.35.1 | Document the Food Insight feature and Health Metrics chart changes in README |
| `e9b8a00` | **1.35.0** | Add Food Insight feature, reflow Health Metrics charts, fix ingredient-matching bugs |
| `0cd5ab0` | **1.34.0** | Add can/clove units, fix Nutrition Facts count-parsing bug, require review before auto-saving new ingredients |
| `e0e8e53` | 1.33.1 | Standardize Notes deterministically, persist Calculate breakdown, fix spray/count scaling |
| `24d6085` | **1.33.0** | Add "spray"/"shot" ingredient units, fix a gram weight for shots |
| `6416c15` | 1.32.1 | Stop Calculate from renaming ingredients, show density used, grow Notes field |
| `41a4fb8` | **1.32.0** | Add a personal Nutrition Facts table for AI calorie estimation, fix eTimeSheet reminder scoping |
| `759abc6` | **1.31.0** | Add a personalized TDEE-based calorie target formula |
| `639b362` | 1.30.1 | Truncate long Company names in Work Log table, unify stat tile font size |
| `08bfa9d` | **1.30.0** | Add Company field to eTimeSheet and scope overtime/reminder to it |
| `0385682` | 1.29.1 | Add category icons and color-coded accents to the landing feature cards |
| `9d8dd34` | **1.29.0** | Add Health Log bulk edit, stacked activity chart, and Insight activity breakdown |
| `5cf0c90` | **1.28.0** | Add protein tracking, AI health insight, and merge Journal/Portfolio into Finances |
| `fee9d37` | **1.27.0** | Add calibrated weight forecast, overtime tally, and extend privacy mode app-wide |
| `d95fd69` | 1.26.2 | Stop auto-focusing form fields when any modal opens |
| `ac2ffdc` | 1.26.1 | Extract shared JS/CSS helpers, add mobile-friendly styling, and speed up dashboard load |
| `ef4e7c4` | **1.26.0** | Add AI-powered calorie calculator to Health Log, fix modal styling |
| `ebee79c` | **1.25.0** | Add a Settings panel and tune wellness chart layout/styling |
| `d5396b6` | **1.24.0** | Add dashboard widgets and reorganize the Journal/Applications panels |
| `617d6b1` | **1.23.0** | Add Travel and Applications tracking under a new Other section |
| `bcda25d` | **1.22.0** | Add Contacts tab with bulk export/delete/merge and a source-merge tool |
| `54f516d` | **1.21.0** | Refresh labels, landing page, and add wellness autocomplete |
| `8091fd1` | **1.20.0** | Add red dashed target lines to all 4 wellness charts |
| `2746558` | 1.19.4 | Cap Weight Trend x-axis ticks to keep chart heights consistent |
| `60440c1` | 1.19.3 | Convert activity units to minutes in chart |
| `31bfcf0` | 1.19.2 | Update Activity default unit to steps, generalize activity chart axis |
| `5cd31a3` | 1.19.1 | Fix Wellness Log UI: form styling, chart layout, notes truncation |
| `25e7e4d` | **1.19.0** | Add Wellness Log section with charts, log table, and entry form |
| `b07788f` | 1.18.1 | Build Spending Breakdown by Type panels dynamically from Insight data |
| `556cb35` | **1.18.0** | Add consent flag, silent-refresh retry, Time Log pagination; update README |
| `08d1169` | 1.17.4 | Document accessibility improvements and currency-formatted chart axes in README |
| `a8ceebb` | 1.17.3 | Show currency-formatted y-axis labels on dollar-denominated charts |
| `dc56c67` | 1.17.2 | Add focus styles, empty-state rows, and modal accessibility; reorder Common panel |
| `c037fa9` | 1.17.1 | Proactively refresh the OAuth access token before it expires |
| `418e9e3` | **1.17.0** | Reorder Transaction columns, add Common payee/spend charts, Time Sheet live duration, percentage histograms; update README and screenshots |
| `31760ca` | 1.16.6 | update |
| `9868e38` | 1.16.5 | update |
| `80db87a` | 1.16.4 | Delete assets/images/architecture-diagram.png |
| `741e6f6` | 1.16.3 | Add files via upload |
| `b8f4f77` | 1.16.2 | Drop the (YYYY-MM) date suffix from the Income/Expenses/Net Cash Flow summary card labels |
| `1f938de` | 1.16.1 | Make Work Pattern Analysis charts visually consistent, center panel-group titles |
| `5f1dcc9` | **1.16.0** | Add transaction bulk edit, fix bulk-selection bar, round chart axis, layout tweaks |
| `49f2864` | 1.15.1 | Fix Break time saving as a duration multiplied by 1440 |
| `d53563c` | **1.15.0** | Add Time Sheet Work Pattern Analysis charts, bulk transaction operations with undo, keyboard shortcuts, and a Time Sheet reminder |
| `8d4b8e3` | **1.14.0** | Add account menu, inline transaction reporting, and a Time Sheet panel |
| `4a1ad79` | **1.13.0** | Add CSV export filters, distinct chart colors, and category autocomplete |
| `bed6427` | 1.12.3 | Polish dashboard layout: panel subtitles, animations, merged FABs |
| `2a9d596` | 1.12.2 | Consolidate chart panels and fix donut tooltip labels |
| `dddc5b5` | 1.12.1 | Remove unhelpful Savings Rate Trend chart |
| `74fad7a` | **1.12.0** | Add privacy mode, reconciliation status, and derive categories/benchmarks from Insight |
| `a59668f` | 1.11.1 | Fix expand/collapse-all FAB label after individual panel toggles |
| `cc5fd33` | **1.11.0** | Add dark mode, collapsible panels, and a floating action button stack |
| `0eb9e80` | **1.10.0** | Add Payee/Description autocomplete to the transaction form |
| `d184a3a` | 1.9.2 | Order chart categories/account types by spend, rename trend panels |
| `be51d66` | 1.9.1 | Document Insight tab and Spending by Type feature in README |
| `f5766f2` | **1.9.0** | Add Spending by Type panel with per-category donut breakdowns |
| `40b6087` | 1.8.3 | Remove silent OAuth refresh to fix mobile sign-in popup failures |
| `7d916e7` | 1.8.2 | Fix dynamic category matching to exclude Income/Expenses, derive Saved/Cumulative by position |
| `edda4a0` | 1.8.1 | Update README for dynamic category columns in Monthly Summary/Benchmarks |
| `be2df89` | **1.8.0** | Add Account Composition & Savings Rate charts, dynamic categories, and UI fixes |
| `54857ad` | 1.7.2 | Add dashboard screenshot to README |
| `bc686fb` | 1.7.1 | Unify category chart colors/legends, reorder charts, and tighten dashboard layout |
| `594af34` | **1.7.0** | Narrow layout to 900px, free-text account types, Save & Add Another for transactions, and mobile chart/donut/header fixes |
| `2394878` | **1.6.0** | Add Spending Breakdown by Category donuts, fix Charts nav anchor and account-type edit bug, refine dashboard terminology |
| `9cb0b25` | 1.5.1 | Move social preview and touch icon into assets/images/ |
| `8d81b7b` | **1.5.0** | Add footer, emoji header icons, SEO/social meta, manifest, and license |
| `27ce59e` | 1.4.2 | Update README.md |
| `fdd8285` | 1.4.1 | Remove Overview link from nav and drop its now-unused section id/styles |
| `2fc8843` | **1.4.0** | Merge accounts views, add sortable tables, fix chart scaling, refine palette and load performance |
| `48548fd` | **1.3.0** | Document detailed architecture in README; add manual cache-clear control |
| `9566a06` | **1.2.0** | Add category spending comparison chart, reorder dashboard sections, redesign landing page |
| `6200c18` | **1.1.0** | Reorganize assets into style/script folders, add favicon, persistent login, account/CSV management, and column sorting |
| `ef1c6f9` | **1.0.0** | Build full Ledger app: auth, dashboard, transactions CRUD, charts, caching, mobile UI |
| `6ca524f` | 0.1.9 | Trim Categories to Category/Color and remove dangling Group/Budget refs |
| `36f4b40` | 0.1.8 | Simplify Transactions/Accounts schema and align Report with existing formulas |
| `86cddcd` | 0.1.7 | Refine README with data model analysis and implementation plan |
| `3179596` | 0.1.6 | Update index.html |
| `042fb5c` | 0.1.5 | Create index.html |
| `9adb39f` | 0.1.4 | Update README.md |
| `c1b8e32` | 0.1.3 | Update README.md |
| `810f7d1` | 0.1.2 | Update README.md |
| `2bba0e5` | 0.1.1 | Update README.md |
| `41be132` | **0.1.0** | Initial commit |
