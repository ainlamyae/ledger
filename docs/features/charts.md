# Chart Conventions

[← Features](README.md) · [README](../../README.md)

## Chart conventions

- Category colours are spread evenly around the wheel, ordered by absolute spend.
- Every dollar axis formats ticks as currency; hours/percentage axes stay plain numbers.
- Green means met, red missed, **grey means not scored either way**.
- **Legends are switches.** Chart.js' own legend is off everywhere; `renderCategoryLegend` draws the HTML one, and passing it a `toggle` makes each entry a `<button>` that takes its series out of the chart and puts it back. A switched-off entry stays in the legend, dimmed and struck through — it's the only way back on, so an entry that vanished on click would be a one-way door. The button is stripped of every default (`.donut-legend-item-toggle`): a legend entry is a swatch and a word, and should look like one whether or not it does anything.
  - *How* an entry hides differs, and the legend doesn't decide it — each chart passes `isHidden`/`onToggle`. **Category Expenditure Trend** uses Chart.js dataset visibility, since its x axis is months and hiding a series leaves everything else in place. **Average Monthly Spending by Category** and **Portfolio Allocation** re-render from a module-level `Set` of hidden names instead: a category *is* the x axis on one and a ring proportion on the other, so per-index hiding would leave a labelled gap, and their palettes are spaced by count, so recolouring must be avoided by computing colours from the full list and filtering after.
  - Hiding a type in Portfolio Allocation takes its institutions and accounts out of the two outer rings with it — all three rings are built from the accounts that survive both hidden sets.
  - A pinned axis has to be re-measured on every toggle. Category Expenditure Trend caps its y axis explicitly, so `axisMaxFor(visibilityTest)` recomputes from what's still showing and the toggle reassigns `scales.y.max`; without it, switching the biggest category off left the rest of the bars in the bottom third of a plot still scaled for it. With everything off it returns `undefined`, handing the axis back to Chart.js rather than pinning it to zero.
