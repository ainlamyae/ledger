// Car Service: past services from Transportation transactions tagged "@12345km", and
// each kind's next service predicted from a linear fit of those readings.
// Sources: Toyota Canada schedule (#1 8,000 km, #3 32,000 km, brake fluid 48,000 km);
// 2023 Corolla guide (filters 48,000, coolant 160,000, plugs 193,000 km); tire sets at
// 6 years; winter tires and rust protection by 1 Dec (TD Insurance, Ontario).

const CAR_ODOMETER_PATTERN = /@\s*([\d,.]+)\s*km/i;

// Description keyword → service type. First match wins, so specific before general.
const CAR_SERVICE_TYPES = [
  { type: 'oil', short: 'Oil', label: 'Oil Change', match: /oil/i, color: '--chart-good' },
  { type: 'tireSet', short: 'New Tires', label: 'Replace Tire Set', match: /accessory tire|new tires?|tire set|tires? purchase/i, color: '--chart-purple' },
  { type: 'changeover', short: 'Tires', label: 'Tire Changeover', match: /changeover|winter tire|tire swap/i, color: '--chart-blue' },
  { type: 'rust', short: 'Rust', label: 'Rust Protection', match: /corrosion|undercarriage|rust/i, color: '--chart-orange' },
  { type: 'rotation', short: 'Rotation', label: 'Tire Rotation + Inspection', match: /rotation/i, color: '--chart-cyan' },
  { type: 'cabin', short: 'Filter', label: 'Cabin Air Filter', match: /cabin/i, color: '--chart-purple' },
  { type: 'engineAir', short: 'Filter', label: 'Engine Air Filter', match: /engine air|air filter/i, color: '--chart-purple' },
  { type: 'brakeFluid', short: 'Brake Fluid', label: 'Brake Fluid', match: /brake fluid/i, color: '--chart-bad' },
  { type: 'service3', short: 'Brakes', label: 'Brake Measure, Valve & Battery Check', match: /brake|valve|battery/i, color: '--chart-bad' },
  { type: 'coolant', short: 'Coolant', label: 'Coolant', match: /coolant/i, color: '--chart-cyan' },
  { type: 'sparkPlugs', short: 'Plugs', label: 'Spark Plugs', match: /spark/i, color: '--chart-orange' },
];
const CAR_OTHER_TYPE = { type: 'other', short: 'Service', label: 'Other', color: '--chart-neutral' };

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
const CAR_REMINDER_DAYS = 7;

// Predictions further out than this stay in the table but off the chart.
const CAR_CHART_HORIZON_DAYS = 730;

// Changeover seasons by month: spring Mar–Jun, fall from Sep.
const CAR_SPRING_FIRST_MONTH = 3;
const CAR_SPRING_LAST_MONTH = 6;
const CAR_FALL_FIRST_MONTH = 9;
// Day of year (from 1 Jan) for spring with no history: 15 Apr.
const CAR_SPRING_DEFAULT_DAY = 104;
// TD's discount needs winter tires through March and on by 1 Dec.
const CAR_SPRING_EARLIEST = '04-01';
const CAR_WINTER_BY = '12-01';
const CAR_TO_SPRING = { label: 'Tire Changeover to All-Season', basis: 'after 31 Mar, above +7 °C — TD' };
const CAR_TO_WINTER = { label: 'Tire Changeover to Winter', basis: 'at +7 °C or below, by 1 Dec — TD' };

const CAR_NOTIFIED_KEY = 'ledger_last_car_service_notified';

let carServiceChart = null;

function carServiceType(description) {
  return CAR_SERVICE_TYPES.find((t) => t.match.test(description)) || CAR_OTHER_TYPE;
}

function carTypeInfo(type) {
  return CAR_SERVICE_TYPES.find((t) => t.type === type) || CAR_OTHER_TYPE;
}

function carDaysBetween(fromIso, toIso) {
  return Math.round((parseIsoDateUTC(toIso) - parseIsoDateUTC(fromIso)) / MS_PER_DAY);
}

function carKmText(km) {
  const text = Math.round(km).toLocaleString('en-US');
  return privacyMode ? maskDigits(text) : text;
}

