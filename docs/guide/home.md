# Home

[Docs](../README.md) › Guide

The home page (`/`) is an overview of every section: four widgets, each section's glance cards and its page tiles.

## At a glance

- **Widgets:** Time, Date, Azan and Weather in one row at the top; they work before sign-in.
- **Glance cards:** Health's Today cards and Finance's summary cards, the same ones each hub shows.
- **Tiles:** one card per section, titled with its name, holding a tile per page; a tile opens that page.
- **Badges:** tiles carry the same red badges as on the hubs (overdue logs, stale reads, met alerts).
- **Show or hide:** the **Widgets** and **Bulbs** switches hide the widget row and the glance cards.

## What it shows

- **Order:** widgets, then Health, Finance and Track, each as its glance cards followed by its tile card.
- **Health:** Status, Intake Macros, Physical Activity, Sleep and Progress; Micronutrient Gaps sits under the Health tiles.
  - See [Health — Today](health/today.md) for what each row means.
- **Finance:** Net Worth, Monthly Cash Flow, Monthly Income, Monthly Expenditure, then a Cumulative Net Worth line.
  - See [Finance — Overview](finance/overview.md#summary).
- **Track:** tiles only (LeetCode, Work Time, Car Service, Travel, Application).
- **Other:** no card here; Settings opens from the account menu (see [Navigation](navigation.md)).

### Widgets

| Widget | Shows |
|---|---|
| Time | Local time (`HH:mm:ss`) and a second clock for another city |
| Date | Today in Gregorian, Shamsi and Ghamari, year/month/day aligned |
| Azan | Sobh, Zohr, Maghreb and Midnight for your location (Shia "Tehran" method) |
| Weather | Current icon and temperature, today's sunrise 🌅 and sunset 🌇, and a 3-day forecast |

- **Only on the home page:** the section hubs hide the widget row and never start its clock or fetches.
- **Weather hover:** the current icon's hover names the condition in words.

## Actions

- **Pick a city:** click the location beside the time to type a city or choose **Use my location (auto-detect)**.
  - The second clock has its own picker for its city.
- **Open a page:** click a tile; quick-action tiles (**Today**, **Workouts**, **Micronutrients**) open their form or view directly.
- **Hide parts:** account menu (or sidebar) switches **Widgets** and **Bulbs**; the choice is kept across loads.

## Rules & calculations

- **Location order:** a city you set → the last detected location → `WIDGET_DEFAULT_CITY` → Waterloo, ON.
  - The browser asks for your location only after you click **Use my location**.
- **Second clock:** a city you set → `WIDGET_SECOND_CLOCK_CITY` → Isfahan.
- **Fresh each load:** weather and prayer times are fetched on every load; only the last detected location is remembered.
- **Sources:** Open-Meteo (weather, city search) and BigDataCloud (place name); both are free and need no key.
- **Before sign-in:** widgets and switches work from this browser's last known values.

## Data

- **Read:** only what the glance cards need, plus Transaction, eTimeSheet, LeetCode, Watchlist and Analysis for tile badges.
- **Settings keys:** `WIDGET_DEFAULT_CITY`, `WIDGET_SECOND_CLOCK_CITY`, `SHOW_WIDGETS`, `SHOW_BULBS` on the Setting tab.
- **Columns:** see the [data model](../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `index.html` | The home page and every section's markup |
| `assets/script/ledger-widgets.js` | Time, Date, Azan and Weather widgets |
| `assets/script/page-nav.js` | Tile cards and badges (`buildPageTiles`, `setPageBadge`) |
| `assets/script/app.js` | Boot, summary cards and the show/hide switches |

## Related

- [Navigation](navigation.md): hubs, sidebar, tab bar and the account menu.
- [Finance — Overview](finance/overview.md) and [Health — Today](health/today.md): the glance cards.
- [Configuration](../development/configuration.md): the `WIDGET_*` and `SHOW_*` keys.
