# Design system

[Docs](../README.md) › Reference

Ledger's colours, type, spacing, tables, buttons and chart rules, all defined in `assets/style/styles.css`.

## At a glance

- **One stylesheet:** pages and scripts carry no inline styles; scripts pass only numbers as custom properties (`--meter-pct`, `--col-width`).
- **Apple system palette:** iOS blue, green and red on an off-white (light) or true-black (dark) page.
- **Six text colours:** text, muted, white, red, green, blue; nothing else.
- **Four type sizes, one bold:** `system-ui` at 600 weight; no italic, no all-caps.
- **Reuse before adding:** copy an existing block, row, table pattern or animation rather than writing new CSS.

## Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-primary` | `#007AFF` | `#0A84FF` | Blue: links, primary buttons, active range |
| `--color-income` | `#34C759` | `#30D158` | Green: good, income, met |
| `--color-danger` | `#FF3B30` | `#FF453A` | Red: bad, expense, destructive |
| `--color-text` | `#1F2937` | `#E2E8F0` | Body text |
| `--color-text-muted` | `#8E8E93` | `#8E8E93` | Muted text, gray tile tint |
| `--color-muted` | `#64748B` | `#64748B` | Gray button background |
| `--color-other` | `#7C3AED` | `#7C3AED` | Purple: AI tiles |
| `--color-bg` | `#F2F2F7` | `#000000` | Page |
| `--color-surface` | `#FFFFFF` | `#1C1C1E` | Cards, fields, buttons |
| `--color-border` | `#C6C6C8` | `#38383A` | Every line and border |
| `--color-error-bg` | `#FEF2F2` | `#422006` | Error box background |
| `--switch-on` | `#34C759` | `#34C759` | Switch on |

## Text colours

| Name | Token | Use |
|---|---|---|
| text | `--color-text` | Everything by default |
| muted | `--color-text-muted` | Hints, labels, secondary figures |
| white | `#fff` | Text on a coloured button or cell |
| red | `--color-danger` | Bad, over, missed, errors |
| green | `--color-income` | Good, met, income |
| blue | `--color-primary` | Links |

- **No new shades:** a new state reuses one of these six.
- **On glass:** text uses `--glass-text` and `--glass-text-muted`, which resolve to text and muted.

## Surfaces

- **Page:** `--color-bg` under two fixed soft washes (`--bg-wash-1` blue, `--bg-wash-2` violet); it never moves.
- **Cards:** `--color-surface`, rounded `--radius-md` (8px), `--shadow-card`; every field sits in a titled card.
- **Glass:** the floating layer only: header, sidebar, phone tab bar, action bars, account menu and wide-screen dialogs.
- **Glass tokens:** `--glass-bg`, `--glass-bg-strong`, `--glass-blur`, `--glass-border`, `--glass-highlight`.
- **Phone bars:** lighter glass (40% surface, 12px blur); every glass turns solid without blur support or with reduced transparency.
- **Page tiles:** liquid-glass capsules over a 15% wash of `--tile-tint`; lift on hover, shrink while pressed.
- **Switches:** every show/hide setting is an iPhone switch (`.switch`), gray off, green on, label left.

| Tile kind | `--tile-tint` | Opens |
|---|---|---|
| Default | `--color-text-muted` (gray) | A page of rows |
| `form` | `#34C759` (green) | A form |
| `chart` | `#FF9500` (orange) | A chart |
| `ai` | `--color-other` (purple) | An AI view |

## Chart colours

| Token | Value | Use |
|---|---|---|
| `--chart-good` | `--color-income` | Desired met, within band |
| `--chart-good-high` | `#166534` | Beat desired, protein over band |
| `--chart-good-light` | `#4ADE80` | Fat over band |
| `--chart-near` | `#A3E635` | Near desired |
| `--chart-warn` | `#F59E0B` | Short of desired, Gaining zone |
| `--chart-bad` | `--color-danger` | Missed desired, Too Fast zone |
| `--chart-orange` | `#D97706` | Accent series |
| `--chart-neutral` | `#9CA3AF` | Unscored (grey) |
| `--chart-blue` | `--color-primary` | Accent series |
| `--chart-purple` | `--color-other` | Unscored activity with no body mass |
| `--chart-cyan` | `#0891B2` | Every desired mark on Health charts |
| `--chart-indigo` | `#6366F1` | Accent series |

