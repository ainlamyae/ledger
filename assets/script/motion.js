// Windows/iOS-style motion: a form grows out of the button that opened it and
// minimizes back into it on close; pages push and pop. Writes stay synchronous.

// Critically damped spring (no overshoot), as iOS navigation.
const MOTION_SPRING = 'linear(0, .079 5%, .236 10%, .403 15%, .551 20%, .671 25%, .764 30%, .833 35%, .883 40%, .944 50%, .974 60%, .988 70%, .995 80%, 1)';
// Restore decelerates out of the button; minimize accelerates into it.
const MOTION_GROW = 'cubic-bezier(.2, .9, .3, 1)';
const MOTION_SHRINK = 'cubic-bezier(.55, 0, .8, .4)';
const MOTION_OPENER = 'button, a, tr, .page-tile, [role="button"]';
const motionOpeners = new WeakMap(); // modal -> element that opened it
const motionGhosts = new Map(); // modal -> its closing ghost
let motionLastPress = null; // { el, at }
let motionPageDir = null; // 'push' | 'pop', set by the router
let motionLastPage; // { panel, key } shown last; panel null = hub, key = block/view
let motionPrepared = null; // taken before a view resets, used by showSectionPage
const motionPageTiles = new Map(); // a view page's key -> the tile that opened it

function motionRect(el) {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 };
}

// Box `on` shrunk evenly (no squash) with its on-screen part centred on `at`,
// as a minimized window over its taskbar icon. Origin is on's top-left.
function motionMinimized(at, on) {
  const top = Math.max(on.top, 0);
  const bottom = Math.min(on.top + on.height, innerHeight);
  const s = Math.max(Math.min(at.width / on.width, 1), 0.03);
  const cx = on.left + on.width / 2;
  const cy = (top + bottom) / 2;
  const x = at.left + at.width / 2 - on.left - s * (cx - on.left);
  const y = at.top + at.height / 2 - on.top - s * (cy - on.top);
  return { transform: `translate(${x}px, ${y}px) scale(${s})`, borderRadius: `${Math.max(at.radius, 6) / s}px` };
}

// Overlay backdrops (glass blur on wide screens) fade with their card.
function motionBackdrop(el, show, fill = 'none') {
  const cs = getComputedStyle(el);
  const frames = [
    { backgroundColor: 'rgba(0, 0, 0, 0)', backdropFilter: 'none' },
    { backgroundColor: cs.backgroundColor, backdropFilter: cs.backdropFilter },
  ];
  return el.animate(show ? frames : frames.reverse(), { duration: 300, easing: 'ease', fill });
}

function motionZoomIn(modal, from) {
  const card = modal.querySelector('.modal-card');
  if (!card || modal.hidden) return;
  card.getAnimations().forEach((a) => a.cancel());
  if (!modal.classList.contains('form-page')) motionBackdrop(modal, true);
  const on = card.getBoundingClientRect();
  const frames = from
    ? [
      { transformOrigin: '0 0', ...motionMinimized(from, on), opacity: 0 },
      { opacity: 1, offset: .08 },
      { transformOrigin: '0 0', transform: 'none', borderRadius: getComputedStyle(card).borderRadius, opacity: 1 },
    ]
    : [
      { transform: 'translateY(24px) scale(.96)', opacity: 0 },
      { transform: 'none', opacity: 1 },
    ];
  card.animate(frames, from ? { duration: 380, easing: MOTION_GROW } : { duration: 400, easing: MOTION_SPRING });
}

// A copy of the card left where it was, since the real one is gone at once.
function motionGhost(modal) {
  const card = modal.querySelector('.modal-card');
  const r = card && card.getBoundingClientRect();
  if (!r?.width || !r.height) return null;
  const cs = getComputedStyle(card);
  const ghost = card.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    maxWidth: 'none', maxHeight: 'none', margin: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '1000',
    background: cs.background, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, padding: cs.padding,
    color: cs.color, font: cs.font,
  });
  let backdrop = null;
  if (!modal.classList.contains('form-page')) {
    const ms = getComputedStyle(modal);
    backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '999', pointerEvents: 'none',
      backgroundColor: ms.backgroundColor, backdropFilter: ms.backdropFilter,
    });
    document.body.appendChild(backdrop);
  }
  document.body.appendChild(ghost);
  return { ghost, backdrop, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, started: false };
}

