# Ledger

A private, serverless personal life dashboard — health, finances, time tracking, travel, applications, and contacts in one place.

- Reads and writes **directly to a Google Sheet you own**. No backend, no database, no third-party data store.
- Public on GitHub Pages, usable by anyone with a Google account.
- Each user clones their own copy of the template; the app only ever touches that copy.
- Scoped via Google Drive's per-file `drive.file` permission — data is visible only to the account owning that sheet.

## Documentation

- [Overview](#overview) — what this is and how it's built.
- [Features](docs/features.md) — every panel, chart and interaction, section by section (Dashboard widgets, Layout, Finance, Breakdown, Time Tracker, Health).
- [Architecture](docs/architecture.md) — system diagram, section pages, request flowchart, frontend module map, data flow.
- [Data Model](docs/data-model.md) — every sheet tab, column by column.
- [Health Formula Reference](docs/health-formulas.md) — every formula the Health section computes, and where it lives.
- [Tech Stack](docs/tech-stack.md) — every layer and library, from the vanilla-JS frontend to the key-less widget APIs.
- [Project Structure](docs/project-structure.md) — the full file tree, one line per module.
- [Getting Started](docs/getting-started.md) — deploy your own copy.
- [Deployment](docs/deployment.md) — publishing to GitHub Pages and authorizing the OAuth origin.
- [Configuration Reference](docs/configuration.md) — every sheet range, cache key and localStorage entry the app touches.
- [Caching Strategy](docs/caching.md) — how the localStorage cache, writes and Refresh/Clear Cache interact.
- [Security & Privacy](docs/security.md) — scopes, what's a secret and what isn't, and exactly what each widget or AI call sends.
- [License](#license) — usage terms.

---

## Overview

- Single-page app; authenticates with the user's own Google account.
- Reads/writes a private "Ledger" spreadsheet via Sheets API v4.
- All aggregation, charting, filtering, sorting and CRUD runs client-side in vanilla JS.
- No build step, no server component to deploy or maintain. Run it locally with `python scripts/serve.py 8000` — `python -m http.server` plus GitHub Pages' `404.html` fallback, which the row addresses below need.
- The home page loads as a fast overview — each section's summary tiles (Health status/macros/activity/sleep, Finance net worth and monthly cash flow) — with the detailed panels **hidden by default** for speed; a **Show blocks** menu item (remembered via a `SHOW_BLOCKS` setting) reveals and loads them on demand. The `/health/`, `/finance/` and `/other/` section pages always show their one block in full.
- **Every block and form has its own address**, like a breadcrumb: `/health/tune/`, `/health/physique/log/`, `/finance/account/transfer/`. Opening a block or form updates the address; loading one reopens it; Back closes a form. Insight's modes have addresses too (`/health/insight/plan/`, `…/patterns/`, …), and so does each row's Edit: `/health/nutrition/chicken-breast/`, `/health/physique/2026-10-03/`, `/health/activity/swim/`, and a day's 🧬 view, `/health/physique/2026-10-03/micronutrients/`. Row addresses are served by `404.html`, since they have no folder of their own. `sitemap.xml` lists every block, button and view address (`python scripts/build_sitemap.py`), but no row addresses, which would publish the sheet's own names and dates. One block is open at a time. See [Addresses](docs/features.md#layout-and-interaction).
- **Tune** (formerly the Health Formula Playground modal) is a block of its own in the Health section, above Indicator, and does the BMR calibration itself (the separate Calibrate form is gone): `n_p` × `L_p` (default 3 × 10 days, ending yesterday) give `BMR_cal` live, and its **Update** button recomputes every day's stored `BMR_cal` with a new window. Both of Tune's BMR choices offer the same four, always in step — `BMR_mif`, `BMR_kat`, `BMR_cal`, `BMR_adp` — and the adaptation rows (λ, λt_max, BMR_adp, m∞_adp) sit right under `BMR_cal`. Tune's model sits in two collapsed dropdowns: **Equations** (the full equation list, above the variables) and **Calculations** (the live substituted arithmetic under the last row, including BMR_cal's Periods table).
- **Physique columns are matched by header name**, so the sheet's column order can change freely. Each day's **Sleep**, **Deprivation** and **BMR** (JSON: `BMR_mif`, `BMR_kat`, `BMR_cal`, `BMR_adp`) are computed once and **stored in the sheet**, and the Status card, the charts and the table read them instead of recalculating on every load. Missing ones are filled in on load; a changed profile or BMR setting rewrites them all in one request. Re-saving a day keeps its stored BMR unless that day's Body Mass changed. See [Data Model → Physique](docs/data-model.md#physique).
- **One name for everything, app-wide**: the four BMR figures are always called `BMR_mif`, `BMR_kat`, `BMR_cal` and `BMR_adp` — in the Physique form (one line under Date and Body Mass), the Status card, Tune, the Caloric Intake chart (which draws all four per day) and every hover. Physique's form fields match the sheet's headers (**Bed**, **Wake**). Hover lines read `label (definition): number unit`, e.g. `TEI (Total Energy Intake): 829 kcal`, with a sign only on negatives in Calorie Balance. **Every date reads `YYYY-MM-DD`** — tables, the Status card's `t` row, chart axes and hovers (`2026-10-04`, or `2026-10` on a month axis) — and the home page's Date card reads year, month, day.
- **Status card** (Health) lists both `BMR_mif` and `BMR_kat`, then `BMR_cal` and `BMR_adp`, above TEI, TEF, AEE, SD, D, Δm and `t`.
- **Nutrition** — the **Add/Edit Ingredient** form is a lock table in Tune's layout, one row per value: **tick, name, box, unit**. Amount, Calories, Protein, Dietary Fiber, Fat, Carbohydrates and TEF come first, then every micronutrient, with zeros at the end. A ticked row is locked: **Complete** (formerly Pull Micronutrients) fills every other row from USDA, scaled to Amount, and refreshes an unticked TEF from the new macros. The **Micronutrients** column stores the same thing as JSON: the six top values first, then the micronutrients, each `{amount, unit, locked}`. The old **Verified** column is gone from the table and the sheet; its ✓s became locked Amount–Carbohydrates. The table's **Micro** column shows how many micronutrients are non-zero. Columns are matched by header name, like Physique. See [Data Model → Nutrition](docs/data-model.md#nutrition).
- **Car Service** (Other section, `/other/car-service/`) — your car's past services from Transportation transactions with an `@<km>km` odometer, a linear odometer forecast, and the next service of each kind: Toyota's 2023 Corolla km schedule (km only, no month limits), your own oil-change average, Ontario winter-tire timing (on by 1 Nov, off after 31 Mar), and a new tire set every 6 years. Each tire changeover also counts as Toyota's rotation & inspection, and rust protection is predicted with the changeover to winter. Two tables, **Predicted** (Date, Odometer, Service, Basis) above **Done** (Date, Odometer, Service), one line per cell; every Basis credits one source: **— Toyota**, **— TD** or **— your own history**. A service due within 30 days (or overdue) puts a short flag on the heading — e.g. `Rust+Tires 28d` — and, with browser notifications allowed, a once-a-day reminder. See [Features → Other](docs/features.md#other).
- Optional AI reads (via your own Groq key) in the Health section's Insight block — Wellness, Food, Micronutrients (which skips any nutrient at 0 with no daily target), Activity, Protein Sources, Plan, and **Patterns**. Each mode has a **Prompt template** dropdown (Tune's Equations style) showing exactly what Send to AI sends: the full system prompt and the user message, with the data already on screen shown as `[data shown above]`. **Patterns** sends period averages (mass change, the four stored BMR figures, intake, macros, activity by type, BMR offset) over Tune's period length `L_p` (default 10 days) and asks what drives more fat loss and a higher BMR.

---

## License

All rights reserved. See [LICENSE](LICENSE) — no permission is granted to copy, modify, or redistribute this project without the copyright holder's prior written consent.
