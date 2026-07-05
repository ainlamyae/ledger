// Shared building blocks for the Health Insight panel, plus everything specific
// to its Wellness mode. The profile snapshot, the window aggregator and the
// model-output renderer here are used by all three modes (food-insight.js,
// activity-insight.js); the metrics/prompt pair below is Wellness's own.
// insight-panel.js owns the panel itself — the buttons, the Groq call, and
// persisting each mode's last report.
//
// ageFromBirthDate is also called from charts.js (BMR/BMI paths), so it lives
// here rather than moving into the panel file.

// Whole-years-old as of today; null if BIRTH_DATE isn't set or unparseable.
function ageFromBirthDate(birthDateStr) {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthdayThisYear = today.getMonth() < birth.getMonth()
    || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthdayThisYear) age--;
  return age;
}

// Age, sex, height, latest logged body mass and the BMI those two imply — the
// body every one of this app's health numbers is actually about. Read straight
// from Settings and the latest weigh-in (latestBodyMassKg/computeBmi, charts.js),
// so all three AI panels describe the same person.
function gatherProfileSnapshot() {
  const heightCm = getSetting('HEIGHT_CM', null);
  const bodyMassKg = latestBodyMassKg(physiqueAsWellnessEntries());

  return {
    age: ageFromBirthDate(getSettingString('BIRTH_DATE', null)),
    sex: getSettingString('SEX', null),
    heightCm,
    bodyMassKg,
    bmi: (heightCm !== null && bodyMassKg !== null) ? computeBmi(bodyMassKg, heightCm) : null,
  };
}

// The snapshot as prompt lines, shared by Wellness, Food and Activity Insight:
// none of these three questions has a body-independent answer. 1,400 kcal/day
// is a floor for one person and a ceiling for another, "enough iron" depends on
// sex, and whether a training volume is heavy depends on the body lifting it —
// so the profile goes to all three rather than only to the panel that happens
// to compute calorie figures. Missing fields are reported as "not set" instead
// of being dropped, so the model can see what it doesn't know rather than
// quietly assuming a default. bodyMassTargetKg is passed only by the Wellness mode,
// the one panel whose subject is the journey rather than today's body.
function formatProfileLines(p, bodyMassTargetKg = null) {
  const targetSuffix = bodyMassTargetKg !== null ? ` (target: ${bodyMassTargetKg} kg)` : '';
  return [
    `Age: ${p.age !== null ? p.age : 'not set'}`,
    `Sex: ${p.sex !== null ? p.sex : 'not set'}`,
    `Height: ${p.heightCm !== null ? `${p.heightCm} cm` : 'not set'}`,
    `Current body mass: ${p.bodyMassKg !== null ? `${p.bodyMassKg} kg${targetSuffix}` : 'not logged'}`,
    `BMI: ${p.bmi !== null ? p.bmi : 'not available (needs height and a logged body mass)'}`,
  ];
}

// The days immediately before [fromIso, toIso], same length as that range —
// so current vs. previous period comparisons stay apples-to-apples for any
// custom range the user picks, not just a fixed lookback from today.
function previousDateRange(fromIso, toIso) {
  const current = datesInRange(fromIso, toIso);
  if (!current.length) return [];

  const prevTo = dateFromIso(fromIso);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevTo.getDate() - (current.length - 1));
  return datesInRange(isoFromDate(prevFrom), isoFromDate(prevTo));
}

