# Finance — Portfolio

[← Features](README.md) · [README](../../README.md)

## At a glance

- `/finance/portfolio/`: your **trade log** and what it's worth today.
- **📝** (`/finance/portfolio/log/`) logs a Buy, Sell or Split, tagged with one of your [Accounts](finance.md).
- Cards: **Market Value**, **Cost Basis**, **Unrealized**, **Realized**, all in CAD.
- Charts: gain/loss over time, and market value against cost. Then tables for Holdings, By Account and Trades.
- Cost is **average cost (ACB)**, Canada's method, with fees included.

## Details

- **Trade tab** (`portfolio.js`): Date | Account | Symbol | Action | Quantity | Price | Fees | Currency | Notes | FX to CAD, created on the first save and written `RAW`.
  - **Split**: Quantity is the ratio (new ÷ old, e.g. 4 for 4-for-1); Price, Fees and FX are blank.
  - **Account** lists Investment-type accounts first.
  - **FX to CAD** is filled on save from that day's USD/CAD (Twelve Data) if left blank, and can be typed over. It's stored with the trade, so a USD position's CAD cost never moves.
- **Average cost** (`computeHoldings`, `portfolio-math.js`), per account and symbol:
  - Buy: cost = quantity × price + fees.
  - Sell: proceeds = quantity × price − fees; realized = proceeds − average cost × quantity; the remaining cost drops by the same average.
  - Split: shares multiply, total cost stays.
  - A sell above the shares held is capped and warned about. The superficial-loss rule isn't applied.
  - CAD figures use each trade's own FX; today's value uses today's USD/CAD.
- **Charts** (`buildPortfolioSeries`): one point per trading day from the first trade, with range buttons and legend toggles.
  - Gain / Loss: total gain, unrealized and cumulative realized.
  - Market Value vs Cost.
  - Days before a TSX stock's saved prices use its last trade price.
- **Holdings**: each in its own currency (`US$` or `$`); the % is unrealized against cost.
- **By Account**: holdings per account (CAD) against the Account page's Market Value; the difference is usually cash.
- **Update Market Value** appears only with `PORTFOLIO_WRITE_MARKET_VALUE` = 1. After a confirm, it writes each account's holdings into Account column E, skipping any cell that holds a formula and naming the ones it skipped.
- Prices load when the page opens, like [Market](finance-market.md). Everything here follows Privacy mode.
