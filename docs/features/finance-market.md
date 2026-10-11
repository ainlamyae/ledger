# Finance — Market

[← Features](README.md) · [README](../../README.md)

## At a glance

- `/finance/market/`: one stock's **verdict**, chart, signals, news and an **AI read** (🤖).
- **🔔** (header) opens the shown stock's Watch List form at its [alerts](finance-watchlist.md#alerts).
- On a phone the four cards sit two by two.
- Pick the stock from the watchlist drop-down at the top, or with 🔬 on [Watch List](finance-watchlist.md). To analyze a stock, add it to Watch List first.
- Built for 1-week to 6-month holds. **Nothing here is close to 95% reliable**: the checks are the price signals with the strongest out-of-sample research, and every report says it isn't financial advice.
- Needs `TWELVE_DATA_API_KEY` (US), `ALPHA_VANTAGE_API_KEY` (TSX) and, for news, `FINNHUB_API_KEY`: see [Stock Data Setup](../stock-data-setup.md).
- Market and Analysis used to be two pages; the AI read is now one feature of Market. The `Analysis` tab is unchanged.

## Verdict

Four checks (`computeSignals`, `market-math.js`):

| Check | Passes when | Research |
|---|---|---|
| Trend | Close above SMA200; with too little daily history, last month-end above the 10-month SMA | Faber 2007; Brock-Lakonishok-LeBaron 1992. It mainly cuts drawdowns |
| Momentum 12-1 | Return from 12 months ago to 1 month ago is above 0 | Jegadeesh-Titman 1993; Asness-Moskowitz-Pedersen 2013 |
| Relative momentum | That return beats SPY's (US) or XIC.TO's (TSX) | Same |
| 52-week high | Close is at least 90% of the 252-day high | George-Hwang 2004 |

- Trend fails → **Unfavourable** (red).
- Trend passes and at least 2 of the other 3 pass → **Favourable** (green); otherwise **Mixed** (gray).
- No trend data → **Insufficient history**. Any check without enough data shows "— (needs N, have n)".
- Notes on the card's hover: "high-volatility regime, size down" when 3-month volatility is above 1.25× the 1-year, and "don't chase last week's spike" after a 5-day move above 2σ (short-term reversal).

## Signals table

- Same layout as Physique's Derived table, grouped by lines.
- **Evidence**: the four checks above, each Pass / Fail / n/a.
- **Risk**: volatility 3m and 1y (annualized), ATR14 (Wilder), max drawdown 1y, Sharpe 1y, Sortino 1y, beta vs the benchmark.
- **Levels**:
  - **Trailing stop** = highest close of the last 22 trading days − `MARKET_ATR_MULT` × ATR14 (default 4, chosen for holds of weeks to months: 2.5 stopped QQQ out 15 times in a year, 4 three times), the chandelier exit (`trailingStopSeries`, `market-math.js`). It follows new highs up, and it can ease down when an old high leaves the 22-day window or ATR grows. A risk-control habit for long holds, not a proven edge. It is for a position you **hold**: a close at or below it reads Fail (exit signal). After a sharp fall it can sit above the close (already broken), so it is never used as a buy-side level.
  - **Entry stop** = close − `MARKET_ATR_MULT` × ATR14: where a buy made **today** would exit. Always under the close.
  - **Position size** = shares so a stop-out at the entry stop loses `MARKET_RISK_PCT` (default 1%) of your Investment accounts' Market Value.
- **Caution**: the 5-day move.
- **Descriptive (weak evidence)**, collapsed: RSI14, MACD 12/26/9, Bollinger %B, SMA50. Research finds little edge in these alone (Park-Irwin 2007; Bajgrowicz-Scaillet 2012).
- Each row's hover gives its definition and source.

## Chart

