// The 'all' range's start when nothing is logged yet: the last 4 weeks.
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

// Every ISO date from fromIso to toIso inclusive; empty on a missing, unparseable or
// inverted range, which callers read as "no data".
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
  renderHealthHeatmap(entries);
  renderHealthBodyMassChart(entries);
  renderHealthSafePaceChart(entries);
  renderHealthIntakeChart(entries);
  renderHealthProteinChart(entries);
  renderHealthFiberChart(entries);
  renderHealthFatChart(entries);
  renderHealthCarbChart(entries);
  renderHealthActivityChart(entries);
  renderHealthSleepChart(entries);
  renderHealthProjectionChart(entries);
  renderHealthEnergyBalanceChart(entries);
}

const isCalorieEntry = (e) => e.category === 'Calories' || e.category === 'Calories; Protein';
const isActivityEntry = (e) => e.category === 'Activity' || e.category === 'Activity; Calories';

// Text in a figure element, digits masked in privacy mode.
function setMaskedText(id, text) {
  document.getElementById(id).textContent = privacyMode ? maskDigits(text) : text;
}

// A Status figure, green when `good`, red when not, uncoloured when null.
function setStatusValue(id, text, good = null) {
  const el = document.getElementById(id);
  el.classList.remove('income', 'expense');
  setMaskedText(id, text);
  if (good !== null) el.classList.add(good ? 'income' : 'expense');
}

// Today's actual-vs-desired for every Health Chart metric, in that panel's order.
function renderTodayGlanceCards(entries) {
  const todayEntries = entries.filter((e) => e.date === isoFromDate(new Date()));
  const addTo = (sum, value) => (sum ?? 0) + value;

  let calories = null;
  let protein = null;
  let fiber = null;
  let fat = null;
  let carb = null;
  let tefKcalToday = null;
  let sleepHours = null;
  let sleepBedMin = null;
  let sleepWakeMin = null;

  todayEntries.forEach((e) => {
    if (isCalorieEntry(e) && e.amount !== null) calories = addTo(calories, e.amount);
    if (e.category === 'Calories; Protein') {
      if (e.amount2 !== null) protein = addTo(protein, e.amount2);
      if (e.fiberG != null) fiber = addTo(fiber, e.fiberG);
      if (e.fatG != null) fat = addTo(fat, e.fatG);
      if (e.carbG != null) carb = addTo(carb, e.carbG);
      if (e.tefKcal != null) tefKcalToday = addTo(tefKcalToday, e.tefKcal);
    }
    if (e.category === 'Sleep' && e.amount !== null) {
      sleepHours = e.amount;
      sleepBedMin = e.sleepBedMin;
      sleepWakeMin = e.sleepWakeMin;
    }
  });

  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
  const bodyMassKg = latestBodyMassKg(entries);

  // Burn by the same per-entry rule as the Activity/Calorie Balance charts, so they agree.
  const activityEntriesToday = todayEntries.filter(isActivityEntry);
  const activityKcal = activityEntriesToday.length
    ? Math.round(activityEntriesToday.reduce((sum, e) => sum + activityEntryKcal(e, bodyMassKg), 0))
    : null;

  // The Physical Activity chart's buckets, by description prefix ("Strength" or "Strength
  // Training"). Informational only, so uncoloured.
  ['cardio', 'neat', 'strength'].forEach((prefix) => {
    const matches = activityEntriesToday.filter((e) => e.description?.toLowerCase().startsWith(prefix));
    let text = '0 min (0 kcal)';
    if (matches.length) {
      const mins = Math.round(matches.reduce((sum, e) => sum + toActivityMinutes(e.amount, e.unit), 0));
      const kcal = Math.round(matches.reduce((sum, e) => sum + activityEntryKcal(e, bodyMassKg), 0));
      text = `${mins} min (${kcal > 0 ? '-' : ''}${kcal} kcal)`;
    }
    setMaskedText(`today-activity-${prefix}-value`, text);
  });

  setStatusEnergyTile(entries, calories, activityKcal, tefKcalToday, sleepHours);

  // Whole grams, floored so the readout never claims a gram not fully there; the colour
  // stays on the true value. Overshooting these bands still counts as a hit.
  const floorG = (g) => (g !== null ? Math.floor(g) : null);
  [
    ['today-protein', protein, getProteinDesiredBandG(entries), withinProteinBand],
    ['today-fiber', fiber, getFiberDesiredBandG(entries), withinFiberBand],
    ['today-fat', fat, getFatDesiredBandG(entries), withinFatBand],
  ].forEach(([idPrefix, g, band, within]) => {
    const good = g !== null && (within(g, band) || g > band.max);
    setTodayGlanceTile(idPrefix, floorG(g), formatProteinDesiredBand(band), 'g', good ? 'income' : 'expense');
  });
  // Carbohydrate under its floor is unscored (neutral), as on its chart.
  const carbBand = getCarbDesiredBandG(entries);
  const carbInBand = carb !== null && withinCarbBand(carb, carbBand);
  const carbOverBand = carb !== null && carb > carbBand.max;
  const carbTone = carbInBand ? 'income' : (carb !== null && !carbOverBand ? 'neutral' : 'expense');
  setTodayGlanceTile('today-carb', floorG(carb), formatProteinDesiredBand(carbBand), 'g', carbTone);

  setTodayGlanceTile('today-sleep-duration', sleepHours, sleepDesired, 'hr', sleepHours !== null && sleepHours >= sleepDesired ? 'income' : 'expense');
  const windowText = sleepBedMin !== null && sleepWakeMin !== null
    ? `${formatClockTime24(sleepBedMin)}-${formatClockTime24(sleepWakeMin)}`
    : '—';
  setMaskedText('today-sleep-window-value', windowText);
  renderTodayMicronutrientGaps();
}

