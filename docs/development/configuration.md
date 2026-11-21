# Configuration

[Docs](../README.md) › Development

Every place Ledger reads configuration from: `config.js`, the `Setting` tab, and what it keeps in the browser.

## At a glance

- **`config.js`:** the OAuth Client ID, the template spreadsheet, the Picker key and every tab name; none are secrets.
- **`Setting` tab:** per-user keys and preferences, edited in Settings; API keys live only here.
- **Browser storage:** sign-in, the chosen spreadsheet and view preferences; never sheet data.
- **Stock prices:** the one data cache, in IndexedDB, cleared on sign-out.

## `config.js`

| Key | What it holds |
|---|---|
| `CLIENT_ID` | OAuth 2.0 Client ID (Web application) from Google Cloud |
| `TEMPLATE_SPREADSHEET_ID` | Drive id of the link-shared template that new users copy |
| `PICKER_API_KEY` | API key for Google Picker, restricted to the Picker API and your origins |
| `SHEETS` | Tab names, below; every range is built from these, so a rename is one line |

## Tab names (`CONFIG.SHEETS`)

| Key | Tab | Notes |
|---|---|---|
| `TRANSACTIONS` | `Transaction` | |
| `REPORT` | `Statement` | Formula-driven; read only |
| `BALANCE`, `ACCOUNTS` | `Account` | Same tab: `D1` net worth and the account rows |
| `INSIGHT` | `Breakdown` | Formula-driven spend; the app edits Category and Type and keeps the formulas |
| `WORK_TIME` | `eTimeSheet` | |
| `PHYSIQUE` | `Physique` | One row per day; columns found by header |
| `ACTIVITIES` | `Activity` | |
| `NUTRITION` | `Nutrition` | Columns found by header |
| `CONTACTS` | `Contact` | |
| `SETTINGS` | `Setting` | |
| `TRAVEL` | `Travel` | |
| `APPLICATIONS` | `Application` | |
| `LEETCODE` | `LeetCode` | Created on the first save |
| `WATCHLIST` | `Watchlist` | Created on the first save |
| `TRADES` | `Trade` | Created on the first save |
| `STOCK_ANALYSIS` | `Analysis` | Created on the first save |

## Setting keys for developers

The `Setting` tab holds every personal preference; the full list is in [Settings](../guide/settings.md). These are the ones that switch services on.

| Key | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `groq` | `groq` or `openrouter` |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` | — | The chosen provider's key |
| `GROQ_MODELS`, `OPENROUTER_MODELS` | — | JSON naming the models, e.g. `{"text": "…", "vision": "…"}` |
| `USDA_FDC_API_KEY` | — | USDA FoodData Central lookups |
| `TWELVE_DATA_API_KEY` | — | US stock prices, search, USD/CAD |
| `ALPHA_VANTAGE_API_KEY` | — | TSX and TSXV prices |
| `FINNHUB_API_KEY` | — | Market news |
| `MARKET_RISK_PCT` | 1 | % of Investment accounts risked per trade (Position Size) |
| `MARKET_ATR_MULT` | 4 | Trailing stop distance below the 22-day highest close, in ATR14s |
| `MARKET_RISK_FREE_PCT` | 0 | Yearly risk-free rate for Sharpe and Sortino |
| `PORTFOLIO_WRITE_MARKET_VALUE` | 0 | 1 shows Portfolio's 🔄 **Update Market Value** |
| `WIDGET_DEFAULT_CITY`, `WIDGET_SECOND_CLOCK_CITY` | — | Weather/Azan city and the second clock, unless picked in the widget |

- **Masking:** any key ending `_API_KEY`, `_TOKEN` or `_SECRET` is masked in Settings, with a per-row reveal.
- **Where to get keys:** see [Getting started](getting-started.md).

## Browser storage

`localStorage` unless noted; every key starts `ledger_`.

| Key | Set by | Contents |
|---|---|---|
| `ledger_token` | `auth.js` | `{ token, expiresAt }`, shared by every open tab |
| `ledger_consented` | `auth.js` | `'1'` once consent is given; cleared on sign-out |
| `ledger_spreadsheet_id` | `drive.js` | The chosen spreadsheet's Drive id; cleared on sign-out |
| `ledger_theme` | `app.js` | `'dark'` when dark mode is on |
| `ledger_side_nav` | `page-nav.js` | `'closed'` when the wide-screen sidebar is collapsed |
| `ledger_switches` | `app.js` | Last known visibility switches, so Widgets and Bulbs don't flash before settings load |
| `ledger_widget_detected_location` | `ledger-widgets.js` | `{ lat, lon, label }` from the last **Use my location** |
| `ledger_widget_manual_location` | `ledger-widgets.js` | `{ lat, lon, label }` picked by hand; beats detection and Settings |
| `ledger_widget_second_clock_location` | `ledger-widgets.js` | `{ label, timezone }` for the second clock |
| `ledger_last_reminder_notified` | `track-work-time.js` | Date the Work Time notification last fired |
| `ledger_last_car_service_notified` | `track-car-service.js` | Date the car-service notification last fired |
| `ledger_activity_guesses` | `health-activity-estimator.js` | Guessed burn for workout names not yet in the sheet |
| `ledger_market_symbol` | `finance-watchlist.js`, `finance-market.js` | The stock last shown on Market |
| `ledger_portfolio_range`, `ledger_analysis_range` | `finance-portfolio.js`, `finance-market.js` | Last chart range on Portfolio and Market |
| `ledger_market_quota` | `finance-market-data.js` | Today's call counts per stock service; cleared with the price cache |
| `ledger_motion_from` | `motion.js` | `sessionStorage`: the page just left, for the page-change motion |
| `ledger-market` | `finance-market-data.js` | IndexedDB database of stock prices and news; cleared on sign-out and **Clear cache** |

## Related

- [Getting started](getting-started.md): template sheet, Google Cloud, `config.js`, local server, API keys.
- [Data access](data-access.md): Sheets read/write rules, batching, quota, caching.
- [Security](security.md): scopes, secrets, what leaves the browser, CSP, pinned libraries.
- [Data model](../reference/data-model.md): every sheet tab, column by column.
- [Settings](../guide/settings.md): every key, by tab.
