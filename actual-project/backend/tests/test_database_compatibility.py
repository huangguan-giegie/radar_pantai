"""Exercise retained database rows and connections across service restarts."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import MetaData, insert, select, text

import app_core as impl
from app import create_app
from api_tests_core import signup


@pytest.fixture
def retained_beach_api(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'retained.db'}"
    engine = impl.create_engine_for_url(database_url)
    beaches = impl.beaches_table.to_metadata(MetaData())
    beaches.c.lat.nullable = True
    beaches.c.lng.nullable = True
    beaches.create(engine)
    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        connection.execute(insert(beaches).values(
            id="retained-without-location", name="Retained beach", area="Selangor",
            lat=None, lng=None, habitat="Unverified", habitat_tag="UNAVAILABLE",
            sensitivity="Unknown", primary_species_glyph="fish", scene="Retained reference",
            ecological_note="No published location", created_at=now,
        ))
    engine.dispose()
    application = create_app(database_url=database_url, testing=True,
                             photo_storage_dir=tmp_path / "photos")
    yield application, application.test_client()
    application.extensions["marine_engine"].dispose()


def test_geo_resolution_skips_retained_beaches_without_coordinates(retained_beach_api):
    _, client = retained_beach_api
    _, headers = signup(client)
    response = client.post("/geo/resolve-beach", headers=headers,
                           json={"lat": 2.74614, "lng": 101.44024})
    assert response.status_code == 200
    assert response.json["id"] == "morib"


def test_check_in_without_beach_coordinates_preserves_attendance(retained_beach_api):
    application, client = retained_beach_api
    _, headers = signup(client)
    now = datetime.now(timezone.utc)
    with application.extensions["marine_engine"].begin() as connection:
        connection.execute(insert(impl.events_table).values(
            id="retained-location-event", beach_id="retained-without-location",
            starts_at=now - timedelta(minutes=30), ends_at=now + timedelta(minutes=30),
            status="Open", source="moderator", created_at=now, updated_at=now,
        ))
    assert client.post("/cleanup-events/retained-location-event/join", headers=headers).status_code == 200
    response = client.post("/cleanup-events/retained-location-event/check-in", headers=headers,
                           json={"lat": 2.74614, "lng": 101.44024})
    assert response.status_code == 409
    assert response.json["code"] == "LOCATION_UNAVAILABLE"
    with application.extensions["marine_engine"].connect() as connection:
        member = connection.execute(select(impl.event_members_table)).one()
        assert member.checked_in_at is None
        assert member.location_passed is False
        assert connection.execute(select(impl.community_event_attendance_table)).first() is None


def test_closed_idle_database_connection_is_replaced(tmp_path):
    engine = impl.create_engine_for_url(f"sqlite:///{tmp_path / 'connection.db'}")
    try:
        with engine.connect() as connection:
            raw = connection.connection.driver_connection
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
        raw.close()
        with engine.connect() as connection:
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
    finally:
        engine.dispose()


def test_postgres_pool_limits_can_be_configured_without_connecting(monkeypatch):
    monkeypatch.setenv("RADAR_DB_POOL_SIZE", "2")
    monkeypatch.setenv("RADAR_DB_MAX_OVERFLOW", "2")
    # Creating the engine is local and does not contact a real PostgreSQL host.
    engine = impl.create_engine_for_url("postgresql+psycopg://user:pass@localhost/db")
    try:
        assert engine.pool.size() == 2
        assert engine.pool._max_overflow == 2
    finally:
        engine.dispose()


def test_postgres_pool_rejects_invalid_limit(monkeypatch):
    monkeypatch.setenv("RADAR_DB_POOL_SIZE", "0")
    with pytest.raises(ValueError, match="Database pool size"):
        impl.create_engine_for_url("postgresql+psycopg://user:pass@localhost/db")
