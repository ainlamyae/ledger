// Insight's Pattern mode: the BMR_cal Periods table, widened with
// each period's macro and activity-type averages, sent to AI to spot which habits line up
// with more fat lost (ΔM) and a higher real BMR (Offset). insight-panel.js drives it.

// Column label, then how to read it off a period row. Shared by the table and the prompt.
const FAT_LOSS_PATTERN_COLUMNS = [
  ['Period', (r) => `${r.weekStart} → ${r.weekEnd}`],
  ['m', (r) => fixedOrDash(r.m, 1)],
  ['Δm', (r) => fixedOrDash(r.deltaMass, 1)],
  ['ΔM (kcal)', (r) => fixedOrDash(r.deltaMKcal, 0)],
  ['BMR_mif', (r) => fixedOrDash(r.bmr.BMR_mif, 0)],
  ['BMR_kat', (r) => fixedOrDash(r.bmr.BMR_kat, 0)],
  ['BMR_cal', (r) => fixedOrDash(r.bmr.BMR_cal, 0)],
  ['BMR_adp', (r) => fixedOrDash(r.bmr.BMR_adp, 0)],
  ['SD', (r) => fixedOrDash(r.sd, 0)],
  ['TEI', (r) => fixedOrDash(r.tei, 0)],
  ['Protein', (r) => fixedOrDash(r.protein, 0)],
  ['Dietary Fiber', (r) => fixedOrDash(r.fiber, 0)],
  ['Fat', (r) => fixedOrDash(r.fat, 0)],
  ['Carbohydrate', (r) => fixedOrDash(r.carbohydrate, 0)],
  ['TEF', (r) => fixedOrDash(r.tef, 0)],
  ['AEE', (r) => fixedOrDash(r.aee, 0)],
  ['Cardio', (r) => fixedOrDash(r.cardio, 0)],
  ['NEAT', (r) => fixedOrDash(r.neat, 0)],
  ['Strength', (r) => fixedOrDash(r.strength, 0)],
  ['D', (r) => fixedOrDash(r.deficit, 0)],
  ['Offset', (r) => (r.offset === null ? '—' : withExplicitSign(Math.round(r.offset)))],
];

function fixedOrDash(value, digits) {
  return value === null || value === undefined ? '—' : value.toFixed(digits);
}

// Mean of the non-null values, or null when there are none.
function meanOfPresent(values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  return present.length ? present.reduce((s, v) => s + v, 0) / present.length : null;
}

// computeBmrCalibration's own periods (so m/Δm/ΔM/D/Offset match Tune's Periods
// exactly), plus period averages of the columns that form doesn't show.
function gatherFatLossPattern(fromIso, toIso, chunkDays) {
  const result = computeBmrCalibration(fromIso, chunkDays, toIso);
  const byDate = new Map(allPhysiqueEntries.filter((p) => p.date).map((p) => [p.date, p]));

  const periods = result.weeks.map((w) => {
    const days = result.days.filter((d) => d.date >= w.weekStart && d.date <= w.weekEnd);
    const logged = days.filter((d) => d.eligible).map((d) => byDate.get(d.date));
    // Activity kcal per category; a logged day with none of a type counts as 0.
    const categoryKcal = (category) => (logged.length
      ? meanOfPresent(logged.map((p) => physiqueActivityByCategory(p)
        .filter((s) => s.category === category)
        .reduce((sum, s) => sum + (s.calories || 0), 0)))
      : null);
    return {
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      m: w.massEnd,
      deltaMass: w.deltaMass,
      deltaMKcal: w.deltaMKcal,
      // Average of each day's stored Derived cell (Physique's Derived column), per key.
      bmr: Object.fromEntries(BMR_JSON_ORDER.map((key) => [key, meanOfPresent(days.map((d) => bmrFiguresForDate(d.date)[key]))])),
      sd: meanOfPresent(days.map((d) => d.sd)),
      tei: w.avgIntake,
      protein: meanOfPresent(logged.map((p) => p.proteinIn)),
      fiber: meanOfPresent(logged.map((p) => p.fiber)),
      fat: meanOfPresent(logged.map((p) => p.fat)),
      carbohydrate: meanOfPresent(logged.map((p) => p.carbohydrate)),
      tef: meanOfPresent(days.filter((d) => d.eligible).map((d) => d.tef)),
      aee: w.avgActivity,
      cardio: categoryKcal('Cardio'),
      neat: categoryKcal('NEAT'),
      strength: categoryKcal('Strength'),
      deficit: w.deficit,
      offset: w.offset,
      loggedDays: logged.length,
    };
  });

  return {
    periods,
    reason: result.ok ? null : result.reason,
    chunkDays,
    bodyMassTargetKg: getSetting('BODY_MASS_TARGET_KG', BODY_MASS_TARGET_KG_DEFAULT),
  };
}

