// "Health Plan" mode of the Health Insight panel: sends the Formula Playground's
// whole plan — the published identities, the inputs behind them, and the figures
// they produce — and asks whether the plan is actually feasible.
//
// The other four modes report what HAPPENED. This one reports what the settings
// INTEND, and pairs it with the same recent averages Wellness reads so the model
// can judge the plan against the logging rather than in the abstract: a 1,228 kcal
// target is a different proposition for someone averaging 1,300 than for someone
// averaging 2,100.
//
// Computed from `Settings` plus the latest weigh-in, NOT from the playground's
// input boxes — the modal may never have been opened this session, and the saved
// values are what the app actually runs on. Every figure goes through the same
// functions the playground and the charts use (calorieTargetDetail,
// maintenanceAffineCoefficients, projectTargetDays, boerLeanBodyMassKg), so all
// three can't disagree about the same plan.

// Both ends of the protein band, in the LBM-scaled form the playground writes.
// Falls back to the app-wide default pair when the sheet has no rule yet, so the
// prompt still shows what the band WOULD be rather than dropping the section.
function planProteinPerKgBand() {
  return {
    low: getSetting('PROTEIN_G_PER_KG_LBM_MIN', PROTEIN_G_PER_KG_LBM_MIN_DEFAULT),
    high: getSetting('PROTEIN_G_PER_KG_LBM_MAX', PROTEIN_G_PER_KG_LBM_MAX_DEFAULT),
  };
}

// The plan as the app currently holds it, or null when the profile it's built from
// is incomplete — the same all-or-nothing rule calorieTargetDetail applies, since
// a plan missing height or sex has no BMR and therefore no target at all.
function gatherPlanSnapshot() {
  const entries = physiqueAsWellnessEntries();
  const bodyMassKg = latestBodyMassKg(entries);
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);

  const detail = bodyMassKg === null ? null : calorieTargetDetail(bodyMassKg);
  if (detail === null) return null;

  const met = activityMet();
  const tau = getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT);
  const kappa = getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT);
  const targetKg = getSetting('BODY_MASS_TARGET_KG', BODY_MASS_TARGET_KG_DEFAULT);

  const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa });
  // targetJourneyProjection, not projectTargetDays: with the percentage pinned the plan walks
  // the proportional journey, and the prompt has to be judging the same arrival date the Body
  // Mass chart is showing.
  const projection = targetJourneyProjection({
    intakeKcal: detail.kcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg,
  });

  // Rounded to 0.1 kg before the grams come off it, exactly as the playground does
  // — so the two report the same band rather than differing by a gram.
  const lbmKg = Math.round(boerLeanBodyMassKg(bodyMassKg, heightCm, sex) * 10) / 10;
  const perKg = planProteinPerKgBand();

  return {
    bodyMassKg, heightCm, age, sex, targetKg, met, tau, kappa,
    deficitKcal: Math.round((detail.weeklyFatLossKg * GENERIC_KCAL_PER_KG_FAT) / 7),
    weeklyFatLossKg: detail.weeklyFatLossKg,
    bmr: Math.round(detail.bmr),
    activityKcal: Math.round(detail.activityKcal),
    intakeKcal: detail.kcal,
    // Whether that intake is a pinned figure, a pinned percentage of body mass, or
    // recalculated from a fixed kilogram rate is the plan's own design decision, and it
    // changes what "following the plan" means — so the model is told which is in force.
    intakeIsPinned: pinnedCalorieTargetKcal() !== null,
    pinnedPct: pinnedWeeklyFatLossPct(),
    weeklyFatLossPct: weeklyFatLossPct(detail.weeklyFatLossKg, bodyMassKg),
    activityIsPinned: pinnedActivityTargetKcal() !== null,
    a: Math.round(a),
    b: Math.round(b * 100) / 100,
    equilibriumKg: Math.round(projection.equilibriumKg * 10) / 10,
    projection,
    lbmKg,
    leanPercent: Math.round((lbmKg / bodyMassKg) * 1000) / 10,
    proteinPerKgMin: Math.min(perKg.low, perKg.high),
    proteinPerKgMax: Math.max(perKg.low, perKg.high),
    proteinMinG: Math.round(lbmKg * Math.min(perKg.low, perKg.high)),
    proteinMaxG: Math.round(lbmKg * Math.max(perKg.low, perKg.high)),
  };
}

// The plan plus the reality it has to survive. gatherInsightMetrics is Wellness'
// own aggregation, reused as-is: feasibility is a question about the gap between
// the two, and computing the actuals a second way here would let the two modes
// quote different averages for the same week.
function gatherPlanInsight(fromIso, toIso) {
  return { plan: gatherPlanSnapshot(), actuals: gatherInsightMetrics(fromIso, toIso) };
}

