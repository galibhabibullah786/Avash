"""Batch runner: score all 64 districts for horizons 2 and 4 (ADR-002 dual-path).

SAFETY MODEL:
- --dry-run (default): prints rows; touches no network or DB.
- --commit: lazy-imports supabase, upserts ONLY risk_predictions contract.
- H=2 (shadow): computed/stored, never alerted. H=4 crossings into high/severe alert.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ml.training import config
from ml.training.feature_engineering import (
    build_feature_frame, eligible_rows, load_daily, load_population, load_weekly,
)
from ml.serving.live_features import fetch_live_features_from_supabase, get_supabase_config
from ml.serving.push_delivery import (
    band_for_score, detect_high_severe_crossings, dispatch_alerts,
    get_vapid_config, _vapid_configured, _load_push_subscriptions, WebPushTransport,
)

log = logging.getLogger(__name__)
DHAKA = timezone(timedelta(hours=config.MONITORING_DATE_TZ_OFFSET_HOURS))

# ---------------- model access ----------------

def load_onnx_session(model_path: Path):
    import onnxruntime as rt
    return rt.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])


def load_booster(model_path: Path):
    return joblib.load(model_path)


def load_models(model_dir: Path) -> dict[int, dict[str, Any]]:
    models = {}
    for H in config.HORIZONS:
        onnx_file = model_dir / f"model_h{H}.onnx"
        lgbm_file = model_dir / f"lgbm_h{H}.joblib"
        if not onnx_file.exists() or not lgbm_file.exists():
            _ensure_hub_model(model_dir, H)
        models[H] = {
            "session": load_onnx_session(onnx_file),
            "booster": load_booster(lgbm_file),
        }
    return models


def _ensure_hub_model(model_dir: Path, horizon: int) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    repo = config.MODEL_HUB_REPO
    try:
        from huggingface_hub import hf_hub_download
        for fname in (f"model_h{horizon}.onnx", f"lgbm_h{horizon}.joblib"):
            target = model_dir / fname
            if not target.exists():
                log.info("Downloading %s from %s...", fname, repo)
                hf_hub_download(repo_id=repo, filename=fname, local_dir=str(model_dir))
    except Exception as exc:  # noqa: BLE001
        log.warning("Hugging Face download skipped/failed for horizon %s: %s", horizon, exc)


def onnx_scores(session, X: np.ndarray) -> np.ndarray:
    outs = session.run(["probabilities"], {"input": X.astype(np.float64)})[0]
    return outs[:, 1]


def apply_calibration(scores: np.ndarray | float, horizon: int = 4) -> np.ndarray | float:
    if not getattr(config, "CALIBRATION_ENABLED", False):
        return scores
    platt_params = {2: {"a": 2.20, "b": -1.45}, 4: {"a": 2.05, "b": -1.15}}
    params = platt_params.get(horizon, {"a": 2.05, "b": -1.15})
    from ml.training.calibration import apply_calibration as _apply
    return _apply(scores, params)


def extract_top_factors(booster, X_row: np.ndarray, feature_names, top_k: int = 3) -> list[dict]:
    contrib = booster.booster_.predict(X_row.reshape(1, -1), pred_contrib=True)[0][:-1]
    top = np.argsort(np.abs(contrib))[::-1][:top_k]
    return [{
        "factor": feature_names[idx],
        "label": config.FACTOR_LABELS.get(feature_names[idx], feature_names[idx].replace("_", " ")),
        "importance": round(float(contrib[idx]), 4),
    } for idx in top]


def normalize_district(name: str) -> str:
    return "".join(ch for ch in str(name).lower() if ch.isalnum())

# ---------------- row assembly ----------------

def build_rows(df_rows: pd.DataFrame, models: dict, features: list[str],
               prediction_date: str, model_version: str, region_ids: dict[str, str | None] | None) -> list[dict]:
    rows = []
    for H in config.HORIZONS:
        sess, booster = models[H]["session"], models[H]["booster"]
        X = df_rows[features].to_numpy(dtype=np.float64)
        probs = onnx_scores(sess, X)
        if getattr(config, "CALIBRATION_ENABLED", False):
            probs = apply_calibration(probs, horizon=H)
        for (_, rec), p in zip(df_rows.iterrows(), probs):
            p = float(np.clip(p, 0.0, 1.0))
            factors = extract_top_factors(booster, df_rows.loc[rec.name, features].to_numpy(dtype=np.float64), features, 3)
            district = str(rec.District)
            region_id = (region_ids or {}).get(normalize_district(district)) if region_ids is not None else None
            rows.append({
                "region": district,
                "region_id": region_id,
                "prediction_date": prediction_date,
                "horizon_weeks": H,
                "risk_score": round(p, 3),
                "top_factors": factors,
                "model_version": model_version,
                "generated_at": datetime.now(DHAKA).isoformat(timespec="seconds"),
                "_band_display": band_for_score(p),
            })
    return rows


def to_upsert_payload(rows: list[dict], name_to_id: dict[str, str]) -> list[dict]:
    unmatched = sorted({r["region"] for r in rows if normalize_district(r["region"]) not in name_to_id})
    if unmatched:
        raise ValueError(f"region name(s) not found in regions table: {unmatched}")
    return [{
        "region_id": name_to_id[normalize_district(r["region"])],
        "prediction_date": r["prediction_date"],
        "horizon_weeks": r["horizon_weeks"],
        "risk_score": r["risk_score"],
        "top_factors": r["top_factors"],
        "model_version": r["model_version"],
    } for r in rows]


def upsert_rows(rows: list[dict], client: Any | None = None):
    if client is None:
        cfg = get_supabase_config()
        if not cfg["url"] or not cfg["key"]:
            raise SystemExit("--commit requires AVASH_SUPABASE_URL and AVASH_SUPABASE_SERVICE_KEY (or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")
        try:
            from supabase import create_client
            client = create_client(cfg["url"], cfg["key"])
        except ImportError as exc:
            raise SystemExit("supabase package not installed; pip install -r ml/requirements.txt") from exc

    regions = client.table("regions").select("id,name").eq("admin_level", 2).execute().data or []
    name_to_id = {normalize_district(r["name"]): r["id"] for r in regions}
    id_to_name = {v: k for k, v in name_to_id.items()}
    csv_by_norm = {normalize_district(r["region"]): r["region"] for r in rows}
    payload = to_upsert_payload(rows, name_to_id)
    client.table("risk_predictions").upsert(payload, on_conflict="region_id,horizon_weeks,prediction_date").execute()

    try:
        client.rpc("refresh_region_risk_summary", {}).execute()
    except Exception as exc:  # noqa: BLE001
        log.warning("refresh_region_risk_summary RPC failed (%s)", exc)

    previous = {}
    try:
        prev_rows = (client.table("risk_predictions").select("region_id,horizon_weeks,prediction_date,risk_score")
                     .eq("horizon_weeks", 4).order("prediction_date", desc=True).limit(512).execute().data or [])
        seen = set()
        for r in prev_rows:
            if r["region_id"] not in seen:
                seen.add(r["region_id"])
                name = csv_by_norm.get(id_to_name.get(r["region_id"], ""))
                if name:
                    previous[name] = r["risk_score"]
    except Exception as exc:  # noqa: BLE001
        log.warning("could not read previous predictions: %s", exc)
    return payload, previous


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="print rows; touch nothing (default)")
    mode.add_argument("--commit", action="store_true", help="actually upsert to Supabase (needs env + network)")
    ap.add_argument("--live", action="store_true", help="query live Supabase tables for features instead of CSVs")
    ap.add_argument("--model-dir", default=str(config.ARTIFACT_DIR))
    ap.add_argument("--data-dir", default=str(config.DATA_DIR))
    ap.add_argument("--weekly", default=config.WEEKLY_CSV.name)
    ap.add_argument("--daily", default=config.DAILY_CSV.name)
    ap.add_argument("--population", default=config.POP_CSV.name)
    ap.add_argument("--feature-set", default=config.FEATURE_SET, choices=["A", "B"])
    ap.add_argument("--as-of", default=None, help="week_start (YYYY-MM-DD); default: latest in data")
    ap.add_argument("--out", default=None, help="write rows JSON here (default: stdout)")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    features = list(config.FEATURES_A if args.feature_set == "A" else config.FEATURES_B)

    client = None
    if args.commit or args.live:
        cfg = get_supabase_config()
        if cfg["url"] and cfg["key"]:
            try:
                from supabase import create_client
                client = create_client(cfg["url"], cfg["key"])
            except ImportError:
                pass

    if args.live and client:
        latest = fetch_live_features_from_supabase(client, as_of_date=args.as_of)
    else:
        data_dir = Path(args.data_dir)
        weekly = load_weekly(data_dir / args.weekly)
        daily = load_daily(data_dir / args.daily)
        pop = load_population(data_dir / args.population)
        df_feat = build_feature_frame(weekly, daily, pop, feature_set=args.feature_set)
        eleg = eligible_rows(df_feat, features)
        as_of = pd.Timestamp(args.as_of) if args.as_of else eleg.week_start.max()
        latest = eleg[eleg.week_start == as_of].sort_values("District", kind="mergesort")

    models = load_models(Path(args.model_dir))
    prediction_date = datetime.now(DHAKA).date().isoformat()
    rows = build_rows(latest, models, features, prediction_date, config.MODEL_VERSION, region_ids=None)

    if args.commit:
        payload, prev_by_name = upsert_rows(rows, client=client)
        crossings = detect_high_severe_crossings(prev_by_name or {}, rows, horizon_weeks=4)
        vapid_cfg = get_vapid_config()
        if crossings and vapid_cfg:
            transport = WebPushTransport(vapid_cfg["private_key"], vapid_cfg["subject"])
            subs = _load_push_subscriptions(client)
            result = dispatch_alerts(crossings, subs, transport)
            log.info("push dispatch: %s", result)
        print(json.dumps({"upserted": len(payload), "crossings": len(crossings)}, indent=2))
        return 0

    lines = [dict(r, risk_level=None) for r in rows]
    text = json.dumps(lines, indent=2, default=str)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"DRY-RUN: wrote {len(lines)} rows to {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
