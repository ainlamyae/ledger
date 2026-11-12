// Safe Pace chart (Health Chart). Shared math/helpers live in health-chart.js.
//
// The two "too harsh a cut" warnings Tune raises against the PLAN, read off what actually
// happened instead:
//   Weekly loss  — the Body Mass chart's own L_p-Day Trend, its change per L_p days scaled
//                  to a week, as a % of the trend mass (weeklyFatLossPct). Red past
//                  WEEKLY_FAT_LOSS_PCT_CEILING.
//   D_bmr%       — each day's intake below its BMR (deficitVsBmrPct, on the same intake/BMR
//                  Calorie Balance uses), smoothed by the same L_p-Day Average. Red past
//                  DEFICIT_VS_BMR_PCT_CEILING.
// The right axis is the left one × (D_bmr ceiling ÷ weekly ceiling), so both limits fall on
// ONE line: everything under it is the green safe band, everything over it red.

let healthSafePaceChart = null;

const SAFE_PACE_TICK_STEPS_PCT = [0.25, 0.5, 1, 2];
const SAFE_PACE_MAX_GRIDLINES = 8;
const SAFE_PACE_WEEKLY_NAME = 'Weekly Loss';
const SAFE_PACE_DBMR_NAME = 'Deficit vs BMR';
const SAFE_PACE_SAFE_NAME = 'Safe';
const SAFE_PACE_DANGER_NAME = 'Too Fast';

