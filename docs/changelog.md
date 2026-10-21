# Changelog

[← Back to README](../README.md)

Every commit, newest first, with the version it produced (see [Versioning](versioning.md)); major and minor releases in bold. Rewritten on every commit by the post-commit hook (`scripts/version.cjs`); the newest row reads *(this commit)* until the next commit fills in its id.

| Commit | Version | Changes |
|---|---|---|
| (this commit) | **3.22.0** | feat: Physique's Derived table shows only the BMR picked in Tune, labelled plain BMR, under new Pro/DF/Fat/Carb rows (the Consumption breakdown's grams against the Intake Macros bands), and gains an M row (BMR + AEE, Desire BMR + the desired AEE) between lines under SD; the desired AEE falls back to the latest reading before the day; the Remain row leaves both Calculate tables; docs |
| `636c126` | 3.21.4 | fix: the plan's BMR_avg ratio is today's at m̄, figured as the Tune does (todayBmrFigures), not the last stored Physique row, which a pre-logged future day could be; Progress and the Status card's ETA now match the Tune's t; docs |
| `628561f` | 3.21.3 | chore: version.cjs's legacy commit ids follow the rewritten history (every version unchanged) and the changelog is rebuilt with the new ids |
| `4bcef48` | 3.21.2 | chore: commit-msg only strips co-author and attribution lines, and the pre-commit and pre-push hooks go; version.js's comment names post-commit as what stamps it; docs |
| `589dfc1` | 3.21.1 | chore: version.cjs's legacy commit ids follow the rewritten history (every version unchanged) and the changelog is rebuilt with the new ids; sidebar comments and the navigation doc trimmed |
| `33136a5` | **3.21.0** | feat: LeetCode gains a Progress card above Past Year (Health's meter over the NeetCode 250, solved and left, a mark every 25) with a time bar under it, days since the first solve against days to go at last week's pace and the finish date; the heatmap starts weeks on Monday, stretches its square cells to the card and on a phone shows Past 16 Weeks; the roadmap shrinks to the card on a phone; the solved summary moves under Roadmap's title; LeetCode comes first in Track, before Work Time; docs |
| `5bc8256` | **3.20.0** | feat: every chart's hover is drawn over the page (htmlTooltip, Chart.js's own look and callbacks) so a tall one such as Intake's or Calorie Balance's is no longer cut at the chart's bottom; Intake's hover adds each macro's logged grams after its kcal and Intake and Calorie Balance show only the BMR selected in Tune (selectedBmrKey, shared with the Status card); the dated Health charts' y axes are fitted to their widest label, one width on both sides (fixDatedYAxisWidth), while the Rotation charts keep 120px; docs |
| `16a68d0` | **3.19.0** | feat: Health Chart gains Intake under Calorie Balance, each day's Protein, Dietary Fiber, Fat and Carbohydrate as stacked kcal (carbohydrate net of fiber, scaled so the stack equals TEI) under Caloric Intake's own TEI dots, 7-Day Average, Desired cap and five BMR caps; 🔍 beside 📤 shows Caloric/Protein/Dietary Fiber/Fat/Carbohydrate Intake, Protein Source Rotation and Activity Rotation, hidden by default and on every reload (🙈 hides them); Protein Source Rotation tops Nutrition and Activity Rotation tops Activity and, above the tiles, Workouts; Progress marks every 2 kg and every 4 weeks with one smooth red-to-green fill; saving a Physique day whose D is above its Desire pulses the page edge red and shakes the form; Derived is open on every date; docs |
| `4596a90` | **3.18.0** | feat: 📤 on Health and Finance Chart saves the whole page as a PNG (phone share sheet to the gallery, laptop download), drawing charts not yet scrolled near first (buildPendingCharts) with html2canvas-pro, keeping the page's CSS, fonts and unboxed legends; Market leaves the sidebar now its tile lives on Finance Insight; the Status card shows only the BMR selected in Tune, adds M (maintenance, BMR + AEE) between lines under SD and ETA, the plan's days and date to the healthy mass as on Progress; docs |
| `3e3249a` | **3.17.0** | feat: every dated Health chart's axes refit to what its legend still shows (Body Mass, Caloric Intake, Calorie Balance, Protein, Carbohydrate, Fat, Dietary Fiber and Sleep's clock axis skip hidden entries, as Physical Activity already did); Body Mass, Physical Activity and Sleep dots shrink with the range like bars (fitPointRadius, fitPointBorderWidth: at most 40% of a day's slot, border thinning with it); Protein Source Rotation and Activity Rotation draw a 550px bar chart beside the donut; print starts on sheet 1 (a chart box, not a page-tall panel, avoids a break), prints legend swatch colours and keeps donuts round; docs |
| `a43c757` | **3.16.0** | feat: Tune's Basal metabolic rate gains BMR_avg, the average of BMR_mif, BMR_kat, BMR_cal and BMR_adp (BMR_adp as of today), as a basis the whole plan can run on (the active equation scaled by BMR_avg / equation), with a BMR_avg row under m-inf_adp, its Equations and Calculations lines, a stored BMR_avg in every Physique day's Derived JSON, a Derived and Status row, a fifth Caloric Intake cap and the hovers; the Setting tab's old target keys are renamed with their duplicates merged, every key the app writes has a default Note filled on save and on load; bulk Calculate tidies Consumption and the Tidy button goes, as does Save & Add Another; Transfer, Capitalize Names, Import CSV, Update Market Value and the two contact exports become emoji buttons and Transfer's commit a Save; Amount reads gr, gram and grams as grams; docs |
| `930177f` | **3.15.0** | feat: "target" leaves the whole project, code, setting keys, ids, classes, file names, comments and docs, for the UI's words: healthy for the body-mass goal (BODY_MASS_HEALTHY_KG, healthyKg) and desired for every other goal (SLEEP_DESIRED_HOURS, getCalorieDesired), health-nutrient-targets.js now health-nutrient-desired.js; every dated Health chart gets a swatch legend under it whose entries click to hide their series or bars/dots of that colour, desired marks turn cyan apart from the 7-Day Average, results read Desired met / Near desired / Missed desired alike, 8 evenly spaced gridlines with the first and last date on the plot edges at every range and a 120px left y axis so Rotation names fit; Body Mass draws Tune's healthy body mass, joins its dots with a thin gray line across gaps, plots a lone old reading, restarts its trend lines after a 14-day gap and draws the Calorie Trend in indigo; Tune opens a fresh user on the user's own figures (m_des 70 kg, L_p 7, n_p 4, gamma 3, kappa 3, walking MET 3, f 13.5, b_min 17, q 30-50, Delta-m% 1, a 170 cm / 35 y / 38-91-99 cm profile); a receipt of 2+ transactions ends in a blue UI-only total, the Pay badge shows only for the 3 days after Payment Day and on the home tile too; docs |
| `734ce48` | 3.14.1 | refactor: rename every feature file, identifier, comment and doc to the UI section-page scheme (health-/finance-/track-/other-/ledger-*; wellness→health, Indicator→Chart, Timesheet→Work Time, Formula Playground→Tune), shared infra left neutral and the Wellness insight feature kept as-is; split the Health chart module into one file per chart; align the Health Chart vertical gridlines at every range via a fixed y-axis width; printer-friendly @media print rules; Body Mass chart joins its dots with a connecting line; fix the physique data-load crash by coercing text cells to strings; add the system-architecture diagram to the README and correct the social-preview description order; remove the one-off activity-image fetch scripts; add walk/backstroke/run activity gifs |
| `10d6a65` | **3.14.0** | feat: Breakdown leaves the Finance and home tiles and the sidebar (PAGES_WITHOUT_TILES in page-nav.js; /finance/breakdown/ still opens, and commenting its entry out brings them back); Calculate title-cases each exercise name in a day's Workout box, and the Workout table under it shows names that way, as Consumption does for ingredients; docs |
| `9d36bf5` | **3.13.0** | feat: Tune adds neck, waist and hip under age, U.S. Navy body-fat % (Hodgdon & Beckett) under BMI_des and LBM_navy above the Boer LBM, now LBM_boer, with their Equations and Calculations lines in Variables order; a Lean body mass question above Basal metabolic rate picks Boer or U.S. Navy for Katch-McArdle, A/B, protein and glycogen app-wide (LBM_FORMULA); new settings get a default Note; an account's Payment Day (1-31, Break-sized box) shows a red Pay <n>d badge on its row and the Account tile once passed unpaid; Activity Rotation runs furthest below desired first, like Protein Source Rotation; docs |
| `adcf1f7` | **3.12.0** | feat: home and hub tiles are liquid-glass capsules (frosted, top shine, lit rim, soft shadow) over their old colour coding, while sidebar links go back to plain list items; Contact, Refresh data, Clear cache and Settings sit above the switches, now named Dark mode, Amounts, Widgets and Bulbs, which show and work before sign-in from this browser's last values (Widgets and Bulbs off by default) and take the Settings tab's once it loads; Market's tile moves beside Snapshot on Finance Insight; Portfolio Allocation is renamed Account Allocation; docs |
| `8a677e6` | **3.11.0** | feat: Contact and Settings open from the account menu, and Other leaves the tab bar, sidebar and home page (its /other/ addresses still work); sidebar links are liquid-glass capsules with a lit rim, top shine and a lift on hover, blue glass when selected; docs |
| `4dadc62` | 3.10.1 | fix: Physique's Derived table shows TEF from intake alone, and before Bed and Wake are typed reads SD as 0 with D and Δm′ worked out from it; ticking Pattern also hides Workout (with its table) and Derived, and a pattern saves Workout, Duration and AEE blank; Protein Source Rotation, Activity Rotation (both copies) and Finance's Cumulative Net Worth sit flush under their headings like every other chart; docs |
| `c3430bd` | **3.10.0** | feat: a new exercise in a day's Workout is priced by AI on Calculate (MET, Category, Group, Muscle Group, Sets x Reps and Rest), its row showing AI with 💾 to save it to the Activity sheet and ✏️ to fix it first, and ✅ for one already there, as Consumption does for a new ingredient; table columns 5px apart everywhere; commit-msg strips every attribution trailer; Add Activity's Save finds the saved row by Name, not Category; docs |
| `a68f15e` | **3.9.0** | feat: sidebar's bottom panel holds Refresh data, Clear cache and the show/hide settings as iPhone-style switches (Dark mode, Show amounts, Show widgets, Show bulbs) above an account row with the Google picture, name and email that opens the account menu above it; links scroll on their own above the panel; with the sidebar hidden or below 1180px they sit in the account menu instead; docs |
| `4b74105` | 3.8.1 | chore: version.js and changelog for 3.8.0, which the post-commit hook skipped while WSL had no node |
| `ff5defc` | **3.8.0** | feat: sidebar hides with a panel button in the logo row (or Ctrl+.), leaving the Ledger logo as the button to bring it back, remembered before first paint; hub tiles colour-coded by function (gray database, green form, orange chart, purple AI incl. Market and Insight modes); Portfolio between Breakdown and Watch List; Health ranges add 6m and 5y, Finance Indicator adds 5y; Caloric Intake y axis from 0 kcal; Protein Source Rotation scales Protein % to 100% and targets the protein band's top; docs |
| `322f6db` | **3.7.0** | feat: Track LeetCode page with the NeetCode 250 roadmap by category (✅, Solved, Problem, Difficulty, 🎥 NeetCode video and 🔗 LeetCode buttons), one category open at a time; Past Year heatmap and NeetCode's roadmap graph cards; 📝 Log form (Date, Problem, Category, Difficulty, LeetCode, NeetCode Video, Notes) saving to a LeetCode tab with columns found by header; docs |
| `3c8a9e3` | **3.6.0** | feat: changelog of every commit with its version, rewritten by the post-commit hook; version counted from 0.0.0 over the whole history with judged legacy commits (Finance Market as 3.0.0); commit-msg strips co-author and attribution lines; docs |
| `412c5c0` | **3.5.0** | feat: version from commit messages (Conventional Commits, as in CELPiPi): feat bumps minor, fix/other bumps patch, feat! bumps major; post-commit hook stamps version.js; docs |
| `f447c5c` | **3.4.0** | Weather widget: today's sunrise and sunset on the current-conditions line (icon and temperature, condition on hover) to keep it one line; docs |
| `3d8b026` | **3.3.0** | Range buttons (1w/1m/3m/1y/All) replace From/To on Health Indicator and Health Insight; Finance Indicator 3m/6m/1y/All for Net Worth and Expenditure Trend, uncapped y axis; Settings tabs with own addresses and Note/Key/Value columns; every table fits its content; Protein Source Rotation stacked by ingredient with ingredient legend; Nutrition drops Uses, orders used-today then protein; Transaction line per receipt; docs |
| `69c518a` | **3.2.0** | Watch List price alerts (below/above price, long-term average, trailing stop) with red badges on Watch List and Market, dismiss, 4-hour background check; AI suggests alerts in a fixed line with 📌 apply and checks; entry stop for buying today and position size; Market and Portfolio cards 2x2 on phones; docs |
| `6169fb2` | **3.1.0** | Finance: Watch List page (🔬 opens Market) and Market page merging the chart with Analysis; watchlist picker; long-term chart lines (SMA200, 52-week high, trailing stop, market) with Chart history sent to AI; trailing stop default 4 ATR; TSE: AC symbol input; Alpha Vantage spacing and TSX news message; docs |
| `5eb69fc` | **3.0.0** | Finance Market, Portfolio and Analysis pages: watchlist and price history, ACB trade log in CAD, evidence-based signals with AI read; smaller phone tab labels; docs |
| `619e127` | 2.94.1 | Activity: one table with Category and Group columns, a line at each Group change; docs |
| `e9e46e6` | **2.94.0** | Red day-count badges: Finance Insight Snapshot, Transaction over 30 days, Work Time days since last log; keep Insight badges after tile redraw; docs |
| `f5bfe53` | **2.93.0** | AI provider switch (Groq or OpenRouter) with models from Settings; 30-day red badges on Insight tiles; docs |
| `313e756` | 2.92.1 | Tune: shorter variable names and BMR label; Equations in the site font, headings dark, equations gray; docs |
| `01bdcb6` | **2.92.0** | Tune as four cards with one BMR choice and desired wording; account details beside Account; one side-by-side field gap; docs |
| `156bc7a` | **2.91.0** | Workouts (was GYM) with Cardio and NEAT; desktop footer strip as phone; even glass sidebar; sidebar closes open form; m̄ in progress bubble; docs |
| `a4882d1` | 2.90.7 | Phone polish: top safe-area strip, faded footer, lighter bottom bars, plain tab colours, iOS-style search boxes, m row in Derived |
| `8a9fcab` | 2.90.6 | Tiles: neutral gray capsules with 12px labels |
| `16ffcbf` | 2.90.5 | Four tiles a row on a phone |
| `78971d0` | 2.90.4 | Body text 13px |
| `592f678` | 2.90.3 | Footer "© year ALI — Ledger vX"; author meta and schema.org JSON-LD |
| `c884349` | 2.90.2 | Footer as "Ledger vX • © year ALI"; card text 12px |
| `a444e6b` | 2.90.1 | Body text back to .9rem |
| `7c66b3d` | **2.90.0** | Track section, Apple-style look, titled tile cards, one type scale |
| `29a2b03` | **2.89.0** | Confetti on saving an income transaction; darker hover shadow |
| `284a6a2` | **2.88.0** | Nutrition Group, grams-first Amount, Protein Rotation by Group; Pattern form; Finance tweaks |
| `ff99ef5` | **2.87.0** | Physique: collapsible Derived table with Desire targets, calibration ramp-up/clamp; Activity Rotation on GYM; Body Mass dots |
| `d278ec8` | 2.86.3 | Nav: bottom bar through tablet widths, no top-bar gap before the sidebar |
| `9893807` | 2.86.2 | Transaction filters: dates on top, the four filters in a 2x2 grid on phones |
| `f65142f` | 2.86.1 | Fix local-date bugs, suggestion placement and stale docs; remove dead code |
| `6af2000` | **2.86.0** | Automatic version in the footer; confetti fires on save |
| `da0671b` | **2.85.0** | Split README and features into topic docs; pin phone suggestions to the top; confetti on body-mass progress |
| `0c6a8cb` | 2.84.8 | Rename Physique's BMR column to Derived, underline Activity table headers |
| `4ec6d52` | 2.84.7 | Widgets as bulbs, one gap across the home page |
| `e4d4821` | 2.84.6 | Same gap from the last bulb to the tiles as between bulbs |
| `4b96240` | 2.84.5 | Charts and GYM activities as bulbs; Micronutrients tables compact |
| `54bff7d` | 2.84.4 | One font family, Today before GYM, even gap under date rows |
| `57a8dbe` | 2.84.3 | No auto-zoom on iPhone, header-row lines, Insight views reload in place |
| `0ad8287` | 2.84.2 | Tables size columns by the table alone; cards keep their padding on phones |
| `051ae78` | 2.84.1 | Tables: fixed row heights, row buttons never stacked |
| `06fc9f3` | **2.84.0** | GYM page, quick logging, and one consistent style system |
| `84a3906` | 2.83.2 | Day form: Sleep Duration/Deprivation line in the m̄/Δm/BMI style |
| `4e42a73` | 2.83.1 | README: stored glycogen swing, load timing logs, body-mass and Load wording |
| `212a483` | **2.83.0** | Finance: Cumulative Net Worth glance card under the summary cards |
| `eee7d99` | 2.82.9 | Remove Health's Settings block; Other's Settings is the one page |
| `a04f9eb` | 2.82.8 | Log where a load's time goes |
| `720638d` | 2.82.7 | Day form: m̄/Δm/BMI line with each unit once |
| `4e1950b` | 2.82.6 | Day form: m_d shown in kg |
| `b3965b2` | 2.82.5 | Day form: m_avg/m_d/BMI line, each in its own unit |
| `de1ce27` | 2.82.4 | m_d stored in kg/day like every other body-mass figure |
| `3f90ecc` | 2.82.3 | Body-mass figures stored in the BMR cell, not a new column |
| `f2e1d89` | 2.82.2 | Tune's Update: say it recomputes m_avg too |
| `2f7d058` | 2.82.1 | Activity: an exercise's Weight is shown as Load |
| `06977ca` | **2.82.0** | Stored Mass column: m, BMI, m_avg and m_d saved per day; body-mass wording |
| `cca6907` | 2.81.17 | Glycogen swing saved once as GLYCOGEN_SWING_KG |
| `ce6e0fc` | 2.81.16 | Phone footer: copyright line 10px lower |
| `cf171e6` | 2.81.15 | README: phone footer strip, left-aligned date/time fields |
| `a08d82b` | 2.81.14 | Phone: copyright line in a strip under the bottom bar |
| `515d949` | 2.81.13 | Phone: no scroll on a short page, footer resting on the bottom bar |
| `ecb5c27` | 2.81.12 | Forms: date and time values pinned left on iOS too |
| `1dc8333` | 2.81.11 | Forms: date and time values left-aligned |
| `b9525ff` | 2.81.10 | README: drop the short-page height note (reverted) |
| `1ba4c66` | 2.81.9 | Revert "Short pages fit the screen; footer above the phone bottom bar" |
| `d02dca6` | 2.81.8 | README: logged rows, Progress card note |
| `00aa7ee` | 2.81.7 | Progress card: no empty line under the last bar |
| `5882a18` | 2.81.6 | Status: one m row with the rolling average in brackets |
| `770e101` | 2.81.5 | Status: m shows the glycogen/water swing beside its target too |
| `0c7de79` | 2.81.4 | Activity: no hover note on a logged row, like Nutrition |
| `d100306` | 2.81.3 | Activity: a logged row is green with no tick, like Nutrition |
| `9343aaf` | 2.81.2 | README: Workout suggestions, page height and footer |
| `e697250` | 2.81.1 | Short pages fit the screen; footer above the phone bottom bar |
| `f58ac8a` | **2.81.0** | Physique form: exercise-name suggestions for Workout |
| `61a671a` | 2.80.11 | README: actions in one place, phone bar spacing, form button order |
| `2f37698` | 2.80.10 | Phone bottom bar a quarter closer to the bottom edge |
| `db5d9a9` | 2.80.9 | Actions at the top on every page, in the phone bar's order |
| `a02ebd9` | 2.80.8 | Reload of a row address: no lowercase name in the breadcrumb |
| `f8b42c5` | 2.80.7 | Ingredient form: Scan before Complete |
| `00b3c00` | 2.80.6 | Ingredient form: name and unit columns at the page's text size |
| `337fd56` | 2.80.5 | Ingredient form: name column as wide as its text |
| `d6a2f49` | 2.80.4 | Phone bottom bar: half the gap between buttons and the account circle |
| `25fc629` | 2.80.3 | Phone bar spacing even at both ends; Physique form: Scan first |
| `4fff572` | 2.80.2 | README: first-paint layout, Ledger tab, phone bar details |
| `aff63c5` | 2.80.1 | Hub/page layout from the first paint |
| `a025c9a` | **2.80.0** | Car Service: winter changeover and rust protection on 1 Dec |
| `e62a511` | 2.79.1 | Phone bottom bar: long labels wrap onto two lines |
| `5662572` | **2.79.0** | Phone tab bar: Ledger tab for the home page |
| `ddfb4ac` | 2.78.2 | Phone: account avatar the same circle as the bottom bar's close |
| `83d4aea` | 2.78.1 | Hide bulbs: keep the cards on section pages |
| `3e620cb` | **2.78.0** | Hide bulbs: account-menu toggle for the home page's glance cards |
| `578f519` | 2.77.3 | Phone bottom bars float above the home indicator |
| `a66a2d3` | 2.77.2 | Pill bottom bars, round close, emoji buttons always white |
| `c8fc851` | 2.77.1 | Selection-bar buttons and Physique's Today as white emoji |
| `9939df6` | **2.77.0** | Emoji action buttons, badges, saves stay open, exports in Settings |
| `82ecd29` | 2.76.2 | Phone bottom bars: one height, one button style |
| `6d1fa98` | 2.76.1 | Six text colours, thinner tables, home breadcrumb, compact BMR line |
| `547301a` | **2.76.0** | Every form a page, no top bar, Insight mode pages, all styling in styles.css |
| `16db0b1` | 2.75.4 | Breadcrumb: link a row's date over its 🧬 view |
| `0c5b0a5` | 2.75.3 | README: batched reads, per-page loading, breadcrumb root |
| `0474aa1` | 2.75.2 | Breadcrumbs start at Ledger, linking to the home page |
| `b8f744c` | 2.75.1 | Contact table: columns fit their text, scrolling sideways |
| `0e037be` | **2.75.0** | One bottom bar at a time on phones, ❌ on every page, direct form loads |
| `c25d0ac` | 2.74.4 | Section hubs: breadcrumb in place of the centred title |
| `8596c61` | 2.74.3 | Health hub: Today as the first tile, before Tune |
| `d427cbf` | 2.74.2 | Settings tables: actions and key on one line |
| `c60bd2d` | 2.74.1 | Health hub: keep Today, drop Log |
| `b073902` | **2.74.0** | Today and Log on the Health hub |
| `4b01e98` | **2.73.0** | Form pages styled like block pages; home overview with tiles; name-only tiles |
| `0295264` | **2.72.0** | Forms open as pages on section pages |
| `3fec6bb` | 2.71.1 | Finance: Financial Indicator/Insight become Indicator and Insight |
| `143d6e6` | **2.71.0** | Section pages as a hub and pages, with a sidebar on wide screens |
| `2756349` | 2.70.1 | Load only the current section's blocks |
| `5235c43` | **2.70.0** | Batch Sheets reads and share the tab list; add Clear cache |
| `dbb839f` | 2.69.2 | Pattern table: content width, one line per cell, compact padding |
| `df33878` | 2.69.1 | Profile order: sex, height, age, then body mass |
| `f20991c` | **2.69.0** | Health Settings block; read walking MET and BMR_cal from their sheets |
| `6f5c28e` | 2.68.1 | Insight mode names and order, Food macro fallback, consistent hover units |
| `5b54392` | **2.68.0** | Nutrition Facts order and names, setting-driven targets, more row addresses |
| `66683f0` | 2.67.6 | Progress card: regular-weight figures and lost/left, elapsed/ahead labels |
| `dd44a67` | 2.67.5 | Remove all caching; smooth m̄ over L_p; Status, Progress and unit cleanups |
| `c000fef` | 2.67.4 | Car Service: wrap Basis in a narrow column; bump shell cache to v29 |
| `463e654` | 2.67.3 | Stop iOS Safari text inflation (Car Service Basis column) |
| `e9b24be` | 2.67.2 | Progress card: stat text at the Status rows' font size |
| `1620617` | 2.67.1 | README: Status, Progress card, ingredient form and Pattern micronutrients |
| `bd5630b` | **2.67.0** | Health glance: drop m̄ and t, Progress card with 10% marks under the cards, tighter stack, Sleep Window first |
| `bc23e56` | **2.66.0** | Physique Patterns: own micronutrients table and pattern-N addresses |
| `fa432aa` | 2.65.2 | Ingredient form: Amount as a stacked field like Classification and Name |
| `62c5a63` | 2.65.1 | Ingredient form: label-matched names and units, fixed right-aligned fields |
| `aa60537` | **2.65.0** | Standard units, editable Patterns period length, sheet-matching sleep labels |
| `8095e7e` | **2.64.0** | Nutrition lock table, per-row edit addresses, Insight prompt templates |
| `ea3405b` | **2.63.0** | Add Equations and Calculation dropdowns to Tune |
| `d36ef6d` | **2.62.0** | Add Car Service reminder flag and daily notification |
| `597b92c` | **2.61.0** | Add Car Service block with service history and predictions; chart hover consistency |
| `df9cb14` | **2.60.0** | Add block/form addresses, Tune block, and stored per-day BMR in Physique |
| `bff4116` | **2.59.0** | Pin form actions to the bottom on mobile, update balances on edit, add progress bar bands |
| `33e62d4` | 2.58.1 | Sort Activity plan and Instructions modal by rotation completion |
| `d094584` | **2.58.0** | Add export confirmation dialogs and reorder Status card rows |
| `600323c` | 2.57.3 | Fix Breakdown action buttons wrapping on mobile, Sleep header abbreviation, integer macros in Physique table |
| `2f91e5c` | 2.57.2 | Improve Transaction and Physique UX across filters, exports, and table display |
| `71d6dbf` | 2.57.1 | Make forms full-screen on mobile and fix background scroll |
| `dc8e284` | **2.57.0** | Add block-visibility toggle, catalogue propagation, and Health Plan parity |
| `d0d70cd` | 2.56.1 | Make Health Insight tables/profile consistent across modes |
| `ba2e7ce` | **2.56.0** | Make Health Insight's Patterns period length user-editable |
| `fec16c3` | **2.55.0** | Add a Patterns mode to Health Insight |
| `32ee985` | **2.54.0** | Add BMR calibration, fix Calculate/basis bugs, and clean up small UX gaps |
| `329db21` | **2.53.0** | Replace the Health Indicator charts' weekly-bucket trend with a continuous EMA |
| `d091319` | 2.52.1 | Make the phone bottom nav a real tab bar with thumb-sized tap targets |
| `a13027a` | **2.52.0** | Overhaul the mobile layout: bottom nav, auto-hiding header, fixed dark-mode colors |
| `547035a` | 2.51.2 | Ignore local editor settings |
| `6eca558` | 2.51.1 | Show 28 dated days plus every Pattern row per Physique page |
| `b25aa1d` | **2.51.0** | Add a Log button to the Add/Edit Activity modal |
| `e4bb4e2` | 2.50.1 | Document that Settings masks API keys/tokens by default |
| `70f2c9b` | **2.50.0** | Add today's raw body mass to Status, mask secrets in Settings, line off Physique weeks, and harden dashboard loading |
| `548621c` | 2.49.4 | Drop the visible "Loading your data..." banner and fix the scan's vision model |
| `4c8cbc1` | 2.49.3 | Drop the default sign-in banner and let gated actions sign in on click |
| `1e2c2e2` | 2.49.2 | Fix Physique scan's vision model id, which pointed at a nonexistent Groq model and made every scan fail. The comment above it already named the intended model (Llama 4 Scout); the constant just never matched it. |
| `8d64c6c` | 2.49.1 | Drop `required` from every form field except Log a Transaction's Date/Account, so a field that doesn't actually need a value stops blocking Save over it. |
| `a689a04` | **2.49.0** | Add an Activity Rotation chart to Health Indicator, matching Protein Source Rotation's bar+donut shape: a new Weekly Target column on the Activity sheet drives a horizontal bar (sessions logged vs. desired this window, one bar per Group) and a three-ring donut (reference weekly split, last 4 weeks, last week). A session credits every Group a day's Workout notes touch, not just the dominant one. |
| `0697a93` | 2.48.2 | Fix Delta-m's target to negate WEEKLY_FAT_LOSS_KG the same way D's target already does, so a cut's desired mass change reads negative (losing) instead of positive, and keep the Status/Macros/Activity/Sleep bento as two columns below 640px instead of collapsing to one, with tighter row and card padding so the Status card's longer figures still fit on a phone width. |
| `cc83414` | 2.48.1 | Split the Status card's BMR row back into BMR/lambda-t/BMR_adp so the adaptation discount and its result are always visible, independent of which basis Balance/Delta-m actually run on. |
| `c217fa8` | **2.48.0** | Add a global BMR/BMR_adp basis toggle to the Formula Playground and wire it through every deficit, calorie target and the forecast's A/B, split the Status card into a Status/Macros/Activity/Sleep bento layout with new BMI and lambda-t rows, standardize chart hover labels to the Playground's symbol vocabulary (TEI/AEE/TEF/SD/D/BMR/BMR_adp) across Body Mass, Calorie Balance, Caloric Intake, Protein/Fiber/Fat/Carb, Activity and Sleep, fix the Body Mass chart's Calorie-Implied Trajectory to reach today instead of stopping at the last weigh-in, add a per-day Adapted BMR dashed line to Caloric Intake, and replace "target" with "desired" across Health Indicator and Health Insight prompts. |
| `aaa7e4d` | 2.47.1 | Simplify the Status card's Intake separator to / and drop the explicit + on positive figures |
| `a50b5b5` | **2.47.0** | Rebuild Health Status card as an energy-budget ledger and add Desire/Remain to Physique breakdowns |
| `f4d0d2c` | **2.46.0** | Add a Normalize button to the Nutrition ingredient form, a Capitalize Names bulk action to Nutrition, and fold Physique's own capitalize/combine buttons into one Tidy button |
| `714ace0` | **2.45.0** | Resync the Health Formula Playground to the metabolic-model reference notation, add a deficit-vs-BMR warning row, and widen the symbol column |
| `9dff321` | **2.44.0** | Add account-to-account Transfer, split README into docs/, and give Tune/Today/Transfer their own gray button role |
| `9545c1b` | **2.43.0** | Reorder Physique table columns, add Sleep Deprivation readouts, and gradient the Caloric Intake and progress-meter colors |
| `c902a68` | **2.42.0** | Redesign Status card to 5 rows, add Intake/Digestion/Activity/Deprivation mirror rows, fix null-textContent crash, graduate progress bars blue-to-green, and remove the JSON backup export |
| `2e0045e` | **2.41.0** | Model sleep deprivation's effect on fat loss across Health Indicator, and fix chart x-axis consistency |
| `46e43ff` | **2.40.0** | Rename the Macros/Activity glance cards to match their charts, add a Cardio/NEAT/Strength breakdown, fix a label typo |
| `a518e7a` | **2.39.0** | Redesign the Today-at-a-glance cards into Status/Macros/Activity/Sleep, and add a per-day Basal Metabolic Rate marker to Caloric Intake |
| `296d3e0` | **2.38.0** | Rework the Today-at-a-glance cards into Body Mass, Activity, Macros and Sleep, and fix the sign-in check being stuck behind window.load |
| `8fbcc4b` | 2.37.2 | Remove the header global search box |
| `88c6f64` | 2.37.1 | Show the dashboard shell before sign-in, split charts.js/physique.js/formula-playground.js into focused modules with lazy chart loading, and add a health reminder banner, global search, full backup export, and offline app-shell support |
| `d5c1178` | **2.37.0** | Add a Carbohydrate Intake band to Wellness, fix AI report formatting, and rename macro labels for accuracy |
| `7a2ada5` | 2.36.1 | Give the top nav more breathing room |
| `81f59fd` | **2.36.0** | Add a Physique Today button, move Tune/Scan into the day form, add a live Sleep Duration readout, and turn the home page into a lightweight summary |
| `0bd4256` | **2.35.0** | Add day-target rows to Physique's Consumption/Workout tables, a Consumption divisor syntax, a muscle-loss fill on State Trend & Forecast, and fix the iOS Scan button |
| `84108d7` | **2.34.0** | Add food-photo Scan to Physique, directional reconciliation flag, and update README |
| `755e9f3` | **2.33.0** | Suggest ingredient names while typing Consumption, mobile-keyboard-aware |
| `01e0c09` | **2.32.0** | Auto-combine Consumption/Workout on Calculate, bound State Trend & Forecast to the panel's From/To, and fill Fat Intake's band |
| `ddf8d89` | **2.31.0** | Add a Fat Intake chart to Wellness, with dashed-line band targets |
| `b3f74f9` | 2.30.1 | Rename Rest & Recovery to Sleep, collapse Physique's Bed/Wake columns into one Sleep hours column, and reorder Physical Activity above Caloric Intake |
| `04f8c4f` | **2.30.0** | Add a Nutrition Log/Log More button and today's-usage row highlight, and reorder the Formula Playground to match its own legend |
| `0f6871a` | **2.29.0** | Add multi-macro Consumption anchors, an edit-before-banking button, a Nutrition usage count, and a fat band to the Formula Playground |
| `cfd16af` | **2.28.0** | Add a fiber band to the Formula Playground, mirroring protein's band |
| `50e66bb` | **2.27.0** | Unify Nutrition's USDA lookup/pull into one button, add Fiber tracking, and consolidate table styling |
| `6cda756` | **2.26.0** | Add Fiber/Fat/Carbohydrate columns to Nutrition, Physique and Food Insight |
| `9cbf9e1` | 2.25.1 | Merge Physique's breakdown and TEF tables into one per-ingredient table |
| `ca48f4a` | **2.25.0** | Add a per-ingredient TEF column to Health Insight's Food mode |
| `9466d96` | **2.24.0** | Add a per-day TEF column to Physique, measured from real macros where available |
| `3003f26` | 2.23.2 | Move dark mode and hide-amounts toggles into account menu, drop panel-toggle FAB |
| `787dd8d` | 2.23.1 | Speed up first paint, and tune State Trend/Forecast, Sleep, Account and Physique feedback |
| `8ae6574` | **2.23.0** | Add State Trend & Forecast's smoothed trend line and glycogen/water swing zone to the Body Mass chart |
| `a1eca3b` | **2.22.0** | Add a per-day Micronutrients view to Physique, only flag nutrient shortfalls, and date-suffix day-scoped modal titles |
| `fdba793` | **2.21.0** | Add glycogen/water swing awareness to Health Indicator scoring and forecast |
| `82fb3a8` | 2.20.3 | Make modal titles consistent, rename Work panel to Work Time, widen the page container, and drop the nutrition Amount hint |
| `fa40f03` | 2.20.2 | Recolor Calorie Balance bars: dark green when a day meets target, red when both the day and its 7-day average miss it |
| `86dfbf6` | 2.20.1 | Fix Calorie Balance tooltip's 7-day fatloss to multiply by 7 |
| `b37c737` | **2.20.0** | Add 7-Day Expected Fatloss to the Calorie Balance chart's hover tooltip |
| `cada066` | **2.19.0** | Add a reference-target ring to Protein Source Rotation's donut, and reformat the Activity glance tile's kcal note |
| `d4a733d` | 2.18.1 | Fix the glycogen store's muscle-mass basis in the Formula Playground, and widen the symbol column |
| `0a9179b` | **2.18.0** | Make Log Time mobile-friendly again, drop the Monthly Expenditure average, and add a glycogen/water swing to the Formula Playground |
| `ae00e59` | **2.17.0** | Add a Weight column to the Activity Plan, sort Micronutrients ideal-first, alphabetize pulled micronutrient JSON, and fix Log Time's Start/End/Break formatting |
| `9eda8ef` | 2.16.1 | Change Log Time's Break field from a plain-minutes number to an HH:mm text input |
| `3bd58d2` | **2.16.0** | Add Ideal/day targets to Micronutrients, a Muscle Group column to the Activity Plan, and fix a protein-decimal and a Break-field bug |
| `747086f` | **2.15.0** | Add a Micronutrients column to Nutrition, a bulk/single-row pull from USDA's full nutrient panel, and a new Health Insight mode built on the real totals |
| `0bd83e4` | **2.14.0** | Color-code Protein's glance tile past its band top, and add a body mass value bubble to the progress bar |
| `a22658b` | 2.13.1 | Shorten the Calculate breakdown's USDA source label to just USDA |
| `3d72cc2` | **2.13.0** | Add a system architecture diagram, a divide-quantity and a protein anchor to Calculate, and mask bed/wake time in privacy mode |
| `6448f78` | **2.12.0** | Give each panel group its own address, and let a transaction move its account's balance |
| `a3e3f33` | **2.11.0** | Add four terms to the Formula Playground, and a BMR equation to choose from |
| `c566df8` | 2.10.1 | Sign the Calorie Balance hover, and name its first row like the other charts |
| `32c6a86` | **2.10.0** | Fold income into the expenditure trend, and make every legend a switch |
| `e1547bf` | **2.9.0** | Add a Breakdown panel and a Tax button, and rename every sheet tab in one place |
| `d3a9f4a` | 2.8.1 | Move "where," onto the variable list, and shorten a Nutrition header |
| `6d5fe5d` | **2.8.0** | Add a fat-loss percentage: a Δm% box, a solve mode and a third pin |
| `b21de44` | 2.7.3 | Show Monthly Income as this month alone |
| `b474b17` | 2.7.2 | Shorten the Contact List heading to Contact |
| `00f3b12` | 2.7.1 | Move Activity below Nutrition in the Health section |
| `1513803` | **2.7.0** | Renew the token before a form opens, and add a Health Plan feasibility insight |
| `4446fce` | **2.6.0** | Cut every panel button to one word, and add a lean-mass protein band to the playground |
| `a30fce0` | **2.5.0** | Pin the activity target by time or calorie burn, add a Protein Sources AI insight mode, and shorten the Work/Travel/Application panel headings |
| `eea4e27` | **2.4.0** | Make the Activities catalogue editable, and give Health Indicators one window |
| `0052148` | **2.3.0** | Merge into an already-logged day instead of refusing the save |
| `6933994` | 2.2.4 | Size the breakdown columns from their content, and merge Source with Save |
| `0064d92` | 2.2.3 | Make date/time inputs honour their width, and tighten the breakdown table |
| `8054fd9` | 2.2.2 | Keep both .form-row columns exactly half wide on a phone |
| `088a1af` | 2.2.1 | Give every single-line form control one height |
| `e35f27e` | **2.2.0** | Read Physique's four totals off tables, and make workout tempo a setting |
| `c5f34bc` | **2.1.0** | Turn the Formula Playground into a solve-for-any-field calculator, and let Physique combine/sort duplicate ingredients |
| `b1d40ed` | 2.0.1 | Unify target/body-mass naming, fix Physique table UI, and merge duplicate ingredient rows |
| `4f9b480` | **2.0.0** | Replace the Health Log with a per-day Physique tab and an Activities catalogue |
| `14edb76` | **1.54.0** | Add an Instruction modal to the Activity Plan |
| `00ae473` | **1.53.0** | Add AI Financial Insight panel; rename Accounts sheet, add Market Value |
| `7671136` | 1.52.3 | Merge spending panels, reorder Historical Trends, drop architecture diagram and emoji |
| `756cd68` | 1.52.2 | Remove dashboard screenshot from README |
| `50e7c7a` | 1.52.1 | Cut the Insight prompts down and halve charts.js's comments |
| `1c78335` | **1.52.0** | Mark each week's average on the Health Indicators charts |
| `6833fb4` | 1.51.2 | Unify the Health Indicators charts, and rewrite the README as bullets |
| `a1cc2e3` | 1.51.1 | Colour buttons by role and show progress on the slow ones |
| `c556d5a` | **1.51.0** | Classify ingredients, log workouts gradually, and tighten mobile layout |
| `6f99647` | 1.50.1 | Rename weight to body mass and drive the forecast from the plan |
| `dc3e05b` | **1.50.0** | Merge the three AI insight panels and curve the weight forecast |
| `6de4577` | 1.49.4 | Remove the Spending Patterns panel |
| `2037d1b` | 1.49.3 | Drop calibration and build the calorie bound from BMR plus activity |
| `3331c84` | 1.49.2 | Make the calibration a smoothed three-term energy model |
| `c538a2d` | 1.49.1 | Drop the note that narrated a working formula toggle |
| `d5c61dd` | **1.49.0** | Give Body Weight its own chart and make the calorie bound per-day |
| `2db2439` | **1.48.0** | Let a food's amount be given as a calorie figure |
| `6b13472` | **1.47.0** | Turn the calorie target into a max or a min, whichever the goal implies |
| `ea506f7` | **1.46.0** | Make the protein target a band scaled off goal weight |
| `8254a70` | 1.45.11 | Widen the calibrated-maintenance guard so the bars can respond again |
| `3fb8590` | 1.45.10 | Stop a noisy calibration from wrecking Calorie Deficit & Fat Loss |
| `9340859` | 1.45.9 | Restore the toggle-sensitive right-axis label on Calorie Deficit |
| `f85c556` | 1.45.8 | Cut the commentary in calibration.js and the new chart axis helper |
| `a68a3cd` | 1.45.7 | Drop the axis title added to Calorie Deficit & Fat Loss |
| `ef149fd` | 1.45.6 | Tighten the Calorie Deficit axis and de-duplicate its right-axis label |
| `5241226` | 1.45.5 | Revert the calibration fit to weighted OLS |
| `f8b231c` | 1.45.4 | Always save the fitted calibration, never substitute the generic value |
| `6c75931` | 1.45.3 | Calibrate over multi-week windows instead of refusing noisy data |
| `4859d8c` | 1.45.2 | Regularize the calibration fit with weighted ridge regression |
| `c064461` | 1.45.1 | Align Activity Plan data-reps with the displayed sets x reps |
| `4e22a51` | **1.45.0** | Add Calorie Deficit & Fat Loss chart, calibrated/generic toggle, Day 5 bodyweight plan |
| `adeecdb` | **1.44.0** | Add Activity Insight AI panel; fix Activity Plan table alignment; make Rest & Recovery axis data-driven; redesign Weight Trend progress meter |
| `b75614b` | **1.43.0** | Replace fixed 7/14/30-day lookback with custom From/To date range on Wellness Insight and Protein Source Rotation; hide landing page feature graphs on mobile |
| `43eb6ae` | 1.42.1 | Change Sleep bed/wake separator to "; " as canonical, "/" as legacy fallback |
| `49d8002` | **1.42.0** | Add Activity; Calories calorie-burn tracking; use it in Weight Trend calibration; align Health Metrics chart widths |
| `d12df95` | **1.41.0** | Match Wellness Insight styling to Food Insight; add optional question box |
| `4e89365` | **1.40.0** | Add Sleep bed/wake entry and redesign Rest & Recovery as a floating-bar chart |
| `5604060` | **1.39.0** | Add plateau alert and Strength Training Plan; fold Time into Other; split gate.js from app.js |
| `1703b0f` | **1.38.0** | Add Protein Source Rotation and Body Composition Change charts; promote Food/Wellness Insight to persistent panels |
| `0ca482f` | **1.37.0** | Redesign landing page as a node graph; add Verified column to Nutrition Facts |
| `5a026ea` | **1.36.0** | Add reusable "pattern" entries to the Health Log |
| `a4a6c80` | 1.35.3 | Format Health Metrics chart x-axis dates as "Jun 29" instead of ISO |
| `a63a2d8` | 1.35.2 | Remove merge_contacts.py, a one-time local tool no longer needed |
| `102c070` | 1.35.1 | Document the Food Insight feature and Health Metrics chart changes in README |
| `4825785` | **1.35.0** | Add Food Insight feature, reflow Health Metrics charts, fix ingredient-matching bugs |
| `36c8134` | **1.34.0** | Add can/clove units, fix Nutrition Facts count-parsing bug, require review before auto-saving new ingredients |
| `16d82c8` | 1.33.1 | Standardize Notes deterministically, persist Calculate breakdown, fix spray/count scaling |
| `ab4ab7d` | **1.33.0** | Add "spray"/"shot" ingredient units, fix a gram weight for shots |
| `ac4e0f6` | 1.32.1 | Stop Calculate from renaming ingredients, show density used, grow Notes field |
| `95aa539` | **1.32.0** | Add a personal Nutrition Facts table for AI calorie estimation, fix eTimeSheet reminder scoping |
| `38b3948` | **1.31.0** | Add a personalized TDEE-based calorie target formula |
| `0f803e0` | 1.30.1 | Truncate long Company names in Work Log table, unify stat tile font size |
| `3b9508c` | **1.30.0** | Add Company field to eTimeSheet and scope overtime/reminder to it |
| `aff02a9` | 1.29.1 | Add category icons and color-coded accents to the landing feature cards |
| `e6c3758` | **1.29.0** | Add Health Log bulk edit, stacked activity chart, and Insight activity breakdown |
| `482079f` | **1.28.0** | Add protein tracking, AI health insight, and merge Journal/Portfolio into Finances |
| `ab8c678` | **1.27.0** | Add calibrated weight forecast, overtime tally, and extend privacy mode app-wide |
| `aee4a68` | 1.26.2 | Stop auto-focusing form fields when any modal opens |
| `ba17acb` | 1.26.1 | Extract shared JS/CSS helpers, add mobile-friendly styling, and speed up dashboard load |
| `60e6037` | **1.26.0** | Add AI-powered calorie calculator to Health Log, fix modal styling |
| `e0d50e2` | **1.25.0** | Add a Settings panel and tune wellness chart layout/styling |
| `23f28df` | **1.24.0** | Add dashboard widgets and reorganize the Journal/Applications panels |
| `cee2164` | **1.23.0** | Add Travel and Applications tracking under a new Other section |
| `ecc1734` | **1.22.0** | Add Contacts tab with bulk export/delete/merge and a source-merge tool |
| `56db6ee` | **1.21.0** | Refresh labels, landing page, and add wellness autocomplete |
| `f44cc1d` | **1.20.0** | Add red dashed target lines to all 4 wellness charts |
| `7c9c340` | 1.19.4 | Cap Weight Trend x-axis ticks to keep chart heights consistent |
| `91e752a` | 1.19.3 | Convert activity units to minutes in chart |
| `f88e1e4` | 1.19.2 | Update Activity default unit to steps, generalize activity chart axis |
| `08c51e7` | 1.19.1 | Fix Wellness Log UI: form styling, chart layout, notes truncation |
| `a3fa60d` | **1.19.0** | Add Wellness Log section with charts, log table, and entry form |
| `346ca89` | 1.18.1 | Build Spending Breakdown by Type panels dynamically from Insight data |
| `2080991` | **1.18.0** | Add consent flag, silent-refresh retry, Time Log pagination; update README |
| `86660b2` | 1.17.4 | Document accessibility improvements and currency-formatted chart axes in README |
| `83602b7` | 1.17.3 | Show currency-formatted y-axis labels on dollar-denominated charts |
| `371c227` | 1.17.2 | Add focus styles, empty-state rows, and modal accessibility; reorder Common panel |
| `0cc6f8b` | 1.17.1 | Proactively refresh the OAuth access token before it expires |
| `b06e644` | **1.17.0** | Reorder Transaction columns, add Common payee/spend charts, Time Sheet live duration, percentage histograms; update README and screenshots |
| `a81b71f` | 1.16.6 | update |
| `42b38b7` | 1.16.5 | update |
| `adeff15` | 1.16.4 | Delete assets/images/architecture-diagram.png |
| `8cca26b` | 1.16.3 | Add files via upload |
| `b128a2a` | 1.16.2 | Drop the (YYYY-MM) date suffix from the Income/Expenses/Net Cash Flow summary card labels |
| `960e497` | 1.16.1 | Make Work Pattern Analysis charts visually consistent, center panel-group titles |
| `1b60730` | **1.16.0** | Add transaction bulk edit, fix bulk-selection bar, round chart axis, layout tweaks |
| `4cbc8a8` | 1.15.1 | Fix Break time saving as a duration multiplied by 1440 |
| `468de10` | **1.15.0** | Add Time Sheet Work Pattern Analysis charts, bulk transaction operations with undo, keyboard shortcuts, and a Time Sheet reminder |
| `04d2364` | **1.14.0** | Add account menu, inline transaction reporting, and a Time Sheet panel |
| `eefeb99` | **1.13.0** | Add CSV export filters, distinct chart colors, and category autocomplete |
| `2f3f4c2` | 1.12.3 | Polish dashboard layout: panel subtitles, animations, merged FABs |
| `24397df` | 1.12.2 | Consolidate chart panels and fix donut tooltip labels |
| `9ba09f2` | 1.12.1 | Remove unhelpful Savings Rate Trend chart |
| `61381e4` | **1.12.0** | Add privacy mode, reconciliation status, and derive categories/benchmarks from Insight |
| `320d8c0` | 1.11.1 | Fix expand/collapse-all FAB label after individual panel toggles |
| `ebda02c` | **1.11.0** | Add dark mode, collapsible panels, and a floating action button stack |
| `9296a8c` | **1.10.0** | Add Payee/Description autocomplete to the transaction form |
| `d63bfa5` | 1.9.2 | Order chart categories/account types by spend, rename trend panels |
| `d46fd0f` | 1.9.1 | Document Insight tab and Spending by Type feature in README |
| `0053b04` | **1.9.0** | Add Spending by Type panel with per-category donut breakdowns |
| `314effe` | 1.8.3 | Remove silent OAuth refresh to fix mobile sign-in popup failures |
| `6eb340c` | 1.8.2 | Fix dynamic category matching to exclude Income/Expenses, derive Saved/Cumulative by position |
| `5119537` | 1.8.1 | Update README for dynamic category columns in Monthly Summary/Benchmarks |
| `0382a1c` | **1.8.0** | Add Account Composition & Savings Rate charts, dynamic categories, and UI fixes |
| `d3b236f` | 1.7.2 | Add dashboard screenshot to README |
| `14b2646` | 1.7.1 | Unify category chart colors/legends, reorder charts, and tighten dashboard layout |
| `4264c46` | **1.7.0** | Narrow layout to 900px, free-text account types, Save & Add Another for transactions, and mobile chart/donut/header fixes |
| `f7cc7f1` | **1.6.0** | Add Spending Breakdown by Category donuts, fix Charts nav anchor and account-type edit bug, refine dashboard terminology |
| `9270cbe` | 1.5.1 | Move social preview and touch icon into assets/images/ |
| `d9b9f1a` | **1.5.0** | Add footer, emoji header icons, SEO/social meta, manifest, and license |
| `765574d` | 1.4.2 | Update README.md |
| `1c2f92f` | 1.4.1 | Remove Overview link from nav and drop its now-unused section id/styles |
| `ec5b8d0` | **1.4.0** | Merge accounts views, add sortable tables, fix chart scaling, refine palette and load performance |
| `3b266f1` | **1.3.0** | Document detailed architecture in README; add manual cache-clear control |
| `addfed9` | **1.2.0** | Add category spending comparison chart, reorder dashboard sections, redesign landing page |
| `e49512c` | **1.1.0** | Reorganize assets into style/script folders, add favicon, persistent login, account/CSV management, and column sorting |
| `d6610f3` | **1.0.0** | Build full Ledger app: auth, dashboard, transactions CRUD, charts, caching, mobile UI |
| `6052303` | 0.1.9 | Trim Categories to Category/Color and remove dangling Group/Budget refs |
| `b2a2832` | 0.1.8 | Simplify Transactions/Accounts schema and align Report with existing formulas |
| `ead7ff9` | 0.1.7 | Refine README with data model analysis and implementation plan |
| `812fa80` | 0.1.6 | Update index.html |
| `3ba4e82` | 0.1.5 | Create index.html |
| `92fd756` | 0.1.4 | Update README.md |
| `d64017d` | 0.1.3 | Update README.md |
| `262f334` | 0.1.2 | Update README.md |
| `e8b8aa9` | 0.1.1 | Update README.md |
| `45a69a0` | **0.1.0** | Initial commit |
