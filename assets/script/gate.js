// Owns the page shown before the dashboard is reachable: the sign-in error
// banner, the "connect your spreadsheet" file-gate, and the auth-state-driven
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
  document.getElementById('privacy-toggle-btn').hidden = state !== 'dashboard';
  document.getElementById('widgets-toggle-btn').hidden = state !== 'dashboard';
  if (state !== 'signedOut') removeSignInBanner();
}

// Prepended to #dashboard rather than a full-page gate, so every block stays
// visible (with its placeholder content) behind it — matches showDashboardError's
// pattern in app.js. Only ever shown for an actual sign-in failure: the plain
// "you're signed out" case has no banner at all — the header's sign-in icon is
// the only cue, and any gated action (setupAuthGatedActions in app.js) signs
// the user in on click and then carries on with whatever they clicked.
function removeSignInBanner() {
  document.getElementById('signin-banner')?.remove();
}

function showSignInBanner(errorMessage) {
  if (!errorMessage) {
    removeSignInBanner();
    return;
  }

  const dashboard = document.getElementById('dashboard');
  let banner = document.getElementById('signin-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'signin-banner';

    const text = document.createElement('span');
    banner.appendChild(text);

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Sign in';
    btn.addEventListener('click', signIn);
    banner.appendChild(btn);

    dashboard.prepend(banner);
  }

  banner.className = 'status error-banner';
  banner.firstElementChild.textContent = errorMessage;
}

function handleAuthChange(token, error) {
  const errorMessage = (error && !error.silent)
    ? `Sign-in failed: ${error.type || error.error || 'unknown error'}${error.message ? ` — ${error.message}` : ''}`
    : null;

  if (!token) {
    setUIState('signedOut');
    showSignInBanner(errorMessage);
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
