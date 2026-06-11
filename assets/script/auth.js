const TOKEN_STORAGE_KEY = 'ledger_token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let tokenClient = null;
let accessToken = null;
let authChangeHandler = () => {};

function loadStoredToken() {
  const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return null;

  const { token, expiresAt } = JSON.parse(raw);
  if (Date.now() >= expiresAt) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
  return token;
}

function storeToken(token, expiresInSeconds) {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt }));
}

function initAuth(onAuthChange) {
  authChangeHandler = onAuthChange;
  accessToken = loadStoredToken();

  let silentAttempt = false;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: SHEETS_SCOPE,
    callback: (response) => {
      if (response.error) {
        console.error('OAuth error:', response);
        accessToken = null;
        if (!silentAttempt) authChangeHandler(null, response);
        silentAttempt = false;
        return;
      }
      accessToken = response.access_token;
      storeToken(accessToken, response.expires_in);
      authChangeHandler(accessToken);
      silentAttempt = false;
    },
    error_callback: (err) => {
      console.error('OAuth flow error:', err);
      if (!silentAttempt) authChangeHandler(null, err);
      silentAttempt = false;
    },
  });

  if (accessToken) {
    authChangeHandler(accessToken);
  } else {
    // No valid cached token (e.g. expired, or first launch from a
    // home-screen icon where sessionStorage didn't persist). Try a
    // silent refresh against the existing Google session before
    // falling back to the sign-in gate.
    authChangeHandler(null);
    silentAttempt = true;
    tokenClient.requestAccessToken({ prompt: 'none' });
  }
}

function signIn() {
  // 'consent' forces the picker on first sign-in; afterwards an empty
  // prompt lets GIS silently refresh using the existing session.
  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
}

function signOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  authChangeHandler(null);
}

function getAccessToken() {
  return accessToken;
}

function isSignedIn() {
  return accessToken !== null;
}
