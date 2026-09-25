
// The window every Health Indicators chart plots, when the From/To pair above Body Mass
// hasn't been filled in yet: the last 4 weeks. Body Mass appears here as well as in
// State Trend & Forecast without duplicating it — that one is the trajectory over the
// whole history and ignores this window, this one scores each day's move toward the
// target or away from it.
const WELLNESS_METRICS_DAYS = 28;

let wellnessCaloriesChart = null;
let wellnessSleepChart = null;
let wellnessActivityChart = null;
let wellnessProteinChart = null;
let wellnessFiberChart = null;
let wellnessFatChart = null;
let wellnessCarbChart = null;
let wellnessProjectionChart = null;

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

function renderWellnessCharts(entries) {
  renderTodayGlanceCards(entries);
  renderWellnessBodyMassChart(entries);
  renderWellnessCaloriesChart(entries);
  renderWellnessProteinChart(entries);
  renderWellnessFiberChart(entries);
  renderWellnessFatChart(entries);
  renderWellnessCarbChart(entries);
  renderWellnessActivityChart(entries);
  renderWellnessSleepChart(entries);
  renderWellnessProjectionChart(entries);
  renderWellnessEnergyBalanceChart(entries);
}

// The charts answer "how's the trend", not "am I on track right now" — these tiles give
// today's actual-vs-target for every Health Indicator metric without reading the
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

  const calorieTarget = getCalorieTarget(entries);
  const proteinBand = getProteinTargetBandG(entries);
  const fiberBand = getFiberTargetBandG(entries);
  const fatBand = getFatTargetBandG(entries);
  const carbBand = getCarbTargetBandG(entries);
  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);
  const bodyMassKg = latestBodyMassKg(entries);
  // Minutes when time is what's pinned; rises with a lighter body mass when calorie burn
  // is pinned instead — see getActivityTargetMin.
  const activityTarget = Math.round(getActivityTargetMin(bodyMassKg));

  // Protein is the one metric judged against a RANGE, and the one where overshooting
  // still counts as a hit — see withinProteinBand and the chart's PROTEIN_OVER_BAND_COLOR.
  const proteinInBand = protein !== null && withinProteinBand(protein, proteinBand);
  const proteinOverBand = protein !== null && protein > proteinBand.max;

  // Same in-band/over-band split as protein — see withinFiberBand/getFiberTargetBandG.
  const fiberInBand = fiber !== null && withinFiberBand(fiber, fiberBand);
  const fiberOverBand = fiber !== null && fiber > fiberBand.max;

  // Same shape again — see withinFatBand/getFatTargetBandG and the chart's
  // FAT_OVER_BAND_COLOR.
  const fatInBand = fat !== null && withinFatBand(fat, fatBand);
  const fatOverBand = fat !== null && fat > fatBand.max;

  // Carbohydrate reads the other way round (see renderWellnessCarbChart): under the
  // floor isn't a miss, just unscored, so that case gets the chart's own gray instead
  // of either fixed colour.
  const carbInBand = carb !== null && withinCarbBand(carb, carbBand);
  const carbOverBand = carb !== null && carb > carbBand.max;
  const carbUnderBand = carb !== null && !carbInBand && !carbOverBand;

  // Actual burn, same per-entry rule the Activity/Calorie Balance charts and Insight use
  // (a Calculate-derived amount2 wins, else minutes at ACTIVITY_MET) — so this figure can't
  // disagree with theirs for today.
  const activityEntriesToday = todayEntries.filter((e) => e.category === 'Activity' || e.category === 'Activity; Calories');
  const activityKcal = activityEntriesToday.length
    ? Math.round(activityEntriesToday.reduce((sum, e) => sum + activityEntryKcal(e, bodyMassKg), 0))
    : null;
  // What hitting the minutes target would burn — pinned flat if calorie burn is what's
  // pinned, else via the same rate the calorie target is built from, so the two can't
  // quote different numbers for one day.
  const activityTargetKcal = Math.round(getActivityTargetKcal(bodyMassKg));

  // Same three buckets the Physical Activity chart stacks by (Activity sheet's own
  // Category column, physiqueActivityByCategory) — matched by prefix rather than an exact
  // string, since a sheet can use "Strength" or "Strength Training" for the same bucket.
  // Purely informational: no target to score against, so no green/red here.
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
  setTodayGlanceTile('today-protein', floorG(protein), formatProteinTargetBand(proteinBand), 'g', proteinInBand || proteinOverBand, null, proteinOverBand);
  setTodayGlanceTile('today-fiber', floorG(fiber), formatProteinTargetBand(fiberBand), 'g', fiberInBand || fiberOverBand, null, fiberOverBand);
  setTodayGlanceTile('today-fat', floorG(fat), formatProteinTargetBand(fatBand), 'g', fatInBand || fatOverBand, null, fatOverBand);
  setTodayGlanceTile('today-carb', floorG(carb), formatProteinTargetBand(carbBand), 'g', carbInBand, null, false, carbUnderBand ? BODY_MASS_UNSCORED_COLOR : null);
  setTodayGlanceTile('today-sleep-duration', sleepHours, sleepTarget, 'hr', null, null, false, sleepHours !== null ? sleepStatusColor(sleepHours, sleepTarget) : null);
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
  const bodyMassKg = latestBodyMassKg(entries);
  const isCut = getCalorieTargetKind(entries) === 'max';

  // m — the latest raw weigh-in (bodyMassKg, already computed above), against the same
  // healthy-mass target as m̄ below. Shown for comparison only, same as the Formula
  // Playground's read-only m row: water and glycogen move this one day to day, which is
  // exactly why every plan figure below reads m̄ instead.
  const healthyMassKg = getSetting('BODY_MASS_TARGET_KG', BODY_MASS_TARGET_KG_DEFAULT);
  const mEl = document.getElementById('today-status-m-value');
  mEl.classList.remove('income', 'expense');
  const mText = bodyMassKg !== null ? `${bodyMassKg} / ${healthyMassKg} kg` : '—';
  mEl.textContent = privacyMode ? maskDigits(mText) : mText;
  if (bodyMassKg !== null) {
    const mGood = bodyMassTargetIsDownward(entries) ? bodyMassKg <= healthyMassKg : bodyMassKg >= healthyMassKg;
    mEl.classList.add(mGood ? 'income' : 'expense');
  }

  // m̄ — the 7-day rolling average body mass (planBodyMassKg / smoothedBodyMassKg), the
  // same smoothed mass every plan identity runs on, shown against the plan's healthy body
  // mass (BODY_MASS_TARGET_KG). A water-heavy morning doesn't move it the way the raw
  // weigh-in would.
  const mBar = planBodyMassKg(entries);
  const mBarEl = document.getElementById('today-status-mbar-value');
  mBarEl.classList.remove('income', 'expense');
  const mBarText = mBar !== null ? `${mBar} / ${healthyMassKg} kg` : '—';
  mBarEl.textContent = privacyMode ? maskDigits(mBarText) : mBarText;
  if (mBar !== null) {
    const mBarGood = bodyMassTargetIsDownward(entries) ? mBar <= healthyMassKg : mBar >= healthyMassKg;
    mBarEl.classList.add(mBarGood ? 'income' : 'expense');
  }

  // BMI — the same m̄/target pair as above, rescaled by height (computeBmi is a fixed
  // linear rescale of mass, so "good" tracks mBar's direction check exactly). Needs
  // only height, so it survives a profile missing birth date or sex.
  const bmiEl = document.getElementById('today-status-bmi-value');
  bmiEl.classList.remove('income', 'expense');
  const bmi = mBar !== null && heightCm !== null ? computeBmi(mBar, heightCm) : null;
  const targetBmi = heightCm !== null ? computeBmi(healthyMassKg, heightCm) : null;
  const bmiText = bmi !== null && targetBmi !== null ? `${bmi} / ${targetBmi} kg/m²` : '—';
  bmiEl.textContent = privacyMode ? maskDigits(bmiText) : bmiText;
  if (bmi !== null && targetBmi !== null) {
    const bmiGood = bodyMassTargetIsDownward(entries) ? bmi <= targetBmi : bmi >= targetBmi;
    bmiEl.classList.add(bmiGood ? 'income' : 'expense');
  }

  // Intake — the one positive contribution to Balance, shown against its target
  // (a cut wants intake under the cap, a bulk over the floor; the color carries
  // that sense, not the separator).
  const calTarget = getCalorieTarget(entries);
  const intakeEl = document.getElementById('today-status-intake-value');
  intakeEl.classList.remove('income', 'expense');
  const intakeText = caloriesToday !== null
    ? `${Math.round(caloriesToday)} / ${calTarget.kcal} kcal`
    : '—';
  intakeEl.textContent = privacyMode ? maskDigits(intakeText) : intakeText;
  if (caloriesToday !== null) intakeEl.classList.add(withinCalorieTarget(caloriesToday, calTarget) ? 'income' : 'expense');

  // Activity — a burn, signed negative. No activity logged today reads as 0 (the
  // same "0 kcal burned so far, not unknown" rule the Cardio/NEAT/Strength lines
  // use), not a dash.
  const actTargetKcal = Math.round(getActivityTargetKcal(bodyMassKg));
  const activityKcalSoFar = activityKcalToday ?? 0;
  const actText = `${activityKcalSoFar > 0 ? '-' : ''}${activityKcalSoFar} / -${actTargetKcal} kcal`;
  const activityEl = document.getElementById('today-status-activity-value');
  activityEl.classList.remove('income', 'expense');
  activityEl.textContent = privacyMode ? maskDigits(actText) : actText;
  activityEl.classList.add(activityKcalSoFar >= actTargetKcal ? 'income' : 'expense');

  // Digestion (TEF) — the other expenditure, measured if we have a figure else the
  // non-TEF share of intake, shown against its own target.
  const digKcal = tefKcalToday !== null
    ? Math.round(tefKcalToday)
    : (caloriesToday !== null ? Math.round(caloriesToday * (1 - tefDivisor())) : null);
  const digTarget = Math.round(calTarget.kcal * (1 - tefDivisor()));
  const digText = digKcal !== null ? `${-digKcal} / ${-digTarget} kcal` : '—';
  document.getElementById('today-status-digestion-value').textContent = privacyMode ? maskDigits(digText) : digText;

  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  let balanceKcal = null;
  let deprivationKcal = null;
  // BMR — always plain, regardless of the Formula Playground's "Basal metabolic rate
  // basis" setting. λt and BMR_adp below are the reference discount and its result;
  // Balance/Δm are measured against whichever the setting actually selected
  // (applyBmrBasis, wellness-math.js), not necessarily this plain figure.
  let maintenanceKcal = null;
  if (haveProfile && caloriesToday !== null && bodyMassKg !== null) {
    maintenanceKcal = Math.round(bmrKcal(bodyMassKg, heightCm, age, sex));
    const effectiveMaintenanceKcal = Math.round(applyBmrBasis(maintenanceKcal));
    const activity = activityKcalToday ?? 0;
    const tef = tefKcalToday !== null
      ? Math.round(tefKcalToday)
      : Math.round(caloriesToday * (1 - tefDivisor()));
    ({ deprivationKcal, balance: balanceKcal } = dailyEnergyBalanceKcal(
      Math.round(caloriesToday), effectiveMaintenanceKcal, activity, tef, sleepHoursToday, sleepTarget,
    ));
  }

  // BMR row — the plain figure above as a signed expenditure, same sign convention as
  // the Calorie Balance tooltip's own BMR line.
  const maintenanceEl = document.getElementById('today-status-maintenance-value');
  const maintenanceText = maintenanceKcal !== null ? `${-maintenanceKcal} kcal` : '—';
  maintenanceEl.textContent = privacyMode ? maskDigits(maintenanceText) : maintenanceText;

  // λt and BMR_adp — always shown regardless of which basis Balance/Δm actually run on,
  // so BMR_adp reads as a plain derivation (BMR × (1 − λt)) rather than an unexplained
  // number. Days actually elapsed since the first logged weigh-in
  // (daysSinceFirstWeighIn, wellness-math.js) — the same basis applyBmrBasis itself uses.
  const adaptFracEl = document.getElementById('today-status-adapt-frac-value');
  const bmrAdaptEl = document.getElementById('today-status-bmr-adapt-value');
  let adaptFracText = '—';
  let bmrAdaptText = '—';
  if (maintenanceKcal !== null) {
    const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
    const daysOnDiet = daysSinceFirstWeighIn(bodyMassEntries);
    if (daysOnDiet !== null) {
      const adaptPctPerWeek = getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT);
      const adaptPctCap = getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT);
      const fraction = adaptationFraction(daysOnDiet, adaptPctPerWeek, adaptPctCap);
      adaptFracText = `${Math.round(fraction * 1000) / 10} %`;
      bmrAdaptText = `${-Math.round(maintenanceKcal * (1 - fraction))} kcal`;
    }
  }
  adaptFracEl.textContent = privacyMode ? maskDigits(adaptFracText) : adaptFracText;
  bmrAdaptEl.textContent = privacyMode ? maskDigits(bmrAdaptText) : bmrAdaptText;

  // Deprivation — the Sleep Deprivation Effect as a signed addition to Balance,
  // against a desired figure of 0 (a full night costs nothing).
  const deprivationEl = document.getElementById('today-status-deprivation-value');
  const deprivationText = deprivationKcal !== null ? `${deprivationKcal} / 0 kcal` : '—';
  deprivationEl.textContent = privacyMode ? maskDigits(deprivationText) : deprivationText;
  deprivationEl.style.color = deprivationKcal !== null ? sleepDeprivationDotColor(deprivationKcal) : '';

  const balanceEl = document.getElementById('today-status-balance-value');
  balanceEl.classList.remove('income', 'income-high', 'expense');
  const balanceTargetKcal = targetBalanceKcal(planBodyMassKg(entries));
  const balanceText = balanceKcal !== null
    ? `${balanceKcal}${balanceTargetKcal !== null ? ` / ${balanceTargetKcal}` : ''} kcal`
    : '—';
  balanceEl.textContent = privacyMode ? maskDigits(balanceText) : balanceText;
  if (balanceKcal !== null) {
    const balanceGood = balanceTargetKcal !== null
      ? (isCut ? balanceKcal <= balanceTargetKcal : balanceKcal >= balanceTargetKcal)
      : (isCut ? balanceKcal < 0 : balanceKcal > 0);
    balanceEl.classList.add(balanceGood ? 'income' : 'expense');
  }

  // Δm — the daily body-mass change today's Balance implies (Balance ÷ ~7700 kcal/kg, the
  // fat-equivalent GENERIC_KCAL_PER_KG_FAT), shown against the plan's own expected fat-loss
  // rate (WEEKLY_FAT_LOSS_KG spread over 7 days). Both are signed mass changes (negative =
  // losing), so WEEKLY_FAT_LOSS_KG — stored positive for a cut — is negated here the same
  // way targetBalanceKcal negates it for D, its own deficit target.
  const dmActual = balanceKcal !== null ? Math.round((balanceKcal / GENERIC_KCAL_PER_KG_FAT) * 1000) : null;
  const weeklyFatLossKg = weeklyFatLossKgAt(planBodyMassKg(entries));
  const dmTarget = weeklyFatLossKg !== null ? Math.round((-weeklyFatLossKg / 7) * 1000) : null;
  const dmText = dmActual !== null
    ? `${dmActual}${dmTarget !== null ? ` / ${dmTarget}` : ''} g`
    : '—';
  document.getElementById('today-status-deltam-value').textContent = privacyMode ? maskDigits(dmText) : dmText;

  // Goal — the projected arrival at the healthy body mass: calcProjection's own day count
  // and ETA (the same figures State Trend & Forecast's time-progress meter shows), the
  // date written D-M-YYYY.
  const proj = calcProjection(entries);
  let goalText = '—';
  if (proj?.status === 'reached') {
    goalText = 'Reached';
  } else if (proj?.status === 'ok' && proj.etaDate) {
    const d = proj.etaDate;
    goalText = `${proj.daysToTarget} days (${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()})`;
  }
  document.getElementById('today-status-goal-value').textContent = privacyMode ? maskDigits(goalText) : goalText;
}

