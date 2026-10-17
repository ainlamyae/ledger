# Finance — Watch List

[← Features](README.md) · [README](../../README.md)

## At a glance

- `/finance/watchlist/`: the stocks you follow, each with its Close and 1d / 1m / 1y change. Its own page so the list can grow long.
- **➕** (`/finance/watchlist/add/`) adds a stock: `AAPL` for US, `SHOP.TO` for the TSX, `XYZ.V` for the TSXV. Google-style `TSE: AC` / `TSXV: XYZ` / `NASDAQ: AAPL` are converted (`normalizeSymbol`, `finance-market-data.js`).
- Each row: **🔬** opens that stock on [Market](finance-market.md) (chart, verdict, signals, news, AI), ✏️ edits, 🗑️ removes (with Undo), and ✅ dismisses a met alert.
- **Alerts** per stock: a red badge on the Watch List and Market tiles when a rule is met on a day's close.
- Needs `TWELVE_DATA_API_KEY` (US) and/or `ALPHA_VANTAGE_API_KEY` (TSX): see [Stock Data Setup](../stock-data-setup.md).

## Details

- **Watchlist tab** (`finance-watchlist.js`): Symbol | Name | Exchange | Currency | Notes | Alerts, created on the first save (`ensureSheetTab`, `sheets.js`). A row's Edit has its own address, `/finance/watchlist/<symbol>/`.
- **Symbol search**: the form's Symbol box searches Twelve Data as you type; picking a result fills Name, Exchange and Currency. A `.TO`/`.V` symbol is always CAD.
- **Changes** are green up, red down, sign only on negatives. 1m is 21 trading days, 1y 252. Symbol and Name sort by header click.
- The stock last opened on Market gets the "current" tint.
- **When prices load**: only when this page opens (`registerPageShow`, `router.js`), one stock after another through the per-service rate-limit queue, from the browser cache first (see [Caching](../caching.md)). A per-minute limit shows "Waiting for … (N s) i/n".
- **Long TSX lists**: Alpha Vantage allows 25 calls a day, so a first visit with many new `.TO` stocks can use the day up; already-saved stocks only need a top-up.
- Prices are public, so they aren't hidden by Privacy mode.

## Alerts

- **Rules** (set in the ✏️ form, or from the AI's suggestion on [Market](finance-market.md)), each checked on the latest **daily close** (`checkAlerts`, `finance-market-math.js`):

  | Rule | Met when | Label |
  |---|---|---|
  | Close below | close < your price | `<20.16` |
  | Close above | close > your price | `>25.00` |
  | Below the long-term average | close < SMA200, or the 10-month SMA while daily history is short (the verdict's Trend check) | `<avg` |
  | Above the long-term average | close > that average (a possible entry) | `>avg` |
  | Below the trailing stop | close < that day's trailing stop | `<stop` |

- **Form hint**: the stock's current close, trailing stop and average from saved prices, to copy into the boxes.
- **Alert column**: each rule's label, gray while waiting, red when met; the hover gives the numbers ("close $19.80 is below $20.16 (2026-10-10)"). An average that needs more history reads "needs more price history" and never fires.
- **Badge**: the red `.page-badge` on the Watch List and Market tiles (hub, home, breadcrumb), e.g. `AC.TO<20.16`, `+N` when more rules are met; the hover lists them all. On Market it outranks the 30-day analysis badge, which moves into the hover.
- **✅ Dismiss**: hides a met rule until it clears; the next check after it clears re-arms it (one small write), so it can fire again. Changing a rule in the form re-arms it too.
- **Checks** run on every Finance and home load, in the background, for **alerted stocks only**: saved prices up to 4 hours old are reused (`getDailyBars` `maxAgeMs`), and a bar for the latest session is always fresh. About one Alpha Vantage call per alerted TSX stock per 4 hours of market time. A failed call keeps the last saved prices.
- **Stored** in column F as JSON (`RAW`), e.g. `{"below":20.16,"above":null,"belowAvg":true,"aboveAvg":false,"belowStop":true,"dismissed":[]}`; the `Alerts` header goes in F1 with the first alert. Rows without alerts leave F blank.
