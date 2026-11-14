// Health Insight building blocks shared by every mode (the profile block, the
// window aggregator, the report renderer), plus the Wellness mode itself.
// health-insight.js owns the panel.
//
// ageFromBirthDate is also used by health-math.js and the charts.

// Whole years old as of `asOf` (today by default), so a per-day figure can use
// the age on that day; null if BIRTH_DATE isn't set or can't be parsed.
function ageFromBirthDate(birthDateStr, asOf = new Date()) {
  if (!birthDateStr) return null;
  // Local midnight: new Date('YYYY-MM-DD') is UTC, the day before in the Americas.
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(birthDateStr.trim()) ? dateFromIso(birthDateStr.trim()) : new Date(birthDateStr);
  if (Number.isNaN(birth.getTime())) return null;

  let age = asOf.getFullYear() - birth.getFullYear();
  const beforeBirthdayThatYear = asOf.getMonth() < birth.getMonth()
    || (asOf.getMonth() === birth.getMonth() && asOf.getDate() < birth.getDate());
  if (beforeBirthdayThatYear) age--;
  return age;
}

// Age, sex, height, latest body mass and BMI, from Settings and the latest
// reading, so every mode describes the same person.
function gatherProfileSnapshot() {
  const heightCm = getSetting('HEIGHT_CM', null);
  const bodyMassKg = latestBodyMassKg(physiqueAsHealthEntries());

  return {
    age: ageFromBirthDate(getSettingString('BIRTH_DATE', null)),
    sex: getSettingString('SEX', null),
    heightCm,
    bodyMassKg,
    bmi: (heightCm !== null && bodyMassKg !== null) ? computeBmi(bodyMassKg, heightCm) : null,
  };
}

// The snapshot as prompt lines. Missing fields read "not set" rather than being
// dropped, so the model sees what it doesn't know.
function formatProfileLines(p, bodyMassHealthyKg = null) {
  const healthySuffix = bodyMassHealthyKg !== null ? ` (desired: ${bodyMassHealthyKg} kg)` : '';
  // Tune's order: sex, height, age, then body mass.
  return [
    `Sex: ${p.sex !== null ? p.sex : 'not set'}`,
    `Height: ${p.heightCm !== null ? `${p.heightCm} cm` : 'not set'}`,
    `Age: ${p.age !== null ? p.age : 'not set'}`,
    `Current body mass: ${p.bodyMassKg !== null ? `${p.bodyMassKg} kg${healthySuffix}` : 'not logged'}`,
    `BMI: ${p.bmi !== null ? p.bmi : 'not available (needs height and a logged body mass)'}`,
  ];
}

function bodyMassHealthySettingKg() {
  return getSetting('BODY_MASS_HEALTHY_KG', BODY_MASS_HEALTHY_KG_DEFAULT);
}

// Today's profile lines with the healthy body mass, as most modes send them.
function currentProfileLines() {
  return formatProfileLines(gatherProfileSnapshot(), bodyMassHealthySettingKg());
}

// The trimmed question, else the mode's default (modes that inline their question).
function insightQuestionOrDefault(question, fallback) {
  return (question && question.trim()) ? question.trim() : fallback;
}

// The days just before [fromIso, toIso], the same length, for period-on-period comparisons.
function previousDateRange(fromIso, toIso) {
  const current = datesInRange(fromIso, toIso);
  if (!current.length) return [];

  const prevTo = dateFromIso(fromIso);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevTo.getDate() - (current.length - 1));
  return datesInRange(isoFromDate(prevFrom), isoFromDate(prevTo));
}

