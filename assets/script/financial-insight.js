// Financial Insight — the same preview/question/Send-to-AI flow as Health
// Insight (insight-panel.js), reusing its renderInsightLines/renderInsightText
// helpers (insight.js) and groqChatText (groq.js), but for money instead of
// health: net worth and cash flow, average spending by category over four
// periods, and every account's Balance (deposited) vs. Market Value (today's
// worth, where tracked) — so a gap between the two reads as the account's own
// gain or loss, not a data error. There's only one report here, so unlike
// Health Insight there's no mode-select table and no date range — every
// figure here is already a fixed period (this month / Previous Month /
// Quarter / Year / Lifelong / a live account snapshot), so there's nothing a
// custom range would add.
//
// currentReport (app.js) and allAccounts (accounts.js) are already loaded for
// the Financial Indicators charts and Account Summary table by the time this
// panel is ever visible, so the preview renders straight from them — nothing
// extra to fetch. Still, nothing is computed until "Financial Snapshot" is
// clicked, same as Health Insight's mode buttons.

// What's on screen right now — reused by Send to AI so it sends exactly what
// the preview showed rather than re-gathering.
let financialInsightLoaded = null;

function initFinancialInsight() {
  clearFieldError('financial-insight-form-error');

  document.getElementById('financial-insight-load-btn').addEventListener('click', refreshFinancialInsightPreview);
  document.getElementById('financial-insight-generate-btn').addEventListener('click', runFinancialInsightGeneration);
}

function gatherFinancialInsightData() {
  const report = currentReport || {};
  const avg = report.quarterAverage;

  // report.categoryComparison holds Math.abs'd PERIOD TOTALS, not monthly
  // averages — renderSpendingTrendChart (charts.js) is the only other reader
  // of this data, and it divides by 3/12/totalMonths itself at chart-render
  // time (SPENDING_TREND_PERIODS). Do the same division here, then negate:
  // every one of these categories is real spending (Income is excluded
  // upstream), so an expense reads as an expense, not an ambiguous positive
  // sum mislabeled "avg".
  const totalMonths = report.totalMonths || 1;
  const categoryComparison = (report.categoryComparison || []).map((c) => ({
    name: c.name,
    lastMonth: -c.lastMonth,
    quarterAvg: -c.quarterAvg / 3,
    yearAvg: -c.yearAvg / 12,
    lifelongAvg: -c.lifelongAvg / totalMonths,
  }));

  // Same "blank counts as 0" convention as the Account Summary Total row
  // (accounts.js) and the Accounts sheet's own SUM() in E1 — summed across
  // every account, not just the ones listed below, so it lines up with
  // Net Worth (also a whole-sheet total).
  const totalMarketValue = allAccounts.reduce((sum, a) => sum + (a.currentValue || 0), 0);

  return {
    netWorth: report.netWorth || 0,
    totalMarketValue,
    monthlyCashFlow: report.saved || 0,
    monthlyIncome: report.income || 0,
    quarterAvgIncome: avg ? avg.income : null,
    monthlyExpenses: report.expenses || 0,
    quarterAvgExpenses: avg ? avg.expenses : null,
    categoryComparison,
    // Closed accounts (balanceText set, e.g. "Closed") and empty ones (zero
    // Balance, and no tracked Market Value or a zero one) hold no funds —
    // reporting a page of them would bury the accounts that actually matter.
    accounts: allAccounts
      .filter((a) => a.balanceText === null && (a.balance !== 0 || (a.currentValue !== null && a.currentValue !== 0)))
      .map((a) => ({
        name: a.name,
        institution: a.institution,
        type: a.type,
        balance: a.balance,
        currentValueText: a.currentValueText,
        currentValue: a.currentValue,
      })),
  };
}

