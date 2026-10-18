// LeetCode: the NeetCode 250 roadmap (track-leetcode-roadmap.js) by category, ticked
// off from the LeetCode tab, one row per solve.

// Sheet columns, found by header name (as Physique's), so a moved or added
// column can't shift values into the wrong cell.
const LEETCODE_COLUMNS = [
  ['date', 'Date'], ['name', 'Problem'], ['category', 'Category'], ['difficulty', 'Difficulty'],
  ['link', 'LeetCode'], ['video', 'NeetCode Video'], ['notes', 'Notes'],
];
const LEETCODE_HEADERS = LEETCODE_COLUMNS.map(([, header]) => header);
const LEETCODE_RANGE = () => `'${CONFIG.SHEETS.LEETCODE}'!A1:Z`;
let leetcodeColumnIndex = {}; // key -> 0-based column, from the header row
const NEETCODE_BY_SLUG = new Map(NEETCODE_250.map((p) => [p.slug, p]));

const leetcodeLink = (p) => `https://leetcode.com/problems/${p.slug}/`;
const neetcodeVideoLink = (p) => `https://neetcode.io/solutions/${p.slug}`;

let allLeetcodeLogs = [];
let leetcodeSheetId = null;
let editingLeetcodeRow = null;
let leetcodeListenersAttached = false;
let editLeetcodeLog = null;
let openLeetcodeCategory; // one at a time; undefined until first shown
// A phone shows the heatmap's last 16 weeks, not the year.
const leetcodePhoneQuery = window.matchMedia('(max-width: 820px)');

async function initLeetcode() {
  if (!leetcodeListenersAttached) {
    leetcodeListenersAttached = true;
    document.getElementById('add-leetcode-btn').addEventListener('click', () => openLeetcodeForm());
    editLeetcodeLog = routedRowEdit('leetcode', () => allLeetcodeLogs, (l) => `${l.date} ${l.name}`, openLeetcodeForm);
    document.getElementById('leetcode-cancel-btn').addEventListener('click', closeLeetcodeForm);
    onFormSubmit('leetcode-form', submitLeetcodeForm);
    leetcodePhoneQuery.addEventListener('change', renderLeetcodeHeatmap);
    document.getElementById('leetcode-problem').addEventListener('change', () => fillLeetcodeLinks());
    populateSelect(document.getElementById('leetcode-category'), Object.keys(NEETCODE_ROADMAP), '');
    const options = document.getElementById('leetcode-problem-options');
    NEETCODE_250.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.name;
      options.appendChild(option);
    });
  }
  await refreshLeetcode();
}

async function refreshLeetcode() {
  if (!(await sheetTabExists(CONFIG.SHEETS.LEETCODE))) {
    allLeetcodeLogs = [];
    leetcodeSheetId = null;
  } else {
    const [header = [], ...rows] = (await getValues(LEETCODE_RANGE(), VALUE_PARAMS)).values || [];
    const names = header.map((h) => String(h ?? '').trim().toLowerCase());
    leetcodeColumnIndex = {};
    LEETCODE_COLUMNS.forEach(([key, h]) => {
      const i = names.indexOf(h.toLowerCase());
      if (i !== -1) leetcodeColumnIndex[key] = i;
    });
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
        video: cell(row, 'video'),
        notes: cell(row, 'notes'),
      };
    }).filter((l) => l.slug);
  }
  renderLeetcode();
}

