# Buttons

[← Features](README.md) · [README](../../README.md)

## At a glance

| Action | Emoji | | Action | Emoji |
|---|---|---|---|---|
| Save | 💾 | | Complete (USDA) | 🧲 |
| Add | ➕ | | Norm | 📏 |
| Log | 📝 | | GYM | 💪 |
| Update | 🔄 | | Send to AI | 🤖 |
| Scan | 📷 | | Reset | ♻️ |
| Calculate | 🧮 | | Today (Physique) | 📍 |
| Micronutrients | 🧬 | | Close | ❌ |

- Selection bars: 🔗 ✏️ 🗑️ 📱 📧.
- Emoji buttons are always white; the word shows on hover, for screen readers and in the breadcrumb (`…/ Add`). Busy: the emoji followed by `…`.
- Sizes: see [Design System → Buttons](../design-system.md#buttons).

## Button roles

- **Blue** — add or save (Add/Log buttons, Save, Save & Add Another, bank).
- **Amber** — spends an AI call (Send to AI, Calculate, Recalculate Selected).
- **Gray** — opens a modal/editor without itself committing anything (Today, Transfer) — its own commit button inside that modal is styled blue.
- **Red** — destructive, text labels only (the export filter's remove).
- **Default** — everything else, including all emoji buttons (close, delete) — an emoji on a dark fill is hard to read.
- Slow actions append `…` to the label and block re-clicks until they settle: all form saves, bulk merge/delete, every row delete, and the AI/USDA calls.
