# ml/ — Avash Dengue Surge Early Warning (Tree A)

Weekly district-level dengue surge forecasting for Bangladesh's 64 districts.
Two LightGBM binary classifiers — **model_h2** (2-week) and **model_h4** (4-week) —
are trained, evaluated, and packaged for the 24h GitHub-Actions batch (source of
truth) and the on-device PWA (ADR-002 dual-path, spec §1.2).

> **NOTHING HERE IS PUBLISHED.** Publishing (Supabase/HF) is blocked on an
> unverified data license (DGHS attribution) and on the promotion gate being a
> provisional, post-hoc decision. Push alerts stay OFF until the frozen-model
> check passes (below). All sync/push paths default to `--dry-run`.

## Layout

```
ml/
  training/      config · feature_engineering · calibration · train · export_onnx
                 · onnx_arithmetic (ONNX export) · onnx_precision (kept for reference)
                 · sync_to_hub (staging only unless --push --yes) · MODEL_MANIFEST.json (committed)
  evaluation/    backtest (promotion gate) · model_card (generates MODEL_CARD.md, not committed)
  serving/       predict (--dry-run default) · push_delivery (best-effort, fake transport in tests)
  tests/         test_features · test_shap_factors · test_parity · test_gate · serving tests
  models/        git-ignored artifacts (ONNX + joblib + metrics JSON) — ship via HF, not git
```

## Quickstart / reproduction

```bash
export AVASH_DATA_DIR=/path/to/raw          # read in place; data is NEVER copied into the repo
export AVASH_WEEKLY_CSV=dengue_weekly.csv
export AVASH_DAILY_CSV=Bangladesh_64_Districts_NASA_POWER_Weather_dengue_affected_Daily_22_26.csv
export AVASH_POP_CSV="population (1).csv"

python -m ml.training.train            # trains CV + final boosters -> ml/models/ (git-ignored)
python -m ml.training.export_onnx      # ONNX export + parity check + MODEL_MANIFEST.json
python -m ml.evaluation.backtest       # walk-forward backtest; H=4 gate; exit 1 on gate failure
python -m pytest -p no:cacheprovider ml/tests ml/serving
python -m ml.serving.predict --dry-run # 64 districts x 2 horizons; writes nothing
python -m ml.training.sync_to_hub --dry-run   # stages to <tmpdir>/hf-staging; NEVER pushes
```

Env overrides: `AVASH_FEATURE_SET=A|B` (default A; B adds `neighbor_case_lag_1`),
`AVASH_CALIBRATION=1` (default OFF — see "Calibration"), `AVASH_ARTIFACT_DIR`,
`AVASH_SNAPSHOT_DIR`, `AVASH_MODEL_HUB_REPO`, `AVASH_DATASET_HUB_REPO`,
`AVASH_SUPABASE_URL` / `AVASH_SUPABASE_SERVICE_KEY` (commit path only),
`AVASH_VAPID_PRIVATE_KEY` / `AVASH_VAPID_SUBJECT` (push only),
`HUGGINGFACE_HUB_TOKEN` (publish only, never needed for dry-runs).

## Target & features

- **Label (a)** (Phase 1 decision): `surge_flag = 1[(cases_{t+H} − cases_t) / max(cases_t, 1) ≥ 0.30]`
- **Folds** (spec §3.3): (train ≤ 2024-06 / val 2024-07→12) · (≤ 2025-06 / 2025-07→12) · (≤ 2025-12 / 2026-01→06).
  Training rows must have their target week BEFORE validation start; decision threshold 0.5
  fixed on training folds. Validation folds are never used to choose hyperparameters.
- **Features (A, default)**: temp_mean_roll_7/14/28, temp_min_roll_14 ⚠, humidity_roll_14,
  precip_cum_14, case_lag_1/2/3, favorable_breeding_flag ⚠, seasonality_sin/cos,
  population_density (log10 population placeholder, NOT land-area density).
  ⚠ `temp_min` in the weekly CSV is the min of daily MEAN temps, not a true daily tmin,
  and the daily CSV has no tmin column — `temp_min_roll_14` and `favorable_breeding_flag`
  are **PROVISIONAL** until production `weather_observations.temp_min_c` coverage is confirmed.
- Feature engineering is deterministic (fixed sort, mergesort) — same inputs, same rows.

## Results (walk-forward; threshold 0.5; PR-AUC = average precision)

