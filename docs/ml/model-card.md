# Model Card — Dengue Surge Risk Classifier

**Model family:** LightGBM, two independent binary classifiers —
`model_h2` (2-week horizon) and `model_h4` (4-week horizon).
**Target:** "≥30% week-over-week case surge" (`SURGE_TARGET_THRESHOLD`, §14).

## Intended use

Populate `risk_predictions` for every tracked region, twice per batch run
(one row per horizon), so the public risk map, dashboards, and proximity
alert pipeline can surface an early warning 2–4 weeks before a dengue case
surge, using weather and historical case data already available to the
system. The model is a **decision-support signal**, not a diagnostic tool
and not a replacement for public-health surveillance — it flags regions
worth closer attention.

## Out-of-scope use

- **Not** a per-individual diagnostic or symptom-triage tool — that logic
  is a separate, deterministic rule engine (ADR-004) that never calls this
  model or any LLM.
- **Not** intended for regions with no historical `dengue_cases` /
  `weather_observations` coverage — predictions for such regions are not
  produced; there is no "no-data" placeholder score.
- **Not** validated for use outside the geographic/climatic context it was
  trained on — the favorable-breeding feature thresholds (§5.1) assume a
  tropical/subtropical climate consistent with dengue-endemic regions.

## 5.1 Feature specification

| Feature | Definition | Window |
|---|---|---|
| `temp_mean_roll` | rolling mean of `temp_mean_c` | 7 / 14 / 28 day |
| `temp_min_roll` | rolling mean of `temp_min_c` | 14 day |
| `humidity_roll` | rolling mean of `humidity_pct` | 14 day |
| `precip_cum` | cumulative `precipitation_mm` | 14 day |
| `case_lag_1/2/3` | `case_count` at t-1, t-2, t-3 weeks | weekly |
| `favorable_breeding_flag` | boolean: `temp_mean_roll ≥ 27 AND temp_min_roll ≥ 22 AND humidity_roll ≥ 80` | derived |
| `seasonality_sin/cos` | sin/cos encoding of ISO week-of-year | static |
| `population_density` | region population / area | static |

Full per-feature computation detail (source table, null handling, leakage
risk) lives in `docs/ml/feature-engineering.md`.

## 5.2 Algorithm details

- **Algorithm:** LightGBM, two independent binary classifiers —
  `model_h2` and `model_h4`. Each is trained separately rather than as a
  single multi-horizon model, so a horizon's training data and validation
  window never leaks information about the other horizon's label.
- **Target definition:** binary label = 1 if the region's case count grows
  by ≥30% week-over-week (`SURGE_TARGET_THRESHOLD`) within the model's
  horizon, else 0. Threshold is configurable in `ml/training/config.py`,
  not hardcoded in training code.
- **Validation methodology — walk-forward (expanding window) time-series
  CV.** Each fold trains on all data up to a cutoff week and validates on
  the immediately following weeks, then the cutoff advances. **Random
  shuffling is forbidden** for this problem: dengue surges are
  autocorrelated in time (a surge this week is highly informative about
  next week), so a randomly shuffled train/validation split would leak
  future information into training, producing an optimistic validation
  score that does not hold up in real deployment where the model only ever
  sees the past.

## Promotion gate

**Recall ≥ 0.85, Precision ≥ 0.60** on the held-out walk-forward window
(`MIN_RECALL_TARGET` / `MIN_PRECISION_TARGET`, §14), enforced by
`ml/evaluation/backtest.py` before a retrained model is promoted.

**Rationale:** missing an outbreak (a false negative) costs more than a
false alarm (a false positive). A missed surge means no early warning
reaches the public, health workers, or the alert-subscription pipeline
until case counts have already visibly spiked — by which point the
2–4 week head start this system exists to provide is gone. A false alarm,
by contrast, costs an unnecessary "elevated risk" notification. The
asymmetry justifies biasing the gate toward recall over precision, while
still requiring precision ≥ 0.60 so the map doesn't become "always red"
and lose the public's trust in the signal.

## Explainability

SHAP values are computed at inference time; the top 3 contributing
features per prediction are stored in `risk_predictions.top_factors`
(`jsonb`) as an array of structured objects `[{"factor": string, "label": string, "importance": number}]`
(`TopFactors` in `packages/types/ml.ts`) and rendered in the UI, e.g.:
*"high risk mainly due to: 14-day humidity 86%, rising case trend, favorable breeding temperature window."*
This lets a viewer understand *why* a region is flagged, not just that it
is.

## Export & Distribution

`skl2onnx`/`onnxmltools` → **ONNX opset 17**. Model artifact versioned as
`model_v{semver}.onnx`, target size budget **< 2 MB**
(`ONNX_MODEL_SIZE_BUDGET`, §14; quantized if needed) so it can ship inside
the PWA's offline cache for on-device inference (§5.3, ADR-002).

Model artifacts and checkpoints are hosted on the public **Hugging Face Model Hub**
(`avash-health/avash-dengue-models`) and datasets on the **Hugging Face Dataset Hub**
(`avash-health/avash-dengue-dataset`). Zero binary weights are stored in the GitHub repository.
The exported artifact is checksum-verified (SHA256 against
`ml/training/MODEL_MANIFEST.json`) before every batch inference run — a
mismatch aborts the job rather than running an unverified model.

## Retrain cadence

Monthly (`MODEL_RETRAIN_CADENCE`, §14), manually triggered via
`ml/training/train.py` — **never auto-promoted.** A human reviews the
model card diff (recall/precision deltas, feature importance shifts)
before a newly trained model replaces the currently deployed one. This is
a deliberate human-in-the-loop control on a health-safety-relevant model.

## Ethical considerations

- **False negatives have asymmetric real-world cost** — see the promotion
  gate rationale above. The gate is tuned accordingly, but the model
  cannot eliminate the risk of a missed surge; it is one signal among the
  public-health tools this project supports, not a sole source of truth.
- **Regional data quality inequality:** regions with sparser historical
  `dengue_cases`/`weather_observations` coverage produce less reliable
  predictions than well-instrumented regions, but the UI does not
  currently surface a per-region confidence/data-completeness indicator —
  tracked as a known limitation below.
- **No individual-level data is used.** All inputs are region-aggregated
  weather and case counts; the model never sees or trains on any
  personally identifiable information.

## Known limitations

- Predictions are only as fresh as the last batch run (24h cadence) — not
  real-time.
- The model has not been validated against climates or regions outside
  its training distribution; deploying it to a new geography without
  retraining/revalidating against local data is out of scope for the
  promotion gate's guarantees.
- `favorable_breeding_flag`'s thresholds (`DENGUE_FAVORABLE_TEMP_MEAN_C`,
  `DENGUE_FAVORABLE_TEMP_MIN_C`, `DENGUE_FAVORABLE_HUMIDITY_PCT`) are fixed
  constants from entomological literature, not learned or region-adaptive.
- SHAP explainability output (`top_factors`) reflects the model's
  statistical reasoning, not a causal claim — "high humidity contributed"
  is not the same as "high humidity caused this surge."
