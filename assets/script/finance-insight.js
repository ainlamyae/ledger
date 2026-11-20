// Finance's Insight: Health Insight's preview/question/Send-to-AI flow for money.
// Fixed periods, no modes; renders from currentReport (app.js) and allAccounts
// (finance-account.js) once "Financial Snapshot" is clicked.

// What the preview shows, so Send to AI sends exactly that.
let financialInsightLoaded = null;

const FINANCIAL_INSIGHT_PAGE = {
  panelId: 'financial-insight-panel',
  statusId: 'financial-insight-status',
  errorId: 'financial-insight-form-error',
  bodyId: 'financial-insight-body',
  generatedAtId: 'financial-insight-generated-at',
  generateBtnId: 'financial-insight-generate-btn',
};

function initFinancialInsight() {
  clearFieldError(FINANCIAL_INSIGHT_PAGE.errorId);

  document.getElementById('financial-insight-load-btn').addEventListener('click', refreshFinancialInsightPreview);
  document.getElementById(FINANCIAL_INSIGHT_PAGE.generateBtnId).addEventListener('click', runFinancialInsightGeneration);
  // Back to /finance/insight/: the tile again.
  registerViewReset(document.getElementById(FINANCIAL_INSIGHT_PAGE.panelId), () => {
    financialInsightLoaded = null;
    resetInsightPage(FINANCIAL_INSIGHT_PAGE);
  });
}

function gatherFinancialInsightData() {
  const report = currentReport || {};
  const avg = report.quarterAverage;

  // Period totals averaged as Spending Trend does, negated to read as spending.
  const categoryComparison = (report.categoryComparison || []).map((c) => ({
    name: c.name,
    ...Object.fromEntries(FINANCE_PERIODS.map((p) => [p.key, -spendingMonthlyAverage(c, p, report.lifelongMonths)])),
  }));

  // Every account, blank as 0, like Account Summary's Total row.
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
    // Skips closed (balanceText set) and empty accounts.
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

// So the model doesn't read a partial month's totals as a shortfall.
function monthProgressNote() {
  const now = new Date();
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = now.getDate();
  return elapsed >= totalDays ? '' : ` (partial month in progress: day ${elapsed} of ${totalDays}, not comparable to a completed month yet)`;
}

function financialInsightSummaryLines(d) {
  const progress = monthProgressNote();
  const priorAvg = (avg) => (avg !== null ? ` (previous months' avg: ${formatCurrency(avg)})` : '');
  return [
    `Net Worth: ${formatCurrency(d.netWorth)}`,
    `Total Market Value: ${formatCurrency(d.totalMarketValue)}`,
    `Monthly Cash Flow: ${formatCurrency(d.monthlyCashFlow)}${progress}`,
    `Monthly Income: ${formatCurrency(d.monthlyIncome)}${progress}${priorAvg(d.quarterAvgIncome)}`,
    `Monthly Expenditure: ${formatCurrency(d.monthlyExpenses)}${progress}${priorAvg(d.quarterAvgExpenses)}`,
  ];
}

// An account's Market Value as shown: its text, its amount, or "not tracked".
function accountMarketValueText(a) {
  if (a.currentValueText !== null) return a.currentValueText;
  return a.currentValue !== null ? formatCurrency(a.currentValue) : 'not tracked';
}

function financialInsightCategoryLines(d) {
  if (d.categoryComparison.length === 0) return ['Spending by category: none logged'];
  return [
    'Spending by category (Previous Month / Quarter avg / Year avg / Lifelong avg — all four are complete periods, unaffected by today\'s date):',
    ...d.categoryComparison.map((c) =>
      `  ${c.name}: ${FINANCE_PERIODS.map((p) => formatCurrency(c[p.key])).join(' / ')}`),
  ];
}

function financialInsightAccountLines(d) {
  if (d.accounts.length === 0) return ['Accounts: none open with a balance'];
  return [
    "Accounts — Balance (deposited) vs. Market Value (today's worth, where tracked):",
    ...d.accounts.map((a) =>
      `  ${a.name} (${a.type}): Balance ${formatCurrency(a.balance)}, Market Value ${accountMarketValueText(a)}`),
  ];
}

// The text the model gets; the preview shows the same sections as tables.
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
    const cells = FINANCE_PERIODS.map((p) => {
      const cell = makeCell(formatCurrency(c[p.key]));
      cell.className = 'expense';
      return cell;
    });
    const tr = document.createElement('tr');
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

  const signClass = (value) => (value < 0 ? 'expense' : 'income');
  accounts.forEach((a) => {
    const balanceCell = makeCell(formatCurrency(a.balance));
    balanceCell.className = signClass(a.balance);

    const marketCell = makeCell(accountMarketValueText(a));
    if (a.currentValueText === null && a.currentValue !== null) {
      marketCell.className = signClass(a.currentValue);
    }

    const tr = document.createElement('tr');
    tr.append(makeCell(a.name), makeCell(a.type), balanceCell, marketCell);
    tbody.appendChild(tr);
  });
}

