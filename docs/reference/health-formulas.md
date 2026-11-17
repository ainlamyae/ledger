# Health formulas

[Docs](../README.md) › Reference

Every formula the Health section computes, with its constants, defaults and source file.

## At a glance

- **One source of truth:** Tune, the charts, the tiles and the AI Plan prompt all call the same functions in `health-math.js` and `health-chart.js`.
- **Plan figures use m̄:** the L_p-day average body mass, never a single reading.
- **Maintenance is BMR + activity:** no lifestyle multiplier; TEF divides the intake rather than adding to it.
- **Settings override defaults:** every key below falls back to its default when the `Setting` row is blank.
- **Population constants:** literature values, not personal parameters; none is read from `Setting` unless marked.

## Symbols

| Symbol | Meaning | Setting key | Default |
|---|---|---|---|
| m | Body mass, kg | Physique Body Mass | — |
| m̄ | L_p-day mean body mass, ending before today, to 0.1 kg | — | — |
| h | Height, cm | `HEIGHT_CM` | 170 in Tune |
| a | Age, whole years from birth date | `BIRTH_DATE` | 35 in Tune |
| σ | Mifflin sex term: +5 ♂, −161 ♀ | `SEX` | — |
| m_des | Healthy body mass, kg | `BODY_MASS_HEALTHY_KG` | 70 |
| Δm | Desired weekly fat loss, kg/week (negative = bulk) | `WEEKLY_FAT_LOSS_KG` | 1% of m̄ in Tune |
| Δm% | Desired weekly loss as % of body mass (pin) | `WEEKLY_FAT_LOSS_PCT` | blank |
| τ | Desired daily activity, min | `ACTIVITY_DESIRED_MIN` | 100 |
| MET | Walking MET, from the `Activity` tab's `Walk` row | — (sheet) | 3 |
| κ | mL O₂ per kg per min per MET | `KCAL_PER_MET_KG_MIN` | 3 |
| ε | mL O₂ per kcal | — | 200 |
| ρ | Energy in 1 kg of body fat | — | 7700 kcal |
| f | TEF share of intake, % | `TEF_PERCENT_OF_INTAKE` | 13.5 (held to 0–90) |
| s_des | Desired sleep, h | `SLEEP_DESIRED_HOURS` | 8 |
| s | Planned sleep, h | `PLAN_SLEEP_HOURS` | = s_des |
| γ | Fat-loss efficiency lost per hour of short sleep, % | `SLEEP_DEPRIVATION_PCT_PER_HOUR` | 3 |
| λ | Metabolic adaptation per week, % | `BMR_ADAPT_PCT_PER_WEEK` | 1 |
| λt_max | Adaptation cap, % | `BMR_ADAPT_PCT_CAP` | 12 |
| n_p | Calibration periods | `BMR_CALIBRATION_PERIOD_COUNT` | 4 |
| L_p | Period length, days (also every average and trend window) | `BMR_CALIBRATION_PERIOD_DAYS` | 7 |

## Population constants

