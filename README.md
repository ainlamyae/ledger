# ledger

A lightweight, serverless personal accounting application built with GitHub Pages and Google Sheets.

Track income, expenses, account balances, investments, and financial trends while keeping all data in your own private Google account. The site is public (GitHub Pages), but the data behind it stays private — accessible only to whoever signs in with the Google account that owns the spreadsheet.

> **Note:** `Accounting.xlsx` in this repo is a local working copy of real personal financial data. It is listed in `.gitignore` and must never be committed or pushed. It is used here only as a reference for designing the Google Sheets schema below.

---

## Proposed Google Sheets Data Model

A single Google Sheet ("Ledger Database") with the following tabs, shared **only with your own Google account** (private):

### 1. `Transactions` (replaces `Detail` + `Rent` + `CELPiPi`)
| Column | Type | Notes |
|---|---|---|
| Date | Date | ISO format, real date cell |
| Account | Text | From `Account Balance` dropdown |
| Payee | Text | Merchant / person / institution |
| Description | Text | Optional detail |
| Amount | Number | Positive = income, negative = expense. The sign alone defines the type — no separate Income/Expense/Transfer column. Transfers between own accounts aren't recorded. |
| Category | Text | From `Categories` dropdown |

Column order (A–F) matches what `Monthly Summary`'s `SUMIFS` formulas already expect (`E` = Amount, `F` = Category).

### 2. `Account Balance`
Net worth snapshot + account validation list combined into one tab.