// Past services, oldest first.
function parseCarServiceTransactions() {
  return allTransactions
    // cellText: a category or description Sheets stored as a number has no .trim().
    .filter((t) => t.date && cellText(t.category).trim().toLowerCase() === 'transportation' && CAR_ODOMETER_PATTERN.test(cellText(t.description)))
    .map((t) => {
      const description = cellText(t.description);
      const km = Number(CAR_ODOMETER_PATTERN.exec(description)[1].replace(/,/g, ''));
      const service = description.replace(CAR_ODOMETER_PATTERN, '').trim();
      return { date: t.date, km, service, payee: t.payee, amount: t.amount, type: carServiceType(service).type };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
}

// Least-squares km/day over every reading, anchored at the latest one.
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

const carIsoYear = (iso) => Number(iso.slice(0, 4));
const carIsoMonth = (iso) => Number(iso.slice(5, 7));

// The next fall (on) and spring (off) changeover dates after the last one logged.
function carSeasonalChangeovers(records, today) {
  const changeovers = records.filter((r) => r.type === 'changeover');
  const springDays = changeovers
    .filter((r) => { const m = carIsoMonth(r.date); return m >= CAR_SPRING_FIRST_MONTH && m <= CAR_SPRING_LAST_MONTH; })
    .map((r) => carDaysBetween(`${r.date.slice(0, 4)}-01-01`, r.date));
  // Your own average spring date, never before TD's earliest.
  const avgSpringDay = springDays.length ? Math.round(springDays.reduce((s, d) => s + d, 0) / springDays.length) : CAR_SPRING_DEFAULT_DAY;
  const toSpring = (year) => {
    const avg = isoDatePlusDays(`${year}-01-01`, avgSpringDay);
    const earliest = `${year}-${CAR_SPRING_EARLIEST}`;
    return { date: avg < earliest ? earliest : avg, ...CAR_TO_SPRING };
  };
  const toWinter = (year) => ({ date: `${year}-${CAR_WINTER_BY}`, ...CAR_TO_WINTER });

  const last = changeovers[changeovers.length - 1];
  // No changeover yet counts as summer tires on.
  const lastMonth = last ? carIsoMonth(last.date) : CAR_SPRING_LAST_MONTH;
  // A fall changeover means winter tires are on: spring comes next.
  if (lastMonth >= CAR_FALL_FIRST_MONTH) {
    const springYear = carIsoYear(last.date) + 1;
    return [toSpring(springYear), toWinter(springYear)];
  }
  const fallYear = last ? carIsoYear(last.date) : carIsoYear(today);
  return [toWinter(fallYear), toSpring(fallYear + 1)];
}

// The next occurrence of every rule.
function predictCarServices(records, fit, today) {
  const lastOf = (types) => [...records].reverse().find((r) => types.includes(r.type)) || null;
  const predictions = [];

  CAR_SERVICE_RULES.forEach((rule) => {
    const info = carTypeInfo(rule.type);
    const done = records.filter((r) => r.type === rule.type);
    const lastDone = done[done.length - 1] || null;
    const onDate = (label, date, basis) => predictions.push({ type: rule.type, label, date, km: fit.kmAt(date), basis });
    const atKm = (km, basis = rule.basis) => predictions.push({ type: rule.type, label: info.label, date: fit.dateFor(km), km, basis });

    if (rule.seasonal) {
      carSeasonalChangeovers(records, today).forEach((c) => onDate(c.label, c.date, c.basis));
    } else if (rule.everyYears) {
      // One row per tire set: the original (the first record) and each bought since.
      const sets = [{ date: records[0].date, name: 'original set' },
        ...done.map((r) => ({ date: r.date, name: `set from ${shortYearDate(r.date)}` }))];
      sets.forEach((set) => {
        onDate(`${info.label} (${set.name})`, `${carIsoYear(set.date) + rule.everyYears}${set.date.slice(4)}`, rule.basis);
      });
    } else if (rule.everyDays) {
      if (lastDone) onDate(info.label, isoDatePlusDays(lastDone.date, rule.everyDays), rule.basis);
    } else if (rule.ownAverage) {
      const gaps = done.slice(1).map((r, i) => r.km - done[i].km);
      const gap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : rule.fallbackKm;
      atKm((lastDone ? lastDone.km : 0) + gap, `every ${carKmText(gap)} km — ${rule.basis}`);
    } else if (rule.atKm) {
      if (!lastDone) atKm(rule.atKm);
    } else {
      const last = lastOf(rule.resetBy || [rule.type]);
      atKm(last ? last.km + rule.everyKm : rule.everyKm);
    }
  });

  // Rust protection is done with the fall changeover to winter, so it shares that day.
  const rust = predictions.find((p) => p.type === 'rust');
  const toWinter = predictions.find((p) => p.type === 'changeover' && p.label === CAR_TO_WINTER.label);
  if (rust && toWinter) {
    rust.date = toWinter.date;
    rust.km = toWinter.km;
    rust.basis = 'yearly, with the changeover to winter — your own history';
  }

  // A changeover includes a rotation: one due first replaces the rotation.
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

  const addRow = (body, cells) => {
    const tr = document.createElement('tr');
    tr.append(...cells.map((text) => makeCell(text)));
    body.appendChild(tr);
  };
  // Upcoming, soonest first; a date already passed says so in the Service cell.
  predictions.forEach((p) => addRow(predictedBody, [
    shortYearDate(p.date), `${carKmText(p.km)} km`, p.status === 'Overdue' ? `${p.label} — overdue` : p.label, p.basis,
  ]));
  // History, newest first.
  [...records].reverse().forEach((r) => addRow(doneBody, [shortYearDate(r.date), `${carKmText(r.km)} km`, r.service]));
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
      const color = chartColor(info.color);
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
        pointRadius: 5, pointHoverRadius: 6, borderColor: color, borderWidth: 2,
        backgroundColor: hollow ? 'transparent' : color, order: 0,
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
          borderColor: desiredMarkColor(), borderWidth: 2, pointRadius: 0, tension: 0, order: 1,
        },
        {
          label: 'Odometer', status: 'forecast', data: forecast,
          borderColor: chartColor('--chart-neutral'), borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0, order: 1,
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
              return new Date(parseIsoDateUTC(this.getLabelForValue(value))).toISOString().slice(0, 7).replace(/^20/, '');
            },
          },
        },
        y: { beginAtZero: true, afterFit: fixTrendYAxisWidth, ticks: { callback: maskedUnitTick('km') } },
      },
    },
  });

  const legendTypes = [...new Set([...records, ...charted].map((r) => r.type))];
  renderCategoryLegend('car-service-legend', legendTypes.map((type) => {
    const info = carTypeInfo(type);
    return { name: info.label, color: chartColor(info.color) };
  }));
}

