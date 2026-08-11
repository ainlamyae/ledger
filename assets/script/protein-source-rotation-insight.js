// The Health Insight panel's Protein Sources mode: how well actual eating
// matched the per-ingredient protein-source rotation plan (protein-rotation.js)
// — each tracked ingredient's own target share of the protein target vs. the
// share actually eaten in the selected window. Reuses computeProteinRotationRows
// exactly, so this mode's numbers can't disagree with the Protein Source
// Rotation chart. insight-panel.js drives it.

function formatProteinRotationInsightPrompt(rows) {
  const lines = [...formatProfileLines(gatherProfileSnapshot()), ''];

  if (rows.length === 0) {
    lines.push('No ingredients are tracked for protein-source rotation yet — nothing has a Protein % set in Nutrition Facts.');
    return lines.join('\n');
  }

  lines.push('Protein source rotation — each tracked ingredient\'s target share of the protein target vs. the share actually eaten this window, grouped by classification, largest shortfall first:');
  let lastClassification = null;
  rows.forEach((r) => {
    if (r.classification !== lastClassification) {
      lines.push(`${r.classification}:`);
      lastClassification = r.classification;
    }
    lines.push(`  - ${r.name}: target ${r.proteinPercent}% of protein target (${r.targetProteinG}g) — actually ate ${r.actualPercentOfTotalTarget}% (${r.actualProteinG}g)`);
  });

  return lines.join('\n');
}

const PROTEIN_ROTATION_INSIGHT_SYSTEM_PROMPT = `You are a supportive nutrition coach reviewing someone's own self-tracked protein SOURCES — not total protein intake, which is a separate metric they track elsewhere. You are not a doctor — do not diagnose deficiencies or prescribe supplements; if something sounds medical, tell them to see a professional instead of advising around it.

You'll be given: their age, sex, height, current body mass and BMI (any of which may read "not set" — treat that as missing, never guess a value); and a list of every ingredient they've marked as a tracked protein source, each with a TARGET share of their protein target (a percentage they assigned it themselves, e.g. "chicken = 20% of my protein") and the share they ACTUALLY ate from it in the selected window, grouped by the classification they assigned it (e.g. Poultry, Fish, Plant, Dairy).

The target percentages are the person's own rotation plan, not a nutritional prescription — your job is to read how well their actual eating matched the mix they set for themselves, not to second-guess the mix itself. A source at 0% actual against a real target is one they haven't touched all window; a source over its target percentage is one they leaned on more than planned, which may simply mean another source was skipped.

Write a short plain-text report with exactly these four sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on how closely the actual mix tracked the target rotation this window.
Going well: which sources or classifications are on or near their target share.
Needs attention: which sources are furthest short of their target share (especially any at or near 0%), and any single source running well over its target at another's expense.
Suggestions: 2-4 concrete next steps — name actual ingredients from their own list and, where useful, roughly how much more (in grams) would close the gap.

If an additional question from the user is included after the data, also answer it directly in a fifth section, "Answer: text".

Keep the whole report under 250 words.`;