| Constant | Value | File |
|---|---|---|
| `GENERIC_KCAL_PER_KG_FAT` (ρ) | 7700 kcal/kg | `health-math.js` |
| `MET_ML_O2_PER_KG_MIN_DEFAULT` / `ML_O2_PER_KCAL` | 3 / 200 (κ / ε) | `health-math.js` |
| `GENERIC_KCAL_PER_ACTIVE_MIN` | 5 kcal/min, only with no body mass on file | `health-math.js` |
| `ACTIVITY_MET_FALLBACK` | 3, walking MET when the Activity tab has no `Walk` row | `health-math.js` |
| `EXERCISE_MET_FALLBACK` | 3.5, an exercise name the Activity tab doesn't list | `health-activity-catalogue.js` |
| `WORKOUT_REP_SEC_DEFAULT` | 3 s per rep (`WORKOUT_REP_SEC`) | `health-activity-estimator.js` |
| `WORKOUT_STEPS_PER_MIN_DEFAULT` | 100 steps/min (`WORKOUT_STEPS_PER_MIN`) | `health-chart.js` |
| `KCAL_PER_G_FAT` / `KCAL_PER_G_CARB` | 9 / 4 kcal/g (Atwater; protein 4, fiber 2) | `health-math.js` |
| `BODY_MASS_TREND_WINDOW_SIZE` | 5 logged points (centred average) | `health-math.js` |
| `PLATEAU_WINDOW_DAYS` / `PLATEAU_THRESHOLD_KG` | 10 days / 0.3 kg | `health-math.js` |
| `BMI_HEALTHY_MIN` / `MAX` | 20 / 25 kg/m² | `health-chart.js` |
| `GLYCOGEN_SKELETAL_FRAC_DEFAULT` | 45% of LBM is skeletal muscle | `health-chart.js` |
| `GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT` | 14 g glycogen per kg muscle | `health-chart.js` |
| `GLYCOGEN_LIVER_G_DEFAULT` | 100 g liver glycogen | `health-chart.js` |
| `GLYCOGEN_WATER_RATIO_DEFAULT` | 3 g water per g glycogen | `health-chart.js` |
| `WEEKLY_FAT_LOSS_PCT_FLOOR` / `CEILING` | 0.5 / 1 % of body mass per week | `health-math.js` |
| `DEFICIT_VS_BMR_PCT_CEILING` | 20% of BMR | `health-math.js` |
| `SLEEP_EFFICIENCY_FACTOR_MIN` | 0.2, floor on η when inflating a deficit | `health-math.js` |
| `PROJECTION_HORIZON_DAYS` | 365, forecast drawn weekly up to a year | `health-math.js` |
| `PROJECTION_LOGGED_WINDOW_DAYS` | 14, habit fallback window | `health-math.js` |
| `PROJECTION_SLEEP_RATIO_MIN` | 0.7, habit fallback sleep multiplier floor | `health-math.js` |

## Desired grades

- **Grade:** each day gets r, the share of the desired change it made (1 = desired, 0 = none, below 0 = wrong way).
- **Lift:** a day grades at most one step below its L_p-day average's grade, so one off day reads as a dip, not red.
- **Blend:** bar and dot colours blend between grade colours along r rather than jumping.

| Grade | r from | Colour token |
|---|---|---|
| Beat desired | 1.1 | `--chart-good-high` (dark green) |
| Desired met | 0.85 | `--chart-good` (green) |
| Near desired | 0.6 | `--chart-near` (lime) |
| Short of desired | 0.3 | `--chart-warn` (amber) |
| Missed desired | below 0.3 | `--chart-bad` (red) |

| Chart | r |
|---|---|
| Calorie Balance, heatmap | balance ÷ D; with no D, green toward / red away by sign |
| Caloric Intake | (intake − M) ÷ D, with M = desired intake − D; with no D, cap ÷ intake (floor: intake ÷ floor) |
| Physical Activity | burn ÷ desired burn; no body mass is violet and unscored |
| Sleep | hours slept ÷ s_des |
| Sleep Deprivation dot | green at 0 kcal, blending to Missed at 60 kcal |

## Macro bands

- **In band:** `min ≤ g ≤ max`; a zero-width band counts at-or-over as a hit.
- **Source order:** Tune's saved gram band (`<KEY>_MIN`/`_MAX`), else the flat default as a zero-width band.

| Macro | Tune formula | Defaults | Under band | Over band |
|---|---|---|---|---|
| Protein | P = p × LBM | p_min 1.8, p_max 2.2 g/kg LBM; flat 100 g | Red | Dark green |
| Fiber | F_min = b_min × TEI/1000, F_max = b_max × m | 17 g/1000 kcal, 0.5 g/kg; flat 30 g | Red | Red |
| Fat | G = (k/100 × TEI) / 9 | 20–35% of TEI; flat 65 g | Red | Light green |
| Carbohydrate | C = (q/100 × TEI) / 4 | 30–50% of TEI; flat 275 g | Grey (unscored) | Red |

- **Protein fallbacks:** absolute band first, then `PROTEIN_DESIRED_G_PER_KG` (or its `_MIN`/`_MAX`) × `BODY_MASS_HEALTHY_KG` (else latest m), then flat `PROTEIN_DESIRED_G`.
- **Lean mass only here:** the protein band is the one figure scaled to LBM rather than total mass.
- **Frozen grams:** a saved gram band moves only when Tune is saved again.