- **Series hues:** `seriesColor` spreads categories evenly around the colour wheel at 65% saturation, 55% lightness.
- **Lookup:** scripts read tokens through `chartColor` and `seriesColor` (`charts-base.js`), so dark mode needs no chart code.
- **Meaning:** green met, red missed, grey not scored either way.

## Typography

| Token | Size | Used for |
|---|---|---|
| `--text-small` | .8rem | Card content, table cells, word buttons, labels, hints, menus, badges, chart text |
| `--text-body` | 13px | Body text, breadcrumb, sidebar links, status lines |
| `--text-title` | 1.1rem | Every heading (`h1`–`h4`), emoji buttons |
| `--text-display` | 1.4rem | Phone tab-bar emoji, landing title, flags |
| `--input-font-size` | 15px (16px on touch) | Every input, select and textarea |

- **Family:** `system-ui` for pages, fields, Tune's formulas and charts.
- **Weight:** 600 for bold; 400 otherwise.
- **Line height:** 1.2 for text and controls, 1.5 for paragraphs.
- **No zoom on iPhone:** 16px touch fields stop Safari zooming; pinch-zoom still works.

## Spacing and effects

| Token | Value |
|---|---|
| `--space-xs` / `-s` / `-m` | .2rem / .5rem / .75rem |
| `--space-l` / `-xl` / `-xxl` | 1rem / 1.5rem / 2rem |
| `--field-pair-gap` | `--space-s`; `--space-l` at ≤ 1179px |
| `--radius-md` / `--radius-lg` | 8px / 16px |
| `--shadow-card` | Cards, tiles |
| `--shadow-dropdown` | Menus, toast, phone bars |
| `--shadow-hover` | Lift on a hovered tile or panel |
| Disabled | Opacity .5 |
| Borders | 1px; table rows .5px |

| Motion | Value |
|---|---|
| Hover and colour | .2s |
| Fold and unfold | .3s on `--ease-spring` `cubic-bezier(.2, .8, .2, 1)` |
| Page leaving | .35s, `cubic-bezier(.4, 0, 1, 1)` |
| Page arriving | .55s, `cubic-bezier(.2, .8, .2, 1)` |
| Moves | Slides only (`down`, `up`, `sideways`), never a fade; all in `motion.js` |

## Tables

- **Width:** sized to their text (`width: fit-content`), scrolling sideways past the card.
- **In a card past 820px:** the table fills the card; only data columns grow, button and checkbox columns stay tight.
- **Cells:** 2.5px side padding, so columns sit 5px apart in every table at every width.
- **Lines:** one colour, `--color-border`: .5px between rows, 1px under the header, above a Total and at group breaks.
- **Dashed line:** 1px dashed above a Desire or Ideal/day row.
- **Compact:** `.table-compact` drops row lines, keeping the line under the header.
- **Row buttons:** ✏️ 📋 🧬 🗑️ always stay side by side on one line.

| Row | Height |
|---|---|
| Header or one-line text | 19px |
| Two-line text | 32px |
| Row with buttons | 29px |

| Row tint | Meaning |
|---|---|
| Green (`rgba(52, 199, 89, .13)`) | Today's row, or logged today |
| Indigo (`rgba(99, 102, 241, .07)`) | Work Time day off, weekend or holiday |

## Buttons

| Height | Used for |
|---|---|
| 24px | Row buttons in tables |
| 30px | Every other button, same as a field |
| 42px | Phone action bar and tiles |

- **Square emoji:** emoji buttons are square and always white, whatever role class they carry.
- **Alignment:** field text left-aligned, button text centred; the account menu is the one left-aligned list.
- **Busy:** a slow action shows its emoji then `…` and blocks re-clicks until it settles.
- **Names:** the word shows on hover, to screen readers and in the breadcrumb (`… / Add`).