// Aggregates physiqueAsWellnessEntries() over an arbitrary set of dates (a
// datesInRange or previousDateRange result) the same way calcProjection() does
// (charts.js) — shared so the current and previous period get identical
// aggregation logic.
function aggregateWindow(dates) {
  const from = dates[0];
  const to = dates[dates.length - 1];

  const caloriesByDate = new Map();
  const proteinByDate = new Map();
  const activityByDate = new Map();
  const activityByDescriptionByDate = new Map();
  const activityKcalByDate = new Map();
  const activityKcalByDescriptionByDate = new Map();
  const sleepByDate = new Map();

  // Hoisted out of the loop below: it doesn't vary per entry, and inside the
  // forEach it cost a full filter plus a filter-and-sort for every activity row.
  const datedEntries = physiqueAsWellnessEntries();
  const bodyMassKg = latestBodyMassKg(datedEntries);

  datedEntries
    .filter((e) => e.date >= from && e.date <= to)
    .forEach((e) => {
      if ((e.category === 'Calories' || e.category === 'Calories; Protein') && e.amount !== null) {
        caloriesByDate.set(e.date, (caloriesByDate.get(e.date) || 0) + e.amount);
      }
      if (e.category === 'Calories; Protein' && e.amount2 !== null) {
        proteinByDate.set(e.date, (proteinByDate.get(e.date) || 0) + e.amount2);
      }
      if ((e.category === 'Activity' || e.category === 'Activity; Calories') && e.amount !== null) {
        const mins = toActivityMinutes(e.amount, e.unit);
        activityByDate.set(e.date, (activityByDate.get(e.date) || 0) + mins);

        // Broken out per description (e.g. NEAT / Resistance / Cardio) as well
        // as the combined total above, so formatInsightPrompt can report each
        // activity type's own trend instead of just one merged number that
        // hides whether e.g. Cardio dropped while Resistance held steady.
        const description = e.description || 'Other';
        if (!activityByDescriptionByDate.has(description)) activityByDescriptionByDate.set(description, new Map());
        const byDate = activityByDescriptionByDate.get(description);
        byDate.set(e.date, (byDate.get(e.date) || 0) + mins);

        // Every entry gets a burn figure via charts.js's activityEntryKcal — its
        // own amount2, else its minutes at ACTIVITY_MET. A plain Activity row used
        // to contribute nothing, understating what the AI was told was burned.
        const kcal = activityEntryKcal(e, bodyMassKg);
        activityKcalByDate.set(e.date, (activityKcalByDate.get(e.date) || 0) + kcal);
        if (!activityKcalByDescriptionByDate.has(description)) activityKcalByDescriptionByDate.set(description, new Map());
        const kcalByDate = activityKcalByDescriptionByDate.get(description);
        kcalByDate.set(e.date, (kcalByDate.get(e.date) || 0) + kcal);
      }
      if (e.category === 'Sleep' && e.amount !== null) {
        sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
      }
    });

  const activityByDescription = {};
  activityByDescriptionByDate.forEach((byDate, description) => {
    const kcalByDate = activityKcalByDescriptionByDate.get(description);
    activityByDescription[description] = {
      avgMins: Math.round(avg(byDate)),
      daysLogged: byDate.size,
      avgKcal: kcalByDate && kcalByDate.size ? Math.round(avg(kcalByDate)) : null,
    };
  });

  return {
    avgCalories: caloriesByDate.size ? Math.round(avg(caloriesByDate)) : null,
    caloriesDaysLogged: caloriesByDate.size,
    avgProtein: proteinByDate.size ? Math.round(avg(proteinByDate)) : null,
    proteinDaysLogged: proteinByDate.size,
    avgActivityMins: activityByDate.size ? Math.round(avg(activityByDate)) : null,
    activityDaysLogged: activityByDate.size,
    avgActivityKcal: activityKcalByDate.size ? Math.round(avg(activityKcalByDate)) : null,
    activityByDescription,
    avgSleepHours: sleepByDate.size ? Math.round(avg(sleepByDate) * 10) / 10 : null,
    sleepDaysLogged: sleepByDate.size,
  };
}

function gatherInsightMetrics(fromIso, toIso) {
  const dates = datesInRange(fromIso, toIso);
  const lookbackDays = dates.length;
  const current = aggregateWindow(dates);
  const previous = aggregateWindow(previousDateRange(fromIso, toIso));

  // Reuses the exact same trajectory logic the State Trend & Forecast chart
  // is built from (charts.js) — Insight doesn't compute its own trend, it just
  // reports this one.
  const projection = calcProjection(physiqueAsWellnessEntries());

  return {
    lookbackDays,
    // The shared age/sex/height/body-mass/BMI block (formatProfileLines above) —
    // sex included because the BMR behind every calorie figure here is built
    // from it, and calorie/protein norms genuinely differ by it.
    profile: gatherProfileSnapshot(),
    bodyMassTargetKg: getSetting('BODY_MASS_TARGET_KG', BODY_MASS_TARGET_KG_DEFAULT),
    projection,

    avgCalories: current.avgCalories,
    prevAvgCalories: previous.avgCalories,
    // The whole figure, not a bare number — {kcal, kind} — so the prompt can
    // name it "max" or "min" rather than the direction-blind "target: 1388",
    // which let the AI praise a 900-kcal day on a bulk and scold a 1,300-kcal
    // one on a cut — both of which are the opposite of the truth.
    calorieTarget: getCalorieTarget(physiqueAsWellnessEntries()),
    caloriesDaysLogged: current.caloriesDaysLogged,

    avgProtein: current.avgProtein,
    prevAvgProtein: previous.avgProtein,
    // The band's display form ("131-164"), not a single number — the target
    // genuinely is a range, and collapsing it to a midpoint here would have
    // the AI calling an in-range day short of target. ASCII hyphen rather than
    // the UI's en dash, since this string is headed for the prompt.
    proteinTarget: formatProteinTargetBand(getProteinTargetBandG(physiqueAsWellnessEntries()), '-'),
    proteinDaysLogged: current.proteinDaysLogged,

    avgActivityMins: current.avgActivityMins,
    prevAvgActivityMins: previous.avgActivityMins,
    activityTarget: getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT),
    activityDaysLogged: current.activityDaysLogged,
    avgActivityKcal: current.avgActivityKcal,
    prevAvgActivityKcal: previous.avgActivityKcal,
    activityByDescription: current.activityByDescription,
    prevActivityByDescription: previous.activityByDescription,

    avgSleepHours: current.avgSleepHours,
    prevAvgSleepHours: previous.avgSleepHours,
    sleepTarget: getSetting('SLEEP_TARGET_HOURS', SLEEP_TARGET_HOURS_DEFAULT),
    sleepDaysLogged: current.sleepDaysLogged,
  };
}

