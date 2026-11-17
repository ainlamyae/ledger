# Finance — Watch List

[Docs](../../README.md) › Guide › Finance

Watch List (`/finance/watchlist/`) holds the stocks you follow, their latest moves and your price alerts.

## At a glance

- **One row per stock:** Close and its 1d, 1m and 1y change.
- **➕ Add** a stock by symbol; the form searches as you type.
- **Alerts:** per-stock rules checked on each daily close; a met one turns red and badges the tile.
- **🔬** opens the stock on [Market](market.md) for its chart, verdict and AI read.
- **Needs keys:** `TWELVE_DATA_API_KEY` for US stocks, `ALPHA_VANTAGE_API_KEY` for TSX.

## What it shows

- **Watching table:** Symbol, Name, Close, 1d, 1m, 1y, Alert, then the row's buttons.
- **Changes:** green up, red down; a sign only on negatives.
  - **1d:** since the previous close; **1m:** 21 trading days; **1y:** 252 trading days.
- **Current stock:** the one last opened on Market is tinted.
- **Alert column:** each rule's label, gray while waiting, red when met.
  - **Hover:** the numbers behind it, e.g. "close $19.80 is below $20.16 (2026-10-10)".
- **Badge:** a red `AC.TO<20.16` on the Watch List and Market tiles; `+N` when more rules are met, all listed on hover.
- **Privacy:** prices are public, so the Amounts switch doesn't hide them.

## Actions

- **➕ Add** (`/finance/watchlist/add/`): type a symbol; picking a search result fills Name, Exchange and Currency.
- **Row buttons:**

| Button | Does |
|---|---|
| ✅ | Dismisses a met alert until it clears (shown only when one is met) |
| 🔬 | Opens the stock on Market |
| ✏️ | Edits the stock and its alerts (`/finance/watchlist/<symbol>/`) |
| 🗑️ | Removes it, with Undo |

- **Sort:** click the Symbol or Name header.
- **Alerts from AI:** Market's 📌 applies the AI's suggested alerts here (see [Market](market.md)).

## Rules & calculations

### Symbols

- **US:** `AAPL`; **TSX:** `SHOP.TO`; **TSXV:** `XYZ.V`.
- **Google style** (`TSE: AC`, `TSXV: XYZ`, `NASDAQ: AAPL`) is converted for you.
- **Currency:** a `.TO` or `.V` symbol is always CAD.

### Alert rules

| Rule | Met when the close is | Label |
|---|---|---|
| Close below | under your price | `<20.16` |
| Close above | over your price | `>25.00` |
| Below the long-term average | under SMA200 (or the 10-month SMA while history is short) | `<avg` |
| Above the long-term average | over that average (a possible entry) | `>avg` |
| Below the trailing stop | under that day's trailing stop | `<stop` |

- **Form hint:** shows the stock's close, trailing stop and average, to copy into the boxes.
- **Already met:** a new below or above price that the latest close already meets is refused.
- **Short history:** an average that needs more data reads "needs more price history" and never fires.
- **✅ Dismiss:** hides a met rule until it clears; it then re-arms and can fire again. Changing a rule re-arms it too.

### When prices load

- **This page:** prices load only when it opens, one stock after another, from the browser cache first.
- **Rate limits:** a per-minute limit shows "Waiting for … (N s) i/n" and carries on.
- **Long TSX lists:** Alpha Vantage allows 25 calls a day, so a first visit with many new `.TO` stocks can use the day up.
- **Alert checks:** run in the background on every Finance and home load, for alerted stocks only.
  - Saved prices up to 4 hours old are reused; a failed call keeps the last saved prices.

## Data

- **Watchlist tab:** Symbol | Name | Exchange | Currency | Notes | Alerts; created on the first save.
- **Alerts column:** the rules as JSON, e.g. `{"below":20.16,"belowAvg":true,"dismissed":[]}`; blank for stocks without alerts.
- **Columns in full:** see the [data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/finance-watchlist.js` | Table, form, alerts and badge |
| `assets/script/finance-market-data.js` | Price fetching, caching and symbol search (`normalizeSymbol`) |
| `assets/script/finance-market-math.js` | Alert checks (`checkAlerts`) and the trailing stop |

## Related

- [Market](market.md): one stock in depth and suggested alerts.
- [Portfolio](portfolio.md): your trades and holdings.
- [Getting started](../../development/getting-started.md): getting the stock data keys.
- [Data access](../../development/data-access.md): price caching.
