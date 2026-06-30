// "Protein Source Rotation" panel: for every Nutrition Facts ingredient that
// has a Protein % value set (nutrition.js), shows a horizontal bar — actual
// protein eaten from that ingredient in the lookback window vs. a live
// target — so a low/empty bar flags "you haven't had this one, eat it."
// Protein % is the share of your protein target this ingredient should
// cover (e.g. 10 for "turkey = 10% of my protein"); since that target
// (charts.js's getProteinTargetG) already updates live with weight/height/
// activity, each ingredient's gram target moves with it automatically —
// no separate serving-size or ratio-scaling math needed. Actual protein
// eaten is summed straight from the Health Log's own Calculate breakdown,
// independent of whatever Nutrition Facts' Amount/Calories happen to say
// today. Beside the bars, a two-ring donut splits the same sources by share
// of protein actually eaten — outer ring the 4 weeks ending on the To date,
// inner ring the last week of it — so a source's short-term share can be read
// against its medium-term one. Wired up by initProteinRotationPanel(), called
// from app.js.

// Default span of the From/To date pickers on first load — otherwise
// identical in meaning to the old fixed 7-day lookback.
const PROTEIN_ROTATION_LOOKBACK_DEFAULT_DAYS = 7;

// Every Nutrition Facts row with a Protein % set — that field is the sole
// "is this tracked" switch (nutrition.js's refreshNutrition/openNutritionForm).
const PROTEIN_UNCLASSIFIED_LABEL = 'Unclassified';

function trackedProteinSources() {
  return allNutritionEntries
    .filter((n) => n.proteinPercent !== null && n.proteinPercent > 0)
    .map((n) => ({
      name: n.name,
      classification: n.classification || PROTEIN_UNCLASSIFIED_LABEL,
      proteinPercent: n.proteinPercent,
    }));
}

// Protein actually eaten per tracked ingredient over the lookback window,
// summed straight from each Calculate breakdown item's own logged protein —
// same source and date filter food-insight.js's aggregateFoodIntake uses,
// but simpler here: no serving size or ingredient-weight conversion is
// needed, only the protein grams each breakdown item already carries.
function actualProteinEatenBySource(from, to) {
  const proteinByName = new Map();
  getDatedWellnessEntries()
    .filter((e) => e.category === 'Calories; Protein' && e.date >= from && e.date <= to)
    .forEach((e) => {
      (e.breakdown || []).forEach((item) => {
        const key = String(item.name || '').trim().toLowerCase();
        if (!key) return;
        proteinByName.set(key, (proteinByName.get(key) || 0) + (item.protein || 0));
      });
    });
  return proteinByName;
}

// One row per tracked ingredient: actual protein (g) eaten this window vs.
// a target scaled live off the current protein target —
//   targetProteinG = (proteinPercent / 100) × weeklyProteinTarget × (lookbackDays / 7)
// — so every ingredient's target rises or falls automatically as the real
// target does, with no separate ratio/scale-factor bookkeeping. Sorted by
// remaining gap (target minus actual) descending — the source with the most
// left to eat leads the chart (a to-do-list read: eat this one next), while
// anything already at or past its target sinks toward the bottom.
function computeProteinRotationRows(from, to) {
  const lookbackDays = datesInRange(from, to).length;
  const sources = trackedProteinSources();
  const proteinByName = actualProteinEatenBySource(from, to);
  // Midpoint of the target band: a share-of-target split needs one
  // denominator, and the middle of the band is the fairest one to divide up
  // (a floor-based split would under-target every source, a top-end one would
  // over-target every source).
  const dailyProteinTarget = getProteinTargetG(getDatedWellnessEntries());
  const weeklyProteinTarget = dailyProteinTarget * 7;
  // Total protein target across the whole lookback window (not per
  // ingredient) — the denominator for "what % of my total target did this
  // ingredient's actual consumption cover this window."
  const totalTargetForWindow = dailyProteinTarget * lookbackDays;

  const rows = sources.map((s) => {
    const actualProteinG = proteinByName.get(s.name.trim().toLowerCase()) || 0;
    const targetProteinG = (s.proteinPercent / 100) * weeklyProteinTarget * (lookbackDays / 7);
    return {
      name: s.name,
      classification: s.classification,
      actualProteinG: Math.round(actualProteinG * 10) / 10,
      targetProteinG: Math.round(targetProteinG * 10) / 10,
      proteinPercent: s.proteinPercent,
      actualPercentOfTotalTarget: totalTargetForWindow > 0 ? Math.round((actualProteinG / totalTargetForWindow) * 1000) / 10 : 0,
    };
  });

  return sortByClassificationThenGap(rows);
}