function renderHealthSafePaceChart(entries) {
  const ctx = document.getElementById('health-safe-pace-chart');
  const dates = healthCalorieChartDates(entries);
  const axisRatio = DEFICIT_VS_BMR_PCT_CEILING / WEEKLY_FAT_LOSS_PCT_CEILING;
  const avgName = healthAvgName();

  // Weekly loss %: the Body Mass L_p-Day Trend (full history, cropped to the window).
  const byDate = bodyMassByDateMap(entries.filter((e) => e.category === 'Body Mass' && e.amount !== null));
  const { trendDays, trendSeries, slopePerSpan } = bodyMassTrendSeries(byDate, dates);
  const weeklyLoss = dates.map((_, i) => (slopePerSpan[i] === null || trendSeries[i] === null
    ? null
    : weeklyFatLossPct((-slopePerSpan[i] * 7) / trendDays, trendSeries[i])));

  // D_bmr%: per day, then the same L_p-Day Average every other Health chart draws.
  // Averaged over the full calorie history, then cropped, so the window's first days aren't
  // a cold-started average.
  const firstIntake = calorieLogEntries(entries).map((e) => e.date).sort()[0];
  const historyDates = dates.length && firstIntake && firstIntake < dates[0]
    ? datesInRange(firstIntake, dates[dates.length - 1])
    : dates;
  const offset = historyDates.length - dates.length;
  const { detailByDate } = energyBalanceDays(entries, historyDates);
  const dbmrHistory = historyDates.map((d) => {
    const det = detailByDate.get(d);
    return det ? deficitVsBmrPct(det.maintenance, det.intake) : null;
  });
  const dbmrDaily = dbmrHistory.slice(offset);
  const dbmrAvg = emaSeries(dbmrHistory, bodyMassSmoothingDays()).slice(offset);

  const hidden = legendHiddenNames('health-safe-pace-legend');
  const shownIf = (name, series) => (hidden.has(name) ? [] : series);
  const shown = [
    ...shownIf(SAFE_PACE_WEEKLY_NAME, weeklyLoss),
    ...shownIf(SAFE_PACE_DBMR_NAME, [...dbmrDaily, ...dbmrAvg].map((v) => (v === null ? null : v / axisRatio))),
  ].filter((v) => v !== null && Number.isFinite(v));
  const hasData = shown.length > 0;

  // The limit always on-plot with headroom above it; a gain or surplus dips below zero.
  const hiRaw = Math.max(WEEKLY_FAT_LOSS_PCT_CEILING, ...shown) * 1.15;
  const loRaw = Math.min(0, ...shown) * 1.15;
  const step = SAFE_PACE_TICK_STEPS_PCT.find((s) => (hiRaw - loRaw) / s <= SAFE_PACE_MAX_GRIDLINES)
    ?? SAFE_PACE_TICK_STEPS_PCT[SAFE_PACE_TICK_STEPS_PCT.length - 1];
  const yMin = Math.floor(loRaw / step) * step;
  const yMax = Math.ceil(hiRaw / step) * step;

  const flat = (v) => new Array(dates.length).fill(v);
  const bandEdge = (label, value, extra = {}) => ({
    type: 'line',
    label,
    data: flat(value),
    borderWidth: 0,
    pointRadius: 0,
    pointHitRadius: 0,
    tension: 0,
    fill: false,
    isDesiredLine: true,
    order: 4,
    ...extra,
  });
  const decimals = step < 1 ? 2 : 0;

  healthSafePaceChart = upsertChart(healthSafePaceChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        // Bands: bottom edge → limit (green, fills down to it) → top edge (red, fills down
        // to the limit). The '-1' chain needs these three adjacent and in this order.
        bandEdge('Band floor', yMin),
        bandEdge('Limit band', WEEKLY_FAT_LOSS_PCT_CEILING, {
          fill: '-1',
          backgroundColor: hidden.has(SAFE_PACE_SAFE_NAME) ? 'transparent' : chartColor('--chart-good', 0.12),
        }),
        bandEdge('Band ceiling', yMax, {
          fill: '-1',
          backgroundColor: hidden.has(SAFE_PACE_DANGER_NAME) ? 'transparent' : chartColor('--chart-bad', 0.12),
        }),
        // The shared limit itself: 1 %/wk on the left, 20 % of BMR on the right.
        bandEdge('Limit', WEEKLY_FAT_LOSS_PCT_CEILING, {
          borderWidth: 1.5,
          borderColor: chartColor('--chart-bad'),
          borderDash: [6, 4],
          order: 3,
        }),
        {
          type: 'line',
          label: SAFE_PACE_WEEKLY_NAME,
          data: weeklyLoss,
          yAxisID: 'y',
          borderColor: chartColor('--chart-indigo'),
          borderWidth: 2,
          tension: 0.3,
          cubicInterpolationMode: 'monotone',
          spanGaps: false,
          pointRadius: 0,
          pointHitRadius: 0,
          fill: false,
          hidden: hidden.has(SAFE_PACE_WEEKLY_NAME),
          order: 1,
        },
        {
          // Each day's own D_bmr%, faint: one fasting day isn't the pace, the average is.
          type: 'line',
          label: `${SAFE_PACE_DBMR_NAME} (day)`,
          data: dbmrDaily,
          yAxisID: 'y1',
          showLine: false,
          pointRadius: fitPointRadius(3),
          pointHoverRadius: fitPointRadius(5),
          pointBackgroundColor: chartColor('--chart-cyan', 0.45),
          pointBorderWidth: 0,
          hidden: hidden.has(SAFE_PACE_DBMR_NAME),
          order: 2,
        },
        {
          type: 'line',
          label: SAFE_PACE_DBMR_NAME,
          data: dbmrAvg,
          yAxisID: 'y1',
          borderColor: chartColor('--chart-cyan'),
          borderWidth: 2,
          tension: 0.3,
          cubicInterpolationMode: 'monotone',
          spanGaps: false,
          pointRadius: 0,
          pointHitRadius: 0,
          fill: false,
          isWeeklyAverage: true,
          hidden: hidden.has(SAFE_PACE_DBMR_NAME),
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        title: {
          display: !hasData,
          text: 'Log Body Mass and Calories (with Height, Birth Date, and Sex in Settings) to see your pace',
          color: Chart.defaults.color,
          font: { size: chartFontSize() },
          padding: { top: 40 },
        },
        tooltip: {
          // Rows come from afterBody, so every figure reads in one fixed order. One item
          // (the always-present band floor) is kept only to carry the hovered index.
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            title: (items) => (items.length ? formatIsoDateShort(items[0].label) : ''),
            label: () => [],
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return [];
              const lines = [];
              if (weeklyLoss[i] !== null) {
                lines.push(`Weekly Loss (${trendDays}-Day Trend): ${weeklyLoss[i]} % m/wk`);
              }
              if (dbmrDaily[i] !== null) lines.push(`D_bmr% (Deficit vs BMR): ${dbmrDaily[i]} %`);
              if (dbmrAvg[i] !== null) lines.push(`D_bmr% ${avgName}: ${Math.round(dbmrAvg[i] * 10) / 10} %`);
              lines.push(`Limits: ${WEEKLY_FAT_LOSS_PCT_CEILING} % m/wk · ${DEFICIT_VS_BMR_PCT_CEILING} % below BMR`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          min: yMin,
          max: yMax,
          position: 'left',
          afterFit: fixDatedYAxisWidth,
          grid: { color: (c) => (c.tick.value === 0 ? Chart.defaults.color : Chart.defaults.borderColor) },
          ticks: { stepSize: step, autoSkip: false, callback: maskedUnitTick('%', decimals) },
        },
        // A fixed linear rescale of y, so the 20 % mark sits exactly on the 1 % line.
        y1: {
          min: yMin * axisRatio,
          max: yMax * axisRatio,
          position: 'right',
          afterFit: fixDatedYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: step * axisRatio, autoSkip: false, callback: maskedUnitTick('% BMR', 0) },
        },
      },
    },
  });

  renderToggleLegend('health-safe-pace-legend', dates.length === 0 ? [] : [
    { name: SAFE_PACE_WEEKLY_NAME, color: chartColor('--chart-indigo') },
    { name: SAFE_PACE_DBMR_NAME, color: chartColor('--chart-cyan') },
    { name: SAFE_PACE_SAFE_NAME, color: chartColor('--chart-good', 0.4) },
    { name: SAFE_PACE_DANGER_NAME, color: chartColor('--chart-bad', 0.4) },
  ], () => renderHealthSafePaceChart(entries));
}
