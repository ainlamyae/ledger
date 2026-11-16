const SETTINGS_PANEL_RANGE = sheetRange(CONFIG.SHEETS.SETTINGS, 'A2:C');
// Notes | Key | Value | actions.
const SETTING_COLUMN_COUNT = 4;

let allSettingRows = [];
let settingsSheetId = null;
let settingsSheetMissing = false;
let editingSettingRow = null;
let settingPanelListenersAttached = false;

function settingRange(cells) {
  return sheetRange(CONFIG.SHEETS.SETTINGS, cells);
}

function missingSettingsTabMessage(purpose) {
  return `No "${CONFIG.SHEETS.SETTINGS}" tab found — add one with columns Key | Value | Notes to ${purpose}.`;
}

async function initSettingsPanel(forceRefresh = false) {
  const spreadsheet = await getSpreadsheetMetadata();
  const sheet = spreadsheet.sheets.find((s) => s.properties.title === CONFIG.SHEETS.SETTINGS);
  settingsSheetId = sheet ? sheet.properties.sheetId : null;
  settingsSheetMissing = settingsSheetId === null;
  // Before the first render, so a /settings/<tab>/ load draws that tab at once.
  initSettingTabs();

  document.getElementById('add-setting-btn').disabled = settingsSheetMissing;

  if (settingsSheetMissing) {
    const tbody = document.getElementById('settings-body');
    tbody.innerHTML = '';
    tbody.appendChild(renderEmptyRow(SETTING_COLUMN_COUNT, missingSettingsTabMessage('use this panel')));
  } else {
    await refreshSettingsList(forceRefresh);
    await removeRetiredSettings();
    await fillBlankSettingNotes();
  }

  if (!settingPanelListenersAttached) {
    settingPanelListenersAttached = true;
    document.getElementById('add-setting-btn').addEventListener('click', () => openSettingForm());
    document.getElementById('setting-cancel-btn').addEventListener('click', closeSettingForm);
    onFormSubmit('setting-form', submitSettingForm);
    // <section>/settings/<key in lowercase>/ opens that setting's Edit.
    registerRecordRoute('settings', (slug, sub) => {
      const setting = allSettingRows.find((s) => settingRouteSlug(s) === slug);
      if (!setting || sub) return null;
      openSettingForm(setting);
      return setting.key;
    });
  }
}

// Slugs match the #settings-tabs buttons. Health takes every key no other tab
// claims, so a new key always lands somewhere.
const SETTING_TABS = [
  { slug: 'ai', pattern: /^AI_|(API_KEY|_TOKEN|_SECRET|_MODELS)$/i },
  { slug: 'responses', pattern: /_LAST_(RESULT|GENERATED_AT)$/i },
  { slug: 'health' },
  { slug: 'display', pattern: /^(SHOW_|WIDGET_)/i },
  { slug: 'all' },
];

let activeSettingTab = SETTING_TABS[0].slug;
let settingTabsAttached = false;

function settingTabIncludes(slug, key) {
  if (slug === 'all') return true;
  const tab = SETTING_TABS.find((t) => t.slug === slug);
  if (tab.pattern) return tab.pattern.test(key);
  return !SETTING_TABS.some((t) => t.pattern && t.pattern.test(key));
}

