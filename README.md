# Ledger

A private, serverless personal finance dashboard. Ledger reads and writes directly to a Google Sheet you own — there is no backend, no database, and no third-party data store. The site is public on GitHub Pages, but the financial data behind it is only ever accessible to the Google account that owns the spreadsheet.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
  - [System Diagram](#system-diagram)
  - [Frontend Module Map](#frontend-module-map)
  - [Data Flow](#data-flow)
- [Data Model](#data-model)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Configuration Reference](#configuration-reference)
- [Caching Strategy](#caching-strategy)
- [Security & Privacy](#security--privacy)
- [License](#license)

---

## Overview

Ledger is a single-page application that authenticates the user with their own Google account, then reads and writes a private "Ledger" Google Sheet via the Sheets API v4. All aggregation, charting, filtering, sorting, and CRUD logic runs client-side in vanilla JavaScript — there is no build step and no server component to deploy or maintain.

![Ledger dashboard screenshot](assets/images/dashboard-screenshot.png)

## Features

- **Summary cards** — at-a-glance Total Savings, monthly income, monthly expenses, and Net Cash Flow.
- **Average Monthly Spending by Category** — grouped bar chart comparing each category's average monthly spend over four periods: Last Month (as-is), Last Quarter Average (last quarter's total ÷ 3), Last Year Average (last year's total ÷ 12), and Lifelong Average (lifelong total ÷ total months of data); each category's 4 bars are shaded from its own color (most recent = most opaque). Categories are ordered by Lifelong Average spend, highest first.
- **Spending Breakdown by Category** — four donut charts showing each category's share of spending for last month, last quarter average, last year average, and lifelong average. Legend and slices follow the same highest-to-lowest Lifelong Average order as Average Monthly Spending by Category.
- **Spending Breakdown by Type** — for each spending category, four donut charts (Last Month, Last Quarter, Last Year, Lifelong) breaking that category's spend down by `Type`, a free-text prefix convention in the `Transactions` `Description` field (e.g. "Bread - milk and eggs"), pre-aggregated by formulas in the `Insight` sheet. Panels are ordered by lifelong spend (highest first), and each donut includes an "Untyped" slice for spending without a recognized prefix.
- **Spending Trend by Category** — stacked bar chart of spending by category, month over month, with categories stacked in the same highest-to-lowest Lifelong Average order as Average Monthly Spending by Category.
- **Income vs. Expenses Trend** — stepped area chart of the full transaction history.
- **Cumulative Savings Trend** — running total of savings as a line chart.
- **Savings Rate Trend** — monthly savings rate (saved ÷ income, as a %) as a line chart.
- **Account Composition** — nested donut chart: the inner ring shows each account type's share of total balance, the outer ring breaks that down by individual account (shaded by its type's color). Account types are ordered by net balance, highest first (so e.g. negative-balance Credit types sort last), and types with a zero balance total are omitted.
- **Transactions** — searchable, filterable, sortable, paginated table with add/edit/delete and CSV import/export. The Payee and Description fields autocomplete from your transaction history (most-used values first), helping correct typos or voice-dictation mistakes. Long Payee/Description values are truncated with an ellipsis (hover to see the full text).
- **Accounts** — sortable table of balances by institution/type, with add/edit/delete and inline Total Savings recalculation. The Accounts panel header shows a reconciliation status (✅ Reconciled, or ⚠️ with the gap amount if recorded balances don't match transaction history). The Balance field accepts a simple arithmetic expression (optionally prefixed with `=`, e.g. `=5000-1234.56`) for quick calculations like credit card spend = limit minus remaining balance; results are rounded to the nearest cent.
- **Collapsible panels** — every chart/table panel is collapsed by default; click its title to expand or collapse it. Clicking a nav link (Charts/Transactions/Accounts) expands the relevant panel(s), and a floating "expand/collapse all" button toggles every panel at once.
- **Privacy mode** — a floating 🙈/👁️ button masks every dollar amount across the summary cards, tables, and charts by replacing each digit with `*` (e.g. `$1,234.56` → `$*,***.**`). Amounts are hidden by default each time you sign in; click the button to reveal them for the rest of the session.
- **Dark mode** — a floating 🌙/☀️ button switches the whole app — including charts and the landing page — between light and dark themes, persisted in `localStorage`.
- **Resilient sign-in** — silent token refresh on return visits (including PWA/home-screen launches), with a full consent prompt only when needed.
- **Local caching** — a 5-minute `localStorage` cache avoids redundant Sheets API calls; manual refresh and clear-cache controls are available as floating buttons.

Category-based charts (Average Monthly Spending by Category, Spending Breakdown by Category, Spending Trend by Category) all assign each category a color spread evenly around the color wheel, in the same highest-to-lowest Lifelong Average order used everywhere else.

---

## Architecture

### System Diagram

Ledger is a static site that talks directly to Google's APIs from the browser. There is no application server in the request path.

![Ledger system architecture diagram](assets/images/architecture-diagram.png)

```text
┌───────────────────────────────────────────────────────────────────────┐
│                            Browser (Client)                            │
│                                                                         │
│   GitHub Pages static site: index.html + assets/style + assets/script │
│   Vanilla JS (ES6+), classic <script> tags, no build step             │
└───────────────────┬─────────────────────────────┬─────────────────────┘
                     │                             │
   (1) OAuth 2.0 token request      (3) REST calls — Authorization: Bearer <token>
       via Google Identity Services                │
                     │                             │
                     ▼                             ▼
     ┌────────────────────────────┐   ┌─────────────────────────────────┐
     │  Google Identity Services   │   │       Google Sheets API v4       │
     │  accounts.google.com        │   │       sheets.googleapis.com      │
     │  - issues OAuth access token│──▶│  (2) validates token + scope     │
     │  - scope: .../spreadsheets  │   └────────────────┬──────────────────┘
     └────────────────────────────┘                    │ (4) read / write
                                                          ▼
                                  ┌─────────────────────────────────────────────┐
                                  │          "Ledger" Google Sheet               │
                                  │       (private; shared with owner only)      │
                                  │                                               │
                                  │  Transactions    Account Balance             │
                                  │  Monthly Summary (formulas)                  │
                                  │  Insight (formulas)                          │
                                  │  Reconciliation (formulas)                   │
                                  └───────────────────────────────────────────────┘
```

Because every Sheets API call carries the signed-in user's own OAuth token, only the Google account the spreadsheet is shared with can ever read or write data — even though the static site and `config.js` (Client ID + Spreadsheet ID) are public.

### Frontend Module Map

Loaded as classic `<script>` tags (no bundler), in this order, sharing one global scope:

| Order | Module | Responsibility | Key exports used elsewhere |
|---|---|---|---|
| 1 | `config.js` | `CONFIG`: Client ID, Spreadsheet ID, sheet tab names | `CONFIG` |
| 2 | `auth.js` | Google sign-in/out, token persistence (`localStorage`), silent refresh | `initAuth`, `signIn`, `signOut`, `getAccessToken` |
| 3 | `sheets.js` | Thin Sheets API v4 wrapper (get / batchGet / append / update / clear / batchUpdate) | `getValues`, `batchGetValues`, `appendValues`, `updateValues`, `batchUpdate`, `getSpreadsheetMetadata` |
| 4 | `cache.js` | `localStorage`-backed cache with 5-minute TTL, plus hard-refresh (cache + Cache Storage + service workers) | `getCached`, `setCached`, `clearCache`, `hardRefresh` |
| 5 | `charts.js` | Chart.js renderers for the dashboard charts, including the 4-donut Spending Breakdown by Category grid, the per-category Spending Breakdown by Type donut grids, and the nested Account Composition donut | `renderSpendingTrendChart`, `renderSpendingBreakdownCharts`, `renderTypeBreakdownCharts`, `renderIncomeExpenseChart`, `renderExpenseBreakdownTrendChart`, `renderSavingsTrendChart`, `renderSavingsRateChart`, `renderAccountCompositionChart` |
| 6 | `transactions.js` | Transactions table: list, search/filter, sortable columns, pagination, add/edit/delete, Payee/Description autocomplete | `initTransactions`, `refreshTransactions`, `refreshAccountOptions` |
| 7 | `accounts.js` | Accounts table: balances + validation list, sortable, add/edit/delete | `initAccountManager` |
| 8 | `csv.js` | CSV export/import for transactions | `initCsvControls` |
| 9 | `app.js` | Orchestration: report aggregation, dashboard rendering, scroll-spy nav, collapsible panels, dark mode toggle, wiring everything together on `window.load` | `loadDashboard`, `handleAuthChange` |

### Data Flow

**Sign-in**
1. `app.js` calls `initAuth(handleAuthChange)`.
2. `auth.js` checks `localStorage` for a non-expired token. If found, it's used immediately. If not, a *silent* `requestAccessToken({ prompt: 'none' })` is tried against the existing Google session — only if that fails does the landing page's "Sign in with Google" button trigger a full consent prompt.
3. On success, `handleAuthChange(token)` swaps the landing page for the dashboard and calls `loadDashboard()`.

**Dashboard load**
4. `loadReport()` returns cached data (`ledger_cache_report`, 5-minute TTL) or issues a single `batchGetValues` for the `Monthly Summary`, `Account Balance`, `Insight`, and `Reconciliation` ranges, then derives the summary cards, the income/expense and cumulative-savings trends, the per-category spending trend over time, the Average Monthly Spending by Category / Spending Breakdown by Category comparisons, the per-category `Type` breakdown for the Spending Breakdown by Type donuts, and the reconciliation status shown above the Accounts table.
5. `initTransactions()` and `initAccountManager()` run concurrently (`Promise.allSettled`), each checking their own cache before calling the Sheets API.
6. `charts.js` renders all Chart.js canvases — the 4 line/bar charts, the 4-donut Spending Breakdown by Category grid, and the per-category Spending Breakdown by Type donut grids; `app.js` renders the summary cards; `accounts.js` and `transactions.js` render their tables.

**Writes** (add/edit/delete transaction or account, edit balance, CSV import)
7. UI actions call `appendValues` / `updateValues` / `batchUpdate` directly against the spreadsheet.
8. On success, the relevant cache key is refreshed (`refreshTransactions(true)`, `refreshAccountsList(true)`, `refreshNetWorth()`, etc.) so the UI reflects the change immediately without a full page reload.

**Manual refresh**
9. The 🔄 Refresh and 🧹 Clear Cache buttons — part of the floating action button stack in the bottom-right corner — clear the cache and re-fetch everything; Clear Cache additionally clears Cache Storage and unregisters any service workers, then reloads — for recovering from a stale deployed version. The same stack also holds the 🌙/☀️ dark mode toggle and the expand/collapse-all panels button.

---

## Data Model

A single Google Sheet ("Ledger") with the following tabs, shared **only with the owner's Google account**.

### `Transactions`

| Column | Type | Notes |
|---|---|---|
| A — Date | Date | ISO format |
| B — Account | Text | Must match a name in `Account Balance` column A |
| C — Payee | Text | Merchant / person / institution |
| D — Description | Text | Optional detail |
| E — Amount | Number | Positive = income, negative = expense. The sign alone defines the type — there is no separate Income/Expense column. |
| F — Category | Text | Must match a category name in `Insight` column A |

### `Account Balance`

Net worth snapshot and the account list, combined in one tab.

| Cell/Column | Type | Notes |
|---|---|---|
| D1 | Number (formula) | Total Savings, e.g. `=ROUND(SUM(D3:D100),2)` |
| Row 2 | Header | `Account \| Institute \| Type \| Balance` |
| A3:A | Text | Account name — also the dropdown source for `Transactions` and the Accounts table |
| B3:B | Text | Institution, e.g. a bank or brokerage name |
| C3:C | Text | Type — one of `Cash`, `Chequing`, `Checking`, `Saving`, `Credit`, `Investment`, `Investment (Managed)`, `Investment (Member)`, `Investment (Employer)`, `Person`, `Other` |
| D3:D | Number | Account balance |

### `Monthly Summary` (formula-driven)

`SUMIFS` against `Transactions`, recomputed automatically whenever transaction data changes — no client-side aggregation. Row 1 is the header; data rows start at row 2.

| Column | Contents |
|---|---|
| A | Month label |
| B | Income |
| C | Expenses |
| D onward | Per-category expense totals — one column per category in `Insight` column A, matched by header name (see below) |
| Second-to-last | Saved (income − expenses) |
| Last | Cumulative savings |

`app.js` reads row 1 as headers and matches each category name from `Insight` column A against the `Monthly Summary` headers to find its column — except "Income"/"Expenses" (columns B/C), which are excluded even if `Insight` also has a row with that name, since they aren't spending categories. `Saved` and `Cumulative` aren't matched by name; they're always taken as the last two columns of the data rows, so inserting a new category column anywhere before them doesn't break either chart. Adding or renaming a category only requires updating `Insight` and adding a matching column/header to `Monthly Summary` — no code changes needed.

### `Insight` (formula-driven)

Per-category, per-`Type` spending breakdown used by the Spending Breakdown by Type donuts. `Type` is not a separate column on `Transactions` — it's a free-text prefix convention on the `Description` field (e.g. a transaction with Description "Bread - milk and eggs" has Type "Bread"). Data rows start at row 2.

| Column | Contents |
|---|---|
| A — Category | Category name. Column A is also the source of the category list used throughout the dashboard and the transaction form's Category dropdown — each unique value across all rows becomes one category. |
| B — Type | A `Description` prefix, or **blank** for a row holding that category's overall total |
| C — Last Month | `-SUMIFS(...)` over `Transactions`, matching Category, `Description` starting with `Type` (via `Type&"*"`, or no Description filter if `Type` is blank), `Amount < 0`, and the date window for "last month" |
| D — Last Quarter | Same, for the trailing 3-month window |
| E — Last Year | Same, for the trailing 12-month window |
| F — Lifelong | Same, with no date filter |

Cell `H1` holds `=TODAY()`, the single anchor date that every period's `EOMONTH(...)`-based date window is computed relative to.

For each category, the blank-`Type` row's totals are used as that category's overall spend; the gap between that total and the sum of its named `Type` rows becomes the "Untyped" donut slice. `Type` rows with a Lifelong value of `0` (a retired Type with no historical spend) are excluded entirely, so removing a Type from active use doesn't leave an empty entry in the legend. The 5 categories shown (Grocery, Household, Personal, Transportation, Housing) are a fixed list in `charts.js` (`TYPE_BREAKDOWN_CATEGORIES`) — adding a new category requires adding its rows to `Insight`, the category name to that constant, and a matching donut-grid block in `index.html`.

### `Reconciliation` (formula-driven)

A single reconciliation check comparing recorded account balances against transaction history.

| Cell | Contents |
|---|---|
| A5 | Label — "Missing Amount" |
| B5 | The discrepancy: non-zero means an `Account Balance` entry is wrong or a `Transactions` row is missing |

`app.js` reads `B5` and shows a reconciliation status above the Accounts table — ✅ Reconciled if it's `0` (within half a cent), or ⚠️ with the discrepancy amount otherwise.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (ES6+) — no framework, no build step |
| Charts | [Chart.js](https://www.chartjs.org/) |
| Authentication | [Google Identity Services](https://developers.google.com/identity) (GIS), OAuth 2.0 token flow, `spreadsheets` scope |
| Data store | Google Sheets API v4 |
| Hosting | GitHub Pages |

---

## Project Structure

```text
ledger/
├── index.html              # Page shell: sign-in gate, dashboard, modals, footer
├── favicon.svg              # Browser tab icon
├── manifest.json            # Web app manifest (PWA/home-screen install)
├── robots.txt               # Search engine crawling rules
├── sitemap.xml              # Sitemap for search engines
├── assets/
│   ├── images/
│   │   ├── social-preview.png   # Open Graph / Twitter card image
│   │   └── apple-touch-icon.png # iOS home-screen icon
│   ├── style/
│   │   └── styles.css       # All styling
│   └── script/
│       ├── config.js        # Client ID + Spreadsheet ID + sheet/range names
│       ├── auth.js           # Google Identity Services sign-in/out, token storage
│       ├── sheets.js         # Sheets API wrapper (get, batchGet, append, update, batchUpdate)
│       ├── cache.js          # localStorage cache + hard refresh
│       ├── charts.js         # Chart.js renderers
│       ├── transactions.js   # Transactions table: filters, sorting, CRUD
│       ├── accounts.js       # Accounts table: balances + CRUD
│       ├── csv.js            # CSV export/import for transactions
│       └── app.js            # Orchestration, report aggregation, scroll-spy nav
├── LICENSE
└── README.md
```

---

## Getting Started

### 1. Create the Google Sheet

Create a new spreadsheet named "Ledger" with the tabs described in [Data Model](#data-model). Share it only with your own Google account (the default — no extra action needed).

### 2. Create a Google Cloud OAuth client

1. Create a Google Cloud project and enable the **Google Sheets API**.
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Add the origin(s) the app will be served from (e.g. `https://<your-username>.github.io`) as authorized JavaScript origins. For local development, also add `http://localhost:8000`.

### 3. Configure the app

Edit `assets/script/config.js`:

```js
const CONFIG = {
  CLIENT_ID: '<your-client-id>.apps.googleusercontent.com',
  SPREADSHEET_ID: '<your-spreadsheet-id>',
  SHEETS: {
    TRANSACTIONS: 'Transactions',
    REPORT: 'Monthly Summary',
    BALANCE: 'Account Balance',
    ACCOUNTS: 'Account Balance',
    INSIGHT: 'Insight',
    RECONCILIATION: 'Reconciliation',
  },
};
```

These values are not secrets — see [Security & Privacy](#security--privacy).

### 4. Run locally

No build step is required. Serve the directory with any static file server, e.g.:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`.

---

## Deployment

The app is a static site — any static host works, but GitHub Pages requires zero configuration:

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Source**, select **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Save. The site will be published at `https://<your-username>.github.io/<repo-name>`.

Make sure that URL is added as an authorized JavaScript origin for the OAuth client (see [Getting Started](#getting-started)).

---

## Configuration Reference

**Sheet ranges read/written by the app:**

| Range | Used in | Purpose |
|---|---|---|
| `'Monthly Summary'!A1:Z149` | `app.js` | Header row (for dynamic category column matching) plus monthly income/expense/category data and cumulative savings |
| `'Account Balance'!A1:D1` | `app.js` | Total Savings figure (`D1`) for the summary card |
| `Insight!A2:F200` | `app.js` | Per-category, per-Type spend breakdown for the Average Monthly Spending by Category chart, Spending Breakdown by Category donuts, and Spending Breakdown by Type donuts, and the source of the category list (column A) for chart category matching |
| `'Reconciliation'!B5` | `app.js` | Missing Amount — non-zero means recorded account balances don't reconcile with transaction history (a transaction may be missing or a balance may be wrong) |
| `Transactions!A2:F` | `transactions.js`, `csv.js` | Transaction rows |
| `'Account Balance'!A3:D100` | `accounts.js` | Account name, institution, type, balance |
| `'Account Balance'!A3:A100`, `Insight!A2:A200` | `transactions.js` | Dropdown option lists for the transaction form |

**Client-side cache (`localStorage`, 5-minute TTL via `cache.js`):**

| Cache key | Set by | Contents |
|---|---|---|
| `ledger_cache_report` | `app.js` | Aggregated report (summary cards, chart data, Average Monthly Spending by Category comparison, Spending Breakdown by Type) |
| `ledger_cache_lists` | `transactions.js` | Transactions sheet ID + account/category dropdown options |
| `ledger_cache_transactions` | `transactions.js` | Raw `Transactions!A2:F` rows |
| `ledger_cache_accounts-meta` | `accounts.js` | `Account Balance` sheet ID |
| `ledger_cache_account-list` | `accounts.js` | Raw `'Account Balance'!A3:D100` rows |

**Auth token (`localStorage`, separate from the cache above):**

| Key | Set by | Contents |
|---|---|---|
| `ledger_token` | `auth.js` | `{ token, expiresAt }` — OAuth access token + expiry, enables silent refresh |

---

## Caching Strategy

- `index.html` is served with `Cache-Control: no-cache, no-store, must-revalidate`, so the app shell is never stale.
- All Sheets API responses are cached in `localStorage` for 5 minutes (`cache.js`), keyed per data set (see [Configuration Reference](#configuration-reference)).
- Every write operation (add/edit/delete) immediately refreshes only the affected cache entries, so the UI updates without a full reload.
- The 🔄 **Refresh** button (floating, bottom-right) clears the cache and re-fetches all data.
- The 🧹 **Clear Cache** button (floating, bottom-right) additionally purges Cache Storage and unregisters any service workers before reloading — useful if a browser has pinned an old deployed version.

---

## Security & Privacy

- Financial data lives in a private Google Sheet, shared with no one but the owner.
- The frontend authenticates with per-user Google OAuth (`spreadsheets` scope). Anyone can load the static site and sign in with their own Google account, but the Sheets API will simply deny access to a spreadsheet they don't own or have been shared.
- `CLIENT_ID` and `SPREADSHEET_ID` in `config.js` are not secrets — access is enforced by Google's OAuth consent and the spreadsheet's sharing settings, not by hiding these IDs.
- There is no backend, no password storage, and no third-party data store.
- **Privacy mode** masks on-screen amounts by default (see [Features](#features)) for safer screen-sharing or use in public — this is a display-only toggle and doesn't affect what's stored in the spreadsheet.

---

## License

All rights reserved. See [LICENSE](LICENSE) — no permission is granted to copy, modify, or redistribute this project without the copyright holder's prior written consent.