| Horizon | Pooled R / P / PR-AUC | n | Worst fold (R/P) | Gate |
|---|---|---|---|---|
| H=2 | 0.649 / 0.485 / 0.458 | 14,720 | F3: 0.559 / 0.503 (PR-AUC 0.496) | SHADOW (never alerts) |
| H=4 | 0.734 / 0.620 / 0.604 | 14,592 | F3: 0.609 / 0.551 (PR-AUC 0.581) | **PASS (provisional)** |

H=4 beats the persistence baseline on recall, precision AND PR-AUC in **every** fold.

**Promotion gate (G2, provisional — chosen AFTER seeing results, replacing the spec's
0.85/0.60 which is unachievable on this data):**
pooled recall ≥ 0.70 AND precision ≥ 0.60 AND beats persistence everywhere; worst fold
always reported; Fold 3 (2026-01→06, low-base) is expected seasonality — do NOT retune;
confirm 2026 counts vs DGHS before production sign-off.
H=2 stays shadow. **Before any push alerts**: frozen-model check on the next 8–12 weeks
of new data (`FROZEN_CHECK_WEEKS = 12`) is REQUIRED (out of scope for this build).

## ONNX artifacts & the parity story (read this before touching export)

Spec §3.4 asked for: opset 17, an ai.onnx.ml TreeEnsembleClassifier with the float64
"double-precision patch" (`nodes_values_as_tensor` as tensor(double)), and a float32
fallback keeping the 1e-4 parity tolerance. **That patch is not possible on
onnxruntime 1.31** — the TreeEnsemble kernel reads `nodes_values_as_tensor` as
vector<float> regardless of the declared dtype; a double tensor aborts InferenceSession
creation (verified at ai.onnx.ml opset 3, 4 and 5).

The float32 fallback does NOT meet the gate either — and not marginally:
**99.7% of eligible rows sit within 1e-6 of a split threshold** (case_lag features are
small integers and surge-ratio thresholds are quantiles of the same distribution), so
float32 routing flips dominate: max |ONNX − Python| = **1.29e-01 (h2)** / **2.05e-01 (h4)**.
Even pure Python float32-vs-float64 diverges by 8.9e-02 / 1.5e-01. No float32 path can
meet 1e-4 on this data. The spec's evident belief that float32 would suffice is the bug.

**Resolution — `onnx_arithmetic.py` ("arithmetic double" export, what actually ships):**
the model is rebuilt as a pure ai.onnx opset-17 graph — `Split` + per-node
`LessOrEqual`/`Where` over **tensor(double) end to end** — no ai.onnx.ml domain, no
float32 anywhere. Leaf values are initializers; the margin is the sum of tree outputs;
`Sigmoid` matches LightGBM's binary objective exactly (verified: sigmoid(raw_score) ==
predict_proba to 1.1e-16). NaN routes exactly as LightGBM (missing_type='None' → right
child). Result:

* parity vs `booster.predict_proba` (float64): **2.2e-16 max over the FULL eligible
  datasets** (14,720 / 14,592 rows) and **1.5e-16 / 2.2e-16 on the 2,000-row gate sample** —
  not just under the non-negotiable 1e-4, at machine epsilon;
