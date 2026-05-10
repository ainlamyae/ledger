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
- [ ] Rebuild `Transactions` with columns `Date | Account | Payee | Description | Amount | Category` (matches what `Report`'s `SUMIFS` formulas already expect)
- [ ] Clean data per the *Issues* list (real dates, canonical account names, consistent category casing)
- [ ] Create the `Accounts` (validation list) and `Categories` tabs
- [ ] Add data validation dropdowns for `Account` and `Category` columns in `Transactions`
- [ ] Verify `Report`'s `SUMIFS` formulas recalculate correctly against the renamed sheet

### Phase 1 — Auth & API plumbing
- [ ] Set up Google Cloud project + OAuth Client ID
- [ ] `auth.js`: sign-in/sign-out with Google Identity Services, token persistence
- [ ] `sheets.js`: `batchGet`/`values.get` wrapper, `append`/`update` for writes

### Phase 2 — Frontend scaffold
- [ ] Split current monolithic `index.html` into `index.html` + `styles.css` + `app.js`
- [ ] Add a sign-in gate; show dashboard only after auth succeeds

### Phase 3 — Read-only dashboard (MVP)
- [ ] Fetch `Report` for net worth, monthly income/expenses, and savings rate (already pre-aggregated by Google Sheets)
- [ ] Fetch `Transactions` for the recent transactions table
- [ ] Replace hardcoded cards/table in `index.html` with live data
- [ ] `charts.js`: cash flow chart (last 6–12 months) from `Report`

### Phase 4 — Transaction management (CRUD)
- [ ] Add-transaction form → append row to `Transactions`
- [ ] Edit/delete transaction → update/delete row by tracked row index
- [ ] Client-side search/filter over fetched transactions (with pagination — 10k+ rows)

### Phase 5 — Reports & analytics
- [ ] Expense breakdown by category (donut chart)
- [ ] Income vs expense trend (Chart.js line/bar) from `Report`
- [ ] Cumulative savings trend over time (from `Report`)

### Phase 6 — Account management
- [ ] Accounts page: manage the validation list (add/edit known account names)
- [ ] Optional future tabs (investments, medical, utilities) — see *Future tabs*

### Phase 7 — Performance & polish
- [ ] Cache sheet data client-side (localStorage/IndexedDB) with manual refresh + TTL
- [ ] Loading/error states for auth & API failures
- [ ] Virtualized/paginated transactions table
- [ ] Mobile responsiveness pass

### Phase 8 — Future (v2/v3)
- [ ] Budget tracking by category
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
