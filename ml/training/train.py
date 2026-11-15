"""Train model_h2 and model_h4 (LightGBM binary, spec §3.2 params, spec §3.3 folds).

Produces (in --artifact-dir, default ml/models/ — git-ignored):
  lgbm_h2.joblib, lgbm_h4.joblib   native boosters (also used for pred_contrib SHAP)
  cv_metrics.json                  walk-forward CV metrics (CSVs are for Phase 1 only)

The FINAL production artifact is a fresh LightGBM fit on ALL eligible rows (targets
known), trained after the CV evaluation. CV metrics — not the final fit — drive the
promotion gate (see ml/evaluation/backtest.py).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

from ml.training import config
from ml.training.feature_engineering import (
    add_labels,
    build_feature_frame,
    load_daily,
    load_population,
    load_weekly,
    model_frame,
)


def fold_split(d: pd.DataFrame, horizon: int):
    """Yield (fold_index, train_df, val_df). Training targets must precede validation start."""
    for i, (train_end, val_start, val_end) in enumerate(config.FOLDS, start=1):
        target_week = d.week_start + pd.Timedelta(weeks=horizon)
        tr = d[target_week < pd.Timestamp(val_start)]
        va = d[(d.week_start >= pd.Timestamp(val_start)) & (d.week_start <= pd.Timestamp(val_end))]
        assert (tr.week_start + pd.Timedelta(weeks=horizon) < pd.Timestamp(val_start)).all()
        yield i, tr, va


def train_fold(Xtr, ytr) -> LGBMClassifier:
    clf = LGBMClassifier(**config.LGBM_PARAMS)
    clf.fit(Xtr, ytr)
    return clf


def cross_validate(df_feat: pd.DataFrame, horizon: int, features=None) -> dict:
    from sklearn.metrics import average_precision_score

    feats = list(features or config.FEATURES)
    d = model_frame(df_feat, horizon, feats)
    folds = []
    oof_scores, oof_y = [], []
    for i, tr, va in fold_split(d, horizon):
        clf = train_fold(tr[feats], tr.target)
        scores = clf.predict_proba(va[feats])[:, 1]
        pred = (scores >= 0.5).astype(int)
        yva = va.target.to_numpy()
        tp = int(((pred == 1) & (yva == 1)).sum())
        fp = int(((pred == 1) & (yva == 0)).sum())
        fn = int(((pred == 0) & (yva == 1)).sum())
        folds.append({
            "fold": i,
            "n_train": int(len(tr)), "n_val": int(len(va)),
            "prevalence": float(yva.mean()),
            "recall": tp / (tp + fn) if (tp + fn) else None,
            "precision": tp / (tp + fp) if (tp + fp) else None,
            "pr_auc": float(average_precision_score(yva, scores)) if yva.sum() else None,
        })
        oof_scores.append(pd.Series(scores, index=va.index))
        oof_y.append(va.target)
    sa = pd.concat(oof_scores).sort_index()
    ya = pd.concat(oof_y).sort_index()
    pa = (sa >= 0.5).astype(int)
    tp = int(((pa == 1) & (ya == 1)).sum()); fp = int(((pa == 1) & (ya == 0)).sum()); fn = int(((pa == 0) & (ya == 1)).sum())
    pooled = {
        "n_val": int(len(ya)),
        "prevalence": float(ya.mean()),
        "recall": tp / (tp + fn) if (tp + fn) else None,
        "precision": tp / (tp + fp) if (tp + fp) else None,
        "pr_auc": float(average_precision_score(ya, sa)) if ya.sum() else None,
    }
    return {"horizon": horizon, "folds": folds, "pooled": pooled}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", default=str(config.DATA_DIR))
    ap.add_argument("--weekly", default=config.WEEKLY_CSV.name)
    ap.add_argument("--daily", default=config.DAILY_CSV.name)
    ap.add_argument("--population", default=config.POP_CSV.name)
    ap.add_argument("--feature-set", default=config.FEATURE_SET, choices=["A", "B"])
    ap.add_argument("--artifact-dir", default=str(config.ARTIFACT_DIR))
    ap.add_argument("--horizon", default="both", choices=["2", "4", "both"])
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir)
    weekly = load_weekly(data_dir / args.weekly)
    daily = load_daily(data_dir / args.daily)
    pop = load_population(data_dir / args.population)
    features = list(config.FEATURES_A if args.feature_set == "A" else config.FEATURES_B)

    df_feat = build_feature_frame(weekly, daily, pop, feature_set=args.feature_set)
    out_dir = Path(args.artifact_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    summary = {"model_version": config.MODEL_VERSION, "feature_set": args.feature_set,
               "features": features, "trained_at": date.today().isoformat(), "horizons": {}}
    horizons = config.HORIZONS if args.horizon == "both" else (int(args.horizon),)
    for H in horizons:
        cv = cross_validate(df_feat, H, features)
        # FINAL artifact: fit on ALL eligible rows (spec §3.3 folds are for CV only)
        d_all = model_frame(df_feat, H, features)
        final = train_fold(d_all[features], d_all.target)
        joblib.dump(final, out_dir / f"lgbm_h{H}.joblib", compress=3)
        summary["horizons"][str(H)] = {"cv": cv, "n_train_final": int(len(d_all))}
        print(f"H={H}: pooled CV recall={cv['pooled']['recall']:.3f} "
              f"precision={cv['pooled']['precision']:.3f} PR-AUC={cv['pooled']['pr_auc']:.3f} "
              f"| final fit n={len(d_all)}")
    with open(out_dir / "cv_metrics.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)
    print(f"artifacts written to {out_dir}")


if __name__ == "__main__":
    sys.exit(main())
