"""Pure, deterministic feature builder for the Avash surge models.

Contract
--------
* Features at week t use data from week t and earlier ONLY (daily windows end at the
  week's Sunday; weekly lags are shifted). Targets (labels) are the only place t+H
  values appear, and they live in `add_labels`, never in the feature matrix.
* No global state, no randomness, fixed sort orders -> bitwise-stable outputs.
* Data is read in place; this module never writes files.

Known approximations / placeholders (do not silently "fix"):
* `temp_min_roll_14`: the raw daily CSV has no minimum-temperature column and the
  weekly `temp_min` is the MIN of daily MEAN temperatures, not a true daily minimum.
  Approximated as the mean of the current and previous weekly `temp_min`.
  PROVISIONAL until the production `weather_observations.temp_min_c` coverage is confirmed.
* `population_density`: NO land-area data exists anywhere in the inputs, so true
  density (population / km^2) cannot be computed. Placeholder = log10(population_2022).
  Recompute from real area values when they are supplied; do not invent areas.
* Weekly-vs-daily: rolling features are computed from the DAILY file over trailing
  windows ending at each week's Sunday (week_start + 6 days); `dengue_weekly.csv` was
  verified to be an exact roll-up of the daily file (cases match 15,040/15,040).
* Seasonality: sin/cos(2*pi*week_of_year/52).
"""
from __future__ import annotations

import math
from typing import Iterable

import numpy as np
import pandas as pd

from ml.training import config

# ---------------- loading ----------------

def load_weekly(path=None) -> pd.DataFrame:
    path = str(path or config.WEEKLY_CSV)
    df = pd.read_csv(path, parse_dates=["week_start"])
    df = df.sort_values(["District", "week_start"], kind="mergesort").reset_index(drop=True)
    return df


def load_daily(path=None) -> pd.DataFrame:
    path = str(path or config.DAILY_CSV)
    df = pd.read_csv(path, parse_dates=["Date"], date_format="%m/%d/%Y")
    # tolerate ISO dates too
    if df["Date"].isna().any():
        df = pd.read_csv(path, parse_dates=["Date"])
    df = df.sort_values(["District", "Date"], kind="mergesort").reset_index(drop=True)
    return df


def load_population(path=None) -> pd.DataFrame:
    path = str(path or config.POP_CSV)
    df = pd.read_csv(path)
    expected = {"District", "population_2022"}
    missing = expected - set(df.columns)
    if missing:
        raise ValueError(f"population file missing columns: {sorted(missing)}")
    return df

# ---------------- neighbour topology (Option B) ----------------

def haversine_km(lat1, lon1, lat2, lon2):
    """Vectorized haversine distance in km."""
    r = 6371.0
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0) ** 2
    return 2.0 * r * np.arcsin(np.sqrt(a))


def neighbour_indices(centroids: pd.DataFrame, k: int = 5) -> dict[str, list[str]]:
    """k nearest districts per district by centroid haversine distance (excludes self)."""
    districts = list(centroids.index)
    lat = centroids["Latitude"].to_numpy(float)
    lon = centroids["Longitude"].to_numpy(float)
    out: dict[str, list[str]] = {}
    for i, name in enumerate(districts):
        d = haversine_km(lat[i], lon[i], lat, lon)
        d[i] = np.inf
        out[name] = [districts[j] for j in np.argsort(d, kind="mergesort")[:k]]
    return out


def _add_neighbor_case_lag_1(df: pd.DataFrame, districts, k: int = 5) -> pd.Series:
    centroids = df.groupby("District", sort=False)[["Latitude", "Longitude"]].first()
    neigh = neighbour_indices(centroids, k)
    piv = df.pivot(index="week_start", columns="District", values="cases")
    nb = np.zeros((len(piv), len(districts)), dtype=float)
    for i, dname in enumerate(districts):
        nb[:, i] = piv[neigh[dname]].sum(axis=1).to_numpy(float)
    nb = pd.DataFrame(nb, index=piv.index, columns=list(districts)).shift(1)   # t-1 only
    long = nb.stack().rename("neighbor_case_lag_1").reset_index()
    long.columns = ["week_start", "District", "neighbor_case_lag_1"]
    merged = df.merge(long, on=["week_start", "District"], how="left")
    return merged["neighbor_case_lag_1"]

# ---------------- feature builder ----------------