// `target` is a number, or a preformatted string for Protein's band — both interpolate
// and mask alike. `note` restates it in a second unit ("(394 kcal)"), inside the same
// string rather than its own element, so the line reads at one size and masks as one.
// `isHigh` gives Protein the same dark-green-past-the-band-top the chart uses; every
// other tile leaves it false and gets the plain two-colour split. `colorOverride`, when
// given, paints the value that exact colour instead of picking one of the two/three
// fixed classes — Sleep's own gradient read, see renderTodayGlanceCards above.
function setTodayGlanceTile(idPrefix, value, target, unit, isGood, note = null, isHigh = false, colorOverride = null, separator = '/') {
  const el = document.getElementById(`${idPrefix}-value`);
  el.classList.remove('income', 'income-high', 'expense');
  el.style.color = '';

  const text = `${value !== null ? value : '—'} ${separator} ${target} ${unit}${note !== null ? ` (${note})` : ''}`;
  el.textContent = privacyMode ? maskDigits(text) : text;
  if (value === null) return;
  if (colorOverride !== null) {
    el.style.color = colorOverride;
  } else {
    el.classList.add(isGood ? (isHigh ? 'income-high' : 'income') : 'expense');
  }
}

// lastNDates clipped to the earliest matching entry, so a short logging history isn't
// pushed to the right behind a run of empty days.
// The one window the whole Health Indicators panel plots, bar State Trend & Forecast:
// whatever the From/To pair above Body Mass holds, else the WELLNESS_METRICS_DAYS
// default. Protein Source Rotation reads it too — it wants the two ends rather than
// every day between them, which is why this returns the range and not the date list.
//
// Read straight off the inputs rather than from state initDateRangeControl hands back,
// so it can't matter whether a chart renders before or after that wiring runs — an
// unfilled pair simply reads as "use the default", which is what it means.
function wellnessDateRange() {
  const from = document.getElementById('wellness-date-from').value;
  const to = document.getElementById('wellness-date-to').value;
  if (from && to) return { from, to };

  const fallback = lastNDates(WELLNESS_METRICS_DAYS);
  return { from: fallback[0], to: fallback[fallback.length - 1] };
}

// One control for the panel. Every chart under State Trend & Forecast redraws on a
// change, Protein Source Rotation included — it used to carry a second From/To pair of
// its own, so the panel showed two windows at once.
function initWellnessRangeControl() {
  initDateRangeControl('wellness-date-from', 'wellness-date-to', WELLNESS_METRICS_DAYS, () => {
    renderWellnessCharts(physiqueAsWellnessEntries());
    renderProteinRotationChart(wellnessDateRange());
    renderActivityRotationChart(wellnessDateRange());
  });
}

