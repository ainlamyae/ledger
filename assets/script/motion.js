// motion.js — every animation in Ledger, in one place: the timing, the CSS
// motion rules, and the code that plays them. Loaded in <head> (index.html and
// every section stub) so its rules and the cross-page transition are in before
// the first paint. Other files only call window.Motion; none animates itself.
//
//   1. Timing         springs and curves
//   2. Stylesheet     transitions, keyframes, view transitions
//   3. Page loads     cross-document push/pop
//   4. Forms          sheets rise and sink, the page behind recedes
//   5. Toast
//   6. Pages          in-page navigation (router.js)
//   7. Feedback       busy icons, panel entry, confetti, warning
//
// Only content ever moves; the background (#app-backdrop) stays still.

(function () {
  'use strict';

  // ── 1. Timing ─────────────────────────────────────────────────────────────

  // A SwiftUI-style spring (response s, bounce 0-1, launch velocity) as a CSS
  // linear() easing plus the time it takes to settle.
  function spring(response, bounce = 0, v0 = 0) {
    const w0 = (2 * Math.PI) / response;
    const z = 1 - bounce;
    const x = (t) => {
      if (z >= 1) return 1 - Math.exp(-w0 * t) * (1 + (w0 - v0) * t);
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0 - v0) / wd) * Math.sin(wd * t));
    };
    let end = response * 0.5;
    while (end < 3 && [0, 0.02, 0.05, 0.1].some((d) => Math.abs(x(end + d) - 1) > 0.002)) end += 0.01;
    const points = [];
    for (let i = 0; i < 40; i++) points.push(+x((end * i) / 40).toFixed(3));
    return { duration: Math.round(end * 1000), easing: `linear(${points.join(', ')}, 1)` };
  }

  const NAV = spring(0.4, 0, 6); // push/pop: quick launch, soft landing
  const ZOOM = spring(0.48, 0.16, 3); // zoom past/settle: a hint of overshoot
  const DISMISS = spring(0.38, 0, 4); // closing: no overshoot
  const POP = spring(0.38, 0.28); // toast

  // Curves for CSS transitions (micro-interactions).
  const EASE = 'cubic-bezier(.2, .8, .2, 1)'; // quick start, soft settle
  const EASE_BOUNCE = 'cubic-bezier(.3, 1.3, .5, 1)'; // springs back past rest
  const PARALLAX = 0.3; // how far the page under a push drifts
  const DIM = 'brightness(.72)';
  const EDGE = '-16px 0 40px rgba(0, 0, 0, .18)';

  // ── 2. Stylesheet ─────────────────────────────────────────────────────────

  const CSS = `
:root {
  --ease-spring: ${EASE};
  --ease-ios-bounce: ${EASE_BOUNCE};
  --transition-colors: background-color .2s ${EASE}, color .2s ${EASE}, border-color .2s ${EASE};
}

/* Colour changes */
body, .card, .modal-card, .side-nav-toggle, .account-avatar-btn { transition: var(--transition-colors); }
.nav a { transition: color .2s ${EASE}; }
.switch { transition: background-color .25s ease; }
.switch::before { transition: transform .25s ${EASE_BOUNCE}; }
.body-mass-progress-meter-callout { transition: background .3s ${EASE}; }
.body-mass-progress-meter-fill { transition: width .3s ${EASE}; }
.side-nav { transition: transform .2s ease, visibility .2s; }

/* Press: gives under the finger, springs back on release */
.btn { transition: var(--transition-colors), transform .3s ${EASE_BOUNCE}; }
.btn:active:not(:disabled) {
  transform: scale(.94);
  transition: var(--transition-colors), transform .1s ease-out;
}
.page-tile { transition: transform .2s ${EASE}, box-shadow .2s ${EASE}, opacity .2s ${EASE}; }
.page-tile:active { opacity: .6; transform: scale(.97); }

/* Hover lift */
.panel { transition: var(--transition-colors), transform .2s ${EASE}, box-shadow .2s ${EASE}; }
.panel:hover, .page-tile:hover, .page-tile:focus-visible { transform: translateY(-2px); }

/* Fold and unfold */
.panel-toggle-icon { transition: transform .2s ${EASE}; }
.panel > *:not(h2):not(.panel-header) {
  transition: max-height .3s ${EASE}, opacity .2s ${EASE}, margin .3s ${EASE},
    padding .3s ${EASE}, border-width .3s ${EASE};
}
.app-card-body { transition: max-height .3s ${EASE}, opacity .2s ${EASE}, padding .3s ${EASE}; }

/* Panels fade in one after another (enterPanel) */
.panel.panel-enter {
  animation: panel-enter .3s ${EASE} both;
  animation-delay: calc(var(--enter-index, 0) * 70ms);
}
@keyframes panel-enter {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

/* The open page sits still: a transform would pin its fixed bottom bar to it. */
html.section-pages .panel.page-active,
html.section-pages .panel.page-active:hover {
  animation: none;
  transform: none;
  transition: none;
}

/* Busy icon button: grows and pulses, then bounces back (iconBusy/iconSettle) */
.btn.btn-icon.icon-busy, .btn.row-action-btn.icon-busy {
  animation: icon-busy-grow .25s ease-out forwards, icon-busy-pulse 1s ease-in-out .25s infinite;
}
.btn.btn-icon.icon-settle, .btn.row-action-btn.icon-settle {
  animation: icon-busy-settle .4s cubic-bezier(.34, 1.56, .64, 1);
}
@keyframes icon-busy-grow { from { transform: scale(1); } to { transform: scale(1.4); } }
@keyframes icon-busy-pulse { 0%, 100% { transform: scale(1.4); } 50% { transform: scale(1.5); } }
@keyframes icon-busy-settle {
  0% { transform: scale(1.4); } 45% { transform: scale(.85); }
  72% { transform: scale(1.15); } 100% { transform: scale(1); }
}

/* Confetti and the warning pulse, over everything; clicks pass through */
.confetti-canvas, .warning-pulse {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 120;
}
.warning-pulse {
  box-shadow: inset 0 0 0 0 var(--color-danger);
  animation: warning-pulse .8s ease-in-out 3;
}
.warning-shake { animation: warning-shake .5s ease-in-out; }
@keyframes warning-shake {
  0%, 100% { transform: translateX(0); }
  15%, 55% { transform: translateX(-10px); }
  35%, 75% { transform: translateX(10px); }
  90% { transform: translateX(-4px); }
}
@keyframes warning-pulse {
  0%, 100% { box-shadow: inset 0 0 0 0 transparent; background: transparent; }
  50% {
    box-shadow: inset 0 0 80px 16px color-mix(in srgb, var(--color-danger) 70%, transparent);
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  }
}

/* Page loads: an iOS push, Back reversed. The background, bars, account and
   breadcrumb are named out of the slide and held still. */
@view-transition { navigation: auto; }
#app-backdrop { view-transition-name: app-backdrop; }
.nav { view-transition-name: app-nav; }
.side-nav { view-transition-name: app-side-nav; }
.header-actions { view-transition-name: app-account; }
.page-crumb { view-transition-name: app-crumb; }
${['app-backdrop', 'app-nav', 'app-side-nav', 'app-account', 'app-crumb'].map((n) => `
::view-transition-group(${n}) { animation: none; }
::view-transition-old(${n}), ::view-transition-new(${n}) { animation: none; mix-blend-mode: normal; }`).join('')}
::view-transition-old(root), ::view-transition-new(root) {
  animation-duration: ${NAV.duration}ms;
  animation-timing-function: ${NAV.easing};
  mix-blend-mode: normal;
}
::view-transition-new(root) { animation-name: page-in; box-shadow: ${EDGE}; }
::view-transition-old(root) { animation-name: page-out; }
html:active-view-transition-type(back)::view-transition-new(root) { animation-name: page-in-back; box-shadow: none; }
html:active-view-transition-type(back)::view-transition-old(root) { animation-name: page-out-back; box-shadow: ${EDGE}; z-index: 1; }
@keyframes page-in { from { transform: translateX(100%); } }
@keyframes page-out { to { transform: translateX(-${PARALLAX * 100}%); filter: ${DIM}; } }
@keyframes page-in-back { from { transform: translateX(-${PARALLAX * 100}%); filter: ${DIM}; } }
@keyframes page-out-back { to { transform: translateX(100%); } }
`;

  function installStyles() {
    if (document.getElementById('motion-styles')) return;
    const style = document.createElement('style');
    style.id = 'motion-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ── 3. Page loads ─────────────────────────────────────────────────────────

  // Back, or up to a shorter address (a section to home), slides the other way;
  // a reload doesn't slide.
  function onPageReveal(event) {
    const act = window.navigation && navigation.activation;
    if (!event.viewTransition || !act || !act.from) return;
    if (act.navigationType === 'reload') return event.viewTransition.skipTransition();
    const depth = (url) => new URL(url).pathname.split('/').filter(Boolean).length;
    const back = act.navigationType === 'traverse' ? act.entry.index < act.from.index : depth(act.entry.url) < depth(act.from.url);
    event.viewTransition.types.add(back ? 'back' : 'forward');
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  function rectOf(el) {
    if (!el?.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // The viewport's middle in el's own coordinates, for scaling round the screen's centre.
  function screenMiddle(el) {
    const r = el.getBoundingClientRect();
    return `${innerWidth / 2 - r.left}px ${innerHeight / 2 - r.top}px`;
  }

  function currentSection() {
    return window.ledgerSectionPage && typeof routedSectionId === 'function' ? document.getElementById(routedSectionId(null)) : null;
  }

  const removeOnFinish = (anim, el) => { const done = () => el.remove(); anim.finished.then(done, done); };

  // The fixed bottom bar sits inside the page being animated, and a transform on
  // an ancestor would carry it along: it waits on <body> until the motion ends.
  function holdBottomBar(anim) {
    const bar = document.querySelector('.action-bar');
    if (!bar) return anim;
    const { parentNode, nextSibling } = bar;
    document.body.appendChild(bar);
    const restore = () => (nextSibling ? parentNode?.insertBefore(bar, nextSibling) : parentNode?.appendChild(bar));
    anim.finished.then(restore, restore);
    return anim;
  }

  // The breadcrumb never moves: an exact inverse of its page's motion cancels it out.
  function holdCrumbShift(root, d, timing, axis) {
    root?.querySelector('.page-crumb')?.animate([{ transform: `translate${axis}(${-d}px)` }, { transform: 'none' }], timing);
  }

  function holdCrumbScale(root, scale, timing) {
    const crumb = root?.querySelector('.page-crumb');
    if (!crumb) return;
    const origin = screenMiddle(crumb);
    crumb.animate([{ transformOrigin: origin, transform: `scale(${1 / scale})` }, { transformOrigin: origin, transform: 'none' }], timing);
  }

  // What's on screen in section now, as a fixed copy (canvases redrawn).
  function snapshot(section) {
    const r = section.getBoundingClientRect();
    const cs = getComputedStyle(section);
    const wrap = document.createElement('div');
    wrap.inert = true;
    wrap.setAttribute('aria-hidden', 'true');
    Object.assign(wrap.style, {
      position: 'fixed', left: `${r.left}px`, top: '0', width: `${r.width}px`, height: `${innerHeight}px`,
      overflow: 'hidden', pointerEvents: 'none', zIndex: '5',
    });
    const inner = wrap.appendChild(document.createElement('div'));
    Object.assign(inner.style, { display: cs.display, flexDirection: cs.flexDirection, gap: cs.gap, transform: `translateY(${r.top}px)` });
    [...section.children].filter((el) => el.getClientRects().length).forEach((el) => {
      const copy = inner.appendChild(el.cloneNode(true));
      copy.querySelectorAll('.action-bar').forEach((bar) => bar.classList.remove('action-bar'));
      // Kept for layout, hidden: the live breadcrumb stays put.
      if (copy.matches('.page-crumb')) copy.style.visibility = 'hidden';
      const from = el.querySelectorAll('canvas');
      copy.querySelectorAll('canvas').forEach((c, i) => {
        try { c.width = from[i].width; c.height = from[i].height; c.getContext('2d').drawImage(from[i], 0, 0); } catch { /* blank is fine */ }
      });
    });
    return { wrap, top: 0 };
  }

  // ── 4. Forms and dialogs ──────────────────────────────────────────────────

  const ghosts = new Map(); // modal -> its closing copy

  // An overlay's backdrop fades with its card.
  function fadeBackdrop(el, show, timing) {
    const cs = getComputedStyle(el);
    const frames = [
      { backgroundColor: 'rgba(0, 0, 0, 0)', backdropFilter: 'blur(0px)' },
      { backgroundColor: cs.backgroundColor, backdropFilter: cs.backdropFilter === 'none' ? 'blur(0px)' : cs.backdropFilter },
    ];
    return el.animate(show ? frames : frames.reverse(), { ...timing, fill: show ? 'none' : 'forwards' });
  }

  // The page behind a form page recedes, as iOS's screen under a sheet.
  function recede(snap) {
    if (!snap) return;
    snap.wrap.style.zIndex = '-1';
    document.body.appendChild(snap.wrap);
    removeOnFinish(snap.wrap.animate([
      { transform: 'none', filter: 'brightness(1)', borderRadius: '0', opacity: 1 },
      { transform: 'scale(.92)', filter: 'brightness(.6)', borderRadius: '24px', opacity: 1, offset: .6 },
      { transform: 'scale(.9)', filter: 'brightness(.5)', borderRadius: '24px', opacity: 0 },
    ], { ...ZOOM, easing: 'linear', fill: 'forwards' }), snap.wrap);
  }

  // A sheet rising from the bottom edge.
  function riseIn(modal, behind) {
    const card = modal.querySelector('.modal-card');
    if (!card || modal.hidden) return behind?.wrap.remove();
    card.getAnimations().forEach((a) => a.cancel());
    if (modal.classList.contains('form-page')) recede(behind);
    else {
      behind?.wrap.remove();
      fadeBackdrop(modal, true, DISMISS);
    }
    const rise = innerHeight - Math.max(card.getBoundingClientRect().top, 0);
    holdBottomBar(card.animate([{ transform: `translateY(${rise}px)` }, { transform: 'none' }], NAV));
  }

  // A copy of the card left where it was, since the real one is gone at once.
  function ghostOf(modal) {
    const card = modal.querySelector('.modal-card');
    const r = card && card.getBoundingClientRect();
    if (!r?.width || !r.height) return null;
    const cs = getComputedStyle(card);
    const ghost = card.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    ghost.querySelectorAll('.action-bar').forEach((bar) => bar.classList.remove('action-bar'));
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      maxWidth: 'none', maxHeight: 'none', margin: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '1000',
      background: cs.background, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, padding: cs.padding,
      color: cs.color, font: cs.font,
    });
    const page = modal.classList.contains('form-page');
    let backdrop = null;
    if (!page) {
      const ms = getComputedStyle(modal);
      backdrop = document.createElement('div');
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', zIndex: '999', pointerEvents: 'none',
        backgroundColor: ms.backgroundColor, backdropFilter: ms.backdropFilter,
      });
      document.body.appendChild(backdrop);
    }
    document.body.appendChild(ghost);
    return { ghost, backdrop, page, top: r.top, started: false };
  }

  function dropGhost(modal) {
    const g = ghosts.get(modal);
    if (!g) return;
    ghosts.delete(modal);
    g.ghost.remove();
    g.backdrop?.remove();
  }

  // The sheet sinks off the bottom edge while the page comes forward again.
  function sinkOut(modal, g) {
    if (ghosts.get(modal) !== g) return;
    g.started = true;
    if (g.backdrop) fadeBackdrop(g.backdrop, false, DISMISS);
    const section = g.page && currentSection();
    if (section && section.getClientRects().length) {
      const middle = screenMiddle(section);
      holdBottomBar(section.animate([
        { transformOrigin: middle, transform: 'scale(.92)', filter: 'brightness(.6)' },
        { transformOrigin: middle, transform: 'none', filter: 'brightness(1)' },
      ], DISMISS));
      holdCrumbScale(section, .92, DISMISS);
    }
    const anim = g.ghost.animate([{ transform: 'none' }, { transform: `translateY(${innerHeight - Math.max(g.top, 0)}px)` }],
      { ...DISMISS, fill: 'forwards' });
    const done = () => { if (ghosts.get(modal) === g) dropGhost(modal); };
    anim.finished.then(done, done);
  }

  function beforeOpen(modal) {
    // Closed and reopened in one go (a save): no animation either way.
    const pending = ghosts.get(modal);
    dropGhost(modal);
    if (pending && !pending.started) return null;
    const section = currentSection();
    const behind = section && section.getClientRects().length ? snapshot(section) : null;
    return () => riseIn(modal, behind);
  }

  function beforeClose(modal) {
    dropGhost(modal);
    modal.querySelector('.modal-card')?.getAnimations().forEach((a) => a.cancel());
    const g = ghostOf(modal);
    if (!g) return null;
    ghosts.set(modal, g);
    return () => sinkOut(modal, g);
  }

  // ── 5. Toast: springs up from the bottom, sinks away ──────────────────────

  function beforeToast(toast, show) {
    if (show) {
      return () => toast.animate([
        { transform: 'translate(-50%, 140%) scale(.9)', opacity: 0 },
        { opacity: 1, offset: .3 },
        { transform: 'translate(-50%, 0) scale(1)', opacity: 1 },
      ], POP);
    }
    if (!toast.getBoundingClientRect().width) return null;
    const ghost = toast.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    ghost.inert = true;
    ghost.hidden = false;
    Object.assign(ghost.style, { pointerEvents: 'none', bottom: getComputedStyle(toast).bottom });
    document.body.appendChild(ghost);
    return () => removeOnFinish(ghost.animate([
      { transform: 'translate(-50%, 0) scale(1)', opacity: 1 },
      { transform: 'translate(-50%, 60%) scale(.94)', opacity: 0 },
    ], { duration: 260, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }), ghost);
  }

  // Every open and close goes through each modal's (and the toast's) `hidden`,
  // wherever it's set; the write itself always happens synchronously.
  let ready = false;

  function init() {
    if (ready || typeof Element.prototype.animate !== 'function') return;
    ready = true;
    const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
    const hook = (el, before, onError) => Object.defineProperty(el, 'hidden', {
      configurable: true,
      get() { return native.get.call(this); },
      set(value) {
        const changed = !!value !== native.get.call(this);
        let after = null;
        try { if (changed) after = before(this, value); } catch { after = null; }
        native.set.call(this, value);
        if (after) requestAnimationFrame(() => { try { after(); } catch { onError(this); } });
      },
    });
    document.querySelectorAll('.modal').forEach((modal) => {
      hook(modal, (m, value) => (value ? beforeClose(m) : beforeOpen(m)), dropGhost);
    });
    document.querySelectorAll('.toast').forEach((toast) => hook(toast, (t, value) => beforeToast(t, !value), () => {}));
  }

  // ── 6. Pages ──────────────────────────────────────────────────────────────
  // From the hub a page rises while the hub zooms past; back, it sinks away as
  // the hub settles in. Page to page is a navigation push/pop.

  let direction = null; // 'push' | 'pop', set by the router
  let lastPage; // { panel, key } shown last; panel null = hub, key = block/view
  let prepared = null; // taken before a view resets, used by the next capture
  let pageGhost = null;
  const viewTiles = new Map(); // a view page's key -> the tile that opened it

  function hubTile(section, panel) {
    return panel && document.querySelector(`.page-tile[data-section="${section.id}"][data-route="${panel.dataset.route}"]`);
  }

  // Before the router swaps pages (or a view opens): what to animate from.
  // opener is the view tile clicked, if any.
  function capturePage(panel, section, opener = null) {
    if (prepared) {
      const m = prepared;
      prepared = null;
      return m;
    }
    const dir = direction;
    direction = null;
    const from = lastPage;
    const key = `${panel?.dataset.route ?? ''}/${(panel && currentRouteView(panel)?.dataset.route) ?? ''}`;
    lastPage = { panel, key };
    if (!dir || !from || from.key === key || !section || !ready) return null;
    pageGhost?.wrap.remove();
    pageGhost = null;
    section.getAnimations().forEach((a) => a.cancel());
    if (opener) viewTiles.set(key, opener);
    const tile = dir === 'push' ? rectOf(opener || (from.panel === null ? hubTile(section, panel) : null)) : null;
    // Back to the hub: the block's tile; back from a view: the view's tile.
    const closeTile = dir === 'pop' ? (panel === null ? hubTile(section, from.panel) : viewTiles.get(from.key)) : null;
    return { dir, closeTile, tile, snap: snapshot(section) };
  }

  // A tile, sidebar link or breadcrumb: up to the hub, or back to the block, is a pop.
  function prepareNavigation(panel, section) {
    direction = !panel || panel === lastPage?.panel ? 'pop' : 'push';
    prepared = capturePage(panel, section);
  }

  // The old page fades out early instead of being covered by an opaque sheet.
  function pushOrPop(section, m) {
    const off = innerWidth - section.getBoundingClientRect().left;
    const parallax = -innerWidth * PARALLAX;
    const timing = { ...NAV, fill: 'forwards' };
    document.body.appendChild(m.snap.wrap);
    if (m.dir === 'push') {
      m.snap.wrap.style.zIndex = '-1';
      holdBottomBar(section.animate([{ transform: `translateX(${off}px)` }, { transform: 'none' }], NAV));
      holdCrumbShift(section, off, NAV, 'X');
      return m.snap.wrap.animate([
        { transform: 'none', filter: 'brightness(1)', opacity: 1 },
        { opacity: 0, offset: .4 },
        { transform: `translateX(${parallax}px)`, filter: DIM, opacity: 0 },
      ], timing);
    }
    m.snap.wrap.style.zIndex = '5';
    holdBottomBar(section.animate([
      { transform: `translateX(${parallax}px)`, filter: DIM, opacity: 0 },
      { opacity: 0, offset: .3 },
      { transform: 'none', filter: 'brightness(1)', opacity: 1 },
    ], NAV));
    holdCrumbShift(section, parallax, NAV, 'X');
    return m.snap.wrap.animate([
      { transform: 'none', opacity: 1 },
      { opacity: 0, offset: .5 },
      { transform: `translateX(${off}px)`, opacity: 0 },
    ], timing);
  }

  // Launch: the old page zooms past and fades while this one rises.
  function launch(section, m) {
    m.snap.wrap.style.zIndex = '-1';
    document.body.appendChild(m.snap.wrap);
    const rise = innerHeight - Math.max(section.getBoundingClientRect().top, 0);
    holdBottomBar(section.animate([{ transform: `translateY(${rise}px)` }, { transform: 'none' }], NAV));
    holdCrumbShift(section, rise, NAV, 'Y');
    return m.snap.wrap.animate([
      { transform: 'none', filter: 'brightness(1)', opacity: 1 },
      { opacity: 0, offset: .4 },
      { transform: 'scale(1.12)', filter: 'brightness(.55)', opacity: 0 },
    ], { ...ZOOM, fill: 'forwards' });
  }

  // Back to the tile: the page sinks away; the hub settles in from zoomed.
  function settle(section, m) {
    m.snap.wrap.style.zIndex = '5';
    document.body.appendChild(m.snap.wrap);
    const sink = innerHeight - Math.max(m.snap.top, 0);
    const middle = screenMiddle(section);
    holdBottomBar(section.animate([
      { transformOrigin: middle, transform: 'scale(1.1)', filter: 'brightness(.55)', opacity: 0 },
      { transformOrigin: middle, transform: 'none', filter: 'brightness(1)', opacity: 1 },
    ], DISMISS));
    holdCrumbScale(section, 1.1, DISMISS);
    return m.snap.wrap.animate([
      { transform: 'none', opacity: 1 },
      { opacity: 0, offset: .5 },
      { transform: `translateY(${sink}px)`, opacity: 0 },
    ], { ...DISMISS, fill: 'forwards' });
  }

  // After the swap (router's showSectionPage, or a view's click).
  function playPage(panel, section, m) {
    if (!m) return;
    requestAnimationFrame(() => {
      try {
        let anim;
        if (m.tile) anim = launch(section, m);
        else if (rectOf(m.closeTile)) anim = settle(section, m);
        else anim = pushOrPop(section, m);
        pageGhost = m.snap;
        const done = () => { if (pageGhost === m.snap) { m.snap.wrap.remove(); pageGhost = null; } };
        anim.finished.then(done, done);
      } catch {
        m.snap?.wrap.remove();
      }
    });
  }

  // ── 7. Feedback ───────────────────────────────────────────────────────────

  // Restarts a one-shot animation class on el and clears it when it ends.
  function playClass(el, name) {
    el.classList.remove(name);
    void el.offsetWidth;
    el.classList.add(name);
    el.addEventListener('animationend', () => el.classList.remove(name), { once: true });
  }

  // An emoji button grows while its action runs, then bounces back.
  function iconBusy(btn) {
    btn.classList.remove('icon-settle');
    btn.classList.add('icon-busy');
  }

  function iconSettle(btn) {
    btn.classList.remove('icon-busy');
    playClass(btn, 'icon-settle');
  }

  // Staggered fade/slide-in, the index-th block after the first.
  function enterPanel(panel, index) {
    panel.style.setProperty('--enter-index', index);
    panel.classList.add('panel-enter');
  }

  // Confetti burst, like iMessage's celebration. Colours are the chart tokens.
  const CONFETTI_COLOURS = ['--chart-good', '--chart-blue', '--chart-purple', '--chart-warn', '--chart-cyan', '--chart-indigo', '--chart-bad'];
  const CONFETTI_COUNT = 160;
  const CONFETTI_MS = 3000;

  function confetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelector('.confetti-canvas')?.remove();
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const colours = CONFETTI_COLOURS.map((name) => chartColor(name)).filter(Boolean);
    // Pieces start above the top edge and drift down, swaying and spinning.
    const pieces = Array.from({ length: CONFETTI_COUNT }, () => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 2,
      vy: 2 + Math.random() * 3,
      size: 6 + Math.random() * 6,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      sway: Math.random() * Math.PI * 2,
      colour: colours[Math.floor(Math.random() * colours.length)],
    }));
    const start = performance.now();
    function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.min(1, (CONFETTI_MS - t) / 500); // fades over the last half second
      pieces.forEach((p) => {
        p.sway += 0.05;
        p.x += p.vx + Math.sin(p.sway);
        p.y += p.vy;
        p.angle += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.colour;
        // cos(sway) flattens the piece, so it looks like it's flipping.
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.sway)));
        ctx.restore();
      });
      if (t < CONFETTI_MS) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  // Confetti's opposite: three red pulses round the screen's edge and a
  // wrong-password shake of the open form (else the page). Shown under reduced motion too.
  function warn() {
    const target = document.querySelector('.modal:not([hidden]) .modal-card') || document.getElementById('dashboard');
    if (target) playClass(target, 'warning-shake');
    document.querySelector('.warning-pulse')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'warning-pulse';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.addEventListener('animationend', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  installStyles();
  window.addEventListener('pagereveal', onPageReveal);

  window.Motion = Object.freeze({
    init,
    capturePage,
    prepareNavigation,
    playPage,
    setDirection(dir) { direction = dir; },
    iconBusy,
    iconSettle,
    enterPanel,
    confetti,
    warn,
  });
})();
