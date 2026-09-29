# Hubs, Pages & Addresses

[← Features](README.md) · [README](../../README.md)

## At a glance

- `/health/`, `/finance/`, `/other/` are **hubs**: glance cards, then a name-only tile per block.
- Health tiles: Indicator, Physique, Nutrition, Activity, Insight, Tune, Settings, then **Today** and **GYM** (gray).
- Finance tiles: Indicator, Transaction, Account, Breakdown, then **Insight** last — the same order as the panels in `index.html`, which the tiles, sidebar and bottom bar all follow.
- Each block and form is its own page under a breadcrumb starting at **Ledger**: `Ledger / Health / Physique / Log`. Pages switch in place, without a reload.
- The breadcrumb is the only heading; the home page's reads **Ledger** alone.
- Forms take the page's place instead of covering it.
- **Wide screens (≥1180px):** a sidebar with every section and page, **Ledger** at the top, account avatar bottom-left.
- **Tablet and phone (≤1179px):** bottom tab bar and tiles, no top bar; avatar bottom-left (🔑 sign-in in its place when signed out). Same treatment at every width in this range — there's no separate tablet layout.
- **Actions bar:** one place and order per page, ❌ last — top of the page on a laptop, bottom bar on tablet and phone. Both bottom bars are navy pills of the same height (`--bottom-bar-height`); the action bar starts with a **Ledger** tab.
- **Loading:** a reload paints the final layout from the first frame and opens straight onto that page or form; Insight mode pages fill in as data arrives.
- **Badges** on tiles and breadcrumbs: `A<T $13` (Account), `28d` (Car Service), `Log` (Work Time, Physique — opens today).
- Finance has **Indicator** and **Insight**; Insight has one mode, **Snapshot** (`/finance/insight/snapshot/`).

### Addresses

| Kind | Example |
|---|---|
| Block / form | `/health/tune/`, `/health/physique/log/`, `/finance/account/transfer/` |
| Insight mode | `/health/insight/plan/` |
| Row Edit | `/health/nutrition/chicken-breast/`, `/health/physique/2026-10-03/`, `/other/settings/body_mass_target_kg/` |
| Row duplicate | `/finance/transaction/2026-10-05-grocer/duplicate/` |
| Bulk Edit | `/finance/transaction/bulk-edit/` |
| 🧬 view | `/health/physique/2026-10-03/micronutrients/` |

