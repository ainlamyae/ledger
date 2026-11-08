# Changelog

[← Back to README](../README.md)

Every commit, newest first, with the version it produced (see [Versioning](versioning.md)); major and minor releases in bold. Rewritten on every commit by the post-commit hook (`scripts/version.cjs`); the newest row reads *(this commit)* until the next commit fills in its id.

| Commit | Version | Changes |
|---|---|---|
| (this commit) | **3.43.0** | feat: Physique's header gets 🧬 Micronutrients (/health/physique/micronutrients/), the one-day table over a range of days: a Range card of Health Chart's buttons (1w default, 1m, 3m, 6m, 1y, All), then a Micronutrients card with Nutrient, Total (period), Avg / day, Ideal / day, same order and gap colouring; one day's Micronutrients table (…/<date>/micronutrients/) sits in a Micronutrients card too; docs |
| `7c93402` | **3.42.0** | feat: two motions only, named down, up and sideways: down/up a level by the breadcrumb (the new screen rises from the bottom as the old goes off the top, and the reverse), sideways on the same level (sections in menu order Health, Finance, Track, Other; a section's pages in tile order; Settings' tabs), for page loads, in-page pages and views, forms, Workouts' groups and Back/Forward alike, slides only on one even 1.5s curve; only cards and fields move, the background, bars, breadcrumb, footer, logo row and sidebar held still (page loads move each page's see-through content, never a whole-page image); every field sits in a titled card (table search, filters and page buttons in their table's card, Range, Ask, Stock and Applications cards, Settings' tabs in its card); the phone's bottom bar shows the page's own buttons after a form closes; docs |
| `b22fcef` | 3.41.1 | chore: the changelog's ids follow the redated history (no commit Mon-Fri before 6pm Waterloo time, at most one major/minor release per weekday and three per weekend day, commits only moved earlier; every version unchanged) |
| `e8a7e7d` | **3.41.0** | feat: Consumption Breakdown's Total row sums the Amounts (grams and counts each on their own, "850g + ×3"); Physique's table floors Protein, Fiber, Fat and Carbohydrate to whole grams as the breakdown Total does, instead of rounding |
| `e118996` | **3.40.0** | feat: every Insight page shows its data in a card (Health's Data, or the Food/Micronutrients/Periods summary inside its table's card; Finance Snapshot's Data) and the AI reply in a Response card (Health, Finance, Market), each hidden while empty; past a phone a card's table fills the card, only its data columns growing (tick boxes and row buttons keep their size), compact as before on a phone |
| `301afe0` | **3.39.0** | feat: every loose table sits in a titled card as Portfolio's Holdings does (Physique Log, Nutrition Ingredients, Insight's Food/Micronutrients/Periods, Transactions, Accounts, Breakdown, Watching, Finance Insight's Categories/Accounts, Work Time Log, Car Service Predicted/Done, Travel Log, Contacts, Settings, Activity Plan), pagination inside, search and bulk actions above; a page's first card or card grid has none above and one card gap below, as Nutrition's (Car Service, LeetCode, Travel, Work Time), and a card grid keeps one card gap to the card under it |
| `eb84a06` | **3.38.0** | feat: Health Chart's heatmap splits by month as LeetCode's does (each month its own block after an empty column, a week spanning two months split, the month's name centred under it) and starts on the range's first day, no longer back to its Monday; docs |
| `183af1f` | 3.37.2 | chore: version.cjs's legacy commit ids and versioning.md's ids follow the redated history (no commit in Mon-Fri 9am-5pm Waterloo time, at most one major/minor release per weekday and three per weekend day; every version unchanged), and the changelog is rebuilt with the new ids |
| `479c0fc` | 3.37.1 | refactor: every animation lives in motion.js behind window.Motion (springs and curves, all motion CSS — transitions, keyframes, view transitions — installed as #motion-styles, the cross-page pagereveal handler, forms, toast, page push/pop and tile launch, busy icons, panel entry, confetti and the warning pulse); styles.css, confetti.js (removed), ui-helpers.js and the inline pagereveal copies no longer animate anything, and motion.js loads in <head> of index.html and every section stub; opening or closing a page no longer moves the background (only content moves, the old page fades out early instead of an opaque sheet sliding over it); the Insight hub keeps its ❌ (only 🤖 waits for a mode); the bottom nav's divider sits only between visible tabs, none after Track; docs |
| `404287b` | **3.37.0** | feat: icon buttons grow and bounce back while busy instead of an ellipsis on the label (withButtonBusy, markIconBusy/settleIconBusy shared by the ad-hoc AI-generate/scan buttons too); Health Chart shows every chart by default, the 🔍/🙈 detail toggle is gone; Insight's 🤖 Send to AI no longer flashes on the hub before a mode is chosen (currentActionBar only surfaces a view's actions once that view is routed to) |
| `3593927` | **3.36.0** | feat: motion rebuilt on iOS's system (motion.js): a SwiftUI-style spring solver (navigation with a quick launch and soft landing, opening with a hint of overshoot, dismissing with none, a springy toast) replaces the fixed curves; forms and dialogs zoom-morph out of the button or row that opened them (its frame and corners reshape into the card by clip-path plus scale, aspect-filled, never squashed) and back into the ✕ clicked or their opener, else rise and drop as a sheet, while the page behind recedes (scales, dims, rounds) and comes forward again; pages launch from their hub tile as the hub zooms past and dims, close back into it as the hub settles in (Insight's views with their own tiles), and page to page is an opaque navigation push with a leading-edge shadow over the old page drifting 30% left and dimming, never see-through; cross-page loads use the same spring, shadow and dimming; the toast springs up and sinks away; docs |
| `5cc919a` | **3.35.0** | feat: Windows/iOS-style motion (motion.js): a form or dialog grows out of the button or row that opened it and minimizes into the ✕ clicked (else its opener, else slides down), solid and evenly scaled, over a copy of its card so every write stays synchronous; pages grow from and minimize into their hub tile (Insight's views into their own tiles), page to page is an iOS push/pop over a snapshot of the old page, and section-to-section or home loads slide through cross-document View Transitions (Back reversed, tab bar and sidebar still, no slide on reload); buttons give under a press; it plays even with the system's animation effects off. Every message written on a page (Saved, Calculate's ♻️/🔗/⚠️ notes, progress, errors) now shows in the undo toast's box without Undo, 3s to 12s by length, errors red, wrapping on a phone; yes/no confirmations stay as they are. Dietary Fiber Intake's bars past the band's ceiling are red, not dark green; docs |
| `ad7220a` | **3.34.0** | feat: LeetCode's Cheat Sheet runs basic to advanced (Control Flow, Logic & Comparison, Numbers & Math, String, Array (List), Functions & Iteration, Set, Dict, Sort & Search, Queue (Deque), Heap, Bits) and within each category, gains 42 interview extras (string/bit tricks, itertools, max-heap, BFS levels) and new Recursion & DP, Pitfalls and Big-O categories, every original row kept; it lays out in two columns (one under 820px), a table per category never split, and the header's 🖨️ prints only the Cheat Sheet on one Letter page with 0.25in margins, its font the largest that fits; docs |
| `60c330b` | 3.33.1 | chore: version.cjs's legacy commit ids follow the rewritten history (every version unchanged), versioning.md's v1/v2/v3/v3.5 ids point at their commits and the changelog is rebuilt with the new ids |
| `63c1bd5` | **3.33.0** | feat: LeetCode gains a Cheat Sheet card under the category cards: every Python construct used in the NeetCode 250's neetcode.io solutions (keywords, operators, builtins, methods, heapq/collections/bisect/math), grouped into one table by category (Control Flow, Logic & Comparison, Numbers & Math, Bits, Array, String, Set, Dict, Heap, Queue, Sort & Search, Functions & Iteration), each a header row with a line above it, most used first, each with a few-word use; docs |
| `660f603` | **3.32.0** | feat: Nutrition's form Complete lists USDA's top 10 matches (generic, survey and branded foods) under Amount, each with its Calories/Protein at the typed Amount, closest to the ticked values first with a % match; the clicked one fills the form and is linked to its USDA page under Amount; bulk Complete still takes the top generic match; docs |
| `c944dd6` | 3.31.1 | fix: Physique's Calculate orders the Consumption box by the breakdown's real (USDA/AI-priced) calories rather than a local-catalogue-only lookup, so the box lands in the same highest-calorie-first order as the Breakdown table beneath it instead of sinking USDA/AI-priced ingredients to the bottom; local pricing stays as the fallback for any line the breakdown doesn't cover, and the merge/capitalization still make no network call (combineAndSortConsumptionText takes a breakdownCaloriesLookup, applied by the form and bulk Calculate alike); docs |
| `9d29fbe` | **3.31.0** | feat: Health Chart's Daily Progress shows each day's date in its cell (white on a coloured day); Physique's Summary TEF ticks ✅ and Status's TEF turns green once past its desire toward the mass goal (more on a cut, less on a bulk), its Remain following the same way; docs |
| `4916a54` | **3.30.0** | feat: LeetCode's Past Year heatmap becomes Daily Progress, from the first solve's Monday to today in Health Chart's chart box (no 16-week phone view), each day showing its solve count and shaded from empty to dark green by its video minutes against the longest day; Health Chart's 7-Day Averages (Calorie Balance, Intake, Caloric Intake, Protein, Dietary Fiber, Fat, Carbohydrate, Physical Activity's Burn, Sleep's Bed & Wake) and the grade lift under them smooth over Tune's L_p and are named for it; Tune clamps its live BMR_cal as Physique stores it, reads BMR under the chosen basis in every Solve-for mode and keeps a solved Δm to three decimals, so its arrival date matches Health's Progress card; docs |
| `a7965c2` | 3.29.1 | fix: Physique's Consumption and Workout suggestions fill in only from a click or an arrow-picked option, so Enter alone starts a new line instead of swapping in the first match (300g milk no longer becomes 300g milk almond); on touch each option is taller with a line between them; docs |
| `9565ad8` | **3.29.0** | feat: Body Mass's dots are all one gray under a single Measured Body Mass legend entry instead of the five desired grades and Unscored; its trend smooths over L_p days and is named for it (L_p-Day Trend) instead of a fixed 7; its hover drops m_des (Healthy Body Mass); docs |
| `6d7aa0e` | **3.28.0** | feat: LeetCode's category cards all start closed instead of opening the first unfinished one; each row gains a Duration column after Difficulty (its NeetCode video's length, read off YouTube for all 250) and 🎥 opens the problem's YouTube video (read off each neetcode.io solutions page) while a new 📄 opens its NeetCode page; the Log form's NeetCode Video becomes NeetCode Page (an old header is read and renamed on the next save) and gains YouTube Video and Duration, filled from the problem; the Progress card gains a video bar of hours watched and to watch in hh:mm, a mark every 10 hours; docs |
| `6e00316` | **3.27.0** | feat: Physique's form puts its three tables at the foot, each in a labelled card (Consumption Breakdown, Workout Breakdown and Summary, which replaces the Derived dropdown), with Name taking the spare width and shrinking first on a phone; Date, Body Mass, Bed and Wake fold into a Day dropdown, open only on today like Consumption and Workout; Summary gains a ✅/❌ column off its green/red Amounts, TEF, M, Δm′ and BMR (BMR_cal above the mean of BMR_mif and BMR_kat) gain their own colours, carbs under the band read ❌, and empty cells show nothing instead of —; cards round their corners like the input boxes; docs |
| `25e1cee` | **3.26.0** | feat: Body Mass's Calorie Trend starts at the mean of the latest run's first L_p days of readings instead of its first reading, so a bloated or water-heavy first day can't set its start; Sleep's legend reads plain Sleep Deprivation Effect; docs |
| `deca72b` | 3.25.1 | docs: Versioning and Project Structure drop the commit-msg hook's notes, and the hook's own comment is shortened |
| `5a6b00c` | **3.25.0** | feat: Health Chart's Daily Progress heatmap, Calorie Balance's bars, Intake's dots, Physical Activity's burn dots and Sleep's bars and Deprivation dot shade on a continuous blend between the desired grades' colours (desiredGradeBlend) instead of five flat colours; both heatmaps put their month names along the bottom; LeetCode's tile gains a red badge of the solves today owes against the last 7 days' average, on the home page too; a lone-digit badge is a round circle; a failed sign-in shows no banner; Physique's Derived Remain reads — once the Amount is past Desire; docs |
| `73e0cab` | **3.24.0** | feat: Health Chart gains a Daily Progress heatmap between the range buttons and Body Mass (LeetCode's grid over the range's days, each day its Calorie Balance grade, one chart's height); Body Mass, Calorie Balance, Intake, Caloric Intake, Physical Activity and Sleep grade every day on five desired steps (Beat, Met, Near, Short of and Missed desired) by the share of the desired change it made, lifted to one step under its 7-day average's grade, instead of met or missed; 5y leaves Health Chart and Health Insight's range buttons; docs |
| `afed464` | **3.23.0** | feat: Physique's Derived table gains a Remain column (Desire − Amount, a band's floor for the macros) and green/red Amounts by the Status and Intake Macros cards' rules; BMR moves above M there and on the Status card; Derived, Consumption and Workout tables right-align their numbers, and the Consumption Total row shows floored whole numbers; docs |
| `af18a6c` | **3.22.0** | feat: Physique's Derived table shows only the BMR picked in Tune, labelled plain BMR, under new Pro/DF/Fat/Carb rows (the Consumption breakdown's grams against the Intake Macros bands), and gains an M row (BMR + AEE, Desire BMR + the desired AEE) between lines under SD; the desired AEE falls back to the latest reading before the day; the Remain row leaves both Calculate tables; docs |
| `ee6f256` | 3.21.4 | fix: the plan's BMR_avg ratio is today's at m̄, figured as the Tune does (todayBmrFigures), not the last stored Physique row, which a pre-logged future day could be; Progress and the Status card's ETA now match the Tune's t; docs |
| `5570944` | 3.21.3 | chore: version.cjs's legacy commit ids follow the rewritten history (every version unchanged) and the changelog is rebuilt with the new ids |
| `13c0c3f` | 3.21.2 | chore: the pre-commit and pre-push hooks go; version.js's comment names post-commit as what stamps it; docs |
| `430d372` | 3.21.1 | chore: version.cjs's legacy commit ids follow the rewritten history (every version unchanged) and the changelog is rebuilt with the new ids; sidebar comments and the navigation doc trimmed |
| `271d48a` | **3.21.0** | feat: LeetCode gains a Progress card above Past Year (Health's meter over the NeetCode 250, solved and left, a mark every 25) with a time bar under it, days since the first solve against days to go at last week's pace and the finish date; the heatmap starts weeks on Monday, stretches its square cells to the card and on a phone shows Past 16 Weeks; the roadmap shrinks to the card on a phone; the solved summary moves under Roadmap's title; LeetCode comes first in Track, before Work Time; docs |
| `a56440b` | **3.20.0** | feat: every chart's hover is drawn over the page (htmlTooltip, Chart.js's own look and callbacks) so a tall one such as Intake's or Calorie Balance's is no longer cut at the chart's bottom; Intake's hover adds each macro's logged grams after its kcal and Intake and Calorie Balance show only the BMR selected in Tune (selectedBmrKey, shared with the Status card); the dated Health charts' y axes are fitted to their widest label, one width on both sides (fixDatedYAxisWidth), while the Rotation charts keep 120px; docs |
| `edbbd20` | **3.19.0** | feat: Health Chart gains Intake under Calorie Balance, each day's Protein, Dietary Fiber, Fat and Carbohydrate as stacked kcal (carbohydrate net of fiber, scaled so the stack equals TEI) under Caloric Intake's own TEI dots, 7-Day Average, Desired cap and five BMR caps; 🔍 beside 📤 shows Caloric/Protein/Dietary Fiber/Fat/Carbohydrate Intake, Protein Source Rotation and Activity Rotation, hidden by default and on every reload (🙈 hides them); Protein Source Rotation tops Nutrition and Activity Rotation tops Activity and, above the tiles, Workouts; Progress marks every 2 kg and every 4 weeks with one smooth red-to-green fill; saving a Physique day whose D is above its Desire pulses the page edge red and shakes the form; Derived is open on every date; docs |
| `14ae514` | **3.18.0** | feat: 📤 on Health and Finance Chart saves the whole page as a PNG (phone share sheet to the gallery, laptop download), drawing charts not yet scrolled near first (buildPendingCharts) with html2canvas-pro, keeping the page's CSS, fonts and unboxed legends; Market leaves the sidebar now its tile lives on Finance Insight; the Status card shows only the BMR selected in Tune, adds M (maintenance, BMR + AEE) between lines under SD and ETA, the plan's days and date to the healthy mass as on Progress; docs |
| `f0e1eb3` | **3.17.0** | feat: every dated Health chart's axes refit to what its legend still shows (Body Mass, Caloric Intake, Calorie Balance, Protein, Carbohydrate, Fat, Dietary Fiber and Sleep's clock axis skip hidden entries, as Physical Activity already did); Body Mass, Physical Activity and Sleep dots shrink with the range like bars (fitPointRadius, fitPointBorderWidth: at most 40% of a day's slot, border thinning with it); Protein Source Rotation and Activity Rotation draw a 550px bar chart beside the donut; print starts on sheet 1 (a chart box, not a page-tall panel, avoids a break), prints legend swatch colours and keeps donuts round; docs |
| `3dadfe6` | **3.16.0** | feat: Tune's Basal metabolic rate gains BMR_avg, the average of BMR_mif, BMR_kat, BMR_cal and BMR_adp (BMR_adp as of today), as a basis the whole plan can run on (the active equation scaled by BMR_avg / equation), with a BMR_avg row under m-inf_adp, its Equations and Calculations lines, a stored BMR_avg in every Physique day's Derived JSON, a Derived and Status row, a fifth Caloric Intake cap and the hovers; the Setting tab's old target keys are renamed with their duplicates merged, every key the app writes has a default Note filled on save and on load; bulk Calculate tidies Consumption and the Tidy button goes, as does Save & Add Another; Transfer, Capitalize Names, Import CSV, Update Market Value and the two contact exports become emoji buttons and Transfer's commit a Save; Amount reads gr, gram and grams as grams; docs |
| `5397855` | **3.15.0** | feat: "target" leaves the whole project, code, setting keys, ids, classes, file names, comments and docs, for the UI's words: healthy for the body-mass goal (BODY_MASS_HEALTHY_KG, healthyKg) and desired for every other goal (SLEEP_DESIRED_HOURS, getCalorieDesired), health-nutrient-targets.js now health-nutrient-desired.js; every dated Health chart gets a swatch legend under it whose entries click to hide their series or bars/dots of that colour, desired marks turn cyan apart from the 7-Day Average, results read Desired met / Near desired / Missed desired alike, 8 evenly spaced gridlines with the first and last date on the plot edges at every range and a 120px left y axis so Rotation names fit; Body Mass draws Tune's healthy body mass, joins its dots with a thin gray line across gaps, plots a lone old reading, restarts its trend lines after a 14-day gap and draws the Calorie Trend in indigo; Tune opens a fresh user on the user's own figures (m_des 70 kg, L_p 7, n_p 4, gamma 3, kappa 3, walking MET 3, f 13.5, b_min 17, q 30-50, Delta-m% 1, a 170 cm / 35 y / 38-91-99 cm profile); a receipt of 2+ transactions ends in a blue UI-only total, the Pay badge shows only for the 3 days after Payment Day and on the home tile too; docs |
| `7d40019` | 3.14.1 | refactor: rename every feature file, identifier, comment and doc to the UI section-page scheme (health-/finance-/track-/other-/ledger-*; wellness→health, Indicator→Chart, Timesheet→Work Time, Formula Playground→Tune), shared infra left neutral and the Wellness insight feature kept as-is; split the Health chart module into one file per chart; align the Health Chart vertical gridlines at every range via a fixed y-axis width; printer-friendly @media print rules; Body Mass chart joins its dots with a connecting line; fix the physique data-load crash by coercing text cells to strings; add the system-architecture diagram to the README and correct the social-preview description order; remove the one-off activity-image fetch scripts; add walk/backstroke/run activity gifs |
| `e8b1e50` | **3.14.0** | feat: Breakdown leaves the Finance and home tiles and the sidebar (PAGES_WITHOUT_TILES in page-nav.js; /finance/breakdown/ still opens, and commenting its entry out brings them back); Calculate title-cases each exercise name in a day's Workout box, and the Workout table under it shows names that way, as Consumption does for ingredients; docs |
| `48205c2` | **3.13.0** | feat: Tune adds neck, waist and hip under age, U.S. Navy body-fat % (Hodgdon & Beckett) under BMI_des and LBM_navy above the Boer LBM, now LBM_boer, with their Equations and Calculations lines in Variables order; a Lean body mass question above Basal metabolic rate picks Boer or U.S. Navy for Katch-McArdle, A/B, protein and glycogen app-wide (LBM_FORMULA); new settings get a default Note; an account's Payment Day (1-31, Break-sized box) shows a red Pay <n>d badge on its row and the Account tile once passed unpaid; Activity Rotation runs furthest below desired first, like Protein Source Rotation; docs |
| `9ede66a` | **3.12.0** | feat: home and hub tiles are liquid-glass capsules (frosted, top shine, lit rim, soft shadow) over their old colour coding, while sidebar links go back to plain list items; Contact, Refresh data, Clear cache and Settings sit above the switches, now named Dark mode, Amounts, Widgets and Bulbs, which show and work before sign-in from this browser's last values (Widgets and Bulbs off by default) and take the Settings tab's once it loads; Market's tile moves beside Snapshot on Finance Insight; Portfolio Allocation is renamed Account Allocation; docs |
| `1204a63` | **3.11.0** | feat: Contact and Settings open from the account menu, and Other leaves the tab bar, sidebar and home page (its /other/ addresses still work); sidebar links are liquid-glass capsules with a lit rim, top shine and a lift on hover, blue glass when selected; docs |
| `7f62fb0` | 3.10.1 | fix: Physique's Derived table shows TEF from intake alone, and before Bed and Wake are typed reads SD as 0 with D and Δm′ worked out from it; ticking Pattern also hides Workout (with its table) and Derived, and a pattern saves Workout, Duration and AEE blank; Protein Source Rotation, Activity Rotation (both copies) and Finance's Cumulative Net Worth sit flush under their headings like every other chart; docs |
| `c3b4bf1` | **3.10.0** | feat: a new exercise in a day's Workout is priced by AI on Calculate (MET, Category, Group, Muscle Group, Sets x Reps and Rest), its row showing AI with 💾 to save it to the Activity sheet and ✏️ to fix it first, and ✅ for one already there, as Consumption does for a new ingredient; table columns 5px apart everywhere; Add Activity's Save finds the saved row by Name, not Category; docs |
| `27fda07` | **3.9.0** | feat: sidebar's bottom panel holds Refresh data, Clear cache and the show/hide settings as iPhone-style switches (Dark mode, Show amounts, Show widgets, Show bulbs) above an account row with the Google picture, name and email that opens the account menu above it; links scroll on their own above the panel; with the sidebar hidden or below 1180px they sit in the account menu instead; docs |
| `ba75f6d` | 3.8.1 | chore: version.js and changelog for 3.8.0, which the post-commit hook skipped while WSL had no node |
| `47587ec` | **3.8.0** | feat: sidebar hides with a panel button in the logo row (or Ctrl+.), leaving the Ledger logo as the button to bring it back, remembered before first paint; hub tiles colour-coded by function (gray database, green form, orange chart, purple AI incl. Market and Insight modes); Portfolio between Breakdown and Watch List; Health ranges add 6m and 5y, Finance Indicator adds 5y; Caloric Intake y axis from 0 kcal; Protein Source Rotation scales Protein % to 100% and targets the protein band's top; docs |
| `b6ba207` | **3.7.0** | feat: Track LeetCode page with the NeetCode 250 roadmap by category (✅, Solved, Problem, Difficulty, 🎥 NeetCode video and 🔗 LeetCode buttons), one category open at a time; Past Year heatmap and NeetCode's roadmap graph cards; 📝 Log form (Date, Problem, Category, Difficulty, LeetCode, NeetCode Video, Notes) saving to a LeetCode tab with columns found by header; docs |
| `7438250` | **3.6.0** | feat: changelog of every commit with its version, rewritten by the post-commit hook; version counted from 0.0.0 over the whole history with judged legacy commits (Finance Market as 3.0.0); docs |
| `314ac28` | **3.5.0** | feat: version from commit messages (Conventional Commits, as in CELPiPi): feat bumps minor, fix/other bumps patch, feat! bumps major; post-commit hook stamps version.js; docs |
| `d3ff8ba` | **3.4.0** | Weather widget: today's sunrise and sunset on the current-conditions line (icon and temperature, condition on hover) to keep it one line; docs |
| `828787d` | **3.3.0** | Range buttons (1w/1m/3m/1y/All) replace From/To on Health Indicator and Health Insight; Finance Indicator 3m/6m/1y/All for Net Worth and Expenditure Trend, uncapped y axis; Settings tabs with own addresses and Note/Key/Value columns; every table fits its content; Protein Source Rotation stacked by ingredient with ingredient legend; Nutrition drops Uses, orders used-today then protein; Transaction line per receipt; docs |
| `6bb420f` | **3.2.0** | Watch List price alerts (below/above price, long-term average, trailing stop) with red badges on Watch List and Market, dismiss, 4-hour background check; AI suggests alerts in a fixed line with 📌 apply and checks; entry stop for buying today and position size; Market and Portfolio cards 2x2 on phones; docs |
| `2459c0e` | **3.1.0** | Finance: Watch List page (🔬 opens Market) and Market page merging the chart with Analysis; watchlist picker; long-term chart lines (SMA200, 52-week high, trailing stop, market) with Chart history sent to AI; trailing stop default 4 ATR; TSE: AC symbol input; Alpha Vantage spacing and TSX news message; docs |
| `e00ffe7` | **3.0.0** | Finance Market, Portfolio and Analysis pages: watchlist and price history, ACB trade log in CAD, evidence-based signals with AI read; smaller phone tab labels; docs |
| `b8c3c33` | 2.94.1 | Activity: one table with Category and Group columns, a line at each Group change; docs |
| `93934ba` | **2.94.0** | Red day-count badges: Finance Insight Snapshot, Transaction over 30 days, Work Time days since last log; keep Insight badges after tile redraw; docs |
| `39e17a0` | **2.93.0** | AI provider switch (Groq or OpenRouter) with models from Settings; 30-day red badges on Insight tiles; docs |
| `e997d8b` | 2.92.1 | Tune: shorter variable names and BMR label; Equations in the site font, headings dark, equations gray; docs |
| `b8a3185` | **2.92.0** | Tune as four cards with one BMR choice and desired wording; account details beside Account; one side-by-side field gap; docs |
| `1284c06` | **2.91.0** | Workouts (was GYM) with Cardio and NEAT; desktop footer strip as phone; even glass sidebar; sidebar closes open form; m̄ in progress bubble; docs |
| `3a96488` | 2.90.7 | Phone polish: top safe-area strip, faded footer, lighter bottom bars, plain tab colours, iOS-style search boxes, m row in Derived |
| `d14baf8` | 2.90.6 | Tiles: neutral gray capsules with 12px labels |
| `d48551f` | 2.90.5 | Four tiles a row on a phone |
| `ee048eb` | 2.90.4 | Body text 13px |
| `11af5e3` | 2.90.3 | Footer "© year ALI — Ledger vX"; author meta and schema.org JSON-LD |
| `7d1d293` | 2.90.2 | Footer as "Ledger vX • © year ALI"; card text 12px |
| `ec10138` | 2.90.1 | Body text back to .9rem |
| `0cfdb48` | **2.90.0** | Track section, Apple-style look, titled tile cards, one type scale |
| `d946716` | **2.89.0** | Confetti on saving an income transaction; darker hover shadow |
| `1a40681` | **2.88.0** | Nutrition Group, grams-first Amount, Protein Rotation by Group; Pattern form; Finance tweaks |
| `0c2bd91` | **2.87.0** | Physique: collapsible Derived table with Desire targets, calibration ramp-up/clamp; Activity Rotation on GYM; Body Mass dots |
| `2fe1e3c` | 2.86.3 | Nav: bottom bar through tablet widths, no top-bar gap before the sidebar |
| `bfd64a6` | 2.86.2 | Transaction filters: dates on top, the four filters in a 2x2 grid on phones |
| `d7729c2` | 2.86.1 | Fix local-date bugs, suggestion placement and stale docs; remove dead code |
| `4ff3dbd` | **2.86.0** | Automatic version in the footer; confetti fires on save |
| `5a94be8` | **2.85.0** | Split README and features into topic docs; pin phone suggestions to the top; confetti on body-mass progress |
| `79a40b9` | 2.84.8 | Rename Physique's BMR column to Derived, underline Activity table headers |
| `c0df201` | 2.84.7 | Widgets as bulbs, one gap across the home page |
| `129dcb4` | 2.84.6 | Same gap from the last bulb to the tiles as between bulbs |
| `5654df4` | 2.84.5 | Charts and GYM activities as bulbs; Micronutrients tables compact |
| `537d445` | 2.84.4 | One font family, Today before GYM, even gap under date rows |
| `bea10dd` | 2.84.3 | No auto-zoom on iPhone, header-row lines, Insight views reload in place |
| `aa0d59d` | 2.84.2 | Tables size columns by the table alone; cards keep their padding on phones |
| `794c1e5` | 2.84.1 | Tables: fixed row heights, row buttons never stacked |
| `d447c9e` | **2.84.0** | GYM page, quick logging, and one consistent style system |
| `c58ea5f` | 2.83.2 | Day form: Sleep Duration/Deprivation line in the m̄/Δm/BMI style |
| `72491df` | 2.83.1 | README: stored glycogen swing, load timing logs, body-mass and Load wording |
| `9ac38ba` | **2.83.0** | Finance: Cumulative Net Worth glance card under the summary cards |
| `d343581` | 2.82.9 | Remove Health's Settings block; Other's Settings is the one page |
| `b545916` | 2.82.8 | Log where a load's time goes |
| `615b3dd` | 2.82.7 | Day form: m̄/Δm/BMI line with each unit once |
| `48e0253` | 2.82.6 | Day form: m_d shown in kg |
| `b635547` | 2.82.5 | Day form: m_avg/m_d/BMI line, each in its own unit |
| `d288921` | 2.82.4 | m_d stored in kg/day like every other body-mass figure |
| `d49f5d5` | 2.82.3 | Body-mass figures stored in the BMR cell, not a new column |
| `8369fd8` | 2.82.2 | Tune's Update: say it recomputes m_avg too |
| `6b8e41a` | 2.82.1 | Activity: an exercise's Weight is shown as Load |
| `831eaa9` | **2.82.0** | Stored Mass column: m, BMI, m_avg and m_d saved per day; body-mass wording |
| `371e691` | 2.81.17 | Glycogen swing saved once as GLYCOGEN_SWING_KG |
| `74c5896` | 2.81.16 | Phone footer: copyright line 10px lower |
| `8541907` | 2.81.15 | README: phone footer strip, left-aligned date/time fields |
| `54cdd6c` | 2.81.14 | Phone: copyright line in a strip under the bottom bar |
| `47c3c2b` | 2.81.13 | Phone: no scroll on a short page, footer resting on the bottom bar |
| `317c053` | 2.81.12 | Forms: date and time values pinned left on iOS too |
| `ff87fa2` | 2.81.11 | Forms: date and time values left-aligned |
| `4cec418` | 2.81.10 | README: drop the short-page height note (reverted) |
| `3065b76` | 2.81.9 | Revert "Short pages fit the screen; footer above the phone bottom bar" |
| `2d7809d` | 2.81.8 | README: logged rows, Progress card note |
| `326f55b` | 2.81.7 | Progress card: no empty line under the last bar |
| `320fe18` | 2.81.6 | Status: one m row with the rolling average in brackets |
| `5f3ec95` | 2.81.5 | Status: m shows the glycogen/water swing beside its target too |
| `bc61089` | 2.81.4 | Activity: no hover note on a logged row, like Nutrition |
| `64a6523` | 2.81.3 | Activity: a logged row is green with no tick, like Nutrition |
| `ea2f382` | 2.81.2 | README: Workout suggestions, page height and footer |
| `761115f` | 2.81.1 | Short pages fit the screen; footer above the phone bottom bar |
| `cddca66` | **2.81.0** | Physique form: exercise-name suggestions for Workout |
| `0c812fc` | 2.80.11 | README: actions in one place, phone bar spacing, form button order |
| `30c3fae` | 2.80.10 | Phone bottom bar a quarter closer to the bottom edge |
| `fa03abe` | 2.80.9 | Actions at the top on every page, in the phone bar's order |
| `7d40b99` | 2.80.8 | Reload of a row address: no lowercase name in the breadcrumb |
| `96b666d` | 2.80.7 | Ingredient form: Scan before Complete |
| `f74b0ed` | 2.80.6 | Ingredient form: name and unit columns at the page's text size |
| `acbb332` | 2.80.5 | Ingredient form: name column as wide as its text |
| `d5e807b` | 2.80.4 | Phone bottom bar: half the gap between buttons and the account circle |
| `895761f` | 2.80.3 | Phone bar spacing even at both ends; Physique form: Scan first |
| `9bc98b1` | 2.80.2 | README: first-paint layout, Ledger tab, phone bar details |
| `6e48d5b` | 2.80.1 | Hub/page layout from the first paint |
| `d8cd6c1` | **2.80.0** | Car Service: winter changeover and rust protection on 1 Dec |
| `de6f992` | 2.79.1 | Phone bottom bar: long labels wrap onto two lines |
| `1f286b0` | **2.79.0** | Phone tab bar: Ledger tab for the home page |
| `69fc12b` | 2.78.2 | Phone: account avatar the same circle as the bottom bar's close |
| `8d2ecd6` | 2.78.1 | Hide bulbs: keep the cards on section pages |
| `750a440` | **2.78.0** | Hide bulbs: account-menu toggle for the home page's glance cards |
| `5553488` | 2.77.3 | Phone bottom bars float above the home indicator |
| `9964f12` | 2.77.2 | Pill bottom bars, round close, emoji buttons always white |
| `d334e2a` | 2.77.1 | Selection-bar buttons and Physique's Today as white emoji |
| `012ca7e` | **2.77.0** | Emoji action buttons, badges, saves stay open, exports in Settings |
| `273ecb0` | 2.76.2 | Phone bottom bars: one height, one button style |
| `e42a10b` | 2.76.1 | Six text colours, thinner tables, home breadcrumb, compact BMR line |
| `bbacabf` | **2.76.0** | Every form a page, no top bar, Insight mode pages, all styling in styles.css |
| `379ee2e` | 2.75.4 | Breadcrumb: link a row's date over its 🧬 view |
| `6ac7939` | 2.75.3 | README: batched reads, per-page loading, breadcrumb root |
| `b9e9a73` | 2.75.2 | Breadcrumbs start at Ledger, linking to the home page |
| `32f9604` | 2.75.1 | Contact table: columns fit their text, scrolling sideways |
| `3a29661` | **2.75.0** | One bottom bar at a time on phones, ❌ on every page, direct form loads |
| `af21454` | 2.74.4 | Section hubs: breadcrumb in place of the centred title |
| `702e356` | 2.74.3 | Health hub: Today as the first tile, before Tune |
| `7643672` | 2.74.2 | Settings tables: actions and key on one line |
| `2a573e7` | 2.74.1 | Health hub: keep Today, drop Log |
| `e5fd877` | **2.74.0** | Today and Log on the Health hub |
| `9703cfe` | **2.73.0** | Form pages styled like block pages; home overview with tiles; name-only tiles |
| `a60d0cd` | **2.72.0** | Forms open as pages on section pages |
| `effb17a` | 2.71.1 | Finance: Financial Indicator/Insight become Indicator and Insight |
| `d6788a0` | **2.71.0** | Section pages as a hub and pages, with a sidebar on wide screens |
| `b0a7ba4` | 2.70.1 | Load only the current section's blocks |
| `07fd7d1` | **2.70.0** | Batch Sheets reads and share the tab list; add Clear cache |
| `634a083` | 2.69.2 | Pattern table: content width, one line per cell, compact padding |
| `568345b` | 2.69.1 | Profile order: sex, height, age, then body mass |
| `22406b6` | **2.69.0** | Health Settings block; read walking MET and BMR_cal from their sheets |
| `84a8f53` | 2.68.1 | Insight mode names and order, Food macro fallback, consistent hover units |
| `6fbc532` | **2.68.0** | Nutrition Facts order and names, setting-driven targets, more row addresses |
| `9af921e` | 2.67.6 | Progress card: regular-weight figures and lost/left, elapsed/ahead labels |
| `2b8d78b` | 2.67.5 | Remove all caching; smooth m̄ over L_p; Status, Progress and unit cleanups |
| `8cb488f` | 2.67.4 | Car Service: wrap Basis in a narrow column; bump shell cache to v29 |
| `eb12ef8` | 2.67.3 | Stop iOS Safari text inflation (Car Service Basis column) |
| `d00dc3d` | 2.67.2 | Progress card: stat text at the Status rows' font size |
| `a21255c` | 2.67.1 | README: Status, Progress card, ingredient form and Pattern micronutrients |
| `7518214` | **2.67.0** | Health glance: drop m̄ and t, Progress card with 10% marks under the cards, tighter stack, Sleep Window first |
| `e69ef8e` | **2.66.0** | Physique Patterns: own micronutrients table and pattern-N addresses |
| `e424ecb` | 2.65.2 | Ingredient form: Amount as a stacked field like Classification and Name |
| `ea17982` | 2.65.1 | Ingredient form: label-matched names and units, fixed right-aligned fields |
| `337871d` | **2.65.0** | Standard units, editable Patterns period length, sheet-matching sleep labels |
| `cee1304` | **2.64.0** | Nutrition lock table, per-row edit addresses, Insight prompt templates |
| `d30516a` | **2.63.0** | Add Equations and Calculation dropdowns to Tune |
| `e9c7e59` | **2.62.0** | Add Car Service reminder flag and daily notification |
| `1fd6436` | **2.61.0** | Add Car Service block with service history and predictions; chart hover consistency |
| `229e46b` | **2.60.0** | Add block/form addresses, Tune block, and stored per-day BMR in Physique |
| `644a23b` | **2.59.0** | Pin form actions to the bottom on mobile, update balances on edit, add progress bar bands |
| `23b79ef` | 2.58.1 | Sort Activity plan and Instructions modal by rotation completion |
| `7d7f67e` | **2.58.0** | Add export confirmation dialogs and reorder Status card rows |
| `ca2170f` | 2.57.3 | Fix Breakdown action buttons wrapping on mobile, Sleep header abbreviation, integer macros in Physique table |
| `df06e7e` | 2.57.2 | Improve Transaction and Physique UX across filters, exports, and table display |
| `4943ead` | 2.57.1 | Make forms full-screen on mobile and fix background scroll |
| `ba34d34` | **2.57.0** | Add block-visibility toggle, catalogue propagation, and Health Plan parity |
| `a2a359e` | 2.56.1 | Make Health Insight tables/profile consistent across modes |
| `f6f7ca8` | **2.56.0** | Make Health Insight's Patterns period length user-editable |
| `592a42c` | **2.55.0** | Add a Patterns mode to Health Insight |
| `3b21822` | **2.54.0** | Add BMR calibration, fix Calculate/basis bugs, and clean up small UX gaps |
| `455509d` | **2.53.0** | Replace the Health Indicator charts' weekly-bucket trend with a continuous EMA |
| `b29f893` | 2.52.1 | Make the phone bottom nav a real tab bar with thumb-sized tap targets |
| `0c99819` | **2.52.0** | Overhaul the mobile layout: bottom nav, auto-hiding header, fixed dark-mode colors |
| `a62b10e` | 2.51.2 | Ignore local editor settings |
| `eaaee7e` | 2.51.1 | Show 28 dated days plus every Pattern row per Physique page |
| `5e7650b` | **2.51.0** | Add a Log button to the Add/Edit Activity modal |
| `e04cc6a` | 2.50.1 | Document that Settings masks API keys/tokens by default |
| `7008ceb` | **2.50.0** | Add today's raw body mass to Status, mask secrets in Settings, line off Physique weeks, and harden dashboard loading |
| `27f3bd4` | 2.49.4 | Drop the visible "Loading your data..." banner and fix the scan's vision model |
| `0dd19d3` | 2.49.3 | Drop the default sign-in banner and let gated actions sign in on click |
| `324bdcb` | 2.49.2 | Fix Physique scan's vision model id, which pointed at a nonexistent Groq model and made every scan fail. The comment above it already named the intended model (Llama 4 Scout); the constant just never matched it. |
| `8e36e3d` | 2.49.1 | Drop `required` from every form field except Log a Transaction's Date/Account, so a field that doesn't actually need a value stops blocking Save over it. |
| `59ac727` | **2.49.0** | Add an Activity Rotation chart to Health Indicator, matching Protein Source Rotation's bar+donut shape: a new Weekly Target column on the Activity sheet drives a horizontal bar (sessions logged vs. desired this window, one bar per Group) and a three-ring donut (reference weekly split, last 4 weeks, last week). A session credits every Group a day's Workout notes touch, not just the dominant one. |
| `89482c9` | 2.48.2 | Fix Delta-m's target to negate WEEKLY_FAT_LOSS_KG the same way D's target already does, so a cut's desired mass change reads negative (losing) instead of positive, and keep the Status/Macros/Activity/Sleep bento as two columns below 640px instead of collapsing to one, with tighter row and card padding so the Status card's longer figures still fit on a phone width. |
| `7bf3f6c` | 2.48.1 | Split the Status card's BMR row back into BMR/lambda-t/BMR_adp so the adaptation discount and its result are always visible, independent of which basis Balance/Delta-m actually run on. |
| `90a6a6b` | **2.48.0** | Add a global BMR/BMR_adp basis toggle to the Formula Playground and wire it through every deficit, calorie target and the forecast's A/B, split the Status card into a Status/Macros/Activity/Sleep bento layout with new BMI and lambda-t rows, standardize chart hover labels to the Playground's symbol vocabulary (TEI/AEE/TEF/SD/D/BMR/BMR_adp) across Body Mass, Calorie Balance, Caloric Intake, Protein/Fiber/Fat/Carb, Activity and Sleep, fix the Body Mass chart's Calorie-Implied Trajectory to reach today instead of stopping at the last weigh-in, add a per-day Adapted BMR dashed line to Caloric Intake, and replace "target" with "desired" across Health Indicator and Health Insight prompts. |
| `e549044` | 2.47.1 | Simplify the Status card's Intake separator to / and drop the explicit + on positive figures |
| `70bc3c9` | **2.47.0** | Rebuild Health Status card as an energy-budget ledger and add Desire/Remain to Physique breakdowns |
| `31e63f2` | **2.46.0** | Add a Normalize button to the Nutrition ingredient form, a Capitalize Names bulk action to Nutrition, and fold Physique's own capitalize/combine buttons into one Tidy button |
| `26f194d` | **2.45.0** | Resync the Health Formula Playground to the metabolic-model reference notation, add a deficit-vs-BMR warning row, and widen the symbol column |
| `8d9fbc9` | **2.44.0** | Add account-to-account Transfer, split README into docs/, and give Tune/Today/Transfer their own gray button role |
| `6c028b9` | **2.43.0** | Reorder Physique table columns, add Sleep Deprivation readouts, and gradient the Caloric Intake and progress-meter colors |
| `f8c4dce` | **2.42.0** | Redesign Status card to 5 rows, add Intake/Digestion/Activity/Deprivation mirror rows, fix null-textContent crash, graduate progress bars blue-to-green, and remove the JSON backup export |
| `54e9a63` | **2.41.0** | Model sleep deprivation's effect on fat loss across Health Indicator, and fix chart x-axis consistency |
| `7836dfe` | **2.40.0** | Rename the Macros/Activity glance cards to match their charts, add a Cardio/NEAT/Strength breakdown, fix a label typo |
| `b9b2823` | **2.39.0** | Redesign the Today-at-a-glance cards into Status/Macros/Activity/Sleep, and add a per-day Basal Metabolic Rate marker to Caloric Intake |
| `c925855` | **2.38.0** | Rework the Today-at-a-glance cards into Body Mass, Activity, Macros and Sleep, and fix the sign-in check being stuck behind window.load |
| `76e8371` | 2.37.2 | Remove the header global search box |
| `915134a` | 2.37.1 | Show the dashboard shell before sign-in, split charts.js/physique.js/formula-playground.js into focused modules with lazy chart loading, and add a health reminder banner, global search, full backup export, and offline app-shell support |
| `ccd7668` | **2.37.0** | Add a Carbohydrate Intake band to Wellness, fix AI report formatting, and rename macro labels for accuracy |
| `f821050` | 2.36.1 | Give the top nav more breathing room |
| `0f65999` | **2.36.0** | Add a Physique Today button, move Tune/Scan into the day form, add a live Sleep Duration readout, and turn the home page into a lightweight summary |
| `39a61d7` | **2.35.0** | Add day-target rows to Physique's Consumption/Workout tables, a Consumption divisor syntax, a muscle-loss fill on State Trend & Forecast, and fix the iOS Scan button |
| `7d941d4` | **2.34.0** | Add food-photo Scan to Physique, directional reconciliation flag, and update README |
| `a3def5d` | **2.33.0** | Suggest ingredient names while typing Consumption, mobile-keyboard-aware |
| `898edf5` | **2.32.0** | Auto-combine Consumption/Workout on Calculate, bound State Trend & Forecast to the panel's From/To, and fill Fat Intake's band |
| `0da2a17` | **2.31.0** | Add a Fat Intake chart to Wellness, with dashed-line band targets |
| `adccb79` | 2.30.1 | Rename Rest & Recovery to Sleep, collapse Physique's Bed/Wake columns into one Sleep hours column, and reorder Physical Activity above Caloric Intake |
| `a145a5b` | **2.30.0** | Add a Nutrition Log/Log More button and today's-usage row highlight, and reorder the Formula Playground to match its own legend |
| `b9bd316` | **2.29.0** | Add multi-macro Consumption anchors, an edit-before-banking button, a Nutrition usage count, and a fat band to the Formula Playground |
| `a2e11de` | **2.28.0** | Add a fiber band to the Formula Playground, mirroring protein's band |
| `90075b3` | **2.27.0** | Unify Nutrition's USDA lookup/pull into one button, add Fiber tracking, and consolidate table styling |
| `702ddc3` | **2.26.0** | Add Fiber/Fat/Carbohydrate columns to Nutrition, Physique and Food Insight |
| `e841e5d` | 2.25.1 | Merge Physique's breakdown and TEF tables into one per-ingredient table |
| `7259918` | **2.25.0** | Add a per-ingredient TEF column to Health Insight's Food mode |
| `a82eee8` | **2.24.0** | Add a per-day TEF column to Physique, measured from real macros where available |
| `ce82dea` | 2.23.2 | Move dark mode and hide-amounts toggles into account menu, drop panel-toggle FAB |
| `352c1d4` | 2.23.1 | Speed up first paint, and tune State Trend/Forecast, Sleep, Account and Physique feedback |
| `30fd4c7` | **2.23.0** | Add State Trend & Forecast's smoothed trend line and glycogen/water swing zone to the Body Mass chart |
| `c83e42b` | **2.22.0** | Add a per-day Micronutrients view to Physique, only flag nutrient shortfalls, and date-suffix day-scoped modal titles |
| `cc416b8` | **2.21.0** | Add glycogen/water swing awareness to Health Indicator scoring and forecast |
| `110dae5` | 2.20.3 | Make modal titles consistent, rename Work panel to Work Time, widen the page container, and drop the nutrition Amount hint |
| `90ab2b3` | 2.20.2 | Recolor Calorie Balance bars: dark green when a day meets target, red when both the day and its 7-day average miss it |
| `fb5e682` | 2.20.1 | Fix Calorie Balance tooltip's 7-day fatloss to multiply by 7 |
| `96c2780` | **2.20.0** | Add 7-Day Expected Fatloss to the Calorie Balance chart's hover tooltip |
| `af930fa` | **2.19.0** | Add a reference-target ring to Protein Source Rotation's donut, and reformat the Activity glance tile's kcal note |
| `c955ce9` | 2.18.1 | Fix the glycogen store's muscle-mass basis in the Formula Playground, and widen the symbol column |
| `8ef5274` | **2.18.0** | Make Log Time mobile-friendly again, drop the Monthly Expenditure average, and add a glycogen/water swing to the Formula Playground |
| `29e7b68` | **2.17.0** | Add a Weight column to the Activity Plan, sort Micronutrients ideal-first, alphabetize pulled micronutrient JSON, and fix Log Time's Start/End/Break formatting |
| `aaea4dc` | 2.16.1 | Change Log Time's Break field from a plain-minutes number to an HH:mm text input |
| `ec8636b` | **2.16.0** | Add Ideal/day targets to Micronutrients, a Muscle Group column to the Activity Plan, and fix a protein-decimal and a Break-field bug |
| `af8304c` | **2.15.0** | Add a Micronutrients column to Nutrition, a bulk/single-row pull from USDA's full nutrient panel, and a new Health Insight mode built on the real totals |
| `1b09191` | **2.14.0** | Color-code Protein's glance tile past its band top, and add a body mass value bubble to the progress bar |
| `d09d53d` | 2.13.1 | Shorten the Calculate breakdown's USDA source label to just USDA |
| `f65615c` | **2.13.0** | Add a system architecture diagram, a divide-quantity and a protein anchor to Calculate, and mask bed/wake time in privacy mode |
| `2bf24cd` | **2.12.0** | Give each panel group its own address, and let a transaction move its account's balance |
| `62780c6` | **2.11.0** | Add four terms to the Formula Playground, and a BMR equation to choose from |
| `fc17fbb` | 2.10.1 | Sign the Calorie Balance hover, and name its first row like the other charts |
| `d88db9c` | **2.10.0** | Fold income into the expenditure trend, and make every legend a switch |
| `3d7017d` | **2.9.0** | Add a Breakdown panel and a Tax button, and rename every sheet tab in one place |
| `b828c01` | 2.8.1 | Move "where," onto the variable list, and shorten a Nutrition header |
| `2c1732c` | **2.8.0** | Add a fat-loss percentage: a Δm% box, a solve mode and a third pin |
| `7ac53ce` | 2.7.3 | Show Monthly Income as this month alone |
| `ce5073a` | 2.7.2 | Shorten the Contact List heading to Contact |
| `6a7a7bc` | 2.7.1 | Move Activity below Nutrition in the Health section |
| `99c425a` | **2.7.0** | Renew the token before a form opens, and add a Health Plan feasibility insight |
| `8087e4d` | **2.6.0** | Cut every panel button to one word, and add a lean-mass protein band to the playground |
| `d7a886e` | **2.5.0** | Pin the activity target by time or calorie burn, add a Protein Sources AI insight mode, and shorten the Work/Travel/Application panel headings |
| `88b9b76` | **2.4.0** | Make the Activities catalogue editable, and give Health Indicators one window |
| `baf798b` | **2.3.0** | Merge into an already-logged day instead of refusing the save |
| `6300085` | 2.2.4 | Size the breakdown columns from their content, and merge Source with Save |
| `c014c19` | 2.2.3 | Make date/time inputs honour their width, and tighten the breakdown table |
| `5538427` | 2.2.2 | Keep both .form-row columns exactly half wide on a phone |
| `84d36a9` | 2.2.1 | Give every single-line form control one height |
| `af98648` | **2.2.0** | Read Physique's four totals off tables, and make workout tempo a setting |
| `2b34928` | **2.1.0** | Turn the Formula Playground into a solve-for-any-field calculator, and let Physique combine/sort duplicate ingredients |
| `29e347a` | 2.0.1 | Unify target/body-mass naming, fix Physique table UI, and merge duplicate ingredient rows |
| `947fd74` | **2.0.0** | Replace the Health Log with a per-day Physique tab and an Activities catalogue |
| `4719d7a` | **1.54.0** | Add an Instruction modal to the Activity Plan |
| `e48e13c` | **1.53.0** | Add AI Financial Insight panel; rename Accounts sheet, add Market Value |
| `663a918` | 1.52.3 | Merge spending panels, reorder Historical Trends, drop architecture diagram and emoji |
| `bf4b5af` | 1.52.2 | Remove dashboard screenshot from README |
| `faf5c23` | 1.52.1 | Cut the Insight prompts down and halve charts.js's comments |
| `e73e9ae` | **1.52.0** | Mark each week's average on the Health Indicators charts |
| `ec8fc6b` | 1.51.2 | Unify the Health Indicators charts, and rewrite the README as bullets |
| `464f26a` | 1.51.1 | Colour buttons by role and show progress on the slow ones |
| `72fdc41` | **1.51.0** | Classify ingredients, log workouts gradually, and tighten mobile layout |
| `8c12abd` | 1.50.1 | Rename weight to body mass and drive the forecast from the plan |
| `a50bd5f` | **1.50.0** | Merge the three AI insight panels and curve the weight forecast |
| `fa16bba` | 1.49.4 | Remove the Spending Patterns panel |
| `dd8d895` | 1.49.3 | Drop calibration and build the calorie bound from BMR plus activity |
| `c0193c8` | 1.49.2 | Make the calibration a smoothed three-term energy model |
| `e376926` | 1.49.1 | Drop the note that narrated a working formula toggle |
| `29afbe1` | **1.49.0** | Give Body Weight its own chart and make the calorie bound per-day |
| `9c914bc` | **1.48.0** | Let a food's amount be given as a calorie figure |
| `306d083` | **1.47.0** | Turn the calorie target into a max or a min, whichever the goal implies |
| `7c142ca` | **1.46.0** | Make the protein target a band scaled off goal weight |
| `bdf69d1` | 1.45.11 | Widen the calibrated-maintenance guard so the bars can respond again |
| `483e9b7` | 1.45.10 | Stop a noisy calibration from wrecking Calorie Deficit & Fat Loss |
| `05ad555` | 1.45.9 | Restore the toggle-sensitive right-axis label on Calorie Deficit |
| `b52ba9a` | 1.45.8 | Cut the commentary in calibration.js and the new chart axis helper |
| `517954c` | 1.45.7 | Drop the axis title added to Calorie Deficit & Fat Loss |
| `3f12a9e` | 1.45.6 | Tighten the Calorie Deficit axis and de-duplicate its right-axis label |
| `b025c79` | 1.45.5 | Revert the calibration fit to weighted OLS |
| `7bb95a9` | 1.45.4 | Always save the fitted calibration, never substitute the generic value |
| `879cd7b` | 1.45.3 | Calibrate over multi-week windows instead of refusing noisy data |
| `f558b81` | 1.45.2 | Regularize the calibration fit with weighted ridge regression |
| `45ab67e` | 1.45.1 | Align Activity Plan data-reps with the displayed sets x reps |
| `0b30840` | **1.45.0** | Add Calorie Deficit & Fat Loss chart, calibrated/generic toggle, Day 5 bodyweight plan |
| `5605638` | **1.44.0** | Add Activity Insight AI panel; fix Activity Plan table alignment; make Rest & Recovery axis data-driven; redesign Weight Trend progress meter |
| `273b90c` | **1.43.0** | Replace fixed 7/14/30-day lookback with custom From/To date range on Wellness Insight and Protein Source Rotation; hide landing page feature graphs on mobile |
| `39a946f` | 1.42.1 | Change Sleep bed/wake separator to "; " as canonical, "/" as legacy fallback |
| `e002c18` | **1.42.0** | Add Activity; Calories calorie-burn tracking; use it in Weight Trend calibration; align Health Metrics chart widths |
| `632abf3` | **1.41.0** | Match Wellness Insight styling to Food Insight; add optional question box |
| `52ed849` | **1.40.0** | Add Sleep bed/wake entry and redesign Rest & Recovery as a floating-bar chart |
| `b8d10cb` | **1.39.0** | Add plateau alert and Strength Training Plan; fold Time into Other; split gate.js from app.js |
| `6129e35` | **1.38.0** | Add Protein Source Rotation and Body Composition Change charts; promote Food/Wellness Insight to persistent panels |
| `b305b8f` | **1.37.0** | Redesign landing page as a node graph; add Verified column to Nutrition Facts |
| `6e5eff5` | **1.36.0** | Add reusable "pattern" entries to the Health Log |
| `1608c97` | 1.35.3 | Format Health Metrics chart x-axis dates as "Jun 29" instead of ISO |
| `4d7f035` | 1.35.2 | Remove merge_contacts.py, a one-time local tool no longer needed |
| `71c745d` | 1.35.1 | Document the Food Insight feature and Health Metrics chart changes in README |
| `a0b39fa` | **1.35.0** | Add Food Insight feature, reflow Health Metrics charts, fix ingredient-matching bugs |
| `121f7fb` | **1.34.0** | Add can/clove units, fix Nutrition Facts count-parsing bug, require review before auto-saving new ingredients |
| `33b4780` | 1.33.1 | Standardize Notes deterministically, persist Calculate breakdown, fix spray/count scaling |
| `b408e93` | **1.33.0** | Add "spray"/"shot" ingredient units, fix a gram weight for shots |
| `99eed7e` | 1.32.1 | Stop Calculate from renaming ingredients, show density used, grow Notes field |
| `4938854` | **1.32.0** | Add a personal Nutrition Facts table for AI calorie estimation, fix eTimeSheet reminder scoping |
| `183fff8` | **1.31.0** | Add a personalized TDEE-based calorie target formula |
| `1befd06` | 1.30.1 | Truncate long Company names in Work Log table, unify stat tile font size |
| `5d7ef5e` | **1.30.0** | Add Company field to eTimeSheet and scope overtime/reminder to it |
| `f20a75c` | 1.29.1 | Add category icons and color-coded accents to the landing feature cards |
| `7b182ca` | **1.29.0** | Add Health Log bulk edit, stacked activity chart, and Insight activity breakdown |
| `6778a4c` | **1.28.0** | Add protein tracking, AI health insight, and merge Journal/Portfolio into Finances |
| `803ca46` | **1.27.0** | Add calibrated weight forecast, overtime tally, and extend privacy mode app-wide |
| `cc2800f` | 1.26.2 | Stop auto-focusing form fields when any modal opens |
| `be940c3` | 1.26.1 | Extract shared JS/CSS helpers, add mobile-friendly styling, and speed up dashboard load |
| `9eb68be` | **1.26.0** | Add AI-powered calorie calculator to Health Log, fix modal styling |
| `2bf13f7` | **1.25.0** | Add a Settings panel and tune wellness chart layout/styling |
| `bd95d25` | **1.24.0** | Add dashboard widgets and reorganize the Journal/Applications panels |
| `7d072d5` | **1.23.0** | Add Travel and Applications tracking under a new Other section |
| `5e49ff3` | **1.22.0** | Add Contacts tab with bulk export/delete/merge and a source-merge tool |
| `081fd61` | **1.21.0** | Refresh labels, landing page, and add wellness autocomplete |
| `4574d7d` | **1.20.0** | Add red dashed target lines to all 4 wellness charts |
| `9242964` | 1.19.4 | Cap Weight Trend x-axis ticks to keep chart heights consistent |
| `469e47d` | 1.19.3 | Convert activity units to minutes in chart |
| `2c3f71a` | 1.19.2 | Update Activity default unit to steps, generalize activity chart axis |
| `bf76e76` | 1.19.1 | Fix Wellness Log UI: form styling, chart layout, notes truncation |
| `fbc3aef` | **1.19.0** | Add Wellness Log section with charts, log table, and entry form |
| `65cd042` | 1.18.1 | Build Spending Breakdown by Type panels dynamically from Insight data |
| `c61b138` | **1.18.0** | Add consent flag, silent-refresh retry, Time Log pagination; update README |
| `ce1891e` | 1.17.4 | Document accessibility improvements and currency-formatted chart axes in README |
| `7627941` | 1.17.3 | Show currency-formatted y-axis labels on dollar-denominated charts |
| `03220f5` | 1.17.2 | Add focus styles, empty-state rows, and modal accessibility; reorder Common panel |
| `df1a53a` | 1.17.1 | Proactively refresh the OAuth access token before it expires |
| `61f7e76` | **1.17.0** | Reorder Transaction columns, add Common payee/spend charts, Time Sheet live duration, percentage histograms; update README and screenshots |
| `cd22bb1` | 1.16.6 | update |
| `f84766a` | 1.16.5 | update |
| `99598ce` | 1.16.4 | Delete assets/images/architecture-diagram.png |
| `89fd1e3` | 1.16.3 | Add files via upload |
| `e58e44d` | 1.16.2 | Drop the (YYYY-MM) date suffix from the Income/Expenses/Net Cash Flow summary card labels |
| `22c0efb` | 1.16.1 | Make Work Pattern Analysis charts visually consistent, center panel-group titles |
| `01635e1` | **1.16.0** | Add transaction bulk edit, fix bulk-selection bar, round chart axis, layout tweaks |
| `2fbbe38` | 1.15.1 | Fix Break time saving as a duration multiplied by 1440 |
| `7adf9b3` | **1.15.0** | Add Time Sheet Work Pattern Analysis charts, bulk transaction operations with undo, keyboard shortcuts, and a Time Sheet reminder |
| `d5adef8` | **1.14.0** | Add account menu, inline transaction reporting, and a Time Sheet panel |
| `f2be2e1` | **1.13.0** | Add CSV export filters, distinct chart colors, and category autocomplete |
| `dc8c03c` | 1.12.3 | Polish dashboard layout: panel subtitles, animations, merged FABs |
| `de81211` | 1.12.2 | Consolidate chart panels and fix donut tooltip labels |
| `9a3c2f3` | 1.12.1 | Remove unhelpful Savings Rate Trend chart |
| `f356c47` | **1.12.0** | Add privacy mode, reconciliation status, and derive categories/benchmarks from Insight |
| `ea99785` | 1.11.1 | Fix expand/collapse-all FAB label after individual panel toggles |
| `6e5c54e` | **1.11.0** | Add dark mode, collapsible panels, and a floating action button stack |
| `f34a310` | **1.10.0** | Add Payee/Description autocomplete to the transaction form |
| `aefee48` | 1.9.2 | Order chart categories/account types by spend, rename trend panels |
| `03b9944` | 1.9.1 | Document Insight tab and Spending by Type feature in README |
| `9370456` | **1.9.0** | Add Spending by Type panel with per-category donut breakdowns |
| `755abb7` | 1.8.3 | Remove silent OAuth refresh to fix mobile sign-in popup failures |
| `0449361` | 1.8.2 | Fix dynamic category matching to exclude Income/Expenses, derive Saved/Cumulative by position |
| `ea0db81` | 1.8.1 | Update README for dynamic category columns in Monthly Summary/Benchmarks |
| `e372c95` | **1.8.0** | Add Account Composition & Savings Rate charts, dynamic categories, and UI fixes |
| `ff818df` | 1.7.2 | Add dashboard screenshot to README |
| `cb6cc02` | 1.7.1 | Unify category chart colors/legends, reorder charts, and tighten dashboard layout |
| `c577e1f` | **1.7.0** | Narrow layout to 900px, free-text account types, Save & Add Another for transactions, and mobile chart/donut/header fixes |
| `d3f06b7` | **1.6.0** | Add Spending Breakdown by Category donuts, fix Charts nav anchor and account-type edit bug, refine dashboard terminology |
| `d4ab71e` | 1.5.1 | Move social preview and touch icon into assets/images/ |
| `3b63b40` | **1.5.0** | Add footer, emoji header icons, SEO/social meta, manifest, and license |
| `163c928` | 1.4.2 | Update README.md |
| `3872903` | 1.4.1 | Remove Overview link from nav and drop its now-unused section id/styles |
| `f81dbea` | **1.4.0** | Merge accounts views, add sortable tables, fix chart scaling, refine palette and load performance |
| `1b1c1f8` | **1.3.0** | Document detailed architecture in README; add manual cache-clear control |
| `ae9fa28` | **1.2.0** | Add category spending comparison chart, reorder dashboard sections, redesign landing page |
| `351a653` | **1.1.0** | Reorganize assets into style/script folders, add favicon, persistent login, account/CSV management, and column sorting |
| `5c01171` | **1.0.0** | Build full Ledger app: auth, dashboard, transactions CRUD, charts, caching, mobile UI |
| `ffe4310` | 0.1.9 | Trim Categories to Category/Color and remove dangling Group/Budget refs |
| `ac7c9ae` | 0.1.8 | Simplify Transactions/Accounts schema and align Report with existing formulas |
| `c89a037` | 0.1.7 | Refine README with data model analysis and implementation plan |
| `ecf176d` | 0.1.6 | Update index.html |
| `0fa0257` | 0.1.5 | Create index.html |
| `50104b6` | 0.1.4 | Update README.md |
| `5092e54` | 0.1.3 | Update README.md |
| `198b5de` | 0.1.2 | Update README.md |
| `f57b7a5` | 0.1.1 | Update README.md |
| `e608995` | **0.1.0** | Initial commit |
