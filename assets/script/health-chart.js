
// The window every Chart-page chart plots, when the From/To pair above Body Mass
// hasn't been filled in yet: the last 4 weeks. Body Mass appears here as well as in
// State Trend & Forecast without duplicating it — that one is the trajectory over the
// whole history and ignores this window, this one scores each day's move toward the
// healthy mass or away from it.
const HEALTH_METRICS_DAYS = 28;

function lastNDates(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (n - 1 - i));
    return isoFromDate(d);
  });
}

// Every ISO date from fromIso to toIso inclusive. Empty on a missing, unparseable or
// inverted range — callers read that as "no data" rather than special-casing it.
function datesInRange(fromIso, toIso) {
  if (!fromIso || !toIso) return [];
  const from = dateFromIso(fromIso);
  const to = dateFromIso(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return [];

  const dates = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    dates.push(isoFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function renderHealthCharts(entries) {
  renderTodayGlanceCards(entries);
  renderHealthBodyMassChart(entries);
  renderHealthCaloriesChart(entries);
  renderHealthProteinChart(entries);
  renderHealthFiberChart(entries);
  renderHealthFatChart(entries);
  renderHealthCarbChart(entries);
  renderHealthActivityChart(entries);
  renderHealthSleepChart(entries);
  renderHealthProjectionChart(entries);
  renderHealthEnergyBalanceChart(entries);
}

// The charts answer "how's the trend", not "am I on track right now" — these tiles give
// today's actual-vs-desired for every Health Chart metric without reading the
// rightmost bar of each chart. Ordered to match that panel: Body Mass, then the
// donut-grid order (Caloric, Protein, Fiber, Fat, Carbohydrate, Activity, Sleep).
function renderTodayGlanceCards(entries) {
  const todayIso = isoFromDate(new Date());
  const todayEntries = entries.filter((e) => e.date === todayIso);

  let calories = null;
  let protein = null;
  let fiber = null;
  let fat = null;
  let carb = null;
  let activityMins = null;
  let sleepHours = null;
  let sleepBedMin = null;
  let sleepWakeMin = null;
  let tefKcalToday = null;

  todayEntries.forEach((e) => {
    if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
      calories = (calories ?? 0) + e.amount;
    }
    if (e.category === 'Calories; Protein' && e.amount2 !== null) {
      protein = (protein ?? 0) + e.amount2;
    }
    if (e.category === 'Calories; Protein' && e.fiberG !== null && e.fiberG !== undefined) {
      fiber = (fiber ?? 0) + e.fiberG;
    }
    if (e.category === 'Calories; Protein' && e.fatG !== null && e.fatG !== undefined) {
      fat = (fat ?? 0) + e.fatG;
    }
    if (e.category === 'Calories; Protein' && e.carbG !== null && e.carbG !== undefined) {
      carb = (carb ?? 0) + e.carbG;
    }
    if (e.category === 'Calories; Protein' && e.tefKcal !== null && e.tefKcal !== undefined) {
      tefKcalToday = (tefKcalToday ?? 0) + e.tefKcal;
    }
    if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
      activityMins = (activityMins ?? 0) + toActivityMinutes(e.amount, e.unit);
    }
    if (e.category === 'Sleep' && e.amount !== null) {
      sleepHours = e.amount;
      sleepBedMin = e.sleepBedMin;
      sleepWakeMin = e.sleepWakeMin;
    }
  });

  const calorieDesired = getCalorieDesired(entries);
  const proteinBand = getProteinDesiredBandG(entries);
  const fiberBand = getFiberDesiredBandG(entries);
  const fatBand = getFatDesiredBandG(entries);
  const carbBand = getCarbDesiredBandG(entries);
  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
  const bodyMassKg = latestBodyMassKg(entries);
  // Minutes when time is what's pinned; rises with a lighter body mass when calorie burn
  // is pinned instead — see getActivityDesiredMin.
  const activityDesired = Math.round(getActivityDesiredMin(bodyMassKg));

  // Protein is the one metric judged against a RANGE, and the one where overshooting
  // still counts as a hit — see withinProteinBand and the chart's PROTEIN_OVER_BAND_COLOR.
  const proteinInBand = protein !== null && withinProteinBand(protein, proteinBand);
  const proteinOverBand = protein !== null && protein > proteinBand.max;

  // Same in-band/over-band split as protein — see withinFiberBand/getFiberDesiredBandG.
  const fiberInBand = fiber !== null && withinFiberBand(fiber, fiberBand);
  const fiberOverBand = fiber !== null && fiber > fiberBand.max;

  // Same shape again — see withinFatBand/getFatDesiredBandG and the chart's
  // FAT_OVER_BAND_COLOR.
  const fatInBand = fat !== null && withinFatBand(fat, fatBand);
  const fatOverBand = fat !== null && fat > fatBand.max;

  // Carbohydrate reads the other way round (see renderHealthCarbChart): under the
  // floor isn't a miss, just unscored, so that case gets the chart's own gray instead
  // of either fixed colour.
  const carbInBand = carb !== null && withinCarbBand(carb, carbBand);
  const carbOverBand = carb !== null && carb > carbBand.max;
  const carbUnderBand = carb !== null && !carbInBand && !carbOverBand;

  // Actual burn, same per-entry rule the Activity/Calorie Balance charts and Insight use
  // (a Calculate-derived amount2 wins, else minutes at the Walk MET, activityMet) — so this figure can't
  // disagree with theirs for today.
  const activityEntriesToday = todayEntries.filter((e) => e.category === 'Activity' || e.category === 'Activity; Calories');
  const activityKcal = activityEntriesToday.length
    ? Math.round(activityEntriesToday.reduce((sum, e) => sum + activityEntryKcal(e, bodyMassKg), 0))
    : null;
  // What hitting the desired minutes would burn — pinned flat if calorie burn is what's
  // pinned, else via the same rate the desired intake is built from, so the two can't
  // quote different numbers for one day.
  const activityDesiredKcal = Math.round(getActivityDesiredKcal(bodyMassKg));

  // Same three buckets the Physical Activity chart stacks by (Activity sheet's own
  // Category column, physiqueActivityByCategory) — matched by prefix rather than an exact
  // string, since a sheet can use "Strength" or "Strength Training" for the same bucket.
  // Purely informational: no desired figure to score against, so no green/red here.
  const activityCategoryLine = (prefix) => {
    const matches = activityEntriesToday.filter((e) => e.description?.toLowerCase().startsWith(prefix));
    if (!matches.length) return '0 min (0 kcal)';
    const mins = Math.round(matches.reduce((sum, e) => sum + toActivityMinutes(e.amount, e.unit), 0));
    const kcal = Math.round(matches.reduce((sum, e) => sum + activityEntryKcal(e, bodyMassKg), 0));
    return `${mins} min (${kcal > 0 ? '-' : ''}${kcal} kcal)`;
  };
  ['cardio', 'neat', 'strength'].forEach((prefix) => {
    const text = activityCategoryLine(prefix);
    document.getElementById(`today-activity-${prefix}-value`).textContent = privacyMode ? maskDigits(text) : text;
  });

  setStatusEnergyTile(entries, calories, activityKcal, tefKcalToday, sleepHours);
  // The macro tiles show a whole-gram figure — floored, not rounded, so the readout never
  // claims a gram that isn't fully there. Band colouring above stays on the true value.
  const floorG = (g) => (g !== null ? Math.floor(g) : null);
  setTodayGlanceTile('today-protein', floorG(protein), formatProteinDesiredBand(proteinBand), 'g', proteinInBand || proteinOverBand ? 'income' : 'expense');
  setTodayGlanceTile('today-fiber', floorG(fiber), formatProteinDesiredBand(fiberBand), 'g', fiberInBand || fiberOverBand ? 'income' : 'expense');
  setTodayGlanceTile('today-fat', floorG(fat), formatProteinDesiredBand(fatBand), 'g', fatInBand || fatOverBand ? 'income' : 'expense');
  setTodayGlanceTile('today-carb', floorG(carb), formatProteinDesiredBand(carbBand), 'g', carbInBand ? 'income' : (carbUnderBand ? 'neutral' : 'expense'));
  setTodayGlanceTile('today-sleep-duration', sleepHours, sleepDesired, 'hr', sleepHours !== null && sleepHours >= sleepDesired ? 'income' : 'expense');
  const windowText = sleepBedMin !== null && sleepWakeMin !== null
    ? `${formatClockTime24(sleepBedMin)}-${formatClockTime24(sleepWakeMin)}`
    : '—';
  document.getElementById('today-sleep-window-value').textContent = privacyMode ? maskDigits(windowText) : windowText;
}

// The Status card is a single energy-budget ledger for today, read top to bottom:
// Maintenance and the Sleep Deprivation Effect on one side, Intake on the other,
// Digestion and Activity the two expenditures between them, all summing to Balance
// — the same dailyEnergyBalanceKcal the Calorie Balance chart plots, just for today
// alone so the two can't disagree. Each row lives ONLY here: the Intake Macros /
// Physical Activity / Sleep cards no longer carry mirror copies.
function setStatusEnergyTile(entries, caloriesToday, activityKcalToday, tefKcalToday, sleepHoursToday) {
  const heightCm = getSetting('HEIGHT_CM', null);
  // m, m_avg, BMI and m_d as stored in today's Derived cell (health-physique.js), read rather
  // than worked out; only a day saved before the column existed falls back to them.
  const stored = storedMassAsOf(isoFromDate(new Date()));
  const bodyMassKg = stored?.m ?? latestBodyMassKg(entries);
  const isCut = getCalorieDesiredKind(entries) === 'max';

  // m — the latest raw body-mass reading (bodyMassKg, already computed above), against the same
  // healthy body mass BMI uses. Shown for comparison only, same as the Formula
  // Tune's read-only m row: water and glycogen move this one day to day, which is
  // exactly why every plan figure below reads m̄ instead.
  const healthyMassKg = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  // m̄, the L_p-day rolling average every plan figure reads; BMI below reads it too.
  const mBar = stored?.m_avg ?? planBodyMassKg(entries);
  // The glycogen/water swing at the latest reading, beside the healthy mass (as on the
  // Progress card): a reading within it of the healthy mass is water, not a miss.
  const swingKg = glycogenSwingKg(bodyMassKg, heightCm, getSettingString('SEX', null));
  const swingText = swingKg === null ? '' : ` ± ${Math.round(swingKg * 10) / 10}`;
  // One line for both: today's reading, the rolling average in brackets, the healthy mass.
  const mEl = document.getElementById('today-status-m-value');
  mEl.classList.remove('income', 'expense');
  const averageText = mBar !== null ? ` (${mBar})` : '';
  const mText = bodyMassKg !== null ? `${bodyMassKg}${averageText} / ${healthyMassKg}${swingText} kg` : '—';
  mEl.textContent = privacyMode ? maskDigits(mText) : mText;
  if (bodyMassKg !== null) {
    const mGood = bodyMassHealthyIsDownward(entries) ? bodyMassKg <= healthyMassKg : bodyMassKg >= healthyMassKg;
    mEl.classList.add(mGood ? 'income' : 'expense');
  }

  // BMI — m̄ against the healthy body mass, rescaled by height (computeBmi is a fixed
  // linear rescale of mass, so "good" follows the healthy mass's direction). Needs
  // only height, so it survives a profile missing birth date or sex.
  const bmiEl = document.getElementById('today-status-bmi-value');
  bmiEl.classList.remove('income', 'expense');
  const bmi = stored?.BMI ?? (mBar !== null && heightCm !== null ? computeBmi(mBar, heightCm) : null);
  const healthyBmi = heightCm !== null ? computeBmi(healthyMassKg, heightCm) : null;
  const bmiText = bmi !== null && healthyBmi !== null ? `${bmi} / ${healthyBmi} kg/m²` : '—';
  bmiEl.textContent = privacyMode ? maskDigits(bmiText) : bmiText;
  if (bmi !== null && healthyBmi !== null) {
    const bmiGood = bodyMassHealthyIsDownward(entries) ? bmi <= healthyBmi : bmi >= healthyBmi;
    bmiEl.classList.add(bmiGood ? 'income' : 'expense');
  }

  // Δm (Changed Mass) — the Body Mass chart's figure for the latest body-mass reading: the slope of
  // the same smoothed trend (computeBodyMassTrend over every reading), in g/day. Green when
  // it moves toward the healthy mass, red when away.
  const changedEl = document.getElementById('today-status-changed-mass-value');
  changedEl.classList.remove('income', 'expense');
  let changedGPerDay = massChangeGPerDay(stored);
  if (changedGPerDay === null) {
    const trendMap = computeBodyMassTrend(bodyMassByDateMap(
      entries.filter((e) => e.category === 'Body Mass' && e.amount !== null),
    ));
    const trendDates = [...trendMap.keys()].sort();
    changedGPerDay = trendDates.length
      ? computeBodyMassTrendSlopeGramsPerDay(trendMap).get(trendDates[trendDates.length - 1]) ?? null
      : null;
  }
  // Against the desired rate: Tune's weekly fat loss Δm as g/day, signed the way the
  // Δm′ row below signs it (a loss is negative), so the pair compare directly.
  const desiredWeeklyLossKg = weeklyFatLossKgAt(planBodyMassKg(entries));
  const desiredGPerDay = desiredWeeklyLossKg !== null ? Math.round((-desiredWeeklyLossKg / 7) * 1000) : null;
  const changedText = changedGPerDay !== null
    ? `${withExplicitSign(changedGPerDay)}${desiredGPerDay !== null ? ` / ${withExplicitSign(desiredGPerDay)}` : ''} g/day`
    : '—';
  changedEl.textContent = privacyMode ? maskDigits(changedText) : changedText;
  if (changedGPerDay !== null && changedGPerDay !== 0) {
    const changedGood = bodyMassHealthyIsDownward(entries) ? changedGPerDay < 0 : changedGPerDay > 0;
    changedEl.classList.add(changedGood ? 'income' : 'expense');
  }

  // Intake — the one positive contribution to Balance, shown against desired intake
  // (a cut wants intake under the cap, a bulk over the floor; the color carries
  // that sense, not the separator).
  const calDesired = getCalorieDesired(entries);
  const intakeEl = document.getElementById('today-status-intake-value');
  intakeEl.classList.remove('income', 'expense');
  const intakeText = caloriesToday !== null
    ? `${Math.round(caloriesToday)} / ${calDesired.kcal} kcal`
    : '—';
  intakeEl.textContent = privacyMode ? maskDigits(intakeText) : intakeText;
  if (caloriesToday !== null) intakeEl.classList.add(withinCalorieDesired(caloriesToday, calDesired) ? 'income' : 'expense');

  // Activity — a burn, signed negative. No activity logged today reads as 0 (the
  // same "0 kcal burned so far, not unknown" rule the Cardio/NEAT/Strength lines
  // use), not a dash.
  const actDesiredKcal = Math.round(getActivityDesiredKcal(bodyMassKg));
  const activityKcalSoFar = activityKcalToday ?? 0;
  const actText = `${activityKcalSoFar > 0 ? '-' : ''}${activityKcalSoFar} / -${actDesiredKcal} kcal`;
  const activityEl = document.getElementById('today-status-activity-value');
  activityEl.classList.remove('income', 'expense');
  activityEl.textContent = privacyMode ? maskDigits(actText) : actText;
  activityEl.classList.add(activityKcalSoFar >= actDesiredKcal ? 'income' : 'expense');

  // Digestion (TEF) — the other expenditure, measured if we have a figure else the
  // non-TEF share of intake, shown against its own desired figure.
  const digKcal = tefKcalToday !== null
    ? Math.round(tefKcalToday)
    : (caloriesToday !== null ? Math.round(caloriesToday * (1 - tefDivisor())) : null);
  const digDesired = Math.round(calDesired.kcal * (1 - tefDivisor()));
  const digText = digKcal !== null ? `${-digKcal} / ${-digDesired} kcal` : '—';
  document.getElementById('today-status-digestion-value').textContent = privacyMode ? maskDigits(digText) : digText;

  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);

  let balanceKcal = null;
  let deprivationKcal = null;
  // BMR — always plain, regardless of the Tune's "Basal metabolic rate
  // basis" setting. λt and BMR_adp below are the reference discount and its result;
  // Balance/Δm are measured against whichever the setting actually selected
  // (applyBmrBasis, health-math.js), not necessarily this plain figure.
  //
  // All three read today's stored Derived cell (Physique's Derived column; the latest
  // earlier row when today has none yet), not a fresh calculation.
  const todayBmrFigures = bmrFiguresForDate(isoFromDate(new Date()));
  let maintenanceKcal = null;
  if (caloriesToday !== null && pickBmrForBasis(todayBmrFigures, 'bmr') !== null) {
    maintenanceKcal = pickBmrForBasis(todayBmrFigures, 'bmr');
    const effectiveMaintenanceKcal = pickBmrForBasis(todayBmrFigures);
    const activity = activityKcalToday ?? 0;
    const tef = tefKcalToday !== null
      ? Math.round(tefKcalToday)
      : Math.round(caloriesToday * (1 - tefDivisor()));
    ({ deprivationKcal, balance: balanceKcal } = dailyEnergyBalanceKcal(
      Math.round(caloriesToday), effectiveMaintenanceKcal, activity, tef, sleepHoursToday, sleepDesired,
    ));
  }

  // BMR_mif and BMR_kat rows: both stored equations as signed expenditures, whichever
  // one Tune has selected.
  ['mif', 'kat'].forEach((key) => {
    const value = todayBmrFigures[`BMR_${key}`];
    const text = maintenanceKcal !== null && value !== undefined ? `${-value} kcal` : '—';
    document.getElementById(`today-status-bmr-${key}-value`).textContent = privacyMode ? maskDigits(text) : text;
  });

  // BMR_adp — always shown regardless of which basis Balance/Δm actually run on, so all
  // three can be compared here at once. The stored BMR × (1 − λt) for today.
  const bmrAdaptEl = document.getElementById('today-status-bmr-adapt-value');
  const bmrAdaptText = (maintenanceKcal !== null && todayBmrFigures.BMR_adp !== undefined)
    ? `${-todayBmrFigures.BMR_adp} kcal`
    : '—';
  bmrAdaptEl.textContent = privacyMode ? maskDigits(bmrAdaptText) : bmrAdaptText;

  // BMR_cal — same "always shown regardless of basis" idea. Hidden entirely (not just
  // dashed) until today's stored figures carry one: the rolling n_p × L_p calibration,
  // absent in the first n_p × L_p days of data.
  const bmrCalRow = document.getElementById('today-status-bmr-cal-row');
  const bmrCalEl = document.getElementById('today-status-bmr-cal-value');
  if (todayBmrFigures.BMR_cal !== undefined && maintenanceKcal !== null) {
    bmrCalRow.hidden = false;
    const bmrCalText = `${-todayBmrFigures.BMR_cal} kcal`;
    bmrCalEl.textContent = privacyMode ? maskDigits(bmrCalText) : bmrCalText;
  } else {
    bmrCalRow.hidden = true;
  }

  // Deprivation — the Sleep Deprivation Effect as a signed addition to Balance,
  // against a desired figure of 0 (a full night costs nothing).
  const deprivationEl = document.getElementById('today-status-deprivation-value');
  const deprivationText = deprivationKcal !== null ? `${deprivationKcal} / 0 kcal` : '—';
  deprivationEl.textContent = privacyMode ? maskDigits(deprivationText) : deprivationText;
  deprivationEl.classList.remove('income', 'expense');
  if (deprivationKcal !== null) deprivationEl.classList.add(deprivationKcal > 0 ? 'expense' : 'income');

  const balanceEl = document.getElementById('today-status-balance-value');
  balanceEl.classList.remove('income', 'expense');
  const balanceDesiredKcal = desiredBalanceKcal(planBodyMassKg(entries));
  const balanceText = balanceKcal !== null
    ? `${balanceKcal}${balanceDesiredKcal !== null ? ` / ${balanceDesiredKcal}` : ''} kcal`
    : '—';
  balanceEl.textContent = privacyMode ? maskDigits(balanceText) : balanceText;
  if (balanceKcal !== null) {
    const balanceGood = balanceDesiredKcal !== null
      ? (isCut ? balanceKcal <= balanceDesiredKcal : balanceKcal >= balanceDesiredKcal)
      : (isCut ? balanceKcal < 0 : balanceKcal > 0);
    balanceEl.classList.add(balanceGood ? 'income' : 'expense');
  }

  // Δm — the daily body-mass change today's Balance implies (Balance ÷ ~7700 kcal/kg, the
  // fat-equivalent GENERIC_KCAL_PER_KG_FAT), shown against the plan's own expected fat-loss
  // rate (WEEKLY_FAT_LOSS_KG spread over 7 days). Both are signed mass changes (negative =
  // losing), so WEEKLY_FAT_LOSS_KG — stored positive for a cut — is negated here the same
  // way desiredBalanceKcal negates it for D, its own desired deficit.
  const dmActual = balanceKcal !== null ? Math.round((balanceKcal / GENERIC_KCAL_PER_KG_FAT) * 1000) : null;
  const weeklyFatLossKg = weeklyFatLossKgAt(planBodyMassKg(entries));
  const dmDesired = weeklyFatLossKg !== null ? Math.round((-weeklyFatLossKg / 7) * 1000) : null;
  const dmText = dmActual !== null
    ? `${dmActual}${dmDesired !== null ? ` / ${dmDesired}` : ''} g`
    : '—';
  document.getElementById('today-status-deltam-value').textContent = privacyMode ? maskDigits(dmText) : dmText;
}

