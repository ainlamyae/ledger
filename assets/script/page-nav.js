// Section pages as a hub and pages instead of a stack of collapsible blocks.
//
// /health/ (and /finance/, /track/, /other/) is the section's hub: its glance cards, then
// one tile per block. /health/physique/ is that block alone, as a page under a
// breadcrumb. Moving between them rewrites the address without reloading
// (router.js owns the history entries), and the blocks themselves are unchanged:
// only one is shown at a time. The home page keeps its overview of every section.
//
// On a wide screen a sidebar lists every section and page; a phone uses the
// bottom tab bar and the hub's tiles instead.

function pageNavSections() {
  return [...document.querySelectorAll('#main-nav a[data-section]')].map((link) => ({
    id: link.dataset.section,
    label: link.textContent.trim(),
    href: link.getAttribute('href'),
    panels: [...document.querySelectorAll(`#${link.dataset.section} > .panel[data-route]`)],
  }));
}

function pageHref(section, panel) {
  return `${section.href}${panel.dataset.route}/`;
}

// Same section: switch in place. Another section is another page load.
function onPageLinkClick(event, sectionId, panel) {
  if (!window.ledgerSectionPage || window.ledgerSectionPage.section !== sectionId) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  navigateSectionPage(panel);
}

// The actions used most, one tap from the section's hub (and from its part of the
// home page), as the last tiles: each stands in for a block's own header button. On the section page
// it clicks that button, so the form opens exactly as it does from the block; from
// the home page it goes to the form's address instead.
const QUICK_ACTIONS = {
  health: [
    { label: 'Today', buttonId: 'today-physique-btn', href: () => `physique/${isoFromDate(new Date())}/` },
    { label: 'GYM', buttonId: 'activity-instruction-btn', href: () => 'activity/gym/' },
  ],
};

function buildQuickActions(section) {
  const actions = QUICK_ACTIONS[section.id];
  const grid = document.querySelector(`#${section.id} > .card > .page-tiles`);
  if (!actions || !grid) return;
  // Last in the tile row, after the page tiles, styled as the one action among them.
  actions.forEach((action) => {
    const source = document.getElementById(action.buttonId);
    const tile = document.createElement('a');
    tile.className = 'page-tile quick-tile';
    if (source?.title) tile.title = source.title;
    tile.href = `${section.href}${action.href()}`;
    const title = document.createElement('span');
    title.className = 'page-tile-title';
    title.textContent = action.label;
    tile.appendChild(title);
    tile.addEventListener('click', (event) => {
      if (window.ledgerSectionPage?.section !== section.id || !source) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      source.click();
    });
    grid.appendChild(tile);
  });
}

function buildPageTiles(section) {
  const group = document.getElementById(section.id);
  const grid = document.createElement('nav');
  grid.className = 'page-tiles';
  grid.setAttribute('aria-label', `${section.label} pages`);
  section.panels.forEach((panel) => {
    const tile = document.createElement('a');
    tile.className = 'page-tile';
    tile.href = pageHref(section, panel);
    tile.dataset.section = section.id;
    tile.dataset.route = panel.dataset.route;
    const title = document.createElement('span');
    title.className = 'page-tile-title';
    title.textContent = routedHeadingText(panel);
    tile.appendChild(title);
    tile.addEventListener('click', (event) => onPageLinkClick(event, section.id, panel));
    grid.appendChild(tile);
  });
  // A section's tiles sit in one card titled with its name, on the home page and
  // on the section's own hub alike.
  const card = document.createElement('div');
  card.className = 'card';
  const heading = document.createElement('h3');
  heading.textContent = section.label;
  card.append(heading, grid);
  group.insertBefore(card, section.panels[0] || null);
  renderPageBadges();
}

// --- Badges: a block's short sign ("A<T $13", "28d", "Log") ------------------------
// Shown on its tile's corner and after its page's breadcrumb. `badge` is { text,
// title, record? }, or null to clear; with `record` it opens that row (today's day).
const pageBadges = new Map(); // "<section id>/<block slug>" -> badge

function setPageBadge(sectionId, route, badge) {
  if (badge) pageBadges.set(`${sectionId}/${route}`, badge);
  else pageBadges.delete(`${sectionId}/${route}`);
  renderPageBadges();
}

