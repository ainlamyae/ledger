# Finance — Market

[← Features](README.md) · [README](../../README.md)

## At a glance

- `/finance/market/`: a **watchlist** of stocks and one **price chart** with ranges 1d 1w 1m 3m 6m 1y 2y 5y 10y All.
- **➕** (`/finance/market/add/`) adds a stock: `AAPL` for US, `SHOP.TO` for the TSX, `XYZ.V` for the TSXV.
- Each row: Close and its 1d / 1m / 1y change; 🔬 opens it in [Analysis](finance-analysis.md), ✏️ edits, 🗑️ removes (with Undo).
- Needs `TWELVE_DATA_API_KEY` (US) and/or `ALPHA_VANTAGE_API_KEY` (TSX): see [Stock Data Setup](../stock-data-setup.md).

## Details

- **Watchlist tab** (`market.js`): Symbol | Name | Exchange | Currency | Notes, created on the first save (`ensureSheetTab`, `sheets.js`). A row's Edit has its own address, `/finance/market/<symbol>/`.
- **Symbol search**: the Symbol box searches Twelve Data as you type; picking a result fills Name, Exchange and Currency. A `.TO`/`.V` symbol is always CAD.
- **Changes** are green up, red down, sign only on negatives. 1m is 21 trading days, 1y 252.
- **A row click** puts that stock on the chart (its row gets the "current" tint); the choice and the range are remembered in the browser.
- **Range buttons**: `.btn` in the existing `.pagination` row, the current one `.btn-primary`, so no new style.
  - `.filters` would stack one button per line on a phone, and `.page-tile` has no selected look because tiles always leave the page.
- **1d / 1w** use Twelve Data intraday prices (5- and 30-minute). **1d is disabled for TSX**: no free intraday source.
- **TSX long ranges**: the free plan gives ~100 daily bars, so 2y / 5y / 10y / All add month-end prices before them. The status line says so when a range reaches past what's saved.
- **When prices load**: only when this page opens (`registerPageShow`, `router.js`), never with the rest of Finance. Each stock's history is fetched once, then topped up (`market-data.js`; see [Caching](../caching.md)).
- **Rate limits** are queued per service. A per-minute limit shows "Waiting for … (N s)"; a used-up day shows saved prices and "resets 00:00 UTC".
- Prices are public, so they aren't hidden by Privacy mode.
