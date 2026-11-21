# Changelog

[← Back to README](../README.md)

Every commit, newest first, with the version it produced (see [Versioning](development/versioning.md)); major and minor releases in bold. Rewritten on every commit by the post-commit hook (`scripts/version.cjs`); the newest row reads *(this commit)* until the next commit fills in its id.

| Commit | Version | Changes |
|---|---|---|
| (this commit) | **3.46.0** | feat(forms): turn Transfer's Pay Off, Work Time's Holiday and Physique's Pattern ticks into buttons |
| `6458fc7` | 3.45.1 | fix(physique): make Consumption the reference for Calculate, put selection buttons beside the header's, and refactor the touched files Calculate: - A typed weight ("5g Coffee") is the amount eaten, never the AI's guess. - A unit the Nutrition Amount names counts servings ("2 cup Coffee" on   "5g (1cup)" is 10 g, not 480 g). - Reused Breakdown rows take the Consumption line's amount; rows from   Nutrition are repriced from the sheet as it is now, so an edited food   (Coffee 0 -> 2 kcal) updates every recalculated day. |
| `e81068c` | **3.45.0** | feat(nav): replace Other with a Settings section at /setting/ and colour Watch List as a chart |
| `a6478d6` | **3.44.0** | feat(nav): move Contact under Track, order hub tiles, and give every dated chart one x axis |
| `c4dfda4` | **3.43.0** | feat(finance): build every chart from Transaction, shorten displayed years, and refactor the touched files |
| `b0e22ba` | 3.42.2 | style(physique): gray the Consumption Breakdown's Amount column so it doesn't read as calories |
| `0f1200f` | 3.42.1 | fix(forms): parse number fields without eval so the CSP stops rejecting every value |
| `0fe0a3e` | **3.42.0** | feat(security): add a Content-Security-Policy, pin CDN libraries and rewrite the docs |
| `d02f0ff` | 3.41.2 | fix(sheets): make every Google Sheets read and write safe and consistent |
| `51aaeed` | 3.41.1 | refactor: tidy every script, the stylesheet and index.html, and fix eleven bugs |
| `b4b0c8f` | **3.41.0** | feat(health): seed Tune's τ/s/f from logged history, unify the healthy BMI band, and consolidate the intake charts |
| `a649c61` | **3.40.0** | feat(health): add body-shape checks to tune and stop unasked sign-in popups |
| `f5ecb39` | **3.39.0** | feat(health): add safe pace chart, daily supplements and micronutrient gaps |
| `0062da2` | **3.38.0** | feat(physique): multiply consumption groups and add quick bulk duplicate |
| `1076b97` | 3.37.1 | fix(physique): give USDA and AI-priced breakdown rows a TEF |
| `6fbf2c1` | **3.37.0** | feat(physique): add a micronutrients page and site map |
| `d61fd9b` | **3.36.0** | feat(motion): reduce navigation to vertical and sideways slides |
| `03e40a0` | **3.35.0** | feat(physique): sum amounts in the consumption total row |
| `1a4bc1f` | **3.34.0** | feat(insight): show insight data and AI replies in cards |
| `489f641` | **3.33.0** | feat(ui): place every table in a titled card |
| `a4414ed` | **3.32.0** | feat(motion): centralise animations and split heatmap by month |
| `1ca2f30` | **3.31.0** | feat(motion): rebuild motion on spring physics |
| `d19971c` | **3.30.0** | feat(motion): add opener-aware motion and unified toast messages |
| `9e64b08` | **3.29.0** | feat(leetcode): add a printable Python cheat sheet |
| `6792674` | **3.28.0** | feat(nutrition): list top USDA matches when completing a food |
| `c0532d5` | **3.27.0** | feat(charts): show dates in heatmap cells and grade TEF by goal |
| `b0c0ef6` | **3.26.0** | feat(charts): smooth averages over L_p and redesign leetcode heatmap |
| `23d30d5` | **3.25.0** | feat(charts): simplify body mass dots and use an L_p-day trend |
| `5e0c6c2` | **3.24.0** | feat(leetcode): add video links, durations and watch progress |
| `939b4d5` | **3.23.0** | feat(physique): reorganise the form into labelled cards |
| `1eabba7` | **3.22.0** | feat(charts): start the calorie trend at an averaged baseline |
| `9783edb` | **3.21.0** | feat(charts): blend grade colours and add leetcode daily badge |
| `4889e79` | **3.20.0** | feat(charts): add daily progress heatmap and five-step grading |
| `545b8e9` | **3.19.0** | feat(physique): add remain column and colour-coded derived amounts |
| `336175e` | **3.18.0** | feat(physique): show selected BMR, macro rows and M in derived table |
| `fba760d` | 3.17.1 | fix(tune): compute the BMR_avg ratio from today's figures |
| `6295120` | **3.17.0** | feat(leetcode): add progress card and responsive heatmap |
| `838020d` | **3.16.0** | feat(charts): render chart tooltips over the page |
| `6692857` | **3.15.0** | feat(charts): add intake chart and optional detail charts |
| `88ef559` | **3.14.0** | feat(charts): export health and finance charts as PNG |
| `abbdc66` | **3.13.0** | feat(charts): refit health chart axes to visible legend entries |
| `9881a46` | **3.12.0** | feat(tune): add BMR_avg basis and tidy settings and action buttons |
| `6fdb621` | **3.11.0** | feat(health): adopt section-page naming and add chart legends |
| `5111d62` | **3.10.0** | feat(nav): hide breakdown from tiles and title-case workout names |
| `fd001fe` | **3.9.0** | feat(tune): add navy body-fat and lean body mass choice |
| `ae8927e` | **3.8.0** | feat(nav): open contact and settings from the account menu |
| `b9c57cf` | **3.7.0** | feat(activity): price new workout exercises with ai |
| `a140397` | **3.6.0** | feat(nav): let the sidebar hide and colour-code hub tiles |
| `8ea7e84` | **3.5.0** | feat(leetcode): add track leetcode page with neetcode roadmap |
| `20a9c80` | **3.4.0** | feat(versioning): generate a changelog and count versions from 0.0.0 |
| `7462f3a` | **3.3.0** | feat(versioning): derive app version from conventional commits |
| `e94e0aa` | **3.2.0** | feat(widgets): show sunrise and sunset in the weather widget |
| `c414203` | **3.1.0** | feat(charts): replace date pickers with range buttons |
| `47ef8b8` | **3.0.0** | feat(market)!: add watch list, market and portfolio pages |
| `5145062` | **2.86.0** | feat(activity): merge activity plan into one table with day badges |
| `fa8983e` | **2.85.0** | feat(insight): add ai provider switch and stale-day badges |
| `e30c302` | **2.84.0** | feat(tune): lay tune out as four cards with one bmr choice |
| `7482242` | **2.83.0** | feat(activity): rename gym to workouts with cardio and neat |
| `49796ef` | 2.82.1 | style(ui): rework footer credit and tune body text size |
| `b6f1d28` | **2.82.0** | feat(track): add track section and apple-style glass look |
| `b7a8262` | **2.81.0** | feat(finance): fire confetti on saving an income transaction |
| `0dc344b` | **2.80.0** | feat(nutrition): add group field, grams-first amounts and group rotation |
| `074bfcc` | **2.79.0** | feat(physique): add collapsible derived table and calibration ramp-up |
| `05adada` | **2.78.0** | feat(ui): show app version in footer and fire confetti on save |
| `b8dd2ae` | **2.77.0** | feat(physique): add body-mass confetti and rename bmr column to derived |
| `dbc13b6` | 2.76.3 | style(ui): show widgets as cards with one gap on the home page |
| `9176074` | 2.76.2 | style(ui): use one font family and show charts as cards |
| `4ac1954` | 2.76.1 | fix(ui): let tables size to content and stop ios auto-zoom |
| `9211802` | **2.76.0** | feat(activity): add gym page with quick logging and unify styles |
| `ea8f559` | **2.75.0** | feat(finance): add cumulative net worth glance card |
| `513293d` | 2.74.3 | refactor(settings): keep a single settings page under other |
| `1e31df5` | 2.74.2 | fix(physique): store daily mass change in kg/day |
| `8dd3510` | 2.74.1 | refactor(physique): store body-mass figures in the bmr cell |
| `0cfe3de` | **2.74.0** | feat(physique): store daily mass metrics and the glycogen swing |
| `e044f04` | 2.73.4 | fix(ui): pin date/time values left on iOS and add a phone footer strip |
| `6df873f` | 2.73.3 | fix(ui): left-align form date and time values; revert footer clearance |
| `9b813cf` | 2.73.2 | fix(health): merge m and m̄ into one Status row and tidy logged rows |
| `bdc28ab` | 2.73.1 | fix(ui): fit short pages to the screen and simplify logged Activity rows |
| `efd1d31` | **2.73.0** | feat(physique): suggest exercise names while typing a Workout |
| `594ea2b` | 2.72.2 | fix(nav): put page actions at the top and stop breadcrumb slug flashes |
| `39a8ba4` | 2.72.1 | style(ui): even out phone bar spacing and fit ingredient columns to text |
| `97d7976` | **2.72.0** | feat(car): predict winter changeover on 1 Dec; set hub layout pre-paint |
| `0b21792` | **2.71.0** | feat(nav): add a Ledger tab to the phone tab bar |
| `c392fae` | **2.70.0** | feat(ui): add Hide bulbs toggle and lift phone bars above home indicator |
| `792082e` | 2.69.1 | style(ui): float phone bottom bars as pills and keep emoji buttons white |
| `0f44715` | **2.69.0** | feat(ui): add emoji action buttons, tile badges and forms that stay open |
| `a8691f3` | **2.68.0** | feat(ui): make every form a page, drop the top bar, limit text colours |
| `70c4097` | 2.67.1 | fix(nav): root breadcrumbs at Ledger and link every parent level |
| `7cc473b` | **2.67.0** | feat(nav): use one phone bottom bar per page with a close button |
| `7a3baf0` | 2.66.1 | style(health): make Today the first hub tile and tidy Settings tables |
| `eee29d2` | **2.66.0** | feat(health): add Today and Log shortcuts to the Health hub |
| `bb44394` | **2.65.0** | feat(nav): style form pages like block pages and make home tile overview |
| `0ec06d7` | **2.64.0** | feat(nav): open forms as pages and rename Finance Indicator and Insight |
| `b8336b4` | **2.63.0** | feat(nav): split sections into hubs and pages with a wide-screen sidebar |
| `33b3e29` | **2.62.0** | feat(sheets): batch Sheets reads, share the tab list and add Clear cache |
| `7767586` | **2.61.0** | feat(settings): add Health Settings and read values from their sheets |
| `da3c812` | **2.60.0** | feat(nutrition): order nutrients like Nutrition Facts, rename modes |
| `5b61f60` | 2.59.2 | fix(pwa): retire the service worker and sheet cache; smooth m̄ over L_p |
| `e9dce80` | 2.59.1 | style(health): match Progress text to Status and stop iOS text inflation |
| `e9597e7` | **2.59.0** | feat(health): add a Progress card to the health glance |
| `dcd7590` | **2.58.0** | feat(physique): give Pattern rows micronutrients and pattern-N addresses |
| `c289027` | **2.57.0** | feat(nutrition): use standard units and refine the ingredient form |
| `2573145` | **2.56.0** | feat(nutrition): add ingredient lock table, row addresses and prompts |
| `5f95680` | **2.55.0** | feat(tune): add equations and calculation dropdowns |
| `bdb800f` | **2.54.0** | feat(car): add a car service reminder flag and daily notification |
| `9b8f2cf` | **2.53.0** | feat(car): add a car service block with history and predictions |
| `f37d87a` | **2.52.0** | feat(nav): give every block and form its own address |
| `342db77` | **2.51.0** | feat(ui): make forms full-screen on mobile and update balances on edit |
| `855b82e` | **2.50.0** | feat(health): add block visibility toggle and catalogue propagation |
| `65978f8` | **2.49.0** | feat(insight): make the patterns period length editable |
| `8220ae2` | **2.48.0** | feat(insight): add a patterns mode to health insight |
| `f0171ad` | **2.47.0** | feat(tune): add bmr calibration and a bmr_cal basis |
| `b250a34` | **2.46.0** | feat(charts): replace weekly-bucket trends with a continuous ema |
| `7165a4a` | **2.45.0** | feat(ui): overhaul the mobile layout with a bottom nav |
| `8e3edbf` | **2.44.0** | feat(health): add a log button to the activity modal |
| `68ea409` | **2.43.0** | feat(health): add raw body mass to status and mask secrets in settings |
| `0b2940f` | **2.42.0** | feat(health): add activity rotation chart and hide-widgets toggle |
| `4570a50` | 2.41.1 | fix(health): correct delta-m sign and keep status bento two columns |
| `24dee0b` | **2.41.0** | feat(tune): add a bmr/bmr_adp basis toggle and status bento layout |
| `e068039` | **2.40.0** | feat(health): rebuild status card as an energy-budget ledger |
| `4059e92` | **2.39.0** | feat(nutrition): add normalize and capitalize names actions |
| `e5b2221` | **2.38.0** | feat(tune): align formula playground notation with the model reference |
| `75f6639` | **2.37.0** | feat(finance): add account transfers and split the readme into docs |
| `d367fd4` | **2.36.0** | feat(health): redesign status card and add sleep deprivation readouts |
| `882570b` | **2.35.0** | feat(health): model sleep deprivation's effect on fat loss |
| `d87202e` | **2.34.0** | feat(health): redesign glance cards and add a per-day bmr marker |
| `c6d8d1a` | **2.33.0** | feat(ui): show dashboard before sign-in and split large modules |
| `890f3ef` | **2.32.0** | feat(health): add carbohydrate intake band and fix insight formatting |
| `5fe9f37` | **2.31.0** | feat(physique): add today button and turn home page into a summary |
| `a9e1cc5` | **2.30.0** | feat(physique): add desired rows and a consumption divisor syntax |
| `a76377e` | **2.29.0** | feat(physique): add food-photo scan and directional reconciliation flag |
| `783245e` | **2.28.0** | feat(physique): suggest ingredient names while typing consumption |
| `44fb0cd` | **2.27.0** | feat(health): add fat intake chart and rename rest & recovery to sleep |
| `16724d1` | **2.26.0** | feat(nutrition): log selected ingredients to today's physique |
| `5eab558` | **2.25.0** | feat(tune): add fiber and fat bands and multi-macro consumption anchors |
| `b9a5d7a` | **2.24.0** | feat(nutrition): unify USDA lookup into one micronutrients pull |
| `46982d7` | **2.23.0** | feat(nutrition): add fiber, fat and carbohydrate columns |
| `e6c9040` | **2.22.0** | feat(insight): add a per-ingredient TEF column to food insight |
| `c09e487` | **2.21.0** | feat(physique): add a per-day TEF column and speed up first paint |
| `7042f98` | **2.20.0** | feat(charts): add the smoothed trend and swing zone to body mass |
| `c50298d` | **2.19.0** | feat(physique): add a per-day micronutrients view |
| `0ee3177` | **2.18.0** | feat(health): account for glycogen swing in scoring and forecast |
| `a8eb762` | **2.17.0** | feat(nutrition): add a reference ring to the protein rotation donut |
| `25568e3` | **2.16.0** | feat(tune): add a glycogen and water swing to the formula playground |
| `e174c35` | **2.15.0** | feat(health): add an activity weight column and sort micronutrients |
| `ae7135a` | **2.14.0** | feat(nutrition): add daily reference values to micronutrients |
| `bc8c718` | **2.13.0** | feat(nutrition): pull USDA micronutrients and add a matching insight |
| `efb6734` | **2.12.0** | feat(health): grade protein overshoot, show body mass on progress bar |
| `8c5250b` | **2.11.0** | feat(physique): add division and protein anchors to calculate |
| `e1544ce` | **2.10.0** | feat(nav): give each section its own page, link transactions to balances |
| `346b554` | **2.9.0** | feat(charts): fold income into the expenditure trend and toggle legends |
| `0953d80` | **2.8.0** | feat(finance): add a breakdown panel and a tax button, rename sheet tabs |
| `c7730a9` | **2.7.0** | feat(tune): add a weekly fat-loss percentage with solve mode and pin |
| `7c74c95` | 2.6.1 | refactor(ui): move activity below nutrition and shorten contact heading |
| `dd6acf1` | **2.6.0** | feat(auth): renew the token before forms open, add a plan insight |
| `65057a6` | **2.5.0** | feat(tune): add a lean-mass protein band and one-word panel buttons |
| `015ddb7` | **2.4.0** | feat(health): pin activity by time or burn, add protein sources insight |
| `899477b` | **2.3.0** | feat(health): make the activities catalogue editable in the app |
| `68439b5` | **2.2.0** | feat(physique): merge saves into an already-logged day |
| `1cc9c20` | **2.1.0** | feat(tune): solve the formula playground for any field |
| `9926d32` | **2.0.0** | feat(physique)!: replace the health log with a per-day physique sheet |
| `feaace2` | **1.50.0** | feat(health): add an exercise instruction modal to the activity plan |
| `78645fe` | **1.49.0** | feat(finance): add AI financial insight panel and account market value |
| `58b48f1` | **1.48.0** | feat(charts): mark weekly averages on the health indicator charts |
| `1c2e98b` | 1.47.1 | style(ui): colour buttons by role and unify health indicator charts |
| `86e7402` | **1.47.0** | feat(health): classify ingredients and drive the forecast from the plan |
| `16aa799` | **1.46.0** | feat(insight): merge the AI panels and curve the body weight forecast |
| `d363066` | 1.45.1 | refactor(health): drop calibration and base the calorie bound on BMR |
| `c78102d` | **1.45.0** | feat(health): add a body weight chart and a per-day calorie bound |
| `ba76783` | **1.44.0** | feat(nutrition): accept a food amount given as calories or kilojoules |
| `4b4432f` | **1.43.0** | feat(health): treat the calorie figure as a max or min based on the goal |
| `c1ab6bd` | **1.42.0** | feat(health): make desired protein a band scaled off desired weight |
| `ce34cb2` | 1.41.3 | fix(health): restore weighted OLS calibration and tighten deficit axis |
| `3601364` | 1.41.2 | fix(health): calibrate over multi-week windows and keep fitted values |
| `43bc37a` | 1.41.1 | fix(health): regularize the calibration fit with weighted ridge |
| `4df1c9b` | **1.41.0** | feat(health): add a calorie deficit chart and calibrated/generic toggle |
| `aa29009` | **1.40.0** | feat(insight): add an activity insight panel with muscle group volume |
| `4ee8a7e` | **1.39.0** | feat(insight): replace fixed lookbacks with custom date ranges |
| `4c28883` | **1.38.0** | feat(health): track activity calorie burn and use it in calibration |
| `9355900` | **1.37.0** | feat(insight): add an optional question box to wellness insight |
| `3cdf1ac` | **1.36.0** | feat(health): add sleep bed/wake times, plateau alert and training plan |
| `5b9da54` | **1.35.0** | feat(health): add protein source rotation and body composition charts |
| `f2d0308` | **1.34.0** | feat(health): add reusable log patterns and a node graph landing page |
| `98d3eaa` | **1.33.0** | feat(nutrition): add a food insight panel and reflow health charts |
| `6ef8c84` | **1.32.0** | feat(nutrition): persist calculation breakdowns and standardize notes |
| `3a36c4c` | **1.31.0** | feat(nutrition): keep typed ingredient names, add spray and shot units |
| `f4d1118` | **1.30.0** | feat(nutrition): add a personal nutrition facts table for calculations |
| `4eb5045` | **1.29.0** | feat(health): calculate desired calories from a personalized TDEE |
| `978c29e` | **1.28.0** | feat(health): add bulk edit, stacked activity chart and work log company |
| `3f33ede` | **1.27.0** | feat(health): add protein tracking and an AI health insight report |
| `1bbfdc8` | **1.26.0** | feat(health): add a calibrated body weight forecast and overtime tally |
| `6c54cfb` | **1.25.0** | feat(health): add an AI calorie calculator and extract shared ui helpers |
| `1397629` | **1.24.0** | feat(settings): add an in-app settings panel and rework wellness charts |
| `e9e06f1` | **1.23.0** | feat(ui): add dashboard widgets and reorganize Journal and Applications |
| `a461117` | **1.22.0** | feat(travel): add Travel and Applications tracking in an Other section |
| `b7d5eef` | **1.21.0** | feat(contacts): add a Contacts tab with bulk export, delete and merge |
| `ef61fd6` | **1.20.0** | feat(health): refine Wellness Log charts and add entry autocomplete |
| `deb91b4` | **1.19.0** | feat(health): add a Wellness Log with charts, table and entry form |
| `bd9df4e` | **1.18.0** | feat(charts): build Spending Breakdown by Type panels from Insight data |
| `bc7b1ad` | 1.17.1 | fix(ui): improve keyboard accessibility and format currency axes |
| `7be8920` | **1.17.0** | feat(charts): add common payee and spend charts, refresh tokens early |
| `97f199f` | 1.16.1 | style(finance): drop the month suffix from summary card labels |
| `653e820` | **1.16.0** | feat(finance): add bulk edit for selected transactions |
| `db0ebbf` | **1.15.0** | feat(worktime): add work pattern charts, bulk delete undo and shortcuts |
| `15ee856` | **1.14.0** | feat(auth): add per-user spreadsheets, account menu and Time Sheet |
| `cbe6acc` | **1.13.0** | feat(finance): add filtered CSV export and category autocomplete |
| `282cff6` | 1.12.1 | refactor(charts): consolidate chart panels and fix donut tooltips |
| `f177a73` | **1.12.0** | feat(finance): add privacy mode, reconciliation status and Insight data |
| `e6823e2` | **1.11.0** | feat(ui): add dark mode, collapsible panels and a floating button stack |
| `849bbec` | **1.10.0** | feat(finance): add payee and description autocomplete to transactions |
| `9fdecc8` | **1.9.0** | feat(charts): add a Spending by Type panel from the Insight sheet |
| `c347b02` | **1.8.0** | feat(charts): add account composition and savings rate charts |
| `9457586` | **1.7.0** | feat(finance): add Save & Add Another and free-text account types |
| `dcb8d6d` | **1.6.0** | feat(charts): add spending breakdown donuts per benchmark period |
| `82ddb01` | **1.5.0** | feat(pwa): add footer, web manifest, SEO metadata and license |
| `dcbd1ec` | **1.4.0** | feat(finance): merge account views and read benchmarks from the sheet |
| `14080ea` | **1.3.0** | feat(settings): add a Clear Cache button that reloads the latest app |
| `843bde9` | **1.2.0** | feat(charts): compare category spending against recent averages |
| `5c0f536` | **1.1.0** | feat(finance): add account management, CSV import/export and sorting |
| `846bb50` | **1.0.0** | feat(app)!: build the live Ledger app on Google Sheets |
| `5766aeb` | 0.1.2 | docs(readme): add a static dashboard mockup and Sheets data model plan |
| `6169f25` | 0.1.1 | docs(readme): point the project name and site URL at ledger |
| `81ea43a` | **0.1.0** | feat(docs): start Ledger with a README describing the planned app |
