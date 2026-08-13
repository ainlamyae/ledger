// Turns /health/, /finance/ and /other/ into pages of their own.
//
// Each of those directories holds an identical stub whose only job is to load
// this file. The dashboard's markup lives in index.html and nowhere else: this
// fetches that one file, rehydrates it into the stub, and then hides everything
// outside the wrapper the address names. So a panel added to index.html — or
// moved between wrappers — shows up on the right section page with nothing to
// keep in sync, and the address survives a refresh because the page is really
// served from that path rather than reached through a hash or a redirect.
//
// The section this page shows is read off index.html's own <nav>, matching the
// last path segment against each link's href, so the list of sections has one
// home: that markup.

(function () {
  const SLUG = location.pathname.replace(/\/+$/, '').split('/').pop();

  // index.html's scripts register their start-up step here instead of on
  // window.load / DOMContentLoaded: they arrive long after this page's own
  // load event, so those listeners would never fire. Called in registration
  // order once every script — including the async Google ones, which window.load
  // would also have waited for — has finished loading.
  const bootSteps = [];

  window.ledgerSectionPage = {
    slug: SLUG,
    section: null,
    onBoot(step) {
      bootSteps.push(step);
    },
  };

  // Resolved against the live document's <base>, never against the parsed
  // document: DOMParser gives its document THIS page's URL as the base, so
  // node.href / node.src on anything it parsed would point inside this section's
  // own directory. Only raw attribute values are ever copied across.
  function reviveScript(node) {
    const script = document.createElement('script');
    for (const { name, value } of node.attributes) script.setAttribute(name, value);
    script.textContent = node.textContent;
    // A script element created here defaults to async, i.e. whenever-it-arrives.
    // index.html's order is load-bearing (Chart.js before charts.js, config
    // before everything), so opt every one that wasn't explicitly marked async
    // back into ordered execution.
    if (!node.hasAttribute('async')) script.async = false;
    return script;
  }

  function appendScript(node, parent, pending) {
    const script = reviveScript(node);
    if (script.src) {
      pending.push(new Promise((resolve) => {
        // error resolves too: a script that 404s should leave the page half-built
        // with a console error, exactly as it would on the home page, rather than
        // hanging before the boot steps run.
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', resolve, { once: true });
      }));
    }
    parent.appendChild(script);
  }

  function adoptHead(source, pending) {
    const stylesheets = new Set(
      [...document.head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href')),
    );

    [...source.head.children].forEach((node) => {
      // The stub's own <base> is what makes every relative URL in the markup
      // below resolve, and its <title>/stylesheet are already here — the
      // stylesheet deliberately so, to download alongside index.html instead
      // of after it.
      if (node.tagName === 'BASE' || node.tagName === 'TITLE') return;
      if (node.tagName === 'LINK' && stylesheets.has(node.getAttribute('href'))) return;
      if (node.tagName === 'SCRIPT') {
        appendScript(node, document.head, pending);
        return;
      }
      document.head.appendChild(document.importNode(node, true));
    });
  }

  // Everything but the scripts, which have to be recreated to run at all and are
  // appended last — after the wrapper filter below, so no renderer ever sees the
  // hidden sections as visible.
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

  // Hidden rather than removed: the panels in the other wrappers are still
  // rendered into by loadDashboard, and every renderer expects its elements to
  // exist. Nothing enumerates the sections here — whatever isn't this page's is
  // hidden — so a fourth wrapper needs no change to this file.
  function showOnly(sectionId) {
    document.documentElement.dataset.section = sectionId;
    window.ledgerSectionPage.section = sectionId;

    document.querySelectorAll('#dashboard .panel-group').forEach((group) => {
      group.hidden = group.id !== sectionId;
    });
    // The Time / Date / Azan / Weather row belongs to the dashboard as a whole,
    // not to any one wrapper.
    document.querySelectorAll('#dashboard .widget-cards').forEach((row) => {
      row.hidden = true;
    });

    const title = document.querySelector(`#${sectionId} .panel-group-title`);
    if (title) document.title = `${title.textContent.trim()} — Ledger`;

    const url = `${location.origin}${location.pathname}`;
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = url;
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = url;
  }

  function showLoadError(message) {
    document.body.innerHTML = '';
    const note = document.createElement('p');
    note.className = 'status status-error';
    note.style.margin = '2rem';
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

    // This head runs index.html's theme script (again — it's idempotent, and the
    // stub already ran a copy of it to beat the first paint) and brings in
    // anything else index.html has picked up since.
    const pending = [];
    adoptHead(source, pending);

    if (document.readyState === 'loading') {
      await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }

    const scripts = adoptBody(source);
    showOnly(link.dataset.section);
    scripts.forEach((node) => appendScript(node, document.body, pending));

    await Promise.all(pending);
    bootSteps.forEach((step) => step());
  }

  build().catch((err) => {
    console.error('Section page failed to load:', err);
    showLoadError(err.message);
  });
}());