// Slug -> its solves, oldest first.
function leetcodeSolves() {
  const solves = new Map();
  [...allLeetcodeLogs].sort((a, b) => a.date.localeCompare(b.date)).forEach((l) => {
    solves.set(l.slug, [...(solves.get(l.slug) || []), l]);
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
  renderLeetcodeRoadmap(solves);

  const container = document.getElementById('leetcode-list');
  container.innerHTML = '';
  const categories = [...new Set(NEETCODE_250.map((p) => p.category))];
  // Opens on the first category not yet finished.
  if (openLeetcodeCategory === undefined) {
    openLeetcodeCategory = categories.find((c) => NEETCODE_250.some((p) => p.category === c && !solves.has(p.slug))) ?? null;
  }
  categories.forEach((category) => {
    const problems = NEETCODE_250.filter((p) => p.category === category);
    container.appendChild(buildLeetcodeCategory(category, problems, solves));
  });
}

// Health's Progress meter over the NeetCode 250, a mark every 25, then the time
// meter: days since the first solve against days to go at last week's pace.
function renderLeetcodeProgress(solves) {
  const total = NEETCODE_250.length;
  const done = NEETCODE_250.filter((p) => solves.has(p.slug)).length;
  const pct = (done / total) * 100;
  const meter = document.getElementById('leetcode-progress-meter');
  meter.style.setProperty('--meter-pct', `${pct}`);
  meter.style.setProperty('--fill-pct', `${Math.round(pct)}`);
  meter.querySelector('.body-mass-progress-meter-track').style.setProperty('--mark-step', `${(25 / total) * 100}`);
  document.getElementById('leetcode-progress-meter-callout').textContent = `${done}/${total}`;
  document.getElementById('leetcode-progress-meter-done').textContent = String(done);
  document.getElementById('leetcode-progress-meter-remaining').textContent = String(total - done);

  const time = document.getElementById('leetcode-time-meter');
  const elapsedEl = document.getElementById('leetcode-time-meter-elapsed');
  const remainingEl = document.getElementById('leetcode-time-meter-remaining');
  const etaEl = document.getElementById('leetcode-time-meter-eta');
  time.style.setProperty('--meter-pct', '0');
  time.style.removeProperty('--fill-pct');
  const timeTrack = time.querySelector('.body-mass-progress-meter-track');
  timeTrack.style.removeProperty('--mark-step');
  elapsedEl.textContent = '—';
  remainingEl.textContent = '—';
  etaEl.textContent = '';
  const firstDates = [...solves.values()].map((s) => s[0].date).filter(Boolean).sort();
  if (!firstDates.length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = parseIsoDateUTC(isoFromDate(today));
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  // New problems a day over the last 7 days, today included.
  const rate = firstDates.filter((d) => d >= isoFromDate(weekAgo)).length / 7;
  const daysElapsed = Math.max(0, Math.round((todayMs - parseIsoDateUTC(firstDates[0])) / 86400000));
  const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  elapsedEl.textContent = days(daysElapsed);
  if (done < total && !rate) return;

  const daysToGo = Math.ceil((total - done) / (rate || 1));
  const totalDays = daysElapsed + daysToGo;
  const timePct = totalDays ? (daysElapsed / totalDays) * 100 : 100;
  time.style.setProperty('--meter-pct', `${timePct}`);
  time.style.setProperty('--fill-pct', `${Math.round(timePct)}`);
  // A mark every 4 weeks from the first solve.
  if (totalDays) timeTrack.style.setProperty('--mark-step', `${(28 / totalDays) * 100}`);
  remainingEl.textContent = days(daysToGo);
  const eta = new Date(today);
  eta.setDate(eta.getDate() + daysToGo);
  etaEl.textContent = `→ ${isoFromDate(eta)}`;
}

// Solves per day for the past year (16 weeks on a phone): columns are weeks
// (Monday first), the last one holding today; 1 solve is level 1, the busiest day level 4.
function renderLeetcodeHeatmap() {
  const weeks = leetcodePhoneQuery.matches ? 16 : 53;
  document.getElementById('leetcode-heatmap-title').textContent = leetcodePhoneQuery.matches ? 'Past 16 Weeks' : 'Past Year';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks - 1) * 7);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const startIso = isoFromDate(start);

  const perDay = new Map();
  allLeetcodeLogs.forEach((l) => {
    if (l.date >= startIso) perDay.set(l.date, (perDay.get(l.date) || 0) + 1);
  });
  const max = Math.max(1, ...perDay.values());

  const grid = document.getElementById('leetcode-heatmap');
  const months = document.getElementById('leetcode-heatmap-months');
  grid.innerHTML = '';
  months.innerHTML = '';
  for (let d = new Date(start), i = 0; d <= today; d.setDate(d.getDate() + 1), i++) {
    const iso = isoFromDate(d);
    const count = perDay.get(iso) || 0;
    const cell = document.createElement('span');
    if (count) cell.className = `heat-${max === 1 ? 1 : 1 + Math.round((3 * (count - 1)) / (max - 1))}`;
    cell.title = `${iso}: ${count} solve${count === 1 ? '' : 's'}`;
    grid.appendChild(cell);
    // A month's name over the first week it starts in.
    if (d.getDate() <= 7 && d.getDay() === 1) {
      const label = document.createElement('span');
      label.textContent = d.toLocaleString('en', { month: 'short' });
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
  const at = (name) => ({ x: NEETCODE_ROADMAP[name][0], y: NEETCODE_ROADMAP[name][1] * ySquash });
  const points = Object.keys(NEETCODE_ROADMAP).map(at);
  const pad = 10;
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
    const problems = NEETCODE_250.filter((p) => p.category === name);
    const done = problems.filter((p) => solves.has(p.slug)).length;
    const node = make('g', {
      tabindex: '0', role: 'button', 'aria-label': `${name}: ${done}/${problems.length} solved`,
      class: [done === problems.length ? 'done' : '', openLeetcodeCategory === name ? 'open' : ''].join(' ').trim(),
    }, svg);
    make('title', {}, node).textContent = `${name}: ${done}/${problems.length} solved`;
    make('rect', { class: 'roadmap-box', x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 12 }, node);
    make('text', { x, y: y - 6 }, node).textContent = name;
    make('text', { class: 'roadmap-count', x, y: y + 14 }, node).textContent = `${done}/${problems.length}`;
    const barW = w - 32;
    make('rect', { class: 'roadmap-track', x: x - barW / 2, y: y + 21, width: barW, height: 5, rx: 2.5 }, node);
    if (done) make('rect', { class: 'roadmap-fill', x: x - barW / 2, y: y + 21, width: (barW * done) / problems.length, height: 5, rx: 2.5 }, node);
    const open = () => {
      openLeetcodeCategory = name;
      renderLeetcode();
      document.querySelector(`#leetcode-list .app-card[data-category="${CSS.escape(name)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    node.addEventListener('click', open);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
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
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  const body = document.createElement('div');
  body.className = 'app-card-body';
  const scroller = document.createElement('div');
  scroller.className = 'table-responsive';
  const table = document.createElement('table');
  table.className = 'table-compact';
  table.innerHTML = '<thead><tr><th></th><th>Solved</th><th>Problem</th><th>Difficulty</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  const today = isoFromDate(new Date());
  problems.forEach((p) => {
    const logs = solves.get(p.slug) || [];
    const latest = logs.at(-1);
    const tr = document.createElement('tr');
    if (latest?.date === today) tr.className = 'today-row';
    const notes = logs.map((l) => l.notes).filter(Boolean).join(' · ');
    const solvedText = logs.length ? `${logs[0].date}${logs.length > 1 ? ` ×${logs.length}` : ''}` : '';
    const actions = document.createElement('td');
    actions.className = 'workout-actions-cell';
    // 🎥 NeetCode's video and 🔗 the LeetCode problem, as buttons like ✏️/🗑️.
    const open = (href) => () => window.open(href, '_blank', 'noopener');
    actions.append(
      makeRowActionButton({ emoji: '🎥', title: 'NeetCode video', onClick: open(latest?.video || neetcodeVideoLink(p)) }),
      makeRowActionButton({ emoji: '🔗', title: 'LeetCode problem', onClick: open(latest?.link || leetcodeLink(p)) }),
    );
    if (latest) {
      actions.append(
        makeRowActionButton({ emoji: '✏️', title: 'Edit', onClick: () => editLeetcodeLog(latest) }),
        makeRowActionButton({ emoji: '🗑️', title: 'Delete', onClick: () => deleteLeetcodeLog(latest) }),
      );
    } else {
      actions.append(makeRowActionButton({ emoji: '📝', title: 'Log', onClick: () => {
        // Opens as the header's Log does: its own page at …/leetcode/log/.
        routeRecordEdit('leetcode', { slug: 'log', label: 'Log' });
        openLeetcodeForm(null, p);
      } }));
    }
    tr.append(
      makeCell(logs.length ? '✅' : ''), makeCell(solvedText, logs.map((l) => l.date).join(', ') + (notes ? ` — ${notes}` : '')),
      makeCell(p.name), makeCell(latest?.difficulty || p.difficulty), actions,
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
  document.getElementById('leetcode-modal-title').textContent = log ? 'Edit LeetCode' : 'Log LeetCode';
  document.getElementById('leetcode-date').value = log?.date || isoFromDate(new Date());
  document.getElementById('leetcode-problem').value = log?.name || problem?.name || '';
  document.getElementById('leetcode-category').value = log?.category || problem?.category || '';
  document.getElementById('leetcode-difficulty').value = log?.difficulty || problem?.difficulty || '';
  document.getElementById('leetcode-link').value = log?.link || '';
  document.getElementById('leetcode-video').value = log?.video || '';
  fillLeetcodeLinks(Boolean(log));
  document.getElementById('leetcode-notes').value = log?.notes || '';
  clearFieldError('leetcode-form-error');
  document.getElementById('leetcode-modal').hidden = false;
}

function closeLeetcodeForm() {
  document.getElementById('leetcode-modal').hidden = true;
  editingLeetcodeRow = null;
}

// Category, difficulty and links follow the problem picked; saved ones or a pasted video link are kept.
function fillLeetcodeLinks(keepDifficulty = false) {
  const problem = findNeetcodeProblem(document.getElementById('leetcode-problem').value);
  if (!problem) return;
  if (!keepDifficulty) {
    document.getElementById('leetcode-category').value = problem.category;
    document.getElementById('leetcode-difficulty').value = problem.difficulty;
  }
  const link = document.getElementById('leetcode-link');
  const video = document.getElementById('leetcode-video');
  if (findNeetcodeProblem(link.value) !== problem) link.value = leetcodeLink(problem);
  if (!video.value || /neetcode\.io\/solutions\//.test(video.value)) video.value = neetcodeVideoLink(problem);
}

// A roadmap problem from its name, LeetCode slug or LeetCode/NeetCode link.
function findNeetcodeProblem(text) {
  const raw = text.trim().toLowerCase();
  const slug = /\/problems\/([a-z0-9-]+)/.exec(raw)?.[1] || raw;
  return NEETCODE_250.find((p) => p.name.toLowerCase() === raw || p.slug === slug || p.neetcode === slug) || null;
}

async function submitLeetcodeForm() {
  const problem = findNeetcodeProblem(document.getElementById('leetcode-problem').value);
  const date = document.getElementById('leetcode-date').value;
  if (!problem) return showFieldError('leetcode-form-error', 'Pick a problem from the NeetCode 250 list.');
  if (!date) return showFieldError('leetcode-form-error', 'Pick the date you solved it.');

  try {
    const log = {
      date,
      name: problem.name,
      category: document.getElementById('leetcode-category').value || problem.category,
      difficulty: document.getElementById('leetcode-difficulty').value || problem.difficulty,
      link: document.getElementById('leetcode-link').value.trim() || leetcodeLink(problem),
      video: document.getElementById('leetcode-video').value.trim() || neetcodeVideoLink(problem),
      notes: document.getElementById('leetcode-notes').value.trim(),
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
// the end); `row` null appends. Returns the sheet row.
async function writeLeetcodeLog(log, row = null) {
  const tab = CONFIG.SHEETS.LEETCODE;
  leetcodeSheetId = await ensureSheetTab(tab, LEETCODE_HEADERS);
  if (!Object.keys(leetcodeColumnIndex).length) await refreshLeetcode();
  const header = [];
  LEETCODE_COLUMNS.forEach(([key, h]) => {
    if (leetcodeColumnIndex[key] !== undefined) return;
    leetcodeColumnIndex[key] = Math.max(-1, ...Object.values(leetcodeColumnIndex)) + 1;
    header.push({ range: `'${tab}'!${physiqueColumnLetter(leetcodeColumnIndex[key])}1`, values: [[h]] });
  });
  if (header.length) await batchUpdateValues(header, 'RAW');
  if (!row) {
    const width = Math.max(...Object.values(leetcodeColumnIndex)) + 1;
    const values = Array(width).fill('');
    LEETCODE_COLUMNS.forEach(([key]) => { values[leetcodeColumnIndex[key]] = log[key] ?? ''; });
    return appendedRow(await appendValues(`'${tab}'!A2:${physiqueColumnLetter(width - 1)}`, [values], 'RAW'));
  }
  await batchUpdateValues(LEETCODE_COLUMNS.map(([key]) => ({
    range: `'${tab}'!${physiqueColumnLetter(leetcodeColumnIndex[key])}${row}`, values: [[log[key] ?? '']],
  })), 'RAW');
  return row;
}

async function deleteLeetcodeLog(log) {
  await confirmAndDelete(`Delete the ${log.date} solve of ${log.name}?`, async () => {
    if (leetcodeSheetId === null) leetcodeSheetId = await ensureSheetTab(CONFIG.SHEETS.LEETCODE, LEETCODE_HEADERS);
    await batchUpdate([{
      deleteDimension: { range: { sheetId: leetcodeSheetId, dimension: 'ROWS', startIndex: log.row - 1, endIndex: log.row } },
    }]);
    await refreshLeetcode();
    showUndoToast(`${log.name} solve deleted.`, async () => {
      await writeLeetcodeLog(log);
      await refreshLeetcode();
    });
  }, "Couldn't delete the solve");
}