// The arithmetic, substituted — the same trace the playground prints under its
// inputs. Sent rather than just the results so the model can see WHERE a number
// comes from and name the input to change, instead of only that it's aggressive.
function planSubstitutedLines(p) {
  const sigma = p.sex === 'male' ? '+ 5' : '− 161';
  const lines = [
    `BMR: 10 × ${p.bodyMassKg} + 6.25 × ${p.heightCm} − 5 × ${p.age} ${sigma} = ${p.bmr} kcal/day`,
    `Ea: ${p.met} × ${p.bodyMassKg} × ${p.tau} × ${p.kappa} / 200 = ${p.activityKcal} kcal/day`,
    // Spelled out rather than left for the model to divide: the sustainable band it's
    // asked to judge the plan against is written in percent, and this is the same figure
    // the playground shows beside the Δm box.
    `dm%: 100 × ${p.weeklyFatLossKg} / ${p.bodyMassKg} = ${p.weeklyFatLossPct} %/week`,
    `D: ${p.weeklyFatLossKg} × 7700 / 7 = ${p.deficitKcal} kcal/day`,
    `Ein: ${p.bmr} + ${p.activityKcal} − ${p.deficitKcal} = ${p.intakeKcal} kcal/day`,
    `A: 6.25 × ${p.heightCm} − 5 × ${p.age} ${sigma} = ${p.a} kcal/day`,
    `B: 10 + ${p.met} × ${p.tau} × ${p.kappa} / 200 = ${p.b} kcal/day per kg`,
  ];

  // Two journeys, two arrival dates, and m_inf only exists in one of them: with the
  // percentage pinned nothing holds Ein still, so there is no intake plateau to level off
  // at — quoting one would invite the model to reason about a plateau this plan can't have.
  const proportional = p.projection.journey === 'pct';
  if (!proportional) lines.push(`m_inf: (${p.intakeKcal} − ${p.a}) / ${p.b} = ${p.equilibriumKg} kg`);

  if (p.projection.status === 'ok' && proportional) {
    lines.push(`t: 7 × ln(${p.bodyMassKg} / ${p.targetKg}) / −ln(1 − ${p.pinnedPct}/100) = ${Math.round(p.projection.days)} days, arriving ${p.projection.etaIso} (no plateau: a constant share of a falling mass always reaches the target)`);
  } else if (p.projection.status === 'ok') {
    lines.push(`t: (7700 / ${p.b}) × ln[(${p.bodyMassKg} − ${p.equilibriumKg}) / (${p.targetKg} − ${p.equilibriumKg})] = ${Math.round(p.projection.days)} days, arriving ${p.projection.etaIso}`);
  } else if (p.projection.status === 'unreachable' && proportional) {
    lines.push(`t: never — ${p.projection.reason}`);
  } else if (p.projection.status === 'unreachable') {
    lines.push(`t: never — at this intake the body mass levels off at ${p.equilibriumKg} kg, short of the ${p.targetKg} kg target`);
  } else if (p.projection.status === 'reached') {
    lines.push('t: already at the target body mass');
  }
  lines.push(
    `LBM: ${p.sex === 'male' ? `0.407 × ${p.bodyMassKg} + 0.267 × ${p.heightCm} − 19.2` : `0.252 × ${p.bodyMassKg} + 0.473 × ${p.heightCm} − 48.3`} = ${p.lbmKg} kg (${p.leanPercent}% of body mass)`,
    `P_min: ${p.proteinPerKgMin} × ${p.lbmKg} = ${p.proteinMinG} g/day`,
    `P_max: ${p.proteinPerKgMax} × ${p.lbmKg} = ${p.proteinMaxG} g/day`,
  );
  return lines;
}

// Which of the three rate plans is in force, in words — the pins are mutually exclusive, so
// exactly one of these describes the sheet. It matters to the judgement, not just the
// arithmetic: the same target intake is a different promise depending on whether it will be
// recut at the next weigh-in, and how.
function planRatePinDescription(p) {
  if (p.intakeIsPinned) return 'the daily intake is pinned, so the deficit shrinks as body mass drops';
  if (p.pinnedPct !== null) {
    return `the fat-loss rate is pinned as a PERCENTAGE of body mass (${p.pinnedPct}%/week), so the kilograms per week and the intake are both recalculated at every weigh-in and the pace stays proportional`;
  }
  return 'the weekly fat-loss rate is pinned in kilograms, so the intake is recalculated at every weigh-in';
}

