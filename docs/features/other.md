# Other

[← Features](README.md) · [README](../../README.md)

## At a glance

- **Settings** (`/other/settings/`): the one Settings page, every key, alphabetical. **Value** is a multi-line box, trimmed on save.
  - Values that live elsewhere are not Settings: walking MET is the Activity sheet's **Walk** row; BMR_cal comes from Physique's Derived cell. Obsolete keys are deleted on load.

## Other

- **Contacts** — searchable, paginated list; bulk export (Google/Outlook CSV), delete and merge.
- **Settings** — Key/Value/Notes table for the `Setting` tab, applied to live widgets without a reload.
- **No caching** — every load and Refresh reads the sheets directly; see [Caching](../caching.md).
