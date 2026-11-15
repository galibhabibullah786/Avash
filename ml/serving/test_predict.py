"""Unit tests for predict wiring: row assembly, payload filtering, band display, H=2 shadow.
No network, no Supabase, no ONNX files required — model sessions and boosters are faked
trained in-memory; the real ONNX path is covered by ml/tests/test_parity.py."""
import numpy as np
import pandas as pd
import pytest
from lightgbm import LGBMClassifier

from ml.training import config
from ml.serving import predict

FEATURES = list(config.FEATURES_A)


@pytest.fixture(scope="module")
def tiny_clf():
    rng = np.random.RandomState(1)
    X = rng.rand(80, len(FEATURES))
    y = (X[:, 5] + X[:, 1] > 1).astype(int)
    return LGBMClassifier(n_estimators=10, max_depth=3, random_state=42, verbose=-1).fit(X, y)


class FakeSession:
    def __init__(self, p=0.73):
        self.p = p

    def run(self, outputs, feed):
        assert outputs == ["probabilities"]
        X = feed["input"]
        p = np.full(len(X), self.p, dtype=np.float32)
        return [np.stack([1 - p, p], axis=1)]


@pytest.fixture(scope="module")
def df_rows():
    rng = np.random.RandomState(5)
    rows = []
    for d in ["Dhaka", "Khulna", "Barishal"]:
        rows.append({"District": d, "week_start": pd.Timestamp("2026-06-29"),
                     **{f: float(v) for f, v in zip(FEATURES, rng.rand(len(FEATURES)) + 0.5)}})
    return pd.DataFrame(rows).set_index(pd.Index([0, 1, 2]), drop=False)


def test_build_rows_contract(df_rows, tiny_clf):
    models = {2: {"session": FakeSession(0.73), "booster": tiny_clf},
              4: {"session": FakeSession(0.81), "booster": tiny_clf}}
    rows = predict.build_rows(df_rows, models, FEATURES, "2026-11-09", "2.0.0", region_ids=None)
    assert len(rows) == 6  # 3 districts x 2 horizons
    for r in rows:
        assert "risk_level" not in r                      # DB generated — never set by us
        assert set(r) >= {"region", "region_id", "prediction_date", "horizon_weeks",
                          "risk_score", "top_factors", "model_version", "_band_display"}
        assert r["horizon_weeks"] in (2, 4)
        assert 0.0 <= r["risk_score"] <= 1.0
        assert round(r["risk_score"], 3) == r["risk_score"]
        assert len(r["top_factors"]) == 3
        assert all(set(f) == {"factor", "label", "importance"} for f in r["top_factors"])


def test_no_risk_level_in_upsert_payload(df_rows, tiny_clf):
    models = {2: {"session": FakeSession(0.5), "booster": tiny_clf},
              4: {"session": FakeSession(0.5), "booster": tiny_clf}}
    rows = predict.build_rows(df_rows, models, FEATURES, "2026-11-09", "2.0.0", region_ids=None)
    name_to_id = {"dhaka": "id-1", "khulna": "id-2", "barishal": "id-3"}
    payload = predict.to_upsert_payload(rows, name_to_id)
    assert len(payload) == 6
    for p in payload:
        assert set(p) == {"region_id", "prediction_date", "horizon_weeks", "risk_score",
                          "top_factors", "model_version"}   # exactly the contract
        assert "risk_level" not in p and "generated_at" not in p


def test_upsert_payload_rejects_unknown_region(df_rows, tiny_clf):
    models = {2: {"session": FakeSession(0.5), "booster": tiny_clf},
              4: {"session": FakeSession(0.5), "booster": tiny_clf}}
    rows = predict.build_rows(df_rows, models, FEATURES, "2026-11-09", "2.0.0", region_ids=None)
    with pytest.raises(ValueError, match="Barishal"):
        predict.to_upsert_payload(rows, {"dhaka": "id-1", "khulna": "id-2"})


def test_normalize_district():
    assert predict.normalize_district("Barishal") == "barishal"
    assert predict.normalize_district(" Narayanganj ") == "narayanganj"
    assert predict.normalize_district("B. Baria") == "bbaria"


