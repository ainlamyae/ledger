# Design System

[← Back to README](../README.md)

All styling lives in `assets/style/styles.css`. Pages and scripts carry no inline `style`; scripts pass only computed numbers as custom properties (`--meter-pct`, `--col-width`, `--gradient-color`…). Changing that one file restyles the whole app.

## Colour

| Use | Values |
|---|---|
| Text | Six colours only: text, muted gray, white, red (bad), green (good), blue (links) |
| Charts | Their own palette, `--chart-*` tokens read by `chartColor` / `seriesColor` (`charts-base.js`) |
| Row tints | **Green** — today's row, or anything logged today · **Indigo** — a Work Time day off. No row is faded |
| Table lines | One colour, **navy** (`--color-nav`): row lines, the solid line above a Total, the dashed line above a Desire or Ideal/day |
| Backgrounds | Page **off-white** (`--color-bg`); cards, tiles, inputs, buttons, menus and GYM figures **white** (`--color-surface`) |

## Typography

One font family — the device's `system-ui` — for page text, fields, Tune's formulas and charts.

| Size | Used for |
|---|---|
| .7rem | Badges, formulas, footer strip, the plan's small cells |
| .8rem | Table cells, word buttons, labels, hints, menus |
| .9rem | Breadcrumb, sidebar, cards, tiles, chart text |
| 15px | Every input, select and textarea, at every width |
| 1.1rem | Headings, form titles, emoji buttons |
| 1.25rem | Header title |
| 1.4rem | Phone bottom-bar emoji, landing title, flags |

## Spacing and tokens

| Token | Values |
|---|---|
| Spacing | `--space-xs` … `--space-xxl`: .2rem, .5rem, .75rem, 1rem, 1.5rem, 2rem (only the sidebar's own layout sizes sit outside them) |
| Shadows | `--shadow-card` (cards, tiles) · `--shadow-dropdown` (menus, toast, phone bars, hover) |
| Line height | 1.2 text and controls · 1.5 paragraphs |
| Weight | One bold: 600 |
| Disabled | One opacity: .5 |
| Animation | .2s hover and colour · .3s open and close |
| Borders | 1px borders · 2px emphasis lines |

Each look is written once: every field starts from one base rule, and cards, Total/target rows, notes, dropdowns and field rows are single rules shared by several selectors.

## Tables

- Full width or as wide as their content; no column has a width of its own.
- Content-width tables: Physique, Contacts, Car Service, Activity Plan.
- `table-compact` tables have no row lines, only a solid line under the header row.
- Fixed row heights at every width:

| Row | Height |
|---|---|
| Header or text row (no vertical cell padding, 16px lines) | 19px |
| Text wrapping onto two lines | 32px |
| Row with buttons | 29px |

Row buttons (✏️ 📋 🧬 🗑️) always stay side by side on one line.

## Buttons

| Height | Used for |
|---|---|
| 24px | Row buttons in tables |
| 30px | Every other button — same as a field |
| 42px | Phone action bar and tiles |

- Same heights on laptop and phone; emoji buttons are square.
- Two `!important` rules set alignment: field text is **left**-aligned (dates included, which iOS would centre), button text is **centred**. The account menu is the one exception, a left-aligned list.
- Emoji buttons are always white, never coloured; colours mark word buttons only. See [Buttons](features/buttons.md).
