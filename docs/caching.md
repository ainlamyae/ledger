# Caching Strategy

[← Back to README](../README.md)

- `index.html` is served `no-cache, no-store, must-revalidate`, so the shell is never stale.
- Sheets responses are cached in `localStorage` for 5 minutes, keyed per data set.
- Every write refreshes only the affected cache entry, so the UI updates without a reload.
- **Refresh** clears the cache and re-fetches everything.
- **Clear Cache** also purges Cache Storage and unregisters service workers, then reloads.
- **A cache write failure never blocks the data it was caching.** `setCached` catches its own `localStorage.setItem` (most commonly `QuotaExceededError` — Nutrition rows carrying a large banked Micronutrients JSON blob can push the origin over its ~5-10MB quota) and just skips that write with a console warning, since every caller already has the real, freshly-fetched data in memory regardless of whether the warm-start for next time succeeded.

> After changing a sheet's column layout, expect up to 5 minutes of stale reads until the cache expires — or use Clear Cache. Writes always bypass the cache.

---

