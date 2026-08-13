// Lays out each landing-page group's feature nodes in a ring around its hub
// (position: absolute, left/top computed here — never transform, since
// .node-graph-node is its own .node-graph-tooltip child's containing block
// once that tooltip is position: fixed, and a transform would hijack that;
// see the CSS comment on .node-graph-node), then draws the SVG lines from
// hub to each node, and wires tap-to-toggle for the tooltip on touch
// devices — hover/focus already reveal it via CSS alone. Purely decorative/
// presentational: runs on every load regardless of sign-in state, and
// touches nothing else on the page. Below 640px (assets/style/styles.css's
// matching breakpoint) both the ring layout and the connecting lines are
// skipped entirely — that breakpoint's own CSS falls back to a plain
// stacked list instead.

const NODE_RING_BREAKPOINT_PX = 640;
const NODE_RING_MIN_RADIUS = 160;
// Budgeted circumference (px) per node — keeps ~172px-wide pills from
// overlapping as a group's node count grows (Health has roughly double
// Other's count), rather than a single fixed radius that works for one
// group's count and crowds another's.
const NODE_RING_ARC_PER_NODE = 190;

function layoutNodesRadially(graph) {
  const spokes = graph.querySelector('.node-graph-spokes');
  const nodes = [...graph.querySelectorAll('.node-graph-node')];
  if (!spokes || nodes.length === 0) return;

  if (window.innerWidth <= NODE_RING_BREAKPOINT_PX) {
    graph.style.height = '';
    return;
  }

  const n = nodes.length;
  const radius = Math.max(NODE_RING_MIN_RADIUS, (n * NODE_RING_ARC_PER_NODE) / (2 * Math.PI));
  const maxNodeHeight = Math.max(...nodes.map((node) => node.getBoundingClientRect().height));
  const centerX = graph.getBoundingClientRect().width / 2;
  const centerY = radius + maxNodeHeight / 2 + 12;

  graph.style.height = `${Math.round(centerY + radius + maxNodeHeight / 2 + 12)}px`;

  nodes.forEach((node, i) => {
    // Start straight up from the hub, then clockwise — matches how a clock
    // face (and the hub icon itself) reads, rather than starting at 3
    // o'clock the way angle 0 normally would.
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const nodeWidth = node.getBoundingClientRect().width;
    const nodeHeight = node.getBoundingClientRect().height;
    node.style.left = `${Math.round(centerX + radius * Math.cos(angle) - nodeWidth / 2)}px`;
    node.style.top = `${Math.round(centerY + radius * Math.sin(angle) - nodeHeight / 2)}px`;
  });
}

function drawNodeGraphLines(graph) {
  const svg = graph.querySelector('.node-graph-lines');
  const hub = graph.querySelector('.node-graph-hub');
  const nodes = graph.querySelectorAll('.node-graph-node');
  if (!svg || !hub || nodes.length === 0) return;

  const graphRect = graph.getBoundingClientRect();
  if (graphRect.width === 0 || graphRect.height === 0) return;

  svg.setAttribute('viewBox', `0 0 ${graphRect.width} ${graphRect.height}`);
  svg.innerHTML = '';

  const hubRect = hub.getBoundingClientRect();
  const hubX = hubRect.left + hubRect.width / 2 - graphRect.left;
  const hubY = hubRect.top + hubRect.height / 2 - graphRect.top;

  nodes.forEach((node) => {
    const nodeRect = node.getBoundingClientRect();
    const nodeX = nodeRect.left + nodeRect.width / 2 - graphRect.left;
    const nodeY = nodeRect.top + nodeRect.height / 2 - graphRect.top;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', hubX);
    line.setAttribute('y1', hubY);
    line.setAttribute('x2', nodeX);
    line.setAttribute('y2', nodeY);
    svg.appendChild(line);
  });
}

// Fixed-positions a node's tooltip in the viewport (in px, not relative to
// its own ring position) — opens downward when there's room, else flips
// above the node, and clamps horizontally so it never runs off either edge
// of the viewport. No "row below" concept to dodge here (unlike the old
// wrapped-grid layout): a ring only ever has one node at a given position,
// nothing else to cover.
function positionNodeTooltip(node) {
  const tooltip = node.querySelector('.node-graph-tooltip');
  if (!tooltip) return;

  const margin = 10;
  const nodeRect = node.getBoundingClientRect();
  const tooltipWidth = tooltip.offsetWidth || 260;
  const tooltipHeight = tooltip.offsetHeight || 100;

  const fitsBelowViewport = (window.innerHeight - nodeRect.bottom) >= tooltipHeight + margin;
  const openUpward = !fitsBelowViewport && nodeRect.top >= tooltipHeight + margin;
  const top = openUpward ? nodeRect.top - tooltipHeight - margin : nodeRect.bottom + margin;

  const idealLeft = nodeRect.left + nodeRect.width / 2 - tooltipWidth / 2;
  const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - tooltipWidth - margin));

  tooltip.style.top = `${Math.max(margin, top)}px`;
  tooltip.style.left = `${left}px`;
}

function initLandingGraphs() {
  const graphs = document.querySelectorAll('.node-graph');
  if (graphs.length === 0) return;

  const redrawAll = () => graphs.forEach((g) => {
    layoutNodesRadially(g);
    drawNodeGraphLines(g);
  });
  redrawAll();

  // A fresh reflow can shift node positions without changing the .node-graph
  // element's own box size (which is what ResizeObserver below watches for)
  // — e.g. the emoji/system font swap-in on first paint — so a couple of
  // short delayed redraws catch that without polling indefinitely.
  setTimeout(redrawAll, 250);
  setTimeout(redrawAll, 1000);
  window.addEventListener('load', redrawAll);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(redrawAll, 100);
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => redrawAll());
    graphs.forEach((g) => ro.observe(g));
  }

  // Hover/:focus-visible already reveal a node's tooltip via CSS alone, but
  // its fixed-position placement is computed here (not in CSS) — so it can
  // flip above the node and clamp to the viewport instead of covering
  // whichever row wraps beneath it. Click also toggles a persistent
  // `.is-open` state, which is what makes this work as tap-to-reveal on a
  // touch device (no hover there, and a tap both focuses and clicks).
  document.querySelectorAll('.node-graph-node').forEach((node) => {
    node.addEventListener('mouseenter', () => positionNodeTooltip(node));
    node.addEventListener('focus', () => positionNodeTooltip(node));
    node.addEventListener('click', () => {
      const wasOpen = node.classList.contains('is-open');
      document.querySelectorAll('.node-graph-node.is-open').forEach((n) => {
        if (n !== node) n.classList.remove('is-open');
      });
      node.classList.toggle('is-open', !wasOpen);
      if (!wasOpen) positionNodeTooltip(node);
    });
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.node-graph-node')) return;
    document.querySelectorAll('.node-graph-node.is-open').forEach((n) => n.classList.remove('is-open'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.node-graph-node.is-open').forEach((n) => n.classList.remove('is-open'));
  });
}

// Same reason app.js registers its start-up step this way: on a section page
// this file arrives after DOMContentLoaded has been and gone.
if (window.ledgerSectionPage) window.ledgerSectionPage.onBoot(initLandingGraphs);
else document.addEventListener('DOMContentLoaded', initLandingGraphs);
