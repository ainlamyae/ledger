# Site map

[Docs](../README.md) › Reference

Every address in Ledger, with the breadcrumb step that names it.

## At a glance

- **Five levels:** home, section, page, then views, forms and rows, then sub-pages.
- **One build:** every address loads the same `index.html`; a page folder holds only a stub.
- **Row addresses:** have no stub; GitHub Pages serves `404.html`, which loads the app and opens the row.
- **Breadcrumbs:** each node's name is its step, as in `Ledger / Health / Physique / 2026-10-17 / Micronutrients`.
- **Order:** sections, pages and views follow the menu, tile and button order; it also sets the slide direction.

## Levels

| Level | What it is | Example breadcrumb | Address |
|---|---|---|---|
| 0 | Home, the Ledger hub | Ledger | `/` |
| 1 | Section, a hub of page tiles | Ledger / Health | `/health/` |
| 2 | Page, one block of a section | … / Health / Physique | `/health/physique/` |
| 3 | View, a page's own tile or tab | … / Insight / Plan | `/health/insight/plan/` |
| 3 | Form, opened by a header button | … / Physique / Log | `/health/physique/log/` |
| 3 | Row, a table row's own form | … / Physique / 2026-10-17 | `/health/physique/2026-10-17/` |
| 4 | Sub-page, inside a form or row | … / 2026-10-17 / Micronutrients | `/health/physique/2026-10-17/micronutrients/` |

## Placeholders

- **`<…>`:** filled per row with a slug: lowercase words joined by hyphens (`Chicken Breast` → `chicken-breast`).
- **Repeats:** a second row with the same slug gets `-2`, then `-3`, in sheet order.
- **Stubs:** every address without a placeholder has its own `index.html` and a line in `sitemap.xml`.
- **Left out of `sitemap.xml`:** row addresses, which would publish sheet data.

## Home and Health

| Breadcrumb | Kind | Address | Opened by |
|---|---|---|---|
| Ledger | Home | `/` | Logo, tab bar |
| Health | Section | `/health/` | Menu |
| Chart | Page | `/health/chart/` | Tile |
| Physique | Page | `/health/physique/` | Tile |
| Micronutrients | Form | `/health/physique/micronutrients/` | 🧬 |
| Log | Form | `/health/physique/log/` | 📝 |
| `<date>` or `pattern-<n>` | Row | `/health/physique/<date>/` | Row ✏️; 📍 Today opens today's |
| Micronutrients | Sub-page | `/health/physique/<date>/micronutrients/` | Row 🧬 |
| Duplicate | Sub-page | `/health/physique/<date>/duplicate/` | Row 📋 |
| Nutrition | Page | `/health/nutrition/` | Tile |
| Add | Form | `/health/nutrition/add/` | ➕ |
| `<ingredient>` | Row | `/health/nutrition/<ingredient>/` | Row ✏️ |
| Activity | Page | `/health/activity/` | Tile |
| Workouts | Form | `/health/activity/workouts/` | 💪 |
| `<group>` | Sub-page | `/health/activity/workouts/<group>/` | Group |
| Add | Form | `/health/activity/add/` | ➕ |
| `<activity>` | Row | `/health/activity/<activity>/` | Row ✏️ |
| Duplicate | Sub-page | `/health/activity/<activity>/duplicate/` | Row 📋 |
| Insight | Page | `/health/insight/` | Tile |
| Plan | View | `/health/insight/plan/` | Mode tile |
| Wellness | View | `/health/insight/wellness/` | Mode tile |
| Food | View | `/health/insight/food/` | Mode tile |
| Micronutrient | View | `/health/insight/micronutrient/` | Mode tile |
| Activity | View | `/health/insight/activity/` | Mode tile |
| Protein | View | `/health/insight/protein/` | Mode tile |
| Pattern | View | `/health/insight/pattern/` | Mode tile |
| Tune | Page | `/health/tune/` | Tile |

- **Today alias:** `/health/physique/today/`, or today's date before today is logged, opens a new Log.
- **Old address:** `/health/activity/gym/` only redirects to `/health/activity/workouts/`.

## Finance

