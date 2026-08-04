# Project Structure

[← Back to README](../README.md)

```text
ledger/
├── index.html                    # Page shell: dashboard, file-gate, modals, footer
├── health/index.html             # One-group pages: identical stubs, no markup of
├── finance/index.html            #   their own — section-page.js builds each from
├── other/index.html              #   index.html and shows that group alone
├── favicon.svg · manifest.json · robots.txt · sitemap.xml
├── sw.js                         # App-shell offline cache (never live sheet data)
├── assets/
│   ├── images/                   # Social preview, touch icon
│   │   └── activities/            # One figure per movement — animated .gif or two-position .jpg
│   ├── style/styles.css          # All styling
│   └── script/
│       ├── config.js             # Client ID, template ID, Picker key, sheet names
│       ├── auth.js               # Sign-in/out, token storage, silent refresh
│       ├── drive.js              # Template copy link, Picker, active-file storage
│       ├── sheets.js             # Sheets API wrapper
│       ├── cache.js              # localStorage cache + hard refresh
│       ├── ui-helpers.js         # Shared table/modal/busy-button helpers
│       ├── groq.js               # Groq chat client
│       ├── usda.js               # USDA FoodData Central client
│       ├── nutrient-targets.js   # Ideal/day targets for Micronutrients mode
│       ├── nutrition.js          # Nutrition table, Classification, USDA lookup
│       ├── calorie-estimator.js  # Calculate for food
│       ├── activity-estimator.js # Calculate for workouts
│       ├── widgets.js            # Time / Date / Azan / Weather bulbs
│       ├── charts-base.js        # Shared chart theming/axis/legend helpers + upsertChart
│       ├── wellness-math.js      # Pure health/target formulas (BMR, TEF, projection, …)
│       ├── wellness-charts.js    # Health Indicator chart renderers
│       ├── finance-charts.js     # Financial Indicator chart renderers
│       ├── timesheet-charts.js   # Work Time chart renderers
│       ├── travel-charts.js      # Travel chart renderers (incl. world map)
│       ├── transactions.js       # Transaction Log
│       ├── accounts.js           # Account panel
│       ├── breakdown.js          # Breakdown panel (Category/Type rows, formula-safe)
│       ├── timesheet.js          # Work panel + analytics data
│       ├── csv.js                # CSV import/export + filter engine
│       ├── physique.js           # Physique (one row per day)
│       ├── physique-breakdown.js # Physique's Calculate + Consumption autocomplete
│       ├── strength-plan.js      # Activity Plan
│       ├── contacts.js           # Contact panel
│       ├── settings-panel.js     # Settings table
│       ├── travel.js             # Travel panel
│       ├── applications.js       # Applications cards
│       ├── insight.js            # Insight shared helpers + Wellness mode
│       ├── food-insight.js       # Insight Food mode
│       ├── micronutrient-insight.js # Insight Micronutrients mode
│       ├── activity-insight.js   # Insight Activity mode
│       ├── protein-source-rotation-insight.js # Insight Protein Sources mode
│       ├── plan-insight.js       # Insight Health Plan mode
│       ├── insight-panel.js      # Insight panel shell
│       ├── protein-rotation.js   # Protein Source Rotation
│       ├── formula-fields.js     # Formula Playground field descriptors + input utils
│       ├── formula-render.js     # Formula Playground substituted-formula renderers
│       ├── formula-playground.js # Health Formula Playground modal lifecycle
│       ├── financial-insight.js  # Financial Insight panel
│       ├── gate.js               # Pre-login flow
│       ├── app.js                # Orchestration
│       └── section-page.js       # Loaded only by the section stubs above
├── scripts/
│   ├── build_template.py              # Scrubbed demo workbook for the Sheets template
│   ├── fetch_activity_images.mjs      # Still exercise guides → assets/images/activities
│   └── fetch_activity_animations.mjs  # Animated exercise loops → assets/images/activities
├── LICENSE
└── README.md
```

---

