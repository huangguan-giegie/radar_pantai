"""Reviewed Radar Pantai API entry point.

The Iteration 2 backend implementation lives in ``app_core.py``. This thin
entry point keeps that implementation intact while enforcing the reviewed
Iteration 2 contracts that must not regress during integration:

* account recovery always requires the recovery token;
* GPS duplicate detection compares active unresolved category/band state inside
  the privacy-preserving 10 metre boundary;
* cleanup changes each report's current score before the active-report beach median is taken;
* fully cleared reports stay in history but leave the current score and active count;
* automatic weekly events are created only for Moderate, High, or Severe beaches;
* public litter galleries expose only beach-scoped signed historical report photos;
* PostgreSQL Iteration 2 tables receive the same integrity constraints as the
  release migration, even if an application process creates them first.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path
from statistics import median
import threading
import time
from typing import Any

from flask import g, jsonify, request
from sqlalchemy import inspect, select, text

import app_core as _impl
from app_core import *  # noqa: F401,F403 - preserve the public module contract
from litter_gallery import install_litter_gallery
from standalone_cleanup import (
    _active_quantities,
    _current_band_state,
    configure_cleanup_schema,
    install_cleanup_route,
)
from v3_contract import install_v3_contract
from account import install_account
from insights import install_insights
from beach_snapshots import install_beach_snapshots
from recurrence import install_recurrence
from recommendations import install_recommendations
from species_questions import install_species_questions
from wildlife import install_wildlife


configure_cleanup_schema(_impl)

_original_create_app = _impl.create_app
_original_initialise_database = _impl.initialise_database
_original_nearby_proximity_refs = _impl.nearby_proximity_refs
# The stored note has to describe the rule the API actually applies: the
# comparison uses each report's current bands after any cleanup, and the match
# is kept in history rather than rejected.
GEO_DUPLICATE_NOTE_PREFIX = "Matching report within 10 metres:"
GEO_DUPLICATE_NOTE = (
    GEO_DUPLICATE_NOTE_PREFIX
    + " an active report already records the same current categories and quantity bands."
    + " This report is saved here but left out of the beach rating."
)
WEEKLY_EVENT_SEVERITIES = {"Moderate", "High", "Severe"}


def _qualified_table(name: str) -> str:
    schema = _impl.database_schema()
    return f'"{schema}".{name}' if schema else name


def _constraint_exists(connection: Any, table_name: str, constraint_name: str) -> bool:
    schema_name = _impl.database_schema()
    if not schema_name:
        schema_name = connection.execute(text("SELECT current_schema()" )).scalar_one()
    return connection.execute(
        text(
            """
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE c.conname = :constraint_name
              AND t.relname = :table_name
              AND n.nspname = :schema_name
            """
        ),
        {
            "constraint_name": constraint_name,
            "table_name": table_name,
            "schema_name": schema_name,
        },
    ).first() is not None


def _ensure_postgres_iteration2_contract(engine: Any) -> None:
    """Bring runtime-created PostgreSQL tables up to the migration contract."""
    if engine.dialect.name != "postgresql":
        return

    q = _qualified_table
    definitions = [
        ("community_events", "community_events_beach_fk", f"FOREIGN KEY (beach_id) REFERENCES {q('beaches')}(id)"),
        ("community_events", "community_events_created_by_fk", f"FOREIGN KEY (created_by) REFERENCES {q('users')}(id)"),
        ("community_events", "community_events_status_check", "CHECK (status IN ('Open','Closed'))"),
        ("community_events", "community_events_source_check", "CHECK (source IN ('scheduled','moderator'))"),
        ("community_events", "community_events_time_check", "CHECK (ends_at > starts_at)"),
        ("community_event_members", "community_event_members_event_fk", f"FOREIGN KEY (event_id) REFERENCES {q('community_events')}(id) ON DELETE CASCADE"),
        ("community_event_members", "community_event_members_participant_fk", f"FOREIGN KEY (participant_id) REFERENCES {q('users')}(id)"),
        ("community_event_members", "community_event_members_location_check", "CHECK (location_passed = (checked_in_at IS NOT NULL))"),
        ("cleanup_actions", "cleanup_actions_target_report_fk", f"FOREIGN KEY (target_report_id) REFERENCES {q('reports')}(id)"),
        ("cleanup_actions", "cleanup_actions_participant_fk", f"FOREIGN KEY (participant_id) REFERENCES {q('users')}(id)"),
        ("cleanup_actions", "cleanup_actions_event_fk", f"FOREIGN KEY (event_id) REFERENCES {q('community_events')}(id)"),
        ("cleanup_actions", "cleanup_actions_beach_fk", f"FOREIGN KEY (beach_id) REFERENCES {q('beaches')}(id)"),
        ("cleanup_actions", "cleanup_actions_total_removed_check", "CHECK (total_removed > 0)"),
        ("cleanup_actions", "cleanup_actions_handling_check", "CHECK (handling IN ('Collected for disposal','Recycled / handled','Not recorded'))"),
        ("reports", "reports_event_fk", f"FOREIGN KEY (event_id) REFERENCES {q('community_events')}(id)"),
    ]

    with engine.begin() as connection:
        # Iteration 2 added the optional meeting point that the event screens
        # show; runtime-created tables need it added in place.
        connection.execute(text(f"ALTER TABLE {q('community_events')} ADD COLUMN IF NOT EXISTS meeting_point VARCHAR(160)"))
        connection.execute(text(f"ALTER TABLE {q('cleanup_actions')} ALTER COLUMN target_report_id DROP NOT NULL"))
        for table_name, constraint_name, definition in definitions:
            if _constraint_exists(connection, table_name, constraint_name):
                continue
            connection.execute(text(f'ALTER TABLE {q(table_name)} ADD CONSTRAINT "{constraint_name}" {definition}'))

        schema = _impl.database_schema()
        index_name = f'"{schema}".cleanup_actions_target' if schema else "cleanup_actions_target"
        connection.execute(text(f"DROP INDEX IF EXISTS {index_name}"))
        connection.execute(text(f"CREATE INDEX cleanup_actions_target ON {q('cleanup_actions')} (target_report_id, created_at)"))


def _repair_exact_duplicate_statuses(engine: Any) -> None:
    """Do not rewrite historical duplicate decisions during startup."""
    return None


def _ensure_report_columns_single_connection(engine: Any) -> None:
    """Apply startup report DDL without reflecting through a second pooled connection."""
    schema = _impl.database_schema() if engine.dialect.name != "sqlite" else None
    inspector = inspect(engine)
    if "reports" not in inspector.get_table_names(schema=schema):
        return
    column_info = inspector.get_columns("reports", schema=schema)
    existing = {column["name"] for column in column_info}
    column_types = {column["name"]: column["type"].__class__.__name__.lower() for column in column_info}
    additions = {
        "beach_name": "VARCHAR(160)",
        "quantities": "TEXT",
        "photo_mime": "VARCHAR(64)",
        "photo_stripped": "BOOLEAN",
        **{column: "VARCHAR(20)" for column in _impl.QUANTITY_COLUMNS.values()},
        "lat": "DOUBLE PRECISION",
        "lng": "DOUBLE PRECISION",
        "item_counts": "TEXT",
        "proximity_ref": "VARCHAR(64)",
        "event_id": "VARCHAR(100)",
        "status_note": "TEXT",
        "updated_at": "TIMESTAMP WITH TIME ZONE",
        "deleted_at": "TIMESTAMP WITH TIME ZONE",
    }
    report_table = "reports" if schema is None else f'"{schema}".reports'
    with engine.begin() as connection:
        for name, sql_type in additions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE {report_table} ADD COLUMN {name} {sql_type}"))
        if engine.dialect.name == "postgresql":
            for column in _impl.QUANTITY_COLUMNS.values():
                if "int" in column_types.get(column, ""):
                    connection.execute(text(
                        f"ALTER TABLE {report_table} ALTER COLUMN {column} TYPE VARCHAR(20) "
                        f"USING CASE {column} WHEN 1 THEN 'Small' WHEN 2 THEN 'Medium' "
                        f"WHEN 3 THEN 'Large' WHEN 4 THEN 'Very Large' ELSE NULL END"
                    ))


def _repair_existing_reports_without_status_reclassification(engine: Any) -> None:
    """Backfill report columns while preserving the stored duplicate decision."""
    schema = _impl.database_schema() if engine.dialect.name != "sqlite" else None
    columns = {column["name"] for column in inspect(engine).get_columns("reports", schema=schema)}
    if "quantities" not in columns:
        return
    report_table = "reports" if schema is None else f'"{schema}".reports'
    with engine.begin() as connection:
        rows = connection.execute(text(
            f"SELECT id, quantities FROM {report_table} ORDER BY created_at, id"
        )).mappings().all()
        for row in rows:
            try:
                quantities = _impl.json.loads(row["quantities"])
                category, quantity = _impl.derive_category_quantity(quantities)
            except (TypeError, ValueError, StopIteration):
                continue
            values: dict[str, Any] = {"category": category, "quantity": quantity}
            values.update(_impl.quantity_values(quantities))
            set_clause = ", ".join(f"{name} = :{name}" for name in values)
            connection.execute(
                text(f"UPDATE {report_table} SET {set_clause} WHERE id = :id"),
                {**values, "id": row["id"]},
            )


def _initialise_database(engine: Any) -> None:
    original_ensure_report_columns = _impl.ensure_report_columns
    original_repair_existing_reports = _impl.repair_existing_reports
    _impl.ensure_report_columns = _ensure_report_columns_single_connection
    _impl.repair_existing_reports = _repair_existing_reports_without_status_reclassification
    try:
        _original_initialise_database(engine)
    finally:
        _impl.ensure_report_columns = original_ensure_report_columns
        _impl.repair_existing_reports = original_repair_existing_reports
    _repair_exact_duplicate_statuses(engine)
    _ensure_postgres_iteration2_contract(engine)


def _candidate_quantities(connection: Any, exclude_report_id: str | None) -> dict[str, str] | None:
    payload = request.get_json(silent=True)
    if isinstance(payload, dict):
        quantities = payload.get("quantities")
        if isinstance(quantities, dict) and quantities:
            normalised = {
                str(category): str(quantity)
                for category, quantity in quantities.items()
                if category in _impl.CATEGORY_WEIGHTS and quantity in _impl.QUANTITY_WEIGHTS
            }
            if len(normalised) == len(quantities):
                return normalised
        if "itemCounts" in payload:
            item_counts = _impl.validate_item_counts(payload.get("itemCounts"))
            if item_counts:
                return _impl.quantity_bands_for_counts(item_counts)

    if exclude_report_id:
        row = connection.execute(select(_impl.reports_table).where(_impl.reports_table.c.id == exclude_report_id)).first()
        if row is not None:
            return _impl.quantities_from_row(row)
    return None


def _nearby_proximity_refs_reviewed(lat: float, lng: float, target_id: str, secret: str) -> set[str]:
    """The reviewed create flow handles nearby active targets itself."""
    if request.endpoint == "create_report":
        return set()
    return _original_nearby_proximity_refs(lat, lng, target_id, secret)


def _duplicate_status(
    connection: Any,
    reporter_id: str,
    beach_id: str,
    created_at: Any,
    exclude_report_id: str | None = None,
) -> str:
    """Manual reports are independent; GPS proximity decides duplicates."""
    return "Counted"


def _remaining_count_attention(engine: Any, rows: list[Any]) -> float | None:
    active = _impl.active_attention_rows(engine, rows)
    if len(active) < 3:
        return None
    return float(median(_impl.report_score_for(quantities) for _, quantities in active))


def _geo_secret(jwt_secret: str) -> str:
    return _impl.os.getenv("GEO_PRIVACY_HMAC_KEY", "").strip() or hmac.new(
        jwt_secret.encode("utf-8"), b"radar-sampah-geo-key-v1", hashlib.sha256
    ).hexdigest()


def _normalised_active_payload(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        return {}
    quantities = payload.get("quantities")
    if isinstance(quantities, dict) and quantities:
        valid = {
            str(category): str(band)
            for category, band in quantities.items()
            if category in _impl.FRONTEND_CATEGORIES and band in _impl.QUANTITY_WEIGHTS
        }
        if len(valid) == len(quantities):
            return _active_quantities(valid)
    if "itemCounts" in payload:
        counts = _impl.validate_item_counts(payload.get("itemCounts"))
        if counts:
            return _active_quantities(_impl.quantity_bands_for_counts(counts))
    return {}


def _projected_xy(lat: float, lng: float) -> tuple[float, float]:
    latitude = min(85.05112878, max(-85.05112878, lat))
    radius = 6_378_137.0
    x = radius * _impl.math.radians(lng)
    y = radius * _impl.math.log(_impl.math.tan(_impl.math.pi / 4 + _impl.math.radians(latitude) / 2))
    return x, y


def _distance_to_stored_cell(
    lat: float,
    lng: float,
    target_id: str,
    stored_ref: str,
    secret: str,
) -> float | None:
    """Match an HMAC cell without recovering or persisting the target coordinate."""
    x, y = _projected_xy(lat, lng)
    grid = float(_impl.GEO_GRID_METRES)
    base_x = _impl.math.floor(x / grid)
    base_y = _impl.math.floor(y / grid)
    cells = int(_impl.math.ceil(10.0 / grid)) + 1
    for offset_x in range(-cells, cells + 1):
        for offset_y in range(-cells, cells + 1):
            cell_x, cell_y = base_x + offset_x, base_y + offset_y
            candidate_ref = _impl.proximity_ref_for_cell(cell_x, cell_y, target_id, secret)
            if not hmac.compare_digest(candidate_ref, stored_ref):
                continue
            min_x, max_x = cell_x * grid, (cell_x + 1) * grid
            min_y, max_y = cell_y * grid, (cell_y + 1) * grid
            dx = min_x - x if x < min_x else x - max_x if x > max_x else 0.0
            dy = min_y - y if y < min_y else y - max_y if y > max_y else 0.0
            return _impl.math.hypot(dx, dy)
    return None


def _gps_proximity_decision(engine: Any, payload: Any, secret: str, exclude_report_id: str | None = None) -> tuple[str, str | None]:
    """Return desired status and optional active target whose reference moves."""
    if not isinstance(payload, dict) or payload.get("locationSource") != "gps":
        return "Counted", None
    coords = payload.get("coords")
    if not isinstance(coords, dict):
        return "Counted", None
    try:
        lat, lng = float(coords["lat"]), float(coords["lng"])
    except (KeyError, TypeError, ValueError):
        return "Counted", None
    beach_id = str(payload.get("beachId") or "").strip()
    candidate = _normalised_active_payload(payload)
    if not beach_id or not candidate:
        return "Counted", None

    changed_targets: list[tuple[float, str]] = []
    with engine.connect() as connection:
        targets = connection.execute(
            select(_impl.reports_table).where(
                _impl.reports_table.c.beach_id == beach_id,
                _impl.reports_table.c.status == "Counted",
                _impl.reports_table.c.proximity_ref.is_not(None),
                _impl.reports_table.c.deleted_at.is_(None),
                _impl.reports_table.c.created_at >= _impl.datetime.now(_impl.timezone.utc) - _impl.timedelta(days=90),
            )
        ).all()
        for target in targets:
            if target.id == exclude_report_id:
                continue
            distance = _distance_to_stored_cell(lat, lng, target.id, target.proximity_ref, secret)
            if distance is None or distance > 10.0:
                continue
            actions = connection.execute(
                select(_impl.cleanup_actions_table)
                .where(_impl.cleanup_actions_table.c.target_report_id == target.id)
                .order_by(_impl.cleanup_actions_table.c.created_at)
            ).all()
            active = _active_quantities(_current_band_state(_impl, target, actions))
            if not active:
                continue
            if active == candidate:
                return "Duplicate", None
            changed_targets.append((distance, target.id))
    if not changed_targets:
        return "Counted", None
    changed_targets.sort(key=lambda item: (item[0], item[1]))
    return "Counted", changed_targets[0][1]


def _repair_gps_privacy_rows(engine: Any, secret: str) -> None:
    """Convert any transient/raw GPS rows to a privacy reference and clear raw coordinates."""
    with engine.begin() as connection:
        rows = connection.execute(
            select(_impl.reports_table).where(
                _impl.reports_table.c.location_source == "gps",
                _impl.reports_table.c.lat.is_not(None),
                _impl.reports_table.c.lng.is_not(None),
            )
        ).all()
        for row in rows:
            reference = row.proximity_ref or _impl.proximity_ref(float(row.lat), float(row.lng), row.id, secret)
            connection.execute(
                _impl.reports_table.update()
                .where(_impl.reports_table.c.id == row.id)
                .values(lat=None, lng=None, proximity_ref=reference)
            )


def _upcoming_saturdays_reviewed(now: Any) -> list[Any]:
    local_now = _impl.utc_datetime(now).astimezone(_impl.KUALA_LUMPUR)
    first_date = local_now.date() + _impl.timedelta(days=(5 - local_now.weekday()) % 7)
    first_start = _impl.datetime.combine(
        first_date,
        _impl.datetime.min.time(),
        tzinfo=_impl.KUALA_LUMPUR,
    ).replace(hour=_impl.EVENT_START_LOCAL_HOUR)
    if first_date == local_now.date() and local_now >= first_start.replace(hour=_impl.EVENT_END_LOCAL_HOUR):
        first_date += _impl.timedelta(days=7)
    return [
        _impl.datetime.combine(
            first_date + _impl.timedelta(days=7 * offset),
            _impl.datetime.min.time(),
            tzinfo=_impl.KUALA_LUMPUR,
        )
        .replace(hour=_impl.EVENT_START_LOCAL_HOUR)
        .astimezone(_impl.timezone.utc)
        for offset in range(_impl.EVENTS_PER_BEACH)
    ]


def _reviewed_event_scheduler(engine: Any):
    """Build the scheduler used by the existing event routes with an attention gate."""
    beaches = _impl.load_beaches(engine)
    refresh_lock = threading.Lock()
    last_refresh_at = 0.0
    last_schedule_key: tuple[Any, ...] | None = None
    try:
        refresh_ttl = max(5.0, float(os.getenv("EVENT_SCHEDULER_TTL_SECONDS", "60")))
    except ValueError:
        refresh_ttl = 60.0

    def ensure_scheduled_events(now: Any | None = None) -> None:
        nonlocal last_refresh_at, last_schedule_key
        current = now or _impl.datetime.now(_impl.timezone.utc)
        starts = _upcoming_saturdays_reviewed(current)
        schedule_key = tuple(starts)
        if (
            last_schedule_key == schedule_key
            and time.monotonic() - last_refresh_at < refresh_ttl
        ):
            return
        with refresh_lock:
            if (
                last_schedule_key == schedule_key
                and time.monotonic() - last_refresh_at < refresh_ttl
            ):
                return
            summaries = {summary["id"]: summary for summary in _impl.beach_summaries_batch(engine, beaches, current)}
            eligible_beaches = [
                beach
                for beach in beaches
                if summaries.get(beach["id"], {}).get("severity") in WEEKLY_EVENT_SEVERITIES
            ]
            scheduled = [
                (
                    beach,
                    starts_at,
                    f"{beach['id']}-{starts_at.astimezone(_impl.KUALA_LUMPUR).date().isoformat()}",
                )
                for beach in eligible_beaches
                for starts_at in starts
            ]
            with engine.begin() as connection:
                existing_ids = set()
                if scheduled:
                    existing_ids = set(connection.execute(
                        select(_impl.events_table.c.id).where(
                            _impl.events_table.c.id.in_(event_id for _, _, event_id in scheduled)
                        )
                    ).scalars())
                for beach, starts_at, event_id in scheduled:
                    if event_id in existing_ids:
                        continue
                    try:
                        with connection.begin_nested():
                            connection.execute(_impl.insert(_impl.events_table).values(
                                id=event_id,
                                beach_id=beach["id"],
                                starts_at=starts_at,
                                ends_at=starts_at + _impl.timedelta(
                                    hours=_impl.EVENT_END_LOCAL_HOUR - _impl.EVENT_START_LOCAL_HOUR
                                ),
                                status="Open",
                                source="scheduled",
                                created_by=None,
                                created_at=current,
                                updated_at=current,
                            ))
                    except _impl.IntegrityError:
                        continue
                connection.execute(_impl.events_table.update().where(
                    _impl.events_table.c.status == "Open",
                    _impl.events_table.c.ends_at < current,
                ).values(status="Closed", updated_at=current))
            last_refresh_at = time.monotonic()
            last_schedule_key = schedule_key

    return ensure_scheduled_events


def _replace_freevar(function: Any, name: str, replacement: Any) -> bool:
    """Replace one captured helper while preserving the route's existing serializer."""
    closure = function.__closure__ or ()
    for freevar, cell in zip(function.__code__.co_freevars, closure):
        if freevar == name:
            cell.cell_contents = replacement
            return True
    return False


