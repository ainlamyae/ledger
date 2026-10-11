# Finance — Watch List

[← Features](README.md) · [README](../../README.md)

## At a glance

- `/finance/watchlist/`: the stocks you follow, each with its Close and 1d / 1m / 1y change. Its own page so the list can grow long.
- **➕** (`/finance/watchlist/add/`) adds a stock: `AAPL` for US, `SHOP.TO` for the TSX, `XYZ.V` for the TSXV. Google-style `TSE: AC` / `TSXV: XYZ` / `NASDAQ: AAPL` are converted (`normalizeSymbol`, `market-data.js`).
- Each row: **🔬** opens that stock on [Market](finance-market.md) (chart, verdict, signals, news, AI), ✏️ edits, 🗑️ removes (with Undo).
- Needs `TWELVE_DATA_API_KEY` (US) and/or `ALPHA_VANTAGE_API_KEY` (TSX): see [Stock Data Setup](../stock-data-setup.md).

## Details

- **Watchlist tab** (`market.js`): Symbol | Name | Exchange | Currency | Notes, created on the first save (`ensureSheetTab`, `sheets.js`). A row's Edit has its own address, `/finance/watchlist/<symbol>/`.
- **Symbol search**: the form's Symbol box searches Twelve Data as you type; picking a result fills Name, Exchange and Currency. A `.TO`/`.V` symbol is always CAD.
- **Changes** are green up, red down, sign only on negatives. 1m is 21 trading days, 1y 252. Symbol and Name sort by header click.
- The stock last opened on Market gets the "current" tint.
- **When prices load**: only when this page opens (`registerPageShow`, `router.js`), one stock after another through the per-service rate-limit queue, from the browser cache first (see [Caching](../caching.md)). A per-minute limit shows "Waiting for … (N s) i/n".
- **Long TSX lists**: Alpha Vantage allows 25 calls a day, so a first visit with many new `.TO` stocks can use the day up; already-saved stocks only need a top-up.
- Prices are public, so they aren't hidden by Privacy mode.
