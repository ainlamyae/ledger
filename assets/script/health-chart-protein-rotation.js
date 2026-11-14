// "Protein Source Rotation" panel: one bar per Nutrition Group (stacked by
// ingredient) of protein eaten in the window vs. a live desired figure, plus a
// three-ring donut (reference split, last 4 weeks, last week). Each tracked
// ingredient's desired grams are its Protein % share of the desired protein
// band's top, so they follow body mass/height/activity automatically.
// Also holds the rotation chart code shared with health-chart-activity-rotation.js.

const ROTATION_UNCLASSIFIED_LABEL = 'Unclassified';
const DAYS_PER_WEEK = 7;
// Bar shades within one hue before wrapping, so a large group never fades out.
const ROTATION_SHADES_PER_HUE = 4;

// Time-windowed donut rings, outermost first; both end on the bars' To date.
const ROTATION_DONUT_RINGS = [
  { label: 'Last 4 weeks', days: 28 },
  { label: 'Last week', days: 7 },
];

const roundTenth = (v) => Math.round(v * 10) / 10;
const percentTenth = (part, whole) => Math.round((part / whole) * 1000) / 10;
const maskRotationValue = (value) => (privacyMode ? maskDigits(value) : value);

// Unclassified sinks last: it's a gap in the catalogue, not a real group.
function compareUnclassifiedLast(aKey, bKey) {
  const aUnknown = aKey === ROTATION_UNCLASSIFIED_LABEL;
  const bUnknown = bKey === ROTATION_UNCLASSIFIED_LABEL;
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  return 0;
}

// The `days` days ending on toIso inclusive.
function rotationWindow(toIso, days) {
  const to = dateFromIso(toIso);
  if (!toIso || Number.isNaN(to.getTime())) return { from: null, to: null };
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));
  return { from: isoFromDate(from), to: toIso };
}

// One hue per `key` value, lightness stepped within it; shared by bars and donut
// so a row keeps one colour everywhere in the panel.
function rotationPalette(rows, key) {
  const groups = [...new Set(rows.map((r) => r[key]))];
  const hueFor = (c) => Math.round((groups.indexOf(c) * 360) / groups.length);
  const seen = new Map();

  const barColors = rows.map((r) => {
    const n = seen.get(r[key]) || 0;
    seen.set(r[key], n + 1);
    return seriesColor(hueFor(r[key]), { lightness: '--chart-series-light', shade: n % ROTATION_SHADES_PER_HUE });
  });

  return {
    barColors,
    legend: groups.map((name) => ({ name, color: seriesColor(hueFor(name), { lightness: '--chart-series-light' }) })),
  };
}

function rotationEmptyTitle(display, text) {
  return {
    display,
    text,
    color: Chart.defaults.color,
    font: { size: chartFontSize() },
    padding: { top: 40 },
  };
}

