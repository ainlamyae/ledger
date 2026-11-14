// The Health Insight panel's Plan mode: Tune's whole plan (formulas, inputs and
// the figures they produce) beside Wellness's recent averages, asking whether it
// is feasible. Built from the saved Settings, not Tune's boxes, through the same
// functions Tune and the charts use, so the three can't disagree.

// Glycogen knobs: Tune's hard-coded box defaults, so m_musc/m_gly/ΔM_gly match it.
const PLAN_GLYCOGEN_SKELETAL_PCT = 45;
const PLAN_GLYCOGEN_G_PER_KG_MUSCLE = 14;
const PLAN_GLYCOGEN_LIVER_G = 100;
const PLAN_GLYCOGEN_WATER_RATIO = 3;

// Both ends of the protein band (g/kg LBM), else the app defaults.
function planProteinPerKgBand() {
  return {
    low: getSetting('PROTEIN_G_PER_KG_LBM_MIN', PROTEIN_G_PER_KG_LBM_MIN_DEFAULT),
    high: getSetting('PROTEIN_G_PER_KG_LBM_MAX', PROTEIN_G_PER_KG_LBM_MAX_DEFAULT),
  };
}

// The plan as saved, or null when the profile is incomplete (no BMR, so no desired
// intake), the same rule as calorieDesiredDetail.
function gatherPlanSnapshot() {
  const entries = physiqueAsHealthEntries();
  // The smoothed mass, as Tune and the calorie tile use it.
  const bodyMassKg = planBodyMassKg(entries);
  const rawBodyMassKg = latestBodyMassKg(entries);
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);

  const detail = bodyMassKg === null ? null : calorieDesiredDetail(bodyMassKg);
  if (detail === null) return null;

  const met = activityMet();
  const tau = getSetting('ACTIVITY_DESIRED_MIN', ACTIVITY_DESIRED_MIN_DEFAULT);
  const kappa = getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT);
  const healthyKg = bodyMassHealthySettingKg();

  const coefficients = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa, bodyMassKg });
  const { a, b } = coefficients;
  // The same arrival date the Body Mass chart shows, on either journey.
  const projection = healthyJourneyProjection({
    intakeKcal: detail.kcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, healthyKg,
  });

  // Rounded to 0.1 kg before the grams come off it, as Tune does.
  const lbmKg = Math.round(leanBodyMassKg(bodyMassKg, heightCm, sex) * 10) / 10;
  const lbmCoefficients = leanBodyMassCoefficients(sex, heightCm);
  const perKg = planProteinPerKgBand();
  const proteinPerKgMin = Math.min(perKg.low, perKg.high);
  const proteinPerKgMax = Math.max(perKg.low, perKg.high);

  // Adaptation by the arrival date, and the plateau once BMR has sagged that far;
  // null on the proportional journey, which has no plateau.
  const adaptFraction = adaptationFraction(
    projection.status === 'ok' ? projection.days : Infinity,
    getSetting(ADAPT_PCT_PER_WEEK_KEY, ADAPT_PCT_PER_WEEK_DEFAULT),
    getSetting(ADAPT_PCT_CAP_KEY, ADAPT_PCT_CAP_DEFAULT),
  );
  const adaptedPlateau = projection.journey === 'pct'
    ? null
    : Math.round(adaptedPlateauKg(detail.kcal, coefficients, adaptFraction) * 10) / 10;

  // The rest of Tune's figures, with its inputs and rounding. Both BMR equations,
  // as in Tune's table; Mifflin is null without a birth date.
  const mifflinBmr = age === null ? null : Math.round(mifflinStJeorBmr(bodyMassKg, heightCm, age, sex));
  const katchBmr = Math.round(katchMcArdleBmr(lbmKg));
  // The saved calibration, or null (its line is then dropped).
  const calibratedBmr = calibratedBmrKcal();
  const bmiDes = heightCm ? Math.round((healthyKg / ((heightCm / 100) ** 2)) * 10) / 10 : null;
  const maintenanceKcal = Math.round(detail.bmr + detail.activityKcal);
  const deficitVsBmr = deficitVsBmrPct(detail.bmr, detail.kcal);

  // Macro bands, as Tune's renderFiber/Fat/CarbFields compute them.
  const fiberPerKcalMin = getSetting('FIBER_G_PER_1000_KCAL_MIN', FIBER_G_PER_1000_KCAL_MIN_DEFAULT);
  const fiberPerKgMax = getSetting('FIBER_G_PER_KG_MAX', FIBER_G_PER_KG_MAX_DEFAULT);
  const fatPctMin = getSetting('FAT_PCT_OF_KCAL_MIN', FAT_PCT_OF_KCAL_MIN_DEFAULT);
  const fatPctMax = getSetting('FAT_PCT_OF_KCAL_MAX', FAT_PCT_OF_KCAL_MAX_DEFAULT);
  const carbPctMin = getSetting('CARB_PCT_OF_KCAL_MIN', CARB_PCT_OF_KCAL_MIN_DEFAULT);
  const carbPctMax = getSetting('CARB_PCT_OF_KCAL_MAX', CARB_PCT_OF_KCAL_MAX_DEFAULT);

  const muscleKg = Math.round((lbmKg * (PLAN_GLYCOGEN_SKELETAL_PCT / 100)) * 10) / 10;
  const glycogenG = Math.round(PLAN_GLYCOGEN_G_PER_KG_MUSCLE * muscleKg + PLAN_GLYCOGEN_LIVER_G);
  const glycogenSwingKg = Math.round((glycogenG * (1 + PLAN_GLYCOGEN_WATER_RATIO)) / 100) / 10;

  return {
    bodyMassKg, rawBodyMassKg, heightCm, age, sex, healthyKg, met, tau, kappa,
    formula: coefficients.formula,
    mifflinBmr, katchBmr, calibratedBmr, bmiDes, maintenanceKcal, deficitVsBmrPct: deficitVsBmr,
    fiberPerKcalMin, fiberPerKgMax, fatPctMin, fatPctMax, carbPctMin, carbPctMax,
    fiberMinG: Math.round(fiberPerKcalMin * (detail.kcal / 1000)),
    fiberMaxG: Math.round(fiberPerKgMax * bodyMassKg),
    fatMinG: Math.round((fatPctMin / 100) * detail.kcal / KCAL_PER_G_FAT),
    fatMaxG: Math.round((fatPctMax / 100) * detail.kcal / KCAL_PER_G_FAT),
    carbMinG: Math.round((carbPctMin / 100) * detail.kcal / KCAL_PER_G_CARB),
    carbMaxG: Math.round((carbPctMax / 100) * detail.kcal / KCAL_PER_G_CARB),
    muscle: {
      skeletalPct: PLAN_GLYCOGEN_SKELETAL_PCT,
      perKgMuscle: PLAN_GLYCOGEN_G_PER_KG_MUSCLE,
      liverG: PLAN_GLYCOGEN_LIVER_G,
      waterRatio: PLAN_GLYCOGEN_WATER_RATIO,
      muscleKg,
      glycogenG,
      swingKg: glycogenSwingKg,
    },
    tefPercent: Math.round((1 - coefficients.tefDivisor) * 1000) / 10,
    tefKcal: Math.round(detail.tefKcal),
    adaptPct: Math.round(adaptFraction * 1000) / 10,
    adaptedBmr: Math.round(detail.bmr * (1 - adaptFraction)),
    adaptedPlateau,
    // The sleep-adjusted deficit Ein was built from, and the raw dm × 7700 / 7 rate.
    deficitKcal: Math.round(detail.deficit),
    rawDeficitKcal: Math.round(detail.rawDeficit),
    sleepDeprivationEffectKcal: detail.sleepDeprivationEffectKcal,
    planSleepHours: detail.planSleepHours,
    sleepDesiredHours: detail.sleepDesiredHours,
    weeklyFatLossKg: detail.weeklyFatLossKg,
    bmr: Math.round(detail.bmr),
    activityKcal: Math.round(detail.activityKcal),
    intakeKcal: detail.kcal,
    // Which figure is pinned changes what "following the plan" means.
    intakeIsPinned: pinnedCalorieDesiredKcal() !== null,
    pinnedPct: pinnedWeeklyFatLossPct(),
    weeklyFatLossPct: weeklyFatLossPct(detail.weeklyFatLossKg, bodyMassKg),
    activityIsPinned: pinnedActivityDesiredKcal() !== null,
    a: Math.round(a),
    b: Math.round(b * 100) / 100,
    equilibriumKg: Math.round(projection.equilibriumKg * 10) / 10,
    projection,
    lbmKg,
    lbmNavyBfPct: lbmCoefficients.formula === 'navy' ? lbmCoefficients.bfPct : null,
    leanPercent: Math.round((lbmKg / bodyMassKg) * 1000) / 10,
    proteinPerKgMin,
    proteinPerKgMax,
    proteinMinG: Math.round(lbmKg * proteinPerKgMin),
    proteinMaxG: Math.round(lbmKg * proteinPerKgMax),
  };
}