// Nutrients short of their desired amount over the last 7 days (the Micronutrients tables'
// red), as average / desired per day. Supplements included, via aggregateMicronutrientIntake.
function renderTodayMicronutrientGaps() {
  const box = document.getElementById('today-micro-gaps');
  if (!box || typeof aggregateMicronutrientIntake !== 'function') return;
  const { from, to } = healthRangeDates('1w');
  const data = aggregateMicronutrientIntake(from, to);
  const gaps = data.nutrients.filter((n) => n.severity === 'severe' || n.severity === 'mild');
  // Small amounts keep their decimals, large ones read as whole numbers.
  const fmt = (v) => (v >= 100 ? Math.round(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000);
  box.innerHTML = '';
  const row = (label, text, tone) => {
    const div = document.createElement('div');
    div.className = 'widget-row';
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.textContent = privacyMode ? maskDigits(text) : text;
    if (tone) value.classList.add(tone);
    div.append(name, value);
    box.appendChild(div);
  };
  if (!data.daysLogged) return row('—', 'no logged days');
  if (!gaps.length) return row('None', 'all met', 'income');
  // In the desired amount's unit, largest shortfall first.
  gaps
    .map((n) => ({ n, perDay: convertNutrientAmount(n.name, n.perDay, n.unit, n.idealUnit) ?? n.perDay }))
    .sort((a, b) => a.perDay / a.n.ideal - b.perDay / b.n.ideal)
    .forEach(({ n, perDay }) => row(n.displayName, `${fmt(perDay)} / ${n.ideal} ${n.idealUnit}`, 'expense'));
}

// The Status card: today's energy ledger, summing to the same dailyEnergyBalanceKcal the
// Calorie Balance chart plots. Each row lives only here.
function setStatusEnergyTile(entries, caloriesToday, activityKcalToday, tefKcalToday, sleepHoursToday) {
  const todayIso = isoFromDate(new Date());
  const heightCm = getSetting('HEIGHT_CM', null);
  // m, m_avg, BMI and m_d from today's stored Derived cell (health-physique.js); worked
  // out only for a day saved before that column existed.
  const stored = storedMassAsOf(todayIso);
  const bodyMassKg = stored?.m ?? latestBodyMassKg(entries);
  const planMassKg = planBodyMassKg(entries);
  const isCut = bodyMassHealthyIsDownward(entries);
  const towardHealthy = (value, healthy) => (isCut ? value <= healthy : value >= healthy);

  // m (raw, for comparison), m̄ in brackets (what every plan figure reads), then the
  // healthy mass ± the glycogen/water swing, within which a reading is water, not a miss.
  const healthyMassKg = getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
  const mBar = stored?.m_avg ?? planMassKg;
  const swingKg = glycogenSwingKg(bodyMassKg, heightCm, getSettingString('SEX', null));
  const swingText = swingKg === null ? '' : ` ± ${Math.round(swingKg * 10) / 10}`;
  const averageText = mBar !== null ? ` (${mBar})` : '';
  setStatusValue(
    'today-status-m-value',
    bodyMassKg !== null ? `${bodyMassKg}${averageText} / ${healthyMassKg}${swingText} kg` : '—',
    bodyMassKg !== null ? towardHealthy(bodyMassKg, healthyMassKg) : null,
  );

  // BMI of m̄ against the healthy mass's BMI; needs only height.
  const bmi = stored?.BMI ?? (mBar !== null && heightCm !== null ? computeBmi(mBar, heightCm) : null);
  const healthyBmi = heightCm !== null ? computeBmi(healthyMassKg, heightCm) : null;
  const hasBmi = bmi !== null && healthyBmi !== null;
  setStatusValue(
    'today-status-bmi-value',
    hasBmi ? `${bmi} / ${healthyBmi} kg/m²` : '—',
    hasBmi ? towardHealthy(bmi, healthyBmi) : null,
  );

  // Δm (Changed Mass): the Body Mass chart's trend slope at the latest reading, in g/day.
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
  // Tune's weekly fat loss as g/day, signed like Δm (a loss is negative).
  const desiredWeeklyLossKg = weeklyFatLossKgAt(planMassKg);
  const desiredGPerDay = desiredWeeklyLossKg !== null ? Math.round((-desiredWeeklyLossKg / 7) * 1000) : null;
  setStatusValue(
    'today-status-changed-mass-value',
    changedGPerDay !== null
      ? `${withExplicitSign(changedGPerDay)}${desiredGPerDay !== null ? ` / ${withExplicitSign(desiredGPerDay)}` : ''} g/day`
      : '—',
    changedGPerDay !== null && changedGPerDay !== 0 ? (isCut ? changedGPerDay < 0 : changedGPerDay > 0) : null,
  );

  // Intake against desired (under the cap on a cut, over the floor on a bulk). Unlogged reads 0.
  const intakeKcal = caloriesToday ?? 0;
  const calDesired = getCalorieDesired(entries);
  setStatusValue(
    'today-status-intake-value',
    `${Math.round(intakeKcal)} / ${calDesired.kcal} kcal`,
    withinCalorieDesired(intakeKcal, calDesired),
  );

  // Activity, a burn signed negative; none logged reads 0.
  const actDesiredKcal = Math.round(getActivityDesiredKcal(bodyMassKg));
  const activityKcalSoFar = activityKcalToday ?? 0;
  setStatusValue(
    'today-status-activity-value',
    `${activityKcalSoFar > 0 ? '-' : ''}${activityKcalSoFar} / -${actDesiredKcal} kcal`,
    activityKcalSoFar >= actDesiredKcal,
  );

  // Digestion (TEF): measured if logged, else the non-TEF share of intake. More is good on
  // a cut, less on a bulk.
  const digKcal = tefKcalToday !== null
    ? Math.round(tefKcalToday)
    : Math.round(intakeKcal * (1 - tefDivisor()));
  const digDesired = Math.round(calDesired.kcal * (1 - tefDivisor()));
  setStatusValue(
    'today-status-digestion-value',
    `${-digKcal} / ${-digDesired} kcal`,
    isCut ? digKcal >= digDesired : digKcal <= digDesired,
  );

  // Balance and Δm run on Tune's selected BMR basis (from today's stored Derived cell);
  // the plain BMR only gates whether there is one.
  const sleepDesired = getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT);
  const todayBmrFigures = bmrFiguresForDate(todayIso);
  const maintenanceKcal = pickBmrForBasis(todayBmrFigures, 'bmr');
  const bmrSelected = pickBmrForBasis(todayBmrFigures);
  let balanceKcal = null;
  let deprivationKcal = null;
  if (maintenanceKcal !== null) {
    ({ deprivationKcal, balance: balanceKcal } = dailyEnergyBalanceKcal(
      Math.round(intakeKcal), bmrSelected, activityKcalSoFar, digKcal, sleepHoursToday, sleepDesired,
    ));
  }

  // The selected BMR, named by its own key.
  const hasBmr = maintenanceKcal !== null && bmrSelected !== null;
  const bmrKey = selectedBmrKey(todayBmrFigures);
  document.getElementById('today-status-bmr-label').textContent = bmrKey;
  document.getElementById('today-status-bmr-row').title = BMR_DEFINITIONS[bmrKey] ?? '';
  setMaskedText('today-status-bmr-value', hasBmr ? `${-bmrSelected} kcal` : '—');

  // M = BMR + AEE, today's then desired, signed as expenditure.
  setMaskedText('today-status-maintenance-value', hasBmr
    ? `${-Math.round(bmrSelected + activityKcalSoFar)} / ${-Math.round(bmrSelected + actDesiredKcal)} kcal`
    : '—');

  // Sleep Deprivation Effect, against 0 (a full night costs nothing).
  setStatusValue(
    'today-status-deprivation-value',
    deprivationKcal !== null ? `${deprivationKcal} / 0 kcal` : '—',
    deprivationKcal !== null ? !(deprivationKcal > 0) : null,
  );

  const balanceDesiredKcal = desiredBalanceKcal(planMassKg);
  let balanceGood = null;
  if (balanceKcal !== null) {
    balanceGood = balanceDesiredKcal !== null
      ? (isCut ? balanceKcal <= balanceDesiredKcal : balanceKcal >= balanceDesiredKcal)
      : (isCut ? balanceKcal < 0 : balanceKcal > 0);
  }
  setStatusValue(
    'today-status-balance-value',
    balanceKcal !== null ? `${balanceKcal}${balanceDesiredKcal !== null ? ` / ${balanceDesiredKcal}` : ''} kcal` : '—',
    balanceGood,
  );

  // Δm today's Balance implies (fat-equivalent kcal/kg), against the desired daily change.
  const dmActual = balanceKcal !== null ? Math.round((balanceKcal / GENERIC_KCAL_PER_KG_FAT) * 1000) : null;
  setMaskedText('today-status-deltam-value', dmActual !== null
    ? `${dmActual}${desiredGPerDay !== null ? ` / ${desiredGPerDay}` : ''} g`
    : '—');

  // ETA: the plan's forecast (calcProjection), as on the Progress card.
  const projection = calcProjection(entries);
  const etaText = projection?.status === 'reached' ? '0 days'
    : projection?.status === 'ok'
      ? `${projection.daysToHealthy} ${projection.daysToHealthy === 1 ? 'day' : 'days'} (${shortYearDate(isoFromDate(projection.etaDate))})`
      : '—';
  setMaskedText('today-status-eta-value', etaText);
}