function motionRemoveGhost(modal) {
  const g = motionGhosts.get(modal);
  if (!g) return;
  motionGhosts.delete(modal);
  g.ghost.remove();
  g.backdrop?.remove();
}

function motionZoomOut(modal, g) {
  if (motionGhosts.get(modal) !== g) return;
  g.started = true;
  const done = () => { if (motionGhosts.get(modal) === g) motionRemoveGhost(modal); };
  if (g.backdrop) motionBackdrop(g.backdrop, false, 'forwards');
  const to = g.target || motionRect(motionOpeners.get(modal));
  const anim = g.ghost.animate(to
    ? [
      { transformOrigin: '0 0', transform: 'none', opacity: 1 },
      { opacity: 1, offset: .85 },
      { transformOrigin: '0 0', ...motionMinimized(to, g.rect), opacity: 0 },
    ]
    : [
      { transform: 'none', opacity: 1 },
      { transform: 'translateY(40px) scale(.97)', opacity: 0 },
    ], to ? { duration: 320, easing: MOTION_SHRINK, fill: 'forwards' } : { duration: 300, easing: MOTION_SPRING, fill: 'forwards' });
  anim.finished.then(done, done);
}

function motionOpen(modal) {
  const press = motionLastPress;
  const opener = press && performance.now() - press.at < 1000 && !modal.contains(press.el) ? press.el : null;
  // Closed and reopened in one go (a save): no animation either way.
  const pending = motionGhosts.get(modal);
  if (pending && !pending.started) {
    motionRemoveGhost(modal);
    return null;
  }
  motionRemoveGhost(modal);
  if (opener) motionOpeners.set(modal, opener);
  return () => motionZoomIn(modal, opener ? motionRect(opener) : null);
}

function motionClose(modal) {
  motionRemoveGhost(modal);
  modal.querySelector('.modal-card')?.getAnimations().forEach((a) => a.cancel());
  const g = motionGhost(modal);
  if (!g) return null;
  // Closed by a click inside it (✕): shrinks into that button, measured before it goes.
  const press = motionLastPress;
  if (press && performance.now() - press.at < 1000 && modal.contains(press.el)) g.target = motionRect(press.el);
  motionGhosts.set(modal, g);
  return () => motionZoomOut(modal, g);
}

// Every open and close goes through each modal's `hidden`, wherever it's set.
function initMotion() {
  if (initMotion.done || typeof Element.prototype.animate !== 'function') return;
  initMotion.done = true;
  const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
  document.addEventListener('click', (event) => {
    const el = event.target.closest?.(MOTION_OPENER);
    if (el) motionLastPress = { el, at: performance.now() };
  }, true);
  document.querySelectorAll('.modal').forEach((modal) => {
    Object.defineProperty(modal, 'hidden', {
      configurable: true,
      get() { return native.get.call(this); },
      set(value) {
        const changed = !!value !== native.get.call(this);
        let after = null;
        // Motion must never stop the write itself.
        try { if (changed) after = value ? motionClose(this) : motionOpen(this); } catch { after = null; }
        native.set.call(this, value);
        if (after) requestAnimationFrame(() => { try { after(); } catch { motionRemoveGhost(this); } });
      },
    });
  });
}

// Pages. Opening from the hub grows out of the tile, closing to the hub
// minimizes into it, page to page is an iOS push/pop over a copy of the old one.
let motionPageGhost = null;

function motionTile(section, panel) {
  return panel && document.querySelector(`.page-tile[data-section="${section.id}"][data-route="${panel.dataset.route}"]`);
}

// What's on screen now, as a fixed copy (canvases redrawn), clipped to the viewport.
function motionPageSnapshot(section) {
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
    copy.querySelectorAll('.action-bar').forEach((bar) => bar.classList.remove('action-bar')); // phone bars stay put
    const from = el.querySelectorAll('canvas');
    copy.querySelectorAll('canvas').forEach((c, i) => {
      try { c.width = from[i].width; c.height = from[i].height; c.getContext('2d').drawImage(from[i], 0, 0); } catch { /* blank is fine */ }
    });
  });
  return { wrap, box: { left: r.left, top: 0, width: r.width, height: innerHeight, radius: 0 } };
}

