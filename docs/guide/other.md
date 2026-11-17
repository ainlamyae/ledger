# Other

[Docs](../README.md) › Guide

The Other section holds Contacts and Settings, both opened from the account menu rather than a tab or tile.

## At a glance

- **Where:** the sidebar's bottom panel on a wide screen, otherwise the account menu; there's no Other tab or home card.
- **Contacts** (`/other/contact/`): a searchable address book with Google, phone and Outlook export, merge and bulk delete.
- **Settings** (`/other/settings/`): every key on the Setting tab, in five tabs, with CSV exports.
- **Changes apply live:** a saved setting takes effect without a reload.

## Contacts

### What it shows

- **Table:** First Name, Last Name, Phone, Email, Tags; 25 rows a page, sortable by name.
- **Privacy:** contact details are masked when the Amounts switch is off.

### Actions

- **➕ Add** (`/other/contact/add/`): name, prefix, tags, birthday, three phones, two emails, address, website, LinkedIn, two Telegrams, note.
- **🔍 Search:** name, tags, phone or email.
- **Row buttons:** ✏️ edit, 🗑️ delete.
- **Export all:** 📱 Export for Google/Phone and 📧 Export for Outlook download a CSV.
- **Select rows** to show the selection bar:

| Button | Does |
|---|---|
| 📱 | Export Selected for Google/Phone |
| 📧 | Export Selected for Outlook |
| 🔗 | Merge Selected into one contact |
| 🗑️ | Delete Selected |
| ❌ | Clear selection |

### Rules & calculations

- **Merge:** the highest contact in the sheet is kept; its filled fields stay as they are and its blanks are filled from the others.
  - **Lists:** phones, emails and Telegrams are combined without duplicates, up to each field's slots.
  - **Tags and notes:** combined from all, duplicates dropped; the other rows are then deleted (no undo).

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
| Contact | First, Middle, Last, Prefix, Tags, Birthday, Phone 1–3, Email 1–2, Street, City, Region, Postal, Country, Website, LinkedIn, Telegram 1–2, Note |
| Setting | Key, Value, Notes |

- **Columns in full:** see the [data model](../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/other-contact.js` | Contacts table, form, merge and export |
| `assets/script/other-settings.js` | Settings tabs, form, default notes and secret masking |
| `assets/script/csv.js` | Export Transactions and Export Physique |

## Related

- [Navigation](navigation.md): the account menu and display switches.
- [Configuration](../development/configuration.md): what each setting key does.
- [Data model](../reference/data-model.md): every sheet tab, column by column.
