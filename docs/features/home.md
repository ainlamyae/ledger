# Home Page & Widgets

[← Features](README.md) · [README](../../README.md)

## At a glance

- An overview of all three sections: each section's glance cards, then its page tiles, with no section titles between them.
- Health cards: Status, Intake Macros, Physical Activity, Sleep, Progress. Finance cards: Net Worth, Monthly Cash Flow, then a Cumulative Net Worth card (line only, no axes or grid).
- Time, Date, Azan and Weather widgets are `.card` bulbs in a `.cards` row; only their text size is their own.
- All card text uses `--card-text-size`, regular weight, one padding; titles have their own single size.
- One gap (`--space-s`) between everything: widget to widget, widgets to cards, card to card, cards to tiles, section to section.
- Reads only what its cards need, plus Transactions and Work Time for tile badges (5 requests).
- Account menu: **Hide widgets** (`SHOW_WIDGETS`) and **Hide bulbs** (`SHOW_BULBS`), both kept across loads.

## Dashboard widgets

- Four self-contained "bulb" cards; work before sign-in.
- **Visible on the home page, hidden on the three section pages.** The row belongs to the dashboard as a whole, not to one group, so it starts unhidden on `/` and its clock interval, prayer-time call and weather fetch all start with it. `/health/`, `/finance/` and `/other/` hide the row outright (`section-page.js`) and never start any of that behind it — a clock ticking behind a hidden row is work nobody there can see.
- **Time** — local `HH:mm:ss` plus a second, independently configurable reference clock.
- **Date** — Gregorian, Shamsi and Ghamari in one aligned year/month/day grid (the app's YYYY-MM-DD order), via `Intl`.
- **Azan** — Sobh/Zohr/Maghreb/Midnight, computed client-side (Shia "Tehran" method).
- **Weather** — current conditions plus a 3-day forecast.
- Location resolution order: manual override → browser geolocation → `WIDGET_DEFAULT_CITY` → Waterloo/Isfahan fallback.
- Powered by free key-less APIs (Open-Meteo, BigDataCloud), fetched fresh on each load (only the last detected location is remembered).