// The prompt's data, with the category and account sections as tables.
function renderFinancialInsightPreview(d) {
  const summaryEl = document.getElementById('financial-insight-preview');
  summaryEl.hidden = false;
  renderInsightLines(summaryEl, financialInsightSummaryLines(d));

  document.getElementById('financial-insight-category-preview').hidden = false;
  renderCategoryComparisonTable(d.categoryComparison);

  document.getElementById('financial-insight-accounts-preview').hidden = false;
  renderAccountsInsightTable(d.accounts);
}

// Cheap: it formats data the dashboard already gathered.
function refreshFinancialInsightPreview() {
  openInsightPage(FINANCIAL_INSIGHT_PAGE, 'snapshot');

  const generateBtn = document.getElementById(FINANCIAL_INSIGHT_PAGE.generateBtnId);
  if (!currentReport || !accountsDataLoaded) {
    showToast('Still loading your accounts — try again in a moment.');
    generateBtn.disabled = true;
    return;
  }

  financialInsightLoaded = gatherFinancialInsightData();
  renderFinancialInsightPreview(financialInsightLoaded);
  renderSavedFinancialInsight();
  generateBtn.disabled = false;
}

const FINANCIAL_INSIGHT_SYSTEM_PROMPT = `You are a supportive personal finance coach reviewing someone's own tracked financial data. You are not a licensed financial advisor — do not recommend a specific company, ticker, fund name, or guarantee any return. When a suggestion involves investing, name the VEHICLE TYPE (e.g. "a broad-market index fund or ETF", "a dividend-focused ETF", "a bond ladder") so it's concrete enough to act on, not just "invest more" — but stop at the type, never a specific issuer or symbol.

You'll be given their net worth, monthly cash flow, income and expenditure (each vs. their own trailing average), average monthly spending by category over four periods (last month, quarter, year, lifelong — so you can see whether a category is trending up or down), and a per-account breakdown of Balance vs. Market Value (closed and empty accounts already excluded).

Balance is the deposited/book figure that ties to transaction history; Market Value is today's actual worth, tracked only for interest-bearing or investment accounts. A gap between the two on the same account is that account's own gain or loss since money was deposited — not an error to flag. "Not tracked" is expected for Chequing/Credit/Cash accounts (their balance IS their value) and is not a gap either.

A negative balance on a Credit-type account is that card's current statement total, paid off in full each cycle — NOT carried/revolving debt. Never call it "debt", suggest paying it off, or count it against net worth as a liability to eliminate; it's a normal pending charge, the same as a bill that hasn't cleared yet.

The RRSP, TFSA and FHSA accounts are maxed out — there is no contribution room left in any of them. Never suggest contributing more to an account with one of those names; if a suggestion involves saving or investing further, it has to go somewhere else (e.g. a taxable/non-registered account).

Monthly Cash Flow/Income/Expenditure may be marked "partial month in progress" — that figure is still accumulating and is NOT comparable to the completed-month average beside it. Never call it a shortfall, a decline, or "well below average" on that basis alone; say plainly that the month is still early and there isn't enough of it yet to judge. This caveat applies ONLY to those three lines — the Previous Month/Quarter/Year/Lifelong category figures are separate, already-complete periods with no partial-month effect, so lean on those for anything that needs a real trend read, and never call one of them low or high because of what day of the month it is today.

Write a short plain-text report with exactly these five sections, each starting on its own line as "Label: text". Do not use markdown syntax (no #, *, -, backticks, bold) — plain text only. Within a section, if you're naming more than one distinct point, put each one on its own line — never run multiple points together in one paragraph, with or without a bullet character.

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

// Send to AI: runs on the loaded preview data, not a fresh gather.
async function runFinancialInsightGeneration() {
  if (!financialInsightLoaded) return;

  const data = financialInsightLoaded;
  const textarea = document.getElementById('financial-insight-question');
  return generateInsight(FINANCIAL_INSIGHT_PAGE, {
    controls: [textarea],
    analyzing: 'Analyzing…',
    prompts: () => [FINANCIAL_INSIGHT_SYSTEM_PROMPT, appendInsightQuestion(formatFinancialInsightPrompt(data), textarea.value)],
    resultKey: 'FINANCIAL_INSIGHT_LAST_RESULT',
    generatedAtKey: 'FINANCIAL_INSIGHT_LAST_GENERATED_AT',
  });
}

function renderSavedFinancialInsight() {
  renderSavedInsightBody(FINANCIAL_INSIGHT_PAGE,
    getSettingString('FINANCIAL_INSIGHT_LAST_RESULT', null),
    getSettingString('FINANCIAL_INSIGHT_LAST_GENERATED_AT', null));
}
