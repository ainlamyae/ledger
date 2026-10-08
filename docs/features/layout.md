# Layout & Interaction

[← Features](README.md) · [README](../../README.md)

## At a glance

- **Keyboard shortcuts** work from any page: `/` filter payees, `n` log a transaction, `Esc` close, `?` help.
- **Saving never closes a form:** 💾 shows "Saved"; an Add becomes the new row's Edit. Only ❌ closes.
- Physique filters by its search box alone (no From/To).
- **Export Transactions** and **Export Physique** (CSV, every row) live in Other › Settings.
- Notifications for Work Time and Car Service: account menu → **Enable notifications**.
- iPhone Safari never zooms on a tapped field (`maximum-scale=1.0`, 16px touch fields); pinch-zoom still works.
- From/To pairs keep 30px fields, a 16px gap on a phone, and `--space-s` after them.
- On a phone the copyright line sits in a slim strip under the bottom bar; short pages fit without scrolling.

## Layout and interaction

### Responsive layout

- One layout with a breakpoint ladder (950/820/800/640/420px); no separate mobile view.
- **Forms are pages**, not overlays (see [Hubs, Pages & Addresses](navigation.md)). Only dialogs that aren't pages (keyboard shortcuts, confirmations, forms opened on the home page) stay overlays.
- **Phone (≤640px):**
  - No top bar: the header box is `display: contents`, its logo hidden; the breadcrumb's **Ledger** goes home.
  - The account avatar and menu (or a round 🔑 sign-in button) sit bottom-left over the bottom bar.
  - Health / Finance / Other become a fixed bottom tab bar; page content gets bottom padding to clear it.
  - The tab bar and the page's action bar are pills floating `--bottom-bar-inset` off the edges, with half-circle ends and ❌ as a round button. No tab is marked active.
- **Wide screens (≥1180px):** a sidebar replaces the top bar (see [Hubs, Pages & Addresses](navigation.md)).

### Fields and alignment

- Field text is 15px at every width (`--input-font-size`); on a touch screen fields are 16px so iPhones never zoom.
- Every field is left-aligned and every button's text centred, each by one `!important` rule; the account menu is the one left-aligned exception.

### Panels and tables

- A panel's primary actions sit on its heading line (`.panel-header`). Bars below it are for selection bars, secondary sets (contact exporters) and submits that belong under their content (**Send to AI**).
- A hidden panel's content gets `inert` (`setPanelCollapsed`, `app.js`), so it leaves the a11y tree, tab order and find-in-page.
- Panel headings are one word: **Activity**, **Nutrition**, **Account**, **Contact**, **Indicator**.
- Sheet tab names live only in `CONFIG.SHEETS` (`config.js`), so renaming a tab is one line.
- Charts live in the panel of the data they describe: Work Analytics in Work Time, Travel Insights in Travel, Protein Source Rotation in Indicator.
- `.table-compact` is the one dense-table look, shared by every table of short figures; per-table widths stay scoped to their own id.
- A form for one calendar day appends ` — {date}` to its title (`formTitleWithDate`, `ui-helpers.js`): *Edit Physique — 2026-08-23*. A dateless Pattern keeps the bare title.

### Stacking order

| Layer | z-index |
|---|---|
| Page chrome | 0–9 |
| Header | 10 |
| Dropdowns | 20–21 |
| Modals | 100 |
| Toasts, phone suggestion lists | 110 |
| Confetti | 120 |

A form's ❌ is the last button in its own actions row, so a long form closes from wherever you scrolled to.

### Behaviour

- **Keyboard shortcuts** — `/` filters transactions by payee, `n` logs a transaction, `Esc` closes a form or menu, `?` toggles help. From any page, `/` and `n` go to the Transaction page or its Log form. Ignored while typing.
- **Saving never closes a form** (`showFormSaved`, `stayOnSavedForm`): 💾 writes the row and shows "Saved"; an Add or Log becomes that row's Edit, its address and breadcrumb moved to the row. Transfer clears its amount; Bulk Edit keeps its rows ticked. Only ❌, Back, Cancel or Esc close a form.
- **Physique's page has no From/To dates**: its table is narrowed by the search box alone.
- **Exports live in Other › Settings**: **Export Transactions** and **Export Physique** download every row as CSV (`exportTransactionsCSV`, `exportPhysiqueCSV`, `csv.js`), whatever the filters.
- **Accessibility** — `role="dialog"`/`aria-modal` on dialogs, focus trap and restore, keyboard-operable headers, visible focus rings.
- **Dark mode** — floating toggle, persisted.
- **Privacy mode** — floating toggle masks amounts, health figures, contact details and Settings values.
- **Widget and bulb visibility** — the account menu's **Hide widgets** and **Hide bulbs** affect the home page only, kept in the `SHOW_WIDGETS` / `SHOW_BULBS` Settings (0/1, like `SHOW_AMOUNTS`).
- **No service worker** — see [Caching Strategy](../caching.md).
