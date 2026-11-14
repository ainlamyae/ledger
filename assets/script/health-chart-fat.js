// Fat chart (Health Chart): red under the floor; past the ceiling a lighter green, still
// inside the AMDR's own upper bound. Band ends as dashed lines rather than caps. Drawn by
// renderHealthMacroBandChart (health-chart-protein.js).
function renderHealthFatChart(entries) {
  renderHealthMacroBandChart(entries, {
    id: 'fat',
    key: 'fatG',
    symbol: 'G',
    getBand: getFatDesiredBandG,
    withinBand: withinFatBand,
    overColor: '--chart-good-light',
    underColor: '--chart-bad',
    mark: 'line',
    rerender: renderHealthFatChart,
  });
}
