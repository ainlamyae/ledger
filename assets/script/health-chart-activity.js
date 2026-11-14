// Physical Activity chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthActivityChart = null;

// "NEAT (Non-Exercise Activity Thermogenesis)" -> "NEAT", short enough for a legend.
function shortActivityLabel(description) {
  return description.split(' (')[0].trim();
}

// The most-read segments keep a fixed colour instead of one that shifts whenever a new
// description is logged. Keyed on the shortened, lower-cased label.
const PINNED_ACTIVITY_COLORS = new Map([
  ['neat', '--chart-blue'],
  ['strength training', '--chart-good'],
]);

// Degrees kept clear either side of each pinned hue, so no generated hue lands next to one.
const RESERVED_ACTIVITY_HUE_MARGIN = 25;

// `count` hues spread evenly over the colour circle minus the reserved bands.
function unreservedActivityHues(count) {
  const allowed = [];
  let cursor = 0;
  [...PINNED_ACTIVITY_COLORS.values()].map((token) => colorHue(chartColor(token)))
    .map((h) => [h - RESERVED_ACTIVITY_HUE_MARGIN, h + RESERVED_ACTIVITY_HUE_MARGIN])
    .sort((a, b) => a[0] - b[0])
    .forEach(([from, to]) => {
      if (from > cursor) allowed.push([cursor, from]);
      cursor = Math.max(cursor, to);
    });
  if (cursor < 360) allowed.push([cursor, 360]);

  const total = allowed.reduce((sum, [from, to]) => sum + (to - from), 0);

  return Array.from({ length: count }, (_, i) => {
    let offset = ((i + 0.5) * total) / count;
    for (const [from, to] of allowed) {
      if (offset < to - from) return Math.round(from + offset);
      offset -= to - from;
    }
    return Math.round(allowed[allowed.length - 1][1]);
  });
}

