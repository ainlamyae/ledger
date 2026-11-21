// Energy Balance chart (Health Chart). Shared math/helpers live in health-chart.js.

// Smallest half-span of the axis, so all-deficit days still leave a band above zero.
const ENERGY_BALANCE_AXIS_MIN_KCAL = 200;

// Both bounds round out to a multiple of this, so every label sits on a gridline.
const ENERGY_BALANCE_TICK_KCAL = 250;

// Headroom past the furthest value before rounding out to a tick.
const ENERGY_BALANCE_AXIS_HEADROOM = 1.08;

// The desired dash's half-height as a share of the axis span, so it stays a hairline.
const ENERGY_BALANCE_DESIRED_CAP_FRACTION = 0.004;

let healthEnergyBalanceChart = null;

// The two grades used when there's no desired figure, only a direction.
function energyBalanceSignGrade(toward) {
  return toward
    ? { name: 'Toward desired', color: chartColor('--chart-good') }
    : { name: 'Away from desired', color: chartColor('--chart-bad') };
}

// Graded by balance ÷ desired balance, lifted by its average's grade. With no desired
// figure, by sign alone: toward or away from the way the user is headed.
function energyBalanceGrade(balance, isCut, desired, weeklyAvg) {
  if (balance === null) return { name: null, color: chartColor('--chart-neutral') };
  if (!desired) return energyBalanceSignGrade(isCut ? balance < 0 : balance > 0);
  return desiredGradeBlended(balance / desired, weeklyAvg === null || weeklyAvg === undefined ? null : weeklyAvg / desired);
}

// Each label's sleep-adjusted balance (null with no food logged or no BMR) and the terms
// behind it by date. Also read by the heatmap and Safe Pace.
function energyBalanceDays(entries, labels) {
  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const intakeEntries = calorieLogEntries(entries);
  const bodyMassForDate = carryForwardBodyMassByDate(bodyMassByDateMap(bodyMassEntries), labels);

  const intakeByDate = dailyValues(intakeEntries, () => true, (e) => e.amount, sumDailyValues);

  // The day's own measured TEF where Physique has one; otherwise the flat estimate below.
  const tefByDate = dailyValues(
    intakeEntries,
    (e) => e.tefKcal !== null && e.tefKcal !== undefined,
    (e) => e.tefKcal,
    sumDailyValues,
  );

  // At the same carried-forward body mass the BMR term uses.
  const activityKcalByDate = dailyValues(
    entries,
    (e) => isActivityCategory(e.category) && e.amount !== null,
    (e) => activityEntryKcal(e, bodyMassForDate.get(e.date) ?? null),
    sumDailyValues,
  );

  // A short night's cost is folded into the balance itself, so this chart, its average
  // and the forecast all read the sleep-adjusted figure.
  const sleepHoursByDate = dailyValues(
    entries,
    (e) => e.category === 'Sleep' && e.amount !== null,
    (e) => e.amount,
    sumDailyValues,
  );
  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);

  const detailByDate = new Map();

  const balanceData = labels.map((date) => {
    // No food logged is no data, not a day of eating nothing.
    if (!intakeByDate.has(date)) return null;

    const intake = Math.round(intakeByDate.get(date));
    // The BMR basis setting picks which of the day's figures drives the bar.
    const bmrFigures = bmrFiguresForDate(date);
    const maintenance = pickBmrForBasis(bmrFigures);
    if (maintenance === null) return null;
    const activity = Math.round(activityKcalByDate.get(date) || 0);
    // Digestion is spent like the other two terms, as a share of what was actually eaten.
    const tefMeasured = tefByDate.has(date);
    const tef = Math.round(tefMeasured ? tefByDate.get(date) : intake * (1 - tefDivisor()));
    const { rawBalance, deprivationKcal, balance } = dailyEnergyBalanceKcal(
      intake, maintenance, activity, tef, sleepHoursByDate.get(date), sleepDesired,
    );

    detailByDate.set(date, {
      intake, maintenance, activity, tef, tefMeasured, rawBalance, deprivationKcal, balance,
      bmrFigures,
    });
    return balance;
  });

  return { balanceData, detailByDate };
}

