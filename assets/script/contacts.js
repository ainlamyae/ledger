const CONTACTS_RANGE = `'${CONFIG.SHEETS.CONTACTS}'!A2:U`;
const C_PAGE_SIZE = 25;

let allContacts = [];
let contactsListenersAttached = false;
let cSort = { key: 'last', dir: 1 };
let cCurrentPage = 1;
let contactsSheetId = null;
let editingContactRow = null;
let selectedContactRows = new Set();

async function fetchContactsSheetId() {
  const { sheets } = await getSpreadsheetMetadata();
  const sheet = sheets.find((s) => s.properties.title === CONFIG.SHEETS.CONTACTS);
  if (!sheet) throw new Error(`Sheet "${CONFIG.SHEETS.CONTACTS}" not found`);
  return sheet.properties.sheetId;
}

async function initContacts(forceRefresh = false) {
  if (!contactsListenersAttached) {
    contactsListenersAttached = true;

    document.getElementById('add-contact-btn').addEventListener('click', () => openContactForm(null));
    document.getElementById('contact-cancel-btn').addEventListener('click', closeContactForm);
    document.getElementById('contact-form').addEventListener('submit', submitContactForm);
    document.getElementById('export-contacts-google-btn').addEventListener('click', () => exportContactsGoogleCSV(allContacts));
    document.getElementById('export-contacts-outlook-btn').addEventListener('click', () => exportContactsOutlookCSV(allContacts));

    document.getElementById('contacts-search').addEventListener('input', () => {
      cCurrentPage = 1;
      selectedContactRows.clear();
      renderContactsList();
    });

    setupContactsSorting();
    setupContactsBulkActions();
  }

  await refreshContacts(forceRefresh);
}

function setupContactsBulkActions() {
  document.getElementById('contacts-select-all').addEventListener('change', (e) => {
    const pageRows = getFilteredContacts().slice((cCurrentPage - 1) * C_PAGE_SIZE, cCurrentPage * C_PAGE_SIZE);
    pageRows.forEach((c) => (e.target.checked ? selectedContactRows.add(c.row) : selectedContactRows.delete(c.row)));
    renderContactsList();
  });

  document.getElementById('contacts-bulk-export-google-btn').addEventListener('click', () => {
    exportContactsGoogleCSV(allContacts.filter((c) => selectedContactRows.has(c.row)), '-selected');
  });
  document.getElementById('contacts-bulk-export-outlook-btn').addEventListener('click', () => {
    exportContactsOutlookCSV(allContacts.filter((c) => selectedContactRows.has(c.row)), '-selected');
  });
  document.getElementById('contacts-bulk-merge-btn').addEventListener('click', mergeSelectedContacts);
  document.getElementById('contacts-bulk-delete-btn').addEventListener('click', bulkDeleteContacts);
}

function setupContactsSorting() {
  document.querySelectorAll('#contacts-table th.sortable').forEach((th) => {
    const label = document.createElement('span');
    label.textContent = th.textContent;
    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';
    th.textContent = '';
    th.append(label, indicator);
    th.setAttribute('tabindex', '0');

    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (cSort.key === key) {
        cSort.dir *= -1;
      } else {
        cSort.key = key;
        cSort.dir = 1;
      }
      updateContactsSortIndicators();
      cCurrentPage = 1;
      selectedContactRows.clear();
      renderContactsList();
    });
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
    });
  });
  updateContactsSortIndicators();
}

function updateContactsSortIndicators() {
  document.querySelectorAll('#contacts-table th.sortable').forEach((th) => {
    const indicator = th.querySelector('.sort-indicator');
    if (!indicator) return;
    indicator.textContent = th.dataset.sort === cSort.key ? (cSort.dir === 1 ? ' ▲' : ' ▼') : '';
  });
}

