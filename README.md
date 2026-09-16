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

---

## License

All rights reserved. See [LICENSE](LICENSE) — no permission is granted to copy, modify, or redistribute this project without the copyright holder's prior written consent.
