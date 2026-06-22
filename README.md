# Ledger

A private, serverless personal finance dashboard. Ledger reads and writes directly to a Google Sheet you own — there is no backend, no database, and no third-party data store. The site is public on GitHub Pages and usable by anyone with a Google account: each user clones their own copy of the Ledger template and the app talks only to that copy, scoped via Google Drive's per-file `drive.file` permission — the financial data behind it is only ever accessible to the Google account that owns that particular spreadsheet.

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
- **Spending by Category** — a grouped bar chart comparing each category's average monthly spend over four periods (Last Month as-is, Last Quarter Average ÷ 3, Last Year Average ÷ 12, and Lifelong Average ÷ total months of data; each category's 4 bars are shaded from its own color, most recent = most opaque), plus four donut charts breaking down each period's spending by category share. Both share one legend, and categories are ordered by Lifelong Average spend, highest first.
- **Spending Breakdown by Type** — for each spending category, four donut charts (Last Month, Last Quarter, Last Year, Lifelong) breaking that category's spend down by `Type`, a free-text prefix convention in the `Transactions` `Description` field (e.g. "Bread - milk and eggs"), pre-aggregated by formulas in the `Insight` sheet. Panels are ordered by lifelong spend (highest first), and each donut includes an "Untyped" slice for spending without a recognized prefix.
- **Trend** — three charts in one panel: **Spending Trend by Category** (stacked bar chart of spending by category, month over month, with categories stacked in the same highest-to-lowest Lifelong Average order as Spending by Category), **Income vs. Expenses Trend** (stepped area chart of the full transaction history), and **Cumulative Savings Trend** (running total of savings as a line chart).
- **Common** — a panel of three bar charts derived straight from transaction history (income rows excluded): **Most Common Payees** and **Most Common Expense Descriptions** (record counts, top 25), and **Total Spend by Payee** (summed expense amounts, top 25 by absolute total, bars colored green/red for net income/expense).
- **Transactions** — searchable, filterable, sortable, paginated (⬅️/➡️) table with add/edit/delete. CSV import also exists (`csv.js`) but its button is hidden from the UI by default. The Payee, Description, and Category fields all autocomplete from your transaction history and the `Insight` category list (most-used values first) instead of a fixed dropdown, helping correct typos or voice-dictation mistakes and letting you type a brand-new category (e.g. "Income") on the fly. Long Payee/Description values are truncated with an ellipsis (hover to see the full text). The Amount field accepts a simple arithmetic expression (optionally prefixed with `=`, e.g. `=-9.97-1.30` to add tax, or `-32/2` to split a charge); results are rounded to the nearest cent.
- **Bulk transaction operations** — a checkbox per row (plus a header "select all") shows a running count and total (privacy-mode aware) of the selected transactions below the table, alongside ✏️ Edit Selected and 🗑️ Delete Selected buttons. Edit Selected opens a form pre-filled with whichever fields are identical across every selected transaction (a field that differs is left blank); only fields you actually fill in are applied to all selected rows, so e.g. recategorizing a batch doesn't touch their dates or amounts. Bulk delete issues one `batchUpdate` with a `deleteDimension` request per row, ordered highest-row-first so earlier deletes in the same call can't invalidate later ones. Selection clears whenever the underlying view changes (search/filter/sort/page) but survives an unrelated re-render.
- **Undo for bulk edit and deletes** — editing or deleting a transaction (single or bulk) shows a toast with an Undo button for a few seconds. Undoing a delete re-appends the deleted row(s) — they land back at the end of the sheet rather than their original position, since Sheets addresses rows by position and the delete has already shifted everything below them. Undoing a bulk edit writes each transaction's original values back in place instead, since those rows were never removed.
- **Keyboard shortcuts** — `/` focuses the transaction search box, `n` opens Add Transaction, `Esc` closes whichever modal (or the account menu) is open, and `?` toggles a shortcuts-help overlay. All except `Esc` are ignored while focus is in any text field, so they never fire while typing.
- **Report Transactions** — a dedicated panel (alongside the Transactions list, in the same panel group) with a From/To date range and a filter builder: each row picks a field (Account, Payee, Description, Category, Amount), an operator (Contains/Equals/etc. for text fields, =, ≠, >, >=, <, <= for Amount), and a value. Rows after the first get an AND/OR selector, evaluated left to right, so filters can be combined (e.g. Category contains "Grocery" OR Category contains "Household", AND Amount < 0). The matching transactions and their total preview live as you adjust the filters — nothing renders until you touch a filter, so opening the panel doesn't pay the cost of listing every transaction — and the Export CSV button writes exactly what's previewed.
- **Accounts** — the Account Composition donut chart (a 3-ring nested donut: the inner ring shows each account type's share of total balance shaded by type, the middle ring breaks that down by institution — each institution has one fixed color, even if its accounts span multiple types — and the outer ring by individual account, shaded by its institution's color; both rings use colors spread evenly around the color wheel so no two entries share a color, however many there are. Account types and institutions are both ordered by absolute balance highest first, so a type or institution with a large negative net — e.g. Credit/debt — still ranks by its size rather than sorting last; types and institutions with a zero balance total are omitted), followed by the Account List panel: a sortable table of balances by institution/type, with add/edit/delete, inline Total Savings recalculation, and a reconciliation status (✅ Reconciled, or ⚠️ with the gap amount if recorded balances don't match transaction history). The Balance field accepts the same arithmetic-expression syntax as the transaction Amount field.
- **Time Sheet** — a "Log a Day" button opens a modal to record a day's Start/End time, Break, and an optional Task note (a weekday with no times but a Task note is treated as a holiday/day off; one with neither is flagged as a missed entry). The modal shows a live "Log Time" duration preview that recomputes as Start/End/Break change (or shows "🏖 Holiday" once that checkbox is ticked), so you see the computed hours before saving. A reminder banner appears whenever today is a weekday with nothing logged yet, with its own "Log a Day" shortcut and an opt-in "Enable reminders" button — browsers require a direct user gesture to grant `Notification` permission, so it's never requested automatically; once granted, an OS-level notification fires once per day (guarded via `localStorage`) instead of only the in-page banner. The **Work Pattern Analysis** panel renders four charts above the log: histograms — each with a fitted normal-distribution curve overlay, bars shown as a % of all logged days (so the curve's height tracks the bars regardless of sample size; the tooltip still shows the underlying day count) — of Start Time, End Time, and Duration across weekday work shifts (weekends, holidays/days off, and mis-keyed negative durations are excluded), plus a bar chart of Average Hours per Day over Last Week/Last Month/Last Quarter/Last Year/Lifelong, averaged only over working days so weekends and holidays don't pull the average down. All four charts share the same bar thickness and x-axis label-row height regardless of how many bars/bins each has, so they line up evenly side by side; Average Hours per Day's longer period labels are rotated vertical to fit that shared height without overlapping or clipping. Below that, the Time Log table lists entries within a From/To date range, sortable by Date, with computed Duration and inline edit.
- **Panel groups** — Charts, Transactions, Accounts, and Time Sheet each wrap their related panels in a bordered group with one heading; clicking that nav link expands every panel in its group at once.
- **Collapsible panels** — every chart/table panel is collapsed by default; click its title to expand or collapse it (dragging to select the title's text does not toggle it). A floating "expand/collapse all" button toggles every panel at once.
- **Privacy mode** — a floating 🙈/👁️ button masks every dollar amount across the summary cards, tables, and charts by replacing each digit with `*` (e.g. `$1,234.56` → `$*,***.**`). Amounts are hidden by default each time you sign in; click the button to reveal them for the rest of the session.
- **Dark mode** — a floating 🌙/☀️ button switches the whole app — including charts and the landing page — between light and dark themes, persisted in `localStorage`.
- **Resilient sign-in** — silent token refresh on return visits (including PWA/home-screen launches), with a full consent prompt only when needed. A tab left open also renews its own access token silently a few minutes before the ~1-hour expiry, so an active session doesn't get kicked back to the sign-in gate just from sitting open.
- **Account menu** — once signed in, the header shows the Google account's avatar (or initials, if it has none); clicking it opens a dropdown with the account's name/email and a Sign out button.
- **Local caching** — a 5-minute `localStorage` cache avoids redundant Sheets API calls; manual refresh and clear-cache controls are available as floating buttons.

Category-based charts (Spending by Category, Spending Trend by Category, Spending Breakdown by Type) all assign each category/type a color spread evenly around the color wheel, ordered by highest-to-lowest absolute spend.

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
     │  - scope: .../drive.file    │   └────────────────┬──────────────────┘
     └────────────────────────────┘                    │ (4) read / write
                                                          ▼
                                  ┌─────────────────────────────────────────────┐
                                  │      The signed-in user's own Ledger copy    │
                                  │   (cloned from TEMPLATE_SPREADSHEET_ID via    │
                                  │    Sheets' "make a copy", picked via Picker) │
                                  │                                               │
                                  │  Transactions    Account Balance             │
                                  │  Monthly Summary (formulas)                  │
                                  │  Insight (formulas)                          │
                                  │  Reconciliation (formulas)                   │
                                  └───────────────────────────────────────────────┘
```

Because every Sheets API call carries the signed-in user's own OAuth token, scoped via `drive.file` to only the specific spreadsheet they created or picked, each user can only ever read or write their own copy — even though the static site and `config.js` (Client ID + the public template ID) are visible to everyone.

### Frontend Module Map

Loaded as classic `<script>` tags (no bundler), in this order, sharing one global scope:

| Order | Module | Responsibility | Key exports used elsewhere |
|---|---|---|---|
| 1 | `config.js` | `CONFIG`: Client ID, template spreadsheet ID, Picker API key, sheet tab names | `CONFIG` |
| 2 | `auth.js` | Google sign-in/out, token persistence (`localStorage`), silent refresh, account profile lookup for the header avatar menu | `initAuth`, `signIn`, `signOut`, `getAccessToken`, `fetchUserInfo` |
| 3 | `drive.js` | Per-user spreadsheet selection: opens Sheets' "make a copy" link for the template, Google Picker for selecting/confirming a file, `localStorage`-backed active spreadsheet ID | `openTemplateCopyLink`, `pickSpreadsheet`, `getActiveSpreadsheetId`, `setActiveSpreadsheetId`, `clearActiveSpreadsheetId` |
| 4 | `sheets.js` | Thin Sheets API v4 wrapper (get / batchGet / append / update / clear / batchUpdate) against the active spreadsheet ID | `getValues`, `batchGetValues`, `appendValues`, `updateValues`, `batchUpdate`, `getSpreadsheetMetadata` |
| 5 | `cache.js` | `localStorage`-backed cache with 5-minute TTL, hard-refresh (cache + Cache Storage + service workers), and the shared numeric-expression evaluator used by the Balance and Amount fields | `getCached`, `setCached`, `clearCache`, `hardRefresh`, `evaluateNumberExpression` |
| 6 | `charts.js` | Chart.js renderers for the dashboard charts, including the 4-donut Spending by Category breakdown grid, the per-category Spending Breakdown by Type donut grids, the nested Account Composition donut, the Time Sheet Work Pattern Analysis charts (Start/End Time and Duration histograms with a normal-curve overlay, plus the Average Hours per Day bar chart), and the Common panel's Most Common Payees/Descriptions and Total Spend by Payee bar charts | `renderSpendingTrendChart`, `renderSpendingBreakdownCharts`, `renderTypeBreakdownCharts`, `renderIncomeExpenseChart`, `renderExpenseBreakdownTrendChart`, `renderSavingsTrendChart`, `renderAccountCompositionChart`, `renderTimesheetDistributionCharts`, `renderTimesheetDailyAverageChart`, `renderCommonPayeeChart`, `renderCommonDescriptionChart`, `renderPayeeSpendChart` |
| 7 | `transactions.js` | Transactions table: list, search/filter, sortable columns, pagination, add/edit/delete, Payee/Description/Category autocomplete, multi-select bulk edit/delete with selected-row sum | `initTransactions`, `refreshTransactions`, `refreshAccountOptions`, `bulkDeleteTransactions`, `restoreTransactions`, `openBulkEditForm`, `submitBulkEditForm` |
| 8 | `accounts.js` | Accounts table: balances + validation list, sortable, add/edit/delete | `initAccountManager` |
| 9 | `timesheet.js` | Time Sheet: Time Log table (date-range filter, sortable, add/edit), holiday/missed-entry detection, client-side Duration computation, the data feeding the Work Pattern Analysis charts, and the today-not-logged reminder banner/notification | `initTimeSheet`, `refreshTimeSheet`, `getFilteredTimeEntries`, `checkTimesheetReminder` |
| 10 | `csv.js` | CSV import for transactions, plus the Report Transactions live preview/export (date range + AND/OR field filters) | `initCsvControls` |
| 11 | `app.js` | Orchestration: report aggregation, dashboard rendering, file-selection gate, scroll-spy nav, collapsible panels, dark mode toggle, app-level keyboard shortcuts, the shared undo toast, wiring everything together on `window.load` | `loadDashboard`, `handleAuthChange`, `setupKeyboardShortcuts`, `showUndoToast` |

### Data Flow

**Sign-in**
1. `app.js` calls `initAuth(handleAuthChange)`.
2. `auth.js` checks `localStorage` for a non-expired token. If found, it's used immediately. If not, a *silent* `requestAccessToken({ prompt: 'none' })` is tried against the existing Google session — only if that fails does the landing page's "Sign in with Google" button trigger a full consent prompt.
3. On success, `handleAuthChange(token)` checks `getActiveSpreadsheetId()` (`drive.js`). If a spreadsheet is already selected for this browser, it swaps the landing page for the dashboard and calls `loadDashboard()`. Otherwise it shows the file-selection gate.

**File selection** (first run on a browser, or after sign-out/clearing storage)
3a. "Get the Template" opens Google Sheets' own `/copy` URL for `CONFIG.TEMPLATE_SPREADSHEET_ID` in a new tab — Sheets clones it directly into the user's Drive via Google's UI, with no extra OAuth scope needed.
3b. "Select my Ledger" calls `pickSpreadsheet()`, which opens a Google Picker scoped to Sheets files. Picking a file (the new copy, or an existing one from a prior session) is what grants the `drive.file`-scoped token access to that specific file; its ID is stored as `ledger_spreadsheet_id` and the dashboard loads.

**Dashboard load**
4. `loadReport()` returns cached data (`ledger_cache_report`, 5-minute TTL) or issues a single `batchGetValues` for the `Monthly Summary`, `Account Balance`, `Insight`, and `Reconciliation` ranges, then derives the summary cards, the income/expense and cumulative-savings trends, the per-category spending trend over time, the Spending by Category comparisons, the per-category `Type` breakdown for the Spending Breakdown by Type donuts, and the reconciliation status shown above the Accounts table.
5. `initTransactions()`, `initAccountManager()`, and `initTimeSheet()` run concurrently (`Promise.allSettled`), each checking their own cache before calling the Sheets API. Once `initTransactions()` resolves, `app.js` renders the Common panel's three charts (Most Common Payees, Most Common Expense Descriptions, Total Spend by Payee) from the loaded transaction list.
6. `charts.js` renders all Chart.js canvases — the 4 line/bar charts, the 4-donut Spending by Category breakdown grid, the per-category Spending Breakdown by Type donut grids, and the Time Sheet Work Pattern Analysis charts; `app.js` renders the summary cards; `accounts.js`, `transactions.js`, and `timesheet.js` render their tables.

**Writes** (add/edit/delete transaction or account, edit balance, CSV import)
7. UI actions call `appendValues` / `updateValues` / `batchUpdate` directly against the spreadsheet.
8. On success, the relevant cache key is refreshed (`refreshTransactions(true)`, `refreshAccountsList(true)`, `refreshNetWorth()`, etc.) so the UI reflects the change immediately without a full page reload.

**Manual refresh**
9. The 🔄 Refresh and 🧹 Clear Cache buttons — part of the floating action button stack in the bottom-right corner — clear the cache and re-fetch everything; Clear Cache additionally clears Cache Storage and unregisters any service workers, then reloads — for recovering from a stale deployed version. The same stack also holds the 🌙/☀️ dark mode toggle and the expand/collapse-all panels button.

---

## Data Model

A single Google Sheet (cloned per-user from the template) with the following tabs, accessible only to the Google account that owns that copy.

### `Transactions`

| Column | Type | Notes |
|---|---|---|
| A — Date | Date | ISO format |
| B — Account | Text | Must match a name in `Account Balance` column A |
| C — Payee | Text | Merchant / person / institution |
| D — Category | Text | Must match a category name in `Insight` column A |
| E — Description | Text | Optional detail |
| F — Amount | Number | Positive = income, negative = expense. The sign alone defines the type — there is no separate Income/Expense column. |

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
| A — Category | Category name. Column A is also the source of the category list used throughout the dashboard and the transaction form's Category autocomplete suggestions — each unique value across all rows becomes one category. The form isn't limited to this list — typing a new value (e.g. "Income") works too. |
| B — Type | A `Description` prefix, or **blank** for a row holding that category's overall total |
| C — Last Month | `-SUMIFS(...)` over `Transactions`, matching Category, `Description` starting with `Type` (via `Type&"*"`, or no Description filter if `Type` is blank), `Amount < 0`, and the date window for "last month" |
| D — Last Quarter | Same, for the trailing 3-month window |
| E — Last Year | Same, for the trailing 12-month window |
| F — Lifelong | Same, with no date filter |

Cell `H1` holds `=TODAY()`, the single anchor date that every period's `EOMONTH(...)`-based date window is computed relative to.

For each category, the blank-`Type` row's totals are used as that category's overall spend; the gap between that total and the sum of its named `Type` rows becomes the "Untyped" donut slice. `Type` rows with a Lifelong value of `0` (a retired Type with no historical spend) are excluded entirely, so removing a Type from active use doesn't leave an empty entry in the legend. The 5 categories shown (Grocery, Household, Personal, Transportation, Housing) are a fixed list in `charts.js` (`TYPE_BREAKDOWN_CATEGORIES`) — adding a new category requires adding its rows to `Insight`, the category name to that constant, and a matching donut-grid block in `index.html`.

### `eTimeSheet`

One row per logged calendar day, oldest first. Data rows start at row 2.

| Column | Type | Notes |
|---|---|---|
| A — Date | Date | ISO format |
| B — Day | Text | Weekday name; only written when a brand-new row is appended, never read back |
| C — Start | Text | `HH:MM`, blank for a holiday/day off |
| D — End | Text | `HH:MM`, blank for a holiday/day off |
| E — Break | Number (minutes) | Break length; pre-existing Excel-style `H:MM`/`H:MM:SS` duration cells are also parsed |
| F — Duration | — | Never read or written by the app — `timesheet.js` always computes worked time client-side from Start/End/Break |
| G — Task | Text | Free-text note. On a weekday with no Start/End, a non-blank Task marks the day as a holiday/day off; blank instead flags a missed entry |

A weekend day (Saturday/Sunday) with no Start/End is neither a holiday nor a missed entry — it's just not logged. Logging a new date that leaves a gap since the last logged date backfills every missing day in between with a blank row first, keeping one row per calendar day.

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
| Authentication | [Google Identity Services](https://developers.google.com/identity) (GIS), OAuth 2.0 token flow, `drive.file` + `userinfo.email`/`userinfo.profile` scopes |
| File selection | [Google Picker API](https://developers.google.com/drive/picker) |
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
│       ├── config.js        # Client ID + template Spreadsheet ID + Picker API key + sheet/range names
│       ├── auth.js           # Google Identity Services sign-in/out, token storage
│       ├── drive.js          # Per-user spreadsheet selection: template copy link, Picker, active-file storage
│       ├── sheets.js         # Sheets API wrapper (get, batchGet, append, update, batchUpdate)
│       ├── cache.js          # localStorage cache + hard refresh
│       ├── charts.js         # Chart.js renderers
│       ├── transactions.js   # Transactions table: filters, sorting, CRUD
│       ├── accounts.js       # Accounts table: balances + CRUD
│       ├── timesheet.js      # Time Sheet: Time Log table + Work Pattern Analysis chart data
│       ├── csv.js            # CSV export/import for transactions
│       └── app.js            # Orchestration, report aggregation, scroll-spy nav
├── LICENSE
└── README.md
```

---

## Getting Started

These steps are for the app's developer/deployer, done once. Individual users don't configure anything — they just sign in and pick or create their own spreadsheet from the running app (see [Data Flow](#data-flow)).

### 1. Create the template Google Sheet

Create a spreadsheet with the tabs described in [Data Model](#data-model), pre-populated with a small amount of sample data so charts aren't empty on a new user's first run. Share it as **Anyone with the link can view** — this is the file every user's personal copy gets cloned from via Sheets' own "make a copy" flow, so it must be link-viewable but should contain no real personal data.

### 2. Create a Google Cloud project and credentials

1. Create a Google Cloud project and enable the **Google Sheets API**, the **Google Drive API**, and the **Google Picker API**.
2. Create an **OAuth 2.0 Client ID** (Web application). Add the origin(s) the app will be served from (e.g. `https://<your-username>.github.io`) as authorized JavaScript origins. For local development, also add `http://localhost:8000`.
3. Create an **API key** (Cloud Console → Credentials → Create Credentials → API key) and restrict it to the Picker API and the same origins. This is separate from the OAuth Client ID — the Picker widget needs it to initialize.

### 3. Configure the app

Edit `assets/script/config.js`:

```js
const CONFIG = {
  CLIENT_ID: '<your-client-id>.apps.googleusercontent.com',
  TEMPLATE_SPREADSHEET_ID: '<your-template-spreadsheet-id>',
  PICKER_API_KEY: '<your-picker-api-key>',
  SHEETS: {
    TRANSACTIONS: 'Transactions',
    REPORT: 'Monthly Summary',
    BALANCE: 'Account Balance',
    ACCOUNTS: 'Account Balance',
    INSIGHT: 'Insight',
    RECONCILIATION: 'Reconciliation',
    TIMESHEET: 'eTimeSheet',
  },
};
```

None of these values are secrets — see [Security & Privacy](#security--privacy). Note that the `drive.file` scope (see [Tech Stack](#tech-stack)) is an unverified-app-friendly scope, so this doesn't require Google's sensitive-scope OAuth verification review the way a broader Sheets/Drive scope would.

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
| `Insight!A2:F200` | `app.js` | Per-category, per-Type spend breakdown for the Spending by Category bar chart and donuts, and the Spending Breakdown by Type donuts, and the source of the category list (column A) for chart category matching |
| `'Reconciliation'!B5` | `app.js` | Missing Amount — non-zero means recorded account balances don't reconcile with transaction history (a transaction may be missing or a balance may be wrong) |
| `Transactions!A2:F` | `transactions.js`, `csv.js` | Transaction rows |
| `'Account Balance'!A3:D100` | `accounts.js` | Account name, institution, type, balance |
| `'Account Balance'!A3:A100`, `Insight!A2:A200` | `transactions.js` | Account dropdown and Category autocomplete suggestions for the transaction form |
| `eTimeSheet!A2:G` | `timesheet.js` | Time Log rows; read for the table, Work Pattern Analysis charts, and gap backfill, appended/updated on add or edit |

**Client-side cache (`localStorage`, 5-minute TTL via `cache.js`):**

| Cache key | Set by | Contents |
|---|---|---|
| `ledger_cache_report` | `app.js` | Aggregated report (summary cards, chart data, Spending by Category comparison, Spending Breakdown by Type) |
| `ledger_cache_lists` | `transactions.js` | Transactions sheet ID + account/category dropdown options |
| `ledger_cache_transactions` | `transactions.js` | Raw `Transactions!A2:F` rows |
| `ledger_cache_accounts-meta` | `accounts.js` | `Account Balance` sheet ID |
| `ledger_cache_account-list` | `accounts.js` | Raw `'Account Balance'!A3:D100` rows |
| `ledger_cache_timesheet` | `timesheet.js` | Raw `eTimeSheet!A2:G` rows |

**Auth and file selection (`localStorage`, separate from the cache above):**

| Key | Set by | Contents |
|---|---|---|
| `ledger_token` | `auth.js` | `{ token, expiresAt }` — OAuth access token + expiry, enables silent refresh |
| `ledger_spreadsheet_id` | `drive.js` | The signed-in user's chosen spreadsheet's Drive file ID — every Sheets API call in `sheets.js` targets this ID, not a fixed constant |
| `ledger_last_reminder_notified` | `timesheet.js` | Today's date once the Time Sheet OS notification has fired, so it only fires once per day rather than on every reload |

---

## Caching Strategy

- `index.html` is served with `Cache-Control: no-cache, no-store, must-revalidate`, so the app shell is never stale.
- All Sheets API responses are cached in `localStorage` for 5 minutes (`cache.js`), keyed per data set (see [Configuration Reference](#configuration-reference)).
- Every write operation (add/edit/delete) immediately refreshes only the affected cache entries, so the UI updates without a full reload.
- The 🔄 **Refresh** button (floating, bottom-right) clears the cache and re-fetches all data.
- The 🧹 **Clear Cache** button (floating, bottom-right) additionally purges Cache Storage and unregisters any service workers before reloading — useful if a browser has pinned an old deployed version.

---

## Security & Privacy

- Each user's financial data lives in their own private Google Sheet (a personal clone of the public template), accessible only to them.
- The frontend authenticates with per-user Google OAuth using the `drive.file` scope — the narrowest Drive scope available, granting access only to files the app created or the user explicitly selected via Picker. It cannot see or list the rest of a user's Drive. It also requests the non-sensitive `userinfo.email`/`userinfo.profile` scopes, used only to show the account's name/avatar in the header menu — no separate API or data store is involved.
- `CLIENT_ID`, `TEMPLATE_SPREADSHEET_ID`, and `PICKER_API_KEY` in `config.js` are not secrets — access is enforced by Google's OAuth consent and each spreadsheet's own ownership/sharing, not by hiding these values. The template itself is intentionally link-viewable and contains no real personal data — see the template-build process in `scripts/build_template.py`.
- There is no backend, no password storage, and no third-party data store.
- **Privacy mode** masks on-screen amounts by default (see [Features](#features)) for safer screen-sharing or use in public — this is a display-only toggle and doesn't affect what's stored in the spreadsheet.

---

## License

All rights reserved. See [LICENSE](LICENSE) — no permission is granted to copy, modify, or redistribute this project without the copyright holder's prior written consent.
