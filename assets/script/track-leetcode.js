// LeetCode: the NeetCode 250 roadmap (track-leetcode-roadmap.js) by category, ticked
// off from the LeetCode tab, one row per solve.

// Sheet columns, found by header name so a moved column can't shift values.
const LEETCODE_COLUMNS = [
  ['date', 'Date'], ['name', 'Problem'], ['category', 'Category'], ['difficulty', 'Difficulty'],
  ['link', 'LeetCode'], ['neetcode', 'NeetCode Page'], ['youtube', 'YouTube Video'], ['minutes', 'Duration'],
  ['notes', 'Notes'],
];
// Old headers still read, renamed on the next save.
const LEETCODE_OLD_HEADERS = { neetcode: 'neetcode video', minutes: 'video minutes' };
let leetcodeOldHeaders = []; // keys found under an old header
const LEETCODE_HEADERS = LEETCODE_COLUMNS.map(([, header]) => header);
// To ZZ, so a header past Z is still found (not re-added on every save).
const LEETCODE_RANGE = () => sheetRange(CONFIG.SHEETS.LEETCODE, 'A1:ZZ');
let leetcodeColumnIndex = {}; // key -> 0-based column, from the header row
const NEETCODE_BY_SLUG = new Map(NEETCODE_250.map((p) => [p.slug, p]));
// Category -> its problems, in NeetCode's order.
const NEETCODE_BY_CATEGORY = NEETCODE_250.reduce((map, p) => map.set(p.category, [...(map.get(p.category) || []), p]), new Map());

const leetcodeLink = (p) => `https://leetcode.com/problems/${p.slug}/`;
const neetcodePageLink = (p) => `https://neetcode.io/solutions/${p.slug}`;
const youtubeLink = (p) => `https://www.youtube.com/watch?v=${p.youtube}`;
// A problem's outside links: its row buttons and form fields. `generated` spots a
// link the form filled itself, so a pasted one is kept.
const LEETCODE_LINKS = [
  { key: 'youtube', emoji: '🎥', title: 'YouTube video', href: youtubeLink, generated: /youtube\.com\/watch\?v=/ },
  { key: 'neetcode', emoji: '📄', title: 'NeetCode page', href: neetcodePageLink, generated: /neetcode\.io\/solutions\// },
  { key: 'link', emoji: '🔗', title: 'LeetCode problem', href: leetcodeLink },
];

const LEETCODE_PACE_DAYS = 7; // the badge's and ETA's look-back
// Meter marks: every 25 problems, 10 hours of video and 4 weeks.
const LEETCODE_MARK_EVERY = { problems: 25, minutes: 600, days: 28 };
// One Letter page less @page's 0.25in margins, in px with a little slack; fonts in pt.
const LEETCODE_PRINT = { maxHeight: 10.5 * 96 - 8, minFont: 5, maxFont: 12, steps: 10 };

let allLeetcodeLogs = [];
let leetcodeSheetId = null;
let editingLeetcodeRow = null;
let leetcodeListenersAttached = false;
let editLeetcodeLog = null;
let openLeetcodeCategory = null; // one at a time; all closed on load

const leetcodeField = (key) => document.getElementById(`leetcode-${key}`);

function leetcodeToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// Enter or Space on a role="button" acts as its click.
function onLeetcodeActivate(el, activate) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
  });
}

async function initLeetcode() {
  if (!leetcodeListenersAttached) {
    leetcodeListenersAttached = true;
    document.getElementById('add-leetcode-btn').addEventListener('click', () => openLeetcodeForm());
    document.getElementById('print-leetcode-cheatsheet-btn').addEventListener('click', printLeetcodeCheatsheet);
    editLeetcodeLog = routedRowEdit('leetcode', () => allLeetcodeLogs, (l) => `${l.date} ${l.name}`, openLeetcodeForm);
    document.getElementById('leetcode-cancel-btn').addEventListener('click', closeLeetcodeForm);
    onFormSubmit('leetcode-form', submitLeetcodeForm);
    leetcodeField('problem').addEventListener('change', () => fillLeetcodeLinks());
    populateSelect(leetcodeField('category'), Object.keys(NEETCODE_ROADMAP), '');
    const options = leetcodeField('problem-options');
    NEETCODE_250.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.name;
      options.appendChild(option);
    });
    renderLeetcodeCheatsheet();
  }
  await refreshLeetcode();
}

