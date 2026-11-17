# Finance — Portfolio

[Docs](../../README.md) › Guide › Finance

Portfolio (`/finance/portfolio/`) is your trade log and what your holdings are worth today, in CAD.

## At a glance

- **📝 Log** a Buy, Sell or Split against one of your accounts.
- **Cards:** Market Value, Cost Basis, Unrealized and Realized, all in CAD.
- **Charts:** gain/loss over time and market value against cost.
- **Tables:** Holdings, By Account and Trades.
- **Cost method:** average cost (ACB), Canada's method, fees included.

## What it shows

- **Cards:** two by two on a phone.
- **Gain / Loss (CAD):** total gain, unrealized and cumulative realized, one point per trading day from the first trade.
- **Market Value vs Cost (CAD):** the two lines over the same days.
- **Holdings:** Account, Symbol, Shares, Avg Cost, Close, Market Value, Unrealized, %, Realized.
  - In each stock's own currency (`US$` or `$`); % is unrealized against cost.
- **By Account:** Holdings (CAD) against the Account page's Market Value; the Difference is usually cash.
- **Trades:** Date, Account, Symbol, Action, Qty, Price, Fees, FX; sortable and paginated.
- **Privacy:** every figure follows the Amounts switch.

## Actions

- **📝 Log** (`/finance/portfolio/log/`): Date, Account, Symbol, Action, Quantity, Price, Fees, Currency, Notes, FX to CAD.
- **Row buttons:** ✏️ edit, 🗑️ delete with Undo.
- **Range:** 1m, 3m, 6m, 1y, 2y, 5y, 10y, All (default) for both charts; the legend hides lines.
- **🔄 Update Market Value:** writes each account's Holdings into its Market Value on the Account tab, after a confirm.
  - Shown only when `PORTFOLIO_WRITE_MARKET_VALUE` is 1; cells holding a formula are skipped and named.

## Rules & calculations

- **Buy:** cost = quantity × price + fees.
- **Sell:** proceeds = quantity × price − fees; realized = proceeds − average cost × quantity.
  - The remaining cost drops by the same average; a sell above the shares held is capped and warned about.
- **Split:** Quantity is the ratio (new ÷ old, e.g. 4 for 4-for-1); shares multiply and total cost stays.
- **Not applied:** the superficial-loss rule.
- **FX to CAD:** filled on save from that day's USD/CAD if left blank, and can be typed over.
  - Stored with the trade, so a USD position's CAD cost never moves; today's value uses today's rate.
- **Numbers:** `1,234.5` groups thousands; a lone comma is a decimal comma, so `1,5` is 1.5.
- **Account list:** Investment-type accounts come first.
- **Early days:** before a TSX stock's saved prices begin, the chart uses its last trade price.
- **Prices:** load when the page opens, like [Watch List](watchlist.md).

## Data

- **Trade tab:** Date | Account | Symbol | Action | Quantity | Price | Fees | Currency | Notes | FX to CAD.
  - Created on the first save; values are written as typed.
- **Account tab:** Market Value (column E) is read for By Account and written by 🔄.
- **Columns in full:** see the [data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/finance-portfolio.js` | Page, form, charts and tables |
| `assets/script/finance-portfolio-math.js` | Average cost and daily series (`computeHoldings`, `buildPortfolioSeries`) |

## Related

- [Finance — Overview](overview.md): the Account page.
- [Watch List](watchlist.md) and [Market](market.md): prices and analysis.
- [Data model](../../reference/data-model.md): every sheet tab, column by column.