function placeBadge(parent, sectionId, route) {
  parent.querySelector(':scope > .page-badge')?.remove();
  const badge = pageBadges.get(`${sectionId}/${route}`);
  if (!badge) return;
  const el = document.createElement('span');
  el.className = 'page-badge';
  el.textContent = badge.text;
  el.title = badge.title;
  if (badge.record) {
    el.classList.add('page-badge-action');
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBadgeRecord(sectionId, route, badge.record);
    });
  }
  parent.appendChild(el);
}

// Today's day as a page: in place on its own section's pages, else by its address.
function openBadgeRecord(sectionId, route, record) {
  const panel = document.querySelector(`#${sectionId} > .panel[data-route="${route}"]`);
  if (window.ledgerSectionPage?.section === sectionId) openRecordRoute(panel, record);
  else location.href = routeUrl(panel, [{ slug: record }]);
}

function renderPageBadges() {
  document.querySelectorAll('.page-tile[data-route]').forEach((tile) => {
    placeBadge(tile, tile.dataset.section, tile.dataset.route);
  });
  const sectionId = window.ledgerSectionPage?.section;
  const crumb = sectionId && document.querySelector(`#${sectionId} > .page-crumb`);
  if (!crumb) return;
  const panel = document.documentElement.dataset.page === 'block' ? currentRoutedPanel() : null;
  if (panel) placeBadge(crumb, sectionId, panel.dataset.route);
  else crumb.querySelector(':scope > .page-badge')?.remove();
}

// The full trail from the home page: "Ledger / Health / Physique" over a page,
// each level a link back to itself; "Ledger / Health" on the hub, in place of the
// section's centred title. "Ledger" opens the home page.
function crumbHomeLink() {
  const home = document.createElement('a');
  home.href = routerRoot;
  home.textContent = 'Ledger';
  return home;
}

function crumbSeparator(className = '') {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = '/';
  return span;
}

// The home page's own: "Ledger" alone, as the current level.
function buildHomeCrumb() {
  const crumb = document.createElement('nav');
  crumb.className = 'page-crumb';
  crumb.setAttribute('aria-label', 'Breadcrumb');
  const current = document.createElement('span');
  current.className = 'page-crumb-current';
  current.textContent = 'Ledger';
  crumb.appendChild(current);
  const dashboard = document.getElementById('dashboard');
  dashboard.insertBefore(crumb, dashboard.firstChild);
}

function buildPageCrumb(section) {
  const group = document.getElementById(section.id);
  const crumb = document.createElement('nav');
  crumb.className = 'page-crumb';
  crumb.setAttribute('aria-label', 'Breadcrumb');
  // On the hub the section is the current level, so its link and separator hide.
  const back = document.createElement('a');
  back.className = 'page-crumb-back';
  back.href = section.href;
  back.textContent = section.label;
  back.addEventListener('click', (event) => onPageLinkClick(event, section.id, null));
  // On a view's page (Insight's Plan) the block is a link too, back to its page.
  const block = document.createElement('a');
  block.className = 'page-crumb-block';
  block.hidden = true;
  block.addEventListener('click', (event) => onPageLinkClick(event, section.id, section.panels.find((p) => p.dataset.route === block.dataset.route)));
  const blockSeparator = crumbSeparator('page-crumb-block');
  blockSeparator.hidden = true;
  const current = document.createElement('span');
  current.className = 'page-crumb-current';
  crumb.append(crumbHomeLink(), crumbSeparator(), back, crumbSeparator('page-crumb-back'), block, blockSeparator, current);
  group.insertBefore(crumb, group.firstChild);
}

function buildSideNav(sections) {
  const aside = document.createElement('aside');
  aside.id = 'side-nav';
  aside.className = 'side-nav';
  aside.setAttribute('aria-label', 'Pages');
  sections.forEach((section) => {
    const heading = document.createElement('a');
    heading.className = 'side-nav-section';
    heading.href = section.href;
    heading.dataset.section = section.id;
    heading.textContent = section.label;
    heading.addEventListener('click', (event) => onPageLinkClick(event, section.id, null));
    aside.appendChild(heading);
    section.panels.forEach((panel) => {
      const link = document.createElement('a');
      link.className = 'side-nav-page';
      link.href = pageHref(section, panel);
      link.dataset.section = section.id;
      link.dataset.route = panel.dataset.route;
      link.textContent = routedHeadingText(panel);
      link.addEventListener('click', (event) => onPageLinkClick(event, section.id, panel));
      aside.appendChild(link);
    });
  });
  document.body.appendChild(aside);
  document.body.classList.add('with-side-nav');
}