function renderHealthActivityChart(entries) {
  const ctx = document.getElementById('health-activity-chart');
  const burnAvgName = healthAvgName(' Burn');
  const desiredBurnName = 'Desired Burn';

  const activityEntries = entries.filter((e) => isActivityCategory(e.category) && e.amount !== null);
  // The panel's shared dates, so gridlines line up across charts.
  const dates = healthCalorieChartDates(entries);

  // One stacked segment per description. Entries with no recognised description are
  // dropped rather than pooled into an 'Other' the sheet doesn't define.
  const categorizedEntries = activityEntries.filter((e) => e.description && e.description !== 'Other');
  const descriptions = [...new Set(categorizedEntries.map((e) => e.description))].sort();
  const byDescription = new Map(descriptions.map((d) => [d, new Map()]));
  categorizedEntries.forEach((e) => {
    const mins = toActivityMinutes(e.amount, e.unit);
    const byDate = byDescription.get(e.description);
    byDate.set(e.date, (byDate.get(e.date) || 0) + mins);
  });

  // Burn per day on its own kcal axis, beside the minutes axis.
  const bodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(entries.filter((e) => e.category === 'Body Mass' && e.amount !== null)), dates);
  const caloriesByDate = dailyValues(
    activityEntries,
    () => true,
    (e) => activityEntryKcal(e, bodyMassForDate.get(e.date) ?? null),
    sumDailyValues,
  );

  const pinnedColorFor = (d) => {
    const token = PINNED_ACTIVITY_COLORS.get(shortActivityLabel(d).toLowerCase());
    return token ? chartColor(token) : null;
  };
  const generatedHues = unreservedActivityHues(descriptions.filter((d) => pinnedColorFor(d) === null).length);
  let nextGeneratedHue = 0;
  const descriptionColors = descriptions.map((d) => pinnedColorFor(d)
    ?? seriesColor(generatedHues[nextGeneratedHue++]));

  const hidden = legendHiddenNames('health-activity-legend');

  // Everything plots negative so the chart hangs below the axis (time and energy spent);
  // ticks and tooltips report magnitudes.
  const activityDatasets = descriptions.map((d, i) => ({
    type: 'bar',
    label: shortActivityLabel(d),
    data: dates.map((date) => -(byDescription.get(d).get(date) || 0)),
    backgroundColor: descriptionColors[i],
    stack: 'activity',
    order: 2,
    hidden: hidden.has(shortActivityLabel(d)),
  }));

  const hasData = activityDatasets.some((ds) => ds.data.some((v) => v !== 0));

  // The day's desired burn at its own body mass (or the pinned burn), the same figure the
  // activity tile uses. No body mass, no figure: a gap rather than an invented one.
  const desiredBurnKcal = dates.map((date) => {
    const bodyMassKg = bodyMassForDate.get(date) ?? null;
    return bodyMassKg === null ? null : getActivityDesiredKcal(bodyMassKg);
  });

  // Dots, not a line: unlogged days aren't a trend to bridge.
  const caloriesData = dates.map((date) => caloriesByDate.get(date) ?? null);
  const weeklyBurnAvg = emaSeries(caloriesData, bodyMassSmoothingDays());
  // Burn ÷ desired burn, lifted by the average's grade; neutral violet without a desired burn.
  const dotGrades = caloriesData.map((kcal, i) => {
    const desiredKcal = desiredBurnKcal[i];
    if (kcal === null || desiredKcal === null) return { name: null, color: chartColor('--chart-purple') };
    return desiredGradeBlended(kcal / desiredKcal, weeklyBurnAvg[i] === null ? null : weeklyBurnAvg[i] / desiredKcal);
  });
  const caloriesDataset = {
    type: 'line',
    label: 'Actual Burn',
    data: maskHiddenClasses(caloriesData.map((v) => (v === null ? null : -v)), dotGrades.map((g) => g.name), hidden),
    yAxisID: 'y1',
    showLine: false,
    pointRadius: fitPointRadius(5),
    pointHoverRadius: fitPointRadius(7),
    pointBackgroundColor: dotGrades.map((g) => g.color),
    pointBorderColor: chartColor('--chart-point-border'),
    pointBorderWidth: fitPointBorderWidth(5, 1.5),
    order: 0,
  };

  // A cap per column, as on Caloric Intake: the desired burn moves with body mass, so one
  // line across the window would misread as a shared limit.
  const burnMagnitudes = [
    ...caloriesData.filter((v) => v !== null),
    ...desiredBurnKcal.filter((v) => v !== null),
  ];
  const desiredLineDataset = desiredCapDataset(
    desiredBurnName,
    desiredBurnKcal.map((v) => (v === null ? null : -v)),
    desiredCapHalf(burnMagnitudes.length ? Math.max(...burnMagnitudes) : 1),
    {
      yAxisID: 'y1',
      backgroundColor: chartColor('--chart-cyan'),
      // Ties the weekly average's order; listed after it, so the cap paints on top.
      order: 1,
      isDesiredLine: true,
      hidden: hidden.has(desiredBurnName),
    },
  );

  const weeklyBurnDataset = trendLineDataset(
    burnAvgName,
    weeklyBurnAvg.map((v) => (v === null ? null : -v)),
    { yAxisID: 'y1', hidden: hidden.has(burnAvgName) },
  );

  healthActivityChart = upsertChart(healthActivityChart, ctx, {
    data: {
      labels: dates,
      datasets: [...activityDatasets, weeklyBurnDataset, desiredLineDataset, caloriesDataset],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        title: {
          display: !hasData,
          text: 'No activity logged yet — add a Walk, Run, or Workout entry to get started',
          color: Chart.defaults.color,
          font: { size: chartFontSize() },
          padding: { top: 40 },
        },
        tooltip: {
          // The cap and average are stated in afterBody instead.
          filter: (item) => item.raw !== null && !item.dataset.isDesiredLine && !item.dataset.isWeeklyAverage,
          // Dataset order, not draw order, so the dots sit beside the figures below.
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // Each dot's swatch takes the colour it was drawn in.
            labelColors: (item) => {
              const ds = item.dataset;
              const fill = Array.isArray(ds.pointBackgroundColor)
                ? ds.pointBackgroundColor[item.dataIndex]
                : (ds.pointBackgroundColor ?? ds.backgroundColor);
              return { borderColor: fill, backgroundColor: fill };
            },
            // kcal (y1) keeps its minus; minutes report magnitude.
            label: (item) => {
              const isKcal = item.dataset.yAxisID === 'y1';
              const v = Math.round(item.parsed.y);
              const text = `${item.dataset.label}: ${isKcal ? v : Math.abs(v)} ${isKcal ? 'kcal' : 'min'}`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [];
              if (desiredBurnKcal[i] !== null) lines.push(`AEE (Desired Activity Energy Expenditure): ${-Math.round(desiredBurnKcal[i])} kcal`);
              if (weeklyBurnAvg[i] !== null) lines.push(`${burnAvgName}: ${-Math.round(weeklyBurnAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ...wellnessCategoryXScale(dates), stacked: true },
        // kcal on the left with the gridlines, since Actual vs Desired Burn is read in
        // kcal; minutes on the right, labelled without the minus.
        y: {
          stacked: true,
          position: 'right',
          beginAtZero: true,
          afterFit: fixDatedYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => maskedUnitTick('min')(Math.abs(v)) },
        },
        y1: {
          position: 'left',
          beginAtZero: true,
          afterFit: fixDatedYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
      },
    },
  });

  renderToggleLegend('health-activity-legend', !hasData ? [] : [
    ...descriptions.map((d, i) => ({ name: shortActivityLabel(d), color: descriptionColors[i] })),
    ...desiredGradeLegend(),
    { name: burnAvgName, color: desiredMarkColor() },
    { name: desiredBurnName, color: chartColor('--chart-cyan') },
  ], () => renderHealthActivityChart(entries));
}