| Cell/Column | Type | Notes |
|---|---|---|
| D1 | Number (formula) | Net worth total, e.g. `=ROUND(SUM(D3:D100),2)` — widened beyond the current row count to leave headroom for new accounts |
| Row 2 | Header | `Account \| Institute \| Type \| Balance` |
| A3:A | Text | Account name (data validation source for `Transactions`, and the dashboard's Accounts table) |
| B3:B | Text | Institution, e.g. Wealthsimple, CIBC, RBC, Tangerine |
| C3:C | Text | Type — Cash / Chequing / Checking / Saving / Credit / Investment / Investment (Managed) / Person / Other |
| D3:D | Number | Account balance (manually maintained, or a formula referencing e.g. `GOOGLEFINANCE`); `"Closed"` (text) for retired accounts — excluded from the dashboard accounts panel |

### 3. `Categories`
| Column | Type | Notes |
|---|---|---|
| Category | Text | e.g. Grocery, Transportation, Medical |
| Color | Text | Hex color for charts |

### Helper tabs (formula-only)
- **`Benchmarks`** — "Last Month / Last Quarter Average / Last Year Average / Lifelong Average" rollups of `Monthly Summary`, per category. Read directly by `app.js` for the "Spending Trend" chart — the dashboard never recomputes these averages itself (with 10k+ transaction rows, re-deriving them client-side would be wasteful when Google Sheets already computes them).
- **`Reconciliation`** — reconciles `Monthly Summary`'s cumulative savings against `Account Balance`'s net worth total (`'Account Balance'!D1`). Not read by the app.
- **`Chart`** — native Google Sheets charts (visual reference only; the live dashboard uses its own Chart.js charts). Not read by the app.

### `Monthly Summary`

`Monthly Summary` stays and remains formula-driven (`SUMIFS` against `Transactions`), so it's always computed by Google Sheets and reflects the latest data with zero frontend aggregation. Row 1 is the header; data rows start at row 2.

---

## Architecture

### System Overview

```text
┌────────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                           │
│                                                                       │
│   GitHub Pages static site — index.html + assets/style + assets/script │
│   Vanilla JS (ES6+), no build step, no backend server                │
└───────────────────┬───────────────────────────────┬─────────────────┘
                     │                               │
                     │ 1. OAuth 2.0 token request    │ 3. REST calls
                     │   (Google Identity Services)  │   Authorization: Bearer <token>
                     ▼                               ▼
     ┌───────────────────────────┐    ┌──────────────────────────────────┐
     │  Google Identity Services  │    │      Google Sheets API v4         │
     │  accounts.google.com       │    │      sheets.googleapis.com        │
     │  - issues access token     │───▶│      (validates token + scope)    │
     │  - scope: spreadsheets   2.│    │                                    │
     └───────────────────────────┘    └─────────────────┬──────────────────┘
                                                          │ 4. read / write
                                                          ▼
                                  ┌─────────────────────────────────────────────┐
                                  │       "Ledger Database" Google Sheet        │
                                  │      (private; shared with owner only)      │
                                  │                                             │
                                  │ ┌──────────────┐ ┌─────────────────┐        │
                                  │ │ Transactions │ │ Account Balance │        │
                                  │ └──────────────┘ └─────────────────┘        │
                                  │ ┌─────────────────┐ ┌────────────┐          │
                                  │ │ Monthly Summary │ │ Categories │          │
                                  │ │   (formulas)    │ │            │          │
                                  │ └─────────────────┘ └────────────┘          │
                                  │ ┌────────────┐ ┌────────────────┐ ┌───────┐ │
                                  │ │ Benchmarks │ │ Reconciliation │ │ Chart │ │
                                  │ └────────────┘ └────────────────┘ └───────┘ │
                                  └─────────────────────────────────────────────┘
```

Because every Sheets API call carries the signed-in user's own OAuth token, only accounts the spreadsheet has been shared with (i.e., the owner) can ever read or write data — even though the static site and `config.js` (Client ID + Spreadsheet ID) are public.

### Frontend Module Map

Loaded as classic `<script>` tags (no bundler), in this order, sharing one global scope:

| Order | Module | Responsibility | Key exports used elsewhere |
|---|---|---|---|
| 1 | `config.js` | `CONFIG`: Client ID, Spreadsheet ID, sheet tab names | `CONFIG` |
| 2 | `auth.js` | Google sign-in/out, token persistence (`localStorage`), silent refresh | `initAuth`, `signIn`, `signOut`, `getAccessToken` |
| 3 | `sheets.js` | Thin Sheets API v4 wrapper (get / batchGet / append / update / clear / batchUpdate) | `getValues`, `batchGetValues`, `appendValues`, `updateValues`, `batchUpdate`, `getSpreadsheetMetadata` |
| 4 | `cache.js` | `localStorage`-backed cache with 5-minute TTL | `getCached`, `setCached`, `clearCache` |
| 5 | `charts.js` | Chart.js renderers for the 4 dashboard charts: Spending Trend (bar vs. `Benchmarks` averages), Income vs Expenses Over Time (stepped area), Expense Breakdown Over Time (stacked bar, y-axis capped so outlier months don't flatten the rest), Cumulative Savings Over Time (line) | `render*Chart` |
| 6 | `transactions.js` | Transactions table: list, search/filter, sortable columns, pagination, add/edit/delete | `initTransactions`, `refreshTransactions`, `refreshAccountOptions` |
| 7 | `accounts.js` | Accounts table: merged balance + validation-list view (Name/Institution/Type/Balance), sortable, CRUD with inline balance editing | `initAccountManager` |
| 8 | `csv.js` | CSV export/import for transactions | `initCsvControls` |
| 9 | `app.js` | Orchestration: report aggregation, dashboard rendering, scroll-spy nav, wiring everything together on `window.load` | `loadDashboard`, `handleAuthChange` |

### Data Flow

**Page load / sign-in**
1. `app.js` calls `initAuth(handleAuthChange)`.
2. `auth.js` checks `localStorage` for a non-expired token. If found, it's used immediately; if not, a *silent* `requestAccessToken({ prompt: 'none' })` is tried against the existing Google session (so PWA/home-screen users aren't forced to re-auth). Only if that fails does the landing page's "Sign in with Google" button trigger a full consent prompt.
3. On success, `handleAuthChange(token)` swaps the landing page for the dashboard and calls `loadDashboard()`.

**Dashboard load**
4. `loadReport()` returns cached data (`ledger_cache_report`, 5-minute TTL) or calls `batchGetValues` for the `Monthly Summary`, `Benchmarks`, `Account Balance`, and `Categories` ranges in one round trip, then derives the summary cards, the income/expense and cumulative-savings trends (full history), the per-category expense breakdown over time, and the Spending Trend comparison (last month vs. quarter/year/lifelong averages, read directly from `Benchmarks`).
5. `initTransactions()` and `initAccountManager()` similarly check cache (`ledger_cache_transactions`, `ledger_cache_lists`, `ledger_cache_account-list`, `ledger_cache_accounts-meta`) before calling the Sheets API.
6. `charts.js` renders all four Chart.js canvases; `app.js` renders the summary cards; `accounts.js` renders the Accounts table.

**Writes** (add/edit/delete transaction or account, edit balance, CSV import)
7. UI actions call `appendValues` / `updateValues` / `batchUpdate` directly against the spreadsheet.
8. On success, the relevant cache key is refreshed (`refreshTransactions(true)`, `refreshAccountsList(true)`, `refreshNetWorth()`, etc.) so the UI reflects the change immediately without a full page reload.
9. The manual **Refresh** button calls `clearCache()` then `loadDashboard(true)`, forcing a full re-fetch of everything.

### Configuration Reference

`assets/script/config.js`:

| Key | Example | Notes |
|---|---|---|
| `CLIENT_ID` | `*.apps.googleusercontent.com` | OAuth 2.0 Web Client ID; must allow the GitHub Pages origin |
| `SPREADSHEET_ID` | (from the sheet's URL) | The "Ledger Database" spreadsheet ID |
| `SHEETS.TRANSACTIONS` | `Transactions` | Tab name for transaction rows |
| `SHEETS.REPORT` | `Monthly Summary` | Tab name for the formula-driven monthly report |
| `SHEETS.BENCHMARKS` | `Benchmarks` | Tab name for the pre-computed per-category spending averages |
| `SHEETS.BALANCE` | `Account Balance` | Tab name for the net-worth/account balances sheet |
| `SHEETS.ACCOUNTS` | `Account Balance` | Same tab as `BALANCE` — account validation list lives in columns B-D |
| `SHEETS.CATEGORIES` | `Categories` | Tab name for category names + chart colors |

These IDs are not secrets — see *Privacy & Security*.

**Sheet ranges read/written by the app:**

| Range | Used in | Purpose |
|---|---|---|
| `'Monthly Summary'!A2:L149` | `app.js` | Monthly income/expense/category data, cumulative savings (row 1 is the header) |
| `'Benchmarks'!A1:K5` | `app.js` | Pre-computed Last Month / Last Quarter / Last Year / Lifelong Average per category for the "Spending Trend" chart |
| `'Account Balance'!A1:D1` | `app.js` | Net worth total (`D1`) for the summary card |
| `Categories!A2:B` | `app.js` | Category name → chart color |
| `Transactions!A2:F` | `transactions.js`, `csv.js` | Transaction rows (Date, Account, Payee, Description, Amount, Category) |
| `'Account Balance'!A3:D100` | `accounts.js` | Account Name, Institution, Type, Balance |
| `'Account Balance'!A3:A100`, `Categories!A2:A` | `transactions.js` | Dropdown option lists for the transaction form |

**Client-side cache (`localStorage`, 5-minute TTL via `cache.js`):**

| Cache key | Set by | Contents |
|---|---|---|
| `ledger_cache_report` | `app.js` | Aggregated report object (summary cards, chart data, Spending Trend comparison) |
| `ledger_cache_lists` | `transactions.js` | Transactions sheet ID + account/category dropdown options |
| `ledger_cache_transactions` | `transactions.js` | Raw `Transactions!A2:F` rows |
| `ledger_cache_accounts-meta` | `accounts.js` | `Account Balance` sheet ID |
| `ledger_cache_account-list` | `accounts.js` | Raw `'Account Balance'!A3:D100` rows |

**Auth token (`localStorage`, separate from the cache above):**

| Key | Set by | Contents |
|---|---|---|
| `ledger_token` | `auth.js` | `{ token, expiresAt }` — OAuth access token + expiry, enables silent refresh on PWA relaunch |

---

## Technology Stack

### Frontend
* HTML5
* CSS3
* JavaScript (ES6+, no framework/build step — keeps GitHub Pages deploy trivial)

### Storage
* Google Sheets ("Ledger Database" workbook, schema above)

### Authentication
* Google Identity Services (GIS) — OAuth 2.0 implicit/token flow, Sheets API scope only

### Hosting
* GitHub Pages

### Visualization
* Chart.js

---

## Project Structure

```text
ledger/
│
├── index.html              # Dashboard shell + sign-in gate
├── favicon.svg             # Browser tab icon
├── assets/
│   ├── style/
│   │   └── styles.css      # Extracted from former inline <style>
│   └── script/
│       ├── app.js          # App init, view routing, state
│       ├── auth.js         # Google Identity Services sign-in/out, token storage
│       ├── cache.js         # Local cache for fetched report/transaction data
│       ├── sheets.js       # Sheets API wrapper (batchGet, append, update, delete)
│       ├── charts.js       # Chart.js setup: Spending Trend, Income vs Expenses, Expense Breakdown, Cumulative Savings
│       ├── transactions.js # Transactions table, filters, sorting, add/edit/delete
│       ├── accounts.js     # Accounts table: balances + validation list, CRUD + sorting
│       ├── csv.js          # CSV export/import for transactions
│       └── config.js       # Client ID + Spreadsheet ID + sheet/range names
├── Accounting.xlsx          # local source data — gitignored, never pushed
├── .gitignore
└── README.md
```

---

## Setup Guide (one-time)

1. **Create the Google Sheet**
   - New spreadsheet, add tabs per the *Proposed Google Sheets Data Model* above.
   - Copy data from `Accounting.xlsx` (clean dates, accounts, categories per the *Issues* list).
   - Share it only with your own Google account (default — do nothing extra).

2. **Google Cloud project**
   - Create a project, enable the **Google Sheets API**.
   - Create an **OAuth 2.0 Client ID** (Web application).
   - Add `https://ainlamyae.github.io` as an authorized JavaScript origin.

3. **Configure the app**
   - In `config.js`, set `CLIENT_ID` and `SPREADSHEET_ID`.
   - These values are not secrets — access is enforced by Google's per-user OAuth consent + the spreadsheet's sharing settings, not by hiding these IDs.

4. **Deploy** (see Deployment section below).

---

## Deployment

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Select:
   * Source: Deploy from a branch
   * Branch: `main`
   * Folder: `/ (root)`
4. Save.

Your site will be available at:

```text
https://ainlamyae.github.io/ledger
```

---

## Privacy & Security

* Data lives in a private Google Sheet, shared with no one but the owner.
* Frontend uses per-user Google OAuth — visitors who aren't granted access to the sheet can sign in with their own Google account but the Sheets API will simply deny them.
* No password storage, no custom backend server.
* `Accounting.xlsx` (real personal data) stays local only — see `.gitignore`.

---

## License

No license
