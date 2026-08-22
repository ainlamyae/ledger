// Car Service block (Other section): past services from Transportation transactions
// whose description carries the odometer as "@12345km", and the next service of each
// kind predicted from a linear fit of those readings.
//
// Sources for the intervals (km only, by request — no month limits):
// - Toyota Canada maintenance schedule (Service #1 every 8,000 km, #3 every 32,000 km,
//   brake fluid at 48,000 km): toyota.ca owners maintenance-schedule generator.
// - Toyota 2023 Corolla Warranty & Maintenance Guide (air filters 30,000 mi ≈ 48,000 km,
//   coolant 100,000 mi ≈ 160,000 km, spark plugs 120,000 mi ≈ 193,000 km).
// - Tire sets: replace at 6 years old (Toyota tire warranty ends at 6 years; CAA Insurance
//   won't cover tires older than 6), sooner if the tread is worn.
// - Winter tires: TD Insurance (+7 °C rule; Ontario discount needs them on Dec–Mar) and
//   GTA data showing commute hours below 7 °C by 1 Nov (taylortire.ca).

const CAR_ODOMETER_PATTERN = /@\s*([\d,.]+)\s*km/i;

// Description keyword → service type. First match wins, so specific before general.
const CAR_SERVICE_TYPES = [
  { type: 'oil', short: 'Oil', label: 'Oil Change', match: /oil/i, color: '#16a34a' },
  { type: 'tireSet', short: 'New Tires', label: 'Replace Tire Set', match: /accessory tire|new tires?|tire set|tires? purchase/i, color: '#7c3aed' },
  { type: 'changeover', short: 'Tires', label: 'Tire Changeover', match: /changeover|winter tire|tire swap/i, color: '#3b82f6' },
  { type: 'rust', short: 'Rust', label: 'Rust Protection', match: /corrosion|undercarriage|rust/i, color: '#d97706' },
  { type: 'rotation', short: 'Rotation', label: 'Tire Rotation + Inspection', match: /rotation/i, color: '#0891b2' },
  { type: 'cabin', short: 'Filter', label: 'Cabin Air Filter', match: /cabin/i, color: '#7c3aed' },
  { type: 'engineAir', short: 'Filter', label: 'Engine Air Filter', match: /engine air|air filter/i, color: '#7c3aed' },
  { type: 'brakeFluid', short: 'Brake Fluid', label: 'Brake Fluid', match: /brake fluid/i, color: '#dc2626' },
  { type: 'service3', short: 'Brakes', label: 'Brake Measure, Valve & Battery Check', match: /brake|valve|battery/i, color: '#dc2626' },
  { type: 'coolant', short: 'Coolant', label: 'Coolant', match: /coolant/i, color: '#0891b2' },
  { type: 'sparkPlugs', short: 'Plugs', label: 'Spark Plugs', match: /spark/i, color: '#d97706' },
];
const CAR_OTHER_TYPE = { type: 'other', short: 'Service', label: 'Other', color: '#9ca3af' };

// What gets predicted. `resetBy` lists the types that also count as having done it.
const CAR_SERVICE_RULES = [
  { type: 'oil', ownAverage: true, fallbackKm: 8000, basis: 'your own history' },
  { type: 'rotation', everyKm: 8000, resetBy: ['rotation', 'changeover'], basis: 'every 8,000 km — Toyota' },
  { type: 'service3', everyKm: 32000, basis: 'every 32,000 km — Toyota' },
  { type: 'cabin', everyKm: 48000, basis: 'every 48,000 km — Toyota' },
  { type: 'engineAir', everyKm: 48000, basis: 'every 48,000 km — Toyota' },
  { type: 'brakeFluid', everyKm: 48000, basis: 'every 48,000 km — Toyota' },
  { type: 'coolant', atKm: 160000, basis: 'first at 160,000 km — Toyota' },
  { type: 'sparkPlugs', atKm: 193000, basis: 'at 193,000 km — Toyota' },
  { type: 'rust', everyDays: 365, basis: 'yearly — your own history' },
  { type: 'changeover', seasonal: true },
  { type: 'tireSet', everyYears: 6, basis: '6 years old, or sooner when the tread is worn — Toyota' },
];

// A service due within this many days (or overdue) flags the heading and notifies.
const CAR_REMINDER_DAYS = 30;

// Predictions further out than this stay in the table but off the chart.
const CAR_CHART_HORIZON_DAYS = 730;

let carServiceChart = null;

function carServiceType(description) {
  return CAR_SERVICE_TYPES.find((t) => t.match.test(description)) || CAR_OTHER_TYPE;
}