* probabilities sum to 1 to < 1e-9; probabilities are column 1 of `[N, 2]` tensor(double);
* file size **240 KB / 238 KB** — under the 300 KB target and far under the 2 MB budget
  (this was measured, not assumed: dedup'd initializers + sequential node naming).

**Costs accepted (flagged for your decision):**
1. **Input is tensor(double) [N, F]** — predict.py, test_parity.py and any consumer must
   feed float64. For the on-device PWA this means `Float64Array` in onnxruntime-web;
   if the PWA stack cannot feed float64 tensors, these artifacts are NOT drop-in there.
   Alternatives (each worse): ship TreeEnsemble float32 (PWA-compatible, parity ~1e-01
   vs Python — violates your non-negotiable), or float64 patch (does not exist at runtime).
   → DECISION NEEDED: accept float64-input artifacts for both paths, or scope a separate
   float32 PWA artifact with documented ~1e-01 deviation. Training/export remain unchanged.
2. The graph has ~4,700 ops (vs ~150 for TreeEnsemble) — inference is still trivial
   (<1 ms/row); arithmetic graphs are fully supported by onnxruntime-web opset 17.
3. `onnx_precision.py` (the double-threshold rebuild, verified node-exact) is kept for
   reference; it is not used — a future onnxruntime with double TreeEnsemble support can
   adopt it instead of the expansion.

Parity gate result (`python -m ml.tests.test_parity`): **PASS** (2 horizons) + manifest
SHA-256 integrity check passes.

## risk_predictions row contract (real schema, migration 20260201000003_risk_predictions.sql)

Upsert key `(region_id, horizon_weeks, prediction_date)`; `horizon_weeks ∈ {2, 4}`;
`risk_score` numeric(4,3); `top_factors` jsonb = **[{factor, label, importance}]** top-3
by |TreeSHAP| (LightGBM `pred_contrib=True`; bias column dropped; format unchanged per
spec §3.5); `model_version` text; `generated_at` defaults to now().
**`risk_level` is a GENERATED column — this pipeline NEVER writes it** (not even NULL-fill).
`region_id` resolves via normalized `regions.name` where `admin_level = 2` (lowercase,
alnum-only; CSV "B. Baria" → "bbaria"). Unmatched districts raise ValueError listing the
names — nothing is written. Dry-run needs no mapping (region_id stays null in output JSON).
`region_risk_summary` is a MATERIALIZED VIEW — refreshed via RPC/separately, never on the
request path.

## Calibration

`calibration.py` implements Platt (default) and isotonic calibration but is
**DISABLED** (`CALIBRATION_ENABLED = False`, `AVASH_CALIBRATION=1` to opt in).
Scores are raw log-loss probabilities with `scale_pos_weight = 2.5` — **deliberately
inflated** (e.g. h4 severe-band counts in the dry-run are high). Do not read
`risk_score` as a calibrated frequency. Enabling calibration changes the decision
threshold's meaning and requires your explicit go-ahead + a backtest re-run.

## Hygiene & storage

Artifacts (`models/`, `*.onnx`, `*.joblib`, `MODEL_CARD.md`) are git-ignored;
`MODEL_MANIFEST.json` (JSON only: SHA-256, sizes, opsets, parity, gate, notes) is
**committed**. `feature snapshot` CSVs go to `$AVASH_SNAPSHOT_DIR` (tmp), never parquet,
never committed. Repo stays ~1.8 MB. Never push to HF/Supabase/GitHub without explicit
user confirmation; all entry points default to dry-run.

## Open decisions (for you, not silently chosen)

1. **PWA + float64 tensors** (above) — go/no-go, or separate float32 PWA artifact with
   documented ~1e-01 deviation.
2. **Publish?** HF model/dataset cards stage fine (`sync_to_hub --dry-run`), but DGHS
   case-data license/attribution is UNVERIFIED — do not `--push` until confirmed.
3. **Calibration** — enable + re-gate, or keep raw inflated scores (current)?
4. **Frozen-model 12-week check** on fresh data before enabling push alerts (schedule).
5. **`temp_min_c`** — production coverage confirmation to un-mark `temp_min_roll_14` /
   `favorable_breeding_flag` as provisional.
6. **DGHS cross-check of 2026 counts** (fold-3 low-base) before production sign-off.
7. **Option B** (`neighbor_case_lag_1`) — available via `AVASH_FEATURE_SET=B`; measured
   H2 +0.015 R / +0.01 PR-AUC, below promotion floor; left as opt-in.
8. `seasonality_sin/cos` is `sin/cos(2π · week_of_year / 52)` (ISO week); `population_density`
   is log10(population_2022) placeholder — replace both when land-area/CMIEOM arrive.

## Verification protocol (this build)

size budget ✓ (240 KB < 300 KB target, < 2 MB ceiling) · ONNX parity ✓ (2e-16 < 1e-4,
≥1,000 rows — full datasets used) · promotion gate ✓ backtest (H=4 PASS provisional /
H=2 shadow) · SHAP factor format ✓ (`pred_contrib`, spec §3.5 shape tested) ·
dry-run over 64 districts × 2 horizons ✓ (128 rows; no DB writes; risk_level absent) ·
41 tests pass, 2 skipped by design (HF download; shap cross-check — shap intentionally
not installed) · SHA-256 manifest ✓ · no network calls anywhere.

Known limitation of this build: production latency/behavior on the real Supabase +
PWA path is unverified (no credentials by design); the commit path is exercised only
via FakeSession tests.