async function refreshContacts(forceRefresh = false) {
  let values = forceRefresh ? null : getCached('contacts');
  if (!values) {
    const resp = await getValues(CONTACTS_RANGE, VALUE_PARAMS);
    values = resp.values || [];
    setCached('contacts', values);
  }

  allContacts = values
    .map((row, i) => ({
      row: i + 2,
      first: row[0] || '',
      middle: row[1] || '',
      last: row[2] || '',
      prefix: row[3] || '',
      tags: row[4] || '',
      birthday: row[5] || '',
      phone1: row[6] || '',
      phone2: row[7] || '',
      phone3: row[8] || '',
      email1: row[9] || '',
      email2: row[10] || '',
      street: row[11] || '',
      city: row[12] || '',
      region: row[13] || '',
      postal: row[14] || '',
      country: row[15] || '',
      website: row[16] || '',
      linkedin: row[17] || '',
      telegram: row[18] || '',
      telegram2: row[19] || '',
      note: row[20] || '',
    }))
    .filter((c) => c.first || c.last);

  renderContactsList();
}

function getFilteredContacts() {
  const search = document.getElementById('contacts-search').value.trim().toLowerCase();

  const filtered = allContacts.filter((c) => {
    if (!search) return true;
    return [
      c.first, c.middle, c.last, c.tags,
      c.phone1, c.phone2, c.phone3, c.email1, c.email2,
      c.city, c.region, c.linkedin, c.telegram, c.telegram2, c.note,
    ].some((field) => field.toLowerCase().includes(search));
  });

  const { key, dir } = cSort;
  return [...filtered].sort((a, b) => {
    const cmp = String(a[key] || '').localeCompare(String(b[key] || ''), undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp * dir;
    return String(a.first || '').localeCompare(String(b.first || ''), undefined, { sensitivity: 'base' }) * dir;
  });
}

function renderContactsList() {
  const tbody = document.getElementById('contacts-body');
  tbody.innerHTML = '';

  const filtered = getFilteredContacts();
  const totalPages = Math.max(1, Math.ceil(filtered.length / C_PAGE_SIZE));
  cCurrentPage = Math.min(cCurrentPage, totalPages);

  const start = (cCurrentPage - 1) * C_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + C_PAGE_SIZE);

  if (pageItems.length === 0) {
    const message = allContacts.length === 0
      ? 'No contacts yet — click "+ Add Contact" to get started.'
      : 'No contacts match your search.';
    tbody.appendChild(renderEmptyRow(7, message));
  }

  pageItems.forEach((c) => {
    const tr = document.createElement('tr');

    const makeCell = (text, title) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (title) td.title = title;
      return td;
    };

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedContactRows.has(c.row);
    checkbox.setAttribute('aria-label', 'Select contact');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedContactRows.add(c.row);
      else selectedContactRows.delete(c.row);
      updateContactsSelectAllCheckbox(pageItems);
      updateContactsBulkActionsUI();
    });
    checkboxCell.appendChild(checkbox);

    const fullName = [c.prefix, c.first, c.middle, c.last].filter(Boolean).join(' ');
    const allPhones = [c.phone1, c.phone2, c.phone3].filter(Boolean).join(', ');
    const allEmails = [c.email1, c.email2].filter(Boolean).join(', ');

    tr.append(
      checkboxCell,
      makeCell(c.first, fullName),
      makeCell(c.last),
      makeCell(c.phone1, allPhones),
      makeCell(c.email1, allEmails),
      makeCell(c.tags),
    );

    const actionsCell = document.createElement('td');

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.addEventListener('click', () => openContactForm(c));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.addEventListener('click', () => deleteContact(c));

    actionsCell.append(editBtn, deleteBtn);
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  updateContactsSelectAllCheckbox(pageItems);
  updateContactsBulkActionsUI();
  renderContactsPagination(totalPages);
}

function updateContactsSelectAllCheckbox(pageItems) {
  const selectAll = document.getElementById('contacts-select-all');
  const selectedOnPage = pageItems.filter((c) => selectedContactRows.has(c.row)).length;
  selectAll.checked = pageItems.length > 0 && selectedOnPage === pageItems.length;
  selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageItems.length;
}

