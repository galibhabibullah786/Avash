"""Tests for ml/serving/push_delivery.py — proximity match + push send.

Run with: pytest ml/serving/test_push_delivery.py
(inside the ml container: `pnpm docker:ml pytest ml/serving`)
"""

from __future__ import annotations

import logging
import math
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from pywebpush import WebPushException

# No `ml/**/__init__.py` package markers exist and pytest's rootdir/import
# mode is not something this test should have to assume — add this
# directory explicitly, same trick ml/serving/predict.py uses, so a flat
# `import push_delivery` resolves regardless of how pytest is invoked.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import push_delivery  # noqa: E402
from push_delivery import (  # noqa: E402
    PushTarget,
    decode_point_geojson,
    find_matching_push_targets,
    haversine_distance_m,
    send_push_notifications,
)

CENTROID_LAT = 23.7
CENTROID_LON = 90.4
_METERS_PER_DEG_LAT = push_delivery._EARTH_RADIUS_M * math.pi / 180


def _geojson_point(lon: float, lat: float) -> dict:
    """The exact shape PostgREST returns for a `geometry(Point, 4326)`
    column — confirmed live against this project's own hosted Supabase
    instance (`GET .../rest/v1/announcements?select=id,geom`), not a
    hand-rolled guess. PostGIS's geometry->json cast is what produces
    this, and it is what `supabase-py`'s JSON parsing hands to a row —
    never a raw WKB hex string, which the old fixture here wrongly
    assumed.
    """
    return {
        "type": "Point",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "coordinates": [lon, lat],
    }


def _point_due_north(distance_m: float) -> tuple[float, float]:
    """A point exactly `distance_m` north of CENTROID_LAT/LON.

    Moving along a meridian makes the haversine great-circle distance
    reduce exactly to R * delta-latitude-in-radians, so this gives an
    exact, not approximate, distance fixture.
    """
    dlat_deg = distance_m / _METERS_PER_DEG_LAT
    return CENTROID_LAT + dlat_deg, CENTROID_LON


# --- haversine_distance_m -----------------------------------------------


def test_haversine_distance_m_matches_known_offset():
    lat, lon = _point_due_north(19_000)
    assert haversine_distance_m(CENTROID_LAT, CENTROID_LON, lat, lon) == pytest.approx(19_000, abs=1)


def test_haversine_distance_m_zero_for_identical_points():
    assert haversine_distance_m(CENTROID_LAT, CENTROID_LON, CENTROID_LAT, CENTROID_LON) == pytest.approx(0, abs=1e-6)


# --- decode_point_geojson --------------------------------------------------


def test_decode_point_geojson_round_trips():
    lon, lat = decode_point_geojson(_geojson_point(90.4123, 23.7456))
    assert lon == pytest.approx(90.4123)
    assert lat == pytest.approx(23.7456)


