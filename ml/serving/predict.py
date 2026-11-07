"""Batch inference entry point (`docs/PROJECT_PLAN.md` §5.3, ADR-002).

`cron-batch-predict.yml` runs this file directly inside a GitHub Actions runner
every `BATCH_PREDICT_CADENCE` (24h, §14) connecting to Supabase (ADR-007).
For any region crossing into `high`/`severe` risk, proximity-match against
`alert_subscriptions` and send Web Push via `push_delivery.py`.
"""

from __future__ import annotations

import hashlib
import logging
import os
import subprocess
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

# Default Hugging Face repository for production dengue surge models.
# Can be overridden via HF_MODEL_REPO_ID and HF_MODEL_TAG environment variables.
DEFAULT_HF_MODEL_REPO = "avash-health/avash-dengue-models"
DEFAULT_HF_MODEL_TAG = "v1.0.0"

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


def verify_file_sha256(path: Path, expected_sha256: str) -> bool:
    """Verifies that a file's SHA-256 matches the pinned expected hash."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest() == expected_sha256.lower()


def fetch_model_from_hub(
    repo_id: str | None = None,
    filename: str = "model.onnx",
    destination: Path | None = None,
    tag: str | None = None,
    expected_sha256: str | None = None,
) -> Path | None:
    """Retrieves a release-tagged ONNX artifact from Hugging Face Hub with disk cache fallback.

    Strict tag resolution is enforced via `tag` (or HF_MODEL_TAG env var, default: v1.0.0).
    If the file exists locally in disk cache, it is reused. If the network or Hugging Face Hub
    is unreachable, it falls back to the local cached artifact if present, or logs a warning
    and returns None cleanly without failing the batch job.
    """
    resolved_repo = repo_id or os.environ.get("HF_MODEL_REPO_ID", DEFAULT_HF_MODEL_REPO)
    resolved_tag = tag or os.environ.get("HF_MODEL_TAG", DEFAULT_HF_MODEL_TAG)
    resolved_sha = expected_sha256 or os.environ.get("HF_MODEL_SHA256")
    dest_path = destination or (Path(__file__).resolve().parent / "models" / filename)
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    if dest_path.exists():
        if not resolved_sha or verify_file_sha256(dest_path, resolved_sha):
            logger.info("Using cached model artifact: %s (tag: %s)", dest_path, resolved_tag)
            return dest_path
        logger.warning(
            "Cached model %s checksum mismatch; attempting refresh from %s@%s",
            dest_path,
            resolved_repo,
            resolved_tag,
        )

    try:
        from huggingface_hub import hf_hub_download

        logger.info(
            "Downloading %s from Hugging Face repo %s (tag: %s)...",
            filename,
            resolved_repo,
            resolved_tag,
        )
        downloaded_path = hf_hub_download(
            repo_id=resolved_repo,
            filename=filename,
            revision=resolved_tag,
            local_dir=str(dest_path.parent),
        )
        downloaded = Path(downloaded_path)

        if resolved_sha and not verify_file_sha256(downloaded, resolved_sha):
            raise RuntimeError(
                f"Downloaded artifact {filename} failed SHA-256 checksum verification against expected hash."
            )

        logger.info("Successfully fetched model %s@%s to %s", resolved_repo, resolved_tag, downloaded)
        return downloaded

    except Exception as err:
        logger.warning(
            "Hugging Face Hub model fetch failed for %s@%s (%s); evaluating disk cache fallback...",
            resolved_repo,
            resolved_tag,
            err,
        )

        if dest_path.exists():
            logger.info("Disk cache fallback: using previously cached model artifact at %s", dest_path)
            return dest_path

        logger.warning(
            "No cached local ONNX artifact found at %s; skipping inference pass gracefully without failing.",
            dest_path,
        )
        return None


def _refresh_materialized_views() -> None:
    """Triggers refresh materialized view concurrently region_risk_summary (ADR-006)."""
    script_path = Path(__file__).resolve().parents[2] / "scripts" / "refresh-materialized-views.ts"
    if script_path.exists():
        try:
            logger.info("Triggering materialized view refresh: %s", script_path)
            subprocess.run(["node", "--experimental-strip-types", str(script_path)], check=True, timeout=30)
            logger.info("Materialized view region_risk_summary refreshed successfully")
        except Exception as err:
            logger.warning("Materialized view refresh script failed: %s", err)


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
    _refresh_materialized_views()


if __name__ == "__main__":
    batch_predict()