// Eaten minus spent per day, with the fat change it implies on a twin grams axis.
// Spend is the selected BMR plus logged activity, with no lifestyle multiplier, since
// logged activity is already real kcal. Colours follow the desired balance, not the sign:
// a deficit is only progress for someone heading down.
function renderHealthEnergyBalanceChart(entries) {
  const ctx = document.getElementById('health-energy-balance-chart');

  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);

  // Without a profile and a body mass there's no maintenance figure: show the empty state.
  const canCompute = haveProfile && bodyMassEntries.length > 0;
  const labels = canCompute ? healthCalorieChartDates(entries) : [];
  const { balanceData, detailByDate } = energyBalanceDays(entries, labels);
  // Which side of zero is progress, read as Caloric Intake reads it.
  const isCut = getCalorieDesiredKind(entries) === 'max';

  const values = balanceData.filter((v) => v !== null);
  const hasData = values.length > 0;

  // At the plan's body mass: one figure for the whole window.
  const desired = hasData ? desiredBalanceKcal(planBodyMassKg(entries)) : null;
  const desiredName = `Desired ${desired !== null && desired < 0 ? 'Deficit' : 'Surplus'}`;

  const weeklyAvg = emaSeries(balanceData, bodyMassSmoothingDays());

  // Hidden legend entries leave the axis range too; bars by their grade's name.
  const hidden = legendHiddenNames('health-energy-balance-legend');
  const avgHidden = hidden.has(healthAvgName());
  const desiredHidden = hidden.has(desiredName);
  const grades = balanceData.map((v, i) => energyBalanceGrade(v, isCut, desired, weeklyAvg[i]));
  const barColors = grades.map((g) => g.color);
  const barClasses = grades.map((g) => g.name);

  const shownBalance = maskHiddenClasses(balanceData, barClasses, hidden);
  const shown = [
    ...shownBalance,
    ...(avgHidden ? [] : weeklyAvg),
    ...(desired === null || desiredHidden ? [] : [desired]),
  ].filter((v) => v !== null);
  const maxDeficit = Math.max(0, ...shown.map((v) => -v));
  const maxSurplus = Math.max(0, ...shown);
  const upToTick = (v) => Math.ceil(Math.max(v * ENERGY_BALANCE_AXIS_HEADROOM, ENERGY_BALANCE_AXIS_MIN_KCAL) / ENERGY_BALANCE_TICK_KCAL)
    * ENERGY_BALANCE_TICK_KCAL;
  const yMin = -upToTick(maxDeficit);
  const yMax = upToTick(maxSurplus);

  healthEnergyBalanceChart = upsertChart(healthEnergyBalanceChart, ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Calorie balance',
          data: shownBalance,
          backgroundColor: barColors,
          order: 2,
        },
        trendLineDataset(healthAvgName(), weeklyAvg, { hidden: avgHidden }),
        // A dash per day, as Caloric Intake marks its desired intake.
        ...(desired === null ? [] : [desiredCapDataset(
          'Desired for the day',
          labels.map(() => desired),
          (yMax - yMin) * ENERGY_BALANCE_DESIRED_CAP_FRACTION,
          // Cyan, so it can't pass for the average line.
          { backgroundColor: chartColor('--chart-cyan'), isDesiredLine: true, hidden: desiredHidden },
        )]),
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
          // The dash and average are stated in afterBody instead.
          filter: (item) => !item.dataset.isDesiredLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            // Every term of the subtraction, spent terms shown negative, so the column
            // reads top-down as the arithmetic behind the bar.
            label: (item) => {
              const d = detailByDate.get(item.label);
              if (!d) return '';
              const lines = [
                `TEI (Total Energy Intake): ${d.intake} kcal`,
                `${bmrHoverLabel(selectedBmrKey(d.bmrFigures))}: ${-d.maintenance} kcal`,
                `AEE (Activity Energy Expenditure): ${-d.activity} kcal`,
                // Omitted at zero, where it would read as a failed figure.
                ...(d.tef > 0 ? [`TEF (Thermic Effect of Food): ${-d.tef} kcal`] : []),
                // Added either side of zero: less fat lost on a deficit, more gained on a surplus.
                `SD (Sleep Deprivation Effect): ${Math.round(d.deprivationKcal ?? 0)} kcal`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            afterBody: (items) => {
              const lines = [];
              if (desired !== null) lines.push(`D (${desiredName}): ${desired} kcal/day`);
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) {
                lines.push(`${healthAvgName()}: ${Math.round(weeklyAvg[i])} kcal`);
              }
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: datedCategoryXScale(labels),
        y: {
          min: yMin,
          max: yMax,
          afterFit: fixDatedYAxisWidth,
          // Zero takes the tick-label colour, since the chart is read against it.
          grid: { color: (ctx) => (ctx.tick.value === 0 ? Chart.defaults.color : Chart.defaults.borderColor) },
          // autoSkip off, or Chart.js drops "crowded" ticks and the spacing goes uneven.
          ticks: { stepSize: ENERGY_BALANCE_TICK_KCAL, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
        y1: {
          // y's bounds in grams of fat, so zero lines up and bars read off either side.
          min: (yMin / GENERIC_KCAL_PER_KG_FAT) * 1000,
          max: (yMax / GENERIC_KCAL_PER_KG_FAT) * 1000,
          position: 'right',
          afterFit: fixDatedYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { includeBounds: false, callback: maskedUnitTick('g') },
        },
      },
    },
  });

  renderToggleLegend('health-energy-balance-legend', labels.length === 0 ? [] : [
    ...(desired ? desiredGradeLegend() : [true, false].map(energyBalanceSignGrade)),
    { name: healthAvgName(), color: desiredMarkColor() },
    ...(desired !== null ? [{ name: desiredName, color: chartColor('--chart-cyan') }] : []),
  ], () => renderHealthEnergyBalanceChart(entries));
}
