// Section pages as a hub and pages: /health/ shows its glance cards and one tile per
// block, /health/physique/ that block alone under a breadcrumb. Moving between them
// rewrites the address (router.js owns history). The home page keeps every section.
// A wide screen gets a sidebar of every page; a phone the tab bar and tiles.

function pageNavSections() {
  return [...document.querySelectorAll('#main-nav a[data-section]')].map((link) => ({
    id: link.dataset.section,
    label: link.textContent.trim(),
    href: link.getAttribute('href'),
    panels: [...document.querySelectorAll(`#${link.dataset.section} > .panel[data-route]`)],
    // A hidden nav entry (Other) opens from the account menu, not the sidebar or tiles.
    inMenu: link.hidden,
  }));
}

function navSection(id) {
  return pageNavSections().find((s) => s.id === id);
}

function pageHref(section, panel) {
  return `${section.href}${panel.dataset.route}/`;
}

// A plain left click; a modified one (new tab, window) is left to the browser.
function isPlainClick(event) {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0);
}

// Same section: switch in place. Another section is another page load.
function onPageLinkClick(event, sectionId, panel) {
  if (!window.ledgerSectionPage || window.ledgerSectionPage.section !== sectionId) return;
  if (!isPlainClick(event)) return;
  event.preventDefault();
  // On a form page (Log, Edit, Workouts…), close it first or the page stays hidden under it.
  if (routedForms.length) closeFormPages(panel, panel ? () => navigateSectionPage(panel) : null);
  else navigateSectionPage(panel);
}

// The most used actions as the last tiles of a section's hub and its part of the home
// page. On the section page each clicks its block's header button; from the home
// page it goes to the form's address.
const QUICK_ACTIONS = {
  health: [
    { key: 'today', label: 'Today', buttonId: 'today-physique-btn', href: () => `physique/${isoFromDate(new Date())}/` },
    { key: 'workouts', label: 'Workouts', buttonId: 'activity-instruction-btn', href: () => 'activity/workouts/' },
    { key: 'micronutrients', label: 'Micronutrients', buttonId: 'physique-micro-range-btn', href: () => 'physique/micronutrients/', kind: 'chart' },
  ],
};

// A hub's tile order, by page route or quick action key; unlisted tiles go last.
const TILE_ORDER = {
  health: ['chart', 'micronutrients', 'insight', 'physique', 'nutrition', 'activity', 'tune', 'today', 'workouts'],
  finance: ['chart', 'insight', 'watchlist', 'transaction', 'account', 'portfolio'],
};

// A tile's colour (styles.css's .page-tile[data-kind]) by what it opens; sheet-row
// blocks stay gray. Quick actions are forms unless they set `kind`.
const TILE_KINDS = {
  'health/chart': 'chart',
  'health/insight': 'ai',
  'health/tune': 'form',
  'finance/chart': 'chart',
  'finance/market': 'ai',
  'finance/insight': 'ai',
};

// Pages with no tile or sidebar link; their addresses still open.
// Comment an entry out to bring its tile and link back.
const PAGES_WITHOUT_TILES = [
  'finance/breakdown',
];

function pageHasTile(section, panel) {
  return !PAGES_WITHOUT_TILES.includes(`${section.id}/${panel.dataset.route}`);
}

// A tile link; `setup` sets its attributes before the title goes in.
function createTile(className, label, setup) {
  const tile = document.createElement('a');
  tile.className = className;
  setup(tile);
  const title = document.createElement('span');
  title.className = 'page-tile-title';
  title.textContent = label;
  tile.appendChild(title);
  return tile;
}

function buildQuickActions(section) {
  const actions = QUICK_ACTIONS[section.id];
  const grid = document.querySelector(`#${section.id} > .card > .page-tiles`);
  if (!actions || !grid) return;
  actions.forEach((action) => {
    const source = document.getElementById(action.buttonId);
    const tile = createTile('page-tile quick-tile', action.label, (el) => {
      el.dataset.kind = action.kind || 'form';
      el.dataset.quick = action.key;
      if (source?.title) el.title = source.title;
      el.href = `${section.href}${action.href()}`;
    });
    tile.addEventListener('click', (event) => {
      if (window.ledgerSectionPage?.section !== section.id || !source) return;
      if (!isPlainClick(event)) return;
      event.preventDefault();
      source.click();
    });
    grid.appendChild(tile);
  });
}

function orderTiles(section) {
  const order = TILE_ORDER[section.id];
  const grid = document.querySelector(`#${section.id} > .card > .page-tiles`);
  if (!order || !grid) return;
  const tiles = [...grid.children];
  const keyOf = (el) => el.dataset.route || el.dataset.quick;
  const rank = (el) => (order.includes(keyOf(el)) ? order.indexOf(keyOf(el)) : order.length);
  tiles.sort((a, b) => rank(a) - rank(b)).forEach((el) => grid.appendChild(el));
}