def test_decode_point_geojson_rejects_non_point():
    with pytest.raises(ValueError):
        decode_point_geojson({"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 0]]]})


def test_decode_point_geojson_rejects_malformed_coordinates():
    with pytest.raises(ValueError):
        decode_point_geojson({"type": "Point", "coordinates": [90.4]})


def test_decode_point_geojson_rejects_non_dict():
    # Guards against a stale assumption resurfacing — a hex WKB string,
    # or anything else that isn't the GeoJSON dict PostgREST actually
    # returns, must be rejected rather than silently mishandled.
    with pytest.raises(ValueError):
        decode_point_geojson("0101000020E6100000...")


# --- fake Supabase client (mimics the supabase-py table().select()...execute() chain) ---


class _FakeQuery:
    def __init__(self, table_name: str, store: dict):
        self._table = table_name
        self._store = store
        self._filters: list[tuple] = []
        self._op = "select"

    def select(self, _columns):
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def in_(self, col, vals):
        self._filters.append(("in", col, set(vals)))
        return self

    def delete(self):
        self._op = "delete"
        return self

    def is_(self, col, val):
        # PostgREST spells `is null` as the string "null", which is what
        # supabase-py passes through — not Python's None.
        self._filters.append(("is", col, None if val == "null" else val))
        return self

    def gt(self, col, val):
        self._filters.append(("gt", col, val))
        return self

    def update(self, patch):
        self._op = "update"
        self._patch = patch
        return self

    def _matching_rows(self):
        rows = self._store[self._table]
        for kind, col, val in self._filters:
            if kind == "eq":
                rows = [r for r in rows if r.get(col) == val]
            elif kind == "in":
                rows = [r for r in rows if r.get(col) in val]
            elif kind == "is":
                rows = [r for r in rows if r.get(col) is val]
            elif kind == "gt":
                rows = [r for r in rows if (r.get(col) or "") > val]
        return rows

    def execute(self):
        rows = self._matching_rows()
        if self._op == "delete":
            ids = {r["id"] for r in rows}
            self._store[self._table] = [r for r in self._store[self._table] if r["id"] not in ids]
        elif self._op == "update":
            for row in rows:
                row.update(self._patch)
        return SimpleNamespace(data=rows)


class FakeSupabaseClient:
    def __init__(self, store: dict):
        self.store = store

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(name, self.store)


# --- find_matching_push_targets -------------------------------------------


def test_find_matching_push_targets_19km_matches_20km_radius():
    near_lat, near_lon = _point_due_north(19_000)
    far_lat, far_lon = _point_due_north(21_000)

    store = {
        "alert_subscriptions": [
            {
                "id": "sub-near",
                "user_id": "user-near",
                "active": True,
                "geom": _geojson_point(near_lon, near_lat),
                "radius_m": 20_000,
            },
            {
                "id": "sub-far",
                "user_id": "user-far",
                "active": True,
                "geom": _geojson_point(far_lon, far_lat),
                "radius_m": 20_000,
            },
        ],
        "push_subscriptions": [
            {"id": "push-near", "user_id": "user-near", "endpoint": "https://push.example/near", "p256dh": "p-near", "auth_key": "a-near"},
            {"id": "push-far", "user_id": "user-far", "endpoint": "https://push.example/far", "p256dh": "p-far", "auth_key": "a-far"},
        ],
    }
    client = FakeSupabaseClient(store)

    targets = find_matching_push_targets(client, CENTROID_LAT, CENTROID_LON)

    assert [t.subscription_id for t in targets] == ["push-near"]


def test_find_matching_push_targets_ignores_inactive_subscriptions():
    near_lat, near_lon = _point_due_north(1_000)
    store = {
        "alert_subscriptions": [
            {"id": "sub-1", "user_id": "user-1", "active": False, "geom": _geojson_point(near_lon, near_lat), "radius_m": 20_000},
        ],
        "push_subscriptions": [
            {"id": "push-1", "user_id": "user-1", "endpoint": "e", "p256dh": "p", "auth_key": "a"},
        ],
    }
    client = FakeSupabaseClient(store)

    assert find_matching_push_targets(client, CENTROID_LAT, CENTROID_LON) == []


def test_find_matching_push_targets_clamps_radius_to_ceiling():
    # radius_m stored above the ceiling (shouldn't happen given the check
    # constraint, but the match must not trust it) — a point 20.5km out
    # must NOT match even though the stored radius claims 50000.
    far_lat, far_lon = _point_due_north(20_500)
    store = {
        "alert_subscriptions": [
            {"id": "sub-1", "user_id": "user-1", "active": True, "geom": _geojson_point(far_lon, far_lat), "radius_m": 50_000},
        ],
        "push_subscriptions": [
            {"id": "push-1", "user_id": "user-1", "endpoint": "e", "p256dh": "p", "auth_key": "a"},
        ],
    }
    client = FakeSupabaseClient(store)

    assert find_matching_push_targets(client, CENTROID_LAT, CENTROID_LON) == []


# --- send_push_notifications ------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code


def test_send_push_notifications_deletes_only_the_410_row(monkeypatch, caplog):
    store = {
        "push_subscriptions": [
            {"id": "push-1", "user_id": "u1", "endpoint": "https://push.example/1", "p256dh": "p1", "auth_key": "a1"},
            {"id": "push-2", "user_id": "u2", "endpoint": "https://push.example/2", "p256dh": "p2", "auth_key": "a2"},
        ]
    }
    client = FakeSupabaseClient(store)
    targets = [
        PushTarget("push-1", "https://push.example/1", "p1", "a1"),
        PushTarget("push-2", "https://push.example/2", "p2", "a2"),
    ]

    fake_private_key = "FAKE-VAPID-PRIVATE-KEY-DO-NOT-LEAK-INTO-LOGS"
    calls = []

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims, ttl):
        calls.append(subscription_info["endpoint"])
        if subscription_info["endpoint"].endswith("/1"):
            raise WebPushException("push service returned 410", response=_FakeResponse(410))
        raise WebPushException("push service returned 500", response=_FakeResponse(500))

    monkeypatch.setattr(push_delivery, "webpush", fake_webpush)

    with caplog.at_level(logging.INFO):
        send_push_notifications(
            client,
            targets,
            {"title": "risk update"},
            vapid_private_key=fake_private_key,
            vapid_claims={"sub": "mailto:test@example.com"},
        )

    # Both sends were attempted — one bad subscription did not stop the loop.
    assert calls == ["https://push.example/1", "https://push.example/2"]

    remaining_ids = {row["id"] for row in store["push_subscriptions"]}
    assert remaining_ids == {"push-2"}  # only the 410 row was deleted

    for record in caplog.records:
        assert fake_private_key not in record.getMessage()


def test_send_push_notifications_leaves_row_on_non_410_failure(monkeypatch):
    store = {
        "push_subscriptions": [
            {"id": "push-1", "user_id": "u1", "endpoint": "https://push.example/1", "p256dh": "p1", "auth_key": "a1"},
        ]
    }
    client = FakeSupabaseClient(store)
    targets = [PushTarget("push-1", "https://push.example/1", "p1", "a1")]

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims, ttl):
        raise WebPushException("boom", response=_FakeResponse(500))

    monkeypatch.setattr(push_delivery, "webpush", fake_webpush)

    send_push_notifications(
        client,
        targets,
        {"title": "risk update"},
        vapid_private_key="unused-in-this-test",
        vapid_claims={"sub": "mailto:test@example.com"},
    )

    assert [row["id"] for row in store["push_subscriptions"]] == ["push-1"]


