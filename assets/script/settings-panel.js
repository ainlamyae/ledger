const SETTINGS_PANEL_RANGE = `${CONFIG.SHEETS.SETTINGS}!A2:C`;

let allSettingRows = [];
let settingsSheetId = null;
let settingsSheetMissing = false;
let editingSettingRow = null;
let settingPanelListenersAttached = false;

async function initSettingsPanel(forceRefresh = false) {
  let meta = forceRefresh ? null : getCached('settings-panel-meta');

  if (!meta) {
    const spreadsheet = await getSpreadsheetMetadata();
    const sheet = spreadsheet.sheets.find((s) => s.properties.title === CONFIG.SHEETS.SETTINGS);
    meta = { settingsSheetId: sheet ? sheet.properties.sheetId : null };
    setCached('settings-panel-meta', meta);
  }

  settingsSheetId = meta.settingsSheetId;
  settingsSheetMissing = settingsSheetId === null;

  document.getElementById('add-setting-btn').disabled = settingsSheetMissing;

  if (settingsSheetMissing) {
    const tbody = document.getElementById('settings-body');
    tbody.innerHTML = '';
    tbody.appendChild(renderEmptyRow(3, `No "${CONFIG.SHEETS.SETTINGS}" tab found — add one with columns Key | Value | Notes to use this panel.`));
  } else {
    await refreshSettingsList(forceRefresh);
  }

  if (!settingPanelListenersAttached) {
    settingPanelListenersAttached = true;
    document.getElementById('add-setting-btn').addEventListener('click', () => openSettingForm());
    document.getElementById('setting-cancel-btn').addEventListener('click', closeSettingForm);
    onFormSubmit('setting-form', submitSettingForm);
  }
}

async function refreshSettingsList(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('setting-list');

  if (!values) {
    const resp = await getValues(SETTINGS_PANEL_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('setting-list', values);
  }

  allSettingRows = values.map((row, i) => ({
    row: i + 2,
    key: row[0] || '',
    value: row[1] || '',
    notes: row[2] || '',
  }));

  renderSettingsList();
}

// A Value cell holds anything from `82` to a whole saved AI report, and a
// multi-hundred-character cell stretched the row far past every other one.
// Truncated for display only — the full text is in the title attribute and in
// the edit form, and nothing here is ever written back from the table.
const SETTING_VALUE_DISPLAY_MAX = 32;

function truncateSettingValue(value) {
  return value.length > SETTING_VALUE_DISPLAY_MAX
    ? `${value.slice(0, SETTING_VALUE_DISPLAY_MAX)}…`
    : value;
}

function renderSettingsList() {
  const tbody = document.getElementById('settings-body');
  tbody.innerHTML = '';

  if (allSettingRows.length === 0) {
    tbody.appendChild(renderEmptyRow(3, 'No settings yet — add your first one above.'));
  }

  allSettingRows.forEach((setting) => {
    const tr = document.createElement('tr');

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => openSettingForm(setting) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteSetting(setting.row) }),
    );

    // Full-masked (not just digits) since values include API keys and city
    // names — letters carry just as much sensitive content as digits do
    // here, unlike a plain number. The Key column (e.g. WEIGHT_GOAL_KG)
    // isn't sensitive on its own and stays visible.
    // No hover-reveal of a masked value — that would defeat the privacy toggle.
    const shown = truncateSettingValue(privacyMode ? maskText(setting.value) : setting.value);
    const fullTitle = (!privacyMode && shown !== setting.value) ? setting.value : undefined;

    tr.append(makeCell(setting.key), makeCell(shown, fullTitle), actionsCell);
    tbody.appendChild(tr);
  });
}

