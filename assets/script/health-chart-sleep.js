// Sleep chart (Health Chart). Shared math/helpers live in health-chart.js.

let wellnessSleepChart = null;
// Clock minutes onto a noon-anchored axis, so a bed/wake pair crossing midnight renders
// as one contiguous span instead of splitting at 0:00. Noon, not an assumed bedtime: a
// fixed 18:00 anchor baked in "everyone sleeps at night" and broke on a night shift,
// while noon falls mid-waking-period for virtually any schedule.
const SLEEP_AXIS_ANCHOR_MIN = 12 * 60;
function sleepAxisValue(clockMin) {
  return (((clockMin - SLEEP_AXIS_ANCHOR_MIN) + 24 * 60) % (24 * 60)) / 60;
}

// Inverse of sleepAxisValue, shared by the ticks and the weekly-average tooltip. Both
// the anchor and the 3h step are whole hours, so no label lookup table is needed.
function sleepAxisClockMin(v) {
  return Math.round((SLEEP_AXIS_ANCHOR_MIN + v * 60) % (24 * 60));
}

function sleepAxisTickLabel(v) {
  return formatClockTime24(sleepAxisClockMin(v));
}

// The real bed-to-wake span rounded out to a 3-hour tick, rather than a fixed 18-hour
// window that wastes space on hours nobody sleeps through. 0-18 only with no data.
//
// The tick AT OR BELOW the earliest bedtime, not a whole tick below it. Flooring a 23:00
// bedtime already lands on 21:00; subtracting a further 3h put the axis floor at 18:00
// and left three empty hours under every bar — six with the top end padded the same way.
// A pad is added only when an extreme falls exactly ON a tick, which is the one case
// where the bar would otherwise sit flush against the axis edge with nothing to read it
// against (a midnight bedtime lands on 00:00, so the axis opens at 21:00).
function computeSleepAxisRange(shiftedPairs) {
  if (shiftedPairs.length === 0) return { axisMin: 0, axisMax: 18 };
  const min = Math.min(...shiftedPairs.map((p) => p.start));
  const max = Math.max(...shiftedPairs.map((p) => p.end));
  const floorTick = Math.floor(min / 3) * 3;
  const ceilTick = Math.ceil(max / 3) * 3;
  return {
    axisMin: Math.max(0, min === floorTick ? floorTick - 3 : floorTick),
    axisMax: Math.min(24, max === ceilTick ? ceilTick + 3 : ceilTick),
  };
}

// Red -> amber -> green from half the desired sleep up to all of it, in the app's own
// expense/calories/income colours. Solid at either end.
function sleepStatusColor(durationHr, desiredHr) {
  const minHr = desiredHr / 2;
  const ratio = Math.min(1, Math.max(0, (durationHr - minHr) / (desiredHr - minHr)));
  return ratio < 0.5
    ? lerpHex(chartColor('--chart-bad'), chartColor('--chart-warn'), ratio / 0.5)
    : lerpHex(chartColor('--chart-warn'), chartColor('--chart-good'), (ratio - 0.5) / 0.5);
}

// Green at 0 kcal, sliding to red as the Deprivation Effect itself grows — driven by the
// same kcal figure the dot's position and the glance tile's number already show, not a
// separate hours-based reading, so the colour can't tell a different story than the
// value beside it. Full red at 60 kcal/day: roughly what one night a couple of hours
// short costs a typical few-hundred-kcal desired deficit — an hours-based ratio against
// the full desired sleep left ordinary night-to-night variation reading as the same
// solid green. Shared by the Sleep chart's dot and the Deprivation Effect glance tile.
const SLEEP_DEPRIVATION_DOT_FULL_RED_KCAL = 60;

function sleepDeprivationDotColor(deprivationEffectKcal) {
  if (deprivationEffectKcal === null || deprivationEffectKcal === undefined) return chartColor('--chart-good');
  const ratio = Math.min(1, Math.max(0, deprivationEffectKcal / SLEEP_DEPRIVATION_DOT_FULL_RED_KCAL));
  return lerpHex(chartColor('--chart-good'), chartColor('--chart-bad'), ratio);
}