// Marks the current section and page in the sidebar and fills the breadcrumb.
function updatePageNav(panel) {
  const sectionId = window.ledgerSectionPage?.section ?? null;
  document.querySelectorAll('#side-nav a').forEach((link) => {
    const isSection = link.classList.contains('side-nav-section');
    const current = link.dataset.section === sectionId
      && (isSection ? !panel : panel?.dataset.route === link.dataset.route);
    link.classList.toggle('active', current);
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  updateActionBar();
  if (sectionId) {
    const section = pageNavSections().find((s) => s.id === sectionId);
    const view = panel && currentRouteView(panel);
    document.querySelectorAll(`#${sectionId} > .page-crumb .page-crumb-block`).forEach((el) => { el.hidden = !view; });
    const block = document.querySelector(`#${sectionId} > .page-crumb a.page-crumb-block`);
    if (view) {
      block.textContent = routedHeadingText(panel);
      block.href = pageHref(section, panel);
      block.dataset.route = panel.dataset.route;
    }
    document.querySelector(`#${sectionId} .page-crumb-current`).textContent = view
      ? view.textContent.trim()
      : (panel ? routedHeadingText(panel) : section.label);
  }
  renderPageBadges();
}

// Runs once, before the router reads the address (bootDashboard, app.js).
function initPageNav() {
  initActionBars();
  liftFormActions();
  const sections = pageNavSections();
  buildSideNav(sections);
  // Home: every section's tiles under its glance cards; each opens that page.
  if (!window.ledgerSectionPage) {
    document.documentElement.classList.add('home-hub');
    buildHomeCrumb();
    sections.forEach((s) => {
      buildPageTiles(s);
      buildQuickActions(s);
    });
    return;
  }
  const section = sections.find((s) => s.id === window.ledgerSectionPage.section);
  if (!section) return;
  document.documentElement.classList.add('section-pages');
  section.panels.forEach(groupHeaderActions);
  section.panels.forEach(liftPageActions);
  buildPageTiles(section);
  buildQuickActions(section);
  buildPageCrumb(section);
  buildFormCrumb();
}

// "Ledger / Health / Physique / Log" over a form page: the section goes back to the hub,
// the block back to its page, each closing the form (router.js's closeFormPages).
function buildFormCrumb() {
  const crumb = document.createElement('nav');
  crumb.id = 'form-crumb';
  crumb.className = 'page-crumb form-crumb';
  crumb.setAttribute('aria-label', 'Breadcrumb');
  // Moved into whichever form is the page (router.js's updateFormPage), so it sits
  // inside the same wrapper as the form, like a block page's breadcrumb.
  document.body.appendChild(crumb);
}

function updateFormCrumb(panel, steps) {
  const crumb = document.getElementById('form-crumb');
  const section = pageNavSections().find((s) => s.id === window.ledgerSectionPage?.section);
  if (!crumb || !section) return;
  crumb.textContent = '';
  // Built from the same pieces as the page breadcrumb (buildPageCrumb): "Ledger",
  // "/" separators, links for the levels above, the current level last.
  const separator = () => crumbSeparator();
  const link = (text, href, onClick) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      onClick();
    });
    return a;
  };
  crumb.append(crumbHomeLink(), separator(), link(section.label, section.href, () => closeFormPages(null)));
  if (panel) {
    crumb.append(separator(), link(routedHeadingText(panel), pageHref(section, panel), () => closeFormPages(panel)));
  }
  // Every level above the current one is a link: a row's date over its 🧬 view
  // goes back to that day's page.
  steps.forEach((step, i) => {
    if (i < steps.length - 1 && panel) {
      const href = `${pageHref(section, panel)}${steps.slice(0, i + 1).map((s) => `${s.slug}/`).join('')}`;
      // A form's own top level (GYM above one of its groups) goes back to it in place.
      const onClick = step.view
        ? () => formSubViews.get(step.slug)?.show(null)
        : () => openFormStep(panel, step);
      crumb.append(separator(), link(step.label, href, onClick));
      return;
    }
    const current = document.createElement('span');
    current.className = 'page-crumb-current';
    current.textContent = step.label;
    crumb.append(separator(), current);
  });
}

// --- One bottom bar at a time ---------------------------------------------------
//
// A page's own action row is its bottom bar while it's showing, in place of the
// section tab bar (on a phone; styles.css). Which row, in order: an open form
// page's actions, a block's selection bar while rows are ticked, the block's own
// page actions (Tune's Reset/Update/Save, Insight's Send to AI), then its header
// buttons (Physique's Export CSV / Today / Log). Every one ends in ❌ at the far
// right.
const SELECTION_BAR_IDS = ['physique-bulk-actions', 'nutrition-bulk-actions', 'tx-bulk-actions', 'contacts-bulk-actions'];