// Covers every status calcProjection() (charts.js) can return, so the
// trajectory line is always sensible text — never undefined/NaN leaking
// into the prompt.
function formatTrajectoryLine(projection) {
  if (!projection) return 'Body mass trajectory: not enough reading history yet to estimate a trend.';
  if (projection.status === 'reached') return 'Body mass trajectory: already at target body mass.';
  if (projection.status === 'no-change') return 'Body mass trajectory: current habits project no meaningful body mass change.';
  if (projection.status === 'wrong-direction') return 'Body mass trajectory: current trend is moving away from the target, not toward it.';
  // Moving the right way but toward a plateau short of the target — the intake these
  // habits average is maintenance at that body mass, so it never arrives.
  if (projection.status === 'asymptote') {
    return `Body mass trajectory: current habits move toward the target but level off around ${Math.round(projection.equilibriumKg * 10) / 10} kg, short of it — reaching the target needs a change in intake or activity.`;
  }
  if (projection.status !== 'ok') return 'Body mass trajectory: not enough data to estimate a trend.';

  const kgPerWeek = Math.abs(projection.slope * 7).toFixed(1);
  const direction = projection.slope < 0 ? 'losing' : 'gaining';
  // "currently" because the rate isn't constant: the arrival date comes from an
  // exponential model in which the rate decays as BMR falls with body mass, so
  // quoting the present rate as if it held to the target would overstate progress.
  return `Body mass trajectory: currently ${direction} ~${kgPerWeek} kg/week (slowing as body mass drops), estimated to reach the ${projection.bodyMassTarget} kg target around ${isoFromDate(projection.etaDate)} (~${projection.daysToTarget} days) — generic population-average estimate.`;
}

// One line per activity description (e.g. NEAT / Resistance / Cardio),
// each with its own avg minutes/day (and, where a Calculate-derived calorie
// figure exists, avg kcal/day burned alongside it), previous-period
// comparison, and logging coverage — so the AI can reason about the mix of
// activity types, not just their combined total (which the 'Avg activity
// total' line above this still covers, since that's what the activity
// target is measured against).
function formatActivityBreakdownLines(m) {
  return Object.keys(m.activityByDescription)
    .sort()
    .map((description) => {
      const cur = m.activityByDescription[description];
      const prev = m.prevActivityByDescription[description];
      const coverage = cur.daysLogged < m.lookbackDays ? ` [only ${cur.daysLogged}/${m.lookbackDays} days logged]` : '';
      const kcalNow = cur.avgKcal !== null ? `, ${cur.avgKcal} kcal/day burned` : '';
      const kcalPrev = prev && prev.avgKcal !== null ? `, ${prev.avgKcal} kcal/day burned` : '';
      const trend = prev ? ` — previous period: ${prev.avgMins} min/day${kcalPrev}` : ' — previous period: not logged';
      return `Avg activity — ${description}: ${cur.avgMins} min/day${kcalNow}${trend}${coverage}`;
    });
}

