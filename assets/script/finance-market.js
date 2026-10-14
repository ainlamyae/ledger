// Market page: one stock's rule-based signals (finance-market-math.js), its chart with the lines
// those rules use, Finnhub headlines, and an AI read of all three. Each read is
// appended to the Analysis tab, so past verdicts stay as a track record.

const ANALYSIS_HEADERS = ['Date', 'Symbol', 'Verdict', 'Score', 'Close', 'Stop', 'Report'];
const ANALYSIS_RANGE = () => `'${CONFIG.SHEETS.STOCK_ANALYSIS}'!A2:G`;
const ANALYSIS_LABELS = ['Overview', 'Signals', 'News', 'Risk', 'Levels', 'Verdict', 'Answer', 'Alerts'];
const ANALYSIS_DISCLAIMER = 'Not financial advice. A rules-based summary of past prices and recent headlines; no signal here is anywhere near 95% reliable.';
const ANALYSIS_STALE_DAYS = 30;

let allStockAnalyses = [];
let analysisSymbol = null;
let analysisRangeSlug = '1y';
let analysisLoaded = null; // { symbol, signals, bars, currency, news, benchmark, monthly }
let analysisChart = null;
let analysisChartToken = 0;
let analysisLoadToken = 0;
const analysisHiddenSeries = new Set(); // legend toggles; every line starts on
let analysisListenersAttached = false;

const MARKET_ANALYSIS_SYSTEM_PROMPT = `You explain a pre-computed, rule-based signal summary for one stock to a long-term investor (holding weeks to months, not day trading; low risk preferred).

Rules:
- Use only the numbers supplied. Never invent a price, forecast, level, earnings figure or headline. If a figure is n/a, say it needs more price history.
- The Verdict is computed by fixed rules: restate it exactly. You may explain why caution is warranted, but never change it.
- Cite every headline you use with its date and source in brackets, e.g. [2026-10-08, Reuters]. Call headlines older than 30 days stale. If no headlines are supplied, say so.
- Evidence: the trend filter (close vs 200-day / 10-month average) mainly reduces drawdowns; 12-1 month momentum and nearness to the 52-week high have the strongest research support among price signals, yet none is close to 95% reliable. The trailing stop is a risk-control habit, not a proven edge.
- Exit conditions, as the app defines them: a close below the trailing stop, or a close below the 200-day average. Entry is only considered while the trend check passes.
- "Chart history" is the chart's lines as text (month-end closes, 200-day average, trailing stop, market index rebased to the stock's price). Use it to describe the trend's direction and duration, recent stop hits and the stock against the market; ignore day-to-day noise.
- Never promise or predict ("will rise"); speak in terms of risk and conditions.
- Plain text, no markdown, no asterisks. One point per line. Under 300 words.

Write exactly these sections, each starting on its own line with the label and a colon:
Overview: one or two lines on where the stock stands and how the last year went (from Chart history).
Signals: what the four checks say, plus the trend's direction and how long it has held.
News: what the headlines suggest for risk, with citations.
Risk: volatility, drawdown, beta, any high-volatility or spike caution.
Levels: only the supplied Close, Trailing stop (for a holder), Entry stop (for a buy today), long-term average and 52-week high, with the supplied distances; when to consider buying, holding or exiting in terms of those levels.
Verdict: the supplied verdict, restated, with one line on what would change it.
If a question is included, add a section "Answer:" answering it.
End with exactly one line in this machine-read format (the app turns it into price alerts):
Alerts: below=<price or none>; above=<price or none>; belowAvg=<yes or no>; aboveAvg=<yes or no>; belowStop=<yes or no>
- below: a warning price UNDER today's Close (a fall to it means exit or stay out); above: a price OVER today's Close (a rise to it is a buy or breakout signal). A below at or over the Close, or an above at or under it, would fire at once: never suggest one.
- When the trailing stop is already broken (above the Close), it can't be a below level: use the Entry stop or the long-term average if they are under the Close, else none.
- Use only prices that appear in the supplied data (Close, Trailing stop, Entry stop, the average, the 52-week high, month-end values), with 2 decimals and no currency, or none.
- belowAvg / belowStop: yes to be warned of the exit conditions, but only if not already met (close still above that level); aboveAvg: yes to be told when the trend turns back up, only if the close is under the average now.
- Example: Alerts: below=20.16; above=none; belowAvg=yes; aboveAvg=no; belowStop=yes`;

async function initStockAnalysisLog() {
  if (!(await sheetTabExists(CONFIG.SHEETS.STOCK_ANALYSIS))) {
    allStockAnalyses = [];
  } else {
    const resp = await getValues(ANALYSIS_RANGE(), VALUE_PARAMS);
    allStockAnalyses = (resp.values || []).map((row, i) => ({
      row: i + 2,
      date: String(row[0] || ''),
      symbol: String(row[1] || '').trim().toUpperCase(),
      verdict: row[2] || '',
      score: row[3] || '',
      close: Number(row[4]),
      stop: Number(row[5]),
      report: String(row[6] || ''),
    })).filter((a) => a.symbol);
  }
  updateAnalysisAgeBadge();
}