// The date list built from that range, clipped to what this particular metric has
// logged.
function wellnessWindowDates(matchingEntries) {
  const { from, to } = wellnessDateRange();
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

// The x-axis Caloric Intake and Body Mass BOTH plot on. Body Mass deliberately doesn't
// clip to its own log the way every other metric chart does: the two are read as a
// stacked pair, and different start days would slide their dates out of line.
function wellnessCalorieChartDates(entries) {
  return wellnessWindowDates(calorieLogEntries(entries));
}

let wellnessBodyMassChart = null;

// For a bar that can't be scored — the first reading, or a stall too short to call.
// Green would claim progress that isn't measured; red, a setback that isn't either.
const BODY_MASS_UNSCORED_COLOR = '#9ca3af';

// One flat reading is scale noise, not a plateau.
const BODY_MASS_STALL_RED_AFTER_DAYS = 2;

// Down on a cut, up on a bulk. Via getCalorieTargetKind rather than re-reading
// BODY_MASS_TARGET_KG, so this chart's green and Caloric Intake's max/min come from one read
// of the target, fallbacks included.
function bodyMassTargetIsDownward(entries) {
  return getCalorieTargetKind(entries) === 'max';
}

// The tolerance getCalorieTargetKind and calcProjection also treat as "there" — no scale
// reading lands on a target to the gram.
const BODY_MASS_AT_TARGET_TOLERANCE_KG = 0.1;

function bodyMassIsAtTarget(bodyMassKg) {
  const targetKg = getSetting('BODY_MASS_TARGET_KG', null);
  return targetKg !== null && bodyMassKg !== null && Math.abs(targetKg - bodyMassKg) < BODY_MASS_AT_TARGET_TOLERANCE_KG;
}

// Progress since the previous reading; null is unscored (gray). A day the scale held
// still is judged by WHERE and HOW LONG: holding at the target is what success looks like,
// so it stays green; holding short of it only reads as a miss after
// BODY_MASS_STALL_RED_AFTER_DAYS, since one flat reading is as likely to be noise.
function bodyMassChangeIsProgress(deltaKg, bodyMassKg, targetIsDownward, stallDays) {
  if (deltaKg === null) return null;
  if (deltaKg === 0) {
    if (bodyMassIsAtTarget(bodyMassKg)) return true;
    return stallDays >= BODY_MASS_STALL_RED_AFTER_DAYS ? false : null;
  }
  return (deltaKg < 0) === targetIsDownward;
}

// Deurenberg et al. 1991 (Br J Nutr): body fat % from BMI alone. The app has no direct
// measurement anywhere, so this is a population estimate at the same trust level as the
// USDA/AI calorie lookups.
function estimateBodyFatPercent(bodyMassKg, heightCm, age, sex) {
  const bmi = bodyMassKg / (heightCm / 100) ** 2;
  const sexTerm = sex === 'male' ? 1 : 0;
  return 1.20 * bmi + 0.23 * age - 10.8 * sexTerm - 5.4;
}

// Held to a plausible range, so a nonsense BMI can't produce a nonsense figure. Every
// fat-related value on this chart goes through it, so none of them can disagree.
function clampedBodyFatPercent(bodyMassKg, heightCm, age, sex) {
  return Math.max(3, Math.min(60, estimateBodyFatPercent(bodyMassKg, heightCm, age, sex)));
}

// Estimated fat mass (kg) at `bodyMassKg` — that clamped share of it.
function estimatedFatMassKg(bodyMassKg, heightCm, age, sex) {
  return bodyMassKg * (clampedBodyFatPercent(bodyMassKg, heightCm, age, sex) / 100);
}

// Energy stored in that fat mass, costed at fat's ~7,700 kcal/kg.
function fatEnergyKcal(bodyMassKg, heightCm, age, sex) {
  return estimatedFatMassKg(bodyMassKg, heightCm, age, sex) * GENERIC_KCAL_PER_KG_FAT;
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

// The same four knobs the Formula Playground's glycogen block opens on (s, g_musc,
// g_liver, r) — defaults here match its input boxes, so a State Trend reader who never
// opens that modal still gets the same swing it would report for their own body.
const GLYCOGEN_SKELETAL_FRAC_DEFAULT = 45; // % of LBM
const GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT = 14; // g glycogen / kg muscle
const GLYCOGEN_LIVER_G_DEFAULT = 100; // g
const GLYCOGEN_WATER_RATIO_DEFAULT = 3; // g H2O / g glycogen

// ΔM_gly = g_musc × m_musc + g_liver, water-bound at r, in kg — the same identity the
// Formula Playground's glycogen block walks through (see its readGlycogenSwingFormula),
// evaluated at the defaults rather than whatever's currently typed there. This is the
// day-to-day swing glycogen and its bound water alone can account for, at this body —
// the noise floor State Trend & Forecast measures its smoothing against.
function glycogenSwingKg(bodyMassKg, heightCm, sex) {
  if (bodyMassKg === null || bodyMassKg === undefined || heightCm === null || heightCm === undefined) return null;
  const lbmKg = boerLeanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(lbmKg) || lbmKg <= 0) return null;
  const muscleKg = lbmKg * (GLYCOGEN_SKELETAL_FRAC_DEFAULT / 100);
  if (muscleKg <= 0) return null;
  const glycogenG = GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT * muscleKg + GLYCOGEN_LIVER_G_DEFAULT;
  return (glycogenG * (1 + GLYCOGEN_WATER_RATIO_DEFAULT)) / 1000;
}

// The target actually used to decide "have I arrived" — past the raw target by the
// glycogen/water swing, in the direction travel is already headed, so a bad-water-day
// reading can't land on the wrong side of the real target. Shared by calcProjection and
// the Formula Playground so both count arrival the same way and can't disagree. Falls
// back to the raw target when the swing can't be estimated (no height/sex on file).
function arrivalTargetKg(targetKg, bodyMassKg, heightCm, sex, isDownward) {
  const swingKg = glycogenSwingKg(bodyMassKg, heightCm, sex);
  return swingKg === null ? targetKg : targetKg + (isDownward ? -swingKg : swingKg);
}

// Headroom around the plotted range. The floor keeps a window of nearly identical
// readings off the top and bottom edges.
const BODY_MASS_AXIS_PAD_FRACTION = 0.15;
const BODY_MASS_AXIS_MIN_PAD_KG = 0.5;

// Smallest first; the first step keeping the count under BODY_MASS_MAX_GRIDLINES wins, so
// every line lands on a round kg.
const BODY_MASS_TICK_STEPS_KG = [0.5, 1, 2, 5, 10];
// Step candidates for macro gram axes; same max-gridlines guard as the kg axis.
const MACRO_G_TICK_STEPS = [5, 10, 25, 50, 100, 200, 500, 1000];
const BODY_MASS_MAX_GRIDLINES = 8;

// One bar per reading, scored by direction of travel on the same dates Caloric Intake
// uses, so the two compare bar for bar. No target line of its own: State Trend above
// already draws one, and a target several kg away would flatten this axis into exactly
// the flat line that chart exists to smooth.
//
// The twin axis restates each bar as the energy stored in the fat mass it implies.
// Body fat % moves with BMI, so that mapping is quadratic while a Chart.js twin axis
// can only be linear — anchoring at the ends of the kg range costs under 0.5% of the
// span on a typical window, 2.8% across an unusually wide 13 kg one.
function renderWellnessBodyMassChart(entries) {
  const ctx = document.getElementById('wellness-body-mass-chart');

  const targetIsDownward = bodyMassTargetIsDownward(entries);

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const byDate = bodyMassByDateMap(bodyMassEntries);
  const dates = wellnessCalorieChartDates(entries);

  // Scored against the previous READING, not the previous day, so logging every third
  // day still leaves every bar something to compare against — the leftmost included,
  // seeded from the last weigh-in before the window. stallStartDate is where the
  // current run of identical readings began, so a plateau predating the window still
  // counts its full length.
  let previousKg = null;
  let stallStartDate = null;
  [...byDate.keys()].sort().forEach((d) => {
    if (d >= dates[0]) return;
    const kg = Math.round(byDate.get(d) * 100) / 100;
    if (previousKg === null || kg !== previousKg) stallStartDate = d;
    previousKg = kg;
  });

  // Read before the loop, so each day's fat energy can be worked out as it goes.
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  // The same smoothed line and glycogen/water swing zone State Trend & Forecast draws
  // (computeBodyMassTrend/computeGlycogenZoneAnchor/glycogenSwingKg, charts.js), built off
  // the FULL history in `byDate` rather than just this window — smoothing needs the
  // context past the window's edges to agree with the other chart there — then read back
  // only for the dates this chart actually plots.
  const trendMap = computeBodyMassTrend(byDate);
  const trendDates = [...trendMap.keys()].sort();
  const lastTrendDate = trendDates[trendDates.length - 1];
  // The green line's slope at each of ITS points — read back below alongside the raw
  // day-to-day delta, so a single noisy weigh-in doesn't read as the real trend.
  const trendSlopeByDate = computeBodyMassTrendSlopeGramsPerDay(trendMap);
  const swingKg = lastTrendDate !== undefined ? glycogenSwingKg(byDate.get(lastTrendDate), heightCm, sex) : null;
  const stateTrendSeries = dates.map((d) => trendMap.get(d) ?? null);

  // Calorie-implied trajectory: same walk the (now-hidden) State Trend & Forecast chart
  // built — start at the first weigh-in and advance by each day's calorie balance. Used
  // here for the gray reference line, the yellow zone, and the Muscle Loss red zone.
  // Requires a full profile (height/age/sex) for BMR; omitted otherwise.
  const calorieTrendMap = new Map();
  // Each day's OWN balance-implied change, in grams — the exact figure the Status card's
  // Δm computes for today, kept per-date here so the hover's Calorie Trend Slope can read
  // it directly instead of diffing two calorieTrendMap points (see the comment where this
  // is filled in below for why that diff is off by a day).
  const calorieDayBalanceGPerDay = new Map();
  if (haveProfile) {
    const sortedWeighInDates = [...byDate.keys()].sort();
    if (sortedWeighInDates.length >= 1) {
      // Through the chart's own last plotted date, not just the last actual weigh-in —
      // otherwise a day (or several) without a fresh weigh-in leaves this line flat short
      // of today, disagreeing with the Status card's own Δm for a day it never reaches.
      // carryForwardBodyMassByDate below fills the gap with the last known reading.
      const calorieTrendDates = datesInRange(sortedWeighInDates[0], dates[dates.length - 1]);
      const calorieBodyMassForDate = carryForwardBodyMassByDate(byDate, calorieTrendDates);
      const cIntakeByDate = new Map();
      const cTefByDate = new Map();
      const cActivityKcalByDate = new Map();
      const cSleepHoursByDate = new Map();
      entries.forEach((e) => {
        if (e.amount === null) return;
        if (e.category === 'Calories' || e.category === 'Calories; Protein') {
          cIntakeByDate.set(e.date, (cIntakeByDate.get(e.date) || 0) + e.amount);
          if (e.tefKcal !== null && e.tefKcal !== undefined) {
            cTefByDate.set(e.date, (cTefByDate.get(e.date) || 0) + e.tefKcal);
          }
        } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
          const kcal = activityEntryKcal(e, calorieBodyMassForDate.get(e.date) ?? null);
          cActivityKcalByDate.set(e.date, (cActivityKcalByDate.get(e.date) || 0) + kcal);
        } else if (e.category === 'Sleep') {
          cSleepHoursByDate.set(e.date, (cSleepHoursByDate.get(e.date) || 0) + e.amount);
        }
      });
      const cSleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);
      let running = byDate.get(sortedWeighInDates[0]);
      calorieTrendDates.forEach((d) => {
        // Plotted BEFORE this day's own balance is folded in — calorieTrendMap.get(d) is
        // the trajectory as of the START of d (last night's number), and d's own balance
        // only shows up in TOMORROW's point. Reading two consecutive points back out of
        // calorieTrendMap to get "today's slope" would therefore actually read YESTERDAY's
        // balance instead — calorieDayBalanceGPerDay below is captured right here, the one
        // place that balance actually exists per day, so the hover's slope line can't get
        // the date shifted by one the way a naive point-to-point diff did.
        calorieTrendMap.set(d, running);
        if (!cIntakeByDate.has(d)) return;
        const intake = cIntakeByDate.get(d);
        const maintenance = applyBmrBasis(bmrKcal(calorieBodyMassForDate.get(d), heightCm, age, sex), d);
        const activity = cActivityKcalByDate.get(d) || 0;
        const tef = cTefByDate.has(d) ? cTefByDate.get(d) : intake * (1 - tefDivisor());
        const { balance } = dailyEnergyBalanceKcal(intake, maintenance, activity, tef, cSleepHoursByDate.get(d), cSleepTarget);
        calorieDayBalanceGPerDay.set(d, Math.round((balance / GENERIC_KCAL_PER_KG_FAT) * 1000));
        running += balance / GENERIC_KCAL_PER_KG_FAT;
      });
    }
  }
  const calorieTrendSeries = dates.map((d) => calorieTrendMap.get(d) ?? null);

  // Yellow zone anchored to the calorie-implied trajectory, matching State Trend &
  // Forecast exactly: upper edge = gray line, lower edge = gray line − full swingKg.
  const zoneUpperSeries = dates.map((d) => calorieTrendMap.get(d) ?? null);
  const zoneLowerSeries = dates.map((d) => {
    const c = calorieTrendMap.get(d);
    return c !== undefined && swingKg !== null ? c - swingKg : null;
  });

  const values = [];
  const barColors = [];
  const detailByDate = new Map();

  dates.forEach((d) => {
    if (!byDate.has(d)) {
      // An empty slot, not a zero: 0 kg is impossible and would drag the axis to it.
      values.push(null);
      barColors.push(BODY_MASS_UNSCORED_COLOR);
      return;
    }

    const kg = Math.round(byDate.get(d) * 100) / 100;
    const delta = previousKg === null ? null : Math.round((kg - previousKg) * 100) / 100;
    if (delta !== 0) stallStartDate = d;
    const stallDays = delta === 0
      ? Math.round((parseIsoDateUTC(d) - parseIsoDateUTC(stallStartDate)) / 86400000)
      : 0;
    const progress = bodyMassChangeIsProgress(delta, kg, targetIsDownward, stallDays);

    const fatKcal = haveProfile ? fatEnergyKcal(kg, heightCm, age, sex) : null;
    // BMI needs only height, so it survives a profile missing birth date or sex.
    const bmi = heightCm !== null ? computeBmi(kg, heightCm) : null;
    const smoothedChangeGPerDay = trendSlopeByDate.get(d) ?? null;
    detailByDate.set(d, { delta, fatKcal, bmi, smoothedChangeGPerDay });

    values.push(kg);
    barColors.push(progress === null ? BODY_MASS_UNSCORED_COLOR : (progress ? '#16a34a' : '#dc2626'));
    previousKg = kg;
  });

  // Sloped, not flat: a bar here is an absolute level, so the week's mean says little
  // and its direction says everything.
  const weekColumns = bucketedColumnCount(dates);
  const { series: trendSeries, slopePerWeek } = weeklyTrendSeries(values, weekColumns);

  // A single reading against the target reads as noise, not a reversal, when the week
  // it belongs to is still trending the right way overall — gray it out rather than
  // calling it a miss. Stall-days are untouched: their red already means something else.
  dates.forEach((d, i) => {
    if (barColors[i] !== '#dc2626') return;
    const delta = detailByDate.get(d)?.delta;
    if (!delta) return;
    const slope = slopePerWeek[i];
    if (slope === null || slope === undefined) return;
    if ((slope < 0) === targetIsDownward) barColors[i] = BODY_MASS_UNSCORED_COLOR;
  });

  // Explicit bounds, not `grace`: the twin axis derives from them and Chart.js resolves
  // `grace` too late to read here. The trend folds in too — a fit extended to the week's
  // edges can reach past every reading in it, and would otherwise clip.
  const logged = [...values, ...trendSeries, ...stateTrendSeries, ...zoneUpperSeries, ...zoneLowerSeries, ...calorieTrendSeries].filter((v) => v !== null);
  const kgLo = logged.length ? Math.min(...logged) : 0;
  const kgHi = logged.length ? Math.max(...logged) : 0;
  const kgPad = Math.max((kgHi - kgLo) * BODY_MASS_AXIS_PAD_FRACTION, BODY_MASS_AXIS_MIN_PAD_KG);

  // kg owns the gridlines, so both bounds round out to a whole step of it — otherwise
  // the lines land wherever the padding left them. The step grows with the range.
  const kgStep = BODY_MASS_TICK_STEPS_KG.find((s) => (kgHi - kgLo + 2 * kgPad) / s <= BODY_MASS_MAX_GRIDLINES)
    ?? BODY_MASS_TICK_STEPS_KG[BODY_MASS_TICK_STEPS_KG.length - 1];
  const yMin = Math.max(0, Math.floor((kgLo - kgPad) / kgStep) * kgStep);
  const yMax = Math.ceil((kgHi + kgPad) / kgStep) * kgStep;

  wellnessBodyMassChart = upsertChart(wellnessBodyMassChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Body Mass',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Trend', trendSeries, {}, weekColumns),
        // Yellow zone, Muscle Loss red zone, and gray Calorie-Implied Trajectory line —
        // all anchored to the calorie-implied trajectory and omitted together whenever the
        // profile is incomplete (no BMR → no trajectory). fill: '-1' chain runs upper →
        // lower (yellow fill) → Muscle Loss (red fill), matching State Trend & Forecast.
        // Band order (3) sits behind bars (2); lines use lower orders to read on top.
        ...(calorieTrendMap.size > 0 && swingKg !== null ? [
          {
            type: 'line',
            label: 'Glycogen + Water Swing (upper)',
            data: zoneUpperSeries,
            borderWidth: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0,
            fill: false,
            spanGaps: false,
            isStateTrendOverlay: true,
            order: 3,
          },
          {
            type: 'line',
            label: 'Glycogen + Water Swing',
            data: zoneLowerSeries,
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            borderWidth: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0,
            fill: '-1',
            spanGaps: false,
            isStateTrendOverlay: true,
            order: 3,
          },
          {
            type: 'line',
            label: 'Muscle Loss (below swing zone)',
            data: dates.map((d) => {
              const c = calorieTrendMap.get(d);
              const trend = trendMap.get(d);
              if (c === undefined || trend === null || trend === undefined) return null;
              return Math.min(trend, c - swingKg);
            }),
            backgroundColor: 'rgba(220, 38, 38, 0.45)',
            borderWidth: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            tension: 0,
            fill: '-1',
            spanGaps: false,
            isStateTrendOverlay: true,
            order: 3,
          },
          {
            type: 'line',
            label: 'Calorie-Implied Trajectory',
            data: calorieTrendSeries,
            borderColor: '#9ca3af',
            borderWidth: 2,
            fill: false,
            tension: 0,
            pointRadius: 0,
            pointHitRadius: 0,
            spanGaps: false,
            isStateTrendOverlay: true,
            order: 1.5,
          },
        ] : []),
        {
          type: 'line',
          label: 'State Trend & Forecast',
          data: stateTrendSeries,
          borderColor: '#16a34a',
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 0,
          spanGaps: false,
          isStateTrendOverlay: true,
          order: 1.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Matching the other charts in the section — without it the cursor lands on the
      // trend line instead of the day's bar, and that row is filtered out.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        title: {
          display: !values.some((v) => v !== null),
          text: 'No body mass readings logged in this range',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: {
          // Days with no weigh-in plot as a gap; index mode would otherwise hand them
          // over as an empty row.
          filter: (item) => item.raw !== null && !item.dataset.isWeeklyAverage && !item.dataset.isStateTrendOverlay,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const d = detailByDate.get(item.label) ?? {};
              const lines = [`m (Body Mass): ${item.parsed.y} kg`];
              // The green line's own slope, not the raw day-to-day delta a single
              // water/glycogen-heavy weigh-in would swing — this is the one shown.
              if (d.smoothedChangeGPerDay !== null && d.smoothedChangeGPerDay !== undefined) {
                lines.push(`Δm (Changed Mass): ${withExplicitSign(d.smoothedChangeGPerDay)} g/day`);
              }
              // BMI leads the derived rows because the rest are computed from it.
              // Unitless by definition, so no unit.
              if (d.bmi !== null && d.bmi !== undefined) lines.push(`BMI (Body Mass Index): ${d.bmi} kg/m²`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // Flush left and last, like every reference figure in the section. One fact
            // per line, same rule every other row in this tooltip already follows (the
            // label callback's own Body Mass/Changed Mass/BMI rows never combine two
            // figures on one line either) — value and slope are two separate lines, not
            // one line with the slope parenthesized after the value.
            //
            // The gray line (renamed "Calorie Trend" for the hover — "Calorie-Implied
            // Trajectory" is the chart's own internal/legend name) is filtered out of the
            // item rows above (isStateTrendOverlay), same as every other overlay line, so
            // its own value/slope never showed anywhere in the hover — added here instead,
            // right above 7-Day Trend so the two rates read together. calorieTrendMap
            // already holds its value per date.
            //
            // Slope is that day's OWN balance-implied change (calorieDayBalanceGPerDay,
            // captured while the trajectory is built above), not a diff between two
            // calorieTrendMap points — calorieTrendMap.get(d) is the trajectory as of the
            // START of d, so a naive point-to-point diff actually reads the PRIOR day's
            // balance (the one that moved d-1's point to d's), landing one day off from
            // what the number was labeled as. Reading the captured balance directly is
            // also exactly the Status card's own Δm arithmetic for today, so the two can't
            // disagree the way a diffed or averaged figure could.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return [];
              const d = items[0].label;
              const lines = [];

              const trajectoryKg = calorieTrendMap.get(d);
              if (trajectoryKg !== undefined) {
                lines.push(`Calorie Trend: ${Math.round(trajectoryKg * 100) / 100} kg`);
                const slopeGPerDay = calorieDayBalanceGPerDay.get(d);
                if (slopeGPerDay !== undefined) {
                  // g/day, not kg/week — same unit Δm (Changed Mass) above uses, so the
                  // two rates read on the same scale instead of forcing a unit conversion
                  // to compare them.
                  lines.push(`Calorie Trend Slope: ${withExplicitSign(slopeGPerDay)} g/day`);
                }
              }

              if (slopePerWeek[i] !== null) {
                lines.push(`7-Day Trend: ${withExplicitSign(Math.round(slopePerWeek[i] * 100) / 100)} kg/week`);
              }

              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          // Must NOT begin at zero — a 0 kg baseline puts every bar within a pixel of
          // the same height and hides the movement the chart exists for.
          beginAtZero: false,
          position: 'left',
          min: yMin,
          max: yMax,
          afterFit: fixTrendYAxisWidth,
          // autoSkip off so the step is honoured exactly.
          ticks: { stepSize: kgStep, autoSkip: false, callback: maskedUnitTick('kg', kgStep < 1 ? 1 : 0) },
        },
        // BMI (kg/m²) right axis — a fixed linear rescale of kg so it stays a true
        // pixel-for-pixel twin of y. Step derived from kgStep / height² so the tick
        // density matches the left axis, then snapped to the nearest clean BMI step.
        y1: heightCm !== null
          ? (() => {
            const BMI_TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5];
            const rawBmiStep = kgStep / Math.pow(heightCm / 100, 2);
            const bmiStep = BMI_TICK_STEPS.find((s) => s >= rawBmiStep) ?? BMI_TICK_STEPS[BMI_TICK_STEPS.length - 1];
            return {
              min: computeBmi(yMin, heightCm),
              max: computeBmi(yMax, heightCm),
              position: 'right',
              afterFit: fixTrendYAxisWidth,
              grid: { drawOnChartArea: false },
              ticks: {
                stepSize: bmiStep,
                includeBounds: false,
                callback: maskedUnitTick('kg/m²', bmiStep < 1 ? 1 : 0),
              },
            };
          })()
          : ghostRightAxis(),
      },
    },
  });
}

// Headroom around the plotted range, with a floor — a window of near-identical days
// would otherwise be padded by almost nothing and sit flush against both edges.
const CALORIE_AXIS_PAD_FRACTION = 0.15;
const CALORIE_AXIS_MIN_PAD_KCAL = 120;

// Rounding for those bounds, so a zoomed axis still lands on readable tick
// figures (1,650 rather than 1,663).
const CALORIE_AXIS_STEP_KCAL = 50;

// Coarser, for the one case where the target still has to widen the axis. A coarse step
// holds the frame still across several hundred kcal of target movement.
const CALORIE_AXIS_TARGET_STEP_KCAL = 250;

