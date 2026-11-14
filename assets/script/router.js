// Addresses <wrapper>/<block>/<button>/ (health/physique/log/), from index.html's
// data-route slugs; each is a real stub page (scripts/build_routes.py), so a reload
// lands on the same block or form. A block or view (data-route-view) rewrites the
// address; a form adds a history step, so Back closes it.
//
// A row's Edit is <wrapper>/<block>/<record>/[<view>/]: no stub, so 404.html loads
// the section page and the block's registerRecordRoute opens the row.
// Forms can stack; history.state.depth counts the ones open at each step.

const routerRoot = new URL('.', document.baseURI).href;
let pendingFormRoute = null; // { panel, steps } from a routed click, claimed by the modal it opens
const routedForms = [];      // [{ modal, panel, steps }] for the open routed forms, innermost last
let initialFormRoute = null; // { panel, button } or { panel, record, sub } waiting for the first data load
const recordRoutes = new Map(); // block slug -> [open(recordSlug, subSlug)]: the row's label, or null if none
let formHandoff = false;     // a form closed to hand its history entry to the next one

// Fills a direct load's breadcrumb until the sheet supplies the real name.
const PENDING_LABEL = '…';
const ISO_DATE_SLUG = /^\d{4}-\d{2}-\d{2}$/;

// A step below the block: { slug, label }. An emoji button (➕) is named by its aria-label.
function buttonStep(button) {
  return { slug: button.dataset.route, label: button.getAttribute('aria-label') || button.textContent.trim() };
}

// A view button (data-route-view) rewrites the address instead of opening a form.
function isRouteView(button) {
  return 'routeView' in button.dataset;
}

// A row's steps: the row, then its view (…/<row>/duplicate/) when `sub` is given.
function recordSteps(slug, label, sub = null) {
  const steps = [{ slug, label }];
  if (sub) steps.push({ slug: sub, label: subStepLabel(sub) });
  return steps;
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

// Routes a block's row Edits as <block>/<row label>/ (repeats get -2, -3… in sheet
// order), `subs` one level down. Returns the click handler (row, subSlug = null).
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
    routeRecordEdit(blockSlug, ...recordSteps(slugs().get(row), label(row), sub));
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
  return at === panel && button && isRouteView(button) ? button : null;
}

