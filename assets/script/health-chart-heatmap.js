// Health Chart's heatmap, LeetCode's grid over the range buttons' days (healthDateRange):
// one cell per day, columns are weeks (Monday first), the last one holding the range's
// end. A day's colour is its Calorie Balance bar's (energyBalanceGrade); a day with no
// food logged is an empty square.

function renderHealthHeatmap(entries) {
  const grid = document.getElementById('health-heatmap');
  if (!grid) return;
  const months = document.getElementById('health-heatmap-months');

  // Back to the range's first Monday, so every column is a whole week.
  const { from, to } = healthDateRange();
  const start = dateFromIso(from);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const dates = datesInRange(isoFromDate(start), to);
  const weeks = Math.max(1, Math.ceil(dates.length / 7));

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
  const weeklyAvg = emaSeries(balanceData);
  const hidden = legendHiddenNames('health-heatmap-legend');

  grid.innerHTML = '';
  months.innerHTML = '';
  dates.forEach((iso, i) => {
    const balance = balanceData[i];
    const cell = document.createElement('span');
    if (balance === null) {
      cell.title = `${iso}: no calories logged`;
    } else {
      const grade = energyBalanceGrade(balance, isCut, desired, weeklyAvg[i]);
      if (!hidden.has(grade.name)) {
        cell.className = 'heat-graded';
        cell.style.background = grade.color;
      }
      const text = `${iso}: ${balance > 0 ? '+' : ''}${Math.round(balance)} kcal · ${grade.name}`;
      cell.title = privacyMode ? maskDigits(text) : text;
    }
    grid.appendChild(cell);
    // A month's name over the first week it starts in.
    const d = dateFromIso(iso);
    if (d.getDate() <= 7 && d.getDay() === 1) {
      const label = document.createElement('span');
      label.textContent = d.toLocaleString('en', { month: 'short' });
      label.style.gridColumn = String(Math.floor(i / 7) + 1);
      months.appendChild(label);
    }
  });
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