| Breadcrumb | Kind | Address | Opened by |
|---|---|---|---|
| Finance | Section | `/finance/` | Menu |
| Chart | Page | `/finance/chart/` | Tile |
| Transaction | Page | `/finance/transaction/` | Tile |
| Log | Form | `/finance/transaction/log/` | 📝 |
| Bulk Edit | Form | `/finance/transaction/bulk-edit/` | ✏️ Edit Selected (no stub) |
| `<date>-<payee>` | Row | `/finance/transaction/<row>/` | Row ✏️ |
| Duplicate | Sub-page | `/finance/transaction/<row>/duplicate/` | Row 📋 |
| Account | Page | `/finance/account/` | Tile |
| Transfer | Form | `/finance/account/transfer/` | 🔀 |
| Add | Form | `/finance/account/add/` | ➕ |
| `<account>` | Row | `/finance/account/<account>/` | Row ✏️ |
| Breakdown | Page | `/finance/breakdown/` | Tile |
| Add | Form | `/finance/breakdown/add/` | ➕ |
| `<category>-<type>` | Row | `/finance/breakdown/<row>/` | Row ✏️ |
| Portfolio | Page | `/finance/portfolio/` | Tile |
| Log | Form | `/finance/portfolio/log/` | 📝 |
| `<date>-<action>-<symbol>` | Row | `/finance/portfolio/<row>/` | Row ✏️ |
| Watch List | Page | `/finance/watchlist/` | Tile |
| Add | Form | `/finance/watchlist/add/` | ➕ |
| `<symbol>` | Row | `/finance/watchlist/<symbol>/` | Row ✏️ |
| Market | Page | `/finance/market/` | Tile in Insight's card |
| Insight | Page | `/finance/insight/` | Tile |
| Snapshot | View | `/finance/insight/snapshot/` | Mode tile |

## Track

| Breadcrumb | Kind | Address | Opened by |
|---|---|---|---|
| Track | Section | `/track/` | Menu |
| LeetCode | Page | `/track/leetcode/` | Tile |
| Log | Form | `/track/leetcode/log/` | 📝 |
| `<date>-<problem>` | Row | `/track/leetcode/<row>/` | Row ✏️ |
| Work Time | Page | `/track/work-time/` | Tile |
| Log | Form | `/track/work-time/log/` | 📝 |
| `<date>` | Row | `/track/work-time/<date>/` | Row ✏️; any date, logged or not |
| Car Service | Page | `/track/car-service/` | Tile |
| Travel | Page | `/track/travel/` | Tile |
| Log | Form | `/track/travel/log/` | 📝 |
| `<date>-<place>` | Row | `/track/travel/<row>/` | Row ✏️ |
| Application | Page | `/track/application/` | Tile |
| Log | Form | `/track/application/log/` | 📝 |
| `<type>-<number>` | Row | `/track/application/<row>/` | Row ✏️ |
| Contact | Page | `/track/contact/` | Tile |
| Add | Form | `/track/contact/add/` | ➕ |
| `<name>` | Row | `/track/contact/<name>/` | Row ✏️ |

## Settings

A section with one block, so its addresses skip the block slug.

| Breadcrumb | Kind | Address | Opened by |
|---|---|---|---|
| Settings | Section | `/setting/` | Account menu (no tab); opens on AI & Keys |
| AI & Keys | View | `/setting/ai/` | Tab |
| AI Responses | View | `/setting/responses/` | Tab |
| Health | View | `/setting/health/` | Tab |
| Display | View | `/setting/display/` | Tab |
| All | View | `/setting/all/` | Tab |
| Add | Form | `/setting/add/` | ➕ |
| `<key>` | Row | `/setting/<key>/` | Row ✏️; key in lowercase |

## Not in the tree

- **Overlay dialogs:** keyboard shortcuts, confirmations and forms opened on the home page.
- **`404.html`:** serves every row address and unknown path.

## Adding a page

- **Stub:** copy a neighbour's `<section>/<page>/index.html`, fixing its `<base>` depth and `<title>`.
- **Sitemap:** run `python scripts/build_sitemap.py`.
- **Docs:** add the node here and a guide page under [Docs](../README.md).

## Related

- [Navigation](../guide/navigation.md): hubs, sidebar, tab bar, addresses, forms, motion, shortcuts, display switches.
- [Architecture](../development/architecture.md): system, section pages, boot order, modules, tech stack.
- [Deployment](../development/deployment.md): GitHub Pages, OAuth origin, CSP upkeep.
- [Design system](design-system.md): colours, type, spacing, tables, buttons, charts.