// Maps each key to its header's column, noting keys still under an old header.
function readLeetcodeHeader(header) {
  const names = header.map((h) => String(h ?? '').trim().toLowerCase());
  leetcodeColumnIndex = {};
  leetcodeOldHeaders = [];
  LEETCODE_COLUMNS.forEach(([key, h]) => {
    let i = names.indexOf(h.toLowerCase());
    if (i === -1 && LEETCODE_OLD_HEADERS[key]) {
      i = names.indexOf(LEETCODE_OLD_HEADERS[key]);
      if (i !== -1) leetcodeOldHeaders.push(key);
    }
    if (i !== -1) leetcodeColumnIndex[key] = i;
  });
}

async function refreshLeetcode() {
  // The id is re-read each time, so a spreadsheet switch can't leave a stale one.
  const sheet = (await getSpreadsheetMetadata()).sheets.find((s) => s.properties.title === CONFIG.SHEETS.LEETCODE);
  leetcodeSheetId = sheet ? sheet.properties.sheetId : null;
  if (leetcodeSheetId === null) {
    allLeetcodeLogs = [];
  } else {
    const [header = [], ...rows] = (await getValues(LEETCODE_RANGE(), VALUE_PARAMS)).values || [];
    readLeetcodeHeader(header);
    const cell = (row, key) => String(row[leetcodeColumnIndex[key]] ?? '').trim();
    allLeetcodeLogs = rows.map((row, i) => {
      const slug = findNeetcodeProblem(cell(row, 'link'))?.slug || findNeetcodeProblem(cell(row, 'name'))?.slug || '';
      const p = NEETCODE_BY_SLUG.get(slug);
      return {
        row: i + 2,
        date: cell(row, 'date').slice(0, 10),
        name: cell(row, 'name') || p?.name || slug,
        slug,
        category: cell(row, 'category') || p?.category || '',
        difficulty: cell(row, 'difficulty') || p?.difficulty || '',
        link: cell(row, 'link'),
        neetcode: cell(row, 'neetcode'),
        youtube: cell(row, 'youtube'),
        minutes: Number(cell(row, 'minutes')) || 0,
        notes: cell(row, 'notes'),
      };
    }).filter((l) => l.slug);
  }
  renderLeetcode();
}

function renderLeetcodeCheatsheet() {
  // A table per category so the two columns break between them.
  const box = document.getElementById('leetcode-cheatsheet');
  box.innerHTML = '';
  Object.entries(LEETCODE_CHEATSHEET).forEach(([category, rows]) => {
    const table = box.appendChild(document.createElement('table'));
    table.className = 'table-compact';
    const row = table.createTHead().insertRow();
    row.className = 'leetcode-cheatsheet-start';
    const th = row.appendChild(document.createElement('th'));
    th.colSpan = 2;
    th.textContent = category;
    const body = table.createTBody();
    rows.forEach(([code, , use]) => {
      const tr = body.insertRow();
      tr.insertCell().appendChild(document.createElement('code')).textContent = code;
      tr.insertCell().textContent = use;
    });
  });
}