// `desired` is a number or a preformatted band string. `tone`: 'income', 'expense' or 'neutral'.
function setTodayGlanceTile(idPrefix, value, desired, unit, tone) {
  const el = document.getElementById(`${idPrefix}-value`);
  el.classList.remove('income', 'expense', 'neutral');
  setMaskedText(`${idPrefix}-value`, `${value !== null ? value : '—'} / ${desired} ${unit}`);
  if (value !== null) el.classList.add(tone);
}

// Fixed lengths ending today, Market's notation (rangeStartDate, finance-market-chart.js).
// Shared by Chart and Insight.
const HEALTH_RANGES = [
  { slug: '1w', label: '1w', days: 7 },
  { slug: '1m', label: '1m', months: 1 },
  { slug: '3m', label: '3m', months: 3 },
  { slug: '6m', label: '6m', months: 6 },
  { slug: '1y', label: '1y', months: 12 },
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

// The one window every Health Chart plots, bar State Trend & Forecast's history.
function healthDateRange() {
  return healthRangeDates(healthRangeSlug);
}

// One range control for the panel; a change redraws every chart, Rotations included.
function initHealthRangeControl() {
  const pick = (slug) => {
    healthRangeSlug = slug;
    renderRangeButtons('health-range', HEALTH_RANGES, healthRangeSlug, pick);
    renderHealthCharts(physiqueAsHealthEntries());
    renderProteinRotationChart(healthDateRange());
    renderProteinRotationChart(healthDateRange(), 'nutrition', PROTEIN_ROTATION_NUTRITION_IDS);
    renderActivityRotationChart(healthDateRange());
    renderActivityRotationChart(healthDateRange(), 'activity', ACTIVITY_ROTATION_ACTIVITY_IDS);
  };
  renderRangeButtons('health-range', HEALTH_RANGES, healthRangeSlug, pick);
}

// The range's dates, clipped forward to this metric's first logged day so a chart doesn't
// open on empty days. An inverted range gives no days ("nothing to draw").
function healthWindowDates(matchingEntries) {
  const { from, to } = healthDateRange();
  const window = datesInRange(from, to);
  if (!window.length || matchingEntries.length === 0) return window;
  const earliest = matchingEntries.reduce((min, e) => (e.date < min ? e.date : min), matchingEntries[0].date);
  const start = earliest > window[0] ? earliest : window[0];
  return window.filter((d) => d >= start);
}

// The Calories/Calories; Protein rows the Caloric Intake chart is built from.
function calorieLogEntries(entries) {
  return entries.filter((e) => isCalorieEntry(e) && e.amount !== null);
}

// The one x-axis every dated Health chart plots on, from the first calorie log or
// body-mass reading in range, so their gridlines land on the same dates.
function healthCalorieChartDates(entries) {
  const bodyMassEntries = entries.filter((e) => e.category === 'Body Mass' && e.amount !== null);
  return healthWindowDates([...calorieLogEntries(entries), ...bodyMassEntries]);
}

// Down on a cut, up on a bulk; via getCalorieDesiredKind so this and Caloric Intake's
// max/min share one read of the healthy mass.
function bodyMassHealthyIsDownward(entries) {
  return getCalorieDesiredKind(entries) === 'max';
}

// Boer 1984 (Am J Physiol 247:F632) lean body mass, regressed against measured lean mass.
// Kept as coefficients because Katch-McArdle BMR is 21.6 × this, and
// maintenanceAffineCoefficients needs the per-kg and fixed parts apart.
const BOER_LBM_COEFFICIENTS = {
  male: { perKg: 0.407, perCm: 0.267, constant: -19.2 },
  female: { perKg: 0.252, perCm: 0.473, constant: -48.3 },
};

function boerLeanBodyMassCoefficients(sex) {
  return sex === 'male' ? BOER_LBM_COEFFICIENTS.male : BOER_LBM_COEFFICIENTS.female;
}

function evaluateLbmCoefficients(c, bodyMassKg, heightCm) {
  return c.perKg * bodyMassKg + c.perCm * heightCm + c.constant;
}

function boerLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  return evaluateLbmCoefficients(boerLeanBodyMassCoefficients(sex), bodyMassKg, heightCm);
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
  return evaluateLbmCoefficients(leanBodyMassCoefficients(sex, heightCm), bodyMassKg, heightCm);
}