// "bulk-edit" -> "Bulk Edit".
function subStepLabel(slug) {
  return slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// A form left open after its save moves to the saved row in place (an Add becomes
// that row's Edit), with no history step.
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
  const steps = recordSteps(slug, slug, sub);
  pendingFormRoute = { panel, steps };
  // The modal observer runs later, so the step can still be filled in: `open` gives
  // the row's label, or a { slug, label } for an alias (physique's "today").
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

// push: a new form entry; handoff: the closing form's entry becomes this form's.
function setRoute(panel = null, steps = [], { push = false, handoff = false } = {}) {
  document.title = routeTitle(panel, steps);
  const url = routeUrl(panel, steps);
  const formState = { ledgerForm: true, depth: routedForms.length + 1 };
  if (push) history.pushState(formState, '', url);
  else if (handoff) history.replaceState(formState, '', url);
  else if (url !== location.href) history.replaceState(null, '', url);
}

// A page (block or view) entry: Back returns to the page before it.
function pushPageEntry(url) {
  history.pushState({ ledgerPage: true }, '', url);
}

function routedSection() {
  return document.getElementById(routedSectionId(null));
}

function routedPanel(slug) {
  return document.querySelector(`#${routedSectionId(null)} .panel[data-route="${slug}"]`);
}

// Only one block is open at a time (setupPanelToggles, app.js).
function currentRoutedPanel() {
  return document.querySelector(`#${routedSectionId(null)} .panel[data-route]:not(.collapsed)`);
}

// The route a click lands on: a block's heading or one of its routed buttons.
function routeHit(element) {
  const button = element.closest('#dashboard .panel[data-route] button[data-route]');
  if (button) return { panel: button.closest('.panel[data-route]'), button };
  const heading = element.closest('#dashboard .panel[data-route] h2');
  const panel = heading?.closest('.panel[data-route]');
  return panel && panel.querySelector('h2') === heading ? { panel, button: null } : null;
}

// --- Hub and pages (section pages only; see page-nav.js) ----------------------
// <html data-page="hub"> shows the glance cards and tiles, "block" one block alone;
// which follows the address. `view`: the view being shown, when known before its
// button runs (Back/Forward).
function showSectionPage(panel, view) {
  if (!window.ledgerSectionPage) return;
  const section = routedSection();
  const motion = Motion.capturePage(panel, section, view);
  document.documentElement.dataset.page = panel ? 'block' : 'hub';
  document.querySelectorAll(`#${routedSectionId(null)} > .panel[data-route]`).forEach((p) => {
    const active = p === panel;
    p.classList.toggle('page-active', active);
    const heading = p.querySelector('h2');
    if (heading) setPanelCollapsed(p, heading, !active);
  });
  updatePageNav(panel);
  Motion.playPage(panel, section, motion);
  runPageShow(panel);
}

// A block's on-open work (Market's price fetch), run when its page shows, not on load.
const pageShows = new Map(); // block slug -> fn(panel)

function registerPageShow(blockSlug, show) {
  pageShows.set(blockSlug, show);
}

function runPageShow(panel) {
  if (panel && dashboardDataLoaded) pageShows.get(panel.dataset.route)?.(panel);
}

// A tile, sidebar link or breadcrumb: one history step, no reload.
function navigateSectionPage(panel) {
  pushPageEntry(routeUrl(panel));
  Motion.prepareNavigation(panel, routedSection());
  resetRouteViews();
  showSectionPage(panel);
  document.title = routeTitle(panel);
  window.scrollTo(0, 0);
}

// A routed form is a page too: html[data-form-page] puts the innermost one in the
// page's place under its breadcrumb (updateFormCrumb). Other dialogs stay overlays;
// leaving returns to the page's scroll.
let formPageReturnScroll = 0;

function updateFormPage() {
  if (!window.ledgerSectionPage) return;
  const root = document.documentElement;
  const top = routedForms.at(-1);
  const current = document.querySelector('.modal.form-page');
  if (current && current !== top?.modal) current.classList.remove('form-page');
  // Stacked forms: only the top one is the page; the ones under it stay hidden.
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

// A directly loaded form address shows this placeholder page while the data loads,
// never the block's page first. The real form replaces it (updateFormPage); if it
// can't open, the block's page shows instead.
function pendingFormPage() {
  let page = document.getElementById('form-pending');
  if (!page) {
    page = document.createElement('div');
    page.id = 'form-pending';
    page.className = 'modal form-page-pending';
    page.hidden = true;
    document.body.insertBefore(page, document.querySelector('body > .modal'));
  }
  return page;
}

// Empty; its breadcrumb shows only when every name is known from the address (a
// date, Log), never a guessed sheet name.
function showPendingFormPage(panel, steps) {
  if (!window.ledgerSectionPage) return;
  const page = pendingFormPage();
  page.hidden = false;
  page.classList.add('form-page');
  document.documentElement.dataset.formPage = '1';
  const crumb = document.getElementById('form-crumb');
  if (!crumb) return;
  page.insertBefore(crumb, page.firstChild);
  const known = steps.every((step) => step.label !== PENDING_LABEL);
  page.style.visibility = known ? '' : 'hidden';
  if (known) updateFormCrumb(panel, steps);
}

function clearPendingFormPage() {
  const page = document.getElementById('form-pending');
  if (!page || page.hidden) return false;
  page.hidden = true;
  page.style.visibility = '';
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

// Signed out: the address keeps this page, named from the address, until the
// sign-in's data load opens the form (routerDataLoaded).
function holdPendingFormPage() {
  if (!initialFormRoute) return;
  const { panel, button, record, sub } = initialFormRoute;
  const steps = record ? recordSteps(record, record, sub) : [buttonStep(button)];
  if (sub && !record) steps.push({ slug: sub, label: sub });
  showPendingFormPage(panel, steps);
}

// A breadcrumb level between the block and the form (a row's date over its 🧬 view):
// back to that row's form if open underneath, else close all and open it.
function openFormStep(panel, step) {
  if (routedForms.length > 1) {
    routedForms.at(-1).modal.hidden = true;
    return;
  }
  closeFormPages(panel, () => openRecordRoute(panel, step.slug));
}

// Closes every form page in one history step back, then shows `panel`'s page (hub for null).
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
    // A form that closed to open this one hands over its history entry.
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
  // Any other slug under a block is one of its rows, optionally with a view below it;
  // under a form's button, one of that form's own pages (registerFormSubView).
  const record = panel && buttonSlug && !button ? decodeURIComponent(buttonSlug) : null;
  const sub = (record || button) && subSlug ? decodeURIComponent(subSlug) : null;
  return { panel, button, record, sub };
}

// A form's own pages (…/activity/workouts/push-day/): `show(slug)` shows one, or the
// top level for null, rewriting the address in place like a view.
const formSubViews = new Map(); // button slug -> { show(subSlug | null), label(subSlug) }
// The sub page a direct load asked for, taken by the form as it opens (takeInitialFormSub).
let initialFormSub = null;

function registerFormSubView(buttonSlug, show, label) {
  formSubViews.set(buttonSlug, { show, label });
}

function takeInitialFormSub(buttonSlug) {
  if (!initialFormSub || initialFormSub.button !== buttonSlug) return null;
  const { sub } = initialFormSub;
  initialFormSub = null;
  return sub;
}

// A form's steps with one of its own pages under it.
function formSubSteps(button, subSlug, label) {
  return [{ ...buttonStep(button), view: true }, { slug: subSlug, label }];
}

// Called by the form once it shows a page of its own (or its top level, for null).
function setFormSubView(subSlug, label) {
  const top = routedForms.at(-1);
  if (!top) return;
  const base = { slug: top.steps[0].slug, label: top.steps[0].label };
  const wasSub = top.steps[1]?.slug ?? null;
  top.steps = subSlug ? [{ ...base, view: true }, { slug: subSlug, label }] : [base];
  // Into a group is down, back to the list up (not while the form itself opens).
  const card = top.modal.querySelector('.modal-card');
  if (wasSub !== subSlug && card && !card.getAnimations().length) {
    Motion.moveIn(card, !wasSub ? 'down' : !subSlug ? 'up' : 'sideways');
  }
  // Keeps the entry's own state (the form's depth), so Back still closes the form.
  history.replaceState(history.state, '', routeUrl(top.panel, top.steps));
  document.title = routeTitle(top.panel, top.steps);
  updateFormCrumb(top.panel, top.steps);
}

// Called once loadDashboard (app.js) has finished: forms need their data first.
let dashboardDataLoaded = false;

function routerDataLoaded() {
  dashboardDataLoaded = true;
  if (window.ledgerSectionPage && document.documentElement.dataset.page === 'block') runPageShow(currentRoutedPanel());
  if (!initialFormRoute) return;
  const { panel, button, record, sub } = initialFormRoute;
  initialFormRoute = null;
  if (record) {
    openRecordRoute(panel, record, sub).then(() => {
      if (!routedForms.length && !pendingFormRoute) abandonPendingFormPage();
    });
  } else {
    // A form page's own page in the address (…/workouts/push-day/): the form opens straight
    // onto it, and claims the entry the address is already on.
    const view = sub && formSubViews.get(button.dataset.route);
    if (view) initialFormSub = { button: button.dataset.route, sub };
    openRoutedForm(panel, button);
    if (view && pendingFormRoute) pendingFormRoute.steps = formSubSteps(button, sub, view.label(sub) ?? sub);
    initialFormSub = null;
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
    if (hit?.button && isRouteView(hit.button)) {
      pendingFormRoute = null;
      // Its own page over the block's: Back returns to the block.
      const steps = [buttonStep(hit.button)];
      if (location.href !== routeUrl(hit.panel, steps)) pushPageEntry(routeUrl(hit.panel, steps));
      // The view's page grows out of its tile once its click has drawn it.
      Motion.arm();
      const section = routedSection();
      Motion.playPage(hit.panel, section, Motion.capturePage(hit.panel, section, hit.button));
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
    Motion.arm();
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
    const view = button && isRouteView(button) ? button : null;
    showSectionPage(panel, view);
    document.title = routeTitle(panel);
    // A view's page reopens its view (the click retitles); the block's resets it.
    if (view) view.click();
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
    initialFormRoute = { panel, button, sub };
    if (isRouteView(button)) {
      // The view's page now, not the block's tiles until the data loads.
      panel.dataset.insightMode = button.dataset.route;
      const steps = [buttonStep(button)];
      pushPageEntry(routeUrl(panel, steps));
      document.title = routeTitle(panel, steps);
    } else {
      // The address stays on a form's own page (…/workouts/push-day/) while it loads.
      const steps = sub ? formSubSteps(button, sub, PENDING_LABEL) : [buttonStep(button)];
      setRoute(panel, steps, { push: true });
      showPendingFormPage(panel, steps);
    }
  } else if (record) {
    // The form's entry now, claimed when it opens. Until the rows load the address
    // has only the slug ("broccoli"), so the name waits as "…"; a date reads the same.
    const steps = recordSteps(record, ISO_DATE_SLUG.test(record) ? record : PENDING_LABEL, sub);
    setRoute(panel, steps, { push: true });
    initialFormRoute = { panel, record, sub };
    showPendingFormPage(panel, steps);
  }
  window.scrollTo(0, 0);
}
