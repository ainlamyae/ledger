// "Protein Source Rotation" panel: for every Nutrition Group with at least
// one ingredient that has a Protein % value set (health-nutrition.js), shows a
// horizontal bar — actual protein eaten from that group's tracked ingredients
// in the lookback window vs. a live desired figure — so a low/empty bar flags "you
// haven't had this group, eat it." Worked out per ingredient
// (computeProteinRotationRows), then summed per Group for the chart
// (groupProteinRotationRows), each bar stacked by ingredient.
// Protein % is the share of your desired protein this ingredient should
// cover (e.g. 10 for "turkey = 10% of my protein"), scaled so the tracked
// ingredients' shares add up to 100% whatever they were typed as; since that
// desired figure (the top of health-math.js's getProteinDesiredBandG) already updates
// live with body mass/height/activity, each ingredient's desired grams move with it automatically —
// no separate serving-size or ratio-scaling math needed. Actual protein
// eaten is summed straight from Physique's own Calculate breakdown,
// independent of whatever Nutrition's Amount/Calories happen to say
// today. Beside the bars, a three-ring donut splits the same groups by
// share of protein — outermost ring the reference Protein % each source is
// meant to cover, middle ring the 4 weeks ending on the To date, inner ring
// the last week of it — so a source's short-term and medium-term share can
// both be read against what it's actually supposed to be. Wired up by
// initProteinRotationPanel(), called from app.js.

// Every Nutrition row with a Protein % set — that field is the sole
// "is this tracked" switch (health-nutrition.js's refreshNutrition/openNutritionForm).
const PROTEIN_UNCLASSIFIED_LABEL = 'Unclassified';

function trackedProteinSources() {
  return allNutritionEntries
    .filter((n) => n.proteinPercent !== null && n.proteinPercent > 0)
    .map((n) => ({
      name: n.name,
      group: n.group || PROTEIN_UNCLASSIFIED_LABEL,
      proteinPercent: n.proteinPercent,
    }));
}

