"""Canonical constants for the Avash dengue surge pipeline.

Model-design values come from the rebuild spec (ML_PIPELINE_REBUILD_PROMPT.md §3);
execution-gate values come from the Phase 1 / Phase 1b feasibility reports and
are PROVISIONAL (see GATE note below). Everything data-path related is env-overridable.
"""
import os
from pathlib import Path

# --- Target formulation (spec §1.5, Phase 1 decision: label (a)) ---
SURGE_TARGET_THRESHOLD = 0.30
LABEL_DEFINITION = "a"          # y = 1[(cases_{t+H} - cases_t) / max(cases_t, 1) >= 0.30]
DENOMINATOR_FLOOR = 1.0         # label (a); do not switch to 10 without a new gate decision

# --- Promotion gate (PROVISIONAL — Phase 1/1b decision, NOT the spec's 0.85/0.60) ---
# Chosen AFTER seeing walk-forward results; must be re-checked on the frozen model
# against the next 8-12 weeks of new data before any push alerts are enabled.
# H=4 is the promotion candidate; H=2 stays shadow (no push alerts) until
# Option B features / retraining / new data improve it.
GATE_PROVISIONAL = True
H4_MIN_RECALL = 0.70            # pooled out-of-fold, threshold fixed on training folds
H4_MIN_PRECISION = 0.60
H2_PROMOTION_ENABLED = False    # shadow mode: scores are computed and stored, never alerted
MIN_RECALL_TARGET = H4_MIN_RECALL     # kept for backwards compat with spec naming
MIN_PRECISION_TARGET = H4_MIN_PRECISION
BASELINE_BEAT_REQUIRED = True   # must beat persistence baseline (R/P/PR-AUC) in EVERY fold
FROZEN_CHECK_WEEKS = 12         # frozen-model validation required before enabling push alerts
SPEC_RECALL_ASPIRATION = 0.85   # retained as a tracked aspiration, NOT the enforced gate

# --- Horizon ---
HORIZONS = (2, 4)

# --- LightGBM hyperparameters (spec §3.2, unchanged) ---
LGBM_PARAMS = {
    "objective": "binary",
    "metric": "binary_logloss",
    "boosting_type": "gbdt",
    "n_estimators": 120,
    "learning_rate": 0.03,
    "num_leaves": 20,
    "max_depth": 5,
    "min_child_samples": 15,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "scale_pos_weight": 2.5,    # class imbalance; probabilities are INFLATED (see calibration.py)
    "random_state": 42,
    "verbose": -1,
}

# --- Walk-forward folds (spec §3.3) — training rows must have target week BEFORE validation start ---
FOLDS = (
    ("2024-06-30", "2024-07-01", "2024-12-31"),
    ("2025-06-30", "2025-07-01", "2025-12-31"),
    ("2025-12-31", "2026-01-01", "2026-06-30"),
)

# --- Feature sets ---
FEATURES_A = (
    "temp_mean_roll_7",
    "temp_mean_roll_14",
    "temp_mean_roll_28",
    "temp_min_roll_14",        # PROVISIONAL (see below)
    "humidity_roll_14",
    "precip_cum_14",
    "case_lag_1",
    "case_lag_2",
    "case_lag_3",
    "favorable_breeding_flag", # PROVISIONAL (see below)
    "seasonality_sin",
    "seasonality_cos",
    "population_density",
)
FEATURES_B = FEATURES_A + ("neighbor_case_lag_1",)
FEATURE_SET = os.environ.get("AVASH_FEATURE_SET", "A").upper()
FEATURES = FEATURES_A if FEATURE_SET == "A" else FEATURES_B
ML_FEATURE_COUNT = len(FEATURES)

# PROVISIONAL features: dengue_weekly.csv `temp_min` is the min of daily MEAN
# temperatures, NOT a true daily minimum, and the raw daily CSV has no tmin column.
# The production `weather_observations` table HAS a `temp_min_c numeric(4,1)` column
# (migration 20260201000002_weather_and_cases.sql) but population/coverage is
# UNCONFIRMED. Until confirmed: treat temp_min_roll_14 and favorable_breeding_flag
# as provisional. Do not ship citizen-facing decisions that hinge on them.
PROVISIONAL_FEATURES = ("temp_min_roll_14", "favorable_breeding_flag")
DAILY_TMIN_UNCONFIRMED = True

