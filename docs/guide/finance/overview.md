# Finance — Overview

[Docs](../../README.md) › Guide › Finance

The Finance section tracks money: summary cards, charts, transactions, accounts, transfers, spending breakdown and an AI snapshot.

## At a glance

- **Hub:** `/finance/` shows the summary cards, then tiles for Chart, Transaction, Account, Portfolio, Watch List and Insight.
- **Transactions drive everything:** each row is one money movement; the sheet's own formulas turn them into monthly figures.
- **Accounts hold balances:** a transaction can move its account's Balance as it saves; 🔀 moves money between two accounts.
- **Checks on the tiles:** red badges flag a stale log, a balance that doesn't match the transactions, and a missed payment.
- **Stocks:** [Watch List](watchlist.md), [Market](market.md) and [Portfolio](portfolio.md) have their own guides.

## Summary

### What it shows

- **Net Worth:** the Account tab's total, read from its cell D1.
- **Monthly Cash Flow:** this month's income less expenditure; green at or above 0, red below.
- **Monthly Income** and **Monthly Expenditure:** this month's figures alone.
  - **Hover:** the average of the previous 3 months (fewer early on); the current month never benchmarks itself.
- **Cumulative Net Worth:** a full-width line of every month, under the four cards.

## Chart

### What it shows

- **Cumulative Net Worth:** a daily line of the running total, with a step on each deposit.
- **Category Expenditure Trend:** stacked spend by category per step, with that step's income as a stepped line.
- **Average Monthly Spending by Category:** grouped bars for Last Month, Quarter ÷ 3, Year ÷ 12 and Lifelong ÷ its complete months.
- **Spending Breakdown by Category:** four donuts (Last Month, Last Quarter, Last Year, Lifelong).
- **`<Category> by Type`:** one card of four donuts per category with named Types, plus an *Untyped* remainder.
- **Account Allocation:** a nested donut of account type (inner), institution (middle) and account (outer).

### Actions

- **Range:** 3m, 6m, 1y (default), 5y, All; windows the first two charts and sets their step: weekly (3m, 6m), monthly (1y), quarterly (5y, All).
- **Legend:** click an entry to hide or show it; the axis refits.
- **📤 Screenshot:** saves the whole page (phone gallery, or a download on a laptop).

### Rules & calculations

- **Source:** every figure is summed from the Transaction tab; Statement only names the categories.
- **Net worth:** the running total of every amount, one point per day through today.
- **Income:** every positive amount; a category's spend is its net (refunds lower it).
- **Periods:** complete months only (previous month, 3, 12, all), so the current month never counts.
- **Types:** a Description starting with one of that category's Breakdown Types counts as that Type.
- **Labels:** thinned so they never overlap; grid lines stay on every step.
- **Allocation sizes:** slices use the absolute balance, so a debt account still draws.

## Transactions

### What it shows

- **Table:** Date, Account, Payee, Category, Description, Amount; 25 rows a page, sortable by any header.
- **Receipts:** a line separates rows whose date, account or payee changes; a receipt of 2+ rows ends in a blue total row.
- **Long text:** Payee and Description are cut with `…`; hover for the full text.
- **Badge:** `31d` on the tile once the newest transaction is over 30 days old, counting up.

### Actions

- **📝 Log** (or `n`): opens the form at `/finance/transaction/log/`.
- **Filters:** From/To dates, Account, Payee (or `/`), Category and Description; they combine.
- **Add Filter:** builds field rules (Account, Payee, Description, Category, Amount) joined by AND or OR.
- **Row buttons:** ✏️ edit, 📋 duplicate (hold it to make 1–100 copies at once), 🗑️ delete with Undo.
- **Select rows:** tick boxes to show ✏️ Edit Selected and 🗑️ Delete Selected left of the header's buttons (the bottom bar on a phone); untick to clear.
  - **Edit Selected** (`/finance/transaction/bulk-edit/`) changes only the fields you fill; Undo writes the old values back.
- **Tax:** multiplies Amount by `TAX_RATE_PCT` (default 13) so you can check it before 💾; a second click taxes again.
- **Confetti:** saving an Income transaction above 0 fires a burst.

### Rules & calculations

- **Sign:** expenses are negative, income positive.
- **Amount arithmetic:** `=-9.97-1.30` or `-32/2` work; the result is rounded to the cent.
- **Autocomplete:** Payee, Category and Description suggest your past values; a new category can be typed in.
- **Account hint:** the chosen account's `Institution Type: Balance` shows beside the select (red when negative).
- **Update the account balance** (ticked by default): adds the amount to the account's Balance in the same save.
  - **Edit:** reverses the old amount and applies the new one, moving between accounts if the account changed.
  - **Off for formulas:** if Balance is a formula or a label like `Closed`, the box turns off and says why.
  - **Failure:** a refused balance write is reported, but the transaction row is already saved.