// Prints only the Cheat Sheet (html.print-cheatsheet in styles.css), its font the
// largest that fits one page, by bisection.
function printLeetcodeCheatsheet() {
  const root = document.documentElement;
  const card = document.getElementById('leetcode-cheatsheet-card');
  const { maxHeight, minFont, maxFont, steps } = LEETCODE_PRINT;
  root.classList.add('print-cheatsheet');
  card.style.setProperty('--cheatsheet-width', '8in');
  let lo = minFont, hi = maxFont;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    card.style.setProperty('--cheatsheet-font', `${mid}pt`);
    if (card.offsetHeight <= maxHeight) lo = mid; else hi = mid;
  }
  card.style.setProperty('--cheatsheet-font', `${lo}pt`);
  window.addEventListener('afterprint', () => {
    root.classList.remove('print-cheatsheet');
    card.style.removeProperty('--cheatsheet-width');
    card.style.removeProperty('--cheatsheet-font');
  }, { once: true });
  window.print();
}

// Slug -> its solves, oldest first.
function leetcodeSolves() {
  const solves = new Map();
  [...allLeetcodeLogs].sort((a, b) => a.date.localeCompare(b.date)).forEach((l) => {
    if (!solves.has(l.slug)) solves.set(l.slug, []);
    solves.get(l.slug).push(l);
  });
  return solves;
}

function renderLeetcode() {
  const solves = leetcodeSolves();
  const solved = NEETCODE_250.filter((p) => solves.has(p.slug));
  const byDifficulty = ['Easy', 'Medium', 'Hard'].map((d) => {
    const all = NEETCODE_250.filter((p) => p.difficulty === d).length;
    return `${d} ${solved.filter((p) => p.difficulty === d).length}/${all}`;
  });
  document.getElementById('leetcode-summary').textContent = `Solved ${solved.length}/${NEETCODE_250.length} · ${byDifficulty.join(' · ')}`;

  renderLeetcodeProgress(solves);
  renderLeetcodeHeatmap();
  checkLeetcodeBadge();
  renderLeetcodeRoadmap(solves);

  const container = document.getElementById('leetcode-list');
  container.innerHTML = '';
  NEETCODE_BY_CATEGORY.forEach((problems, category) => {
    container.appendChild(buildLeetcodeCategory(category, problems, solves));
  });
}

// A red badge of the solves today still owes: the last 7 days' average (rounded up)
// less today's solves.
function checkLeetcodeBadge() {
  const today = leetcodeToday();
  const todayIso = isoFromDate(today);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - LEETCODE_PACE_DAYS);
  const weekAgoIso = isoFromDate(weekAgo);
  const weekSolves = allLeetcodeLogs.filter((l) => l.date >= weekAgoIso && l.date < todayIso).length;
  const todaySolves = allLeetcodeLogs.filter((l) => l.date === todayIso).length;
  const owed = Math.ceil(weekSolves / LEETCODE_PACE_DAYS) - todaySolves;
  setPageBadge('track', 'leetcode', owed > 0 ? {
    text: String(owed),
    title: `${owed} more to match the last 7 days' average of ${(weekSolves / LEETCODE_PACE_DAYS).toFixed(1)} solves a day (${todaySolves} today)`,
  } : null);
}

// Fills a Progress meter to `pct`; with `markStep`, its track gets a mark every that many percent.
function setLeetcodeMeter(meter, pct, markStep) {
  meter.style.setProperty('--meter-pct', `${pct}`);
  meter.style.setProperty('--fill-pct', `${Math.round(pct)}`);
  if (markStep !== undefined) meter.querySelector('.body-mass-progress-meter-track').style.setProperty('--mark-step', `${markStep}`);
}

