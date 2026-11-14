// Carbohydrate chart (Health Chart): the reverse of Fat. Too little isn't a deficiency, so
// under the floor is unscored grey; over the ceiling is red, the end linked to bloating and
// water retention. Drawn by renderHealthMacroBandChart (health-chart-protein.js).
function renderHealthCarbChart(entries) {
  renderHealthMacroBandChart(entries, {
    id: 'carb',
    key: 'carbG',
    symbol: 'C',
    getBand: getCarbDesiredBandG,
    withinBand: withinCarbBand,
    overColor: '--chart-bad',
    underColor: '--chart-neutral',
    mark: 'line',
    rerender: renderHealthCarbChart,
  });
}
