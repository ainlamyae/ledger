// The pre-dashboard flow: the "connect your spreadsheet" file-gate and the
// auth-driven switch between it and the dashboard.

// 'signedOut' -> the dashboard shell with placeholders and the header's sign-in
//   icon; a gated action (setupAuthGatedActions, app.js) signs in first, then runs.
// 'needsFile' -> signed in with no spreadsheet chosen: the only state that takes
//   over the whole page, since there's nothing to fill the blocks from.
// 'dashboard' -> signed in with a spreadsheet; the normal app.
function setUIState(state) {
  document.getElementById('file-gate').hidden = state !== 'needsFile';
  document.getElementById('dashboard').hidden = state === 'needsFile';
  document.getElementById('main-nav').hidden = state === 'needsFile';
  document.getElementById('signin-btn').hidden = state !== 'signedOut';
  document.getElementById('account-menu').hidden = state === 'signedOut';
  document.getElementById('refresh-btn').hidden = state !== 'dashboard';
  // Signed out, a form address keeps its own page and opens once signed in; without a file it can't.
  if (state === 'signedOut' && typeof holdPendingFormPage === 'function') holdPendingFormPage();
  if (state === 'needsFile' && typeof abandonPendingFormPage === 'function') abandonPendingFormPage();
}

function handleAuthChange(token, error) {
  if (!token) {
    // A failed sign-in leaves the 🔑 icon to try again; no banner.
    if (error && !error.silent) console.warn('Sign-in failed:', error.type || error.error || 'unknown error', error.message || '');
    setUIState('signedOut');
    return;
  }

  populateAccountMenu();

  if (getActiveSpreadsheetId()) {
    setUIState('dashboard');
    loadDashboard();
  } else {
    setUIState('needsFile');
  }
}

// The account's picture (or its initial) and name/email in the header dropdown.
async function populateAccountMenu() {
  const info = await fetchUserInfo();
  if (!info) return;

  const img = document.getElementById('account-avatar-img');
  const fallback = document.getElementById('account-avatar-fallback');

  if (info.picture) {
    img.src = info.picture;
    img.hidden = false;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = (info.name || info.email || '?').trim().charAt(0).toUpperCase();
  }

  document.getElementById('account-menu-name').textContent = info.name || '';
  document.getElementById('account-menu-email').textContent = info.email || '';
  document.getElementById('account-btn-name').textContent = info.name || info.email || '';
  document.getElementById('account-btn-email').textContent = info.name ? (info.email || '') : '';
}

function showFileGateStatus(message) {
  const status = document.getElementById('file-gate-status');
  status.hidden = false;
  status.textContent = message;
}

// Shared by the file-gate and the account menu's Switch spreadsheet; rejects with 'cancelled' on a closed picker.
async function pickAndLoadSpreadsheet() {
  await pickSpreadsheet();
  setUIState('dashboard');
  loadDashboard();
}

function setupFileGate() {
  document.getElementById('get-template-btn').addEventListener('click', openTemplateCopyLink);

  document.getElementById('select-sheet-btn').addEventListener('click', async () => {
    try {
      await pickAndLoadSpreadsheet();
    } catch (err) {
      if (err.message !== 'cancelled') showFileGateStatus(`Couldn't select that file: ${err.message}`);
    }
  });
}

function initGate() {
  initAuth(handleAuthChange);
  document.getElementById('signin-btn').addEventListener('click', signIn);
  setupFileGate();
}
