const CONTACTS_RANGE = sheetRange(CONFIG.SHEETS.CONTACTS, 'A2:U');
const C_PAGE_SIZE = 25;
// Checkbox | First | Last | Phone | Email | Tags | actions.
const CONTACT_COLUMN_COUNT = 7;

// The sheet's columns A..U, in order; also the form's contact-<id> fields.
const CONTACT_FIELD_IDS = [
  'first', 'middle', 'last', 'prefix', 'tags', 'birthday',
  'phone1', 'phone2', 'phone3', 'email1', 'email2',
  'street', 'city', 'region', 'postal', 'country',
  'website', 'linkedin', 'telegram', 'telegram2', 'note',
];

let allContacts = [];
let contactsListenersAttached = false;
let cSort = { key: 'last', dir: 1 };
let cCurrentPage = 1;
let contactsSheetId = null;
let editingContactRow = null;
let selectedContactRows = new Set();
let editContact = null;

function contactRowRange(row) {
  return sheetRange(CONFIG.SHEETS.CONTACTS, `A${row}:U${row}`);
}

// Fetched on first use; only deletes and merges need it.
async function ensureContactsSheetId() {
  if (contactsSheetId === null) contactsSheetId = findSheetId(await getSpreadsheetMetadata(), CONFIG.SHEETS.CONTACTS);
  return contactsSheetId;
}

function selectedContacts() {
  return allContacts.filter((c) => selectedContactRows.has(c.row));
}

async function initContacts(forceRefresh = false) {
  if (!contactsListenersAttached) {
    contactsListenersAttached = true;

    document.getElementById('add-contact-btn').addEventListener('click', () => openContactForm(null));
    // track/contact/<name>/ opens that contact's Edit.
    editContact = routedRowEdit('contact', () => allContacts, contactDisplayName, openContactForm);
    document.getElementById('contact-cancel-btn').addEventListener('click', closeContactForm);
    onFormSubmit('contact-form', submitContactForm);
    Object.keys(CONTACT_CSV_FORMATS).forEach((format) => {
      document.getElementById(`export-contacts-${format}-btn`).addEventListener('click', () => exportContactsCSV(format, allContacts));
      document.getElementById(`contacts-bulk-export-${format}-btn`).addEventListener('click', () => exportContactsCSV(format, selectedContacts(), '-selected'));
    });

    document.getElementById('contacts-search').addEventListener('input', resetContactsView);
    makeSortableHeaders('#contacts-table', cSort, resetContactsView);
    document.getElementById('contacts-select-all').addEventListener('change', (e) => {
      const pageRows = getFilteredContacts().slice((cCurrentPage - 1) * C_PAGE_SIZE, cCurrentPage * C_PAGE_SIZE);
      pageRows.forEach((c) => (e.target.checked ? selectedContactRows.add(c.row) : selectedContactRows.delete(c.row)));
      renderContactsList();
    });
    onAsyncClick('contacts-bulk-merge-btn', mergeSelectedContacts);
    onAsyncClick('contacts-bulk-delete-btn', bulkDeleteContacts);
  }

  await refreshContacts(forceRefresh);
}

// A new search or sort starts on page 1 with nothing selected.
function resetContactsView() {
  cCurrentPage = 1;
  selectedContactRows.clear();
  renderContactsList();
}

async function refreshContacts(forceRefresh = false) {
  // Dropped so a delete or merge looks the tab up again (the spreadsheet may have changed).
  contactsSheetId = null;
  const resp = await getValues(CONTACTS_RANGE, VALUE_PARAMS);
  const values = resp.values || [];

  allContacts = values
    .map((row, i) => ({
      row: i + 2,
      // Birthday was USER_ENTERED before, so it may read in a display format.
      ...Object.fromEntries(CONTACT_FIELD_IDS.map((id, col) => [id, id === 'birthday' ? sheetDateIso(row[col]) : cellText(row[col])])),
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
  const compare = (a, b, field) => String(a[field] || '').localeCompare(String(b[field] || ''), undefined, { sensitivity: 'base' });
  return [...filtered].sort((a, b) => (compare(a, b, key) || compare(a, b, 'first')) * dir);
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
      ? 'No contacts yet — click "Add" in the panel heading to get started.'
      : 'No contacts match your search.';
    tbody.appendChild(renderEmptyRow(CONTACT_COLUMN_COUNT, message));
  }

  // Privacy mode: names and email fully masked, phones digit-masked so their shape stays.
  const text = (s) => (privacyMode ? maskText(s) : s);
  const digits = (s) => (privacyMode ? maskDigits(s) : s);

  pageItems.forEach((c) => {
    const tr = document.createElement('tr');

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
      makeCell(text(c.first), text(fullName)),
      makeCell(text(c.last)),
      makeCell(digits(c.phone1), digits(allPhones)),
      makeCell(text(c.email1), text(allEmails)),
      makeCell(c.tags),
    );

    const actionsCell = document.createElement('td');
    actionsCell.append(
      makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editContact(c) }),
      makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteContact(c) }),
    );
    tr.appendChild(actionsCell);
    tbody.appendChild(tr);
  });

  updateContactsSelectAllCheckbox(pageItems);
  updateContactsBulkActionsUI();
  renderPager('contacts-pagination', {
    page: cCurrentPage,
    totalPages,
    onChange: (p) => {
      cCurrentPage = p;
      selectedContactRows.clear();
      renderContactsList();
    },
  });
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

