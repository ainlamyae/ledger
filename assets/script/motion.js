// iOS motion: springs, a sheet rising from (and sinking back off) the bottom
// edge — the one motion every form, dialog, and tile-opened page uses to open
// and close — a receding/zooming background, and page-to-page navigation
// push/pop. Every write stays synchronous; animations ride on top (live
// elements, or copies of what left).

// A SwiftUI-style spring (response s, bounce 0-1, launch velocity) as a CSS
// linear() easing plus the time it takes to settle.
function motionSpring(response, bounce = 0, v0 = 0) {
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

const MOTION_NAV = motionSpring(0.4, 0, 6); // push/pop: quick launch, soft landing
const MOTION_ZOOM = motionSpring(0.48, 0.16, 3); // the background's zoom-past/settle: a hint of overshoot
const MOTION_DISMISS = motionSpring(0.38, 0, 4); // closing: no overshoot
const MOTION_POP = motionSpring(0.38, 0.28); // toast

const motionGhosts = new Map(); // modal -> its closing copy
let motionPageDir = null; // 'push' | 'pop', set by the router
let motionLastPage; // { panel, key } shown last; panel null = hub, key = block/view
let motionPrepared = null; // taken before a view resets, used by showSectionPage
const motionPageTiles = new Map(); // a view page's key -> the tile that opened it
let motionPageGhost = null;

function motionRect(el) {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 };
}

function motionBox(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// The page's own background, so a moving layer is opaque like an iOS screen.
function motionSurface() {
  const cs = getComputedStyle(document.body);
  return { backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage, backgroundAttachment: 'fixed' };
}

// Inline styles for the length of an animation, then put back.
function motionWhile(el, styles, anim) {
  const before = Object.keys(styles).map((k) => [k, el.style[k]]);
  Object.assign(el.style, styles);
  const restore = () => before.forEach(([k, v]) => { el.style[k] = v; });
  anim.finished.then(restore, restore);
  return anim;
}

// The bottom bar (on a phone, `.action-bar`) is `position: fixed` so it's meant
// to stay put on screen regardless of what's animating — but it's also a DOM
// descendant of the page or form card being animated here, and a `transform` or
// `filter` on an ancestor (even mid-animation, even set by the Web Animations
// API rather than CSS) makes THAT ancestor the fixed element's containing block
// instead of the viewport, and composites it into the blur/dim filter too. Left
// alone, the real bar gets dragged along with the page/card's motion. Detaching
// it to <body> for the motion's length keeps it exactly where it always is.
function motionDetachOverlays() {
  const bar = document.querySelector('.action-bar');
  if (!bar) return () => {};
  const { parentNode, nextSibling } = bar;
  document.body.appendChild(bar);
  return () => { (nextSibling ? parentNode?.insertBefore(bar, nextSibling) : parentNode?.appendChild(bar)); };
}

// What's on screen in `section` now, as a fixed copy (canvases redrawn).
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
    // The breadcrumb never moves — not even shrinking/dimming as part of "the old
    // page recedes" — so it's invisible in this copy rather than cloned live.
    // visibility (not display/removal) keeps its layout space, so the rest of the
    // copy still lines up with the real section's own layout underneath it.
    if (copy.matches('.page-crumb')) copy.style.visibility = 'hidden';
    const from = el.querySelectorAll('canvas');
    copy.querySelectorAll('canvas').forEach((c, i) => {
      try { c.width = from[i].width; c.height = from[i].height; c.getContext('2d').drawImage(from[i], 0, 0); } catch { /* blank is fine */ }
    });
  });
  return { wrap, box: { left: r.left, top: 0, width: r.width, height: innerHeight } };
}

// The viewport's middle in `el`'s own coordinates, for scaling around the screen's centre.
function motionMiddle(el) {
  const r = el.getBoundingClientRect();
  return `${innerWidth / 2 - r.left}px ${innerHeight / 2 - r.top}px`;
}

function motionSection() {
  return window.ledgerSectionPage && typeof routedSectionId === 'function' ? document.getElementById(routedSectionId(null)) : null;
}

