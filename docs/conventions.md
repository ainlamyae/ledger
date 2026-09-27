# Naming & Display Conventions

[← Back to README](../README.md)

One name, one unit and one format for each thing, app-wide.

## Wording

- The body has **body mass**, never "weight".
- An exercise's dumbbell or machine load is **Load** (the Activity sheet's Weight column is read by position, so its header can stay).
- Physique form labels match the sheet headers: **Bed**, **Wake**, **Sleep**, **Deprivation**.
- **Log** always reads Log, never "Log More".

## BMR names

The four BMR figures are always `BMR_mif`, `BMR_kat`, `BMR_cal`, `BMR_adp` — in the Physique form, Status card, Tune, Caloric Intake chart and every hover.

The Physique form shows them on one line, names grouped then values, unit once:

```text
BMR_mif/kat/cal/adp: 1692/1638/1663/1441 kcal
```

## Units

Standard symbols only — `g`, `mg`, `µg`, `IU`, `kcal` — never USDA's `G`/`MG`/`UG`. This applies to forms, tables, Insight and the sheet itself.

## Dates

Every date reads `YYYY-MM-DD` (`2026-10-04`), or `YYYY-MM` on a month axis — tables, the Progress card, chart axes and hovers. The home page's Date card reads year, month, day.

## Chart hovers

| Rule | Example |
|---|---|
| `label (definition): number unit` | `TEI (Total Energy Intake): 829 kcal` |
| Sign only on negatives | Calorie Balance lines |
| 7-Day Average is an amount, no `/day` | `1309 kcal`, `134 g`; sleep averages are clock times |
| 7-Day Trend is a slope, always `/day` | `-71 g/day` |
