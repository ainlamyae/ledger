// The one "Health Insight" panel, shared by every AI read (Plan, Wellness, Food,
// Micronutrient, Activity, Protein, Pattern). The first three used to be separate
// panels running an identical flow — pick a range, compute a local preview,
// optionally ask a question, POST to Groq, render, persist — so everything except
// the real per-mode differences (what data to gather, how to phrase it, which
// system prompt to send) lives here once, and those live in INSIGHT_MODES below.
//
// Nothing is computed until a mode button is clicked. The old panels each
// rendered their preview on page load and again when wellness data arrived,
// which meant dozens of passes over the day log — including the expensive
// muscle-group note re-parse — before anyone had opened them. Now a load that
// never touches this panel does no aggregation at all.

// Every per-mode difference. resultKeys[0]/generatedAtKeys[0] are what a save
// writes; the rest of each array is fallback read order (getSettingStringAny),
// which is how the pre-rename WELLNESS_INSIGHT_*-style rows stay readable.
const INSIGHT_MODES = {
  wellness: {
    label: 'Wellness',
    hint: '',
    questionPlaceholder: 'e.g. Should I prioritize sleep or protein right now?',
    previewId: 'insight-preview-text',
    gather: (from, to) => gatherInsightMetrics(from, to),
    formatPrompt: (data) => formatInsightPrompt(data),
    renderPreview: (data) => renderInsightPreviewLines(formatInsightPrompt(data)),
    appendQuestion: true,
    // Fat/fiber (insight.js's gatherInsightMetrics) are pulled the same way
    // Micronutrients mode pulls its numbers — via aggregateMicronutrientIntake,
    // which needs the Nutrition table loaded.
    needsNutrition: true,
    systemPrompt: INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_WELLNESS_LAST_RESULT', 'WELLNESS_INSIGHT_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_WELLNESS_LAST_GENERATED_AT', 'WELLNESS_INSIGHT_LAST_GENERATED_AT'],
  },
  food: {
    label: 'Food',
    hint: '',
    questionPlaceholder: 'e.g. Which vitamins or minerals might be missing?',
    previewId: 'insight-preview-food',
    gather: (from, to) => aggregateFoodIntake(from, to),
    // Food is the one mode that inlines the question (and its own default) into
    // the prompt body rather than appending it, so appendQuestion is false.
    formatPrompt: (rows, { from, to, question }) => formatFoodInsightPrompt(rows, from, to, question),
    renderPreview: (rows, { from, to }) => renderFoodInsightPreview(rows, from, to),
    // Group and ingredient lines: the table above.
    dataLine: /^( {2}- |.+ — \d+ ingredients?, )/,
    appendQuestion: false,
    needsNutrition: true,
    systemPrompt: FOOD_INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_FOOD_LAST_RESULT', 'FOOD_INSIGHT_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_FOOD_LAST_GENERATED_AT', 'FOOD_INSIGHT_LAST_GENERATED_AT'],
  },
  micronutrient: {
    label: 'Micronutrient',
    hint: '',
    questionPlaceholder: 'e.g. Is this amount enough? What is missing?',
    previewId: 'insight-preview-micronutrient',
    gather: (from, to) => aggregateMicronutrientIntake(from, to),
    // Micronutrient is the other mode (with Food) that inlines the question
    // into the prompt body rather than appending it — same reasoning as Food:
    // it has its own default question and phrasing built around it.
    formatPrompt: (data, { from, to, question }) => formatMicronutrientInsightPrompt(data, { from, to, question }),
    renderPreview: (data) => renderMicronutrientInsightPreview(data),
    dataLine: /^ {2}- /,
    appendQuestion: false,
    needsNutrition: true,
    systemPrompt: MICRONUTRIENT_INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_MICRONUTRIENT_LAST_RESULT', 'INSIGHT_MICRONUTRIENTS_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_MICRONUTRIENT_LAST_GENERATED_AT', 'INSIGHT_MICRONUTRIENTS_LAST_GENERATED_AT'],
  },
  activity: {
    label: 'Activity',
    hint: '',
    questionPlaceholder: 'e.g. Which muscle group should I prioritize next?',
    previewId: 'insight-preview-text',
    gather: (from, to) => gatherActivityInsightMetrics(from, to),
    formatPrompt: (data) => formatActivityInsightPrompt(data),
    renderPreview: (data) => renderInsightPreviewLines(formatActivityInsightPrompt(data)),
    appendQuestion: true,
    needsNutrition: false,
    systemPrompt: ACTIVITY_INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_ACTIVITY_LAST_RESULT', 'ACTIVITY_INSIGHT_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_ACTIVITY_LAST_GENERATED_AT', 'ACTIVITY_INSIGHT_LAST_GENERATED_AT'],
  },
  protein: {
    label: 'Protein',
    hint: '',
    questionPlaceholder: 'e.g. Which source should I prioritize next?',
    previewId: 'insight-preview-text',
    // computeProteinRotationRows is protein-rotation.js's — same rows the
    // Protein Source Rotation chart plots, so this mode can't quote a
    // different figure for the same ingredient.
    gather: (from, to) => computeProteinRotationRows(from, to),
    formatPrompt: (rows) => formatProteinRotationInsightPrompt(rows),
    renderPreview: (rows) => renderInsightPreviewLines(formatProteinRotationInsightPrompt(rows)),
    appendQuestion: true,
    needsNutrition: true,
    systemPrompt: PROTEIN_ROTATION_INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_PROTEIN_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_PROTEIN_LAST_GENERATED_AT'],
  },
  plan: {
    label: 'Plan',
    hint: '',
    questionPlaceholder: 'e.g. Is the deficit too aggressive for this timeline?',
    previewId: 'insight-preview-text',
    // The only mode whose data is the app's own SETTINGS rather than the day log —
    // the range still matters, because the actuals it's judged against come from it.
    gather: (from, to) => gatherPlanInsight(from, to),
    formatPrompt: (data) => formatPlanInsightPrompt(data),
    renderPreview: (data) => renderInsightPreviewLines(formatPlanInsightPrompt(data)),
    appendQuestion: true,
    needsNutrition: false,
    systemPrompt: PLAN_INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_PLAN_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_PLAN_LAST_GENERATED_AT'],
  },
  pattern: {
    label: 'Pattern',
    hint: '',
    questionPlaceholder: 'e.g. Does more strength training raise my BMR?',
    previewId: 'insight-preview-pattern',
    gather: (from, to) => gatherFatLossPattern(from, to, patternChunkDays()),
    formatPrompt: (data) => formatFatLossPatternPrompt(data),
    renderPreview: (data) => renderFatLossPatternPreview(data),
    dataLine: / \| |^\(no logged periods/,
    appendQuestion: true,
    needsNutrition: false,
    systemPrompt: (data) => formatFatLossPatternSystemPrompt(data.chunkDays),
    resultKeys: ['INSIGHT_PATTERN_LAST_RESULT', 'INSIGHT_PATTERNS_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_PATTERN_LAST_GENERATED_AT', 'INSIGHT_PATTERNS_LAST_GENERATED_AT'],
  },
};

const INSIGHT_LOOKBACK_DEFAULT_DAYS = 7;
const INSIGHT_PREVIEW_IDS = ['insight-preview-text', 'insight-preview-food', 'insight-preview-micronutrient', 'insight-preview-pattern'];

// What's on screen right now: which mode, the range it was gathered for, and
// the gathered data itself. Send to AI reuses this data rather than re-running
// the aggregation, and a null value is the single "nothing loaded yet" signal.
let insightLoaded = null;

let getInsightDateRange = () => ({ from: null, to: null });

function initInsightPanel() {
  clearFieldError('insight-status');
  // Starts blank — the element still carries the real status messages below
  // ("Still loading your Physique data…"), it just no longer opens with a prompt.
  document.getElementById('insight-mode-status').textContent = '';

  // Wires the From/To pair and defaults it to the last 7 days, but renders
  // nothing — a date edit only recomputes once a mode has been loaded.
  getInsightDateRange = initDateRangeControl('insight-date-from', 'insight-date-to', INSIGHT_LOOKBACK_DEFAULT_DAYS, () => {
    if (insightLoaded) loadInsightMode(insightLoaded.mode);
  });

  document.getElementById('insight-mode-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-insight-mode]');
    if (btn) loadInsightMode(btn.dataset.insightMode);
  });

  // Pattern's period length: reloads only while Pattern is on screen.
  document.getElementById('insight-pattern-period-days').addEventListener('input', () => {
    if (insightLoaded && insightLoaded.mode === 'pattern') loadInsightMode('pattern');
  });

  document.getElementById('insight-generate-btn').addEventListener('click', runInsightGeneration);
  // Back to /health/insight/: the tiles again.
  registerViewReset(document.getElementById('insight-panel'), clearInsightMode);
}

