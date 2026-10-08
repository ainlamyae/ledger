// Confetti burst, like iMessage's celebration effect. Colours are the chart tokens.

const CONFETTI_COLOURS = ['--chart-good', '--chart-blue', '--chart-purple', '--chart-warn', '--chart-cyan', '--chart-indigo', '--chart-bad'];
const CONFETTI_COUNT = 160;
const CONFETTI_MS = 3000;

function celebrateWithConfetti() {
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
    // Fade out over the last half second.
    ctx.globalAlpha = Math.min(1, (CONFETTI_MS - t) / 500);
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
