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
| `'Nutrition'!A1:Z` (header row included; columns found by name) | `nutrition.js`, `calorie-estimator.js`, `food-insight.js`, `protein-rotation.js` | Classification / Name / Amount / Calories / Protein / Fiber / Fat / Carbohydrate / TEF / Verification / Percent / Micronutrients (JSON) |
| `'Physique'!A1:Z` | `physique.js` (all writes go through its `writePhysiqueRow`) | One row per day, **header row included**: columns are matched by header name (`PHYSIQUE_COLUMNS`), not position. Stored Sleep/Derived/Deprivation are filled in with one `values:batchUpdate` request |
| `'Contact'!A2:U` | `contacts.js` | Contact rows |
| `'Travel'!A2:H` | `travel.js` | Travel rows |
| `'Application'!A2:E` | `applications.js` | Application header + status-update rows |
| `Settings!A2:C` | `app.js`, `settings-panel.js` | Personal overrides; `app.js` reads A/B, the panel reads and writes all three |

**Auth, file selection and widget preferences (`localStorage`; no sheet data is stored):**

| Key | Set by | Contents |
|---|---|---|
| `ledger_token` | `auth.js` | `{ token, expiresAt }` — enables silent refresh |
| `ledger_consented` | `auth.js` | `'1'` once consent completes; controls `prompt` on next sign-in; cleared on sign-out |
| `ledger_widget_detected_location` | `widgets.js` | `{lat, lon, label}` from the last "Use my location" |
| `ledger_spreadsheet_id` | `drive.js` | The chosen spreadsheet's Drive file ID — every Sheets call targets it |
| `ledger_last_reminder_notified` | `timesheet.js` | Today's date once the OS notification fired |
| `ledger_last_car_service_notified` | `car-service.js` | Today's date once the car-service notification fired (one per day) |
| `ledger_widget_manual_location` | `widgets.js` | `{lat, lon, label}` from the location picker; overrides auto-detect and Settings |
| `ledger_widget_second_clock_location` | `widgets.js` | `{label, timezone}` for the second clock |

---