// The plan plus Wellness's own actuals, so the two modes quote the same averages.
function gatherPlanInsight(fromIso, toIso) {
  return { plan: gatherPlanSnapshot(), actuals: gatherInsightMetrics(fromIso, toIso) };
}

// The substituted arithmetic, as Tune prints it, so the model can name the input to change.
function planSubstitutedLines(p) {
  const sigma = p.sex === 'male' ? '+ 5' : '− 161';
  const katch = p.formula === 'katch';
  // No "/ 1" divisor at f = 0.
  const byF = p.tefPercent > 0 ? `, all / (1 − ${p.tefPercent}/100)` : '';
  const hM = Math.round((p.heightCm / 100) * 100) / 100;
  const proportional = p.projection.journey === 'pct';

  // In Tune's order.
  const lines = [];

  const lbmTerms = p.lbmNavyBfPct !== null
    ? `${p.bodyMassKg} × (1 − ${p.lbmNavyBfPct}/100), U.S. Navy`
    : `${p.sex === 'male' ? `0.407 × ${p.bodyMassKg} + 0.267 × ${p.heightCm} − 19.2` : `0.252 × ${p.bodyMassKg} + 0.473 × ${p.heightCm} − 48.3`}, Boer`;
  lines.push(`LBM: ${lbmTerms} = ${p.lbmKg} kg (${p.leanPercent}% of body mass)`);

  // The plan runs on whichever BMR PLAN INPUTS names.
  if (p.mifflinBmr !== null) lines.push(`BMR_mif (Mifflin-St Jeor): 10 × ${p.bodyMassKg} + 6.25 × ${p.heightCm} − 5 × ${p.age} ${sigma} = ${p.mifflinBmr} kcal/day`);
  lines.push(`BMR_kat (Katch-McArdle, from lean mass): 370 + 21.6 × ${p.lbmKg} = ${p.katchBmr} kcal/day`);
  if (p.calibratedBmr !== null) lines.push(`BMR_cal (calibrated — back-solved from logged intake/activity/body-mass change): ${p.calibratedBmr} kcal/day`);

  lines.push(`Ea (AEE): ${p.met} × ${p.bodyMassKg} × ${p.tau} × ${p.kappa} / 200 = ${p.activityKcal} kcal/day`);

  lines.push(p.sleepDeprivationEffectKcal > 0
    ? `D: (${p.weeklyFatLossKg} × 7700 / 7) / eta = ${p.rawDeficitKcal} / eta = ${p.deficitKcal} kcal/day — eta is the Sleep Efficiency Factor for ${p.planSleepHours}h assumed sleep against ${p.sleepDesiredHours}h desired sleep, so short sleep adds ${p.sleepDeprivationEffectKcal} kcal/day (SD) to the raw rate`
    : `D: ${p.weeklyFatLossKg} × 7700 / 7 = ${p.deficitKcal} kcal/day`);

  lines.push(p.tefPercent > 0
    ? `Ein (TEI): (${p.bmr} + ${p.activityKcal} − ${p.deficitKcal}) / (1 − ${p.tefPercent}/100) = ${p.intakeKcal} kcal/day`
    : `Ein (TEI): ${p.bmr} + ${p.activityKcal} − ${p.deficitKcal} = ${p.intakeKcal} kcal/day`);

  lines.push(`TEF: ${p.tefPercent}% × ${p.intakeKcal} = ${p.tefKcal} kcal/day`);
  lines.push(`dm (Δm): ${p.deficitKcal} × 7 / 7700 = ${p.weeklyFatLossKg} kg/week`);

  lines.push(katch
    ? `A: 370 + 21.6 × (lean-mass terms in h)${byF} = ${p.a} kcal/day`
    : `A: 6.25 × ${p.heightCm} − 5 × ${p.age} ${sigma}${byF} = ${p.a} kcal/day`);
  lines.push(katch
    ? `B: 21.6 × (lean-mass kg term) + ${p.met} × ${p.tau} × ${p.kappa} / 200${byF} = ${p.b} kcal/day per kg`
    : `B: 10 + ${p.met} × ${p.tau} × ${p.kappa} / 200${byF} = ${p.b} kcal/day per kg`);

  // m_inf only exists on the constant-intake journey.
  if (!proportional) lines.push(`m_inf: (${p.intakeKcal} − ${p.a}) / ${p.b} = ${p.equilibriumKg} kg`);

  if (p.projection.status === 'ok' && proportional) {
    lines.push(`t: 7 × ln(${p.bodyMassKg} / ${p.healthyKg}) / −ln(1 − ${p.pinnedPct}/100) = ${Math.round(p.projection.days)} days, arriving ${p.projection.etaIso} (no plateau: a constant share of a falling mass always reaches the healthy body mass)`);
  } else if (p.projection.status === 'ok') {
    lines.push(`t: (7700 / ${p.b}) × ln[(${p.bodyMassKg} − ${p.equilibriumKg}) / (${p.healthyKg} − ${p.equilibriumKg})] = ${Math.round(p.projection.days)} days, arriving ${p.projection.etaIso}`);
  } else if (p.projection.status === 'unreachable' && proportional) {
    lines.push(`t: never — ${p.projection.reason}`);
  } else if (p.projection.status === 'unreachable') {
    lines.push(`t: never — at this intake the body mass levels off at ${p.equilibriumKg} kg, short of the ${p.healthyKg} kg healthy body mass`);
  } else if (p.projection.status === 'reached') {
    lines.push('t: already at the healthy body mass');
  }

  if (p.bmiDes !== null) lines.push(`BMI_des: ${p.healthyKg} / (${hM})² = ${p.bmiDes} kg/m²`);
  lines.push(`dm%: 100 × ${p.weeklyFatLossKg} / ${p.bodyMassKg} = ${p.weeklyFatLossPct} %/week`);
  if (p.deficitVsBmrPct !== null) lines.push(`D_bmr%: (${p.bmr} − ${p.intakeKcal}) / ${p.bmr} × 100 = ${p.deficitVsBmrPct} %`);

  // Adaptation: reported, not planned with; m_inf is the optimistic figure.
  if (p.adaptPct > 0) {
    const whenNote = p.projection.status === 'ok' ? ' by the arrival date' : ' at the adaptation ceiling';
    lines.push(`BMR_adp: ${p.bmr} × (1 − ${p.adaptPct}/100) = ${p.adaptedBmr} kcal/day${whenNote}`);
    if (p.adaptedPlateau !== null) {
      lines.push(`m_inf_adp: adapted plateau ${p.adaptedPlateau} kg — ${Math.round((p.adaptedPlateau - p.equilibriumKg) * 10) / 10} kg above m_inf, the usual overshoot. Refeeds and diet breaks push it back toward the un-adapted figure.`);
    }
  }

  lines.push(
    `m_musc: ${p.muscle.skeletalPct}% × ${p.lbmKg} = ${p.muscle.muscleKg} kg`,
    `m_gly: ${p.muscle.perKgMuscle} × ${p.muscle.muscleKg} + ${p.muscle.liverG} = ${p.muscle.glycogenG} g`,
    `ΔM_gly: ${p.muscle.glycogenG} × (1 + ${p.muscle.waterRatio}) / 1000 = ${p.muscle.swingKg} kg`,
    `P_min: ${p.proteinPerKgMin} × ${p.lbmKg} = ${p.proteinMinG} g/day`,
    `P_max: ${p.proteinPerKgMax} × ${p.lbmKg} = ${p.proteinMaxG} g/day`,
    `F_min: ${p.fiberPerKcalMin} × (${p.intakeKcal} / 1000) = ${p.fiberMinG} g/day`,
    `F_max: ${p.fiberPerKgMax} × ${p.bodyMassKg} = ${p.fiberMaxG} g/day`,
    `G_min: (${p.fatPctMin}% × ${p.intakeKcal}) / 9 = ${p.fatMinG} g/day`,
    `G_max: (${p.fatPctMax}% × ${p.intakeKcal}) / 9 = ${p.fatMaxG} g/day`,
    `C_min: (${p.carbPctMin}% × ${p.intakeKcal}) / 4 = ${p.carbMinG} g/day`,
    `C_max: (${p.carbPctMax}% × ${p.intakeKcal}) / 4 = ${p.carbMaxG} g/day`,
  );
  return lines;
}

