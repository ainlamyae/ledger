# Data access

[Docs](../README.md) › Development

How Ledger reads and writes Google Sheets, stays under Google's quota, and what it caches.

## At a glance

- **One wrapper:** every Sheets call goes through `sheets.js`, which adds the token and handles 401 and 429.
- **Reads are batched:** reads made within 20 ms share one `values:batchGet`, and the tab list is fetched once per load.
- **Typed text stays as typed:** text is never turned into a formula, number, date or boolean.
- **Only the app's own cells change:** your extra columns and formulas survive every edit.
- **No data cache:** every load and **Refresh** reads the sheet; only public stock prices are kept in the browser.

## Reading

- **Batching:** `getValues` calls within 20 ms go out as one `values:batchGet`; a failed batch retries range by range, so one missing tab fails only its own block.
- **Tab list:** fetched once per load and shared; dropped before and after any `batchUpdate` and on **Refresh**.
- **Per page:** each page reads only the tabs it shows (see [Architecture](architecture.md)).
- **Text cells:** read with `cellText()`, so digits Sheets stored as numbers ("711", "4165550100") still read as text.
- **Dates and times:** normalised to `YYYY-MM-DD` and `HH:MM`, whatever format the column displays.
- **Columns by header:** Physique, Nutrition and LeetCode find columns by header name; a missing header is added after the last used column.
- **No row limits:** open ranges such as `A2:F` and `A1:ZZ`, so tables can grow and wide tabs read past column Z.
- **Quoted ranges:** built with `sheetRange()` from `CONFIG.SHEETS`, so tab names with spaces work.

## Writing

- **Text written `RAW`:** names, notes, payees, phone numbers and workout lines are stored exactly as typed (`=1+1`, `00123`, `1/2`, `TRUE`).
- **Mixed rows:** a row that must be `USER_ENTERED` for a date or formula writes each text cell through `sheetText()` instead.
- **Own columns only:** Physique, Nutrition, LeetCode and Transaction edits write one cell per changed field, never the whole row.
- **Formulas kept:** a Transaction Amount or Account cell typed as a formula keeps it unless that value is changed.
- **Appends:** `appendValues` reads the tab and appends after the last row holding data, so a blank row inside a table can't misplace it.
- **Sheet ids:** looked up on every load, so a spreadsheet switch can't send a delete to the wrong tab; id `0` is valid.
- **New tabs:** `ensureSheetTab` creates `Watchlist`, `Trade`, `Analysis` or `LeetCode` once, even if two saves race.
- **One request where possible:** multi-step writes (Breakdown add, Work Time edit, Nutrition headers) go as one `batchUpdate`.
- **Failures are shown:** a failed write always reaches the user as a field error, toast or alert, naming the failed step.
- **After a write:** only the affected tab is re-read and re-rendered; the page doesn't reload.
- **Busy buttons:** the clicked button shows `…` and ignores clicks until the write settles; Settings saves run one at a time.
- **Bulk deletes:** one `batchUpdate`, highest row first, with an Undo toast.

## Quota and retries

| Case | What happens |
|---|---|
| Google's limit | 60 read requests per minute per user; a request counts once however many ranges it holds |
| 429 Too Many Requests | Waits `Retry-After`, or 2, 4, 8, 16, 32 s plus jitter, up to 5 retries (about a minute), then shows Google's error |
| 401 Unauthorized | Renews the token once (inside the user's click) and re-sends the same request |
| No token at save | Signs in from the Save click first; a background read never opens a window |

- **Load cost:** the console logs `[sheets] <page> load: N requests` and `[load] <page>: page + sign-in … ms, data … ms`.

## Caching

- **Sheet data:** never cached; a change in the sheet shows on the next load.
- **Stock prices:** kept in IndexedDB (`ledger-market`) and only topped up after the first fetch.
  - Daily bars are rechecked at most every 30 minutes, or 4 hours for the background alert check.
  - Intraday bars stay fresh 5 minutes (5-minute bars) or 15 minutes (30-minute bars); news for an hour; month-end bars for a day.
  - The day's call counts sit in `localStorage` (`ledger_market_quota`).
  - Both are cleared on sign-out and by **Clear cache**, since they show which stocks you follow.
- **Service worker:** none; `sw.js` and `page-boot.js` remove one left from older installs.
- **Clear cache** (account menu): clears Cache Storage, service workers, old `ledger_cache_*` keys and the stock cache, re-fetches own scripts and styles with `cache: 'reload'`, then reloads.
- **Kept by Clear cache:** sign-in and preferences.

## Related

- [Data model](../reference/data-model.md): every sheet tab, column by column.
- [Architecture](architecture.md): system, section pages, boot order, modules, tech stack.
- [Configuration](configuration.md): `CONFIG`, `Setting` keys and browser storage.
- [Security](security.md): scopes, secrets, what leaves the browser, CSP, pinned libraries.