function renderFatLossPatternPreview(data) {
  renderInsightLines(document.getElementById('insight-pattern-profile'), formatProfileLines(gatherProfileSnapshot(), data.bodyMassTargetKg));
  const tbody = document.getElementById('insight-pattern-body');
  tbody.innerHTML = '';

  if (!data.periods.length) {
    tbody.appendChild(renderEmptyRow(FAT_LOSS_PATTERN_COLUMNS.length, data.reason || 'No periods in this range.'));
    return;
  }
  data.periods.forEach((r) => {
    const tr = document.createElement('tr');
    FAT_LOSS_PATTERN_COLUMNS.forEach(([, read]) => {
      const td = document.createElement('td');
      td.textContent = read(r);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function formatFatLossPatternPrompt(data) {
  const header = FAT_LOSS_PATTERN_COLUMNS.map(([label]) => label).join(' | ');
  const rows = data.periods
    .filter((r) => r.loggedDays)
    .map((r) => FAT_LOSS_PATTERN_COLUMNS.map(([, read]) => read(r)).join(' | '));
  return [
    ...formatProfileLines(gatherProfileSnapshot(), data.bodyMassTargetKg),
    '',
    `PERIODS (${data.chunkDays}-day averages, oldest first):`,
    header,
    ...(rows.length ? rows : ['(no logged periods in this range)']),
    '',
    'COLUMNS:',
    'm: smoothed body mass (kg) at the period end. Δm: change in body mass over the period (kg, negative = lost).',
    `ΔM (kcal): Δm × 7700 / ${data.chunkDays} — measured daily energy balance from real mass change (negative = deficit / fat lost).`,
    'BMR_mif / BMR_kat: basal metabolic rate by Mifflin-St Jeor / Katch-McArdle; BMR_cal: calibrated (equation + measured offset); BMR_adp: adapted by days on the diet — each the period average of the daily stored figure (kcal/day).',
    'SD: sleep-deprivation energy effect (kcal/day). TEI: total energy intake (kcal/day).',
    'Protein, Dietary Fiber, Fat, Carbohydrate: grams/day.',
    'TEF: thermic effect of food (kcal/day). AEE: total activity energy expenditure (kcal/day), split into Cardio, NEAT and Strength (kcal/day).',
    'D: daily energy balance the BMR equation implies (TEI − BMR − AEE − TEF, sleep-adjusted; negative = deficit).',
    'Offset: D − ΔM — how far real energy expenditure beat the equation BMR. Higher (more positive) = the body burned more than the equation predicts, i.e. a higher real BMR.',
  ].join('\n');
}

// A function of chunkDays, not a fixed string — the period length is user-editable
// (Pattern's days box), so the prompt has to name whatever length is actually in the table.
function formatFatLossPatternSystemPrompt(chunkDays) {
  return `You are a data-minded personal health coach. You are not a doctor — do not give medical diagnoses or prescribe treatment.

You'll get a table of self-tracked ${chunkDays}-day periods. Each row is one period's averages: body mass and its change, measured energy balance from mass change (ΔM), sleep effect, intake and macros, thermic effect of food, activity split by type, the equation-implied balance (D), and Offset (D − ΔM, a proxy for how much higher the person's real BMR ran than the equation's).

Your job: find which habits line up with (1) MORE fat lost — the most negative ΔM — and (2) a HIGHER real BMR — the most positive Offset. Compare the best and worst periods on each outcome, and look for columns that move together with them (e.g. higher protein, more strength, more NEAT, more carbs, better sleep). Quote the actual numbers. Be honest about the limits: few periods, logging noise and water-weight swings make these associations, not proof — say how confident each pattern is, and do not invent a pattern the numbers don't show.

Write a short plain-text report with exactly these sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only. Within a section, put each distinct point on its own line.

Best periods: which period(s) had the most fat loss and which had the highest Offset, with their figures.
Pattern: the habits that line up with more fat loss and with a higher Offset, quoting the numbers on both sides, and how confident each is.
Do this: 2-4 concrete changes, each on its own numbered line ("1. ", "2. ", …), naming the target figure.
Caveats: 1-2 lines on what the data can't tell yet and what to log to make it clearer.

If an additional question from the user is included after the data, also answer it directly in a final section, "Answer: text".

Keep the whole report under 320 words.`;
}