// Per-day averages of the day log over `dates` (a datesInRange or
// previousDateRange result), so both periods aggregate identically.
function aggregateWindow(dates) {
  const from = dates[0];
  const to = dates[dates.length - 1];
  const addTo = (map, key, value) => map.set(key, (map.get(key) || 0) + value);
  const addToNested = (outer, key, date, value) => {
    if (!outer.has(key)) outer.set(key, new Map());
    addTo(outer.get(key), date, value);
  };
  const roundedAvg = (byDate) => (byDate.size ? Math.round(avg(byDate)) : null);

  const caloriesByDate = new Map();
  const proteinByDate = new Map();
  const activityByDate = new Map();
  const activityKcalByDate = new Map();
  // Per description (NEAT / Resistance / Cardio …), so each type's trend shows.
  const activityByDescriptionByDate = new Map();
  const activityKcalByDescriptionByDate = new Map();
  const sleepByDate = new Map();

  const datedEntries = physiqueAsHealthEntries();
  const bodyMassKg = latestBodyMassKg(datedEntries);

  datedEntries
    .filter((e) => e.date >= from && e.date <= to)
    .forEach((e) => {
      if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
        addTo(caloriesByDate, e.date, e.amount);
      }
      if (e.category === 'Calories; Protein' && e.amount2 !== null) {
        addTo(proteinByDate, e.date, e.amount2);
      }
      if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
        const mins = toActivityMinutes(e.amount, e.unit);
        const description = e.description || 'Other';
        addTo(activityByDate, e.date, mins);
        addToNested(activityByDescriptionByDate, description, e.date, mins);
        // Its own amount2, else its minutes at the Walk MET (health-math.js).
        const kcal = activityEntryKcal(e, bodyMassKg);
        addTo(activityKcalByDate, e.date, kcal);
        addToNested(activityKcalByDescriptionByDate, description, e.date, kcal);
      }
      if (e.category === 'Sleep' && e.amount !== null) {
        addTo(sleepByDate, e.date, e.amount);
      }
    });

  const activityByDescription = {};
  activityByDescriptionByDate.forEach((byDate, description) => {
    activityByDescription[description] = {
      avgMins: Math.round(avg(byDate)),
      daysLogged: byDate.size,
      avgKcal: roundedAvg(activityKcalByDescriptionByDate.get(description)),
    };
  });

  return {
    avgCalories: roundedAvg(caloriesByDate),
    caloriesDaysLogged: caloriesByDate.size,
    avgProtein: roundedAvg(proteinByDate),
    proteinDaysLogged: proteinByDate.size,
    avgActivityMins: roundedAvg(activityByDate),
    activityDaysLogged: activityByDate.size,
    avgActivityKcal: roundedAvg(activityKcalByDate),
    activityByDescription,
    avgSleepHours: sleepByDate.size ? Math.round(avg(sleepByDate) * 10) / 10 : null,
    sleepDaysLogged: sleepByDate.size,
  };
}

// Fat, fiber and carbohydrate come from the priced Nutrition totals
// (aggregateMicronutrientIntake), not a second nutrient list.
const WELLNESS_FAT_NUTRIENT = 'Total lipid (fat)';
const WELLNESS_FIBER_NUTRIENT = 'Fiber, total dietary';
const WELLNESS_CARB_NUTRIENT = 'Carbohydrate, by difference';
const EMPTY_MICRONUTRIENT_INTAKE = { nutrients: [], daysLogged: 0, contributing: [], missing: [] };

function findMicronutrient(data, name) {
  return data.nutrients.find((n) => n.name === name) || null;
}

// One macro's per-day average now and in the previous period, and its fixed
// FDA Daily Value (shown even when nothing was priced).
function macroInsightFigures(current, previous, name) {
  const cur = findMicronutrient(current, name);
  const prev = findMicronutrient(previous, name);
  const desired = nutrientDailyDesired()[name];
  return { avg: cur ? cur.perDay : null, prevAvg: prev ? prev.perDay : null, desired: desired ? desired.amount : null };
}

