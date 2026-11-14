// Sleep chart (Health Chart). Shared math/helpers live in health-chart.js.

let wellnessSleepChart = null;

// Clock minutes onto a noon-anchored axis, so a night crossing midnight is one span.
// Noon rather than an assumed bedtime, so night shifts plot too.
const SLEEP_AXIS_ANCHOR_MIN = 12 * 60;
const SLEEP_AXIS_TICK_HOURS = 3;

function sleepAxisValue(clockMin) {
  return (((clockMin - SLEEP_AXIS_ANCHOR_MIN) + 24 * 60) % (24 * 60)) / 60;
}

// Inverse of sleepAxisValue, for the ticks and the average's tooltip.
function sleepAxisClockMin(v) {
  return Math.round((SLEEP_AXIS_ANCHOR_MIN + v * 60) % (24 * 60));
}

function sleepAxisTickLabel(v) {
  return formatClockTime24(sleepAxisClockMin(v));
}

// The bed-to-wake span rounded out to the tick at or beyond each extreme; padded one
// more tick only when an extreme sits exactly on one, so no bar is flush with the edge.
function computeSleepAxisRange(shiftedPairs) {
  if (shiftedPairs.length === 0) return { axisMin: 0, axisMax: 18 };
  const step = SLEEP_AXIS_TICK_HOURS;
  const min = Math.min(...shiftedPairs.map((p) => p.start));
  const max = Math.max(...shiftedPairs.map((p) => p.end));
  const floorTick = Math.floor(min / step) * step;
  const ceilTick = Math.ceil(max / step) * step;
  return {
    axisMin: Math.max(0, min === floorTick ? floorTick - step : floorTick),
    axisMax: Math.min(24, max === ceilTick ? ceilTick + step : ceilTick),
  };
}

// The Deprivation Effect dot goes fully red at this many kcal/day, roughly a night a
// couple of hours short against a typical desired deficit.
const SLEEP_DEPRIVATION_DOT_FULL_RED_KCAL = 60;

// Green at 0 kcal, along the desired grades' blend to Missed at the full-red figure.
function sleepDeprivationDotColor(deprivationEffectKcal) {
  if (deprivationEffectKcal === null || deprivationEffectKcal === undefined) return chartColor('--chart-good');
  const ratio = Math.min(1, Math.max(0, deprivationEffectKcal / SLEEP_DEPRIVATION_DOT_FULL_RED_KCAL));
  return desiredGradeBlend(DESIRED_GRADES[1].min * (1 - ratio));
}