// Protein actually eaten per tracked ingredient over the lookback window,
// summed straight from each Calculate breakdown item's own logged protein —
// same source and date filter health-insight-food.js's aggregateFoodIntake uses,
// but simpler here: no serving size or ingredient-weight conversion is
// needed, only the protein grams each breakdown item already carries.
function actualProteinEatenBySource(from, to) {
  const proteinByName = new Map();
  physiqueAsHealthEntries()
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
// a desired figure scaled live off the current desired protein —
//   proteinPercent = Protein % / (sum of every tracked Protein %) × 100
//   desiredProteinG = (proteinPercent / 100) × weeklyProteinDesired × (lookbackDays / 7)
// — so every ingredient's desired figure rises or falls automatically as the real
// desired protein does, with no separate ratio/scale-factor bookkeeping. Sorted by
// remaining gap (desired minus actual) descending — the source with the most
// left to eat leads the chart (a to-do-list read: eat this one next), while
// anything already at or past its desired figure sinks toward the bottom.
function computeProteinRotationRows(from, to) {
  const lookbackDays = datesInRange(from, to).length;
  const sources = trackedProteinSources();
  const proteinByName = actualProteinEatenBySource(from, to);
  // The Protein % column is typed freely, so its sum is rarely 100: each
  // share is taken of that sum instead, and together they always cover the
  // whole desired figure.
  const totalPercent = sources.reduce((sum, s) => sum + s.proteinPercent, 0);
  // The top of the desired band: a share-of-desired split needs one
  // denominator, and the full split is what the band's top asks for.
  const dailyProteinDesired = getProteinDesiredBandG(physiqueAsHealthEntries()).max;
  const weeklyProteinDesired = dailyProteinDesired * 7;
  // Total desired protein across the whole lookback window (not per
  // ingredient) — the denominator for "what % of my total desired did this
  // ingredient's actual consumption cover this window."
  const totalDesiredForWindow = dailyProteinDesired * lookbackDays;

  const rows = sources.map((s) => {
    const actualProteinG = proteinByName.get(s.name.trim().toLowerCase()) || 0;
    const proteinPercent = (s.proteinPercent / totalPercent) * 100;
    const desiredProteinG = (proteinPercent / 100) * weeklyProteinDesired * (lookbackDays / 7);
    return {
      name: s.name,
      group: s.group,
      actualProteinG: Math.round(actualProteinG * 10) / 10,
      desiredProteinG: Math.round(desiredProteinG * 10) / 10,
      proteinPercent: Math.round(proteinPercent * 10) / 10,
      actualPercentOfTotalDesired: totalDesiredForWindow > 0 ? Math.round((actualProteinG / totalDesiredForWindow) * 1000) / 10 : 0,
    };
  });

  return sortByGroupThenGap(rows);
}

// Sources cluster under their group, so a whole group reads as one
// block in the bars and one arc in the donut. The old flat "most left to eat
// first" ordering is kept inside each group, and the groups themselves lead
// with whichever has the largest combined gap — so the to-do-list read survives
// grouping instead of being traded away for it. Unclassified sinks to the
// bottom: it's a gap in the catalog, not a food group.
function sortByGroupThenGap(rows) {
  const gap = (r) => r.desiredProteinG - r.actualProteinG;

  const groupGap = new Map();
  rows.forEach((r) => groupGap.set(r.group, (groupGap.get(r.group) || 0) + gap(r)));

  return [...rows].sort((a, b) => {
    if (a.group === b.group) return gap(b) - gap(a);
    const aUnknown = a.group === PROTEIN_UNCLASSIFIED_LABEL;
    const bUnknown = b.group === PROTEIN_UNCLASSIFIED_LABEL;
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
    return groupGap.get(b.group) - groupGap.get(a.group);
  });
}

// The chart's rows: the per-ingredient rows above summed into one per Group,
// so the rotation reads as "eat more fish" rather than "eat more salmon". The
// per-ingredient rows stay as they are — Insight's Protein mode reads those —
// and each group row carries its `sources` so the donut and tooltips can name
// them. A group's desired figure is the sum of its members' Protein %, so the bars
// still add up to the same totals as the ingredients they came from. Most
// left to eat first; Unclassified last, as in sortByGroupThenGap.
function groupProteinRotationRows(rows) {
  const byGroup = new Map();
  rows.forEach((r) => {
    if (!byGroup.has(r.group)) {
      byGroup.set(r.group, {
        name: r.group, group: r.group, sources: [],
        actualProteinG: 0, desiredProteinG: 0, proteinPercent: 0, actualPercentOfTotalDesired: 0,
      });
    }
    const g = byGroup.get(r.group);
    g.sources.push(r.name);
    g.actualProteinG += r.actualProteinG;
    g.desiredProteinG += r.desiredProteinG;
    g.proteinPercent += r.proteinPercent;
    g.actualPercentOfTotalDesired += r.actualPercentOfTotalDesired;
  });

  const round1 = (v) => Math.round(v * 10) / 10;
  const gap = (r) => r.desiredProteinG - r.actualProteinG;
  return [...byGroup.values()]
    .map((g) => ({
      ...g,
      actualProteinG: round1(g.actualProteinG),
      desiredProteinG: round1(g.desiredProteinG),
      proteinPercent: round1(g.proteinPercent),
      actualPercentOfTotalDesired: round1(g.actualPercentOfTotalDesired),
    }))
    .sort((a, b) => {
      const aUnknown = a.group === PROTEIN_UNCLASSIFIED_LABEL;
      const bUnknown = b.group === PROTEIN_UNCLASSIFIED_LABEL;
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      return gap(b) - gap(a);
    });
}

// One hue per group, lightness stepped within it — the group reads as
// a block while two sources inside it stay distinguishable. Shared by the bars
// and the donut, so a source keeps one colour everywhere in the panel.
function proteinRotationPalette(rows) {
  const groups = [...new Set(rows.map((r) => r.group))];
  const hueFor = (c) => Math.round((groups.indexOf(c) * 360) / groups.length);
  const seen = new Map();

  const barColors = rows.map((r) => {
    const n = seen.get(r.group) || 0;
    seen.set(r.group, n + 1);
    // Wraps every 4 so a large group never fades out or drifts into the next
    // group's shade.
    return seriesColor(hueFor(r.group), { lightness: '--chart-series-light', shade: n % 4 });
  });

  return {
    barColors,
    legend: groups.map((name) => ({ name, color: seriesColor(hueFor(name), { lightness: '--chart-series-light' }) })),
  };
}

// The time-windowed rings of the rotation donut, outermost first — Chart.js
// draws datasets[0] as the outer ring. Both end on the To date the bars use,
// so the first of these is the medium-term rotation and the second is the
// most recent week inside it. The reference ring (each source's desired
// Protein %) sits outside both — see renderProteinRotationDonut — since it
// isn't a time window at all, just the one static split the other two are
// read against.
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

// Same group order and colors as the bar chart — one group is one color
// everywhere in the panel, in every ring and in its bar, which is what makes
// the donut readable without a legend of its own. The rings are told apart by
// position (outermost = reference desired, then 4 weeks, then last week),
// never by shade.
function renderProteinRotationDonut(rows, barColors, toIso) {
  const ctx = document.getElementById('protein-rotation-donut');
  const labels = rows.map((r) => r.name);

  // Not a time window like the two below it — each source's own Protein %
  // setting (health-nutrition.js), the fixed split the other two rings are read
  // against. No `days`, which the tooltip callback below uses to tell it
  // apart from an eaten-window ring.
  const referenceRing = {
    label: 'Reference desired',
    data: rows.map((r) => r.proteinPercent),
    total: rows.reduce((sum, r) => sum + r.proteinPercent, 0),
  };

  const rings = PROTEIN_ROTATION_DONUT_RINGS.map((ring) => {
    const { from, to } = proteinRotationWindow(toIso, ring.days);
    const eaten = from ? actualProteinEatenBySource(from, to) : new Map();
    const eatenBy = (name) => eaten.get(name.trim().toLowerCase()) || 0;
    const data = rows.map((r) => Math.round(r.sources.reduce((sum, name) => sum + eatenBy(name), 0) * 10) / 10);
    return { ...ring, data, total: data.reduce((sum, v) => sum + v, 0) };
  });

  // hasData is about actually-eaten protein, not the reference ring — a
  // fresh set of tracked sources always has a reference split even before
  // anything's been logged against it.
  const hasData = rings.some((ring) => ring.total > 0);
  const allRings = [referenceRing, ...rings];

  proteinRotationDonut = upsertChart(proteinRotationDonut, ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: allRings.map((ring) => ({ data: ring.data, backgroundColor: barColors })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Without this, hovering one ring also matches the same dataIndex in
      // the other rings, giving multiple tooltip lines for a single hover.
      interaction: { mode: 'point' },
      plugins: {
        legend: { display: false },
        title: {
          // Only worth saying when there are sources to log against — with
          // none tracked, the bar chart's own title already explains why.
          display: rows.length > 0 && !hasData,
          text: ['No protein logged from a tracked', 'source in these 4 weeks'],
          color: Chart.defaults.color,
          font: { size: chartFontSize() },
          padding: { top: 40 },
        },
        tooltip: {
          callbacks: {
            // The label line below already names the group, so the title
            // lists the ingredients it's made of instead.
            title: (items) => rows[items[0].dataIndex].sources.join(', '),
            label: (item) => {
              const ring = allRings[item.datasetIndex];
              // The reference ring's own numbers ARE percentages already —
              // no share-of-window arithmetic to redo on top of them.
              if (ring.days === undefined) {
                const value = `${item.formattedValue}% of desired protein`;
                return `${labels[item.dataIndex]} — ${ring.label}: ${privacyMode ? maskDigits(value) : value}`;
              }
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
  const sourceRows = computeProteinRotationRows(from, to);
  const rows = groupProteinRotationRows(sourceRows);

  const labels = rows.map((r) => r.name);
  const actualData = rows.map((r) => r.actualProteinG);
  const desiredData = rows.map((r) => r.desiredProteinG);
  const { barColors, legend } = proteinRotationPalette(rows);

  // Ingredients in group-row order, so the palette's hues match the donut's.
  const stackRows = rows.flatMap((g) => sourceRows.filter((r) => r.group === g.group));
  const stackColors = proteinRotationPalette(stackRows).barColors;
  // Second legend line: one swatch per ingredient, in stack order.
  renderCategoryLegend('protein-rotation-ingredient-legend', stackRows.map((r, i) => ({ name: r.name, color: stackColors[i] })));
  // One stacked dataset per ingredient, filled only on its own group's row.
  const stackDatasets = stackRows.map((r, i) => ({
    type: 'bar',
    label: r.name,
    source: r,
    data: rows.map((g) => (g.group === r.group ? r.actualProteinG : null)),
    backgroundColor: stackColors[i],
    stack: 'eaten',
    order: 2,
  }));

  // One swatch per group — the bars are labelled by group too, but the donut
  // isn't, and this is what names its slices.
  renderCategoryLegend('protein-rotation-legend', legend);

  const hasData = labels.length > 0;

  // Chart.js's own "nice number" auto-max often rounds well past the actual
  // data (e.g. real max 8 -> axis max 12) — fit the axis to the real max
  // eaten/desired value instead, with a little headroom.
  const maxValue = Math.ceil(Math.max(1, ...actualData, ...desiredData)) + 1;

  proteinRotationChart = upsertChart(proteinRotationChart, ctx, {
    data: {
      labels,
      datasets: [
        ...stackDatasets,
        {
          type: 'line',
          label: 'Desired',
          stack: 'desired',
          data: desiredData,
          showLine: false,
          pointStyle: 'line',
          rotation: 90,
          pointRadius: 12,
          borderWidth: 3,
          borderColor: chartColor('--chart-bad'),
          backgroundColor: chartColor('--chart-bad'),
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
          text: 'No ingredients tracked yet — open Nutrition, edit an ingredient, and set its Protein %',
          color: Chart.defaults.color,
          font: { size: chartFontSize() },
          padding: { top: 40 },
        },
        tooltip: {
          callbacks: {
            // The default title is the bare group name; listing its tracked
            // ingredients there says what the bar is summed from.
            title: (items) => {
              const row = rows[items[0].dataIndex];
              return `${row.group} — ${row.sources.join(', ')}`;
            },
            label: (item) => {
              const source = item.dataset.source;
              const pct = source ? source.actualPercentOfTotalDesired : rows[item.dataIndex].proteinPercent;
              const pctLabel = source ? 'of total desired' : 'desired';
              const value = `${item.formattedValue}g protein (${pct}% ${pctLabel})`;
              const label = source ? `${source.name} eaten` : item.dataset.label;
              return `${label}: ${privacyMode ? maskDigits(value) : value}`;
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
          stacked: true,
          beginAtZero: true,
          max: maxValue,
          ticks: { callback: maskedUnitTick('g', 1), maxRotation: 45, minRotation: 45 },
        },
        y: { afterFit: fixTrendYAxisWidth, ticks: { autoSkip: false, callback: trendYAxisCategoryTick } },
      },
    },
  });

  renderProteinRotationDonut(rows, barColors, to);
}

// No From/To pair of its own any more: this chart is the last block of the Health
// Chart panel, and healthDateRange() (health-chart.js) is that panel's one window.
// initHealthRangeControl() owns the wiring and redraws this chart on a change, so all
// that's left here is the first, usually data-less render.
function initProteinRotationPanel() {
  renderProteinRotationChart(healthDateRange());
}
