# Stock Data Setup

[← Back to README](../README.md)

The Finance **Market**, **Portfolio** and **Analysis** pages need three free API keys before they show live prices and news. Until then they show "Add a … setting" and everything else in the app works as before.

## To do

1. **Get three free keys.** Each one needs its own free account, which you have to create yourself.

   | Service | Sign up | Used for | Free limits |
   |---|---|---|---|
   | Twelve Data | [twelvedata.com](https://twelvedata.com) | US stocks (daily up to ~20 years, 1d/1w intraday), symbol search, the USD/CAD rate | 8 calls/min, 800/day |
   | Alpha Vantage | [alphavantage.co](https://www.alphavantage.co/support/#api-key) | TSX / TSXV stocks (`.TO`, `.V`) | 5 calls/min, 25/day; last ~100 trading days daily, full month-end history |
   | Finnhub | [finnhub.io](https://finnhub.io) | Company news for Analysis | 60 calls/min |

2. **Add them in Settings** (Other → Settings → ➕). All three keys are in the Key suggestions list, and each value is masked like every `_API_KEY`:

   | Key | Value |
   |---|---|
   | `TWELVE_DATA_API_KEY` | your Twelve Data key |
   | `ALPHA_VANTAGE_API_KEY` | your Alpha Vantage key |
   | `FINNHUB_API_KEY` | your Finnhub key |

3. **Sign in**, open Finance → **Market**, and add your first stock with ➕ (e.g. `AAPL`, or `SHOP.TO` for the TSX). This creates the `Watchlist` tab. Logging the first trade creates `Trade`, and the first AI read creates `Analysis`.

## Optional settings

| Key | Default | Meaning |
|---|---|---|
| `MARKET_RISK_PCT` | 1 | % of your Investment accounts risked per trade (Analysis' Position Size) |
| `MARKET_ATR_MULT` | 2.5 | Stop distance below the close, in ATR14s (2–3 is usual) |
| `MARKET_RISK_FREE_PCT` | 0 | Yearly risk-free rate for Sharpe and Sortino, e.g. 3 |
| `PORTFOLIO_WRITE_MARKET_VALUE` | 0 | 1 shows Portfolio's **Update Market Value** button |

## Good to know

- Only one key is strictly needed per kind of stock: Twelve Data alone covers US stocks, Alpha Vantage alone covers TSX. Without Finnhub, Analysis just has no News.
- Prices are saved in the browser after the first load, so later visits only fetch the newest days. Alpha Vantage's 25 calls a day go furthest when you keep a short TSX watchlist.
- TSX daily history starts at ~100 days and grows each day you come back. Until then, long ranges and the trend check use month-end prices.
- What each call sends: [Security & Privacy](security.md). How prices are cached: [Caching Strategy](caching.md).
- The pages themselves: [Market](features/finance-market.md), [Portfolio](features/finance-portfolio.md), [Analysis](features/finance-analysis.md).