function latestAnalysis(symbol) {
  return allStockAnalyses.filter((a) => a.symbol === symbol).at(-1) || null;
}

// The Market tile's red badge: the oldest of the watchlist's latest reads, once over 30 days.
function updateAnalysisAgeBadge() {
  const today = dateFromIso(isoFromDate(new Date()));
  let oldest = null;
  allWatchlist.forEach((w) => {
    const last = latestAnalysis(w.symbol);
    if (!last) return;
    const days = Math.round((today - dateFromIso(last.date.slice(0, 10))) / 86400000);
    if (oldest === null || days > oldest.days) oldest = { days, symbol: w.symbol, date: last.date };
  });
  const stale = oldest && oldest.days > ANALYSIS_STALE_DAYS ? `${oldest.symbol} last analyzed ${oldest.days} days ago (${oldest.date})` : null;
  // A met alert outranks the age badge, which moves into the hover.
  const alert = watchlistAlertBadge();
  if (alert) setPageBadge('finance', 'market', { text: alert.text, title: stale ? `${alert.title}\n${stale}` : alert.title });
  else setPageBadge('finance', 'market', stale ? { text: `${oldest.days}d`, title: stale } : null);
}

function initStockAnalysis() {
  if (analysisListenersAttached) return;
  analysisListenersAttached = true;
  analysisRangeSlug = readMarketPref('ledger_analysis_range', '1y');
  const select = document.getElementById('analysis-symbol');
  select.addEventListener('change', () => {
    const symbol = select.value;
    if (symbol) {
      analysisSymbol = symbol;
      writeMarketPref('ledger_market_symbol', symbol);
      loadStockAnalysis();
    }
  });
  document.getElementById('analysis-include-position').addEventListener('change', renderAnalysisPrompt);
  document.getElementById('analysis-question').addEventListener('input', renderAnalysisPrompt);
  document.getElementById('analysis-generate-btn').addEventListener('click', runStockAnalysis);
  document.getElementById('analysis-apply-alerts-btn').addEventListener('click', applySuggestedAlerts);
  document.getElementById('market-alert-btn').addEventListener('click', () => {
    const entry = allWatchlist.find((w) => w.symbol === analysisSymbol);
    if (entry) openWatchlistForm(entry);
  });
  registerPageShow('market', () => {
    const saved = analysisSymbol || readMarketPref('ledger_market_symbol', null);
    analysisSymbol = allWatchlist.some((w) => w.symbol === saved) ? saved : allWatchlist[0]?.symbol || null;
    if (analysisSymbol) loadStockAnalysis();
    else renderAnalysisRange();
  });
}

// The picker lists the watchlist.
function syncAnalysisSymbolOptions() {
  const select = document.getElementById('analysis-symbol');
  if (!select) return;
  select.innerHTML = '';
  if (!allWatchlist.length) {
    select.appendChild(new Option('Add stocks on Watch List first', ''));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  allWatchlist.forEach((w) => select.appendChild(new Option(w.name ? `${w.symbol} — ${w.name}` : w.symbol, w.symbol)));
  if (analysisSymbol) select.value = analysisSymbol;
}

function analysisBenchmark(symbol) {
  return isCanadianSymbol(symbol) ? 'XIC.TO' : 'SPY';
}

async function loadStockAnalysis() {
  const symbol = analysisSymbol;
  const token = ++analysisLoadToken;
  document.getElementById('analysis-symbol').value = symbol;
  document.getElementById('analysis-generate-btn').disabled = true;
  setMarketStatus('analysis-status', `Loading ${symbol}…`);
  const onWait = (s, name) => setMarketStatus('analysis-status', `Waiting for ${name}'s per-minute limit (${s} s)…`);
  const problems = [];
  try {
    const daily = await getDailyBars(symbol, { onWait });
    if (daily.error) problems.push(marketErrorText(daily.error));
    marketBars.set(symbol, daily);
    const monthly = daily.partial ? await getMonthlyBars(symbol, { onWait }).catch((err) => { problems.push(marketErrorText(err)); return null; }) : null;
    let benchmark = null;
    try {
      benchmark = (await getDailyBars(analysisBenchmark(symbol), { onWait })).bars;
    } catch (err) {
      problems.push(`Benchmark ${analysisBenchmark(symbol)}: ${marketErrorText(err)}`);
    }
    let news = [];
    try {
      news = await getCompanyNews(symbol, 30, { onWait });
    } catch (err) {
      if (!isCanadianSymbol(symbol)) problems.push(marketErrorText(err));
    }
    const currency = daily.currency || symbolCurrency(symbol);
    let equity = investmentEquityCad();
    if (currency === 'USD' && equity) {
      const fx = await getUsdCadSeries().then((s) => s.at(-1)?.c).catch(() => null);
      equity = fx ? equity / fx : null;
    }
    const signals = computeSignals({
      bars: daily.bars,
      benchmarkBars: benchmark,
      monthlyBars: monthly,
      riskFreePct: getSetting('MARKET_RISK_FREE_PCT', 0),
      atrMult: getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT),
      riskPct: getSetting('MARKET_RISK_PCT', 1),
      equity,
    });
    if (token !== analysisLoadToken) return;
    analysisLoaded = { symbol, signals, bars: daily.bars, monthly, currency, news, benchmark };
    setMarketStatus('analysis-status', [...new Set(problems)].join(' '));
    renderAnalysisCards();
    renderSignalTable();
    renderDescriptiveTable();
    renderNews();
    drawAnalysisChart();
    renderAnalysisPrompt();
    renderSavedAnalysis();
    document.getElementById('analysis-generate-btn').disabled = false;
    document.getElementById('analysis-generate-btn').title = `Send ${symbol}'s signals and headlines to AI`;
  } catch (err) {
    if (token !== analysisLoadToken) return;
    analysisLoaded = null;
    setMarketStatus('analysis-status', marketErrorText(err));
  }
}