// Defaults of Tune's glycogen block (s, g_musc, g_liver, r).
const GLYCOGEN_SKELETAL_FRAC_DEFAULT = 45; // % of LBM
const GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT = 14; // g glycogen / kg muscle
const GLYCOGEN_LIVER_G_DEFAULT = 100; // g
const GLYCOGEN_WATER_RATIO_DEFAULT = 3; // g H2O / g glycogen

// The swing every display uses: the saved GLYCOGEN_SWING_KG setting (it barely moves),
// else worked out from the given body.
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

// ΔM_gly = (g_musc × m_musc + g_liver) water-bound at r, in kg, at Tune's defaults: the
// day-to-day swing glycogen and its water alone can explain.
function computeGlycogenSwingKg(bodyMassKg, heightCm, sex) {
  if (bodyMassKg === null || bodyMassKg === undefined || heightCm === null || heightCm === undefined) return null;
  const lbmKg = leanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(lbmKg) || lbmKg <= 0) return null;
  const muscleKg = lbmKg * (GLYCOGEN_SKELETAL_FRAC_DEFAULT / 100);
  if (muscleKg <= 0) return null;
  const glycogenG = GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT * muscleKg + GLYCOGEN_LIVER_G_DEFAULT;
  return (glycogenG * (1 + GLYCOGEN_WATER_RATIO_DEFAULT)) / 1000;
}