## Body

| Figure | Formula | Notes |
|---|---|---|
| BMI | m / (h/100)² | — |
| BMI_des | m_des / (h/100)² | Graded against 20–25 |
| LBM_boer ♂ | 0.407·m + 0.267·h − 19.2 | Boer 1984; default (`LBM_FORMULA` = `boer`) |
| LBM_boer ♀ | 0.252·m + 0.473·h − 48.3 | Rounded to 0.1 kg before BMR uses it |
| BF% Navy ♂ | 495 / (1.0324 − 0.19077·log10(C_waist − C_neck) + 0.15456·log10(h)) − 450 | Hodgdon & Beckett 1984 |
| BF% Navy ♀ | 495 / (1.29579 − 0.35004·log10(C_waist + C_hip − C_neck) + 0.22100·log10(h)) − 450 | Girths `NECK_CM`, `WAIST_CM`, `HIP_CM` |
| LBM_navy | m × (1 − BF%/100) | `LBM_FORMULA` = `navy`; Boer until girths are saved |
| WHtR | C_waist / h | Red at 0.5 or over |
| WHR | C_waist / C_hip | Red over 0.90 ♂ / 0.85 ♀ (WHO) |
| BRI | 364.2 − 365.5 × √(1 − (C_waist/2π)² / (0.5·h)²) | Thomas 2013 |
| Waist | C_waist | Red over 102 ♂ / 88 ♀ cm |
| BF% verdict | BF% | Red over 25% ♂ / 32% ♀ |

## Smoothing and trend

| Figure | Formula | Used by |
|---|---|---|
| m̄ | mean of daily means over the L_p days ending at the newest reading before today | Every plan figure, Tune, Status |
| EMA | ema(i) = α·v(i) + (1 − α)·ema(i−1), α = 2/(L_p + 1) | L_p-Day Average on every dated chart |
| Body Mass L_p-Day Trend | EMA over L_p days, restarted after a gap over 14 days | Body Mass, Safe Pace |
| Trend slope | ema(i) − ema(i − L_p) | Body Mass hover, in g/day |
| Centred trend | mean of 5 logged points around each reading | Plateau check, forecast fallback |
| Plateau | abs(trend change) < 0.3 kg over ≥ 10 days, ≥ 3 points | State Trend & Forecast |

- **Unlogged day:** the EMA carries the last value forward.
- **Today counts:** a reading logged today updates the EMA at once.
- **Sleep:** bed and wake are smoothed on the noon-anchored axis, so 23:30 and 00:30 average near midnight.

## Energy

| Figure | Formula | Notes |
|---|---|---|
| MET burn | MET × m × min × κ/ε | The app's only MET-to-kcal conversion |
| Activity minutes | steps ÷ `WORKOUT_STEPS_PER_MIN`; hours × 60; minutes as-is | — |
| Entry burn | Calculate's AEE if logged, else MET_walk burn, else min × 5 | `activityEntryKcal` |
| BMR_mif | 10·m + 6.25·h − 5·a + σ | Default (`BMR_FORMULA` = `mifflin`) |
| BMR_kat | 370 + 21.6·LBM | `BMR_FORMULA` = `katch`; needs no age |
| λt | min(λ/100 × days/7, λt_max/100) | days since the first body-mass reading |
| BMR_adp | BMR × (1 − λt) | — |
| BMR_cal | BMR + calibration offset | See Calibration |
| BMR_avg | mean of the known BMR_mif, BMR_kat, BMR_cal, BMR_adp | — |
| AEE desired | MET_walk × m × τ × κ/ε | `activityDesiredKcal` |
| AEE pinned | `ACTIVITY_DESIRED_FIXED_KCAL`; minutes = kcal ÷ (MET × m × κ/ε) | Tile, chart, Insight only |

| `BMR_BASIS` | BMR used for every deficit |
|---|---|
| `bmr` (default) | The equation in force |
| `bmr_adp` | BMR × (1 − λt) on that date |
| `bmr_cal` | BMR + the latest stored calibration offset (0 if none) |
| `bmr_avg` | BMR × BMR_avg / BMR_equation, measured today at m̄ (1 if none) |

## Desired intake

