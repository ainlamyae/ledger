// Hierarchical addresses: <wrapper>/<block>/<button>/, e.g. health/physique/log/.
// Each one is a real page (a stub written by scripts/build_routes.py), so a
// reload or a shared link lands on the same block or form. The slugs are the
// data-route attributes in index.html.
//
// Expanding/collapsing a block only rewrites the address; opening a form adds
// one history step, so Back closes it. A view button (data-route-view, e.g.
// Insight's modes) rewrites the address like a block does.
//
// A row's Edit gets its own address too, <wrapper>/<block>/<record>/ (e.g.
// health/physique/2026-10-04/), and a row's view one more level down
// (…/2026-10-04/micronutrients/). No stub exists for these: 404.html loads the
// section page, and the block's registerRecordRoute opens the row.
//
// Forms can stack (a view opened from inside a form); each one is a history
// step, and history.state.depth says how many are open at that step.

const routerRoot = new URL('.', document.baseURI).href;
let pendingFormRoute = null; // { panel, steps } from a routed click, claimed by the modal it opens
const routedForms = [];      // [{ modal, panel, steps }] for the open routed forms, innermost last
let initialFormRoute = null; // { panel, button } or { panel, record, sub } waiting for the first data load
const recordRoutes = new Map(); // block slug -> open(recordSlug, subSlug): the row's label, or null if none

// A step below the block: { slug, label }, from a routed button or a row.
function buttonStep(button) {
  return { slug: button.dataset.route, label: button.textContent.trim() };
}

