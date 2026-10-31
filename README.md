# Ledger

A private, serverless personal life dashboard — health, finances, time tracking, travel, applications, LeetCode practice and contacts in one place.

- Reads and writes **directly to a Google Sheet you own**. No backend, no database, no third-party data store.
- Single-page vanilla-JS app on GitHub Pages; no build step.
- Each user copies the template sheet; the app only touches that copy, via Drive's per-file `drive.file` scope.

![Ledger system architecture](assets/images/system-architecture.png)

## Documentation

### Product

- [Features](docs/features/README.md) — every section and page, one file each.
  - [Finance — Watch List](docs/features/finance-watchlist.md) — the stocks you follow, their latest moves and price alerts.
  - [Finance — Market](docs/features/finance-market.md) — one stock's chart 1d to All, rule-based verdict, risk, news and an AI read.
  - [Finance — Portfolio](docs/features/finance-portfolio.md) — trade log at average cost, gain/loss in CAD.
  - [Health — Chart](docs/features/health-chart.md) — every Health chart on one range, a Daily Progress heatmap of each day's Calorie Balance with its day of the month in each cell, and five desired grades (Beat, Met, Near, Short of, Missed desired) shared by every chart, shaded on a continuous colour blend; Body Mass's dots are one gray (Measured Body Mass), its trend named and smoothed over L_p days, and its Calorie Trend starts at the mean of its first L_p days; every other chart's average line (and the grade lift under it) is an L_p-Day Average, following Tune's L_p.
  - [Health — Tune](docs/features/health-tune.md) — the plan's settings and live arithmetic; BMR_cal is clamped as Physique stores it and every Solve-for mode reads BMR under the chosen basis, so its arrival date matches Health's Progress card.
  - [Health — Physique](docs/features/health-physique.md) — the daily log and day form; Consumption and Workout suggest names per line, filled in only from a click or an arrow-picked option (Enter alone starts a new line), with taller, divided options on touch.
  - [Track — LeetCode](docs/features/track.md#track) — the NeetCode 250 roadmap ticked off from your logged solves, a Progress card with video hours watched and a finish date at last week's pace, a Daily Progress heatmap since the first solve (sized as Health Chart's), each day showing its solve count, shaded from empty to dark green by its video minutes against the longest day, NeetCode's roadmap graph, category tables with each problem's video Duration and 🎥 YouTube / 📄 NeetCode / 🔗 LeetCode buttons, and a red badge of the solves today owes against the last 7 days' average.
- [Design System](docs/design-system.md) — colours, type sizes, spacing, tables, buttons.
- [Naming & Display Conventions](docs/conventions.md) — wording, BMR names, units, dates, hover format.

### Engineering

- [Architecture](docs/architecture.md) — system diagram, request flow, module map, data flow.
- [Data Model](docs/data-model.md) — every sheet tab, column by column.
- [Health Formula Reference](docs/health-formulas.md) — every Health formula and where it lives.
- [Tech Stack](docs/tech-stack.md) — every layer and library.
- [Project Structure](docs/project-structure.md) — the file tree, one line per module.
- [Caching Strategy](docs/caching.md) — no sheet caching (stock prices excepted), batched reads, quota handling.

### Operations

- [Getting Started](docs/getting-started.md) — deploy your own copy.
- [Deployment](docs/deployment.md) — GitHub Pages and the OAuth origin.
- [Versioning](docs/versioning.md) — automatic MAJOR.MINOR.PATCH from commit messages (`feat:` minor, `fix:`/other patch, `feat!:` major).
- [Changelog](docs/changelog.md) — every commit with its version and a summary of the changes.
- [Configuration Reference](docs/configuration.md) — sheet ranges and localStorage entries.
- [Stock Data Setup](docs/stock-data-setup.md) — to do: the three free API keys for Watch List, Market and Portfolio.
- [Security & Privacy](docs/security.md) — scopes, secrets, what each external call sends.

## License

All rights reserved. See [LICENSE](LICENSE).