function gatherInsightMetrics(fromIso, toIso) {
  const dates = datesInRange(fromIso, toIso);
  const lookbackDays = dates.length;
  const current = aggregateWindow(dates);
  const previousDates = previousDateRange(fromIso, toIso);
  const previous = aggregateWindow(previousDates);
  const entries = physiqueAsHealthEntries();

  // The State Trend & Forecast chart's own trajectory (health-math.js).
  const projection = calcProjection(entries);

  const microCurrent = aggregateMicronutrientIntake(fromIso, toIso);
  const microPrevious = previousDates.length
    ? aggregateMicronutrientIntake(previousDates[0], previousDates[previousDates.length - 1])
    : EMPTY_MICRONUTRIENT_INTAKE;
  const fat = macroInsightFigures(microCurrent, microPrevious, WELLNESS_FAT_NUTRIENT);
  const fiber = macroInsightFigures(microCurrent, microPrevious, WELLNESS_FIBER_NUTRIENT);
  const carb = macroInsightFigures(microCurrent, microPrevious, WELLNESS_CARB_NUTRIENT);

  return {
    lookbackDays,
    profile: gatherProfileSnapshot(),
    bodyMassHealthyKg: bodyMassHealthySettingKg(),
    projection,

    avgCalories: current.avgCalories,
    prevAvgCalories: previous.avgCalories,
    // {kcal, kind}: the prompt names it "max" or "min", since the figure is directional.
    calorieDesired: getCalorieDesired(entries),
    caloriesDaysLogged: current.caloriesDaysLogged,

    avgProtein: current.avgProtein,
    prevAvgProtein: previous.avgProtein,
    // The band ("131-164"), not a midpoint; ASCII hyphen for the prompt.
    proteinDesired: formatProteinDesiredBand(getProteinDesiredBandG(entries), '-'),
    proteinDaysLogged: current.proteinDaysLogged,

    avgActivityMins: current.avgActivityMins,
    prevAvgActivityMins: previous.avgActivityMins,
    activityDesired: Math.round(getActivityDesiredMin(latestBodyMassKg(entries))),
    activityDaysLogged: current.activityDaysLogged,
    avgActivityKcal: current.avgActivityKcal,
    prevAvgActivityKcal: previous.avgActivityKcal,
    activityByDescription: current.activityByDescription,
    prevActivityByDescription: previous.activityByDescription,

    avgSleepHours: current.avgSleepHours,
    prevAvgSleepHours: previous.avgSleepHours,
    sleepDesired: getSetting('SLEEP_DESIRED_HOURS', SLEEP_DESIRED_HOURS_DEFAULT),
    sleepDaysLogged: current.sleepDaysLogged,

    // Days here are priced (Calculate-derived) days, which can trail caloriesDaysLogged.
    avgFat: fat.avg,
    prevAvgFat: fat.prevAvg,
    fatDesired: fat.desired,
    fatDaysLogged: microCurrent.daysLogged,

    avgFiber: fiber.avg,
    prevAvgFiber: fiber.prevAvg,
    fiberDesired: fiber.desired,
    fiberDaysLogged: microCurrent.daysLogged,

    avgCarb: carb.avg,
    prevAvgCarb: carb.prevAvg,
    carbDesired: carb.desired,
    carbDaysLogged: microCurrent.daysLogged,
  };
}

// Covers every calcProjection() status, so the line never shows undefined/NaN.
function formatTrajectoryLine(projection) {
  if (!projection) return 'Body mass trajectory: not enough reading history yet to estimate a trend.';
  if (projection.status === 'reached') return 'Body mass trajectory: already at desired body mass.';
  if (projection.status === 'no-change') return 'Body mass trajectory: current habits project no meaningful body mass change.';
  if (projection.status === 'wrong-direction') return 'Body mass trajectory: current trend is moving away from the desired mass, not toward it.';
  // Right direction, but the average intake is maintenance short of the desired mass.
  if (projection.status === 'asymptote') {
    return `Body mass trajectory: current habits move toward the desired mass but level off around ${Math.round(projection.equilibriumKg * 10) / 10} kg, short of it — reaching it needs a change in intake or activity.`;
  }
  if (projection.status !== 'ok') return 'Body mass trajectory: not enough data to estimate a trend.';

  const kgPerWeek = Math.abs(projection.slope * 7).toFixed(1);
  const direction = projection.slope < 0 ? 'losing' : 'gaining';
  // "currently": the rate decays as BMR falls with body mass.
  return `Body mass trajectory: currently ${direction} ~${kgPerWeek} kg/week (slowing as body mass drops), estimated to reach the ${projection.bodyMassHealthy} kg desired mass around ${isoFromDate(projection.etaDate)} (~${projection.daysToHealthy} days) — generic population-average estimate.`;
}