function updateContactsBulkActionsUI() {
  const bar = document.getElementById('contacts-bulk-actions');
  const count = selectedContactRows.size;
  bar.hidden = count === 0;
  document.getElementById('contacts-bulk-summary').textContent = count > 0 ? `${count} selected` : '';
  document.getElementById('contacts-bulk-merge-btn').disabled = count < 2;
}

function renderContactsPagination(totalPages) {
  const container = document.getElementById('contacts-pagination');
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const prev = document.createElement('button');
  prev.className = 'btn';
  prev.textContent = '⬅️';
  prev.title = 'Previous page';
  prev.setAttribute('aria-label', 'Previous page');
  prev.disabled = cCurrentPage === 1;
  prev.addEventListener('click', () => { cCurrentPage--; selectedContactRows.clear(); renderContactsList(); });

  const info = document.createElement('span');
  info.textContent = `${cCurrentPage} of ${totalPages}`;

  const next = document.createElement('button');
  next.className = 'btn';
  next.textContent = '➡️';
  next.title = 'Next page';
  next.setAttribute('aria-label', 'Next page');
  next.disabled = cCurrentPage === totalPages;
  next.addEventListener('click', () => { cCurrentPage++; selectedContactRows.clear(); renderContactsList(); });

  container.append(prev, info, next);
}

const CONTACT_FIELD_IDS = [
  'first', 'middle', 'last', 'prefix', 'tags', 'birthday',
  'phone1', 'phone2', 'phone3', 'email1', 'email2',
  'street', 'city', 'region', 'postal', 'country',
  'website', 'linkedin', 'telegram', 'telegram2', 'note',
];

function openContactForm(contact) {
  editingContactRow = contact ? contact.row : null;

  document.getElementById('contact-modal-title').textContent = contact ? 'Edit Contact' : 'Add Contact';

  CONTACT_FIELD_IDS.forEach((id) => {
    document.getElementById(`contact-${id}`).value = contact ? (contact[id] || '') : '';
  });

  document.getElementById('contact-form-error').hidden = true;
  document.getElementById('contact-modal').hidden = false;
}

function closeContactForm() {
  document.getElementById('contact-modal').hidden = true;
}

