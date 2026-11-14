// Fiber chart (Health Chart): red under the floor or past the ceiling. Drawn by
// renderHealthMacroBandChart (health-chart-protein.js).
function renderHealthFiberChart(entries) {
  renderHealthMacroBandChart(entries, {
    id: 'fiber',
    key: 'fiberG',
    symbol: 'F',
    getBand: getFiberDesiredBandG,
    withinBand: withinFiberBand,
    overColor: '--chart-bad',
    underColor: '--chart-bad',
    mark: 'cap',
    rerender: renderHealthFiberChart,
  });
}
