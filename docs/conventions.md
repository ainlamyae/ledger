# Naming & Display Conventions

[← Back to README](../README.md)

One name, one unit and one format for each thing, app-wide.

## Wording

- The body has **body mass**, never "weight".
- A goal is never a "target", anywhere: not in text, names, setting keys, ids or docs. The body-mass goal is **healthy** (healthy body mass, `BODY_MASS_HEALTHY_KG`); every other goal is **desired** (desired intake, desired sleep, `SLEEP_DESIRED_HOURS`).
- An exercise's dumbbell or machine load is **Load** (the Activity sheet's Weight column is read by position, so its header can stay).
- Physique form labels match the sheet headers: **Bed**, **Wake**, **Sleep**, **Deprivation**.
- **Log** always reads Log, never "Log More".

## BMR names

The five BMR figures are always `BMR_mif`, `BMR_kat`, `BMR_cal`, `BMR_adp`, `BMR_avg` (Average BMR) — in the Physique form, Status card, Tune, Caloric Intake chart and every hover. Where only one is shown (Status card, Intake, Calorie Balance), it is the one selected in Tune (`selectedBmrKey`).

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
| L_p-Day Trend is a slope, always `/day` | `-71 g/day` |
