# Security & Privacy

[← Back to README](../README.md)

- Each user's data lives in their own private Google Sheet, accessible only to them.
- Auth uses the `drive.file` scope — the narrowest Drive scope, covering only files the app created or the user picked. It cannot list the rest of a Drive.
- `userinfo.email`/`userinfo.profile` are used only for the header avatar.
- `CLIENT_ID`, `TEMPLATE_SPREADSHEET_ID` and `PICKER_API_KEY` are **not secrets** — access is enforced by OAuth consent and per-file ownership.
- No backend, no password storage, no third-party store for financial data.
- **Widgets** are the one always-on exception:
  - With location granted, coordinates or a typed city go to Open-Meteo and BigDataCloud.
  - No account, no financial data, no server of ours involved.
  - Avoidable entirely by denying location and not setting a custom city.
- **The AI provider (Groq or OpenRouter) and USDA are opt-in** and only run once you set the keys:
  - Calculate sends the typed ingredient text only.
  - The USDA lookup sends the ingredient name only.
  - Physique's **Scan** sends the meal photo you pick; Nutrition's **Scan** sends the label photo you pick (resized to 1600px, as JPEG) and the list of nutrient names it may fill.
  - Wellness Insight sends age, height, BMI, body mass/healthy body mass and aggregated averages.
  - Food Insight sends the ingredient list grouped by Group plus your question — no real vitamin/mineral data, just the model's own inference from the ingredient names.
  - Micronutrient Insight sends real, USDA-measured nutrient totals (from ingredients you've priced via Nutrition's Pull Micronutrients) and their Ideal/day reference figures — the one mode that does send vitamin/mineral data, because unlike Food Insight it's measured, not inferred.
  - Activity Insight sends the activity-type and per-muscle-group breakdown.
  - Plan Insight sends your plan settings (height, age, sex, current and healthy body mass, desired activity, fat-loss rate, protein rule) alongside the same aggregated averages Wellness sends.
  - Pattern Insight sends the profile block plus period averages over Tune's L_p days (body mass and its change, intake, macros, activity by type, energy balance and BMR offset).
  - Finance Market's AI read sends one stock's signal rows, levels, last 5 closes, a year of month-end chart values (public prices) and Finnhub headlines, plus your shares and average cost only when **Include my position** is ticked.
  - Nothing is sent until that panel's Send to AI is clicked.
- **Stock data is opt-in** too: with `TWELVE_DATA_API_KEY`, `ALPHA_VANTAGE_API_KEY` or `FINNHUB_API_KEY` set, the Watch List, Market and Portfolio pages (and, for stocks with alerts, every Finance and home load) send ticker symbols and dates (and the key, as a query parameter, as those services require) to Twelve Data, Alpha Vantage and Finnhub. No amounts, shares or account names leave the browser this way.
- `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `USDA_FDC_API_KEY`, `TWELVE_DATA_API_KEY`, `ALPHA_VANTAGE_API_KEY` and `FINNHUB_API_KEY` **are** real bearer secrets, unlike the config values above. They live in your own `Setting` tab and are never committed. The Settings panel masks any key ending `_API_KEY`/`_TOKEN`/`_SECRET` by default — independent of Privacy mode below, which is for amounts, not credentials — with a per-row reveal button that resets on reload.
- **LeetCode** sends nothing: the NeetCode 250 list, its YouTube video ids and lengths, and the roadmap ship in `track-leetcode-roadmap.js`, and the 🎥/📄/🔗 buttons only open youtube.com, neetcode.io or leetcode.com in a new tab. Your progress lives in your own `LeetCode` tab.
- **Privacy mode** is display-only and doesn't change what's stored.

---