function formatInsightPrompt(m) {
  // `word` is what the figure in brackets is called: 'target' for the metrics
  // that are a point to land on, but 'max'/'min' for calories, whose target is
  // directional — a side to stay on rather than a number to land on.
  // No range on the line: every figure here covers the same one, so repeating it
  // eight times cost more than the data did. The [N/M days logged] marker carries
  // the window length where coverage is partial.
  const line = (label, value, unit, target, daysLogged, prevValue, word = 'target') => {
    if (value === null) return `${label}: not logged this period`;
    const coverage = daysLogged < m.lookbackDays ? ` [only ${daysLogged}/${m.lookbackDays} days logged]` : '';
    const trend = prevValue !== null ? ` — previous period: ${prevValue}${unit}` : '';
    return `${label}: ${value}${unit} (${word}: ${target}${unit})${trend}${coverage}`;
  };

  // Bespoke rather than built from the generic line() helper above, since
  // this is the one metric with a second, target-less figure (kcal burned)
  // riding alongside its primary one (minutes) — line() only has room for
  // one value + one target.
  const activityTotalLine = (() => {
    if (m.avgActivityMins === null) return 'Avg activity total: not logged this period';
    const coverage = m.activityDaysLogged < m.lookbackDays ? ` [only ${m.activityDaysLogged}/${m.lookbackDays} days logged]` : '';
    const kcalNow = m.avgActivityKcal !== null ? `, ${m.avgActivityKcal} kcal/day burned` : '';
    const kcalPrev = m.prevAvgActivityKcal !== null ? `, ${m.prevAvgActivityKcal} kcal/day burned` : '';
    const trend = m.prevAvgActivityMins !== null ? ` — previous period: ${m.prevAvgActivityMins} min/day${kcalPrev}` : '';
    return `Avg activity total: ${m.avgActivityMins} min/day${kcalNow} (target: ${m.activityTarget} min/day)${trend}${coverage}`;
  })();

  const lines = [
    ...formatProfileLines(m.profile, m.bodyMassTargetKg),
    line('Avg calorie intake', m.avgCalories, ' kcal/day', m.calorieTarget.kcal, m.caloriesDaysLogged, m.prevAvgCalories, m.calorieTarget.kind),
    line('Avg protein intake', m.avgProtein, ' g/day', m.proteinTarget, m.proteinDaysLogged, m.prevAvgProtein),
    activityTotalLine,
    ...formatActivityBreakdownLines(m),
    line('Avg sleep', m.avgSleepHours, ' hr/day', m.sleepTarget, m.sleepDaysLogged, m.prevAvgSleepHours),
    formatTrajectoryLine(m.projection),
  ];

  return lines.filter((l) => l !== null).join('\n');
}

const INSIGHT_SYSTEM_PROMPT = `You are a supportive personal health coach reviewing someone's own self-tracked data. You are not a doctor — do not give medical diagnoses or prescribe treatment.

You'll be given their age, sex, height, BMI, current body mass vs. target, their average calorie/protein intake, activity, and sleep for a recent period compared to both their own personal figure and the immediately preceding period of the same length (so you can tell if things are improving or slipping, not just where they stand today), and a body-mass-trajectory line (their actual estimated rate of progress toward their target). Activity is also broken down by type (e.g. NEAT, Resistance, Cardio), each with its own minutes/day and trend versus the previous period, beneath the combined "Avg activity total" line — use this to comment on the balance between activity types (e.g. cardio-only with no resistance training, or a specific type dropping off) rather than just the total minutes. Some values may be missing or under-logged (marked "not set", "not logged this period", or "[only N/X days logged]") — treat those as missing data to note, never as zero. The protein target may be given as a range (e.g. "target: 131-164 g/day"): anywhere inside that range is on target, and both falling below its low end and exceeding its top end are off target.

Calorie intake's target is DIRECTIONAL, not a point to land on, and the label says which side: "(max: 1388 kcal/day)" is a ceiling: they are aiming to lose body mass, so at or under it is on track and over it is off track. "(min: 2600 kcal/day)" is a floor: they are aiming to gain body mass, so at or over it is on track and under it is off track. Never treat a day under a "min" as a win or read it as a deficit worth praising, and never describe being under a "max" as falling short. If the average sits far on the good side of a max, that is a deeper deficit than the target called for, not a failure — comment on whether the pace looks sustainable (especially alongside protein and sleep) rather than scoring it as a miss.

Write a short plain-text report with exactly these four sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall picture, grounded in the body mass trajectory line, not just the current period's numbers in isolation.
Going well: what's on track, including any improvement vs. the previous period.
Needs attention: what's off track, including any decline vs. the previous period. Specifically check whether calories are in a deficit while protein is below target — if so, call out that this risks losing muscle instead of fat, which slows real (fat) progress even when the scale moves.
Suggestions: 2-4 concrete, specific next steps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.

If an additional question from the user is included after the data, also answer it directly in a fifth section, "Answer: text".

Keep the whole report under 250 words.`;

const INSIGHT_SECTION_LABELS = ['Overview', 'Going well', 'Needs attention', 'Investment outlook', 'Suggestions', 'Answer'];

// One <p> per line (blank lines dropped) rather than per blank-line-separated
// block — the prompt asks for each of the 4 sections, and each numbered
// suggestion within Suggestions, on its own line, so this gives every one of
// them its own paragraph and CSS spacing instead of Suggestions' items
// running together in a single wall of text. Still never innerHTML — this is
// untrusted model output; the section label is the one bit of markup we add,
// and it's built from a fixed known string, not from parsing the model's text.
function renderInsightText(container, text) {
  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const p = document.createElement('p');
    const label = INSIGHT_SECTION_LABELS.find((l) => line.startsWith(`${l}:`));
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