// A block's header buttons (Physique's Export CSV / Today / Log, Activity's GYM /
// Log / Add, …) gathered into one group that ends in ❌, so every page has the same
// way out in the same place: top right of the header on a wide screen, the right
// end of the bottom bar on a phone. A block with no buttons (Indicator) gets the
// group with just ❌, and a heading without a .panel-header gets one around it.
// Moved, not copied, so every listener stays attached.
function groupHeaderActions(panel) {
  let header = panel.querySelector(':scope > .panel-header');
  if (!header) {
    const heading = panel.querySelector(':scope > h2');
    if (!heading) return;
    header = document.createElement('div');
    header.className = 'panel-header';
    heading.before(header);
    header.appendChild(heading);
  }
  const buttons = [...header.querySelectorAll(':scope > button')];
  const group = document.createElement('div');
  group.className = 'panel-header-actions';
  if (buttons.length) buttons[0].before(group);
  else header.appendChild(group);
  group.append(...buttons);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn modal-close page-action-close header-action-close';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '❌';
  group.appendChild(close);
}

// One place for a page's actions on every screen: the top, in the phone bar's
// order (actions, then ❌ last). A block's own action row (Tune's ♻️ 🔄 💾,
// Insight's Send to AI) joins its header group before ❌, and every form's action
// row moves to the top of the form, under its title. Moved, not copied, so every
// listener (and a form's submit button) stays attached; on a phone the bar is
// pinned to the bottom of the screen wherever it sits in the page.
function liftPageActions(panel) {
  const row = panel.querySelector('.panel-actions[data-page-actions]');
  const group = panel.querySelector(':scope > .panel-header > .panel-header-actions');
  if (!row || !group) return;
  const close = group.querySelector('.header-action-close');
  [...row.children]
    .filter((el) => !el.classList.contains('page-action-close'))
    .forEach((el) => group.insertBefore(el, close));
  row.remove();
}

function liftFormActions() {
  document.querySelectorAll('.modal .modal-actions').forEach((bar) => {
    bar.classList.add('modal-actions-top');
    const parent = bar.parentElement;
    const title = parent.querySelector(':scope > h2');
    if (title) title.after(bar);
    else parent.prepend(bar);
  });
}

function currentActionBar() {
  if (!window.ledgerSectionPage) return null;
  const formBar = document.querySelector('html[data-form-page] .modal.form-page .modal-actions');
  if (formBar) return formBar;
  const panel = document.querySelector(`#${window.ledgerSectionPage.section} > .panel.page-active`);
  if (!panel) return null;
  return panel.querySelector(SELECTION_BAR_IDS.map((id) => `#${id}:not([hidden])`).join(', '))
    || panel.querySelector('.panel-actions[data-page-actions]')
    || panel.querySelector(':scope > .panel-header > .panel-header-actions');
}

function updateActionBar() {
  const bar = currentActionBar();
  document.querySelectorAll('.action-bar').forEach((el) => {
    if (el !== bar) el.classList.remove('action-bar');
  });
  if (bar) bar.classList.add('action-bar');
  if (bar) document.documentElement.dataset.actionBar = '1';
  else delete document.documentElement.dataset.actionBar;
}

// ❌ on a selection bar clears the selection; on a page's own actions it leaves
// for the section hub, as the breadcrumb does. (A form's ❌ is its own Cancel.)
function onPageActionClose(event) {
  const close = event.target.closest('.page-action-close');
  if (!close) return;
  const selectionBar = close.closest(SELECTION_BAR_IDS.map((id) => `#${id}`).join(', '));
  if (selectionBar) {
    const panel = selectionBar.closest('.panel');
    const selectAll = panel.querySelector('thead input[type="checkbox"]:checked');
    if (selectAll) selectAll.click();
    panel.querySelectorAll('tbody input[type="checkbox"]:checked').forEach((box) => box.click());
    return;
  }
  // A view's page (Insight's Plan) closes to its block's; a block's to the hub.
  if (!window.ledgerSectionPage) return;
  const panel = currentRoutedPanel();
  navigateSectionPage(panel && currentRouteView(panel) ? panel : null);
}

function initActionBars() {
  document.addEventListener('click', onPageActionClose);
  SELECTION_BAR_IDS.forEach((id) => {
    const bar = document.getElementById(id);
    if (bar) new MutationObserver(updateActionBar).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  });
}
