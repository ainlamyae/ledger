# ledger

A lightweight, serverless personal accounting application built with GitHub Pages and Google Sheets.

Track income, expenses, account balances, investments, and financial trends while keeping all data in your own private Google account. The site is public (GitHub Pages), but the data behind it stays private — accessible only to whoever signs in with the Google account that owns the spreadsheet.

> **Note:** `Accounting.xlsx` in this repo is a local working copy of real personal financial data. It is listed in `.gitignore` and must never be committed or pushed. It is used here only as a reference for designing the Google Sheets schema below.

---

## Analysis of the Current Data (`Accounting.xlsx`)

The existing workbook has 8 sheets, ~10,500 transactions spanning 2018–2026:

| Sheet | Rows | Purpose | Notes |
|---|---|---|---|
| `Balance` | ~27 | Net worth snapshot: investments, account balances, credit cards, IOUs | Manually maintained, not derived |
| `Report` | 150 | Monthly rollup by category (Income, Expenses, Saved, Cumulative Saving) | Looks like a manual/pivot summary of `Detail` |
| `Detail` | 10,523 | Core transaction ledger: Date, Account, Payee, Description, Amount, Category | Main data source |

### Issues found that the new schema should fix

- **Dates stored as text** (`'2018.09.05'`) instead of real date values — breaks sorting/filtering and Sheets API date math.
- **Inconsistent account naming**: `Hossein`, `TDV`/`TDD`/`TDC`, `RBCV`/`RBCM`/`RBCD`, etc. — needs a canonical account list with dropdown validation.
- **Inconsistent category casing**: `Tax` vs `TAX`.
- **No Income/Expense/Transfer distinction** — credit card payments and inter-account transfers are mixed in with real income/expenses, which can double-count cash flow.
- **Personal IOUs mixed with real accounts** (`Hossein`, `Borna`, `Reza`, `Amin`, `Mostafa`, `Ali Asghar`, `Ehsan`, `Parsapour`, `Conica`, `Basiri + Mazaheri`) — these are people who owe/are owed money, not financial institutions.
- **`Report` sheet is a static manual summary** — better computed dynamically in the frontend so it always reflects the latest data.

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
| Category | Text | From `Categories` dropdown |
| Type | Text | `Income` / `Expense` / `Transfer` |
| Amount | Number | Positive for income, negative for expense |
| Notes | Text | Optional |

### 2. `Accounts`
| Column | Type | Notes |
|---|---|---|
| Account Name | Text | Canonical name (data validation source for `Transactions`) |
| Institution | Text | e.g. Wealthsimple, CIBC, RBC, Tangerine |
| Type | Text | Chequing / Savings / Credit / Cash / Investment / Loan / Person (IOU) |
| Currency | Text | Default CAD |
| Opening Balance | Number | Starting balance before first tracked transaction |
| Opening Date | Date | |
| Active | Boolean | Hide closed accounts from dashboard |

Current balance per account = `Opening Balance + SUMIF(Transactions, Account)` — computed live, no manual upkeep.

### 3. `Categories`
| Column | Type | Notes |
|---|---|---|
| Category | Text | e.g. Grocery, Transportation, Medical |
| Type | Text | Income / Expense |
| Group | Text | Rollup grouping, e.g. "Living Expenses", "Discretionary", "Savings" |
| Color | Text | Hex color for charts |
| Monthly Budget | Number | Optional, used in v2 budget tracking |

### 4. `Investments` (replaces `RRSP`, extensible to other accounts)
| Column | Type | Notes |
|---|---|---|
| Date | Date | |
| Account | Text | e.g. RRSP, TFSA, FHSA |
| Fund | Text | Fund name |
| Units | Number | |
| Unit Price | Number | |
| Amount | Number | |
| Contribution Type | Text | Member / Employer / Personal |

### 5. `Medical`
| Column | Type | Notes |
|---|---|---|
| Date | Date | |
| Provider | Text | |
| Service | Text | |
| Submitted | Number | |
| Eligible | Number | |
| Paid by Plan | Number | |
| Out of Pocket | Number | Auto-flows into `Transactions` as a single Medical-category row |

### 6. `Utilities` (replaces `Hydro`, generalized)
| Column | Type | Notes |
|---|---|---|
| Date | Date | |
| Utility | Text | Electricity / Gas / Water / Internet |
| Amount | Number | |
| Period Days | Number | |
| Daily Cost | Number | Computed `=Amount/Period Days` |
| Notes | Text | |