def test_send_push_notifications_survives_unexpected_exception(monkeypatch):
    store = {
        "push_subscriptions": [
            {"id": "push-1", "user_id": "u1", "endpoint": "https://push.example/1", "p256dh": "p1", "auth_key": "a1"},
            {"id": "push-2", "user_id": "u2", "endpoint": "https://push.example/2", "p256dh": "p2", "auth_key": "a2"},
        ]
    }
    client = FakeSupabaseClient(store)
    targets = [
        PushTarget("push-1", "https://push.example/1", "p1", "a1"),
        PushTarget("push-2", "https://push.example/2", "p2", "a2"),
    ]

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims, ttl):
        if subscription_info["endpoint"].endswith("/1"):
            raise ConnectionError("network blip")
        return None  # second send succeeds

    monkeypatch.setattr(push_delivery, "webpush", fake_webpush)

    # Must not raise — one bad subscription cannot abort the batch.
    send_push_notifications(
        client,
        targets,
        {"title": "risk update"},
        vapid_private_key="unused-in-this-test",
        vapid_claims={"sub": "mailto:test@example.com"},
    )

    assert {row["id"] for row in store["push_subscriptions"]} == {"push-1", "push-2"}


# --- deliver_region_alert ---------------------------------------------------


def test_deliver_region_alert_skips_when_vapid_keys_missing(caplog):
    client = FakeSupabaseClient({"alert_subscriptions": [], "push_subscriptions": []})

    with caplog.at_level(logging.WARNING):
        sent = push_delivery.deliver_region_alert(
            client,
            region_centroid_lat=CENTROID_LAT,
            region_centroid_lon=CENTROID_LON,
            payload={"title": "x"},
            vapid_public_key=None,
            vapid_private_key=None,
            vapid_claims={"sub": "mailto:test@example.com"},
        )

    assert sent == 0
    assert any("VAPID keys not configured" in record.getMessage() for record in caplog.records)


