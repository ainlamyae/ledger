# Security

[Docs](../README.md) › Development

What Ledger can reach, what leaves the browser, and how the pages guard against injected code.

## At a glance

- **Own data, own sheet:** each user's data lives in their own Google spreadsheet; there is no backend and no password store.
- **Narrowest scope:** `drive.file` reaches only files the app created or the user picked.
- **Opt-in services:** AI, USDA and stock data run only with the user's own keys, and only on a click or a page that needs them.
- **Strict CSP:** every page refuses inline scripts and unknown hosts.
- **Pinned libraries:** every CDN file has an exact version and an integrity hash.

## Scopes and secrets

| Item | Secret? | Notes |
|---|---|---|
| `drive.file` | — | Only files the app created or the user picked in Picker; can't list the rest of Drive |
| `userinfo.email`, `userinfo.profile` | — | Header avatar and name only |
| `CLIENT_ID`, `TEMPLATE_SPREADSHEET_ID`, `PICKER_API_KEY` | No | Public in `config.js`; access is enforced by OAuth consent and file ownership |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `USDA_FDC_API_KEY` | Yes | Stored in the user's `Setting` tab, never committed |
| `TWELVE_DATA_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY` | Yes | Same; sent as a query parameter, as those services require |

- **Masking:** Settings masks any key ending `_API_KEY`, `_TOKEN` or `_SECRET`; a per-row reveal resets on reload.
- **Privacy mode:** hides amounts on screen only; it changes nothing stored or sent.

## What leaves the browser

| Service | When | What is sent |
|---|---|---|
| Open-Meteo, BigDataCloud | Widgets, with location granted or a city set | Coordinates or a typed city; no key, no account |
| AI: Calculate | Calculate clicked | The typed ingredient text; for workouts, only names missing from the `Activity` tab |
| AI: Scan | Physique or Nutrition **Scan** | The chosen photo (Nutrition: resized to 1600 px JPEG) and the nutrient names it may fill |
| AI: Wellness Insight | **Send to AI** | Age, height, BMI, body mass, healthy body mass, aggregated averages |
| AI: Food Insight | **Send to AI** | Ingredient list by Group and your question |
| AI: Micronutrient Insight | **Send to AI** | USDA-measured nutrient totals and their Ideal/day figures |
| AI: Activity Insight | **Send to AI** | Activity-type and per-muscle-group breakdown |
| AI: Protein Insight | **Send to AI** | Protein per tracked source against its desired share |
| AI: Plan Insight | **Send to AI** | Plan settings (height, age, sex, body mass, desired activity, fat-loss rate, protein rule) and averages |
| AI: Pattern Insight | **Send to AI** | Profile and period averages over Tune's L_p days |
| AI: Finance Insight | **Send to AI** | Net worth, cash flow, category spend and account snapshot |
| AI: Market read | **Send to AI** | One stock's signals, levels, recent and month-end closes, headlines; shares and cost only with **Include my position** |
| USDA | Nutrition lookup or Calculate fallback | The ingredient name |
| Twelve Data, Alpha Vantage, Finnhub | Watch List, Market, Portfolio, and alert checks on Finance and home loads | Ticker symbols, dates and the key; no amounts, shares or account names |

- **LeetCode:** sends nothing; the NeetCode list ships in the code and 🎥📄🔗 only open youtube.com, neetcode.io or leetcode.com in a new tab.

## Content-Security-Policy

GitHub Pages can't send headers, so every page (`index.html`, each stub, `404.html`) carries the same policy in a `<meta http-equiv="Content-Security-Policy">`.

| Directive | Allows |
|---|---|
| `default-src` | `'self'` |
| `script-src` | `'self'`, `accounts.google.com/gsi/client`, `apis.google.com`, `cdn.jsdelivr.net/npm/`; `404.html` adds one `sha256-` hash |
| `style-src` | `'self'`, `'unsafe-inline'` (inline `style` attributes from the app and Google sign-in), `accounts.google.com/gsi/style` |
| `img-src` | `'self'`, `data:`, `blob:`, any `https:` (Activity images are URLs from the sheet) |
| `connect-src` | `'self'`, Sheets, `www.googleapis.com`, Google sign-in, jsDelivr, Groq, OpenRouter, Twelve Data, Alpha Vantage, Finnhub, USDA, BigDataCloud, Open-Meteo (API and geocoding) |
| `frame-src` | Google sign-in, `docs.google.com`, `drive.google.com` (Picker) |
| `object-src` | `'none'` |
| `base-uri`, `form-action` | `'self'` |

- **No inline scripts:** start-up code lives in `theme-boot.js` and `page-boot.js`, so injected `<script>`, `onerror=` and `javascript:` URLs are refused.
- **`404.html`'s inline script:** sets `<base>` before any relative URL resolves; it is allowed by its SHA-256 hash.
- **Keep the hash valid:** `.gitattributes` keeps `404.html` LF; after editing that script, recompute the hash in its meta.
- **New host or page:** add it to the policy on every page (see [Deployment](deployment.md)).

## Pinned libraries

| File | Version | Loaded by |
|---|---|---|
| Chart.js | 4.6.1 (`dist/chart.umd.min.js`) | `index.html` |
| chartjs-chart-geo | 4.3.6 (`build/index.umd.min.js`) | `index.html` |
| world-atlas | 2.0.2 (`countries-110m.json`) | `track-travel-chart.js`, `fetch` with `integrity` |
| html2canvas-pro | 1.5.8 (`dist/html2canvas-pro.min.js`) | `charts-base.js`, on the first 📤 |

- **Why:** a new release or a changed file at the same URL fails its hash and is refused instead of run.
- **Upgrade:** change the version, then replace the hash with `sha384-` plus the output of `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
- **Google's scripts:** sign-in and Picker can't be pinned; Google serves them unversioned and changes them in place.

## Data from the sheet and APIs

- **Never parsed as HTML:** text from the sheet or an API is placed with `textContent` or `createTextNode`.
- **Links from data:** Finnhub news and LeetCode links go through `safeHref()` (`ui-helpers.js`), which keeps only `http:`, `https:`, `mailto:` and `tel:`.

## Related

- [Deployment](deployment.md): GitHub Pages, OAuth origin, CSP upkeep.
- [Configuration](configuration.md): `CONFIG`, `Setting` keys and browser storage.
- [Architecture](architecture.md): system, section pages, boot order, modules, tech stack.
- [Getting started](getting-started.md): template sheet, Google Cloud, `config.js`, local server, API keys.