| Step | Formula |
|---|---|
| Raw deficit | D_raw = Δm × ρ / 7 |
| Sleep efficiency | η = 1 − (γ/100) × max(0, s_des − s), floored at 0 |
| Deficit | D = D_raw / max(η, 0.2) for a deficit; D = D_raw for a surplus |
| Sleep Deprivation Effect | SD = D − D_raw |
| TEF | TEF = f × TEI |
| Desired intake | TEI = (BMR + AEE − D) / (1 − f), rounded |
| Δm from Δm% | Δm = Δm%/100 × m, recomputed at each body mass |
| Δm% | 100 × Δm / m |
| D_bmr% | (BMR − TEI) / BMR × 100 |

- **Today's figure:** evaluated at m̄; the per-day chart line uses each day's carried-forward body mass and stored BMR.
- **Direction:** a ceiling when m_des < m̄, a floor when m_des > m̄; at goal, a negative Δm makes it a floor.
- **Fallback:** flat `CALORIE_DESIRED_KCAL` (2000) when height, sex, Δm, or age (Mifflin only) is missing.
- **Pinned intake:** `CALORIE_DESIRED_FIXED_KCAL` wins everywhere and stops tracking body mass.
- **Pinned rate:** `WEEKLY_FAT_LOSS_PCT` replaces `WEEKLY_FAT_LOSS_KG`; pinning it blanks the intake pin and vice versa.
- **Tracking vs pinned:** tracking re-cuts intake as you lighten (steady loss); pinned intake holds still, so loss slows.
- **Pin-blind AEE:** the desired intake always uses the unpinned AEE, so pinning the burn doesn't move intake.
- **Rate verdict:** Δm% outside 0.5–1 %/week and D_bmr% over 20% are coloured warnings, never limits.
- **Sensitivity:** the desired intake moves about 16 kcal per kg of body mass.

## Calibration

- **Idea:** compare what the equation says happened (D) with what the scale says happened (ΔM); the gap is the equation's error.
- **Window:** n_p periods of L_p days, ending yesterday; each period's m̄ is smoothed over L_p days.
- **Sign:** both D and ΔM are negative for a deficit.
- **Stored:** written per day as `BMR_cal` in Physique's Derived cell; the plan reads the latest one.
- **Shift, not slope:** the offset is added at every body mass, keeping the equation's own slope.

| Step | Formula |
|---|---|
| Day balance | D = TEI − BMR − AEE − TEF + SD (stored BMR, TEF falls back to f × TEI) |
| Period balance | D_i = mean D over period i's days with a D |
| Period mass change | ΔM_i = (m̄_end,i − m̄_start,i) × ρ / L_p |
| Period offset | D_i − ΔM_i |
| Weight | w_i = 0.1 + 0.9 × i / (n_p − 1); oldest 0.1, newest 1.0; 1 when n_p = 1 |
| Offset | Σ w_i (D_i − ΔM_i) / Σ w_i |
| BMR_cal | BMR + offset |

- **Ramp-up:** a day uses the full periods it has so far, up to n_p; in the first period BMR_cal is the mean of the day's equations.
- **Clamp:** a stored BMR_cal stays within the day's lowest equation − 10% and highest + 10%.
- **Missing data:** a period with no D or no mass at both ends gets no offset.
- **Profile needed:** height, sex, and age unless Katch-McArdle.

## Calorie Balance

