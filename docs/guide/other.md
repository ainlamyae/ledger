# Other

[Docs](../README.md) › Guide

The Other section holds Settings, opened from the account menu rather than a tab or tile.

## At a glance

- **Where:** the sidebar's bottom panel on a wide screen, otherwise the account menu; there's no Other tab or home card.
- **Settings** (`/other/settings/`): every key on the Setting tab, in five tabs, with CSV exports.
- **Changes apply live:** a saved setting takes effect without a reload.

## Settings

### What it shows

- **Table:** Note, Key, Value, alphabetical; Note and Value are cut at 32 characters, the full text on hover and in Edit.
- **Tabs:** one group at a time, each with its own address.

| Tab | Address | Keys |
|---|---|---|
| AI & Keys | `/other/settings/ai/` (also bare `/other/settings/`) | `AI_*`, `*_API_KEY`, `*_MODELS`, tokens and secrets |
| AI Responses | `/other/settings/responses/` | `*_LAST_RESULT`, `*_LAST_GENERATED_AT` |
| Health | `/other/settings/health/` | Every key no other tab claims: profile and Tune values |
| Display | `/other/settings/display/` | `SHOW_*`, `WIDGET_*` |
| All | `/other/settings/all/` | Every key |

- **Secrets:** keys ending in `API_KEY`, `_TOKEN` or `_SECRET` are hidden; 👁️ reveals one for this session, 🙈 hides it.

### Actions

- **➕ Add** a setting; ✏️ edits a row (`/other/settings/<key>/`), 🗑️ deletes it.
- **Value:** a multi-line box, trimmed on save.
- **Export Transactions** and **Export Physique:** download every row of that tab as CSV, whatever the filters.

### Rules & calculations

- **Notes fill themselves:** a blank Note is filled with the app's default note for that key on save and on load.
- **Obsolete keys** are removed from the tab on load.
- **Kept elsewhere:** walking MET is the Activity tab's **Walk** row; BMR_cal comes from Physique.
- **AI provider:** `AI_PROVIDER` is `groq` (default) or `openrouter`, each with its own key and models setting.
  - **Models:** `GROQ_MODELS` or `OPENROUTER_MODELS` as JSON with a `"text"` and a `"vision"` model.
  - **Example:** `{"text": "openai/gpt-oss-120b", "vision": "qwen/qwen3.8-27b"}`; no model is built in.
  - **Errors:** a missing or invalid JSON shows an error naming the setting to fix.

## Data

| Tab | Columns used |
|---|---|
| Setting | Key, Value, Notes |

- **Columns in full:** see the [data model](../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/other-settings.js` | Settings tabs, form, default notes and secret masking |
| `assets/script/csv.js` | Export Transactions and Export Physique |

## Related

- [Navigation](navigation.md): the account menu and display switches.
- [Configuration](../development/configuration.md): what each setting key does.
- [Data model](../reference/data-model.md): every sheet tab, column by column.
