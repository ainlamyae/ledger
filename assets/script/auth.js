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
// Set for the mobile return-to-tab retry, so its failure stays quiet.
let pendingSilent = false;
// Tokens last ~1hr with no refresh token. GIS's token client opens a popup for
// every request, prompt:'none' included, so nothing renews in the background:
// at expiry the app just turns signed-out, and the next click signs in again.
let expiryTimer = null;
// Less life than this left and ensureAccessToken() asks for a new token, so a
// form isn't opened on one that dies before Save.
const TOKEN_MIN_REMAINING_MS = 2 * 60 * 1000;

// Callers parked on an in-flight requestAccessToken. GIS reports through one
// shared callback rather than per-request promises, so every waiter is resolved
// together by whichever request lands — including the scheduled silent refresh.
let authWaiters = [];
// Whether any request is outstanding. Every requestAccessToken call in this file
// goes through requestToken() so this stays true: two overlapping requests both
// resolve the same waiter list, and the loser resolving second used to hand a
// caller `null` from a request it never made.
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
  const expiresAt = Date.now() + (expiresInSeconds || 3600) * 1000;
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

// index.html loads gsi/client with `async`, so it can still be in flight when
// this file runs (bootDashboard no longer waits on window.load, which used to
// guarantee it had arrived) — wait for the script's own load event rather than
// assuming `google` exists yet. Resolves immediately if it's already there.
function waitForGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  const script = document.querySelector('script[src^="https://accounts.google.com/gsi/client"]');
  return new Promise((resolve) => script.addEventListener('load', resolve, { once: true }));
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
      const wasSilent = pendingSilent;
      pendingSilent = false;
      tokenRequestInFlight = false;

      // A failure leaves whatever token is still held; its expiry timer signs out.
      if (response.error) {
        console.error('OAuth error:', response);
        resolveAuthWaiters(null);
        if (!accessToken) authChangeHandler(null, { ...response, silent: wasSilent });
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
    error_callback: (err) => {
      const wasSilent = pendingSilent;
      pendingSilent = false;
      tokenRequestInFlight = false;
      console.error('OAuth flow error:', err);
      resolveAuthWaiters(null);
      if (!accessToken) authChangeHandler(null, { ...err, silent: wasSilent });
    },
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
  // First-time users (no prior consent stored) need 'consent' to grant OAuth
  // permissions. Returning users already have Google-side consent, so '' lets
  // GIS use the browser's active Google session — Chrome can often satisfy
  // this without any visible UI or with a single account-picker click.
  const hasConsented = localStorage.getItem(CONSENTED_STORAGE_KEY);
  requestToken({ prompt: hasConsented ? '' : 'consent' });

  // On mobile, GIS opens the OAuth flow as a new browser tab rather than a
  // true popup. window.opener is often null in that context, so the token
  // can't be posted back — the app tab stays at the sign-in gate even after
  // the user authenticates. When the user switches back here, a silent
  // requestAccessToken succeeds because the browser now has a Google session
  // cookie from the completed sign-in.
  if (/Mobi|Android|iPhone|iPad|IEMobile/i.test(navigator.userAgent)) {
    let attempts = 0;
    const retryOnReturn = () => {
      if (document.hidden || isSignedIn()) return;
      if (++attempts > 3) {
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
  // Clear the consent flag too: a different person may sign in next on this
  // browser and needs to go through their own consent flow.
  localStorage.removeItem(CONSENTED_STORAGE_KEY);
  // A different person may sign in next on this browser — don't hand them
  // the previous user's spreadsheet selection.
  clearActiveSpreadsheetId();
  clearMarketCache();
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

// A token good for the next couple of minutes, or null. Awaited before a form
// opens, so a long form isn't lost to a 401 on Save.
//
// A stored token with life left comes straight back (possibly another tab's).
// Otherwise sign-in runs, but only inside the user's click: called from anywhere
// else (a background read's 401) it returns null instead of opening a window.
// `interactive: false` never opens one.
function ensureAccessToken({ interactive = true } = {}) {
  if (!tokenClient) return Promise.resolve(null);

  const stored = loadStoredToken();
  if (stored && stored.expiresAt - Date.now() > TOKEN_MIN_REMAINING_MS) {
    if (stored.token !== accessToken) adoptToken(stored);
    return Promise.resolve(stored.token);
  }

  if (!interactive || !hasUserActivation()) return Promise.resolve(null);
  // One popup, opened synchronously in the click; prompt '' lets a returning user
  // through on their Google session without a picker.
  return requestTokenAndWait(signIn);
}

// Parks the caller on the shared GIS callback, kicking `start` only when nothing
// is already outstanding — a second click while the iframe is open, or a click
// that lands on top of the scheduled hourly refresh, joins that request rather
// than racing another one against it. Racing them meant two resolutions of the
// same waiter list, and whichever landed second could hand a caller the result of
// a request it never made.
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
