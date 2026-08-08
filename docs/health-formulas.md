# Health Formula Reference

[← Back to README](../README.md)

- Every formula the Health section computes, with the file it lives in.
- Population constants are literature values, not personal parameters.
- None of them is read from `Setting` unless noted.

## Population constants

| Constant | Value | Where |
|---|---|---|
| `GENERIC_KCAL_PER_KG_FAT` | `7700` kcal/kg adipose | `wellness-math.js` |
| `MET_ML_O2_PER_KG_MIN_DEFAULT` / `ML_O2_PER_KCAL` | `3.5` / `200` (ACSM). Numerator overridable via `KCAL_PER_MET_KG_MIN` | `wellness-math.js` |
| `GENERIC_KCAL_PER_ACTIVE_MIN` | `5` kcal/min — last resort with no body mass on file | `wellness-math.js` |
| `WORKOUT_REP_SEC_DEFAULT` | `3` s per rep — a brisk tempo. Overridable via `WORKOUT_REP_SEC` | `activity-estimator.js` |
| `WORKOUT_STEPS_PER_MIN_DEFAULT` | `100` steps/min. Overridable via `WORKOUT_STEPS_PER_MIN` | `wellness-charts.js` |
| `ACTIVITY_MET_FALLBACK` / `EXERCISE_MET_DEFAULT` | `3.5` | `wellness-math.js`, `activity-estimator.js` |
| `BODY_MASS_TREND_WINDOW_SIZE` | `5` logged points | `wellness-math.js` |
| `PLATEAU_WINDOW_DAYS` / `PLATEAU_THRESHOLD_KG` | `10` days / `0.3` kg | `wellness-math.js` |
| `GLYCOGEN_SKELETAL_FRAC_DEFAULT` | `45 %` of LBM is skeletal muscle | `wellness-charts.js` |
| `GLYCOGEN_G_PER_KG_MUSCLE_DEFAULT` | `14` g glycogen / kg muscle | `wellness-charts.js` |
| `GLYCOGEN_LIVER_G_DEFAULT` | `100` g liver glycogen reserve | `wellness-charts.js` |
| `GLYCOGEN_WATER_RATIO_DEFAULT` | `3` g H₂O bound per g glycogen | `wellness-charts.js` |
| `GLYCOGEN_ZONE_SMOOTHING_ALPHA` | `1 / BODY_MASS_TREND_WINDOW_SIZE` (`0.2`) | `wellness-math.js` |

## Scoring thresholds

| Threshold | Value | Effect |
|---|---|---|
| `CALORIE_TARGET_NEAR_FRACTION` | `5 %` | Past the target by ≤5 % is grey, beyond is red |
| `ACTIVITY_NEAR_TARGET_FRACTION` | `5 %` | Short of the implied burn by ≤5 % is grey |
| `BODY_MASS_STALL_RED_AFTER_DAYS` | `2` days | A flat reading is grey until the plateau holds this long. Holding *at* target stays green |
| Protein over-band | — | Above the top end is a darker green (`#166534`), not red or grey. Below the floor stays red |
| Calorie Balance vs. target | — | At/beyond target green, short but right side of zero grey, wrong side red |
| Body Mass vs. its own 7-Day Trend | sign of the week's slope | A day scored red (moved the wrong way since the last reading) regrades to grey if that week's own least-squares trend (`weeklyTrendSeries`) still slopes toward the target. Stall-reds (a flat reading held too long) are untouched — a different signal |
| Caloric Intake vs. its own 7-Day Average | `withinCalorieTarget` | A red bar (past the target beyond `CALORIE_TARGET_NEAR_FRACTION`) regrades to grey if the 7-day average is still on the target's right side |

## Body

```
BMI                = bodyMassKg / (heightCm/100)²
age                = years since BIRTH_DATE (−1 before this year's birthday)
bodyFat%           = 1.20·BMI + 0.23·age − 10.8·(sex==male ? 1 : 0) − 5.4
                     clamped to [3, 60]                       (Deurenberg 1991)
LBM (kg)           = 0.407·kg + 0.267·cm − 19.2     ♂       (Boer 1984)
                   = 0.252·kg + 0.473·cm − 48.3     ♀
                     rounded to 0.1 kg before anything scales off it
```

