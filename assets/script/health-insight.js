// The Health Insight panel, shared by every AI read (Plan, Wellness, Food,
// Micronutrient, Activity, Protein, Pattern). The flow (pick a range, preview, ask,
// send, persist) lives here once; the per-mode differences live in INSIGHT_MODES.
// Nothing is computed until a mode button is clicked.

// Wellness, Activity, Protein and Plan preview their prompt text as lines here.
const INSIGHT_TEXT_PREVIEW_ID = 'insight-preview-text';

// Every per-mode difference. resultKeys[0]/generatedAtKeys[0] are what a save
// writes; the rest are older names still read as fallbacks.
// A mode without renderPreview shows its own prompt in INSIGHT_TEXT_PREVIEW_ID.
// appendQuestion false: the mode inlines the question (with its own default) itself.
const INSIGHT_MODES = {
  wellness: {
    label: 'Wellness',
    questionPlaceholder: 'e.g. Should I prioritize sleep or protein right now?',
    gather: (from, to) => gatherInsightMetrics(from, to),
    formatPrompt: (data) => formatInsightPrompt(data),
    appendQuestion: true,
    // Fat/fiber/carbohydrate come from aggregateMicronutrientIntake.
    needsNutrition: true,
    systemPrompt: INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_WELLNESS_LAST_RESULT', 'WELLNESS_INSIGHT_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_WELLNESS_LAST_GENERATED_AT', 'WELLNESS_INSIGHT_LAST_GENERATED_AT'],
  },
  food: {
    label: 'Food',
    questionPlaceholder: 'e.g. Which vitamins or minerals might be missing?',
    previewId: 'insight-preview-food',
    gather: (from, to) => aggregateFoodIntake(from, to),
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
    questionPlaceholder: 'e.g. Is this amount enough? What is missing?',
    previewId: 'insight-preview-micronutrient',
    gather: (from, to) => aggregateMicronutrientIntake(from, to),
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
    questionPlaceholder: 'e.g. Which muscle group should I prioritize next?',
    gather: (from, to) => gatherActivityInsightMetrics(from, to),
    formatPrompt: (data) => formatActivityInsightPrompt(data),
    appendQuestion: true,
    needsNutrition: false,
    systemPrompt: ACTIVITY_INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_ACTIVITY_LAST_RESULT', 'ACTIVITY_INSIGHT_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_ACTIVITY_LAST_GENERATED_AT', 'ACTIVITY_INSIGHT_LAST_GENERATED_AT'],
  },
  protein: {
    label: 'Protein',
    questionPlaceholder: 'e.g. Which source should I prioritize next?',
    // The Protein Source Rotation chart's own rows, so the two can't disagree.
    gather: (from, to) => computeProteinRotationRows(from, to),
    formatPrompt: (rows) => formatProteinRotationInsightPrompt(rows),
    appendQuestion: true,
    needsNutrition: true,
    systemPrompt: PROTEIN_ROTATION_INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_PROTEIN_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_PROTEIN_LAST_GENERATED_AT'],
  },
  plan: {
    label: 'Plan',
    questionPlaceholder: 'e.g. Is the deficit too aggressive for this timeline?',
    // The plan comes from Settings; the range only picks the actuals it's judged against.
    gather: (from, to) => gatherPlanInsight(from, to),
    formatPrompt: (data) => formatPlanInsightPrompt(data),
    appendQuestion: true,
    needsNutrition: false,
    systemPrompt: PLAN_INSIGHT_SYSTEM_PROMPT,
    resultKeys: ['INSIGHT_PLAN_LAST_RESULT'],
    generatedAtKeys: ['INSIGHT_PLAN_LAST_GENERATED_AT'],
  },
  pattern: {
    label: 'Pattern',
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

// Element ids for the flow both Insight pages share (Finance has its own).
const HEALTH_INSIGHT_PAGE = {
  panelId: 'insight-panel',
  statusId: 'insight-mode-status',
  errorId: 'insight-status',
  bodyId: 'insight-body',
  generatedAtId: 'insight-generated-at',
  generateBtnId: 'insight-generate-btn',
};

const INSIGHT_PREVIEW_IDS = [INSIGHT_TEXT_PREVIEW_ID, 'insight-preview-food', 'insight-preview-micronutrient', 'insight-preview-pattern'];
const INSIGHT_DATA_PLACEHOLDER = '[data shown above]';

// The mode on screen, its range and gathered data; Send to AI reuses this data.
// null means nothing is loaded.
let insightLoaded = null;

let getInsightDateRange = () => ({ from: null, to: null });
let insightRangeSlug = '1w';

const insightPreviewId = (mode) => mode.previewId || INSIGHT_TEXT_PREVIEW_ID;
const insightSystemPrompt = (mode, data) => (typeof mode.systemPrompt === 'function' ? mode.systemPrompt(data) : mode.systemPrompt);
const insightModeButtons = () => [...document.querySelectorAll('#insight-mode-actions [data-insight-mode]')];

function initInsightPanel() {
  clearFieldError('insight-status');
  document.getElementById('insight-mode-status').textContent = '';

  // A pick only recomputes once a mode has been loaded.
  getInsightDateRange = () => healthRangeDates(insightRangeSlug);
  const pick = (slug) => {
    insightRangeSlug = slug;
    renderRangeButtons('insight-range', HEALTH_RANGES, insightRangeSlug, pick);
    if (insightLoaded) loadInsightMode(insightLoaded.mode);
  };
  renderRangeButtons('insight-range', HEALTH_RANGES, insightRangeSlug, pick);

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
  insightLoaded = null;
  setInsightModeButtons(null);
  resetInsightPage(HEALTH_INSIGHT_PAGE);
}

// Opens `modeKey`'s page, even while its data is still loading.
function openInsightPage(page, modeKey) {
  document.getElementById(page.panelId).dataset.insightMode = modeKey;
  document.getElementById(page.statusId).textContent = '';
  clearFieldError(page.errorId);
}

// Back to the tiles.
function resetInsightPage(page) {
  delete document.getElementById(page.panelId).dataset.insightMode;
  document.getElementById(page.statusId).textContent = '';
  clearFieldError(page.errorId);
}

// Pattern's L_p box, seeded from Tune's L_p; blank or invalid falls back to Tune's.
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

// The only path that computes anything: gathers the mode's data, shows its
// preview and last saved report, and arms Send to AI.
function loadInsightMode(modeKey) {
  const mode = INSIGHT_MODES[modeKey];
  if (!mode) return;
  openInsightPage(HEALTH_INSIGHT_PAGE, modeKey);
  const { from, to } = getInsightDateRange();

  if (!from || !to) {
    showFieldError('insight-status', 'Pick a From and To date first.');
    return;
  }

  // An unloaded table isn't "nothing logged"; don't preview zeros.
  if (!physiqueDataLoaded || (mode.needsNutrition && !nutritionDataLoaded)) {
    showToast('Still loading your Physique data — try again in a moment.');
    return;
  }

  const textarea = document.getElementById('insight-question');
  const ctx = { from, to, question: textarea.value };
  const data = mode.gather(from, to);
  insightLoaded = { mode: modeKey, from, to, data };

  document.getElementById('insight-hint').textContent = '';
  textarea.placeholder = mode.questionPlaceholder;
  showInsightPreview(insightPreviewId(mode));
  if (mode.renderPreview) mode.renderPreview(data, ctx);
  else renderInsightPreviewLines(mode.formatPrompt(data, ctx));
  renderInsightPromptTemplate(mode, data, ctx);
  renderSavedInsight(mode);
  setInsightModeButtons(modeKey);
  showToast(`${mode.label} data for ${from} to ${to}.`);
  document.getElementById('insight-generate-btn').disabled = false;
}

// Only the active mode's preview container is visible.
function showInsightPreview(previewId) {
  INSIGHT_PREVIEW_IDS.forEach((id) => {
    document.getElementById(id).hidden = id !== previewId;
  });
}

function setInsightModeButtons(modeKey) {
  insightModeButtons().forEach((btn) => {
    const active = btn.dataset.insightMode === modeKey;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// One <p> per line; every preview uses it, so the profile block looks the same everywhere.
function renderInsightLines(el, lines) {
  el.innerHTML = '';
  lines.forEach((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    el.appendChild(p);
  });
}

// Shows exactly what would be sent to the AI.
function renderInsightPreviewLines(text) {
  renderInsightLines(document.getElementById(INSIGHT_TEXT_PREVIEW_ID), text.split('\n'));
}

function appendInsightQuestion(prompt, question) {
  return question && question.trim() ? `${prompt}\n\nAdditional question: ${question.trim()}` : prompt;
}

function insightUserMessage(mode, data, ctx) {
  const prompt = mode.formatPrompt(data, ctx);
  return mode.appendQuestion ? appendInsightQuestion(prompt, ctx.question) : prompt;
}

// The system prompt plus the user message, with each run of lines the preview
// already shows (or a table row of it) folded into one placeholder.
function renderInsightPromptTemplate(mode, data, ctx) {
  const preview = document.getElementById(insightPreviewId(mode));
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
      && lines.findLast((l) => l.trim()) === INSIGHT_DATA_PLACEHOLDER) lines.pop();
    if (lines.at(-1) !== INSIGHT_DATA_PLACEHOLDER) lines.push(INSIGHT_DATA_PLACEHOLDER);
  });
  if (mode.appendQuestion) lines.push('', 'Additional question: [your question, if any]');

  document.getElementById('insight-prompt-template').textContent =
    `SYSTEM\n${insightSystemPrompt(mode, data)}\n\nUSER\n${lines.join('\n')}`;
  document.getElementById('insight-prompt-details').hidden = false;
}

function appendInsightHint(container, text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  container.appendChild(p);
}

// Send to AI: runs on the data already loaded, so what was shown is what's sent.
async function runInsightGeneration() {
  if (!insightLoaded) return;

  const mode = INSIGHT_MODES[insightLoaded.mode];
  const { from, to } = insightLoaded;
  const textarea = document.getElementById('insight-question');
  // Saved per mode, so a fresh load shows the last read.
  return generateInsight(HEALTH_INSIGHT_PAGE, {
    controls: [...document.querySelectorAll('#insight-range button'), textarea, ...insightModeButtons()],
    analyzing: `Analyzing ${from} to ${to}…`,
    prompts: () => {
      const ctx = { from, to, question: textarea.value };
      return [insightSystemPrompt(mode, insightLoaded.data), insightUserMessage(mode, insightLoaded.data, ctx)];
    },
    resultKey: mode.resultKeys[0],
    generatedAtKey: mode.generatedAtKeys[0],
  });
}

// Both pages' Send to AI. `prompts` runs inside the try, so a formatting error
// shows like an AI one.
async function generateInsight(page, { controls, analyzing, prompts, resultKey, generatedAtKey }) {
  const body = document.getElementById(page.bodyId);
  const btn = document.getElementById(page.generateBtnId);
  const setControlsDisabled = (disabled) => [btn, ...controls].forEach((c) => { c.disabled = disabled; });

  body.innerHTML = '';
  clearFieldError(page.errorId);
  appendInsightHint(body, analyzing);

  setControlsDisabled(true);
  Motion.iconBusy(btn);

  try {
    const text = await aiChatText(...prompts());
    body.innerHTML = '';
    renderInsightText(body, text);

    const generatedAt = localTimestamp(new Date());
    try {
      await saveSettingValues({
        [resultKey]: text,
        [generatedAtKey]: generatedAt,
      });
      renderInsightGeneratedAt(page, generatedAt);
      renderInsightAgeBadges();
    } catch (saveErr) {
      showFieldError(page.errorId, `Generated, but couldn't save it: ${saveErr.message}`);
    }
  } catch (err) {
    body.innerHTML = '';
    showFieldError(page.errorId, err.message);
  } finally {
    setControlsDisabled(false);
    Motion.iconSettle(btn);
  }
}

// A red "<days>d" badge on each mode tile last generated over 30 days ago.
const INSIGHT_STALE_DAYS = 30;
const INSIGHT_MS_PER_DAY = 86400000;

// `stamp` is the tile's saved "YYYY-MM-DD HH:mm"; shared with Finance's Snapshot.
function placeInsightAgeBadge(btn, stamp) {
  btn.querySelector(':scope > .page-badge')?.remove();
  if (!stamp) return;
  const today = dateFromIso(isoFromDate(new Date()));
  const days = Math.round((today - dateFromIso(stamp.slice(0, 10))) / INSIGHT_MS_PER_DAY);
  if (!(days > INSIGHT_STALE_DAYS)) return;
  const badge = document.createElement('span');
  badge.className = 'page-badge';
  badge.textContent = `${days}d`;
  badge.title = `Last generated ${days} days ago (${stamp})`;
  btn.appendChild(badge);
}

function renderInsightAgeBadges() {
  insightModeButtons().forEach((btn) => {
    placeInsightAgeBadge(btn, getSettingStringAny(INSIGHT_MODES[btn.dataset.insightMode].generatedAtKeys, null));
  });
  placeInsightAgeBadge(document.getElementById('financial-insight-load-btn'), getSettingString('FINANCIAL_INSIGHT_LAST_GENERATED_AT', null));
}

function renderInsightGeneratedAt(page, timestamp) {
  const el = document.getElementById(page.generatedAtId);
  if (!timestamp) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `Last generated ${timestamp}`;
}

// The mode's last AI result from the in-memory Settings; no sheet read.
function renderSavedInsight(mode) {
  renderSavedInsightBody(HEALTH_INSIGHT_PAGE, getSettingStringAny(mode.resultKeys, null), getSettingStringAny(mode.generatedAtKeys, null));
}

// A page's last saved result, so a fresh load isn't blank.
function renderSavedInsightBody(page, text, generatedAt) {
  const body = document.getElementById(page.bodyId);
  body.innerHTML = '';
  if (!text) {
    appendInsightHint(body, 'Review the data above, then click "Send to AI" to get a read on it.');
    renderInsightGeneratedAt(page, null);
    return;
  }

  renderInsightText(body, text);
  renderInsightGeneratedAt(page, generatedAt);
}
