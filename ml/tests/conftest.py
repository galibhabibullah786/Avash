"""Shared pytest fixtures. Unit tests use synthetic data in tmp_path.
Integration checks (real data / artifacts) are opt-in via env vars and skip cleanly."""
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DATA_DIR = os.environ.get("AVASH_DATA_DIR")
REAL_DATA_AVAILABLE = bool(DATA_DIR) and Path(DATA_DIR).is_dir()
ARTIFACT_DIR = os.environ.get("AVASH_ARTIFACT_DIR", str(REPO_ROOT / "ml" / "models"))
ARTIFACTS_AVAILABLE = all(
    Path(ARTIFACT_DIR, f).exists()
    for f in ("model_h2.onnx", "model_h4.onnx", "lgbm_h2.joblib", "lgbm_h4.joblib")
)


def _synthetic_weeks(n_districts: int = 6, n_weeks: int = 80, seed: int = 7):
    rng = np.random.RandomState(seed)
    rows = []
    start = pd.Timestamp("2022-01-03")
    for d in range(n_districts):
        level = rng.randint(0, 3)
        for w in range(n_weeks):
            if w > 30 and rng.rand() < 0.10 + 0.15 * (level > 0):
                level = min(level + rng.randint(1, 4), 60)
            elif rng.rand() < 0.35:
                level = max(level - 1, 0)
            rows.append((f"D{d:02d}", start + pd.Timedelta(weeks=w), 25.0 + 3 * np.sin(2 * np.pi * (w / 52.0)),
                         23.0, 28.0, 80.0, 2.0, 2.0, 1013.0, 2.0, int(level), 2022 + (start + pd.Timedelta(weeks=w)).year,
                         (start + pd.Timedelta(weeks=w)).isocalendar().week))
    wk = pd.DataFrame(rows, columns=["District", "week_start", "temp_mean", "temp_min", "temp_max",
                                     "humidity_mean", "rain_sum", "rain_max", "pressure_mean", "wind_mean",
                                     "cases", "year", "week_of_year"])
    wk["Latitude"] = 23.5 + rng.rand(len(wk)) * 0.1
    wk["Longitude"] = 90.0 + rng.rand(len(wk)) * 0.1
    return wk


@pytest.fixture
def synthetic_weekly():
    return _synthetic_weeks()


@pytest.fixture
def synthetic_daily():
    rows = []
    start = pd.Timestamp("2021-11-01")
    rng = np.random.RandomState(11)
    for d in range(6):
        for day in range(720):
            date = start + pd.Timedelta(days=day)
            rows.append((date, f"D{d:02d}", 24.0 + 5 * np.sin(2 * np.pi * day / 365.0) + rng.randn(),
                         78.0 + rng.randn() * 5, max(0.0, rng.exponential(2.0)), 1013.0, 2.0, 0))
    return pd.DataFrame(rows, columns=["Date", "District", "Temperature_C", "Humidity_percent",
                                       "Precipitation_mm", "Surface_Pressure_kPa", "Wind_Speed_ms", "Affected count"])


@pytest.fixture
def synthetic_population():
    return pd.DataFrame({"District": [f"D{d:02d}" for d in range(6)],
                         "population_2022": [100_000 + d * 250_000 for d in range(6)]})