# --- deliver_pending_announcements ------------------------------------------


def _announcement(**overrides) -> dict:
    row = {
        "id": "ann-1",
        "title": "Fogging tonight",
        "body": "Ward 12 will be fogged after 9pm.",
        "geom": _geojson_point(CENTROID_LON, CENTROID_LAT),
        "radius_m": 5_000,
        "expires_at": "2099-01-01T00:00:00+00:00",
        "pushed_at": None,
    }
    row.update(overrides)
    return row


def _subscriber_at(distance_m: float, *, radius_m: int, user_id: str, sub_id: str) -> dict:
    lat, lon = _point_due_north(distance_m)
    return {
        "id": sub_id,
        "user_id": user_id,
        "active": True,
        "geom": _geojson_point(lon, lat),
        "radius_m": radius_m,
    }


def _push_row(user_id: str, push_id: str) -> dict:
    return {
        "id": push_id,
        "user_id": user_id,
        "endpoint": f"https://push.example.com/{push_id}",
        "p256dh": "p",
        "auth_key": "a",
    }


def _deliver(client, monkeypatch, now_iso="2026-08-18T00:00:00+00:00"):
    sends: list[dict] = []
    monkeypatch.setattr(
        push_delivery,
        "webpush",
        lambda subscription_info, data, vapid_private_key, vapid_claims, ttl: sends.append(
            {"endpoint": subscription_info["endpoint"], "data": data}
        ),
    )
    count = push_delivery.deliver_pending_announcements(
        client,
        vapid_public_key="pub",
        vapid_private_key="priv",
        vapid_claims={"sub": "mailto:test@example.com"},
        now_iso=now_iso,
    )
    return count, sends