// Lowercase words joined by hyphens: "Chicken Breast" -> "chicken-breast".
function routeSlug(text) {
  return String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function registerRecordRoute(blockSlug, open) {
  recordRoutes.set(blockSlug, open);
}

// Called by a row's Edit (or view) just before it opens its form.
function routeRecordEdit(blockSlug, ...steps) {
  if (!window.ledgerSectionPage || !steps[0]?.slug) return;
  const panel = routedPanel(blockSlug);
  if (panel) pendingFormRoute = { panel, steps };
}

// Behind sign-in, as a click on the row's own Edit would be (setupAuthGatedActions).
async function openRecordRoute(panel, slug, sub = null) {
  const open = recordRoutes.get(panel.dataset.route);
  if (!open || !(await ensureAccessToken())) return;
  const steps = [{ slug, label: slug }];
  if (sub) steps.push({ slug: sub, label: sub.charAt(0).toUpperCase() + sub.slice(1) });
  pendingFormRoute = { panel, steps };
  // The modal observer runs after this, so the step can still be filled in. `open`
  // returns the row's label, or a { slug, label } step when the row's own address
  // differs from the one asked for (an alias such as physique's "today").
  const opened = open(slug, sub);
  if (opened && typeof opened === 'object') Object.assign(steps[0], opened);
  else if (opened) steps[0].label = opened;
  else pendingFormRoute = null;
}

function routedSectionId(panel) {
  return panel ? panel.closest('.panel-group').id : window.ledgerSectionPage.section;
}

function routeUrl(panel = null, steps = []) {
  const wrapper = document
    .querySelector(`#main-nav a[data-section="${routedSectionId(panel)}"]`)
    .getAttribute('href');
  const parts = [panel?.dataset.route, ...steps.map((step) => step.slug)]
    .filter(Boolean).map((slug) => `${slug}/`).join('');
  return `${routerRoot}${wrapper}${parts}`;
}

function routedHeadingText(panel) {
  return [...panel.querySelector('h2').childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join('')
    .trim();
}

// "Health — Physique — Log — Ledger": the same trail as the address.
function routeTitle(panel = null, steps = []) {
  const wrapper = document.querySelector(`#${routedSectionId(panel)} .panel-group-title`);
  return [wrapper?.textContent.trim(), panel && routedHeadingText(panel), ...steps.map((step) => step.label), 'Ledger']
    .filter(Boolean)
    .join(' — ');
}

function setRoute(panel = null, steps = [], { push = false } = {}) {
  document.title = routeTitle(panel, steps);
  const url = routeUrl(panel, steps);
  if (push) history.pushState({ ledgerForm: true, depth: routedForms.length + 1 }, '', url);
  else if (url !== location.href) history.replaceState(null, '', url);
}

function routedPanel(slug) {
  return document.querySelector(`#${routedSectionId(null)} .panel[data-route="${slug}"]`);
}

// Only one block is open at a time (setupPanelToggles, app.js).
function currentRoutedPanel() {
  return document.querySelector(`#${routedSectionId(null)} .panel[data-route]:not(.collapsed)`);
}

// The route a click lands on: a block's heading or one of its routed buttons.
function routeHit(target) {
  const button = target.closest('#dashboard .panel[data-route] button[data-route]');
  if (button) return { panel: button.closest('.panel[data-route]'), button };
  const heading = target.closest('#dashboard .panel[data-route] h2');
  const panel = heading?.closest('.panel[data-route]');
  return panel && panel.querySelector('h2') === heading ? { panel, button: null } : null;
}

// Called by setupPanelToggles (app.js) on a user expand/collapse.
function routerPanelToggled(panel) {
  if (!window.ledgerSectionPage || !panel.dataset.route) return;
  if (!routedForms.length) setRoute(currentRoutedPanel());
}

function routerModalChanged(modal) {
  if (!modal.hidden) {
    if (!pendingFormRoute || routedForms.some((f) => f.modal === modal)) return;
    const { panel, steps } = pendingFormRoute;
    pendingFormRoute = null;
    // Forward into an existing form entry reuses it instead of pushing again.
    const sameEntry = history.state?.depth === routedForms.length + 1 && location.href === routeUrl(panel, steps);
    if (sameEntry) document.title = routeTitle(panel, steps);
    else setRoute(panel, steps, { push: true });
    routedForms.push({ modal, panel, steps });
    return;
  }
  const at = routedForms.findIndex((f) => f.modal === modal);
  if (at === -1) return;
  const closed = routedForms.length - at;
  routedForms.splice(at);
  // Step back over the closed forms' entries; popstate then retitles.
  if ((history.state?.depth || 0) >= closed) history.go(-closed);
  else {
    const top = routedForms.at(-1);
    if (top) setRoute(top.panel, top.steps);
    else setRoute(currentRoutedPanel());
  }
}

function openRoutedForm(panel, button) {
  if (button.disabled) return;
  pendingFormRoute = { panel, steps: [buttonStep(button)] };
  button.click();
}

function routeFromLocation() {
  const [, blockSlug, buttonSlug, subSlug] = location.href.slice(routerRoot.length).split(/[?#]/)[0].split('/');
  const panel = blockSlug ? routedPanel(blockSlug) : null;
  const button = panel && buttonSlug ? panel.querySelector(`button[data-route="${buttonSlug}"]`) : null;
  // Any other slug under a block is one of its rows, optionally with a view below it.
  const record = panel && buttonSlug && !button ? decodeURIComponent(buttonSlug) : null;
  const sub = record && subSlug ? decodeURIComponent(subSlug) : null;
  return { panel, button, record, sub };
}

// Called once loadDashboard (app.js) has finished: forms need their data first.
function routerDataLoaded() {
  if (!initialFormRoute) return;
  const { panel, button, record, sub } = initialFormRoute;
  initialFormRoute = null;
  if (record) openRecordRoute(panel, record, sub);
  else openRoutedForm(panel, button);
}

function initRouter() {
  // Capture on window: runs before the auth gate (document) and the heading's own toggle.
  window.addEventListener('click', (event) => {
    const hit = routeHit(event.target);
    if (!window.ledgerSectionPage) {
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      location.href = routeUrl(hit.panel, hit.button ? [buttonStep(hit.button)] : []);
      return;
    }
    if (hit?.button && 'routeView' in hit.button.dataset) {
      pendingFormRoute = null;
      setRoute(hit.panel, [buttonStep(hit.button)]);
      return;
    }
    pendingFormRoute = hit?.button ? { panel: hit.panel, steps: [buttonStep(hit.button)] } : null;
  }, true);

  if (!window.ledgerSectionPage) {
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const hit = routeHit(event.target);
      if (!hit || hit.button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      location.href = routeUrl(hit.panel);
    }, true);
    return;
  }

  document.querySelectorAll('.modal').forEach((modal) => {
    new MutationObserver(() => routerModalChanged(modal))
      .observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  });

  window.addEventListener('popstate', () => {
    const depth = history.state?.depth || 0;
    // Back: close the forms above this step, innermost first.
    while (routedForms.length > depth) {
      const { modal } = routedForms.pop();
      modal.hidden = true;
    }
    // Forward into a form step: open it again.
    if (depth > routedForms.length) {
      const { panel, button, record, sub } = routeFromLocation();
      if (button) openRoutedForm(panel, button);
      else if (record) openRecordRoute(panel, record, sub);
      return;
    }
    const top = routedForms.at(-1);
    document.title = top ? routeTitle(top.panel, top.steps) : routeTitle(routeFromLocation().panel);
  });

  const { panel, button, record, sub } = routeFromLocation();
  if (!panel) {
    setRoute();
    return;
  }
  setPanelCollapsed(panel, panel.querySelector('h2'), false);
  // Block entry underneath, so Back from the form lands on the block.
  setRoute(panel);
  if (button) {
    // A view needs no history step of its own; a form gets one underneath it.
    setRoute(panel, [buttonStep(button)], { push: !('routeView' in button.dataset) });
    initialFormRoute = { panel, button };
  } else if (record) {
    // Pushed when its form opens, once the rows have loaded.
    initialFormRoute = { panel, record, sub };
  }
  panel.scrollIntoView({ block: 'start' });
}
