# Track

[← Features](README.md) · [README](../../README.md)

## At a glance

- **Work Time** (`/track/work-time/`): see [Time Tracker](time-tracker.md).
- **Car Service** (`/track/car-service/`): services from Transportation transactions tagged `@<km>km`, a linear odometer forecast, and the next service of each kind.
  - Sources: Toyota's 2023 Corolla km schedule, your own oil-change average, TD's winter-tire dates (on by 1 Dec, off after 31 Mar), new tires every 6 years.
  - Two tables: **Predicted** (Date, Odometer, Service, Basis) above **Done**. Every Basis credits one source: — Toyota, — TD or — your own history.
  - Due within 30 days → `28d` / `-3d` badge and an optional daily Chrome reminder.
- **Travel** (`/track/travel/`) and **Application** (`/track/application/`).

## Track

- **Work Time** — see [Time Tracker](time-tracker.md).
- **Car Service** (`car-service.js`, between Work Time and Travel) — reads **Transportation** transactions whose description carries the odometer as `@<km>km` (e.g. `Service Oil Change @28902km`); no sheet of its own. An **Odometer & Service** chart draws the logged odometer (solid), a linear forecast (dashed, least-squares km/day anchored at the latest reading), past services (filled dots) and the next ones (hollow dots, coloured by type), with a legend and hovers like `Oil Change (done): 28,902 km`. Two tables, each one line per cell, Basis included (the column fits its text; `text-size-adjust` on `html` keeps iOS Safari from enlarging it) — **Predicted** (Date, Odometer, Service, Basis; an overdue one reads "… — overdue") and **Done** (Date, Odometer, Service), scrolling sideways when wide. Every Basis reads `<rule> — <source>`, with one of three sources: **Toyota**, **TD** or **your own history**.
  - **Reminder:** when a predicted service is due within 30 days (or overdue), its badge reads the days left — e.g. **`28d`**, or **`-3d`** once overdue — with the full list and dates on hover, and, if notifications are allowed (account menu → **Enable notifications**, shared with Work Time), Chrome shows "Car service 28d: Rust+Tires" once a day.
  - **km-only rules** (no month limits): oil every *your own average* km gap between logged oil changes; tire rotation + inspection every 8,000 km (Toyota Service #1) — but every **Tire Changeover** is also a rotation + inspection, so while the next changeover comes before that 8,000 km (twice a year, ~5,000 km apart) no separate rotation is predicted and the changeover rows read `… + Rotation & Inspection`; brake measure / valve / 12 V battery every 32,000 km (Service #3); cabin air filter, engine air filter and brake fluid every 48,000 km; coolant first at 160,000 km; spark plugs at 193,000 km — Toyota's 2023 Corolla (Canada) schedule. Its date is when the forecast reaches that km.
  - **Date rules:** winter tires **predicted on 1 Dec**, TD Insurance's hard deadline (its Ontario discount needs them on December–March; the Basis reads `at +7 °C or below, by 1 Dec — TD`) and **off after 31 Mar** on your own average spring changeover date (Basis `after 31 Mar, above +7 °C — TD`); rust protection yearly from your own history, predicted on the same day as the changeover to winter. **Tire sets** are replaced at **6 years old**, or sooner when the tread is worn (Toyota's tire warranty ends at 6 years; CAA Insurance won't cover older tires): one row for the car's original set, dated from its first record, and one for each set bought since (`Accessory Tire`, `New Tires`, …). One-offs (diagnostic, engine mount, balancing, the tire purchase) are history only.
  - Service type comes from description keywords (oil, changeover, corrosion/undercarriage, rotation, cabin, air filter, brake fluid, brake/valve/battery, coolant, spark); anything else is **Other**. Predictions more than 2 years out stay in the table but off the chart.
- **Travel** — one Travel panel: Time Spent by Country flag tiles and a Countries Visited choropleth above the sortable table they're derived from.
- **Applications** — immigration/visa applications as expandable cards, grouped Ongoing/Closed.
