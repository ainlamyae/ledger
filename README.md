# Ledger

A private, serverless personal life dashboard — health, finances, time tracking, travel, applications and contacts in one place.

- Reads and writes **directly to a Google Sheet you own**. No backend, no database, no third-party data store.
- Single-page vanilla-JS app on GitHub Pages; no build step.
- Each user copies the template sheet; the app only touches that copy, via Drive's per-file `drive.file` scope.

## Documentation

### Product

- [Features](docs/features/README.md) — every section and page, one file each.
- [Design System](docs/design-system.md) — colours, type sizes, spacing, tables, buttons.
- [Naming & Display Conventions](docs/conventions.md) — wording, BMR names, units, dates, hover format.

### Engineering

- [Architecture](docs/architecture.md) — system diagram, request flow, module map, data flow.
- [Data Model](docs/data-model.md) — every sheet tab, column by column.
- [Health Formula Reference](docs/health-formulas.md) — every Health formula and where it lives.
- [Tech Stack](docs/tech-stack.md) — every layer and library.
- [Project Structure](docs/project-structure.md) — the file tree, one line per module.
- [Caching Strategy](docs/caching.md) — no caching, batched reads, quota handling.

### Operations

- [Getting Started](docs/getting-started.md) — deploy your own copy.
- [Deployment](docs/deployment.md) — GitHub Pages and the OAuth origin.
- [Versioning](docs/versioning.md) — automatic MAJOR.MINOR.PATCH release numbers.
- [Configuration Reference](docs/configuration.md) — sheet ranges and localStorage entries.
- [Security & Privacy](docs/security.md) — scopes, secrets, what each external call sends.

## License

All rights reserved. See [LICENSE](LICENSE).