// Framed on what was LOGGED, padded out. The zeros standing in for unlogged days would
// drag the floor back down and undo the zoom; clamped at zero so small intakes give the
// zero-based axis rather than negative calories.
//
// The target is deliberately NOT part of the frame. Padding around it made the ruler move
// with the thing it measures: a 278 kcal change landed the caps 2 px from where they
// started, with the bars changing height instead. What was eaten doesn't depend on the
// target, so framing on it holds still while the target moves across it.
//
// The caps still can't fall off-plot, so the frame is WIDENED — never re-padded — to
// reach one. That only arises when the target sits beyond everything logged.
function calorieAxisBounds(loggedValues, targetValues) {
  const framing = loggedValues.length ? loggedValues : targetValues;
  const lo = Math.min(...framing);
  const hi = Math.max(...framing);
  const pad = Math.max(CALORIE_AXIS_MIN_PAD_KCAL, (hi - lo) * CALORIE_AXIS_PAD_FRACTION);

  const roundDown = (v, step) => Math.max(0, Math.floor(v / step) * step);
  const roundUp = (v, step) => Math.ceil(v / step) * step;

  return {
    min: Math.min(roundDown(lo - pad, CALORIE_AXIS_STEP_KCAL), roundDown(Math.min(...targetValues), CALORIE_AXIS_TARGET_STEP_KCAL)),
    max: Math.max(roundUp(hi + pad, CALORIE_AXIS_STEP_KCAL), roundUp(Math.max(...targetValues), CALORIE_AXIS_TARGET_STEP_KCAL)),
  };
}

function renderWellnessCaloriesChart(entries) {
  const ctx = document.getElementById('wellness-calories-chart');

  const target = getCalorieTarget(entries);

  const calorieEntries = calorieLogEntries(entries);
  const dates = wellnessCalorieChartDates(entries);
  const byDate = new Map();
  calorieEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount));

  // Resting metabolic rate, at THAT day's own carried-forward body mass and age — not a
  // flat figure at today's, since both can move across the window (a multi-week range can
  // span a birthday, and body mass is the whole point of the chart next to it). Drawn as
  // its own dashed line below and restated in the hover (afterBody).
  const heightCm = getSetting('HEIGHT_CM', null);
  const birthDateStr = getSettingString('BIRTH_DATE', null);
  const sex = getSettingString('SEX', null);
  const haveRestingProfile = heightCm !== null && (sex === 'male' || sex === 'female');
  const bodyMassForDate = carryForwardBodyMassByDate(
    bodyMassByDateMap(entries.filter((e) => e.category === 'Body Mass' && e.amount !== null)),
    dates,
  );
  const restingKcalByDate = new Map();
  if (haveRestingProfile) {
    dates.forEach((d) => {
      const massKg = bodyMassForDate.get(d);
      if (massKg === undefined || massKg === null) return;
      const age = ageFromBirthDate(birthDateStr, dateFromIso(d));
      if (age === null && bmrNeedsAge()) return;
      restingKcalByDate.set(d, bmrKcal(massKg, heightCm, age, sex));
    });
  }

  // BMR_adp, per day — the same reference figure the Status card's own BMR row shows
  // under the 'bmr_adp' basis, but always the adapted reading here regardless of the
  // Formula Playground's "Basal metabolic rate basis" setting, so the two bases can be
  // compared on the chart at once. Each day gets its OWN discount (days actually elapsed
  // since the first logged weigh-in, evaluated AT that day — daysSinceFirstWeighIn,
  // wellness-math.js), not a single constant applied alike everywhere — a day early in
  // the diet sits close to plain BMR, one further in sits further below it.
  const restingAdaptKcalByDate = new Map();
  if (haveRestingProfile) {
    const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
    const adaptPctPerWeek = getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT);
    const adaptPctCap = getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT);
    dates.forEach((d) => {
      const bmr = restingKcalByDate.get(d);
      if (bmr === undefined) return;
      const daysOnDiet = daysSinceFirstWeighIn(bodyMassEntries, d);
      if (daysOnDiet === null) return;
      restingAdaptKcalByDate.set(d, bmr * (1 - adaptationFraction(daysOnDiet, adaptPctPerWeek, adaptPctCap)));
    });
  }

  // Re-evaluated per day, so there's no single figure to draw: each bar carries its own
  // and is scored against that one alone.
  const targetByDay = calorieTargetSeries(entries, dates);
  const dayTarget = (i) => ({ ...target, kcal: targetByDay[i].kcal });

  // Each bar against its OWN day's figure: green on the right side, gray within
  // CALORIE_TARGET_NEAR_FRACTION past it, red beyond — so the colour IS the read, and a
  // near-miss is called neither a win nor a failure. No shaded out-of-bounds region:
  // the target moves by tens of kcal across a window, far too little for a filled zone
  // to follow, so the wash only ever communicated a fixed limit the chart doesn't have.
  // An unlogged day plots as 0 and takes the green — a missing log, not a fast, and
  // invisible at zero height anyway rather than the worst day on the chart under a floor.
  const CALORIE_NEAR_TARGET_COLOR = '#9ca3af';
  const values = dates.map((d) => byDate.get(d) || 0);
  // On a "Max" target, red beyond it isn't flat — green at the target itself sliding
  // to red at that day's own Basal Metabolic Rate (restingKcalByDate, above), since
  // eating up to BMR alone already erases the deficit before activity or TEF even
  // factor in: the real ceiling the target sits a step under. Solid red at or past
  // BMR itself. A "Min" target (a bulk) has no such ceiling to gradient toward, so
  // it keeps the old flat near/missed split, as does a Max day BMR can't be priced
  // for yet (no profile, or no body mass logged).
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d)) return '#16a34a';
    const value = values[i];
    const dt = dayTarget(i);
    if (withinCalorieTarget(value, dt)) return '#16a34a';
    const bmr = target.isMax ? restingKcalByDate.get(d) : undefined;
    if (bmr === undefined || bmr === null || bmr <= dt.kcal) {
      return calorieTargetScore(value, dt) === 'near' ? CALORIE_NEAR_TARGET_COLOR : '#dc2626';
    }
    if (value >= bmr) return '#dc2626';
    return lerpHex('#16a34a', '#dc2626', (value - dt.kcal) / (bmr - dt.kcal));
  });

  // Averaged off the LOGGED days only, so `values`' zero-for-nothing-logged stand-ins
  // don't count as days of fasting. Computed here, ahead of the axis, so a missed day
  // can be graded against it below.
  const weekColumns = bucketedColumnCount(dates);
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), weekColumns);

  // A single day's overshoot reads as noise, not a habit, when the week around it is
  // still landing on the target's right side — gray it out rather than calling it a
  // miss. Only a 'missed' bar moves: 'met' is already green and 'near' is already this
  // same gray.
  barColors.forEach((color, i) => {
    if (color !== '#dc2626') return;
    const avg = weeklyAvg[i];
    if (avg === null || avg === undefined) return;
    if (withinCalorieTarget(avg, dayTarget(i))) barColors[i] = CALORIE_NEAR_TARGET_COLOR;
  });

  const restingKcalValues = [...restingKcalByDate.values()];
  const axis = calorieAxisBounds(
    values.filter((v, i) => byDate.has(dates[i])),
    targetByDay.map((b) => b.kcal).concat(restingKcalValues),
  );

  // A cap across each bar rather than one continuous line: a line spanning the window
  // reads as a single shared limit however it's dashed, while a mark per bar says the
  // limit belongs to that day alone. Thickness scales with the axis span.
  const capHalf = (axis.max - axis.min) * 0.004;
  const capData = targetByDay.map((b) => [b.kcal - capHalf, b.kcal + capHalf]);

  wellnessCaloriesChart = upsertChart(wellnessCaloriesChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Calories',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        {
          type: 'bar',
          label: `${target.word} for the day`,
          data: capData,
          backgroundColor: targetMarkColor(),
          grouped: false,
          isTargetLine: true,
          // Lowest order paints last, so the cap stays visible on a bar that overshot it.
          order: 0,
        },
        // Resting metabolic rate, per day (see restingKcalByDate above) — the same
        // per-day cap idiom as the Target above (and Protein/Fiber Intake's own min/max),
        // not a separate line style: a mark per bar, same thickness, same colour.
        ...(restingKcalValues.length === 0 ? [] : [
          targetCapDataset('Basal Metabolic Rate', dates.map((d) => restingKcalByDate.get(d) ?? null), capHalf, { isTargetLine: true }),
        ]),
        // Adapted BMR, right beside it — a distinct colour (WEEKLY_AVG_COLOR, the app's
        // existing "reference, not a score" violet) since the two caps would otherwise be
        // indistinguishable marks at slightly different heights.
        ...(restingAdaptKcalByDate.size === 0 ? [] : [
          targetCapDataset('Adapted BMR', dates.map((d) => restingAdaptKcalByDate.get(d) ?? null), capHalf, { isTargetLine: true, backgroundColor: WEEKLY_AVG_COLOR }),
        ]),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Hovering anywhere in a column reports that day. Without it the cap is often the
      // nearest element to the pointer, and since it's filtered out below, hovering near
      // the top of a bar would produce an empty tooltip.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The cap is filtered out — a floating bar would report itself as a
          // `[from, to]` pair — and stated properly in afterBody instead.
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const lines = [`TEI (Total Energy Intake): ${item.parsed.y} kcal`];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // afterBody rather than a label row: Chart.js indents body lines to clear the
            // colour swatch, while this sits flush left. target.word, so it reads
            // "Desired Max" rather than "Desired Maximum". No TEI prefix here — TEI
            // already labels the Actual Intake line above, and repeating it on this one
            // in the same tooltip would say the same symbol means two different things.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [`Desired ${target.word}: ${targetByDay[i].kcal} kcal`];
              const restingKcal = restingKcalByDate.get(items[0].label);
              if (restingKcal !== undefined) lines.push(`BMR (Basal Metabolic Rate): ${Math.round(restingKcal)} kcal`);
              const restingAdaptKcal = restingAdaptKcalByDate.get(items[0].label);
              if (restingAdaptKcal !== undefined) lines.push(`BMR_adp (Adapted BMR): ${Math.round(restingAdaptKcal)} kcal`);
              if (weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          // NOT zero-based, unlike the other intake charts. The target drifts only a few
          // tens of kcal across a 12-week window — on a 0-2,500 axis that's a handful of
          // pixels, which is why the per-day figures still read as one fixed line. Bars
          // here are a position against their own cap, not a quantity of food, so the
          // axis covers the region the comparison actually happens in.
          min: axis.min,
          max: axis.max,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
        y1: ghostRightAxis(),
      },
    },
  });
}

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

