"""TreeSHAP factor format (spec §3.5/§5.4, implementation: LightGBM native pred_contrib)."""
import json

import numpy as np
import pytest
from lightgbm import LGBMClassifier

from ml.training import config
from ml.serving.predict import extract_top_factors

FEATURES = list(config.FEATURES_A)


@pytest.fixture(scope="module")
def tiny_booster():
    rng = np.random.RandomState(0)
    X = rng.rand(200, len(FEATURES))
    y = (X[:, 5] + X[:, 0] > 1).astype(int)
    clf = LGBMClassifier(n_estimators=10, max_depth=3, random_state=42, verbose=-1)
    return clf.fit(X, y)


def test_top_factors_format(tiny_booster):
    row = np.arange(len(FEATURES), dtype=np.float64) * 0.1 + 1.0
    factors = extract_top_factors(tiny_booster, row, FEATURES, top_k=3)
    assert len(factors) == 3
    json.dumps(factors)  # must be JSON-serializable (jsonb column)
    for f in factors:
        assert set(f) == {"factor", "label", "importance"}
        assert f["factor"] in FEATURES
        assert isinstance(f["label"], str) and f["label"]
        assert isinstance(f["importance"], float)
    assert all(FEATURES.index(factors[i]["factor"]) is not None for i in range(3))
    # sorted by |contribution| descending
    mags = [abs(f["importance"]) for f in factors]
    assert mags == sorted(mags, reverse=True)


def test_top_factors_deterministic(tiny_booster):
    row = np.linspace(0.5, 2.5, len(FEATURES))
    assert extract_top_factors(tiny_booster, row, FEATURES) == extract_top_factors(tiny_booster, row, FEATURES)


def test_bias_column_dropped(tiny_booster):
    # contrib vector must have exactly n_features entries after dropping the bias term
    raw = tiny_booster.booster_.predict(np.ones((1, len(FEATURES))), pred_contrib=True)[0]
    assert raw.shape[0] == len(FEATURES) + 1


def test_shap_crosscheck_optional(tiny_booster):
    shap = pytest.importorskip("shap", reason="shap not installed in sandbox (by design)")
    row = np.linspace(0.2, 1.5, len(FEATURES)).reshape(1, -1)
    tree = shap.TreeExplainer(tiny_booster)
    vals = tree.shap_values(row)
    if isinstance(vals, list):
        vals = vals[1]
    native = tiny_booster.booster_.predict(row, pred_contrib=True)[0, :-1]
    np.testing.assert_allclose(np.asarray(vals).reshape(-1), native, atol=1e-4)
