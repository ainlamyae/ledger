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
- No build step, no server component to deploy or maintain.
- The home page loads as a fast overview — each section's summary tiles (Health status/macros/activity/sleep, Finance net worth and monthly cash flow) — with the detailed panels **hidden by default** for speed; a **Show blocks** menu item (remembered via a `SHOW_BLOCKS` setting) reveals and loads them on demand. The `/health/`, `/finance/` and `/other/` section pages always show their one block in full.
- **Every block and form has its own address**, like a breadcrumb: `/health/tune/`, `/health/physique/log/`, `/finance/account/transfer/`. Opening a block or form updates the address; loading one reopens it; Back closes a form. One block is open at a time. See [Addresses](docs/features.md#layout-and-interaction).
- **Tune** (formerly the Health Formula Playground modal) is a block of its own in the Health section, above Indicator, with **Calibrate** in its heading. Calibrate BMR's window is a **Number of periods** × **Period length** (default 3 × 10 days, ending yesterday), shared with Tune's `n_p` / `L_p` rows, and its **Update** button recomputes every day's stored `BMR_cal` with a new window.
- **Physique columns are matched by header name**, so the sheet's column order can change freely. Each day's **Sleep**, **Deprivation** and **BMR** (JSON: `BMR_mif`, `BMR_kat`, `BMR_cal`, `BMR_adp`) are computed once and **stored in the sheet**, and the Status card, the charts and the table read them instead of recalculating on every load. Missing ones are filled in on load; a changed profile or BMR setting rewrites them all in one request. Re-saving a day keeps its stored BMR unless that day's Body Mass changed. See [Data Model → Physique](docs/data-model.md#physique).
- **One name for everything, app-wide**: the four BMR figures are always called `BMR_mif`, `BMR_kat`, `BMR_cal` and `BMR_adp` — in the Physique form (one line under Date and Body Mass), the Status card, Tune, the Caloric Intake chart (which draws all four per day) and every hover. Physique's form fields match the sheet's headers (**Bed**, **Wake**). Hover lines read `label (definition): number unit`, e.g. `TEI (Total Energy Intake): 829 kcal`, with a sign only on negatives in Calorie Balance.
- **Car Service** (Other section, `/other/car-service/`) — your car's past services from Transportation transactions with an `@<km>km` odometer, a linear odometer forecast, and the next service of each kind: Toyota's 2023 Corolla km schedule (km only, no month limits), your own oil-change average, and Ontario winter-tire timing (on by 1 Nov, off after 31 Mar). Each tire changeover also counts as Toyota's rotation & inspection, and rust protection is predicted with the changeover to winter. The table (Date, Payee, Service, Odometer, Amount, Status, Basis) puts predictions above the history, one line per cell; every Basis credits one source: **— Toyota**, **— TD** or **— your own history**. See [Features → Other](docs/features.md#other).
- Optional AI reads (via your own Groq key) in the Health section's Insight block — Wellness, Food, Micronutrients, Activity, Protein Sources, Health Plan, and **Patterns**, which sends period averages (mass change, intake, macros, activity by type, BMR offset) over a user-editable period length (default 14 days) and asks what drives more fat loss and a higher BMR.

---

## License

All rights reserved. See [LICENSE](LICENSE) — no permission is granted to copy, modify, or redistribute this project without the copyright holder's prior written consent.
