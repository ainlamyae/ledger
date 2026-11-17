# Project structure

[Docs](../README.md) › Development

Every folder and file in the repository, one line each.

## At a glance

- **One page of markup:** `index.html`; the section folders hold copies of a small stub.
- **One stylesheet:** `assets/style/styles.css`.
- **Scripts:** `assets/script/`, named `<section>-<block>[-<part>].js`, plus core files with no prefix.
- **Tools:** `scripts/` holds the local server, the version stamper, the sitemap builder and tests.
- **Docs:** `docs/`, with `guide/`, `reference/` and `development/`.

## Top level

| Path | What it is |
|---|---|
| `index.html` | The page shell: every block, form and modal, the CSP and the script order |
| `health/`, `finance/`, `track/`, `other/` | Section pages; every sub-folder is a block, button or view address holding a stub `index.html` |
| `404.html` | Serves row addresses (`/health/nutrition/<name>/`); one inline script, allowed by hash |
| `sw.js` | Retired service worker: clears old caches and unregisters itself |
| `favicon.svg`, `manifest.json`, `robots.txt`, `sitemap.xml` | Icon, web app manifest, crawler rules, address list |
| `.gitattributes` | Keeps `404.html` and `scripts/hooks/*` LF |
| `assets/style/styles.css` | All styling |
| `assets/images/` | Social preview, touch icon, architecture diagram; `activities/` has one figure per movement |
| `docs/` | This documentation and the generated `changelog.md` |
| `LICENSE`, `README.md` | Licence and landing page |

## Core scripts

| File | Role |
|---|---|
| `motion.js` | Every animation, behind `window.Motion`: page and form moves, toast, confetti, warning pulse |
| `theme-boot.js` | Before first paint on every page: theme and sidebar state |
| `page-boot.js` | Before first paint in `index.html`: Widgets/Bulbs visibility, hub/page classes, old service worker removal |
| `config.js` | `CONFIG`: Client ID, template id, Picker key, tab names |
| `auth.js` | Google sign-in and out, token storage, quiet expiry, `ensureAccessToken` |
| `drive.js` | Template copy link, Picker, chosen spreadsheet id, file name |
| `sheets.js` | Sheets API wrapper: batched reads, 401 renew, 429 backoff, cell helpers, tab creation |
| `cache.js` | Numeric-expression evaluator and **Clear cache** |
| `ui-helpers.js` | Shared table, modal, row-button, busy-button and `safeHref` helpers |
| `ai.js` | Chat client for Groq or OpenRouter, including photo scans |
| `ledger-widgets.js` | Time, Date, Azan and Weather widgets |
| `charts-base.js` | Chart theme, axes, legends, `htmlTooltip`, lazy `upsertChart`, 📤 export |
| `csv.js` | CSV import and export, and the filter engine |
| `gate.js` | Signed-out view, file gate and sign-in state changes |
| `version.js` | `APP_VERSION`, written by `scripts/version.cjs` |
| `app.js` | Boot, `loadDashboard`, summary cards, settings, menus, dark and privacy mode, shortcuts |
| `router.js` | Block, button and row addresses, history steps |
| `page-nav.js` | Hub tiles, breadcrumb and wide-screen sidebar |
| `section-page.js` | Section stubs only: rebuilds `index.html` and shows one group |

## Health scripts