// Which of the three (mutually exclusive) rate pins is in force, in words.
function planRatePinDescription(p) {
  if (p.intakeIsPinned) return 'the daily intake is pinned, so the deficit shrinks as body mass drops';
  if (p.pinnedPct !== null) {
    return `the fat-loss rate is pinned as a PERCENTAGE of body mass (${p.pinnedPct}%/week), so the kilograms per week and the intake are both recalculated at every body-mass reading and the pace stays proportional`;
  }
  return 'the weekly fat-loss rate is pinned in kilograms, so the intake is recalculated at every body-mass reading';
}

function planInputLines(p) {
  // Tune's order: sex, height, age, then the body-mass rows.
  return [
    `sigma (sex): ${p.sex}`,
    `h (height): ${p.heightCm} cm`,
    `a (age): ${p.age} years${p.formula === 'katch' ? ' (unused — the Katch-McArdle BMR equation does not read age)' : ''}`,
    `m (latest single body-mass reading): ${p.rawBodyMassKg} kg`,
    `m_bar (L_p-day rolling average, L_p = ${bodyMassSmoothingDays()} days — the mass every figure below is evaluated at): ${p.bodyMassKg} kg`,
    `m_g (healthy body mass): ${p.healthyKg} kg`,
    `MET (assumed activity intensity): ${p.met}`,
    `tau (desired daily activity): ${p.tau} min/day`,
    `kappa (oxygen uptake per MET): ${p.kappa} mL O2/kg/min`,
    `dm (desired weekly fat loss): ${p.weeklyFatLossKg} kg/week, i.e. ${p.weeklyFatLossPct}% of current body mass per week`,
    `s (sleep length the plan assumes) vs. desired sleep: ${p.planSleepHours}h vs. ${p.sleepDesiredHours}h${p.sleepDeprivationEffectKcal > 0 ? ` — short of desired sleep, so the deficit above is inflated by ${p.sleepDeprivationEffectKcal} kcal/day to compensate` : ' — at or above desired sleep, no deficit adjustment'}`,
    `p_min - p_max (protein per kg of lean mass): ${p.proteinPerKgMin} - ${p.proteinPerKgMax} g/kg LBM/day`,
    `BMR equation in force: ${p.formula === 'katch' ? 'Katch-McArdle, BMR = 370 + 21.6 x LBM' : 'Mifflin-St Jeor, BMR = 10m + 6.25h - 5a + sigma'}`,
    `f (thermic effect of food): ${p.tefPercent}% of intake${p.tefPercent > 0 ? '' : ' (not counted in this plan)'}`,
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
    // Inputs, then the model, then its figures (Tune's order).
    'PLAN INPUTS:',
    ...planInputLines(plan),
    '',
    'THE PLAN — the formulas this app derives the desired figures from:',
    // Tune's own text, verbatim.
    FORMULA_EXPRESSION,
    '',
    'WHAT THOSE INPUTS PRODUCE (each line is the substituted arithmetic, in the same order as the Tune panel):',
    ...planSubstitutedLines(plan),
    '',
    'RECENT LOGGING — what is actually being done, over the selected period:',
    formatInsightPrompt(actuals),
  ].join('\n');
}

