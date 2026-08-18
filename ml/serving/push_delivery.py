"""Proximity match + Web Push delivery for a region crossing into high/severe risk.

ADR-007: this module talks to Supabase directly with the service-role key
(the same client `ml/serving/predict.py` already holds for `risk_predictions`)
— never through an `apps/api` HTTP endpoint. ADR-002: this only ever runs
inside the GitHub Actions batch job, never per-request.

`docs/PROJECT_PLAN.md` §4 specifies the match as `ST_DWithin(alert_subscriptions.geom,
region_centroid, alert_subscriptions.radius_m)`. PostgREST — the API
`supabase-py` talks to — cannot express `ST_DWithin` as a filter; the
existing pattern for pushing a spatial predicate like that into SQL is a
`security invoker` database function owned by a migration (see
`public.blood_within_radius` in
`packages/db/supabase/migrations/20260815000012_app_role_and_resource_reads.sql`).
Adding a new migration is out of scope for this slice, so the match is
computed here instead: fetch active `alert_subscriptions`, decode each
row's stored `geom` point, and keep the ones within a geodesic
(great-circle) distance of the region centroid — the same notion of
"within" that PostGIS's geography-cast `ST_DWithin` uses. If a future
slice adds the RPC function, this module's `find_matching_push_targets`
is the one place that would switch to calling it.
"""

from __future__ import annotations

import json
import logging
import math
import struct
from dataclasses import dataclass
from typing import Any, Iterable

from pywebpush import WebPushException, webpush

logger = logging.getLogger(__name__)

# ALERT_PROXIMITY_RADIUS_DEFAULT_M ceiling (docs/PROJECT_PLAN.md §14,
# docs/constants-registry.md). The `alert_subscriptions.radius_m` check
# constraint already bounds stored values to 100-20000, but the match
# below re-clamps defensively rather than trusting the stored value to
# still satisfy that constraint by the time this runs.
ALERT_PROXIMITY_RADIUS_CEILING_M = 20_000

_EARTH_RADIUS_M = 6_371_000.0

# Postgres's EWKB type header sets this bit when an SRID follows the type
# word — every geom column in this schema is SRID 4326, so it is always
# set in practice, but the parser checks the flag rather than assuming.
_WKB_SRID_FLAG = 0x20000000
_WKB_POINT_TYPE = 1


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two WGS84 points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    a = min(1.0, max(0.0, a))  # guard float rounding at/near antipodal points
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_M * c


def decode_point_wkb(hex_ewkb: str) -> tuple[float, float]:
    """Decode a PostGIS `geometry(Point, 4326)` returned by PostgREST.

    A plain `select` over a geometry column comes back as Postgres's text
    output for `geometry`, which is extended WKB (EWKB) hex — there is no
    view here doing the `ST_X`/`ST_Y` conversion PostgREST itself cannot
    do (see module docstring).

    Returns `(lon, lat)` to match GeoJSON coordinate order.
    """
    raw = bytes.fromhex(hex_ewkb)
    byte_order = raw[0]
    endian = "<" if byte_order == 1 else ">"
    geom_type = struct.unpack_from(endian + "I", raw, 1)[0]
    if (geom_type & 0xFFFF) != _WKB_POINT_TYPE:
        raise ValueError(f"expected a Point geometry, got wkb type {geom_type:#x}")
    offset = 5
    if geom_type & _WKB_SRID_FLAG:
        offset += 4
    x, y = struct.unpack_from(endian + "dd", raw, offset)
    return x, y


@dataclass(frozen=True)
class PushTarget:
    """One `push_subscriptions` row to send to."""

    subscription_id: str
    endpoint: str
    p256dh: str
    auth_key: str


