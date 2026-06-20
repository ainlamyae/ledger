const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const VALUE_PARAMS = { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' };

async function sheetsRequest(path, options = {}) {
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

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Sheets API error ${res.status}`);
  }

  return res.json();
}

function getSpreadsheetMetadata() {
  return sheetsRequest('?fields=sheets.properties');
}

function getValues(range, params = {}) {
  const query = new URLSearchParams(params).toString();
  const suffix = query ? `?${query}` : '';
  return sheetsRequest(`/values/${encodeURIComponent(range)}${suffix}`);
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

function updateValues(range, values, valueInputOption = 'USER_ENTERED') {
  return sheetsRequest(
    `/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`,
    { method: 'PUT', body: JSON.stringify({ values }) }
  );
}

function clearValues(range) {
  return sheetsRequest(`/values/${encodeURIComponent(range)}:clear`, { method: 'POST' });
}

function batchUpdate(requests) {
  return sheetsRequest(':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
}