function buildPageTiles(section) {
  const group = document.getElementById(section.id);
  const grid = document.createElement('nav');
  grid.className = 'page-tiles';
  grid.setAttribute('aria-label', `${section.label} pages`);
  section.panels.filter((panel) => pageHasTile(section, panel)).forEach((panel) => {
    const tile = createTile('page-tile', routedHeadingText(panel), (el) => {
      el.href = pageHref(section, panel);
      el.dataset.section = section.id;
      el.dataset.route = panel.dataset.route;
      const kind = TILE_KINDS[`${section.id}/${panel.dataset.route}`];
      if (kind) el.dataset.kind = kind;
    });
    tile.addEventListener('click', (event) => onPageLinkClick(event, section.id, panel));
    // A block can have its tile elsewhere (data-tile-host): Market's sits among
    // Finance Insight's mode tiles.
    const host = panel.dataset.tileHost && document.getElementById(panel.dataset.tileHost);
    (host || grid).appendChild(tile);
  });
  // One card titled with the section's name, on the home page and the hub alike.
  const card = document.createElement('div');
  card.className = 'card';
  const heading = document.createElement('h3');
  heading.textContent = section.label;
  card.append(heading, grid);
  group.insertBefore(card, section.panels[0] || null);
  // Cards marked data-under-tiles (Health's Progress) sit right under it.
  [...group.querySelectorAll(':scope > [data-under-tiles]')].reverse().forEach((el) => card.after(el));
  renderPageBadges();
}

// --- Badges: a block's short sign ("A<T $13", "28d", "Log") ------------------------
// On its tile's corner and after its page's breadcrumb. `badge` is { text, title,
// record? } (record: the row it opens), or null to clear.
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
  // The loop above clears Insight's tiles too; their age badges go back on.
  renderInsightAgeBadges();
  const sectionId = window.ledgerSectionPage?.section;
  const crumb = sectionId && document.querySelector(`#${sectionId} > .page-crumb`);
  if (!crumb) return;
  const panel = document.documentElement.dataset.page === 'block' ? currentRoutedPanel() : null;
  if (panel) placeBadge(crumb, sectionId, panel.dataset.route);
  else crumb.querySelector(':scope > .page-badge')?.remove();
}

// "Ledger / Health / Physique": every level above the current one links back.
function createCrumb(className, id = null) {
  const crumb = document.createElement('nav');
  if (id) crumb.id = id;
  crumb.className = className;
  crumb.setAttribute('aria-label', 'Breadcrumb');
  return crumb;
}

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
  const crumb = createCrumb('page-crumb');
  const current = document.createElement('span');
  current.className = 'page-crumb-current';
  current.textContent = 'Ledger';
  crumb.appendChild(current);
  const dashboard = document.getElementById('dashboard');
  dashboard.insertBefore(crumb, dashboard.firstChild);
}

function buildPageCrumb(section) {
  const group = document.getElementById(section.id);
  const crumb = createCrumb('page-crumb');
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
  // The links scroll above the fixed bottom panel (index.html's .header-actions).
  const links = document.createElement('div');
  links.className = 'side-nav-links';
  aside.appendChild(links);
  sections.filter((s) => !s.inMenu).forEach((section) => {
    const heading = document.createElement('a');
    heading.className = 'side-nav-section';
    heading.href = section.href;
    heading.dataset.section = section.id;
    heading.textContent = section.label;
    heading.addEventListener('click', (event) => onPageLinkClick(event, section.id, null));
    links.appendChild(heading);
    // A block whose tile lives on another page (data-tile-host) is reached from there.
    section.panels.filter((panel) => pageHasTile(section, panel) && !panel.dataset.tileHost).forEach((panel) => {
      const link = document.createElement('a');
      link.className = 'side-nav-page';
      link.href = pageHref(section, panel);
      link.dataset.section = section.id;
      link.dataset.route = panel.dataset.route;
      link.textContent = routedHeadingText(panel);
      link.addEventListener('click', (event) => onPageLinkClick(event, section.id, panel));
      links.appendChild(link);
    });
  });
  document.body.appendChild(aside);
  document.body.classList.add('with-side-nav');
  trackSideNavFooter();
  initSideNavToggle();
}

// The logo row's toggle, remembered in this browser (index.html's head reads it too).
const SIDE_NAV_KEY = 'ledger_side_nav';

function setSideNavOpen(open) {
  const toggle = document.getElementById('side-nav-toggle');
  if (open) delete document.documentElement.dataset.sideNav;
  else document.documentElement.dataset.sideNav = 'closed';
  const label = open ? 'Hide sidebar' : 'Show sidebar';
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('aria-expanded', String(open));
  if (typeof placeSettingsSwitches === 'function') placeSettingsSwitches();
  try {
    if (open) localStorage.removeItem(SIDE_NAV_KEY);
    else localStorage.setItem(SIDE_NAV_KEY, 'closed');
  } catch (e) {}
}

// The bottom panel's height as --side-nav-footer, which the links stop above.
function trackSideNavFooter() {
  const footer = document.querySelector('.header-actions');
  if (!footer || !('ResizeObserver' in window)) return;
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--side-nav-footer', `${footer.offsetHeight}px`);
  }).observe(footer);
}

