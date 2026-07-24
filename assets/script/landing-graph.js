// Draws the SVG lines connecting each landing-page group's hub node to its
// feature spokes (assets/style/styles.css's .node-graph rules lay the nodes
// out; this only computes where the lines between them go), and wires
// tap-to-toggle for the description tooltip on touch devices — hover/focus
// already reveal it via CSS alone. Purely decorative/presentational: runs
// on every load regardless of sign-in state, and touches nothing else on
// the page.

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
    const nodeY = nodeRect.top - graphRect.top;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', hubX);
    line.setAttribute('y1', hubY);
    line.setAttribute('x2', nodeX);
    line.setAttribute('y2', nodeY);
    svg.appendChild(line);
  });
}

// Fixed-positions a node's tooltip in the viewport (in px, not relative to
// its wrapped row) so it never lands on top of the row of nodes below it —
// flipping above the node when there's more room there, and clamping
// horizontally so it never runs off either edge of the viewport.
function positionNodeTooltip(node) {
  const tooltip = node.querySelector('.node-graph-tooltip');
  if (!tooltip) return;

  const margin = 10;
  const nodeRect = node.getBoundingClientRect();
  const tooltipWidth = tooltip.offsetWidth || 260;
  const tooltipHeight = tooltip.offsetHeight || 100;

  // A node that isn't in its group's last row has more nodes wrapped
  // directly beneath it — opening downward would cover them, so those
  // always open upward (toward the hub, which always has clear space
  // above it) regardless of how much viewport room is left below.
  const spokes = node.closest('.node-graph-spokes');
  const spokesRect = spokes ? spokes.getBoundingClientRect() : null;
  const hasRowBelow = spokesRect && nodeRect.bottom < spokesRect.bottom - 2;

  const fitsBelowViewport = (window.innerHeight - nodeRect.bottom) >= tooltipHeight + margin;
  const fitsAboveViewport = nodeRect.top >= tooltipHeight + margin;
  const openUpward = (hasRowBelow || !fitsBelowViewport) && fitsAboveViewport;
  const top = openUpward ? nodeRect.top - tooltipHeight - margin : nodeRect.bottom + margin;

  const idealLeft = nodeRect.left + nodeRect.width / 2 - tooltipWidth / 2;
  const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - tooltipWidth - margin));

  tooltip.style.top = `${Math.max(margin, top)}px`;
  tooltip.style.left = `${left}px`;
}

function initLandingGraphs() {
  const graphs = document.querySelectorAll('.node-graph');
  if (graphs.length === 0) return;

  const redrawAll = () => graphs.forEach(drawNodeGraphLines);
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

document.addEventListener('DOMContentLoaded', initLandingGraphs);
