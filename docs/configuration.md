# Configuration Reference

[← Back to README](../README.md)

**Sheet ranges read/written by the app:**

| Range | Used in | Purpose |
|---|---|---|
| `'Statement'!A1:Z149` | `app.js` | Header row plus monthly income/expense/category data and cumulative net worth (last row's last column feeds the reconciliation check) |
| `'Account'!A1:D1` | `app.js` | Net Worth figure (`D1`), also the other side of the reconciliation check |
| `Breakdown!A2:F200` | `app.js` | Per-category/per-Type spend, and the category list (column A) |
| `'Breakdown'!A2:F200` | `breakdown.js` | The same rows, with their sheet row numbers, for the Breakdown panel |
| `Transaction!A2:F` | `transactions.js`, `csv.js` | Transaction rows |
| `'Account'!A3:E100` | `accounts.js` | Account name, institution, type, balance, market value |
| `'Account'!A3:A100`, `Breakdown!A2:A200` | `transactions.js` | Account dropdown and Category autocomplete |
| `eTimeSheet!A2:H` | `timesheet.js` | Work rows |
| `'Nutrition'!A2:L` | `nutrition.js`, `calorie-estimator.js`, `food-insight.js`, `protein-rotation.js` | Classification / Name / Amount / Calories / Protein / Fiber / Fat / Carbohydrate / TEF / Verification / Percent / Micronutrients (JSON) |
| `'Contact'!A2:U` | `contacts.js` | Contact rows |
| `'Travel'!A2:H` | `travel.js` | Travel rows |
| `'Application'!A2:E` | `applications.js` | Application header + status-update rows |
| `Settings!A2:C` | `app.js`, `settings-panel.js` | Personal overrides; `app.js` reads A/B, the panel reads and writes all three |

**Client-side cache (`localStorage` via `cache.js`, 5-minute TTL unless noted):**

| Cache key | Set by | Contents |
|---|---|---|
| `ledger_cache_report` | `app.js` | Aggregated report for the summary cards and finance charts |
| `ledger_cache_lists` | `transactions.js` | Transaction sheet ID + dropdown options |
| `ledger_cache_transactions` | `transactions.js` | Raw `Transaction!A2:F` rows |
| `ledger_cache_accounts-meta` / `account-list` | `accounts.js` | `Account` sheet ID / rows |
| `ledger_cache_timesheet` | `timesheet.js` | Raw `eTimeSheet!A2:H` rows |
| `ledger_cache_nutrition` | `nutrition.js` | Raw `'Nutrition'!A2:L` rows |
| `ledger_cache_breakdown` | `breakdown.js` | Raw `'Breakdown'!A2:F200` rows |
| `ledger_cache_contacts` | `contacts.js` | Raw `'Contact'!A2:U` rows |
| `ledger_cache_travel` | `travel.js` | Raw `'Travel'!A2:H` rows |
| `ledger_cache_applications` | `applications.js` | Raw `'Application'!A2:E` rows |
| `ledger_cache_settings` | `app.js` | Parsed `Setting` key-value map |
| `ledger_cache_settings-panel-meta` / `setting-list` | `settings-panel.js` | `Setting` sheet ID / raw rows |
| `ledger_cache_widget_location` | `widgets.js` | Auto-detected `{lat, lon, label}` — 6-hour TTL |
| `ledger_cache_widget_weather_<lat>_<lon>` | `widgets.js` | Open-Meteo response — 30-minute TTL |

**Auth, file selection and widget preferences (`localStorage`, separate from the cache):**

| Key | Set by | Contents |
|---|---|---|
| `ledger_token` | `auth.js` | `{ token, expiresAt }` — enables silent refresh |
| `ledger_consented` | `auth.js` | `'1'` once consent completes; controls `prompt` on next sign-in; cleared on sign-out |
| `ledger_spreadsheet_id` | `drive.js` | The chosen spreadsheet's Drive file ID — every Sheets call targets it |
| `ledger_last_reminder_notified` | `timesheet.js` | Today's date once the OS notification fired |
| `ledger_widget_manual_location` | `widgets.js` | `{lat, lon, label}` from the location picker; overrides auto-detect and Settings |
| `ledger_widget_second_clock_location` | `widgets.js` | `{label, timezone}` for the second clock |

---

