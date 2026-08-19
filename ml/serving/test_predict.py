"""Tests for ml/serving/predict.py — the risk_predictions-empty guard and
crossing detection. Delivery itself (proximity match, push send) is
covered by test_push_delivery.py; these tests only exercise the wiring.

Run with: pytest ml/serving/test_predict.py
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
import predict  # noqa: E402


class _FakeQuery:
    def __init__(self, table_name: str, store: dict):
        self._table = table_name
        self._store = store
        self._filters: list[tuple] = []

    def select(self, _columns):
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def execute(self):
        rows = self._store.get(self._table, [])
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        return SimpleNamespace(data=rows)


class FakeSupabaseClient:
    def __init__(self, store: dict):
        self.store = store

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(name, self.store)


def test_batch_predict_returns_early_on_empty_risk_predictions(monkeypatch, caplog):
    client = FakeSupabaseClient({"risk_predictions": []})
    monkeypatch.setattr(predict, "_build_supabase_client", lambda: client)

    calls = []
    monkeypatch.setattr(predict, "_find_crossings", lambda predictions: calls.append(predictions) or [])

    with caplog.at_level(logging.INFO):
        predict.batch_predict()

    # The empty-table guard must return before crossing detection ever runs.
    assert calls == []
    assert any("risk_predictions is empty" in record.getMessage() for record in caplog.records)


def test_batch_predict_logs_and_returns_when_no_region_crosses(monkeypatch, caplog):
    client = FakeSupabaseClient(
        {
            "risk_predictions": [
                {"region_id": "r1", "horizon_weeks": 2, "risk_level": "low", "prediction_date": "2026-08-17"},
            ]
        }
    )
    monkeypatch.setattr(predict, "_build_supabase_client", lambda: client)

    delivered = []
    monkeypatch.setattr(predict, "deliver_region_alert", lambda *a, **k: delivered.append((a, k)) or 0)

    with caplog.at_level(logging.INFO):
        predict.batch_predict()

    assert delivered == []
    assert any("no region crossed into high/severe risk" in record.getMessage() for record in caplog.records)


def test_find_crossings_flags_first_time_high_with_no_prior_row():
    predictions = [
        {"region_id": "r1", "horizon_weeks": 2, "risk_level": "high", "prediction_date": "2026-08-17"},
    ]
    crossings = predict._find_crossings(predictions)
    assert [c["region_id"] for c in crossings] == ["r1"]


def test_find_crossings_skips_region_already_high_last_time():
    predictions = [
        {"region_id": "r1", "horizon_weeks": 2, "risk_level": "high", "prediction_date": "2026-08-17"},
        {"region_id": "r1", "horizon_weeks": 2, "risk_level": "severe", "prediction_date": "2026-08-16"},
    ]
    assert predict._find_crossings(predictions) == []


def test_find_crossings_flags_moderate_to_high_transition():
    predictions = [
        {"region_id": "r1", "horizon_weeks": 2, "risk_level": "high", "prediction_date": "2026-08-17"},
        {"region_id": "r1", "horizon_weeks": 2, "risk_level": "moderate", "prediction_date": "2026-08-16"},
    ]
    crossings = predict._find_crossings(predictions)
    assert [c["prediction_date"] for c in crossings] == ["2026-08-17"]


def test_find_crossings_ignores_low_and_moderate_latest():
    predictions = [
        {"region_id": "r1", "horizon_weeks": 2, "risk_level": "moderate", "prediction_date": "2026-08-17"},
        {"region_id": "r2", "horizon_weeks": 4, "risk_level": "low", "prediction_date": "2026-08-17"},
    ]
    assert predict._find_crossings(predictions) == []