function carTypeInfo(type) {
  return CAR_SERVICE_TYPES.find((t) => t.type === type) || CAR_OTHER_TYPE;
}

function carDaysBetween(fromIso, toIso) {
  return Math.round((parseIsoDateUTC(toIso) - parseIsoDateUTC(fromIso)) / 86400000);
}

function carKmText(km) {
  const text = Math.round(km).toLocaleString('en-US');
  return privacyMode ? maskDigits(text) : text;
}

// Past services, oldest first.
function parseCarServiceTransactions() {
  return allTransactions
    .filter((t) => t.date && t.category.trim().toLowerCase() === 'transportation' && CAR_ODOMETER_PATTERN.test(t.description))
    .map((t) => {
      const km = Number(CAR_ODOMETER_PATTERN.exec(t.description)[1].replace(/,/g, ''));
      const service = t.description.replace(CAR_ODOMETER_PATTERN, '').trim();
      return { date: t.date, km, service, payee: t.payee, amount: t.amount, type: carServiceType(service).type };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
}

// Least-squares km/day over every reading, anchored at the latest one so the forecast
// continues from where the odometer actually is.
function carOdometerFit(records) {
  const last = records[records.length - 1];
  const xs = records.map((r) => carDaysBetween(records[0].date, r.date));
  const ys = records.map((r) => r.km);
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const sxy = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);
  const kmPerDay = sxx > 0 ? sxy / sxx : 0;
  return {
    kmPerDay,
    lastDate: last.date,
    lastKm: last.km,
    kmAt: (date) => last.km + kmPerDay * carDaysBetween(last.date, date),
    dateFor: (km) => isoDatePlusDays(last.date, kmPerDay > 0 ? Math.round((km - last.km) / kmPerDay) : 0),
  };
}

// The next fall (on) and spring (off) changeover dates after the last one logged.
function carSeasonalChangeovers(records, today) {
  const changeovers = records.filter((r) => r.type === 'changeover');
  const springDays = changeovers
    .filter((r) => { const m = Number(r.date.slice(5, 7)); return m >= 3 && m <= 6; })
    .map((r) => carDaysBetween(`${r.date.slice(0, 4)}-01-01`, r.date));
  // Your own average spring date, never before 1 Apr (TD's discount runs through March).
  const avgSpringDay = springDays.length ? Math.round(springDays.reduce((s, d) => s + d, 0) / springDays.length) : 104;
  const springDate = (year) => {
    const avg = isoDatePlusDays(`${year}-01-01`, avgSpringDay);
    return avg < `${year}-04-01` ? `${year}-04-01` : avg;
  };

  const last = changeovers[changeovers.length - 1];
  const lastMonth = last ? Number(last.date.slice(5, 7)) : 6;
  const year = Number(today.slice(0, 4));
  // A fall changeover (Sep–Dec) means winter tires are on: spring comes next.
  if (lastMonth >= 9) {
    const springYear = Number(last.date.slice(0, 4)) + 1;
    return [
      { date: springDate(springYear), label: 'Tire Changeover to All-Season', basis: 'after 31 Mar, above +7 °C, on your average spring date — TD' },
      { date: `${springYear}-11-01`, label: 'Tire Changeover to Winter', basis: 'by 1 Nov, at +7 °C or below, before 1 Dec — TD' },
    ];
  }
  const fallYear = last ? Number(last.date.slice(0, 4)) : year;
  return [
    { date: `${fallYear}-11-01`, label: 'Tire Changeover to Winter', basis: 'by 1 Nov, at +7 °C or below, before 1 Dec — TD' },
    { date: springDate(fallYear + 1), label: 'Tire Changeover to All-Season', basis: 'after 31 Mar, above +7 °C, on your average spring date — TD' },
  ];
}

// The next occurrence of every rule.
function predictCarServices(records, fit, today) {
  const lastOf = (types) => [...records].reverse().find((r) => types.includes(r.type)) || null;
  const predictions = [];

  CAR_SERVICE_RULES.forEach((rule) => {
    const info = carTypeInfo(rule.type);
    if (rule.seasonal) {
      carSeasonalChangeovers(records, today).forEach((c) => predictions.push({
        type: rule.type, label: c.label, date: c.date, km: fit.kmAt(c.date), basis: c.basis,
      }));
      return;
    }
    // One row per tire set: the car's original set (its first record) and each bought since.
    if (rule.everyYears) {
      const sets = [{ date: records[0].date, name: 'original set' },
        ...records.filter((r) => r.type === rule.type).map((r) => ({ date: r.date, name: `set from ${r.date}` }))];
      sets.forEach((set) => {
        const date = `${Number(set.date.slice(0, 4)) + rule.everyYears}${set.date.slice(4)}`;
        predictions.push({ type: rule.type, label: `${info.label} (${set.name})`, date, km: fit.kmAt(date), basis: rule.basis });
      });
      return;
    }
    if (rule.everyDays) {
      const last = lastOf([rule.type]);
      if (!last) return;
      const date = isoDatePlusDays(last.date, rule.everyDays);
      predictions.push({ type: rule.type, label: info.label, date, km: fit.kmAt(date), basis: rule.basis });
      return;
    }

    let km;
    let basis = rule.basis;
    if (rule.ownAverage) {
      const done = records.filter((r) => r.type === rule.type);
      const gaps = done.slice(1).map((r, i) => r.km - done[i].km);
      const gap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : rule.fallbackKm;
      km = (done.length ? done[done.length - 1].km : 0) + gap;
      basis = `every ${carKmText(gap)} km — ${rule.basis}`;
    } else if (rule.atKm) {
      if (lastOf([rule.type])) return;
      km = rule.atKm;
    } else {
      const last = lastOf(rule.resetBy || [rule.type]);
      km = last ? last.km + rule.everyKm : rule.everyKm;
    }
    predictions.push({ type: rule.type, label: info.label, date: fit.dateFor(km), km, basis });
  });

  // Rust protection is done with the fall changeover to winter, so it shares that day.
  const rust = predictions.find((p) => p.type === 'rust');
  const toWinter = predictions.find((p) => p.type === 'changeover' && /to Winter/.test(p.label));
  if (rust && toWinter) {
    rust.date = toWinter.date;
    rust.km = toWinter.km;
    rust.basis = 'yearly, with the changeover to winter — your own history';
  }

  // A changeover is also a rotation + inspection: when the next one comes before the
  // rotation's 8,000 km, the rotation happens there rather than on its own.
  const rotation = predictions.find((p) => p.type === 'rotation');
  const changeovers = predictions.filter((p) => p.type === 'changeover');
  if (rotation && changeovers.some((c) => c.km <= rotation.km)) {
    predictions.splice(predictions.indexOf(rotation), 1);
    changeovers.forEach((c) => {
      c.label = `${c.label} + Rotation & Inspection`;
      c.basis = `${c.basis}; includes rotation & inspection every 8,000 km — Toyota`;
    });
  }

  return predictions
    .map((p) => ({ ...p, status: p.date < today ? 'Overdue' : 'Predicted' }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderCarServiceTable(records, predictions) {
  const predictedBody = document.getElementById('car-service-predicted-body');
  const doneBody = document.getElementById('car-service-done-body');
  predictedBody.innerHTML = '';
  doneBody.innerHTML = '';
  if (!records.length) {
    const message = 'No Transportation transactions with an odometer reading (e.g. "Service Oil Change @28902km") yet.';
    predictedBody.appendChild(renderEmptyRow(4, message));
    doneBody.appendChild(renderEmptyRow(3, message));
    return;
  }

  // Upcoming, soonest first; a date already passed says so in the Service cell.
  predictions.forEach((p) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(p.date),
      makeCell(`${carKmText(p.km)} km`),
      makeCell(p.status === 'Overdue' ? `${p.label} — overdue` : p.label),
      makeCell(p.basis),
    );
    predictedBody.appendChild(tr);
  });

  // History, newest first.
  [...records].reverse().forEach((r) => {
    const tr = document.createElement('tr');
    tr.append(makeCell(r.date), makeCell(`${carKmText(r.km)} km`), makeCell(r.service));
    doneBody.appendChild(tr);
  });
}

function renderCarServiceChart(records, predictions, fit, today) {
  const ctx = document.getElementById('car-service-chart');
  const horizon = isoDatePlusDays(today, CAR_CHART_HORIZON_DAYS);
  const charted = predictions.filter((p) => p.date <= horizon);
  const lastDate = [today, fit.lastDate, ...charted.map((p) => p.date)].sort().pop();
  const dates = [];
  for (let d = records[0].date; d <= lastDate; d = isoDatePlusDays(d, 1)) dates.push(d);
  const indexOf = new Map(dates.map((d, i) => [d, i]));

  const readings = new Array(dates.length).fill(null);
  records.forEach((r) => { readings[indexOf.get(r.date)] = r.km; });
  const forecast = dates.map((d) => (d >= fit.lastDate ? Math.round(fit.kmAt(d)) : null));

  // One point series per service type and status, so the hover can name each.
  const pointSets = [];
  const addPoints = (items, status, hollow) => {
    const byType = new Map();
    items.forEach((item) => {
      if (!byType.has(item.type)) byType.set(item.type, []);
      byType.get(item.type).push(item);
    });
    byType.forEach((list, type) => {
      const info = carTypeInfo(type);
      const data = new Array(dates.length).fill(null);
      const names = new Array(dates.length).fill(null);
      list.forEach((item) => {
        const i = indexOf.get(item.date);
        if (i === undefined) return;
        data[i] = Math.round(item.km);
        names[i] = item.label || item.service;
      });
      pointSets.push({
        type: 'line', label: info.label, data, names, status, showLine: false,
        pointRadius: 5, pointHoverRadius: 6, borderColor: info.color, borderWidth: 2,
        backgroundColor: hollow ? 'transparent' : info.color, order: 0,
      });
    });
  };
  addPoints(records, 'done', false);
  addPoints(charted, 'predicted', true);

  carServiceChart = upsertChart(carServiceChart, ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: 'Odometer', status: 'logged', data: readings, spanGaps: true,
          borderColor: targetMarkColor(), borderWidth: 2, pointRadius: 0, tension: 0, order: 1,
        },
        {
          label: 'Odometer', status: 'forecast', data: forecast,
          borderColor: '#9ca3af', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0, order: 1,
        },
        ...pointSets,
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          // The forecast starts on the last reading; there the logged line already says it.
          filter: (item) => item.raw !== null && item.raw !== undefined
            && !(item.dataset.status === 'forecast' && item.label === fit.lastDate),
          callbacks: {
            title: (items) => items[0]?.label ?? '',
            label: (item) => {
              const ds = item.dataset;
              const name = ds.names ? ds.names[item.dataIndex] : ds.label;
              return `${name} (${ds.status}): ${carKmText(item.raw)} km`;
            },
          },
        },
      },
      scales: {
        x: {
          ...wellnessCategoryXScale(dates),
          ticks: {
            maxRotation: 45,
            minRotation: 45,
            autoSkip: false,
            callback(value) {
              // Year-month, the app's YYYY-MM-DD order.
              return new Date(parseIsoDateUTC(this.getLabelForValue(value))).toISOString().slice(0, 7);
            },
          },
        },
        y: { beginAtZero: true, afterFit: fixTrendYAxisWidth, ticks: { callback: maskedUnitTick('km') } },
      },
    },
  });

  const legendTypes = [...new Set([...records, ...charted].map((r) => r.type))];
  renderCategoryLegend('car-service-legend', legendTypes.map((type) => ({ name: carTypeInfo(type).label, color: carTypeInfo(type).color })));
}