// Health's Progress meter over the NeetCode 250, then video minutes, then time:
// days since the first solve against days to go at last week's pace.
function renderLeetcodeProgress(solves) {
  const total = NEETCODE_250.length;
  const done = NEETCODE_250.filter((p) => solves.has(p.slug)).length;
  setLeetcodeMeter(document.getElementById('leetcode-progress-meter'), (done / total) * 100, (LEETCODE_MARK_EVERY.problems / total) * 100);
  document.getElementById('leetcode-progress-meter-callout').textContent = `${done}/${total}`;
  document.getElementById('leetcode-progress-meter-done').textContent = String(done);
  document.getElementById('leetcode-progress-meter-remaining').textContent = String(total - done);

  // A solve's logged minutes, else its video's.
  const minutesOf = (p) => solves.get(p.slug)?.at(-1).minutes || p.minutes;
  const allMinutes = NEETCODE_250.reduce((sum, p) => sum + minutesOf(p), 0);
  const doneMinutes = NEETCODE_250.filter((p) => solves.has(p.slug)).reduce((sum, p) => sum + minutesOf(p), 0);
  setLeetcodeMeter(document.getElementById('leetcode-minutes-meter'), allMinutes ? (doneMinutes / allMinutes) * 100 : 0, (LEETCODE_MARK_EVERY.minutes / allMinutes) * 100);
  const hours = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  document.getElementById('leetcode-minutes-meter-done').textContent = hours(doneMinutes);
  document.getElementById('leetcode-minutes-meter-remaining').textContent = hours(allMinutes - doneMinutes);

  const time = document.getElementById('leetcode-time-meter');
  const elapsedEl = document.getElementById('leetcode-time-meter-elapsed');
  const remainingEl = document.getElementById('leetcode-time-meter-remaining');
  const etaEl = document.getElementById('leetcode-time-meter-eta');
  time.style.setProperty('--meter-pct', '0');
  time.style.removeProperty('--fill-pct');
  time.querySelector('.body-mass-progress-meter-track').style.removeProperty('--mark-step');
  elapsedEl.textContent = '—';
  remainingEl.textContent = '—';
  etaEl.textContent = '';
  const firstDates = [...solves.values()].map((s) => s[0].date).filter(Boolean).sort();
  if (!firstDates.length) return;

  const today = leetcodeToday();
  const todayMs = parseIsoDateUTC(isoFromDate(today));
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - LEETCODE_PACE_DAYS);
  // New problems a day: the faster of the last 7 days with today and the 7 before it,
  // so an unfinished today can't drag the ETA out but today's solves still count.
  const weekAgoIso = isoFromDate(weekAgo);
  const todayIso = isoFromDate(today);
  const newSince = (fromIso, beforeIso) => firstDates.filter((d) => d >= fromIso && (!beforeIso || d < beforeIso)).length;
  const sixDaysAgo = new Date(today);
  sixDaysAgo.setDate(sixDaysAgo.getDate() - (LEETCODE_PACE_DAYS - 1));
  const rate = Math.max(newSince(isoFromDate(sixDaysAgo)), newSince(weekAgoIso, todayIso)) / LEETCODE_PACE_DAYS;
  const daysElapsed = Math.max(0, Math.round((todayMs - parseIsoDateUTC(firstDates[0])) / MS_PER_DAY));
  const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  elapsedEl.textContent = days(daysElapsed);
  if (done < total && !rate) return;

  const daysToGo = Math.ceil((total - done) / (rate || 1));
  const totalDays = daysElapsed + daysToGo;
  setLeetcodeMeter(time, totalDays ? (daysElapsed / totalDays) * 100 : 100,
    totalDays ? (LEETCODE_MARK_EVERY.days / totalDays) * 100 : undefined);
  remainingEl.textContent = days(daysToGo);
  const eta = new Date(today);
  eta.setDate(eta.getDate() + daysToGo);
  etaEl.textContent = `→ ${shortYearDate(isoFromDate(eta))}`;
}