// --- Rendering --------------------------------------------------------------

function fmtPct(v, digits = 1) {
  return v === null || !Number.isFinite(v) ? null : `${(v * 100).toFixed(digits)}%`;
}

function fmtNum(v, digits = 2) {
  return v === null || !Number.isFinite(v) ? null : v.toFixed(digits);
}

function needsText(result) {
  return `— (needs ${result.needs} ${result.basis === '10-month SMA' ? 'month-ends' : 'days'}, have ${result.have})`;
}

const VERDICT_CLASS = { Favourable: 'income', Mixed: 'neutral', Unfavourable: 'expense' };

function renderAnalysisCards() {
  const { signals, currency } = analysisLoaded;
  const verdict = document.getElementById('analysis-verdict');
  verdict.className = `value ${VERDICT_CLASS[signals.verdict.label] || 'neutral'}`;
  verdict.textContent = `${signals.verdict.label} ${signals.verdict.passed}/${signals.verdict.available}`;
  verdict.title = signals.verdict.notes.join('; ');
  document.getElementById('analysis-close').textContent = signals.close !== null ? formatMoney(signals.close, currency, { mask: false }) : '—';
  document.getElementById('analysis-stop').textContent = signals.stop !== null ? formatMoney(signals.stop, currency, { mask: false }) : '—';
  const shares = document.getElementById('analysis-shares');
  shares.textContent = signals.shares !== null ? (privacyMode ? maskDigits(String(signals.shares)) : String(signals.shares)) : '—';
  shares.title = signals.riskAmount !== null ? `If you buy today: risking ${formatMoney(signals.riskAmount, currency)} at the entry stop ${formatMoney(signals.entryStop, currency, { mask: false })}`
    : 'Needs investment accounts with a Market Value';
  const stopCard = document.getElementById('analysis-stop');
  stopCard.title = signals.stop !== null && signals.close <= signals.stop
    ? `Trailing stop, already broken: close is below it (exit signal for a holder). Entry stop if buying today: ${signals.entryStop !== null ? formatMoney(signals.entryStop, currency, { mask: false }) : 'n/a'}`
    : `Trailing stop for a holder. Entry stop if buying today: ${signals.entryStop !== null ? formatMoney(signals.entryStop, currency, { mask: false }) : 'n/a'}`;
}

// One table row: [name (definition), value, rule, read].
function signalRow(tbody, name, title, value, rule, pass, groupEnd = false) {
  const tr = document.createElement('tr');
  tr.title = title;
  const read = makeCell(pass === true ? 'Pass' : pass === false ? 'Fail' : pass === null ? 'n/a' : '');
  if (pass === true) read.classList.add('income');
  else if (pass === false) read.classList.add('expense');
  else read.classList.add('neutral');
  const valueCell = makeCell(value ?? '—');
  valueCell.classList.add('num');
  tr.append(makeCell(name), valueCell, makeCell(rule), read);
  if (groupEnd) tr.classList.add('physique-derived-group-end');
  tbody.appendChild(tr);
}

