// motion.js — every animation in Ledger, in one place: the timing, the CSS
// motion rules, and the code that plays them. Loaded in <head> (index.html and
// every section stub) so its rules and the cross-page transition are in before
// the first paint. Other files only call window.Motion; none animates itself.
//
//   1. Timing         springs and curves
//   2. Stylesheet     transitions, keyframes, view transitions
//   3. Page loads     down, up or sideways between pages
//   4. Forms          opening is down, closing up
//   5. Toast
//   6. Pages          hub, page and view (router.js): down, up or sideways
//   7. Feedback       busy icons, panel entry, confetti, warning
//
// Two motions only: down/up a level (by the breadcrumb) and sideways on the
// same level. Only content moves; the background, bars and breadcrumb stay still.

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

  const POP = spring(0.38, 0.28); // toast
  // Every move (down, up, sideways): one even timing, slow enough to watch.
  const SWIPE = { duration: 1500, easing: 'cubic-bezier(.45, 0, .2, 1)' };

  // Curves for CSS transitions (micro-interactions).
  const EASE = 'cubic-bezier(.2, .8, .2, 1)'; // quick start, soft settle
  const EASE_BOUNCE = 'cubic-bezier(.3, 1.3, .5, 1)'; // springs back past rest
  // Same-rank sections, left to right: the nav's order, Other (account menu) last.
  // Listed here because a section page has no nav yet when it's revealed.
  const SECTION_ORDER = ['health', 'finance', 'track', 'other'];

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

/* The breadcrumb stays over whatever moves (under the bars, 9+). */
.page-crumb { position: relative; z-index: 8; }

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

/* Page loads, by html[data-move] (set below): down, up or sideways (--move-side
   1 to the right, -1 to the left). The background, logo row (with the sidebar's toggle), sidebar,
   bars, account, breadcrumb and footer are named out and held still. */
@view-transition { navigation: auto; }
#app-backdrop { view-transition-name: app-backdrop; }
.nav { view-transition-name: app-nav; }
.side-nav { view-transition-name: app-side-nav; }
.header-actions { view-transition-name: app-account; }
.page-crumb { view-transition-name: app-crumb; }
.action-bar { view-transition-name: app-action-bar; }
.site-footer { view-transition-name: app-footer; }
/* The logo row on a wide screen: logo, name and the sidebar's toggle. */
header h1 { view-transition-name: app-logo; }
${['app-backdrop', 'app-nav', 'app-side-nav', 'app-account', 'app-crumb', 'app-action-bar', 'app-footer', 'app-logo'].map((n) => `
::view-transition-group(${n}) { animation: none; }
::view-transition-old(${n}), ::view-transition-new(${n}) { animation: none; mix-blend-mode: normal; }`).join('')}
/* The background never moves. What moves is the page's content alone (body, named
   app-page while moving, see-through), never the whole page: a whole-page image
   carries the canvas colour with it. Both pages are marked while moving (the
   leaving one data-move-out, from pageswap), at once (a colour transition would
   leave it solid when captured). */
html:is([data-move], [data-move-out]) { view-transition-name: none; background: transparent; }
html:is([data-move], [data-move-out]) body { view-transition-name: app-page; background: transparent; transition: none; }
html:is([data-move], [data-move-out]) body::before { visibility: hidden; }
::view-transition-group(app-page) { animation: none; }
/* The leaving page where it was scrolled to (--move-old-y). */
::view-transition-old(app-page) { inset-block-start: calc(var(--move-old-y, 0) * -1px); }
/* Held parts are drawn over the moving page, so the full-screen backdrop goes under it. */
::view-transition-group(app-backdrop) { z-index: -1; }
/* The arriving page's own held parts and background stay hidden while it moves in,
   so they never ride along (a section page builds them after the move has begun);
   the leaving page's, held still, show until it lands. */
