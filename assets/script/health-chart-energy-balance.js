// Energy Balance chart (Health Chart). Shared math/helpers live in health-chart.js.

// Smallest half-span the axis scales to, so a run of all-deficit days still leaves a
// band above zero to read them against instead of pinning zero to the top.
const ENERGY_BALANCE_AXIS_MIN_KCAL = 200;

// Both bounds round out to a multiple of this, so every label sits on a gridline and
// the halves step identically. niceAxisBound's ladder could land on 800 and leave one
// odd tick among a run of 500s.
const ENERGY_BALANCE_TICK_KCAL = 250;

let healthEnergyBalanceChart = null;

// Against the target line, not just the sign: at or beyond it on the day itself is a
// darker green — a proper hit, not just a near-miss. Short of it falls back to the
// week: a 7-day average that's still made the target reads as real progress despite
// the one off day (green), but an average that's ALSO short means the day isn't an
// outlier, it's the trend, so it reads red like the wrong-side-of-zero case. No target
// means no band to compare against, so it falls back to the sign alone.
function energyBalanceColor(balance, isCut, target, weeklyAvg) {
  const towardTarget = isCut ? balance < 0 : balance > 0;
  if (!towardTarget) return chartColor('--chart-bad');
  if (target === null) return chartColor('--chart-good');
  if (isCut ? balance <= target : balance >= target) return chartColor('--chart-good-high');
  const weekOnTarget = weeklyAvg !== null && weeklyAvg !== undefined
    && (isCut ? weeklyAvg <= target : weeklyAvg >= target);
  return weekOnTarget ? chartColor('--chart-good') : chartColor('--chart-bad');
}