- **Boer, not `kg × (1 − bodyFat%)`.** That route would square a BMI-only approximation; Boer was regressed against measured lean mass directly, and is the LBM equation clinical dosing uses. Age doesn't enter it. Lives in `wellness-charts.js` as `boerLeanBodyMassKg`, next to the Deurenberg chain it deliberately doesn't reuse.

```
trend[i]           = mean(values[i−2 … i+2])   centered SMA over logged points
plateau            = |trend[last] − trend[start]| < 0.3 kg over ≥10 days, ≥3 points
```

## Energy

```
metKcal(met, kg, min)     = met × kg × min × KCAL_PER_MET_KG_MIN/200
activityMinutes(amt,unit) = steps/WORKOUT_STEPS_PER_MIN | hours×60 | min as-is

activityEntryKcal(entry)  = entry.amount2                    if logged
                          = metKcal(ACTIVITY_MET, kg, mins)  else, with a body mass on file
                          = mins × 5                         else

BMR (Mifflin-St Jeor)     = 10·kg + 6.25·cm − 5·age + (male ? +5 : −161)   default
BMR (Katch-McArdle)       = 370 + 21.6·LBM(kg, cm, sex)                    if BMR_FORMULA=katch

daysOnDiet(atDate)        = atDate − date of the first logged weigh-in, days, floored at 0
λt(atDate)                = min(BMR_ADAPT_PCT_PER_WEEK/100 × daysOnDiet(atDate)/7,
                                 BMR_ADAPT_PCT_CAP/100)
BMR_adp(atDate)           = BMR × (1 − λt(atDate))
applyBmrBasis(BMR,atDate) = BMR_adp(atDate)  if BMR_BASIS=bmr_adp, else BMR unchanged

activityTargetKcal(kg)    = metKcal(ACTIVITY_MET, kg, ACTIVITY_TARGET_MIN)
getActivityTargetKcal(kg) = ACTIVITY_TARGET_FIXED_KCAL, if set, else activityTargetKcal(kg)
getActivityTargetMin(kg)  = ACTIVITY_TARGET_FIXED_KCAL / metKcal(ACTIVITY_MET, kg, 1), if set and kg known
                          = ACTIVITY_TARGET_MIN                                        otherwise
```

**Calorie target** — one number per day, directional rather than a point to land on (a ceiling heading down, a floor heading up):

```
rawD   = (WEEKLY_FAT_LOSS_KG × 7700) / 7
η      = 1 − (SLEEP_DEPRIVATION_PCT_PER_HOUR/100) × max(0, SLEEP_TARGET_HOURS − PLAN_SLEEP_HOURS)
D      = rawD > 0 ? rawD / max(η, 0.2) : rawD        bigger deficit needed if sleep is short
target = round( (BMR + activityTargetKcal − D) / (1 − f) )
```

