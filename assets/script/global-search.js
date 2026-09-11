// One header search box that searches every panel that already has its own
// search input, by driving that input directly rather than reimplementing
// each panel's own filter logic. Scoped to the panels that already carry a
// `-search` box (Transactions, Physique, Nutrition, Contacts, Travel,
// Applications, Breakdown) — Accounts, Settings and Activity have no
// existing filter to reuse and are out of scope for this pass.
const GLOBAL_SEARCH_TARGETS = [
  { label: 'Transactions', searchInputId: 'tx-search', bodyId: 'transactions-body' },
  { label: 'Physique', searchInputId: 'physique-search', bodyId: 'physique-body' },
  { label: 'Nutrition', searchInputId: 'nutrition-search', bodyId: 'nutrition-body' },
  { label: 'Contacts', searchInputId: 'contacts-search', bodyId: 'contacts-body' },
  { label: 'Travel', searchInputId: 'travel-search', bodyId: 'travel-body' },
  { label: 'Applications', searchInputId: 'applications-search', bodyId: 'applications-list' },
  { label: 'Breakdown', searchInputId: 'breakdown-search', bodyId: 'breakdown-body' },
];

// Setting `.value` and dispatching a real `input` event is what lets this reuse
// each panel's own existing listener — filtering, pagination reset and
// re-render all already happen there, so none of it is duplicated here.
function runGlobalSearch(query) {
  const status = document.getElementById('global-search-status');
  if (!query) {
    status.hidden = true;
    return;
  }

  const results = GLOBAL_SEARCH_TARGETS.map((target) => {
    const input = document.getElementById(target.searchInputId);
    const body = document.getElementById(target.bodyId);
    if (!input || !body) return { ...target, count: 0 };

    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // A "no matches"/"nothing yet" placeholder (renderEmptyRow, app.js, or
    // applications.js's own div equivalent) is one child element too — every
    // panel's empty state carries this same class, so it's what tells a real
    // match apart from zero of them.
    const count = body.querySelector('.empty-state') ? 0 : body.children.length;
    return { ...target, count };
  });

  const matches = results.filter((r) => r.count > 0);
  status.hidden = false;
  status.textContent = matches.length
    ? matches.map((r) => `${r.count} in ${r.label}`).join(' · ')
    : 'No matches';

  // Jumps to the first match in target-list priority order, expanding its
  // panel first if the panel-collapse default (setupPanelToggles, app.js)
  // left it shut — otherwise scrolling to it would land on a hidden table.
  const first = matches[0];
  if (!first) return;
  const panel = document.getElementById(first.searchInputId).closest('.panel');
  if (!panel) return;
  if (panel.classList.contains('collapsed')) panel.querySelector('h2')?.click();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initGlobalSearch() {
  const input = document.getElementById('global-search');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runGlobalSearch(input.value.trim());
  });
}