## Account

### What it shows

- **Accounts table:** Account Name, Institution, Type, Balance, Market Value, with a Total row.
- **Market Value:** blank means not tracked and shows `—`; a text Balance (`Closed`) keeps its label.
- **Reconciliation badge:** `A>T $13` when balances exceed what transactions sum to, `A<T $13` when below.
  - Whole dollars, rounded up; the exact gap is on hover.
- **Payment badge:** `Pay 3d` after an account's name and on the tile when a payment day was missed.

### Actions

- **➕ Add** (`/finance/account/add/`), ✏️ edit, 🗑️ delete.
- **Payment Day:** an optional day of the month (1–31) on the form, for a balance repaid on a set day.

### Rules & calculations

- **Missed payment:** for 3 days after the payment day, when Balance is below 0 and no money came in since the last payment day.
- **Short months:** a day past the month's end uses its last day.
- **Transfers:** a 🔀 transfer logs no transaction, so it clears the badge only by bringing Balance to 0.

## Transfer

### What it shows

- **🔀 Transfer** on the Account page opens `/finance/account/transfer/` to move money between two of your accounts.
- **Fields:** From, To (each with its `Institution Type: Balance`), Amount.

### Actions

- **Pay off To account's full balance:** fills Amount with what brings the To account to 0, and locks it.
- **💾:** writes both Balances; Amount clears so you can send another.

### Rules & calculations

- **Balance only:** nothing is added to the Transaction tab.
- **Formula check:** both accounts are checked first; a formula Balance on either stops the whole transfer.
- **Partial failure:** the message says "Nothing was transferred" or "Half applied… Add $25.00 to Y by hand."

## Breakdown

### What it shows

- **Address:** `/finance/breakdown/`; it has no tile or sidebar link.
- **Table:** one row per Category × Type with Last Month, Last Quarter, Last Year and Lifelong; 100 rows a page.
- **Total rows:** a blank Type (`—`) is the category's own total.
- **Groups:** a line marks the start of each Category.

### Actions

- **➕ Add** (`/finance/breakdown/add/`) and 📋 Duplicate copy an existing row's formulas, so the totals compute themselves.
- **✏️ Edit:** changes Category and Type only; the four amounts show as read-only text.
- **🗑️ Delete:** removes the row; the confirm warns that formulas pointing at it lose it.
- **🔍 Search:** filters by category or type.

### Rules & calculations

- **Money is never written:** the amount columns are the sheet's formulas; the Chart page computes its own from Transaction.

## Insight

### What it shows

- **Snapshot tile:** loads net worth, total Market Value, monthly cash flow, income and expenditure.
  - **Categories:** Previous Month and Quarter, Year and Lifelong averages; **Accounts:** each open account's Balance and Market Value.
- **Response:** Overview, Going well, Needs attention, Investment Outlook and Suggestions.
- **Market tile:** sits here too and opens [Market](market.md).
- **Badge:** `31d` on the Snapshot tile once its last run is over 30 days old.

### Actions

- **Snapshot** (`/finance/insight/snapshot/`): builds the preview; nothing is computed before this click.
- **Ask:** an optional question.
- **🤖 Send to AI:** sends the preview and question to your AI provider; the answer is kept in Settings.

### Rules & calculations

- **Partial month:** an in-progress month's figures are flagged so the AI doesn't read them as a decline.
- **Left out:** closed or empty accounts and institution names are not sent.

## Data

| Tab | Used for |
|---|---|
| Transaction | Date, Account, Payee, Category, Description, Amount |
| Account | Account Name, Institution, Type, Balance, Market Value, Payment Day; D1 is Net Worth |
| Statement | Monthly income, expenditure and net worth (sheet formulas) |
| Breakdown | Category, Type, then the four period totals (sheet formulas) |
| Setting | `TAX_RATE_PCT`, `FINANCIAL_INSIGHT_LAST_RESULT`, `FINANCIAL_INSIGHT_LAST_GENERATED_AT` |

- **Columns in full:** see the [data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/app.js` | Summary cards and the reconciliation badge |
| `assets/script/finance-chart.js` | Chart page: builds every figure from Transaction, then draws each chart |
| `assets/script/finance-transaction.js` | Transaction table, form and bulk actions |
| `assets/script/csv.js` | Advanced filters and CSV export |
| `assets/script/finance-account.js` | Accounts, payment badge and Transfer |
| `assets/script/finance-breakdown.js` | Breakdown table |
| `assets/script/finance-insight.js` | Insight Snapshot |

## Related

- [Watch List](watchlist.md), [Market](market.md), [Portfolio](portfolio.md).
- [Navigation](../navigation.md): shortcuts, forms and exports.
- [Data model](../../reference/data-model.md) and [Configuration](../../development/configuration.md).
