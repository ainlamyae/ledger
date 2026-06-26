const TOKEN_STORAGE_KEY = 'ledger_token';
const CONSENTED_STORAGE_KEY = 'ledger_consented';
// File-scoped Drive access: the app only ever sees files it created or the
// user explicitly granted via Picker — not every spreadsheet in their Drive.
// userinfo.email/profile (non-sensitive, no Google verification needed) are
// only used to show the signed-in account's name/avatar in the header.
const SHEETS_SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

let tokenClient = null;
let accessToken = null;
let authChangeHandler = () => {};
// Tracks whether the in-flight requestAccessToken call was the automatic
// silent refresh (vs. an explicit signIn() click), so a failure from it can
// be treated as "still signed out" instead of a user-facing error.
let pendingSilent = false;
// Access tokens expire after ~1hr with no refresh token (the implicit GIS
// flow never issues one), so a tab left open needs its own timer to renew
// silently before that happens — otherwise Sheets API calls start failing
// with 401 mid-session, or the next reload has to fall back to the gate.
let refreshTimer = null;
// Refresh this long before actual expiry, so the new token is in place with
// margin to spare even if the silent request itself takes a few seconds.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function loadStoredToken() {
  const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return null;

  const { token, expiresAt } = JSON.parse(raw);
  if (Date.now() >= expiresAt) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
  return { token, expiresAt };
}

function storeToken(token, expiresInSeconds) {
  const expiresAt = Date.now() + (expiresInSeconds || 3600) * 1000;
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt }));
  localStorage.setItem(CONSENTED_STORAGE_KEY, '1');
  scheduleTokenRefresh(expiresAt);
}

function scheduleTokenRefresh(expiresAt) {
  clearTimeout(refreshTimer);
  const delay = Math.max(expiresAt - Date.now() - REFRESH_BUFFER_MS, 0);
  refreshTimer = setTimeout(() => {
    pendingSilent = true;
    tokenClient.requestAccessToken({ prompt: 'none' });
  }, delay);
}

function initAuth(onAuthChange) {
  authChangeHandler = onAuthChange;
  const stored = loadStoredToken();
  accessToken = stored?.token || null;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: SHEETS_SCOPE,
    callback: (response) => {
      const wasSilent = pendingSilent;
      pendingSilent = false;

      if (response.error) {
        console.error('OAuth error:', response);
        // Silent refresh failed while user is signed in — keep them signed in
        // and retry after a backoff rather than logging them out mid-session.
        if (wasSilent && accessToken) {
          refreshTimer = setTimeout(() => {
            pendingSilent = true;
            tokenClient.requestAccessToken({ prompt: 'none' });
          }, 2 * 60 * 1000);
          return;
        }
        accessToken = null;
        authChangeHandler(null, { ...response, silent: wasSilent });
        return;
      }
      accessToken = response.access_token;
      storeToken(accessToken, response.expires_in);
      authChangeHandler(accessToken);
    },
    error_callback: (err) => {
      const wasSilent = pendingSilent;
      pendingSilent = false;
      console.error('OAuth flow error:', err);
      // Same: don't log out mid-session from a silent refresh failure.
      if (wasSilent && accessToken) {
        refreshTimer = setTimeout(() => {
          pendingSilent = true;
          tokenClient.requestAccessToken({ prompt: 'none' });
        }, 2 * 60 * 1000);
        return;
      }
      authChangeHandler(null, { ...err, silent: wasSilent });
    },
  });

  if (accessToken) {
    scheduleTokenRefresh(stored.expiresAt);
    authChangeHandler(accessToken);
    return;
  }

  // No stored token: try a silent refresh off the browser's existing Google
  // session before falling back to the sign-in gate. prompt: 'none' only
  // succeeds quietly when that session is already active (e.g. Chrome on
  // Android sharing the device's signed-in Google account); otherwise GIS
  // reports an error here instead of opening a popup, so this never blocks
  // or flashes anything — it just degrades to the gate.
  pendingSilent = true;
  tokenClient.requestAccessToken({ prompt: 'none' });
}

function signIn() {
  // First-time users (no prior consent stored) need 'consent' to grant OAuth
  // permissions. Returning users already have Google-side consent, so '' lets
  // GIS use the browser's active Google session — Chrome can often satisfy
  // this without any visible UI or with a single account-picker click.
  const hasConsented = localStorage.getItem(CONSENTED_STORAGE_KEY);
  tokenClient.requestAccessToken({ prompt: hasConsented ? '' : 'consent' });
}

function signOut() {
  clearTimeout(refreshTimer);
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  // Clear the consent flag too: a different person may sign in next on this
  // browser and needs to go through their own consent flow.
  localStorage.removeItem(CONSENTED_STORAGE_KEY);
  // A different person may sign in next on this browser — don't hand them
  // the previous user's spreadsheet selection.
  clearActiveSpreadsheetId();
  authChangeHandler(null);
}

// Used only to show the signed-in account's name/avatar in the header —
// the app's own data access stays entirely on the drive.file scope.
async function fetchUserInfo() {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function getAccessToken() {
  return accessToken;
}

function isSignedIn() {
  return accessToken !== null;
}