// `desired` is a number, or a preformatted string for Protein's band — both interpolate
// and mask alike. `tone` is the value's colour class: 'income', 'expense' or 'neutral'.
function setTodayGlanceTile(idPrefix, value, desired, unit, tone) {
  const el = document.getElementById(`${idPrefix}-value`);
  el.classList.remove('income', 'expense', 'neutral');

  const text = `${value !== null ? value : '—'} / ${desired} ${unit}`;
  el.textContent = privacyMode ? maskDigits(text) : text;
  if (value !== null) el.classList.add(tone);
}

// lastNDates clipped to the earliest matching entry, so a short logging history isn't
// pushed to the right behind a run of empty days.
// The one window the whole Health Chart panel plots, bar State Trend & Forecast:
// whatever the From/To pair above Body Mass holds, else the HEALTH_METRICS_DAYS
// default. Protein Source Rotation reads it too — it wants the two ends rather than
// every day between them, which is why this returns the range and not the date list.
//
// Read straight off the inputs rather than from state initDateRangeControl hands back,
// so it can't matter whether a chart renders before or after that wiring runs — an
// unfilled pair simply reads as "use the default", which is what it means.
// From/To inputs retired for the range buttons below.
// function healthDateRange() {
//   const from = document.getElementById('health-date-from').value;
//   const to = document.getElementById('health-date-to').value;
//   if (from && to) return { from, to };
//
//   const fallback = lastNDates(HEALTH_METRICS_DAYS);
//   return { from: fallback[0], to: fallback[fallback.length - 1] };
// }