// Eaten minus spent per day, with the fat change that balance implies on a twin axis.
//
// Spend is Mifflin-St Jeor BMR at that day's carried-forward body mass PLUS its logged
// activity burn — no lifestyle multiplier, since logged activity is already real kcal
// and scaling BMR too would count the same movement twice. The calorie target is built
// the same way, so the two agree on any day activity hits the target.
//
// The COLOURS follow the target, not the sign — a deficit is only progress for someone
// heading down, so the app's green and red keep meaning "toward" and "away" rather than
// congratulating a bulker for undereating. Which side is progress comes from
// getCalorieTargetKind, the same read Caloric Intake uses. Within that side the target
// splits green from gray, so falling behind reads differently from going backwards.
//
// Grams is balance ÷ kcal-per-kg, a fixed linear rescale off two population constants,
// which is what makes the right axis a true twin of the left.
function renderHealthEnergyBalanceChart(entries) {
  const ctx = document.getElementById('health-energy-balance-chart');

  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const intakeEntries = entries.filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null);

  // No profile means no maintenance figure, no body-mass reading means no body mass to feed it.
  // Either way the chart shows its explanatory empty state, not a misleading partial.
  const canCompute = haveProfile && bodyMassEntries.length > 0;
  const labels = canCompute ? healthWindowDates(intakeEntries) : [];
  const bodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(bodyMassEntries), labels);

  const intakeByDate = new Map();
  intakeEntries.forEach((e) => intakeByDate.set(e.date, (intakeByDate.get(e.date) || 0) + e.amount));

  // This day's own measured TEF (Physique column L, via 🧬 Micronutrients on its
  // ingredients) where Physique has calculated one — falls back to the flat
  // TEF_PERCENT_OF_INTAKE estimate below on any day without one, same as before
  // this column existed.
  const tefByDate = new Map();
  intakeEntries.forEach((e) => {
    if (e.tefKcal !== null && e.tefKcal !== undefined) tefByDate.set(e.date, (tefByDate.get(e.date) || 0) + e.tefKcal);
  });

  // Through the one shared rule, at the same carried-forward body mass the BMR term uses.
  const activityKcalByDate = new Map();
  entries.forEach((e) => {
    if ((e.category !== 'Activity' && e.category !== 'Activity; Calories') || e.amount === null) return;
    const kcal = activityEntryKcal(e, bodyMassForDate.get(e.date) ?? null);
    activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
  });

  // Which side of zero is progress. Same read Caloric Intake's target is built on, so
  // the two charts can't disagree about which way the user is headed.
  const isCut = getCalorieTargetKind(entries) === 'max';

  // Sleep Deprivation Effect: how much of the day's OWN balance (not the flat plan
  // target — see the Sleep chart's dot for that) a short night cost — shrinking a
  // deficit's fat loss, or growing a surplus's fat gain, whichever side of zero the day
  // was already on. Folded straight into "balance" itself, so this chart, its
  // weekly average, and State Trend & Forecast's Calorie-Implied Trajectory (which
  // walks this same arithmetic day by day) all read the sleep-adjusted figure.
  const sleepEntries = entries.filter((e) => e.category === 'Sleep' && e.amount !== null);
  const sleepHoursByDate = new Map();
  sleepEntries.forEach((e) => sleepHoursByDate.set(e.date, (sleepHoursByDate.get(e.date) || 0) + e.amount));
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  const detailByDate = new Map();

  const balanceData = labels.map((date) => {
    // No food logged is no data, not a day of eating nothing — an empty slot rather
    // than a huge fake deficit.
    if (!intakeByDate.has(date)) return null;

    const intake = Math.round(intakeByDate.get(date));
    // The day's stored Derived cell (Physique's Derived column); the BMR basis setting picks
    // which figure drives the bar, and the hover lists all four.
    const bmrFigures = bmrFiguresForDate(date);
    const maintenance = pickBmrForBasis(bmrFigures);
    if (maintenance === null) return null;
    const activity = Math.round(activityKcalByDate.get(date) || 0);
    // Digestion is an expenditure like the other two, so it comes off the same subtraction —
    // otherwise switching TEF on would raise the desired intake here without also raising the
    // cost of eating it, and this chart would contradict the one that set it. A share
    // of what was ACTUALLY eaten, not of the desired figure: this row scores the day that
    // happened. Measured (tefByDate, from the day's own breakdown macros) wins over estimated
    // whenever Physique has calculated one for this day.
    const tefMeasured = tefByDate.has(date);
    const tef = Math.round(tefMeasured ? tefByDate.get(date) : intake * (1 - tefDivisor()));
    const { rawBalance, deprivationKcal, balance } = dailyEnergyBalanceKcal(
      intake, maintenance, activity, tef, sleepHoursByDate.get(date), sleepTarget,
    );

    detailByDate.set(date, {
      intake, maintenance, activity, tef, tefMeasured, rawBalance, deprivationKcal, balance,
      bmrFigures,
    });
    return balance;
  });

  const values = balanceData.filter((v) => v !== null);
  const hasData = values.length > 0;

  // Folded into the axis range too, so the dashes can't fall off-plot on a stretch of
  // days that all undershot them.
  // At the smoothed body mass, since a pinned percentage makes the deficit a function of body
  // mass: one dashed line for the whole window, drawn at the rate the plan's mass implies.
  const target = hasData ? targetBalanceKcal(planBodyMassKg(entries)) : null;

  const maxDeficit = Math.max(0, ...values.map((v) => -v), target === null ? 0 : -target);
  const maxSurplus = Math.max(0, ...values, target === null ? 0 : target);
  const upToTick = (v) => Math.ceil(Math.max(v * 1.08, ENERGY_BALANCE_AXIS_MIN_KCAL) / ENERGY_BALANCE_TICK_KCAL)
    * ENERGY_BALANCE_TICK_KCAL;
  const yMin = -upToTick(maxDeficit);
  const yMax = upToTick(maxSurplus);

  // A fraction of the axis span, so the dash stays a hairline at any range.
  const targetHalf = (yMax - yMin) * 0.004;

  // balanceData already nulls the unlogged days, so they sit out of the fit.
  const weeklyAvg = emaSeries(balanceData);

  healthEnergyBalanceChart = upsertChart(healthEnergyBalanceChart, ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Calorie balance',
          data: balanceData,
          backgroundColor: balanceData.map((v, i) => energyBalanceColor(v, isCut, target, weeklyAvg[i])),
          order: 2,
        },
        trendLineDataset('7-Day Average', weeklyAvg),
        // A dash per day, the idiom Caloric Intake uses for its own target: a continuous
        // line reads as one shared limit, a mark on each bar says the target belongs to
        // that day.
        ...(target === null ? [] : [{
          type: 'bar',
          label: 'Target for the day',
          data: labels.map(() => [target - targetHalf, target + targetHalf]),
          backgroundColor: targetMarkColor(),
          grouped: false,
          isTargetLine: true,
          // Lowest order paints last, so it stays visible on a bar that overshot it.
          order: 0,
        }]),
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
          text: canCompute
            ? 'No calories logged yet — log what you ate to see your daily balance'
            : 'Add Height, Birth Date, and Sex in Settings (and log a Body Mass) to estimate this',
          color: Chart.defaults.color,
          font: { size: chartFontSize() },
          padding: { top: 40 },
        },
        tooltip: {
          // The dashes are filtered out — a floating bar would report itself as a
          // `[from, to]` pair — and stated in afterBody instead.
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // The chart IS the subtraction, so every term is spelled out — a bare
            // "-450" wouldn't show whether eating less or moving more produced it.
            label: (item) => {
              const d = detailByDate.get(item.label);
              if (!d) return '';
              // "Actual Intake", the same name Caloric Intake and Protein Intake give
              // the figure in their own hovers — one day's eating shouldn't be called
              // three different things across three charts of the same panel.
              //
              // Maintenance and Activity are the two things SUBTRACTED from it, so
              // they're shown subtracted: the column reads top-down as the arithmetic
              // behind the bar (intake, less maintenance, less activity, giving the
              // balance) instead of three bare figures the reader has to remember the
              // signs of. Activity especially — kcal burned printed as a positive reads
              // as something ADDED to the day.
              const lines = [
                `TEI (Total Energy Intake): ${d.intake} kcal`,
                // All four stored BMR figures, as in Caloric Intake's hover.
                ...BMR_JSON_ORDER.filter((key) => d.bmrFigures[key] !== undefined)
                  .map((key) => `${bmrHoverLabel(key)}: ${-d.bmrFigures[key]} kcal`),
                `AEE (Activity Energy Expenditure): ${-d.activity} kcal`,
                // Only when there IS one. At the default f = 0 the row would be a
                // permanent "-0", which reads as a term that failed to compute rather
                // than one deliberately left out of the model. Labelled "measured" when
                // it's this day's own Physique figure, "est." when it's the flat
                // TEF_PERCENT_OF_INTAKE fallback — the two can differ by a real amount,
                // so which one produced this bar shouldn't be left ambiguous.
                ...(d.tef > 0 ? [`TEF (Thermic Effect of Food): ${-d.tef} kcal`] : []),
                // Added, not subtracted: on a deficit this is how much less of it became
                // fat loss; on a surplus it's how much MORE was gained, since short sleep
                // drives hunger and cuts NEAT rather than sitting out surplus days. Shown
                // on every day, 0 when the night met the target (or none was logged).
                `SD (Sleep Deprivation Effect): ${Math.round(d.deprivationKcal ?? 0)} kcal`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // The Tune's D. Flush left via afterBody, and signed like everything
            // else here so it reads off the axis its dash is drawn on.
            afterBody: (items) => {
              const lines = [];
              if (target !== null) {
                const word = target < 0 ? 'Deficit' : 'Surplus';
                lines.push(`D (Desired ${word}): ${target} kcal/day`);
              }
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) {
                lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} kcal`);
              }
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(labels),
        y: {
          min: yMin,
          max: yMax,
          afterFit: fixTrendYAxisWidth,
          // Zero is the line the chart is read against, so it takes the tick-label
          // colour instead of receding into the gridlines. Evaluated at draw time, so a
          // theme switch recolours it.
          grid: { color: (ctx) => (ctx.tick.value === 0 ? Chart.defaults.color : Chart.defaults.borderColor) },
          // autoSkip off, or Chart.js drops ticks it thinks are crowded and the spacing
          // goes uneven again.
          ticks: { stepSize: ENERGY_BALANCE_TICK_KCAL, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
        y1: {
          // The gram equivalent of y's own bounds, so zero lines up and every bar reads
          // off either side.
          min: (yMin / GENERIC_KCAL_PER_KG_FAT) * 1000,
          max: (yMax / GENERIC_KCAL_PER_KG_FAT) * 1000,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { includeBounds: false, callback: maskedUnitTick('g') },
        },
      },
    },
  });
}

