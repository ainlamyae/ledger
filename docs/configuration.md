# Configuration Reference

[← Back to README](../README.md)

**Sheet ranges read/written by the app:**

| Range | Used in | Purpose |
|---|---|---|
| `'Statement'!A1:Z149` | `app.js` | Header row plus monthly income/expense/category data and cumulative net worth (last row's last column feeds the reconciliation check) |
| `'Account'!A1:D1` | `app.js` | Net Worth figure (`D1`), also the other side of the reconciliation check |
| `Breakdown!A2:F200` | `app.js` | Per-category/per-Type spend, and the category list (column A) |
| `'Breakdown'!A2:F200` | `finance-breakdown.js` | The same rows, with their sheet row numbers, for the Breakdown panel |
| `Transaction!A2:F` | `finance-transaction.js`, `csv.js` | Transaction rows |
| `'Account'!A3:E100` | `finance-account.js` | Account name, institution, type, balance, market value |
| `'Account'!A3:A100`, `Breakdown!A2:A200` | `finance-transaction.js` | Account dropdown and Category autocomplete |
| `eTimeSheet!A2:H` | `track-work-time.js` | Work rows |
| `'Nutrition'!A1:Z` (header row included; columns found by name) | `health-nutrition.js`, `health-physique-estimator.js`, `health-insight-food.js`, `health-chart-protein-rotation.js` | Group / Name / Amount / Calories / Protein / Fiber / Fat / Carbohydrate / TEF / Verification / Percent / Micronutrients (JSON) |
| `'Physique'!A1:Z` | `health-physique.js` (all writes go through its `writePhysiqueRow`) | One row per day, **header row included**: columns are matched by header name (`PHYSIQUE_COLUMNS`), not position. Stored Sleep/Derived/Deprivation are filled in with one `values:batchUpdate` request |
| `'Contact'!A2:U` | `other-contact.js` | Contact rows |
| `'Travel'!A2:H` | `track-travel.js` | Travel rows |
| `'Application'!A2:E` | `track-application.js` | Application header + status-update rows |
| `'LeetCode'!A1:Z` (header row included; columns found by name) | `track-leetcode.js` | Solved problems (tab created on the first save) |
| `Settings!A2:C` | `app.js`, `other-settings.js` | Personal overrides; `app.js` reads A/B, the panel reads and writes all three |
| `'Watchlist'!A2:F` | `finance-watchlist.js` | Watchlist stocks and their alerts (tab created on the first save) |
| `'Trade'!A2:J` | `finance-portfolio.js` | Buys, sells and splits (tab created on the first save) |
| `'Analysis'!A2:G` | `finance-market.js` | Saved AI reads, one row per run (tab created on the first save) |
| `'Account'!E3:E100` | `finance-portfolio.js` | Market Value, written only by the opt-in Update Market Value (`PORTFOLIO_WRITE_MARKET_VALUE` = 1) |

**Auth, file selection and widget preferences (`localStorage`; no sheet data is stored):**

| Key | Set by | Contents |
|---|---|---|
| `ledger_token` | `auth.js` | `{ token, expiresAt }` — enables silent refresh |
| `ledger_consented` | `auth.js` | `'1'` once consent completes; controls `prompt` on next sign-in; cleared on sign-out |
| `ledger_widget_detected_location` | `ledger-widgets.js` | `{lat, lon, label}` from the last "Use my location" |
| `ledger_spreadsheet_id` | `drive.js` | The chosen spreadsheet's Drive file ID — every Sheets call targets it |
| `ledger_last_reminder_notified` | `track-work-time.js` | Today's date once the OS notification fired |
| `ledger_last_car_service_notified` | `track-car-service.js` | Today's date once the car-service notification fired (one per day) |
| `ledger_widget_manual_location` | `ledger-widgets.js` | `{lat, lon, label}` from the location picker; overrides auto-detect and Settings |
| `ledger_widget_second_clock_location` | `ledger-widgets.js` | `{label, timezone}` for the second clock |
| `ledger_market_symbol`, `ledger_portfolio_range`, `ledger_analysis_range` | `finance-watchlist.js`, `finance-portfolio.js`, `finance-market.js` | The stock and chart ranges last shown |
| `ledger_market_quota` | `finance-market-data.js` | Today's API call counts per stock-data service; cleared with the price cache |

**Stock settings (`Setting` tab):** `TWELVE_DATA_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY` (masked like every `_API_KEY`); `MARKET_RISK_PCT` (default 1, % of investment accounts risked per trade), `MARKET_ATR_MULT` (default 4, trailing stop distance below the 22-day highest close, in ATRs), `MARKET_RISK_FREE_PCT` (default 0, for Sharpe/Sortino), `PORTFOLIO_WRITE_MARKET_VALUE` (1 shows Update Market Value).

---