// Fixed lengths ending today, Market's notation (rangeStartDate, finance-market-chart.js).
// Shared by Chart and Insight.
const HEALTH_RANGES = [
  { slug: '1w', label: '1w', days: 7 },
  { slug: '1m', label: '1m', months: 1 },
  { slug: '3m', label: '3m', months: 3 },
  { slug: '6m', label: '6m', months: 6 },
  { slug: '1y', label: '1y', months: 12 },
  { slug: '5y', label: '5y', months: 60 },
  { slug: 'all', label: 'All' },
];
let healthRangeSlug = '1m';

// {from, to} for a range slug; All starts at the first logged Physique day.
function healthRangeDates(slug) {
  const range = HEALTH_RANGES.find((r) => r.slug === slug);
  const to = localIso();
  let from = rangeStartDate(range);
  if (!from) {
    const dates = physiqueAsHealthEntries().map((e) => e.date).filter(Boolean).sort();
    from = dates[0] || lastNDates(HEALTH_METRICS_DAYS)[0];
  }
  return { from, to };
}

function healthDateRange() {
  return healthRangeDates(healthRangeSlug);
}

// One control for the panel. Every chart under State Trend & Forecast redraws on a
// change, Protein Source Rotation and Activity Rotation included.
function initHealthRangeControl() {
  // initDateRangeControl('health-date-from', 'health-date-to', HEALTH_METRICS_DAYS, () => { … });
  const pick = (slug) => {
    healthRangeSlug = slug;
    renderRangeButtons('health-range', HEALTH_RANGES, healthRangeSlug, pick);
    renderHealthCharts(physiqueAsHealthEntries());
    renderProteinRotationChart(healthDateRange());
    renderActivityRotationChart(healthDateRange());
  };
  renderRangeButtons('health-range', HEALTH_RANGES, healthRangeSlug, pick);
}

