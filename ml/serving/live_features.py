"""Live feature builder: constructs the 13 canonical dengue features from Supabase tables.

Used by ml/serving/predict.py in production batch runs. Directly queries:
- regions (admin_level=2 / districts, population)
- weather_observations (daily temp, humidity, precipitation)
- dengue_cases (weekly reported cases)

Constructs the exact 13 features without touching any local CSV files.
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from ml.training import config

log = logging.getLogger(__name__)


def get_supabase_config() -> dict[str, str | None]:
    import os
    url = os.environ.get("AVASH_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = (os.environ.get("AVASH_SUPABASE_SERVICE_KEY") or
           os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or
           os.environ.get("SUPABASE_SERVICE_KEY"))

    # When running inside a Docker container against local Supabase
    if url and ("127.0.0.1" in url or "localhost" in url):
        if os.path.exists("/.dockerenv") or os.environ.get("DOCKER_CONTAINER"):
            url = url.replace("127.0.0.1", "host.docker.internal").replace("localhost", "host.docker.internal")

    return {"url": url, "key": key}


def fetch_live_features_from_supabase(client: Any, as_of_date: str | None = None) -> pd.DataFrame:
    """Query live Supabase tables and return a DataFrame matching the 13-feature contract."""
    # 1. Fetch regions
    regions_res = client.table("regions").select("id,name,code,population").execute()
    regions = getattr(regions_res, "data", None) or []
    if not regions:
        log.warning("No regions returned from Supabase")
        return pd.DataFrame()

    # 2. Fetch trailing weather observations (trailing 35 days to ensure >= 28 available)
    weather_query = client.table("weather_observations").select("*")
    if as_of_date:
        weather_query = weather_query.lte("observed_at", as_of_date)
    weather_res = weather_query.order("observed_at", desc=False).execute()
    weather_data = getattr(weather_res, "data", None) or []
    weather_df = pd.DataFrame(weather_data)

    # 3. Fetch trailing dengue cases (trailing 8 weeks to ensure >= 4 lag weeks available)
    cases_query = client.table("dengue_cases").select("*")
    if as_of_date:
        cases_query = cases_query.lte("reported_week", as_of_date)
    cases_res = cases_query.order("reported_week", desc=False).execute()
    cases_data = getattr(cases_res, "data", None) or []
    cases_df = pd.DataFrame(cases_data)

    rows = []
    for r in regions:
        rid = r["id"]
        dname = r["name"]
        pop = float(r.get("population") or 1000000)
        pop_density = float(np.log10(max(pop, 1.0)))

        # Process weather for region
        if not weather_df.empty and "region_id" in weather_df.columns:
            rw = weather_df[weather_df["region_id"] == rid].copy()
            if not rw.empty:
                rw["observed_at"] = pd.to_datetime(rw["observed_at"])
                rw = rw.sort_values("observed_at")
        else:
            rw = pd.DataFrame()

        tmean_col = "temp_mean_c" if "temp_mean_c" in rw.columns else ("Temperature_C" if "Temperature_C" in rw.columns else None)
        tmin_col = "temp_min_c" if "temp_min_c" in rw.columns else None
        hum_col = "humidity_pct" if "humidity_pct" in rw.columns else ("Humidity_percent" if "Humidity_percent" in rw.columns else None)
        precip_col = "precipitation_mm" if "precipitation_mm" in rw.columns else ("Precipitation_mm" if "Precipitation_mm" in rw.columns else None)

        if not rw.empty and tmean_col:
            tmean = rw[tmean_col].dropna().to_numpy(dtype=float)
            tm_7 = float(np.mean(tmean[-7:])) if len(tmean) >= 7 else (float(np.mean(tmean)) if len(tmean) > 0 else 28.0)
            tm_14 = float(np.mean(tmean[-14:])) if len(tmean) >= 14 else (float(np.mean(tmean)) if len(tmean) > 0 else 28.0)
            tm_28 = float(np.mean(tmean[-28:])) if len(tmean) >= 28 else (float(np.mean(tmean)) if len(tmean) > 0 else 28.0)
        else:
            tm_7, tm_14, tm_28 = 28.0, 28.0, 28.0

        if not rw.empty and tmin_col:
            tmin = rw[tmin_col].dropna().to_numpy(dtype=float)
            tmin_14 = float(np.mean(tmin[-14:])) if len(tmin) >= 14 else (float(np.mean(tmin)) if len(tmin) > 0 else 22.0)
        else:
            tmin_14 = 22.0

        if not rw.empty and hum_col:
            hum = rw[hum_col].dropna().to_numpy(dtype=float)
            hum_14 = float(np.mean(hum[-14:])) if len(hum) >= 14 else (float(np.mean(hum)) if len(hum) > 0 else 75.0)
        else:
            hum_14 = 75.0

        if not rw.empty and precip_col:
            precip = rw[precip_col].dropna().to_numpy(dtype=float)
            prec_14 = float(np.sum(precip[-14:])) if len(precip) >= 14 else (float(np.sum(precip)) if len(precip) > 0 else 0.0)
        else:
            prec_14 = 0.0

        # Process cases for region
        if not cases_df.empty and "region_id" in cases_df.columns:
            rc = cases_df[cases_df["region_id"] == rid].copy()
            if not rc.empty:
                rc["reported_week"] = pd.to_datetime(rc["reported_week"])
                rc = rc.sort_values("reported_week")
        else:
            rc = pd.DataFrame()

        case_col = "case_count" if "case_count" in rc.columns else ("cases" if "cases" in rc.columns else None)
        if not rc.empty and case_col:
            counts = rc[case_col].to_numpy(dtype=float)
            c_lag1 = float(counts[-2]) if len(counts) >= 2 else (float(counts[-1]) if len(counts) >= 1 else 0.0)
            c_lag2 = float(counts[-3]) if len(counts) >= 3 else c_lag1
            c_lag3 = float(counts[-4]) if len(counts) >= 4 else c_lag2
            latest_date = rc["reported_week"].iloc[-1]
        else:
            c_lag1, c_lag2, c_lag3 = 0.0, 0.0, 0.0
            latest_date = pd.Timestamp.now()

        fav_flag = int(tm_14 >= 27.0 and tmin_14 >= 22.0 and hum_14 >= 80.0)

        week_num = latest_date.isocalendar()[1] if hasattr(latest_date, "isocalendar") else 26
        sin_t = float(np.sin(2 * np.pi * week_num / 52.0))
        cos_t = float(np.cos(2 * np.pi * week_num / 52.0))

        rows.append({
            "District": dname,
            "region_id": rid,
            "week_start": latest_date,
            "temp_mean_roll_7": tm_7,
            "temp_mean_roll_14": tm_14,
            "temp_mean_roll_28": tm_28,
            "temp_min_roll_14": tmin_14,
            "humidity_roll_14": hum_14,
            "precip_cum_14": prec_14,
            "case_lag_1": c_lag1,
            "case_lag_2": c_lag2,
            "case_lag_3": c_lag3,
            "favorable_breeding_flag": fav_flag,
            "seasonality_sin": sin_t,
            "seasonality_cos": cos_t,
            "population_density": pop_density,
        })

    return pd.DataFrame(rows)
