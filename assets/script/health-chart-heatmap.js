// Health Chart's heatmap over the range's days (healthDateRange), laid out like LeetCode's:
// rows are weekdays (Monday first), columns weeks, each month its own block with an empty
// column before the next, so a week spanning two months splits. A day's colour is its
// Calorie Balance bar's; a day with no food logged is an empty square.

function renderHealthHeatmap(entries) {
  const grid = document.getElementById('health-heatmap');
  if (!grid) return;
  const months = document.getElementById('health-heatmap-months');

  const { from, to } = healthDateRange();
  const dates = datesInRange(from, to);

  // Calorie Balance's own profile check: without one there's no BMR to subtract.
  const heightCm = getSetting('HEIGHT_CM', null);
  const age = ageFromBirthDate(getSettingString('BIRTH_DATE', null));
  const sex = getSettingString('SEX', null);
  const canCompute = heightCm !== null && age !== null && (sex === 'male' || sex === 'female')
    && entries.some((e) => e.category === 'Body Mass' && e.amount !== null);
  const balanceData = canCompute ? energyBalanceDays(entries, dates).balanceData : dates.map(() => null);
  const hasData = balanceData.some((v) => v !== null);
  const desired = hasData ? desiredBalanceKcal(planBodyMassKg(entries)) : null;
  const isCut = getCalorieDesiredKind(entries) === 'max';
  const weeklyAvg = emaSeries(balanceData, bodyMassSmoothingDays());
  const hidden = legendHiddenNames('health-heatmap-legend');

  grid.innerHTML = '';
  months.innerHTML = '';
  let col = 0;
  let monthLabel = null;
  let monthStart = 0;
  dates.forEach((iso, i) => {
    const d = dateFromIso(iso);
    const row = (d.getDay() + 6) % 7;
    // New month: a gap column, then its own label.
    if (i === 0 || d.getDate() === 1) {
      col += i === 0 ? 1 : 2;
      monthStart = col;
      monthLabel = document.createElement('span');
      monthLabel.textContent = d.toLocaleString('en', { month: 'short' });
      monthLabel.style.textAlign = 'center';
      months.appendChild(monthLabel);
    } else if (row === 0) {
      col += 1;
    }
    monthLabel.style.gridColumn = `${monthStart} / ${col + 1}`;
    const balance = balanceData[i];
    const cell = document.createElement('span');
    cell.style.gridColumn = String(col);
    cell.style.gridRow = String(row + 1);
    cell.textContent = String(d.getDate());
    if (balance === null) {
      cell.title = `${iso}: no calories logged`;
    } else {
      const grade = energyBalanceGrade(balance, isCut, desired, weeklyAvg[i]);
      if (!hidden.has(grade.name)) {
        cell.className = 'heat-graded';
        cell.style.background = grade.color;
        cell.style.color = '#fff';
      }
      const text = `${iso}: ${balance > 0 ? '+' : ''}${Math.round(balance)} kcal · ${grade.name}`;
      cell.title = privacyMode ? maskDigits(text) : text;
    }
    grid.appendChild(cell);
  });
  const weeks = Math.max(1, col);
  grid.style.setProperty('--weeks', String(weeks));
  months.style.setProperty('--weeks', String(weeks));
  const scroll = document.getElementById('health-heatmap-scroll');
  scroll.scrollLeft = scroll.scrollWidth;

  // Calorie Balance's swatches; clicking one empties its days.
  renderToggleLegend('health-heatmap-legend', !hasData ? [] : desired ? desiredGradeLegend() : [
    { name: 'Toward desired', color: chartColor('--chart-good') },
    { name: 'Away from desired', color: chartColor('--chart-bad') },
  ], () => renderHealthHeatmap(entries));
}