def find_matching_push_targets(
    supabase_client: Any,
    region_centroid_lat: float,
    region_centroid_lon: float,
) -> list[PushTarget]:
    """Active `alert_subscriptions` within their own radius of the region
    centroid, resolved to the `push_subscriptions` rows for those users.

    Two round trips, both filtered server-side as far as PostgREST allows
    (`active = true`, then `user_id in (...)`); the radius predicate itself
    is evaluated here per the module docstring.
    """
    subs_response = (
        supabase_client.table("alert_subscriptions")
        .select("id,user_id,geom,radius_m")
        .eq("active", True)
        .execute()
    )
    subscriptions = subs_response.data or []

    matched_user_ids: set[str] = set()
    for row in subscriptions:
        geom = row.get("geom")
        user_id = row.get("user_id")
        radius_m = row.get("radius_m")
        if not geom or not user_id or radius_m is None:
            continue
        try:
            lon, lat = decode_point_wkb(geom)
        except (ValueError, struct.error) as exc:
            logger.warning("skipping alert_subscription %s — unreadable geom: %s", row.get("id"), exc)
            continue
        effective_radius_m = min(radius_m, ALERT_PROXIMITY_RADIUS_CEILING_M)
        distance_m = haversine_distance_m(region_centroid_lat, region_centroid_lon, lat, lon)
        if distance_m <= effective_radius_m:
            matched_user_ids.add(user_id)

    if not matched_user_ids:
        return []

    push_response = (
        supabase_client.table("push_subscriptions")
        .select("id,user_id,endpoint,p256dh,auth_key")
        .in_("user_id", list(matched_user_ids))
        .execute()
    )
    push_rows = push_response.data or []
    return [
        PushTarget(
            subscription_id=row["id"],
            endpoint=row["endpoint"],
            p256dh=row["p256dh"],
            auth_key=row["auth_key"],
        )
        for row in push_rows
        if row.get("endpoint") and row.get("p256dh") and row.get("auth_key")
    ]


def send_push_notifications(
    supabase_client: Any,
    targets: Iterable[PushTarget],
    payload: dict[str, Any],
    vapid_private_key: str,
    vapid_claims: dict[str, str],
) -> None:
    """Send one Web Push message per target via `pywebpush`.

    A `410 Gone` means the browser unsubscribed or the endpoint expired —
    that `push_subscriptions` row is deleted. Any other failure (network
    error, non-410 HTTP status, etc.) is logged and skipped so one bad
    subscription never aborts the rest of the batch. Neither the exception
    nor any log line here ever includes `vapid_private_key` — pywebpush
    uses it to sign the request, it never appears in a response or in the
    exception it raises.
    """
    for target in targets:
        try:
            webpush(
                subscription_info={
                    "endpoint": target.endpoint,
                    "keys": {"p256dh": target.p256dh, "auth": target.auth_key},
                },
                data=json.dumps(payload),
                vapid_private_key=vapid_private_key,
                vapid_claims=dict(vapid_claims),
            )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code == 410:
                logger.info("push subscription %s is gone (410) — deleting", target.subscription_id)
                supabase_client.table("push_subscriptions").delete().eq("id", target.subscription_id).execute()
            else:
                logger.warning("push send failed for subscription %s (status=%s)", target.subscription_id, status_code)
        except Exception:  # noqa: BLE001 - one bad subscription must not abort the batch
            logger.warning("push send failed for subscription %s (unexpected error)", target.subscription_id)


def deliver_region_alert(
    supabase_client: Any,
    region_centroid_lat: float,
    region_centroid_lon: float,
    payload: dict[str, Any],
    vapid_public_key: str | None,
    vapid_private_key: str | None,
    vapid_claims: dict[str, str],
) -> int:
    """Full proximity-match + send pass for one region that just crossed
    into `high`/`severe` risk. Returns the number of push attempts made.

    Both VAPID halves are required arguments, read by the caller from the
    environment (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) and never logged
    here or by the caller — see `docs/security/secrets-matrix.md` §7.
    `vapid_public_key` is not passed to `pywebpush` (the browser already
    bound the public key when it created the subscription); its presence
    is still required as a misconfiguration check.
    """
    if not vapid_private_key or not vapid_public_key:
        logger.warning("VAPID keys not configured — skipping push delivery for this region")
        return 0

    targets = find_matching_push_targets(supabase_client, region_centroid_lat, region_centroid_lon)
    if not targets:
        return 0

    send_push_notifications(
        supabase_client,
        targets,
        payload,
        vapid_private_key=vapid_private_key,
        vapid_claims=vapid_claims,
    )
    return len(targets)