function lerpHex(hexA, hexB, t) {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${rgb.join(',')})`;
}

// Red -> amber -> green from half the target up to the target, in the app's own
// expense/calories/income colours. Solid at either end.
function sleepStatusColor(durationHr, targetHr) {
  const minHr = targetHr / 2;
  const ratio = Math.min(1, Math.max(0, (durationHr - minHr) / (targetHr - minHr)));
  return ratio < 0.5
    ? lerpHex('#dc2626', '#f59e0b', ratio / 0.5)
    : lerpHex('#f59e0b', '#16a34a', (ratio - 0.5) / 0.5);
}

// Green at 0 kcal, sliding to red as the Deprivation Effect itself grows — driven by the
// same kcal figure the dot's position and the glance tile's number already show, not a
// separate hours-based reading, so the colour can't tell a different story than the
// value beside it. Full red at 60 kcal/day: roughly what one night a couple of hours
// short costs a typical few-hundred-kcal target deficit — an hours-based ratio against
// the full sleep target left ordinary night-to-night variation reading as the same
// solid green. Shared by the Sleep chart's dot and the Deprivation Effect glance tile.
const SLEEP_DEPRIVATION_DOT_FULL_RED_KCAL = 60;

function sleepDeprivationDotColor(deprivationEffectKcal) {
  if (deprivationEffectKcal === null || deprivationEffectKcal === undefined) return '#16a34a';
  const ratio = Math.min(1, Math.max(0, deprivationEffectKcal / SLEEP_DEPRIVATION_DOT_FULL_RED_KCAL));
  return lerpHex('#16a34a', '#dc2626', ratio);
}

function renderWellnessSleepChart(entries) {
  const ctx = document.getElementById('wellness-sleep-chart');

  const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

  const sleepEntries = entries.filter((e) => e.category === 'Sleep' && e.amount !== null);
  // Shared with every other chart in the panel (wellnessCalorieChartDates), not this
  // metric's own earliest log — a Sleep chart clipped to its own first entry could pick
  // a different-length date list than Body Mass/Calorie Balance/etc, and
  // wellnessTickIndices (charts-base.js) would then choose DIFFERENT Mondays for its
  // ticks even though every chart runs the identical selection algorithm. One shared list is the
  // only way every chart's gridlines are guaranteed to land on the same dates.
  const dates = wellnessCalorieChartDates(entries);

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
    barColors.push(sleepStatusColor(e.amount, sleepTarget));
    return [start, end];
  });

  // Averaged in AXIS units, not clock minutes: the shift has already unwrapped
  // midnight, so a plain mean works where clock times would average 23:30 and 00:30
  // into midday.
  const weekColumns = bucketedColumnCount(dates);
  const bedAvg = weeklyAverageSeries(dates.map((d) => shiftedByDate.get(d)?.start ?? null), weekColumns);
  const wakeAvg = weeklyAverageSeries(dates.map((d) => shiftedByDate.get(d)?.end ?? null), weekColumns);

  // Deprivation Effect = Target Deficit × (1 - Sleep Efficiency Factor) — the kcal of
  // the plan's own deficit (targetBalanceKcal, not the day's actual eaten-vs-burned
  // balance — that adjustment lives in Calorie Balance instead) that a short night cost,
  // dotted on each night's bar. Zero — green — at a full night; red and rising the
  // further that night fell short of the target. This is the impact, not what survived
  // it, so a good night reads as "nothing lost" rather than a number worth reading.
  const targetDeficitKcal = targetBalanceKcal(planBodyMassKg(entries));
  const sleepHoursByDate = new Map();
  sleepEntries.forEach((e) => {
    sleepHoursByDate.set(e.date, (sleepHoursByDate.get(e.date) || 0) + e.amount);
  });
  const dotColors = [];
  const deprivationEffectData = dates.map((d) => {
    const sleepHrs = sleepHoursByDate.get(d);
    if (sleepHrs === undefined || targetDeficitKcal === null) { dotColors.push(null); return null; }
    const factor = sleepEfficiencyFactor(sleepHrs, sleepTarget);
    const kcal = Math.round(Math.abs(targetDeficitKcal) * (1 - factor));
    dotColors.push(sleepDeprivationDotColor(kcal));
    return kcal;
  });

  wellnessSleepChart = upsertChart(wellnessSleepChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Sleep',
          data: sleepData,
          backgroundColor: barColors,
          yAxisID: 'y1',
          order: 2,
        },
        weeklyAverageDataset('7-Day Avg Bed', bedAvg, { yAxisID: 'y1' }, weekColumns),
        weeklyAverageDataset('7-Day Avg Wake', wakeAvg, { yAxisID: 'y1' }, weekColumns),
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
          // Paints on top of the bar it sits on, same convention as the target caps.
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
                `7-Day Avg Bed: ${formatClockTime24(sleepAxisClockMin(bedAvg[i]))}`,
                `7-Day Avg Wake: ${formatClockTime24(sleepAxisClockMin(wakeAvg[i]))}`,
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
}

// Steps and timed entries onto one comparable scale. ~100 steps/min is walking
// pace; WORKOUT_STEPS_PER_MIN overrides it for a longer or shorter stride, and
// applies everywhere at once — this chart, the Activity target, and the workout
// estimator's own duration (activeSecondsForNoteLine, activity-estimator.js).
// The default lives here rather than beside WORKOUT_REP_SEC_DEFAULT because
// charts.js loads first: a const in the later file would still be in its dead
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
// Body Mass tooltip and insight.js.
function computeBmi(bodyMassKg, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((bodyMassKg / (heightM * heightM)) * 10) / 10;
}

// The inverse — the body mass a BMI implies at this height. Only one place needs it, the
// Formula Playground's target-BMI box, but it lives here beside computeBmi so the pair can't
// drift apart the way two copies of one rearrangement eventually do.
function bodyMassKgFromBmi(bmi, heightCm) {
  const heightM = heightCm / 100;
  return Math.round(bmi * heightM * heightM * 10) / 10;
}

// The WHO bands, for the one place a BMI is a GOAL rather than a reading: a target body mass
// is a number you choose, and the whole reason to show its BMI is to say whether the choice
// lands somewhere sensible. Both ends matter here, unlike the fat-loss band where only the
// ceiling is a warning — an underweight target is as much a problem as an obese one.
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

// "NEAT (Non-Exercise Activity Thermogenesis)" -> "NEAT"; the parenthetical doesn't fit
// a legend and isn't needed once you know the term.
function shortActivityLabel(description) {
  return description.split(' (')[0].trim();
}

// The two segments read most often, pinned rather than left to whatever hue their
// alphabetical position lands on — a generated one slides out from under them the
// moment a new description is logged. Keyed on the SHORTENED label.
const PINNED_ACTIVITY_COLORS = new Map([
  ['neat', '#3b82f6'],
  ['strength training', '#16a34a'],
]);

// Everything else gets a generated hue from the colour circle MINUS a band around each
// pinned one, otherwise a third activity lands on a near-identical blue and the pinning
// buys nothing. The surviving arcs are measured end to end and the hues spread evenly
// along that total, so they stay as far apart as the reduced range allows.
const RESERVED_ACTIVITY_HUES = [142, 217]; // the two pinned colors above
const RESERVED_ACTIVITY_HUE_MARGIN = 25;

function unreservedActivityHues(count) {
  const allowed = [];
  let cursor = 0;
  RESERVED_ACTIVITY_HUES
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

function renderWellnessActivityChart(entries) {
  const ctx = document.getElementById('wellness-activity-chart');

  const activityEntries = entries.filter((e) => (e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = wellnessCalorieChartDates(entries);

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

  const pinnedColorFor = (d) => PINNED_ACTIVITY_COLORS.get(shortActivityLabel(d).toLowerCase()) ?? null;
  const generatedHues = unreservedActivityHues(descriptions.filter((d) => pinnedColorFor(d) === null).length);
  let nextGeneratedHue = 0;
  const descriptionColors = descriptions.map((d) => pinnedColorFor(d)
    ?? `hsl(${generatedHues[nextGeneratedHue++]}, 65%, 55%)`);

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

  // Scored against what that day's own body mass would burn at ACTIVITY_TARGET_MIN — or
  // the pinned calorie burn, if that's what's pinned instead — via the same
  // getActivityTargetKcal the activity tile uses, so the two can't disagree. Met is
  // green, short by up to ACTIVITY_NEAR_TARGET_FRACTION gray, further short red. Without
  // a body mass there's no target, so the dot stays neutral violet.
  const dotColor = (date, kcal) => {
    const bodyMassKg = activityBodyMassForDate.get(date) ?? null;
    if (kcal === null || bodyMassKg === null) return '#7c3aed';
    const target = getActivityTargetKcal(bodyMassKg);
    if (kcal >= target) return '#16a34a';
    return target - kcal <= target * ACTIVITY_NEAR_TARGET_FRACTION ? '#9ca3af' : '#dc2626';
  };

  // Dots, not a connected line: each day's burn is independent, and a line would bridge
  // the unlogged days as though they were a trend.
  const caloriesData = dates.map((date) => (caloriesByDate.has(date) ? caloriesByDate.get(date) : null));
  const caloriesDataset = {
    type: 'line',
    label: 'Actual Burn',
    data: caloriesData.map((v) => (v === null ? null : -v)),
    yAxisID: 'y1',
    showLine: false,
    pointRadius: 5,
    pointHoverRadius: 7,
    pointBackgroundColor: dates.map((date, i) => dotColor(date, caloriesData[i])),
    pointBorderColor: '#fff',
    pointBorderWidth: 1.5,
    order: 0,
  };

  // TARGET BURN on the kcal axis, not the flat minutes target it used to be — that sat
  // on the other axis from the dots it appeared to judge, so a day could clear it on a
  // walk while burning less than a day that lifted. It moves day to day when time is
  // what's pinned, since activityTargetKcal scales with body mass; flat when calorie
  // burn is pinned instead. No body mass, no figure, so it breaks there rather than
  // inventing one.
  const targetBurnKcal = dates.map((date) => {
    const bodyMassKg = activityBodyMassForDate.get(date) ?? null;
    return bodyMassKg === null ? null : getActivityTargetKcal(bodyMassKg);
  });

  // A cap per column, the same mark Caloric Intake and Calorie Balance use. It was a
  // dashed line while the target was flat; now that it moves with body mass, a line
  // spanning the window would read as one shared limit however it's dashed.
  const burnMagnitudes = [
    ...caloriesData.filter((v) => v !== null),
    ...targetBurnKcal.filter((v) => v !== null),
  ];
  const capHalf = (burnMagnitudes.length ? Math.max(...burnMagnitudes) : 1) * 0.006;
  const targetLineDataset = {
    type: 'bar',
    label: 'Target Burn',
    data: targetBurnKcal.map((v) => (v === null ? null : [-v - capHalf, -v + capHalf])),
    yAxisID: 'y1',
    backgroundColor: targetMarkColor(),
    grouped: false,
    // Lowest order paints last: bars (2), the weekly average and this cap (both 1, the
    // cap second so it wins the tie), then the dots (0) above everything.
    order: 1,
    isTargetLine: true,
  };

  // On the kcal axis, not the minutes one — Target Burn lives there, and it's what the
  // week is compared against. Negated like the dots it averages.
  const weekColumns = bucketedColumnCount(dates);
  const weeklyBurnAvg = weeklyAverageSeries(caloriesData, weekColumns);
  const weeklyBurnDataset = weeklyAverageDataset(
    '7-Day Average Burn',
    weeklyBurnAvg.map((v) => (v === null ? null : -v)),
    { yAxisID: 'y1' },
    weekColumns,
  );

  wellnessActivityChart = upsertChart(wellnessActivityChart, ctx, {
    data: {
      labels: dates,
      datasets: [...activityDatasets, weeklyBurnDataset, targetLineDataset, caloriesDataset],
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
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: {
          // Empty slots and the cap, whose `[from, to]` pair goes to afterBody instead.
          filter: (item) => item.raw !== null && !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          // Dataset order. Without it Chart.js sorts by `order`, which controls DRAW
          // order, and put the dots above the bars — away from the Target Burn figure
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
            // Flush left and last, the placement Caloric Intake gives its own target.
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined) return '';
              const lines = [];
              if (targetBurnKcal[i] !== null) lines.push(`AEE (Desired Activity Energy Expenditure): ${-Math.round(targetBurnKcal[i])} kcal`);
              if (weeklyBurnAvg[i] !== null) lines.push(`7-Day Average Burn: ${-Math.round(weeklyBurnAvg[i])} kcal`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: { ...wellnessCategoryXScale(dates), stacked: true },
        // kcal left with the gridlines, minutes right with none: the comparison this
        // chart exists for — Actual against Target Burn — happens on the kcal scale,
        // so the lines have to be spaced in kcal. Only the sides move; the axis ids are
        // untouched. Both run from 0 downward, since everything is negated, but they
        // label differently: calories keep the minus because that energy left the body,
        // minutes drop it because negative time is meaningless.
        y: {
          stacked: true,
          position: 'right',
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => maskedUnitTick('min')(Math.abs(v)) },
        },
        y1: {
          position: 'left',
          beginAtZero: true,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

function renderWellnessProteinChart(entries) {
  const ctx = document.getElementById('wellness-protein-chart');

  const band = getProteinTargetBandG(entries);

  const proteinEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.amount2 !== null);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = wellnessCalorieChartDates(entries);
  const byDate = new Map();
  proteinEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.amount2));

  // Both ends take the section's per-column cap, so this chart's mark means what every
  // other chart's does. The band stays shaded: these two line datasets exist only to
  // carry `fill: '+1'` (which shades down to the NEXT dataset, so the pair must stay
  // adjacent and in this order) with their stroke off, and the caps draw over them. A
  // zero-width band collapses to one row of caps with nothing to shade.
  //
  // Green, not red: unlike Caloric Intake's shading, this region is the one you're
  // aiming to land IN, and it sits behind bars scored in the same green.
  const bandFill = (value, extra = {}) => ({
    type: 'line',
    label: `${value} g band edge`,
    data: new Array(dates.length).fill(value),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 3,
    ...extra,
  });

  // The two ways of leaving the band are NOT equivalent. Under the floor is the miss
  // that costs muscle on a deficit, so red. Over the top is a darker green than the
  // band itself — still a day you hit your protein, just past the point where more
  // buys anything, and read as a success rather than the neutral gray the other charts
  // give their near-miss. An unlogged day takes the plain green.
  const PROTEIN_OVER_BAND_COLOR = '#166534';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinProteinBand(values[i], band)) return '#16a34a';
    return values[i] > band.max ? PROTEIN_OVER_BAND_COLOR : '#dc2626';
  });

  // Zero-based and auto-topped, so the span is whatever is tallest — a bar or the band.
  const capHalf = targetCapHalf(Math.max(band.max, ...values, 1));
  const capFor = (value, label) => targetCapDataset(label, new Array(dates.length).fill(value), capHalf, { isTargetLine: true });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: 'rgba(22, 163, 74, 0.10)' }),
      bandFill(band.min),
      capFor(band.max, `${band.max} g upper target`),
      capFor(band.min, `${band.min} g target floor`),
    ]
    : [capFor(band.min, `${band.min} g target`)];

  // Logged days only, so the zero stand-ins don't pull the week under the band's floor.
  const weekColumns = bucketedColumnCount(dates);
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), weekColumns);

  const gTopProtein = Math.max(...values, band.max, band.min, 1);
  const gStepProtein = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTopProtein / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMaxProtein = Math.ceil(gTopProtein / gStepProtein) * gStepProtein;

  wellnessProteinChart = upsertChart(wellnessProteinChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Actual Intake',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        ...targetDatasets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Without it the cursor lands on the average line, not the bar.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The band's lines are the same constant every day, so as rows they'd repeat
          // identically on every hover. Stated once by afterBody instead.
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `P (Actual Protein): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            // Both ends, flush left and last — the Actual/Target shape the other charts
            // use. A zero-width band reads as one target, not an equal Min and Max.
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`P_min (Desired Protein, lower end): ${band.min} g`, `P_max (Desired Protein, upper end): ${band.max} g`]
                : [`P_min (Desired Protein): ${band.min} g`];
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} g`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          min: 0,
          max: gMaxProtein,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStepProtein, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMaxProtein * 4,
          position: 'left',
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: gStepProtein * 4, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

// Now a shaded min/max band like Protein Intake, not a flat single line — the Formula
// playground's fiber rows produce a band the same shape protein's do (getFiberTargetBandG),
// so the chart reads the same way: a floor that's a genuine miss (red) and a ceiling that's
// still a hit (dark green), not a flat met-or-missed. Read from the same Physique-day Fiber
// figure (fiberG) the Health tiles' own Fiber card sums — see physiqueAsWellnessEntries.
function renderWellnessFiberChart(entries) {
  const ctx = document.getElementById('wellness-fiber-chart');

  const band = getFiberTargetBandG(entries);

  const fiberEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.fiberG !== null && e.fiberG !== undefined);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = wellnessCalorieChartDates(entries);
  const byDate = new Map();
  fiberEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.fiberG));

  // Same shape as Protein Intake's bandFill — two flat line datasets whose only job is the
  // `fill: '+1'` shading between them, stroke off, caps drawn over them.
  const bandFill = (value, extra = {}) => ({
    type: 'line',
    label: `${value} g band edge`,
    data: new Array(dates.length).fill(value),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 3,
    ...extra,
  });

  // Same three-way split as Protein Intake: under the floor is red, in the band (or
  // unlogged) is green, and past the ceiling is a darker green — still a hit, not a miss.
  const FIBER_OVER_BAND_COLOR = '#166534';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinFiberBand(values[i], band)) return '#16a34a';
    return values[i] > band.max ? FIBER_OVER_BAND_COLOR : '#dc2626';
  });

  const capHalf = targetCapHalf(Math.max(band.max, ...values, 1));
  const capFor = (value, label) => targetCapDataset(label, new Array(dates.length).fill(value), capHalf, { isTargetLine: true });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: 'rgba(22, 163, 74, 0.10)' }),
      bandFill(band.min),
      capFor(band.max, `${band.max} g upper target`),
      capFor(band.min, `${band.min} g target floor`),
    ]
    : [capFor(band.min, `${band.min} g target`)];

  const weekColumns = bucketedColumnCount(dates);
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), weekColumns);

  const gTopFiber = Math.max(...values, band.max, band.min, 1);
  const gStepFiber = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTopFiber / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMaxFiber = Math.ceil(gTopFiber / gStepFiber) * gStepFiber;

  wellnessFiberChart = upsertChart(wellnessFiberChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Actual Intake',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        ...targetDatasets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `F (Actual Dietary Fiber): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`F_min (Desired Dietary Fiber, lower end): ${band.min} g`, `F_max (Desired Dietary Fiber, upper end): ${band.max} g`]
                : [`F_min (Desired Dietary Fiber): ${band.min} g`];
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} g`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          min: 0,
          max: gMaxFiber,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStepFiber, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMaxFiber * 2,
          position: 'left',
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: gStepFiber * 2, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

// Fiber's chart just above, with one deliberate difference: the band edges draw as a
// single dashed line spanning the whole window rather than fiber's per-day caps. The
// shaded fill between the two edges is the same green band fill as Protein/Fiber though —
// it draws behind the bars via its own invisible-stroke datasets, same as theirs, while
// the visible dashed line stays a separate on-top dataset. Read from the same Physique-day
// Fat figure (fatG) physiqueAsWellnessEntries adds beside fiberG.
function renderWellnessFatChart(entries) {
  const ctx = document.getElementById('wellness-fat-chart');

  const band = getFatTargetBandG(entries);

  const fatEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.fatG !== null && e.fatG !== undefined);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = wellnessCalorieChartDates(entries);
  const byDate = new Map();
  fatEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.fatG));

  // Under the floor is red, in the band (or unlogged) is green. Past the ceiling is a
  // lighter green — still inside the AMDR's own upper bound, just not the plain in-band hit.
  const FAT_OVER_BAND_COLOR = '#4ade80';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinFatBand(values[i], band)) return '#16a34a';
    return values[i] > band.max ? FAT_OVER_BAND_COLOR : '#dc2626';
  });

  // Same shape as Protein/Fiber Intake's bandFill — two flat line datasets whose only job
  // is the `fill: '+1'` shading between them, stroke off, drawn behind the bars.
  const bandFill = (value, extra = {}) => ({
    type: 'line',
    label: `${value} g band edge`,
    data: new Array(dates.length).fill(value),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 3,
    ...extra,
  });

  // targetMarkColor() is near-black in light mode, near-white in dark — the same colour
  // every other target cap on this panel uses, just as a continuous dashed line here
  // instead of a per-column tick.
  const targetLine = (value, label) => ({
    type: 'line',
    label,
    data: new Array(dates.length).fill(value),
    borderColor: targetMarkColor(),
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 0,
  });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: 'rgba(22, 163, 74, 0.10)' }),
      bandFill(band.min),
      targetLine(band.max, `${band.max} g upper target`),
      targetLine(band.min, `${band.min} g target floor`),
    ]
    : [targetLine(band.min, `${band.min} g target`)];

  const weekColumns = bucketedColumnCount(dates);
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), weekColumns);

  const gTopFat = Math.max(...values, band.max, band.min, 1);
  const gStepFat = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTopFat / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMaxFat = Math.ceil(gTopFat / gStepFat) * gStepFat;

  wellnessFatChart = upsertChart(wellnessFatChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Actual Intake',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        ...targetDatasets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `G (Actual Fat): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`G_min (Desired Fat, lower end): ${band.min} g`, `G_max (Desired Fat, upper end): ${band.max} g`]
                : [`G_min (Desired Fat): ${band.min} g`];
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} g`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          min: 0,
          max: gMaxFat,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStepFat, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMaxFat * KCAL_PER_G_FAT,
          position: 'left',
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: gStepFat * KCAL_PER_G_FAT, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

// Fat's chart just above, same dashed-band-edge shape but the opposite severity read:
// too little carbohydrate isn't a deficiency the way too little fiber or protein is, so
// under the floor is merely unscored grey (BODY_MASS_UNSCORED_COLOR's own shade) rather
// than a red miss — it's over the ceiling that's flagged, since that's the end actually
// linked to the bloating/water-retention complaint this band exists to catch. Read from
// the same Physique-day Carbohydrate figure (carbG) physiqueAsWellnessEntries adds beside
// fiberG/fatG.
function renderWellnessCarbChart(entries) {
  const ctx = document.getElementById('wellness-carb-chart');

  const band = getCarbTargetBandG(entries);

  const carbEntries = entries.filter((e) => e.category === 'Calories; Protein' && e.carbG !== null && e.carbG !== undefined);
  // Shared with every other chart in the panel — see the Sleep chart's own copy of this
  // comment for why a per-metric clip broke cross-chart gridline alignment.
  const dates = wellnessCalorieChartDates(entries);
  const byDate = new Map();
  carbEntries.forEach((e) => byDate.set(e.date, (byDate.get(e.date) || 0) + e.carbG));

  const CARB_UNDER_BAND_COLOR = '#9ca3af';
  const values = dates.map((d) => byDate.get(d) || 0);
  const barColors = dates.map((d, i) => {
    if (!byDate.has(d) || withinCarbBand(values[i], band)) return '#16a34a';
    return values[i] > band.max ? '#dc2626' : CARB_UNDER_BAND_COLOR;
  });

  // Same shape as Fiber/Fat Intake's bandFill — two flat line datasets whose only job
  // is the `fill: '+1'` shading between them, stroke off, drawn behind the bars.
  const bandFill = (value, extra = {}) => ({
    type: 'line',
    label: `${value} g band edge`,
    data: new Array(dates.length).fill(value),
    borderWidth: 0,
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 3,
    ...extra,
  });

  // targetMarkColor() is near-black in light mode, near-white in dark — the same colour
  // every other target cap on this panel uses, just as a continuous dashed line here
  // instead of a per-column tick.
  const targetLine = (value, label) => ({
    type: 'line',
    label,
    data: new Array(dates.length).fill(value),
    borderColor: targetMarkColor(),
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    tension: 0,
    isTargetLine: true,
    order: 0,
  });

  const targetDatasets = band.max > band.min
    ? [
      bandFill(band.max, { fill: '+1', backgroundColor: 'rgba(22, 163, 74, 0.10)' }),
      bandFill(band.min),
      targetLine(band.max, `${band.max} g upper target`),
      targetLine(band.min, `${band.min} g target floor`),
    ]
    : [targetLine(band.min, `${band.min} g target`)];

  const weekColumns = bucketedColumnCount(dates);
  const weeklyAvg = weeklyAverageSeries(dates.map((d) => (byDate.has(d) ? byDate.get(d) : null)), weekColumns);

  const gTopCarb = Math.max(...values, band.max, band.min, 1);
  const gStepCarb = MACRO_G_TICK_STEPS.find((s) => Math.ceil(gTopCarb / s) <= BODY_MASS_MAX_GRIDLINES) ?? MACRO_G_TICK_STEPS[MACRO_G_TICK_STEPS.length - 1];
  const gMaxCarb = Math.ceil(gTopCarb / gStepCarb) * gStepCarb;

  wellnessCarbChart = upsertChart(wellnessCarbChart, ctx, {
    data: {
      labels: dates,
      datasets: [
        {
          type: 'bar',
          label: 'Actual Intake',
          data: values,
          backgroundColor: barColors,
          order: 2,
        },
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
        ...targetDatasets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => !item.dataset.isTargetLine && !item.dataset.isWeeklyAverage,
          callbacks: {
            title: (items) => formatIsoDateShort(items[0].label),
            label: (item) => {
              const text = `C (Actual Carbohydrate): ${item.parsed.y} g`;
              return privacyMode ? maskDigits(text) : text;
            },
            afterBody: (items) => {
              const lines = band.max > band.min
                ? [`C_min (Desired Carbohydrate, lower end): ${band.min} g`, `C_max (Desired Carbohydrate, upper end): ${band.max} g`]
                : [`C_min (Desired Carbohydrate): ${band.min} g`];
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) lines.push(`7-Day Average: ${Math.round(weeklyAvg[i])} g`);
              return privacyMode ? lines.map(maskDigits) : lines;
            },
          },
        },
      },
      scales: {
        x: wellnessCategoryXScale(dates),
        y: {
          min: 0,
          max: gMaxCarb,
          position: 'right',
          afterFit: fixTrendYAxisWidth,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: gStepCarb, autoSkip: false, callback: maskedUnitTick('g') },
        },
        y1: {
          min: 0,
          max: gMaxCarb * KCAL_PER_G_CARB,
          position: 'left',
          afterFit: fixTrendYAxisWidth,
          ticks: { stepSize: gStepCarb * KCAL_PER_G_CARB, autoSkip: false, callback: maskedUnitTick('kcal') },
        },
      },
    },
  });
}

function renderWellnessProjectionChart(entries) {
  const ctx = document.getElementById('wellness-projection-chart');

  const meterWrap = document.getElementById('body-mass-progress-meter');
  const meterFill = document.getElementById('body-mass-progress-meter-fill');
  const meterCallout = document.getElementById('body-mass-progress-meter-callout');
  const meterDone = document.getElementById('body-mass-progress-meter-done');
  const meterRemaining = document.getElementById('body-mass-progress-meter-remaining');
  const meterTarget = document.getElementById('body-mass-progress-meter-target');
  const timeWrap = document.getElementById('time-progress-meter');
  const timeFill = document.getElementById('time-progress-meter-fill');
  const timeElapsed = document.getElementById('time-progress-meter-elapsed');
  const timeRemaining = document.getElementById('time-progress-meter-remaining');
  const timeEta = document.getElementById('time-progress-meter-eta');
  const etaEl = document.getElementById('body-mass-projection-eta');
  const plateauNote = document.getElementById('body-mass-plateau-note');
  meterWrap.hidden = true;
  meterWrap.style.removeProperty('--fill-pct');
  meterCallout.textContent = '';
  meterCallout.classList.remove('danger');
  meterDone.textContent = '';
  meterRemaining.textContent = '';
  meterTarget.textContent = '';
  meterRemaining.classList.remove('danger');
  timeWrap.hidden = true;
  timeWrap.style.removeProperty('--fill-pct');
  timeElapsed.textContent = '';
  timeRemaining.textContent = '';
  timeEta.textContent = '';
  etaEl.textContent = '';
  plateauNote.textContent = '';
  plateauNote.classList.remove('warning');

  const bodyMassEntries = entries
    .filter((e) => e.category === 'Body Mass' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (bodyMassEntries.length < 2) return;

  const startBodyMass = bodyMassEntries[0].amount;
  const lastBodyMass = bodyMassEntries[bodyMassEntries.length - 1].amount;

  const proj = calcProjection(entries);
  if (!proj) return;

  // First logged body mass to target, shown whatever the trajectory status — "wrong
  // direction" is worth seeing, just in the danger colour. Both readouts are kg so the
  // pair compares directly; the percentage still drives the bar's width.
  const bodyMassTarget = getSetting('BODY_MASS_TARGET_KG', BODY_MASS_TARGET_KG_DEFAULT);
  const totalDelta = startBodyMass - bodyMassTarget;
  if (Math.abs(totalDelta) >= 0.1) {
    const pct = Math.max(0, Math.min(100, ((startBodyMass - lastBodyMass) / totalDelta) * 100));
    const doneKg = Math.round(Math.abs(startBodyMass - lastBodyMass) * 10) / 10;
    const remainingKg = Math.round(Math.abs(lastBodyMass - bodyMassTarget) * 10) / 10;
    const isWrongDirection = proj.status === 'wrong-direction';

    meterWrap.hidden = false;
    meterFill.style.width = `${pct}%`;
    meterFill.classList.toggle('danger', isWrongDirection);
    if (!isWrongDirection) meterWrap.style.setProperty('--fill-pct', `${Math.round(pct)}`);

    // Same edge the fill stops at, so the bubble reads as "you are here" rather
    // than a second, disagreeing marker.
    meterCallout.style.left = `${pct}%`;
    const currentText = `${lastBodyMass} kg`;
    meterCallout.textContent = privacyMode ? maskDigits(currentText) : currentText;
    meterCallout.classList.toggle('danger', isWrongDirection);

    const doneText = `${doneKg} kg`;
    meterDone.textContent = privacyMode ? maskDigits(doneText) : doneText;

    const remainingText = `${remainingKg} kg`;
    meterRemaining.textContent = privacyMode ? maskDigits(remainingText) : remainingText;
    meterRemaining.classList.toggle('danger', isWrongDirection);

    // The swing (see glycogenSwingKg) alongside the target itself — the target line is a
    // single number, but any reading within this band of it is glycogen and water, not a
    // real miss, the same margin State Trend & Forecast's own zone and arrival math use.
    const targetSwingKg = glycogenSwingKg(lastBodyMass, getSetting('HEIGHT_CM', null), getSettingString('SEX', null));
    const targetText = targetSwingKg === null
      ? `→ ${bodyMassTarget} kg`
      : `→ ${bodyMassTarget} kg ± ${Math.round(targetSwingKg * 10) / 10} kg`;
    meterTarget.textContent = privacyMode ? maskDigits(targetText) : targetText;
  }

  // An undrawable projection drops only the projected SEGMENT. It used to `return`
  // here, but the chart is destroyed at the top of this function, so the panel went
  // blank and took the history, trend and target lines with it — none of which depend on
  // a projection. The status line says why, and the rate keeps it concrete.
  const rateNote = () => {
    const kgPerWeek = Math.abs(proj.slope * 7).toFixed(2);
    const direction = proj.slope > 0 ? 'gaining' : 'losing';
    return `${direction} ~${kgPerWeek} kg/week`;
  };
  const statusNote = {
    reached: () => 'Desired mass reached! 🎉',
    'no-change': () => 'No net change at current habits',
    'wrong-direction': () => `Current habits trend away from the desired mass — ${rateNote()}, so no arrival date can be projected`,
    // Right direction, but it decays to zero before the desired mass: the intake these
    // habits average IS maintenance at that body mass.
    asymptote: () => `Currently ${rateNote()}, but these habits level off around ${Math.round(proj.equilibriumKg * 10) / 10} kg — the desired mass isn't reachable without changing them`,
  }[proj.status];
  if (statusNote) {
    const note = statusNote();
    etaEl.textContent = privacyMode ? maskDigits(note) : note;
  }

  const hasProjection = proj.status === 'ok';
  const projPoints = hasProjection ? proj.projectedPoints : [];

  // The same journey in time rather than kg: elapsed since the first weigh-in against
  // the forecast's remaining days. A long time bar beside a short body-mass bar is itself
  // the signal that progress is slower than the effort. Needs an arrival date.
  if (hasProjection) {
    // Re-parsed as UTC, so today sits on the same footing as every other date here.
    const todayMs = parseIsoDateUTC(isoFromDate(new Date()));
    const daysElapsed = Math.max(0, Math.round((todayMs - parseIsoDateUTC(bodyMassEntries[0].date)) / 86400000));
    const daysToGo = Math.max(0, proj.daysToTarget);
    const totalDays = daysElapsed + daysToGo;

    if (totalDays > 0) {
      const timePct = Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
      timeWrap.hidden = false;
      timeFill.style.width = `${timePct}%`;
      timeWrap.style.setProperty('--fill-pct', `${Math.round(timePct)}`);

      const elapsedText = `${daysElapsed} ${daysElapsed === 1 ? 'day' : 'days'}`;
      timeElapsed.textContent = privacyMode ? maskDigits(elapsedText) : elapsedText;

      const toGoText = `${daysToGo} ${daysToGo === 1 ? 'day' : 'days'}`;
      timeRemaining.textContent = privacyMode ? maskDigits(toGoText) : toGoText;

      const etaText = `→ ${isoFromDate(proj.etaDate)}`;
      timeEta.textContent = privacyMode ? maskDigits(etaText) : etaText;
    }
  }

  const histLabels = bodyMassEntries.map((e) => e.date);
  const projLabels = projPoints.map((p) => p.date);

  // The same From/To window every other chart under this one reads
  // (wellnessDateRange), bounding BOTH ends — nothing plots outside it, forecast
  // included, same as Body Mass/Calorie Balance/Physical Activity/Caloric Intake
  // never show a "tomorrow" bar either. With the default To (today) that means no
  // projected segment is visible until To is pushed into the future.
  //
  // Filtered from histLabels/projLabels themselves, NOT wellnessWindowDates —
  // that helper returns every CALENDAR day in the window (what the bar charts
  // want, so an unlogged day still draws an empty column), but this chart's
  // datasets are sparse points on a linear day-offset axis with spanGaps:
  // false (see the comment below): only real weigh-in days and real WEEKLY
  // projected points belong in allLabels. Filling the gaps between them with
  // dateless "empty" days would put null right next to the sparse projected
  // points and spanGaps would refuse to bridge them, breaking the dashed line
  // into invisible fragments.
  //
  // histLabels/lastDate stay the TRUE full history regardless of the window —
  // the trend, adaptation and calorie-implied trajectory all need that full
  // run to compute correctly at the window's own left edge, the same reason
  // renderWellnessBodyMassChart's mirrored overlay does.
  const { from: windowFromDate, to: windowToDate } = wellnessDateRange();
  const windowHistLabels = histLabels.filter((d) => d >= windowFromDate && d <= windowToDate);
  const windowProjLabels = projLabels.filter((d) => d >= windowFromDate && d <= windowToDate);
  const allLabels = [...new Set([...windowHistLabels, ...windowProjLabels])].sort();
  if (!allLabels.length) return;

  const projMap = new Map(projPoints.map((p) => [p.date, p.bodyMass]));
  const lastDate = histLabels[histLabels.length - 1];

  // Same-day weigh-ins are averaged before smoothing, rather than letting whichever
  // came last silently win.
  const bodyMassSumsByDate = new Map();
  bodyMassEntries.forEach((e) => {
    const cur = bodyMassSumsByDate.get(e.date) || { sum: 0, count: 0 };
    cur.sum += e.amount;
    cur.count += 1;
    bodyMassSumsByDate.set(e.date, cur);
  });
  const bodyMassByDate = new Map([...bodyMassSumsByDate].map(([d, { sum, count }]) => [d, sum / count]));

  // Read here, ahead of the trend, so the zone band below can be positioned against it.
  const heightCm = getSetting('HEIGHT_CM', null);
  const sex = getSettingString('SEX', null);
  const swingKg = glycogenSwingKg(lastBodyMass, heightCm, sex);
  const trendMap = computeBodyMassTrend(bodyMassByDate);

  // The body-mass trajectory implied by logged calories alone: start at the first
  // weigh-in, then walk forward a day at a time adding that day's calorie balance
  // (intake minus BMR, activity and TEF) converted to kg via GENERIC_KCAL_PER_KG_FAT —
  // the same balance Calorie Balance itself scores. A day with nothing logged carries
  // the running total forward flat rather than guessing. Needs a profile for BMR, same
  // as that chart. Set against the smoothed trend line, the gap between the two is what
  // the calorie math alone can't explain — water, glycogen, or a logging gap.
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');
  const calorieTrendMap = new Map();
  if (haveProfile) {
    const calorieTrendDates = datesInRange(bodyMassEntries[0].date, lastDate);
    const calorieBodyMassForDate = carryForwardBodyMassByDate(bodyMassByDate, calorieTrendDates);

    const intakeByDate = new Map();
    const tefByDate = new Map();
    const activityKcalByDate = new Map();
    const sleepHoursByDate = new Map();
    entries.forEach((e) => {
      if (e.amount === null) return;
      if (e.category === 'Calories' || e.category === 'Calories; Protein') {
        intakeByDate.set(e.date, (intakeByDate.get(e.date) || 0) + e.amount);
        // This day's own measured TEF (Physique column L) where calculated —
        // same measured-over-estimated precedence Calorie Balance gives it.
        if (e.tefKcal !== null && e.tefKcal !== undefined) {
          tefByDate.set(e.date, (tefByDate.get(e.date) || 0) + e.tefKcal);
        }
      } else if (e.category === 'Activity' || e.category === 'Activity; Calories') {
        const kcal = activityEntryKcal(e, calorieBodyMassForDate.get(e.date) ?? null);
        activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
      } else if (e.category === 'Sleep') {
        sleepHoursByDate.set(e.date, (sleepHoursByDate.get(e.date) || 0) + e.amount);
      }
    });
    const sleepTarget = getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT);

    let running = startBodyMass;
    calorieTrendDates.forEach((d) => {
      calorieTrendMap.set(d, running);
      if (!intakeByDate.has(d)) return;
      const intake = intakeByDate.get(d);
      const maintenance = applyBmrBasis(bmrKcal(calorieBodyMassForDate.get(d), heightCm, age, sex), d);
      const activity = activityKcalByDate.get(d) || 0;
      const tef = tefByDate.has(d) ? tefByDate.get(d) : intake * (1 - tefDivisor());
      // Same sleep-adjusted balance Calorie Balance itself scores (dailyEnergyBalanceKcal)
      // — this walk can't disagree with that chart's own reading of a day's shortfall.
      const { balance } = dailyEnergyBalanceKcal(intake, maintenance, activity, tef, sleepHoursByDate.get(d), sleepTarget);
      running += balance / GENERIC_KCAL_PER_KG_FAT;
    });
  }

  // Anchored to the calorie-implied trajectory above, not an EMA of the smoothed trend
  // itself. That trajectory assumes intake vs. burn is the ONLY thing moving the scale,
  // so it's the driest the smoothed trend could read — the trend's own wobble above it
  // is the glycogen/water noise. The zone's top edge has to BE that line, not straddle
  // it, so the band sits entirely below rather than centered on it.
  const zoneAnchorMap = (swingKg === null || !haveProfile) ? null : calorieTrendMap;

  const plateauDays = detectPlateau(trendMap);
  if (plateauDays) {
    const plateauLine = `⚠️ Body mass trend has been flat for ~${plateauDays} days — consider adjusting your calorie limit`;
    plateauNote.textContent = privacyMode ? maskDigits(plateauLine) : plateauLine;
    plateauNote.classList.add('warning');
  }

  // Daily history then weekly projected points must NOT sit on equal category ticks,
  // which would imply every gap is the same length. A true linear day-offset axis makes
  // a week gap 7x the width of a one-day gap.
  const firstDateMs = parseIsoDateUTC(allLabels[0]);
  const dayOffset = (dateStr) => Math.round((parseIsoDateUTC(dateStr) - firstDateMs) / 86400000);
  const offsetToDateLabel = (offset) =>
    new Date(firstDateMs + offset * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // No raw per-reading series: Body Mass already plots every reading, this is the trend.
  const datasets = [
    // The zone anchor (the calorie-implied trajectory) down to anchor − the glycogen/water
    // swing — a band the trend line can wander inside without it being a real change. The
    // upper edge is the anchor itself, unshifted, so it draws exactly on top of the gray
    // Calorie-Implied Trajectory line — tension 0 to match that line's own straight
    // segments, not the smoothed trend's curve. Two line datasets rather than one:
    // Chart.js fills the area BETWEEN a dataset and the one its `fill` points at, so the
    // zone needs both edges plotted, just invisibly (borderWidth 0). Omitted whenever the
    // swing or the calorie trajectory can't be computed (no profile on file) rather than
    // drawn at 0, which would claim glycogen accounts for nothing.
    ...(zoneAnchorMap !== null ? [
      {
        label: 'Glycogen + Water Swing (upper)',
        data: allLabels.map((d) => {
          const a = zoneAnchorMap.get(d);
          return { x: dayOffset(d), y: a === undefined ? null : a };
        }),
        borderWidth: 0,
        pointRadius: 0,
        tension: 0,
        fill: false,
        spanGaps: false,
        isSwingBand: true,
        order: 5,
      },
      {
        label: 'Glycogen + Water Swing',
        data: allLabels.map((d) => {
          const a = zoneAnchorMap.get(d);
          return { x: dayOffset(d), y: a === undefined ? null : a - swingKg };
        }),
        // The zone reads as "normal noise", not a target or a warning, so it takes the
        // app's neutral highlight rather than either of those colours.
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
        borderWidth: 0,
        pointRadius: 0,
        tension: 0,
        // Fills to the upper-bound dataset just above this one in the array.
        fill: '-1',
        spanGaps: false,
        isSwingBand: true,
        order: 5,
      },
      // Where the actual trend has dropped BELOW the swing zone's own floor — glycogen
      // and water alone don't explain a drop that size, so unlike the zone above this
      // reads as a real loss, not noise. Sits at the zone floor (a zero-height fill
      // against the dataset above) whenever the trend is inside or above the zone, and
      // drops to the trend's own value — opening up a red fill down to it — for exactly
      // the stretch it's actually below. tension 0 to match the zone's own straight
      // edges rather than the trend line's smoothed curve.
      {
        label: 'Muscle Loss (below swing zone)',
        data: allLabels.map((d) => {
          const a = zoneAnchorMap.get(d);
          const trend = trendMap.get(d);
          if (a === undefined || trend === null || trend === undefined) return { x: dayOffset(d), y: null };
          return { x: dayOffset(d), y: Math.min(trend, a - swingKg) };
        }),
        // A real warning, so it reads noticeably stronger than the yellow zone's own
        // 0.15 neutral tint rather than matching it.
        backgroundColor: 'rgba(220, 38, 38, 0.45)',
        borderWidth: 0,
        pointRadius: 0,
        tension: 0,
        // Fills to the zone-floor dataset just above this one in the array.
        fill: '-1',
        spanGaps: false,
        isSwingBand: true,
        order: 5,
      },
    ] : []),
    {
      label: 'State Trend & Forecast',
      data: allLabels.map((d) => ({ x: dayOffset(d), y: trendMap.get(d) ?? null })),
      borderColor: '#16a34a',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      spanGaps: false,
      order: 4,
    },
    // Omitted without a profile — same guard as calorieTrendMap's own computation above.
    ...(haveProfile ? [{
      label: 'Calorie-Implied Trajectory',
      data: allLabels.map((d) => {
        const y = calorieTrendMap.get(d);
        return { x: dayOffset(d), y: y === undefined ? null : y };
      }),
      borderColor: '#9ca3af',
      borderWidth: 2,
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 3,
    }] : []),
    // Omitted rather than plotted empty, so it can't sit in the legend claiming a
    // forecast exists.
    ...(hasProjection ? [{
      label: 'Projected',
      data: allLabels.map((d) => {
        let y = null;
        if (d === lastDate) y = lastBodyMass;
        else if (d > lastDate) y = projMap.get(d) ?? null;
        return { x: dayOffset(d), y };
      }),
      borderColor: '#6366f1',
      // The app's one dash pattern, at the width of the trend line it continues. At
      // Chart.js's default width 3 the forecast was the heaviest line on the chart
      // despite being the least certain thing on it.
      borderDash: [4, 4],
      borderWidth: 2,
      // Line only — a shaded area read as a quantity, when all this asserts is where
      // the trend goes.
      fill: false,
      tension: 0,
      pointRadius: 0,
      spanGaps: false,
      order: 2,
    }] : []),
    {
      // bodyMassTarget, not proj.bodyMassTarget — that's only set on an 'ok' projection, but
      // the desired-mass line is drawn either way.
      label: `${bodyMassTarget} kg Desired`,
      data: allLabels.map((d) => ({ x: dayOffset(d), y: bodyMassTarget })),
      // Solid, like the section's hairline caps. It stays a continuous LINE rather than
      // caps because this chart has no columns: its x-axis is a linear time scale, so
      // there's nothing per-column for a mark to belong to.
      borderColor: targetMarkColor(),
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 1,
    },
  ];

  // Skipped without a height: BMI can't be computed, and an empty scale is worse than
  // none. There's no BMI LINE either — BMI is a fixed linear rescale of body mass, so it
  // would retrace the body-mass line pixel for pixel, and the y1 axis alone lets it be
  // read off that line. (heightCm itself was read earlier, ahead of the trend.)

  // Left to auto-range, Chart.js can pick a BMI span that doesn't correspond to the
  // body-mass span, so a point on the chart would read as the wrong BMI off the right axis.
  // Deriving y1's bounds from the same body-mass range keeps the two true parallel twins.
  //
  // Rounded to whole kg, not just padded: a fractional min/max breaks Chart.js's own
  // round-number tick algorithm, which is what produced the clean 1 kg gridlines.
  //
  // Raw weigh-ins are excluded since they're no longer plotted. lastBodyMass stays — the
  // projection starts from it. The swing band's own edges are included so the padded
  // axis can't clip the zone it's meant to fully show.
  const trendExtremes = zoneAnchorMap === null ? [] : [...zoneAnchorMap.values()].flatMap((v) => [v + swingKg, v - swingKg]);
  const bodyMassValues = [...trendMap.values(), ...projMap.values(), ...trendExtremes, ...calorieTrendMap.values(), lastBodyMass, bodyMassTarget]
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const bodyMassMin = Math.min(...bodyMassValues);
  const bodyMassMax = Math.max(...bodyMassValues);
  const bodyMassPad = Math.max(0.5, (bodyMassMax - bodyMassMin) * 0.08);

  // The target end gets no padding: nothing is ever plotted past it, so padding reserved
  // an empty band — a 70 kg target floored to 68. Still floor/ceil'd to whole kg, since
  // the ticks step by 1 from these bounds. Only when the target really is the extreme; a
  // reading that overshoots it pads normally, because then something IS drawn beyond.
  const yMin = bodyMassMin < bodyMassTarget
    ? Math.floor(bodyMassMin - bodyMassPad)
    : Math.floor(bodyMassTarget);
  const yMax = bodyMassMax > bodyMassTarget
    ? Math.ceil(bodyMassMax + bodyMassPad)
    : Math.ceil(bodyMassTarget);

  // The EXACT date list Body Mass and Caloric Intake already share (see
  // wellnessCalorieChartDates) — clipped forward to the earliest CALORIE entry, not
  // this chart's own earliest weigh-in, which can predate it and did: clipping to
  // bodyMassEntries[0] here left this axis starting well before every bar chart's own
  // leftmost bar, with empty space where they had none. Reused directly for both the
  // axis edges and the tick list below, so this axis can't quote a different window
  // than the one they're actually drawn on.
  const axisDates = wellnessCalorieChartDates(entries);
  const axisFromDate = axisDates.length ? axisDates[0] : windowFromDate;

  const scales = {
    x: {
      type: 'linear',
      // Pinned to the window's own (clipped) edges, not left for Chart.js to auto-fit
      // from whatever's actually plotted: allLabels is sparse (only weigh-ins and
      // weekly projected points), so an auto-fit axis stretched to fit just those
      // points ran a narrower — or wider — span than every category-axis chart above
      // it, which always covers the full clipped window (every calendar day, even
      // empty ones). That's what let the same calendar date land at a different
      // fraction across this chart's width than everywhere else — "today" mid-plot
      // here, far right there.
      //
      // The ±0.5 day pad on top of those edges matters just as much as the edges
      // themselves: every bar chart above this one is a CATEGORY axis with Chart.js's
      // default `offset: true` for bar charts, which reserves half a category's width
      // as margin on EACH side and centers every gridline inside its own 1-day-wide
      // band — so day N sits at pixel fraction (N+0.5)/numDays, not N/numDays. A plain
      // linear axis has no such margin: value=min lands flush at the left edge.
      // Padding this axis's min/max out by half a day reproduces that same
      // band-centering, so a gridline for the same calendar day lands at the same
      // fraction of the plot width on both kinds of axis.
      min: dayOffset(axisFromDate) - 0.5,
      max: dayOffset(windowToDate) + 0.5,
      // min = max, so the labels hold a fixed 45° like the rest of the section instead
      // of Chart.js straightening them whenever they happen to fit — which made this
      // axis flip angle on resize.
      //
      // Ticks forced onto the SAME calendar dates the section's category-axis charts
      // pick (wellnessTickIndices, charts-base.js — Mondays, not an evenly-spaced-by-
      // index pick) — Chart.js's own autoSkip runs a
      // pixel-width heuristic that differs between a category axis and this linear
      // day-offset one, so left to itself this axis could (and did) label different
      // calendar dates than every bar chart above it for the exact same window.
      afterBuildTicks: (axis) => {
        axis.ticks = wellnessTickIndices(axisDates).map((i) => ({ value: dayOffset(axisDates[i]) }));
      },
      // autoSkip false for the same reason wellnessCategoryXScale disables it
      // (charts-base.js): left on, it runs AFTER afterBuildTicks and could thin the 7
      // ticks just chosen above independently of whatever the category axes' own
      // autoSkip passes decide, undoing the point of picking them identically.
      ticks: { maxRotation: 45, minRotation: 45, autoSkip: false, callback: offsetToDateLabel },
    },
    y: {
      min: yMin,
      max: yMax,
      afterFit: fixTrendYAxisWidth,
      // Pinned: once min/max are explicit (needed to lock the BMI axis to this range),
      // Chart.js's auto step-size stopped producing the clean 1 kg steps.
      ticks: { stepSize: 1, callback: maskedUnitTick('kg') },
    },
  };
  if (heightCm !== null) {
    scales.y1 = {
      // Exact, not rounded — that's what keeps this a true pixel-for-pixel twin.
      min: computeBmi(yMin, heightCm),
      max: computeBmi(yMax, heightCm),
      position: 'right',
      afterFit: fixTrendYAxisWidth,
      grid: { drawOnChartArea: false },
      ticks: {
        stepSize: 1,
        // Otherwise Chart.js forces the exact min/max on as extra labels off the step
        // grid — 25.3/33.2 alongside an evenly-stepped 27, 28, 29.
        includeBounds: false,
        callback: maskedUnitTick('BMI', 1),
      },
    };
  }

  // Chart canvas is currently hidden in HTML — skip rendering, but keep everything
  // above so the progress meters and ETA text still populate normally.
  if (ctx) {
    wellnessProjectionChart = upsertChart(wellnessProjectionChart, ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          // Off, like the rest of the section: Chart.js draws it inside the canvas, so a
          // legend here left this plot area ~30px shorter. Series are named in the tooltip.
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales,
      },
    });
  }

}