function planInputLines(p) {
  return [
    `m (current body mass): ${p.bodyMassKg} kg`,
    `m_g (target body mass): ${p.targetKg} kg`,
    `h (height): ${p.heightCm} cm`,
    `a (age): ${p.age} years`,
    `sigma (sex): ${p.sex}`,
    `MET (assumed activity intensity): ${p.met}`,
    `tau (daily activity target): ${p.tau} min/day`,
    `kappa (oxygen uptake per MET): ${p.kappa} mL O2/kg/min`,
    `dm (weekly fat loss target): ${p.weeklyFatLossKg} kg/week, i.e. ${p.weeklyFatLossPct}% of current body mass per week`,
    `p_min - p_max (protein per kg of lean mass): ${p.proteinPerKgMin} - ${p.proteinPerKgMax} g/kg LBM/day`,
    'rho (fat energy density): 7700 kcal/kg (population constant)',
    'epsilon (oxygen energy yield): 200 mL O2/kcal (population constant)',
    `Which figure is held fixed as body mass falls: ${planRatePinDescription(p)}; ${p.activityIsPinned ? 'the activity calorie burn is pinned, so the minutes needed rise as body mass drops' : 'the activity minutes are pinned, so the burn they produce falls as body mass drops'}`,
  ];
}

function formatPlanInsightPrompt(data) {
  const { plan, actuals } = data;
  if (plan === null) {
    return [
      'THE PLAN: cannot be computed yet.',
      'It needs HEIGHT_CM, BIRTH_DATE, SEX and WEEKLY_FAT_LOSS_KG on the Settings tab, plus at least one logged body mass.',
      '',
      'RECENT LOGGING:',
      formatInsightPrompt(actuals),
    ].join('\n');
  }

  return [
    'THE PLAN — the formulas this app derives the targets from:',
    // The playground's own text, not a paraphrase: one definition of the model,
    // shown on screen and sent to the model.
    FORMULA_EXPRESSION,
    '',
    'PLAN INPUTS:',
    ...planInputLines(plan),
    '',
    'WHAT THOSE INPUTS PRODUCE (each line is the substituted arithmetic):',
    ...planSubstitutedLines(plan),
    '',
    'RECENT LOGGING — what is actually being done, over the selected period:',
    formatInsightPrompt(actuals),
  ].join('\n');
}

const PLAN_INSIGHT_SYSTEM_PROMPT = `You are a supportive personal health coach reviewing a fat-loss plan someone built for themselves, and the self-tracked logging that shows how they are actually doing against it. You are not a doctor — do not give medical diagnoses or prescribe treatment.

You'll be given three things: THE PLAN (the published formulas the app uses — Mifflin-St Jeor BMR, the ACSM activity equation, an exponential body-mass decay model, and the Boer lean-body-mass equation), PLAN INPUTS (the person's own numbers fed into them, plus which figure they hold fixed as body mass falls), WHAT THOSE INPUTS PRODUCE (the same arithmetic substituted, ending in a target daily intake Ein, a plateau body mass m_inf, an estimated number of days t to the target, and a daily protein band P_min-P_max scaled to lean mass), and RECENT LOGGING (their recent averages versus their targets and the preceding period, and their measured body-mass trajectory).

Your job is to judge whether this plan is FEASIBLE and SAFE for this person, and whether their logging shows it being followed. Reason about the actual numbers you were given — quote them.

Check these specifically:
- Is the target intake Ein sensible against their BMR? An intake at or below BMR, or a very large gap between the two, is a warning sign worth naming plainly. Compare Ein to their BMR figure and say what the relationship is.
- Is the weekly fat-loss rate realistic? Roughly 0.5-1% of body mass per week is the usual sustainable range; well above that risks muscle loss, poor adherence and rebound, and the arrival date it promises is unlikely to hold.
- Is the activity target (tau minutes/day at that MET) something a person can genuinely do every day, and does the recent logging show them doing it? A plan whose burn assumes daily activity that is not being logged is arithmetic, not a plan.
- Is the protein band adequate to protect lean mass at that deficit, and is the recent protein average inside it? Protein below the band during a deficit is the single most common way a plan loses muscle instead of fat.
- Is the timeline t plausible, and does it agree with the measured trajectory in RECENT LOGGING? If the plan says one date and the actual trend implies another, say so and explain which inputs are responsible.
- Does anything in the plan contradict something else in it?

Write a short plain-text report with exactly these sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Verdict: one or two sentences — is this plan feasible as written? Say plainly whether it is sound, aggressive but workable, or unsafe/unrealistic, and why.
What works: the parts of the plan that are well set, quoting the figures.
Risks: the specific parts that are too aggressive, internally inconsistent, or not supported by the logging. Name the input responsible for each.
Do this: 2-4 concrete changes, each on its own numbered line (a line starting "1. ", then a new line starting "2. ", and so on). Where a number should change, say what to change it to and what that does to Ein, the protein band, or the arrival date.
Avoid this: 2-3 specific things not to do, each on its own numbered line — the traps this particular plan sets up, not generic advice.

If an additional question from the user is included after the data, also answer it directly in a final section, "Answer: text".

Keep the whole report under 320 words.`;