- Ranges 1d 1w 1m 3m 6m 1y 2y 5y 10y All: `.btn` in the existing `.pagination` row, the current one `.btn-primary`; the range is remembered in the browser.
- **1m…All**: five lines, all on by default (the legend can hide any):
  - **Close**.
  - **SMA200**: the long-term trend; a close below it is the trend exit (Faber 2007).
  - **52-week high**: nearness to it is one of the checks (George-Hwang 2004).
  - **Trailing stop**: day by day, so you can see where it would have exited in the past.
  - **SPY / XIC.TO**, rebased to the first close: whether the stock beats the market (the relative-momentum check).
- Lines are worked out on the full daily history, so a 200-day average is right at the left edge of a short range.
- SMA50 and the Bollinger bands were removed: they're short-term tools with weak evidence for long holds (Park-Irwin 2007; Bajgrowicz-Scaillet 2012). Their values stay in the Descriptive table.
- **1d / 1w**: Twelve Data intraday prices (5- and 30-minute), close only (the other lines are daily). **1d is disabled for TSX**: no free intraday source.
- **TSX long ranges**: the free plan gives ~100 daily bars, so 2y / 5y / 10y / All add month-end prices before them.

## Loading and limits

- **When prices load**: only when this page opens (`registerPageShow`, `router.js`), never with the rest of Finance. Each stock's history is fetched once, then topped up (`market-data.js`; see [Caching](../caching.md)).
- **Rate limits** are queued per service; Alpha Vantage calls are also spaced 1.5 s apart (its 1-per-second burst limit). A per-minute limit shows "Waiting for … (N s)"; a used-up day shows saved prices and "resets 00:00 UTC".
- Prices are public, so they aren't hidden by Privacy mode.

## News and AI

- **News**: Finnhub headlines from the last 30 days, newest first, each linking to the story. Finnhub's free plan has no news for TSX stocks, and the News box says so.
- **Send to AI (🤖)** uses your AI provider (`ai.js`) and sends:
  - the signal rows, verdict, levels and last 5 closes
  - **chart history**, the chart's lines as text (`analysisChartHistory`):
    - close vs SMA200 and whether SMA200 is rising
    - the date of the last SMA200 cross
    - close vs trailing stop, and how often the close fell below the stop in the last year
    - 3m / 6m / 12m return against SPY or XIC.TO
    - the last 13 month-ends as date | close | SMA200 | trailing stop | market rebased
  - the headlines as `date | source | title`
  - your question
  - your shares and average cost **only** with **Include my position** ticked
- The exact text is under **Prompt template**.
- **The prompt** tells the AI to:
  - use only the supplied numbers, for an investor holding weeks to months, not day trading
  - treat a close below the trailing stop or below SMA200 as the exit conditions, and consider entry only while the trend check passes
  - read Chart history for the trend's direction and duration, stop hits and the stock against the market
  - restate the verdict without changing it
  - cite each headline with its date and source, and call any over 30 days old stale
  - write the sections Overview, Signals, News, Risk, Levels and Verdict, plus Answer when you asked a question
  - end with one machine-read line: `Alerts: below=<price or none>; above=<price or none>; belowAvg=yes|no; aboveAvg=yes|no; belowStop=yes|no`, prices only from the data sent; below must be under today's close and above over it, and a rule already met isn't suggested
  - the Levels lines give each level's distance from the close ("close is 2.04 below it"), so the AI needn't compute one
- **Checks on the answer**: a fixed "Not financial advice" line is added below it. Any price in Levels that isn't anywhere in the data sent is flagged in red.
- **Suggested alerts** (`parseAlertLine`, `market-math.js`): the Alerts line is read back and shown under the answer ("Suggested alerts: <20.16 · <avg · <stop"). Left out, each with the reason shown: a price that isn't in the data sent, a below at or over today's close, an above at or under it, and a rule already met (e.g. below the trailing stop when the close is under it). The ✏️ form refuses a new below/above price already met on the latest close for the same reason.
  - **📌** applies them to that stock on Watch List, replacing its alerts, with Undo.
- **Saved**: every read is appended to the `Analysis` tab (Date | Symbol | Verdict | Score | Close | Stop | Report).
  - The newest read per stock shows when you come back; the older ones are your track record.
  - The Market tile gets the red `<days>d` badge when a watchlist stock's newest read is over 30 days old.