function renderSignalTable() {
  const { signals: s, currency, symbol } = analysisLoaded;
  const tbody = document.getElementById('market-signal-body');
  tbody.innerHTML = '';
  const money = (v) => (v === null || !Number.isFinite(v) ? null : formatMoney(v, currency, { mask: false }));
  const or = (result, text) => (result.value === null ? needsText(result) : text);

  signalRow(tbody, `Trend (${s.trend.basis})`, 'Close above its long average — mainly cuts drawdowns (Faber 2007; Brock-Lakonishok-LeBaron 1992)',
    s.trend.value === null ? needsText(s.trend) : `${money(s.trend.close)} vs ${money(s.trend.sma)}`, 'Close above the average', s.checks.trend);
  signalRow(tbody, 'Momentum 12-1', 'Return from 12 months ago to 1 month ago (Jegadeesh-Titman 1993; Asness-Moskowitz-Pedersen 2013)',
    or(s.momentum, fmtPct(s.momentum.value)), 'Above 0%', s.checks.momentum);
  signalRow(tbody, `Relative momentum vs ${analysisBenchmark(symbol)}`, "12-1 momentum minus the market's",
    s.relative.value === null ? `— (needs ${s.relative.needs} days)` : fmtPct(s.relative.value), 'Above the market', s.checks.relative);
  signalRow(tbody, '52-week high', 'Close ÷ highest high of the last 252 days (George-Hwang 2004)',
    or(s.high52, fmtPct(s.high52.value)), 'At least 90%', s.checks.high52, true);

  signalRow(tbody, 'Volatility 3m', 'Annualized standard deviation of daily log returns, last 63 days', or(s.vol63, fmtPct(s.vol63.value)), 'Risk', undefined);
  signalRow(tbody, 'Volatility 1y', 'Same, last 252 days', or(s.vol252, fmtPct(s.vol252.value)), '3m above 1.25× 1y: size down', undefined);
  signalRow(tbody, 'ATR14', "Wilder's average true range, 14 days", money(s.atr), 'Sets the stop distance', undefined);
  signalRow(tbody, 'Max drawdown 1y', 'Largest fall from a peak in the last year', or(s.mdd1y, fmtPct(s.mdd1y.value)), 'Risk', undefined);
  signalRow(tbody, 'Sharpe 1y', 'Excess return per unit of volatility, annualized', or(s.sharpe, fmtNum(s.sharpe.value)), 'Risk', undefined);
  signalRow(tbody, 'Sortino 1y', 'Excess return per unit of downside volatility, annualized', or(s.sortino, fmtNum(s.sortino.value)), 'Risk', undefined);
  signalRow(tbody, `Beta vs ${analysisBenchmark(symbol)}`, 'How much the stock moves per 1% market move', or(s.beta, fmtNum(s.beta.value)), 'Risk', undefined, true);

  const k = getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT);
  signalRow(tbody, 'Trailing stop', `Highest close of the last 22 days − ${k} × ATR14 (chandelier exit). A risk-control habit for long holds, not a proven edge`, money(s.stop), s.stop !== null && s.close <= s.stop ? 'Close is at or below it: exit signal' : 'Exit if the close falls below', s.stop === null ? undefined : s.close > s.stop ? undefined : false);
  signalRow(tbody, 'Entry stop', `Close − ${k} × ATR14: where a buy made today would exit; Position size uses it`, money(s.entryStop), 'If you buy today', undefined);
  signalRow(tbody, 'Position size', `Shares so a stop-out at the entry stop loses ${getSetting('MARKET_RISK_PCT', 1)}% of your investment accounts`,
    s.shares === null ? null : (privacyMode ? maskDigits(String(s.shares)) : String(s.shares)), s.riskAmount === null ? '' : `Risk ${formatMoney(s.riskAmount, currency)}`, undefined, true);

  signalRow(tbody, '5-day move', 'Last 5 days against 2σ of normal 5-day moves (short-term reversal: Jegadeesh 1990)',
    s.spike === null ? '—' : s.spike ? 'Spike' : 'Normal', "Don't chase a spike", s.spike === null ? null : !s.spike);
}

function renderDescriptiveTable() {
  const { bars, currency } = analysisLoaded;
  const closes = bars.map((b) => b.c);
  const tbody = document.getElementById('analysis-descriptive-body');
  tbody.innerHTML = '';
  const last = (arr) => (arr.length ? arr.at(-1) : null);
  const rsi = last(rsiSeries(closes, 14));
  const macd = macdSeries(closes, 12, 26, 9);
  const bb = bollingerSeries(closes, 20, 2);
  const upper = last(bb.upper);
  const lower = last(bb.lower);
  const pctB = upper !== null && lower !== null && upper !== lower ? (closes.at(-1) - lower) / (upper - lower) : null;
  const rows = [
    ['RSI14', "Wilder's relative strength index, 0–100", fmtNum(rsi, 1)],
    ['MACD 12/26/9', 'EMA12 − EMA26; signal = EMA9 of MACD', last(macd.macd) === null ? null : `${fmtNum(last(macd.macd))} / ${fmtNum(last(macd.signal))}`],
    ['Bollinger %B', 'Where the close sits between the 20-day ± 2σ bands', fmtNum(pctB)],
    ['SMA50', '50-day average close', last(smaSeries(closes, 50)) === null ? null : formatMoney(last(smaSeries(closes, 50)), currency, { mask: false })],
  ];
  rows.forEach(([name, title, value]) => signalRow(tbody, name, title, value, 'Descriptive only', undefined));
}