async function submitContactForm(event) {
  event.preventDefault();

  const val = (id) => document.getElementById(`contact-${id}`).value.trim();
  const first = val('first');
  const last = val('last');
  const errorEl = document.getElementById('contact-form-error');

  if (!first && !last) {
    errorEl.textContent = 'Enter at least a first or last name.';
    errorEl.hidden = false;
    return;
  }

  const rowData = CONTACT_FIELD_IDS.map(val);

  try {
    if (editingContactRow !== null) {
      await updateValues(`'${CONFIG.SHEETS.CONTACTS}'!A${editingContactRow}:U${editingContactRow}`, [rowData]);
    } else {
      await appendValues(CONTACTS_RANGE, [rowData]);
    }
    await refreshContacts(true);
    closeContactForm();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

function contactDisplayName(c) {
  return [c.first, c.last].filter(Boolean).join(' ') || '(unnamed)';
}

async function deleteContact(contact) {
  if (!confirm(`Delete ${contactDisplayName(contact)}?`)) return;

  try {
    if (!contactsSheetId) contactsSheetId = await fetchContactsSheetId();
    await batchUpdate([{
      deleteDimension: {
        range: {
          sheetId: contactsSheetId,
          dimension: 'ROWS',
          startIndex: contact.row - 1,
          endIndex: contact.row,
        },
      },
    }]);
    await refreshContacts(true);
  } catch (err) {
    alert(`Couldn't delete contact: ${err.message}`);
  }
}

async function bulkDeleteContacts() {
  const selected = allContacts.filter((c) => selectedContactRows.has(c.row));
  if (selected.length === 0) return;
  if (!confirm(`Delete ${selected.length} selected contact(s)?\n\n${selected.map(contactDisplayName).join(', ')}`)) return;

  try {
    if (!contactsSheetId) contactsSheetId = await fetchContactsSheetId();
    // Descending by row so each request's startIndex/endIndex is still valid
    // by the time the API processes the next one in the same batchUpdate call.
    const requests = [...selected]
      .sort((a, b) => b.row - a.row)
      .map((c) => ({
        deleteDimension: {
          range: { sheetId: contactsSheetId, dimension: 'ROWS', startIndex: c.row - 1, endIndex: c.row },
        },
      }));
    await batchUpdate(requests);
    selectedContactRows.clear();
    await refreshContacts(true);
  } catch (err) {
    alert(`Couldn't delete contacts: ${err.message}`);
  }
}

// Merges values from multiple contact list-type fields into one, deduplicating
// so re-merging an already-shared phone/email/URL doesn't create a repeat.
function dedupeCap(values, cap, isSame) {
  const out = [];
  values.filter(Boolean).forEach((v) => {
    if (!out.some((o) => isSame(o, v))) out.push(v);
  });
  return out.slice(0, cap);
}

function phoneDigits(s) {
  const d = (s || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-10) : '';
}

const sameText = (a, b) => a.toLowerCase() === b.toLowerCase();

// Combines `target` with `others`, keeping target's own first/last name and
// never overwriting a field target already has a value for -- only filling
// blanks and merging list fields (phones/emails/etc.), same rule the
// scripts/merge_contacts.py source-merge uses.
function mergeContactFields(target, others) {
  const merged = { ...target };

  ['prefix', 'middle', 'birthday', 'street', 'city', 'region', 'postal', 'country'].forEach((field) => {
    if (!merged[field]) {
      const fromOther = others.find((c) => c[field]);
      if (fromOther) merged[field] = fromOther[field];
    }
  });

  const phones = dedupeCap(
    [target.phone1, target.phone2, target.phone3, ...others.flatMap((c) => [c.phone1, c.phone2, c.phone3])],
    3, (a, b) => phoneDigits(a) === phoneDigits(b),
  );
  [merged.phone1, merged.phone2, merged.phone3] = [phones[0] || '', phones[1] || '', phones[2] || ''];

  const emails = dedupeCap(
    [target.email1, target.email2, ...others.flatMap((c) => [c.email1, c.email2])],
    2, sameText,
  );
  [merged.email1, merged.email2] = [emails[0] || '', emails[1] || ''];

  const telegrams = dedupeCap(
    [target.telegram, target.telegram2, ...others.flatMap((c) => [c.telegram, c.telegram2])],
    2, sameText,
  );
  [merged.telegram, merged.telegram2] = [telegrams[0] || '', telegrams[1] || ''];

  if (!merged.website) merged.website = (others.find((c) => c.website) || {}).website || '';
  if (!merged.linkedin) merged.linkedin = (others.find((c) => c.linkedin) || {}).linkedin || '';

  const tags = [];
  [target, ...others].forEach((c) => {
    (c.tags || '').split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => {
      if (!tags.some((existing) => sameText(existing, t))) tags.push(t);
    });
  });
  merged.tags = tags.join(', ');

  const notes = [];
  [target, ...others].forEach((c) => {
    (c.note || '').split('\n').map((n) => n.trim()).filter(Boolean).forEach((n) => {
      if (!notes.includes(n)) notes.push(n);
    });
  });
  merged.note = notes.join('\n');

  return merged;
}

function contactToRowArray(c) {
  return CONTACT_FIELD_IDS.map((id) => c[id] || '');
}

async function mergeSelectedContacts() {
  const selected = allContacts.filter((c) => selectedContactRows.has(c.row)).sort((a, b) => a.row - b.row);
  if (selected.length < 2) return;

  const target = selected[0];
  const others = selected.slice(1);

  if (!confirm(
    `Merge ${selected.length} contacts into "${contactDisplayName(target)}"?\n\n` +
    `${others.map(contactDisplayName).join(', ')} will be combined into "${contactDisplayName(target)}" ` +
    `and their rows deleted. Fields already filled on "${contactDisplayName(target)}" are kept as-is; ` +
    `blanks are filled in from the others. This cannot be undone.`
  )) return;

  const merged = mergeContactFields(target, others);

  try {
    if (!contactsSheetId) contactsSheetId = await fetchContactsSheetId();

    await updateValues(`'${CONFIG.SHEETS.CONTACTS}'!A${target.row}:U${target.row}`, [contactToRowArray(merged)]);

    const deleteRequests = others
      .map((c) => c.row)
      .sort((a, b) => b - a)
      .map((row) => ({
        deleteDimension: {
          range: { sheetId: contactsSheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
        },
      }));
    await batchUpdate(deleteRequests);

    selectedContactRows.clear();
    await refreshContacts(true);
  } catch (err) {
    alert(`Couldn't merge contacts: ${err.message}`);
  }
}

function downloadCSV(filename, headerRow, rows) {
  const csv = [headerRow, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

// Google Contacts' CSV import accepts a reduced header set (it doesn't require
// every column their own export produces) -- this fills the fields it does read.
// Telegram 2 has no dedicated slot in Google's format, so it rides along as a
// 4th Website entry.
function exportContactsGoogleCSV(contacts, label = '') {
  if (contacts.length === 0) {
    alert('No contacts to export.');
    return;
  }

  const header = [
    'First Name', 'Middle Name', 'Last Name', 'Name Prefix', 'Birthday', 'Notes',
    'Phone 1 - Label', 'Phone 1 - Value', 'Phone 2 - Label', 'Phone 2 - Value', 'Phone 3 - Label', 'Phone 3 - Value',
    'E-mail 1 - Label', 'E-mail 1 - Value', 'E-mail 2 - Label', 'E-mail 2 - Value',
    'Address 1 - Label', 'Address 1 - Street', 'Address 1 - City', 'Address 1 - Region',
    'Address 1 - Postal Code', 'Address 1 - Country',
    'Website 1 - Label', 'Website 1 - Value', 'Website 2 - Label', 'Website 2 - Value',
    'Website 3 - Label', 'Website 3 - Value', 'Website 4 - Label', 'Website 4 - Value', 'Labels',
  ];

  const rows = contacts.map((c) => [
    c.first, c.middle, c.last, c.prefix, c.birthday, c.note,
    c.phone1 ? 'Other' : '', c.phone1, c.phone2 ? 'Other' : '', c.phone2, c.phone3 ? 'Other' : '', c.phone3,
    c.email1 ? 'Other' : '', c.email1, c.email2 ? 'Other' : '', c.email2,
    'Home', c.street, c.city, c.region, c.postal, c.country,
    c.website ? 'Website' : '', c.website, c.linkedin ? 'LinkedIn' : '', c.linkedin,
    c.telegram ? 'Telegram' : '', c.telegram, c.telegram2 ? 'Telegram' : '', c.telegram2, c.tags,
  ]);

  downloadCSV(`contacts-google${label}-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
}

// Standard Outlook CSV import template. LinkedIn/Telegram have no matching
// column in Outlook's format, so they're intentionally left out of this export.
function exportContactsOutlookCSV(contacts, label = '') {
  if (contacts.length === 0) {
    alert('No contacts to export.');
    return;
  }

  const header = [
    'Title', 'First Name', 'Middle Name', 'Last Name',
    'Mobile Phone', 'Home Phone', 'Business Phone', 'E-mail Address', 'E-mail 2 Address',
    'Birthday', 'Business Street', 'Business City', 'Business State',
    'Business Postal Code', 'Business Country/Region', 'Web Page', 'Categories', 'Notes',
  ];

  const rows = contacts.map((c) => [
    c.prefix, c.first, c.middle, c.last,
    c.phone1, c.phone2, c.phone3, c.email1, c.email2,
    c.birthday, c.street, c.city, c.region, c.postal, c.country, c.website, c.tags, c.note,
  ]);

  downloadCSV(`contacts-outlook${label}-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
}
