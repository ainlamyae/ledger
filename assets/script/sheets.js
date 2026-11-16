const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const VALUE_PARAMS = { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' };

// Sheets allows 60 reads a minute per user and a cold dashboard load fires ~18, so
// a few Refreshes can run out. A 429 only means "wait and resend": back off
// 2s, 4s, 8s, 16s, 32s plus jitter (~62s, past the window) before reporting it.
const QUOTA_RETRY_LIMIT = 5;
const QUOTA_BASE_DELAY_MS = 2000;
const QUOTA_JITTER_MS = 1000;

// Every request sent, retries included — loadDashboard logs how many a load cost.
let sheetsRequestCount = 0;

// `retrying` is set only by the 401 path: one more attempt on a renewed token,
// so a dead token can't loop.
async function sheetsRequest(path, options = {}, retrying = false, quotaAttempt = 0) {
  sheetsRequestCount++;
  // Expired while a form sat open: Save's click signs in first (never a background read).
  const token = getAccessToken() || await ensureAccessToken();
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

  // A token that died while a form sat open past the hour: renew once and
  // re-send, rather than make someone re-type a save.
  if (res.status === 401 && !retrying) {
    const fresh = await ensureAccessToken();
    if (fresh) return sheetsRequest(path, options, true, quotaAttempt);
  }

  if (res.status === 429 && quotaAttempt < QUOTA_RETRY_LIMIT) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    const delayMs = retryAfter > 0
      ? retryAfter * 1000
      : QUOTA_BASE_DELAY_MS * 2 ** quotaAttempt + Math.random() * QUOTA_JITTER_MS;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return sheetsRequest(path, options, retrying, quotaAttempt + 1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Sheets API error ${res.status}`);
  }

  return res.json();
}

// A write whose payload goes as the JSON body.
function sheetsWrite(path, method, payload) {
  return sheetsRequest(path, { method, body: JSON.stringify(payload) });
}

function valuesPath(range) {
  return `/values/${encodeURIComponent(range)}`;
}

// --- Cell helpers -------------------------------------------------------------

// An A1 range on a tab, quoted (apostrophes doubled) so any tab name works.
function sheetRange(tab, a1) {
  return `'${String(tab).replace(/'/g, "''")}'!${a1}`;
}

// A cell read as text. Sheets stores typed digits ("711", "4165550100") as numbers,
// which UNFORMATTED_VALUE returns as numbers.
function cellText(value) {
  return value === undefined || value === null ? '' : String(value);
}

// Free text for a USER_ENTERED write: the leading ' keeps it as typed (never a
// formula, number, date or boolean); Sheets doesn't store the quote itself.
function sheetText(value) {
  const text = cellText(value);
  return text === '' ? '' : `'${text}`;
}

// --- Read coalescing ---------------------------------------------------------
//
// Sheets counts quota per request, not per range, so reads are shared here with
// no change to the callers:
// - The tab list is fetched once and reused until a Refresh (resetSheetReads),
//   a batchUpdate (which can add, delete or rename tabs) or a spreadsheet switch.
// - getValues calls within READ_BATCH_WINDOW_MS of each other, with the same
//   params, go out as ONE values:batchGet. If it fails, each range is retried on
//   its own, so one missing tab fails only the module that reads it.

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
  return sheetsRequest(`${valuesPath(range)}${suffix}`);
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

// USER_ENTERED (the default) parses a typed date or formula as the cell would.
// Pass 'RAW' for values that must round-trip byte-for-byte (see
// other-settings.js's saveSettingValues).
function appendValues(range, values, valueInputOption = 'USER_ENTERED') {
  return sheetsWrite(
    `${valuesPath(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
    'POST',
    { values }
  );
}

// The sheet row an append landed on, from its response ("Tab!A12:U12" -> 12).
function appendedRow(response) {
  const match = /![A-Z]+(\d+)/.exec(response?.updates?.updatedRange || '');
  return match ? Number(match[1]) : null;
}

function updateValues(range, values, valueInputOption = 'USER_ENTERED') {
  return sheetsWrite(`${valuesPath(range)}?valueInputOption=${valueInputOption}`, 'PUT', { values });
}

// Several ranges in one request — `data` is [{ range, values }].
function batchUpdateValues(data, valueInputOption = 'USER_ENTERED') {
  return sheetsWrite('/values:batchUpdate', 'POST', { valueInputOption, data });
}

// A tab the app adds on its first save (Watchlist, Trade, Analysis), with a
// frozen header row. Returns its sheet id.
async function ensureSheetTab(title, headers) {
  const meta = await getSpreadsheetMetadata();
  const existing = meta.sheets.find((s) => s.properties.title === title);
  if (existing) return existing.properties.sheetId;
  // One creation per tab at a time, so two first saves can't both add it.
  if (!pendingTabCreations.has(title)) {
    const creating = createSheetTab(title, headers).finally(() => pendingTabCreations.delete(title));
    pendingTabCreations.set(title, creating);
  }
  return pendingTabCreations.get(title);
}

const pendingTabCreations = new Map(); // title -> Promise<sheetId>

async function createSheetTab(title, headers) {
  let sheetId;
  try {
    const res = await batchUpdate([{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }]);
    sheetId = res.replies[0].addSheet.properties.sheetId;
  } catch (err) {
    // Another tab or device added it first: use that one.
    const meta = await getSpreadsheetMetadata();
    const existing = meta.sheets.find((s) => s.properties.title === title);
    if (!existing) throw err;
    return existing.properties.sheetId;
  }
  await updateValues(`'${title}'!A1`, [headers], 'RAW');
  return sheetId;
}

// True when the tab exists, so a load can skip reading a tab not made yet.
async function sheetTabExists(title) {
  const meta = await getSpreadsheetMetadata();
  return meta.sheets.some((s) => s.properties.title === title);
}

async function batchUpdate(requests) {
  // Can add, delete or rename tabs, so the shared tab list is dropped before and
  // after: a read made while this was in flight can't keep the old list.
  resetSheetReads();
  try {
    return await sheetsWrite(':batchUpdate', 'POST', { requests });
  } finally {
    resetSheetReads();
  }
}