const PLAN_INSIGHT_SYSTEM_PROMPT = `You are a supportive personal health coach reviewing a fat-loss plan someone built for themselves, and the self-tracked logging that shows how they are actually doing against it. You are not a doctor — do not give medical diagnoses or prescribe treatment.

You'll be given three things: THE PLAN (the published formulas the app uses — a BMR equation, either Mifflin-St Jeor or Katch-McArdle from lean mass, whichever PLAN INPUTS says is in force; the ACSM activity equation; an optional thermic-effect-of-food correction; an exponential body-mass decay model; and the Boer lean-body-mass equation. Body mass throughout is a 7-day rolling average, not a single body-mass reading), PLAN INPUTS (the person's own numbers fed into them, plus which figure they hold fixed as body mass falls), WHAT THOSE INPUTS PRODUCE (the same arithmetic substituted, ending in a desired daily intake Ein, a plateau body mass m_inf, an estimated number of days t to the healthy body mass, and a daily protein band P_min-P_max scaled to lean mass), and RECENT LOGGING (their recent averages versus their desired figures and the preceding period, and their measured body-mass trajectory).

Your job is to judge whether this plan is FEASIBLE and SAFE for this person, and whether their logging shows it being followed. Reason about the actual numbers you were given — quote them.

Check these specifically:
- Is the desired intake Ein sensible against their BMR? An intake at or below BMR, or a very large gap between the two, is a warning sign worth naming plainly. Compare Ein to their BMR figure and say what the relationship is.
- Is the weekly fat-loss rate realistic? Roughly 0.5-1% of body mass per week is the usual sustainable range; well above that risks muscle loss, poor adherence and rebound, and the arrival date it promises is unlikely to hold.
- Is the desired activity (tau minutes/day at that MET) something a person can genuinely do every day, and does the recent logging show them doing it? A plan whose burn assumes daily activity that is not being logged is arithmetic, not a plan.
- Is the protein band adequate to protect lean mass at that deficit, and is the recent protein average inside it? Protein below the band during a deficit is the single most common way a plan loses muscle instead of fat.
- Is the timeline t plausible, and does it agree with the measured trajectory in RECENT LOGGING? If the plan says one date and the actual trend implies another, say so and explain which inputs are responsible.
- Does anything in the plan contradict something else in it?

Write a short plain-text report with exactly these sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only. Within a section, if you're naming more than one distinct point, put each one on its own line — never run multiple points together in one paragraph, with or without a bullet character.

Verdict: one or two sentences — is this plan feasible as written? Say plainly whether it is sound, aggressive but workable, or unsafe/unrealistic, and why.
What works: the parts of the plan that are well set, quoting the figures.
Risks: the specific parts that are too aggressive, internally inconsistent, or not supported by the logging. Name the input responsible for each.
Do this: 2-4 concrete changes, each on its own numbered line (a line starting "1. ", then a new line starting "2. ", and so on). Where a number should change, say what to change it to and what that does to Ein, the protein band, or the arrival date.
Avoid this: 2-3 specific things not to do, each on its own numbered line — the traps this particular plan sets up, not generic advice.

If an additional question from the user is included after the data, also answer it directly in a final section, "Answer: text".

Keep the whole report under 320 words.`;
