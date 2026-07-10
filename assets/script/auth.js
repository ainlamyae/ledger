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
// How much life a stored token must have left for ensureAccessToken() to hand it
// straight back. Deliberately longer than a save takes and shorter than
// REFRESH_BUFFER_MS: inside this window the scheduled refresh is either running
// or overdue, so a write is better off waiting for a new token than starting on
// one that may die between opening a form and saving it.
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

function requestSilently() {
  pendingSilent = true;
  requestToken({ prompt: 'none' });
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
  scheduleTokenRefresh(expiresAt);
}

function scheduleTokenRefresh(expiresAt) {
  clearTimeout(refreshTimer);
  const delay = Math.max(expiresAt - Date.now() - REFRESH_BUFFER_MS, 0);
  refreshTimer = setTimeout(requestSilently, delay);
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
      tokenRequestInFlight = false;

      if (response.error) {
        console.error('OAuth error:', response);
        // Silent refresh failed while user is signed in — keep them signed in
        // and retry after a backoff rather than logging them out mid-session.
        if (wasSilent && accessToken) {
          // Waiters get null, not the token we're still holding: a silent refresh
          // that fails is the signal that this session can't be renewed quietly,
          // so ensureAccessToken() should escalate to the visible flow instead of
          // letting a write start on a token that's about to expire.
          resolveAuthWaiters(null);
          refreshTimer = setTimeout(requestSilently, 2 * 60 * 1000);
          return;
        }
        accessToken = null;
        resolveAuthWaiters(null);
        authChangeHandler(null, { ...response, silent: wasSilent });
        return;
      }
      accessToken = response.access_token;
      storeToken(accessToken, response.expires_in);
      resolveAuthWaiters(accessToken);
      authChangeHandler(accessToken);
    },
    error_callback: (err) => {
      const wasSilent = pendingSilent;
      pendingSilent = false;
      tokenRequestInFlight = false;
      console.error('OAuth flow error:', err);
      resolveAuthWaiters(null);
      // Same: don't log out mid-session from a silent refresh failure.
      if (wasSilent && accessToken) {
        refreshTimer = setTimeout(requestSilently, 2 * 60 * 1000);
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

  // No stored token: on desktop, try a silent refresh — GIS resolves the
  // existing Google session via a hidden iframe, no visible UI. On mobile,
  // skip this entirely: mobile browsers (especially iOS) restrict cross-origin
  // iframes, so GIS falls back to opening a popup/tab even for prompt:'none',
  // causing an unexpected window to appear before the user taps anything.
  // Just show the sign-in gate immediately instead.
  if (/Mobi|Android|iPhone|iPad|IEMobile/i.test(navigator.userAgent)) {
    authChangeHandler(null);
  } else {
    requestSilently();
  }
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

// A token good for the next couple of minutes, or null if the user has to sign in
// again. Awaited BEFORE a form opens rather than checked when it saves: the token
// lives ~1hr and the app is a tab people leave open, so the failure people
// actually hit was filling a long form and losing it to a 401 on Save.
//
// Three outcomes, cheapest first: a stored token with enough life left is handed
// straight back (no network, no UI); otherwise one silent renewal is attempted
// (GIS resolves the existing Google session in a hidden iframe — invisible when
// it works); and only if that fails does the visible flow run, which is the one
// case the user sees anything at all.
//
// `interactive: false` stops before that last step, for callers that would rather
// skip the work than raise a popup.
function ensureAccessToken({ interactive = true } = {}) {
  // Before initAuth there is no client to ask, and nothing that needs a token has
  // run yet — a null here beats a TypeError from inside a click handler.
  if (!tokenClient) return Promise.resolve(null);

  const stored = loadStoredToken();
  if (stored && stored.expiresAt - Date.now() > TOKEN_MIN_REMAINING_MS) {
    return Promise.resolve(stored.token);
  }

  return requestTokenAndWait(requestSilently).then((token) => {
    if (token || !interactive) return token;
    // Silent renewal is out, so this needs the account picker / consent screen.
    // signIn() carries its own mobile handling, where GIS opens a tab instead of
    // a popup and the token can only arrive once the user comes back.
    return requestTokenAndWait(signIn);
  });
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