// " [only N/M days logged]" when coverage is partial.
function insightCoverageNote(daysLogged, lookbackDays) {
  return daysLogged < lookbackDays ? ` [only ${daysLogged}/${lookbackDays} days logged]` : '';
}

function insightBurnedNote(kcal) {
  return kcal !== null ? `, ${kcal} kcal/day burned` : '';
}

// One line per activity description, so the model sees the mix of types.
function formatActivityBreakdownLines(m) {
  return Object.keys(m.activityByDescription)
    .sort()
    .map((description) => {
      const cur = m.activityByDescription[description];
      const prev = m.prevActivityByDescription[description];
      const trend = prev ? ` — previous period: ${prev.avgMins} min/day${insightBurnedNote(prev.avgKcal)}` : ' — previous period: not logged';
      return `Avg activity — ${description}: ${cur.avgMins} min/day${insightBurnedNote(cur.avgKcal)}${trend}${insightCoverageNote(cur.daysLogged, m.lookbackDays)}`;
    });
}

function formatInsightPrompt(m) {
  // `word` names the bracketed figure: 'desired', 'reference', or calories' directional 'max'/'min'.
  const line = (label, value, unit, desired, daysLogged, prevValue, word = 'desired') => {
    if (value === null) return `${label}: not logged this period`;
    const trend = prevValue !== null ? ` — previous period: ${prevValue}${unit}` : '';
    return `${label}: ${value}${unit} (${word}: ${desired}${unit})${trend}${insightCoverageNote(daysLogged, m.lookbackDays)}`;
  };

  // Its own shape: minutes plus a second, desired-less figure (kcal burned).
  const activityTotalLine = (() => {
    if (m.avgActivityMins === null) return 'Avg activity total: not logged this period';
    const trend = m.prevAvgActivityMins !== null ? ` — previous period: ${m.prevAvgActivityMins} min/day${insightBurnedNote(m.prevAvgActivityKcal)}` : '';
    return `Avg activity total: ${m.avgActivityMins} min/day${insightBurnedNote(m.avgActivityKcal)} (desired: ${m.activityDesired} min/day)${trend}${insightCoverageNote(m.activityDaysLogged, m.lookbackDays)}`;
  })();

  // In the Wellness charts' order.
  return [
    ...formatProfileLines(m.profile, m.bodyMassHealthyKg),
    formatTrajectoryLine(m.projection),
    line('Avg calorie intake', m.avgCalories, ' kcal/day', m.calorieDesired.kcal, m.caloriesDaysLogged, m.prevAvgCalories, m.calorieDesired.kind),
    line('Avg protein intake', m.avgProtein, ' g/day', m.proteinDesired, m.proteinDaysLogged, m.prevAvgProtein),
    line('Avg dietary fiber intake', m.avgFiber, ' g/day', m.fiberDesired, m.fiberDaysLogged, m.prevAvgFiber),
    line('Avg fat intake', m.avgFat, ' g/day', m.fatDesired, m.fatDaysLogged, m.prevAvgFat, 'reference'),
    line('Avg carbohydrate intake', m.avgCarb, ' g/day', m.carbDesired, m.carbDaysLogged, m.prevAvgCarb, 'reference'),
    activityTotalLine,
    ...formatActivityBreakdownLines(m),
    line('Avg sleep', m.avgSleepHours, ' hr/day', m.sleepDesired, m.sleepDaysLogged, m.prevAvgSleepHours),
  ].join('\n');
}

