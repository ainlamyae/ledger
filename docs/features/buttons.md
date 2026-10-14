# Buttons

[← Features](README.md) · [README](../../README.md)

## At a glance

| Action | Emoji | | Action | Emoji |
|---|---|---|---|---|
| Save | 💾 | | Complete (USDA) | 🧲 |
| Add | ➕ | | Norm | 📏 |
| Log | 📝 | | Workouts | 💪 |
| Update | 🔄 | | Send to AI | 🤖 |
| Scan | 📷 | | Reset | ♻️ |
| Calculate | 🧮 | | Today (Physique) | 📍 |
| Micronutrients | 🧬 | | Close | ❌ |

- Selection bars: 🔗 ✏️ 🗑️ 📱 📧.
- Emoji buttons are always white; the word shows on hover, for screen readers and in the breadcrumb (`…/ Add`). Busy: the emoji followed by `…`.
- Sizes: see [Design System → Buttons](../design-system.md#buttons).

## Button roles

Colour marks **word buttons** only; emoji buttons (`.btn-icon`, `.row-action-btn`, `.modal-close`) are always white, whatever role class they carry.

| Colour | Role | Examples |
|---|---|---|
| Blue | Add or save | Save & Add Another, Transfer's commit |
| Gray | Opens an editor without committing | Physique's Today button |
| Tinted tile | What a hub tile opens: gray rows, green form, orange chart, purple AI | Every hub tile (see [Hubs, Pages & Addresses](navigation.md)) |
| Red | Destructive, text labels only | The export filter's remove |
| Default | Everything else | |

- Slow actions show `…` and block re-clicks until they settle: form saves, bulk merge/delete, row deletes, AI and USDA calls.
- The router names a form's breadcrumb step from the button's word (`buttonStep`), so the trail reads `… / Add`.
