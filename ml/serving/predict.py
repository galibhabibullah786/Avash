"""Batch inference entry point (`docs/PROJECT_PLAN.md` §5.3, ADR-002).

`cron-batch-predict.yml` runs this file directly inside a GitHub Actions
runner every `BATCH_PREDICT_CADENCE` (24h, §14) — plain Python, no
Cloudflare Worker involved, connecting straight to Supabase with the
service-role key (ADR-007). The onnxruntime scoring pass that actually
populates `risk_predictions` is a separate, already-landed concern; this
module picks up from an existing `risk_predictions` table and owns only
the delivery step described in §4: for any region whose latest prediction
just crossed into `high`/`severe` risk, proximity-match against
`alert_subscriptions` and send Web Push via `push_delivery.py`.

Safety property (do not remove): `batch_predict()` returns early, with a
clear log line, whenever `risk_predictions` has no rows. A cron guard
(`.github/workflows/cron-batch-predict.yml`) only skips this file when it
is completely empty — once it has real content, every scheduled run
executes for real, including sending real pushes. An empty
`risk_predictions` table is exactly the situation this early return
exists to make safe: there is nothing to alert on, and nothing here may
ever infer otherwise.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any

from supabase import Client, create_client

# No `ml/**/__init__.py` package markers exist (ml/ is a plain script
# tree, not an installed package), and this file is invoked both directly
# (`python ml/serving/predict.py`, matching sys.path[0] to this
# directory) and imported by tests from the repo root
# (`from ml.serving.predict import batch_predict`, which does not put
# this directory on sys.path). Adding it explicitly makes the following
# import work either way.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from push_delivery import deliver_region_alert  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# Risk bands that trigger a push (docs/PROJECT_PLAN.md §4, RISK_LEVEL_BANDS
# §14) — "moderate" and "low" never page a subscriber, only a crossing
# into one of these two.
_ALERTABLE_RISK_LEVELS = {"high", "severe"}

# Required by the Web Push VAPID protocol (RFC 8292) as an abuse contact,
# not a secret and not itself a threshold/limit, so it isn't a
# constants-registry entry — just a fixed claim sent with every push.
_VAPID_CLAIMS_SUBJECT = "mailto:alerts@avash.app"


def _build_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set")
    return create_client(url, key)


def _find_crossings(predictions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Latest prediction per (region_id, horizon_weeks) that just crossed
    into an alertable risk level — i.e. the previous prediction for that
    same region + horizon (if any) was not already `high`/`severe`.
    """
    groups: dict[tuple[Any, Any], list[dict[str, Any]]] = {}
    for row in predictions:
        key = (row.get("region_id"), row.get("horizon_weeks"))
        groups.setdefault(key, []).append(row)

    crossings: list[dict[str, Any]] = []
    for rows in groups.values():
        rows_sorted = sorted(rows, key=lambda r: r.get("prediction_date") or "", reverse=True)
        latest = rows_sorted[0]
        previous = rows_sorted[1] if len(rows_sorted) > 1 else None
        if latest.get("risk_level") not in _ALERTABLE_RISK_LEVELS:
            continue
        if previous is not None and previous.get("risk_level") in _ALERTABLE_RISK_LEVELS:
            continue
        crossings.append(latest)
    return crossings


def _region_centroid(supabase: Client, region_id: str) -> dict[str, Any] | None:
    # region_ingest_targets (packages/db/supabase/migrations/
    # 20260215000009_api_read_views.sql) already exposes ST_Centroid as
    # plain lat/lon numerics for exactly this reason — jobs never decode
    # polygon WKB themselves.
    response = (
        supabase.table("region_ingest_targets").select("region_id,code,name,lat,lon").eq("region_id", region_id).execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def batch_predict() -> None:
    supabase = _build_supabase_client()

    vapid_public_key = os.environ.get("VAPID_PUBLIC_KEY")
    vapid_private_key = os.environ.get("VAPID_PRIVATE_KEY")

    predictions = supabase.table("risk_predictions").select("*").execute().data or []
    if not predictions:
        logger.info("risk_predictions is empty — no risk alerts to score")
        return

    crossings = _find_crossings(predictions)
    if not crossings:
        logger.info("no region crossed into high/severe risk this run")
        return

    total_sent = 0
    for prediction in crossings:
        region = _region_centroid(supabase, prediction.get("region_id"))
        if region is None:
            logger.warning("skipping region %s — no region_ingest_targets row (deleted region?)", prediction.get("region_id"))
            continue

        payload = {
            "title": f"Dengue risk alert — {region.get('name')}",
            "body": f"Risk level is now {prediction.get('risk_level')} "
            f"for the next {prediction.get('horizon_weeks')} weeks.",
            "regionCode": region.get("code"),
            "riskLevel": prediction.get("risk_level"),
            "horizonWeeks": prediction.get("horizon_weeks"),
        }
        sent = deliver_region_alert(
            supabase,
            region_centroid_lat=region.get("lat"),
            region_centroid_lon=region.get("lon"),
            payload=payload,
            vapid_public_key=vapid_public_key,
            vapid_private_key=vapid_private_key,
            vapid_claims={"sub": _VAPID_CLAIMS_SUBJECT},
        )
        total_sent += sent
        logger.info("region %s crossed into %s — %d push attempt(s)", region.get("code"), prediction.get("risk_level"), sent)

    logger.info(
        "batch_predict delivery pass complete — %d region(s) crossed, %d risk push attempt(s)",
        len(crossings),
        total_sent,
    )


if __name__ == "__main__":
    batch_predict()