def test_h2_rows_flagged_shadow_not_in_alerts(df_rows, tiny_clf):
    from ml.serving.push_delivery import detect_high_severe_crossings
    models = {2: {"session": FakeSession(0.95), "booster": tiny_clf},
              4: {"session": FakeSession(0.95), "booster": tiny_clf}}
    rows = predict.build_rows(df_rows, models, FEATURES, "2026-11-09", "2.0.0", region_ids=None)
    h2 = [r for r in rows if r["horizon_weeks"] == 2]
    assert h2 and all(r["_band_display"] == "severe" for r in h2)   # computed, visible, ...
    assert detect_high_severe_crossings({}, h2, horizon_weeks=4) == []  # ... never alerted
    h4 = [r for r in rows if r["horizon_weeks"] == 4]
    assert detect_high_severe_crossings({}, h4, horizon_weeks=4)    # H=4 does alert


def test_env_var_fallbacks_resolve_ci_secrets(monkeypatch):
    """CI passes SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY without AVASH_ prefix."""
    monkeypatch.delenv("AVASH_SUPABASE_URL", raising=False)
    monkeypatch.delenv("AVASH_SUPABASE_SERVICE_KEY", raising=False)
    monkeypatch.delenv("AVASH_VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("AVASH_VAPID_SUBJECT", raising=False)

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key-123")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "vapid-priv-abc")
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "vapid-pub-xyz")

    cfg = predict.get_supabase_config()
    assert cfg["url"] == "https://example.supabase.co"
    assert cfg["key"] == "service-key-123"

    vapid = predict.get_vapid_config()
    assert vapid["private_key"] == "vapid-priv-abc"
    assert vapid["subject"] == "mailto:alerts@avash.app"


def test_platt_scaling_calibration_applied_when_enabled(df_rows, tiny_clf, monkeypatch):
    """When CALIBRATION_ENABLED=True, probabilities are remapped via Platt scaling."""
    monkeypatch.setattr(config, "CALIBRATION_ENABLED", True)
    # Fake a high raw probability 0.90
    models = {2: {"session": FakeSession(0.90), "booster": tiny_clf},
              4: {"session": FakeSession(0.90), "booster": tiny_clf}}
    rows = predict.build_rows(df_rows, models, FEATURES, "2026-11-09", "2.0.0", region_ids=None)
    # Calibrated probability should differ from raw 0.90
    assert len(rows) == 6
    for r in rows:
        assert r["risk_score"] != 0.90
        assert 0.0 <= r["risk_score"] <= 1.0


def test_fetch_live_features_from_supabase_builds_canonical_13(monkeypatch):
    """Live query builds the 13 feature columns directly from Supabase tables with zero CSVs."""
    class FakeTable:
        def __init__(self, data):
            self._data = data

        def select(self, *a, **k):
            return self

        def eq(self, *a, **k):
            return self

        def gte(self, *a, **k):
            return self

        def order(self, *a, **k):
            return self

        def execute(self):
            class Res:
                pass
            r = Res()
            r.data = self._data
            return r

    # 1 district mock
    region_id = "r-dhaka"
    regions_data = [{"id": region_id, "name": "Dhaka", "code": "DHA", "population": 1000000}]
    
    # 28 days of daily weather
    weather_data = []
    base_date = pd.Timestamp("2026-06-01")
    for d in range(35):
        weather_data.append({
            "region_id": region_id,
            "observed_at": (base_date + pd.Timedelta(days=d)).isoformat(),
            "temp_mean_c": 28.5,
            "temp_min_c": 24.0,
            "humidity_pct": 82.0,
            "precipitation_mm": 15.0,
        })
    
    # 4 weeks of weekly dengue cases
    cases_data = []
    for w in range(5):
        cases_data.append({
            "region_id": region_id,
            "reported_week": (base_date + pd.Timedelta(weeks=w)).strftime("%Y-%m-%d"),
            "case_count": 20 + w * 5,
        })

    class FakeClient:
        def table(self, name):
            if name == "regions":
                return FakeTable(regions_data)
            elif name == "weather_observations":
                return FakeTable(weather_data)
            elif name == "dengue_cases":
                return FakeTable(cases_data)
            raise ValueError(name)

    client = FakeClient()
    df_feat = predict.fetch_live_features_from_supabase(client)
    assert len(df_feat) == 1
    assert df_feat.iloc[0]["District"] == "Dhaka"
    for col in config.FEATURES_A:
        assert col in df_feat.columns
        assert not pd.isna(df_feat.iloc[0][col])