function openContactForm(contact) {
  editingContactRow = contact ? contact.row : null;

  CONTACT_FIELD_IDS.forEach((id) => {
    document.getElementById(`contact-${id}`).value = contact ? (contact[id] || '') : '';
  });

  clearFieldError('contact-form-error');
  document.getElementById('contact-modal').hidden = false;
}

function closeContactForm() {
  document.getElementById('contact-modal').hidden = true;
}

async function submitContactForm(event) {
  event.preventDefault();

  const val = (id) => document.getElementById(`contact-${id}`).value.trim();
  if (!val('first') && !val('last')) {
    showFieldError('contact-form-error', 'Enter at least a first or last name.');
    return;
  }

  const rowData = CONTACT_FIELD_IDS.map(val);

  try {
    let row = editingContactRow;
    if (row !== null) {
      // RAW: nothing here needs parsing, and phone numbers must keep their digits.
      await updateValues(contactRowRange(row), [rowData], 'RAW');
    } else {
      row = appendedRow(await appendValues(CONTACTS_RANGE, [rowData], 'RAW'));
    }
    await refreshContacts(true);
    const saved = allContacts.find((c) => c.row === row);
    if (saved) {
      openContactForm(saved);
      stayOnSavedForm('contact-modal', editContact.step(saved));
    }
    showFormSaved('contact-form-error');
  } catch (err) {
    showFieldError('contact-form-error', err.message);
  }
}

function contactDisplayName(c) {
  return [c.first, c.last].filter(Boolean).join(' ') || '(unnamed)';
}

// Deletes the given sheet rows bottom-up, so each request's indices still hold
// when the API reaches it.
async function deleteContactRows(sheetId, rows) {
  await batchUpdate([...rows].sort((a, b) => b - a).map((row) => sheetRowDeleteRequest(sheetId, row)));
}

async function deleteContact(contact) {
  await confirmAndDelete(`Delete ${contactDisplayName(contact)}?`, async () => {
    await deleteContactRows(await ensureContactsSheetId(), [contact.row]);
    await refreshContacts(true);
  }, "Couldn't delete contact");
}

async function bulkDeleteContacts() {
  const selected = selectedContacts();
  if (selected.length === 0) return;

  await confirmAndDelete(
    `Delete ${selected.length} selected contact(s)?\n\n${selected.map(contactDisplayName).join(', ')}`,
    async () => {
      await deleteContactRows(await ensureContactsSheetId(), selected.map((c) => c.row));
      selectedContactRows.clear();
      await refreshContacts(true);
    },
    "Couldn't delete contacts",
  );
}

// First non-blank values, without repeats, at most `cap`.
function dedupeCap(values, cap, isSame) {
  const out = [];
  values.filter(Boolean).forEach((v) => {
    if (!out.some((o) => isSame(o, v))) out.push(v);
  });
  return out.slice(0, cap);
}

function phoneDigits(s) {
  const d = cellText(s).replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-10) : '';
}

const sameText = (a, b) => cellText(a).toLowerCase() === cellText(b).toLowerCase();

// List fields merged across contacts into their numbered slots.
const CONTACT_MERGE_LISTS = [
  { fields: ['phone1', 'phone2', 'phone3'], isSame: (a, b) => phoneDigits(a) === phoneDigits(b) },
  { fields: ['email1', 'email2'], isSame: sameText },
  { fields: ['telegram', 'telegram2'], isSame: sameText },
];

// Keeps primary's own values, filling only its blanks and merging list fields,
// the same rule as scripts/merge_contacts.py.
function mergeContactFields(primary, others) {
  const merged = { ...primary };
  const all = [primary, ...others];

  ['prefix', 'middle', 'birthday', 'street', 'city', 'region', 'postal', 'country'].forEach((field) => {
    if (!merged[field]) {
      const fromOther = others.find((c) => c[field]);
      if (fromOther) merged[field] = fromOther[field];
    }
  });

  CONTACT_MERGE_LISTS.forEach(({ fields, isSame }) => {
    const values = dedupeCap(all.flatMap((c) => fields.map((f) => c[f])), fields.length, isSame);
    fields.forEach((f, i) => { merged[f] = values[i] || ''; });
  });

  ['website', 'linkedin'].forEach((field) => {
    if (!merged[field]) merged[field] = (others.find((c) => c[field]) || {})[field] || '';
  });

  const parts = (field, separator) => all.flatMap((c) => (c[field] || '').split(separator).map((s) => s.trim()).filter(Boolean));
  merged.tags = dedupeCap(parts('tags', ','), Infinity, sameText).join(', ');
  merged.note = dedupeCap(parts('note', '\n'), Infinity, (a, b) => a === b).join('\n');

  return merged;
}