function renderNews() {
  const box = document.getElementById('analysis-news');
  box.innerHTML = '';
  const { news, symbol } = analysisLoaded;
  if (!news.length) {
    const p = document.createElement('p');
    if (!getSettingString('FINNHUB_API_KEY', null)) p.textContent = 'Add a FINNHUB_API_KEY setting to see headlines.';
    else if (isCanadianSymbol(symbol)) p.textContent = "Finnhub's free plan has no news for TSX stocks.";
    else p.textContent = `No Finnhub headlines for ${symbol} in the last 30 days.`;
    box.appendChild(p);
    return;
  }
  news.slice(0, 12).forEach((n) => {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = n.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = n.headline;
    p.append(`${n.date} · ${n.source} · `, a);
    box.appendChild(p);
  });
}

function renderAnalysisRange() {
  const canadian = analysisSymbol && isCanadianSymbol(analysisSymbol);
  renderRangeButtons('analysis-range', MARKET_RANGES, analysisRangeSlug, (slug) => {
    analysisRangeSlug = slug;
    writeMarketPref('ledger_analysis_range', slug);
    drawAnalysisChart();
  }, canadian ? new Set(['1d']) : new Set());
}

// 1d/1w: Twelve Data intraday, close only (the other lines are daily).
async function drawIntradayAnalysisChart(range) {
  const { currency, symbol } = analysisLoaded;
  const token = ++analysisChartToken;
  try {
    const result = await getIntradayBars(symbol, range.intraday);
    let bars = result.bars;
    if (range.slug === '1d' && bars.length) {
      const lastDay = bars.at(-1).d.slice(0, 10);
      bars = bars.filter((b) => b.d.startsWith(lastDay));
    }
    if (token !== analysisChartToken) return;
    const series = [
      { label: `${symbol} (close)`, data: bars.map((b) => b.c), color: chartColor('--chart-blue'), order: 1 },
    ];
    const draw = () => {
      analysisChart = marketLineChart(analysisChart, 'analysis-chart', bars.map((b) => b.d),
        series.map((s) => ({ ...s, hidden: analysisHiddenSeries.has(s.label) })), { money: result.currency || currency, intraday: true });
      renderSeriesLegend('analysis-legend', series, analysisHiddenSeries, draw);
    };
    draw();
  } catch (err) {
    if (token === analysisChartToken) setMarketStatus('analysis-status', marketErrorText(err));
  }
}

// Overlays come from the daily bars only; older month-end bars (TSX) show the close alone.
function drawAnalysisChart() {
  renderAnalysisRange();
  if (!analysisLoaded) return;
  const { bars, monthly, currency, symbol, benchmark } = analysisLoaded;
  const entry = allWatchlist.find((w) => w.symbol === symbol);
  document.getElementById('analysis-chart-title').textContent = entry?.name ? `${symbol} — ${entry.name}` : symbol;
  let range = marketRange(analysisRangeSlug);
  if (range.slug === '1d' && isCanadianSymbol(symbol)) range = marketRange('1w');
  if (range.intraday && !isCanadianSymbol(symbol)) {
    drawIntradayAnalysisChart(range);
    return;
  }
  ++analysisChartToken;
  const shown = barsForRange(bars, monthly, range);
  const closes = bars.map((b) => b.c);
  const byDate = (series) => new Map(bars.map((b, i) => [b.d, series[i]]));
  const sma200 = byDate(smaSeries(closes, 200));
  const stops = byDate(trailingStopSeries(bars, getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT)));
  const high52 = byDate(bars.map((_, i) => (i >= 251 ? Math.max(...bars.slice(i - 251, i + 1).map((b) => b.h)) : null)));
  const pick = (map) => shown.map((b) => map.get(b.d) ?? null);
  const benchByDate = new Map((benchmark || []).map((b) => [b.d, b.c]));
  const firstBench = shown.map((b) => benchByDate.get(b.d)).find((v) => Number.isFinite(v));
  const rebased = shown.map((b) => (firstBench && benchByDate.has(b.d) ? (benchByDate.get(b.d) / firstBench) * shown[0].c : null));

  const series = [
    { label: `${symbol} (close)`, data: shown.map((b) => b.c), color: chartColor('--chart-blue'), order: 1 },
    { label: 'SMA200 (200-day average close)', data: pick(sma200), color: desiredMarkColor() },
    { label: '52-week high (highest high, 252 days)', data: pick(high52), color: chartColor('--chart-good'), dash: true },
    { label: `Trailing stop (highest close of 22 days − ${getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT)} × ATR14)`, data: pick(stops), color: chartColor('--chart-bad'), dash: true },
    { label: `${analysisBenchmark(symbol)} (market, rebased to the first close)`, data: rebased, color: chartColor('--chart-purple') },
  ];
  const draw = () => {
    analysisChart = marketLineChart(analysisChart, 'analysis-chart', shown.map((b) => b.d),
      series.map((s) => ({ ...s, hidden: analysisHiddenSeries.has(s.label) })), { money: currency });
    renderSeriesLegend('analysis-legend', series, analysisHiddenSeries, draw);
  };
  draw();
}

