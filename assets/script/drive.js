const ACTIVE_SHEET_STORAGE_KEY = 'ledger_spreadsheet_id';
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';

let gapiReadyPromise = null;

function getActiveSpreadsheetId() {
  return localStorage.getItem(ACTIVE_SHEET_STORAGE_KEY);
}

function setActiveSpreadsheetId(id) {
  localStorage.setItem(ACTIVE_SHEET_STORAGE_KEY, id);
}

function clearActiveSpreadsheetId() {
  localStorage.removeItem(ACTIVE_SHEET_STORAGE_KEY);
}

// Google Sheets' own "make a copy" flow in a new tab: needs no Drive scope, as
// Sheets clones the template itself. The user then picks the copy via pickSpreadsheet().
function openTemplateCopyLink() {
  window.open(`https://docs.google.com/spreadsheets/d/${CONFIG.TEMPLATE_SPREADSHEET_ID}/copy`, '_blank');
}

// gapi's 'picker' module, loaded once.
function loadGapiPicker() {
  if (gapiReadyPromise) return gapiReadyPromise;

  gapiReadyPromise = new Promise((resolve, reject) => {
    gapi.load('picker', { callback: resolve, onerror: reject });
  });

  return gapiReadyPromise;
}

// A Picker of Sheets files. Picking a file is what grants the drive.file token
// access to it, whether a fresh template copy or an existing ledger.
async function pickSpreadsheet() {
  await loadGapiPicker();

  return new Promise((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setMode(google.picker.DocsViewMode.LIST)
      .setIncludeFolders(true);

    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(getAccessToken())
      .setDeveloperKey(CONFIG.PICKER_API_KEY)
      // The client id's leading number is the Cloud project number.
      .setAppId(CONFIG.CLIENT_ID.split('-')[0])
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const fileId = data.docs[0].id;
          setActiveSpreadsheetId(fileId);
          resolve(fileId);
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new Error('cancelled'));
        }
      })
      .build();

    picker.setVisible(true);
  });
}

// A Drive API call on the active spreadsheet's file; throws on a non-2xx.
async function driveFileRequest(suffix, init = {}) {
  const res = await fetch(`${DRIVE_FILES_API}/${getActiveSpreadsheetId()}${suffix}`, {
    ...init,
    headers: { Authorization: `Bearer ${getAccessToken()}`, ...init.headers },
  });
  if (!res.ok) throw new Error(`Drive API error ${res.status}`);
  return res;
}

// The spreadsheet's Drive filename, not a tab name. drive.file already covers
// metadata writes on a picked file.
async function getActiveSpreadsheetName() {
  const res = await driveFileRequest('?fields=name');
  return (await res.json()).name;
}

async function renameActiveSpreadsheet(name) {
  await driveFileRequest('', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}
