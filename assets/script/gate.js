// Owns the page shown before the dashboard is reachable: the sign-in gate,
// the "connect your spreadsheet" file-gate, and the auth-state-driven
// switch between them and the dashboard itself. Kept out of app.js (the
// dashboard proper) so the pre-login flow can be read and changed on its
// own, without wading through unrelated dashboard code.

// 'signedOut' -> the landing/sign-in gate.
// 'needsFile' -> signed in, but no spreadsheet selected yet (new user, or
//   returning user who cleared storage / switched browsers).
// 'dashboard' -> signed in with a spreadsheet selected; the normal app.
function setUIState(state) {
  document.getElementById('gate').hidden = state !== 'signedOut';
  document.getElementById('file-gate').hidden = state !== 'needsFile';
  document.getElementById('dashboard').hidden = state !== 'dashboard';
  document.getElementById('main-nav').hidden = state !== 'dashboard';
  document.getElementById('signin-btn').hidden = state !== 'signedOut';
  document.getElementById('account-menu').hidden = state === 'signedOut';
  document.getElementById('refresh-btn').hidden = state !== 'dashboard';
  document.getElementById('privacy-toggle-btn').hidden = state !== 'dashboard';
}

function handleAuthChange(token, error) {
  const status = document.getElementById('auth-status');
  if (error && !error.silent) {
    status.hidden = false;
    status.textContent = `Sign-in failed: ${error.type || error.error || 'unknown error'}${error.message ? ` — ${error.message}` : ''}`;
  } else {
    status.hidden = true;
    status.textContent = '';
  }

  if (!token) {
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