function contactToRowArray(c) {
  return CONTACT_FIELD_IDS.map((id) => c[id] || '');
}

async function mergeSelectedContacts() {
  const selected = selectedContacts().sort((a, b) => a.row - b.row);
  if (selected.length < 2) return;

  const primary = selected[0];
  const others = selected.slice(1);
  const merged = mergeContactFields(primary, others);
  const primaryName = contactDisplayName(primary);

  await confirmAndDelete(
    `Merge ${selected.length} contacts into "${primaryName}"?\n\n` +
    `${others.map(contactDisplayName).join(', ')} will be combined into "${primaryName}" ` +
    `and their rows deleted. Fields already filled on "${primaryName}" are kept as-is; ` +
    `blanks are filled in from the others. This cannot be undone.`,
    async () => {
      const sheetId = await ensureContactsSheetId();
      await updateValues(contactRowRange(primary.row), [contactToRowArray(merged)], 'RAW');
      await deleteContactRows(sheetId, others.map((c) => c.row));
      selectedContactRows.clear();
      await refreshContacts(true);
    },
    "Couldn't merge contacts",
  );
}

function downloadCSV(filename, headerRow, rows) {
  const csv = [headerRow, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  downloadTextFile(filename, csv, 'text/csv;charset=utf-8;');
}

const CONTACT_CSV_FORMATS = {
  // Google's import reads this reduced header set. Telegram 2 has no slot, so it
  // rides along as a 4th Website.
  google: {
    header: [
      'First Name', 'Middle Name', 'Last Name', 'Name Prefix', 'Birthday', 'Notes',
      'Phone 1 - Label', 'Phone 1 - Value', 'Phone 2 - Label', 'Phone 2 - Value', 'Phone 3 - Label', 'Phone 3 - Value',
      'E-mail 1 - Label', 'E-mail 1 - Value', 'E-mail 2 - Label', 'E-mail 2 - Value',
      'Address 1 - Label', 'Address 1 - Street', 'Address 1 - City', 'Address 1 - Region',
      'Address 1 - Postal Code', 'Address 1 - Country',
      'Website 1 - Label', 'Website 1 - Value', 'Website 2 - Label', 'Website 2 - Value',
      'Website 3 - Label', 'Website 3 - Value', 'Website 4 - Label', 'Website 4 - Value', 'Labels',
    ],
    row: (c) => [
      c.first, c.middle, c.last, c.prefix, c.birthday, c.note,
      c.phone1 ? 'Other' : '', c.phone1, c.phone2 ? 'Other' : '', c.phone2, c.phone3 ? 'Other' : '', c.phone3,
      c.email1 ? 'Other' : '', c.email1, c.email2 ? 'Other' : '', c.email2,
      'Home', c.street, c.city, c.region, c.postal, c.country,
      c.website ? 'Website' : '', c.website, c.linkedin ? 'LinkedIn' : '', c.linkedin,
      c.telegram ? 'Telegram' : '', c.telegram, c.telegram2 ? 'Telegram' : '', c.telegram2, c.tags,
    ],
  },
  // Outlook's standard template; it has no LinkedIn or Telegram column.
  outlook: {
    header: [
      'Title', 'First Name', 'Middle Name', 'Last Name',
      'Mobile Phone', 'Home Phone', 'Business Phone', 'E-mail Address', 'E-mail 2 Address',
      'Birthday', 'Business Street', 'Business City', 'Business State',
      'Business Postal Code', 'Business Country/Region', 'Web Page', 'Categories', 'Notes',
    ],
    row: (c) => [
      c.prefix, c.first, c.middle, c.last,
      c.phone1, c.phone2, c.phone3, c.email1, c.email2,
      c.birthday, c.street, c.city, c.region, c.postal, c.country, c.website, c.tags, c.note,
    ],
  },
};

function exportContactsCSV(format, contacts, label = '') {
  if (contacts.length === 0) {
    alert('No contacts to export.');
    return;
  }
  const { header, row } = CONTACT_CSV_FORMATS[format];
  downloadCSV(`contacts-${format}${label}-${todayStamp()}.csv`, header, contacts.map(row));
}