def build_feature_frame(
    weekly: pd.DataFrame,
    daily: pd.DataFrame,
    population: pd.DataFrame,
    feature_set: str | None = None,
) -> pd.DataFrame:
    """Return one row per (district, week) with feature columns + ids. Deterministic."""
    feature_set = (feature_set or config.FEATURE_SET).upper()
    df = weekly.sort_values(["District", "week_start"], kind="mergesort").reset_index(drop=True).copy()

    # population placeholder: log10 population (NO land-area data exists; see module docstring)
    pop = population.copy()
    pop["population_density"] = np.log10(pop["population_2022"].astype(float))
    pop_map = pop.set_index("District")["population_density"]
    if not set(df.District) <= set(pop_map.index):
        missing = sorted(set(df.District) - set(pop_map.index))
        raise ValueError(f"population missing districts: {missing}")
    df["population_density"] = df.District.map(pop_map)

    # trailing daily windows ending at week_end (= week_start + 6 days)
    dl = daily.set_index("Date").sort_index()
    frames = []
    for dist, d in dl.groupby("District", sort=False):
        d = d.sort_index()
        rolled = pd.DataFrame({
            "temp_mean_roll_7": d["Temperature_C"].rolling(7, min_periods=7).mean(),
            "temp_mean_roll_14": d["Temperature_C"].rolling(14, min_periods=14).mean(),
            "temp_mean_roll_28": d["Temperature_C"].rolling(28, min_periods=28).mean(),
            "humidity_roll_14": d["Humidity_percent"].rolling(14, min_periods=14).mean(),
            "precip_cum_14": d["Precipitation_mm"].rolling(14, min_periods=14).sum(),
        })
        rolled["District"] = dist
        frames.append(rolled.reset_index())
    roll = pd.concat(frames, ignore_index=True)

    df["week_end"] = df["week_start"] + pd.Timedelta(days=6)
    df = df.merge(roll, left_on=["District", "week_end"], right_on=["District", "Date"], how="left")
    df = df.drop(columns=["Date"]).sort_values(["District", "week_start"], kind="mergesort").reset_index(drop=True)

    g = df.groupby("District", sort=False)
    df["temp_min_roll_14"] = g["temp_min"].transform(lambda s: s.rolling(2, min_periods=2).mean())  # PROVISIONAL
    for k in (1, 2, 3):
        df[f"case_lag_{k}"] = g["cases"].shift(k)
    df["week_sum_2"] = g["cases"].transform(lambda s: s.rolling(2, min_periods=2).sum())
    df["favorable_breeding_flag"] = (
        (df.temp_mean_roll_14 >= 27.0) & (df.temp_min_roll_14 >= 22.0) & (df.humidity_roll_14 >= 80.0)
    ).astype(int)
    df["seasonality_sin"] = np.sin(2 * np.pi * df.week_of_year / 52.0)
    df["seasonality_cos"] = np.cos(2 * np.pi * df.week_of_year / 52.0)

    if feature_set == "B":
        districts = list(df.District.unique())
        df["neighbor_case_lag_1"] = _add_neighbor_case_lag_1(df, districts, k=5)

    return df


def feature_matrix(df: pd.DataFrame, features: Iterable[str] | None = None) -> pd.DataFrame:
    feats = list(features or config.FEATURES)
    out = df.dropna(subset=feats)
    return out[feats]

# ---------------- labels ----------------

def add_labels(df: pd.DataFrame, horizon: int, denominator_floor: float = config.DENOMINATOR_FLOOR) -> pd.DataFrame:
    """Label (a), spec §3.1 with floor from Phase 1 decision. Uses FUTURE cases — targets only."""
    if horizon not in config.HORIZONS:
        raise ValueError(f"horizon must be one of {config.HORIZONS}")
    df = df.copy()
    g = df.groupby("District", sort=False)
    fut = g["cases"].shift(-horizon)
    growth = (fut - df["cases"]) / np.maximum(df["cases"], denominator_floor)
    df["future_cases"] = fut
    df["growth_rate"] = growth
    df["target"] = (growth >= config.SURGE_TARGET_THRESHOLD).astype(float)
    df.loc[fut.isna(), "target"] = np.nan
    return df


def model_frame(df: pd.DataFrame, horizon: int, features: Iterable[str] | None = None) -> pd.DataFrame:
    """Rows with complete features and a known target. Used for CV and training."""
    feats = list(features or config.FEATURES)
    d = add_labels(df, horizon).dropna(subset=feats + ["target"]).copy()
    d["target"] = d.target.astype(int)
    return d

def eligible_rows(df: pd.DataFrame, features: Iterable[str] | None = None) -> pd.DataFrame:
    feats = list(features or config.FEATURES)
    return df.dropna(subset=feats).copy()