// The most recent weigh-in on or before each date, carried forward — a BMR is needed
// for every day in the window, not just the days a weigh-in lands on. Days before the
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

// Smallest half-span the axis scales to, so a run of all-deficit days still leaves a
// band above zero to read them against instead of pinning zero to the top.
const ENERGY_BALANCE_AXIS_MIN_KCAL = 200;

// Both bounds round out to a multiple of this, so every label sits on a gridline and
// the halves step identically. niceAxisBound's ladder could land on 800 and leave one
// odd tick among a run of 500s.
const ENERGY_BALANCE_TICK_KCAL = 250;

// The sign carries the whole meaning here — deficit vs surplus — so a positive figure
// shows its + rather than going bare.
function withExplicitSign(value) {
  return value > 0 ? `+${value}` : String(value);
}

let wellnessEnergyBalanceChart = null;

// Against the target line, not just the sign: at or beyond it on the day itself is a
// darker green — a proper hit, not just a near-miss. Short of it falls back to the
// week: a 7-day average that's still made the target reads as real progress despite
// the one off day (green), but an average that's ALSO short means the day isn't an
// outlier, it's the trend, so it reads red like the wrong-side-of-zero case. No target
// means no band to compare against, so it falls back to the sign alone.
function energyBalanceColor(balance, isCut, target, weeklyAvg) {
  const towardTarget = isCut ? balance < 0 : balance > 0;
  if (!towardTarget) return '#dc2626';
  if (target === null) return '#16a34a';
  if (isCut ? balance <= target : balance >= target) return '#166534';
  const weekOnTarget = weeklyAvg !== null && weeklyAvg !== undefined
    && (isCut ? weeklyAvg <= target : weeklyAvg >= target);
  return weekOnTarget ? '#16a34a' : '#dc2626';
}

