const TOKEN_STORAGE_KEY = 'ledger_token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let tokenClient = null;
let accessToken = null;
let authChangeHandler = () => {};

function loadStoredToken() {
  const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) return null;

  const { token, expiresAt } = JSON.parse(raw);
  if (Date.now() >= expiresAt) {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
  return token;
}

function storeToken(token, expiresInSeconds) {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt }));
}

function initAuth(onAuthChange) {
  authChangeHandler = onAuthChange;
  accessToken = loadStoredToken();

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: SHEETS_SCOPE,
    callback: (response) => {
      if (response.error) {
        console.error('OAuth error:', response);
        accessToken = null;
        authChangeHandler(null, response);
        return;
      }
      accessToken = response.access_token;
      storeToken(accessToken, response.expires_in);
      authChangeHandler(accessToken);
    },
    error_callback: (err) => {
      console.error('OAuth flow error:', err);
      authChangeHandler(null, err);
    },
  });

  if (accessToken) authChangeHandler(accessToken);
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
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  authChangeHandler(null);
}

function getAccessToken() {
  return accessToken;
}

function isSignedIn() {
  return accessToken !== null;
}
