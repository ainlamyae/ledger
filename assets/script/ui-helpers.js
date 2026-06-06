// Shared DOM/CRUD helpers used by the entity modules (transactions, accounts,
// timesheet, wellness, contacts, travel, applications, settings-panel) — the
// mechanical bits of the "table + modal form" pattern that are genuinely
// identical across those files. Per-entity logic (validation, chart
// rendering, bulk actions, etc.) stays in each module.

// Finds a sheet's ID by tab title in an already-fetched getSpreadsheetMetadata()
// result, throwing a descriptive error (listing the available tabs) if the
// tab doesn't exist — e.g. a renamed/deleted sheet tab, or a typo in config.js.
function findSheetId(metadata, title) {
  const sheet = metadata.sheets.find((s) => s.properties.title === title);
  if (!sheet) {
    const available = metadata.sheets.map((s) => s.properties.title).join(', ');
    throw new Error(`Sheet tab "${title}" not found. Available tabs: ${available}`);
  }
  return sheet.properties.sheetId;
}

// Wraps the confirm-gate + try/catch/alert shape every delete action shares.
// `deleteFn` does the entity-specific work (batchUpdate, refresh, any extra
// success side effect like an undo toast) — this just gates it on the confirm
// dialog and reports a failure consistently.
async function confirmAndDelete(message, deleteFn, errorPrefix = 'Failed to delete') {
  if (!confirm(message)) return;
  try {
    await deleteFn();
  } catch (err) {
    alert(`${errorPrefix}: ${err.message}`);
  }
}

function showFieldError(elId, message) {
  const el = document.getElementById(elId);
  el.textContent = message;
  el.hidden = false;
}

function clearFieldError(elId) {
  document.getElementById(elId).hidden = true;
}

// Builds a small icon-only action button (Edit/Delete/Duplicate/prev-next,
// etc.) with the title/aria-label pair every row action and pager control uses.
function makeRowActionButton({ emoji, title, onClick }) {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = emoji;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', onClick);
  return btn;
}

// A plain <td> with text (and an optional title/tooltip, e.g. for a
// truncated value) — the row-cell shape repeated across every table renderer.
function makeCell(text, title) {
  const td = document.createElement('td');
  td.textContent = text;
  if (title) td.title = title;
  return td;
}

// Refreshes the ▲/▼ indicator on every `th.sortable` in a table to match the
// current sort state.
function updateSortIndicators(tableSelector, sortState) {
  document.querySelectorAll(`${tableSelector} th.sortable`).forEach((th) => {
    const indicator = th.querySelector('.sort-indicator');
    if (!indicator) return;
    indicator.textContent = th.dataset.sort === sortState.key ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
  });
}

// Wires up click/keyboard-toggle sorting for every `th.sortable` in a table:
// clicking a header sorts by its `data-sort` key, clicking the active header
// again flips direction. `sortState` is a mutable { key, dir } object owned by
// the caller; `onSortChange` re-renders (and does any extra reset the caller
// needs, e.g. clearing the current page or a row-selection set).
function makeSortableHeaders(tableSelector, sortState, onSortChange) {
  document.querySelectorAll(`${tableSelector} th.sortable`).forEach((th) => {
    const label = document.createElement('span');
    label.textContent = th.textContent;
    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';
    th.textContent = '';
    th.append(label, indicator);
    th.setAttribute('tabindex', '0');

    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir *= -1;
      } else {
        sortState.key = key;
        sortState.dir = 1;
      }
      updateSortIndicators(tableSelector, sortState);
      onSortChange();
    });
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        th.click();
      }
    });
  });

  updateSortIndicators(tableSelector, sortState);
}

// Renders a prev/info/next pager into `containerId`, or clears it when
// there's only one page. `onChange(newPage)` is responsible for updating the
// caller's own page variable (plus any extra reset, e.g. clearing a
// row-selection set) and re-rendering.
function renderPager(containerId, { page, totalPages, onChange }) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const prev = makeRowActionButton({ emoji: '⬅️', title: 'Previous page', onClick: () => onChange(page - 1) });
  prev.disabled = page === 1;

  const info = document.createElement('span');
  info.textContent = `${page} of ${totalPages}`;

  const next = makeRowActionButton({ emoji: '➡️', title: 'Next page', onClick: () => onChange(page + 1) });
  next.disabled = page === totalPages;

  container.append(prev, info, next);
}
