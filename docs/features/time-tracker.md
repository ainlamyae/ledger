# Time Tracker

[← Features](README.md) · [README](../../README.md)

## Time Tracker

- **Log a Work Time** modal — Company, Start/End, Break, optional Task; live duration preview. The modal keeps the long name; the button that opens it is the app-wide one-word **Log**.
  - Break is an `HH:mm` duration typed into a plain text input (`pattern="[0-9]{1,2}:[0-5][0-9]"`), not a clock time — a `type="time"` control (still used for Start/End) would force an AM/PM time-of-day picker onto it. `parseBreakMinutes` reads the typed value back into minutes for the live duration preview, and `minutesToTimeInput` normalizes it back to an `"H:MM"` string on save, since some Break columns carry pre-existing Excel-style duration formatting that reinterprets a raw integer as a day count.
- Company autocompletes and defaults to the most recently logged one.
- A **`Log`** badge on an unlogged weekday, scoped to your current company, opening today's day; with notifications allowed (account menu → **Enable notifications**) Chrome shows "Work Time: log today" once a day.
- One **Work Time** panel holds the lot, charts above the table — they read the same logged hours, so they collapse together rather than sitting in a separate panel:
  - Arrival, Departure and Hours Worked histograms with normal-curve overlays, plus Daily Hours Average by period.
  - **Overtime summary** — net time beyond an 8h/day pace, broken out Total/Year/Month/Week.
  - The table itself — date range, sortable, computed Duration, inline edit, paginated.
