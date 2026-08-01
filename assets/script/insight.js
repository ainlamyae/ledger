// "💡 Wellness Insight" panel (formerly "Insight"): sends a plain-language
// snapshot of the user's recent data (current window + the immediately
// preceding period of equal length, plus the shared age/sex/height/weight/BMI
// profile block Food and Activity Insight also send, their own targets and
// calorie bound,
// and the same weight-trajectory numbers the Weight Trend &
// Forecast chart already computes) to Groq and shows the free-text response
// inline. Never runs automatically, and unlike calorie-estimator.js's calls
// this one is neither cached nor deterministic (it's advice text, not a
// number to reproduce) — but the last result IS persisted, to the Settings
// tab as WELLNESS_INSIGHT_LAST_RESULT/WELLNESS_INSIGHT_LAST_GENERATED_AT, so
// the panel still shows something on a fresh page load. Wired up by
// initInsightPanel(), called from app.js.

// Default span of the From/To date pickers on first load — otherwise
// identical in meaning to the old fixed 7-day lookback.
const INSIGHT_LOOKBACK_DEFAULT_DAYS = 7;

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

// Age, sex, height, latest logged weight and the BMI those two imply — the
// body every one of this app's health numbers is actually about. Read straight
// from Settings and the latest weigh-in (latestWeightKg/computeBmi, charts.js),
// so all three AI panels describe the same person.
function gatherProfileSnapshot() {
  const heightCm = getSetting('HEIGHT_CM', null);
  const weightKg = latestWeightKg(getDatedWellnessEntries());

  return {
    age: ageFromBirthDate(getSettingString('BIRTH_DATE', null)),
    sex: getSettingString('SEX', null),
    heightCm,
    weightKg,
    bmi: (heightCm !== null && weightKg !== null) ? computeBmi(weightKg, heightCm) : null,
  };
}