function clearInsightMode() {
  delete document.getElementById('insight-panel').dataset.insightMode;
  insightLoaded = null;
  setInsightModeButtons(null);
  document.getElementById('insight-mode-status').textContent = '';
  clearFieldError('insight-status');
}

// Pattern's L_p box, starting at Tune's L_p (its box, else the saved setting); a blank
// or invalid entry falls back to Tune's.
function patternChunkDays() {
  const saved = getSetting(BMR_CALIBRATION_PERIOD_DAYS_KEY, BMR_CALIBRATION_PERIOD_DAYS_DEFAULT);
  const tuneDays = periodInputValue('formula-cal-period-days', saved);
  const box = document.getElementById('insight-pattern-period-days');
  box.placeholder = String(tuneDays);
  if (box.dataset.defaulted !== '1') {
    box.dataset.defaulted = '1';
    box.value = String(tuneDays);
  }
  return periodInputValue('insight-pattern-period-days', tuneDays);
}

// The only path that computes anything. Gathers the mode's data for the current
// range, shows its preview and its last saved report, and arms Send to AI.
function loadInsightMode(modeKey) {
  const mode = INSIGHT_MODES[modeKey];
  if (!mode) return;
  // The mode's page, even while its data is still loading.
  document.getElementById('insight-panel').dataset.insightMode = modeKey;

  const { from, to } = getInsightDateRange();
  const statusEl = document.getElementById('insight-mode-status');
  clearFieldError('insight-status');

  if (!from || !to) {
    showFieldError('insight-status', 'Pick a From and To date first.');
    return;
  }

  // An empty in-memory array isn't the same answer as "nothing logged" — say so
  // rather than gathering a preview full of zeros from data that's still in flight.
  if (!physiqueDataLoaded || (mode.needsNutrition && !nutritionDataLoaded)) {
    statusEl.textContent = 'Still loading your Physique data — try again in a moment.';
    return;
  }

  const textarea = document.getElementById('insight-question');
  const ctx = { from, to, question: textarea.value };
  const data = mode.gather(from, to);
  insightLoaded = { mode: modeKey, from, to, data };

  document.getElementById('insight-hint').textContent = mode.hint;
  textarea.placeholder = mode.questionPlaceholder;
  showInsightPreview(mode.previewId);
  mode.renderPreview(data, ctx);
  renderInsightPromptTemplate(mode, data, ctx);
  renderSavedInsight(mode);
  setInsightModeButtons(modeKey);

  statusEl.textContent = `${mode.label} data for ${from} to ${to}.`;
  document.getElementById('insight-generate-btn').disabled = false;
}

