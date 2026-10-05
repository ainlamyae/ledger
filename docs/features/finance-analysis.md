# Finance — Analysis

[← Features](README.md) · [README](../../README.md)

## At a glance

- `/finance/analysis/`: one stock's **verdict**, signals, risk, chart and news, plus an **AI read** of them (🤖).
- Pick a stock in the box (watchlist and traded symbols), or use 🔬 on [Market](finance-market.md).
- Built for 1-week to 6-month holds. **Nothing here is close to 95% reliable**: the checks are the price signals with the strongest out-of-sample research, and every report says it isn't financial advice.
- News needs `FINNHUB_API_KEY`: see [Stock Data Setup](../stock-data-setup.md).

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
  - **Stop** = close − `MARKET_ATR_MULT` × ATR14 (default 2.5).
  - **Position size** = shares so a stop-out loses `MARKET_RISK_PCT` (default 1%) of your Investment accounts' Market Value.
- **Caution**: the 5-day move.
- **Descriptive (weak evidence)**, collapsed: RSI14, MACD 12/26/9, Bollinger %B, SMA50. Research finds little edge in these alone (Park-Irwin 2007; Bajgrowicz-Scaillet 2012).
- Each row's hover gives its definition and source.

## Chart

- Close, SMA200, 52-week high and stop, with range buttons 1m…All.
- SMA50, the Bollinger bands and the benchmark (rebased to the first close) are off until switched on in the legend.
- Lines are worked out on the full daily history, so a 200-day average is right at the left edge of a short range.

## News and AI

- **News**: Finnhub headlines from the last 30 days, newest first, each linking to the story.
- **Send to AI (🤖)** uses your AI provider (`ai.js`) and sends:
  - the signal rows, verdict, levels and last 5 closes
  - the headlines as `date | source | title`
  - your question
  - your shares and average cost **only** with **Include my position** ticked
- The exact text is under **Prompt template**.
- **The prompt** tells the AI to:
  - use only the supplied numbers
  - restate the verdict without changing it
  - cite each headline with its date and source, and call any over 30 days old stale
  - write the sections Overview, Signals, News, Risk, Levels and Verdict, plus Answer when you asked a question
- **Checks on the answer**: a fixed "Not financial advice" line is added below it. Any price in Levels that wasn't in the data sent is flagged in red.
- **Saved**: every read is appended to the `Analysis` tab (Date | Symbol | Verdict | Score | Close | Stop | Report).
  - The newest read per stock shows when you come back; the older ones are your track record.
  - The Analysis tile gets the red `<days>d` badge when a watchlist stock's newest read is over 30 days old.
