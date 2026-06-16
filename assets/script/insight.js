// "💡 Wellness Insight" panel (formerly "Insight"): sends a plain-language
// snapshot of the user's recent data (current window + the immediately
// preceding period of equal length, plus age/height/BMI, their own targets,
// and the same weight-trajectory/calibration numbers the Weight Trend &
// Forecast chart already computes) to Groq and shows the free-text response
// inline. Never runs automatically, and unlike calorie-estimator.js's calls
// this one is neither cached nor deterministic (it's advice text, not a
// number to reproduce) — but the last result IS persisted, to the Settings
// tab as WELLNESS_INSIGHT_LAST_RESULT/WELLNESS_INSIGHT_LAST_GENERATED_AT, so
// the panel still shows something on a fresh page load. Wired up by
// initInsightPanel(), called from app.js.

const INSIGHT_LOOKBACK_DEFAULT = 7;

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

// The n days immediately before lastNDates(n) (charts.js) — same local-date
// construction, just shifted back by n, so current vs. previous period
// comparisons can't drift a day apart from a UTC/local mismatch.
function previousNDates(n) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (2 * n - 1 - i));
    return isoFromDate(d);
  });
}

// Aggregates getDatedWellnessEntries() over an arbitrary set of dates (a
// lastNDates or previousNDates result) the same way calcProjection()/
// buildCalibrationSamples() do (charts.js/calibration.js) — shared so the
// current and previous period get identical aggregation logic.
function aggregateWindow(dates) {
  const from = dates[0];
  const to = dates[dates.length - 1];

  const caloriesByDate = new Map();
  const proteinByDate = new Map();
  const activityByDate = new Map();
  const activityByDescriptionByDate = new Map();
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
      if (e.category === 'Activity' && e.amount !== null) {
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
      }
      if (e.category === 'Sleep' && e.amount !== null) {
        sleepByDate.set(e.date, (sleepByDate.get(e.date) || 0) + e.amount);
      }
    });

  const activityByDescription = {};
  activityByDescriptionByDate.forEach((byDate, description) => {
    activityByDescription[description] = { avgMins: Math.round(avg(byDate)), daysLogged: byDate.size };
  });

  return {
    avgCalories: caloriesByDate.size ? Math.round(avg(caloriesByDate)) : null,
    caloriesDaysLogged: caloriesByDate.size,
    avgProtein: proteinByDate.size ? Math.round(avg(proteinByDate)) : null,
    proteinDaysLogged: proteinByDate.size,
    avgActivityMins: activityByDate.size ? Math.round(avg(activityByDate)) : null,
    activityDaysLogged: activityByDate.size,
    activityByDescription,
    avgSleepHours: sleepByDate.size ? Math.round(avg(sleepByDate) * 10) / 10 : null,
    sleepDaysLogged: sleepByDate.size,
  };
}