// The heading flag (like Account's "Acct>Txn") and a once-a-day Chrome notification
// (like Work Time's), for every service due within CAR_REMINDER_DAYS or overdue.
function updateCarServiceReminder(predictions, today) {
  const flag = document.getElementById('car-service-flag');
  const due = predictions.filter((p) => carDaysBetween(today, p.date) <= CAR_REMINDER_DAYS);
  flag.hidden = due.length === 0;
  if (!due.length) {
    flag.textContent = '';
    flag.title = '';
    return;
  }

  const days = carDaysBetween(today, due[0].date);
  const names = [...new Set(due.map((p) => carTypeInfo(p.type).short))].join('+');
  flag.textContent = days < 0 ? `${names} overdue` : `${names} ${days}d`;
  const detail = due.map((p) => `${p.label} (${p.date})`).join(', ');
  flag.title = `Car service due: ${detail}`;

  if ('Notification' in window && Notification.permission === 'granted'
    && localStorage.getItem('ledger_last_car_service_notified') !== today) {
    new Notification('Ledger', { body: days < 0 ? `Car service overdue: ${detail}` : `Car service in ${days} days: ${detail}` });
    localStorage.setItem('ledger_last_car_service_notified', today);
  }
}

// Called from refreshTransactions (transactions.js) whenever the rows change.
function renderCarService() {
  if (!document.getElementById('car-service-done-body')) return;
  const records = parseCarServiceTransactions();
  if (!records.length) {
    renderCarServiceTable([], []);
    if (carServiceChart) carServiceChart.destroy();
    carServiceChart = null;
    updateCarServiceReminder([], isoFromDate(new Date()));
    return;
  }
  const today = isoFromDate(new Date());
  const fit = carOdometerFit(records);
  const predictions = predictCarServices(records, fit, today);
  renderCarServiceTable(records, predictions);
  renderCarServiceChart(records, predictions, fit, today);
  updateCarServiceReminder(predictions, today);
}
