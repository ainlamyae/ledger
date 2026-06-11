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
| Account | Text | From `Accounts` dropdown |
| Payee | Text | Merchant / person / institution |
| Description | Text | Optional detail |
| Amount | Number | Positive = income, negative = expense. The sign alone defines the type — no separate Income/Expense/Transfer column. Transfers between own accounts aren't recorded. |
| Category | Text | From `Categories` dropdown |

Column order (A–F) matches what `Report`'s `SUMIFS` formulas already expect (`E` = Amount, `F` = Category).

### 2. `Accounts`
A lookup/reference list only — used to check that each transaction's `Account` value matches a real, known account. Not used for balance calculations.

| Column | Type | Notes |
|---|---|---|
| Account Name | Text | Canonical name (data validation source for `Transactions`) |
| Institution | Text | e.g. Wealthsimple, CIBC, RBC, Tangerine |
| Type | Text | Chequing / Savings / Credit / Cash / Investment / Person (IOU) |

### 3. `Categories`
| Column | Type | Notes |
|---|---|---|
| Category | Text | e.g. Grocery, Transportation, Medical |
| Color | Text | Hex color for charts |


### `Report` and `Balance`

`Report` stays and remains formula-driven (`SUMIFS` against `Transactions`), so it's always computed by Google Sheets and reflects the latest data with zero frontend aggregation. `Balance` (net worth snapshot) remains a separate, manually-maintained reference sheet.

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
                                  ┌──────────────────────────────────────────┐
                                  │     "Ledger Database" Google Sheet         │
                                  │     (private; shared with owner only)      │
                                  │                                             │
                                  │  ┌────────────┐ ┌─────────┐ ┌────────────┐ │
                                  │  │Transactions│ │ Accounts│ │ Categories │ │
                                  │  └────────────┘ └─────────┘ └────────────┘ │
                                  │  ┌────────────┐ ┌─────────┐               │
                                  │  │   Report   │ │ Balance │               │
                                  │  │ (formulas) │ │(manual) │               │
                                  │  └────────────┘ └─────────┘               │
                                  └──────────────────────────────────────────┘
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
| 5 | `charts.js` | Chart.js renderers (income/expense, category breakdown, savings trend, category comparison) | `render*Chart` |
| 6 | `transactions.js` | Transactions table: list, search/filter, pagination, add/edit/delete | `initTransactions`, `refreshTransactions`, `refreshAccountOptions` |
| 7 | `accounts.js` | "Manage Accounts" validation list: CRUD + sortable table | `initAccountManager` |
| 8 | `csv.js` | CSV export/import for transactions | `initCsvControls` |
| 9 | `app.js` | Orchestration: report aggregation, dashboard rendering, scroll-spy nav, wiring everything together on `window.load` | `loadDashboard`, `handleAuthChange` |

### Data Flow

**Page load / sign-in**
1. `app.js` calls `initAuth(handleAuthChange)`.
2. `auth.js` checks `localStorage` for a non-expired token. If found, it's used immediately; if not, a *silent* `requestAccessToken({ prompt: 'none' })` is tried against the existing Google session (so PWA/home-screen users aren't forced to re-auth). Only if that fails does the landing page's "Sign in with Google" button trigger a full consent prompt.
3. On success, `handleAuthChange(token)` swaps the landing page for the dashboard and calls `loadDashboard()`.

**Dashboard load**
4. `loadReport()` returns cached data (`ledger_cache_report`, 5-minute TTL) or calls `batchGetValues` for the `Report`, `Balance`, and `Categories` ranges in one round trip, then derives summary cards, the last-12-months chart data, category breakdown, savings trend, and the category comparison (last month vs. 4-/12-month averages).
5. `initTransactions()` and `initAccountManager()` similarly check cache (`ledger_cache_transactions`, `ledger_cache_lists`, `ledger_cache_account-list`, `ledger_cache_accounts-meta`) before calling the Sheets API.
6. `charts.js` renders all Chart.js canvases; `app.js` renders the summary cards, accounts panel, and category comparison list.

**Writes** (add/edit/delete transaction or account, edit balance, CSV import)
7. UI actions call `appendValues` / `updateValues` / `batchUpdate` directly against the spreadsheet.
8. On success, the relevant cache key is refreshed (`refreshTransactions(true)`, `refreshAccountsList(true)`, `refreshBalances()`, etc.) so the UI reflects the change immediately without a full page reload.
9. The manual **Refresh** button calls `clearCache()` then `loadDashboard(true)`, forcing a full re-fetch of everything.

### Configuration Reference

`assets/script/config.js`:

