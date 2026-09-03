// Section pages as a hub and pages instead of a stack of collapsible blocks.
//
// /health/ (and /finance/, /other/) is the section's hub: its glance cards, then
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
// home page), as the first tiles: each stands in for a block's own header button. On the section page
// it clicks that button, so the form opens exactly as it does from the block; from
// the home page it goes to the form's address instead.
const QUICK_ACTIONS = {
  health: [
    { label: 'Today', buttonId: 'today-physique-btn', href: () => `physique/${isoFromDate(new Date())}/` },
  ],
};

function buildQuickActions(section) {
  const actions = QUICK_ACTIONS[section.id];
  const grid = document.querySelector(`#${section.id} > .page-tiles`);
  if (!actions || !grid) return;
  // First in the tile row, before the page tiles, styled as the one action among them.
  [...actions].reverse().forEach((action) => {
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
    grid.insertBefore(tile, grid.firstChild);
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
    const title = document.createElement('span');
    title.className = 'page-tile-title';
    title.textContent = routedHeadingText(panel);
    tile.appendChild(title);
    tile.addEventListener('click', (event) => onPageLinkClick(event, section.id, panel));
    grid.appendChild(tile);
  });
  group.insertBefore(grid, section.panels[0] || null);
}

// "‹ Health / Physique" over a page, the section name going back to the hub; on
// the hub itself just "Health", in the same place and style, in place of the
// section's centred title.
function buildPageCrumb(section) {
  const group = document.getElementById(section.id);
  const crumb = document.createElement('nav');
  crumb.className = 'page-crumb';
  crumb.setAttribute('aria-label', 'Breadcrumb');
  const back = document.createElement('a');
  back.className = 'page-crumb-back';
  back.href = section.href;
  back.textContent = `‹ ${section.label}`;
  back.addEventListener('click', (event) => onPageLinkClick(event, section.id, null));
  const separator = document.createElement('span');
  separator.className = 'page-crumb-back';
  separator.textContent = '/';
  const current = document.createElement('span');
  current.className = 'page-crumb-current';
  crumb.append(back, separator, current);
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
    document.querySelector(`#${sectionId} .page-crumb-current`).textContent = panel
      ? routedHeadingText(panel)
      : section.label;
  }
}

// Runs once, before the router reads the address (bootDashboard, app.js).
function initPageNav() {
  initActionBars();
  const sections = pageNavSections();
  buildSideNav(sections);
  // Home: every section's tiles under its glance cards; each opens that page.
  if (!window.ledgerSectionPage) {
    document.documentElement.classList.add('home-hub');
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
  buildPageTiles(section);
  buildQuickActions(section);
  buildPageCrumb(section);
  buildFormCrumb();
}

// "‹ Health / Physique / Log" over a form page: the section goes back to the hub,
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
  // Built from the same pieces as the page breadcrumb (buildPageCrumb): a "‹ Section"
  // link, "/" separators, links for the levels above, the current level last.
  const separator = () => {
    const span = document.createElement('span');
    span.textContent = '/';
    return span;
  };
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
  crumb.append(link(`‹ ${section.label}`, section.href, () => closeFormPages(null)));
  if (panel) {
    crumb.append(separator(), link(routedHeadingText(panel), pageHref(section, panel), () => closeFormPages(panel)));
  }
  steps.forEach((step) => {
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

// A block's header buttons (Physique's Export CSV / Today / Log, Activity's Guide /
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
  if (window.ledgerSectionPage) navigateSectionPage(null);
}

function initActionBars() {
  document.addEventListener('click', onPageActionClose);
  SELECTION_BAR_IDS.forEach((id) => {
    const bar = document.getElementById(id);
    if (bar) new MutationObserver(updateActionBar).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  });
}
