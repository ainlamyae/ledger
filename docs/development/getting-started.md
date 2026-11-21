# Getting started

[Docs](../README.md) › Development

How to set up your own copy of Ledger once: the template sheet, Google Cloud credentials, `config.js`, a local server and API keys.

## At a glance

- **Who does this:** the developer or deployer, once; end users only sign in and pick or copy their own spreadsheet.
- **What you need:** a Google account, a Google Cloud project, Python 3 for the local server and Node for the version hook.
- **No build step:** edit a file, reload the page.
- **Optional keys:** AI, USDA and stock data each need a free key in the `Setting` tab; everything else works without them.

## Setup

1. **Create the template spreadsheet:**
   - add the tabs listed in [Data model](../reference/data-model.md), with a little sample data so charts aren't empty;
   - share it as **Anyone with the link can view**, with no real personal data in it.
2. **Create the Google Cloud credentials:**
   - enable the **Google Sheets API**, **Google Drive API** and **Google Picker API**;
   - create an **OAuth 2.0 Client ID** (Web application) and add your origins, e.g. `https://<user>.github.io` and `http://localhost:8000`;
   - create an **API key** restricted to the Picker API and the same origins.
3. **Fill in `assets/script/config.js`:** `CLIENT_ID`, `TEMPLATE_SPREADSHEET_ID` and `PICKER_API_KEY` (see [Configuration](configuration.md)).
4. **Run it locally:** `python scripts/serve.py 8000`, then open `http://localhost:8000`.
5. **Turn on the git hooks:** `git config core.hooksPath scripts/hooks` (see [Versioning](versioning.md)).

## Running locally

- **Why `serve.py`:** it answers unknown paths with `404.html`, as GitHub Pages does, so row addresses like `/health/nutrition/onion/` load.
- **Plain `http.server` fails:** `python -m http.server` shows a 404 page for those row addresses.
- **No stale files:** `serve.py` sends `Cache-Control: no-cache`, so an edited file shows on the next reload.
- **No `python`:** use `python3` (e.g. on WSL).
- **Scopes:** `drive.file` is not a sensitive scope, so the OAuth app needs no Google verification review.

## API keys

Each key is added as a row in **Settings → ➕**; a key ending `_API_KEY` is masked in the table.

| Setting key | Service | Used for | Free limits |
|---|---|---|---|
| `GROQ_API_KEY` | [Groq](https://groq.com) | AI Calculate, Scan and Insight when `AI_PROVIDER` is `groq` | Per Groq's free tier |
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai) | The same AI features when `AI_PROVIDER` is `openrouter` | Per model |
| `USDA_FDC_API_KEY` | [USDA FoodData Central](https://fdc.nal.usda.gov) | Ingredient lookup and micronutrients on Nutrition | 1,000 requests/hour |
| `TWELVE_DATA_API_KEY` | [Twelve Data](https://twelvedata.com) | US stock prices, symbol search, the USD/CAD rate | 8 calls/min, 800/day |
| `ALPHA_VANTAGE_API_KEY` | [Alpha Vantage](https://www.alphavantage.co/support/#api-key) | TSX and TSXV stocks (`.TO`, `.V`) | 5 calls/min, 25/day |
| `FINNHUB_API_KEY` | [Finnhub](https://finnhub.io) | Company news on Market | 60 calls/min (the app keeps to 50) |

- **Stock keys:** Twelve Data alone covers US stocks, Alpha Vantage alone covers TSX; without Finnhub, Market has no news.
- **First stock:** open Finance → **Watch List** and add one with ➕ (e.g. `AAPL` or `SHOP.TO`); this creates the `Watchlist` tab.
- **Tabs made on first save:** logging a trade creates `Trade`, the first AI read creates `Analysis`, the first solve creates `LeetCode`.
- **TSX history:** Alpha Vantage's free plan gives about 100 trading days of daily prices; longer ranges use month-end prices until the saved history grows.
- **Saving calls:** prices are kept in the browser, so later visits fetch only the newest days; a short TSX watchlist stretches the 25 daily calls.
- **Without keys:** the pages that need one say which setting to add; nothing else changes.

## Related

- [Configuration](configuration.md): `CONFIG`, `Setting` keys and browser storage.
- [Deployment](deployment.md): GitHub Pages, OAuth origin, CSP upkeep.
- [Security](security.md): scopes, secrets, what leaves the browser, CSP, pinned libraries.
- [Data model](../reference/data-model.md): every sheet tab, column by column.
- [Finance watch list](../guide/finance/watchlist.md): followed stocks, latest moves and price alerts.