function renderHealthSleepChart(entries) {
  const ctx = document.getElementById('health-sleep-chart');

  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);

  const sleepEntries = entries.filter((e) => e.category === 'Sleep' && e.amount !== null);
  // Shared with every other chart in the panel (healthCalorieChartDates), not this
  // metric's own earliest log — a Sleep chart clipped to its own first entry could pick
  // a different-length date list than Body Mass/Calorie Balance/etc, and
  // wellnessTickIndices (charts-base.js) would then choose DIFFERENT dates for its
  // ticks even though every chart runs the identical selection algorithm. One shared list is the
  // only way every chart's gridlines are guaranteed to land on the same dates.
  const dates = healthCalorieChartDates(entries);

  // Only the longest bed/wake-bearing entry per date, so a nap logged separately
  // doesn't compete with the night. A date with only a duration is left as a gap.
  const bestByDate = new Map();
  sleepEntries.forEach((e) => {
    if (e.sleepBedMin === null || e.sleepWakeMin === null) return;
    const current = bestByDate.get(e.date);
    if (!current || e.amount > current.amount) bestByDate.set(e.date, e);
  });

  // Shifted once up front, feeding both the axis range and the chart data, so the shift
  // and the validity check (wake must land after bed) live in one place.
  const shiftedByDate = new Map();
  const validShiftedPairs = [];
  dates.forEach((d) => {
    const e = bestByDate.get(d);
    if (!e) return;
    const start = sleepAxisValue(e.sleepBedMin);
    const end = sleepAxisValue(e.sleepWakeMin);
    if (end <= start) return;
    shiftedByDate.set(d, { start, end, e });
    validShiftedPairs.push({ start, end });
  });

  const { axisMin, axisMax } = computeSleepAxisRange(validShiftedPairs);

  const rangeByDate = new Map(); // date -> { bedMin, wakeMin, durationHr }
  const barColors = [];
  const sleepData = dates.map((d) => {
    const shifted = shiftedByDate.get(d);
    if (!shifted) { barColors.push(null); return null; }
    const { start, end, e } = shifted;
    rangeByDate.set(d, { bedMin: e.sleepBedMin, wakeMin: e.sleepWakeMin, durationHr: e.amount });
    barColors.push(sleepStatusColor(e.amount, sleepDesired));
    return [start, end];
  });

  // Fit in AXIS units, not clock minutes: the shift has already unwrapped midnight, so
  // a plain fit works where clock times would average 23:30 and 00:30 into midday.
  const bedAvg = emaSeries(dates.map((d) => shiftedByDate.get(d)?.start ?? null));
  const wakeAvg = emaSeries(dates.map((d) => shiftedByDate.get(d)?.end ?? null));

  // Deprivation Effect = Desired Deficit × (1 - Sleep Efficiency Factor) — the kcal of
  // the plan's own deficit (desiredBalanceKcal, not the day's actual eaten-vs-burned
  // balance — that adjustment lives in Calorie Balance instead) that a short night cost,
  // dotted on each night's bar. Zero — green — at a full night; red and rising the
  // further that night fell short of desired sleep. This is the impact, not what survived
  // it, so a good night reads as "nothing lost" rather than a number worth reading.
  const desiredDeficitKcal = desiredBalanceKcal(planBodyMassKg(entries));
  const sleepHoursByDate = new Map();
  sleepEntries.forEach((e) => {
    sleepHoursByDate.set(e.date, (sleepHoursByDate.get(e.date) || 0) + e.amount);
  });
  const dotColors = [];
  const deprivationEffectData = dates.map((d) => {
    const sleepHrs = sleepHoursByDate.get(d);
    if (sleepHrs === undefined || desiredDeficitKcal === null) { dotColors.push(null); return null; }
    const factor = sleepEfficiencyFactor(sleepHrs, sleepDesired);
    const kcal = Math.round(Math.abs(desiredDeficitKcal) * (1 - factor));
    dotColors.push(sleepDeprivationDotColor(kcal));
    return kcal;
  });

  // Legend entries switched off (renderToggleLegend below); nights by how far short of
  // the desired sleep they fell, the cut-offs the gradient runs between.
  const hidden = legendHiddenNames('health-sleep-legend');
  const nightClasses = dates.map((d) => {
    const r = rangeByDate.get(d);
    if (!r) return null;
    if (r.durationHr >= sleepDesired) return 'Desired sleep met';
    return r.durationHr <= sleepDesired / 2 ? 'Half of desired or less' : 'Short of desired';
  });

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
        trendLineDataset('7-Day Avg Bed', bedAvg, { yAxisID: 'y1', hidden: hidden.has('7-Day Average Bed & Wake') }),
        trendLineDataset('7-Day Avg Wake', wakeAvg, { yAxisID: 'y1', hidden: hidden.has('7-Day Average Bed & Wake') }),
        {
          type: 'line',
          label: 'Deprivation Effect',
          data: deprivationEffectData,
          showLine: false,
          spanGaps: false,
          pointRadius: (c) => (deprivationEffectData[c.dataIndex] !== null ? 4 : 0),
          pointHoverRadius: (c) => (deprivationEffectData[c.dataIndex] !== null ? 5 : 0),
          pointBackgroundColor: (c) => dotColors[c.dataIndex] ?? 'transparent',
          pointBorderColor: (c) => dotColors[c.dataIndex] ?? 'transparent',
          yAxisID: 'y',
          hidden: hidden.has('Sleep Deprivation Effect (dot, green to red)'),
          // Paints on top of the bar it sits on, same convention as the desired caps.
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Without it the cursor lands on whichever average line is nearest, not the bar.
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
              const r = rangeByDate.get(item.label);
              if (!r) return '';
              const lines = [
                `Bed: ${formatClockTime24(r.bedMin)}`,
                `Wake: ${formatClockTime24(r.wakeMin)}`,
                `Duration: ${r.durationHr} hr`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // Flush left and last, like every reference figure in the section.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined || bedAvg[i] === null) return '';
              const lines = [
                `7-Day Average Bed: ${formatClockTime24(sleepAxisClockMin(bedAvg[i]))}`,
                `7-Day Average Wake: ${formatClockTime24(sleepAxisClockMin(wakeAvg[i]))}`,
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
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
        y1: {
          position: 'right',
          min: axisMin,
          max: axisMax,
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: 3, callback: sleepAxisTickLabel },
        },
      },
    },
  });

  // Swatches under the chart; both 7-Day lines share one colour, so one entry.
  renderToggleLegend('health-sleep-legend', rangeByDate.size === 0 ? [] : [
    { name: 'Desired sleep met', color: chartColor('--chart-good') },
    { name: 'Short of desired', color: chartColor('--chart-warn') },
    { name: 'Half of desired or less', color: chartColor('--chart-bad') },
    { name: '7-Day Average Bed & Wake', color: desiredMarkColor() },
    ...(desiredDeficitKcal !== null ? [{ name: 'Sleep Deprivation Effect (dot, green to red)', color: sleepDeprivationDotColor(SLEEP_DEPRIVATION_DOT_FULL_RED_KCAL / 2) }] : []),
  ], () => renderHealthSleepChart(entries));
}