// The daily deficit the weekly rate implies — the playground's D, from the same
// fat-density constant so the two can't disagree. Already signed to this chart's
// convention. Null at zero or unset, since a line on zero would retrace the axis.
//
// Takes a body mass because a pinned percentage makes the rate depend on it; unpinned the
// argument is ignored and this is the flat WEEKLY_FAT_LOSS_KG it always was.
//
// Routed through calorieTargetDetail (which now folds in PLAN_SLEEP_HOURS — see
// sleepAdjustedDeficitKcal in wellness-math.js) whenever a full profile is on file, so this
// chart's own dash and the Sleep chart's dot can't quote a smaller target deficit than the
// real Eᵢₙ was actually built from. Falls back to the un-adjusted rate with no profile,
// same as calorieTargetDetail's own callers do.
function targetBalanceKcal(bodyMassKg) {
  const detail = calorieTargetDetail(bodyMassKg);
  if (detail !== null) return -Math.round(detail.deficit);
  const weeklyKg = weeklyFatLossKgAt(bodyMassKg);
  if (weeklyKg === null || weeklyKg === 0) return null;
  return -Math.round((weeklyKg * GENERIC_KCAL_PER_KG_FAT) / 7);
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
function renderWellnessEnergyBalanceChart(entries) {
  const ctx = document.getElementById('wellness-energy-balance-chart');

  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const haveProfile = heightCm !== null && age !== null && (sex === 'male' || sex === 'female');

  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  const intakeEntries = entries.filter((e) => (e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null);

  // No profile means no maintenance figure, no weigh-in means no body mass to feed it.
  // Either way the chart shows its explanatory empty state, not a misleading partial.
  const canCompute = haveProfile && bodyMassEntries.length > 0;
  const labels = canCompute ? wellnessWindowDates(intakeEntries) : [];
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

  const adaptPctPerWeek = getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT);
  const adaptPctCap = getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT);

  const balanceData = labels.map((date) => {
    // No food logged is no data, not a day of eating nothing — an empty slot rather
    // than a huge fake deficit.
    if (!intakeByDate.has(date)) return null;

    const intake = Math.round(intakeByDate.get(date));
    const bmr = bmrKcal(bodyMassForDate.get(date), heightCm, age, sex);
    const bmrRounded = Math.round(bmr);
    // ALWAYS the adapted figure (days actually elapsed since the first logged weigh-in,
    // evaluated AT this day), regardless of the Formula Playground's "Basal metabolic
    // rate basis" setting — a fixed comparison, the same way Caloric Intake's two dashed
    // lines are, rather than "whichever basis is active" (which would mislabel itself
    // the moment the setting is plain BMR and this figure stopped being adapted at all).
    const daysOnDiet = daysSinceFirstWeighIn(bodyMassEntries, date);
    const bmrAdaptedRounded = daysOnDiet !== null
      ? Math.round(bmr * (1 - adaptationFraction(daysOnDiet, adaptPctPerWeek, adaptPctCap)))
      : bmrRounded;
    // Whichever of the two the Playground's setting has picked (applyBmrBasis,
    // wellness-math.js) is what actually drives this bar's colour, the axis and the
    // weekly average — the two rows above are shown either way, but only one of them is
    // "official" for the day.
    const maintenance = bmrBasis() === 'bmr_adp' ? bmrAdaptedRounded : bmrRounded;
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

    // The same balance again off each fixed basis — always both, so the two deficits (one
    // assumes maintenance held steady, the other accounts for the metabolic slowdown the
    // diet itself causes) can be read side by side regardless of which one the chart itself
    // is currently scored against.
    const { balance: balanceFromBmr } = dailyEnergyBalanceKcal(
      intake, bmrRounded, activity, tef, sleepHoursByDate.get(date), sleepTarget,
    );
    const { balance: balanceFromBmrAdp } = dailyEnergyBalanceKcal(
      intake, bmrAdaptedRounded, activity, tef, sleepHoursByDate.get(date), sleepTarget,
    );

    detailByDate.set(date, {
      intake, maintenance, activity, tef, tefMeasured, rawBalance, deprivationKcal, balance,
      bmrRounded, bmrAdaptedRounded, balanceFromBmr, balanceFromBmrAdp,
      massG: Math.round((balance / GENERIC_KCAL_PER_KG_FAT) * 1000),
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

  // balanceData already nulls the unlogged days, so they sit out of the mean.
  const weekColumns = bucketedColumnCount(labels);
  const weeklyAvg = weeklyAverageSeries(balanceData, weekColumns);

  wellnessEnergyBalanceChart = upsertChart(wellnessEnergyBalanceChart, ctx, {
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
        weeklyAverageDataset('7-Day Average', weeklyAvg, {}, weekColumns),
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
          font: { size: 12 },
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
              // Last of the body rows, to sit beside the Target row its colour is
              // compared against. A day over maintenance reports a SURPLUS, since
              // calling it a deficit would contradict the + in front of it.
              const actualWordAdp = d.balanceFromBmrAdp > 0 ? 'Surplus' : 'Deficit';
              const actualWordBmr = d.balanceFromBmr > 0 ? 'Surplus' : 'Deficit';
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
                `BMR (basal metabolic rate): ${withExplicitSign(-d.bmrRounded)} kcal`,
                `BMR_adp (adapted BMR by t): ${withExplicitSign(-d.bmrAdaptedRounded)} kcal`,
                `AEE (Activity Energy Expenditure): ${withExplicitSign(-d.activity)} kcal`,
                // Only when there IS one. At the default f = 0 the row would be a
                // permanent "-0", which reads as a term that failed to compute rather
                // than one deliberately left out of the model. Labelled "measured" when
                // it's this day's own Physique figure, "est." when it's the flat
                // TEF_PERCENT_OF_INTAKE fallback — the two can differ by a real amount,
                // so which one produced this bar shouldn't be left ambiguous.
                ...(d.tef > 0 ? [`TEF (Thermic Effect of Food): ${withExplicitSign(-d.tef)} kcal`] : []),
                // Added, not subtracted: on a deficit this is how much less of it became
                // fat loss; on a surplus it's how much MORE was gained, since short sleep
                // drives hunger and cuts NEAT rather than sitting out surplus days. Shown
                // only when a night actually fell short of the target.
                ...(d.deprivationKcal > 0 ? [`SD (Sleep Deprivation Effect): ${withExplicitSign(d.deprivationKcal)} kcal`] : []),
                `Expected Fat: ${withExplicitSign(d.massG)} g`,
                `D (${actualWordAdp} from BMR_adp): ${withExplicitSign(d.balanceFromBmrAdp)} kcal`,
                `D (${actualWordBmr} from BMR): ${withExplicitSign(d.balanceFromBmr)} kcal`,
              ];
              return privacyMode ? lines.map(maskDigits) : lines;
            },
            // The playground's D. Flush left via afterBody, and signed like everything
            // else here so it reads off the axis its dash is drawn on.
            afterBody: (items) => {
              const lines = [];
              if (target !== null) {
                const word = target < 0 ? 'Deficit' : 'Surplus';
                lines.push(`D (Desired ${word}): ${withExplicitSign(target)} kcal/day`);
              }
              const i = items[0]?.dataIndex;
              if (i !== undefined && weeklyAvg[i] !== null) {
                lines.push(`7-Day Average: ${withExplicitSign(Math.round(weeklyAvg[i]))} kcal/day`);
                const weeklyMassG = Math.round(((weeklyAvg[i] * 7) / GENERIC_KCAL_PER_KG_FAT) * 1000);
                lines.push(`7-Day Expected Fat: ${withExplicitSign(weeklyMassG)} g`);
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

// One body mass per logged date, same averaging as renderWellnessProjectionChart's.
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