function openSettingForm(setting) {
  editingSettingRow = setting ? setting.row : null;

  document.getElementById('setting-modal-title').textContent = setting ? 'Edit Setting' : 'Add Setting';
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
    document.getElementById('setting-value').value,
    document.getElementById('setting-notes').value,
  ]];

  try {
    // RAW here for the same reason saveSettingValues uses it (see there): this
    // tab is a key/value store, and nothing in it benefits from Sheets
    // reinterpreting the typed text. A BIRTH_DATE of "1990-05-12" is meant to
    // be read back as exactly that string, and a HEIGHT_CM of 178 must never
    // end up in a date-formatted cell — where it would read back as a date and
    // register as "not set" everywhere.
    if (editingSettingRow) {
      await updateValues(`${CONFIG.SHEETS.SETTINGS}!A${editingSettingRow}:C${editingSettingRow}`, values, 'RAW');
    } else {
      await appendValues(SETTINGS_PANEL_RANGE, values, 'RAW');
    }
    closeSettingForm();
    await refreshSettingsList(true);
    // Repairs this row's format if a previous USER_ENTERED write date-stamped
    // it, so editing a broken setting is enough to fix it.
    const saved = allSettingRows.find((r) => r.key === key);
    if (saved) await clearSettingValueFormats([saved.row]);

    await refreshSettingsList(true);
    currentSettings = await loadSettings(true);
    applySettingsToWidgets();
  } catch (err) {
    showFieldError('setting-form-error', err.message);
  }
}

// A cell's number format is a separate property from its value, so writing the
// right number into a cell that some earlier write turned into a date-formatted
// one leaves it still reading back as a date string. Clearing the format on
// every row written repairs those in place — an already-broken setting is fixed
// by re-saving it, rather than needing its row deleted by hand.
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
      // Field named in `fields` but omitted from `cell` — the API's documented
      // way to DELETE a field, resetting the cell to Automatic formatting.
      cell: { userEnteredFormat: {} },
      fields: 'userEnteredFormat.numberFormat',
    },
  })));
}

// Writes key/value pairs to the Settings tab — updating rows that already
// exist in place, appending new ones for keys seen for the first time — then
// refreshes both the settings-panel list and currentSettings so callers see
// their own write immediately. Shared by every feature that persists an
// AI/computed result there (insight.js, food-insight.js).
//
// RAW, not USER_ENTERED: every value routed through here is already a finished
// computed value that has to survive the round trip byte-for-byte, and
// USER_ENTERED reinterprets it the way typing into the cell would. That caused
// a genuinely destructive bug — a written "2026-07-30" was parsed into a real
// date, which turned its cell into a DATE-formatted one, and rows appended
// beside it inherited that format. A value like 0.00031534 is a perfectly valid
// date serial, so it then displayed as "1899-12-30 0:00" and (via VALUE_PARAMS'
// FORMATTED_STRING dateTimeRenderOption) read back as that STRING rather than a
// number. getSetting() saw NaN and reported the setting as absent, so a
// correctly-written value silently vanished — as did any other numeric setting
// whose cell caught the same format.
async function saveSettingValues(values) {
  await initSettingsPanel(true);
  if (settingsSheetMissing) {
    throw new Error(`No "${CONFIG.SHEETS.SETTINGS}" tab found — add one with columns Key | Value | Notes to save this.`);
  }

  const existingByKey = new Map(allSettingRows.map((r) => [r.key, r]));
  const updates = [];
  const newRows = [];

  Object.entries(values).forEach(([key, value]) => {
    const existing = existingByKey.get(key);
    if (existing) {
      updates.push(updateValues(`${CONFIG.SHEETS.SETTINGS}!A${existing.row}:C${existing.row}`, [[key, value, existing.notes ?? '']], 'RAW'));
    } else {
      newRows.push([key, value, '']);
    }
  });

  await Promise.all(updates);
  if (newRows.length > 0) await appendValues(SETTINGS_PANEL_RANGE, newRows, 'RAW');

  // Formats are cleared BEFORE the read-back below, so currentSettings gets the
  // repaired numeric values rather than the date strings the old format would
  // still have produced this one last time.
  await refreshSettingsList(true);
  const writtenKeys = new Set(Object.keys(values));
  await clearSettingValueFormats(allSettingRows.filter((r) => writtenKeys.has(r.key)).map((r) => r.row));

  await refreshSettingsList(true);
  currentSettings = await loadSettings(true);
}

async function deleteSetting(row) {
  await confirmAndDelete('Delete this setting?', async () => {
    await batchUpdate([{
      deleteDimension: {
        range: { sheetId: settingsSheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
      },
    }]);
    await refreshSettingsList(true);
    currentSettings = await loadSettings(true);
    applySettingsToWidgets();
  });
}