const INSIGHT_SYSTEM_PROMPT = `You are a supportive personal health coach reviewing someone's own self-tracked data. You are not a doctor — do not give medical diagnoses or prescribe treatment.

You'll be given their age, sex, height, BMI, current body mass vs. desired, their average calorie/protein/dietary fiber/fat/carbohydrate intake, activity, and sleep for a recent period compared to both their own personal figure and the immediately preceding period of the same length (so you can tell if things are improving or slipping, not just where they stand today), and a body-mass-trajectory line (their actual estimated rate of progress toward their desired mass). Activity is also broken down by type (e.g. NEAT, Resistance, Cardio), each with its own minutes/day and trend versus the previous period, beneath the combined "Avg activity total" line — use this to comment on the balance between activity types (e.g. cardio-only with no resistance training, or a specific type dropping off) rather than just the total minutes. Some values may be missing or under-logged (marked "not set", "not logged this period", or "[only N/X days logged]") — treat those as missing data to note, never as zero. The protein desired figure may be given as a range (e.g. "desired: 131-164 g/day"): anywhere inside that range meets it, and both falling below its low end and exceeding its top end miss it.

Dietary fiber, fat and carbohydrate are labeled differently from the other desired figures. Dietary fiber's "(desired: 28 g/day)" is a floor: at or above it is on track, below it is a real gap worth naming, especially alongside a calorie deficit. Fat's and carbohydrate's are both "(reference: X g/day)", a general adult reference figure to mention only in passing, not a pass/fail line — don't score someone against it the way you would protein or dietary fiber. A carbohydrate average that's running well past its reference figure is worth a brief mention of bloating/water retention from the glycogen it gets stored as (which shows up as scale weight, not fat) — but only as a passing physiological note, not as a diet mistake to fix, since there's no ADA/IOM ceiling being violated the way going over a calorie "max" would be. All three figures come from actually-logged, ingredient-priced meals, which can lag behind what's logged for calories/protein — "not logged this period" here may just mean those meals haven't been priced for fiber/fat/carbohydrate yet, not that nothing was eaten, so don't state a confident zero.

Calorie intake's desired figure is DIRECTIONAL, not a point to land on, and the label says which side: "(max: 1388 kcal/day)" is a ceiling: they are aiming to lose body mass, so at or under it is on track and over it is off track. "(min: 2600 kcal/day)" is a floor: they are aiming to gain body mass, so at or over it is on track and under it is off track. Never treat a day under a "min" as a win or read it as a deficit worth praising, and never describe being under a "max" as falling short. If the average sits far on the good side of a max, that is a deeper deficit than the desired pace called for, not a failure — comment on whether the pace looks sustainable (especially alongside protein and sleep) rather than scoring it as a miss.

Write a short plain-text report with exactly these four sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only. Within a section, if you're naming more than one distinct point (several things going well, several things needing attention), put each one on its own line — never run multiple points together in one paragraph, with or without a bullet character.

Overview: one or two sentences on the overall picture, grounded in the body mass trajectory line, not just the current period's numbers in isolation.
Going well: what's on track, including any improvement vs. the previous period.
Needs attention: what's off track, including any decline vs. the previous period. Specifically check whether calories are in a deficit while protein is below desired — if so, call out that this risks losing muscle instead of fat, which slows real (fat) progress even when the scale moves.
Suggestions: 2-4 concrete, specific next steps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.

If an additional question from the user is included after the data, also answer it directly in a fifth section, "Answer: text".

Keep the whole report under 250 words.`;

const INSIGHT_SECTION_LABELS = ['Overview', 'Going well', 'Needs attention', 'Investment outlook', 'Suggestions', 'Answer'];

// One <p> per non-blank line, with a known section label bolded. Never innerHTML:
// this is untrusted model output.
function renderInsightText(container, text, labels = INSIGHT_SECTION_LABELS) {
  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const p = document.createElement('p');
    const label = labels.find((l) => line.startsWith(`${l}:`));
    if (label) {
      const strong = document.createElement('strong');
      strong.textContent = `${label}:`;
      p.appendChild(strong);
      p.appendChild(document.createTextNode(line.slice(label.length + 1)));
    } else {
      p.textContent = line;
    }
    container.appendChild(p);
  });
}
