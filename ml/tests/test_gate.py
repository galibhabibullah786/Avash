"""Promotion gate check (PROVISIONAL, Phase 1/1b decision). Real data required; skips otherwise.

The spec's recall >= 0.85 / precision >= 0.60 is NOT enforced here.
H=4: pooled recall >= 0.70, precision >= 0.60, beats persistence baseline everywhere.
H=2: shadow — metrics reported, no assertion.
"""
import os
from pathlib import Path

import pytest

from ml.training import config
from ml.tests.conftest import REAL_DATA_AVAILABLE

pytestmark = pytest.mark.skipif(not REAL_DATA_AVAILABLE,
                                reason="requires AVASH_DATA_DIR with the raw CSVs")


@pytest.fixture(scope="module")
def df_feat():
    from ml.training.feature_engineering import build_feature_frame, load_daily, load_population, load_weekly
    data_dir = Path(os.environ["AVASH_DATA_DIR"])
    wk = load_weekly(data_dir / os.environ.get("AVASH_WEEKLY_CSV", "dengue_weekly.csv"))
    dl = load_daily(data_dir / os.environ.get("AVASH_DAILY_CSV", "raw_daily.csv"))
    pop = load_population(data_dir / os.environ.get("AVASH_POP_CSV", "population.csv"))
    return build_feature_frame(wk, dl, pop, feature_set=config.FEATURE_SET)


def test_h4_provisional_gate(df_feat):
    from ml.evaluation.backtest import backtest_horizon, gate_verdict
    res = backtest_horizon(df_feat, 4, list(config.FEATURES))
    verdict = gate_verdict(res)
    print(f"\nH=4 pooled: recall={res['pooled']['recall']:.3f} precision={res['pooled']['precision']:.3f} "
          f"PR-AUC={res['pooled']['pr_auc']:.3f} | worst fold={res['worst_fold']}")
    for f in res["folds"]:
        print(f"fold{f['fold']}: R={f['recall']:.3f} P={f['precision']:.3f} PR-AUC={f['pr_auc']:.3f} beats_baseline={f['beats_baseline']}")
    assert res["pooled"]["recall"] >= config.H4_MIN_RECALL, "pooled recall below provisional gate"
    assert res["pooled"]["precision"] >= config.H4_MIN_PRECISION, "pooled precision below provisional gate"
    assert all(f["beats_baseline"] for f in res["folds"]), "H=4 must beat persistence baseline (R/P/AP) in EVERY fold"
    assert verdict["passed"] is True


def test_h2_shadow_reported_not_enforced(df_feat):
    from ml.evaluation.backtest import backtest_horizon, gate_verdict
    res = backtest_horizon(df_feat, 2, list(config.FEATURES))
    verdict = gate_verdict(res)
    print(f"\nH=2 (shadow) pooled: recall={res['pooled']['recall']:.3f} precision={res['pooled']['precision']:.3f}")
    assert verdict["enforced"] is False
    assert verdict["status"] == "shadow"
