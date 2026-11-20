// Shared table + form helpers for the entity modules; per-entity logic stays in each module.

// A sheet's ID by tab title; a missing tab throws, listing the tabs there are.
function findSheetId(metadata, title) {
  const sheet = metadata.sheets.find((s) => s.properties.title === title);
  if (!sheet) {
    const available = metadata.sheets.map((s) => s.properties.title).join(', ');
    throw new Error(`Sheet tab "${title}" not found. Available tabs: ${available}`);
  }
  return sheet.properties.sheetId;
}

// The confirm gate and failure alert every delete shares; `deleteFn` does the work.
async function confirmAndDelete(message, deleteFn, errorPrefix = 'Failed to delete') {
  if (!confirm(message)) return;
  try {
    await deleteFn();
  } catch (err) {
    alert(`${errorPrefix}: ${err.message}`);
  }
}

// Every form/panel message is a toast now; red unless it's progress ("…").
function showFieldError(elId, message) {
  clearFieldError(elId);
  showToast(message, !message.endsWith('…'));
}

// A save never closes its form: "Saved" is a toast and the old status line goes.
function showFormSaved(elId) {
  clearFieldError(elId);
  showToast('Saved');
}

function clearFieldError(elId) {
  document.getElementById(elId).hidden = true;
}

// Marks a button busy while `run` goes, so a slow save isn't clicked twice; null
// button allowed. Emoji buttons bounce, word buttons get "…". aria-busy, not
// `disabled` (some buttons drive that from the selection); data-busy blocks keyboard submits.
async function withButtonBusy(btn, run) {
  if (!btn) return run();
  if (btn.dataset.busy) return undefined;

  const isIcon = btn.classList.contains('btn-icon') || btn.classList.contains('row-action-btn');
  const label = btn.textContent;
  btn.dataset.busy = '1';
  btn.setAttribute('aria-busy', 'true');
  if (isIcon) Motion.iconBusy(btn);
  else btn.textContent = `${label}…`;
  try {
    return await run();
  } finally {
    delete btn.dataset.busy;
    btn.removeAttribute('aria-busy');
    if (isIcon) Motion.iconSettle(btn);
    else btn.textContent = label;
  }
}

// Click wiring for an async action, with the same busy treatment.
function onAsyncClick(buttonId, handler) {
  const btn = document.getElementById(buttonId);
  btn.addEventListener('click', () => withButtonBusy(btn, handler));
}

// Async submit handler; `submitter` marks the button actually pressed busy.
function onFormSubmit(formId, handler) {
  const form = document.getElementById(formId);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const btn = event.submitter || form.querySelector('button[type="submit"]');
    return withButtonBusy(btn, () => handler(event));
  });
  // "Saved" (showFormSaved) goes as soon as the form is changed again.
  form.addEventListener('input', () => {
    form.querySelector('.status.status-ok')?.setAttribute('hidden', '');
  });
}

// Standard unit symbols for USDA's upper-case ones ("G" -> "g", "UG" or "ΜG" -> "µg").
const STANDARD_UNITS = { g: 'g', mg: 'mg', ug: 'µg', 'µg': 'µg', 'μg': 'µg', mcg: 'µg', kcal: 'kcal', kj: 'kJ', iu: 'IU', mg_ate: 'mg α-TE' };

function standardUnit(unit) {
  const raw = String(unit ?? '').trim();
  return STANDARD_UNITS[raw.toLowerCase()] || raw;
}

// An emoji row/pager button on the default surface (emoji read badly on colour).
// A handler that returns a promise (every delete) gets the busy treatment.
function makeRowActionButton({ emoji, title, onClick, onLongPress, readOnly = false }) {
  const btn = document.createElement('button');
  // row-action-btn is how setupAuthGatedActions (app.js) knows it edits the sheet.
  btn.className = 'btn row-action-btn';
  // Never touches the sheet (e.g. an outside link): the sign-in gate skips it.
  if (readOnly) btn.dataset.noAuth = '1';
  btn.textContent = emoji;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  const run = (handler, event) => {
    const result = handler(event);
    if (result && typeof result.then === 'function') return withButtonBusy(btn, () => result);
    return result;
  };
  btn.addEventListener('click', (event) => run(onClick, event));
  if (onLongPress) attachLongPress(btn, (event) => run(onLongPress, event));
  return btn;
}

const LONG_PRESS_MS = 600;
const LONG_PRESS_VIBRATE_MS = 15;

// Held LONG_PRESS_MS: the release runs onLongPress instead of the click, caught on
// window ahead of the auth gate. Moving off the button cancels it.
function attachLongPress(btn, onLongPress) {
  let timer = null;
  let swallow = null;
  const disarm = () => {
    clearTimeout(timer);
    timer = null;
    if (swallow) window.removeEventListener('click', swallow, true);
    swallow = null;
  };
  btn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    disarm();
    timer = setTimeout(() => {
      swallow = (e) => {
        if (!btn.contains(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        disarm();
        onLongPress(e);
      };
      window.addEventListener('click', swallow, true);
      navigator.vibrate?.(LONG_PRESS_VIBRATE_MS);
    }, LONG_PRESS_MS);
  });
  btn.addEventListener('pointerup', () => { clearTimeout(timer); timer = null; });
  // A touch leaves on release too, before its click: only a leave mid-press cancels.
  btn.addEventListener('pointerleave', () => { if (timer !== null) disarm(); });
  btn.addEventListener('pointercancel', disarm);
  // A touch hold would otherwise open the browser's own menu.
  btn.addEventListener('contextmenu', (event) => event.preventDefault());
}

// A link from data, kept only if http(s)/mailto/tel; else ''.
function safeHref(url) {
  const text = String(url ?? '').trim();
  return /^(https?|mailto|tel):/i.test(text) ? text : '';
}

// Display only: "2026-11-21" -> "26-11-21", "2026-11" -> "26-11".
function shortYearDate(text) {
  return String(text ?? '').replace(/^20(\d{2}-)/, '$1');
}

// A <td> with text and an optional title (e.g. for a truncated value).
function makeCell(text, title) {
  const td = document.createElement('td');
  td.textContent = text;
  if (title) td.title = title;
  return td;
}

// Sets the ▲/▼ on every `th.sortable` in a table to match the sort state.
function updateSortIndicators(tableSelector, sortState) {
  document.querySelectorAll(`${tableSelector} th.sortable`).forEach((th) => {
    const indicator = th.querySelector('.sort-indicator');
    if (!indicator) return;
    indicator.textContent = th.dataset.sort === sortState.key ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
  });
}

// Click/Enter/Space sorting on every `th.sortable` by its `data-sort` key; the
// active header flips direction. Mutates the caller's { key, dir }, then calls onSortChange.
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

// A prev/"n of m"/next pager, or nothing for one page; onChange(newPage) re-renders.
function renderPager(containerId, { page, totalPages, onChange }) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const pageButton = (emoji, title, toPage, disabled) => {
    const btn = makeRowActionButton({ emoji, title, onClick: () => onChange(toPage) });
    btn.disabled = disabled;
    return btn;
  };
  const info = document.createElement('span');
  info.textContent = `${page} of ${totalPages}`;

  container.append(
    pageButton('⬅️', 'Previous page', page - 1, page === 1),
    info,
    pageButton('➡️', 'Next page', page + 1, page === totalPages),
  );
}
