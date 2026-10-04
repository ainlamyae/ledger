// Charts and controls shared by Market, Portfolio and Analysis.

const MARKET_RANGES = [
  { slug: '1d', label: '1d', intraday: '5min' },
  { slug: '1w', label: '1w', intraday: '30min', days: 7 },
  { slug: '1m', label: '1m', months: 1 },
  { slug: '3m', label: '3m', months: 3 },
  { slug: '6m', label: '6m', months: 6 },
  { slug: '1y', label: '1y', months: 12 },
  { slug: '2y', label: '2y', months: 24 },
  { slug: '5y', label: '5y', months: 60 },
  { slug: '10y', label: '10y', months: 120 },
  { slug: 'all', label: 'All' },
];
const MARKET_CHART_MAX_POINTS = 600;

function marketRange(slug) {
  return MARKET_RANGES.find((r) => r.slug === slug) || MARKET_RANGES[5];
}

// First date a daily range shows, or null for All.
function rangeStartDate(range, now = new Date()) {
  const d = new Date(now);
  if (range.days) d.setDate(d.getDate() - range.days);
  else if (range.months) d.setMonth(d.getMonth() - range.months);
  else return null;
  return localIso(d);
}

// The range buttons: the existing .pagination row of .btn, the current one .btn-primary.
function renderRangeButtons(containerId, ranges, activeSlug, onPick, disabled = new Set()) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  ranges.forEach((range) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = range.slug === activeSlug ? 'btn btn-primary' : 'btn';
    btn.textContent = range.label;
    btn.setAttribute('aria-pressed', String(range.slug === activeSlug));
    btn.disabled = disabled.has(range.slug);
    if (btn.disabled) btn.title = "Intraday prices aren't available for TSX on free plans";
    btn.addEventListener('click', () => onPick(range.slug));
    box.appendChild(btn);
  });
}

// Every k-th point (always keeping the last), so 20 years of daily bars stay light.
function downsampleIndices(length, max = MARKET_CHART_MAX_POINTS) {
  if (length <= max) return Array.from({ length }, (_, i) => i);
  const step = Math.ceil(length / max);
  const out = [];
  for (let i = 0; i < length; i += step) out.push(i);
  if (out.at(-1) !== length - 1) out.push(length - 1);
  return out;
}

// Daily bars for a range; TSX ranges older than the daily cache use month-end bars.
function barsForRange(dailyBars, monthlyBars, range) {
  const start = rangeStartDate(range);
  const inRange = start ? dailyBars.filter((b) => b.d >= start) : dailyBars;
  const firstDaily = dailyBars[0]?.d;
  if (!monthlyBars?.length || !firstDaily || (start && firstDaily <= start)) return inRange;
  const older = monthlyBars.filter((b) => b.d < firstDaily && (!start || b.d >= start));
  return [...older, ...inRange];
}

// Line datasets over shared date labels. `series` = [{ label, data, color, dash, hidden, fill }].
function marketLineChart(existing, canvasId, labels, series, { money = null, mask = false, intraday = false } = {}) {
  const ctx = document.getElementById(canvasId);
  const keep = downsampleIndices(labels.length);
  const pick = (arr) => keep.map((i) => arr[i]);
  const valueText = (v) => (money ? formatMoney(v, money, { mask }) : String(Math.round(v * 100) / 100));
  return upsertChart(existing, ctx, {
    type: 'line',
    data: {
      labels: pick(labels),
      datasets: series.map((s) => ({
        label: s.label,
        data: pick(s.data),
        borderColor: s.color,
        backgroundColor: s.fill ? s.fillColor || s.color : s.color,
        borderDash: s.dash ? [6, 4] : [],
        borderWidth: s.width || 2,
        fill: s.fill || false,
        pointRadius: 0,
        pointHitRadius: 6,
        tension: 0,
        spanGaps: true,
        hidden: !!s.hidden,
        order: s.order ?? 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => (Number.isFinite(item.raw) ? `${item.dataset.label}: ${valueText(item.raw)}` : null),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 6,
            maxRotation: 0,
            callback(value) {
              const label = this.getLabelForValue(value);
              return intraday ? label.slice(5, 16) : label.slice(0, 10);
            },
          },
        },
        y: {
          beginAtZero: false,
          afterFit: fixTrendYAxisWidth,
          ticks: { callback: (v) => valueText(v) },
        },
      },
    },
  });
}

// One legend toggle per series that can be switched; redraws via onChange.
function renderSeriesLegend(containerId, series, hiddenSet, onChange) {
  renderCategoryLegend(containerId, series.map((s) => ({ name: s.label, color: s.color })), {
    isHidden: (c) => hiddenSet.has(c.name),
    onToggle: (c) => {
      if (hiddenSet.has(c.name)) hiddenSet.delete(c.name); else hiddenSet.add(c.name);
      onChange();
    },
  });
}

// Market/Analysis/Portfolio status line from a MarketDataError (or any error).
function marketErrorText(err) {
  if (!err) return '';
  if (err.kind === 'missing-key') return `${err.message} (Other → Settings)`;
  return err.message || String(err);
}

function setMarketStatus(id, text) {
  const el = document.getElementById(id);
  el.textContent = text || '';
}

// Change from `back` bars ago, as a fraction; null if too short.
function barChange(bars, back) {
  if (bars.length <= back) return null;
  const now = bars.at(-1).c;
  const then = bars[bars.length - 1 - back].c;
  return then ? now / then - 1 : null;
}

// "+3.2%" green / "−1.4%" red, sign only on negatives.
function setPercentCell(td, value) {
  td.classList.add('num');
  if (value === null || !Number.isFinite(value)) {
    td.textContent = '—';
    return;
  }
  td.textContent = `${(value * 100).toFixed(1)}%`;
  td.classList.add(value < 0 ? 'expense' : 'income');
}