// Heading badge and a once-a-day notification for services due soon or overdue.
function updateCarServiceReminder(predictions, today) {
  const due = predictions.filter((p) => carDaysBetween(today, p.date) <= CAR_REMINDER_DAYS);
  if (!due.length) {
    setPageBadge('track', 'car-service', null);
    return;
  }

  const days = carDaysBetween(today, due[0].date);
  const names = [...new Set(due.map((p) => carTypeInfo(p.type).short))].join('+');
  const detail = due.map((p) => `${p.label} (${shortYearDate(p.date)})`).join(', ');
  setPageBadge('track', 'car-service', { text: `${days}d`, title: `Car service due: ${detail}` });

  if ('Notification' in window && Notification.permission === 'granted'
    && localStorage.getItem(CAR_NOTIFIED_KEY) !== today) {
    new Notification('Ledger', { body: `Car service ${days}d: ${names}` });
    localStorage.setItem(CAR_NOTIFIED_KEY, today);
  }
}

// Called from refreshTransactions (finance-transaction.js) whenever the rows change.
function renderCarService() {
  if (!document.getElementById('car-service-done-body')) return;
  const records = parseCarServiceTransactions();
  const today = isoFromDate(new Date());
  if (!records.length) {
    renderCarServiceTable([], []);
    if (carServiceChart) carServiceChart.destroy();
    carServiceChart = null;
    updateCarServiceReminder([], today);
    return;
  }
  const fit = carOdometerFit(records);
  const predictions = predictCarServices(records, fit, today);
  renderCarServiceTable(records, predictions);
  renderCarServiceChart(records, predictions, fit, today);
  updateCarServiceReminder(predictions, today);
}