- `PLAN_SLEEP_HOURS` defaults to `SLEEP_TARGET_HOURS` itself — `η = 1`, `D = rawD`, byte-identical to the target this app always produced. See the [Formula Playground](features.md#health--formula-playground)'s `s`/`γ`/`δ` fields for where it's tuned.
- Falls back to flat `CALORIE_TARGET_KCAL` if height / age / sex / `WEEKLY_FAT_LOSS_KG` is missing. Age only when the BMR equation in force reads it (`bmrNeedsAge`) — Katch-McArdle doesn't.
- `f` is `TEF_PERCENT_OF_INTAKE / 100`, default **0**, in which case this is exactly the sum it has always been. See the [Formula Playground](features.md#health--formula-playground) for why digestion divides rather than adds.
- **Today's** figure is evaluated at the 7-day rolling average body mass (`planBodyMassKg`), not the last single reading — so a water-heavy morning doesn't move the day's ceiling. The per-day chart line still re-evaluates from that day's carried-forward body mass.
- Moves ≈ 15.8 kcal per kg, so a 6 kg loss shifts it by roughly 95 kcal.
- **`CALORIE_TARGET_FIXED_KCAL` pins it.** Set (via the Formula Playground's **Pin target daily intake**, or by hand) and that one number wins everywhere — today's tile, the per-day chart line and the forecast's E_in — instead of being recalculated from each weigh-in. Blank means the tracking behaviour above, unchanged; it's a separate key from `CALORIE_TARGET_KCAL` precisely so an existing sheet's stale fallback can't silently start overriding the calculated figure.
- The two are genuinely different plans, which is worth knowing before choosing: **tracking** re-cuts intake as you lighten, holding `WEEKLY_FAT_LOSS_KG` roughly steady (a straight line to the goal); **pinned** holds intake still, so the deficit shrinks as maintenance falls and loss decelerates. The forecast below has always modelled the pinned one — it solves `dm/dt` at a constant E_in — so pinning is also what makes the target you eat and the date you're shown the same plan. On a 94 → 82 kg example at 0.5 kg/week, tracking arrives in ~168 days and pinned in ~207.
- Max when target < current, min when target > current; otherwise the sign of `WEEKLY_FAT_LOSS_KG` decides.
- **Nothing clamps `WEEKLY_FAT_LOSS_KG`**, but it is judged: `weeklyFatLossPct` expresses it as `100 × Δm / m`, and both the Formula Playground's `Δm%` box and the Health Plan prompt hold it against the `WEEKLY_FAT_LOSS_PCT_FLOOR`/`_CEILING` pair (0.5 and 1% of body mass per week). Above the ceiling the playground colours the verdict; it still computes and still saves.
- **`WEEKLY_FAT_LOSS_PCT` replaces the rate rather than scaling it.** Set (via the playground's **Pin target fat-loss %**, or by hand) and `weeklyFatLossKgAt` recomputes the kilograms from whichever body mass the target is being evaluated at — so the figure above becomes `(p·m/100 × 7700) / 7` and moves with every weigh-in, per day on the chart. Blank means the flat `WEEKLY_FAT_LOSS_KG` behaviour, unchanged. It's mutually exclusive with `CALORIE_TARGET_FIXED_KCAL`: pinning either blanks the other.
- Uses the raw, pin-blind `activityTargetKcal` — same as the Formula Playground's own live preview — so a pinned activity calorie-burn target (below) doesn't move today's calorie-intake figure; that's a deliberately separate dial.
- **`ACTIVITY_TARGET_FIXED_KCAL` pins the activity target itself** the same way `CALORIE_TARGET_FIXED_KCAL` pins intake (via the Formula Playground's **Pin target calorie burn**, or by hand): the Activity tile, the Physical Activity chart's target line/dot colour, and Activity Insight's stated target all switch from `activityTargetKcal`/flat `ACTIVITY_TARGET_MIN` to `getActivityTargetKcal`/`getActivityTargetMin`, so the calorie burn stays put and the minutes needed rise as body mass falls, instead of the reverse.

## Calorie Balance (per day)

```
maintenance = BMR(that day's carried-forward body mass, height, age, sex)
TEF         = f × intake                                    that day's logged intake
rawBalance  = intake − maintenance − activityKcal(that day) − TEF
deprivation = |rawBalance| × (1 − η(that day's logged sleep, SLEEP_TARGET_HOURS))
balance     = rawBalance + deprivation      always toward positive — shrinks a deficit,
                                             grows a surplus
expected g  = (balance / 7700) × 1000
```

- A day with no food logged is a gap, not a day of eating nothing.
- The `TEF` term is a share of what was **actually eaten**, not of the target — this row scores the day that happened. At the default `f = 0` it's absent from the arithmetic and from the tooltip; it exists so that switching digestion on can't raise the target intake in one chart without also raising the cost of eating it here. The target dash is drawn at the smoothed body mass, like every other plan-level figure.
- **Measured wins over estimated.** `TEF = f × intake` is the fallback — whenever a day's Physique row has its own TEF column calculated (see [`Physique`](data-model.md#physique)), that figure is used instead, and the tooltip's Digestion row says which one produced the bar (`measured` vs. `est.`). State Trend & Forecast's gray Calorie-Implied Trajectory line gives the same day the same precedence, so the two charts can't disagree about which TEF a given day used.
- **`deprivation` is zero without that day's own sleep logged** — no basis to apply `η` to, not assumed perfect. The tooltip's `Sleep Deprivation Effect` line only appears when it's nonzero, right before `Expected Fat`/the `Actual Deficit`/`Actual Surplus` figure it feeds. This is the *reverse* question from the calorie-target `D` above (`sleepDeprivationKcal` vs. `sleepAdjustedDeficitKcal`, both `wellness-math.js`) — "how much did last night cost the balance that actually happened" rather than "how much bigger does the planned deficit need to be" — so it multiplies by `(1 − η)` instead of dividing by `η`.

## 7-day dash (all nine scored Health Indicator charts)

```
bucket(i)  = floor((columnCount − 1 − i) / 7)      counted back from today

flat       = mean of that bucket's LOGGED days     unlogged days sit out
sloped     = least-squares fit over that bucket's (columnIndex, kg) pairs,
             evaluated at all 7 columns            Body Mass only, ≥2 readings
```

- **Today sits out of the weekly maths entirely** (`bucketedColumnCount`). It's a day in progress — the food logged by 10am, the steps walked so far — so averaging it in drags the current week down by an amount that shrinks as the day goes on, reporting "this week" as worse than it is. Today's column gets **no dash at all** rather than one drawn from a partial day.
  - So `count` above is the window minus that trailing column, and the buckets run back from **yesterday**. Today's bucket index is `-1`, which reads as "belongs to no week" everywhere: `buckets.get(-1)` is undefined, so the average is null, and the dash-joining test refuses to connect a segment to it.
  - Only when the window actually **ends today**. A window ending on a past date has no partial column and keeps all of them.
  - The arithmetic follows from that: a 28-day window ending today leaves 27 bucketed days — three full weeks plus a 6-day oldest one, since only the oldest bucket may come up short. Four full weeks plus today needs a 29-day window.

- Drawn as a line whose bucket-crossing segments are transparent, so each week is one dash rather than a stepped line with risers.
- Body Mass folds the fitted endpoints into its kg bounds before padding — a fit extended to the week edges can reach past every reading in it, and the fat-energy twin axis is derived from those same bounds.
- Sleep averages bed/wake in *noon-anchored axis units*, not clock minutes — the shift has already unwrapped midnight, so 23:30 and 00:30 average to midnight rather than midday.

## State Trend & Forecast

**Glycogen + water swing** (`ΔM_gly`) — computed first, since both the trend zone and the target-based forecast below read it:

```
m_musc = s × LBM(m̄, h, sex)                        s = GLYCOGEN_SKELETAL_FRAC_DEFAULT
m_gly  = g_musc × m_musc + g_liver                  per-kg-muscle and liver constants above
ΔM_gly = m_gly × (1 + r) / 1000                     r = GLYCOGEN_WATER_RATIO_DEFAULT, → kg
```

- `glycogenSwingKg` (`charts.js`) — the day-to-day swing glycogen and its bound water alone can account for, at this body. Same identity the Formula Playground's glycogen block walks through (`readGlycogenSwingFormula`), evaluated at its default knobs rather than whatever's currently typed there, so a reader who never opens that modal still gets the figure it would report for their own body. `null` without `HEIGHT_CM`/`SEX` on file, which the zone and the swing-adjusted arrival below both fall back around.
- **Trend zone** — a transparent band drawn at `trend(t) ± ΔM_gly`, centred not on the trend line itself but on an EMA of it (`computeGlycogenZoneAnchor`, `α = GLYCOGEN_ZONE_SMOOTHING_ALPHA`) — deliberately smoother/slower-moving than the trend, so the zone reads as the stable reference and the trend as what moves inside it.
  - **State Trend & Forecast's own chart** (`wellnessProjectionChart`) draws this yellow band anchored to that day's gray Calorie-Implied Trajectory instead — `[anchor − ΔM_gly, anchor]`, unshifted at the top so the band's own upper edge draws exactly on the gray line — then shades the gap **red** wherever the green trend line drops below the band's floor: glycogen and water alone don't explain a drop that size, so past the floor reads as a real loss, not the zone's own normal noise. A second, near-invisible dataset (`Muscle Loss (below swing zone)`, `renderWellnessProjectionChart`) sits flush on the floor whenever the trend is inside or above it, and only opens up — filling red down to the trend's own value — for the stretch it's genuinely below.
- **Arrival target** — `arrivalTargetKg(target, m̄, h, sex, isDownward) = target ∓ ΔM_gly`, past the raw target by the swing **in the direction travel is already headed** (cutting subtracts, bulking adds) — so a reading on a high-water day still can't land on the wrong side of the real target. This is what `target` means everywhere below; the progress meter's raw kg-to-go bar and the drawn target line still use the unadjusted figure, shown alongside its `± ΔM_gly`.

**Target-based** — the primary path, whenever `HEIGHT_CM`, `BIRTH_DATE` and `SEX` are on file. It projects the target being *followed*.

```
E_in    = BMR + E_act(target) − D                    calculated target at m̄
A      = 6.25·cm − 5·age + (male ? +5 : −161)    mass-independent part of maintenance
B      = 10 + MET·τ·κ/ε                          per-kg part, kcal/day/kg
m∞     = (E_in − A) / B                           where that intake IS maintenance
m(t)   = m∞ + (m̄ − m∞)·e^(−B·t/ρ)                every 7 days, capped at 365
t      = (ρ / B) · ln[ (m̄ − m∞) / (target∓ΔM_gly − m∞) ]
```

- `D` here is `calorieTargetDetail`'s own sleep-adjusted deficit (see the Calorie target formula above) — `E_in` already reflects `PLAN_SLEEP_HOURS`, so a plan that assumes chronic short sleep forecasts a slower arrival than the same `WEEKLY_FAT_LOSS_KG` would without it, at the default `PLAN_SLEEP_HOURS = SLEEP_TARGET_HOURS` this is exactly the pre-existing figure.
- `t` is the exact closed-form solution of `dm/dt = (E_in − A − B·m) / ρ`, verified against numeric integration.
- Maintenance is affine in body mass, so the trajectory is exponential decay, not a straight line.
- **`m̄` (`planBodyMassKg`), not the last raw weigh-in** — the same smoothed mass the Formula Playground's own boxes run on, so the two start the curve from the same point.
- `calcProjection` (`wellness-math.js`) reads `t`, its `status` and `equilibriumKg` **directly off `targetProjectionFromSettings`'s own return** — the exact `projectTargetDays` / `projectTargetDaysAtFixedPct` call the Formula Playground makes — rather than a second copy of this formula. The chart and the playground read one function, so they cannot print two different day counts for the same profile.
- **With `WEEKLY_FAT_LOSS_PCT` pinned it's a different journey**, and `projectTargetDaysAtFixedPct` is the one that runs. A constant share of a falling mass is `dm/dt = −k·m`, `k = −ln(1 − p/100)/7` per day:

```
m(t) = m · (1 − p/100)^(t/7)      no plateau — m∞ = 0
t    = 7 · ln(m / m_des) / −ln(1 − p/100)
```

  - Returned in `projectTargetDays`' own shape with `equilibriumKg: 0`, because both journeys are the same exponential with different coefficients — one curve-drawing routine serves both. The coefficient it hands back is `decayPerKg` (`k·ρ` here, `B` there): the chart reads that rather than `B`, since `B` is only the right rate for the constant-intake journey.
  - **The only plan with no plateau to fall short of** — a constant fraction of a falling mass crosses any positive target eventually, so this journey has no `asymptote` case. Its `unreachable` means the target isn't below the current mass, and it carries a `reason` string rather than an equilibrium figure to describe.
  - `targetJourneyProjection` picks between the two from the pins, and the chart, the Health Plan prompt and the playground's forward `t` all go through it (`pct > 0` only — a pinned zero or negative rate falls back to the constant-E_in form, which reports a hold or a gain properly).
  - Verified: 86.9 → 82 kg at 1%/week is 40 days, the chart's own day count agrees to the day, and its weekly curve points step down by exactly 1% of the running mass.
- Worked example (87.5 → 72 kg, 170 cm, 35 y, male, κ=3, τ=100, 0.84 kg/wk): `BMR 1768`, `E_act 459`, `D 924`, `E_in 1303`, `A 893`, `B 15.25`, `m∞ 26.9 kg`, `t 149 days`.

> **What this forecast is not:**
> - It states the target, not recent behaviour.
> - Eating over the target does **not** slip the date — only body mass, the target, or the target's own settings move it.
> - **Sleep enters it only as a plan-level assumption** (`PLAN_SLEEP_HOURS`, folded into `D` above), never as a night-by-night reading — a run of short nights doesn't move this curve the way it moves Calorie Balance or the Sleep chart's own dot.
> - Actual-vs-target lives on the Calorie Balance chart instead.

**Habit-based fallback** — only when the profile is incomplete and something is logged in the last 14 days:

```
maintenance = flat calorie target + avgActivityKcal
balance     = avgCalories − maintenance
baseSlope   = balance / 7700
sleepRatio  = clamp(avgSleep / SLEEP_TARGET_HOURS, 0.7, 1.0)
slope       = baseSlope × sleepRatio
```

**Body-mass-only fallback** — nothing logged at all; ordinary least-squares slope.

- Statuses: `reached`, `no-change`, `wrong-direction`, and `asymptote` (target lies past `m∞`).
- The slope is reported for all four, so the status line quotes a rate rather than "unavailable".

> **Known inconsistency**, confined to this fallback:
> - The regression is fitted against the *index* of each reading, so its units are kg per logged entry.
> - Its consumers treat it as kg per day. They agree only if you log daily.
> - Unreachable on the target-based path, which never uses it.

**Progress meters** (rendered above the chart heading):

```
bar %       = clamp( (startBodyMass − lastBodyMass) / (startBodyMass − target) × 100, 0, 100 )
done kg     = |startBodyMass − lastBodyMass|
to-go kg    = |lastBodyMass − target|                unadjusted target — the raw distance
target text = target [± ΔM_gly]                      swing shown alongside, not folded into the kg above
time bar %  = daysElapsed / (daysElapsed + daysToTarget) × 100     daysToTarget is t, so already swing-adjusted
```

## Fat energy — the Body Mass chart's second axis

```
bodyFat%   = clamp(Deurenberg(BMI, age, sex), 3, 60)
fatMass    = kg × bodyFat%/100
fatEnergy  = fatMass × 7700
```

- One clamp, one chain — tooltip, fat mass, energy row and axis can't disagree.
- A population-average estimate, not a measurement; nothing here observes body composition directly.
- Fat energy is quadratic in body mass while a twin axis can only be linear, so the axis is anchored at both ends of the kg range (<0.5 % error on a typical window).
- This is why 1 kg isn't worth 7,700 kcal: at ~90 kg / 175 cm only ~61 % of a kg is fat, so the tooltip reads ≈ 4,685 kcal/kg.

## Protein

```
band (g/day) = { PROTEIN_TARGET_G_MIN, PROTEIN_TARGET_G_MAX }          ← if either is set
   else       = { round(basisKg × gPerKg.low), round(basisKg × gPerKg.high) }
   basisKg    = BODY_MASS_TARGET_KG, else the latest logged body mass
   fallback   = flat PROTEIN_TARGET_G as a zero-width band
midpoint     = round((min + max) / 2)
in band?     = g ≥ min AND (max == min OR g ≤ max)
protein/100kcal = protein / calories × 100
```

- Three sources, most specific first. The **absolute gram band wins**: it is already a mass × a per-kg figure (the playground's `p × LBM`), so re-scaling it by a basis mass would double-count. The g/kg band is next, and the flat `PROTEIN_TARGET_G` last.
- Absolute grams don't drift as you diet — which is what the g/kg band needs `BODY_MASS_TARGET_KG` for. A gram figure is frozen at the lean mass it was computed from and only moves when you re-save the playground.
- Written by the [Formula Playground](features.md#health--formula-playground) as `p_min/p_max × LBM`, which is the only place in the app that scales anything to **lean** mass rather than total mass. Set the pair by hand on the `Setting` tab and it behaves the same; either end alone is enough, and a backwards pair is sorted.

**Protein Source Rotation**, per tracked ingredient:

```
targetG   = (Protein% / 100) × dailyMidpoint × lookbackDays
actualG   = Σ protein of every Calculate breakdown item with that name in range
% of total target = actualG / (dailyMidpoint × lookbackDays) × 100
sort key  = classification group gap, then targetG − actualG within it, both descending
```

- Group colour: one hue per classification, lightness stepped `62 − (n mod 4)×9` within it.
- Donut rings: each source's share of `Σ actualG` over the 28 and 7 days ending on the To date.

## Today at a Glance

- Card order: Status (m̄/BMR/TEI/TEF/AEE/SD/D/Δm/t — today's whole energy budget, read top to bottom), Intake Macros (Protein/Fiber/Fat/Carb), Physical Activity (Cardio/NEAT/Strength), Sleep (Duration/Window).
- Sums today's entries per category; Fiber/Fat/Carb each read the day's own persisted Physique figure (`fiberG`/`fatG`/`carbG`).
- Green/red by `withinCalorieTarget` (TEI), `withinProteinBand`/`withinFiberBand`/`withinFatBand`/`withinCarbBand` (macros), `kcal ≥ getActivityTargetKcal(latest body mass)` (AEE), and (Status) which side of `BODY_MASS_TARGET_KG`/the balance target `bodyMassTargetIsDownward`/`targetBalanceKcal` call for (m̄ and D).
- Carb's under-band case reads grey, not red — same as its chart's bar coloring.
- Status's **AEE** sums `activityEntryKcal` per entry rather than just the logged minutes, so it agrees with the Activity/Calorie Balance charts. Physical Activity's Cardio/NEAT/Strength split that same set of entries by the `Activity` sheet's Category column (prefix-matched), each unscored (`N min (-N kcal)`, `0 min (0 kcal)` rather than `—` for a bucket with nothing logged — that's a real zero, not a missing reading).
- Status is the per-day form of `dailyEnergyBalanceKcal` (`setStatusEnergyTile`): **BMR** is Mifflin at the smoothed mass; **TEI** is intake vs. the calorie target with a `<`/`>` per the target kind; **TEF** is `calTarget.kcal × (1 − tefDivisor())`; **SD** is the sleep-deprivation effect vs. `0`; **D** is intake − BMR − AEE − TEF (+SD) against `targetBalanceKcal(planBodyMassKg(entries))`, the same arithmetic the Calorie Balance chart plots for one day; **m̄** is `planBodyMassKg` vs. `BODY_MASS_TARGET_KG`; **Δm** is `D ÷ GENERIC_KCAL_PER_KG_FAT` against `-weeklyFatLossKgAt ÷ 7` — negated the same way `targetBalanceKcal` negates it for D, so a positive (cut) `WEEKLY_FAT_LOSS_KG` reads as a negative target mass change, matching Δm's own actual-value sign convention (negative = losing); **t** is `calcProjection`'s day count and ETA — "Reached" once there, `—` when no projection can be drawn.
- Sleep's Duration is colored by `sleepStatusColor` (the chart's own red→amber→green gradient), not a flat two-colour split; Window is `sleepBedMin`-`sleepWakeMin` as one `HH:MM-HH:MM` range.

## Sleep

```
axis position (hours) = ((clockMin − 12·60) + 1440) mod 1440 / 60
colour ratio          = clamp( (durationHr − target/2) / (target − target/2), 0, 1 )
                        red → amber below 0.5, amber → green above

axis min = floor(earliest / 3) × 3      the 3h tick at or below the earliest bedtime
axis max = ceil(latest / 3) × 3         the 3h tick at or above the latest wake
           ±3 only when an extreme lands exactly ON a tick
```

- Noon-anchored, not 18:00-anchored: an assumed bedtime broke on a night shift, while noon falls mid-waking-period for virtually any schedule.
- The `±3` used to be unconditional, which cost up to 6 hours of empty axis — a 23:00 bedtime floors to 21:00 and was then padded down to 18:00. It's now applied only where a bar would otherwise sit flush against the axis edge.

## Workout logging (Activity Plan → Calculate)

Active time only — rest, warm-up and moving between machines are real gym time but aren't activity.

```
strength row  activeSec = sets × reps × WORKOUT_REP_SEC
hold row      activeSec = sets × holdSec        (already seconds; no per-rep tempo)
NEAT steps    activeSec = (steps / WORKOUT_STEPS_PER_MIN) × 60
cardio min    activeSec = minutes × 60

minutes  = max(1, round(Σ activeSec / 60))
calories = Σ metKcal( MET(exercise) ?? 3.5, bodyMassKg, activeSecᵢ / 60 )
```

- `activeSecondsForNoteLine` (`activity-estimator.js`) is the single place this is decided — Log's prefill and Calculate both read it.
- **Only the two converted units are tunable**, both from `Setting`: `WORKOUT_REP_SEC` (default `3`, a brisk tempo — a controlled machine rep is nearer 4-5 s) and `WORKOUT_STEPS_PER_MIN` (default `100`). A hold carries its own seconds and a cardio row its own minutes, so neither has anything to set. The tempo is global, not per exercise — the whole session moves together when you change it. `WORKOUT_STEPS_PER_MIN` also rescales the Activity chart and target, since both convert steps the same way.
- Note parsing: `30x Name` → 30 total reps; legacy `3x10 Name` → 30; `135sec`, `30min`, `6000step`.
- A second Log the same day appends its new lines to today's entry rather than opening a new row.

## Food logging (Calculate)

Precedence: your own `Nutrition` row (by **count** first, then by **weight**) → USDA → the model's estimate.

```
by count   kcalPerUnit = row.calories / row.count
           itemKcal    = kcalPerUnit × count

by weight  kcalPer100g = row.calories / row.grams × 100
           itemKcal    = kcalPer100g × grams / 100

energy-anchored ("300kcal cookie") — the same sources read backwards:
           grams = energyKcal / kcalPer100g × 100        (weight wins here)
           count = energyKcal / kcalPerUnit              (only if the row has no gram figure)

protein-anchored ("20p chicken") — same backwards read, off protein density:
           grams = proteinG / proteinPer100g × 100        (weight wins here)
           count = proteinG / proteinPerUnit              (only if the row has no gram figure)

divided ("200/5g bar") — resolved before any of the above runs:
           quantity = numerator / denominator, glued back onto the same unit
```

- Count wins normally: an exact count beats an estimated gram mass.
- Weight wins on an anchored path (energy or protein): "300kcal cookie" and "20p chicken" are both most useful as a number to put on the scale.
- A new row is always banked per 100 g, whatever unit that mention used.
- **A division in the quantity** (`200/5g`, `1/2cup`, …) is resolved arithmetically — `resolveDivisionQuantities`, `calorie-estimator.js` — before Groq or the Nutrition table ever see the text, rather than trusting the model to divide (not guaranteed reproducible run to run). It resolves in whatever unit it was typed in, so a weight or volume unit still gets its normal density handling (table hit, USDA, or AI estimate) afterward. A `2-3` range is left untouched — that's uncertainty, not arithmetic.
- **`p` is a protein anchor**, the protein-flavoured twin of the kcal anchor: `20p chicken` means 20 g of protein were eaten, not 20 g of chicken. Either anchor rewrites Consumption with the real weight/count Calculate worked out — `20p chicken` → `74g chicken`, same as `300kcal cookie` resolving to a gram figure.
- **Multiple macro anchors can share one line** — `100kcal 5p 4fiber 5fat 8carb homemade energy bar` (`pro`/`df`/`carbs` also parse, as aliases). Each anchor is applied **exactly as typed** as this line's true figure, whatever branch above priced the weight — unlike the single-anchor case, energy and protein no longer have to be mutually exclusive, and fiber/fat/carb ride alongside either. Only energy (falling back to the estimator's own gram guess) ever drives the derived weight; the others never fight over it. Whichever of the five you leave out still gets filled from USDA when a plausible match exists — same "fill the gaps, never override what you typed" rule USDA already follows for calories/protein — and a fresh miss banks whatever it found (typed or looked-up) into the new Nutrition row's own Fiber/Fat/Carb columns, per-100g, alongside Calories/Protein (`stripLeadingIngredientTokens`, `calorie-estimator.js`).
- **✏️ next to 💾** on an estimated (non-table) breakdown row opens the same Add/Edit Ingredient modal Nutrition's own **Add** uses, prefilled with that row's guess (name, amount, Calories/Protein/Fiber/Fat/Carb). Save both banks the corrected row — same as 💾 would — **and** rescales the correction onto today's own line (by the saved Amount vs. what this line actually logged) and re-renders the breakdown/total in place, instead of only fixing the Nutrition table for next time (`makeEditNewRowButton`/`applyEditedRowToBreakdown`, `calorie-estimator.js`; the modal's `openNutritionForm` takes an optional one-shot `onSaved` callback for this).

---