// The snapshot as prompt lines, shared by Wellness, Food and Activity Insight:
// none of these three questions has a body-independent answer. 1,400 kcal/day
// is a floor for one person and a ceiling for another, "enough iron" depends on
// sex, and whether a training volume is heavy depends on the body lifting it —
// so the profile goes to all three rather than only to the panel that happens
// to compute calorie figures. Missing fields are reported as "not set" instead
// of being dropped, so the model can see what it doesn't know rather than
// quietly assuming a default. weightGoalKg is passed only by Wellness Insight,
// the one panel whose subject is the journey rather than today's body.
function formatProfileLines(p, weightGoalKg = null) {
  const goalSuffix = weightGoalKg !== null ? ` (goal: ${weightGoalKg} kg)` : '';
  return [
    `Age: ${p.age !== null ? p.age : 'not set'}`,
    `Sex: ${p.sex !== null ? p.sex : 'not set'}`,
    `Height: ${p.heightCm !== null ? `${p.heightCm} cm` : 'not set'}`,
    `Current weight: ${p.weightKg !== null ? `${p.weightKg} kg${goalSuffix}` : 'not logged'}`,
    `BMI: ${p.bmi !== null ? p.bmi : 'not available (needs height and a logged weight)'}`,
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

// Aggregates getDatedWellnessEntries() over an arbitrary set of dates (a
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

  getDatedWellnessEntries()
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
        const kcal = activityEntryKcal(e, latestWeightKg(getDatedWellnessEntries()));
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

// Human-readable stand-in for the old "last N days" phrasing — since the
// range is now an arbitrary user-picked From/To rather than always ending
// today, the label needs the actual dates to stay accurate.
function formatDateRangeLabel(fromIso, toIso, dayCount) {
  return `${fromIso} to ${toIso}, ${dayCount} day${dayCount === 1 ? '' : 's'}`;
}

function gatherInsightMetrics(fromIso, toIso) {
  const dates = datesInRange(fromIso, toIso);
  const lookbackDays = dates.length;
  const rangeLabel = formatDateRangeLabel(fromIso, toIso, lookbackDays);
  const current = aggregateWindow(dates);
  const previous = aggregateWindow(previousDateRange(fromIso, toIso));

  // Reuses the exact same trajectory logic the Weight Trend & Forecast chart
  // is built from (charts.js) — Insight doesn't compute its own trend, it just
  // reports this one.
  const projection = calcProjection(getDatedWellnessEntries());

  return {
    lookbackDays,
    rangeLabel,
    // The shared age/sex/height/weight/BMI block (formatProfileLines above) —
    // sex included because the BMR behind every calorie figure here is built
    // from it, and calorie/protein norms genuinely differ by it.
    profile: gatherProfileSnapshot(),
    weightGoalKg: getSetting('WEIGHT_GOAL_KG', WEIGHT_GOAL_KG_DEFAULT),
    projection,

    avgCalories: current.avgCalories,
    prevAvgCalories: previous.avgCalories,
    // The whole bound, not a bare number — {kcal, kind} — so the prompt can
    // name it "max" or "min". Handing over "target: 1388" let the AI praise a
    // 900-kcal day on a bulk and scold a 1,300-kcal one on a cut, both of which
    // are the opposite of the truth.
    calorieBound: getCalorieBound(getDatedWellnessEntries()),
    caloriesDaysLogged: current.caloriesDaysLogged,

    avgProtein: current.avgProtein,
    prevAvgProtein: previous.avgProtein,
    // The band's display form ("131-164"), not a single number — the target
    // genuinely is a range, and collapsing it to a midpoint here would have
    // the AI calling an in-range day short of target. ASCII hyphen rather than
    // the UI's en dash, since this string is headed for the prompt.
    proteinTarget: formatProteinTargetBand(getProteinTargetBandG(getDatedWellnessEntries()), '-'),
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
  if (!projection) return 'Weight trajectory: not enough weigh-in history yet to estimate a trend.';
  if (projection.status === 'reached') return 'Weight trajectory: already at goal weight.';
  if (projection.status === 'no-change') return 'Weight trajectory: current habits project no meaningful weight change.';
  if (projection.status === 'wrong-direction') return 'Weight trajectory: current trend is moving away from the goal, not toward it.';
  if (projection.status !== 'ok') return 'Weight trajectory: not enough data to estimate a trend.';

  const kgPerWeek = Math.abs(projection.slope * 7).toFixed(1);
  const direction = projection.slope < 0 ? 'losing' : 'gaining';
  return `Weight trajectory: ${direction} ~${kgPerWeek} kg/week, estimated to reach the ${projection.weightGoal} kg goal around ${isoFromDate(projection.etaDate)} (~${projection.daysToGoal} days) — generic population-average estimate.`;
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
      return `Avg activity — ${description} (${m.rangeLabel}): ${cur.avgMins} min/day${kcalNow}${trend}${coverage}`;
    });
}

function formatInsightPrompt(m) {
  // `word` is what the figure in brackets is called: 'target' for the metrics
  // that really have one, but 'max'/'min' for calories, whose figure is a bound
  // to stay on one side of rather than a number to land on.
  const line = (label, value, unit, target, daysLogged, prevValue, word = 'target') => {
    if (value === null) return `${label} (${m.rangeLabel}): not logged this period`;
    const coverage = daysLogged < m.lookbackDays ? ` [only ${daysLogged}/${m.lookbackDays} days logged]` : '';
    const trend = prevValue !== null ? ` — previous period: ${prevValue}${unit}` : '';
    return `${label} (${m.rangeLabel}): ${value}${unit} (${word}: ${target}${unit})${trend}${coverage}`;
  };

  // Bespoke rather than built from the generic line() helper above, since
  // this is the one metric with a second, target-less figure (kcal burned)
  // riding alongside its primary one (minutes) — line() only has room for
  // one value + one target.
  const activityTotalLine = (() => {
    if (m.avgActivityMins === null) return `Avg activity total (${m.rangeLabel}): not logged this period`;
    const coverage = m.activityDaysLogged < m.lookbackDays ? ` [only ${m.activityDaysLogged}/${m.lookbackDays} days logged]` : '';
    const kcalNow = m.avgActivityKcal !== null ? `, ${m.avgActivityKcal} kcal/day burned` : '';
    const kcalPrev = m.prevAvgActivityKcal !== null ? `, ${m.prevAvgActivityKcal} kcal/day burned` : '';
    const trend = m.prevAvgActivityMins !== null ? ` — previous period: ${m.prevAvgActivityMins} min/day${kcalPrev}` : '';
    return `Avg activity total (${m.rangeLabel}): ${m.avgActivityMins} min/day${kcalNow} (target: ${m.activityTarget} min/day)${trend}${coverage}`;
  })();

  const lines = [
    ...formatProfileLines(m.profile, m.weightGoalKg),
    line('Avg calorie intake', m.avgCalories, ' kcal/day', m.calorieBound.kcal, m.caloriesDaysLogged, m.prevAvgCalories, m.calorieBound.kind),
    line('Avg protein intake', m.avgProtein, ' g/day', m.proteinTarget, m.proteinDaysLogged, m.prevAvgProtein),
    activityTotalLine,
    ...formatActivityBreakdownLines(m),
    line('Avg sleep', m.avgSleepHours, ' hr/day', m.sleepTarget, m.sleepDaysLogged, m.prevAvgSleepHours),
    formatTrajectoryLine(m.projection),
  ];

  return lines.filter((l) => l !== null).join('\n');
}

const INSIGHT_SYSTEM_PROMPT = `You are a supportive personal health coach reviewing someone's own self-tracked data. You are not a doctor — do not give medical diagnoses or prescribe treatment.

You'll be given their age, sex, height, BMI, current weight vs. goal, their average calorie/protein intake, activity, and sleep for a recent period compared to both their own personal figure and the immediately preceding period of the same length (so you can tell if things are improving or slipping, not just where they stand today), and a weight-trajectory line (their actual estimated rate of progress toward their goal). Activity is also broken down by type (e.g. NEAT, Resistance, Cardio), each with its own minutes/day and trend versus the previous period, beneath the combined "Avg activity total" line — use this to comment on the balance between activity types (e.g. cardio-only with no resistance training, or a specific type dropping off) rather than just the total minutes. Some values may be missing or under-logged (marked "not set", "not logged this period", or "[only N/X days logged]") — treat those as missing data to note, never as zero. The protein target may be given as a range (e.g. "target: 131-164 g/day"): anywhere inside that range is on target, and both falling below its low end and exceeding its top end are off target.

Calorie intake has no target — its figure is a BOUND, and the label says which one. "(max: 1388 kcal/day)" is a ceiling: they are aiming to lose weight, so at or under it is on track and over it is off track. "(min: 2600 kcal/day)" is a floor: they are aiming to gain weight, so at or over it is on track and under it is off track. Never treat a day under a "min" as a win or read it as a deficit worth praising, and never describe being under a "max" as falling short. If the average sits far on the good side of a max, that is a deeper deficit than planned, not a failure — comment on whether the pace looks sustainable (especially alongside protein and sleep) rather than scoring it as a miss.

Write a short plain-text report with exactly these four sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall picture, grounded in the weight trajectory line, not just the current period's numbers in isolation.
Going well: what's on track, including any improvement vs. the previous period.
Needs attention: what's off track, including any decline vs. the previous period. Specifically check whether calories are in a deficit while protein is below target — if so, call out that this risks losing muscle instead of fat, which slows real (fat) progress even when the scale moves.
Suggestions: 2-4 concrete, specific next steps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.

If an additional question from the user is included after the data, also answer it directly in a fifth section, "Answer: text".

Keep the whole report under 250 words.`;

async function generateWellnessInsight(fromIso, toIso, question) {
  const apiKey = getSettingString('GROQ_API_KEY', null);
  if (!apiKey) throw new Error('Add a GROQ_API_KEY setting first (Settings panel).');

  let userMessage = formatInsightPrompt(gatherInsightMetrics(fromIso, toIso));
  if (question && question.trim()) userMessage += `\n\nAdditional question: ${question.trim()}`;

  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: INSIGHT_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// Set by initInsightPanel() to the getter initDateRangeControl() (charts.js)
// returns — the one shared From/To wiring also used by protein-rotation.js.
let getInsightDateRange = () => ({ from: null, to: null });

function initInsightPanel() {
  clearFieldError('insight-status');
  getInsightDateRange = initDateRangeControl('insight-date-from', 'insight-date-to', INSIGHT_LOOKBACK_DEFAULT_DAYS, () => {
    renderInsightDataPreview(getInsightDateRange());
  });
  renderInsightDataPreview(getInsightDateRange());
  renderSavedWellnessInsight();

  document.getElementById('insight-generate-btn').addEventListener('click', () => {
    const { from, to } = getInsightDateRange();
    runInsightGeneration(from, to, document.getElementById('insight-question').value);
  });
}

// Shows exactly what formatInsightPrompt() would send to Groq, in plain
// language, so nothing about the request is a black box — this is our own
// computed text (not model output), rendered before Send to AI is ever
// clicked and refreshed live as the date range changes.
function renderInsightDataPreview({ from, to }) {
  const preview = document.getElementById('insight-data-preview');
  preview.innerHTML = '';
  formatInsightPrompt(gatherInsightMetrics(from, to)).split('\n').forEach((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    preview.appendChild(p);
  });
}

const INSIGHT_SECTION_LABELS = ['Overview', 'Going well', 'Needs attention', 'Suggestions', 'Answer'];

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

// Only runs on an explicit Send to AI click — changing the date range only
// updates the (free, local) data preview above.
async function runInsightGeneration(fromIso, toIso, question) {
  const body = document.getElementById('insight-body');
  const btn = document.getElementById('insight-generate-btn');
  const fromEl = document.getElementById('insight-date-from');
  const toEl = document.getElementById('insight-date-to');
  const textarea = document.getElementById('insight-question');

  body.innerHTML = '';
  clearFieldError('insight-status');

  const loading = document.createElement('p');
  loading.className = 'hint';
  loading.textContent = `Analyzing ${fromIso} to ${toIso}…`;
  body.appendChild(loading);

  btn.disabled = true;
  fromEl.disabled = true;
  toEl.disabled = true;
  textarea.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Generating…';

  try {
    const text = await generateWellnessInsight(fromIso, toIso, question);
    body.innerHTML = '';
    renderInsightText(body, text);

    // Persisted so a fresh page load still shows the last read instead of
    // going blank — same pattern as food-insight.js's Food Insight panel.
    const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
    try {
      await saveSettingValues({
        WELLNESS_INSIGHT_LAST_RESULT: text,
        WELLNESS_INSIGHT_LAST_GENERATED_AT: generatedAt,
      });
      renderInsightGeneratedAt(generatedAt);
    } catch (saveErr) {
      showFieldError('insight-status', `Generated, but couldn't save it: ${saveErr.message}`);
    }
  } catch (err) {
    body.innerHTML = '';
    showFieldError('insight-status', err.message);
  } finally {
    btn.disabled = false;
    fromEl.disabled = false;
    toEl.disabled = false;
    textarea.disabled = false;
    btn.textContent = originalLabel;
  }
}

function renderInsightGeneratedAt(timestamp) {
  const el = document.getElementById('insight-generated-at');
  if (!timestamp) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `Last generated ${timestamp}`;
}

// Restores the last AI result (if any) from the Settings tab on page load,
// so the panel shows the previous read instead of an empty placeholder.
function renderSavedWellnessInsight() {
  const body = document.getElementById('insight-body');
  const text = getSettingString('WELLNESS_INSIGHT_LAST_RESULT', null);

  body.innerHTML = '';
  if (!text) {
    const placeholder = document.createElement('p');
    placeholder.className = 'hint';
    placeholder.textContent = 'Review the data above, then click "Send to AI" to get a read on it.';
    body.appendChild(placeholder);
    renderInsightGeneratedAt(null);
    return;
  }

  renderInsightText(body, text);
  renderInsightGeneratedAt(getSettingString('WELLNESS_INSIGHT_LAST_GENERATED_AT', null));
}
