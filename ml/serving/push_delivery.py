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
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

from pywebpush import WebPushException, webpush

logger = logging.getLogger(__name__)

# ALERT_PROXIMITY_RADIUS_DEFAULT_M ceiling (docs/PROJECT_PLAN.md §14,
# docs/constants-registry.md). The `alert_subscriptions.radius_m` check
# constraint already bounds stored values to 100-20000, but the match
# below re-clamps defensively rather than trusting the stored value to
# still satisfy that constraint by the time this runs.
ALERT_PROXIMITY_RADIUS_CEILING_M = 20_000

# ANNOUNCEMENT_RADIUS_DEFAULT_M's ceiling (docs/constants-registry.md,
# bounds 500-50,000), mirroring the `announcements.radius_m` check
# constraint. Deliberately a separate constant from the subscription
# ceiling above: an announcement's radius is bounded by a different
# column with a different constraint, and a single shared number would
# make one of the two wrong the moment either constraint moves.
ANNOUNCEMENT_RADIUS_CEILING_M = 50_000

_EARTH_RADIUS_M = 6_371_000.0

# How long a push service should hold an undelivered message for a device
# that is offline, asleep, or has the browser closed (RFC 8030 `TTL`).
#
# NOT zero, which is what `pywebpush` sends when the caller omits it. TTL
# 0 means "deliver this instant or throw it away", so every subscriber
# whose laptop was shut or phone was idle silently got nothing — and
# Windows' push service (WNS) rejects TTL 0 outright, dropping the
# message with `400 Ttl value conflicts with X-WNS-Cache-Policy`, so
# every Edge and Windows subscriber failed 100% of the time regardless.
# Both were observed against real endpoints, not inferred.
#
# 24h matches BATCH_PREDICT_CADENCE: a risk alert that has not reached a
# device before the next scheduled run has been superseded by that run,
# so holding it longer would deliver stale news. Comfortably inside every
# push service's own ceiling (FCM 4 weeks, WNS 30 days).
PUSH_TTL_SECONDS = 86_400


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two WGS84 points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    a = min(1.0, max(0.0, a))  # guard float rounding at/near antipodal points
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_M * c


def decode_point_geojson(geom: Any) -> tuple[float, float]:
    """Decode a PostGIS `geometry(Point, 4326)` returned by PostgREST.

    PostGIS registers a `geometry -> json`/`jsonb` cast that emits GeoJSON
    (the same `ST_AsGeoJSON`-shaped output the `apps/api` route handlers
    already read via `row.geom.coordinates` — see
    `apps/api/src/lib/announcementDto.ts`'s `extractLatLng`), so a plain
    `select` over a geometry column comes back as a parsed
    `{"type": "Point", "coordinates": [lon, lat]}` dict, never a raw WKB
    string — `supabase-py`'s JSON response parsing hands this function a
    dict, not text.

    Returns `(lon, lat)` to match GeoJSON coordinate order.
    """
    if not isinstance(geom, dict) or geom.get("type") != "Point":
        raise ValueError(f"expected a GeoJSON Point, got {geom!r}")
    coordinates = geom.get("coordinates")
    if (
        not isinstance(coordinates, (list, tuple))
        or len(coordinates) != 2
        or not all(isinstance(c, (int, float)) for c in coordinates)
    ):
        raise ValueError(f"expected a two-element numeric coordinates array, got {coordinates!r}")
    lon, lat = coordinates
    return float(lon), float(lat)


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
    match_radius_m: float | None = None,
) -> list[PushTarget]:
    """Active `alert_subscriptions` near the given point, resolved to the
    `push_subscriptions` rows for those users.

    Two round trips, both filtered server-side as far as PostgREST allows
    (`active = true`, then `user_id in (...)`); the radius predicate itself
    is evaluated here per the module docstring.

    `match_radius_m` selects WHOSE radius decides the match, and the two
    callers genuinely need different answers:

    - `None` (a region crossing) — each subscription's OWN `radius_m`.
      The subscriber said "tell me about risk within 2km of my home", so
      the question is whether the region falls inside their circle.
    - a value (an announcement) — that fixed radius for every
      subscription. The author said "this notice concerns everyone within
      5km of here", so the question is whether the subscriber falls
      inside the ANNOUNCEMENT's circle. Using the subscriber's radius
      here would let someone with a 20km radius receive a notice posted
      for one neighbourhood, and would hide a 500m-radius subscriber
      standing inside a city-wide one. It also matches what
      `GET /api/announcements` already shows in-app
      (`announcementVisibleTo`), so the push and the feed cannot disagree
      about who an announcement is for.
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
            lon, lat = decode_point_geojson(geom)
        except ValueError as exc:
            logger.warning("skipping alert_subscription %s — unreadable geom: %s", row.get("id"), exc)
            continue
        # Each radius is clamped to ITS OWN table's ceiling. Reusing the
        # subscription ceiling for an announcement would silently shrink a
        # legitimate 50km broadcast to 20km — the two columns have
        # different check constraints and conflating them loses reach
        # rather than adding safety.
        if match_radius_m is not None:
            effective_radius_m = min(match_radius_m, ANNOUNCEMENT_RADIUS_CEILING_M)
        else:
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
    ttl_seconds: int = PUSH_TTL_SECONDS,
) -> None:
    """Send one Web Push message per target via `pywebpush`.

    `ttl_seconds` is how long the push service should hold the message
    for a device that is offline (see `PUSH_TTL_SECONDS` — the default is
    deliberately not zero).

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
                # A FRESH copy per send: pywebpush mutates this dict,
                # writing an `aud` claim derived from the endpoint's
                # origin. Reusing one dict across targets would sign the
                # second endpoint's request with the first endpoint's
                # audience, which every push service rejects.
                vapid_claims=dict(vapid_claims),
                ttl=max(0, int(ttl_seconds)),
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