// The date list built from that range, clipped to what this particular metric has
// logged.
function healthWindowDates(matchingEntries) {
  const { from, to } = healthDateRange();
  const window = datesInRange(from, to);

  // Clipped forward to the first day this metric has anything logged, so a chart doesn't
  // open on a run of empty days it never had data for. An inverted range gives no days,
  // and every caller already reads an empty window as "nothing to draw".
  if (!window.length || matchingEntries.length === 0) return window;
  const earliest = matchingEntries.reduce((min, e) => (e.date < min ? e.date : min), matchingEntries[0].date);
  const start = earliest > window[0] ? earliest : window[0];
  return window.filter((d) => d >= start);
}

// The Calories/Calories; Protein rows the Caloric Intake chart is built from.
function calorieLogEntries(entries) {
  return entries.filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null);
}

// The one x-axis every dated Health chart plots on, from the first calorie log or
// body-mass reading in range, so their gridlines land on the same dates.
function healthCalorieChartDates(entries) {
  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  return healthWindowDates([...calorieLogEntries(entries), ...bodyMassEntries]);
}

// Down on a cut, up on a bulk. Via getCalorieDesiredKind rather than re-reading
// BODY_MASS_HEALTHY_KG, so this chart's green and Caloric Intake's max/min come from one read
// of the healthy mass, fallbacks included.
function bodyMassHealthyIsDownward(entries) {
  return getCalorieDesiredKind(entries) === 'max';
}