// --- AI ---------------------------------------------------------------------

// The chart's lines as text, so the AI reads what the chart shows.
function analysisChartHistory() {
  const { symbol, bars, benchmark } = analysisLoaded;
  const k = getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT);
  const closes = bars.map((b) => b.c);
  const sma = smaSeries(closes, 200);
  const stops = trailingStopSeries(bars, k);
  const t = bars.length - 1;
  const pct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : 'n/a');
  const n = (v) => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');
  const benchName = analysisBenchmark(symbol);
  const lines = ['Chart history:'];

  if (sma[t] !== null) {
    const monthAgo = t >= 21 ? sma[t - 21] : null;
    lines.push(`Close vs SMA200: ${pct(closes[t] / sma[t] - 1)}; SMA200 ${monthAgo !== null ? (sma[t] > monthAgo ? 'rising' : 'falling') : 'n/a'} over the last month (${n(monthAgo)} -> ${n(sma[t])})`);
    let i = t;
    const above = closes[t] > sma[t];
    while (i > 0 && sma[i - 1] !== null && (closes[i - 1] > sma[i - 1]) === above) i--;
    lines.push(sma[i - 1] === null || i === 0
      ? `Close has been ${above ? 'above' : 'below'} SMA200 for all ${t - i + 1} days it can be computed`
      : `Close crossed ${above ? 'above' : 'below'} SMA200 on ${bars[i].d.slice(0, 10)}, ${t - i} trading days ago`);
  } else {
    lines.push('SMA200: n/a (needs 200 daily closes)');
  }

  if (stops[t] !== null) {
    lines.push(`Close vs trailing stop: ${pct(closes[t] / stops[t] - 1)}`);
    const hits = [];
    for (let i = Math.max(1, t - 251); i <= t; i++) {
      if (stops[i] !== null && stops[i - 1] !== null && closes[i] < stops[i] && closes[i - 1] >= stops[i - 1]) hits.push(bars[i].d.slice(0, 10));
    }
    lines.push(`Closes below the trailing stop in the last year: ${hits.length ? `${hits.length} (latest ${hits.at(-1)})` : 'none'}`);
  }

  const benchByDate = new Map((benchmark || []).map((b) => [b.d, b.c]));
  const back = (days) => (t >= days ? bars[t - days] : null);
  const perf = [63, 126, 252].map((days) => {
    const then = back(days);
    if (!then) return null;
    const stock = closes[t] / then.c - 1;
    const b0 = benchByDate.get(then.d);
    const b1 = benchByDate.get(bars[t].d);
    return `${days === 63 ? '3m' : days === 126 ? '6m' : '12m'} ${pct(stock)} vs ${benchName} ${b0 && b1 ? pct(b1 / b0 - 1) : 'n/a'}`;
  }).filter(Boolean);
  if (perf.length) lines.push(`Return: ${perf.join('; ')}`);

  // Month-ends of the last year: the chart's shape.
  const monthEnds = bars.map((b, i) => i).filter((i) => i === t || bars[i + 1].d.slice(0, 7) !== bars[i].d.slice(0, 7)).slice(-13);
  const firstBench = benchByDate.get(bars[monthEnds[0]].d);
  lines.push(`Month-ends (date | close | SMA200 | trailing stop | ${benchName} rebased to the first close):`);
  monthEnds.forEach((i) => {
    const b = benchByDate.get(bars[i].d);
    const rebased = firstBench && b ? (b / firstBench) * closes[monthEnds[0]] : null;
    lines.push(`${bars[i].d.slice(0, 10)} | ${n(closes[i])} | ${n(sma[i])} | ${n(stops[i])} | ${n(rebased)}`);
  });
  return lines;
}

