# Project Structure

[← Back to README](../README.md)

```text
ledger/
├── index.html                    # Page shell: dashboard, file-gate, modals, footer
├── health/index.html             # One-group pages: identical stubs, no markup of
├── finance/index.html            #   their own — section-page.js builds each from
├── track/index.html              #   index.html and shows that group alone
├── other/index.html              #
├── <group>/<block>/[<button>/]index.html # Copies of the stub above, one per address (see router.js),
│                                 #   e.g. track/leetcode/ and track/leetcode/log/
├── favicon.svg · manifest.json · robots.txt · sitemap.xml
├── sw.js                         # Retired service worker: clears old caches, unregisters itself
├── assets/
│   ├── images/                   # Social preview, touch icon
│   │   └── activities/            # One figure per movement — animated .gif or two-position .jpg
│   ├── style/styles.css          # All styling
│   └── script/
│       ├── config.js             # Client ID, template ID, Picker key, sheet names
│       ├── auth.js               # Sign-in/out, token storage, silent refresh
│       ├── drive.js              # Template copy link, Picker, active-file storage
│       ├── sheets.js             # Sheets API wrapper
│       ├── cache.js              # Numeric-expression evaluator; clears old cache keys
│       ├── ui-helpers.js         # Shared table/modal/busy-button helpers
│       ├── ai.js                 # AI chat client (Groq or OpenRouter)
│       ├── health-nutrition-usda.js               # USDA FoodData Central client
│       ├── health-nutrient-desired.js   # Ideal/day desired figures for Micronutrient mode
│       ├── health-nutrition.js          # Nutrition table, Group, USDA lookup
│       ├── health-physique-estimator.js  # Calculate for food
│       ├── health-activity-estimator.js # Calculate for workouts
│       ├── ledger-widgets.js            # Time / Date / Azan / Weather bulbs
│       ├── charts-base.js        # Shared chart theming/axis/legend helpers, htmlTooltip + upsertChart
│       ├── confetti.js           # Confetti burst for body-mass progress and income saves; warnWithPulse (red pulse + shake) for a day short of the desired deficit
│       ├── health-math.js      # Pure health/desired-figure formulas (BMR, TEF, projection, …)
│       ├── health-chart.js    # Chart renderers
│       ├── finance-chart.js     # Finance Chart renderers
│       ├── finance-market-data.js        # Stock prices/news: Twelve Data, Alpha Vantage, Finnhub; IndexedDB cache, rate limits
│       ├── finance-market-math.js        # Indicators, trailing stop, risk measures and the verdict (pure)
│       ├── finance-portfolio-math.js     # Average-cost holdings and gain series (pure)
│       ├── finance-market-chart.js      # Range buttons and price/gain line charts
│       ├── finance-watchlist.js             # Finance Watch List page (Watchlist tab)
│       ├── finance-portfolio.js          # Finance Portfolio page (Trade tab)
│       ├── finance-market.js     # Finance Market page: picker, chart, signals, news, AI read with Chart history (Analysis tab)
│       ├── track-work-time-chart.js   # Work Time chart renderers
│       ├── track-travel-chart.js      # Travel chart renderers (incl. world map)
│       ├── finance-transaction.js       # Transaction Log
│       ├── track-car-service.js        # Car Service block: odometer fit + predicted services
│       ├── finance-account.js           # Account panel
│       ├── finance-breakdown.js          # Breakdown panel (Category/Type rows, formula-safe)
│       ├── track-work-time.js          # Work panel + analytics data
│       ├── csv.js                # CSV import/export + filter engine
│       ├── health-physique.js           # Physique (one row per day)
│       ├── health-physique-breakdown.js # Physique's Calculate + Consumption autocomplete
│       ├── health-activity.js      # Activity Plan
│       ├── other-contact.js           # Contact panel
│       ├── other-settings.js     # Settings table
│       ├── track-travel.js             # Travel panel
│       ├── track-application.js       # Applications cards
│       ├── track-leetcode.js           # LeetCode roadmap and solve log
│       ├── track-leetcode-roadmap.js   # NeetCode 250 problem list
│       ├── health-insight-wellness.js            # Insight shared helpers + Wellness mode
│       ├── health-insight-food.js       # Insight Food mode
│       ├── health-insight-micronutrient.js # Insight Micronutrient mode
│       ├── health-insight-activity.js   # Insight Activity mode
│       ├── health-insight-protein.js # Insight Protein mode
│       ├── health-insight-plan.js       # Insight Plan mode
│       ├── health-insight-pattern.js # Insight Pattern mode
│       ├── health-insight.js      # Insight panel shell
│       ├── health-chart-protein-rotation.js   # Protein Source Rotation
│       ├── health-chart-heatmap.js   # Health Chart's Daily Progress heatmap
│       ├── health-tune-fields.js     # Tune field descriptors + input utils
│       ├── health-tune-render.js     # Tune substituted-formula renderers
│       ├── health-tune.js # Tune block lifecycle
│       ├── health-tune-calibration.js    # BMR calibration — back-solves BMR_cal from logged data (Tune)
│       ├── finance-insight.js  # Finance Insight panel
│       ├── gate.js               # Pre-login flow
│       ├── version.js            # APP_VERSION, written by scripts/version.cjs (post-commit hook)
│       ├── app.js                # Orchestration
│       ├── router.js             # Block/button/row addresses (<group>/<block>/<button or row>/)
│       ├── page-nav.js           # Section hub tiles, page breadcrumb, wide-screen sidebar
│       └── section-page.js       # Loaded only by the section stubs above
├── scripts/
│   ├── hooks/post-commit              # Stamps version.js and rewrites docs/changelog.md (see docs/versioning.md)
│   ├── hooks/commit-msg               # Strips co-author and attribution lines
│   ├── version.cjs                    # Conventional Commits → version (feat = minor, fix = patch)
│   ├── build_template.py              # Scrubbed demo workbook for the Sheets template
│   ├── serve.py                       # Local server with GitHub Pages' 404.html fallback
│   └── build_sitemap.py               # sitemap.xml from the address stub folders
├── docs/                         # Reference docs; features/ holds one file per section
├── 404.html                      # Fallback page: row Edit addresses (see router.js)
├── LICENSE
└── README.md
```

---

