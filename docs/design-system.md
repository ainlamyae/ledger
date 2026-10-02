# Design System

[← Back to README](../README.md)

All styling lives in `assets/style/styles.css`. Pages and scripts carry no inline `style`; scripts pass only computed numbers as custom properties (`--meter-pct`, `--col-width`, `--gradient-color`…). Changing that one file restyles the whole app.

## Colour

| Use | Values |
|---|---|
| Palette | Apple's system colours, light / dark: blue `#007AFF` / `#0A84FF`, green `#34C759` / `#30D158`, red `#FF3B30` / `#FF453A`, gray `#8E8E93`; page `#F2F2F7` / true black, cards `#FFFFFF` / `#1C1C1E`, lines `#C6C6C8` / `#38383A` |
| Text | Six colours only: text, muted gray, white, red (bad), green (good), blue (links) |
| Charts | Their own palette, `--chart-*` tokens read by `chartColor` / `seriesColor` (`charts-base.js`) |
| Row tints | **Green** — today's row, or anything logged today · **Indigo** — a Work Time day off. No row is faded |
| Table lines | One colour, the line **gray** (`--color-border`), as iOS separators: a .5px hairline between rows; 1px under the header, above a Total and at group breaks; 1px dashed above a Desire or Ideal/day |
| Backgrounds | Page **off-white** (`--color-bg`) under two soft blue/violet washes (`--bg-wash-1`/`-2`, fixed to the screen); cards, inputs, buttons and GYM figures **white** (`--color-surface`); page tiles Apple-style **tinted** capsules (12% of `--color-primary` under blue text, `border-radius: 999px`; dimmed and shrunk while pressed), so they stand out on a card and on the page alike — content is always solid |
| Glass | The floating layer only, like Apple's Liquid Glass: header, phone tab bar and action bar, sticky form actions, sidebar, account menu and (wide screens) dialogs. Translucent `--glass-bg` / `--glass-bg-strong`, blurred by `--glass-blur`, a `--glass-border` rim and `--glass-highlight` top edge; text on it is `--glass-text`. Solid again when blur is unsupported or the device asks for reduced transparency |

## Typography

One font family — the device's `system-ui` — for page text, fields, Tune's formulas and charts.

Four sizes, as tokens — every `font-size` is one of them — on one 15px base at every width. One weight for bold (600), no italic, no all-caps.

| Token | Size | Used for |
|---|---|---|
| `--text-small` | .8rem | Card content (`--card-text-size`, set on `.card`), table cells (every width), word buttons, labels, hints, menus, badges, formulas, footer, card labels, sidebar section names, chart text |
| `--text-body` | .9rem | Text, tiles, breadcrumb, sidebar links, status lines |
| `--text-title` | 1.1rem | Every heading (header title, panel and form titles, `h1`–`h4`), emoji buttons |
| `--text-display` | 1.4rem | Phone bottom-bar emoji, landing title, flags |
| `--input-font-size` | 15px (16px on touch) | Every input, select and textarea — 16px keeps iOS from zooming |

## Spacing and tokens

| Token | Values |
|---|---|
| Spacing | `--space-xs` … `--space-xxl`: .2rem, .5rem, .75rem, 1rem, 1.5rem, 2rem (only the sidebar's own layout sizes sit outside them) |
| Shadows | `--shadow-card` (cards, tiles) · `--shadow-dropdown` (menus, toast, phone bars) · `--shadow-hover` (the lift on a hovered tile or panel, darker) |
| Line height | 1.2 text and controls · 1.5 paragraphs |
| Weight | One bold: 600 |
| Disabled | One opacity: .5 |
| Animation | .2s hover and colour · .3s open and close · one Apple-like spring curve on all of them (`--ease-spring`, `cubic-bezier(.2, .8, .2, 1)`) |
| Borders | 1px borders · .5px table hairlines |

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