function analysisUserMessage() {
  const { symbol, signals: s, currency, bars, news } = analysisLoaded;
  const money = (v) => (v === null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)} ${currency}`);
  const read = (pass) => (pass === true ? 'pass' : pass === false ? 'fail' : 'n/a');
  const val = (result, text) => (result.value === null ? `n/a (needs ${result.needs}, have ${result.have})` : text);
  // The close's distance from a level, so the AI needn't work it out.
  const gap = (level) => (level === null || !Number.isFinite(level) ? '' : ` (close is ${Math.abs(s.close - level).toFixed(2)} ${s.close >= level ? 'above' : 'below'} it)`);
  const lines = [
    `Stock: ${symbol} (${currency}), as of ${bars.at(-1)?.d.slice(0, 10)}`,
    '',
    'Evidence-backed checks:',
    `Trend (${s.trend.basis}): close ${money(s.trend.close)} vs average ${money(s.trend.sma)} (rule: close above) -> ${read(s.checks.trend)}`,
    `Momentum 12-1: ${val(s.momentum, fmtPct(s.momentum.value))} (rule: above 0%) -> ${read(s.checks.momentum)}`,
    `Relative momentum vs ${analysisBenchmark(symbol)}: ${s.relative.value === null ? 'n/a' : fmtPct(s.relative.value)} (rule: above 0) -> ${read(s.checks.relative)}`,
    `52-week high ratio: ${val(s.high52, fmtPct(s.high52.value))} (rule: at least 90%) -> ${read(s.checks.high52)}`,
    `Verdict: ${s.verdict.label} (${s.verdict.passed} of ${s.verdict.available} checks pass)${s.verdict.notes.length ? `; ${s.verdict.notes.join('; ')}` : ''}`,
    '',
    'Risk:',
    `Volatility 3m: ${val(s.vol63, fmtPct(s.vol63.value))}; 1y: ${val(s.vol252, fmtPct(s.vol252.value))}`,
    `ATR14: ${money(s.atr)}; max drawdown 1y: ${val(s.mdd1y, fmtPct(s.mdd1y.value))}`,
    `Sharpe 1y: ${val(s.sharpe, fmtNum(s.sharpe.value))}; Sortino 1y: ${val(s.sortino, fmtNum(s.sortino.value))}; beta vs ${analysisBenchmark(symbol)}: ${val(s.beta, fmtNum(s.beta.value))}`,
    `5-day move: ${s.spike === null ? 'n/a' : s.spike ? 'spike (above 2 sigma)' : 'normal'}`,
    '',
    'Levels:',
    `Close: ${money(s.close)}`,
    `Trailing stop, for a holder (highest close of 22 days − ${getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT)} × ATR14): ${money(s.stop)}${gap(s.stop)}${s.stop !== null && s.close <= s.stop ? ' — already broken: exit signal for a holder' : ''}`,
    `Entry stop, if buying today (close − ${getSetting('MARKET_ATR_MULT', MARKET_ATR_MULT_DEFAULT)} × ATR14): ${money(s.entryStop)}${gap(s.entryStop)}`,
    `${s.trend.basis} (long-term average): ${money(s.trend.sma)}${gap(s.trend.sma)}`,
    `52-week high: ${s.high52.value === null ? 'n/a' : `${money(s.close / s.high52.value)}${gap(s.close / s.high52.value)}`}`,
    `Last 5 closes: ${bars.slice(-5).map((b) => `${b.d.slice(0, 10)} ${b.c.toFixed(2)}`).join(', ')}`,
    '',
    ...analysisChartHistory(),
  ];
  if (document.getElementById('analysis-include-position').checked) {
    const held = [...currentHoldings().values()].filter((h) => h.symbol === symbol && h.shares > 0);
    lines.push('', 'My position:', ...(held.length
      ? held.map((h) => `${h.account}: ${h.shares} shares at average cost ${(h.acb / h.shares).toFixed(2)} ${h.currency}`)
      : ['none']));
  }
  lines.push('', `Headlines (last 30 days, newest first):`, ...(news.length
    ? news.slice(0, 15).map((n) => `${n.date} | ${n.source} | ${n.headline}`)
    : ['none supplied']));
  const question = document.getElementById('analysis-question').value.trim();
  if (question) lines.push('', `Question: ${question}`);
  return lines.join('\n');
}

function renderAnalysisPrompt() {
  if (!analysisLoaded) return;
  document.getElementById('analysis-prompt-template').textContent = `SYSTEM\n${MARKET_ANALYSIS_SYSTEM_PROMPT}\n\nUSER\n${analysisUserMessage()}`;
  document.getElementById('analysis-prompt-details').hidden = false;
}

function renderAnalysisReport(text, stamp) {
  const body = document.getElementById('analysis-body');
  body.innerHTML = '';
  renderInsightText(body, text, ANALYSIS_LABELS);
  const disclaimer = document.createElement('p');
  disclaimer.className = 'hint';
  disclaimer.textContent = ANALYSIS_DISCLAIMER;
  body.appendChild(disclaimer);
  const at = document.getElementById('analysis-generated-at');
  at.hidden = !stamp;
  at.textContent = stamp ? `Last generated ${stamp}` : '';
  renderSuggestedAlerts(text);
}

let suggestedAlerts = null; // { symbol, alerts } from the shown report

// The report's Alerts line; a price not in the data sent is dropped, never applied.
function renderSuggestedAlerts(text) {
  const hint = document.getElementById('analysis-alerts-hint');
  const btn = document.getElementById('analysis-apply-alerts-btn');
  suggestedAlerts = null;
  hint.hidden = true;
  btn.hidden = true;
  const parsed = text ? parseAlertLine(text) : null;
  if (!parsed || !analysisLoaded) return;
  const { symbol } = analysisLoaded;
  const known = (analysisUserMessage().match(/\d+\.\d{2}/g) || []).map(Number);
  const { close, stop, trend } = analysisLoaded.signals;
  const notes = [];
  const dropped = ['below', 'above'].filter((k) => parsed[k] !== null && !known.some((v) => Math.abs(parsed[k] - v) <= v * 0.005));
  if (dropped.length) notes.push(`Left out ${dropped.join(' and ')}: not a price in the data sent.`);
  dropped.forEach((k) => { parsed[k] = null; });
  // A rule already met would fire at once, so it isn't a warning.
  const money = (v) => formatMoney(v, analysisLoaded.currency, { mask: false });
  if (parsed.below !== null && parsed.below >= close) {
    notes.push(`Left out below ${money(parsed.below)}: it's not under today's close ${money(close)}.`);
    parsed.below = null;
  }
  if (parsed.above !== null && parsed.above <= close) {
    notes.push(`Left out above ${money(parsed.above)}: it's not over today's close ${money(close)}.`);
    parsed.above = null;
  }
  if (parsed.belowStop && stop !== null && close <= stop) {
    notes.push('Left out below the trailing stop: the close is already under it.');
    parsed.belowStop = false;
  }
  if (parsed.belowAvg && trend.sma !== null && close <= trend.sma) {
    notes.push('Left out below the average: the close is already under it.');
    parsed.belowAvg = false;
  }
  if (parsed.aboveAvg && trend.sma !== null && close >= trend.sma) {
    notes.push('Left out above the average: the close is already over it.');
    parsed.aboveAvg = false;
  }
  const labels = alertLabels(parseAlerts(parsed)).map((l) => l.label);
  const entry = allWatchlist.find((w) => w.symbol === symbol);
  if (labels.length && entry) {
    suggestedAlerts = { symbol, alerts: parsed };
    btn.hidden = false;
    btn.title = `Set ${symbol}'s alerts to ${labels.join(' · ')} on Watch List (replaces its current alerts)`;
    notes.unshift(`Suggested alerts: ${labels.join(' · ')}. 📌 applies them to ${symbol} on Watch List, replacing its current alerts.`);
  }
  hint.textContent = notes.join(' ');
  hint.hidden = !notes.length;
}

