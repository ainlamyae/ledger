# Changelog

[← Back to README](../README.md)

Every commit, newest first, with the version it produced (see [Versioning](versioning.md)); major and minor releases in bold. Rewritten on every commit by the post-commit hook (`scripts/version.cjs`); the newest row reads *(this commit)* until the next commit fills in its id.

| Commit | Version | Changes |
|---|---|---|
| (this commit) | **3.36.0** | feat: motion rebuilt on iOS's system (motion.js): a SwiftUI-style spring solver (navigation with a quick launch and soft landing, opening with a hint of overshoot, dismissing with none, a springy toast) replaces the fixed curves; forms and dialogs zoom-morph out of the button or row that opened them (its frame and corners reshape into the card by clip-path plus scale, aspect-filled, never squashed) and back into the ✕ clicked or their opener, else rise and drop as a sheet, while the page behind recedes (scales, dims, rounds) and comes forward again; pages launch from their hub tile as the hub zooms past and dims, close back into it as the hub settles in (Insight's views with their own tiles), and page to page is an opaque navigation push with a leading-edge shadow over the old page drifting 30% left and dimming, never see-through; cross-page loads use the same spring, shadow and dimming; the toast springs up and sinks away; docs |
| `d6605f3` | **3.35.0** | feat: Windows/iOS-style motion (motion.js): a form or dialog grows out of the button or row that opened it and minimizes into the ✕ clicked (else its opener, else slides down), solid and evenly scaled, over a copy of its card so every write stays synchronous; pages grow from and minimize into their hub tile (Insight's views into their own tiles), page to page is an iOS push/pop over a snapshot of the old page, and section-to-section or home loads slide through cross-document View Transitions (Back reversed, tab bar and sidebar still, no slide on reload); buttons give under a press; it plays even with the system's animation effects off. Every message written on a page (Saved, Calculate's ♻️/🔗/⚠️ notes, progress, errors) now shows in the undo toast's box without Undo, 3s to 12s by length, errors red, wrapping on a phone; yes/no confirmations stay as they are. Dietary Fiber Intake's bars past the band's ceiling are red, not dark green; docs |
| `7f2c982` | **3.34.0** | feat: LeetCode's Cheat Sheet runs basic to advanced (Control Flow, Logic & Comparison, Numbers & Math, String, Array (List), Functions & Iteration, Set, Dict, Sort & Search, Queue (Deque), Heap, Bits) and within each category, gains 42 interview extras (string/bit tricks, itertools, max-heap, BFS levels) and new Recursion & DP, Pitfalls and Big-O categories, every original row kept; it lays out in two columns (one under 820px), a table per category never split, and the header's 🖨️ prints only the Cheat Sheet on one Letter page with 0.25in margins, its font the largest that fits; docs |
| `ad88f98` | 3.33.1 | chore: version.cjs's legacy commit ids follow the rewritten history (every version unchanged), versioning.md's v1/v2/v3/v3.5 ids point at their commits and the changelog is rebuilt with the new ids |
| `4d2dfc3` | **3.33.0** | feat: LeetCode gains a Cheat Sheet card under the category cards: every Python construct used in the NeetCode 250's neetcode.io solutions (keywords, operators, builtins, methods, heapq/collections/bisect/math), grouped into one table by category (Control Flow, Logic & Comparison, Numbers & Math, Bits, Array, String, Set, Dict, Heap, Queue, Sort & Search, Functions & Iteration), each a header row with a line above it, most used first, each with a few-word use; docs |
| `46dbf2f` | **3.32.0** | feat: Nutrition's form Complete lists USDA's top 10 matches (generic, survey and branded foods) under Amount, each with its Calories/Protein at the typed Amount, closest to the ticked values first with a % match; the clicked one fills the form and is linked to its USDA page under Amount; bulk Complete still takes the top generic match; docs |
| `3cf1f23` | 3.31.1 | fix: Physique's Calculate orders the Consumption box by the breakdown's real (USDA/AI-priced) calories rather than a local-catalogue-only lookup, so the box lands in the same highest-calorie-first order as the Breakdown table beneath it instead of sinking USDA/AI-priced ingredients to the bottom; local pricing stays as the fallback for any line the breakdown doesn't cover, and the merge/capitalization still make no network call (combineAndSortConsumptionText takes a breakdownCaloriesLookup, applied by the form and bulk Calculate alike); docs |
| `4a3bc1f` | **3.31.0** | feat: Health Chart's Daily Progress shows each day's date in its cell (white on a coloured day); Physique's Summary TEF ticks ✅ and Status's TEF turns green once past its desire toward the mass goal (more on a cut, less on a bulk), its Remain following the same way; docs |
| `bf5fadd` | **3.30.0** | feat: LeetCode's Past Year heatmap becomes Daily Progress, from the first solve's Monday to today in Health Chart's chart box (no 16-week phone view), each day showing its solve count and shaded from empty to dark green by its video minutes against the longest day; Health Chart's 7-Day Averages (Calorie Balance, Intake, Caloric Intake, Protein, Dietary Fiber, Fat, Carbohydrate, Physical Activity's Burn, Sleep's Bed & Wake) and the grade lift under them smooth over Tune's L_p and are named for it; Tune clamps its live BMR_cal as Physique stores it, reads BMR under the chosen basis in every Solve-for mode and keeps a solved Δm to three decimals, so its arrival date matches Health's Progress card; docs |
| `ade8f0f` | 3.29.1 | fix: Physique's Consumption and Workout suggestions fill in only from a click or an arrow-picked option, so Enter alone starts a new line instead of swapping in the first match (300g milk no longer becomes 300g milk almond); on touch each option is taller with a line between them; docs |
| `8e89ce0` | **3.29.0** | feat: Body Mass's dots are all one gray under a single Measured Body Mass legend entry instead of the five desired grades and Unscored; its trend smooths over L_p days and is named for it (L_p-Day Trend) instead of a fixed 7; its hover drops m_des (Healthy Body Mass); docs |
| `47a2a71` | **3.28.0** | feat: LeetCode's category cards all start closed instead of opening the first unfinished one; each row gains a Duration column after Difficulty (its NeetCode video's length, read off YouTube for all 250) and 🎥 opens the problem's YouTube video (read off each neetcode.io solutions page) while a new 📄 opens its NeetCode page; the Log form's NeetCode Video becomes NeetCode Page (an old header is read and renamed on the next save) and gains YouTube Video and Duration, filled from the problem; the Progress card gains a video bar of hours watched and to watch in hh:mm, a mark every 10 hours; docs |
| `1e805b2` | **3.27.0** | feat: Physique's form puts its three tables at the foot, each in a labelled card (Consumption Breakdown, Workout Breakdown and Summary, which replaces the Derived dropdown), with Name taking the spare width and shrinking first on a phone; Date, Body Mass, Bed and Wake fold into a Day dropdown, open only on today like Consumption and Workout; Summary gains a ✅/❌ column off its green/red Amounts, TEF, M, Δm′ and BMR (BMR_cal above the mean of BMR_mif and BMR_kat) gain their own colours, carbs under the band read ❌, and empty cells show nothing instead of —; cards round their corners like the input boxes; docs |
| `f82d33e` | **3.26.0** | feat: Body Mass's Calorie Trend starts at the mean of the latest run's first L_p days of readings instead of its first reading, so a bloated or water-heavy first day can't set its start; Sleep's legend reads plain Sleep Deprivation Effect; docs |
| `a517c32` | 3.25.1 | docs: Versioning and Project Structure drop the commit-msg hook's notes, and the hook's own comment is shortened |
| `7ab0b59` | **3.25.0** | feat: Health Chart's Daily Progress heatmap, Calorie Balance's bars, Intake's dots, Physical Activity's burn dots and Sleep's bars and Deprivation dot shade on a continuous blend between the desired grades' colours (desiredGradeBlend) instead of five flat colours; both heatmaps put their month names along the bottom; LeetCode's tile gains a red badge of the solves today owes against the last 7 days' average, on the home page too; a lone-digit badge is a round circle; a failed sign-in shows no banner; Physique's Derived Remain reads — once the Amount is past Desire; docs |
| `0882782` | **3.24.0** | feat: Health Chart gains a Daily Progress heatmap between the range buttons and Body Mass (LeetCode's grid over the range's days, each day its Calorie Balance grade, one chart's height); Body Mass, Calorie Balance, Intake, Caloric Intake, Physical Activity and Sleep grade every day on five desired steps (Beat, Met, Near, Short of and Missed desired) by the share of the desired change it made, lifted to one step under its 7-day average's grade, instead of met or missed; 5y leaves Health Chart and Health Insight's range buttons; docs |
| `fae8bb5` | **3.23.0** | feat: Physique's Derived table gains a Remain column (Desire − Amount, a band's floor for the macros) and green/red Amounts by the Status and Intake Macros cards' rules; BMR moves above M there and on the Status card; Derived, Consumption and Workout tables right-align their numbers, and the Consumption Total row shows floored whole numbers; docs |
| `794acca` | **3.22.0** | feat: Physique's Derived table shows only the BMR picked in Tune, labelled plain BMR, under new Pro/DF/Fat/Carb rows (the Consumption breakdown's grams against the Intake Macros bands), and gains an M row (BMR + AEE, Desire BMR + the desired AEE) between lines under SD; the desired AEE falls back to the latest reading before the day; the Remain row leaves both Calculate tables; docs |
| `8b80541` | 3.21.4 | fix: the plan's BMR_avg ratio is today's at m̄, figured as the Tune does (todayBmrFigures), not the last stored Physique row, which a pre-logged future day could be; Progress and the Status card's ETA now match the Tune's t; docs |
| `75e5a6e` | 3.21.3 | chore: version.cjs's legacy commit ids follow the rewritten history (every version unchanged) and the changelog is rebuilt with the new ids |
| `1f78ad5` | 3.21.2 | chore: the pre-commit and pre-push hooks go; version.js's comment names post-commit as what stamps it; docs |
| `95eb5d3` | 3.21.1 | chore: version.cjs's legacy commit ids follow the rewritten history (every version unchanged) and the changelog is rebuilt with the new ids; sidebar comments and the navigation doc trimmed |
| `a21c3fd` | **3.21.0** | feat: LeetCode gains a Progress card above Past Year (Health's meter over the NeetCode 250, solved and left, a mark every 25) with a time bar under it, days since the first solve against days to go at last week's pace and the finish date; the heatmap starts weeks on Monday, stretches its square cells to the card and on a phone shows Past 16 Weeks; the roadmap shrinks to the card on a phone; the solved summary moves under Roadmap's title; LeetCode comes first in Track, before Work Time; docs |
| `a5b3931` | **3.20.0** | feat: every chart's hover is drawn over the page (htmlTooltip, Chart.js's own look and callbacks) so a tall one such as Intake's or Calorie Balance's is no longer cut at the chart's bottom; Intake's hover adds each macro's logged grams after its kcal and Intake and Calorie Balance show only the BMR selected in Tune (selectedBmrKey, shared with the Status card); the dated Health charts' y axes are fitted to their widest label, one width on both sides (fixDatedYAxisWidth), while the Rotation charts keep 120px; docs |
| `d1331f4` | **3.19.0** | feat: Health Chart gains Intake under Calorie Balance, each day's Protein, Dietary Fiber, Fat and Carbohydrate as stacked kcal (carbohydrate net of fiber, scaled so the stack equals TEI) under Caloric Intake's own TEI dots, 7-Day Average, Desired cap and five BMR caps; 🔍 beside 📤 shows Caloric/Protein/Dietary Fiber/Fat/Carbohydrate Intake, Protein Source Rotation and Activity Rotation, hidden by default and on every reload (🙈 hides them); Protein Source Rotation tops Nutrition and Activity Rotation tops Activity and, above the tiles, Workouts; Progress marks every 2 kg and every 4 weeks with one smooth red-to-green fill; saving a Physique day whose D is above its Desire pulses the page edge red and shakes the form; Derived is open on every date; docs |
| `7fcf2d4` | **3.18.0** | feat: 📤 on Health and Finance Chart saves the whole page as a PNG (phone share sheet to the gallery, laptop download), drawing charts not yet scrolled near first (buildPendingCharts) with html2canvas-pro, keeping the page's CSS, fonts and unboxed legends; Market leaves the sidebar now its tile lives on Finance Insight; the Status card shows only the BMR selected in Tune, adds M (maintenance, BMR + AEE) between lines under SD and ETA, the plan's days and date to the healthy mass as on Progress; docs |
| `bd1cb84` | **3.17.0** | feat: every dated Health chart's axes refit to what its legend still shows (Body Mass, Caloric Intake, Calorie Balance, Protein, Carbohydrate, Fat, Dietary Fiber and Sleep's clock axis skip hidden entries, as Physical Activity already did); Body Mass, Physical Activity and Sleep dots shrink with the range like bars (fitPointRadius, fitPointBorderWidth: at most 40% of a day's slot, border thinning with it); Protein Source Rotation and Activity Rotation draw a 550px bar chart beside the donut; print starts on sheet 1 (a chart box, not a page-tall panel, avoids a break), prints legend swatch colours and keeps donuts round; docs |
| `c0aaebf` | **3.16.0** | feat: Tune's Basal metabolic rate gains BMR_avg, the average of BMR_mif, BMR_kat, BMR_cal and BMR_adp (BMR_adp as of today), as a basis the whole plan can run on (the active equation scaled by BMR_avg / equation), with a BMR_avg row under m-inf_adp, its Equations and Calculations lines, a stored BMR_avg in every Physique day's Derived JSON, a Derived and Status row, a fifth Caloric Intake cap and the hovers; the Setting tab's old target keys are renamed with their duplicates merged, every key the app writes has a default Note filled on save and on load; bulk Calculate tidies Consumption and the Tidy button goes, as does Save & Add Another; Transfer, Capitalize Names, Import CSV, Update Market Value and the two contact exports become emoji buttons and Transfer's commit a Save; Amount reads gr, gram and grams as grams; docs |
| `3064dfb` | **3.15.0** | feat: "target" leaves the whole project, code, setting keys, ids, classes, file names, comments and docs, for the UI's words: healthy for the body-mass goal (BODY_MASS_HEALTHY_KG, healthyKg) and desired for every other goal (SLEEP_DESIRED_HOURS, getCalorieDesired), health-nutrient-targets.js now health-nutrient-desired.js; every dated Health chart gets a swatch legend under it whose entries click to hide their series or bars/dots of that colour, desired marks turn cyan apart from the 7-Day Average, results read Desired met / Near desired / Missed desired alike, 8 evenly spaced gridlines with the first and last date on the plot edges at every range and a 120px left y axis so Rotation names fit; Body Mass draws Tune's healthy body mass, joins its dots with a thin gray line across gaps, plots a lone old reading, restarts its trend lines after a 14-day gap and draws the Calorie Trend in indigo; Tune opens a fresh user on the user's own figures (m_des 70 kg, L_p 7, n_p 4, gamma 3, kappa 3, walking MET 3, f 13.5, b_min 17, q 30-50, Delta-m% 1, a 170 cm / 35 y / 38-91-99 cm profile); a receipt of 2+ transactions ends in a blue UI-only total, the Pay badge shows only for the 3 days after Payment Day and on the home tile too; docs |
| `49fa6df` | 3.14.1 | refactor: rename every feature file, identifier, comment and doc to the UI section-page scheme (health-/finance-/track-/other-/ledger-*; wellness→health, Indicator→Chart, Timesheet→Work Time, Formula Playground→Tune), shared infra left neutral and the Wellness insight feature kept as-is; split the Health chart module into one file per chart; align the Health Chart vertical gridlines at every range via a fixed y-axis width; printer-friendly @media print rules; Body Mass chart joins its dots with a connecting line; fix the physique data-load crash by coercing text cells to strings; add the system-architecture diagram to the README and correct the social-preview description order; remove the one-off activity-image fetch scripts; add walk/backstroke/run activity gifs |
| `00ea8db` | **3.14.0** | feat: Breakdown leaves the Finance and home tiles and the sidebar (PAGES_WITHOUT_TILES in page-nav.js; /finance/breakdown/ still opens, and commenting its entry out brings them back); Calculate title-cases each exercise name in a day's Workout box, and the Workout table under it shows names that way, as Consumption does for ingredients; docs |
| `a28dfd6` | **3.13.0** | feat: Tune adds neck, waist and hip under age, U.S. Navy body-fat % (Hodgdon & Beckett) under BMI_des and LBM_navy above the Boer LBM, now LBM_boer, with their Equations and Calculations lines in Variables order; a Lean body mass question above Basal metabolic rate picks Boer or U.S. Navy for Katch-McArdle, A/B, protein and glycogen app-wide (LBM_FORMULA); new settings get a default Note; an account's Payment Day (1-31, Break-sized box) shows a red Pay <n>d badge on its row and the Account tile once passed unpaid; Activity Rotation runs furthest below desired first, like Protein Source Rotation; docs |
| `43c3213` | **3.12.0** | feat: home and hub tiles are liquid-glass capsules (frosted, top shine, lit rim, soft shadow) over their old colour coding, while sidebar links go back to plain list items; Contact, Refresh data, Clear cache and Settings sit above the switches, now named Dark mode, Amounts, Widgets and Bulbs, which show and work before sign-in from this browser's last values (Widgets and Bulbs off by default) and take the Settings tab's once it loads; Market's tile moves beside Snapshot on Finance Insight; Portfolio Allocation is renamed Account Allocation; docs |
| `7f69c84` | **3.11.0** | feat: Contact and Settings open from the account menu, and Other leaves the tab bar, sidebar and home page (its /other/ addresses still work); sidebar links are liquid-glass capsules with a lit rim, top shine and a lift on hover, blue glass when selected; docs |
| `11d69e7` | 3.10.1 | fix: Physique's Derived table shows TEF from intake alone, and before Bed and Wake are typed reads SD as 0 with D and Δm′ worked out from it; ticking Pattern also hides Workout (with its table) and Derived, and a pattern saves Workout, Duration and AEE blank; Protein Source Rotation, Activity Rotation (both copies) and Finance's Cumulative Net Worth sit flush under their headings like every other chart; docs |
| `f3e1c9c` | **3.10.0** | feat: a new exercise in a day's Workout is priced by AI on Calculate (MET, Category, Group, Muscle Group, Sets x Reps and Rest), its row showing AI with 💾 to save it to the Activity sheet and ✏️ to fix it first, and ✅ for one already there, as Consumption does for a new ingredient; table columns 5px apart everywhere; Add Activity's Save finds the saved row by Name, not Category; docs |
| `fbe6b69` | **3.9.0** | feat: sidebar's bottom panel holds Refresh data, Clear cache and the show/hide settings as iPhone-style switches (Dark mode, Show amounts, Show widgets, Show bulbs) above an account row with the Google picture, name and email that opens the account menu above it; links scroll on their own above the panel; with the sidebar hidden or below 1180px they sit in the account menu instead; docs |
| `a5c21b4` | 3.8.1 | chore: version.js and changelog for 3.8.0, which the post-commit hook skipped while WSL had no node |
| `8a04dce` | **3.8.0** | feat: sidebar hides with a panel button in the logo row (or Ctrl+.), leaving the Ledger logo as the button to bring it back, remembered before first paint; hub tiles colour-coded by function (gray database, green form, orange chart, purple AI incl. Market and Insight modes); Portfolio between Breakdown and Watch List; Health ranges add 6m and 5y, Finance Indicator adds 5y; Caloric Intake y axis from 0 kcal; Protein Source Rotation scales Protein % to 100% and targets the protein band's top; docs |
| `d620a4e` | **3.7.0** | feat: Track LeetCode page with the NeetCode 250 roadmap by category (✅, Solved, Problem, Difficulty, 🎥 NeetCode video and 🔗 LeetCode buttons), one category open at a time; Past Year heatmap and NeetCode's roadmap graph cards; 📝 Log form (Date, Problem, Category, Difficulty, LeetCode, NeetCode Video, Notes) saving to a LeetCode tab with columns found by header; docs |
| `e73912d` | **3.6.0** | feat: changelog of every commit with its version, rewritten by the post-commit hook; version counted from 0.0.0 over the whole history with judged legacy commits (Finance Market as 3.0.0); docs |
| `8962a67` | **3.5.0** | feat: version from commit messages (Conventional Commits, as in CELPiPi): feat bumps minor, fix/other bumps patch, feat! bumps major; post-commit hook stamps version.js; docs |
| `cd5ebbb` | **3.4.0** | Weather widget: today's sunrise and sunset on the current-conditions line (icon and temperature, condition on hover) to keep it one line; docs |
| `8629ee8` | **3.3.0** | Range buttons (1w/1m/3m/1y/All) replace From/To on Health Indicator and Health Insight; Finance Indicator 3m/6m/1y/All for Net Worth and Expenditure Trend, uncapped y axis; Settings tabs with own addresses and Note/Key/Value columns; every table fits its content; Protein Source Rotation stacked by ingredient with ingredient legend; Nutrition drops Uses, orders used-today then protein; Transaction line per receipt; docs |
| `c23c09f` | **3.2.0** | Watch List price alerts (below/above price, long-term average, trailing stop) with red badges on Watch List and Market, dismiss, 4-hour background check; AI suggests alerts in a fixed line with 📌 apply and checks; entry stop for buying today and position size; Market and Portfolio cards 2x2 on phones; docs |
| `c6ba7c1` | **3.1.0** | Finance: Watch List page (🔬 opens Market) and Market page merging the chart with Analysis; watchlist picker; long-term chart lines (SMA200, 52-week high, trailing stop, market) with Chart history sent to AI; trailing stop default 4 ATR; TSE: AC symbol input; Alpha Vantage spacing and TSX news message; docs |
| `40c813a` | **3.0.0** | Finance Market, Portfolio and Analysis pages: watchlist and price history, ACB trade log in CAD, evidence-based signals with AI read; smaller phone tab labels; docs |
| `5dc36a4` | 2.94.1 | Activity: one table with Category and Group columns, a line at each Group change; docs |
| `0251c20` | **2.94.0** | Red day-count badges: Finance Insight Snapshot, Transaction over 30 days, Work Time days since last log; keep Insight badges after tile redraw; docs |
| `16305cd` | **2.93.0** | AI provider switch (Groq or OpenRouter) with models from Settings; 30-day red badges on Insight tiles; docs |
| `eaa521b` | 2.92.1 | Tune: shorter variable names and BMR label; Equations in the site font, headings dark, equations gray; docs |
| `0fa0022` | **2.92.0** | Tune as four cards with one BMR choice and desired wording; account details beside Account; one side-by-side field gap; docs |
| `0629ebc` | **2.91.0** | Workouts (was GYM) with Cardio and NEAT; desktop footer strip as phone; even glass sidebar; sidebar closes open form; m̄ in progress bubble; docs |
| `3efbb87` | 2.90.7 | Phone polish: top safe-area strip, faded footer, lighter bottom bars, plain tab colours, iOS-style search boxes, m row in Derived |
| `6786f37` | 2.90.6 | Tiles: neutral gray capsules with 12px labels |
| `892406a` | 2.90.5 | Four tiles a row on a phone |
| `9497661` | 2.90.4 | Body text 13px |
| `deabee0` | 2.90.3 | Footer "© year ALI — Ledger vX"; author meta and schema.org JSON-LD |
| `e60d8bd` | 2.90.2 | Footer as "Ledger vX • © year ALI"; card text 12px |
| `89e9dca` | 2.90.1 | Body text back to .9rem |
| `cc8df16` | **2.90.0** | Track section, Apple-style look, titled tile cards, one type scale |
| `12b09a3` | **2.89.0** | Confetti on saving an income transaction; darker hover shadow |
| `0fcbf0e` | **2.88.0** | Nutrition Group, grams-first Amount, Protein Rotation by Group; Pattern form; Finance tweaks |
| `732bcfb` | **2.87.0** | Physique: collapsible Derived table with Desire targets, calibration ramp-up/clamp; Activity Rotation on GYM; Body Mass dots |
| `86c2e3e` | 2.86.3 | Nav: bottom bar through tablet widths, no top-bar gap before the sidebar |
| `f433823` | 2.86.2 | Transaction filters: dates on top, the four filters in a 2x2 grid on phones |
| `6c2d133` | 2.86.1 | Fix local-date bugs, suggestion placement and stale docs; remove dead code |
| `5a021a7` | **2.86.0** | Automatic version in the footer; confetti fires on save |
| `53e01d3` | **2.85.0** | Split README and features into topic docs; pin phone suggestions to the top; confetti on body-mass progress |
| `c655c7d` | 2.84.8 | Rename Physique's BMR column to Derived, underline Activity table headers |
| `597d43b` | 2.84.7 | Widgets as bulbs, one gap across the home page |
| `51fd11b` | 2.84.6 | Same gap from the last bulb to the tiles as between bulbs |
| `12710ae` | 2.84.5 | Charts and GYM activities as bulbs; Micronutrients tables compact |
| `d973833` | 2.84.4 | One font family, Today before GYM, even gap under date rows |
| `741d59e` | 2.84.3 | No auto-zoom on iPhone, header-row lines, Insight views reload in place |
| `fc224c3` | 2.84.2 | Tables size columns by the table alone; cards keep their padding on phones |
| `2a37c4e` | 2.84.1 | Tables: fixed row heights, row buttons never stacked |
| `2ee886c` | **2.84.0** | GYM page, quick logging, and one consistent style system |
| `32ec7ca` | 2.83.2 | Day form: Sleep Duration/Deprivation line in the m̄/Δm/BMI style |
| `d813e56` | 2.83.1 | README: stored glycogen swing, load timing logs, body-mass and Load wording |
| `0ff62cc` | **2.83.0** | Finance: Cumulative Net Worth glance card under the summary cards |
| `0da3a90` | 2.82.9 | Remove Health's Settings block; Other's Settings is the one page |
| `3d7ef40` | 2.82.8 | Log where a load's time goes |
| `9d22429` | 2.82.7 | Day form: m̄/Δm/BMI line with each unit once |
| `7b3d042` | 2.82.6 | Day form: m_d shown in kg |
| `320868d` | 2.82.5 | Day form: m_avg/m_d/BMI line, each in its own unit |
| `35bfe42` | 2.82.4 | m_d stored in kg/day like every other body-mass figure |
| `332bb91` | 2.82.3 | Body-mass figures stored in the BMR cell, not a new column |
| `0ffe6dd` | 2.82.2 | Tune's Update: say it recomputes m_avg too |
| `11b7ffc` | 2.82.1 | Activity: an exercise's Weight is shown as Load |
| `d121a18` | **2.82.0** | Stored Mass column: m, BMI, m_avg and m_d saved per day; body-mass wording |
| `ce675f6` | 2.81.17 | Glycogen swing saved once as GLYCOGEN_SWING_KG |
| `adaddf2` | 2.81.16 | Phone footer: copyright line 10px lower |
| `26348a3` | 2.81.15 | README: phone footer strip, left-aligned date/time fields |
| `cf67966` | 2.81.14 | Phone: copyright line in a strip under the bottom bar |
| `cff1333` | 2.81.13 | Phone: no scroll on a short page, footer resting on the bottom bar |
| `e8be6c9` | 2.81.12 | Forms: date and time values pinned left on iOS too |
| `715c000` | 2.81.11 | Forms: date and time values left-aligned |
| `ecb6e27` | 2.81.10 | README: drop the short-page height note (reverted) |
| `e836a0c` | 2.81.9 | Revert "Short pages fit the screen; footer above the phone bottom bar" |
| `d81f8e9` | 2.81.8 | README: logged rows, Progress card note |
| `14fcd33` | 2.81.7 | Progress card: no empty line under the last bar |
| `a071d4b` | 2.81.6 | Status: one m row with the rolling average in brackets |
| `f92aaee` | 2.81.5 | Status: m shows the glycogen/water swing beside its target too |
| `9a24a36` | 2.81.4 | Activity: no hover note on a logged row, like Nutrition |
| `ed904cd` | 2.81.3 | Activity: a logged row is green with no tick, like Nutrition |
| `01907f4` | 2.81.2 | README: Workout suggestions, page height and footer |
| `9acaf21` | 2.81.1 | Short pages fit the screen; footer above the phone bottom bar |
| `efd9a05` | **2.81.0** | Physique form: exercise-name suggestions for Workout |
| `6d8d095` | 2.80.11 | README: actions in one place, phone bar spacing, form button order |
| `b3af487` | 2.80.10 | Phone bottom bar a quarter closer to the bottom edge |
| `16eb040` | 2.80.9 | Actions at the top on every page, in the phone bar's order |
| `e4cb5b7` | 2.80.8 | Reload of a row address: no lowercase name in the breadcrumb |
| `6eeaeee` | 2.80.7 | Ingredient form: Scan before Complete |
| `5451423` | 2.80.6 | Ingredient form: name and unit columns at the page's text size |
| `20fba01` | 2.80.5 | Ingredient form: name column as wide as its text |
| `d2fa55b` | 2.80.4 | Phone bottom bar: half the gap between buttons and the account circle |
| `7f908bd` | 2.80.3 | Phone bar spacing even at both ends; Physique form: Scan first |
| `ec25537` | 2.80.2 | README: first-paint layout, Ledger tab, phone bar details |
| `be00493` | 2.80.1 | Hub/page layout from the first paint |
| `ebcab15` | **2.80.0** | Car Service: winter changeover and rust protection on 1 Dec |
| `6aa0946` | 2.79.1 | Phone bottom bar: long labels wrap onto two lines |
| `046f454` | **2.79.0** | Phone tab bar: Ledger tab for the home page |
| `d13b20d` | 2.78.2 | Phone: account avatar the same circle as the bottom bar's close |
| `1bd1c28` | 2.78.1 | Hide bulbs: keep the cards on section pages |
| `8bc518d` | **2.78.0** | Hide bulbs: account-menu toggle for the home page's glance cards |
| `e5f924f` | 2.77.3 | Phone bottom bars float above the home indicator |
| `983ac3b` | 2.77.2 | Pill bottom bars, round close, emoji buttons always white |
| `af2c95d` | 2.77.1 | Selection-bar buttons and Physique's Today as white emoji |
| `690d225` | **2.77.0** | Emoji action buttons, badges, saves stay open, exports in Settings |
| `73d522d` | 2.76.2 | Phone bottom bars: one height, one button style |
| `2bcdcfb` | 2.76.1 | Six text colours, thinner tables, home breadcrumb, compact BMR line |
| `57da33a` | **2.76.0** | Every form a page, no top bar, Insight mode pages, all styling in styles.css |
| `b62d6f6` | 2.75.4 | Breadcrumb: link a row's date over its 🧬 view |
| `82ac54e` | 2.75.3 | README: batched reads, per-page loading, breadcrumb root |
| `cbf72c4` | 2.75.2 | Breadcrumbs start at Ledger, linking to the home page |
| `40f7238` | 2.75.1 | Contact table: columns fit their text, scrolling sideways |
| `30aa4d8` | **2.75.0** | One bottom bar at a time on phones, ❌ on every page, direct form loads |
| `b7049ab` | 2.74.4 | Section hubs: breadcrumb in place of the centred title |
| `9107c5f` | 2.74.3 | Health hub: Today as the first tile, before Tune |
| `e048cad` | 2.74.2 | Settings tables: actions and key on one line |
| `b04a980` | 2.74.1 | Health hub: keep Today, drop Log |
| `f90856d` | **2.74.0** | Today and Log on the Health hub |
| `67748ab` | **2.73.0** | Form pages styled like block pages; home overview with tiles; name-only tiles |
| `26ef72b` | **2.72.0** | Forms open as pages on section pages |
| `7ab1bef` | 2.71.1 | Finance: Financial Indicator/Insight become Indicator and Insight |
| `92576ce` | **2.71.0** | Section pages as a hub and pages, with a sidebar on wide screens |
| `5a7c2c0` | 2.70.1 | Load only the current section's blocks |
| `77fcb9e` | **2.70.0** | Batch Sheets reads and share the tab list; add Clear cache |
| `0952cf0` | 2.69.2 | Pattern table: content width, one line per cell, compact padding |
| `9de00d1` | 2.69.1 | Profile order: sex, height, age, then body mass |
| `244a145` | **2.69.0** | Health Settings block; read walking MET and BMR_cal from their sheets |
| `4dad826` | 2.68.1 | Insight mode names and order, Food macro fallback, consistent hover units |
| `4c95ce6` | **2.68.0** | Nutrition Facts order and names, setting-driven targets, more row addresses |
| `0cc0fa6` | 2.67.6 | Progress card: regular-weight figures and lost/left, elapsed/ahead labels |
| `eeaad17` | 2.67.5 | Remove all caching; smooth m̄ over L_p; Status, Progress and unit cleanups |
| `34a3ad9` | 2.67.4 | Car Service: wrap Basis in a narrow column; bump shell cache to v29 |
| `5e6c412` | 2.67.3 | Stop iOS Safari text inflation (Car Service Basis column) |
| `3f7b7eb` | 2.67.2 | Progress card: stat text at the Status rows' font size |
| `d3b5f73` | 2.67.1 | README: Status, Progress card, ingredient form and Pattern micronutrients |
| `2145eac` | **2.67.0** | Health glance: drop m̄ and t, Progress card with 10% marks under the cards, tighter stack, Sleep Window first |
| `051749f` | **2.66.0** | Physique Patterns: own micronutrients table and pattern-N addresses |
| `7e9a39b` | 2.65.2 | Ingredient form: Amount as a stacked field like Classification and Name |
| `bd02050` | 2.65.1 | Ingredient form: label-matched names and units, fixed right-aligned fields |
| `56bbad4` | **2.65.0** | Standard units, editable Patterns period length, sheet-matching sleep labels |
| `12e82c0` | **2.64.0** | Nutrition lock table, per-row edit addresses, Insight prompt templates |
| `8c6d09a` | **2.63.0** | Add Equations and Calculation dropdowns to Tune |
| `b6dbe9f` | **2.62.0** | Add Car Service reminder flag and daily notification |
| `cc1b712` | **2.61.0** | Add Car Service block with service history and predictions; chart hover consistency |
| `b56aa8e` | **2.60.0** | Add block/form addresses, Tune block, and stored per-day BMR in Physique |
| `dc2fa83` | **2.59.0** | Pin form actions to the bottom on mobile, update balances on edit, add progress bar bands |
| `8220c0c` | 2.58.1 | Sort Activity plan and Instructions modal by rotation completion |
| `6747dbf` | **2.58.0** | Add export confirmation dialogs and reorder Status card rows |
| `3665c1f` | 2.57.3 | Fix Breakdown action buttons wrapping on mobile, Sleep header abbreviation, integer macros in Physique table |
| `bd9dd5e` | 2.57.2 | Improve Transaction and Physique UX across filters, exports, and table display |
| `ecb0a87` | 2.57.1 | Make forms full-screen on mobile and fix background scroll |
| `35086f7` | **2.57.0** | Add block-visibility toggle, catalogue propagation, and Health Plan parity |
| `53f09c6` | 2.56.1 | Make Health Insight tables/profile consistent across modes |
| `1d4ebae` | **2.56.0** | Make Health Insight's Patterns period length user-editable |
| `c4fbfc7` | **2.55.0** | Add a Patterns mode to Health Insight |
| `d99d1a6` | **2.54.0** | Add BMR calibration, fix Calculate/basis bugs, and clean up small UX gaps |
| `12bcc3c` | **2.53.0** | Replace the Health Indicator charts' weekly-bucket trend with a continuous EMA |
| `4af6408` | 2.52.1 | Make the phone bottom nav a real tab bar with thumb-sized tap targets |
| `c8cf130` | **2.52.0** | Overhaul the mobile layout: bottom nav, auto-hiding header, fixed dark-mode colors |
| `2e4491a` | 2.51.2 | Ignore local editor settings |
| `1d07c3d` | 2.51.1 | Show 28 dated days plus every Pattern row per Physique page |
| `d0329bd` | **2.51.0** | Add a Log button to the Add/Edit Activity modal |
| `4fb6a30` | 2.50.1 | Document that Settings masks API keys/tokens by default |
| `2b200bb` | **2.50.0** | Add today's raw body mass to Status, mask secrets in Settings, line off Physique weeks, and harden dashboard loading |
| `b0de122` | 2.49.4 | Drop the visible "Loading your data..." banner and fix the scan's vision model |
| `088a090` | 2.49.3 | Drop the default sign-in banner and let gated actions sign in on click |
| `258f196` | 2.49.2 | Fix Physique scan's vision model id, which pointed at a nonexistent Groq model and made every scan fail. The comment above it already named the intended model (Llama 4 Scout); the constant just never matched it. |
| `1f1e9a2` | 2.49.1 | Drop `required` from every form field except Log a Transaction's Date/Account, so a field that doesn't actually need a value stops blocking Save over it. |
| `3eca770` | **2.49.0** | Add an Activity Rotation chart to Health Indicator, matching Protein Source Rotation's bar+donut shape: a new Weekly Target column on the Activity sheet drives a horizontal bar (sessions logged vs. desired this window, one bar per Group) and a three-ring donut (reference weekly split, last 4 weeks, last week). A session credits every Group a day's Workout notes touch, not just the dominant one. |
| `bdada9b` | 2.48.2 | Fix Delta-m's target to negate WEEKLY_FAT_LOSS_KG the same way D's target already does, so a cut's desired mass change reads negative (losing) instead of positive, and keep the Status/Macros/Activity/Sleep bento as two columns below 640px instead of collapsing to one, with tighter row and card padding so the Status card's longer figures still fit on a phone width. |
| `b33f950` | 2.48.1 | Split the Status card's BMR row back into BMR/lambda-t/BMR_adp so the adaptation discount and its result are always visible, independent of which basis Balance/Delta-m actually run on. |
| `33ed153` | **2.48.0** | Add a global BMR/BMR_adp basis toggle to the Formula Playground and wire it through every deficit, calorie target and the forecast's A/B, split the Status card into a Status/Macros/Activity/Sleep bento layout with new BMI and lambda-t rows, standardize chart hover labels to the Playground's symbol vocabulary (TEI/AEE/TEF/SD/D/BMR/BMR_adp) across Body Mass, Calorie Balance, Caloric Intake, Protein/Fiber/Fat/Carb, Activity and Sleep, fix the Body Mass chart's Calorie-Implied Trajectory to reach today instead of stopping at the last weigh-in, add a per-day Adapted BMR dashed line to Caloric Intake, and replace "target" with "desired" across Health Indicator and Health Insight prompts. |
| `e864c7f` | 2.47.1 | Simplify the Status card's Intake separator to / and drop the explicit + on positive figures |
| `25d8973` | **2.47.0** | Rebuild Health Status card as an energy-budget ledger and add Desire/Remain to Physique breakdowns |
| `c707705` | **2.46.0** | Add a Normalize button to the Nutrition ingredient form, a Capitalize Names bulk action to Nutrition, and fold Physique's own capitalize/combine buttons into one Tidy button |
| `1c06c9e` | **2.45.0** | Resync the Health Formula Playground to the metabolic-model reference notation, add a deficit-vs-BMR warning row, and widen the symbol column |
| `5268746` | **2.44.0** | Add account-to-account Transfer, split README into docs/, and give Tune/Today/Transfer their own gray button role |
| `ec51720` | **2.43.0** | Reorder Physique table columns, add Sleep Deprivation readouts, and gradient the Caloric Intake and progress-meter colors |
| `77d92f2` | **2.42.0** | Redesign Status card to 5 rows, add Intake/Digestion/Activity/Deprivation mirror rows, fix null-textContent crash, graduate progress bars blue-to-green, and remove the JSON backup export |
| `b8a34b7` | **2.41.0** | Model sleep deprivation's effect on fat loss across Health Indicator, and fix chart x-axis consistency |
| `6299c8c` | **2.40.0** | Rename the Macros/Activity glance cards to match their charts, add a Cardio/NEAT/Strength breakdown, fix a label typo |
| `e521a8c` | **2.39.0** | Redesign the Today-at-a-glance cards into Status/Macros/Activity/Sleep, and add a per-day Basal Metabolic Rate marker to Caloric Intake |
| `6fde846` | **2.38.0** | Rework the Today-at-a-glance cards into Body Mass, Activity, Macros and Sleep, and fix the sign-in check being stuck behind window.load |
| `bd57bf6` | 2.37.2 | Remove the header global search box |
| `ca82662` | 2.37.1 | Show the dashboard shell before sign-in, split charts.js/physique.js/formula-playground.js into focused modules with lazy chart loading, and add a health reminder banner, global search, full backup export, and offline app-shell support |
| `e379be1` | **2.37.0** | Add a Carbohydrate Intake band to Wellness, fix AI report formatting, and rename macro labels for accuracy |
| `46138a4` | 2.36.1 | Give the top nav more breathing room |
| `cc937ba` | **2.36.0** | Add a Physique Today button, move Tune/Scan into the day form, add a live Sleep Duration readout, and turn the home page into a lightweight summary |
| `4fd67f6` | **2.35.0** | Add day-target rows to Physique's Consumption/Workout tables, a Consumption divisor syntax, a muscle-loss fill on State Trend & Forecast, and fix the iOS Scan button |
| `7167a57` | **2.34.0** | Add food-photo Scan to Physique, directional reconciliation flag, and update README |
| `810f5d0` | **2.33.0** | Suggest ingredient names while typing Consumption, mobile-keyboard-aware |
| `c209d81` | **2.32.0** | Auto-combine Consumption/Workout on Calculate, bound State Trend & Forecast to the panel's From/To, and fill Fat Intake's band |
| `afd9c10` | **2.31.0** | Add a Fat Intake chart to Wellness, with dashed-line band targets |
| `f874e0a` | 2.30.1 | Rename Rest & Recovery to Sleep, collapse Physique's Bed/Wake columns into one Sleep hours column, and reorder Physical Activity above Caloric Intake |
| `ceaf9a8` | **2.30.0** | Add a Nutrition Log/Log More button and today's-usage row highlight, and reorder the Formula Playground to match its own legend |
| `a796452` | **2.29.0** | Add multi-macro Consumption anchors, an edit-before-banking button, a Nutrition usage count, and a fat band to the Formula Playground |
| `e937246` | **2.28.0** | Add a fiber band to the Formula Playground, mirroring protein's band |
| `0d25123` | **2.27.0** | Unify Nutrition's USDA lookup/pull into one button, add Fiber tracking, and consolidate table styling |
| `61ce5b9` | **2.26.0** | Add Fiber/Fat/Carbohydrate columns to Nutrition, Physique and Food Insight |
| `9b68cbf` | 2.25.1 | Merge Physique's breakdown and TEF tables into one per-ingredient table |
| `040b4ec` | **2.25.0** | Add a per-ingredient TEF column to Health Insight's Food mode |
| `ea0d324` | **2.24.0** | Add a per-day TEF column to Physique, measured from real macros where available |
| `333cbac` | 2.23.2 | Move dark mode and hide-amounts toggles into account menu, drop panel-toggle FAB |
| `397b12e` | 2.23.1 | Speed up first paint, and tune State Trend/Forecast, Sleep, Account and Physique feedback |
| `a1ade7f` | **2.23.0** | Add State Trend & Forecast's smoothed trend line and glycogen/water swing zone to the Body Mass chart |
| `14c346c` | **2.22.0** | Add a per-day Micronutrients view to Physique, only flag nutrient shortfalls, and date-suffix day-scoped modal titles |
| `dc28863` | **2.21.0** | Add glycogen/water swing awareness to Health Indicator scoring and forecast |
| `9f5edaa` | 2.20.3 | Make modal titles consistent, rename Work panel to Work Time, widen the page container, and drop the nutrition Amount hint |
| `f973e8b` | 2.20.2 | Recolor Calorie Balance bars: dark green when a day meets target, red when both the day and its 7-day average miss it |
| `5dce7a9` | 2.20.1 | Fix Calorie Balance tooltip's 7-day fatloss to multiply by 7 |
| `6b0a077` | **2.20.0** | Add 7-Day Expected Fatloss to the Calorie Balance chart's hover tooltip |
| `6aef9c2` | **2.19.0** | Add a reference-target ring to Protein Source Rotation's donut, and reformat the Activity glance tile's kcal note |
| `fb35387` | 2.18.1 | Fix the glycogen store's muscle-mass basis in the Formula Playground, and widen the symbol column |
| `79fd189` | **2.18.0** | Make Log Time mobile-friendly again, drop the Monthly Expenditure average, and add a glycogen/water swing to the Formula Playground |
| `4356fcd` | **2.17.0** | Add a Weight column to the Activity Plan, sort Micronutrients ideal-first, alphabetize pulled micronutrient JSON, and fix Log Time's Start/End/Break formatting |
| `eb0339e` | 2.16.1 | Change Log Time's Break field from a plain-minutes number to an HH:mm text input |
| `5020f27` | **2.16.0** | Add Ideal/day targets to Micronutrients, a Muscle Group column to the Activity Plan, and fix a protein-decimal and a Break-field bug |
| `f109a77` | **2.15.0** | Add a Micronutrients column to Nutrition, a bulk/single-row pull from USDA's full nutrient panel, and a new Health Insight mode built on the real totals |
| `812afcd` | **2.14.0** | Color-code Protein's glance tile past its band top, and add a body mass value bubble to the progress bar |
| `baf584c` | 2.13.1 | Shorten the Calculate breakdown's USDA source label to just USDA |
| `f47e694` | **2.13.0** | Add a system architecture diagram, a divide-quantity and a protein anchor to Calculate, and mask bed/wake time in privacy mode |
| `801fe0e` | **2.12.0** | Give each panel group its own address, and let a transaction move its account's balance |
| `3439f1f` | **2.11.0** | Add four terms to the Formula Playground, and a BMR equation to choose from |
| `e2745be` | 2.10.1 | Sign the Calorie Balance hover, and name its first row like the other charts |
| `b53a7be` | **2.10.0** | Fold income into the expenditure trend, and make every legend a switch |
| `cf138b6` | **2.9.0** | Add a Breakdown panel and a Tax button, and rename every sheet tab in one place |
| `08ae9b3` | 2.8.1 | Move "where," onto the variable list, and shorten a Nutrition header |
| `2692be8` | **2.8.0** | Add a fat-loss percentage: a Δm% box, a solve mode and a third pin |
| `fbf408f` | 2.7.3 | Show Monthly Income as this month alone |
| `bc3d8d7` | 2.7.2 | Shorten the Contact List heading to Contact |
| `2db9d9f` | 2.7.1 | Move Activity below Nutrition in the Health section |
| `bb9b993` | **2.7.0** | Renew the token before a form opens, and add a Health Plan feasibility insight |
| `6384853` | **2.6.0** | Cut every panel button to one word, and add a lean-mass protein band to the playground |
| `8ab79cf` | **2.5.0** | Pin the activity target by time or calorie burn, add a Protein Sources AI insight mode, and shorten the Work/Travel/Application panel headings |
| `8ba40ca` | **2.4.0** | Make the Activities catalogue editable, and give Health Indicators one window |
| `c00f770` | **2.3.0** | Merge into an already-logged day instead of refusing the save |
| `b795c5a` | 2.2.4 | Size the breakdown columns from their content, and merge Source with Save |
| `51bdde7` | 2.2.3 | Make date/time inputs honour their width, and tighten the breakdown table |
| `9cc7f32` | 2.2.2 | Keep both .form-row columns exactly half wide on a phone |
| `a997eee` | 2.2.1 | Give every single-line form control one height |
| `f4be546` | **2.2.0** | Read Physique's four totals off tables, and make workout tempo a setting |
| `bcfb691` | **2.1.0** | Turn the Formula Playground into a solve-for-any-field calculator, and let Physique combine/sort duplicate ingredients |
| `03caf47` | 2.0.1 | Unify target/body-mass naming, fix Physique table UI, and merge duplicate ingredient rows |
| `7ea44f1` | **2.0.0** | Replace the Health Log with a per-day Physique tab and an Activities catalogue |
| `c18b8d6` | **1.54.0** | Add an Instruction modal to the Activity Plan |
| `c57b6b8` | **1.53.0** | Add AI Financial Insight panel; rename Accounts sheet, add Market Value |
| `a4db68e` | 1.52.3 | Merge spending panels, reorder Historical Trends, drop architecture diagram and emoji |
| `3886f2d` | 1.52.2 | Remove dashboard screenshot from README |
| `d837db1` | 1.52.1 | Cut the Insight prompts down and halve charts.js's comments |
| `468c178` | **1.52.0** | Mark each week's average on the Health Indicators charts |
| `573abaa` | 1.51.2 | Unify the Health Indicators charts, and rewrite the README as bullets |
| `36a77f9` | 1.51.1 | Colour buttons by role and show progress on the slow ones |
| `a064c90` | **1.51.0** | Classify ingredients, log workouts gradually, and tighten mobile layout |
| `d263737` | 1.50.1 | Rename weight to body mass and drive the forecast from the plan |
| `deb116b` | **1.50.0** | Merge the three AI insight panels and curve the weight forecast |
| `32c6c65` | 1.49.4 | Remove the Spending Patterns panel |
| `d9f98ee` | 1.49.3 | Drop calibration and build the calorie bound from BMR plus activity |
| `0b91807` | 1.49.2 | Make the calibration a smoothed three-term energy model |
| `f925860` | 1.49.1 | Drop the note that narrated a working formula toggle |
| `b68a8e2` | **1.49.0** | Give Body Weight its own chart and make the calorie bound per-day |
| `0508956` | **1.48.0** | Let a food's amount be given as a calorie figure |
| `babcdc0` | **1.47.0** | Turn the calorie target into a max or a min, whichever the goal implies |
| `951510c` | **1.46.0** | Make the protein target a band scaled off goal weight |
| `fba5fc0` | 1.45.11 | Widen the calibrated-maintenance guard so the bars can respond again |
| `1a39568` | 1.45.10 | Stop a noisy calibration from wrecking Calorie Deficit & Fat Loss |
| `4ac37e6` | 1.45.9 | Restore the toggle-sensitive right-axis label on Calorie Deficit |
| `4ed15df` | 1.45.8 | Cut the commentary in calibration.js and the new chart axis helper |
| `28c6d7f` | 1.45.7 | Drop the axis title added to Calorie Deficit & Fat Loss |
| `65d18f6` | 1.45.6 | Tighten the Calorie Deficit axis and de-duplicate its right-axis label |
| `3cc1ce9` | 1.45.5 | Revert the calibration fit to weighted OLS |
| `dd895ab` | 1.45.4 | Always save the fitted calibration, never substitute the generic value |
| `b50a6eb` | 1.45.3 | Calibrate over multi-week windows instead of refusing noisy data |
| `581be01` | 1.45.2 | Regularize the calibration fit with weighted ridge regression |
| `221a0b9` | 1.45.1 | Align Activity Plan data-reps with the displayed sets x reps |
| `94dab22` | **1.45.0** | Add Calorie Deficit & Fat Loss chart, calibrated/generic toggle, Day 5 bodyweight plan |
| `178bc9a` | **1.44.0** | Add Activity Insight AI panel; fix Activity Plan table alignment; make Rest & Recovery axis data-driven; redesign Weight Trend progress meter |
| `73b5fbf` | **1.43.0** | Replace fixed 7/14/30-day lookback with custom From/To date range on Wellness Insight and Protein Source Rotation; hide landing page feature graphs on mobile |
| `4c9ee3c` | 1.42.1 | Change Sleep bed/wake separator to "; " as canonical, "/" as legacy fallback |
| `59062b5` | **1.42.0** | Add Activity; Calories calorie-burn tracking; use it in Weight Trend calibration; align Health Metrics chart widths |
| `78f4679` | **1.41.0** | Match Wellness Insight styling to Food Insight; add optional question box |
| `dd850bb` | **1.40.0** | Add Sleep bed/wake entry and redesign Rest & Recovery as a floating-bar chart |
| `27c4305` | **1.39.0** | Add plateau alert and Strength Training Plan; fold Time into Other; split gate.js from app.js |
| `6e8715c` | **1.38.0** | Add Protein Source Rotation and Body Composition Change charts; promote Food/Wellness Insight to persistent panels |
| `8414fa7` | **1.37.0** | Redesign landing page as a node graph; add Verified column to Nutrition Facts |
| `5782775` | **1.36.0** | Add reusable "pattern" entries to the Health Log |
| `ca11bc2` | 1.35.3 | Format Health Metrics chart x-axis dates as "Jun 29" instead of ISO |
| `c30c401` | 1.35.2 | Remove merge_contacts.py, a one-time local tool no longer needed |
| `ac27c4c` | 1.35.1 | Document the Food Insight feature and Health Metrics chart changes in README |
| `b474cca` | **1.35.0** | Add Food Insight feature, reflow Health Metrics charts, fix ingredient-matching bugs |
| `20ae6a9` | **1.34.0** | Add can/clove units, fix Nutrition Facts count-parsing bug, require review before auto-saving new ingredients |
| `e241bfe` | 1.33.1 | Standardize Notes deterministically, persist Calculate breakdown, fix spray/count scaling |
| `bada1d0` | **1.33.0** | Add "spray"/"shot" ingredient units, fix a gram weight for shots |
| `e479694` | 1.32.1 | Stop Calculate from renaming ingredients, show density used, grow Notes field |
| `6c74430` | **1.32.0** | Add a personal Nutrition Facts table for AI calorie estimation, fix eTimeSheet reminder scoping |
| `605101a` | **1.31.0** | Add a personalized TDEE-based calorie target formula |
| `be76d6e` | 1.30.1 | Truncate long Company names in Work Log table, unify stat tile font size |
| `b8e03b3` | **1.30.0** | Add Company field to eTimeSheet and scope overtime/reminder to it |
| `680e789` | 1.29.1 | Add category icons and color-coded accents to the landing feature cards |
| `dd1e063` | **1.29.0** | Add Health Log bulk edit, stacked activity chart, and Insight activity breakdown |
| `dfab9c6` | **1.28.0** | Add protein tracking, AI health insight, and merge Journal/Portfolio into Finances |
| `0d77431` | **1.27.0** | Add calibrated weight forecast, overtime tally, and extend privacy mode app-wide |
| `a6873cd` | 1.26.2 | Stop auto-focusing form fields when any modal opens |
| `a8ad6f5` | 1.26.1 | Extract shared JS/CSS helpers, add mobile-friendly styling, and speed up dashboard load |
| `68dbef8` | **1.26.0** | Add AI-powered calorie calculator to Health Log, fix modal styling |
| `3020fcc` | **1.25.0** | Add a Settings panel and tune wellness chart layout/styling |
| `3a787e8` | **1.24.0** | Add dashboard widgets and reorganize the Journal/Applications panels |
| `e07ea68` | **1.23.0** | Add Travel and Applications tracking under a new Other section |
| `d829aff` | **1.22.0** | Add Contacts tab with bulk export/delete/merge and a source-merge tool |
| `f970bfa` | **1.21.0** | Refresh labels, landing page, and add wellness autocomplete |
| `3e98fe7` | **1.20.0** | Add red dashed target lines to all 4 wellness charts |
| `b6dd9a5` | 1.19.4 | Cap Weight Trend x-axis ticks to keep chart heights consistent |
| `8bf4322` | 1.19.3 | Convert activity units to minutes in chart |
| `ca46987` | 1.19.2 | Update Activity default unit to steps, generalize activity chart axis |
| `8fbb76f` | 1.19.1 | Fix Wellness Log UI: form styling, chart layout, notes truncation |
| `df4fa3d` | **1.19.0** | Add Wellness Log section with charts, log table, and entry form |
| `9437668` | 1.18.1 | Build Spending Breakdown by Type panels dynamically from Insight data |
| `ea5edc8` | **1.18.0** | Add consent flag, silent-refresh retry, Time Log pagination; update README |
| `768f3c7` | 1.17.4 | Document accessibility improvements and currency-formatted chart axes in README |
| `f4392fb` | 1.17.3 | Show currency-formatted y-axis labels on dollar-denominated charts |
| `b2aeea4` | 1.17.2 | Add focus styles, empty-state rows, and modal accessibility; reorder Common panel |
| `e85c66c` | 1.17.1 | Proactively refresh the OAuth access token before it expires |
| `07dd529` | **1.17.0** | Reorder Transaction columns, add Common payee/spend charts, Time Sheet live duration, percentage histograms; update README and screenshots |
| `1e10ef1` | 1.16.6 | update |
| `4c7525b` | 1.16.5 | update |
| `2eb9759` | 1.16.4 | Delete assets/images/architecture-diagram.png |
| `6c71d7b` | 1.16.3 | Add files via upload |
| `5be7920` | 1.16.2 | Drop the (YYYY-MM) date suffix from the Income/Expenses/Net Cash Flow summary card labels |
| `190048f` | 1.16.1 | Make Work Pattern Analysis charts visually consistent, center panel-group titles |
| `b1c902f` | **1.16.0** | Add transaction bulk edit, fix bulk-selection bar, round chart axis, layout tweaks |
| `2d3bea9` | 1.15.1 | Fix Break time saving as a duration multiplied by 1440 |
| `de9dadc` | **1.15.0** | Add Time Sheet Work Pattern Analysis charts, bulk transaction operations with undo, keyboard shortcuts, and a Time Sheet reminder |
| `cdf3b26` | **1.14.0** | Add account menu, inline transaction reporting, and a Time Sheet panel |
| `38dae07` | **1.13.0** | Add CSV export filters, distinct chart colors, and category autocomplete |
| `eb1349f` | 1.12.3 | Polish dashboard layout: panel subtitles, animations, merged FABs |
| `f6a28b7` | 1.12.2 | Consolidate chart panels and fix donut tooltip labels |
| `be790c9` | 1.12.1 | Remove unhelpful Savings Rate Trend chart |
| `4046cc0` | **1.12.0** | Add privacy mode, reconciliation status, and derive categories/benchmarks from Insight |
| `67c64c3` | 1.11.1 | Fix expand/collapse-all FAB label after individual panel toggles |
| `f5250cc` | **1.11.0** | Add dark mode, collapsible panels, and a floating action button stack |
| `78e231a` | **1.10.0** | Add Payee/Description autocomplete to the transaction form |
| `14f4a57` | 1.9.2 | Order chart categories/account types by spend, rename trend panels |
| `20b635d` | 1.9.1 | Document Insight tab and Spending by Type feature in README |
| `f680119` | **1.9.0** | Add Spending by Type panel with per-category donut breakdowns |
| `204e610` | 1.8.3 | Remove silent OAuth refresh to fix mobile sign-in popup failures |
| `b12e396` | 1.8.2 | Fix dynamic category matching to exclude Income/Expenses, derive Saved/Cumulative by position |
| `0085506` | 1.8.1 | Update README for dynamic category columns in Monthly Summary/Benchmarks |
| `2a5df9b` | **1.8.0** | Add Account Composition & Savings Rate charts, dynamic categories, and UI fixes |
| `0a6c999` | 1.7.2 | Add dashboard screenshot to README |
| `8adbf49` | 1.7.1 | Unify category chart colors/legends, reorder charts, and tighten dashboard layout |
| `6160f62` | **1.7.0** | Narrow layout to 900px, free-text account types, Save & Add Another for transactions, and mobile chart/donut/header fixes |
| `48beac6` | **1.6.0** | Add Spending Breakdown by Category donuts, fix Charts nav anchor and account-type edit bug, refine dashboard terminology |
| `4ecb546` | 1.5.1 | Move social preview and touch icon into assets/images/ |
| `96aa2e7` | **1.5.0** | Add footer, emoji header icons, SEO/social meta, manifest, and license |
| `2d794b4` | 1.4.2 | Update README.md |
| `828ece9` | 1.4.1 | Remove Overview link from nav and drop its now-unused section id/styles |
| `0ed8b3f` | **1.4.0** | Merge accounts views, add sortable tables, fix chart scaling, refine palette and load performance |
| `8567e64` | **1.3.0** | Document detailed architecture in README; add manual cache-clear control |
| `5b7dbc5` | **1.2.0** | Add category spending comparison chart, reorder dashboard sections, redesign landing page |
| `3090b89` | **1.1.0** | Reorganize assets into style/script folders, add favicon, persistent login, account/CSV management, and column sorting |
| `765fbd8` | **1.0.0** | Build full Ledger app: auth, dashboard, transactions CRUD, charts, caching, mobile UI |
| `f93fcb8` | 0.1.9 | Trim Categories to Category/Color and remove dangling Group/Budget refs |
| `614af02` | 0.1.8 | Simplify Transactions/Accounts schema and align Report with existing formulas |
| `fc95ce1` | 0.1.7 | Refine README with data model analysis and implementation plan |
| `ecf176d` | 0.1.6 | Update index.html |
| `0fa0257` | 0.1.5 | Create index.html |
| `50104b6` | 0.1.4 | Update README.md |
| `5092e54` | 0.1.3 | Update README.md |
| `198b5de` | 0.1.2 | Update README.md |
| `f57b7a5` | 0.1.1 | Update README.md |
| `e608995` | **0.1.0** | Initial commit |
