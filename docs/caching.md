# Caching Strategy

[← Back to README](../README.md)

The app caches nothing: no service worker, no stored copy of sheet data.

- Every page load and every **Refresh** reads the sheets directly, so a change in the sheet (a value, a column layout) shows on the next load.
- Every write re-reads only the affected data, so the UI updates without a reload.
- `sw.js` is kept only as a retired stub: browsers that installed the old offline worker pick it up, and it deletes its caches and unregisters itself. `index.html` also removes any leftover registration on load.
- `cache.js` deletes any `ledger_cache_*` keys earlier versions left in `localStorage`.
- One full load reads about 18 ranges. Google's Sheets limit is 60 reads per minute per user, so several Refresh clicks inside a minute can hit it; `sheetsRequest` (`sheets.js`) then waits and retries (2s doubling to 32s, about a minute in total) before reporting "Quota exceeded".

---