// Sources cluster under their classification, so a whole group reads as one
// block in the bars and one arc in the donut. The old flat "most left to eat
// first" ordering is kept inside each group, and the groups themselves lead
// with whichever has the largest combined gap — so the to-do-list read survives
// grouping instead of being traded away for it. Unclassified sinks to the
// bottom: it's a gap in the catalog, not a food group.
function sortByClassificationThenGap(rows) {
  const gap = (r) => r.targetProteinG - r.actualProteinG;

  const groupGap = new Map();
  rows.forEach((r) => groupGap.set(r.classification, (groupGap.get(r.classification) || 0) + gap(r)));

  return [...rows].sort((a, b) => {
    if (a.classification === b.classification) return gap(b) - gap(a);
    const aUnknown = a.classification === PROTEIN_UNCLASSIFIED_LABEL;
    const bUnknown = b.classification === PROTEIN_UNCLASSIFIED_LABEL;
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
    return groupGap.get(b.classification) - groupGap.get(a.classification);
  });
}

// One hue per classification, lightness stepped within it — the group reads as
// a block while two sources inside it stay distinguishable. Shared by the bars
// and the donut, so a source keeps one colour everywhere in the panel.
function proteinRotationPalette(rows) {
  const classifications = [...new Set(rows.map((r) => r.classification))];
  const hueFor = (c) => Math.round((classifications.indexOf(c) * 360) / classifications.length);
  const seen = new Map();

  const barColors = rows.map((r) => {
    const n = seen.get(r.classification) || 0;
    seen.set(r.classification, n + 1);
    // Wraps every 4 so a large group never fades out or drifts into the next
    // classification's shade.
    return `hsl(${hueFor(r.classification)}, 65%, ${62 - (n % 4) * 9}%)`;
  });

  return {
    barColors,
    legend: classifications.map((name) => ({ name, color: `hsl(${hueFor(name)}, 65%, 62%)` })),
  };
}

// Rings of the rotation donut beside the bars, outermost first — Chart.js
// draws datasets[0] as the outer ring. Both end on the To date the bars use,
// so the outer ring is the medium-term rotation and the inner one is the
// most recent week inside it.
const PROTEIN_ROTATION_DONUT_RINGS = [
  { label: 'Last 4 weeks', days: 28 },
  { label: 'Last week', days: 7 },
];

// The `days` days ending on toIso inclusive.
function proteinRotationWindow(toIso, days) {
  const to = dateFromIso(toIso);
  if (!toIso || Number.isNaN(to.getTime())) return { from: null, to: null };
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));
  return { from: isoFromDate(from), to: toIso };
}

let proteinRotationChart = null;
let proteinRotationDonut = null;

// Same source order and colors as the bar chart — one source is one color
// everywhere in the panel, in both rings and in its bar, which is what makes
// the donut readable without a legend of its own. The rings are told apart by
// position (outer = 4 weeks, inner = last week), never by shade.
function renderProteinRotationDonut(rows, barColors, toIso) {
  const ctx = document.getElementById('protein-rotation-donut');
  const labels = rows.map((r) => r.name);

  const rings = PROTEIN_ROTATION_DONUT_RINGS.map((ring) => {
    const { from, to } = proteinRotationWindow(toIso, ring.days);
    const eaten = from ? actualProteinEatenBySource(from, to) : new Map();
    const data = rows.map((r) => Math.round((eaten.get(r.name.trim().toLowerCase()) || 0) * 10) / 10);
    return { ...ring, data, total: data.reduce((sum, v) => sum + v, 0) };
  });

  const hasData = rings.some((ring) => ring.total > 0);

  proteinRotationDonut = upsertChart(proteinRotationDonut, ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: rings.map((ring) => ({ data: ring.data, backgroundColor: barColors })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Without this, hovering one ring also matches the same dataIndex in
      // the other, giving two tooltip lines for a single hover.
      interaction: { mode: 'point' },
      plugins: {
        legend: { display: false },
        title: {
          // Only worth saying when there are sources to log against — with
          // none tracked, the bar chart's own title already explains why.
          display: rows.length > 0 && !hasData,
          text: ['No protein logged from a tracked', 'source in these 4 weeks'],
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: {
          callbacks: {
            // The default title looks up data.labels by dataIndex, which is
            // right for both rings — but the label line below already names the
            // source, so the slice's classification goes here instead.
            title: (items) => rows[items[0].dataIndex].classification,
            label: (item) => {
              const ring = rings[item.datasetIndex];
              const pct = ring.total ? Math.round((item.raw / ring.total) * 1000) / 10 : 0;
              const value = `${item.formattedValue}g protein (${pct}% of the window)`;
              return `${labels[item.dataIndex]} — ${ring.label}: ${privacyMode ? maskDigits(value) : value}`;
            },
          },
        },
      },
    },
  });
}