// Boer 1984 (Am J Physiol 247:F632): lean body mass (kg) from mass, height and sex —
// the LBM equation clinical dosing uses, and the one that validates closest to DEXA in
// a general population. Deliberately NOT m × (1 − bodyFat%) off the Deurenberg estimate
// above: that route squares a BMI-only approximation, and Boer was regressed against
// measured lean mass directly. Age doesn't enter it.
//
// Split into its coefficients rather than written as two expressions because Katch-McArdle
// BMR is 21.6 × this: maintenance stays affine in body mass under that equation too, and
// maintenanceAffineCoefficients needs the per-kg and mass-independent halves separately to
// say so. One copy of the numbers, two things read off them.
const BOER_LBM_COEFFICIENTS = {
  male: { perKg: 0.407, perCm: 0.267, constant: -19.2 },
  female: { perKg: 0.252, perCm: 0.473, constant: -48.3 },
};

function boerLeanBodyMassCoefficients(sex) {
  return sex === 'male' ? BOER_LBM_COEFFICIENTS.male : BOER_LBM_COEFFICIENTS.female;
}

function boerLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  const c = boerLeanBodyMassCoefficients(sex);
  return c.perKg * bodyMassKg + c.perCm * heightCm + c.constant;
}

// U.S. Navy body-fat %, Hodgdon & Beckett (1984), all in cm. Null when a log would be invalid.
function navyBodyFatPct(sex, heightCm, neckCm, waistCm, hipCm) {
  if (heightCm == null || neckCm == null || waistCm == null || (sex !== 'male' && hipCm == null)) return null;
  const girth = sex === 'male' ? waistCm - neckCm : waistCm + hipCm - neckCm;
  if (!(girth > 0) || !(heightCm > 0)) return null;
  const density = sex === 'male'
    ? 1.0324 - 0.19077 * Math.log10(girth) + 0.15456 * Math.log10(heightCm)
    : 1.29579 - 0.35004 * Math.log10(girth) + 0.22100 * Math.log10(heightCm);
  return 495 / density - 450;
}