| Key | Example | Notes |
|---|---|---|
| `CLIENT_ID` | `*.apps.googleusercontent.com` | OAuth 2.0 Web Client ID; must allow the GitHub Pages origin |
| `SPREADSHEET_ID` | `1dDuXPry...` | The "Ledger Database" spreadsheet ID |
| `SHEETS.TRANSACTIONS` | `Transactions` | Tab name for transaction rows |
| `SHEETS.REPORT` | `Report` | Tab name for the formula-driven monthly report |
| `SHEETS.BALANCE` | `Balance` | Tab name for the manual net-worth/account balances sheet |
| `SHEETS.ACCOUNTS` | `Accounts` | Tab name for the account validation list |
| `SHEETS.CATEGORIES` | `Categories` | Tab name for category names + chart colors |

These IDs are not secrets — see *Privacy & Security*.

**Sheet ranges read/written by the app:**

| Range | Used in | Purpose |
|---|---|---|
| `Report!A3:N114` | `app.js` | Monthly income/expense/category data, cumulative savings |
| `Balance!A1:B26` | `app.js` | Net worth (`A5`) + per-account balances (`A7:B26`) |
| `Categories!A2:B` | `app.js` | Category name → chart color |
| `Transactions!A2:F` | `transactions.js`, `csv.js` | Transaction rows (Date, Account, Payee, Description, Amount, Category) |
| `Accounts!A2:C` | `accounts.js` | Account Name, Institution, Type |
| `Accounts!A2:A`, `Categories!A2:A` | `transactions.js` | Dropdown option lists for the transaction form |

**Client-side cache (`localStorage`, 5-minute TTL via `cache.js`):**

| Cache key | Set by | Contents |
|---|---|---|
| `ledger_cache_report` | `app.js` | Aggregated report object (cards, charts, accounts, category comparison) |
| `ledger_cache_lists` | `transactions.js` | Transactions sheet ID + account/category dropdown options |
| `ledger_cache_transactions` | `transactions.js` | Raw `Transactions!A2:F` rows |
| `ledger_cache_accounts-meta` | `accounts.js` | Accounts sheet ID |
| `ledger_cache_account-list` | `accounts.js` | Raw `Accounts!A2:C` rows |

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
│       ├── charts.js       # Chart.js setup for cash flow, category breakdown, etc.
│       ├── transactions.js # Transactions table, filters, add/edit/delete
│       ├── accounts.js     # Manage Accounts: validation list CRUD + sorting
│       ├── csv.js          # CSV export/import for transactions
│       └── config.js       # Client ID + Spreadsheet ID + sheet/range names
├── Accounting.xlsx         # local source data — gitignored, never pushed
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

## Implementation Plan

### Phase 0 — Data migration & schema setup
- [x] Rebuild `Transactions` with columns `Date | Account | Payee | Description | Amount | Category` (matches what `Report`'s `SUMIFS` formulas already expect)
- [x] Clean data per the *Issues* list (real dates, canonical account names, consistent category casing)
- [x] Create the `Accounts` (validation list) and `Categories` tabs
- [x] Add data validation dropdowns for `Account` and `Category` columns in `Transactions`
- [x] Verify `Report`'s `SUMIFS` formulas recalculate correctly against the renamed sheet

### Phase 1 — Auth & API plumbing
- [x] Set up Google Cloud project + OAuth Client ID
- [x] `auth.js`: sign-in/sign-out with Google Identity Services, token persistence
- [x] `sheets.js`: `batchGet`/`values.get` wrapper, `append`/`update` for writes

### Phase 2 — Frontend scaffold
- [x] Split current monolithic `index.html` into `index.html` + `styles.css` + `app.js`
- [x] Add a sign-in gate; show dashboard only after auth succeeds

### Phase 3 — Read-only dashboard (MVP)
- [x] Fetch `Report` for net worth, monthly income/expenses, and savings rate (already pre-aggregated by Google Sheets)
- [x] Fetch `Transactions` for the recent transactions table
- [x] Replace hardcoded cards/table in `index.html` with live data
- [x] `charts.js`: cash flow chart (last 6–12 months) from `Report`

### Phase 4 — Transaction management (CRUD)
- [x] Add-transaction form → append row to `Transactions`
- [x] Edit/delete transaction → update/delete row by tracked row index
- [x] Client-side search/filter over fetched transactions (with pagination — 10k+ rows)

### Phase 5 — Reports & analytics
- [x] Expense breakdown by category (donut chart)
- [x] Income vs expense trend (Chart.js line/bar) from `Report`
- [x] Cumulative savings trend over time (from `Report`)

### Phase 6 — Account management
- [x] Accounts page: manage the validation list (add/edit known account names)
- [ ] Optional future tabs (medical, utilities) — see *Future tabs*

### Phase 7 — Performance & polish
- [x] Cache sheet data client-side (localStorage/IndexedDB) with manual refresh + TTL
- [x] Loading/error states for auth & API failures
- [x] Virtualized/paginated transactions table
- [x] Mobile responsiveness pass

### Phase 8 — Future (v2/v3)
- [ ] Budget tracking by category
- [x] CSV import/export

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