function renderProteinRotationChart({ from, to }) {
  const ctx = document.getElementById('protein-rotation-chart');
  const rows = computeProteinRotationRows(from, to);

  const labels = rows.map((r) => r.name);
  const actualData = rows.map((r) => r.actualProteinG);
  const targetData = rows.map((r) => r.targetProteinG);
  const { barColors, legend } = proteinRotationPalette(rows);

  // One swatch per classification rather than per source — the shades within a
  // group would only add noise, and the group is what the legend explains.
  renderCategoryLegend('protein-rotation-legend', legend);

  const hasData = labels.length > 0;

  // Chart.js's own "nice number" auto-max often rounds well past the actual
  // data (e.g. real max 8 -> axis max 12) — fit the axis to the real max
  // eaten/target value instead, with a little headroom.
  const maxValue = Math.ceil(Math.max(1, ...actualData, ...targetData)) + 1;

  proteinRotationChart = upsertChart(proteinRotationChart, ctx, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Eaten', data: actualData, backgroundColor: barColors, order: 2 },
        {
          type: 'line',
          label: 'Target',
          data: targetData,
          showLine: false,
          pointStyle: 'line',
          rotation: 90,
          pointRadius: 12,
          borderWidth: 3,
          borderColor: '#dc2626',
          backgroundColor: '#dc2626',
          order: 1,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: !hasData,
          text: 'No ingredients tracked yet — open Nutrition Facts, edit an ingredient, and set its Protein %',
          color: Chart.defaults.color,
          font: { size: 12 },
          padding: { top: 40 },
        },
        tooltip: {
          callbacks: {
            // The default title is the bare source name; naming its group there
            // is what makes a block of same-hue bars self-explanatory.
            title: (items) => {
              const row = rows[items[0].dataIndex];
              return `${row.name} — ${row.classification}`;
            },
            label: (item) => {
              const row = rows[item.dataIndex];
              const pct = item.dataset.label === 'Eaten' ? row.actualPercentOfTotalTarget : row.proteinPercent;
              const pctLabel = item.dataset.label === 'Eaten' ? 'of total target' : 'target';
              const value = `${item.formattedValue}g protein (${pct}% ${pctLabel})`;
              return `${item.dataset.label}: ${privacyMode ? maskDigits(value) : value}`;
            },
          },
        },
      },
      scales: {
        // Ticks are grams; the panel's whole subject is protein, so the axis
        // says "g" and leaves "protein" to the tooltip. Tilted a fixed 45°
        // rather than left to Chart.js, which only rotates once labels
        // actually collide — so the axis doesn't change angle as the range does.
        x: {
          beginAtZero: true,
          max: maxValue,
          ticks: { callback: maskedUnitTick('g', 1), maxRotation: 45, minRotation: 45 },
        },
        y: { afterFit: fixTrendYAxisWidth, ticks: { autoSkip: false } },
      },
    },
  });

  renderProteinRotationDonut(rows, barColors, to);
}

// Set by initProteinRotationPanel() to the getter initDateRangeControl()
// (charts.js) returns — read by app.js to re-render once wellness/nutrition
// data finishes loading after the panel's own initial (data-less) render.
let getProteinRotationDateRange = () => ({ from: null, to: null });

function initProteinRotationPanel() {
  // Shared From/To wiring (charts.js) — same one insight.js uses for the
  // Health Insight panel.
  getProteinRotationDateRange = initDateRangeControl('protein-rotation-date-from', 'protein-rotation-date-to', PROTEIN_ROTATION_LOOKBACK_DEFAULT_DAYS, () => {
    renderProteinRotationChart(getProteinRotationDateRange());
  });
  renderProteinRotationChart(getProteinRotationDateRange());
}