// "Monthly Income"/"Expenditure"/"Cash Flow" are the CURRENT month's SUMIFS
// total, which only grows as the month goes on — early in the month it's
// naturally a fraction of a full month's average, not a real decline. Without
// this, the model reads day-7's partial total against a full-month average
// and calls it a shortfall. Days elapsed only, not "today" itself — a whole
// day's worth of transactions may still be unposted.
function monthProgressNote() {
  const now = new Date();
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = now.getDate();
  return elapsed >= totalDays ? '' : ` (partial month in progress: day ${elapsed} of ${totalDays}, not comparable to a completed month yet)`;
}

function financialInsightSummaryLines(d) {
  const progress = monthProgressNote();
  return [
    `Net Worth: ${formatCurrency(d.netWorth)}`,
    `Total Market Value: ${formatCurrency(d.totalMarketValue)}`,
    `Monthly Cash Flow: ${formatCurrency(d.monthlyCashFlow)}${progress}`,
    `Monthly Income: ${formatCurrency(d.monthlyIncome)}${progress}${d.quarterAvgIncome !== null ? ` (previous months' avg: ${formatCurrency(d.quarterAvgIncome)})` : ''}`,
    `Monthly Expenditure: ${formatCurrency(d.monthlyExpenses)}${progress}${d.quarterAvgExpenses !== null ? ` (previous months' avg: ${formatCurrency(d.quarterAvgExpenses)})` : ''}`,
  ];
}

function financialInsightCategoryLines(d) {
  if (d.categoryComparison.length === 0) return ['Spending by category: none logged'];
  return [
    'Spending by category (Previous Month / Quarter avg / Year avg / Lifelong avg — all four are complete periods, unaffected by today\'s date):',
    ...d.categoryComparison.map((c) =>
      `  ${c.name}: ${formatCurrency(c.lastMonth)} / ${formatCurrency(c.quarterAvg)} / ${formatCurrency(c.yearAvg)} / ${formatCurrency(c.lifelongAvg)}`),
  ];
}

function financialInsightAccountLines(d) {
  if (d.accounts.length === 0) return ['Accounts: none open with a balance'];
  return [
    "Accounts — Balance (deposited) vs. Market Value (today's worth, where tracked):",
    ...d.accounts.map((a) => {
      const marketStr = a.currentValueText !== null ? a.currentValueText
        : a.currentValue !== null ? formatCurrency(a.currentValue) : 'not tracked';
      return `  ${a.name} (${a.type}): Balance ${formatCurrency(a.balance)}, Market Value ${marketStr}`;
    }),
  ];
}

// The full text sent to Groq — every section above joined into one prompt.
// The visual preview renders the category/account sections as tables instead
// (renderFinancialInsightPreview below), but the model only ever sees text.
function formatFinancialInsightPrompt(d) {
  return [
    ...financialInsightSummaryLines(d),
    '',
    ...financialInsightCategoryLines(d),
    '',
    ...financialInsightAccountLines(d),
  ].join('\n');
}

function renderCategoryComparisonTable(categoryComparison) {
  const tbody = document.getElementById('financial-insight-category-body');
  tbody.innerHTML = '';

  if (categoryComparison.length === 0) {
    tbody.appendChild(renderEmptyRow(5, 'No categorized spending logged yet.'));
    return;
  }

  categoryComparison.forEach((c) => {
    const tr = document.createElement('tr');
    const cells = [c.lastMonth, c.quarterAvg, c.yearAvg, c.lifelongAvg].map((v) => {
      const cell = makeCell(formatCurrency(v));
      cell.className = 'expense';
      return cell;
    });
    tr.append(makeCell(c.name), ...cells);
    tbody.appendChild(tr);
  });
}

function renderAccountsInsightTable(accounts) {
  const tbody = document.getElementById('financial-insight-accounts-body');
  tbody.innerHTML = '';

  if (accounts.length === 0) {
    tbody.appendChild(renderEmptyRow(4, 'No open accounts with a balance.'));
    return;
  }

  accounts.forEach((a) => {
    const balanceCell = makeCell(formatCurrency(a.balance));
    balanceCell.className = a.balance < 0 ? 'expense' : 'income';

    const marketStr = a.currentValueText !== null ? a.currentValueText
      : a.currentValue !== null ? formatCurrency(a.currentValue) : 'not tracked';
    const marketCell = makeCell(marketStr);
    if (a.currentValueText === null && a.currentValue !== null) {
      marketCell.className = a.currentValue < 0 ? 'expense' : 'income';
    }

    const tr = document.createElement('tr');
    tr.append(makeCell(a.name), makeCell(a.type), balanceCell, marketCell);
    tbody.appendChild(tr);
  });
}

// The visual read-out — same data as formatFinancialInsightPrompt above, just
// laid out as tables where a table reads easier than a wall of text, same as
// Health Insight's Food mode (aggregate lines + an ingredient table).
function renderFinancialInsightPreview(d) {
  const summaryEl = document.getElementById('financial-insight-preview');
  summaryEl.hidden = false;
  renderInsightLines(summaryEl, financialInsightSummaryLines(d));

  document.getElementById('financial-insight-category-preview').hidden = false;
  renderCategoryComparisonTable(d.categoryComparison);

  document.getElementById('financial-insight-accounts-preview').hidden = false;
  renderAccountsInsightTable(d.accounts);
}

// The only path that computes anything, and it's cheap — formatting data the
// dashboard already gathered, not a fresh aggregation pass.
function refreshFinancialInsightPreview() {
  const statusEl = document.getElementById('financial-insight-status');
  const btn = document.getElementById('financial-insight-generate-btn');
  clearFieldError('financial-insight-form-error');

  if (!currentReport || !accountsDataLoaded) {
    statusEl.textContent = 'Still loading your accounts — try again in a moment.';
    btn.disabled = true;
    return;
  }

  const data = gatherFinancialInsightData();
  financialInsightLoaded = data;

  renderFinancialInsightPreview(data);
  renderSavedFinancialInsight();

  statusEl.textContent = '';
  btn.disabled = false;
}

const FINANCIAL_INSIGHT_SYSTEM_PROMPT = `You are a supportive personal finance coach reviewing someone's own tracked financial data. You are not a licensed financial advisor — do not recommend a specific company, ticker, fund name, or guarantee any return. When a suggestion involves investing, name the VEHICLE TYPE (e.g. "a broad-market index fund or ETF", "a dividend-focused ETF", "a bond ladder") so it's concrete enough to act on, not just "invest more" — but stop at the type, never a specific issuer or symbol.

You'll be given their net worth, monthly cash flow, income and expenditure (each vs. their own trailing average), average monthly spending by category over four periods (last month, quarter, year, lifelong — so you can see whether a category is trending up or down), and a per-account breakdown of Balance vs. Market Value (closed and empty accounts already excluded).

Balance is the deposited/book figure that ties to transaction history; Market Value is today's actual worth, tracked only for interest-bearing or investment accounts. A gap between the two on the same account is that account's own gain or loss since money was deposited — not an error to flag. "Not tracked" is expected for Chequing/Credit/Cash accounts (their balance IS their value) and is not a gap either.

A negative balance on a Credit-type account is that card's current statement total, paid off in full each cycle — NOT carried/revolving debt. Never call it "debt", suggest paying it off, or count it against net worth as a liability to eliminate; it's a normal pending charge, the same as a bill that hasn't cleared yet.

The RRSP, TFSA and FHSA accounts are maxed out — there is no contribution room left in any of them. Never suggest contributing more to an account with one of those names; if a suggestion involves saving or investing further, it has to go somewhere else (e.g. a taxable/non-registered account).

Monthly Cash Flow/Income/Expenditure may be marked "partial month in progress" — that figure is still accumulating and is NOT comparable to the completed-month average beside it. Never call it a shortfall, a decline, or "well below average" on that basis alone; say plainly that the month is still early and there isn't enough of it yet to judge. This caveat applies ONLY to those three lines — the Previous Month/Quarter/Year/Lifelong category figures are separate, already-complete periods with no partial-month effect, so lean on those for anything that needs a real trend read, and never call one of them low or high because of what day of the month it is today.

Write a short plain-text report with exactly these five sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only.

Overview: one or two sentences on the overall financial picture — net worth, cash flow direction, and whether spending is trending up or down.
Going well: what's healthy — positive cash flow, an account's market value growing ahead of its balance, a category trending down, etc.
Needs attention: what's off — negative or shrinking cash flow, a category trending up period over period, an account's market value lagging its balance, etc.
Investment outlook: a one-sentence intro, then exactly two more lines below it, each on its own line:
Short term: liquidity and cash-buffer read from the Cash/Chequing/Saving balances against the monthly cash flow (e.g. runway if income stopped, whether idle cash sits uninvested).
Long term: read from the Investment-type accounts' Market Value vs. Balance growth and how concentrated or spread out that money is across them; note if too little is invested for a long horizon, or too much sits idle in non-growth accounts.
Say plainly if there isn't enough data to judge either one, instead of guessing.
Suggestions: 2-4 concrete, specific next steps, each on its own line (e.g. a line starting "1. ", then a new line starting "2. ", and so on) — do not run them together in one line.

If an additional question from the user is included after the data, also answer it directly in a sixth section, "Answer: text".

Keep the whole report under 300 words.`;

function financialInsightUserMessage(data, question) {
  const prompt = formatFinancialInsightPrompt(data);
  return question && question.trim() ? `${prompt}\n\nAdditional question: ${question.trim()}` : prompt;
}

// Only runs on an explicit Send to AI click, on the already-loaded preview
// data — so gathering happens once per snapshot load, not again per request.
async function runFinancialInsightGeneration() {
  if (!financialInsightLoaded) return;

  const data = financialInsightLoaded;
  const body = document.getElementById('financial-insight-body');
  const btn = document.getElementById('financial-insight-generate-btn');
  const textarea = document.getElementById('financial-insight-question');

  body.innerHTML = '';
  clearFieldError('financial-insight-form-error');

  const loading = document.createElement('p');
  loading.className = 'hint';
  loading.textContent = 'Analyzing…';
  body.appendChild(loading);

  btn.disabled = true;
  textarea.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Generating…';

  try {
    const text = await groqChatText(FINANCIAL_INSIGHT_SYSTEM_PROMPT, financialInsightUserMessage(data, textarea.value));
    body.innerHTML = '';
    renderInsightText(body, text);

    const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
    try {
      await saveSettingValues({
        FINANCIAL_INSIGHT_LAST_RESULT: text,
        FINANCIAL_INSIGHT_LAST_GENERATED_AT: generatedAt,
      });
      renderFinancialInsightGeneratedAt(generatedAt);
    } catch (saveErr) {
      showFieldError('financial-insight-form-error', `Generated, but couldn't save it: ${saveErr.message}`);
    }
  } catch (err) {
    body.innerHTML = '';
    showFieldError('financial-insight-form-error', err.message);
  } finally {
    btn.disabled = false;
    textarea.disabled = false;
    btn.textContent = originalLabel;
  }
}

function renderFinancialInsightGeneratedAt(timestamp) {
  const el = document.getElementById('financial-insight-generated-at');
  if (!timestamp) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `Last generated ${timestamp}`;
}

// The last AI result, straight from the Settings copy already in memory —
// re-shown every time the snapshot loads/reloads, so a fresh page load's
// first click doesn't go blank before anything new has been sent.
function renderSavedFinancialInsight() {
  const body = document.getElementById('financial-insight-body');
  const text = getSettingString('FINANCIAL_INSIGHT_LAST_RESULT', null);

  body.innerHTML = '';
  if (!text) {
    const placeholder = document.createElement('p');
    placeholder.className = 'hint';
    placeholder.textContent = 'Review the data above, then click "Send to AI" to get a read on it.';
    body.appendChild(placeholder);
    renderFinancialInsightGeneratedAt(null);
    return;
  }

  renderInsightText(body, text);
  renderFinancialInsightGeneratedAt(getSettingString('FINANCIAL_INSIGHT_LAST_GENERATED_AT', null));
}
