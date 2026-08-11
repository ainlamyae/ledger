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
- **Groq / USDA are opt-in** and only run once you set the keys:
  - Calculate sends the typed ingredient text only.
  - The USDA lookup sends the ingredient name only.
  - Wellness Insight sends age, height, BMI, body mass/target and aggregated averages.
  - Food Insight sends the classification-grouped ingredient list plus your question — no real vitamin/mineral data, just the model's own inference from the ingredient names.
  - Micronutrients Insight sends real, USDA-measured nutrient totals (from ingredients you've priced via Nutrition's Pull Micronutrients) and their Ideal/day reference figures — the one mode that does send vitamin/mineral data, because unlike Food Insight it's measured, not inferred.
  - Activity Insight sends the activity-type and per-muscle-group breakdown.
  - Health Plan Insight sends your plan settings (height, age, sex, current and target body mass, activity target, fat-loss rate, protein rule) alongside the same aggregated averages Wellness sends.
  - Nothing is sent until that panel's Send to AI is clicked.
- `GROQ_API_KEY` and `USDA_FDC_API_KEY` **are** real bearer secrets, unlike the config values above. They live in your own `Setting` tab and are never committed. The Settings panel masks any key ending `_API_KEY`/`_TOKEN`/`_SECRET` by default — independent of Privacy mode below, which is for amounts, not credentials — with a per-row reveal button that resets on reload.
- **Privacy mode** is display-only and doesn't change what's stored.

---