// Wellness and Activity share one text-lines container, Food has its own
// profile-line-plus-table one; only the active mode's is visible.
function showInsightPreview(previewId) {
  INSIGHT_PREVIEW_IDS.forEach((id) => {
    document.getElementById(id).hidden = id !== previewId;
  });
}

function setInsightModeButtons(modeKey) {
  document.querySelectorAll('#insight-mode-actions [data-insight-mode]').forEach((btn) => {
    const active = btn.dataset.insightMode === modeKey;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// One <p> per line. Every mode's preview uses this, which is what keeps the
// shared profile block (age/sex/height/body mass/BMI) looking identical across all
// three instead of each mode inventing its own layout for the same five facts.
function renderInsightLines(el, lines) {
  el.innerHTML = '';
  lines.forEach((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    el.appendChild(p);
  });
}

// Shows exactly what would be sent to Groq, in plain language, so nothing about
// the request is a black box. Our own computed text, not model output.
function renderInsightPreviewLines(text) {
  renderInsightLines(document.getElementById('insight-preview-text'), text.split('\n'));
}

// The three modes only ever differed by system prompt and by whether the
// question is appended or already inlined in the prompt body; the call itself is
// groq.js's groqChatText.
function insightUserMessage(mode, data, ctx) {
  const prompt = mode.formatPrompt(data, ctx);
  if (mode.appendQuestion && ctx.question && ctx.question.trim()) {
    return `${prompt}\n\nAdditional question: ${ctx.question.trim()}`;
  }
  return prompt;
}

// The system prompt plus the user message, with every line the preview already
// shows (or a table row of it) folded into one placeholder per run.
function renderInsightPromptTemplate(mode, data, ctx) {
  const preview = document.getElementById(mode.previewId);
  const seen = new Set([...preview.querySelectorAll('p, td')].map((el) => el.textContent.trim()).filter(Boolean));
  const isData = (line) => seen.has(line.trim()) || (mode.dataLine && mode.dataLine.test(line));

  const lines = [];
  mode.formatPrompt(data, { ...ctx, question: '' }).split('\n').forEach((line) => {
    if (!line.trim() || !isData(line)) {
      lines.push(line.replace(/^Question: .*/, (q) => `Question: [your question, else: ${q.slice(10)}]`));
      return;
    }
    // Blank lines between two runs of data fold into the one placeholder too.
    while (lines.length && !lines.at(-1).trim() && lines.some((l) => l.trim())
      && lines.findLast((l) => l.trim()) === '[data shown above]') lines.pop();
    if (lines.at(-1) !== '[data shown above]') lines.push('[data shown above]');
  });
  if (mode.appendQuestion) lines.push('', 'Additional question: [your question, if any]');

  const system = typeof mode.systemPrompt === 'function' ? mode.systemPrompt(data) : mode.systemPrompt;
  document.getElementById('insight-prompt-template').textContent =
    `SYSTEM\n${system}\n\nUSER\n${lines.join('\n')}`;
  document.getElementById('insight-prompt-details').hidden = false;
}

// Only runs on an explicit Send to AI click, on the already-loaded data — so
// the aggregation happens once per load, not again per request.
async function runInsightGeneration() {
  if (!insightLoaded) return;

  const mode = INSIGHT_MODES[insightLoaded.mode];
  const { from, to } = insightLoaded;
  const body = document.getElementById('insight-body');
  const btn = document.getElementById('insight-generate-btn');
  const fromEl = document.getElementById('insight-date-from');
  const toEl = document.getElementById('insight-date-to');
  const textarea = document.getElementById('insight-question');
  const modeButtons = [...document.querySelectorAll('#insight-mode-actions [data-insight-mode]')];

  body.innerHTML = '';
  clearFieldError('insight-status');

  const loading = document.createElement('p');
  loading.className = 'hint';
  loading.textContent = `Analyzing ${from} to ${to}…`;
  body.appendChild(loading);

  btn.disabled = true;
  fromEl.disabled = true;
  toEl.disabled = true;
  textarea.disabled = true;
  modeButtons.forEach((b) => { b.disabled = true; });
  const originalLabel = btn.textContent;
  btn.textContent = '🤖…';

  try {
    // Built from the data the preview above was rendered from, not a fresh
    // pass — what was shown is exactly what gets sent.
    const ctx = { from, to, question: textarea.value };
    const systemPrompt = typeof mode.systemPrompt === 'function' ? mode.systemPrompt(insightLoaded.data) : mode.systemPrompt;
    const text = await groqChatText(systemPrompt, insightUserMessage(mode, insightLoaded.data, ctx));
    body.innerHTML = '';
    renderInsightText(body, text);

    // Persisted per mode, so a fresh page load can show the last read once that
    // mode is loaded again instead of going blank.
    const generatedAt = localTimestamp(new Date());
    try {
      await saveSettingValues({
        [mode.resultKeys[0]]: text,
        [mode.generatedAtKeys[0]]: generatedAt,
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
    modeButtons.forEach((b) => { b.disabled = false; });
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

// The loaded mode's last AI result, straight from the Settings copy already in
// memory — no sheet read, so it stays free enough to run on every mode switch.
function renderSavedInsight(mode) {
  const body = document.getElementById('insight-body');
  const text = getSettingStringAny(mode.resultKeys, null);

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
  renderInsightGeneratedAt(getSettingStringAny(mode.generatedAtKeys, null));
}