| File | Role |
|---|---|
| `health-math.js` | Pure formulas: BMR, TEF, desired intake, macro bands, trend, projection |
| `health-nutrition-usda.js` | USDA FoodData Central client with full nutrient panels |
| `health-nutrient-desired.js` | Ideal/day micronutrient amounts and gap thresholds |
| `health-nutrition.js` | Nutrition block: table, Group, USDA lookup, merge, Pull Micronutrients |
| `health-physique-estimator.js` | Calculate for food: split, table-first lookup, USDA fallback |
| `health-physique.js` | Physique block: one row per day, form, and the entries every chart reads |
| `health-physique-breakdown.js` | Physique's Calculate, Combine & Sort, Consumption autocomplete |
| `health-activity-catalogue.js` | `Activity` tab catalogue: plan tables, Instruction modal, MET and muscle lookups |
| `health-activity.js` | Activity block: logged-today ticks, Log a Workout |
| `health-activity-estimator.js` | Workout note parsing and MET-based burn |
| `health-chart.js` | Shared Health chart helpers, Today glance tiles, range control |
| `health-chart-body-mass.js` | Body Mass chart |
| `health-chart-intake.js` | Caloric Intake chart |
| `health-chart-protein.js` | Protein chart and the band chart Fiber, Fat and Carbohydrate share |
| `health-chart-fiber.js` | Fiber chart |
| `health-chart-fat.js` | Fat chart |
| `health-chart-carb.js` | Carbohydrate chart |
| `health-chart-activity.js` | Physical Activity chart |
| `health-chart-sleep.js` | Sleep chart |
| `health-chart-projection.js` | State Trend & Forecast chart, progress meters, forecast notes |
| `health-chart-energy-balance.js` | Energy Balance chart |
| `health-chart-safe-pace.js` | Safe Pace chart: weekly loss and deficit against their limits |
| `health-chart-heatmap.js` | Daily Progress heatmap |
| `health-chart-protein-rotation.js` | Protein Source Rotation bars and donut |
| `health-chart-activity-rotation.js` | Activity Rotation bars and donut |
| `health-tune-fields.js` | Tune field definitions and input helpers |
| `health-tune-render.js` | Tune's substituted formulas and section renderers |
| `health-tune.js` | Tune block: solve for any field, BMR switch, save to `Setting` |
| `health-tune-calibration.js` | BMR calibration from logged data |
| `health-insight-wellness.js` | Insight shared helpers and Wellness mode |
| `health-insight-food.js` | Insight Food mode |
| `health-insight-micronutrient.js` | Insight Micronutrient mode |
| `health-insight-activity.js` | Insight Activity mode |
| `health-insight-protein.js` | Insight Protein mode |
| `health-insight-plan.js` | Insight Plan mode |
| `health-insight-pattern.js` | Insight Pattern mode |
| `health-insight.js` | Insight panel: modes, AI call, saved reports |

## Finance scripts

| File | Role |
|---|---|
| `finance-chart.js` | Finance Chart renderers: net worth, category trend, breakdowns, allocation |
| `finance-transaction.js` | Transaction log: filters, sorting, paging, edit, bulk actions |
| `finance-account.js` | Account block, formula-preserving edits, transfers |
| `finance-breakdown.js` | Breakdown block: Category and Type rows |
| `finance-insight.js` | Finance Insight panel and AI call |
| `finance-market-data.js` | Only caller of Twelve Data, Alpha Vantage and Finnhub; IndexedDB cache, rate limits |
| `finance-market-math.js` | Pure indicators, trailing stop, risk measures, verdict, alerts |
| `finance-portfolio-math.js` | Pure average-cost holdings and daily portfolio series |
| `finance-market-chart.js` | Range buttons and price/gain line charts |
| `finance-watchlist.js` | Watch List block and alerts |
| `finance-portfolio.js` | Portfolio block: trades, holdings, gain charts, Market Value write |
| `finance-market.js` | Market block: chart, signals, news, AI read, Analysis history |

## Track and Other scripts

| File | Role |
|---|---|
| `track-work-time.js` | Work Time block, missed-day detection, reminder |
| `track-work-time-chart.js` | Work Time charts |
| `track-car-service.js` | Car Service block: odometer fit and next services |
| `track-travel.js` | Travel block |
| `track-travel-chart.js` | Travel charts and the world map |
| `track-application.js` | Applications cards |
| `track-leetcode.js` | LeetCode block: solves, progress, heatmap, roadmap, Cheat Sheet |
| `track-leetcode-roadmap.js` | NeetCode 250 list, videos and roadmap graph (data only) |
| `track-leetcode-cheatsheet.js` | Cheat Sheet Python constructs (data only) |
| `other-contact.js` | Contacts block |
| `other-settings.js` | Settings block, key suggestions, masking, `saveSettingValues` |

## `scripts/`

| File | Role |
|---|---|
| `serve.py` | Local server with GitHub Pages' `404.html` fallback: `python scripts/serve.py 8000` |
| `dev-server.py` | Older fallback server on port 8000; `serve.py` replaces it |
| `version.cjs` | Version from commit messages; writes `version.js` and `docs/changelog.md` |
| `hooks/post-commit` | Runs `version.cjs --hook` after each commit |
| `hooks/commit-msg` | Strips trailer and attribution lines from commit messages |
| `build_sitemap.py` | Writes `sitemap.xml` from the stub folders |
| `build_template.py` | Builds a demo-data template workbook from a local export |
| `test_market_math.mjs` | Node tests for `finance-market-math.js` |
| `test_portfolio_math.mjs` | Node tests for `finance-portfolio-math.js` |

## Related

- [Architecture](architecture.md): system, section pages, boot order, modules, tech stack.
- [Versioning](versioning.md): version stamping, hooks and the changelog.
- [Getting started](getting-started.md): template sheet, Google Cloud, `config.js`, local server, API keys.
- [Site map](../reference/site-map.md): every address and its breadcrumb.
