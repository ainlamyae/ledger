# Other

[← Features](README.md) · [README](../../README.md)

## At a glance

- Both pages open from the account area: **Contact** at the top of the group with Refresh data and Clear cache, **Settings** under Clear cache (the sidebar's bottom panel on a wide screen, else the account menu); the section has no tab, sidebar heading or home card of its own.

- **Settings** (`/other/settings/`): the one Settings page, alphabetical. **Value** is a multi-line box, trimmed on save.
  - A row of tab buttons above the table (the Market range buttons' style) shows one group at a time: **AI & Keys** (`AI_*`, `*_API_KEY`, `*_MODELS`, tokens/secrets), **AI Responses** (`*_LAST_RESULT`, `*_LAST_GENERATED_AT`), **Health** (every key no other tab claims — profile and tune values), **Display** (`SHOW_*`, `WIDGET_*`) and **All**.
  - Each tab has its own address — `/other/settings/ai/`, `/responses/`, `/health/`, `/display/`, `/all/` (stubs under `other/settings/`) — so a reload, Back or shared link lands on it. The bare `/other/settings/` is AI & Keys.
  - Values that live elsewhere are not Settings: walking MET is the Activity sheet's **Walk** row; BMR_cal comes from Physique's Derived cell. Obsolete keys are deleted on load.
  - **AI provider**: `AI_PROVIDER` is `groq` (default) or `openrouter`. Each provider has its own key (`GROQ_API_KEY`, `OPENROUTER_API_KEY`) and its own models JSON (`GROQ_MODELS`, `OPENROUTER_MODELS`), with a `"text"` model (Calculate, Insight) and a `"vision"` model (photo and label Scan), e.g. `{"text": "openai/gpt-oss-120b", "vision": "qwen/qwen3.8-27b"}`. No model is built into the code; a missing or invalid JSON shows an error saying which setting to fix.

## Other

- **Contacts** — searchable, paginated list; bulk export (Google/Outlook CSV), delete and merge.
- **Settings** — Note / Key / Value table for the `Setting` tab (Note and Value cut to 32 characters with …, full text on hover and in Edit), applied to live widgets without a reload.
- **No caching** — every load and Refresh reads the sheets directly; see [Caching](../caching.md).