// Which LBM the app runs on (Tune's Lean body mass choice): Boer, or U.S. Navy.
const LBM_FORMULA_KEY = 'LBM_FORMULA';

function lbmFormula() {
  return getSettingString(LBM_FORMULA_KEY, 'boer') === 'navy' ? 'navy' : 'boer';
}

// BF% off the saved girths, rounded as Tune's box shows it; null until they're saved.
function savedNavyBodyFatPct(heightCm, sex) {
  const pct = navyBodyFatPct(sex, heightCm, getSetting('NECK_CM', null), getSetting('WAIST_CM', null), getSetting('HIP_CM', null));
  return pct === null || !Number.isFinite(pct) ? null : Math.round(pct * 10) / 10;
}

// Both are affine in m (Navy's BF% doesn't depend on mass), so Katch stays affine either way.
// Navy falls back to Boer until its girths are on file.
function leanBodyMassCoefficients(sex, heightCm) {
  if (lbmFormula() === 'navy') {
    const bfPct = savedNavyBodyFatPct(heightCm, sex);
    if (bfPct !== null) return { perKg: 1 - bfPct / 100, perCm: 0, constant: 0, formula: 'navy', bfPct };
  }
  return { ...boerLeanBodyMassCoefficients(sex), formula: 'boer' };
}

