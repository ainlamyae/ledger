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

// One line under each tile's title, by "<section>/<block>". A block with no entry
// just shows its title.
const PAGE_TILE_DESCRIPTIONS = {
  'health/tune': 'Targets, BMR model and plan',
  'health/indicator': 'Body mass, intake and sleep over time',
  'health/insight': 'AI reads of your logged data',
  'health/physique': 'Daily log: sleep, food, workout',
  'health/activity': 'Exercise plan and catalogue',
  'health/nutrition': 'Ingredients and their nutrients',
  'health/settings': 'Health keys in the Setting tab',
  'finance/indicator': 'Spending and savings over time',
  'finance/insight': 'AI read of your finances',
  'finance/transaction': 'Every transaction',
  'finance/account': 'Balances and transfers',
  'finance/breakdown': 'Categories and types',
  'other/work-time': 'Timesheet',
  'other/car-service': 'Service history and next due',
  'other/travel': 'Trips',
  'other/application': 'Applications and their status',
  'other/contact': 'People',
  'other/settings': 'Every key in the Setting tab',
};

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
    const description = PAGE_TILE_DESCRIPTIONS[`${section.id}/${panel.dataset.route}`];
    if (description) {
      const note = document.createElement('span');
      note.className = 'page-tile-note';
      note.textContent = description;
      tile.appendChild(note);
    }
    tile.addEventListener('click', (event) => onPageLinkClick(event, section.id, panel));
    grid.appendChild(tile);
  });
  group.insertBefore(grid, section.panels[0] || null);
}

// "‹ Health / Physique" over a page; the section name goes back to the hub.
function buildPageCrumb(section) {
  const group = document.getElementById(section.id);
  const crumb = document.createElement('nav');
  crumb.className = 'page-crumb';
  crumb.setAttribute('aria-label', 'Breadcrumb');
  const back = document.createElement('a');
  back.href = section.href;
  back.textContent = `‹ ${section.label}`;
  back.addEventListener('click', (event) => onPageLinkClick(event, section.id, null));
  const current = document.createElement('span');
  current.className = 'page-crumb-current';
  crumb.append(back, document.createTextNode(' / '), current);
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
  if (sectionId && panel) {
    document.querySelector(`#${sectionId} .page-crumb-current`).textContent = routedHeadingText(panel);
  }
}

// Runs once, before the router reads the address (bootDashboard, app.js).
function initPageNav() {
  const sections = pageNavSections();
  buildSideNav(sections);
  if (!window.ledgerSectionPage) return;
  const section = sections.find((s) => s.id === window.ledgerSectionPage.section);
  if (!section) return;
  document.documentElement.classList.add('section-pages');
  buildPageTiles(section);
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
  // Before the first form, so it sits right above whichever form is the page.
  document.body.insertBefore(crumb, document.querySelector('body > .modal'));
}

function updateFormCrumb(panel, steps) {
  const crumb = document.getElementById('form-crumb');
  const section = pageNavSections().find((s) => s.id === window.ledgerSectionPage?.section);
  if (!crumb || !section) return;
  crumb.textContent = '';
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
    crumb.append(' / ', link(routedHeadingText(panel), pageHref(section, panel), () => closeFormPages(panel)));
  }
  steps.forEach((step) => {
    const current = document.createElement('span');
    current.className = 'page-crumb-current';
    current.textContent = step.label;
    crumb.append(' / ', current);
  });
}
