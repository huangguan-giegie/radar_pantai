"""Beach list/detail snapshot parity and report/cleanup refresh inputs."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import insert

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_tests_core import api, signup
import app_core as impl
from beach_snapshots import build_beach_snapshots


def test_snapshot_matches_empty_live_beach_contract(api):
    application, client = api
    engine = application.extensions["marine_engine"]
    built = build_beach_snapshots(engine, impl)
    live = client.get("/beaches/morib").get_json()
    assert len(built["beaches"]) == len(client.get("/beaches").get_json())
    assert built["details"]["morib"] == live
    assert built["details"]["morib"]["composition"] is None
    assert "does-not-exist" not in built["details"]


def test_snapshot_reflects_new_counted_reports_and_composition(api):
    application, client = api
    user = signup(client)[0]["user"]["id"]
    now = datetime.now(timezone.utc)
    engine = application.extensions["marine_engine"]
    with engine.begin() as connection:
        connection.execute(insert(impl.reports_table).values(
            id="snapshot-counted-report", reporter_id=user, beach_id="morib",
            beach_name="Pantai Morib", quantities='{"Plastic":"Large"}',
            category="Plastic", quantity="Large", location_source="manual",
            photo_key="snapshot.jpg", photo_mime="image/jpeg",
            photo_stripped=True, status="Counted", created_at=now, updated_at=now,
            **impl.quantity_values({"Plastic": "Large"}),
        ))
    built = build_beach_snapshots(engine, impl, now=now)
    detail = built["details"]["morib"]
    assert detail["validReports"] == 1
    assert detail["composition"] == [{"category": "Plastic", "percentage": 100}]
    assert detail["compositionSource"]["reportId"] == "snapshot-counted-report"
    assert next(b for b in built["beaches"] if b["id"] == "morib")["validReports"] == 1