def test_deliver_pending_announcements_reaches_a_subscriber_inside_the_announcement_radius(monkeypatch):
    store = {
        "announcements": [_announcement(radius_m=5_000)],
        # A tight 500m personal radius: under the region-crossing rule
        # this subscriber would NOT match at 3km out, but an announcement
        # asks who is inside ITS circle, not inside theirs.
        "alert_subscriptions": [_subscriber_at(3_000, radius_m=500, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    count, sends = _deliver(FakeSupabaseClient(store), monkeypatch)

    assert count == 1
    assert len(sends) == 1
    assert "Fogging tonight" in sends[0]["data"]


def test_deliver_pending_announcements_skips_a_subscriber_outside_the_announcement_radius(monkeypatch):
    store = {
        "announcements": [_announcement(radius_m=5_000)],
        # A 20km personal radius does not buy a seat at a 5km broadcast:
        # the announcement's own circle is what decides.
        "alert_subscriptions": [_subscriber_at(9_000, radius_m=20_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    count, sends = _deliver(FakeSupabaseClient(store), monkeypatch)

    assert count == 0
    assert sends == []


def test_deliver_pending_announcements_stamps_pushed_at_so_the_next_run_does_not_repeat_it(monkeypatch):
    store = {
        "announcements": [_announcement()],
        "alert_subscriptions": [_subscriber_at(1_000, radius_m=2_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    client = FakeSupabaseClient(store)

    first_count, first_sends = _deliver(client, monkeypatch)
    assert first_count == 1
    assert store["announcements"][0]["pushed_at"] == "2026-08-18T00:00:00+00:00"

    # A second scheduled run must find nothing — without the stamp every
    # run would re-push every live announcement.
    second_count, second_sends = _deliver(client, monkeypatch)
    assert second_count == 0
    assert second_sends == []


def test_deliver_pending_announcements_stamps_even_when_nobody_was_in_range(monkeypatch):
    store = {
        "announcements": [_announcement(radius_m=1_000)],
        "alert_subscriptions": [_subscriber_at(50_000, radius_m=20_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    client = FakeSupabaseClient(store)
    count, sends = _deliver(client, monkeypatch)

    # Delivered to zero subscribers is still delivered; leaving it null
    # would make every future run re-scan this row forever.
    assert (count, sends) == (0, [])
    assert store["announcements"][0]["pushed_at"] == "2026-08-18T00:00:00+00:00"


def test_deliver_pending_announcements_ignores_an_already_delivered_row(monkeypatch):
    store = {
        "announcements": [_announcement(pushed_at="2026-08-17T00:00:00+00:00")],
        "alert_subscriptions": [_subscriber_at(1_000, radius_m=2_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    count, sends = _deliver(FakeSupabaseClient(store), monkeypatch)
    assert (count, sends) == (0, [])


def test_deliver_pending_announcements_ignores_an_expired_row(monkeypatch):
    store = {
        "announcements": [_announcement(expires_at="2020-01-01T00:00:00+00:00")],
        "alert_subscriptions": [_subscriber_at(1_000, radius_m=2_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    count, sends = _deliver(FakeSupabaseClient(store), monkeypatch)
    assert (count, sends) == (0, [])


def test_deliver_pending_announcements_leaves_an_unreadable_geom_undelivered(monkeypatch, caplog):
    store = {
        "announcements": [_announcement(geom="not-geojson")],
        "alert_subscriptions": [_subscriber_at(1_000, radius_m=2_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    client = FakeSupabaseClient(store)
    with caplog.at_level(logging.WARNING):
        count, sends = _deliver(client, monkeypatch)

    assert (count, sends) == (0, [])
    # NOT stamped: a data problem should resurface next run, not be
    # silently marked as sent.
    assert store["announcements"][0]["pushed_at"] is None
    assert any("unreadable geom" in record.getMessage() for record in caplog.records)


def test_deliver_pending_announcements_skips_entirely_without_vapid_keys(caplog):
    store = {"announcements": [_announcement()], "alert_subscriptions": [], "push_subscriptions": []}
    with caplog.at_level(logging.WARNING):
        sent = push_delivery.deliver_pending_announcements(
            FakeSupabaseClient(store),
            vapid_public_key=None,
            vapid_private_key=None,
            vapid_claims={"sub": "mailto:test@example.com"},
            now_iso="2026-08-18T00:00:00+00:00",
        )

    assert sent == 0
    # Crucially NOT stamped — a run that could not send must not mark the
    # announcement as delivered, or it would never go out.
    assert store["announcements"][0]["pushed_at"] is None
    assert any("VAPID keys not configured" in record.getMessage() for record in caplog.records)


def test_announcement_radius_clamps_to_its_own_50km_ceiling_not_the_20km_subscription_one(monkeypatch):
    store = {
        "announcements": [_announcement(radius_m=45_000)],
        "alert_subscriptions": [_subscriber_at(30_000, radius_m=500, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    count, sends = _deliver(FakeSupabaseClient(store), monkeypatch)

    # 30km out is inside a 45km broadcast. Reusing the subscription
    # ceiling (20km) here would have silently dropped this recipient.
    assert count == 1
    assert len(sends) == 1


# --- TTL --------------------------------------------------------------------


def _capture_ttl(monkeypatch) -> list:
    seen: list = []

    def fake_webpush(subscription_info, data, vapid_private_key, vapid_claims, ttl):
        seen.append({"ttl": ttl, "aud": vapid_claims.get("aud"), "endpoint": subscription_info["endpoint"]})
        # pywebpush MUTATES the claims dict it is handed, writing an
        # `aud` derived from the endpoint. Reproduced here because the
        # bug it causes — signing endpoint B with endpoint A's audience —
        # is invisible unless the double is equally rude.
        vapid_claims["aud"] = subscription_info["endpoint"].split("/", 3)[0:3]

    monkeypatch.setattr(push_delivery, "webpush", fake_webpush)
    return seen


def test_send_push_notifications_never_uses_ttl_zero(monkeypatch):
    seen = _capture_ttl(monkeypatch)
    client = FakeSupabaseClient({"push_subscriptions": []})

    send_push_notifications(
        client,
        [PushTarget(subscription_id="p1", endpoint="https://push.example.com/1", p256dh="p", auth_key="a")],
        {"title": "x"},
        vapid_private_key="k",
        vapid_claims={"sub": "mailto:test@example.com"},
    )

    # TTL 0 means "deliver this instant or discard", so a closed laptop
    # gets nothing — and Windows' push service rejects it outright with
    # `400 Ttl value conflicts with X-WNS-Cache-Policy`, which made every
    # Edge/Windows subscriber undeliverable.
    assert seen[0]["ttl"] == push_delivery.PUSH_TTL_SECONDS
    assert seen[0]["ttl"] > 0


def test_each_send_gets_its_own_claims_dict(monkeypatch):
    seen = _capture_ttl(monkeypatch)
    client = FakeSupabaseClient({"push_subscriptions": []})
    claims = {"sub": "mailto:test@example.com"}

    send_push_notifications(
        client,
        [
            PushTarget(subscription_id="p1", endpoint="https://a.example.com/1", p256dh="p", auth_key="a"),
            PushTarget(subscription_id="p2", endpoint="https://b.example.com/2", p256dh="p", auth_key="a"),
        ],
        {"title": "x"},
        vapid_private_key="k",
        vapid_claims=claims,
    )

    # Neither send may inherit the other's audience, and the caller's own
    # dict must come back unmodified.
    assert seen[0]["aud"] is None and seen[1]["aud"] is None
    assert claims == {"sub": "mailto:test@example.com"}


def test_announcement_ttl_follows_its_own_expiry(monkeypatch):
    store = {
        "announcements": [_announcement(expires_at="2026-08-18T02:00:00+00:00")],
        "alert_subscriptions": [_subscriber_at(1_000, radius_m=2_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    seen = _capture_ttl(monkeypatch)
    push_delivery.deliver_pending_announcements(
        FakeSupabaseClient(store),
        vapid_public_key="pub",
        vapid_private_key="priv",
        vapid_claims={"sub": "mailto:test@example.com"},
        now_iso="2026-08-18T00:00:00+00:00",
    )

    # Two hours left, so the push service must not wake a device with it
    # tomorrow — "fogging tonight" delivered late is worse than dropped.
    assert seen[0]["ttl"] == 7_200


def test_announcement_ttl_clamps_to_the_default_ceiling(monkeypatch):
    store = {
        "announcements": [_announcement(expires_at="2099-01-01T00:00:00+00:00")],
        "alert_subscriptions": [_subscriber_at(1_000, radius_m=2_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    seen = _capture_ttl(monkeypatch)
    push_delivery.deliver_pending_announcements(
        FakeSupabaseClient(store),
        vapid_public_key="pub",
        vapid_private_key="priv",
        vapid_claims={"sub": "mailto:test@example.com"},
        now_iso="2026-08-18T00:00:00+00:00",
    )

    assert seen[0]["ttl"] == push_delivery.PUSH_TTL_SECONDS


def test_announcement_ttl_falls_back_rather_than_dropping_to_zero_on_a_bad_timestamp(monkeypatch):
    store = {
        "announcements": [_announcement(expires_at="not-a-timestamp")],
        "alert_subscriptions": [_subscriber_at(1_000, radius_m=2_000, user_id="u1", sub_id="s1")],
        "push_subscriptions": [_push_row("u1", "push-1")],
    }
    seen = _capture_ttl(monkeypatch)
    push_delivery.deliver_pending_announcements(
        FakeSupabaseClient(store),
        vapid_public_key="pub",
        vapid_private_key="priv",
        vapid_claims={"sub": "mailto:test@example.com"},
        now_iso="2026-08-18T00:00:00+00:00",
    )

    assert seen[0]["ttl"] == push_delivery.PUSH_TTL_SECONDS