def _seconds_until(expires_at: Any, now_iso: str) -> int:
    """Whole seconds between `now_iso` and `expires_at`, clamped to
    `PUSH_TTL_SECONDS` and never below 1.

    Returns the default TTL when either timestamp is unparseable — a
    push that cannot compute its own lifetime should still be
    deliverable, and 0 would mean "discard unless the device is awake
    this instant".
    """
    try:
        expiry = datetime.fromisoformat(str(expires_at))
        now = datetime.fromisoformat(now_iso)
    except (TypeError, ValueError):
        return PUSH_TTL_SECONDS
    remaining = int((expiry - now).total_seconds())
    return max(1, min(remaining, PUSH_TTL_SECONDS))


def deliver_pending_announcements(
    supabase_client: Any,
    vapid_public_key: str | None,
    vapid_private_key: str | None,
    vapid_claims: dict[str, str],
    now_iso: str,
) -> int:
    """Push every live announcement that has not been delivered yet.

    `docs/features/alerts.md` has always described an announcement as
    being visible in-app immediately and riding this job for push
    delivery, but nothing here ever read the table — so a published
    announcement notified nobody, and the only thing in the whole system
    that could produce a push was a region crossing into high/severe
    risk, which happens at most once a day and never in response to
    anything a person did.

    Reach is the announcement's own `radius_m` around its own point —
    `find_matching_push_targets(..., match_radius_m=...)`, the same circle
    `GET /api/announcements` uses in-app, so the push and the feed cannot
    disagree about who a notice is for.

    One deliberate difference from the feed: `target_roles` is NOT applied
    here. Role targeting needs each recipient's role, and a
    `push_subscriptions` row carries only a `user_id`; resolving a role
    per subscriber is a join this job does not do. A role-targeted
    announcement therefore pushes to everyone in range, and the targeting
    still applies when they open the app. That is a real over-delivery
    and it is recorded as such rather than papered over — narrowing it
    needs the role join, not a guess here.

    `pushed_at` is stamped after the send so a later run never re-pushes
    the same announcement (20260818000021). It is stamped even when the
    announcement matched nobody: "delivered to zero subscribers in range"
    is a completed delivery, and leaving it null would make the job
    re-scan it on every run forever.
    """
    if not vapid_private_key or not vapid_public_key:
        logger.warning("VAPID keys not configured — skipping announcement delivery")
        return 0

    response = (
        supabase_client.table("announcements")
        .select("id,title,body,geom,radius_m,expires_at")
        .is_("pushed_at", "null")
        .gt("expires_at", now_iso)
        .execute()
    )
    pending = response.data or []
    if not pending:
        logger.info("no undelivered announcements to push")
        return 0

    total_sent = 0
    for row in pending:
        announcement_id = row.get("id")
        radius_m = row.get("radius_m")
        if radius_m is None:
            logger.warning("skipping announcement %s — no radius_m", announcement_id)
            continue
        try:
            lon, lat = decode_point_geojson(row.get("geom"))
        except ValueError as exc:
            # Left undelivered on purpose: an unreadable point is a data
            # problem worth seeing again on the next run, not something
            # to mark as sent and forget.
            logger.warning("skipping announcement %s — unreadable geom: %s", announcement_id, exc)
            continue

        targets = find_matching_push_targets(supabase_client, lat, lon, match_radius_m=radius_m)
        if targets:
            send_push_notifications(
                supabase_client,
                targets,
                {
                    "title": row.get("title") or "Avash announcement",
                    "body": row.get("body") or "",
                    "announcementId": announcement_id,
                },
                vapid_private_key=vapid_private_key,
                vapid_claims=vapid_claims,
                # An announcement carries its own lifetime, so a device
                # that is offline past `expires_at` should never be woken
                # with it — "fogging tonight" delivered tomorrow is worse
                # than not delivered. Falls back to the default when the
                # timestamp cannot be read rather than dropping to 0,
                # which would mean "deliver this instant or discard".
                ttl_seconds=_seconds_until(row.get("expires_at"), now_iso),
            )
        total_sent += len(targets)

        supabase_client.table("announcements").update({"pushed_at": now_iso}).eq("id", announcement_id).execute()
        logger.info("announcement %s delivered — %d push attempt(s)", announcement_id, len(targets))

    return total_sent
