"""Web Push dispatcher for high/severe risk crossings (batch job only).

H=2 is SHADOW: horizon-2 rows are NEVER dispatched (they are computed and stored).
Push transports are injectable; tests use FakeTransport. pywebpush is imported
lazily only by WebPushTransport, so unit tests need neither network nor keys.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from ml.training import config

log = logging.getLogger(__name__)
ALERTED_BANDS = ("high", "severe")


def band_for_score(score: float) -> str:
    """Display band for a 0..1 score. The STORED band comes from the DB generated
    column — this helper is for dispatch decisions and console display only."""
    for ceiling, band in config.RISK_BANDS:
        if score < ceiling:
            return band
    return "severe"


def band_rank(band: str) -> int:
    return {"low": 0, "moderate": 1, "high": 2, "severe": 3}[band]


def detect_high_severe_crossings(previous: dict[str, float], current_rows: list[dict],
                                 horizon_weeks: int = 4) -> list[dict]:
    """Return alert dicts for rows whose band CROSSED INTO high/severe vs previous score.
    Rows for horizons other than 4 are ignored (H=2 shadow). Rows already in high/severe
    stay quiet unless they escalate (high->severe)."""
    crossings = []
    for row in current_rows:
        if row["horizon_weeks"] != horizon_weeks:
            continue
        score = float(row["risk_score"])
        band = band_for_score(score)
        if band not in ALERTED_BANDS:
            continue
        prev_score = previous.get(row["region"])
        prev_band = band_for_score(float(prev_score)) if prev_score is not None else "low"
        if band_rank(band) > band_rank(prev_band):
            crossings.append({**row, "band": band, "previous_band": prev_band})
    return crossings


def build_alert_payload(crossing: dict) -> dict:
    band = crossing["band"]
    return {
        "title": f"Dengue risk {band.upper()} — {crossing['region']}",
        "body": (f"Predicted {crossing['horizon_weeks']}-week surge risk for {crossing['region']} "
                 f"is {band} ({float(crossing['risk_score']):.2f}). Limit stagnant water and seek "
                 f"medical advice on symptoms. This is an early-warning notice, not medical advice."),
        "data": {
            "region": crossing["region"],
            "horizon_weeks": crossing["horizon_weeks"],
            "risk_score": round(float(crossing["risk_score"]), 3),
            "band": band,
            "model_version": crossing.get("model_version"),
            "url": "/risk-map",
        },
    }


class Transport(Protocol):
    def send(self, subscription: dict, payload: dict) -> None: ...


@dataclass
class FakeTransport:
    """Records sends; used by tests and --dry-run."""
    sent: list[dict] = field(default_factory=list)
    fail_on: frozenset[str] = frozenset()

    def send(self, subscription: dict, payload: dict) -> None:
        if subscription.get("id") in self.fail_on:
            raise RuntimeError(f"fake transport failure for {subscription.get('id')}")
        self.sent.append({"subscription": subscription, "payload": payload})


class WebPushTransport:  # pragma: no cover - requires VAPID keys + network
    def __init__(self, vapid_private_key: str, vapid_claims_email: str):
        from pywebpush import webpush  # lazy: not needed for tests
        self._webpush = webpush
        self.vapid_private_key = vapid_private_key
        self.vapid_claims_email = vapid_claims_email

    def send(self, subscription: dict, payload: dict) -> None:
        import json as _json
        sub_info = {
            "endpoint": subscription["endpoint"],
            "keys": subscription.get("keys") or {
                "p256dh": subscription.get("p256dh"),
                "auth": subscription.get("auth_key"),
            },
        }
        self._webpush(
            subscription_info=sub_info,
            data=_json.dumps(payload),
            vapid_private_key=self.vapid_private_key,
            vapid_claims={"sub": self.vapid_claims_email},
            ttl=86400,  # PUSH_TTL_SECONDS (24h)
        )


def dispatch_alerts(crossings: list[dict], subscriptions: list[dict], transport: Transport) -> dict:
    """Best-effort fan-out; a failing subscription never aborts the batch run."""
    sent, failed = 0, 0
    for crossing in crossings:
        payload = build_alert_payload(crossing)
        for sub in subscriptions:
            try:
                transport.send(sub, payload)
                sent += 1
            except Exception as exc:  # noqa: BLE001 - deliberate best-effort
                failed += 1
                log.error("push failed for region=%s sub=%s: %s", crossing.get("region"), sub.get("id"), exc)
    return {"alerts": len(crossings), "subscriptions": len(subscriptions), "sent": sent, "failed": failed}


def get_vapid_config() -> dict[str, str | None] | None:
    import os
    priv = os.environ.get("AVASH_VAPID_PRIVATE_KEY") or os.environ.get("VAPID_PRIVATE_KEY")
    if not priv:
        return None
    subject = (os.environ.get("AVASH_VAPID_SUBJECT") or
               os.environ.get("VAPID_SUBJECT") or
               "mailto:alerts@avash.app")
    pub = os.environ.get("AVASH_VAPID_PUBLIC_KEY") or os.environ.get("VAPID_PUBLIC_KEY")
    return {"private_key": priv, "subject": subject, "public_key": pub}


def _vapid_configured() -> bool:
    cfg = get_vapid_config()
    return bool(cfg and cfg.get("private_key") and cfg.get("subject"))


def load_push_subscriptions(client: Any | None = None, region_name: str | None = None) -> list[dict]:
    """Load active push subscriptions matching region proximity (or all active if region_name is None)."""
    if client is None:
        from ml.serving.live_features import get_supabase_config
        cfg = get_supabase_config()
        from supabase import create_client
        client = create_client(cfg["url"], cfg["key"])

    # 1. Fetch from push_subscriptions
    push_res = client.table("push_subscriptions").select("id,user_id,endpoint,p256dh,auth_key").execute()
    push_rows = getattr(push_res, "data", None) or []
    if not push_rows:
        return []

    valid_subs = []
    for r in push_rows:
        endpoint = r.get("endpoint")
        p256dh = r.get("p256dh")
        auth_key = r.get("auth_key")
        if endpoint and p256dh and auth_key:
            valid_subs.append({
                "id": r["id"],
                "user_id": r.get("user_id"),
                "endpoint": endpoint,
                "keys": {"p256dh": p256dh, "auth": auth_key},
            })

    if not region_name:
        return valid_subs

    # 2. Check region coordinates if proximity filtering is requested
    try:
        targets_res = client.table("region_ingest_targets").select("region_id,name,lat,lon").execute()
        targets = getattr(targets_res, "data", None) or []
        region_target = next((t for t in targets if str(t.get("name", "")).lower() == region_name.lower()), None)
        if not region_target or region_target.get("lat") is None or region_target.get("lon") is None:
            return valid_subs

        reg_lat, reg_lon = float(region_target["lat"]), float(region_target["lon"])

        # Fetch active alert subscriptions with geofence
        alerts_res = client.table("alert_subscriptions").select("id,user_id,geom,radius_m,active").eq("active", True).execute()
        alerts = getattr(alerts_res, "data", None) or []

        from ml.training.feature_engineering import haversine_km

        matched_user_ids = set()
        for a in alerts:
            uid = a.get("user_id")
            geom = a.get("geom")
            if isinstance(geom, dict) and geom.get("type") == "Point":
                coords = geom.get("coordinates")
                if coords and len(coords) >= 2:
                    sub_lon, sub_lat = float(coords[0]), float(coords[1])
                    dist_km = haversine_km(sub_lat, sub_lon, reg_lat, reg_lon)
                    radius_km = min(float(a.get("radius_m", 2000)), 20000.0) / 1000.0
                    if dist_km <= radius_km:
                        matched_user_ids.add(uid)

        if matched_user_ids:
            filtered = [sub for sub in valid_subs if sub.get("user_id") in matched_user_ids]
            return filtered if filtered else valid_subs
    except Exception as exc:  # noqa: BLE001
        log.warning("Proximity filtering failed (%s); falling back to all active subscribers", exc)

    return valid_subs


_load_push_subscriptions = load_push_subscriptions