function initSideNavToggle() {
  const toggle = document.getElementById('side-nav-toggle');
  if (!toggle) return;
  setSideNavOpen(document.documentElement.dataset.sideNav !== 'closed');
  toggle.addEventListener('click', () => {
    setSideNavOpen(document.documentElement.dataset.sideNav === 'closed');
  });
  // Ctrl+. (⌘. on a Mac).
  document.addEventListener('keydown', (event) => {
    if (event.key !== '.' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (!window.matchMedia('(min-width: 1180px)').matches) return;
    event.preventDefault();
    toggle.click();
  });
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
    const section = navSection(sectionId);
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
      if (s.inMenu) {
        document.getElementById(s.id).hidden = true;
        return;
      }
      buildPageTiles(s);
      buildQuickActions(s);
      orderTiles(s);
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
  orderTiles(section);
  buildPageCrumb(section);
  buildFormCrumb();
}

// "Ledger / Health / Physique / Log" over a form page; its links close the form
// (closeFormPages). updateFormPage moves it into whichever form is the page.
function buildFormCrumb() {
  document.body.appendChild(createCrumb('page-crumb form-crumb', 'form-crumb'));
}

function updateFormCrumb(panel, steps) {
  const crumb = document.getElementById('form-crumb');
  const section = navSection(window.ledgerSectionPage?.section);
  if (!crumb || !section) return;
  crumb.textContent = '';
  const separator = () => crumbSeparator();
  const link = (text, href, onClick) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.addEventListener('click', (event) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      onClick();
    });
    return a;
  };
  crumb.append(crumbHomeLink(), separator(), link(section.label, section.href, () => closeFormPages(null)));
  if (panel) {
    crumb.append(separator(), link(routedHeadingText(panel), pageHref(section, panel), () => closeFormPages(panel)));
  }
  // Levels between the block and the current one link too (a row's date over its 🧬 view).
  steps.forEach((step, i) => {
    if (i < steps.length - 1 && panel) {
      const href = `${pageHref(section, panel)}${steps.slice(0, i + 1).map((s) => `${s.slug}/`).join('')}`;
      // A form's own top level (Workouts above one of its groups) goes back to it in place.
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
// A page's action row replaces the phone's tab bar (styles.css). First match wins:
// an open form page's actions, a block's selection bar while rows are ticked, its
// page actions, then its header buttons. Each ends in ❌.
const SELECTION_BAR_IDS = ['physique-bulk-actions', 'nutrition-bulk-actions', 'tx-bulk-actions', 'contacts-bulk-actions'];
const SELECTION_BAR_SELECTOR = SELECTION_BAR_IDS.map((id) => `#${id}`).join(', ');

// Gathers a block's header buttons into one group ending in ❌ (just ❌ when it has
// none), wrapping a bare <h2> in a .panel-header. Moved, so listeners stay attached.
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

// A block's own action row (Tune's ♻️ 🔄 💾) joins its header group before ❌, and
// each form's moves to the form's top. Moved, so listeners and submit stay attached.
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
    bar.parentElement.prepend(bar);
  });
}

function currentActionBar() {
  if (!window.ledgerSectionPage) return null;
  const formBar = document.querySelector('html[data-form-page] .modal.form-page .modal-actions');
  if (formBar) return formBar;
  const panel = document.querySelector(`#${window.ledgerSectionPage.section} > .panel.page-active`);
  if (!panel) return null;
  const selectionBar = panel.querySelector(SELECTION_BAR_IDS.map((id) => `#${id}:not([hidden])`).join(', '));
  if (selectionBar) return selectionBar;
  return panel.querySelector('.panel-actions[data-page-actions]')
    || panel.querySelector(':scope > .panel-header > .panel-header-actions');
}

function updateActionBar() {
  const bar = currentActionBar();
  document.querySelectorAll('.action-bar').forEach((el) => {
    if (el !== bar) el.classList.remove('action-bar');
  });
  if (bar) bar.classList.add('action-bar');
  // A view hub (Insight before a mode is picked) shows only ❌ in its bar.
  const panel = bar?.closest('.panel');
  const onHub = !!panel && !!panel.querySelector('[data-route-view]') && !currentRouteView(panel)
    && !bar.closest(SELECTION_BAR_SELECTOR);
  document.querySelectorAll('.action-bar-hub').forEach((el) => {
    if (el !== bar || !onHub) el.classList.remove('action-bar-hub');
  });
  if (onHub) bar.classList.add('action-bar-hub');
  if (bar) document.documentElement.dataset.actionBar = '1';
  else delete document.documentElement.dataset.actionBar;
}

// ❌ on a selection bar clears the selection; on a page's own actions it leaves
// for the section hub, as the breadcrumb does. (A form's ❌ is its own Cancel.)
function onPageActionClose(event) {
  const close = event.target.closest('.page-action-close');
  if (!close) return;
  const selectionBar = close.closest(SELECTION_BAR_SELECTOR);
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