// Current tab is .btn-primary, as in the Market range row.
function renderSettingTabs() {
  document.querySelectorAll('#settings-tabs [data-route]').forEach((btn) => {
    const active = btn.dataset.route === activeSettingTab;
    btn.classList.toggle('btn-primary', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function showSettingTab(slug) {
  activeSettingTab = slug;
  renderSettingsList();
}

// Each tab is at /other/settings/<tab>/; the bare address is the first tab.
function initSettingTabs() {
  if (settingTabsAttached) return;
  settingTabsAttached = true;
  const panel = document.getElementById('settings-tabs').closest('.panel');
  const view = currentRouteView(panel);
  if (view) activeSettingTab = view.dataset.route;
  document.querySelectorAll('#settings-tabs [data-route]').forEach((btn) => {
    btn.addEventListener('click', () => showSettingTab(btn.dataset.route));
  });
  registerViewReset(panel, () => showSettingTab(SETTING_TABS[0].slug));
}

// The key in lowercase, underscores kept (BODY_MASS_HEALTHY_KG -> body_mass_healthy_kg).
function settingRouteSlug(setting) {
  return setting.key.trim().toLowerCase();
}

async function refreshSettingsList(forceRefresh = false) {
  const resp = await getValues(SETTINGS_PANEL_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

  allSettingRows = values.map((row, i) => ({
    row: i + 2,
    // cellText: a stored 0 (SHOW_AMOUNTS) must read "0", not blank.
    key: cellText(row[0]),
    value: cellText(row[1]),
    notes: cellText(row[2]),
  }));

  renderSettingsList();
}

// A Value cell can hold a whole saved AI report; the table shows a stub, the full
// text is in the title and the edit form.
const SETTING_VALUE_DISPLAY_MAX = 32;

function truncateSettingValue(value) {
  return value.length > SETTING_VALUE_DISPLAY_MAX
    ? `${value.slice(0, SETTING_VALUE_DISPLAY_MAX)}…`
    : value;
}

// Credential keys, masked even with privacy mode off (that toggle hides amounts,
// it isn't meant to guard credentials).
const SECRET_SETTING_KEY_PATTERN = /(API_KEY|_TOKEN|_SECRET)$/i;

function isSecretSettingKey(key) {
  return SECRET_SETTING_KEY_PATTERN.test(key);
}

// Secret keys revealed this session; in memory only.
const revealedSettingKeys = new Set();

// Not makeRowActionButton: reveal never writes the sheet, so it skips the sign-in gate.
function makeSecretRevealButton(key, revealed) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = revealed ? '🙈' : '👁️';
  btn.title = revealed ? 'Hide value' : 'Reveal value';
  btn.setAttribute('aria-label', btn.title);
  btn.addEventListener('click', () => {
    if (revealed) revealedSettingKeys.delete(key); else revealedSettingKeys.add(key);
    renderSettingsList();
  });
  return btn;
}

function renderSettingsList() {
  renderSettingTabs();
  const tbody = document.getElementById('settings-body');
  tbody.innerHTML = '';

  // Alphabetical by key, not the sheet's row order, so a key is found where you'd look.
  const rows = allSettingRows
    .filter((setting) => settingTabIncludes(activeSettingTab, setting.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (rows.length === 0) {
    tbody.appendChild(renderEmptyRow(SETTING_COLUMN_COUNT, allSettingRows.length ? 'No settings in this tab.' : 'No settings yet — add your first one above.'));
  }

  rows.forEach((setting) => {
    const tr = document.createElement('tr');

    const isSecret = isSecretSettingKey(setting.key);
    const revealed = revealedSettingKeys.has(setting.key);

    const actionsCell = document.createElement('td');
    if (isSecret) actionsCell.appendChild(makeSecretRevealButton(setting.key, revealed));
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => {
        routeRecordEdit('settings', { slug: settingRouteSlug(setting), label: setting.key });
        openSettingForm(setting);
      } }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteSetting(setting.row) }),
    );

    // Values are fully masked (they include keys and city names); the Key column
    // stays visible. No hover-reveal of a masked value.
    const shouldMask = privacyMode || (isSecret && !revealed);
    const shown = truncateSettingValue(shouldMask ? maskText(setting.value) : setting.value);
    const fullTitle = (!shouldMask && shown !== setting.value) ? setting.value : undefined;

    const note = truncateSettingValue(setting.notes);
    tr.append(makeCell(note, note !== setting.notes ? setting.notes : undefined), makeCell(setting.key), makeCell(shown, fullTitle), actionsCell);
    tbody.appendChild(tr);
  });
}

function openSettingForm(setting) {
  editingSettingRow = setting ? setting.row : null;

  document.getElementById('setting-key').value = setting ? setting.key : '';
  document.getElementById('setting-value').value = setting ? setting.value : '';
  document.getElementById('setting-notes').value = setting ? setting.notes : '';

  clearFieldError('setting-form-error');
  document.getElementById('setting-modal').hidden = false;
}

function closeSettingForm() {
  document.getElementById('setting-modal').hidden = true;
  editingSettingRow = null;
}

async function submitSettingForm(event) {
  event.preventDefault();

  const key = document.getElementById('setting-key').value.trim();
  if (!key) {
    showFieldError('setting-form-error', 'Key is required.');
    return;
  }

  const values = [[
    key,
    // Trimmed: a stray trailing Enter in the multi-line box would be saved ("male\n").
    document.getElementById('setting-value').value.trim(),
    // A blank note takes the key's default one.
    document.getElementById('setting-notes').value.trim() || settingDefaultNote(key),
  ]];

  try {
    // RAW, as in saveSettingValues.
    if (editingSettingRow) {
      await updateValues(settingRange(`A${editingSettingRow}:C${editingSettingRow}`), values, 'RAW');
    } else {
      await appendValues(SETTINGS_PANEL_RANGE, values, 'RAW');
    }
    // Re-saving a setting is enough to repair a date-stamped cell.
    await reloadSettingsAfterWrite(() => {
      const saved = allSettingRows.find((r) => r.key === key);
      return saved ? [saved.row] : [];
    });
    applySettingsToWidgets();
    await recomputeStoredPhysiqueBmr([key]);
    const savedSetting = allSettingRows.find((r) => r.key === key);
    if (savedSetting) {
      openSettingForm(savedSetting);
      stayOnSavedForm('setting-modal', { slug: settingRouteSlug(savedSetting), label: savedSetting.key });
    }
    showFormSaved('setting-form-error');
  } catch (err) {
    showFieldError('setting-form-error', err.message);
  }
}

// A cell's number format outlives its value, so a once date-formatted Value cell
// keeps reading back as a date. Resetting the format repairs it in place.
async function clearSettingValueFormats(rowNumbers) {
  if (rowNumbers.length === 0 || settingsSheetId === null) return;

  await batchUpdate(rowNumbers.map((row) => ({
    repeatCell: {
      range: {
        sheetId: settingsSheetId,
        startRowIndex: row - 1,
        endRowIndex: row,
        startColumnIndex: 1, // column B, the Value cell
        endColumnIndex: 2,
      },
      // Named in `fields` but absent from `cell`: the API's way to delete it.
      cell: { userEnteredFormat: {} },
      fields: 'userEnteredFormat.numberFormat',
    },
  })));
}

// After a write: re-reads the tab, repairs the given rows' formats, then re-reads
// again so the list and currentSettings get the repaired values.
async function reloadSettingsAfterWrite(rowsToRepair) {
  await refreshSettingsList(true);
  await clearSettingValueFormats(rowsToRepair());
  await refreshSettingsList(true);
  currentSettings = await loadSettings(true);
}

// The note a save writes into a blank Notes cell (a typed note is kept).
const SETTING_DEFAULT_NOTES = {
  ACTIVITY_DESIRED_FIXED_KCAL: 'Pins the desired daily activity burn (kcal); blank = worked out from ACTIVITY_DESIRED_MIN of walking at your body mass',
  ACTIVITY_DESIRED_MIN: 'Desired daily activity (minutes) line on the Physical Activity chart',
  AI_PROVIDER: 'groq or openrouter',
  ALPHA_VANTAGE_API_KEY: 'Alpha Vantage API key for Market prices and news',
  BIRTH_DATE: 'Your birth date (YYYY-MM-DD); gives your age for the BMR formula and the Insight profile',
  BMR_ADAPT_PCT_CAP: 'Most metabolic adaptation allowed (%): BMR_adp never falls more than this below BMR',
  BMR_ADAPT_PCT_PER_WEEK: 'Metabolic adaptation per week of dieting (%), used by BMR_adp until it reaches BMR_ADAPT_PCT_CAP',
  BMR_BASIS: 'Which BMR the plan runs on: bmr = the BMR_FORMULA equation, bmr_cal = calibrated from your logs, bmr_adp = adapted, bmr_avg = the average of the four',
  BMR_CALIBRATION_PERIOD_COUNT: 'How many periods BMR_cal is calibrated over (Tune n_p); saved by Tune Update',
  BMR_CALIBRATION_PERIOD_DAYS: 'Days per BMR_cal period and the rolling-average body-mass window (Tune L_p); saved by Tune Update',
  BMR_FORMULA: 'BMR equation: mifflin (Mifflin-St Jeor) or katch (Katch-McArdle, from lean body mass)',
  BODY_MASS_HEALTHY_KG: 'Your healthy body mass, kg',
  CALORIE_DESIRED_FIXED_KCAL: 'Pins the desired daily calorie intake (kcal) everywhere; blank = recalculated from body mass and WEEKLY_FAT_LOSS_KG',
  CARB_DESIRED_G_MAX: 'High end of the desired daily carbohydrate band, g; saved by Tune',
  CARB_DESIRED_G_MIN: 'Low end of the desired daily carbohydrate band, g; saved by Tune',
  CARB_PCT_OF_KCAL_MAX: 'High end of the carbohydrate rule, % of daily calories; saved by Tune',
  CARB_PCT_OF_KCAL_MIN: 'Low end of the carbohydrate rule, % of daily calories; saved by Tune',
  FAT_DESIRED_G_MAX: 'High end of the desired daily fat band, g; saved by Tune',
  FAT_DESIRED_G_MIN: 'Low end of the desired daily fat band, g; saved by Tune',
  FAT_PCT_OF_KCAL_MAX: 'High end of the fat rule, % of daily calories; saved by Tune',
  FAT_PCT_OF_KCAL_MIN: 'Low end of the fat rule, % of daily calories; saved by Tune',
  FIBER_DESIRED_G_MAX: 'High end of the desired daily fiber band, g; saved by Tune',
  FIBER_DESIRED_G_MIN: 'Low end of the desired daily fiber band, g; saved by Tune',
  FIBER_G_PER_1000_KCAL_MIN: 'Low end of the fiber rule, g per 1,000 kcal eaten; saved by Tune',
  FIBER_G_PER_KG_MAX: 'High end of the fiber rule, g per kg body mass; saved by Tune',
  FINNHUB_API_KEY: 'Finnhub API key for Market quotes and news',
  GLYCOGEN_SWING_KG: 'Expected glycogen/water swing in body mass, kg (the ± beside body mass); saved by Tune',
  GROQ_API_KEY: 'Groq API key for AI (Calculate, Scan, Insight) when AI_PROVIDER is groq',
  GROQ_MODELS: 'text and vision model ids for Groq',
  HEIGHT_CM: 'Your height, cm; for BMI, lean body mass and BMR',
  HIP_CM: 'Hip circumference (cm) at the widest point — U.S. Navy body fat, women only',
  KCAL_PER_MET_KG_MIN: 'Oxygen per MET (ml O2/kg/min), default 3; activity kcal = MET x kg x min x this / 200',
  LBM_FORMULA: 'Lean body mass the app runs on: boer (Boer 1984) or navy (U.S. Navy body fat)',
  MICRONUTRIENT_DAILY_DESIRED_JSON: 'Desired daily amount per nutrient (JSON) for Micronutrient Insight; Tune updates protein, fiber and fat',
  NECK_CM: 'Neck circumference (cm), just below the larynx — U.S. Navy body fat (Hodgdon & Beckett)',
  OPENROUTER_API_KEY: 'OpenRouter API key for AI (Calculate, Scan, Insight) when AI_PROVIDER is openrouter',
  OPENROUTER_MODELS: 'text and vision model ids for OpenRouter',
  PLAN_SLEEP_HOURS: 'Sleep the plan assumes you get, hours; less than SLEEP_DESIRED_HOURS raises the deficit needed',
  PROTEIN_DESIRED_G_MAX: 'High end of the desired daily protein band, g; saved by Tune, read by the tile, chart, Insight and Protein Source Rotation',
  PROTEIN_DESIRED_G_MIN: 'Low end of the desired daily protein band, g; saved by Tune, read by the tile, chart, Insight and Protein Source Rotation',
  PROTEIN_G_PER_KG_LBM_MAX: 'High end of the protein rule, g per kg lean body mass; saved by Tune with PROTEIN_DESIRED_G_MAX',
  PROTEIN_G_PER_KG_LBM_MIN: 'Low end of the protein rule, g per kg lean body mass; saved by Tune with PROTEIN_DESIRED_G_MIN',
  SEX: 'Needed for the BMR formula\'s constant term',
  SHOW_AMOUNTS: '1 shows amounts; 0 turns on privacy mode, masking amounts and health figures',
  SHOW_BULBS: '1 or blank shows the home page bulbs, 0 hides them (account menu: Hide bulbs)',
  SHOW_WIDGETS: '1 shows the home page widgets, 0 hides them (account menu: Hide widgets)',
  SLEEP_DEPRIVATION_PCT_PER_HOUR: 'Fat-loss efficiency lost per hour of sleep short of SLEEP_DESIRED_HOURS (%)',
  SLEEP_DESIRED_HOURS: 'Desired daily sleep line on the Sleep chart, and the sleep factor in the State Trend & Forecast projection',
  TEF_CARB_PERCENT: 'Share of carbohydrate calories spent digesting (%), for each day\'s TEF',
  TEF_FAT_PERCENT: 'Share of fat calories spent digesting (%), for each day\'s TEF',
  TEF_PERCENT_OF_INTAKE: 'Share of eaten calories spent digesting (%) in the calorie balance; 0 leaves TEF out',
  TEF_PROTEIN_PERCENT: 'Share of protein calories spent digesting (%), for each day\'s TEF',
  TWELVE_DATA_API_KEY: 'Twelve Data API key for Market and Portfolio prices',
  USDA_FDC_API_KEY: 'USDA FoodData Central API key, for looking up ingredient nutrition and micronutrients',
  WAIST_CM: 'Waist circumference (cm): at the navel for men, narrowest point for women — U.S. Navy body fat',
  WEEKLY_FAT_LOSS_KG: 'Your desired rate of loss (kg/week). Use a negative number instead for a lean bulk',
  WEEKLY_FAT_LOSS_PCT: 'Pins the weekly loss as % of body mass, replacing WEEKLY_FAT_LOSS_KG; blank = use the kg rate',
  WIDGET_DEFAULT_CITY: 'City for the home page weather and main clock',
  WIDGET_SECOND_CLOCK_CITY: 'City for the home page second clock',
  WORKOUT_REP_SEC: 'Seconds per rep, to turn logged reps into active minutes',
  WORKOUT_STEPS_PER_MIN: 'Steps per minute, to turn logged steps into active minutes',
};

// An AI mode's saved response and its time get a note from their own key.
function settingDefaultNote(key) {
  if (SETTING_DEFAULT_NOTES[key]) return SETTING_DEFAULT_NOTES[key];
  const mode = key.replace(/_LAST_(RESULT|GENERATED_AT)$/, '').replace(/_/g, ' ').toLowerCase();
  if (/_LAST_RESULT$/.test(key)) return `Last ${mode} response, shown until the next Generate`;
  if (/_LAST_GENERATED_AT$/.test(key)) return `When the ${mode} response was last generated`;
  return '';
}

// Writes key/value pairs to the Setting tab (existing keys in place, new ones
// appended), then refreshes the list and currentSettings so callers see their write.
//
// RAW, not USER_ENTERED: Sheets parsed a written "2026-07-30" into a date, which
// date-formatted the cell and the rows appended beside it, so numbers there read
// back as date strings and getSetting() reported them as absent.
//
// One save at a time: two at once could both append a missing key, or one's
// row delete shift the rows the other updates.
let settingsSaveChain = Promise.resolve();

function saveSettingValues(values) {
  const saving = settingsSaveChain.then(() => writeSettingValues(values));
  settingsSaveChain = saving.catch(() => {});
  return saving;
}

async function writeSettingValues(values) {
  await initSettingsPanel(true);
  if (settingsSheetMissing) {
    throw new Error(missingSettingsTabMessage('save this'));
  }

  const existingByKey = new Map(allSettingRows.map((r) => [r.key, r]));
  const changedKeys = [];
  const updates = [];
  const newRows = [];

  Object.entries(values).forEach(([key, value]) => {
    const existing = existingByKey.get(key);
    if (String(existing?.value ?? '') !== String(value ?? '')) changedKeys.push(key);
    const defaultNote = settingDefaultNote(key);
    if (existing) {
      updates.push(updateValues(settingRange(`A${existing.row}:C${existing.row}`), [[key, value, existing.notes || defaultNote]], 'RAW'));
    } else {
      newRows.push([key, value, defaultNote]);
    }
  });

  await Promise.all(updates);
  if (newRows.length > 0) await appendValues(SETTINGS_PANEL_RANGE, newRows, 'RAW');

  const writtenKeys = new Set(Object.keys(values));
  await reloadSettingsAfterWrite(() => allSettingRows.filter((r) => writtenKeys.has(r.key)).map((r) => r.row));
  // Stored per-day BMR/Deprivation follow a changed profile or BMR setting.
  return recomputeStoredPhysiqueBmr(changedKeys);
}

// Keys the app no longer reads (the walking MET is the Activity sheet's Walk row,
// BMR_cal each Physique day's Derived cell, SHOW_BLOCKS went with Show blocks).
// Any row still holding one is deleted on load.
const RETIRED_SETTING_KEYS = ['ACTIVITY_MET', 'ACTIVITY_MET_DEFAULT', 'BMR_CALIBRATED_KCAL', 'BMR_CALIBRATED_OFFSET_KCAL', 'SHOW_BLOCKS'];

// A row with a blank Notes cell gets its key's default note, once, on load.
async function fillBlankSettingNotes() {
  const blanks = allSettingRows
    .map((setting) => ({ setting, note: settingDefaultNote(setting.key.trim()) }))
    .filter(({ setting, note }) => note && !String(setting.notes || '').trim());
  if (!blanks.length) return;
  await Promise.all(blanks.map(({ setting, note }) => updateValues(settingRange(`C${setting.row}`), [[note]], 'RAW')));
  console.info(`[settings] filled blank notes: ${blanks.map(({ setting }) => setting.key).join(', ')}`);
  await refreshSettingsList(true);
}

async function removeRetiredSettings() {
  const rows = allSettingRows
    .filter((setting) => RETIRED_SETTING_KEYS.includes(setting.key.trim()))
    .map((setting) => setting.row)
    // Bottom-up, so each deletion leaves the rows still to delete where they were.
    .sort((a, b) => b - a);
  if (!rows.length || settingsSheetId === null) return;
  await batchUpdate(rows.map((row) => sheetRowDeleteRequest(settingsSheetId, row)));
  console.info(`[settings] removed retired keys: ${RETIRED_SETTING_KEYS.join(', ')}`);
  await refreshSettingsList(true);
}

async function deleteSetting(row) {
  await confirmAndDelete('Delete this setting?', async () => {
    await batchUpdate([sheetRowDeleteRequest(settingsSheetId, row)]);
    await refreshSettingsList(true);
    currentSettings = await loadSettings(true);
    applySettingsToWidgets();
  });
}
