# Chart Conventions

[← Features](README.md) · [README](../../README.md)

## Chart conventions

- Category colours are spread evenly around the wheel, ordered by absolute spend.
- Every dollar axis formats ticks as currency; hours/percentage axes stay plain numbers.
- Green means met, red missed, **grey means not scored either way**.
- **Legends are switches.** Chart.js' own legend is off everywhere; `renderCategoryLegend` draws the HTML one, and passing it a `toggle` makes each entry a `<button>` that takes its series out of the chart and puts it back. A switched-off entry stays in the legend, dimmed and struck through — it's the only way back on, so an entry that vanished on click would be a one-way door. The button is stripped of every default (`.donut-legend-item-toggle`): a legend entry is a swatch and a word, and should look like one whether or not it does anything.
  - *How* an entry hides differs, and the legend doesn't decide it — each chart passes `isHidden`/`onToggle`. **Category Expenditure Trend** uses Chart.js dataset visibility, since its x axis is months and hiding a series leaves everything else in place. **Average Monthly Spending by Category** and **Account Allocation** re-render from a module-level `Set` of hidden names instead: a category *is* the x axis on one and a ring proportion on the other, so per-index hiding would leave a labelled gap, and their palettes are spaced by count, so recolouring must be avoided by computing colours from the full list and filtering after.
  - Hiding a type in Account Allocation takes its institutions and accounts out of the two outer rings with it — all three rings are built from the accounts that survive both hidden sets.
  - A pinned axis has to be re-measured on every toggle. Category Expenditure Trend caps its y axis explicitly, so `axisMaxFor(visibilityTest)` recomputes from what's still showing and the toggle reassigns `scales.y.max`; without it, switching the biggest category off left the rest of the bars in the bottom third of a plot still scaled for it. With everything off it returns `undefined`, handing the axis back to Chart.js rather than pinning it to zero.
- **Health Chart legends** (`renderToggleLegend`) sit under each dated chart and name entries in words, without symbols ("Healthy Body Mass", "Mifflin-St Jeor BMR"); the hover keeps its symbols. A bar/dot entry hides that colour's points (`maskHiddenClasses`), a line/cap/zone entry its dataset, and the axes refit to what's left; hidden names are kept per legend until the page reloads.
  - Each dated chart computes its own axis bounds, so each one skips its hidden entries itself (Body Mass, Caloric Intake, Calorie Balance, the four intake charts and Sleep's clock axis); Physical Activity's are left to Chart.js.
  - The same result reads the same on every chart: **Desired met**, **Near desired**, **Missed desired** (Caloric Intake, Calorie Balance, Physical Activity); the intake bands use **Within/Over/Under desired**.
- **📤 on Health → Chart and Finance → Chart** (`data-screenshot` buttons, `initPageScreenshots`, `charts-base.js`) saves the whole page as a PNG; see [Health — Chart](health-chart.md).
- **Desired marks are cyan** (`--chart-cyan`) on every Health chart with a legend, so none shares the 7-Day Average's text colour.
- **Health Chart axes:** 8 evenly spaced vertical gridlines with the first and last date on the plot's edges at every range (`wellnessTickIndices`, `HEALTH_X_GRIDLINES`); every left y axis is `TREND_Y_AXIS_WIDTH` (120px), right axes 84px, so plot areas line up.
- **Every chart sits flush under its heading** (`.chart-box-flush`, or `.chart-box-donut` for the small donuts) — no chart keeps `.chart-box`'s own top margin, so a card's heading-to-chart gap is the same everywhere.
