"""ONNX vs Python parity on >=1000 historical rows (spec §5.2). Requires artifacts + real data.
Skips cleanly on a fresh CI machine without the Hugging Face artifacts."""
import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pytest

from ml.training import config
from ml.tests.conftest import ARTIFACTS_AVAILABLE, REAL_DATA_AVAILABLE

pytestmark = pytest.mark.skipif(
    not (ARTIFACTS_AVAILABLE and REAL_DATA_AVAILABLE),
    reason="requires exported ONNX artifacts and AVASH_DATA_DIR with the raw CSVs",
)
ARTIFACT_DIR = Path(os.environ.get("AVASH_ARTIFACT_DIR", config.ARTIFACT_DIR))


@pytest.fixture(scope="module")
def real_features():
    from ml.training.feature_engineering import (
        build_feature_frame, eligible_rows, load_daily, load_population, load_weekly,
    )
    data_dir = Path(os.environ["AVASH_DATA_DIR"])
    wk = load_weekly(data_dir / os.environ.get("AVASH_WEEKLY_CSV", "dengue_weekly.csv"))
    dl = load_daily(data_dir / os.environ.get("AVASH_DAILY_CSV", "raw_daily.csv"))
    pop = load_population(data_dir / os.environ.get("AVASH_POP_CSV", "population.csv"))
    df = build_feature_frame(wk, dl, pop, feature_set=config.FEATURE_SET)
    d = eligible_rows(df, config.FEATURES)
    X = d[list(config.FEATURES)].to_numpy(dtype=np.float64)
    assert len(X) >= 1000, f"need >=1000 eligible rows, got {len(X)}"
    if len(X) > 1500:
        idx = np.linspace(0, len(X) - 1, 1500).astype(int)
        X = X[np.unique(idx)]
    return X


@pytest.mark.parametrize("horizon", [2, 4])
def test_onnx_python_parity(real_features, horizon):
    import joblib
    import onnxruntime as rt

    clf = joblib.load(ARTIFACT_DIR / f"lgbm_h{horizon}.joblib")
    sess = rt.InferenceSession(str(ARTIFACT_DIR / f"model_h{horizon}.onnx"),
                               providers=["CPUExecutionProvider"])
    probs = sess.run(["probabilities"], {"input": real_features})[0]
    assert probs.shape == (real_features.shape[0], 2)
    assert probs.dtype == np.float64          # arithmetic-export graph is double end to end
    np.testing.assert_allclose(probs.sum(axis=1), 1.0, atol=1e-9)
    onnx_p = probs[:, 1]
    py_p = clf.predict_proba(real_features)[:, 1]
    max_diff = float(np.max(np.abs(onnx_p - py_p)))
    assert max_diff < config.PARITY_TOLERANCE, f"max abs diff {max_diff} >= {config.PARITY_TOLERANCE}"


def test_manifest_integrity():
    manifest = json.loads(config.MANIFEST_PATH.read_text())
    for entry in manifest["horizons"]:
        p = ARTIFACT_DIR / entry["file"]
        assert p.exists(), p
        assert hashlib.sha256(p.read_bytes()).hexdigest() == entry["sha256"]
        assert p.stat().st_size == entry["size_bytes"]
        assert entry["size_bytes"] < config.ONNX_SIZE_BUDGET


def test_hf_download_path():
    pytest.importorskip("huggingface_hub", reason="huggingface_hub not installed in sandbox (by design)")
    pytest.skip("HF download test intentionally not run — nothing may be fetched/published without user confirmation")