// The mass that counts as "arrived": the healthy mass pushed past by the glycogen swing in
// the direction of travel, so a water day can't land on the wrong side. Shared by
// calcProjection and Tune; the raw healthy mass when the swing can't be estimated.
function arrivalHealthyKg(healthyKg, bodyMassKg, heightCm, sex, isDownward) {
  const swingKg = glycogenSwingKg(bodyMassKg, heightCm, sex);
  return swingKg === null ? healthyKg : healthyKg + (isDownward ? -swingKg : swingKg);
}

// Step candidates for macro gram axes; same max-gridlines guard as the kg axis.
const MACRO_G_TICK_STEPS = [5, 10, 25, 50, 100, 200, 500, 1000];
// A day is graded by r, the share of the desired change it made (1 the desired figure, 0
// none, below 0 the wrong way), on five steps. The L_p-day average's r lifts a day to one
// step under the week's grade, so one off day in a good week reads as a dip.
const DESIRED_GRADES = [
  { name: 'Beat desired', min: 1.1, color: '--chart-good-high' },
  { name: 'Desired met', min: 0.85, color: '--chart-good' },
  { name: 'Near desired', min: 0.6, color: '--chart-near' },
  { name: 'Short of desired', min: 0.3, color: '--chart-warn' },
  { name: 'Missed desired', min: -Infinity, color: '--chart-bad' },
];

