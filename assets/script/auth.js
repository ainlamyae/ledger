const TOKEN_STORAGE_KEY = 'ledger_token';
const CONSENTED_STORAGE_KEY = 'ledger_consented';
// drive.file sees only files the app created or the user picked, not the whole
// Drive. userinfo.email/profile only show the account's name/avatar in the header.
const SHEETS_SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

let tokenClient = null;
let accessToken = null;
let authChangeHandler = () => {};
// Set for the mobile return-to-tab retry, so its failure stays quiet.
let pendingSilent = false;
// Tokens last ~1hr with no refresh token, and GIS opens a popup for every request,
// so nothing renews in the background: at expiry the app just turns signed-out.
let expiryTimer = null;
// Less life than this left and ensureAccessToken() asks for a new token, so a
// form isn't opened on one that dies before Save.
const TOKEN_MIN_REMAINING_MS = 2 * 60 * 1000;
// Used when GIS's response leaves out expires_in.
const DEFAULT_TOKEN_LIFETIME_S = 3600;
const MOBILE_UA_PATTERN = /Mobi|Android|iPhone|iPad|IEMobile/i;
// Silent retries the mobile sign-in makes on returning to the tab.
const MOBILE_SILENT_RETRY_LIMIT = 3;

// Callers parked on an in-flight requestAccessToken. GIS reports through one
// shared callback, so every waiter is resolved by whichever request lands.
let authWaiters = [];
// Whether a requestToken() call is outstanding, so overlapping callers join it
// instead of starting a second request whose result they'd be handed.
let tokenRequestInFlight = false;

function requestToken(params) {
  tokenRequestInFlight = true;
  tokenClient.requestAccessToken(params);
}

function resolveAuthWaiters(token) {
  const waiters = authWaiters;
  authWaiters = [];
  waiters.forEach((resolve) => resolve(token));
}

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
  const expiresAt = Date.now() + (expiresInSeconds || DEFAULT_TOKEN_LIFETIME_S) * 1000;
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt }));
  localStorage.setItem(CONSENTED_STORAGE_KEY, '1');
  scheduleTokenExpiry(expiresAt);
}

// At expiry: signed-out quietly, no popup. Another tab's newer token wins.
function scheduleTokenExpiry(expiresAt) {
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    const stored = loadStoredToken();
    if (stored) {
      adoptToken(stored);
      return;
    }
    accessToken = null;
    authChangeHandler(null);
  }, Math.max(expiresAt - Date.now(), 0));
}

// A token another tab signed in with, taken over without a request of our own.
function adoptToken(stored) {
  const wasSignedOut = !accessToken;
  accessToken = stored.token;
  scheduleTokenExpiry(stored.expiresAt);
  if (wasSignedOut) authChangeHandler(accessToken);
}

// Signing in on one ledger tab signs in the others.
window.addEventListener('storage', (event) => {
  if (event.key !== TOKEN_STORAGE_KEY || !tokenClient) return;
  const stored = loadStoredToken();
  if (stored && stored.token !== accessToken) adoptToken(stored);
});

// A Google window may open only inside the user's own click; a popup from a timer
// or a background read is what used to appear unasked. No API: assume a click.
function hasUserActivation() {
  return navigator.userActivation ? navigator.userActivation.isActive : true;
}

// gsi/client loads `async`, so it may not have arrived yet: wait for its load event.
function waitForGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  const script = document.querySelector('script[src^="https://accounts.google.com/gsi/client"]');
  return new Promise((resolve) => script.addEventListener('load', resolve, { once: true }));
}

// Ends the outstanding request; returns whether it was the quiet mobile retry.
function finishTokenRequest() {
  const wasSilent = pendingSilent;
  pendingSilent = false;
  tokenRequestInFlight = false;
  return wasSilent;
}

// A failure leaves whatever token is still held; its expiry timer signs out.
function reportTokenFailure(message, detail, wasSilent) {
  console.error(message, detail);
  resolveAuthWaiters(null);
  if (!accessToken) authChangeHandler(null, { ...detail, silent: wasSilent });
}