function motionClearPage(section) {
  motionPageGhost?.wrap.remove();
  motionPageGhost = null;
  section.getAnimations().forEach((a) => a.cancel());
}

// Before the router swaps pages (or a view opens): what to animate from.
// `opener` is the view tile clicked, if any.
function motionPageBefore(panel, section, opener = null) {
  if (motionPrepared) {
    const m = motionPrepared;
    motionPrepared = null;
    return m;
  }
  const dir = motionPageDir;
  motionPageDir = null;
  const from = motionLastPage;
  // Block plus view; a form's own steps don't make a new page.
  const key = `${panel?.dataset.route ?? ''}/${(panel && currentRouteView(panel)?.dataset.route) ?? ''}`;
  motionLastPage = { panel, key };
  if (!dir || !from || from.key === key || !section || !initMotion.done) return null;
  motionClearPage(section);
  if (opener) motionPageTiles.set(key, opener);
  const grow = dir === 'push' ? motionRect(opener || (from.panel === null ? motionTile(section, panel) : null)) : null;
  // Back to the hub: into the block's tile; back from a view: into the view's tile.
  const closeTile = dir === 'pop' ? (panel === null ? motionTile(section, from.panel) : motionPageTiles.get(from.key)) : null;
  return { dir, from, closeTile, tile: grow, snap: grow ? null : motionPageSnapshot(section) };
}

function motionPageSlide(section, m) {
  const w = innerWidth;
  const push = m.dir === 'push';
  m.snap.wrap.style.zIndex = push ? '-1' : '5'; // the page on top is the one moving most
  document.body.appendChild(m.snap.wrap);
  const timing = { duration: 450, easing: MOTION_SPRING };
  section.animate(push
    ? [{ transform: `translateX(${w}px)` }, { transform: 'none' }]
    : [{ transform: `translateX(${-w / 3}px)`, opacity: .6 }, { transform: 'none', opacity: 1 }], timing);
  return m.snap.wrap.animate(push
    ? [{ transform: 'none', opacity: 1 }, { transform: `translateX(${-w / 3}px)`, opacity: .4 }]
    : [{ transform: 'none' }, { transform: `translateX(${w}px)` }], { ...timing, fill: 'forwards' });
}

// After the swap (router's showSectionPage).
function motionPage(panel, section, m) {
  if (!m) return;
  requestAnimationFrame(() => {
    let anim = null;
    try {
      if (m.tile) {
        // Hub -> page: the page grows out of the tile it was opened from.
        const on = section.getBoundingClientRect();
        section.animate([
          { transformOrigin: '0 0', ...motionMinimized(m.tile, on), opacity: 0 },
          { opacity: 1, offset: .08 },
          { transformOrigin: '0 0', transform: 'none', borderRadius: '0', opacity: 1 },
        ], { duration: 380, easing: MOTION_GROW });
        return;
      }
      const tile = motionRect(m.closeTile);
      if (tile) {
        // Back to the hub or a view's block: minimizes into its tile, the tiles settle in.
        document.body.appendChild(m.snap.wrap);
        anim = m.snap.wrap.animate([
          { transformOrigin: '0 0', transform: 'none', opacity: 1 },
          { opacity: 1, offset: .85 },
          { transformOrigin: '0 0', ...motionMinimized(tile, m.snap.box), opacity: 0 },
        ], { duration: 340, easing: MOTION_SHRINK, fill: 'forwards' });
        [...section.querySelectorAll('.page-tile')].filter((t) => t.getClientRects().length).forEach((t, i) => {
          t.animate([{ transform: 'scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }],
            { duration: 320, delay: 120 + Math.min(i, 12) * 20, easing: MOTION_GROW, fill: 'backwards' });
        });
      } else {
        anim = motionPageSlide(section, m);
      }
      motionPageGhost = m.snap;
      const done = () => { if (motionPageGhost === m.snap) motionClearPage(section); };
      anim.finished.then(done, done);
    } catch {
      m.snap?.wrap.remove();
    }
  });
}