// Horizontal bars plus a "Desired" tick per row; `holder` is the slot's chart handles.
function renderRotationBars(holder, canvasId, { labels, datasets, actualData, desiredData, stacked, emptyText, unit, tooltip }) {
  // Fit the axis to the real max: Chart.js's "nice" auto-max often overshoots.
  const maxValue = Math.ceil(Math.max(1, ...actualData, ...desiredData)) + 1;

  holder.chart = upsertChart(holder.chart, document.getElementById(canvasId), {
    data: {
      labels,
      datasets: [
        ...datasets,
        {
          type: 'line',
          label: 'Desired',
          ...(stacked && { stack: 'desired' }),
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
        title: rotationEmptyTitle(labels.length === 0, emptyText),
        tooltip: { callbacks: tooltip },
      },
      scales: {
        // Fixed 45° so the axis doesn't change angle as the range does.
        x: {
          ...(stacked && { stacked: true }),
          beginAtZero: true,
          max: maxValue,
          ticks: { callback: maskedUnitTick(unit, 1), maxRotation: 45, minRotation: 45 },
        },
        y: { afterFit: fixTrendYAxisWidth, ticks: { autoSkip: false, callback: trendYAxisCategoryTick } },
      },
    },
  });
}

// Donut in the bars' colours, rings told apart by position: outermost the
// reference split (no `days`), then ROTATION_DONUT_RINGS.
function renderRotationDonut(holder, canvasId, rows, barColors, toIso, cfg) {
  const labels = rows.map((r) => r.name);
  const referenceData = rows.map(cfg.referenceValue);
  const referenceRing = {
    label: 'Reference desired',
    data: referenceData,
    total: referenceData.reduce((sum, v) => sum + v, 0),
  };

  const rings = ROTATION_DONUT_RINGS.map((ring) => {
    const { from, to } = rotationWindow(toIso, ring.days);
    const counts = from ? cfg.countsBetween(from, to) : new Map();
    const data = rows.map((r) => cfg.ringValue(r, counts));
    return { ...ring, data, total: data.reduce((sum, v) => sum + v, 0) };
  });

  // Logged data only: the reference ring always has a split.
  const hasData = rings.some((ring) => ring.total > 0);
  const allRings = [referenceRing, ...rings];

  holder.donut = upsertChart(holder.donut, document.getElementById(canvasId), {
    type: 'doughnut',
    data: {
      labels,
      datasets: allRings.map((ring) => ({ data: ring.data, backgroundColor: barColors })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Otherwise one hover matches the same index in every ring.
      interaction: { mode: 'point' },
      plugins: {
        legend: { display: false },
        // With nothing tracked, the bar chart's own title already explains why.
        title: rotationEmptyTitle(rows.length > 0 && !hasData, cfg.emptyText),
        tooltip: {
          callbacks: {
            title: (items) => cfg.tooltipTitle(rows[items[0].dataIndex]),
            label: (item) => {
              const ring = allRings[item.datasetIndex];
              const value = ring.days === undefined
                ? `${item.formattedValue}${cfg.referenceUnit}`
                : `${item.formattedValue}${cfg.windowUnit} (${ring.total ? percentTenth(item.raw, ring.total) : 0}% of the window)`;
              return `${labels[item.dataIndex]} — ${ring.label}: ${maskRotationValue(value)}`;
            },
          },
        },
      },
    },
  });
}

// Protein % set on a Nutrition row is the sole "is this tracked" switch.
function trackedProteinSources() {
  return allNutritionEntries
    .filter((n) => n.proteinPercent !== null && n.proteinPercent > 0)
    .map((n) => ({
      name: n.name,
      group: n.group || ROTATION_UNCLASSIFIED_LABEL,
      proteinPercent: n.proteinPercent,
    }));
}

const proteinSourceKey = (name) => String(name || '').trim().toLowerCase();

// Protein eaten per ingredient, summed from each Calculate breakdown item.
function actualProteinEatenBySource(from, to) {
  const proteinByName = new Map();
  physiqueAsHealthEntries()
    .filter((e) => e.category === 'Calories; Protein' && e.date >= from && e.date <= to)
    .forEach((e) => {
      (e.breakdown || []).forEach((item) => {
        const key = proteinSourceKey(item.name);
        if (!key) return;
        proteinByName.set(key, (proteinByName.get(key) || 0) + (item.protein || 0));
      });
    });
  return proteinByName;
}

// One row per tracked ingredient: protein eaten vs. its share of the desired
// protein over the window. Protein % is typed freely, so shares are taken of
// their sum and always cover the whole desired figure.
function computeProteinRotationRows(from, to) {
  const lookbackDays = datesInRange(from, to).length;
  const sources = trackedProteinSources();
  const proteinByName = actualProteinEatenBySource(from, to);
  const totalPercent = sources.reduce((sum, s) => sum + s.proteinPercent, 0);
  // The band's top: a share-of-desired split needs one denominator.
  const dailyProteinDesired = getProteinDesiredBandG(physiqueAsHealthEntries()).max;
  const weeklyProteinDesired = dailyProteinDesired * DAYS_PER_WEEK;
  const totalDesiredForWindow = dailyProteinDesired * lookbackDays;

  const rows = sources.map((s) => {
    const actualProteinG = proteinByName.get(proteinSourceKey(s.name)) || 0;
    const proteinPercent = (s.proteinPercent / totalPercent) * 100;
    const desiredProteinG = (proteinPercent / 100) * weeklyProteinDesired * (lookbackDays / DAYS_PER_WEEK);
    return {
      name: s.name,
      group: s.group,
      actualProteinG: roundTenth(actualProteinG),
      desiredProteinG: roundTenth(desiredProteinG),
      proteinPercent: roundTenth(proteinPercent),
      actualPercentOfTotalDesired: totalDesiredForWindow > 0 ? percentTenth(actualProteinG, totalDesiredForWindow) : 0,
    };
  });

  return sortByGroupThenGap(rows);
}

const proteinGap = (r) => r.desiredProteinG - r.actualProteinG;

// Sources cluster under their group; most left to eat first, both within a
// group and across groups (by combined gap).
function sortByGroupThenGap(rows) {
  const groupGap = new Map();
  rows.forEach((r) => groupGap.set(r.group, (groupGap.get(r.group) || 0) + proteinGap(r)));

  return [...rows].sort((a, b) => {
    if (a.group === b.group) return proteinGap(b) - proteinGap(a);
    return compareUnclassifiedLast(a.group, b.group) || groupGap.get(b.group) - groupGap.get(a.group);
  });
}

// The ingredient rows summed per Group ("eat more fish", not "more salmon"),
// each carrying its `sources` for the donut and tooltips.
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

  return [...byGroup.values()]
    .map((g) => ({
      ...g,
      actualProteinG: roundTenth(g.actualProteinG),
      desiredProteinG: roundTenth(g.desiredProteinG),
      proteinPercent: roundTenth(g.proteinPercent),
      actualPercentOfTotalDesired: roundTenth(g.actualPercentOfTotalDesired),
    }))
    .sort((a, b) => compareUnclassifiedLast(a.group, b.group) || proteinGap(b) - proteinGap(a));
}

// The Chart panel's card and Nutrition's copy, each with its own chart handles.
const proteinRotationCharts = {
  chart: { chart: null, donut: null },
  nutrition: { chart: null, donut: null },
};
const PROTEIN_ROTATION_DEFAULT_IDS = {
  chart: 'protein-rotation-chart', donut: 'protein-rotation-donut',
  legend: 'protein-rotation-legend', ingredientLegend: 'protein-rotation-ingredient-legend',
};
const PROTEIN_ROTATION_NUTRITION_IDS = {
  chart: 'protein-rotation-chart-nutrition', donut: 'protein-rotation-donut-nutrition',
  legend: 'protein-rotation-legend-nutrition', ingredientLegend: 'protein-rotation-ingredient-legend-nutrition',
};

function renderProteinRotationDonut(rows, barColors, toIso, slot, ids) {
  renderRotationDonut(proteinRotationCharts[slot], ids.donut, rows, barColors, toIso, {
    referenceValue: (r) => r.proteinPercent,
    countsBetween: actualProteinEatenBySource,
    ringValue: (r, eaten) => roundTenth(r.sources.reduce((sum, name) => sum + (eaten.get(proteinSourceKey(name)) || 0), 0)),
    emptyText: ['No protein logged from a tracked', 'source in these 4 weeks'],
    // The label line names the group, so the title lists its ingredients.
    tooltipTitle: (r) => r.sources.join(', '),
    referenceUnit: '% of desired protein',
    windowUnit: 'g protein',
  });
}

function renderProteinRotationChart({ from, to }, slot = 'chart', ids = PROTEIN_ROTATION_DEFAULT_IDS) {
  const sourceRows = computeProteinRotationRows(from, to);
  const rows = groupProteinRotationRows(sourceRows);
  const { barColors, legend } = rotationPalette(rows, 'group');

  // Ingredients in group-row order, one stacked dataset each, filled only on its own group's row.
  const stackRows = rows.flatMap((g) => sourceRows.filter((r) => r.group === g.group));
  const stackColors = rotationPalette(stackRows, 'group').barColors;
  renderCategoryLegend(ids.ingredientLegend, stackRows.map((r, i) => ({ name: r.name, color: stackColors[i] })));
  const stackDatasets = stackRows.map((r, i) => ({
    type: 'bar',
    label: r.name,
    source: r,
    data: rows.map((g) => (g.group === r.group ? r.actualProteinG : null)),
    backgroundColor: stackColors[i],
    stack: 'eaten',
    order: 2,
  }));

  // Group swatches: they're what names the donut's slices.
  renderCategoryLegend(ids.legend, legend);

  renderRotationBars(proteinRotationCharts[slot], ids.chart, {
    labels: rows.map((r) => r.name),
    datasets: stackDatasets,
    actualData: rows.map((r) => r.actualProteinG),
    desiredData: rows.map((r) => r.desiredProteinG),
    stacked: true,
    emptyText: 'No ingredients tracked yet — open Nutrition, edit an ingredient, and set its Protein %',
    unit: 'g',
    tooltip: {
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
        return `${label}: ${maskRotationValue(value)}`;
      },
    },
  });

  renderProteinRotationDonut(rows, barColors, to, slot, ids);
}

// healthDateRange() is the window; initHealthRangeControl() redraws on change.
function initProteinRotationPanel() {
  renderProteinRotationChart(healthDateRange());
  renderProteinRotationChart(healthDateRange(), 'nutrition', PROTEIN_ROTATION_NUTRITION_IDS);
}