html[data-move] :is(#app-backdrop, header h1, .nav, .side-nav, .header-actions, .page-crumb, .action-bar, .site-footer) { visibility: hidden; }
::view-transition-old(app-page), ::view-transition-new(app-page) {
  animation-duration: ${SWIPE.duration}ms;
  animation-timing-function: ${SWIPE.easing};
  animation-fill-mode: both;
  mix-blend-mode: normal;
}
html[data-move="down"]::view-transition-old(app-page) { animation-name: down-out; }
html[data-move="down"]::view-transition-new(app-page) { animation-name: down-in; }
html[data-move="up"]::view-transition-old(app-page) { animation-name: up-out; z-index: 1; }
html[data-move="up"]::view-transition-new(app-page) { animation-name: up-in; }
html[data-move="sideways"]::view-transition-old(app-page) { animation-name: sideways-out; }
html[data-move="sideways"]::view-transition-new(app-page) { animation-name: sideways-in; }
/* A section page still building when revealed: both pages hold until it's built (enterPage). */
html[data-move-wait]::view-transition-old(app-page), html[data-move-wait]::view-transition-new(app-page) { animation-play-state: paused; }
/* By the screen, not the page image (as tall as the page). */
@keyframes down-in { from { transform: translateY(100vh); } }
@keyframes down-out { to { transform: translateY(-100vh); } }
@keyframes up-in { from { transform: translateY(-100vh); } }
@keyframes up-out { to { transform: translateY(100vh); } }
@keyframes sideways-in { from { transform: translateX(calc(var(--move-side) * 100vw)); } }
@keyframes sideways-out { to { transform: translateX(calc(var(--move-side) * -100vw)); } }
`;

  function installStyles() {
    if (document.getElementById('motion-styles')) return;
    const style = document.createElement('style');
    style.id = 'motion-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ── 3. Page loads ─────────────────────────────────────────────────────────
  // Each page notes its address as it leaves; the next reads it to know which
  // way it came. No Navigation API needed, so Safari moves too.

  const FROM_KEY = 'ledger_motion_from';

  // Address parts under the app root: ['health', 'physique'], [] for home.
  function addressParts(url) {
    const root = new URL('.', document.baseURI).pathname;
    const path = new URL(url, location.href).pathname;
    return (path.startsWith(root) ? path.slice(root.length) : path).split('/').filter(Boolean);
  }

  // The move between two addresses: sideways between sections (menu order),
  // else down to a deeper address or up to a shorter one.
  function moveBetween(fromUrl, toUrl) {
    const from = addressParts(fromUrl);
    const to = addressParts(toUrl);
    const a = SECTION_ORDER.indexOf(from[0]);
    const b = SECTION_ORDER.indexOf(to[0]);
    if (a !== -1 && b !== -1 && a !== b) return { move: 'sideways', side: b > a ? 1 : -1 };
    return { move: to.length < from.length ? 'up' : 'down', side: 1 };
  }

  function noteLeaving() {
    try { sessionStorage.setItem(FROM_KEY, JSON.stringify({ url: location.href, y: Math.round(scrollY), at: Date.now() })); } catch { /* no storage: no motion */ }
  }

  // Where this load came from (a reload, or nothing recent: no motion).
  function arrivedFrom() {
    try {
      const note = JSON.parse(sessionStorage.getItem(FROM_KEY) || 'null');
      sessionStorage.removeItem(FROM_KEY);
      if (!note || Date.now() - note.at > 10000 || note.url === location.href) return null;
      return note;
    } catch {
      return null;
    }
  }

  const cameFrom = arrivedFrom();
  let loadMove = cameFrom && moveBetween(cameFrom.url, location.href);
  let leftAtY = cameFrom?.y || 0;
  const isSectionPage = SECTION_ORDER.includes(addressParts(location.href)[0]);
  let pendingMove = loadMove && isSectionPage ? loadMove : null;
  // A section page builds itself after load, before or after the reveal.
  let revealed = !('onpagereveal' in window); // no reveal event coming: act on build
  let built = false;
  let viewMoving = false; // a page transition is carrying this load

  function markMove(m) {
    document.documentElement.dataset.move = m.move;
    document.documentElement.style.setProperty('--move-side', m.side);
    document.documentElement.style.setProperty('--move-old-y', leftAtY);
  }

  function clearMove() {
    delete document.documentElement.dataset.move;
    delete document.documentElement.dataset.moveWait;
    document.documentElement.style.removeProperty('--move-side');
    document.documentElement.style.removeProperty('--move-old-y');
  }

  // Only where a page transition will read it; cleared when it ends (failsafe).
  if (loadMove && revealed === false) {
    markMove(loadMove);
    setTimeout(clearMove, SWIPE.duration + 4000);
  }

  // The transition moves old and new together; a page still building holds
  // both where they are until it's built, so the new one never comes in blank.
  function onPageReveal(event) {
    revealed = true;
    viewMoving = false;
    // Shown again from the back/forward cache: its own load ran long ago, so
    // the way it came is read now (a fresh load already took the note).
    const again = arrivedFrom();
    if (again) {
      loadMove = moveBetween(again.url, location.href);
      leftAtY = again.y || 0;
      markMove(loadMove);
      built = true;
      pendingMove = null;
    }
    const vt = event.viewTransition;
    if (!vt) clearMove();
    else if (!loadMove) vt.skipTransition();
    else {
      viewMoving = true;
      pendingMove = null;
      if (isSectionPage && !built) {
        document.documentElement.dataset.moveWait = '';
        setTimeout(() => delete document.documentElement.dataset.moveWait, 3000);
      }
      vt.finished.then(clearMove, clearMove);
    }
    if (built) moveBuiltPage();
  }

  // Called by section-page.js once the page is built.
  function enterPage() {
    built = true;
    delete document.documentElement.dataset.moveWait;
    if (revealed) moveBuiltPage();
  }

  // No page transition (an older browser): the new page's cards move in on their own.
  function moveBuiltPage() {
    const m = pendingMove;
    pendingMove = null;
    const screen = !viewMoving && m && currentScreen();
    if (screen) moveIn(screen.matches('.modal') ? screen.querySelector('.modal-card') || screen : screen, m.move, m.side);
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  function currentSection() {
    return window.ledgerSectionPage && typeof routedSectionId === 'function' ? document.getElementById(routedSectionId(null)) : null;
  }

  const removeOnFinish = (anim, el) => { const done = () => el.remove(); anim.finished.then(done, done); };

  // ── The two motions, by the breadcrumb: down a level the new screen rises
  // from the bottom as the old one goes off the top; up a level the reverse.
  // On the same level, sideways: the new one sweeps in from the right (going on
  // in the order) or the left (going back), the old one out the other side.
  // Only cards and fields move: the breadcrumb, the bars and the background stay
  // put, and on top.

  const STILL = '.page-crumb, .action-bar';
  const GHOST_Z = '5'; // over the page, under the breadcrumb (8) and the bars (9+)

  // What moves in root: everything but STILL. Ancestors of a STILL element are
  // split into their children, so no transform ever carries the fixed bar.
  function movers(root) {
    const out = [];
    [...root.children].forEach((el) => {
      if (!el.getClientRects().length || el.matches(STILL)) return;
      if (el.querySelector(STILL)) out.push(...movers(el));
      else out.push(el);
    });
    return out;
  }

  // Script animations only; CSS ones (busy icons, hover) are left alone.
  function stopMoves(root) {
    root.getAnimations({ subtree: true })
      .filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))
      .forEach((a) => a.cancel());
  }

  // Where new content starts, just off screen: down from the bottom edge, up
  // from the top edge, sideways from the right (side 1) or left (side -1) edge.
  function startOffset(move, side, rect) {
    if (move === 'down') return { axis: 'Y', d: innerHeight - Math.max(rect.top, 0) };
    if (move === 'up') return { axis: 'Y', d: -Math.max(rect.bottom, 0) };
    return { axis: 'X', d: side > 0 ? innerWidth - Math.max(rect.left, 0) : -Math.max(rect.right, 0) };
  }

  // New content in. A form card moves by top/left, not transform, so its fixed bar stays.
  function moveIn(root, move, side = 1) {
    const { axis, d } = startOffset(move, side, root.getBoundingClientRect());
    if (root.matches('.modal-card')) {
      const prop = axis === 'Y' ? 'top' : 'left';
      const cs = getComputedStyle(root);
      const base = parseFloat(cs[prop]) || 0;
      const wasStatic = cs.position === 'static';
      if (wasStatic) root.style.position = 'relative';
      const anim = root.animate([{ [prop]: `${base + d}px` }, { [prop]: `${base}px` }], SWIPE);
      const done = () => { if (wasStatic) root.style.position = ''; };
      anim.finished.then(done, done);
      return;
    }
    const frames = [{ transform: `translate${axis}(${d}px)` }, { transform: 'none' }];
    movers(root).forEach((el) => el.animate(frames, SWIPE));
  }

  // The old screen's copy out: down, off the top under the new one; up, off the
  // bottom over it; sideways, off the other side.
  function moveOut(snap, move, side = 1) {
    document.body.appendChild(snap.wrap);
    snap.wrap.style.zIndex = move === 'up' ? GHOST_Z : '-1';
    const to = move === 'down' ? `translateY(${-innerHeight}px)`
      : move === 'up' ? `translateY(${innerHeight}px)`
        : `translateX(${-side * innerWidth}px)`;
    const anim = snap.wrap.animate([{ transform: 'none' }, { transform: to }], { ...SWIPE, fill: 'forwards' });
    removeOnFinish(anim, snap.wrap);
    return anim;
  }

  // In a copy the breadcrumb and action bar keep their room (none, if fixed) unseen.
  function hideStill(copy, live) {
    const pick = (root) => [root, ...root.querySelectorAll(STILL)].filter((el) => el.matches(STILL));
    const lives = pick(live);
    pick(copy).forEach((el, i) => {
      const fixed = lives[i] && getComputedStyle(lives[i]).position === 'fixed';
      el.classList.remove('action-bar');
      if (fixed) el.style.display = 'none';
      else el.style.visibility = 'hidden';
    });
  }

  // What's on screen: the open form page, else the section page.
  function currentScreen() {
    const form = document.querySelector('html[data-form-page] .modal.form-page:not([hidden])');
    if (form) return form;
    const section = currentSection();
    return section && section.getClientRects().length ? section : null;
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
      hideStill(copy, el);
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

  // A form is a level down: its card rises as the screen under it goes off the top.
  function openCard(modal, behind) {
    const card = modal.querySelector('.modal-card');
    if (!card || modal.hidden) return behind?.wrap.remove();
    stopMoves(card);
    if (modal.classList.contains('form-page') && behind) moveOut(behind, 'down');
    else {
      behind?.wrap.remove();
      fadeBackdrop(modal, true, SWIPE);
    }
    moveIn(card, 'down');
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
    hideStill(ghost, card);
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    const page = modal.classList.contains('form-page');
    Object.assign(ghost.style, {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      maxWidth: 'none', maxHeight: 'none', margin: '0', overflow: 'hidden', pointerEvents: 'none',
      // A form page's copy stays under the bars; an overlay's over its backdrop.
      zIndex: page ? GHOST_Z : '1000',
      background: cs.background, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, padding: cs.padding,
      color: cs.color, font: cs.font,
    });
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

  // Closing is a level up: the card goes off the bottom as its parent (page or form) comes down.
  function closeCard(modal, g) {
    if (ghosts.get(modal) !== g) return;
    g.started = true;
    if (g.backdrop) fadeBackdrop(g.backdrop, false, SWIPE);
    const screen = g.page && currentScreen();
    if (screen) {
      const root = screen.matches('.modal') ? screen.querySelector('.modal-card') : screen;
      stopMoves(root);
      moveIn(root, 'up');
    }
    const anim = g.ghost.animate([{ transform: 'none' }, { transform: `translateY(${innerHeight - Math.max(g.top, 0)}px)` }],
      { ...SWIPE, fill: 'forwards' });
    const done = () => { if (ghosts.get(modal) === g) dropGhost(modal); };
    anim.finished.then(done, done);
  }

  function beforeOpen(modal) {
    // Closed and reopened in one go (a save): no animation either way.
    const pending = ghosts.get(modal);
    dropGhost(modal);
    if (pending && !pending.started) return null;
    const screen = currentScreen();
    const behind = screen ? snapshot(screen) : null;
    return () => openCard(modal, behind);
  }

  function beforeClose(modal) {
    dropGhost(modal);
    modal.querySelector('.modal-card')?.getAnimations().forEach((a) => a.cancel());
    const g = ghostOf(modal);
    if (!g) return null;
    ghosts.set(modal, g);
    return () => closeCard(modal, g);
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
  // Hub, page and view, by the breadcrumb: hub → page and page → view are down,
  // the reverse up; two pages, or two views, on the same level go sideways in
  // their order on screen.

  let armed = false; // the router's next swap moves (never a first show)
  let lastPage; // { panel, view } shown last; panel null = hub
  let prepared = null; // taken before a view resets, used by the next capture
  let pageGhost = null;

  // 1 when b comes after a on screen, -1 before.
  function sideOf(a, b) {
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
  }

  function pageMove(from, to) {
    if (from.panel !== to.panel) {
      if (!from.panel) return { move: 'down', side: 1 };
      if (!to.panel) return { move: 'up', side: 1 };
      return { move: 'sideways', side: sideOf(from.panel, to.panel) };
    }
    if (from.view === to.view) return null;
    if (!from.view) return { move: 'down', side: 1 };
    if (!to.view) return { move: 'up', side: 1 };
    return { move: 'sideways', side: sideOf(from.view, to.view) };
  }

  // Before the router swaps pages (or a view opens): what to move from.
  // view: the view button being opened (null for the page itself).
  function capturePage(panel, section, view = panel ? currentRouteView(panel) : null) {
    if (prepared) {
      const m = prepared;
      prepared = null;
      return m;
    }
    const go = armed;
    armed = false;
    const from = lastPage;
    lastPage = { panel, view: view || null };
    const m = go && from && section && ready && pageMove(from, lastPage);
    if (!m) return null;
    pageGhost?.wrap.remove();
    pageGhost = null;
    stopMoves(section);
    return { ...m, snap: snapshot(section) };
  }

  // A tile, sidebar link or breadcrumb: captured before the views reset.
  function prepareNavigation(panel, section) {
    armed = true;
    prepared = capturePage(panel, section, null);
  }

  // After the swap (router's showSectionPage, or a view's click).
  function playPage(panel, section, m) {
    if (!m) return;
    requestAnimationFrame(() => {
      try {
        const anim = moveOut(m.snap, m.move, m.side);
        moveIn(section, m.move, m.side);
        pageGhost = m.snap;
        const done = () => { if (pageGhost === m.snap) pageGhost = null; };
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
    // Arrived by a page move: the page sweeps in whole, its blocks already shown.
    if (loadMove) return;
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
  // Also on a link's click: the next page may start before pagehide fires.
  window.addEventListener('pagehide', noteLeaving);
  // Leaving with a page transition: see-through before it's captured.
  window.addEventListener('pageswap', (event) => {
    if (event.viewTransition) document.documentElement.dataset.moveOut = '';
  });
  // Back from the back/forward cache: no longer leaving.
  window.addEventListener('pageshow', () => delete document.documentElement.dataset.moveOut);
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (link && link.origin === location.origin) noteLeaving();
  });

  window.Motion = Object.freeze({
    init,
    capturePage,
    prepareNavigation,
    playPage,
    enterPage,
    arm() { armed = true; },
    moveIn,
    iconBusy,
    iconSettle,
    enterPanel,
    confetti,
    warn,
  });
})();