### 7. `Settings`
| Key | Value |
|---|---|
| Currency | CAD |
| Locale | en-CA |
| Spreadsheet Version | schema version, for migration scripts |

The `Balance` and `Report` sheets are **dropped** — net worth, balances, and monthly summaries are computed live in the frontend from `Transactions`, `Accounts`, and `Investments`.

---

## Architecture

```text
+---------------------+
|    GitHub Pages     |
|   Static Website    |
+----------+----------+
           |
           | Google Identity Services (OAuth 2.0)
           | + Sheets API v4 (per-user token)
           |
+----------v----------+
|    Google Sheets    |
|  "Ledger Database"  |
|  (private, owner-   |
|   only sharing)     |
+----------+----------+
           |
+----------v----------+
|   Google Account    |
| Authentication/OAuth|
+---------------------+
```

Because the Sheets API call is made with the signed-in user's own OAuth token, only people the spreadsheet has been shared with (i.e., you) can ever read or write data — even though the site itself and `config.js` (Client ID + Spreadsheet ID) are public.

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
├── index.html        # Dashboard shell + sign-in gate
├── styles.css         # Extracted from current inline <style>
├── app.js              # App init, view routing, state
├── auth.js             # Google Identity Services sign-in/out, token storage
├── sheets.js           # Sheets API wrapper (batchGet, append, update, delete)
├── charts.js           # Chart.js setup for cash flow, category breakdown, etc.
├── config.js           # Client ID + Spreadsheet ID + sheet/range names
├── assets/
│   └── icons/
├── Accounting.xlsx     # local source data — gitignored, never pushed
├── .gitignore
└── README.md
```

---

## Setup Guide (one-time)

1. **Create the Google Sheet**
   - New spreadsheet, add tabs per the *Proposed Google Sheets Data Model* above.
   - Migrate data from `Accounting.xlsx` (clean dates, accounts, categories per the *Issues* list).
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
- [ ] Create the new "Ledger Database" Google Sheet with tabs from the data model above
- [ ] Write a one-off migration script (Node or Python, run locally — not part of the deployed app) to import & clean `Accounting.xlsx` → new sheet
- [ ] Add data validation dropdowns for `Account` and `Category` columns

### Phase 1 — Auth & API plumbing
- [ ] Set up Google Cloud project + OAuth Client ID
- [ ] `auth.js`: sign-in/sign-out with Google Identity Services, token persistence
- [ ] `sheets.js`: `batchGet`/`values.get` wrapper, `append`/`update` for writes

### Phase 2 — Frontend scaffold
- [ ] Split current monolithic `index.html` into `index.html` + `styles.css` + `app.js`
- [ ] Add a sign-in gate; show dashboard only after auth succeeds

### Phase 3 — Read-only dashboard (MVP)
- [ ] Fetch `Transactions`, `Accounts`, `Categories`
- [ ] Compute net worth, monthly income/expenses, savings rate client-side
- [ ] Replace hardcoded cards/table in `index.html` with live data
- [ ] `charts.js`: cash flow chart (last 6–12 months) from real data

### Phase 4 — Transaction management (CRUD)
- [ ] Add-transaction form → append row to `Transactions`
- [ ] Edit/delete transaction → update/delete row by tracked row index
- [ ] Client-side search/filter over fetched transactions (with pagination — 10k+ rows)

### Phase 5 — Reports & analytics
- [ ] Expense breakdown by category (donut chart) and by `Group`
- [ ] Income vs expense trend (Chart.js line/bar, real monthly aggregates)
- [ ] Account balance history over time

### Phase 6 — Account & specialty tracking
- [ ] Accounts page: computed balances, add/edit accounts
- [ ] Investments page (`Investments` tab): contributions over time
- [ ] Utilities page (`Utilities` tab): cost-per-day trend
- [ ] Medical claims tracker

### Phase 7 — Performance & polish
- [ ] Cache sheet data client-side (localStorage/IndexedDB) with manual refresh + TTL
- [ ] Loading/error states for auth & API failures
- [ ] Virtualized/paginated transactions table
- [ ] Mobile responsiveness pass

### Phase 8 — Future (v2/v3)
- [ ] Budget tracking against `Categories.Monthly Budget`
- [ ] Recurring transaction templates
- [ ] CSV import/export
- [ ] AI-generated insights / forecasting

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