// Solves per day from the first solve's Monday to today, as Health Chart's All:
// a column per week. Each day shows its count, shaded by its video minutes up
// to the longest day's.
function renderLeetcodeHeatmap() {
  const today = leetcodeToday();
  const first = allLeetcodeLogs.map((l) => l.date).filter(Boolean).sort()[0];
  const start = first ? dateFromIso(first) : new Date(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks = Math.max(1, Math.ceil((Math.round((today - start) / MS_PER_DAY) + 1) / 7));

  const perDay = new Map(); // date -> {count, minutes}
  allLeetcodeLogs.forEach((l) => {
    const day = perDay.get(l.date) || { count: 0, minutes: 0 };
    day.count += 1;
    day.minutes += l.minutes || NEETCODE_BY_SLUG.get(l.slug)?.minutes || 0;
    perDay.set(l.date, day);
  });
  const maxMinutes = Math.max(1, ...[...perDay.values()].map((day) => day.minutes));

  const grid = document.getElementById('leetcode-heatmap');
  const months = document.getElementById('leetcode-heatmap-months');
  grid.innerHTML = '';
  months.innerHTML = '';
  for (let d = new Date(start), i = 0; d <= today; d.setDate(d.getDate() + 1), i++) {
    const iso = isoFromDate(d);
    const { count = 0, minutes = 0 } = perDay.get(iso) || {};
    const cell = document.createElement('span');
    if (count) {
      const pct = Math.round((minutes / maxMinutes) * 100);
      cell.className = 'heat-graded';
      cell.style.background = `color-mix(in srgb, color-mix(in srgb, var(--color-income) 45%, black) ${pct}%, transparent)`;
      if (pct >= 50) cell.style.color = '#fff';
      cell.textContent = String(count);
    }
    cell.title = `${shortYearDate(iso)}: ${count} solve${count === 1 ? '' : 's'} · ${minutes} min`;
    grid.appendChild(cell);
    // A month's name over the first week it starts in.
    if (d.getDate() <= 7 && d.getDay() === 1) {
      const label = document.createElement('span');
      label.textContent = wordDate(d, false);
      label.style.gridColumn = String(Math.floor(i / 7) + 1);
      months.appendChild(label);
    }
  }
  grid.style.setProperty('--weeks', String(weeks));
  months.style.setProperty('--weeks', String(weeks));
  const scroll = document.getElementById('leetcode-heatmap-scroll');
  scroll.scrollLeft = scroll.scrollWidth;
}

// NeetCode's roadmap at its own positions (y squeezed to fit), a node per
// category with its count and progress bar; a click opens its card below.
const ROADMAP_NODE = { w: 210, wLong: 254, h: 66, ySquash: 0.55 };
// The viewBox padding, node corner radius and progress bar's inset, offset and height.
const ROADMAP_LAYOUT = { pad: 10, rx: 12, barInset: 32, barY: 21, barH: 5 };
const roadmapNodeWidth = (name) => (name.length > 21 ? ROADMAP_NODE.wLong : ROADMAP_NODE.w);

function renderLeetcodeRoadmap(solves) {
  const svg = document.getElementById('leetcode-roadmap');
  const ns = 'http://www.w3.org/2000/svg';
  const make = (tag, attrs, parent) => {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    parent.appendChild(el);
    return el;
  };
  const { wLong, h, ySquash } = ROADMAP_NODE;
  const { pad, rx, barInset, barY, barH } = ROADMAP_LAYOUT;
  const at = (name) => ({ x: NEETCODE_ROADMAP[name][0], y: NEETCODE_ROADMAP[name][1] * ySquash });
  const points = Object.keys(NEETCODE_ROADMAP).map(at);
  const minX = Math.min(...points.map((p) => p.x)) - wLong / 2 - pad;
  const minY = Math.min(...points.map((p) => p.y)) - h / 2 - pad;
  const width = Math.max(...points.map((p) => p.x)) + wLong / 2 + pad - minX;
  const height = Math.max(...points.map((p) => p.y)) + h / 2 + pad - minY;
  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  svg.innerHTML = '';

  Object.entries(NEETCODE_ROADMAP).forEach(([name, [, , parents]]) => {
    const c = at(name);
    parents.forEach((parent) => {
      const p = at(parent);
      const y1 = p.y + h / 2;
      const y2 = c.y - h / 2;
      make('path', { d: `M${p.x} ${y1} C${p.x} ${(y1 + y2) / 2} ${c.x} ${(y1 + y2) / 2} ${c.x} ${y2}` }, svg);
    });
  });

  Object.keys(NEETCODE_ROADMAP).forEach((name) => {
    const { x, y } = at(name);
    const w = roadmapNodeWidth(name);
    const problems = NEETCODE_BY_CATEGORY.get(name);
    const done = problems.filter((p) => solves.has(p.slug)).length;
    const label = `${name}: ${done}/${problems.length} solved`;
    const node = make('g', {
      tabindex: '0', role: 'button', 'aria-label': label,
      class: [done === problems.length ? 'done' : '', openLeetcodeCategory === name ? 'open' : ''].join(' ').trim(),
    }, svg);
    make('title', {}, node).textContent = label;
    make('rect', { class: 'roadmap-box', x: x - w / 2, y: y - h / 2, width: w, height: h, rx }, node);
    make('text', { x, y: y - 6 }, node).textContent = name;
    make('text', { class: 'roadmap-count', x, y: y + 14 }, node).textContent = `${done}/${problems.length}`;
    const barW = w - barInset;
    const bar = { x: x - barW / 2, y: y + barY, height: barH, rx: barH / 2 };
    make('rect', { class: 'roadmap-track', x: bar.x, y: bar.y, width: barW, height: bar.height, rx: bar.rx }, node);
    if (done) make('rect', { class: 'roadmap-fill', x: bar.x, y: bar.y, width: (barW * done) / problems.length, height: bar.height, rx: bar.rx }, node);
    const open = () => {
      openLeetcodeCategory = name;
      renderLeetcode();
      document.querySelector(`#leetcode-list .app-card[data-category="${CSS.escape(name)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    node.addEventListener('click', open);
    onLeetcodeActivate(node, open);
  });
}

// The Application card, one per category, holding its problems' table.
function buildLeetcodeCategory(category, problems, solves) {
  const card = document.createElement('div');
  card.className = 'app-card leetcode-category';
  card.dataset.category = category;
  if (openLeetcodeCategory !== category) card.classList.add('collapsed');

  const header = document.createElement('div');
  header.className = 'app-card-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', String(!card.classList.contains('collapsed')));
  const icon = document.createElement('span');
  icon.className = 'panel-toggle-icon app-card-toggle-icon';
  icon.textContent = '▾';
  const title = document.createElement('div');
  title.className = 'app-card-title';
  const name = document.createElement('strong');
  name.textContent = category;
  const meta = document.createElement('span');
  meta.className = 'app-card-meta';
  meta.textContent = `${problems.filter((p) => solves.has(p.slug)).length}/${problems.length} solved`;
  title.append(name, meta);
  header.append(icon, title);

  // Opening one closes the others.
  const toggle = () => {
    const expanded = card.classList.contains('collapsed');
    card.parentElement.querySelectorAll('.app-card').forEach((other) => {
      other.classList.add('collapsed');
      other.querySelector('.app-card-header').setAttribute('aria-expanded', 'false');
    });
    card.classList.toggle('collapsed', !expanded);
    header.setAttribute('aria-expanded', String(expanded));
    openLeetcodeCategory = expanded ? category : null;
    renderLeetcodeRoadmap(leetcodeSolves());
  };
  header.addEventListener('click', () => {
    if (window.getSelection().toString()) return;
    toggle();
  });
  onLeetcodeActivate(header, toggle);

  const body = document.createElement('div');
  body.className = 'app-card-body';
  const scroller = document.createElement('div');
  scroller.className = 'table-responsive';
  const table = document.createElement('table');
  table.className = 'table-compact';
  table.innerHTML = '<thead><tr><th></th><th>Solved</th><th>Problem</th><th>Difficulty</th><th>Duration</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  const today = isoFromDate(new Date());
  let left = 0;
  problems.forEach((p) => {
    const logs = solves.get(p.slug) || [];
    const latest = logs.at(-1);
    const tr = document.createElement('tr');
    if (latest?.date === today) tr.className = 'today-row';
    const notes = logs.map((l) => l.notes).filter(Boolean).join(' · ');
    const solvedText = logs.length ? `${shortYearDate(logs[0].date)}${logs.length > 1 ? ` ×${logs.length}` : ''}` : '';
    const actions = document.createElement('td');
    actions.className = 'workout-actions-cell';
    // The outside links, as buttons like ✏️/🗑️.
    const open = (href) => () => window.open(href, '_blank', 'noopener');
    actions.append(...LEETCODE_LINKS.map(({ key, emoji, title: linkTitle, href }) => makeRowActionButton({
      emoji, title: linkTitle, onClick: open(safeHref(latest?.[key]) || href(p)), readOnly: true,
    })));
    if (latest) {
      actions.append(
        makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editLeetcodeLog(latest) }),
        makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteLeetcodeLog(latest) }),
      );
    } else {
      actions.append(makeRowActionButton({ emoji: '📝', title: 'Log', onClick: () => {
        // Routes as the header's Log does: …/leetcode/log/.
        routeRecordEdit('leetcode', { slug: 'log', label: 'Log' });
        openLeetcodeForm(null, p);
      } }));
    }
    tr.append(
      // ✅ once solved, else its count among those left (1, 2, …).
      makeCell(logs.length ? '✅' : String(++left)), makeCell(solvedText, logs.map((l) => shortYearDate(l.date)).join(', ') + (notes ? ` — ${notes}` : '')),
      makeCell(p.name), makeCell(latest?.difficulty || p.difficulty),
      makeCell(`${latest?.minutes || p.minutes} min`), actions,
    );
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroller.appendChild(table);
  body.appendChild(scroller);
  card.append(header, body);
  return card;
}

// --- Log form ---------------------------------------------------------------

function openLeetcodeForm(log = null, problem = null) {
  editingLeetcodeRow = log?.row ?? null;
  leetcodeField('date').value = log?.date || isoFromDate(new Date());
  leetcodeField('problem').value = log?.name || problem?.name || '';
  leetcodeField('category').value = log?.category || problem?.category || '';
  leetcodeField('difficulty').value = log?.difficulty || problem?.difficulty || '';
  ['link', 'neetcode', 'youtube', 'minutes'].forEach((key) => { leetcodeField(key).value = log?.[key] || ''; });
  fillLeetcodeLinks(Boolean(log));
  leetcodeField('notes').value = log?.notes || '';
  clearFieldError('leetcode-form-error');
  document.getElementById('leetcode-modal').hidden = false;
}

function closeLeetcodeForm() {
  document.getElementById('leetcode-modal').hidden = true;
  editingLeetcodeRow = null;
}

// Category, difficulty and links follow the problem picked; saved ones or a pasted link are kept.
function fillLeetcodeLinks(keepDifficulty = false) {
  const problem = findNeetcodeProblem(leetcodeField('problem').value);
  if (!problem) return;
  if (!keepDifficulty) {
    leetcodeField('category').value = problem.category;
    leetcodeField('difficulty').value = problem.difficulty;
  }
  LEETCODE_LINKS.forEach(({ key, href, generated }) => {
    const field = leetcodeField(key);
    const keep = generated ? field.value && !generated.test(field.value) : findNeetcodeProblem(field.value) === problem;
    if (!keep) field.value = href(problem);
  });
  const minutes = leetcodeField('minutes');
  if (!keepDifficulty || !minutes.value) minutes.value = problem.minutes;
}

// A roadmap problem from its name, LeetCode slug or LeetCode/NeetCode link.
function findNeetcodeProblem(text) {
  const raw = text.trim().toLowerCase();
  const slug = /\/problems\/([a-z0-9-]+)/.exec(raw)?.[1] || raw;
  return NEETCODE_250.find((p) => p.name.toLowerCase() === raw || p.slug === slug || p.neetcode === slug) || null;
}

async function submitLeetcodeForm() {
  const problem = findNeetcodeProblem(leetcodeField('problem').value);
  const date = leetcodeField('date').value;
  if (!problem) return showFieldError('leetcode-form-error', 'Pick a problem from the NeetCode 250 list.');
  if (!date) return showFieldError('leetcode-form-error', 'Pick the date you solved it.');

  try {
    const link = (key, href) => leetcodeField(key).value.trim() || href(problem);
    const log = {
      date,
      name: problem.name,
      category: leetcodeField('category').value || problem.category,
      difficulty: leetcodeField('difficulty').value || problem.difficulty,
      link: link('link', leetcodeLink),
      neetcode: link('neetcode', neetcodePageLink),
      youtube: link('youtube', youtubeLink),
      minutes: Number(leetcodeField('minutes').value) || problem.minutes,
      notes: leetcodeField('notes').value.trim(),
    };
    const savedRow = await writeLeetcodeLog(log, editingLeetcodeRow);
    openLeetcodeCategory = problem.category;
    await refreshLeetcode();
    const saved = allLeetcodeLogs.find((l) => l.row === savedRow);
    if (saved) {
      openLeetcodeForm(saved);
      stayOnSavedForm('leetcode-modal', editLeetcodeLog.step(saved));
    }
    showFormSaved('leetcode-form-error');
  } catch (err) {
    showFieldError('leetcode-form-error', err.message);
  }
}

// Writes a solve cell by cell under its headers (a missing header is added at
// the end, an old one renamed); `row` null appends. Returns the sheet row.
async function writeLeetcodeLog(log, row = null) {
  const tab = CONFIG.SHEETS.LEETCODE;
  const cellRange = (key, r) => sheetRange(tab, `${physiqueColumnLetter(leetcodeColumnIndex[key])}${r}`);
  leetcodeSheetId = await ensureSheetTab(tab, LEETCODE_HEADERS);
  if (!Object.keys(leetcodeColumnIndex).length) await refreshLeetcode();
  const header = [];
  LEETCODE_COLUMNS.forEach(([key, h]) => {
    if (leetcodeColumnIndex[key] !== undefined && !leetcodeOldHeaders.includes(key)) return;
    if (leetcodeColumnIndex[key] === undefined) leetcodeColumnIndex[key] = Math.max(-1, ...Object.values(leetcodeColumnIndex)) + 1;
    header.push({ range: cellRange(key, 1), values: [[h]] });
  });
  if (header.length) await batchUpdateValues(header, 'RAW');
  leetcodeOldHeaders = [];
  if (!row) {
    const width = Math.max(...Object.values(leetcodeColumnIndex)) + 1;
    const values = Array(width).fill('');
    LEETCODE_COLUMNS.forEach(([key]) => { values[leetcodeColumnIndex[key]] = log[key] ?? ''; });
    return appendedRow(await appendValues(sheetRange(tab, `A2:${physiqueColumnLetter(width - 1)}`), [values], 'RAW'));
  }
  await batchUpdateValues(LEETCODE_COLUMNS.map(([key]) => ({ range: cellRange(key, row), values: [[log[key] ?? '']] })), 'RAW');
  return row;
}

async function deleteLeetcodeLog(log) {
  await confirmAndDelete(`Delete the ${shortYearDate(log.date)} solve of ${log.name}?`, async () => {
    if (leetcodeSheetId === null) leetcodeSheetId = await ensureSheetTab(CONFIG.SHEETS.LEETCODE, LEETCODE_HEADERS);
    await batchUpdate([sheetRowDeleteRequest(leetcodeSheetId, log.row)]);
    await refreshLeetcode();
    showUndoToast(`${log.name} solve deleted.`, async () => {
      try {
        await writeLeetcodeLog(log);
        await refreshLeetcode();
      } catch (err) {
        showToast(`Couldn't restore the solve: ${err.message}`, true);
      }
    });
  }, "Couldn't delete the solve");
}
