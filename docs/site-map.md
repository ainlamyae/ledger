# Site Map

[← README](../README.md) · [Hubs, Pages & Addresses](features/navigation.md) · [Architecture](architecture.md)

Every page in Ledger, as its breadcrumb names it, from the home page down. The tree is the app's hierarchy: a branch is one level below its parent, and pages under the same parent are one level side by side.

## Levels

| Level | What it is | Example breadcrumb | Address |
|---|---|---|---|
| 0 | **Home** — the Ledger hub | Ledger | `/` |
| 1 | **Section** — a hub of page tiles | Ledger / Health | `/health/` |
| 2 | **Page** — one block of a section | Ledger / Health / Physique | `/health/physique/` |
| 3 | **View** — a page of a page (its own tile or tab) | … / Insight / Plan | `/health/insight/plan/` |
| 3 | **Form** — opened by a page's header button | … / Physique / Log | `/health/physique/log/` |
| 3 | **Row** — a table row's own form (its Edit) | … / Physique / 2026-10-17 | `/health/physique/2026-10-17/` |
| 4 | **Sub-page** — a page inside a form or row | … / 2026-10-17 / Micronutrients | `/health/physique/2026-10-17/micronutrients/` |

`<…>` in the tree is a placeholder filled per row: a date, a name's slug (`chicken-breast`) or a setting's key. Every address without one has its own page file on disk and is listed in [`sitemap.xml`](../sitemap.xml).

## Tree

```text
Ledger                                        /
│   Time · Date · Azan · Weather widgets, one card of page tiles per section
│
├── Health                                    /health/
│   ├── Chart                                 /health/chart/
│   ├── Physique                              /health/physique/
│   │   ├── Micronutrients        (🧬 form)   /health/physique/micronutrients/
│   │   ├── Log                   (📝 form)   /health/physique/log/
│   │   └── <date> | pattern-<n>  (row Edit)  /health/physique/<date>/        📍 Today opens today's
│   │       ├── Micronutrients    (🧬)        /health/physique/<date>/micronutrients/
│   │       └── Duplicate         (📋)        /health/physique/<date>/duplicate/
│   ├── Nutrition                             /health/nutrition/
│   │   ├── Add                   (➕ form)   /health/nutrition/add/
│   │   └── <ingredient>          (row Edit)  /health/nutrition/<ingredient>/
│   ├── Activity                              /health/activity/
│   │   ├── Workouts              (💪 form)   /health/activity/workouts/
│   │   │   └── <group>           (sub-page)  /health/activity/workouts/<group>/
│   │   ├── Add                   (➕ form)   /health/activity/add/
│   │   └── <activity>            (row Edit)  /health/activity/<activity>/
│   │       └── Duplicate         (📋)        /health/activity/<activity>/duplicate/
│   ├── Insight                               /health/insight/
│   │   ├── Plan                  (view)      /health/insight/plan/
│   │   ├── Wellness              (view)      /health/insight/wellness/
│   │   ├── Food                  (view)      /health/insight/food/
│   │   ├── Micronutrient         (view)      /health/insight/micronutrient/
│   │   ├── Activity              (view)      /health/insight/activity/
│   │   ├── Protein               (view)      /health/insight/protein/
│   │   └── Pattern               (view)      /health/insight/pattern/
│   └── Tune                                  /health/tune/
│
├── Finance                                   /finance/
│   ├── Chart                                 /finance/chart/
│   ├── Transaction                           /finance/transaction/
│   │   ├── Log                   (📝 form)   /finance/transaction/log/
│   │   └── Bulk Edit             (selection) /finance/transaction/bulk-edit/
│   ├── Account                               /finance/account/
│   │   ├── Transfer              (🔀 form)   /finance/account/transfer/
│   │   └── Add                   (➕ form)   /finance/account/add/
│   ├── Breakdown                             /finance/breakdown/
│   │   └── Add                   (➕ form)   /finance/breakdown/add/
│   ├── Portfolio                             /finance/portfolio/
│   │   └── Log                   (📝 form)   /finance/portfolio/log/
│   ├── Watch List                            /finance/watchlist/
│   │   └── Add                   (➕ form)   /finance/watchlist/add/
│   ├── Market                                /finance/market/                  its tile sits in Insight's card
│   └── Insight                               /finance/insight/
│       └── Snapshot              (view)      /finance/insight/snapshot/
│
├── Track                                     /track/
│   ├── LeetCode                              /track/leetcode/
│   │   └── Log                   (📝 form)   /track/leetcode/log/
│   ├── Work Time                             /track/work-time/
│   │   ├── Log                   (📝 form)   /track/work-time/log/
│   │   └── <date>                (row Edit)  /track/work-time/<date>/
│   ├── Car Service                           /track/car-service/
│   ├── Travel                                /track/travel/
│   │   └── Log                   (📝 form)   /track/travel/log/
│   └── Application                           /track/application/
│       └── Log                   (📝 form)   /track/application/log/
│
└── Other                                     /other/                           from the account menu, no tab
    ├── Contact                               /other/contact/
    │   └── Add                   (➕ form)   /other/contact/add/
    └── Settings                              /other/settings/                  opens on AI & Keys
        ├── AI & Keys             (tab)       /other/settings/ai/
        ├── AI Responses          (tab)       /other/settings/responses/
        ├── Health                (tab)       /other/settings/health/
        ├── Display               (tab)       /other/settings/display/
        ├── All                   (tab)       /other/settings/all/
        ├── Add                   (➕ form)   /other/settings/add/
        └── <key>                 (row Edit)  /other/settings/<key>/
```

## Reading the tree

- **Order.** Sections follow the menu (Health, Finance, Track, then Other); pages follow their section's tiles; views and tabs follow their buttons. The same order sets [the motion](features/layout.md#motion): moving to a branch below is `down`, back to a parent is `up`, and between branches of one parent is `sideways`, to the right when going on in this order.
- **Breadcrumbs.** Each node's name is its breadcrumb step: `Ledger / Health / Physique / 2026-10-17 / Micronutrients`. Every step but the last is a link back up.
- **Forms are pages.** A header button's form and a row's Edit take their page's place under a breadcrumb; ❌ goes back up one level.
- **Not in the tree:** dialogs that aren't pages (keyboard shortcuts, confirmations), and `/health/activity/gym/`, Workouts' old address, which only redirects to `/health/activity/workouts/`.
- **One build.** Every page is the same `index.html`: a section's page file is a stub that loads it and shows its own section ([Architecture § Section pages](architecture.md#section-pages)). A row address has no file; GitHub Pages answers it with `404.html`, which loads the app the same way.

## Keeping it current

A new page needs its node here, its stub (`<section>/<page>/index.html`, copied from a neighbour with its `<base>` depth and `<title>`), its line in [`sitemap.xml`](../sitemap.xml), and its feature doc under [Features](features/README.md).
