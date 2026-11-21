// Turns /health/, /finance/, /track/ and /setting/ into pages of their own: each
// stub loads this file, which fetches index.html (the only copy of the markup),
// rebuilds it here and hides every wrapper but the one the address names. The
// section is matched against index.html's <nav> hrefs, the one list of sections.

(function () {
  // Pinned absolute, so the router's pushState can't shift relative URLs.
  const base = document.querySelector('base');
  base.href = base.href;

  // Path below the app root: "<wrapper>/<block>/<button>" (see router.js).
  const [SLUG, ...ROUTE] = location.pathname
    .slice(new URL(base.href).pathname.length)
    .split('/')
    .filter(Boolean);

  // Start-up steps, registered instead of window.load (long past by the time the
  // scripts arrive). Boot steps run once every script, async Google ones included,
  // has loaded; route steps run first, once the app's own have, so the page shows
  // the right view straight away.
  const bootSteps = [];
  const routeSteps = [];

  window.ledgerSectionPage = {
    slug: SLUG,
    route: ROUTE,
    section: null,
    onBoot(step) {
      bootSteps.push(step);
    },
    onRoute(step) {
      routeSteps.push(step);
    },
  };

  // Content stays hidden until the route steps have run (styles.css).
  document.documentElement.dataset.routing = '';

  // Raw attribute values only: the parsed document's base is this page's URL, so
  // its resolved node.src would point inside this section's directory.
  function reviveScript(node) {
    const script = document.createElement('script');
    for (const { name, value } of node.attributes) script.setAttribute(name, value);
    script.textContent = node.textContent;
    // A created script defaults to async; index.html's order is load-bearing, so
    // only the ones marked async stay that way.
    if (!node.hasAttribute('async')) script.async = false;
    return script;
  }

  // `ordered` collects the in-order scripts alone: the app's own, not Google's async ones.
  function appendScript(node, parent, pending, ordered) {
    const script = reviveScript(node);
    if (script.src) {
      const loaded = new Promise((resolve) => {
        // error resolves too: a 404 leaves the page half-built, as on the home page,
        // rather than hanging before the boot steps.
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', resolve, { once: true });
      });
      pending.push(loaded);
      if (!script.async) ordered.push(loaded);
    }
    parent.appendChild(script);
  }

  function adoptHead(source, pending, ordered) {
    const stylesheets = new Set(
      [...document.head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href')),
    );

    [...source.head.children].forEach((node) => {
      // The stub's own <base>, <title> and stylesheet (fetched alongside index.html) stay.
      if (node.tagName === 'BASE' || node.tagName === 'TITLE') return;
      if (node.tagName === 'LINK' && stylesheets.has(node.getAttribute('href'))) return;
      if (node.tagName === 'SCRIPT') {
        // The stub's own head already ran it (motion.js, theme-boot.js).
        if (node.getAttribute('src') && document.head.querySelector(`script[src="${node.getAttribute('src')}"]`)) return;
        appendScript(node, document.head, pending, ordered);
        return;
      }
      document.head.appendChild(document.importNode(node, true));
    });
  }

  // Everything but the scripts, which must be recreated to run and go in last, after
  // showOnly, so no renderer sees the other sections visible.
  function adoptBody(source) {
    const scripts = [];
    [...source.body.childNodes].forEach((node) => {
      if (node.tagName === 'SCRIPT') {
        scripts.push(node);
        return;
      }
      document.body.appendChild(document.importNode(node, true));
    });
    return scripts;
  }

  // Hidden, not removed: loadDashboard still renders into every wrapper.
  function showOnly(sectionId) {
    document.documentElement.dataset.section = sectionId;
    window.ledgerSectionPage.section = sectionId;

    document.querySelectorAll('#dashboard .panel-group').forEach((group) => {
      group.hidden = group.id !== sectionId;
    });
    // The Time / Date / Azan / Weather row belongs to the home page alone.
    document.querySelectorAll('#dashboard .widget-cards').forEach((row) => {
      row.hidden = true;
    });

    // The wrapper's own address, even on a deeper block/button page.
    const url = new URL(`${SLUG}/`, base.href).href;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = url;
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = url;
  }

  function showLoadError(message) {
    document.body.innerHTML = '';
    const note = document.createElement('p');
    note.className = 'status status-error page-note';
    note.textContent = `Couldn't load this page: ${message}. `;
    const home = document.createElement('a');
    home.href = '.';
    home.textContent = 'Open the dashboard';
    note.appendChild(home);
    document.body.appendChild(note);
  }

  async function build() {
    // Relative to the stub's <base>, so this is the one index.html at the root.
    const response = await fetch('index.html', { cache: 'no-store' });
    if (!response.ok) throw new Error(`index.html returned ${response.status}`);
    const source = new DOMParser().parseFromString(await response.text(), 'text/html');

    const link = [...source.querySelectorAll('#main-nav a[data-section]')]
      .find((a) => a.getAttribute('href').replace(/\/+$/, '') === SLUG);
    if (!link) throw new Error(`"${SLUG}" isn't one of the dashboard's sections`);

    // Adds the rest of index.html's head (page-boot.js runs before the body's scripts).
    const pending = [];
    const ordered = [];
    adoptHead(source, pending, ordered);

    if (document.readyState === 'loading') {
      await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }

    const scripts = adoptBody(source);
    showOnly(link.dataset.section);
    scripts.forEach((node) => appendScript(node, document.body, pending, ordered));

    await Promise.all(ordered);
    routeSteps.forEach((step) => step());
    delete document.documentElement.dataset.routing;
    // Its cards come in the way the load went (motion.js).
    window.Motion?.enterPage();

    await Promise.all(pending);
    bootSteps.forEach((step) => step());
  }

  build().catch((err) => {
    delete document.documentElement.dataset.routing;
    console.error('Section page failed to load:', err);
    showLoadError(err.message);
  });
}());