function gatherInsightMetrics(lookbackDays) {
  const current = aggregateWindow(lastNDates(lookbackDays));
  const previous = aggregateWindow(previousNDates(lookbackDays));

  const weightEntries = getDatedWellnessEntries()
    .filter((e) => e.category === 'Weight' && e.amount !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const heightCm = getSetting('HEIGHT_CM', null);
  const currentWeightKg = weightEntries.length ? weightEntries[weightEntries.length - 1].amount : null;
  const bmi = (heightCm !== null && currentWeightKg !== null) ? computeBmi(currentWeightKg, heightCm) : null;

  // Reuses the exact same trajectory/calibration logic the Weight Trend &
  // Forecast chart is built from (charts.js) — Insight doesn't compute its
  // own trend, it just reports this one.
  const projection = calcProjection(getDatedWellnessEntries());
  const gains = getCalibratedGains();
  const energyDensityKcalPerKg = (gains && gains.betaCal > 0) ? Math.round(1 / gains.betaCal) : null;

  return {
    lookbackDays,
    age: ageFromBirthDate(getSettingString('BIRTH_DATE', null)),
    heightCm,
    currentWeightKg,
    weightGoalKg: getSetting('WEIGHT_GOAL_KG', WEIGHT_GOAL_KG_DEFAULT),
    bmi,
    projection,
    energyDensityKcalPerKg,

    avgCalories: current.avgCalories,
    prevAvgCalories: previous.avgCalories,
    calorieTarget: getCalorieTargetKcal(getDatedWellnessEntries()),
    caloriesDaysLogged: current.caloriesDaysLogged,

    avgProtein: current.avgProtein,
    prevAvgProtein: previous.avgProtein,
    proteinTarget: getProteinTargetG(getDatedWellnessEntries()),
    proteinDaysLogged: current.proteinDaysLogged,

    avgActivityMins: current.avgActivityMins,
    prevAvgActivityMins: previous.avgActivityMins,
    activityTarget: getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT),
    activityDaysLogged: current.activityDaysLogged,
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
  const source = projection.calibrated ? 'personalized estimate from your calibrated data' : 'generic population-average estimate';
  return `Weight trajectory: ${direction} ~${kgPerWeek} kg/week, estimated to reach the ${projection.weightGoal} kg goal around ${isoFromDate(projection.etaDate)} (~${projection.daysToGoal} days) — ${source}.`;
}

// One line per activity description (e.g. NEAT / Resistance / Cardio),
// each with its own avg minutes/day, previous-period comparison, and
// logging coverage — so the AI can reason about the mix of activity types,
// not just their combined total (which the 'Avg activity total' line above
// this still covers, since that's what the activity target is measured against).
function formatActivityBreakdownLines(m) {
  return Object.keys(m.activityByDescription)
    .sort()
    .map((description) => {
      const cur = m.activityByDescription[description];
      const prev = m.prevActivityByDescription[description];
      const coverage = cur.daysLogged < m.lookbackDays ? ` [only ${cur.daysLogged}/${m.lookbackDays} days logged]` : '';
      const trend = prev ? ` — previous ${m.lookbackDays} days: ${prev.avgMins} min/day` : ' — previous period: not logged';
      return `Avg activity — ${description} (last ${m.lookbackDays} days): ${cur.avgMins} min/day${trend}${coverage}`;
    });
}

function formatInsightPrompt(m) {
  const line = (label, value, unit, target, daysLogged, prevValue) => {
    if (value === null) return `${label} (last ${m.lookbackDays} days): not logged this period`;
    const coverage = daysLogged < m.lookbackDays ? ` [only ${daysLogged}/${m.lookbackDays} days logged]` : '';
    const trend = prevValue !== null ? ` — previous ${m.lookbackDays} days: ${prevValue}${unit}` : '';
    return `${label} (last ${m.lookbackDays} days): ${value}${unit} (target: ${target}${unit})${trend}${coverage}`;
  };

  const lines = [
    `Age: ${m.age !== null ? m.age : 'not set'}`,
    `Height: ${m.heightCm !== null ? `${m.heightCm} cm` : 'not set'}`,
    `Current weight: ${m.currentWeightKg !== null ? `${m.currentWeightKg} kg (goal: ${m.weightGoalKg} kg)` : 'not logged'}`,
    m.bmi !== null ? `BMI: ${m.bmi}` : null,
    line('Avg calorie intake', m.avgCalories, ' kcal/day', m.calorieTarget, m.caloriesDaysLogged, m.prevAvgCalories),
    line('Avg protein intake', m.avgProtein, ' g/day', m.proteinTarget, m.proteinDaysLogged, m.prevAvgProtein),
    line('Avg activity total', m.avgActivityMins, ' min/day', m.activityTarget, m.activityDaysLogged, m.prevAvgActivityMins),
    ...formatActivityBreakdownLines(m),
    line('Avg sleep', m.avgSleepHours, ' hr/day', m.sleepTarget, m.sleepDaysLogged, m.prevAvgSleepHours),
    formatTrajectoryLine(m.projection),
    m.energyDensityKcalPerKg !== null
      ? `Calibrated energy density: ~${m.energyDensityKcalPerKg.toLocaleString()} kcal/kg (your own fitted value, vs. the generic 7,700 kcal/kg assumption).`
      : null,
  ];

  return lines.filter((l) => l !== null).join('\n');
}

const INSIGHT_SYSTEM_PROMPT = `You are a supportive personal health coach reviewing someone's own self-tracked data. You are not a doctor — do not give medical diagnoses or prescribe treatment.

You'll be given their age, height, BMI, current weight vs. goal, their average calorie/protein intake, activity, and sleep for a recent period compared to both their own personal target and the immediately preceding period of the same length (so you can tell if things are improving or slipping, not just where they stand today), and a weight-trajectory line (their actual estimated rate of progress toward their goal, personalized if they've calibrated it, generic otherwise). Activity is also broken down by type (e.g. NEAT, Resistance, Cardio), each with its own minutes/day and trend versus the previous period, beneath the combined "Avg activity total" line — use this to comment on the balance between activity types (e.g. cardio-only with no resistance training, or a specific type dropping off) rather than just the total minutes. Some values may be missing or under-logged (marked "not set", "not logged this period", or "[only N/X days logged]") — treat those as missing data to note, never as zero.

Write a short plain-text report with exactly these four sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall picture, grounded in the weight trajectory line, not just the current period's numbers in isolation.
Going well: what's on track, including any improvement vs. the previous period.
Needs attention: what's off track, including any decline vs. the previous period. Specifically check whether calories are in a deficit while protein is below target — if so, call out that this risks losing muscle instead of fat, which slows real (fat) progress even when the scale moves.
Suggestions: 2-4 concrete, specific next steps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.

If an additional question from the user is included after the data, also answer it directly in a fifth section, "Answer: text".

Keep the whole report under 250 words.`;

async function generateWellnessInsight(lookbackDays, question) {
  const apiKey = getSettingString('GROQ_API_KEY', null);
  if (!apiKey) throw new Error('Add a GROQ_API_KEY setting first (Settings panel).');

  let userMessage = formatInsightPrompt(gatherInsightMetrics(lookbackDays));
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

function initInsightPanel() {
  clearFieldError('insight-status');
  renderInsightDataPreview(currentInsightLookbackDays());
  renderSavedWellnessInsight();

  document.getElementById('insight-generate-btn').addEventListener('click', () => {
    runInsightGeneration(currentInsightLookbackDays(), document.getElementById('insight-question').value);
  });
  document.getElementById('insight-lookback').addEventListener('change', () => {
    renderInsightDataPreview(currentInsightLookbackDays());
  });
}

function currentInsightLookbackDays() {
  return Number(document.getElementById('insight-lookback').value) || INSIGHT_LOOKBACK_DEFAULT;
}

// Shows exactly what formatInsightPrompt() would send to Groq, in plain
// language, so nothing about the request is a black box — this is our own
// computed text (not model output), rendered before Send to AI is ever
// clicked and refreshed live as the lookback selector changes.
function renderInsightDataPreview(lookbackDays) {
  const preview = document.getElementById('insight-data-preview');
  preview.innerHTML = '';
  formatInsightPrompt(gatherInsightMetrics(lookbackDays)).split('\n').forEach((line) => {
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

// Only runs on an explicit Send to AI click — changing the lookback selector
// only updates the (free, local) data preview above.
async function runInsightGeneration(lookbackDays, question) {
  const body = document.getElementById('insight-body');
  const btn = document.getElementById('insight-generate-btn');
  const select = document.getElementById('insight-lookback');
  const textarea = document.getElementById('insight-question');

  body.innerHTML = '';
  clearFieldError('insight-status');

  const loading = document.createElement('p');
  loading.className = 'hint';
  loading.textContent = `Analyzing your last ${lookbackDays} days…`;
  body.appendChild(loading);

  btn.disabled = true;
  select.disabled = true;
  textarea.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Generating…';

  try {
    const text = await generateWellnessInsight(lookbackDays, question);
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
    select.disabled = false;
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
