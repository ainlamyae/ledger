// Hierarchical addresses: <wrapper>/<block>/<button>/, e.g. health/physique/log/.
// Each one is a real page (a stub written by scripts/build_routes.py), so a
// reload or a shared link lands on the same block or form. The slugs are the
// data-route attributes in index.html.
//
// Expanding/collapsing a block only rewrites the address; opening a form adds
// one history step, so Back closes it.

const routerRoot = new URL('.', document.baseURI).href;
let pendingFormRoute = null; // { panel, button } from a routed click, claimed by the modal it opens
let routedForm = null;       // { modal, panel } while a routed form is open
let initialFormRoute = null; // a button address waiting for the first data load

function routedSectionId(panel) {
  return panel ? panel.closest('.panel-group').id : window.ledgerSectionPage.section;
}

function routeUrl(panel = null, button = null) {
  const wrapper = document
    .querySelector(`#main-nav a[data-section="${routedSectionId(panel)}"]`)
    .getAttribute('href');
  const parts = [panel, button].filter(Boolean).map((el) => `${el.dataset.route}/`).join('');
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
function routeTitle(panel = null, button = null) {
  const wrapper = document.querySelector(`#${routedSectionId(panel)} .panel-group-title`);
  return [wrapper?.textContent.trim(), panel && routedHeadingText(panel), button?.textContent.trim(), 'Ledger']
    .filter(Boolean)
    .join(' — ');
}

function setRoute(panel = null, button = null, { push = false } = {}) {
  document.title = routeTitle(panel, button);
  const url = routeUrl(panel, button);
  if (push) history.pushState({ ledgerForm: true }, '', url);
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
  if (!routedForm) setRoute(currentRoutedPanel());
}

function routerModalChanged(modal) {
  if (!modal.hidden) {
    if (!pendingFormRoute || routedForm) return;
    const { panel, button } = pendingFormRoute;
    pendingFormRoute = null;
    routedForm = { modal, panel };
    // Forward into an existing form entry reuses it instead of pushing again.
    const sameEntry = history.state?.ledgerForm && location.href === routeUrl(panel, button);
    if (sameEntry) document.title = routeTitle(panel, button);
    else setRoute(panel, button, { push: true });
    return;
  }
  if (routedForm?.modal !== modal) return;
  routedForm = null;
  if (history.state?.ledgerForm) history.back();
  else setRoute(currentRoutedPanel());
}

function openRoutedForm(panel, button) {
  if (button.disabled) return;
  pendingFormRoute = { panel, button };
  button.click();
}

function routeFromLocation() {
  const [, blockSlug, buttonSlug] = location.href.slice(routerRoot.length).split(/[?#]/)[0].split('/');
  const panel = blockSlug ? routedPanel(blockSlug) : null;
  const button = panel && buttonSlug ? panel.querySelector(`button[data-route="${buttonSlug}"]`) : null;
  return { panel, button };
}

// Called once loadDashboard (app.js) has finished: forms need their data first.
function routerDataLoaded() {
  if (!initialFormRoute) return;
  const { panel, button } = initialFormRoute;
  initialFormRoute = null;
  openRoutedForm(panel, button);
}

function initRouter() {
  // Capture on window: runs before the auth gate (document) and the heading's own toggle.
  window.addEventListener('click', (event) => {
    const hit = routeHit(event.target);
    if (!window.ledgerSectionPage) {
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      location.href = routeUrl(hit.panel, hit.button);
      return;
    }
    pendingFormRoute = hit?.button ? hit : null;
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
    const { panel, button } = routeFromLocation();
    if (routedForm) {
      const { modal } = routedForm;
      routedForm = null;
      modal.hidden = true;
    } else if (button) {
      openRoutedForm(panel, button);
      return;
    }
    document.title = routeTitle(panel);
  });

  const { panel, button } = routeFromLocation();
  if (!panel) {
    setRoute();
    return;
  }
  setPanelCollapsed(panel, panel.querySelector('h2'), false);
  // Block entry underneath, so Back from the form lands on the block.
  setRoute(panel);
  if (button) {
    setRoute(panel, button, { push: true });
    initialFormRoute = { panel, button };
  }
  panel.scrollIntoView({ block: 'start' });
}
