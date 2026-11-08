# Layout & Interaction

[← Features](README.md) · [README](../../README.md)

## At a glance

- **Keyboard shortcuts** work from any page: `/` filter payees, `n` log a transaction, `Esc` close, `?` help.
- **Saving never closes a form:** 💾 shows "Saved" in the toast at the bottom (no Undo); an Add becomes the new row's Edit. Only ❌ closes.
- **Results and progress are toasts** (`showToast`): Saved, Physique's 🧮 Calculate notes (♻️ reused, 🔗 combined, ⚠️), Checking/Updating N Physique days…, Capitalize, a clean Pull Micronutrients, Tune's Saved/Updated. 3s to 12s by length, wrapping on a phone. Every other message written on a page goes there too, errors in red (6s or more); only yes/no confirmations (`confirm()`) stay as they are.
- Physique filters by its search box alone (no From/To).
- **Export Transactions** and **Export Physique** (CSV, every row) live in Settings (account menu).
- Notifications for Work Time and Car Service: account menu → **Enable notifications**.
- iPhone Safari never zooms on a tapped field (`maximum-scale=1.0`, 16px touch fields); pinch-zoom still works.
- **Every field sits in a titled card** (`.panel-section.card` + `h3`): a table's search, filters and page buttons in its table's card; range rows in a **Range** card; AI questions in an **Ask** card; Market's stock picker in **Stock**; Application's search and list in **Applications**; Settings' tabs in Settings. Hints, status lines and action bars stay outside. A field row ending its card adds no space under it.
- Range-button rows (Health Chart, Health Insight, Finance Chart, Settings' tabs) are Market's `.pagination` row of `.btn`, current one `.btn-primary`, with `.panel-range`: nothing above, `--space-s` below. Work Time still uses From/To.
- From/To pairs keep 30px fields and `--space-s` after them. Every pair of fields side by side (From/To, a form's pairs, filter rows) is `--field-pair-gap` apart: 8px, 16px at ≤1179px.
- The footer reads `© 2026 ALI — Ledger v3.3.6`, its two parts joined by a spaced em dash, a real character so search engines and AI read the break: the copyright with its owner first (ALI links to the author's site; the year is the current one), then the product and its version (Ledger links home; the version is stamped per commit).
  - The same facts are in `index.html`'s head for machines: `<meta name="author" content="ALI">` and a schema.org `WebApplication` JSON-LD block (name, URL, description, author and copyright holder ALI, copyright year). It carries no version — that changes every commit and only `version.js` is stamped.
- The copyright line sits in a slim strip fixed at the bottom of the screen at every width (`--phone-footer-height`), half see-through at its top and solid at the screen edge; on a phone it is under the bottom bar and 10px lower, nearer the home indicator. Short pages fit without scrolling.
- On a phone a solid strip in the page colour covers the status-bar area (`env(safe-area-inset-top)`), so iOS Safari has nothing to blur as the page scrolls under it.
- Every search box reads `🔍 Search`, as on iOS; what it searches is its hover title.
- The last-load timestamp (`setLastUpdated`, "Updated 11:00:44") lives in the account menu, under the email and above Refresh data — not in the header, at any width.

## Layout and interaction

### Responsive layout

- One layout with a breakpoint ladder (950/820/800/420px, plus the 1179/1180px nav split); no separate mobile view.
- **Forms are pages**, not overlays (see [Hubs, Pages & Addresses](navigation.md)). Only dialogs that aren't pages (keyboard shortcuts, confirmations, forms opened on the home page) stay overlays.
- **Tablet and phone (≤1179px), the same bottom-bar nav at every width in that range:**
  - No top bar: the header box is `display: contents`, its logo hidden; the breadcrumb's **Ledger** goes home.
  - The account avatar and menu (or a round 🔑 sign-in button) sit bottom-left over the bottom bar; the menu holds the show/hide settings as iPhone switches.
  - Ledger / Health / Finance / Track become a fixed bottom tab bar; page content gets bottom padding to clear it.
  - The tab bar and the page's action bar are pills floating `--bottom-bar-inset` off the edges, with half-circle ends and ❌ as a round button. Lighter glass than the rest (40% opacity, 12px blur). No tab is marked active or changes colour on hover.
- **Wide screens (≥1180px):** a sidebar replaces the top bar (see [Hubs, Pages & Addresses](navigation.md)). There is no intermediate top-bar state — the layout is bottom-bar-or-sidebar with nothing in between.

### Motion

All of it lives in `motion.js` (`window.Motion`): its CSS, keyframes and view transitions too, so no other file or stylesheet animates. Web Animations ride over every `.modal`'s and the toast's `hidden`, so every write stays synchronous. Only cards and fields move; the background never does.

- **Timing:** every page and form move (`down`, `up`, `sideways`) on one even curve, `SWIPE` (1.5s, `cubic-bezier(.45, 0, .2, 1)`); only the toast keeps a spring (`spring`, `POP`).
- **Two motions only, named `down`, `up` and `sideways`** (`motion.js`), all slides, never a fade, on one even 1.5s curve (`SWIPE`):
  - **Down / up, by the breadcrumb:** a level down (Ledger → section → page → view → form → a form opened from a form, Workouts → a group) the old screen goes off the top while the new one rises from the bottom; a level up the reverse: the old one goes off the bottom while its parent comes down from the top.
  - **Sideways, on the same level:** sections in menu order (Health, Finance, Track, then Other), a section's pages in their tile order (Transaction → Account), a page's views in their button order (Settings' tabs). Going on in the order, the new one comes in from the right as the old one goes out the left; going back, the mirror.
  - Browser Back and Forward follow the same rules (the move is worked out from where you are and where you land, not from which button you pressed).
  - A dialog that isn't a page (on the home page) moves down to open and up to close, its glass backdrop fading.
- **Only cards and fields move.** The breadcrumb, the background, the tab bar, the action bar with its emoji buttons, the account button, the copyright footer and, on a wide screen, the logo row (logo, Ledger, the sidebar's toggle) and the left sidebar stay put and on top of everything that moves. Nothing moving takes the bar out of its page: what moves is everything around it (a form card by `top`, so its fixed bar stays fixed).
- **Across page loads** (`html[data-move]` + `--move-side`): each page notes its address in `sessionStorage` as it leaves (`pagehide`, and on a link's click); the next page reads it in motion.js's head code, so it works without the Navigation API (Safari). Both pages move together through cross-document View Transitions (`down-in`/`down-out`, `up-in`/`up-out`, `sideways-in`/`sideways-out`), the backdrop drawn under them and the held parts over them; what moves is each page's content alone (`body`, named `app-page` and see-through while moving: `html[data-move]`, and `data-move-out` on the leaving page from `pageswap`), never a whole-page image, which would carry the canvas colour; moves are by the screen (`100vh`/`100vw`), the leaving page kept where it was scrolled (`--move-old-y`); so the one background (`#app-backdrop`, the same on every page) never moves; the arriving page's own held parts stay hidden until it lands. A section page builds itself after loading (`section-page.js`); if it's still building when the move starts, both pages hold still (`html[data-move-wait]`) until it's built (`Motion.enterPage`), so the new page never comes in blank. A browser without page transitions moves just the new page's cards in. No motion on a reload or a fresh open.
- **Toast** springs up from the bottom and sinks away. Buttons give under a press and spring back.
- It plays even with the system's animation effects turned off.

### Fields and alignment

- Field text is 15px at every width (`--input-font-size`); on a touch screen fields are 16px so iPhones never zoom.
- Every field is left-aligned and every button's text centred, each by one `!important` rule; the account menu is the one left-aligned exception.

### Panels and tables

- A panel's primary actions sit on its heading line (`.panel-header`). Bars below it are for selection bars, secondary sets (contact exporters) and submits that belong under their content (**Send to AI**).
- A hidden panel's content gets `inert` (`setPanelCollapsed`, `app.js`), so it leaves the a11y tree, tab order and find-in-page.
- Panel headings are one word: **Activity**, **Nutrition**, **Account**, **Contact**, **Chart**.
- Sheet tab names live only in `CONFIG.SHEETS` (`config.js`), so renaming a tab is one line.
- Charts live in the panel of the data they describe: Work Analytics in Work Time, Travel Insights in Travel, Protein Source Rotation in Chart.
- `.table-compact` is the one dense-table look, shared by every table of short figures; per-table widths stay scoped to their own id.
- Every table is as wide as its columns' text (`table { width: fit-content; max-width: 100% }`), not the panel's full width, so columns carry no spare gaps; a table wider than the panel scrolls sideways.
- A form for one calendar day appends ` — {date}` to its title (`formTitleWithDate`, `ui-helpers.js`): *Edit Physique — 2026-08-23*. A dateless Pattern keeps the bare title.

### Stacking order

| Layer | z-index |
|---|---|
| Page chrome | 0–9 |
| Header | 10 |
| Dropdowns | 20–21 |
| Modals | 100 |
| Toasts, phone suggestion lists, chart hovers | 110 |
| Confetti, warning pulse | 120 |

A form's ❌ is the last button in its own actions row, so a long form closes from wherever you scrolled to.

### Behaviour

- **Keyboard shortcuts** — `/` filters transactions by payee, `n` logs a transaction, `Esc` closes a form or menu, `?` toggles help. From any page, `/` and `n` go to the Transaction page or its Log form. Ignored while typing.
- **Saving never closes a form** (`showFormSaved`, `stayOnSavedForm`): 💾 writes the row and shows "Saved" in the undo toast's box without ↩️ (`showToast`, gone after 3s); an Add or Log becomes that row's Edit, its address and breadcrumb moved to the row. Transfer clears its amount; Bulk Edit keeps its rows ticked. Only ❌, Back, Cancel or Esc close a form.
- **Physique's page has no From/To dates**: its table is narrowed by the search box alone.
- **Exports live in Settings** (account menu): **Export Transactions** and **Export Physique** download every row as CSV (`exportTransactionsCSV`, `exportPhysiqueCSV`, `csv.js`), whatever the filters.
- **Printing** (`@media print`, `styles.css`) — drops the nav, sidebar, footer, buttons and range pickers; a single chart box, not a whole panel, avoids a page break (a page-tall panel was pushed whole to sheet 2, leaving sheet 1 blank); legend swatches print their colour without Background graphics; canvases keep their proportions (`object-fit: contain`), so donuts stay round; the Rotation row keeps its 550px bar beside the donut on A4.
- **Accessibility** — `role="dialog"`/`aria-modal` on dialogs, focus trap and restore, keyboard-operable headers, visible focus rings.
- **Dark mode** — floating toggle, persisted.
- **Privacy mode** — floating toggle masks amounts, health figures, contact details and Settings values.
- **Widget and bulb visibility** — the account menu's **Hide widgets** and **Hide bulbs** affect the home page only, kept in the `SHOW_WIDGETS` / `SHOW_BULBS` Settings (0/1, like `SHOW_AMOUNTS`).
- **No service worker** — see [Caching Strategy](../caching.md).