function desiredGradeIndex(r) {
  if (r === null || r === undefined || !Number.isFinite(r)) return null;
  return DESIRED_GRADES.findIndex((g) => r >= g.min);
}

// {name, color} for a day's r and its week's, or null with no r to grade.
function desiredGrade(r, weekR = null) {
  const day = desiredGradeIndex(r);
  if (day === null) return null;
  const week = desiredGradeIndex(weekR);
  const grade = DESIRED_GRADES[week === null ? day : Math.min(day, week + 1)];
  return { name: grade.name, color: chartColor(grade.color) };
}

// desiredGrade's colour blended along the steps instead of fixed per step: each step's
// colour sits at its min (Missed at r = 0), and the week's lift raises r to that floor.
function desiredGradeBlend(r, weekR = null) {
  const week = desiredGradeIndex(weekR);
  const floor = week === null ? -Infinity : (DESIRED_GRADES[week + 1]?.min ?? -Infinity);
  const x = Math.max(r, floor);
  const stops = DESIRED_GRADES.map((g) => ({ at: Math.max(g.min, 0), color: chartColor(g.color) }));
  if (x >= stops[0].at) return stops[0].color;
  if (x <= 0) return stops[stops.length - 1].color;
  const i = stops.findIndex((s) => x >= s.at);
  return lerpHex(stops[i].color, stops[i - 1].color, (x - stops[i].at) / (stops[i - 1].at - stops[i].at));
}

// desiredGrade named by its step, coloured along the blend.
function desiredGradeBlended(r, weekR = null) {
  const grade = desiredGrade(r, weekR);
  return grade && { ...grade, color: desiredGradeBlend(r, weekR) };
}

function desiredGradeLegend() {
  return DESIRED_GRADES.map((g) => ({ name: g.name, color: chartColor(g.color) }));
}

// r for a day's intake: the share of the desired balance D it leaves, against the
// maintenance M = desired intake − D that day's desired figure is built on, so it reads
// exactly as Calorie Balance's balance ÷ D. With no D, the intake against the cap or floor.
function intakeDesiredR(kcal, dayDesired, balanceKcal) {
  if (kcal === null || kcal === undefined) return null;
  // D on the other side of zero from the cap or floor's direction can't be read as a share.
  if (!balanceKcal || (balanceKcal < 0) !== dayDesired.isMax) return dayDesired.isMax ? dayDesired.kcal / kcal : kcal / dayDesired.kcal;
  const maintenance = dayDesired.kcal - balanceKcal;
  return (kcal - maintenance) / balanceKcal;
}

// Caloric Intake's axis (health-chart-intake.js): headroom over the logged range, with a
// floor so near-identical days don't sit flush against the top.
const CALORIE_AXIS_PAD_FRACTION = 0.15;
const CALORIE_AXIS_MIN_PAD_KCAL = 120;
// Rounds the top to readable ticks (1,650 rather than 1,663).
const CALORIE_AXIS_STEP_KCAL = 50;
// Coarser, so a desired figure that widens the axis holds it still as it moves.
const CALORIE_AXIS_DESIRED_STEP_KCAL = 250;

// From 0 kcal, framed on what was logged, not the desired figure, so the ruler doesn't
// move with what it measures. Widened, never re-padded, when a desired cap lies beyond it.
function calorieAxisBounds(loggedValues, desiredValues) {
  // Falls back to 0 when every entry is hidden.
  const framing = loggedValues.length ? loggedValues : desiredValues.length ? desiredValues : [0];
  const lo = Math.min(...framing);
  const hi = Math.max(...framing);
  const pad = Math.max(CALORIE_AXIS_MIN_PAD_KCAL, (hi - lo) * CALORIE_AXIS_PAD_FRACTION);

  const roundUp = (v, step) => Math.ceil(v / step) * step;

  return {
    min: 0,
    max: Math.max(roundUp(hi + pad, CALORIE_AXIS_STEP_KCAL), roundUp(Math.max(0, ...desiredValues), CALORIE_AXIS_DESIRED_STEP_KCAL)),
  };
}