function leanBodyMassKg(bodyMassKg, heightCm, sex) {
  const c = leanBodyMassCoefficients(sex, heightCm);
  return c.perKg * bodyMassKg + c.perCm * heightCm + c.constant;
}

// The same four knobs the Tune's glycogen block opens on (s, g_musc,
// g_liver, r) — defaults here match its input boxes, so a State Trend reader who never
// opens that modal still gets the same swing it would report for their own body.
const GLYCOGEN_SKELETAL_FRAC_DEFAULT = 45; // % of LBM
const GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT = 14; // g glycogen / kg muscle
const GLYCOGEN_LIVER_G_DEFAULT = 100; // g
const GLYCOGEN_WATER_RATIO_DEFAULT = 3; // g H2O / g glycogen

// ΔM_gly = g_musc × m_musc + g_liver, water-bound at r, in kg — the same identity the
// Tune's glycogen block walks through (see its readGlycogenSwingFormula),
// evaluated at the defaults rather than whatever's currently typed there. This is the
// day-to-day swing glycogen and its bound water alone can account for, at this body —
// the noise floor State Trend & Forecast measures its smoothing against.
// The swing every display uses (Status, Progress, the charts, the arrival mass):
// the GLYCOGEN_SWING_KG setting, saved once and changed only by Tune's Save or by
// editing it. It moves ~10 g per kg of body mass, so it barely changes; before it's
// saved, it's worked out from the given body (computeGlycogenSwingKg).
const GLYCOGEN_SWING_KEY = 'GLYCOGEN_SWING_KG';

function glycogenSwingKg(bodyMassKg, heightCm, sex) {
  const saved = getSetting(GLYCOGEN_SWING_KEY, null);
  if (saved !== null && Number.isFinite(saved) && saved > 0) return saved;
  return computeGlycogenSwingKg(bodyMassKg, heightCm, sex);
}

// Saves the swing once, at the latest body-mass reading, when the setting doesn't exist yet
// (app.js, after Physique loads), so it's read rather than worked out from then on.
async function seedGlycogenSwingSetting() {
  if (getSetting(GLYCOGEN_SWING_KEY, null) !== null) return;
  const entries = physiqueAsHealthEntries();
  const swing = computeGlycogenSwingKg(latestBodyMassKg(entries), getSetting('HEIGHT_CM', null), getSettingString('SEX', null));
  if (swing === null) return;
  await saveSettingValues({ [GLYCOGEN_SWING_KEY]: Math.round(swing * 10) / 10 });
}

function computeGlycogenSwingKg(bodyMassKg, heightCm, sex) {
  if (bodyMassKg === null || bodyMassKg === undefined || heightCm === null || heightCm === undefined) return null;
  const lbmKg = leanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(lbmKg) || lbmKg <= 0) return null;
  const muscleKg = lbmKg * (GLYCOGEN_SKELETAL_FRAC_DEFAULT / 100);
  if (muscleKg <= 0) return null;
  const glycogenG = GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT * muscleKg + GLYCOGEN_LIVER_G_DEFAULT;
  return (glycogenG * (1 + GLYCOGEN_WATER_RATIO_DEFAULT)) / 1000;
}

// The mass actually used to decide "have I arrived" — past the raw healthy mass by the
// glycogen/water swing, in the direction travel is already headed, so a bad-water-day
// reading can't land on the wrong side of the real healthy mass. Shared by calcProjection and
// the Tune so both count arrival the same way and can't disagree. Falls
// back to the raw healthy mass when the swing can't be estimated (no height/sex on file).
function arrivalHealthyKg(healthyKg, bodyMassKg, heightCm, sex, isDownward) {
  const swingKg = glycogenSwingKg(bodyMassKg, heightCm, sex);
  return swingKg === null ? healthyKg : healthyKg + (isDownward ? -swingKg : swingKg);
}