// Runs the exact inverse of a translateX/Y(d) animation on root's own
// breadcrumb (if it has one), so the two cancel out and the crumb visually
// never moves — without reparenting it out of the DOM, which turned out to
// have its own timing and layout pitfalls (a wrong/stale element picked up,
// or the rest of the page reflowing into the space it briefly left behind).
function motionCounterCrumb(root, d, timing, axis = 'Y') {
  const crumb = root?.querySelector('.page-crumb');
  if (!crumb) return;
  crumb.animate([{ transform: `translate${axis}(${-d}px)` }, { transform: 'none' }], timing);
}

// Same idea, for a scale(s) animation anchored at a transform-origin (the
// "page comes forward"/"hub settles in" effects): the inverse scale, anchored
// at the same absolute screen point expressed in the crumb's own coordinates
// (motionMiddle is relative to whichever element's own box it's given),
// cancels the parent's scale exactly.
function motionCounterCrumbScale(root, scale, timing) {
  const crumb = root?.querySelector('.page-crumb');
  if (!crumb) return;
  const origin = motionMiddle(crumb);
  crumb.animate([
    { transformOrigin: origin, transform: `scale(${1 / scale})` },
    { transformOrigin: origin, transform: 'none' },
  ], timing);
}

// ── Forms and dialogs ──

// Overlay backdrops (glass blur on wide screens) fade with their card.
function motionBackdrop(el, show, timing) {
  const cs = getComputedStyle(el);
  const frames = [
    { backgroundColor: 'rgba(0, 0, 0, 0)', backdropFilter: 'blur(0px)' },
    { backgroundColor: cs.backgroundColor, backdropFilter: cs.backdropFilter === 'none' ? 'blur(0px)' : cs.backdropFilter },
  ];
  return el.animate(show ? frames : frames.reverse(), { ...timing, fill: show ? 'none' : 'forwards' });
}

// The page behind a form page recedes, as iOS's screen under a zoom or sheet.
function motionRecede(snap) {
  if (!snap) return;
  snap.wrap.style.zIndex = '-1';
  document.body.appendChild(snap.wrap);
  const anim = snap.wrap.animate([
    { transform: 'none', filter: 'brightness(1)', borderRadius: '0', opacity: 1 },
    { transform: 'scale(.92)', filter: 'brightness(.6)', borderRadius: '24px', opacity: 1, offset: .6 },
    { transform: 'scale(.9)', filter: 'brightness(.5)', borderRadius: '24px', opacity: 0 },
  ], { ...MOTION_ZOOM, easing: 'linear', fill: 'forwards' });
  const done = () => snap.wrap.remove();
  anim.finished.then(done, done);
}

function motionZoomIn(modal, behind) {
  const card = modal.querySelector('.modal-card');
  if (!card || modal.hidden) return behind?.wrap.remove();
  card.getAnimations().forEach((a) => a.cancel());
  const page = modal.classList.contains('form-page');
  if (page) motionRecede(behind);
  else {
    behind?.wrap.remove();
    motionBackdrop(modal, true, MOTION_DISMISS);
  }
  // An iOS sheet rising from the bottom edge, whatever opened it. #form-crumb
  // is a sibling of .modal-card (router.js's updateFormPage inserts it
  // straight into the modal, not the card), so it's never actually part of
  // this transform and needs no counter-animation of its own.
  const dst = motionBox(card);
  const rise = innerHeight - Math.max(dst.top, 0);
  const restoreBar = motionDetachOverlays();
  card.animate([{ transform: `translateY(${rise}px)` }, { transform: 'none' }], MOTION_NAV)
    .finished.then(restoreBar, restoreBar);
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
  ghost.querySelectorAll('.action-bar').forEach((bar) => bar.classList.remove('action-bar')); // phone bar stays put
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    maxWidth: 'none', maxHeight: 'none', margin: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '1000',
    background: cs.background, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, padding: cs.padding,
    color: cs.color, font: cs.font,
  });
  let backdrop = null;
  const page = modal.classList.contains('form-page');
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
  return { ghost, backdrop, page, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, started: false };
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
  if (g.backdrop) motionBackdrop(g.backdrop, false, MOTION_DISMISS);
  // The page comes forward again from behind the form.
  const section = g.page && motionSection();
  if (section && section.getClientRects().length) {
    const middle = motionMiddle(section);
    const restoreBar = motionDetachOverlays();
    section.animate([
      { transformOrigin: middle, transform: 'scale(.92)', filter: 'brightness(.6)' },
      { transformOrigin: middle, transform: 'none', filter: 'brightness(1)' },
    ], MOTION_DISMISS).finished.then(restoreBar, restoreBar);
    motionCounterCrumbScale(section, .92, MOTION_DISMISS);
  }
  // An iOS sheet dismissed down the screen, whatever opened it.
  const anim = g.ghost.animate([{ transform: 'none' }, { transform: `translateY(${innerHeight - Math.max(g.rect.top, 0)}px)` }],
    { ...MOTION_DISMISS, fill: 'forwards' });
  anim.finished.then(done, done);
}