| Figure | Formula |
|---|---|
| Maintenance | that day's BMR at its carried-forward body mass |
| TEF | the day's measured TEF, else f × intake |
| Raw balance | intake − maintenance − AEE − TEF |
| Deprivation (SD) | abs(raw balance) × (1 − η(that night's sleep)) |
| Balance | raw balance + SD |
| Expected change | balance / ρ × 1000 g |

- **No food logged:** the day is a gap, not zero.
- **SD direction:** always toward surplus; a deficit shrinks and a surplus grows.
- **No sleep logged:** SD is 0.
- **Forward vs reverse:** the plan divides D by η; the day's balance multiplies by (1 − η).

## Safe Pace

| Line | Formula |
|---|---|
| Weekly Loss | (trend(d − L_p) − trend(d)) × 7 / L_p / trend(d) × 100 |
| Deficit vs BMR | (BMR − intake) / BMR × 100, then L_p-Day Average |
| Right axis | left axis × 20 (20% of BMR lines up with 1% m/week) |

- **Zones:** Safe (green) from 0 to the line, Too Fast (red) above, Gaining (amber) below 0.

## Glycogen swing

| Figure | Formula |
|---|---|
| Muscle | m_musc = s × LBM(m̄) |
| Glycogen | m_gly = g_musc × m_musc + g_liver |
| Swing | ΔM_gly = m_gly × (1 + r) / 1000 kg |
| Arrival mass | m_des − ΔM_gly cutting, m_des + ΔM_gly bulking |

- **Saved swing:** `GLYCOGEN_SWING_KG` is saved once from the latest reading and used everywhere after.
- **Swing zone:** a yellow band ΔM_gly deep under the Calorie-Implied Trajectory; a trend below it shades red (real loss).

## Forecast

- **Primary path:** needs h, sex and (Mifflin) birth date; it states the plan, not recent behaviour.
- **Sleep:** enters only through s in D; nightly sleep doesn't move the curve.
- **Same numbers as Tune:** the chart and Tune call one projection, so day counts can't differ.

| Figure | Constant-intake journey |
|---|---|
| E_in | desired intake at m̄ |
| A (Mifflin) | (6.25·h − 5·a + σ) / (1 − f) |
| B (Mifflin) | (10 + MET·τ·κ/ε) / (1 − f) |
| A (Katch) | (370 + 21.6·(c_h·h + c_0)) / (1 − f) |
| B (Katch) | (21.6·c_m + MET·τ·κ/ε) / (1 − f) |
| m∞ | (E_in − A) / B |
| m(t) | m∞ + (m̄ − m∞)·e^(−B·t/ρ) |
| t | (ρ / B) · ln[(m̄ − m∞) / (m_arrival − m∞)] |

- **Katch coefficients:** c_m, c_h, c_0 are LBM's per-kg, per-cm and constant terms; on Navy, c_m = 1 − BF%/100 and c_h = c_0 = 0.
- **Basis:** `bmr_adp` scales the BMR parts of A and B by (1 − λt); `bmr_cal` and `bmr_avg` scale them by a fixed ratio.
- **Adapted plateau:** m∞_adp = (E_in − A_adp) / B_adp, with the BMR halves × (1 − λt).

| Figure | Pinned-rate journey (Δm% > 0) |
|---|---|
| k | −ln(1 − Δm%/100) / 7 per day |
| m(t) | m̄ · (1 − Δm%/100)^(t/7) |
| t | 7 · ln(m̄ / m_arrival) / −ln(1 − Δm%/100) |

- **No plateau:** m∞ = 0, so any positive rate arrives.

| Status | Meaning |
|---|---|
| `reached` | m̄ within 0.1 kg of the healthy mass |
| `ok` | Arrival date found |
| `asymptote` | The healthy mass lies past m∞ (or, pinned, isn't below m̄) |
| `no-change`, `wrong-direction` | Fallback paths only |

| Fallback | Formula |
|---|---|
| Habit (no profile, logs in last 14 days) | slope = (avg intake − (flat desired + avg AEE)) / ρ × clamp(avg sleep / s_des, 0.7, 1) |
| Body mass only | least-squares slope over the readings |

- **Known limit:** the body-mass-only slope is per logged reading, so it matches kg/day only with daily logging.

## Progress meters

| Figure | Formula |
|---|---|
| Body bar % | clamp((m_start − m_last) / (m_start − m_des) × 100, 0, 100) |
| Done | abs(m_start − m_last) kg |
| To go | abs(m_last − m_des) kg, shown with ± ΔM_gly |
| Time bar % | days elapsed / (days elapsed + t) × 100 |

## Today's Status card

| Row | Figure | Green when |
|---|---|---|
| m, BMI | m̄ and its BMI | On the side of m_des the plan heads to |
| BMR | BMR at m̄, the one selected in Tune | — |
| TEI | Intake vs the desired intake | Under a ceiling or over a floor |
| TEF | desired intake × f | — |
| AEE | Σ entry burn | At or over the desired burn |
| SD | Sleep Deprivation Effect | 0 |
| D | TEI − BMR − AEE − TEF + SD | On the desired side of −Δm·ρ/7 |
| Δm | D / ρ | On the desired side of −Δm/7 |

- **Macros:** Protein, Fiber, Fat and Carb tiles use the day's stored Physique figures and the bands above.
- **Activity:** Cardio, NEAT and Strength split the day's entries by the Activity tab's Category; unscored.
- **Sleep:** Duration is green at or over s_des, red under it.

## Sleep chart axis

| Figure | Formula |
|---|---|
| Axis position, h | ((clock min − 720) + 1440) mod 1440 / 60 (noon-anchored) |
| Axis min | floor(earliest / 3) × 3, minus 3 only if the earliest sits on a tick |
| Axis max | ceil(latest / 3) × 3, plus 3 only if the latest sits on a tick |

## Protein Source Rotation

| Figure | Formula |
|---|---|
| Share | ingredient Percent ÷ Σ Percent × 100 |
| Desired | share/100 × P_max × 7 × days/7 g |
| Actual | Σ protein of that ingredient's breakdown items in range |
| % of total desired | actual / (P_max × days) × 100 |
| Bar | Σ desired and Σ actual per Group, sorted by shortfall |
| Donut rings | each Group's share of actual over the last 28 and 7 days |

## Workout logging

- **Active time only:** rest, warm-up and moving between machines don't count.
- **Tunable:** `WORKOUT_REP_SEC` (tempo) and `WORKOUT_STEPS_PER_MIN`; holds and minutes carry their own time.
- **Note lines:** `30x Name` (30 reps), `3x10 Name` (30 reps), `135sec Name`, `30min Name`, `6000step Name`.

| Line type | Active seconds |
|---|---|
| Reps | sets × reps × `WORKOUT_REP_SEC` |
| Hold | sets × hold seconds |
| Steps | steps / `WORKOUT_STEPS_PER_MIN` × 60 |
| Minutes | minutes × 60 |
| Day minutes | max(1, round(Σ seconds / 60)) |
| Day AEE | Σ MET(name, else 3.5) × m × seconds/60 × κ/ε |

## Food logging

- **Precedence:** your Nutrition row (by count, then by weight), then USDA, then the AI estimate.
- **Count vs weight:** count wins normally; weight wins on an anchored line.
- **Banking:** a new Nutrition row is always stored per 100 g.
- **Division:** `200/5g` or `1/2cup` is resolved before any lookup; a range like `2-3` is left alone.
- **Anchors:** `300kcal cookie` and `20p chicken` mean the energy or protein eaten; Consumption is rewritten with the weight.
- **Several anchors:** `100kcal 5p 4fiber 5fat 8carb bar` keeps each as typed; USDA fills only the missing ones.
- **Aliases:** `pro`, `df` and `carbs` parse as protein, fiber and carbohydrate anchors.

| Path | Formula |
|---|---|
| By count | kcal = row kcal / row count × count |
| By weight | kcal = row kcal / row g × 100 × g / 100 |
| Energy anchor | g = kcal / kcal per 100 g × 100; count = kcal / kcal per unit if no gram figure |
| Protein anchor | g = protein / protein per 100 g × 100; count likewise |

| TEF per item | Formula |
|---|---|
| Protein | g × 4 × `TEF_PROTEIN_PERCENT` (25%) |
| Carbohydrate | g × 4 × `TEF_CARB_PERCENT` (7.5%) |
| Fat | g × 9 × `TEF_FAT_PERCENT` (2%) |

- **Daily supplements:** `DAILY_SUPPLEMENTS` adds fixed amounts to micronutrient totals only (40 IU vitamin D = 1 µg).

## Related

- [Tune](../guide/health/tune.md): the plan's settings and the arithmetic behind each desired figure.
- [Chart](../guide/health/chart.md): every Health chart on one range, with desired grades.
- [Today](../guide/health/today.md): the day's energy budget, macros, activity, sleep and progress.
- [Data model](data-model.md): every sheet tab, column by column.
- [Conventions](conventions.md): names, units, dates and hover format.
- [Configuration](../development/configuration.md): `CONFIG`, `Setting` keys and browser storage.
