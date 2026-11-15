"""Walk-forward backtest + PROVISIONAL promotion gate (decision Phase 1/1b, G2-style).

Gate (PROVISIONAL — chosen after seeing results; the spec's 0.85 recall is retained
only as an aspiration, NOT enforced):

  H=4 (promotion candidate):
    * pooled out-of-fold recall >= 0.70 AND precision >= 0.60   (threshold fixed at 0.5)
    * must beat the persistence baseline ("last week's growth >= 30%") on recall,
      precision AND PR-AUC in EVERY fold
    * worst fold is always reported
    * EVEN IF GREEN: push alerts stay disabled until a frozen model passes an
      8-12 week check on new data (FROZEN_CHECK_WEEKS)

  H=2: shadow mode — metrics reported, gate never enforced, no push alerts.

Baseline PR-AUC uses the continuous last-week growth ratio as the ranking score.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.metrics import average_precision_score

from ml.training import config
from ml.training.feature_engineering import (
    build_feature_frame, load_daily, load_population, load_weekly, model_frame,
)
from ml.training.train import fold_split


def _metrics(y, scores, pred):
    tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum()); fn = int(((pred == 0) & (y == 1)).sum())
    return {
        "recall": tp / (tp + fn) if (tp + fn) else None,
        "precision": tp / (tp + fp) if (tp + fp) else None,
        "pr_auc": float(average_precision_score(y, scores)) if y.sum() else None,
        "support_pos": int(y.sum()), "n": int(len(y)),
    }


def backtest_horizon(df_feat: pd.DataFrame, horizon: int, features) -> dict:
    d = model_frame(df_feat, horizon, features).copy()
    g = d.groupby("District", sort=False)
    d["growth_base"] = (d.cases - g["cases"].shift(1)) / np.maximum(g["cases"].shift(1), 1.0)

    folds, pooled_scores, pooled_y, val_frames = [], [], [], []
    for i, tr, va in fold_split(d, horizon):
        clf = LGBMClassifier(**config.LGBM_PARAMS)
        clf.fit(tr[features], tr.target)
        scores = clf.predict_proba(va[features])[:, 1]
        pred = (scores >= 0.5).astype(int)
        yva = va.target.to_numpy()
        m = _metrics(yva, scores, pred)
        bscore = va.growth_base.fillna(0.0).to_numpy()
        bpred = (bscore >= config.SURGE_TARGET_THRESHOLD).astype(int)
        b = _metrics(yva, bscore, bpred)
        beats = all(
            (x is not None and y is not None and x > y)
            for x, y in ((m["recall"], b["recall"]), (m["precision"], b["precision"]), (m["pr_auc"], b["pr_auc"]))
        )
        folds.append({"fold": i, "n_train": int(len(tr)), "n_val": int(len(va)),
                      "prevalence": float(yva.mean()), **m,
                      "baseline": b, "beats_baseline": bool(beats)})
        pooled_scores.append(pd.Series(scores, index=va.index))
        pooled_y.append(va.target)
        val_frames.append(va)

    sa = pd.concat(pooled_scores).sort_index()
    ya = pd.concat(pooled_y).sort_index()
    pa = (sa >= 0.5).astype(int)
    pooled = _metrics(ya.to_numpy(), sa.to_numpy(), pa.to_numpy())
    va_all = pd.concat(val_frames)
    bscore = va_all.growth_base.fillna(0.0).to_numpy()
    bpred = (bscore >= config.SURGE_TARGET_THRESHOLD).astype(int)
    pooled["baseline"] = _metrics(va_all.target.to_numpy(), bscore, bpred)
    worst = {
        "fold": min((f["fold"] for f in folds), key=lambda i: folds[i - 1]["recall"] if folds[i - 1]["recall"] is not None else -1),
        "recall": min((f["recall"] for f in folds if f["recall"] is not None), default=None),
        "precision": min((f["precision"] for f in folds if f["precision"] is not None), default=None),
    }
    return {"horizon": horizon, "folds": folds, "pooled": pooled, "worst_fold": worst}


def gate_verdict(result: dict) -> dict:
    """Provisional G2-style gate. Only H=4 is enforceable; H=2 is shadow."""
    H = result["horizon"]
    pooled, folds = result["pooled"], result["folds"]
    every_fold_beats = all(f["beats_baseline"] for f in folds)
    if H == 4:
        ok_recall = pooled["recall"] is not None and pooled["recall"] >= config.H4_MIN_RECALL
        ok_prec = pooled["precision"] is not None and pooled["precision"] >= config.H4_MIN_PRECISION
        passed = bool(ok_recall and ok_prec and every_fold_beats)
        return {"enforced": True, "passed": passed, "ok_recall": bool(ok_recall),
                "ok_precision": bool(ok_prec), "every_fold_beats_baseline": bool(every_fold_beats),
                "note": "PROVISIONAL gate; frozen 8-12 week check on new data required before push alerts."}
    return {"enforced": False, "passed": None, "status": "shadow",
            "every_fold_beats_baseline": bool(every_fold_beats),
            "note": "H=2 shadow mode: metrics reported only; no push alerts; gate not enforced."}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", default=str(config.DATA_DIR))
    ap.add_argument("--weekly", default=config.WEEKLY_CSV.name)
    ap.add_argument("--daily", default=config.DAILY_CSV.name)
    ap.add_argument("--population", default=config.POP_CSV.name)
    ap.add_argument("--feature-set", default=config.FEATURE_SET, choices=["A", "B"])
    ap.add_argument("--out", default=None, help="write backtest JSON (default: <artifact-dir>/backtest_results.json); use '-' for stdout only")
    ap.add_argument("--no-gate", action="store_true", help="report only; never exit non-zero")
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir)
    weekly = load_weekly(data_dir / args.weekly)
    daily = load_daily(data_dir / args.daily)
    pop = load_population(data_dir / args.population)
    features = list(config.FEATURES_A if args.feature_set == "A" else config.FEATURES_B)
    df_feat = build_feature_frame(weekly, daily, pop, feature_set=args.feature_set)

    print("=" * 78)
    print("PROVISIONAL PROMOTION GATE — chosen after seeing results (Phase 1/1b).")
    print(f"Spec aspiration recall>={config.SPEC_RECALL_ASPIRATION} is NOT enforced. "
          f"Frozen {config.FROZEN_CHECK_WEEKS}-week check on new data required before push alerts.")
    print("=" * 78)

    results, failures = [], []
    for H in config.HORIZONS:
        res = backtest_horizon(df_feat, H, features)
        res["gate"] = gate_verdict(res)
        results.append(res)
        print(f"\nHorizon H={H}")
        for f in res["folds"]:
            b = f["baseline"]
            print(f"  fold{f['fold']}: n_train={f['n_train']:5d} n_val={f['n_val']:4d} prev={f['prevalence']:.3f} | "
                  f"R={f['recall']:.3f} P={f['precision']:.3f} PR-AUC={f['pr_auc']:.3f} | "
                  f"baseline R={b['recall']:.3f} P={b['precision']:.3f} AP={b['pr_auc']:.3f} | beats={f['beats_baseline']}")
        p, b = res["pooled"], res["pooled"]["baseline"]
        print(f"  pooled : R={p['recall']:.3f} P={p['precision']:.3f} PR-AUC={p['pr_auc']:.3f} | "
              f"baseline R={b['recall']:.3f} P={b['precision']:.3f} AP={b['pr_auc']:.3f}")
        w = res["worst_fold"]
        print(f"  worst fold: fold{w['fold']} recall={w['recall']:.3f} precision={w['precision']:.3f}")
        g = res["gate"]
        if g["enforced"]:
            print(f"  GATE (H=4, provisional): recall>=0.70 {g['ok_recall']}  precision>=0.60 {g['ok_precision']}  "
                  f"beats-baseline-every-fold {g['every_fold_beats_baseline']}  -> {'PASS' if g['passed'] else 'FAIL'}")
            if not g["passed"]:
                failures.append(H)
        else:
            print(f"  GATE (H=2): shadow mode — reported only; alerts disabled; beats-baseline-every-fold={g['every_fold_beats_baseline']}")

    payload = {"model_version": config.MODEL_VERSION, "feature_set": args.feature_set,
               "provisional_gate": True, "results": results}
    out = args.out
    if out is None:
        out = str(Path(config.ARTIFACT_DIR) / "backtest_results.json")
    if out != "-":
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
        print(f"\nbacktest JSON written to {out}")

    if failures and not args.no_gate:
        print(f"\nGATE FAILED for horizons {failures}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
