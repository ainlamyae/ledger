# Navigation

[Docs](../README.md) › Guide

How you move around Ledger: hubs and pages, the sidebar and tab bar, addresses, forms, motion, shortcuts and the display switches.

## At a glance

- **Hubs and pages:** `/health/`, `/finance/`, `/track/` and `/other/` are hubs of glance cards and tiles; each tile opens one page.
- **Breadcrumb:** the only heading, starting at **Ledger** (`Ledger / Health / Physique / Log`); every step is a link.
- **Wide screens (≥1180px):** a left sidebar lists every section and page; **Tablet and phone:** a bottom tab bar.
- **Forms are pages:** Log, Add, Edit and views replace the page under their own address; ❌ closes them.
- **Every view has an address:** reload, Back, Forward or a shared link land on the same page, form or row.

## What it shows

### Hubs and tiles

- **Hub:** the section's glance cards, then one card titled with the section's name holding a tile per page.
- **Tile colour says what it opens:**

| Colour | Opens | Tiles |
|---|---|---|
| Gray | A sheet's rows | Physique, Nutrition, Activity, Transaction, Account, Portfolio, Watch List, LeetCode, Work Time, Car Service, Travel, Application |
| Green | A form | Tune, Today, Workouts |
| Orange | Charts | Chart (Health and Finance), Micronutrients |
| Purple | An AI read | Insight (Health and Finance), Market, and Insight's mode tiles |

- **Quick actions:** the Health hub adds **Today**, **Workouts** and **Micronutrients** tiles that open their form or view directly.
- **Tiles elsewhere:** Market's tile sits on Finance Insight's page beside Snapshot; Breakdown has no tile but `/finance/breakdown/` opens.
- **Badges:** a small red pill on a tile's corner and after its breadcrumb, e.g. `5d`, `Log`, `A<T $13`, `AC.TO<20.16`.
  - Each badge is explained on its page's guide; a `Log` or Work Time badge opens today's day.

### Sidebar and tab bar

- **Sidebar (wide screens):** **Ledger** at the top, then every section and page; the current one is white on blue.
  - **Bottom panel:** Refresh data, Clear cache, Settings, the switches, then your account row.
  - **Hide it:** the button beside **Ledger**, or Ctrl+. (⌘. on a Mac); the choice is kept in this browser.
- **Tab bar (≤1179px):** Ledger · Health · Finance · Track, pinned to the bottom; your avatar (or 🔑 sign-in) sits bottom-left.
- **Action bar:** a page's buttons in one place and order, ❌ last; top of the page on a laptop, the bottom bar on a phone.
  - On a phone it replaces the tab bar while a page or form is open, and scrolls sideways when long.
- **Footer:** `© ALI — Ledger v…` in a slim strip at the bottom; the version changes with each release.

### Account menu

- **Items:** Refresh data, Clear cache, Settings, then Rename Ledger file, Switch spreadsheet, Open in Google Sheets, Sign out.
- **Last load:** "Updated 11:00:44" sits under your name and email.
- **Enable notifications:** shown until answered; lets Chrome show Work Time's and Car Service's daily reminders.
- **Clear cache:** re-downloads the app's own files and reloads, for when the browser still runs an older version.

## Actions

### Keyboard shortcuts

| Key | Does |
|---|---|
| `/` | Filter transactions by payee (goes to the Transaction page if needed) |
| `n` | Log a transaction (opens Transaction's Log form) |
| `Esc` | Close a form or menu |
| `?` | Show or hide the shortcuts help |
| Ctrl+. / ⌘. | Hide or show the sidebar |

- **While typing:** shortcuts are ignored inside a field.

### Display switches

- **Dark mode:** switches the theme; kept in this browser.
- **Amounts:** off masks money, health figures, contact details and Settings values (for reading over a shoulder).
- **Widgets:** shows the Time/Date/Azan/Weather row on the home page.
- **Bulbs:** shows the home page's Health and Finance glance cards.
- **Where they live:** the sidebar's bottom panel while it's open, otherwise the account menu.
- **Before sign-in:** they work from this browser's last values; once signed in, the Setting tab's `SHOW_*` keys rule.

### Forms

- **Save never closes:** 💾 shows "Saved" in a toast and the form stays open; an Add becomes the new row's Edit.
- **Close:** ❌, Back, Esc or a breadcrumb step close a form and return to where you were scrolled.
- **Stacked forms:** a form opened from another (a day's 🧬 view from its Edit) shows on top; closing returns to the first.
- **Slow actions:** the button shows `…` and ignores clicks until done (saves, deletes, AI and USDA calls).
- **Deletes:** many show an Undo toast (↩️); yes/no questions use the browser's confirm box.
- **Messages:** results, progress and errors appear as a toast at the bottom; errors are red and stay longer.

### Exports and printing

- **Export Transactions / Export Physique:** buttons on the Settings page; each downloads every row as CSV.
- **Print:** drops navigation, buttons and range pickers; a chart is never split across sheets.

## Rules & calculations

### Addresses

| Kind | Example |
|---|---|
| Page / form | `/health/tune/`, `/health/physique/log/`, `/finance/account/transfer/`, `/track/work-time/log/` |
| View | `/health/insight/plan/`, `/finance/insight/snapshot/`, `/other/settings/display/` |
| Row Edit | `/health/nutrition/chicken-breast/`, `/health/physique/2026-10-03/` |
| Row duplicate | `/finance/transaction/2026-10-05-grocer/duplicate/` |
| Bulk Edit | `/finance/transaction/bulk-edit/` |

- **Row names:** a row uses its label or date; repeats get `-2`, `-3`… in sheet order.
- **Reloading a form address** opens straight onto that form once data loads; signed out, it waits for sign-in.
- **Running locally:** row addresses need `scripts/serve.py` (see [Getting started](../development/getting-started.md)).
- **Full list:** [Site map](../reference/site-map.md).

### Motion

- **Down / up:** going a level deeper (section → page → form) slides the old screen up and the new one in from below; back up reverses it.
- **Sideways:** moving on the same level (next section, next page, next Settings tab) slides left or right in menu order.
- **Back and Forward:** follow the same rules, worked out from where you are and where you land.
- **What moves:** only cards and fields; the breadcrumb, bars, sidebar and background stay put.

### Layout and accessibility

- **One layout:** it reflows by width; there is no separate mobile site.
- **iPhone:** tapping a field never zooms the page; pinch-zoom still works.
- **Dialogs:** focus is trapped inside and returned on close; focus rings stay visible.
- **Hidden pages** are taken out of the tab order and find-in-page.

## Code

| File | Role |
|---|---|
| `assets/script/page-nav.js` | Hubs, tiles, sidebar, action bar and badges |
| `assets/script/router.js` | Addresses, history and forms as pages |
| `assets/script/section-page.js` | Builds a section page from the home page's markup |
| `assets/script/motion.js` | Every slide, the toast and confetti |
| `assets/script/app.js` | Shortcuts, switches, account menu and toasts |

## Related

- [Home](home.md): the overview page and its widgets.
- [Site map](../reference/site-map.md): every address and breadcrumb.
- [Design system](../reference/design-system.md): colours, buttons and tables.