function renderHealthSleepChart(entries) {
  const ctx = document.getElementById('health-sleep-chart');
  const smoothingDays = bodyMassSmoothingDays();
  const bedWakeAvgName = healthAvgName(' Bed & Wake');

  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);

  const sleepEntries = entries.filter((e) => e.category === 'Sleep' && e.amount !== null);
  // The panel's shared dates, not this metric's own first log, so every chart picks the
  // same gridline dates.
  const dates = healthCalorieChartDates(entries);

  // Only the longest entry with bed and wake times per date, so a separate nap doesn't
  // compete with the night. A date with only a duration is left as a gap.
  const bestByDate = new Map();
  sleepEntries.forEach((e) => {
    if (e.sleepBedMin === null || e.sleepWakeMin === null) return;
    const current = bestByDate.get(e.date);
    if (!current || e.amount > current.amount) bestByDate.set(e.date, e);
  });

  // Shifted once, for both the axis range and the bars; wake must land after bed.
  const shiftedByDate = new Map();
  dates.forEach((d) => {
    const e = bestByDate.get(d);
    if (!e) return;
    const start = sleepAxisValue(e.sleepBedMin);
    const end = sleepAxisValue(e.sleepWakeMin);
    if (end <= start) return;
    shiftedByDate.set(d, { start, end, e });
  });
  const sleepData = dates.map((d) => {
    const shifted = shiftedByDate.get(d);
    return shifted ? [shifted.start, shifted.end] : null;
  });

  // Each night graded by hours slept ÷ desired sleep, lifted by its average's grade.
  const durations = dates.map((d) => shiftedByDate.get(d)?.e.amount ?? null);
  const durationAvg = emaSeries(durations, smoothingDays);
  const nightGrades = durations.map((hr, i) => (hr === null ? null
    : desiredGradeBlended(hr / sleepDesired, durationAvg[i] === null ? null : durationAvg[i] / sleepDesired)));
  const barColors = nightGrades.map((g) => g?.color ?? null);

  // Averaged in axis units, where midnight is already unwrapped.
  const bedAvg = emaSeries(dates.map((d) => shiftedByDate.get(d)?.start ?? null), smoothingDays);
  const wakeAvg = emaSeries(dates.map((d) => shiftedByDate.get(d)?.end ?? null), smoothingDays);

  // Deprivation Effect = Desired Deficit × (1 - Sleep Efficiency Factor): the kcal of the
  // plan's deficit a short night cost. Calorie Balance applies it to the day's actual balance.
  const desiredDeficitKcal = desiredBalanceKcal(planBodyMassKg(entries));
  const sleepHoursByDate = dailyValues(sleepEntries, () => true, (e) => e.amount, sumDailyValues);
  const deprivationEffectData = dates.map((d) => {
    const sleepHrs = sleepHoursByDate.get(d);
    if (sleepHrs === undefined || desiredDeficitKcal === null) return null;
    const factor = sleepEfficiencyFactor(sleepHrs, sleepDesired);
    return Math.round(Math.abs(desiredDeficitKcal) * (1 - factor));
  });
  const dotColors = deprivationEffectData.map((kcal) => (kcal === null ? null : sleepDeprivationDotColor(kcal)));

  // Hidden legend entries leave the axis range too; nights by their grade's name.
  const hidden = legendHiddenNames('health-sleep-legend');
  const avgHidden = hidden.has(bedWakeAvgName);
  const nightClasses = nightGrades.map((g) => g?.name ?? null);
  const shownPairs = dates.map((d, i) => (hidden.has(nightClasses[i]) ? null : shiftedByDate.get(d)))
    .filter(Boolean);
  if (!avgHidden) {
    dates.forEach((d, i) => {
      if (bedAvg[i] !== null && wakeAvg[i] !== null) shownPairs.push({ start: bedAvg[i], end: wakeAvg[i] });
    });
  }
  const { axisMin, axisMax } = computeSleepAxisRange(shownPairs);

  const hasDot = (c) => deprivationEffectData[c.dataIndex] !== null;

  wellnessSleepChart = upsertChart(wellnessSleepChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Sleep',
          data: maskHiddenClasses(sleepData, nightClasses, hidden),
          backgroundColor: barColors,
          yAxisID: 'y1',
          order: 2,
        },
        trendLineDataset(`${smoothingDays}-Day Avg Bed`, bedAvg, { yAxisID: 'y1', hidden: avgHidden }),
        trendLineDataset(`${smoothingDays}-Day Avg Wake`, wakeAvg, { yAxisID: 'y1', hidden: avgHidden }),
        {
          type: 'line',
          label: 'Deprivation Effect',
          data: deprivationEffectData,
          showLine: false,
          spanGaps: false,
          pointRadius: (c) => (hasDot(c) ? fitPointRadius(4)(c) : 0),
          pointHoverRadius: (c) => (hasDot(c) ? fitPointRadius(5)(c) : 0),
          pointBorderWidth: fitPointBorderWidth(4, 1),
          pointBackgroundColor: (c) => dotColors[c.dataIndex] ?? 'transparent',
          pointBorderColor: (c) => dotColors[c.dataIndex] ?? 'transparent',
          yAxisID: 'y',
          hidden: hidden.has('Sleep Deprivation Effect'),
          // Paints on top of its bar.
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Index mode, or the cursor snaps to the nearest average line instead of the bar.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // Nights with no pair plot as a gap; index mode would hand them over empty.
          filter: (item) => item.raw !== null && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              if (item.dataset.label === 'Deprivation Effect') {
                const text = `SD (Sleep Deprivation Effect): ${item.raw} kcal`;
                return privacyMode ? maskDigits(text) : text;
              }
              const e = shiftedByDate.get(item.label)?.e;
              if (!e) return '';
              const lines = [
                `Bed: ${formatClockTime24(e.sleepBedMin)}`,
                `Wake: ${formatClockTime24(e.sleepWakeMin)}`,
                `Duration: ${e.amount} hr`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined || bedAvg[i] === null) return '';
              const lines = [
                `${healthAvgName(' Bed')}: ${formatClockTime24(sleepAxisClockMin(bedAvg[i]))}`,
                `${healthAvgName(' Wake')}: ${formatClockTime24(sleepAxisClockMin(wakeAvg[i]))}`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          min: 0,
          afterFit: fixDatedYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
        y1: {
          position: 'right',
          min: axisMin,
          max: axisMax,
          afterFit: fixDatedYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: SLEEP_AXIS_TICK_HOURS, callback: sleepAxisTickLabel },
        },
      },
    },
  });

  // Both average lines share one colour, so one legend entry.
  renderToggleLegend('health-sleep-legend', shiftedByDate.size === 0 ? [] : [
    ...desiredGradeLegend(),
    { name: bedWakeAvgName, color: desiredMarkColor() },
    ...(desiredDeficitKcal !== null ? [{ name: 'Sleep Deprivation Effect', color: sleepDeprivationDotColor(SLEEP_DEPRIVATION_DOT_FULL_RED_KCAL / 2) }] : []),
  ], () => renderHealthSleepChart(entries));
}
