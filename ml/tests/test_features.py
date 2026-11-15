"""Feature engineering: shape, determinism, no leakage, null handling (spec §4/§5)."""
import numpy as np
import pandas as pd
import pytest

from ml.training import config
from ml.training.feature_engineering import (
    add_labels, build_feature_frame, load_daily, load_population, load_weekly, model_frame,
    neighbour_indices, haversine_km,
)


def _frame(synthetic_weekly, synthetic_daily, synthetic_population, feature_set="A"):
    return build_feature_frame(synthetic_weekly, synthetic_daily, synthetic_population,
                               feature_set=feature_set)


def test_columns_and_count(synthetic_weekly, synthetic_daily, synthetic_population):
    df = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    assert len(config.FEATURES_A) == 13
    for col in config.FEATURES_A:
        assert col in df.columns, col


def test_determinism(synthetic_weekly, synthetic_daily, synthetic_population):
    a = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    b = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    pd.testing.assert_frame_equal(a, b)


def test_no_leakage_features_use_only_past(synthetic_weekly, synthetic_daily, synthetic_population):
    full = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    district = "D00"
    cut_week = full[full.District == district].week_start.iloc[40]
    wk_trunc = synthetic_weekly[synthetic_weekly.week_start <= cut_week]
    dy_trunc = synthetic_daily[synthetic_daily.Date <= cut_week + pd.Timedelta(days=6)]
    trunc = build_feature_frame(wk_trunc, dy_trunc, synthetic_population, feature_set="A")
    row_full = full[(full.District == district) & (full.week_start == cut_week)].iloc[0]
    row_trunc = trunc[(trunc.District == district) & (trunc.week_start == cut_week)].iloc[0]
    for col in config.FEATURES_A:
        np.testing.assert_allclose(row_full[col], row_trunc[col], rtol=1e-10, atol=1e-10,
                                   err_msg=f"feature {col} changed when future data was dropped")


def test_case_lags_shift_within_district(synthetic_weekly, synthetic_daily, synthetic_population):
    df = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    g = df.groupby("District", sort=False)
    for k in (1, 2, 3):
        np.testing.assert_array_equal(df[f"case_lag_{k}"].to_numpy()[k:],
                                      g["cases"].shift(k).to_numpy()[k:])


def test_labels_use_future_cases_and_match_rule(synthetic_weekly):
    wk = synthetic_weekly.sort_values(["District", "week_start"]).reset_index(drop=True)
    d = add_labels(wk, 2)
    g = wk.groupby("District", sort=False)
    fut = g["cases"].shift(-2)
    expected = ((fut - wk.cases) / np.maximum(wk.cases, 1.0) >= config.SURGE_TARGET_THRESHOLD)
    ok = fut.notna()
    np.testing.assert_array_equal(d.target[ok].astype(bool), expected[ok])
    assert d.target[~ok].isna().all()


def test_null_handling_first_weeks(synthetic_weekly, synthetic_daily, synthetic_population):
    df = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    assert df.case_lag_3.isna().any()           # first weeks have no lag-3
    m = model_frame(df, 2)
    assert m[list(config.FEATURES)].notna().all().all()
    assert m.target.isin([0, 1]).all()


def test_favorable_flag_thresholds(synthetic_weekly, synthetic_daily, synthetic_population):
    df = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    cond = (df.temp_mean_roll_14 >= 27.0) & (df.temp_min_roll_14 >= 22.0) & (df.humidity_roll_14 >= 80.0)
    np.testing.assert_array_equal(df.favorable_breeding_flag.to_numpy(), cond.astype(int).to_numpy())


def test_seasonality_bounded(synthetic_weekly, synthetic_daily, synthetic_population):
    df = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    assert df.seasonality_sin.abs().max() <= 1.0
    assert df.seasonality_cos.abs().max() <= 1.0


def test_population_density_is_log10_placeholder(synthetic_weekly, synthetic_daily, synthetic_population):
    # PLACEHOLDER CONTRACT: log10 population, NOT a real density (no land-area data).
    df = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    pop = synthetic_population.set_index("District").population_2022
    for dname, grp in df.groupby("District"):
        np.testing.assert_allclose(grp.population_density.iloc[0], np.log10(pop[dname]), rtol=1e-9)


def test_option_b_neighbor_feature(synthetic_weekly, synthetic_daily, synthetic_population):
    df = _frame(synthetic_weekly, synthetic_daily, synthetic_population, feature_set="B")
    assert "neighbor_case_lag_1" in df.columns
    assert len(config.FEATURES_B) == 14


def test_neighbour_indices_exclude_self(synthetic_weekly):
    cent = synthetic_weekly.groupby("District")[["Latitude", "Longitude"]].first()
    neigh = neighbour_indices(cent, k=3)
    for d, ns in neigh.items():
        assert d not in ns and len(ns) == 3


def test_haversine_zero_self():
    assert haversine_km(23.7, 90.4, 23.7, 90.4) == pytest.approx(0.0, abs=1e-9)


def test_labels_nan_dropped_in_model_frame(synthetic_weekly, synthetic_daily, synthetic_population):
    df = _frame(synthetic_weekly, synthetic_daily, synthetic_population)
    m = model_frame(df, 4)
    assert len(m) < len(df)
