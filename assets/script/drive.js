const ACTIVE_SHEET_STORAGE_KEY = 'ledger_spreadsheet_id';

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

// Opens Google Sheets' own "make a copy" flow in a new tab. This needs no
// Drive scope at all — Sheets clones the template directly into the
// signed-in user's Drive via Google's UI, outside our app entirely. The
// user then picks that new file via pickSpreadsheet() below.
function openTemplateCopyLink() {
  window.open(`https://docs.google.com/spreadsheets/d/${CONFIG.TEMPLATE_SPREADSHEET_ID}/copy`, '_blank');
}

// Loads gapi's 'picker' module (for the file picker UI), cached so repeated
// picker opens don't reload the script.
function loadGapiPicker() {
  if (gapiReadyPromise) return gapiReadyPromise;

  gapiReadyPromise = new Promise((resolve, reject) => {
    gapi.load('picker', { callback: resolve, onerror: reject });
  });

  return gapiReadyPromise;
}

// Shows a Picker scoped to Sheets files. Selecting a file here is what
// grants our drive.file-scoped token access to that specific file, whether
// the user just created it (via openTemplateCopyLink) or it's an existing
// personal ledger copy from a previous session/browser.
async function pickSpreadsheet() {
  await loadGapiPicker();

  return new Promise((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setMode(google.picker.DocsViewMode.LIST)
      .setIncludeFolders(true);

    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(getAccessToken())
      .setDeveloperKey(CONFIG.PICKER_API_KEY)
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

// Reads/renames the active spreadsheet's Drive filename — distinct from any
// sheet *tab* name. drive.file scope already covers metadata writes on a
// file the app was granted access to via pickSpreadsheet(), so no extra
// scope is needed.
async function getActiveSpreadsheetName() {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${getActiveSpreadsheetId()}?fields=name`,
    { headers: { Authorization: `Bearer ${getAccessToken()}` } }
  );
  if (!res.ok) throw new Error(`Drive API error ${res.status}`);
  return (await res.json()).name;
}

async function renameActiveSpreadsheet(name) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${getActiveSpreadsheetId()}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Drive API error ${res.status}`);
}
