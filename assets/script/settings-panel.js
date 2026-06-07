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
    document.getElementById('setting-form').addEventListener('submit', submitSettingForm);
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
    tr.append(makeCell(setting.key), makeCell(privacyMode ? maskText(setting.value) : setting.value), actionsCell);
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
    if (editingSettingRow) {
      await updateValues(`${CONFIG.SHEETS.SETTINGS}!A${editingSettingRow}:C${editingSettingRow}`, values);
    } else {
      await appendValues(SETTINGS_PANEL_RANGE, values);
    }
    closeSettingForm();
    await refreshSettingsList(true);
    currentSettings = await loadSettings(true);
    applySettingsToWidgets();
  } catch (err) {
    showFieldError('setting-form-error', err.message);
  }
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
