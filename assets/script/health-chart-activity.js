// Physical Activity chart (Health Chart). Shared math/helpers live in health-chart.js.

let healthActivityChart = null;
// "NEAT (Non-Exercise Activity Thermogenesis)" -> "NEAT"; the parenthetical doesn't fit
// a legend and isn't needed once you know the term.
function shortActivityLabel(description) {
  return description.split(' (')[0].trim();
}

// The two segments read most often, pinned rather than left to whatever hue their
// alphabetical position lands on — a generated one slides out from under them the
// moment a new description is logged. Keyed on the SHORTENED label.
const PINNED_ACTIVITY_COLORS = new Map([
  ['neat', '--chart-blue'],
  ['strength training', '--chart-good'],
]);

// Everything else gets a generated hue from the colour circle MINUS a band around each
// pinned one, otherwise a third activity lands on a near-identical blue and the pinning
// buys nothing. The surviving arcs are measured end to end and the hues spread evenly
// along that total, so they stay as far apart as the reduced range allows.
const RESERVED_ACTIVITY_HUE_MARGIN = 25;

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

  const activityEntries = entries.filter((e) => (e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = healthCalorieChartDates(entries);

  // One stacked segment per description rather than a summed bar, so each day's
  // composition shows and not just its total. Entries with no recognized
  // category (an exercise name missing from the Activities tab) are dropped
  // rather than pooled into an 'Other' segment the sheet doesn't define.
  const categorizedEntries = activityEntries.filter((e) => e.description && e.description !== 'Other');
  const descriptions = [...new Set(categorizedEntries.map((e) => e.description))].sort();
  const byDescription = new Map(descriptions.map((d) => [d, new Map()]));
  categorizedEntries.forEach((e) => {
    const mins = toActivityMinutes(e.amount, e.unit);
    const byDate = byDescription.get(e.description);
    byDate.set(e.date, (byDate.get(e.date) || 0) + mins);
  });

  // Burn per day on its own axis — minutes and kcal are different scales, so this is a
  // deliberate dual-axis chart. Every entry gets a figure via activityEntryKcal, so an
  // entry without amount2 no longer leaves a logged day with no dot.
  const activityBodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(entries.filter((e) => e.category === 'Body Mass' && e.amount !== null)), dates);
  const caloriesByDate = new Map();
  activityEntries.forEach((e) => {
    const kcal = activityEntryKcal(e, activityBodyMassForDate.get(e.date) ?? null);
    caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + kcal);
  });

  const pinned = (d) => PINNED_ACTIVITY_COLORS.get(shortActivityLabel(d).toLowerCase());
  const pinnedColorFor = (d) => (pinned(d) ? chartColor(pinned(d)) : null);
  const generatedHues = unreservedActivityHues(descriptions.filter((d) => pinnedColorFor(d) === null).length);
  let nextGeneratedHue = 0;
  const descriptionColors = descriptions.map((d) => pinnedColorFor(d)
    ?? seriesColor(generatedHues[nextGeneratedHue++]));

  // Everything plots NEGATIVE so the chart hangs below the axis: minutes and calories
  // are both what a day spent, not what it accumulated. Only the geometry is flipped —
  // ticks and tooltips report the magnitudes.
  const activityDatasets = descriptions.map((d, i) => ({
    type: 'bar',
    label: shortActivityLabel(d),
    data: dates.map((date) => -(byDescription.get(d).get(date) || 0)),
    backgroundColor: descriptionColors[i],
    stack: 'activity',
    order: 2,
  }));

  const hasData = activityDatasets.some((ds) => ds.data.some((v) => v !== 0));

  // Scored against what that day's own body mass would burn at ACTIVITY_DESIRED_MIN — or
  // the pinned calorie burn, if that's what's pinned instead — via the same
  // getActivityDesiredKcal the activity tile uses, so the two can't disagree. Graded by
  // burn ÷ desired burn (desiredGrade), lifted to one step under the 7-Day Average Burn's
  // grade. Without a body mass there's no desired burn, so the dot stays neutral violet.
  const dotGrade = (date, kcal, weekKcal) => {
    const bodyMassKg = activityBodyMassForDate.get(date) ?? null;
    if (kcal === null || bodyMassKg === null) return { name: null, color: chartColor('--chart-purple') };
    const desiredKcal = getActivityDesiredKcal(bodyMassKg);
    return desiredGrade(kcal / desiredKcal, weekKcal === null ? null : weekKcal / desiredKcal);
  };

  // Dots, not a connected line: each day's burn is independent, and a line would bridge
  // the unlogged days as though they were a trend.
  const caloriesData = dates.map((date) => (caloriesByDate.has(date) ? caloriesByDate.get(date) : null));
  // On the kcal axis, not the minutes one — Desired Burn lives there, and it's what the
  // week is compared against.
  const weeklyBurnAvg = emaSeries(caloriesData);
  const dotGrades = dates.map((date, i) => dotGrade(date, caloriesData[i], weeklyBurnAvg[i]));
  const caloriesDataset = {
    type: 'line',
    label: 'Actual Burn',
    data: caloriesData.map((v) => (v === null ? null : -v)),
    yAxisID: 'y1',
    showLine: false,
    pointRadius: fitPointRadius(5),
    pointHoverRadius: fitPointRadius(7),
    pointBackgroundColor: dotGrades.map((g) => g.color),
    pointBorderColor: chartColor('--chart-point-border'),
    pointBorderWidth: fitPointBorderWidth(5, 1.5),
    order: 0,
  };

  // DESIRED BURN on the kcal axis, not the flat desired minutes it used to be — that sat
  // on the other axis from the dots it appeared to judge, so a day could clear it on a
  // walk while burning less than a day that lifted. It moves day to day when time is
  // what's pinned, since activityDesiredKcal scales with body mass; flat when calorie
  // burn is pinned instead. No body mass, no figure, so it breaks there rather than
  // inventing one.
  const desiredBurnKcal = dates.map((date) => {
    const bodyMassKg = activityBodyMassForDate.get(date) ?? null;
    return bodyMassKg === null ? null : getActivityDesiredKcal(bodyMassKg);
  });

  // A cap per column, the same mark Caloric Intake and Calorie Balance use. It was a
  // dashed line while the desired burn was flat; now that it moves with body mass, a line
  // spanning the window would read as one shared limit however it's dashed.
  const burnMagnitudes = [
    ...caloriesData.filter((v) => v !== null),
    ...desiredBurnKcal.filter((v) => v !== null),
  ];
  const capHalf = (burnMagnitudes.length ? Math.max(...burnMagnitudes) : 1) * 0.006;
  const desiredLineDataset = {
    type: 'bar',
    label: 'Desired Burn',
    data: desiredBurnKcal.map((v) => (v === null ? null : [-v - capHalf, -v + capHalf])),
    yAxisID: 'y1',
    // Cyan, the desired mark's colour on the other Health charts.
    backgroundColor: chartColor('--chart-cyan'),
    grouped: false,
    // Lowest order paints last: bars (2), the weekly average and this cap (both 1, the
    // cap second so it wins the tie), then the dots (0) above everything.
    order: 1,
    isDesiredLine: true,
  };

  // Negated like the dots it's fit to.
  const weeklyBurnDataset = trendLineDataset(
    '7-Day Average Burn',
    weeklyBurnAvg.map((v) => (v === null ? null : -v)),
    { yAxisID: 'y1' },
  );

  // Legend entries switched off (renderToggleLegend below): activities and lines by
  // name, burn dots by their colour's name.
  const hidden = legendHiddenNames('health-activity-legend');
  activityDatasets.forEach((ds) => { ds.hidden = hidden.has(ds.label); });
  weeklyBurnDataset.hidden = hidden.has('7-Day Average Burn');
  desiredLineDataset.hidden = hidden.has('Desired Burn');
  const dotClasses = dotGrades.map((g) => g.name);
  caloriesDataset.data = maskHiddenClasses(caloriesDataset.data, dotClasses, hidden);

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
          // Empty slots and the cap, whose `[from, to]` pair goes to afterBody instead.
          filter: (item) => item.raw !== null && !item.dataset.isDesiredLine && !item.dataset.isWeeklyAverage,
          // Dataset order. Without it Chart.js sorts by `order`, which controls DRAW
          // order, and put the dots above the bars — away from the Desired Burn figure
          // they should be read against.
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // Each dot's swatch takes the scored colour it was drawn in.
            labelColors: (item) => {
              const ds = item.dataset;
              const fill = Array.isArray(ds.pointBackgroundColor)
                ? ds.pointBackgroundColor[item.dataIndex]
                : (ds.pointBackgroundColor ?? ds.backgroundColor);
              return { borderColor: fill, backgroundColor: fill };
            },
            // Signed like the axes: calories keep the minus, minutes report magnitude.
            // y1 is kcal, everything else minutes, so the unit follows the row's axis.
            label: (item) => {
              const isKcal = item.dataset.yAxisID === 'y1';
              const v = Math.round(item.parsed.y);
              const text = `${item.dataset.label}: ${isKcal ? v : Math.abs(v)} ${isKcal ? 'kcal' : 'min'}`;
              return privacyMode ? maskDigits(text) : text;
            },
            // Flush left and last, the placement Caloric Intake gives its own desired intake.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [];
              if (desiredBurnKcal[i] !== null) lines.push(`AEE (Desired Activity Energy Expenditure): ${-Math.round(desiredBurnKcal[i])} kcal`);
              if (weeklyBurnAvg[i] !== null) lines.push(`7-Day Average Burn: ${-Math.round(weeklyBurnAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ...wellnessCategoryXScale(dates), stacked: true },
        // kcal left with the gridlines, minutes right with none: the comparison this
        // chart exists for — Actual against Desired Burn — happens on the kcal scale,
        // so the lines have to be spaced in kcal. Only the sides move; the axis ids are
        // untouched. Both run from 0 downward, since everything is negated, but they
        // label differently: calories keep the minus because that energy left the body,
        // minutes drop it because negative time is meaningless.
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

  // Swatches under the chart: each activity's bar colour, then the burn dots and lines.
  renderToggleLegend('health-activity-legend', !hasData ? [] : [
    ...descriptions.map((d, i) => ({ name: shortActivityLabel(d), color: descriptionColors[i] })),
    ...desiredGradeLegend(),
    { name: '7-Day Average Burn', color: desiredMarkColor() },
    { name: 'Desired Burn', color: chartColor('--chart-cyan') },
  ], () => renderHealthActivityChart(entries));
}

