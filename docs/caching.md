# Caching Strategy

[← Back to README](../README.md)

The app caches nothing: no service worker, no stored copy of sheet data.

- Every page load and every **Refresh** reads the sheets directly, so a change in the sheet (a value, a column layout) shows on the next load.
- Every write re-reads only the affected data, so the UI updates without a reload.
- `sw.js` is kept only as a retired stub: browsers that installed the old offline worker pick it up, and it deletes its caches and unregisters itself. `index.html` also removes any leftover registration on load.
- `cache.js` deletes any `ledger_cache_*` keys earlier versions left in `localStorage`.
- **Clear cache** (account menu, under Refresh data; `clearCacheAndReload`) is for development or a stale browser: it clears Cache Storage, unregisters any service worker, deletes `ledger_cache_*` keys, re-fetches every same-origin script and stylesheet with `cache: 'reload'` so the browser's HTTP cache holds the current files, and reloads. Sign-in and preferences are kept.
- Reads are batched (`sheets.js`): the spreadsheet's tab list is fetched once per load and shared by every module (fetched again after Refresh or any `batchUpdate`), and `getValues` calls made within 20 ms of each other go out as one `values:batchGet`. Google's limit is 60 read **requests** per minute, not ranges, so a full load costs a handful of requests instead of ~28 (the console logs `[sheets] dashboard load: N requests`). A failed batch is retried range by range, so one missing tab fails only its own module. If the limit is still hit, `sheetsRequest` waits and retries (2s doubling to 32s) before reporting "Quota exceeded".
- Each page reads only what it shows: a Health page never reads Finance's tabs; the home page reads its cards' data plus Transactions and Work Time for badges (5 requests).
- The console logs where load time goes (`[load] health: page + sign-in … ms, data … ms`) and any background Physique write (`… writes and re-reads Physique`), which should only happen while stored figures are missing.

---