async function applySuggestedAlerts() {
  if (!suggestedAlerts) return;
  const entry = allWatchlist.find((w) => w.symbol === suggestedAlerts.symbol);
  if (!entry) return;
  const previous = entry.alerts ? { ...entry.alerts } : null;
  const btn = document.getElementById('analysis-apply-alerts-btn');
  btn.disabled = true;
  try {
    await saveWatchlistAlerts(entry, { ...suggestedAlerts.alerts, dismissed: [] });
    showUndoToast(`Alerts set for ${entry.symbol}.`, () => saveWatchlistAlerts(entry, previous));
  } catch (err) {
    showFieldError('analysis-form-error', `Couldn't save the alerts: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

function renderSavedAnalysis() {
  const last = latestAnalysis(analysisLoaded.symbol);
  clearFieldError('analysis-form-error');
  if (last) renderAnalysisReport(last.report, last.date);
  else {
    document.getElementById('analysis-body').innerHTML = '';
    document.getElementById('analysis-generated-at').hidden = true;
    renderSuggestedAlerts(null);
  }
}

// A price in Levels that isn't one of the supplied figures (±0.5%) gets flagged.
function auditAnalysisLevels(text, message) {
  const known = (message.match(/\d+\.\d{2}/g) || []).map(Number);
  const levels = text.split('\n').find((l) => l.trim().startsWith('Levels:')) || '';
  const odd = (levels.match(/\d+\.\d{2}/g) || []).map(Number).filter((v) => !known.some((k) => Math.abs(v - k) <= k * 0.005));
  return odd;
}

async function runStockAnalysis() {
  if (!analysisLoaded) return;
  const btn = document.getElementById('analysis-generate-btn');
  const { symbol, signals } = analysisLoaded;
  btn.disabled = true;
  btn.textContent = '🤖…';
  clearFieldError('analysis-form-error');
  try {
    const message = analysisUserMessage();
    const text = await aiChatText(MARKET_ANALYSIS_SYSTEM_PROMPT, message, 0.2);
    const stamp = localTimestamp(new Date());
    renderAnalysisReport(text, stamp);
    const odd = auditAnalysisLevels(text, message);
    if (odd.length) showFieldError('analysis-form-error', `Levels mentions ${odd.join(', ')}, which isn't in the data sent — check it.`);
    try {
      await ensureSheetTab(CONFIG.SHEETS.STOCK_ANALYSIS, ANALYSIS_HEADERS);
      await appendValues(ANALYSIS_RANGE(), [[stamp, symbol, signals.verdict.label, `${signals.verdict.passed}/${signals.verdict.available}`,
        signals.close ?? '', signals.stop ?? '', text]], 'RAW');
      await initStockAnalysisLog();
    } catch (err) {
      showFieldError('analysis-form-error', `Generated, but couldn't save it: ${err.message}`);
    }
  } catch (err) {
    showFieldError('analysis-form-error', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖';
  }
}
