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
const recordRoutes = new Map(); // block slug -> [open(recordSlug, subSlug)]: the row's label, or null if none
let formHandoff = false;     // a form closed to hand its history entry to the next one

// A step below the block: { slug, label }, from a routed button or a row.
// An emoji button (➕) is named by its aria-label.
function buttonStep(button) {
  return { slug: button.dataset.route, label: button.getAttribute('aria-label') || button.textContent.trim() };
}

// Lowercase words joined by hyphens: "Chicken Breast" -> "chicken-breast".
function routeSlug(text) {
  return String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Several per block; the first to open something wins.
function registerRecordRoute(blockSlug, open) {
  recordRoutes.set(blockSlug, [...(recordRoutes.get(blockSlug) || []), open]);
}

// Routes a block's row Edits: <block>/<row label>/, a repeated label getting -2,
// -3… in sheet order, and `subs` one level down (…/<row>/duplicate/). `rows()` is
// read fresh; returns the click handler, (row, subSlug = null).
function routedRowEdit(blockSlug, rows, label, open, subs = {}) {
  let cache = { list: null, slugs: null };
  const slugs = () => {
    const list = rows();
    if (cache.list !== list) {
      const seen = new Map();
      cache = { list, slugs: new Map() };
      list.forEach((row) => {
        const base = routeSlug(label(row)) || 'row';
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        cache.slugs.set(row, n > 1 ? `${base}-${n}` : base);
      });
    }
    return cache.slugs;
  };
  registerRecordRoute(blockSlug, (slug, sub) => {
    if (sub && !subs[sub]) return null;
    const row = [...slugs()].find(([, s]) => s === slug)?.[0];
    if (!row) return null;
    (sub ? subs[sub] : open)(row);
    return label(row);
  });
  const edit = (row, sub = null) => {
    const steps = [{ slug: slugs().get(row), label: label(row) }];
    if (sub) steps.push({ slug: sub, label: subStepLabel(sub) });
    routeRecordEdit(blockSlug, ...steps);
    (sub ? subs[sub] : open)(row);
  };
  edit.step = (row) => ({ slug: slugs().get(row), label: label(row) });
  return edit;
}

// A block whose views (data-route-view buttons) are pages: how to leave the view.
const viewResets = new Map(); // panel -> reset()

function registerViewReset(panel, reset) {
  viewResets.set(panel, reset);
}

function resetRouteViews() {
  viewResets.forEach((reset) => reset());
}

// The view button the address names, or null.
function currentRouteView(panel) {
  const { panel: at, button } = routeFromLocation();
  return at === panel && button && 'routeView' in button.dataset ? button : null;
}

// "bulk-edit" -> "Bulk Edit".
function subStepLabel(slug) {
  return slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// A form staying open after its save, now on the saved row: its address, title and
// breadcrumb move there in place (an Add becomes that row's Edit), no history step.
function stayOnSavedForm(modalId, step) {
  const form = routedForms.find((f) => f.modal.id === modalId);
  if (!form || !step?.slug) return;
  form.steps = [step];
  history.replaceState(history.state, '', routeUrl(form.panel, form.steps));
  document.title = routeTitle(form.panel, form.steps);
  updateFormCrumb(form.panel, form.steps);
}

// Called by a row's Edit (or view) just before it opens its form.
function routeRecordEdit(blockSlug, ...steps) {
  if (!window.ledgerSectionPage || !steps[0]?.slug) return;
  const panel = routedPanel(blockSlug);
  if (panel) pendingFormRoute = { panel, steps };
}

// Behind sign-in, as a click on the row's own Edit would be (setupAuthGatedActions).
async function openRecordRoute(panel, slug, sub = null) {
  const opens = recordRoutes.get(panel.dataset.route);
  if (!opens || !(await ensureAccessToken())) return;
  const steps = [{ slug, label: slug }];
  if (sub) steps.push({ slug: sub, label: subStepLabel(sub) });
  pendingFormRoute = { panel, steps };
  // The modal observer runs after this, so the step can still be filled in. `open`
  // returns the row's label, or a { slug, label } step when the row's own address
  // differs from the one asked for (an alias such as physique's "today").
  let opened = null;
  for (const open of opens) {
    opened = open(slug, sub);
    if (opened) break;
  }
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

function setRoute(panel = null, steps = [], { push = false, handoff = false } = {}) {
  document.title = routeTitle(panel, steps);
  const url = routeUrl(panel, steps);
  if (push) history.pushState({ ledgerForm: true, depth: routedForms.length + 1 }, '', url);
  else if (handoff) history.replaceState({ ledgerForm: true, depth: routedForms.length + 1 }, '', url);
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

// --- Hub and pages (section pages only; see page-nav.js) ----------------------
//
// <html data-page="hub"> shows the section's glance cards and page tiles;
// data-page="block" shows one block alone, opened, under its breadcrumb. Which
// one is current always follows the address, so a reload, Back or a shared link
// lands on the same view.
function showSectionPage(panel) {
  if (!window.ledgerSectionPage) return;
  document.documentElement.dataset.page = panel ? 'block' : 'hub';
  document.querySelectorAll(`#${routedSectionId(null)} > .panel[data-route]`).forEach((p) => {
    const active = p === panel;
    p.classList.toggle('page-active', active);
    const heading = p.querySelector('h2');
    if (heading) setPanelCollapsed(p, heading, !active);
  });
  updatePageNav(panel);
}

// A tile, sidebar link or breadcrumb: one history step, no reload.
function navigateSectionPage(panel) {
  history.pushState({ ledgerPage: true }, '', routeUrl(panel));
  resetRouteViews();
  showSectionPage(panel);
  document.title = routeTitle(panel);
  window.scrollTo(0, 0);
}

// A routed form (Log, Add, a row's Edit or view) on a section page is a page too:
// html[data-form-page] puts the innermost one in the page's place under a
// breadcrumb (page-nav.js's updateFormCrumb) instead of over it. Other dialogs
// (shortcuts, confirms) stay overlays. Leaving it returns to where the page was.
let formPageReturnScroll = 0;

function updateFormPage() {
  if (!window.ledgerSectionPage) return;
  const root = document.documentElement;
  const top = routedForms.at(-1);
  const current = document.querySelector('.modal.form-page');
  if (current && current !== top?.modal) current.classList.remove('form-page');
  // Stacked forms (a 🧬 view opened from a day's Edit): only the top one is the
  // page; the ones under it are hidden until it closes, never left as overlays.
  document.querySelectorAll('.modal.form-page-under').forEach((m) => m.classList.remove('form-page-under'));
  routedForms.slice(0, -1).forEach((form) => form.modal.classList.add('form-page-under'));
  if (!top) {
    if (root.dataset.formPage) {
      delete root.dataset.formPage;
      window.scrollTo(0, formPageReturnScroll);
    }
    updateActionBar();
    return;
  }
  if (!root.dataset.formPage) formPageReturnScroll = window.scrollY;
  root.dataset.formPage = '1';
  clearPendingFormPage();
  if (current !== top.modal) {
    top.modal.classList.add('form-page');
    // The breadcrumb lives inside the form's wrapper, above its card.
    const crumb = document.getElementById('form-crumb');
    if (crumb) top.modal.insertBefore(crumb, top.modal.firstChild);
    window.scrollTo(0, 0);
  }
  updateFormCrumb(top.panel, top.steps);
  updateActionBar();
}

// A form address loaded directly (a reload of …/2026-10-05/ or …/log/) opens as
// that form page at once — its breadcrumb over a "Loading…" card in the form's
// place — while the data it needs loads, instead of showing the block's page
// first. The real form takes its place when it opens (updateFormPage); if it
// can't (signed out, an unknown row), the block's page is shown instead.
function pendingFormPage() {
  let page = document.getElementById('form-pending');
  if (!page) {
    page = document.createElement('div');
    page.id = 'form-pending';
    page.className = 'modal form-page-pending';
    page.hidden = true;
    const card = document.createElement('div');
    card.className = 'modal-card';
    const note = document.createElement('p');
    note.className = 'status';
    note.textContent = 'Loading…';
    card.appendChild(note);
    page.appendChild(card);
    document.body.insertBefore(page, document.querySelector('body > .modal'));
  }
  return page;
}

function showPendingFormPage(panel, steps) {
  if (!window.ledgerSectionPage) return;
  const page = pendingFormPage();
  page.hidden = false;
  page.classList.add('form-page');
  document.documentElement.dataset.formPage = '1';
  const crumb = document.getElementById('form-crumb');
  if (crumb) page.insertBefore(crumb, page.firstChild);
  updateFormCrumb(panel, steps);
}

function clearPendingFormPage() {
  const page = document.getElementById('form-pending');
  if (!page || page.hidden) return false;
  page.hidden = true;
  page.classList.remove('form-page');
  return true;
}

// The form a direct load was waiting for didn't open: show its block's page, back
// on the block's own history entry.
function abandonPendingFormPage() {
  if (!clearPendingFormPage() || routedForms.length) return;
  delete document.documentElement.dataset.formPage;
  updateActionBar();
  if ((history.state?.depth || 0) > 0) history.back();
}

// A breadcrumb link to a level between the block and the current form (a row's
// date over its 🧬 view). When that row's form is open underneath, closing the
// top one returns to it; otherwise every form closes and the row's own opens.
function openFormStep(panel, step) {
  if (routedForms.length > 1) {
    routedForms.at(-1).modal.hidden = true;
    return;
  }
  closeFormPages(panel, () => openRecordRoute(panel, step.slug));
}

// The breadcrumb's way out: closes every open form page in one history step back,
// then shows `panel`'s page, or the hub for null.
function closeFormPages(panel, then = null) {
  const forms = routedForms.splice(0);
  const steps = Math.min(forms.length, history.state?.depth || 0);
  // Emptied first, so routerModalChanged ignores these closes.
  forms.reverse().forEach((form) => { form.modal.hidden = true; });
  updateFormPage();
  const show = () => {
    if (panel === null) navigateSectionPage(null);
    else showSectionPage(currentRoutedPanel() || panel);
    if (then) then();
  };
  if (steps) {
    window.addEventListener('popstate', show, { once: true });
    history.go(-steps);
  } else {
    setRoute(panel);
    show();
  }
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
    // A form that closed to open this one (seen here first or already let go)
    // hands over its history entry.
    const closing = routedForms.filter((f) => f.modal.hidden);
    const handoff = formHandoff || closing.length > 0;
    formHandoff = false;
    if (closing.length) routedForms.splice(routedForms.indexOf(closing[0]));
    // Forward into an existing form entry reuses it instead of pushing again.
    const sameEntry = history.state?.depth === routedForms.length + 1 && location.href === routeUrl(panel, steps);
    if (sameEntry) document.title = routeTitle(panel, steps);
    else setRoute(panel, steps, handoff ? { handoff: true } : { push: true });
    routedForms.push({ modal, panel, steps });
    updateFormPage();
    return;
  }
  const at = routedForms.findIndex((f) => f.modal === modal);
  if (at === -1) return;
  const closed = routedForms.length - at;
  routedForms.splice(at);
  // The top form closed to open another (pendingFormRoute): that one takes its entry.
  if (pendingFormRoute && closed === 1) {
    formHandoff = true;
    return;
  }
  updateFormPage();
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
  if (record) {
    openRecordRoute(panel, record, sub).then(() => {
      if (!routedForms.length && !pendingFormRoute) abandonPendingFormPage();
    });
  } else {
    openRoutedForm(panel, button);
  }
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
      // A page of its own over the block's: Back returns to the block.
      const steps = [buttonStep(hit.button)];
      if (location.href !== routeUrl(hit.panel, steps)) history.pushState({ ledgerPage: true }, '', routeUrl(hit.panel, steps));
      document.title = routeTitle(hit.panel, steps);
      updatePageNav(hit.panel);
      window.scrollTo(0, 0);
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
    updateFormPage();
    // Forward into a form step: open it again, over its page.
    if (depth > routedForms.length) {
      const { panel, button, record, sub } = routeFromLocation();
      showSectionPage(panel);
      if (button) openRoutedForm(panel, button);
      else if (record) openRecordRoute(panel, record, sub);
      return;
    }
    const top = routedForms.at(-1);
    if (top) {
      document.title = routeTitle(top.panel, top.steps);
      return;
    }
    const { panel, button } = routeFromLocation();
    showSectionPage(panel);
    document.title = routeTitle(panel);
    // A view's page reopens its view (the click retitles); the block's resets it.
    if (button && 'routeView' in button.dataset) button.click();
    else resetRouteViews();
  });

  const { panel, button, record, sub } = routeFromLocation();
  showSectionPage(panel);
  if (!panel) {
    setRoute();
    return;
  }
  // Block entry underneath, so Back from the form lands on the block.
  setRoute(panel);
  if (button) {
    // A view or a form gets a history step over the block's.
    if ('routeView' in button.dataset) {
      history.pushState({ ledgerPage: true }, '', routeUrl(panel, [buttonStep(button)]));
      document.title = routeTitle(panel, [buttonStep(button)]);
    } else {
      setRoute(panel, [buttonStep(button)], { push: true });
    }
    initialFormRoute = { panel, button };
    if (!('routeView' in button.dataset)) showPendingFormPage(panel, [buttonStep(button)]);
  } else if (record) {
    // The form's own entry over the block's, now, so the address stays on the
    // row while its data loads; the form claims this entry when it opens.
    // The address only has the row's lowercase slug ("broccoli"), not its name
    // ("Broccoli"), until the rows load: "…" holds its place in the breadcrumb, so
    // the name isn't shown wrong and then corrected. A date reads the same either way.
    const label = /^\d{4}-\d{2}-\d{2}$/.test(record) ? record : '…';
    const steps = [{ slug: record, label }];
    if (sub) steps.push({ slug: sub, label: subStepLabel(sub) });
    setRoute(panel, steps, { push: true });
    initialFormRoute = { panel, record, sub };
    showPendingFormPage(panel, steps);
  }
  window.scrollTo(0, 0);
}