- Labelled rows (Contact, Account, Breakdown, Transaction, Travel, Application) use their label; repeats get `-2`, `-3`… in sheet order.
- Physique's **Today** uses today's date address, logged or not; a Pattern is `/health/physique/pattern-1/`. Addresses like these have no file of their own, so locally they need `scripts/serve.py` (see [Getting Started](../getting-started.md#4-run-locally)); plain `python -m http.server` answers them with File not found.
- Row addresses are served by `404.html`. `sitemap.xml` (`python scripts/build_sitemap.py`) lists block, button and view addresses but never rows, which would publish sheet data.

## Hub and pages

- **Every section page starts with the same breadcrumb, top-left**: `Ledger / Health` on the hub (in place of the old centred section title; **Ledger** links to the home page), `Ledger / Health / Physique` on a page, `Ledger / Health / Physique / Log` on a form page.
- **A section page is a hub, and each block is a page** (`page-nav.js`, `router.js`'s `showSectionPage`). `/health/`, `/finance/` and `/other/` show the section's glance cards, then one **tile** per block — just its name, as many a row as fit (3 on a phone, up to 7 on a laptop). `/health/physique/` shows that block alone, opened, under a breadcrumb (`Ledger / Health / Physique`); its heading is a title, not a fold toggle.
- **One bottom bar at a time, and ❌ on every page** (`page-nav.js`'s `updateActionBar`). On a phone the page's own action row replaces the Health · Finance · Other tab bar as the one bar pinned to the bottom: a form page's actions, a selection bar while rows are ticked (Physique, Nutrition, Transaction, Contact), Tune's Reset · Update · Save or Insight's Send to AI, otherwise the block's header buttons (Physique's Today · Log). Every bar ends in ❌ at the far right — a page with no buttons (Indicator) gets a bar with just ❌ — in one row that scrolls sideways when it's long, with ❌ kept in view; it starts with a **Ledger** tab, its buttons share one 42px size and differ only in colour, ❌ at the right end, and it is exactly as tall as the tab bar it replaces (both read `--bottom-bar-height`, which the avatar's box and the page's bottom clearance use too). On a wide screen the header buttons stay in the header with ❌ top right on every page. ❌ on a page returns to the section hub, on a selection bar clears the selection, on a form closes it.
- **Reloading a form address** (`/health/physique/2026-10-05/`, `/health/physique/log/`) opens straight onto that form page — its breadcrumb over a "Loading…" card — and the form fills it once the data loads; the address never switches to the block in between. If the form can't open (signed out, an unknown row) the block's page is shown.
- **Stacked forms** (a day's 🧬 view opened from its Edit): only the top one is shown, as a page with its own breadcrumb; the one under it returns when it closes.
- **Quick actions:** the Health hub (and Health's part of the home page) carries **Today** then **GYM** as its last tiles, gray like Physique's own Today button, after Settings (`QUICK_ACTIONS`, `page-nav.js`); GYM opens `/health/activity/gym/`. On the hub it clicks Physique's own Today, so today's entry (or a new one dated today) opens exactly as it does from the Physique page (`/health/physique/2026-10-05/`), and closing it returns to the hub; on the home page it goes to that address.
- Tiles, the breadcrumb and the sidebar switch views in place — one history entry, no reload — so Back and Forward move between hub and pages, and a reload or shared link lands on the same view.
- **Forms are pages too** (`router.js`'s `updateFormPage`): Log, Add, Today, a row's Edit or 🧬 view and Activity's GYM take the page's place under their own breadcrumb (`Ledger / Health / Physique / Log`) instead of covering it — the section name returns to the hub and the block name to its page, both closing the form, as do Back, ✕, Cancel and Escape, which also return to where the page was scrolled. On a phone the form's actions are the bottom bar, in place of the tab bar. Dialogs that aren't pages (keyboard shortcuts, confirmations) and forms on the home page stay overlays.
- **One text size for every card**: the widgets (Time, Date, Azan, Weather), the Health cards and Finance's all set their content in `--card-text-size` (.9rem, .8rem at 820px and below), regular weight, under .8rem titles, with one padding — no bigger clock, date or figure.
- **Six text colours, app-wide**: text, muted gray, white, red (bad, negative, errors), green (good, positive, success) and blue (links). A value is green, red or gray (`.income`, `.expense`, `.neutral`) — no dark green, orange, brown, navy or gradient text; charts keep their own palette.
- **Pages have no card of their own**: a block page and a form page sit on the page background (`.panel.page-active` and the form page's `.modal-card` drop their white, shadow and padding); only small cards — the glance cards, tiles and inputs — are white.
- **Badges** (`setPageBadge`, page-nav.js): a block's short sign — `A<T $13` (Account), `28d` (Car Service), `Log` (Work Time, Physique) — a small red pill on its tile's corner, on the hub and the home page, and after its page's breadcrumb. A `Log` badge opens today's day. They replace the old heading flags and the reminder banners. The home page reads Transactions and Work Time too (5 requests a load instead of 3), so its tiles carry the same badges as the hubs.
- **The breadcrumb is the only heading**, the home page included (`buildHomeCrumb`, page-nav.js: **Ledger** alone, at the hubs' place and spacing): a block page hides its block's `<h2>` and a form page its card's title, since the breadcrumb already ends in that name. A Physique form opened to add to today keeps that hint on Save's hover (`setPhysiqueFormHint`).
- **Views are pages too** (`data-route-view`, Health Insight's modes): a view's button pushes its own history step (`/health/insight/plan/`), the breadcrumb gains the block as a link (`Ledger / Health / Insight / Plan`), and Back, that link, the sidebar or ❌ return to the block's page, where `registerViewReset` (router.js) clears the view — for Insight, `clearInsightMode` back to the tiles. Finance's Insight is the same with one mode, **Snapshot** (`/finance/insight/snapshot/`).
- **Wide screens (≥ 1180px)** get a left sidebar listing every section and page, the current one marked, with **Ledger** (the home page) at its top and the account avatar and menu in its bottom-left corner in place of the top bar; a link in another section loads that section. Below that width, the bottom tab bar picks a section and the hub's tiles pick a page.
- **The home page is an overview of all three sections**: each one's glance cards (Health status and Progress, Finance's summary cards) followed by its tiles; a tile opens that page. There are no collapsible blocks any more, so the old **Show blocks** menu item and its `SHOW_BLOCKS` setting are gone (the row is removed from the Setting tab on load).
