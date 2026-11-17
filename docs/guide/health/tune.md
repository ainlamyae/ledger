# Health — Tune

[Docs](../../README.md) › Guide › Health

Tune is the plan's worksheet: it sets every desired figure the Health pages use and shows the arithmetic behind each one.

## At a glance

- **Address:** `/health/tune/`; it reloads its boxes from the sheet every time it opens.
- **Four cards:** Plan Choices, Variables, Equations and Calculations.
- **Live preview:** typing changes nothing in the app until 💾 Save writes the plan to the Setting tab.
- **One plan everywhere:** Today, Chart, Physique and Insight's Plan mode read the same saved figures through the same functions.
- **Calibrated BMR:** BMR_cal is measured from your own logged history, over n_p periods of L_p days ending yesterday.

## What it shows

- **Plan Choices:** the five decisions that shape the plan.

| Question | Options |
|---|---|
| Solve for | Calories, Healthy body mass, Activity, Weekly fat loss (default), Weekly fat loss % |
| Lean body mass | Boer (m, h, σ) (default), U.S. Navy (C_neck, C_waist, C_hip, h, σ) |
| Basal metabolic rate | Mifflin-St Jeor (default), Katch-McArdle, BMR_cal (calibrated), BMR_adp (adapted), BMR_avg (average) |
| Which stays fixed as you lose body mass | Pin desired deficit/fat loss (default), Pin desired daily intake, Pin desired fat-loss % |
| Which stays fixed on the desired activity | Pin desired activity time (default), Pin desired calorie burn |

- **Variables:** one row per symbol (symbol, name, box, unit), in the order the algebra runs.

| Block | Rows |
|---|---|
| Profile | σ, h, a, C_neck, C_waist, C_hip, m, L_p, m̄, m_des, BMI_des |
| Body shape | WHtR, WHR, BRI, BF%, LBM_navy, LBM_boer |
| BMR | BMR_mif, BMR_kat, n_p, BMR_cal, λ, λt_max, BMR_adp, m∞_adp, BMR_avg |
| Activity | τ, MET, κ, ε (200), AEE |
| Sleep | s, γ, SD |
| Rate | Δm%, Δm, ρ (7700), D |
| Intake | f, TEF, M, TEI, D_bmr% |
| Journey | t, estimated arrival date |
| Glycogen | s, m_musc, g_musc, g_liver, m_gly, r, ΔM_gly |
| Macro bands | p_min/p_max → P_min/P_max; b_min/b_max → F_min/F_max; k_min/k_max → G_min/G_max; q_min/q_max → C_min/C_max |

- **Equations:** the model's full list of equations, the same text Insight's Plan mode sends to the AI.
- **Calculations:** every equation with your numbers substituted, plus BMR_cal's **Periods** table.
  - **Periods columns:** Period, m, Δm, ΔM (kcal), D, Offset, Weight (recency: 0.1 oldest to 1.0 newest).

## Actions

- **Type any editable box:** the rest recompute at once; read-only boxes are derived.
- **Unit pairs:** type either box and the other follows: Δm% ↔ Δm, m_des ↔ BMI_des, t ↔ arrival date.
- **Solve for:** the chosen quantity becomes the answer and its box turns read-only.
  - **Activity and Weekly fat loss:** type either TEI or t; the one you didn't type is computed.
  - **Weekly fat loss %:** Δm% is the input, and picking it also ticks **Pin desired fat-loss %**.
- **Type m or m̄:** a what-if body mass; a typed m is copied into m̄, which every formula uses.
- **Type L_p:** re-averages m̄, τ, s and f over the new window.
- **♻️ Reset:** reloads every box from the sheet.
- **🔄 Update:** saves n_p and L_p, then recomputes every Physique day's stored BMR figures and m̄, after a confirm.
- **💾 Save:** writes the plan to the Setting tab and redraws the app; a toast lists what was saved.
- **❌ Close:** leaves without saving.

## Rules & calculations

- **m̄:** the mean of body-mass readings over the L_p days ending at the newest reading before today.
- **Seeded from history:** τ, s and f open on your L_p-day logged averages ending yesterday, else on their defaults.
- **MET:** read from the Walk row of the Activity tab; the box is a what-if only and Save doesn't write it.
- **Intake:** TEI = (BMR + AEE − D) ÷ (1 − f), since TEF is a share of the intake being solved for.
- **Sleep:** sleeping s hours, short of the desired sleep, needs a bigger deficit for the same fat loss (γ % per hour short).
- **Pins:**
  - **Deficit:** holds kg per week; the intake falls as you get lighter.
  - **Daily intake:** holds TEI; the deficit shrinks and loss slows.
  - **Fat-loss %:** holds a share of body mass; the gentlest journey, and the only one with no plateau.
- **BMR_cal:** the active equation plus a measured offset (D − ΔM per period, recency-weighted).
  - Kept within 10 % of BMR_mif, BMR_kat and BMR_adp, so a thin window can't swing it.
  - Before a full period is logged, it is the average of the other BMRs.
- **BMR_adp:** BMR × (1 − λt), metabolic adaptation growing about 1 % per week up to a ceiling.
- **Red boxes:** a warning only; they never block Save.

| Box | Red when |
|---|---|
| BMI_des | Outside 20–25 |
| Δm% | Above 1 %/week |
| D_bmr% | Above 20 % |
| C_waist | 102 cm or more (men), 88 cm or more (women) |
| WHtR | 0.5 or more |
| WHR | 0.90 or more (men), 0.85 or more (women) |
| BF% | Above 25 % (men), 32 % (women) |

- **Defaults:**

| Setting | Default |
|---|---|
| n_p × L_p | 4 × 7 days |
| γ | 3 %/hr |
| f | 13.5 % of TEI |
| λ, λt_max | 1 %/week, 12 % |
| p_min, p_max | 1.8, 2.2 g/kg LBM |
| b_min, b_max | 17 g/1,000 kcal, 0.5 g/kg |
| k_min, k_max (fat) | 20 %, 35 % of TEI |
| q_min, q_max (carbohydrate) | 30 %, 50 % of TEI |

- **New user:** with no settings or readings, Tune opens on male, 170 cm, 35 years, m 78.9 kg, m̄ 79 kg.
- **Formulas:** see [Health formulas](../../reference/health-formulas.md).

## Data

- **Setting tab (written by Save):**
  - the profile girths, healthy body mass, weekly fat loss and the active pin;
  - the BMR and lean-mass choices, adaptation, sleep and TEF settings;
  - each macro band's grams and the rule behind them, plus `GLYCOGEN_SWING_KG`;
  - each band's minimum, copied into `MICRONUTRIENT_DAILY_DESIRED_JSON`.
- **Physique tab:** body-mass history; 🔄 Update rewrites each day's Derived cell.
- **Keys in full:** see [Configuration](../../development/configuration.md) and [Data model](../../reference/data-model.md).

## Code

| File | Role |
|---|---|
| `assets/script/health-tune.js` | Opens, seeds and saves Tune (`openFormulaPlayground`, `saveFormulaSettings`) |
| `assets/script/health-tune-fields.js` | Field list, defaults and the Equations text |
| `assets/script/health-tune-render.js` | Live preview and the Calculations trace |
| `assets/script/health-tune-calibration.js` | BMR_cal and the Periods table |
| `assets/script/health-math.js` | The shared plan maths |

## Related

- [Today](today.md) and [Chart](chart.md): where the plan's figures show.
- [Insight](insight.md): the Plan mode sends this plan to the AI.
- [Health formulas](../../reference/health-formulas.md): every equation and constant.
