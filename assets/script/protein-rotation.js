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
// today. Wired up by initProteinRotationPanel(), called from app.js.

// Default span of the From/To date pickers on first load — otherwise
// identical in meaning to the old fixed 7-day lookback.
const PROTEIN_ROTATION_LOOKBACK_DEFAULT_DAYS = 7;

// Every Nutrition Facts row with a Protein % set — that field is the sole
// "is this tracked" switch (nutrition.js's refreshNutrition/openNutritionForm).
function trackedProteinSources() {
  return allNutritionEntries
    .filter((n) => n.proteinPercent !== null && n.proteinPercent > 0)
    .map((n) => ({ name: n.name, proteinPercent: n.proteinPercent }));
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
// target does, with no separate ratio/scale-factor bookkeeping. Sorted
// highest target first, so the ingredients the plan leans on most heavily
// lead the chart rather than being scattered by how close each is to plan.
function computeProteinRotationRows(from, to) {
  const lookbackDays = datesInRange(from, to).length;
  const sources = trackedProteinSources();
  const proteinByName = actualProteinEatenBySource(from, to);
  const dailyProteinTarget = getProteinTargetG(getDatedWellnessEntries());
  const weeklyProteinTarget = dailyProteinTarget * 7;
  // Total protein target across the whole lookback window (not per
  // ingredient) — the denominator for "what % of my total target did this
  // ingredient's actual consumption cover this window."
  const totalTargetForWindow = dailyProteinTarget * lookbackDays;

  return sources
    .map((s) => {
      const actualProteinG = proteinByName.get(s.name.trim().toLowerCase()) || 0;
      const targetProteinG = (s.proteinPercent / 100) * weeklyProteinTarget * (lookbackDays / 7);
      return {
        name: s.name,
        actualProteinG: Math.round(actualProteinG * 10) / 10,
        targetProteinG: Math.round(targetProteinG * 10) / 10,
        proteinPercent: s.proteinPercent,
        actualPercentOfTotalTarget: totalTargetForWindow > 0 ? Math.round((actualProteinG / totalTargetForWindow) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.targetProteinG - a.targetProteinG);
}

// Enough px per row that every tracked ingredient's label fits on screen at
// once (no autoSkip-dropped labels) rather than being squeezed into a fixed
// box sized for a handful of rows.
const PROTEIN_ROTATION_ROW_HEIGHT = 32;
const PROTEIN_ROTATION_MIN_HEIGHT = 200;

let proteinRotationChart = null;

function renderProteinRotationChart({ from, to }) {
  const ctx = document.getElementById('protein-rotation-chart');
  const rows = computeProteinRotationRows(from, to);

  const labels = rows.map((r) => r.name);
  const actualData = rows.map((r) => r.actualProteinG);
  const targetData = rows.map((r) => r.targetProteinG);
  const barColors = labels.map((_, i) => `hsl(${Math.round((i * 360) / labels.length)}, 65%, 55%)`);

  const hasData = labels.length > 0;
  ctx.parentElement.style.height = `${Math.max(PROTEIN_ROTATION_MIN_HEIGHT, rows.length * PROTEIN_ROTATION_ROW_HEIGHT + 60)}px`;

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
        x: { beginAtZero: true, max: maxValue, ticks: { callback: maskedUnitTick('g protein', 1) } },
        y: { afterFit: fixTrendYAxisWidth, ticks: { autoSkip: false } },
      },
    },
  });
}

// Set by initProteinRotationPanel() to the getter initDateRangeControl()
// (charts.js) returns — read by app.js to re-render once wellness/nutrition
// data finishes loading after the panel's own initial (data-less) render.
let getProteinRotationDateRange = () => ({ from: null, to: null });

function initProteinRotationPanel() {
  // Shared From/To wiring (charts.js) — same one insight.js uses for the
  // Wellness Insight panel.
  getProteinRotationDateRange = initDateRangeControl('protein-rotation-date-from', 'protein-rotation-date-to', PROTEIN_ROTATION_LOOKBACK_DEFAULT_DAYS, () => {
    renderProteinRotationChart(getProteinRotationDateRange());
  });
  renderProteinRotationChart(getProteinRotationDateRange());
}