function lerpHex(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${rgb.join(',')})`;
}

// Dot radius that shrinks with the range, like bar width: at most 80% of a day's slot.
const POINT_RADIUS_SLOT_FRACTION = 0.4;

function fitPointRadius(maxRadius) {
  return (ctx) => {
    const chart = ctx.chart;
    const width = chart.chartArea ? chart.chartArea.width : chart.width;
    const slot = width / Math.max(1, chart.data.labels.length);
    return Math.max(1, Math.min(maxRadius, slot * POINT_RADIUS_SLOT_FRACTION));
  };
}

// Border thins with the dot so small dots keep their colour.
function fitPointBorderWidth(maxRadius, maxBorder) {
  const radius = fitPointRadius(maxRadius);
  return (ctx) => Math.min(maxBorder, radius(ctx) / 3);
}

// ~100 steps/min is walking pace; WORKOUT_STEPS_PER_MIN overrides it everywhere at once.
// Defined here, not in health-activity-estimator.js, because this file loads first.
const WORKOUT_STEPS_PER_MIN_DEFAULT = 100;

// Steps and timed entries onto one scale, in minutes.
function toActivityMinutes(amount, unit) {
  const u = (unit || '').toLowerCase().trim();
  if (u === 'steps' || u === 'step') {
    return Math.round(amount / getSetting('WORKOUT_STEPS_PER_MIN', WORKOUT_STEPS_PER_MIN_DEFAULT));
  }
  if (u === 'hr' || u === 'hour' || u === 'hours') return Math.round(amount * 60);
  return amount; // 'min' or unknown — use as-is
}

// bodyMassKg / heightM², to one decimal.
function computeBmi(bodyMassKg, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((bodyMassKg / (heightM * heightM)) * 10) / 10;
}

// The inverse: the body mass a BMI implies at this height (Tune's healthy-BMI box).
function bodyMassKgFromBmi(bmi, heightCm) {
  const heightM = heightCm / 100;
  return Math.round(bmi * heightM * heightM * 10) / 10;
}

// The one healthy BMI band: Tune's verdict on a chosen healthy mass, and the green the Body
// Mass chart shades (BMI_HEALTHY_BAND). Both ends matter, so underweight is flagged too.
const BMI_HEALTHY_MIN = 20;
const BMI_HEALTHY_MAX = 25;

function bmiVerdict(bmi) {
  if (bmi < 16) return { text: 'severely underweight', outside: true };
  if (bmi < BMI_HEALTHY_MIN) return { text: 'underweight', outside: true };
  if (bmi <= BMI_HEALTHY_MAX) return { text: `in the healthy ${BMI_HEALTHY_MIN}–${BMI_HEALTHY_MAX} band`, outside: false };
  if (bmi < 30) return { text: 'overweight', outside: true };
  if (bmi < 35) return { text: 'obese (class I)', outside: true };
  return { text: 'obese (class II+)', outside: true };
}

// The latest body mass on or before each date, so every day has one for its BMR; days
// before the first reading take that first reading.
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

// The sign carries the meaning (deficit vs surplus), so a positive figure shows its +.
function withExplicitSign(value) {
  return value > 0 ? `+${value}` : String(value);
}

// The daily deficit Tune's D implies, signed negative for a deficit; null at zero or unset.
// Via calorieDesiredDetail (sleep-adjusted) with a full profile, so it matches the real
// desired intake; else the plain weekly rate at this body mass.
function desiredBalanceKcal(bodyMassKg) {
  const detail = calorieDesiredDetail(bodyMassKg);
  if (detail !== null) return -Math.round(detail.deficit);
  const weeklyKg = weeklyFatLossKgAt(bodyMassKg);
  if (weeklyKg === null || weeklyKg === 0) return null;
  return -Math.round((weeklyKg * GENERIC_KCAL_PER_KG_FAT) / 7);
}

// One body mass per logged date, same-day readings averaged.
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