async function initAuth(onAuthChange) {
  authChangeHandler = onAuthChange;
  const stored = loadStoredToken();
  accessToken = stored?.token || null;

  await waitForGoogleIdentity();

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: SHEETS_SCOPE,
    callback: (response) => {
      const wasSilent = finishTokenRequest();
      if (response.error) {
        reportTokenFailure('OAuth error:', response, wasSilent);
        return;
      }
      const wasSignedIn = accessToken !== null;
      accessToken = response.access_token;
      storeToken(accessToken, response.expires_in);
      resolveAuthWaiters(accessToken);
      // A renewal mid-session keeps the page as it is; only a sign-in loads it.
      if (!wasSignedIn) authChangeHandler(accessToken);
    },
    // Popup closed or blocked.
    error_callback: (err) => reportTokenFailure('OAuth flow error:', err, finishTokenRequest()),
  });

  if (accessToken) {
    scheduleTokenExpiry(stored.expiresAt);
    authChangeHandler(accessToken);
    return;
  }

  // No token: signed-out view with the 🔑 icon. No window opens on page load.
  authChangeHandler(null);
}

function signIn() {
  // First-timers need 'consent'; a returning user's '' lets GIS reuse the
  // browser's Google session, often with no UI or one account-picker click.
  const hasConsented = localStorage.getItem(CONSENTED_STORAGE_KEY);
  requestToken({ prompt: hasConsented ? '' : 'consent' });

  // On mobile GIS opens a new tab with no window.opener, so the token never posts
  // back. Back on this tab the browser has a Google session, so a silent request
  // succeeds. Deliberately not via requestToken(): it never parks waiters.
  if (MOBILE_UA_PATTERN.test(navigator.userAgent)) {
    let attempts = 0;
    const retryOnReturn = () => {
      if (document.hidden || isSignedIn()) return;
      if (++attempts > MOBILE_SILENT_RETRY_LIMIT) {
        document.removeEventListener('visibilitychange', retryOnReturn);
        return;
      }
      pendingSilent = true;
      tokenClient.requestAccessToken({ prompt: 'none' });
    };
    document.addEventListener('visibilitychange', retryOnReturn);
  }
}

function signOut() {
  clearTimeout(expiryTimer);
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  // A different person may sign in next on this browser: they need their own
  // consent, and mustn't inherit this user's spreadsheet.
  localStorage.removeItem(CONSENTED_STORAGE_KEY);
  clearActiveSpreadsheetId();
  clearMarketCache();
  authChangeHandler(null);
}

// Only for the header's name/avatar; data access stays on drive.file.
async function fetchUserInfo() {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// A token good for the next couple of minutes, or null; awaited before a form
// opens so Save doesn't hit a 401. A stored token with life left (maybe another
// tab's) comes straight back. Otherwise sign-in runs, but only inside the user's
// click; `interactive: false` never opens a window.
function ensureAccessToken({ interactive = true } = {}) {
  if (!tokenClient) return Promise.resolve(null);

  const stored = loadStoredToken();
  if (stored && stored.expiresAt - Date.now() > TOKEN_MIN_REMAINING_MS) {
    if (stored.token !== accessToken) adoptToken(stored);
    return Promise.resolve(stored.token);
  }

  if (!interactive || !hasUserActivation()) return Promise.resolve(null);
  // One popup, opened synchronously in the click.
  return requestTokenAndWait(signIn);
}

// Parks the caller on the shared GIS callback, calling `start` only when no
// request is outstanding: a second click joins the open one rather than racing it.
function requestTokenAndWait(start) {
  return new Promise((resolve) => {
    authWaiters.push(resolve);
    if (!tokenRequestInFlight) start();
  });
}

function getAccessToken() {
  return accessToken;
}

function isSignedIn() {
  return accessToken !== null;
}