// Step candidates for macro gram axes; same max-gridlines guard as the kg axis.
const MACRO_G_TICK_STEPS = [5, 10, 25, 50, 100, 200, 500, 1000];
function lerpHex(hexA, hexB, t) {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${rgb.join(',')})`;
}

// Steps and timed entries onto one comparable scale. ~100 steps/min is walking
// pace; WORKOUT_STEPS_PER_MIN overrides it for a longer or shorter stride, and
// applies everywhere at once — this chart, desired activity, and the workout
// estimator's own duration (activeSecondsForNoteLine, health-activity-estimator.js).
// The default lives here rather than beside WORKOUT_REP_SEC_DEFAULT because
// this file loads first: a const in the later file would still be in its dead
// zone. Nothing there needs it anyway — the estimator calls this function.
const WORKOUT_STEPS_PER_MIN_DEFAULT = 100;

function toActivityMinutes(amount, unit) {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'steps' || u === 'step') {
    return Math.round(amount / getSetting('WORKOUT_STEPS_PER_MIN', WORKOUT_STEPS_PER_MIN_DEFAULT));
  }
  if (u === 'hr' || u === 'hour' || u === 'hours') return Math.round(amount * 60);
  return amount; // 'min' or unknown — use as-is
}

// bodyMassKg / heightM². Computed, never asked of an LLM, and shared by the BMI line, the
// Body Mass tooltip and health-insight-wellness.js.
function computeBmi(bodyMassKg, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((bodyMassKg / (heightM * heightM)) * 10) / 10;
}

// The inverse — the body mass a BMI implies at this height. Only one place needs it, the
// Tune's healthy-BMI box, but it lives here beside computeBmi so the pair can't
// drift apart the way two copies of one rearrangement eventually do.
function bodyMassKgFromBmi(bmi, heightCm) {
  const heightM = heightCm / 100;
  return Math.round(bmi * heightM * heightM * 10) / 10;
}

// The WHO bands, for the one place a BMI is a GOAL rather than a reading: a healthy body mass
// is a number you choose, and the whole reason to show its BMI is to say whether the choice
// lands somewhere sensible. Both ends matter here, unlike the fat-loss band where only the
// ceiling is a warning — an underweight choice is as much a problem as an obese one.
const BMI_HEALTHY_MIN = 18.5;
const BMI_HEALTHY_MAX = 24.9;

function bmiVerdict(bmi) {
  if (bmi < 16) return { text: 'severely underweight', outside: true };
  if (bmi < BMI_HEALTHY_MIN) return { text: 'underweight', outside: true };
  if (bmi <= BMI_HEALTHY_MAX) return { text: `in the healthy ${BMI_HEALTHY_MIN}–${BMI_HEALTHY_MAX} band`, outside: false };
  if (bmi < 30) return { text: 'overweight', outside: true };
  if (bmi < 35) return { text: 'obese (class I)', outside: true };
  return { text: 'obese (class II+)', outside: true };
}

// The most recent body-mass reading on or before each date, carried forward — a BMR is needed
// for every day in the window, not just the days a body-mass reading lands on. Days before the
// first reading fall back to it rather than dropping off the chart.
function carryForwardBodyMassByDate(bodyMassByDate, dates) {
  const weighInDates = [...bodyMassByDate.keys()].sort();
  if (weighInDates.length === 0) return new Map();

  const carried = new Map();
  let next = 0;
  let current = bodyMassByDate.get(weighInDates[0]);
  dates.forEach((date) => {
    while (next < weighInDates.length && weighInDates[next] <= date) {
      current = bodyMassByDate.get(weighInDates[next]);
      next += 1;
    }
    carried.set(date, current);
  });
  return carried;
}

// The sign carries the whole meaning here — deficit vs surplus — so a positive figure
// shows its + rather than going bare.
function withExplicitSign(value) {
  return value > 0 ? `+${value}` : String(value);
}

// The daily deficit the weekly rate implies — the Tune's D, from the same
// fat-density constant so the two can't disagree. Already signed to this chart's
// convention. Null at zero or unset, since a line on zero would retrace the axis.
//
// Takes a body mass because a pinned percentage makes the rate depend on it; unpinned the
// argument is ignored and this is the flat WEEKLY_FAT_LOSS_KG it always was.
//
// Routed through calorieDesiredDetail (which now folds in PLAN_SLEEP_HOURS — see
// sleepAdjustedDeficitKcal in health-math.js) whenever a full profile is on file, so this
// chart's own dash and the Sleep chart's dot can't quote a smaller desired deficit than the
// real Eᵢₙ was actually built from. Falls back to the un-adjusted rate with no profile,
// same as calorieDesiredDetail's own callers do.
function desiredBalanceKcal(bodyMassKg) {
  const detail = calorieDesiredDetail(bodyMassKg);
  if (detail !== null) return -Math.round(detail.deficit);
  const weeklyKg = weeklyFatLossKgAt(bodyMassKg);
  if (weeklyKg === null || weeklyKg === 0) return null;
  return -Math.round((weeklyKg * GENERIC_KCAL_PER_KG_FAT) / 7);
}

// One body mass per logged date, same averaging as renderHealthProjectionChart's.
function bodyMassByDateMap(bodyMassEntries) {
  const sums = new Map();
  bodyMassEntries.forEach((e) => {
    const cur = sums.get(e.date) || { sum: 0, count: 0 };
    cur.sum += e.amount;
    cur.count += 1;
    sums.set(e.date, cur);
  });
  return new Map([...sums].map(([date, { sum, count }]) => [date, sum / count]));
}