_impl.initialise_database = _initialise_database
_impl.duplicate_status = _duplicate_status
_impl.remaining_count_attention = _remaining_count_attention
_impl.nearby_proximity_refs = _nearby_proximity_refs_reviewed


def create_app(
    database_url: str | None = None,
    testing: bool = False,
    photo_storage_dir: str | Path | None = None,
):
    application = _original_create_app(
        database_url=database_url,
        testing=testing,
        photo_storage_dir=photo_storage_dir,
    )
    engine = application.extensions["marine_engine"]
    jwt_secret = _impl.auth_jwt_secret(testing)
    geo_secret = _geo_secret(jwt_secret)
    _repair_gps_privacy_rows(engine, geo_secret)

    def get_iteration2_scoring_method_reviewed():
        return jsonify({
            "ruleVersion": "radar-sampah-scoring-i2-v3",
            "categoryWeights": [
                {"category": category, "weight": _impl.CATEGORY_WEIGHTS[category]}
                for category in _impl.FRONTEND_CATEGORIES
            ],
            "quantityWeights": [
                {"quantity": quantity, "weight": _impl.QUANTITY_WEIGHTS[quantity]}
                for quantity in ("Small", "Medium", "Large", "Very Large")
            ],
            "windowDays": 90,
            "minReports": 3,
            "reportEligibility": "Counted reports in the latest 90 days with active non-Small litter after cleanup; resolved reports remain in history",
            "remainingBandAggregation": "per-report-after-cleanup",
            "reportAggregation": "max-category-score",
            "beachAggregation": "median-of-active-reports",
            "modelClassMapping": [
                {"modelClass": model_class, "category": category}
                for model_class, category in _impl.ITERATION2_CATEGORIES.items()
            ],
            "cleanupScore": "quantity-band-unit-reduction",
            "cleanupPoints": 0,
        })

    @application.after_request
    def persist_location_duplicate_note(response):
        if (
            request.endpoint == "create_report"
            and response.status_code == 201
            and getattr(g, "same_day_nearby_gps_duplicate", False)
        ):
            payload = response.get_json(silent=True)
            report_id = payload.get("id") if isinstance(payload, dict) else None
            if report_id:
                with engine.begin() as connection:
                    connection.execute(
                        _impl.reports_table.update()
                        .where(_impl.reports_table.c.id == report_id)
                        .values(status_note=GEO_DUPLICATE_NOTE)
                    )
                payload["statusNote"] = GEO_DUPLICATE_NOTE
                response.set_data(_impl.json.dumps(payload, separators=(",", ":")))
        return response

    install_cleanup_route(application, engine, jwt_secret, _impl)
    install_litter_gallery(application, engine, jwt_secret, _impl)
    install_v3_contract(application, engine, jwt_secret, _impl)
    install_account(application, engine, jwt_secret, _impl)
    install_insights(application, engine, jwt_secret, _impl)
    install_recurrence(application, engine, jwt_secret, _impl)
    install_recommendations(application, engine, jwt_secret, _impl)
    install_species_questions(application)
    install_wildlife(application, engine, _impl, jwt_secret)
    install_beach_snapshots(application, engine, _impl)

    reviewed_scheduler = _reviewed_event_scheduler(engine)
    application.extensions["ensure_scheduled_events"] = reviewed_scheduler
    application.extensions["gps_proximity_decision"] = lambda payload, report_id: _gps_proximity_decision(engine, payload, geo_secret, report_id)
    for endpoint in ("list_events", "get_event"):
        route = application.view_functions.get(endpoint)
        if route is None or not _replace_freevar(route, "ensure_scheduled_events", reviewed_scheduler):
            raise RuntimeError(f"Could not install reviewed weekly-event scheduler for {endpoint}.")

    # Prepare public snapshots before serving requests, then refresh them in the
    # background so an expired snapshot never makes a visitor wait.
    if not application.testing and os.getenv("RADAR_PREWARM_PUBLIC_VIEWS", "1").lower() in {"1", "true", "yes", "on"}:
        prewarm = application.extensions.get("prewarm_insights")
        prewarm_events = application.extensions.get("prewarm_cleanup_events")
        prewarm_beaches = application.extensions.get("prewarm_beach_snapshots")
        if prewarm is not None:
            try:
                prewarm()
            except Exception:  # pragma: no cover - deployment-only best effort
                application.logger.exception("Public insights prewarm failed")
        if prewarm_events is not None:
            try:
                prewarm_events()
            except Exception:  # pragma: no cover - deployment-only best effort
                application.logger.exception("Public cleanup events prewarm failed")

        if prewarm_beaches is not None:
            try:
                prewarm_beaches()
            except Exception:  # pragma: no cover - deployment-only best effort
                application.logger.exception("Public beach snapshots prewarm failed")

        def _refresh_public_views_loop() -> None:
            wait = threading.Event()
            while not wait.wait(50.0):
                refresh_insights = application.extensions.get("refresh_insights_async")
                refresh_events = application.extensions.get("refresh_cleanup_events_async")
                refresh_beaches = application.extensions.get("refresh_beach_snapshots_async")
                if refresh_insights is not None:
                    refresh_insights()
                if refresh_events is not None:
                    refresh_events()
                if refresh_beaches is not None:
                    refresh_beaches()

        threading.Thread(target=_refresh_public_views_loop, name="radar-public-refresh", daemon=True).start()

    original_create_report = application.view_functions["create_report"]

    def create_report_with_reviewed_proximity():
        payload = request.get_json(silent=True)
        decision = _gps_proximity_decision(engine, payload, geo_secret)
        response = application.make_response(original_create_report())
        if response.status_code != 201 or not isinstance(payload, dict) or payload.get("locationSource") != "gps":
            return response
        coords = payload.get("coords")
        body = response.get_json(silent=True)
        if not isinstance(coords, dict) or not isinstance(body, dict) or not body.get("id"):
            return response
        try:
            lat, lng = float(coords["lat"]), float(coords["lng"])
        except (KeyError, TypeError, ValueError):
            return response
        report_id = str(body["id"])
        desired_status, refresh_target_id = decision
        new_reference = _impl.proximity_ref(lat, lng, report_id, geo_secret)
        values: dict[str, Any] = {
            "lat": None,
            "lng": None,
            "proximity_ref": new_reference,
            "status": desired_status,
            "status_note": GEO_DUPLICATE_NOTE if desired_status == "Duplicate" else None,
        }
        with engine.begin() as connection:
            connection.execute(
                _impl.reports_table.update()
                .where(_impl.reports_table.c.id == report_id)
                .values(**values)
            )
            if refresh_target_id and desired_status == "Counted":
                connection.execute(
                    _impl.reports_table.update()
                    .where(_impl.reports_table.c.id == refresh_target_id)
                    .values(proximity_ref=_impl.proximity_ref(lat, lng, refresh_target_id, geo_secret))
                )
        body["status"] = desired_status
        body["currentState"] = "excluded" if desired_status == "Duplicate" else "active"
        if desired_status == "Duplicate":
            body["statusNote"] = GEO_DUPLICATE_NOTE
        else:
            body.pop("statusNote", None)
            if refresh_target_id:
                # A nearby active report carries a different category or band, so
                # this observation was accepted and the permitted location
                # reference moved to it. The reporter is told that happened; the
                # other report stays anonymous and its id is not exposed.
                body["nearbyReportFound"] = True
                body["locationReferenceUpdated"] = True
        response.set_data(_impl.json.dumps(body, separators=(",", ":")))
        return response

    application.view_functions["create_report"] = create_report_with_reviewed_proximity
    application.view_functions["get_iteration2_scoring_method"] = get_iteration2_scoring_method_reviewed
    return application


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=int(_impl.os.getenv("PORT", "5000")))
