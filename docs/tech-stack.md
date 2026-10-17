# Tech Stack

[← Back to README](../README.md)

| Layer | Choice |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (ES6+) — no framework, no build step |
| Charts | [Chart.js](https://www.chartjs.org/), plus [chartjs-chart-geo](https://github.com/sgratzl/chartjs-chart-geo) + [world-atlas](https://github.com/topojson/world-atlas) for the choropleth; [html2canvas-pro](https://github.com/yorickshan/html2canvas-pro) for the Chart pages' 📤, loaded on first click |
| Authentication | [Google Identity Services](https://developers.google.com/identity), OAuth 2.0, `drive.file` + `userinfo.*` scopes |
| File selection | [Google Picker API](https://developers.google.com/drive/picker) |
| Data store | Google Sheets API v4 |
| Widgets | `navigator.geolocation` + `Intl`; [Open-Meteo](https://open-meteo.com/) and [BigDataCloud](https://www.bigdatacloud.com/) — free, key-less |
| AI / nutrition | [Groq](https://groq.com/) or [OpenRouter](https://openrouter.ai/) chat-completions (`AI_PROVIDER`) and [USDA FoodData Central](https://fdc.nal.usda.gov/) — per-user keys in `Setting` |
| Hosting | GitHub Pages |

---

