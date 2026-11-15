"""Probability calibration for the surge models (PROPOSED, NOT APPLIED by default).

Background (Phase 1b): with `scale_pos_weight=2.5`, predicted probabilities are
inflated (mean pred 0.42 vs observed 0.32/0.37 pooled; the [0.75, 1.00] band
over-predicts by ~16-36pp). The DB bands (0.25/0.50/0.75) are probability
thresholds, so raw scores over-assign high/severe risk.

Fix: Platt/sigmoid `p_cal = sigmoid(a * p + b)` fitted on OUT-OF-FOLD predictions
from the TRAINING folds only (never the validation folds). Monotone -> ranking,
AUC and (by construction) the calibrator's effect on any threshold are all via a
single scalar remap. To let the browser WASM path band identically, the two
constants must be applied there too (or baked into the ONNX graph) — decision is
pending user sign-off.

THIS IS DISABLED BY DEFAULT (`config.CALIBRATION_ENABLED == False`).
Do NOT enable it without explicit approval; it changes risk_score values.
Selection between platt and isotonic must be done on training OOF only.
"""
from __future__ import annotations

import json
import math

import numpy as np


def sigmoid(z: np.ndarray) -> np.ndarray:
    z = np.clip(z, -60.0, 60.0)
    return 1.0 / (1.0 + np.exp(-z))


def fit_platt(y_true, scores) -> dict:
    """Fit sigmoid(a*p + b) by logistic regression on the raw probability. Deterministic."""
    from sklearn.linear_model import LogisticRegression

    p = np.clip(np.asarray(scores, dtype=np.float64).reshape(-1, 1), 1e-6, 1 - 1e-6)
    y = np.asarray(y_true, dtype=np.int64)
    lr = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000, random_state=42)
    lr.fit(p, y)
    a, b = float(lr.coef_[0][0]), float(lr.intercept_[0])
    return {"method": "platt", "a": round(a, 8), "b": round(b, 8),
            "fitted_on": "training_oof_predictions", "n": int(len(y))}


def apply_calibration(scores, params: dict):
    a, b = float(params["a"]), float(params["b"])
    return sigmoid(a * np.asarray(scores, dtype=np.float64) + b)


def brier_score(y_true, p) -> float:
    y = np.asarray(y_true, dtype=np.float64)
    return float(np.mean((np.asarray(p, dtype=np.float64) - y) ** 2))


def reliability_table(scores, y_true, bins=(0.0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1.0)) -> list[dict]:
    s = np.asarray(scores, dtype=np.float64); y = np.asarray(y_true, dtype=np.float64)
    rows = []
    edges = list(bins)
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        m = (s >= lo) & (s <= hi) if i == len(edges) - 2 else (s >= lo) & (s < hi)
        rows.append({"bin": f"[{lo:.1f},{hi:.1f}{']' if i == len(edges) - 2 else ')'}",
                     "n": int(m.sum()),
                     "mean_pred": float(s[m].mean()) if m.any() else None,
                     "observed": float(y[m].mean()) if m.any() else None})
    return rows


def manifest_payload(params: dict | None, enabled: bool) -> dict:
    return {"calibration": {"enabled": bool(enabled), "method": (params or {}).get("method", config_method()),
                            **(params or {})}}


def config_method() -> str:
    from ml.training import config
    return config.CALIBRATION_METHOD


def dump_calibrator(params: dict, path) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(params, fh, indent=2)