| Role | Class | Colour | Examples |
|---|---|---|---|
| Commit | `.btn-primary` | Blue | Set, Select my Ledger, Add Filter, active range |
| Open an editor | `.btn-secondary` | Gray | 📍 Today, Tune |
| Destroy | `.btn-danger` | Red | Export filter's remove (word buttons only) |
| Default | `.btn` | White | Everything else |

| Emoji | Name | Emoji | Name |
|---|---|---|---|
| 💾 | Save | 🧲 | Complete (USDA) |
| ➕ | Add | 📏 | Norm |
| 📝 | Log | 💪 | Workouts |
| 🔄 | Update | 🤖 | Send to AI |
| 📷 | Scan | ♻️ | Reset |
| 🧮 | Calculate | 📍 | Today |
| 🧬 | Micronutrients | ❌ | Close |
| 🔀 | Transfer | 🔠 | Capitalize Names |
| 📥 | Import CSV | 📱 | Export for Google/Phone |
| 📧 | Export for Outlook | 📤 | Screenshot |
| 🔔 | Alerts | 📌 | Apply suggested alerts |
| 🖨️ | Print Cheat Sheet | 🔑 | Sign in |
| ✏️ | Edit | 📋 | Duplicate |
| 🗑️ | Delete | 🔗 | Merge Selected |
| ↩️ | Undo | 📝 | Log ticked |

- **Selection bars:** 🔗 Merge, ✏️ Edit, 🗑️ Delete, 📱 and 📧 exports, ❌ Clear selection.

## Charts

- **Legends are switches:** each entry hides its series; a hidden entry stays dimmed and struck through so it can come back.
- **Axes refit:** hiding an entry refits the axes to what's left.
- **Health legends:** entries in words (`Healthy Body Mass`), under each dated chart; hidden names last until reload.
- **Grades:** Beat desired, Desired met, Near desired, Short of desired, Missed desired; bands use Within/Over/Under desired.
- **Desired marks:** cyan on every Health chart.
- **Trend line:** one solid neutral curve with monotone interpolation, so it can't overshoot the data.
- **Health x axis:** 8 evenly spaced gridlines, first and last date on the edges.
- **Health y axes:** one fixed width on every dated chart so plot areas line up.
- **Currency axes:** dollar ticks as currency; hours and percentages stay plain numbers.
- **Hovers:** drawn over the page, beside the pointer and kept on screen; format in [Conventions](conventions.md).
- **Flush:** every chart sits directly under its card heading.
- **Screenshot:** 📤 on Health › Chart and Finance › Chart saves the page as a PNG.

## Responsive breakpoints

| Width | Change |
|---|---|
| ≥ 1180px | Sidebar navigation |
| ≤ 1179px | Bottom tab bar, no top bar, account button bottom-left; wider field gaps |
| ≤ 949px | Finance cards go two-up |
| ≥ 821px | A card's table fills the card |
| ≤ 820px | Phone layout: stacked cards, dropped columns (e.g. Muscle Group) |
| ≤ 800px | Narrower form-page gutter |
| ≤ 640px | Tap (not hover) opens nutrient sources |
| ≤ 560px | Tune keeps each formula row on one line, tightened |
| ≤ 420px | Cards one per row (Market and Portfolio stay two-up); one field per line |
| Touch | 16px fields |

## Stacking order

| Layer | z-index |
|---|---|
| Page chrome | 0–9 |
| Header | 10 |
| Dropdowns | 20–21 |
| Modals | 100 |
| Toasts, phone suggestion lists, chart hovers | 110 |
| Confetti, warning pulse | 120 |

## Print

- **Hidden:** navigation, sidebar, footer, buttons and range pickers.
- **Breaks:** a single chart box avoids a page break, not a whole panel.
- **Shapes:** canvases keep their proportions, so donuts stay round; legend swatches print their colour.

## Related

- [Conventions](conventions.md): names, units, dates and hover format.
- [Health formulas](health-formulas.md): every Health formula, constant and default.
- [Navigation](../guide/navigation.md): hubs, sidebar, tab bar, addresses, forms, motion, shortcuts, display switches.
- [Site map](site-map.md): every address and its breadcrumb.
