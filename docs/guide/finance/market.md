# Finance — Market

[Docs](../../README.md) › Guide › Finance

Market (`/finance/market/`) analyses one stock: a rule-based verdict, a chart, risk signals, news and an AI read.

## At a glance

- **Pick a stock** from the **Stock** card, or with 🔬 on [Watch List](watchlist.md); only watchlist stocks can be analysed.
- **Verdict:** Favourable, Mixed or Unfavourable from four research-backed price checks.
- **Built for holds of 1 week to 6 months;** nothing here is close to certain, and every report says it isn't financial advice.
- **🤖 Send to AI** writes a read that is saved to the Analysis tab, and can suggest alerts.
- **Where:** its tile sits on Finance Insight's page, beside Snapshot.

## What it shows

- **Cards:** Verdict, Close, Stop (the trailing stop) and Position Size; two by two on a phone.
- **Chart:** close with SMA200, 52-week high, trailing stop and the market index (SPY or XIC.TO) rebased to the first close.
  - **1d / 1w:** intraday close only (5- and 30-minute); 1d is disabled for TSX stocks.
  - **TSX long ranges:** 2y and longer add month-end prices before the ~100 free daily bars.
- **Signals table:** Evidence, Risk, Levels and Caution rows; each row's hover gives its definition and source.
- **Descriptive (weak evidence):** a folded table of RSI14, MACD 12/26/9, Bollinger %B and SMA50.
- **News:** Finnhub headlines from the last 30 days, newest first; none for TSX stocks on the free plan.
- **Response:** the newest AI read for this stock, shown again when you come back.
- **Badge:** `31d` on the tile when a watchlist stock's newest read is over 30 days old; a met alert outranks it.

## Actions

- **Range:** 1d, 1w, 1m, 3m, 6m, 1y (default), 2y, 5y, 10y, All; remembered in this browser.
- **Legend:** click a line to hide or show it.
- **🔔 Alerts:** opens this stock's Watch List form at its alert rules.
- **Ask:** an optional question; tick **Include my position** to send your shares and average cost.
- **Prompt template:** unfold to see the exact text sent.
- **🤖 Send to AI:** runs the read with your AI provider.
- **📌 Apply suggested alerts:** replaces the stock's Watch List alerts with the AI's suggestion, with Undo.

## Rules & calculations

### Verdict

| Check | Passes when |
|---|---|
| Trend | Close above SMA200 (or last month-end above the 10-month SMA while history is short) |
| Momentum 12-1 | The return from 12 months ago to 1 month ago is above 0 |
| Relative momentum | That return beats SPY's (US) or XIC.TO's (TSX) |
| 52-week high | Close is at least 90% of the 252-day high |

- **Unfavourable (red):** Trend fails.
- **Favourable (green):** Trend passes and at least 2 of the other 3 pass; otherwise **Mixed** (gray).
- **Insufficient history:** no trend data; a check short of data reads "— (needs N, have n)".
- **Notes on hover:** "high-volatility regime, size down" when 3-month volatility exceeds 1.25× the 1-year.
  - "don't chase last week's spike" after a 5-day move above 2σ.

### Risk and levels

- **Risk:** volatility 3m and 1y (annualized), ATR14, max drawdown 1y, Sharpe 1y, Sortino 1y and beta against the index.
- **Trailing stop:** the highest close of the last 22 trading days − `MARKET_ATR_MULT` × ATR14 (default 4).
  - For a position you hold: a close at or below it reads Fail, an exit signal. It is never used as a buy level.
- **Entry stop:** close − `MARKET_ATR_MULT` × ATR14, where a buy made today would exit.
- **Position size:** shares so a stop-out at the entry stop loses `MARKET_RISK_PCT` (default 1%) of your Investment accounts.
- **Caution:** the 5-day move.

### The AI read

- **Sent:** signal rows, verdict, levels, the last 5 closes, a text summary of the chart's history, the headlines and your question.
- **Asked for:** Overview, Signals, News, Risk, Levels and Verdict, plus Answer when you asked a question.
- **Rules given:** use only the numbers sent, keep the verdict unchanged, and date and source each headline.
- **Checks on the answer:** a "Not financial advice" line is added; a Levels price not in the data sent is flagged red.
- **Suggested alerts:** read back from the answer and listed under it, e.g. "Suggested alerts: <20.16 · <avg · <stop".
  - Left out, with the reason shown: a price not in the data, a below at or over today's close, an above at or under it, or a rule already met.

### Loading and limits

- **When:** prices load only when this page opens; each stock's history is fetched once, then topped up.
- **Rate limits:** queued per service; a per-minute wait shows "Waiting for … (N s)", a used-up day shows saved prices and "resets 00:00 UTC".
- **Privacy:** prices are public, so the Amounts switch doesn't hide them.

## Data

- **Analysis tab:** Date | Symbol | Verdict | Score | Close | Stop | Report; one row per read, the older ones your track record.
- **Setting tab:** `MARKET_ATR_MULT`, `MARKET_RISK_PCT`, `TWELVE_DATA_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`.
- **Columns in full:** see the [data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/finance-market.js` | Page, AI read and the Analysis tab |
| `assets/script/finance-market-math.js` | Signals, verdict, stops and alert parsing (`computeSignals`) |
| `assets/script/finance-market-chart.js` | Chart and ranges |
| `assets/script/finance-market-data.js` | Prices, news, caching and rate limits |

## Related

- [Watch List](watchlist.md): alert rules and the stocks you can pick.
- [Portfolio](portfolio.md): the position sent with **Include my position**.
- [Configuration](../../development/configuration.md): AI provider and stock data keys.