# --- Labels (spec §3.5 label keys mirror exact feature names) ---
FACTOR_LABELS = {
    "temp_mean_roll_7": "7-day average temperature",
    "temp_mean_roll_14": "14-day average temperature",
    "temp_mean_roll_28": "28-day average temperature",
    "temp_min_roll_14": "14-day minimum temperature",
    "humidity_roll_14": "14-day relative humidity",
    "precip_cum_14": "14-day cumulative rainfall",
    "case_lag_1": "prior week case trajectory",
    "case_lag_2": "case trajectory two weeks ago",
    "case_lag_3": "case trajectory three weeks ago",
    "favorable_breeding_flag": "favorable vector breeding conditions",
    "seasonality_sin": "seasonal monsoon peak window",
    "seasonality_cos": "seasonal monsoon phase",
    "population_density": "district population (log10 placeholder for density)",
    "neighbor_case_lag_1": "neighbouring districts' cases last week",
}

# --- Data paths (read in place; never copy data into the repo) ---
_HERE = Path(__file__).resolve()
ML_DIR = _HERE.parents[1]
DATA_DIR = Path(os.environ.get("AVASH_DATA_DIR", ".")).expanduser()
WEEKLY_CSV = DATA_DIR / os.environ.get("AVASH_WEEKLY_CSV", "dengue_weekly.csv")
DAILY_CSV = DATA_DIR / os.environ.get("AVASH_DAILY_CSV", "raw_daily.csv")
POP_CSV = DATA_DIR / os.environ.get("AVASH_POP_CSV", "population.csv")
ARTIFACT_DIR = Path(os.environ.get("AVASH_ARTIFACT_DIR", str(ML_DIR / "models"))).expanduser()
MANIFEST_PATH = ML_DIR / "training" / "MODEL_MANIFEST.json"

# Feature snapshot goes to a temp dir as CSV (never parquet, never committed)
SNAPSHOT_DIR = Path(os.environ.get("AVASH_SNAPSHOT_DIR", "/tmp/avash-snapshots"))

# --- ONNX export ---
ONNX_OPSET = 17                  # main ai.onnx domain (onnxmltools caps converter at 15; see export_onnx.py)
ONNX_ML_OPSET = 3                # ai.onnx.ml domain for TreeEnsembleClassifier
ONNX_SIZE_BUDGET = 2 * 1024 * 1024      # hard assert: < 2 MB
ONNX_SIZE_TARGET = 300 * 1024           # expected < 300 KB
PARITY_TOLERANCE = 1e-4
PARITY_SAMPLE_ROWS = 2000        # >= 1000 required

# --- Model registry ---
MODEL_VERSION = "2.0.0"
MODEL_HUB_REPO = os.environ.get("AVASH_MODEL_HUB_REPO", "avash-health/avash-dengue-models")
DATASET_HUB_REPO = os.environ.get("AVASH_DATASET_HUB_REPO", "avash-health/avash-dengue-dataset")
MONITORING_DATE_TZ_OFFSET_HOURS = 6   # Asia/Dhaka (UTC+6)

# --- Calibration (Phase 1b fix; Platt scaling remapping raw probabilities to true frequencies) ---
CALIBRATION_ENABLED = os.environ.get("AVASH_CALIBRATION", "1") != "0"
CALIBRATION_METHOD = "platt"

# --- risk_predictions row contract (real schema, migration 20260201000003) ---
# region_id (uuid FK), prediction_date (date), horizon_weeks (smallint 2|4),
# risk_score numeric(4,3), top_factors jsonb, model_version text, generated_at default now().
# risk_level is a GENERATED column — we NEVER write it.
RISK_ROW_FIELDS = ("region_id", "prediction_date", "horizon_weeks", "risk_score",
                   "top_factors", "model_version")
RISK_BANDS = ((0.25, "low"), (0.50, "moderate"), (0.75, "high"), (1.01, "severe"))  # display only
