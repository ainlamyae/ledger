const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const VALUE_PARAMS = { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' };

// Sheets allows 60 reads per minute per user, and a full dashboard load fires
// ~18 at once with nothing cached, so a few Refresh clicks inside a minute
// can run out. A 429 only ever means "wait and resend", so back off and retry
// (2s, 4s, 8s, 16s, 32s with jitter, ~62s total, past the per-minute window)
// before reporting it.
const QUOTA_RETRY_LIMIT = 5;

// `retrying` is set only by the 401 path below — the recursive call renews the
// token first and gets exactly one more attempt, so a dead token can't loop.
// Every request sent, retries included — loadDashboard logs how many a load cost.
let sheetsRequestCount = 0;

async function sheetsRequest(path, options = {}, retrying = false, quotaAttempt = 0) {
  sheetsRequestCount++;
  const token = getAccessToken();
  if (!token) throw new Error('Not signed in');

  const spreadsheetId = getActiveSpreadsheetId();
  if (!spreadsheetId) throw new Error('No spreadsheet selected');

  const res = await fetch(`${SHEETS_API}/${spreadsheetId}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // The one error worth handling here rather than reporting. A token that expired
  // or was revoked between opening a form and saving it used to surface as a
  // Google auth message on the filled-in form — the click gate in app.js makes
  // that rare, but a form left open past the hour can still hit it, and there's
  // no reason to make someone re-type a save that only needed a new token.
  // Renew once, in place, and re-send the identical request.
  if (res.status === 401 && !retrying) {
    const fresh = await ensureAccessToken();
    if (fresh) return sheetsRequest(path, options, true, quotaAttempt);
  }

  if (res.status === 429 && quotaAttempt < QUOTA_RETRY_LIMIT) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    const delayMs = retryAfter > 0
      ? retryAfter * 1000
      : 2000 * 2 ** quotaAttempt + Math.random() * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return sheetsRequest(path, options, retrying, quotaAttempt + 1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Sheets API error ${res.status}`);
  }

  return res.json();
}

// --- Read coalescing ---------------------------------------------------------
//
// Sheets counts quota per REQUEST (60 reads/min/user), not per range, and a full
// load used to send ~28: every module fetched the tab list for itself, then read
// its own range. Both are shared here, with no change to the callers:
//
// - The tab list (sheet ids/titles) is fetched once and reused until something
//   could have changed it: a Refresh (resetSheetReads), a batchUpdate (which can
//   add, delete or rename tabs), or a different spreadsheet.
// - getValues calls made within READ_BATCH_WINDOW_MS of each other, with the same
//   params, go out as ONE values:batchGet. If that request fails, each range is
//   retried on its own, so one missing tab fails only the module that reads it.

const READ_BATCH_WINDOW_MS = 20;

let metadataPromise = null;
let metadataSpreadsheetId = null;
const pendingReads = new Map(); // params key -> { params, items: [{ range, resolve, reject }] }

function getSpreadsheetMetadata() {
  const spreadsheetId = getActiveSpreadsheetId();
  if (!metadataPromise || metadataSpreadsheetId !== spreadsheetId) {
    metadataSpreadsheetId = spreadsheetId;
    metadataPromise = sheetsRequest('?fields=sheets.properties');
    // A failed fetch isn't kept: the next caller tries again.
    metadataPromise.catch(() => {
      if (metadataSpreadsheetId === spreadsheetId) metadataPromise = null;
    });
  }
  return metadataPromise;
}

// Drops the shared tab list, so the next reader fetches it fresh.
function resetSheetReads() {
  metadataPromise = null;
}

function getValuesNow(range, params = {}) {
  const query = new URLSearchParams(params).toString();
  const suffix = query ? `?${query}` : '';
  return sheetsRequest(`/values/${encodeURIComponent(range)}${suffix}`);
}

// Same result as a single values.get ({ range, values }), but batched with the
// other reads made at the same moment (see above).
function getValues(range, params = {}) {
  const key = JSON.stringify(params);
  return new Promise((resolve, reject) => {
    if (!pendingReads.has(key)) {
      pendingReads.set(key, { params, items: [] });
      setTimeout(() => flushReads(key), READ_BATCH_WINDOW_MS);
    }
    pendingReads.get(key).items.push({ range, resolve, reject });
  });
}

async function flushReads(key) {
  const { params, items } = pendingReads.get(key);
  pendingReads.delete(key);
  if (items.length === 1) {
    getValuesNow(items[0].range, params).then(items[0].resolve, items[0].reject);
    return;
  }
  try {
    const { valueRanges = [] } = await batchGetValues(items.map((item) => item.range), params);
    items.forEach((item, i) => item.resolve(valueRanges[i] || { range: item.range, values: [] }));
  } catch (err) {
    console.warn(`[sheets] batched read of ${items.length} ranges failed (${err.message}); reading each on its own`);
    items.forEach((item) => getValuesNow(item.range, params).then(item.resolve, item.reject));
  }
}

function batchGetValues(ranges, params = {}) {
  const query = new URLSearchParams(params);
  ranges.forEach((range) => query.append('ranges', range));
  return sheetsRequest(`/values:batchGet?${query.toString()}`);
}

// valueInputOption defaults to USER_ENTERED — what the entity forms
// (transactions, timesheet, ...) want, since a typed date or formula should be
// parsed the way typing it into the cell would be. Pass 'RAW' for values that
// must round-trip byte-for-byte instead of being reinterpreted; see
// settings-panel.js's saveSettingValues for why that matters.
function appendValues(range, values, valueInputOption = 'USER_ENTERED') {
  return sheetsRequest(
    `/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values }) }
  );
}

// The sheet row an append landed on, from its response ("Tab!A12:U12" -> 12).
function appendedRow(response) {
  const match = /![A-Z]+(\d+)/.exec(response?.updates?.updatedRange || '');
  return match ? Number(match[1]) : null;
}

function updateValues(range, values, valueInputOption = 'USER_ENTERED') {
  return sheetsRequest(
    `/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`,
    { method: 'PUT', body: JSON.stringify({ values }) }
  );
}

// Several ranges in one request — `data` is [{ range, values }].
function batchUpdateValues(data, valueInputOption = 'USER_ENTERED') {
  return sheetsRequest('/values:batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ valueInputOption, data }),
  });
}

function batchUpdate(requests) {
  // Can add, delete or rename tabs, so the shared tab list may be out of date.
  resetSheetReads();
  return sheetsRequest(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
}