function motionOpen(modal) {
  // Closed and reopened in one go (a save): no animation either way.
  const pending = motionGhosts.get(modal);
  if (pending && !pending.started) {
    motionRemoveGhost(modal);
    return null;
  }
  motionRemoveGhost(modal);
  // The page as it is, for receding behind the form once it takes the page's place.
  const section = motionSection();
  const behind = section && section.getClientRects().length ? motionPageSnapshot(section) : null;
  return () => motionZoomIn(modal, behind);
}

function motionClose(modal) {
  motionRemoveGhost(modal);
  modal.querySelector('.modal-card')?.getAnimations().forEach((a) => a.cancel());
  const g = motionGhost(modal);
  if (!g) return null;
  motionGhosts.set(modal, g);
  return () => motionZoomOut(modal, g);
}

// ── Toast: springs up from the bottom, sinks away ──

function motionToast(toast, show) {
  const cs = getComputedStyle(toast);
  if (show) {
    return () => toast.animate([
      { transform: 'translate(-50%, 140%) scale(.9)', opacity: 0 },
      { opacity: 1, offset: .3 },
      { transform: 'translate(-50%, 0) scale(1)', opacity: 1 },
    ], MOTION_POP);
  }
  const r = toast.getBoundingClientRect();
  if (!r.width) return null;
  const ghost = toast.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  ghost.inert = true;
  ghost.hidden = false;
  Object.assign(ghost.style, { pointerEvents: 'none', bottom: cs.bottom });
  document.body.appendChild(ghost);
  return () => {
    const anim = ghost.animate([
      { transform: 'translate(-50%, 0) scale(1)', opacity: 1 },
      { transform: 'translate(-50%, 60%) scale(.94)', opacity: 0 },
    ], { duration: 260, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    const done = () => ghost.remove();
    anim.finished.then(done, done);
  };
}

// Every open and close goes through each modal's (and the toast's) `hidden`, wherever it's set.
function initMotion() {
  if (initMotion.done || typeof Element.prototype.animate !== 'function') return;
  initMotion.done = true;
  const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
  const hook = (el, before, onError) => Object.defineProperty(el, 'hidden', {
    configurable: true,
    get() { return native.get.call(this); },
    set(value) {
      const changed = !!value !== native.get.call(this);
      let after = null;
      // Motion must never stop the write itself.
      try { if (changed) after = before(this, value); } catch { after = null; }
      native.set.call(this, value);
      if (after) requestAnimationFrame(() => { try { after(); } catch { onError(this); } });
    },
  });
  document.querySelectorAll('.modal').forEach((modal) => {
    hook(modal, (m, value) => (value ? motionClose(m) : motionOpen(m)), motionRemoveGhost);
  });
  document.querySelectorAll('.toast').forEach((toast) => hook(toast, (t, value) => motionToast(t, !value), () => {}));
}

// ── Pages ──
// From the hub a page rises as a sheet while the hub zooms past; back, it
// sinks away as the hub settles in. Page to page is a navigation push.

function motionTile(section, panel) {
  return panel && document.querySelector(`.page-tile[data-section="${section.id}"][data-route="${panel.dataset.route}"]`);
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
  const tile = dir === 'push' ? motionRect(opener || (from.panel === null ? motionTile(section, panel) : null)) : null;
  // Back to the hub: into the block's tile; back from a view: into the view's tile.
  const closeTile = dir === 'pop' ? (panel === null ? motionTile(section, from.panel) : motionPageTiles.get(from.key)) : null;
  return { dir, closeTile, tile, snap: motionPageSnapshot(section) };
}

// The page that's moving gets the page's own background, a soft edge shadow and
// rounded corners while it does, so it reads as one opaque screen.
const motionScreen = (shadow = '0 0 0 transparent') => ({ ...motionSurface(), boxShadow: shadow });

function motionPagePush(section, m) {
  const left = section.getBoundingClientRect().left;
  const off = innerWidth - left;
  const parallax = -innerWidth * 0.3;
  const dim = 'brightness(.72)';
  const edge = '-16px 0 40px rgba(0, 0, 0, .18)';
  const timing = { ...MOTION_NAV, fill: 'forwards' };
  document.body.appendChild(m.snap.wrap);
  if (m.dir === 'push') {
    m.snap.wrap.style.zIndex = '-1';
    const restoreBar = motionDetachOverlays();
    motionWhile(section, motionScreen(edge), section.animate([{ transform: `translateX(${off}px)` }, { transform: 'none' }], MOTION_NAV))
      .finished.then(restoreBar, restoreBar);
    motionCounterCrumb(section, off, MOTION_NAV, 'X');
    return m.snap.wrap.animate([{ transform: 'none', filter: 'brightness(1)' }, { transform: `translateX(${parallax}px)`, filter: dim }], timing);
  }
  Object.assign(m.snap.wrap.style, { zIndex: '5', ...motionScreen(edge) });
  const restoreBar = motionDetachOverlays();
  motionWhile(section, motionScreen(), section.animate([
    { transform: `translateX(${parallax}px)`, filter: dim },
    { transform: 'none', filter: 'brightness(1)' },
  ], MOTION_NAV)).finished.then(restoreBar, restoreBar);
  motionCounterCrumb(section, parallax, MOTION_NAV, 'X');
  return m.snap.wrap.animate([{ transform: 'none' }, { transform: `translateX(${off}px)` }], timing);
}

// After the swap (router's showSectionPage, or a view's click).
function motionPage(panel, section, m) {
  if (!m) return;
  requestAnimationFrame(() => {
    let anim = null;
    try {
      if (m.tile) {
        // Launch: the old page zooms past and dims while this one rises as a sheet.
        m.snap.wrap.style.zIndex = '-1';
        document.body.appendChild(m.snap.wrap);
        anim = m.snap.wrap.animate([
          { transform: 'none', filter: 'brightness(1)', opacity: 1 },
          { transform: 'scale(1.12)', filter: 'brightness(.55)', opacity: 0 },
        ], { ...MOTION_ZOOM, fill: 'forwards' });
        const rise = innerHeight - Math.max(section.getBoundingClientRect().top, 0);
        const restoreBar = motionDetachOverlays();
        motionWhile(section, motionScreen('0 24px 60px rgba(0, 0, 0, .25)'),
          section.animate([{ transform: `translateY(${rise}px)` }, { transform: 'none' }], MOTION_NAV))
          .finished.then(restoreBar, restoreBar);
        motionCounterCrumb(section, rise, MOTION_NAV);
      } else if (motionRect(m.closeTile)) {
        // Back to the tile: the page sinks away down the screen; the hub settles in from zoomed.
        Object.assign(m.snap.wrap.style, { zIndex: '5', ...motionScreen('0 24px 60px rgba(0, 0, 0, .25)') });
        document.body.appendChild(m.snap.wrap);
        const sink = innerHeight - Math.max(m.snap.box.top, 0);
        anim = m.snap.wrap.animate([{ transform: 'none' }, { transform: `translateY(${sink}px)` }],
          { ...MOTION_DISMISS, fill: 'forwards' });
        const middle = motionMiddle(section);
        const restoreBar = motionDetachOverlays();
        section.animate([
          { transformOrigin: middle, transform: 'scale(1.1)', filter: 'brightness(.55)', opacity: 0 },
          { transformOrigin: middle, transform: 'none', filter: 'brightness(1)', opacity: 1 },
        ], MOTION_DISMISS).finished.then(restoreBar, restoreBar);
        motionCounterCrumbScale(section, 1.1, MOTION_DISMISS);
      } else {
        anim = motionPagePush(section, m);
      }
      motionPageGhost = m.snap;
      const done = () => { if (motionPageGhost === m.snap) { m.snap.wrap.remove(); motionPageGhost = null; } };
      anim.finished.then(done, done);
    } catch {
      m.snap?.wrap.remove();
    }
  });
}
