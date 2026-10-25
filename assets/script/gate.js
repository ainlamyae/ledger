// Owns the page shown before the dashboard is reachable: the
// "connect your spreadsheet" file-gate, and the auth-state-driven
// switch between them and the dashboard itself. Kept out of app.js (the
// dashboard proper) so the pre-login flow can be read and changed on its
// own, without wading through unrelated dashboard code.

// 'signedOut' -> dashboard shell visible (every block, all placeholders), no
//   data loaded — just the header's sign-in icon, no banner nagging about it.
//   Clicking any gated action (setupAuthGatedActions in app.js) signs the
//   user in first and then carries out whatever was clicked.
// 'needsFile' -> signed in, but no spreadsheet selected yet (new user, or
//   returning user who cleared storage / switched browsers): the one state
//   that still takes over the whole page, since there's no spreadsheet to
//   eventually populate the blocks from.
// 'dashboard' -> signed in with a spreadsheet selected; the normal app.
function setUIState(state) {
  document.getElementById('file-gate').hidden = state !== 'needsFile';
  document.getElementById('dashboard').hidden = state === 'needsFile';
  document.getElementById('main-nav').hidden = state === 'needsFile';
  document.getElementById('signin-btn').hidden = state !== 'signedOut';
  document.getElementById('account-menu').hidden = state === 'signedOut';
  document.getElementById('refresh-btn').hidden = state !== 'dashboard';
  // A form address loaded while signed out (or without a file) can't open its form.
  if (state !== 'dashboard' && typeof abandonPendingFormPage === 'function') abandonPendingFormPage();
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

// Shows the signed-in account's picture (or initials, if it has none/fails
// to load) and name/email in the header dropdown.
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

function setupFileGate() {
  document.getElementById('get-template-btn').addEventListener('click', openTemplateCopyLink);

  document.getElementById('select-sheet-btn').addEventListener('click', async () => {
    try {
      await pickSpreadsheet();
      setUIState('dashboard');
      loadDashboard();
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
