"""Unit tests for push payloads, crossing detection, best-effort dispatch."""
import pytest

from ml.serving import push_delivery as pd


def _row(region, score, horizon=4):
    return {"region": region, "prediction_date": "2026-11-09", "horizon_weeks": horizon,
            "risk_score": score, "model_version": "2.0.0"}


@pytest.mark.parametrize("score,band", [(0.0, "low"), (0.249, "low"), (0.25, "moderate"),
                                        (0.499, "moderate"), (0.5, "high"), (0.749, "high"),
                                        (0.75, "severe"), (1.0, "severe")])
def test_band_for_score(score, band):
    assert pd.band_for_score(score) == band


def test_crossing_into_high():
    prev = {"Dhaka": 0.4}
    cur = [_row("Dhaka", 0.6)]
    crossings = pd.detect_high_severe_crossings(prev, cur, horizon_weeks=4)
    assert [c["region"] for c in crossings] == ["Dhaka"]
    assert crossings[0]["previous_band"] == "moderate" and crossings[0]["band"] == "high"


def test_no_alert_when_already_high():
    prev = {"Dhaka": 0.6}
    cur = [_row("Dhaka", 0.65)]
    assert pd.detect_high_severe_crossings(prev, cur, horizon_weeks=4) == []


def test_high_to_severe_escalates():
    prev = {"Dhaka": 0.6}
    cur = [_row("Dhaka", 0.8)]
    crossings = pd.detect_high_severe_crossings(prev, cur, horizon_weeks=4)
    assert crossings and crossings[0]["band"] == "severe"


def test_below_high_never_alerts():
    prev = {}
    cur = [_row("Dhaka", 0.49), _row("Khulna", 0.7)]
    crossings = pd.detect_high_severe_crossings(prev, cur, horizon_weeks=4)
    assert [c["region"] for c in crossings] == ["Khulna"]


def test_h2_rows_never_alert():
    prev = {}
    cur = [_row("Dhaka", 0.9, horizon=2)]
    assert pd.detect_high_severe_crossings(prev, cur, horizon_weeks=4) == []


def test_payload_contract():
    crossing = {**_row("Dhaka", 0.81), "band": "severe", "previous_band": "moderate"}
    payload = pd.build_alert_payload(crossing)
    assert set(payload) == {"title", "body", "data"}
    assert payload["data"]["region"] == "Dhaka"
    assert payload["data"]["horizon_weeks"] == 4
    assert payload["data"]["band"] == "severe"
    assert "not medical advice" in payload["body"]


def test_dispatch_best_effort():
    crossings = [{**_row("Dhaka", 0.8), "band": "severe", "previous_band": "low"}]
    subs = [{"id": "s1"}, {"id": "s2"}, {"id": "s3"}]
    transport = pd.FakeTransport(fail_on=frozenset({"s2"}))
    result = pd.dispatch_alerts(crossings, subs, transport)
    assert result == {"alerts": 1, "subscriptions": 3, "sent": 2, "failed": 1}
    assert len(transport.sent) == 2
