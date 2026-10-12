"""Radar Pantai API for the Iteration 1 frontend and Iteration 2 services.

The routes and response shapes in this module follow frontend/API.md and
frontend/API.en.md. Report coordinates and photo storage keys are private
server-side data and are deliberately excluded from response serializers.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
from statistics import median
import tempfile
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from functools import lru_cache, wraps
from io import BytesIO
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlencode

import jwt
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from PIL import Image, ImageOps, UnidentifiedImageError
from dotenv import load_dotenv
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    insert,
    inspect,
    select,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateSchema
from werkzeug.exceptions import HTTPException
from werkzeug.exceptions import RequestEntityTooLarge
from species_distribution import ModelAreaError, ModelInputError, SpeciesDistributionModel

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover - dependency is installed in deployed builds
    register_heif_opener = None


# Local development settings are intentionally loaded from the ignored .env.
load_dotenv(Path(__file__).with_name(".env"))


LOCAL_DATABASE_URL = "sqlite:///radar_sampah.db"
KUALA_LUMPUR = timezone(timedelta(hours=8))
AUTH_JWT_ALGORITHM = "HS256"
AUTH_TOKEN_TTL_DAYS = 30
PHOTO_URL_TTL_MINUTES = 15
PHOTO_MAX_BYTES = 10 * 1024 * 1024
PHOTO_MAX_EDGE = 2048
PHOTO_ORPHAN_TTL = timedelta(hours=24)
PARTICIPANT_ID_MIN = 1000
PARTICIPANT_ID_MAX = 9999
DEFAULT_VOLUNTEER_ROLE = "volunteer"
ITERATION2_CATEGORIES = {
    "plastic": "Plastic",
    "metal": "Metal",
    "glass": "Glass",
    "paper_cardboard": "Paper",
    "styrofoam": "Other",
    "fishing_gear": "Fishing gear",
}
ITEM_COUNT_BANDS = ((5, "Small"), (20, "Medium"), (50, "Large"), (None, "Very Large"))
ITEM_COUNT_LIMIT = 100_000
ACTIVE_TARGET_RADIUS_METRES = 10
EVENT_CHECKIN_RADIUS_KM = 25
EVENT_START_LOCAL_HOUR = 9
EVENT_END_LOCAL_HOUR = 12
EVENTS_PER_BEACH = 4
GEO_GRID_METRES = 1
GEO_HMAC_CONTEXT = b"radar-sampah-proximity-v1"
LEGACY_SEED_REPORT_IDS = frozenset({"r1", "r2", "r3", "r4"})

FRONTEND_CATEGORIES = ("Fishing gear", "Plastic", "Glass", "Metal", "Other", "Paper")
CATEGORY_WEIGHTS = {
    "Fishing gear": 1.0,
    "Plastic": 0.85,
    "Glass": 0.70,
    "Metal": 0.60,
    "Other": 0.50,
    "Paper": 0.35,
}
QUANTITY_WEIGHTS = {"Small": 1, "Medium": 2, "Large": 3, "Very Large": 4}
REPORT_STATUSES = {"Counted", "Duplicate", "Incomplete"}
REPORT_STATUS_NOTES = {
    "Duplicate": "Same participant, beach and local day as an existing counted report. Saved here but excluded from the beach score.",
    "Incomplete": "Photo unreadable — excluded until you correct and save the record.",
}
SCORING_BANDS = (
    {"band": "Low", "range": "below 1.5", "color": "#7CA98B"},
    {"band": "Moderate", "range": "1.5 – <2.5", "color": "#D9A24B"},
    {"band": "High", "range": "2.5 – <3.5", "color": "#CE6B45"},
    {"band": "Severe", "range": "3.5 and above", "color": "#B84A3F"},
)
PHOTO_MIME_TYPES = {"image/jpeg", "image/png", "image/heic", "image/heif"}
REPORT_INPUT_FIELDS = {"beachId", "quantities", "photoKey", "locationSource", "coords"}
ITERATION2_REPORT_FIELDS = {"itemCounts", "eventId"}
EVENT_HANDLING_VALUES = {"Collected for disposal", "Recycled / handled", "Not recorded"}
BEACH_SUMMARY_FIELDS = (
    "id",
    "name",
    "area",
    "lat",
    "lng",
    "habitat",
    "habitatTag",
    "sensitivity",
    "primarySpeciesGlyph",
    "speciesNames",
    "coverImageUrl",
    "scene",
)


metadata = MetaData()
users_table = Table(
    "users",
    metadata,
    Column("id", String(80), primary_key=True),
    Column("participant_id", String(4), nullable=False, unique=True),
    Column("role", String(20), nullable=False, default=DEFAULT_VOLUNTEER_ROLE),
    Column("user_token", String(128)),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

beaches_table = Table(
    "beaches",
    metadata,
    Column("id", String(80), primary_key=True),
    Column("name", String(160), nullable=False),
    Column("area", String(160), nullable=False),
    Column("lat", Float, nullable=False),
    Column("lng", Float, nullable=False),
    Column("habitat", String(200), nullable=False),
    Column("habitat_tag", String(40), nullable=False),
    Column("sensitivity", String(200), nullable=False),
    Column("primary_species_glyph", String(20), nullable=False),
    Column("cover_image_url", String(500)),
    Column("scene", Text, nullable=False),
    Column("ecological_note", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint(
        "primary_species_glyph IN ('turtle','bird','mangrove','grass','crab','fish')",
        name="beaches_primary_species_glyph_check",
    ),
)

dim_threat_table = Table(
    "dim_threat",
    metadata,
    Column("threat_id", Integer, primary_key=True, autoincrement=True),
    Column("threat_name", String(120), nullable=False, unique=True),
)

dim_species_table = Table(
    "dim_species",
    metadata,
    Column("species_id", String(36), primary_key=True),
    Column("scientific_name", String(200), nullable=False, unique=True),
    Column("common_name", String(160)),
    Column("threat_id", ForeignKey("dim_threat.threat_id")),
    Column("glyph", String(20), nullable=False),
    Column("picture_url", String(500)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    CheckConstraint(
        "glyph IN ('turtle','bird','mangrove','grass','crab','fish')",
        name="dim_species_glyph_check",
    ),
)

area_species_table = Table(
    "area_species",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("area_id", ForeignKey("beaches.id", ondelete="CASCADE"), nullable=False),
    Column("species_id", ForeignKey("dim_species.species_id")),
    Column("kind", String(20), nullable=False),
    Column("display_name", String(160), nullable=False),
    Column("glyph", String(20), nullable=False),
    Column("text", Text, nullable=False),
    Column("sort_order", Integer, nullable=False, default=0),
    Column("origin", String(20), nullable=False, default="curated"),
    Column("source_dataset", String(20), nullable=False, default="pending"),
    Column("source_citation", Text, nullable=False),
    Column("source_url", String(500)),
    Column("source_accessed_at", Date),
    Column("occurrence_state", String(20), nullable=False, default="unavailable"),
    Column("occurrence_score", Integer),
    Column("occurrence_basis", Text),
    UniqueConstraint("area_id", "species_id", name="area_species_area_species_key"),
    CheckConstraint("kind IN ('species','habitat','group')", name="area_species_kind_check"),
    CheckConstraint(
        "glyph IN ('turtle','bird','mangrove','grass','crab','fish')",
        name="area_species_glyph_check",
    ),
    CheckConstraint("origin IN ('curated','derived')", name="area_species_origin_check"),
    CheckConstraint(
        "source_dataset IN ('FishBase','OBIS','other','pending')",
        name="area_species_source_dataset_check",
    ),
    CheckConstraint(
        "occurrence_state IN ('ready','pending','unavailable')",
        name="area_species_occurrence_state_check",
    ),
    CheckConstraint(
        "occurrence_score IS NULL OR occurrence_score BETWEEN 0 AND 100",
        name="area_species_occurrence_score_check",
    ),
    CheckConstraint(
        "(kind = 'species') = (species_id IS NOT NULL)",
        name="area_species_kind_species_check",
    ),
    CheckConstraint(
        "(occurrence_score IS NULL) = (occurrence_state <> 'ready')",
        name="area_species_occurrence_state_score_check",
    ),
    CheckConstraint(
        "occurrence_score IS NULL OR occurrence_basis IS NOT NULL",
        name="area_species_occurrence_basis_check",
    ),
)

# The database contract in schema.sql stores one nullable column per litter
# category. Keep this mapping at the boundary so the API can continue to use
# the frontend's compact `{category: quantity}` shape.
QUANTITY_COLUMNS = {
    "Plastic": "qty_plastic",
    "Fishing gear": "qty_fishing_gear",
    "Glass": "qty_glass",
    "Metal": "qty_metal",
    "Paper": "qty_paper",
    "Other": "qty_other",
}

reports_table = Table(
    "reports",
    metadata,
    Column("id", String(40), primary_key=True),
    Column("reporter_id", ForeignKey("users.id"), nullable=False),
    Column("beach_id", ForeignKey("beaches.id"), nullable=False),
    # Legacy PR #13 columns. Existing Render tables may still require these
    # fields, so new writes keep both representations in sync during migration.
    Column("beach_name", String(160)),
    Column("quantities", Text),
    Column("location_source", String(20), nullable=False),
    Column("photo_key", String(500), nullable=False),
    Column("photo_mime", String(64), nullable=False),
    Column("photo_stripped", Boolean, nullable=False, default=False),
    *(Column(column, String(20)) for column in QUANTITY_COLUMNS.values()),
    Column("category", String(40), nullable=False),
    Column("quantity", String(20), nullable=False),
    Column("lat", Float),
    Column("lng", Float),
    Column("item_counts", Text),
    Column("proximity_ref", String(64)),
    Column("event_id", String(100)),
    Column("status", String(20), nullable=False),
    Column("status_note", Text),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("deleted_at", DateTime(timezone=True)),
    CheckConstraint("location_source IN ('gps','manual')", name="reports_location_source_check"),
    CheckConstraint(
        "photo_mime IN ('image/jpeg','image/png','image/heic')",
        name="reports_photo_mime_check",
    ),
    *(
        CheckConstraint(
            f"{column} IN ('Small','Medium','Large','Very Large')",
            name=f"reports_{column}_check",
        )
        for column in QUANTITY_COLUMNS.values()
    ),
    CheckConstraint(
        "category IN ('Plastic','Fishing gear','Glass','Metal','Paper','Other')",
        name="reports_category_check",
    ),
    CheckConstraint("quantity IN ('Small','Medium','Large','Very Large')", name="reports_quantity_check"),
    CheckConstraint("status IN ('Counted','Duplicate','Incomplete')", name="reports_status_check"),
    CheckConstraint(
        "((CASE WHEN qty_plastic IS NOT NULL THEN 1 ELSE 0 END) + "
        "(CASE WHEN qty_fishing_gear IS NOT NULL THEN 1 ELSE 0 END) + "
        "(CASE WHEN qty_glass IS NOT NULL THEN 1 ELSE 0 END) + "
        "(CASE WHEN qty_metal IS NOT NULL THEN 1 ELSE 0 END) + "
        "(CASE WHEN qty_paper IS NOT NULL THEN 1 ELSE 0 END) + "
        "(CASE WHEN qty_other IS NOT NULL THEN 1 ELSE 0 END)) >= 1",
        name="reports_at_least_one_category_check",
    ),
    CheckConstraint(
        "location_source = 'gps' OR (lat IS NULL AND lng IS NULL)",
        name="reports_manual_has_no_coords_check",
    ),
    CheckConstraint(
        "status <> 'Counted' OR status_note IS NULL",
        name="reports_note_only_when_excluded_check",
    ),
)

report_photos_table = Table(
    "report_photos",
    metadata,
    Column("photo_key", String(500), primary_key=True),
    Column("owner_id", ForeignKey("users.id"), nullable=False),
    Column("mime", String(64), nullable=False),
    Column("data", LargeBinary, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

i2_metadata = MetaData()
events_table = Table(
    "community_events",
    i2_metadata,
    Column("id", String(100), primary_key=True),
    Column("beach_id", String(80), nullable=False),
    Column("starts_at", DateTime(timezone=True), nullable=False),
    Column("ends_at", DateTime(timezone=True), nullable=False),
    Column("status", String(20), nullable=False),
    Column("source", String(20), nullable=False),
    # Where volunteers should gather. Nullable: a scheduled event does not have
    # one until a moderator adds it, and inventing a meeting point for a real
    # beach would be a guess.
    Column("meeting_point", String(160)),
    Column("created_by", String(80)),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("beach_id", "starts_at", name="community_events_beach_start"),
)
event_members_table = Table(
    "community_event_members",
    i2_metadata,
    Column("event_id", String(100), primary_key=True),
    Column("participant_id", String(80), primary_key=True),
    Column("joined_at", DateTime(timezone=True), nullable=False),
    Column("checked_in_at", DateTime(timezone=True)),
    Column("location_passed", Boolean, nullable=False, default=False),
)
cleanup_actions_table = Table(
    "cleanup_actions",
    i2_metadata,
    Column("id", String(40), primary_key=True),
    Column("target_report_id", String(40), nullable=False),
    Column("participant_id", String(80), nullable=False),
    Column("event_id", String(100)),
    Column("beach_id", String(80), nullable=False),
    Column("removed_counts", Text, nullable=False),
    Column("rows", Text, nullable=False),
    Column("total_removed", Integer, nullable=False),
    Column("handling", String(40), nullable=False),
    Column("note", Text),
    Column("idempotency_key", String(128), nullable=False),
    Column("request_fingerprint", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("participant_id", "idempotency_key", name="cleanup_actions_idempotency"),
)
Index("cleanup_actions_target", cleanup_actions_table.c.target_report_id)
Index("community_events_window", events_table.c.beach_id, events_table.c.starts_at)
Index("reports_severity_window", reports_table.c.beach_id, reports_table.c.status, reports_table.c.created_at)
Index("reports_duplicate_check", reports_table.c.reporter_id, reports_table.c.beach_id, reports_table.c.created_at)


def normalise_database_url(database_url: str | None) -> str:
    value = (database_url or LOCAL_DATABASE_URL).strip()
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+psycopg://", 1)
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    return value


def create_engine_for_url(database_url: str) -> Engine:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, future=True, connect_args=connect_args, pool_pre_ping=True)
    if database_url.startswith("sqlite"):
        return engine
    # Neon poolers can reset session settings between transactions. Translate
    # unqualified SQLAlchemy tables into the configured schema at compile time
    # instead of relying on a connection-level `SET search_path`.
    schema = database_schema()
    return engine.execution_options(schema_translate_map={None: schema}) if schema else engine


def database_schema() -> str | None:
    schema = os.getenv("DATABASE_SCHEMA", "").strip()
    if not schema:
        return None
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
        raise RuntimeError("DATABASE_SCHEMA must be a valid PostgreSQL schema name")
    return schema


def initialise_database(engine: Engine) -> None:
    """Create the schema and preserve reports written under the former name."""
    schema = database_schema() if engine.dialect.name == "postgresql" else None
    if schema:
        with engine.begin() as connection:
            if not inspect(connection).has_schema(schema):
                connection.execute(CreateSchema(schema, if_not_exists=True))
    migrate_legacy_reports_table(engine)
    metadata.create_all(engine)
    ensure_user_columns(engine)
    ensure_report_columns(engine)
    i2_metadata.create_all(engine)
    ensure_demo_participant(engine)
    repair_existing_reports(engine)


def ensure_user_columns(engine: Engine) -> None:
    schema = database_schema() if engine.dialect.name != "sqlite" else None
    if "users" not in inspect(engine).get_table_names(schema=schema):
        return
    existing = {column["name"] for column in inspect(engine).get_columns("users", schema=schema)}
    if "user_token" in existing:
        return
    user_table = "users" if schema is None else f'"{schema}".users'
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {user_table} ADD COLUMN user_token VARCHAR(128)"))


def ensure_demo_participant(engine: Engine) -> None:
    """Optionally create one empty, anonymous participant for controlled demos."""
    participant_id = os.getenv("DEMO_PARTICIPANT_ID", "").strip()
    if not participant_id:
        return
    if not re.fullmatch(r"\d{4}", participant_id):
        raise RuntimeError("DEMO_PARTICIPANT_ID must be a four-digit participant ID")

    user_id = f"u_demo_{participant_id}"
    with engine.begin() as connection:
        participant = connection.execute(
            select(users_table.c.id).where(users_table.c.participant_id == participant_id)
        ).first()
        if participant is not None:
            return

        conflicting_user = connection.execute(
            select(users_table.c.participant_id).where(users_table.c.id == user_id)
        ).first()
        if conflicting_user is not None:
            raise RuntimeError(f"Demo user ID {user_id} is already assigned to another participant")

        connection.execute(
            insert(users_table).values(
                id=user_id,
                participant_id=participant_id,
                role=DEFAULT_VOLUNTEER_ROLE,
                created_at=datetime.now(timezone.utc),
            )
        )


def migrate_legacy_reports_table(engine: Engine) -> None:
    """Rename the pre-PR-13 table before SQLAlchemy creates ``reports``.

    The standalone PostgreSQL equivalent lives in migrations/001_*.sql.  This
    startup guard keeps local SQLite databases and Render deployments safe when
    the migration has not been run as a separate release step.
    """
    schema = database_schema() if engine.dialect.name != "sqlite" else None
    table_names = set(inspect(engine).get_table_names(schema=schema))
    if "frontend_reports" not in table_names or "reports" in table_names:
        return
    legacy_table = "frontend_reports" if schema is None else f'"{schema}".frontend_reports'
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {legacy_table} RENAME TO reports"))


def ensure_report_columns(engine: Engine) -> None:
    """Add contract fields that were absent from the former partial table."""
    schema = database_schema() if engine.dialect.name != "sqlite" else None
    if "reports" not in inspect(engine).get_table_names(schema=schema):
        return
    existing = {column["name"] for column in inspect(engine).get_columns("reports", schema=schema)}
    additions = {
        "beach_name": "VARCHAR(160)",
        "quantities": "TEXT",
        "photo_mime": "VARCHAR(64)",
        "photo_stripped": "BOOLEAN",
        **{column: "VARCHAR(20)" for column in QUANTITY_COLUMNS.values()},
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
            column_types = {
                column["name"]: column["type"].__class__.__name__.lower()
                for column in inspect(engine).get_columns("reports", schema=schema)
            }
            for column in QUANTITY_COLUMNS.values():
                if "int" in column_types.get(column, ""):
                    connection.execute(text(
                        f"ALTER TABLE {report_table} ALTER COLUMN {column} TYPE VARCHAR(20) "
                        f"USING CASE {column} WHEN 1 THEN 'Small' WHEN 2 THEN 'Medium' "
                        f"WHEN 3 THEN 'Large' WHEN 4 THEN 'Very Large' ELSE NULL END"
                    ))


def repair_existing_reports(engine: Engine) -> None:
    """Backfill quantity columns and retain duplicate handling for legacy rows."""
    schema = database_schema() if engine.dialect.name != "sqlite" else None
    columns = {column["name"] for column in inspect(engine).get_columns("reports", schema=schema)}
    if "quantities" not in columns:
        return
    report_table = "reports" if schema is None else f'"{schema}".reports'
    with engine.begin() as connection:
        rows = connection.execute(text(
            f"SELECT id, reporter_id, beach_id, quantities, status, created_at FROM {report_table} "
            "ORDER BY created_at, id"
        )).mappings().all()
        first_counted_by_day: set[tuple[str, str, Any]] = set()
        for row in rows:
            try:
                quantities = json.loads(row["quantities"])
                category, quantity = derive_category_quantity(quantities)
            except (TypeError, ValueError, StopIteration):
                continue
            status = row["status"]
            if status != "Incomplete":
                created_at = row["created_at"]
                if isinstance(created_at, str):
                    created_at = datetime.fromisoformat(created_at)
                local_day = utc_datetime(created_at).astimezone(KUALA_LUMPUR).date()
                duplicate_key = (row["reporter_id"], row["beach_id"], local_day)
                status = "Duplicate" if duplicate_key in first_counted_by_day else "Counted"
                first_counted_by_day.add(duplicate_key)
            values: dict[str, Any] = {"category": category, "quantity": quantity, "status": status}
            values.update(quantity_values(quantities))
            set_clause = ", ".join(f"{name} = :{name}" for name in values)
            connection.execute(
                text(f"UPDATE {report_table} SET {set_clause} WHERE id = :id"),
                {**values, "id": row["id"]},
            )


def load_beaches(engine: Engine | None = None) -> list[dict[str, Any]]:
    """Prefer the seeded database records, with JSON only as local-test fallback."""
    with (Path(__file__).parent / "data" / "beaches.json").open(encoding="utf-8") as data_file:
        fallback = json.load(data_file)
    schema = database_schema() if engine is not None and engine.dialect.name != "sqlite" else None
    if engine is None or "beaches" not in inspect(engine).get_table_names(schema=schema):
        return fallback
    beach_table = "beaches" if schema is None else f'"{schema}".beaches'
    with engine.connect() as connection:
        rows = connection.execute(
            text(f"""
                SELECT id, name, area, lat, lng, habitat, habitat_tag, sensitivity,
                       primary_species_glyph, cover_image_url, scene, ecological_note
                FROM {beach_table} ORDER BY id
            """)
        ).mappings().all()
    if not rows:
        return fallback
    fallback_by_id = {beach["id"]: beach for beach in fallback}
    beaches: list[dict[str, Any]] = []
    for row in rows:
        base = fallback_by_id.get(row["id"], {})
        beaches.append(
            {
                **base,
                "id": row["id"], "name": row["name"], "area": row["area"],
                "lat": row["lat"], "lng": row["lng"], "habitat": row["habitat"],
                "habitatTag": row["habitat_tag"], "sensitivity": row["sensitivity"],
                "primarySpeciesGlyph": row["primary_species_glyph"],
                "speciesNames": base.get("speciesNames", []),
                "coverImageUrl": row["cover_image_url"], "scene": row["scene"],
                "ecologicalNote": row["ecological_note"],
            }
        )
    return beaches


def seed_reference_data(engine: Engine, beaches: list[dict[str, Any]]) -> None:
    """Insert fixed beach and biodiversity reference rows without overwriting data."""

    now = datetime.now(timezone.utc)

    def insert_if_missing(connection: Any, table: Table, values: dict[str, Any], conflict_columns: list[str]) -> None:
        if engine.dialect.name == "sqlite":
            from sqlalchemy.dialects.sqlite import insert as dialect_insert
        elif engine.dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as dialect_insert
        else:
            dialect_insert = None

        if dialect_insert is not None:
            statement = dialect_insert(table).values(**values).on_conflict_do_nothing(
                index_elements=[table.c[column] for column in conflict_columns]
            )
            connection.execute(statement)
            return

        exists = connection.execute(
            select(*[table.c[column] for column in conflict_columns]).where(
                *[table.c[column] == values[column] for column in conflict_columns]
            )
        ).first()
        if exists is None:
            connection.execute(insert(table).values(**values))

    with engine.begin() as connection:
        for beach in beaches:
            insert_if_missing(
                connection,
                beaches_table,
                {
                    "id": beach["id"],
                    "name": beach["name"],
                    "area": beach["area"],
                    "lat": beach["lat"],
                    "lng": beach["lng"],
                    "habitat": beach["habitat"],
                    "habitat_tag": beach["habitatTag"],
                    "sensitivity": beach["sensitivity"],
                    "primary_species_glyph": beach["primarySpeciesGlyph"],
                    "cover_image_url": beach.get("coverImageUrl"),
                    "scene": beach["scene"],
                    "ecological_note": beach.get("ecologicalNote", ""),
                    "created_at": now,
                },
                ["id"],
            )

        for beach in beaches:
            for position, card in enumerate(beach.get("species", []), start=1):
                scientific_name = str(card.get("scientificName") or "").strip() or None
                species_id = None
                if scientific_name:
                    deterministic_species_id = str(
                        uuid.uuid5(uuid.NAMESPACE_URL, f"radar-sampah:species:{scientific_name}")
                    )
                    insert_if_missing(
                        connection,
                        dim_species_table,
                        {
                            "species_id": deterministic_species_id,
                            "scientific_name": scientific_name,
                            "common_name": card.get("name"),
                            "threat_id": None,
                            "glyph": card["glyph"],
                            "picture_url": None,
                            "created_at": now,
                        },
                        ["scientific_name"],
                    )
                    species = connection.execute(
                        select(dim_species_table.c.species_id).where(
                            dim_species_table.c.scientific_name == scientific_name
                        )
                    ).first()
                    species_id = species.species_id if species is not None else deterministic_species_id

                existing_card = connection.execute(
                    select(area_species_table.c.id).where(
                        area_species_table.c.area_id == beach["id"],
                        area_species_table.c.display_name == card["name"],
                    )
                ).first()
                if existing_card is not None:
                    continue

                source = card.get("source") or {}
                likelihood = card.get("likelihood") or {}
                accessed_at = source.get("accessedAt")
                insert_if_missing(
                    connection,
                    area_species_table,
                    {
                        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"radar-sampah:card:{beach['id']}:{card['name']}")),
                        "area_id": beach["id"],
                        "species_id": species_id,
                        "kind": card["kind"],
                        "display_name": card["name"],
                        "glyph": card["glyph"],
                        "text": card["text"],
                        "sort_order": position,
                        "origin": "curated",
                        "source_dataset": source.get("dataset", "pending"),
                        "source_citation": source.get("citation", "Source not recorded."),
                        "source_url": source.get("url"),
                        "source_accessed_at": datetime.fromisoformat(accessed_at).date() if accessed_at else None,
                        "occurrence_state": likelihood.get("state", "unavailable"),
                        "occurrence_score": None,
                        "occurrence_basis": likelihood.get("basis"),
                    },
                    ["id"],
                )


def error_response(status: int, code: str, message: str):
    return jsonify({"code": code, "message": message}), status


def auth_jwt_secret(testing: bool) -> str:
    secret = os.getenv("AUTH_JWT_SECRET", "").strip()
    if secret:
        return secret
    if testing:
        return "test-only-secret-not-for-production"
    raise RuntimeError("AUTH_JWT_SECRET must be configured outside tests")


@lru_cache(maxsize=1)
def load_species_distribution_model() -> SpeciesDistributionModel:
    """Load the packaged offline species models once per API process."""
    return SpeciesDistributionModel()


class _LazySpeciesDistributionModel:
    """Preserve the shared model object contract without blocking web startup."""

    def __init__(self) -> None:
        self._instance: SpeciesDistributionModel | None = None
        self._load_lock = threading.Lock()

    def _get(self) -> SpeciesDistributionModel:
        if self._instance is None:
            with self._load_lock:
                if self._instance is None:
                    self._instance = load_species_distribution_model()
        return self._instance

    def __getattr__(self, name: str) -> Any:
        return getattr(self._get(), name)


@lru_cache(maxsize=1)
def lazy_species_distribution_model() -> _LazySpeciesDistributionModel:
    return _LazySpeciesDistributionModel()


class _LazyLitterRecognizer:
    """Delay ONNX session creation until a recognition request actually needs it.

    Render must bind the web port before its deploy health window expires. The
    recognizer keeps the exact same request-time behavior; only startup order
    changes.
    """

    def __init__(self) -> None:
        self._instance: Any | None = None
        self._load_lock = threading.Lock()

    def _get(self) -> Any:
        if self._instance is None:
            with self._load_lock:
                if self._instance is None:
                    from recognition import LitterRecognizer
                    self._instance = LitterRecognizer.load()
        return self._instance

    def recognise(self, image_bytes: bytes) -> dict[str, Any]:
        return self._get().recognise(image_bytes)


def generate_participant_id(connection: Any) -> str:
    taken = set(connection.execute(select(users_table.c.participant_id)).scalars().all())
    available = [str(value) for value in range(PARTICIPANT_ID_MIN, PARTICIPANT_ID_MAX + 1) if str(value) not in taken]
    if not available:
        raise RuntimeError("No participant IDs are available")
    return secrets.choice(available)


def issue_token(user_id: str, jwt_secret: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "iat": now, "exp": now + timedelta(days=AUTH_TOKEN_TTL_DAYS)},
        jwt_secret,
        algorithm=AUTH_JWT_ALGORITHM,
    )


def decode_token_subject(token: str, jwt_secret: str) -> str | None:
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=[AUTH_JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    subject = payload.get("sub")
    return subject if isinstance(subject, str) else None


def issue_recovery_token(user_id: str, jwt_secret: str) -> str:
    """Create the stable, non-session secret shown once to a new participant."""

    digest = hmac.new(
        jwt_secret.encode("utf-8"),
        f"radar-sampah-recovery:{user_id}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    raw = base64.b32encode(digest).decode("ascii").rstrip("=")[:24]
    return "RS-" + "-".join(raw[index:index + 4] for index in range(0, len(raw), 4))


def recovery_token_matches(user_id: str, supplied_token: str, jwt_secret: str) -> bool:
    expected = issue_recovery_token(user_id, jwt_secret)
    return hmac.compare_digest(expected, supplied_token.strip().upper())


def user_dict(row: Any) -> dict[str, Any]:
    return {"id": row.id, "participantId": row.participant_id, "role": row.role}


def utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def contract_timestamp(value: datetime) -> str:
    return utc_datetime(value).astimezone(KUALA_LUMPUR).isoformat()


def derive_category_quantity(quantities: dict[str, str]) -> tuple[str, str]:
    """选择类别分数最高的类别；相同分数按固定类别顺序稳定决胜。"""

    best_category = next(category for category in FRONTEND_CATEGORIES if category in quantities)
    best_score = CATEGORY_WEIGHTS[best_category] * QUANTITY_WEIGHTS[quantities[best_category]]
    for category in FRONTEND_CATEGORIES:
        quantity = quantities.get(category)
        if quantity is None:
            continue
        score = CATEGORY_WEIGHTS[category] * QUANTITY_WEIGHTS[quantity]
        if score > best_score:
            best_category, best_score = category, score
    return best_category, quantities[best_category]


def category_scores_for(quantities: dict[str, str]) -> dict[str, float]:
    """按公开类别顺序返回每个已填类别的分数。"""

    return {
        category: CATEGORY_WEIGHTS[category] * QUANTITY_WEIGHTS[quantities[category]]
        for category in FRONTEND_CATEGORIES
        if category in quantities
    }


def report_score_for(quantities: dict[str, str]) -> float:
    return max(category_scores_for(quantities).values())


def band_for_item_count(count: int) -> str:
    for upper, band in ITEM_COUNT_BANDS:
        if upper is None or count <= upper:
            return band
    return "Very Large"


def quantity_bands_for_counts(item_counts: dict[str, int]) -> dict[str, str]:
    return {
        category: band_for_item_count(count)
        for category, count in item_counts.items()
        if count > 0
    }


def validate_item_counts(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict) or not value:
        return None
    if any(category not in CATEGORY_WEIGHTS for category in value):
        return None
    counts: dict[str, int] = {}
    for category, count in value.items():
        if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= ITEM_COUNT_LIMIT:
            return None
        if count > 0:
            counts[category] = count
    return counts or None


def remaining_counts_for(report: Any, actions: list[Any]) -> dict[str, int]:
    try:
        original = json.loads(report.item_counts or "{}")
    except (TypeError, ValueError):
        return {}
    remaining = {category: int(count) for category, count in original.items() if int(count) > 0}
    for action in actions:
        try:
            removed = json.loads(action.removed_counts)
        except (TypeError, ValueError):
            continue
        for category, count in removed.items():
            remaining[category] = max(0, remaining.get(category, 0) - int(count))
    return {category: count for category, count in remaining.items() if count > 0}


def recovery_token_digest(recovery_token: str) -> str:
    return hashlib.sha256(recovery_token.encode("utf-8")).hexdigest()


def create_share_token(event_id: str | None, report_id: str | None, jwt_secret: str) -> str:
    """Create a stable, signed token scoped to one public event and optional report."""
    return jwt.encode(
        {"purpose": "iteration2-share", "eventId": event_id, "reportId": report_id},
        jwt_secret,
        algorithm=AUTH_JWT_ALGORITHM,
    )


def decode_share_token(token: str, jwt_secret: str) -> dict[str, Any] | None:
    try:
        claims = jwt.decode(token, jwt_secret, algorithms=[AUTH_JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    event_id, report_id = claims.get("eventId"), claims.get("reportId")
    if (
        claims.get("purpose") != "iteration2-share"
        or (event_id is not None and not isinstance(event_id, str))
        or (report_id is not None and not isinstance(report_id, str))
        or (event_id is None and report_id is None)
    ):
        return None
    return claims


def create_recovery_token() -> str:
    raw = base64.b32encode(secrets.token_bytes(15)).decode("ascii").rstrip("=")
    return "RS-" + "-".join(raw[index:index + 4] for index in range(0, len(raw), 4))


def projected_grid(lat: float, lng: float) -> tuple[int, int]:
    """Return a roughly one-metre Web Mercator grid cell (all project beaches are tropical)."""
    latitude = min(85.05112878, max(-85.05112878, lat))
    radius = 6_378_137.0
    x = radius * math.radians(lng)
    y = radius * math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))
    return math.floor(x / GEO_GRID_METRES), math.floor(y / GEO_GRID_METRES)


def proximity_ref(lat: float, lng: float, target_id: str, secret: str) -> str:
    cell_x, cell_y = projected_grid(lat, lng)
    return proximity_ref_for_cell(cell_x, cell_y, target_id, secret)


def proximity_ref_for_cell(cell_x: int, cell_y: int, target_id: str, secret: str) -> str:
    message = b"|".join((GEO_HMAC_CONTEXT, target_id.encode("utf-8"), str(cell_x).encode(), str(cell_y).encode()))
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def nearby_proximity_refs(lat: float, lng: float, target_id: str, secret: str) -> set[str]:
    cell_x, cell_y = projected_grid(lat, lng)
    # Include every one-metre cell that can intersect a 10 m circle. The extra
    # half-diagonal makes boundary decisions conservative by at most ~1.5 m.
    radius_cells = ACTIVE_TARGET_RADIUS_METRES + 1.5
    extent = math.ceil(radius_cells)
    return {
        proximity_ref_for_cell(cell_x + dx, cell_y + dy, target_id, secret)
        for dy in range(-extent, extent + 1)
        for dx in range(-extent, extent + 1)
        if math.hypot(dx, dy) <= radius_cells
    }


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlambda = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    haversine = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(min(1.0, haversine)))


def public_participant_count(value: int) -> int | str:
    return value if value >= 3 else "Fewer than 3"


def quantity_band_from_storage(value: Any) -> str | None:
    """Read schema band codes and legacy text labels into the API vocabulary."""
    if isinstance(value, str):
        value = value.strip()
        if value in QUANTITY_WEIGHTS:
            return value
        if not value.isdecimal():
            return None
        value = int(value)
    if isinstance(value, int) and not isinstance(value, bool):
        return next((band for band, code in QUANTITY_WEIGHTS.items() if code == value), None)
    return None


def quantities_from_row(row: Any) -> dict[str, str]:
    quantities: dict[str, str] = {}
    for category, column in QUANTITY_COLUMNS.items():
        band = quantity_band_from_storage(getattr(row, column))
        if band is not None:
            quantities[category] = band
    return quantities


def quantity_values(quantities: dict[str, str]) -> dict[str, str | None]:
    return {column: quantities.get(category) for category, column in QUANTITY_COLUMNS.items()}


def is_json_number(value: Any) -> bool:
    """JSON coordinates are numbers; reject booleans and numeric strings."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def composition_percentages(quantities: dict[str, str]) -> list[dict[str, Any]]:
    """Convert the newest report's category scores into whole percentages.

    Each category contributes its category score (category weight x quantity
    level), so the percentages follow the published scoring rule instead of the
    quantity bands alone.

    The largest-remainder method keeps every response at exactly 100, avoiding
    a chart whose labels visibly add up to 99 or 101 because of rounding.
    """

    weighted = [
        (category, CATEGORY_WEIGHTS[category] * QUANTITY_WEIGHTS[quantities[category]])
        for category in FRONTEND_CATEGORIES
        if category in quantities
    ]
    total = sum(weight for _, weight in weighted)
    if total <= 0:
        return []
    exact = [(category, weight * 100 / total) for category, weight in weighted]
    whole = {category: math.floor(value) for category, value in exact}
    remainder = 100 - sum(whole.values())
    for category, _ in sorted(exact, key=lambda item: item[1] - math.floor(item[1]), reverse=True)[:remainder]:
        whole[category] += 1
    return [{"category": category, "percentage": whole[category]} for category, _ in weighted]


def attention_score_for(rows: list[Any]) -> float | None:
    if len(rows) < 3:
        return None
    scores = [report_score_for(quantities_from_row(row)) for row in rows]
    return float(median(scores))


def severity_for(rows: list[Any]) -> tuple[str | None, int | None]:
    score = attention_score_for(rows)
    if score is None:
        return None, None
    if score < 1.5:
        return "Low", 1
    if score < 2.5:
        return "Moderate", 2
    if score < 3.5:
        return "High", 3
    return "Severe", 4


def active_attention_rows(engine: Engine, rows: list[Any]) -> list[tuple[Any, dict[str, str]]]:
    """Return recent Counted reports that still have litter to attend to."""
    counted_rows = [row for row in rows if row.id not in LEGACY_SEED_REPORT_IDS and getattr(row, "item_counts", None) is not None]
    report_ids = [row.id for row in counted_rows]
    with engine.connect() as connection:
        actions = connection.execute(
            select(cleanup_actions_table).where(cleanup_actions_table.c.target_report_id.in_(report_ids))
        ).all()
    actions_by_report: defaultdict[str, list[Any]] = defaultdict(list)
    for action in actions:
        actions_by_report[action.target_report_id].append(action)
    active: list[tuple[Any, dict[str, str]]] = []
    for row in rows:
        if row.id in LEGACY_SEED_REPORT_IDS:
            continue
        quantities = quantity_band_state_for(row, actions_by_report[row.id])
        if quantities and any(value != "Small" for value in quantities.values()):
            active.append((row, quantities))
    return active


def remaining_count_attention(engine: Engine, rows: list[Any]) -> float | None:
    active = active_attention_rows(engine, rows)
    if len(active) < 3:
        return None
    return float(median(report_score_for(quantities) for _, quantities in active))


def severity_from_score(score: float | None) -> tuple[str | None, int | None]:
    if score is None:
        return None, None
    if score < 1.5:
        return "Low", 1
    if score < 2.5:
        return "Moderate", 2
    if score < 3.5:
        return "High", 3
    return "Severe", 4


def beach_summary(engine: Engine, beach: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    current_time = now or datetime.now(timezone.utc)
    cutoff = current_time - timedelta(days=90)
    with engine.connect() as connection:
        all_counted = connection.execute(
            select(reports_table).where(
                reports_table.c.beach_id == beach["id"],
                reports_table.c.status == "Counted",
            )
        ).all()
    eligible = [row for row in all_counted if row.id not in LEGACY_SEED_REPORT_IDS and utc_datetime(row.created_at) >= cutoff]
    all_counted = [row for row in all_counted if row.id not in LEGACY_SEED_REPORT_IDS]
    active_rows = active_attention_rows(engine, eligible)
    attention_score = (
        float(median(report_score_for(quantities) for _, quantities in active_rows))
        if len(active_rows) >= 3
        else None
    )
    severity, band = severity_from_score(attention_score)
    newest = max(all_counted, key=lambda row: utc_datetime(row.created_at), default=None)
    newest_counted_at = max((utc_datetime(row.created_at) for row, _ in active_rows), default=None)
    if newest_counted_at is None:
        freshness = "stale"
    else:
        age = current_time - newest_counted_at
        freshness = "ok" if age < timedelta(days=30) else "aging" if age <= timedelta(days=90) else "stale"
    summary = {field: beach[field] for field in BEACH_SUMMARY_FIELDS}
    summary.update(
        {
            "severity": severity,
            "band": band,
            "insufficientData": severity is None,
            "validReports": len(active_rows),
            "attentionScore": round(attention_score, 2) if attention_score is not None else None,
            "eligibleReportCount": len(active_rows),
            "lastReportedAt": contract_timestamp(newest.created_at) if newest else None,
            "newestCountedReportAt": contract_timestamp(newest_counted_at) if newest_counted_at else None,
            "latestContributingReportAt": contract_timestamp(newest_counted_at) if newest_counted_at else None,
            "freshnessKind": freshness,
        }
    )
    return summary


def beach_summaries_batch(engine: Engine, beaches: list[dict[str, Any]], now: datetime | None = None) -> list[dict[str, Any]]:
    """Build all beach cards from one report query and one cleanup query."""
    current_time = now or datetime.now(timezone.utc)
    cutoff = current_time - timedelta(days=90)
    beach_ids = [beach["id"] for beach in beaches]
    with engine.connect() as connection:
        reports = connection.execute(select(reports_table).where(reports_table.c.beach_id.in_(beach_ids))).all()
        report_ids = [row.id for row in reports]
        actions = connection.execute(
            select(cleanup_actions_table).where(cleanup_actions_table.c.target_report_id.in_(report_ids))
        ).all() if report_ids else []
    actions_by_report: defaultdict[str, list[Any]] = defaultdict(list)
    for action in actions:
        actions_by_report[action.target_report_id].append(action)
    result = []
    for beach in beaches:
        all_counted = [row for row in reports if row.id not in LEGACY_SEED_REPORT_IDS and row.beach_id == beach["id"] and row.status == "Counted" and getattr(row, "deleted_at", None) is None]
        eligible = [row for row in all_counted if utc_datetime(row.created_at) >= cutoff]
        active_rows = []
        for row in eligible:
            quantities = quantity_band_state_for(row, actions_by_report[row.id])
            active_quantities = {category: band for category, band in quantities.items() if band != "Small"}
            if active_quantities:
                active_rows.append((row, active_quantities))
        score = float(median(report_score_for(q) for _, q in active_rows)) if len(active_rows) >= 3 else None
        severity, band = severity_from_score(score)
        newest = max(all_counted, key=lambda row: utc_datetime(row.created_at), default=None)
        newest_counted_at = max((utc_datetime(row.created_at) for row, _ in active_rows), default=None)
        age = current_time - newest_counted_at if newest_counted_at else None
        summary = {field: beach[field] for field in BEACH_SUMMARY_FIELDS}
        summary.update({
            "severity": severity, "band": band, "insufficientData": severity is None,
            "validReports": len(active_rows), "attentionScore": round(score, 2) if score is not None else None,
            "eligibleReportCount": len(active_rows), "lastReportedAt": contract_timestamp(newest.created_at) if newest else None,
            "newestCountedReportAt": contract_timestamp(newest_counted_at) if newest_counted_at else None,
            "latestContributingReportAt": contract_timestamp(newest_counted_at) if newest_counted_at else None,
            "freshnessKind": "stale" if age is None else "ok" if age < timedelta(days=30) else "aging" if age <= timedelta(days=90) else "stale",
        })
        result.append(summary)
    return result


def photo_storage_path(configured: str | Path | None) -> Path:
    value = configured or os.getenv("PHOTO_STORAGE_DIR")
    path = Path(value) if value else Path(tempfile.gettempdir()) / "radar-sampah-private-photos"
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def photo_file_path(directory: Path, photo_key: str) -> Path | None:
    if not re.fullmatch(r"[0-9a-f]{32}\.jpg", photo_key):
        return None
    path = (directory / photo_key).resolve()
    return path if directory in path.parents else None


def photo_metadata_path(directory: Path, photo_key: str) -> Path | None:
    photo_path = photo_file_path(directory, photo_key)
    return photo_path.with_name(photo_path.name + ".meta.json") if photo_path else None


def read_photo_metadata(directory: Path, photo_key: str) -> dict[str, Any] | None:
    path = photo_metadata_path(directory, photo_key)
    if path is None or not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def write_photo_metadata(directory: Path, photo_key: str, value: dict[str, Any]) -> None:
    path = photo_metadata_path(directory, photo_key)
    assert path is not None
    path.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")


def process_photo(raw: bytes) -> bytes:
    try:
        with Image.open(BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source)
            image.thumbnail((PHOTO_MAX_EDGE, PHOTO_MAX_EDGE), Image.Resampling.LANCZOS)
            if image.mode not in {"RGB", "L"}:
                background = Image.new("RGB", image.size, "white")
                if "A" in image.getbands():
                    background.paste(image, mask=image.getchannel("A"))
                else:
                    background.paste(image)
                image = background
            elif image.mode == "L":
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=90, optimize=True)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ValueError("The photo could not be read. Please choose another image.") from error


def photo_blob(engine: Engine, photo_key: str, owner_id: str) -> Any | None:
    if not owner_id:
        return None
    with engine.connect() as connection:
        return connection.execute(select(report_photos_table).where(
            report_photos_table.c.photo_key == photo_key,
            report_photos_table.c.owner_id == owner_id,
        )).first()


def stored_photo_metadata(engine: Engine | None, directory: Path, photo_key: str) -> dict[str, Any] | None:
    if engine is not None:
        with engine.connect() as connection:
            row = connection.execute(select(
                report_photos_table.c.owner_id, report_photos_table.c.mime,
            ).where(report_photos_table.c.photo_key == photo_key)).first()
        if row is not None:
            return {"ownerId": row.owner_id, "mime": row.mime, "metadataStripped": True}
    path = photo_file_path(directory, photo_key)
    return read_photo_metadata(directory, photo_key) if path is not None and path.is_file() else None


def photo_available(engine: Engine | None, directory: Path, photo_key: str, owner_id: str) -> bool:
    info = stored_photo_metadata(engine, directory, photo_key)
    return bool(owner_id and info and info.get("ownerId") == owner_id)


def read_photo_source(engine: Engine, directory: Path, photo_key: str, owner_id: str) -> BytesIO | Path | None:
    blob = photo_blob(engine, photo_key, owner_id)
    if blob is not None:
        return BytesIO(blob.data)
    if photo_available(engine, directory, photo_key, owner_id):
        return photo_file_path(directory, photo_key)
    return None


def signed_photo_url(
    photo_key: str,
    owner_id: str,
    jwt_secret: str,
    directory: Path,
    engine: Engine | None = None,
    photo_info: dict[str, Any] | None = None,
) -> str | None:
    if photo_info is False:
        return None
    if photo_info is None and not photo_available(engine, directory, photo_key, owner_id):
        return None
    if photo_info is not None and photo_info.get("ownerId") != owner_id:
        return None
    if photo_info is not None and photo_info.get("legacy"):
        legacy_path = photo_file_path(directory, photo_key)
        if legacy_path is None or not legacy_path.is_file():
            return None
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": owner_id,
            "photoKey": photo_key,
            "purpose": "photo-preview",
            "iat": now,
            "exp": now + timedelta(minutes=PHOTO_URL_TTL_MINUTES),
        },
        jwt_secret,
        algorithm=AUTH_JWT_ALGORITHM,
    )
    return request.url_root.rstrip("/") + "/uploads/photos/" + photo_key + "?" + urlencode({"token": token})


def delete_photo(directory: Path, photo_key: str) -> None:
    for path in (photo_file_path(directory, photo_key), photo_metadata_path(directory, photo_key)):
        if path is not None and path.is_file():
            path.unlink(missing_ok=True)


def delete_photo_if_unreferenced(engine: Engine, directory: Path, photo_key: str) -> None:
    with engine.begin() as connection:
        referenced = connection.execute(
            select(reports_table.c.id).where(reports_table.c.photo_key == photo_key)
        ).first()
        if referenced is None:
            connection.execute(report_photos_table.delete().where(
                report_photos_table.c.photo_key == photo_key,
                ~select(reports_table.c.id).where(reports_table.c.photo_key == photo_key).exists(),
            ))
    if referenced is None:
        delete_photo(directory, photo_key)


def sweep_orphan_photos(engine: Engine, directory: Path) -> None:
    cutoff = datetime.now(timezone.utc) - PHOTO_ORPHAN_TTL
    with engine.begin() as connection:
        connection.execute(report_photos_table.delete().where(
            report_photos_table.c.created_at < cutoff,
            ~select(reports_table.c.id).where(
                reports_table.c.photo_key == report_photos_table.c.photo_key,
            ).exists(),
        ))
    with engine.connect() as connection:
        referenced = set(connection.execute(select(reports_table.c.photo_key)).scalars().all())
    for metadata_path in directory.glob("*.jpg.meta.json"):
        photo_key = metadata_path.name.removesuffix(".meta.json")
        if photo_key in referenced:
            continue
        metadata_value = read_photo_metadata(directory, photo_key)
        try:
            created_at = datetime.fromisoformat(str((metadata_value or {}).get("createdAt", "")))
        except ValueError:
            created_at = datetime.fromtimestamp(metadata_path.stat().st_mtime, tz=timezone.utc)
        if utc_datetime(created_at) < cutoff:
            delete_photo(directory, photo_key)


def schedule_orphan_cleanup(engine: Engine, directory: Path, photo_key: str, created_at: datetime) -> threading.Timer:
    delay = max(0.0, (utc_datetime(created_at) + PHOTO_ORPHAN_TTL - datetime.now(timezone.utc)).total_seconds())
    timer = threading.Timer(delay, delete_photo_if_unreferenced, args=(engine, directory, photo_key))
    timer.daemon = True
    timer.start()
    return timer


def quantity_band_state_for(report: Any, actions: list[Any]) -> dict[str, str]:
    """Return the current band state, including canonical cleanup after-states."""
    canonical = [action for action in actions if getattr(action, "remaining_quantities", None)]
    if canonical:
        try:
            parsed = json.loads(max(canonical, key=lambda action: utc_datetime(action.created_at)).remaining_quantities)
        except (TypeError, ValueError):
            parsed = {}
        return {category: band for category, band in (parsed or {}).items() if category in CATEGORY_WEIGHTS and band in QUANTITY_WEIGHTS}
    if getattr(report, "item_counts", None):
        return quantity_bands_for_counts(remaining_counts_for(report, actions))
    return quantities_from_row(report)


def report_dict(
    row: Any,
    viewer_id: str,
    jwt_secret: str,
    directory: Path,
    beach_names: dict[str, str],
    engine: Engine | None = None,
    actions: list[Any] | None = None,
    photo_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # Exact coordinates and photo bytes are never copied into this response.
    quantities = quantities_from_row(row)
    value: dict[str, Any] = {
        "id": row.id,
        "beachId": row.beach_id,
        "beachName": beach_names.get(row.beach_id, row.beach_id),
        "quantities": quantities,
        "category": row.category,
        "quantity": row.quantity,
        "categoryScores": {category: round(score, 2) for category, score in category_scores_for(quantities).items()},
        "reportScore": round(report_score_for(quantities), 2),
        "createdAt": contract_timestamp(row.created_at),
        "status": row.status,
        "locationSource": row.location_source,
    }
    if getattr(row, "status_note", None):
        value["statusNote"] = row.status_note
    elif row.status in REPORT_STATUS_NOTES:
        value["statusNote"] = REPORT_STATUS_NOTES[row.status]
    loaded_actions = actions
    eligible_cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    if row.status != "Counted" or utc_datetime(row.created_at) < eligible_cutoff or getattr(row, "deleted_at", None) is not None:
        value["currentState"] = "excluded"
    else:
        loaded_actions = actions
        if loaded_actions is None and engine is not None:
            with engine.connect() as connection:
                loaded_actions = connection.execute(select(cleanup_actions_table).where(cleanup_actions_table.c.target_report_id == row.id)).all()
        current_quantities = quantity_band_state_for(row, loaded_actions or [])
        value["currentState"] = "active" if any(band != "Small" for band in current_quantities.values()) else "resolved"
    if getattr(row, "item_counts", None):
        try:
            item_counts = json.loads(row.item_counts)
        except (TypeError, ValueError):
            item_counts = {}
        value["itemCounts"] = item_counts
        remaining = item_counts
        if loaded_actions is not None:
            remaining = remaining_counts_for(row, loaded_actions)
        value["remainingItemCounts"] = remaining
        value["eventId"] = getattr(row, "event_id", None)
    if viewer_id == row.reporter_id:
        # The opaque key is returned only to the owner so an expired preview can be renewed.
        value["photoKey"] = row.photo_key
        photo_url = signed_photo_url(row.photo_key, row.reporter_id, jwt_secret, directory, engine, photo_info)
        if photo_url:
            value["photoUrl"] = photo_url
    return value


def report_problem(status: int, code: str, message: str) -> tuple[int, str, str]:
    return status, code, message


def validate_report_payload(
    payload: Any,
    beaches: list[dict[str, Any]],
    owner_id: str,
    directory: Path,
    require_uploaded_photo: bool,
    engine: Engine | None = None,
) -> tuple[dict[str, Any] | None, tuple[int, str, str] | None]:
    if not isinstance(payload, dict):
        return None, report_problem(400, "VALIDATION_FAILED", "A JSON object is required.")
    if set(payload) - REPORT_INPUT_FIELDS - ITERATION2_REPORT_FIELDS:
        return None, report_problem(400, "VALIDATION_FAILED", "The report contains unsupported fields.")

    photo_key = str(payload.get("photoKey") or "").strip()
    if not photo_key:
        return None, report_problem(400, "PHOTO_REQUIRED", "A photo is required.")

    item_counts = validate_item_counts(payload.get("itemCounts")) if "itemCounts" in payload else None
    if "itemCounts" in payload and item_counts is None:
        return None, report_problem(400, "VALIDATION_FAILED", "itemCounts must contain positive whole-item counts for valid categories.")
    quantities = payload.get("quantities")
    if quantities is None and item_counts is not None:
        quantities = quantity_bands_for_counts(item_counts)
    if (
        not isinstance(quantities, dict)
        or not quantities
        or any(category not in CATEGORY_WEIGHTS or quantity not in QUANTITY_WEIGHTS for category, quantity in quantities.items())
    ):
        return None, report_problem(400, "VALIDATION_FAILED", "Choose at least one valid category and quantity band.")
    if item_counts is not None and quantities != quantity_bands_for_counts(item_counts):
        return None, report_problem(400, "VALIDATION_FAILED", "quantity bands must match the submitted itemCounts.")

    beach_id = str(payload.get("beachId") or "").strip()
    beach = next((item for item in beaches if item["id"] == beach_id), None)
    if beach is None:
        return None, report_problem(404, "NOT_FOUND", "Beach not found.")

    location_source = payload.get("locationSource")
    if location_source not in {"gps", "manual"}:
        return None, report_problem(400, "VALIDATION_FAILED", "locationSource must be gps or manual.")

    lat = lng = None
    coords = payload.get("coords")
    if location_source == "gps":
        if not isinstance(coords, dict) or set(coords) != {"lat", "lng"}:
            return None, report_problem(400, "VALIDATION_FAILED", "GPS reports require lat and lng.")
        if not is_json_number(coords["lat"]) or not is_json_number(coords["lng"]):
            return None, report_problem(400, "VALIDATION_FAILED", "lat and lng must be numbers.")
        try:
            raw_lat, raw_lng = float(coords["lat"]), float(coords["lng"])
        except (TypeError, ValueError):
            return None, report_problem(400, "VALIDATION_FAILED", "lat and lng must be numbers.")
        if not math.isfinite(raw_lat) or not math.isfinite(raw_lng) or not -90 <= raw_lat <= 90 or not -180 <= raw_lng <= 180:
            return None, report_problem(400, "VALIDATION_FAILED", "lat or lng is outside its valid range.")
        lat, lng = (raw_lat, raw_lng) if item_counts is not None else (round(raw_lat, 3), round(raw_lng, 3))
    elif coords is not None:
        return None, report_problem(400, "VALIDATION_FAILED", "Manual reports must not include coordinates.")

    photo_metadata = stored_photo_metadata(engine, directory, photo_key)
    if require_uploaded_photo and (photo_metadata is None or photo_metadata.get("ownerId") != owner_id):
        return None, report_problem(404, "NOT_FOUND", "Photo not found.")

    category, quantity = derive_category_quantity(quantities)
    event_id = payload.get("eventId")
    if event_id is not None and (not isinstance(event_id, str) or not event_id.strip() or len(event_id) > 100):
        return None, report_problem(400, "VALIDATION_FAILED", "eventId must be a valid event identifier.")
    return {
        "beach": beach,
        "quantities": quantities,
        "category": category,
        "quantity": quantity,
        "photo_key": photo_key,
        "photo_mime": (photo_metadata or {}).get("mime"),
        "photo_stripped": (photo_metadata or {}).get("metadataStripped"),
        "location_source": location_source,
        "lat": lat,
        "lng": lng,
        "item_counts": item_counts,
        "event_id": event_id,
    }, None


def duplicate_status(
    connection: Any,
    reporter_id: str,
    beach_id: str,
    created_at: datetime,
    exclude_report_id: str | None = None,
) -> str:
    query = select(reports_table.c.id, reports_table.c.created_at).where(
        reports_table.c.reporter_id == reporter_id,
        reports_table.c.beach_id == beach_id,
        reports_table.c.status == "Counted",
    )
    rows = connection.execute(query).all()
    local_day = utc_datetime(created_at).astimezone(KUALA_LUMPUR).date()
    for row in rows:
        if row.id != exclude_report_id and utc_datetime(row.created_at).astimezone(KUALA_LUMPUR).date() == local_day:
            return "Duplicate"
    return "Counted"


def create_app(
    database_url: str | None = None,
    testing: bool = False,
    photo_storage_dir: str | Path | None = None,
) -> Flask:
    jwt_secret = auth_jwt_secret(testing)
    application = Flask(__name__)
    application.config.update(TESTING=testing, MAX_CONTENT_LENGTH=12 * 1024 * 1024)
    CORS(application, resources={r"/*": {"origins": os.getenv("FRONTEND_ORIGINS", "*").split(",")}})

    engine = create_engine_for_url(normalise_database_url(database_url or os.getenv("DATABASE_URL")))
    initialise_database(engine)
    # Render's small free instance keeps the ONNX session lazy, while the
    # dedicated GCP VM can keep the detector resident and remove first-photo
    # model loading from the request path.
    if os.getenv("LITTER_PRELOAD", "").lower() in {"1", "true", "yes", "on"}:
        from recognition import LitterRecognizer

        recognizer = LitterRecognizer.load()
    else:
        recognizer = _LazyLitterRecognizer()
    species_distribution_model = load_species_distribution_model()
    directory = photo_storage_path(photo_storage_dir)
    seed_reference_data(engine, load_beaches())
    beaches = load_beaches(engine)
    beach_names = {beach["id"]: beach["name"] for beach in beaches}
    application.extensions["marine_engine"] = engine
    application.extensions["photo_storage_dir"] = directory
    # Load the 40 packaged species models once at startup. Prediction never
    # queries OBIS and does not write coordinates or scores to the database.
    application.extensions["photo_cleanup_timers"] = []
    application.extensions["litter_recognizer"] = recognizer
    application.extensions["species_distribution_model"] = species_distribution_model
    sweep_orphan_photos(engine, directory)
    with engine.connect() as connection:
        pending_photos = connection.execute(select(
            report_photos_table.c.photo_key, report_photos_table.c.created_at,
        ).where(~select(reports_table.c.id).where(
            reports_table.c.photo_key == report_photos_table.c.photo_key,
        ).exists())).all()
    for photo in pending_photos:
        application.extensions["photo_cleanup_timers"].append(
            schedule_orphan_cleanup(engine, directory, photo.photo_key, photo.created_at)
        )
    for metadata_path in directory.glob("*.jpg.meta.json"):
        photo_key = metadata_path.name.removesuffix(".meta.json")
        metadata_value = read_photo_metadata(directory, photo_key)
        try:
            created_at = datetime.fromisoformat(str((metadata_value or {}).get("createdAt", "")))
        except ValueError:
            created_at = datetime.fromtimestamp(metadata_path.stat().st_mtime, tz=timezone.utc)
        application.extensions["photo_cleanup_timers"].append(
            schedule_orphan_cleanup(engine, directory, photo_key, created_at)
        )
    rate_events: defaultdict[tuple[str, str], deque[float]] = defaultdict(deque)

    def require_auth(view: Callable[..., Any]):
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any):
            header = request.headers.get("Authorization", "")
            token = header[len("Bearer "):].strip() if header.startswith("Bearer ") else ""
            user_id = decode_token_subject(token, jwt_secret) if token else None
            if user_id is None:
                return error_response(401, "UNAUTHENTICATED", "Sign in to continue.")
            with engine.connect() as connection:
                row = connection.execute(select(users_table).where(users_table.c.id == user_id)).first()
            if row is None:
                return error_response(401, "UNAUTHENTICATED", "Sign in to continue.")
            request.current_user = row
            return view(*args, **kwargs)

        return wrapper

    def require_moderator(view: Callable[..., Any]):
        @wraps(view)
        @require_auth
        def wrapper(*args: Any, **kwargs: Any):
            if request.current_user.role != "moderator":
                return error_response(403, "MODERATOR_REQUIRED", "A moderator account is required to manage events.")
            return view(*args, **kwargs)

        return wrapper

    def optional_current_user() -> Any | None:
        header = request.headers.get("Authorization", "")
        token = header[len("Bearer "):].strip() if header.startswith("Bearer ") else ""
        user_id = decode_token_subject(token, jwt_secret) if token else None
        if user_id is None:
            return None
        with engine.connect() as connection:
            return connection.execute(select(users_table).where(users_table.c.id == user_id)).first()

    def rate_limited(bucket: str, limit: int):
        def decorator(view: Callable[..., Any]):
            @wraps(view)
            def wrapper(*args: Any, **kwargs: Any):
                now = time.monotonic()
                events = rate_events[(bucket, request.current_user.id)]
                while events and events[0] <= now - 3600:
                    events.popleft()
                if len(events) >= limit:
                    return error_response(429, "RATE_LIMITED", "Too many requests. Please try again later.")
                events.append(now)
                return view(*args, **kwargs)

            return wrapper

        return decorator

    def upcoming_saturdays(now: datetime) -> list[datetime]:
        local_now = utc_datetime(now).astimezone(KUALA_LUMPUR)
        first_date = local_now.date() + timedelta(days=(5 - local_now.weekday()) % 7)
        first_start = datetime.combine(first_date, datetime.min.time(), tzinfo=KUALA_LUMPUR).replace(hour=EVENT_START_LOCAL_HOUR)
        if first_date == local_now.date() and local_now >= first_start.replace(hour=EVENT_END_LOCAL_HOUR):
            first_date += timedelta(days=7)
        return [
            datetime.combine(first_date + timedelta(days=7 * offset), datetime.min.time(), tzinfo=KUALA_LUMPUR)
            .replace(hour=EVENT_START_LOCAL_HOUR)
            .astimezone(timezone.utc)
            for offset in range(EVENTS_PER_BEACH)
        ]

    def ensure_scheduled_events(now: datetime | None = None) -> None:
        current = now or datetime.now(timezone.utc)
        starts = upcoming_saturdays(current)
        scheduled = [
            (beach, starts_at, f"{beach['id']}-{starts_at.astimezone(KUALA_LUMPUR).date().isoformat()}")
            for beach in beaches
            for starts_at in starts
        ]
        with engine.begin() as connection:
            existing_ids = set(connection.execute(
                select(events_table.c.id).where(events_table.c.id.in_(event_id for _, _, event_id in scheduled))
            ).scalars())
            for beach, starts_at, event_id in scheduled:
                if event_id in existing_ids:
                    continue
                try:
                    with connection.begin_nested():
                        connection.execute(insert(events_table).values(
                            id=event_id,
                            beach_id=beach["id"],
                            starts_at=starts_at,
                            ends_at=starts_at + timedelta(hours=EVENT_END_LOCAL_HOUR - EVENT_START_LOCAL_HOUR),
                            status="Open",
                            source="scheduled",
                            created_by=None,
                            created_at=current,
                            updated_at=current,
                        ))
                except IntegrityError:
                    # Another worker may have inserted this deterministic slot first.
                    continue
            connection.execute(events_table.update().where(
                events_table.c.status == "Open",
                events_table.c.ends_at < current,
            ).values(status="Closed", updated_at=current))

    def event_has_evidence(connection: Any, event: Any, participant_id: str) -> bool:
        start, end = utc_datetime(event.starts_at), utc_datetime(event.ends_at)
        report = connection.execute(
            select(reports_table.c.id).where(
                reports_table.c.reporter_id == participant_id,
                reports_table.c.event_id == event.id,
                reports_table.c.beach_id == event.beach_id,
                reports_table.c.status == "Counted",
                reports_table.c.created_at >= start,
                reports_table.c.created_at <= end,
            ).limit(1)
        ).first()
        if report is not None:
            return True
        cleanup = connection.execute(
            select(cleanup_actions_table.c.id).where(
                cleanup_actions_table.c.participant_id == participant_id,
                cleanup_actions_table.c.event_id == event.id,
                cleanup_actions_table.c.created_at >= start,
                cleanup_actions_table.c.created_at <= end,
            ).limit(1)
        ).first()
        return cleanup is not None

    def event_dicts(event_rows: list[Any], viewer_id: str | None = None) -> list[dict[str, Any]]:
        if not event_rows:
            return []
        event_ids = [event.id for event in event_rows]
        with engine.connect() as connection:
            members = connection.execute(
                select(event_members_table)
                .where(event_members_table.c.event_id.in_(event_ids))
                .order_by(event_members_table.c.joined_at)
            ).all()

        members_by_event: defaultdict[str, list[Any]] = defaultdict(list)
        for member in members:
            members_by_event[member.event_id].append(member)

        payloads = []
        for event in event_rows:
            event_members = members_by_event[event.id]
            viewer_member = next((member for member in event_members if member.participant_id == viewer_id), None)
            beach_name = beach_names.get(event.beach_id, event.beach_id)
            beach = next((item for item in beaches if item["id"] == event.beach_id), None)
            local_start = utc_datetime(event.starts_at).astimezone(KUALA_LUMPUR)
            local_end = utc_datetime(event.ends_at).astimezone(KUALA_LUMPUR)
            payloads.append({
                "id": event.id,
                "beachId": event.beach_id,
                "beachName": beach_name,
                "area": beach["area"] if beach else beach_name,
                "date": local_start.date().isoformat(),
                "startsAt": local_start.strftime("%H:%M"),
                "endsAt": local_end.strftime("%H:%M"),
                # Null until a moderator sets one; the UI decides what to show.
                "meetingPoint": getattr(event, "meeting_point", None),
                "status": event.status,
                "source": "weekly" if event.source == "scheduled" else "admin",
                "participantCount": public_participant_count(len(event_members)),
                "checkedInCount": sum(member.location_passed for member in event_members),
                "attendanceCount": sum(member.location_passed for member in event_members),
                "joined": bool(viewer_member),
                "checkedIn": bool(viewer_member and viewer_member.location_passed),
                "attendanceConfirmed": bool(viewer_member and viewer_member.location_passed),
            })
        return payloads

    def event_dict(event: Any, viewer_id: str | None = None) -> dict[str, Any]:
        return event_dicts([event], viewer_id)[0]

    def cleanup_target_dict(report: Any, actions: list[Any]) -> dict[str, Any] | None:
        remaining = remaining_counts_for(report, actions)
        if report.status != "Counted" or not remaining:
            return None
        try:
            original = json.loads(report.item_counts or "{}")
        except (TypeError, ValueError):
            original = {}
        return {
            "reportId": report.id,
            "targetReportId": report.id,
            "beachId": report.beach_id,
            "beachName": beach_names.get(report.beach_id, report.beach_id),
            "reportedAt": contract_timestamp(report.created_at),
            "createdAt": contract_timestamp(report.created_at),
            "itemCounts": original,
            "remaining": remaining,
            "remainingTotal": sum(remaining.values()),
        }

    def cleanup_action_dict(action: Any) -> dict[str, Any]:
        with engine.connect() as connection:
            participant = connection.execute(select(users_table.c.participant_id).where(
                users_table.c.id == action.participant_id
            )).scalar_one_or_none()
        return {
            "id": action.id,
            "participantId": participant or action.participant_id,
            "targetReportId": action.target_report_id,
            "eventId": action.event_id,
            "beachId": action.beach_id,
            "beachName": beach_names.get(action.beach_id, action.beach_id),
            "createdAt": contract_timestamp(action.created_at),
            "rows": json.loads(action.rows),
            "score": action.total_removed,
            "handling": action.handling,
            "note": action.note or "",
            "status": "Cleanup recorded — awaiting follow-up",
        }

    def recognition_payload(result: dict[str, Any]) -> dict[str, Any]:
        counts = validate_item_counts(result.get("counts"))
        quantity_bands = quantity_bands_for_counts(counts) if counts else {}
        state = result.get("state")
        model_state = "empty" if state == "ready" and not counts else state
        if model_state == "failed":
            model_state = "unreadable"
        if model_state not in {"ready", "unavailable", "unreadable", "empty"}:
            model_state = "unavailable"
        return {
            "quantityBands": quantity_bands,
            "suggestions": quantity_bands,
            "confidence": result.get("confidence"),
            "modelVersion": result.get("modelVersion"),
            "state": model_state,
            "modelState": model_state,
            "manualEntryRequired": model_state != "ready",
            "supportedClasses": list(ITERATION2_CATEGORIES),
        }

    @application.errorhandler(RequestEntityTooLarge)
    def payload_too_large(_error: RequestEntityTooLarge):
        return error_response(413, "PAYLOAD_TOO_LARGE", "The upload payload is too large.")

    @application.errorhandler(404)
    def route_not_found(_error: Any):
        return error_response(404, "NOT_FOUND", "The requested resource was not found.")

    @application.errorhandler(Exception)
    def contract_error(error: Exception):
        if application.testing and not isinstance(error, HTTPException):
            raise error
        if isinstance(error, HTTPException):
            status = error.code or 500
            code = "VALIDATION_FAILED" if status < 500 else "INTERNAL_ERROR"
            return error_response(status, code, error.description or "The request could not be completed.")
        application.logger.exception("Unhandled API error", exc_info=error)
        return error_response(500, "INTERNAL_ERROR", "Something went wrong. Please try again later.")

    @application.get("/")
    def root():
        return jsonify({"project": "Radar Pantai", "status": "ready", "apiVersion": "3.0.0"})

    @application.get("/health")
    def health():
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except Exception:
            application.logger.exception("Database health check failed")
            return jsonify({"status": "unavailable", "database": "unavailable"}), 503
        return jsonify({"status": "ok", "database": "connected", "apiVersion": "3.0.0"})

    @application.post("/auth/anonymous")
    def create_anonymous_participant():
        recovery_token = create_recovery_token()
        with engine.begin() as connection:
            try:
                participant_id = generate_participant_id(connection)
            except RuntimeError as error:
                return error_response(500, "INTERNAL_ERROR", str(error))
            user_id = "u_" + secrets.token_hex(12)
            now = datetime.now(timezone.utc)
            connection.execute(
                insert(users_table).values(
                    id=user_id,
                    participant_id=participant_id,
                    role=DEFAULT_VOLUNTEER_ROLE,
                    user_token=recovery_token_digest(recovery_token),
                    created_at=now,
                )
            )
        return jsonify({
            "token": issue_token(user_id, jwt_secret),
            "recoveryToken": recovery_token,
            "user": {"id": user_id, "participantId": participant_id, "role": DEFAULT_VOLUNTEER_ROLE},
        }), 201

    @application.post("/auth/restore")
    def restore_anonymous_participant():
        payload = request.get_json(silent=True)
        participant_id = str(payload.get("participantId") or "").strip() if isinstance(payload, dict) else ""
        supplied_recovery_token = str(payload.get("token") or "").strip() if isinstance(payload, dict) else ""
        if not re.fullmatch(r"\d{4}", participant_id):
            return error_response(404, "UNKNOWN_PARTICIPANT", "That participant ID was not found.")
        with engine.connect() as connection:
            row = connection.execute(select(users_table).where(users_table.c.participant_id == participant_id)).first()
        if row is None:
            return error_response(404, "UNKNOWN_PARTICIPANT", "That participant ID was not found.")
        # A participant ID is public: it is printed on reports, event signups and
        # share pages. Restoring on the ID alone would hand anybody a working
        # session for any account they can enumerate, so the recovery token is
        # required and checked before a token is issued.
        if not supplied_recovery_token:
            return error_response(
                401,
                "RECOVERY_TOKEN_REQUIRED",
                "Enter the recovery token you saved when you joined.",
            )
        stored_digest = getattr(row, "user_token", None)
        digest_match = bool(
            stored_digest
            and hmac.compare_digest(stored_digest, recovery_token_digest(supplied_recovery_token))
        )
        # Tokens issued before the digest was stored were derived from the
        # server's signing secret and the internal user id, so they cannot be
        # re-derived by a client that only knows the public participant ID.
        legacy_match = bool(recovery_token_matches(row.id, supplied_recovery_token, jwt_secret))
        if not (digest_match or legacy_match):
            return error_response(
                401,
                "INVALID_RECOVERY_TOKEN",
                "That participant ID and recovery token do not match.",
            )
        return jsonify({"token": issue_token(row.id, jwt_secret), "user": user_dict(row)})

    @application.post("/auth/logout")
    @require_auth
    def logout_anonymous_participant():
        return "", 204

    @application.get("/auth/me")
    @require_auth
    def get_current_participant():
        return jsonify(user_dict(request.current_user))

    @application.get("/beaches")
    def get_beaches():
        now = datetime.now(timezone.utc)
        return jsonify(beach_summaries_batch(engine, beaches, now))

    @application.get("/beaches/<beach_id>")
    def get_beach(beach_id: str):
        beach = next((item for item in beaches if item["id"] == beach_id), None)
        if beach is None:
            return error_response(404, "NOT_FOUND", "Beach not found.")
        detail = beach_summary(engine, beach)
        detail.update({"species": beach.get("species", []), "ecologicalNote": beach.get("ecologicalNote", "")})
        with engine.connect() as connection:
            row = connection.execute(
                select(reports_table)
                .where(
                    reports_table.c.beach_id == beach_id,
                    reports_table.c.status == "Counted",
                )
                .order_by(reports_table.c.created_at.desc())
            ).first()
        if row is None:
            detail.update({"composition": None, "compositionSource": None})
        else:
            quantities = quantities_from_row(row)
            if getattr(row, "item_counts", None):
                with engine.connect() as connection:
                    actions = connection.execute(
                        select(cleanup_actions_table).where(cleanup_actions_table.c.target_report_id == row.id)
                    ).all()
                quantities = quantity_bands_for_counts(remaining_counts_for(row, actions))
            detail.update(
                {
                    "composition": composition_percentages(quantities),
                    "compositionSource": {
                        "reportId": row.id,
                        "createdAt": contract_timestamp(row.created_at),
                        "method": "reported_quantity_estimate",
                    },
                }
            )
        return jsonify(detail)

    @application.get("/scoring-method")
    def get_scoring_method():
        return jsonify(
            {
                "categoryWeights": [{"category": category, "weight": CATEGORY_WEIGHTS[category]} for category in FRONTEND_CATEGORIES],
                "quantityWeights": [{"quantity": quantity, "weight": weight} for quantity, weight in QUANTITY_WEIGHTS.items()],
                "bands": list(SCORING_BANDS),
                "windowDays": 90,
                "minReports": 3,
                "reportEligibility": "Counted reports in the latest 90 days with remaining litter after cleanup; fully cleared count-backed reports are excluded from the active count but retained in history",
                "reportAggregation": "max",
                "beachAggregation": "median-of-active-reports",
                "ruleVersion": "radar-sampah-scoring-v3",
            }
        )

    @application.get("/api/species-distribution/species")
    def species_distribution_catalog():
        return jsonify(application.extensions["species_distribution_model"].catalog())

    @application.post("/api/species-distribution/predict")
    def predict_species_distribution():
        payload = request.get_json(silent=True)
        if (not isinstance(payload, dict)
                or not {"latitude", "longitude"} <= set(payload)
                or set(payload) - {"latitude", "longitude", "mode", "topK"}):
            return error_response(400, "VALIDATION_FAILED", "latitude and longitude are required.")
        if not is_json_number(payload["latitude"]) or not is_json_number(payload["longitude"]):
            return error_response(400, "VALIDATION_FAILED", "latitude and longitude must be numbers.")
        try:
            latitude, longitude = float(payload["latitude"]), float(payload["longitude"])
        except (TypeError, ValueError, OverflowError):
            return error_response(400, "VALIDATION_FAILED", "latitude and longitude must be numbers.")
        mode = payload.get("mode", "exact")
        if mode not in ("exact", "nearby_marine"):
            return error_response(400, "VALIDATION_FAILED", "mode must be exact or nearby_marine.")
        try:
            model = application.extensions["species_distribution_model"]
            if mode == "nearby_marine":
                result = model.predict_nearby_marine(
                    latitude,
                    longitude,
                    max_distance_km=15,
                    top_k=payload.get("topK", 5),
                )
            else:
                result = model.predict(latitude, longitude, top_k=payload.get("topK", 5))
        except ModelInputError as error:
            return error_response(400, "VALIDATION_FAILED", str(error))
        except ModelAreaError as error:
            return error_response(422, "OUTSIDE_MODEL_AREA", str(error))
        return jsonify(result)

    @application.get("/scoring-method/iteration2")
    def get_iteration2_scoring_method():
        return jsonify({
            "ruleVersion": "radar-sampah-scoring-i2-v3",
            "categoryWeights": [{"category": category, "weight": CATEGORY_WEIGHTS[category]} for category in FRONTEND_CATEGORIES],
            "itemCountBands": [
                {"minimum": 1, "maximum": 5, "quantity": "Small", "weight": 1},
                {"minimum": 6, "maximum": 20, "quantity": "Medium", "weight": 2},
                {"minimum": 21, "maximum": 50, "quantity": "Large", "weight": 3},
                {"minimum": 51, "maximum": None, "quantity": "Very Large", "weight": 4},
            ],
            "windowDays": 90,
            "minReports": 3,
            "reportEligibility": "Counted reports in the latest 90 days with remaining litter after cleanup; fully cleared count-backed reports are excluded from the active count but retained in history",
            "remainingBandAggregation": "per-report-after-cleanup",
            "reportAggregation": "max-category-score",
            "beachAggregation": "median-of-active-reports",
            "modelClassMapping": [{"modelClass": model_class, "category": category} for model_class, category in ITERATION2_CATEGORIES.items()],
            "cleanupScore": "number-of-items-removed",
            "cleanupPoints": 0,
        })

    @application.post("/recognitions")
    @require_auth
    @rate_limited("recognition", 30)
    def recognise_report_photo():
        payload = request.get_json(silent=True)
        photo_key = str(payload.get("photoKey") or "").strip() if isinstance(payload, dict) else ""
        source = read_photo_source(engine, directory, photo_key, request.current_user.id) if photo_key else None
        if source is None:
            return error_response(404, "NOT_FOUND", "Photo not found.")
        raw = source.getvalue() if isinstance(source, BytesIO) else source.read_bytes()
        result = application.extensions["litter_recognizer"].recognise(raw)
        return jsonify(recognition_payload(result))

    @application.post("/recognitions/cleanup-photo")
    @require_auth
    @rate_limited("recognition", 30)
    def recognise_ephemeral_cleanup_photo():
        photo = request.files.get("photo")
        if photo is None or not photo.filename:
            return error_response(400, "PHOTO_REQUIRED", "A photo is required.")
        mime = (photo.mimetype or "").lower().split(";", 1)[0]
        if mime not in PHOTO_MIME_TYPES:
            return error_response(400, "PHOTO_UNSUPPORTED_TYPE", "Only JPEG, PNG, or HEIC photos are accepted.")
        raw = photo.read(PHOTO_MAX_BYTES + 1)
        if len(raw) > PHOTO_MAX_BYTES:
            return error_response(400, "PHOTO_TOO_LARGE", "Photo exceeds the 10 MB limit.")
        try:
            processed = process_photo(raw)
        except ValueError as error:
            return error_response(400, "VALIDATION_FAILED", str(error))
        result = application.extensions["litter_recognizer"].recognise(processed)
        # The after-cleanup photo is passed to inference from memory and is never persisted.
        return jsonify(recognition_payload(result))

    @application.get("/events")
    def list_events():
        ensure_scheduled_events()
        beach_id = request.args.get("beachId")
        if beach_id and not any(beach["id"] == beach_id for beach in beaches):
            return error_response(404, "NOT_FOUND", "Beach not found.")
        current = datetime.now(timezone.utc) - timedelta(days=30)
        query = select(events_table).where(events_table.c.starts_at >= current).order_by(events_table.c.starts_at)
        if beach_id:
            query = query.where(events_table.c.beach_id == beach_id)
        with engine.connect() as connection:
            rows = connection.execute(query).all()
        viewer = optional_current_user()
        return jsonify(event_dicts(rows, viewer.id if viewer else None))

    @application.get("/events/<event_id>")
    def get_event(event_id: str):
        ensure_scheduled_events()
        with engine.connect() as connection:
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
        if event is None:
            return error_response(404, "NOT_FOUND", "Event not found.")
        viewer = optional_current_user()
        return jsonify(event_dict(event, viewer.id if viewer else None))

    @application.get("/share-links")
    def issue_share_link():
        event_id = request.args.get("eventId")
        report_id = request.args.get("reportId")
        if not event_id and not report_id:
            return error_response(400, "VALIDATION_FAILED", "eventId or reportId is required.")
        with engine.connect() as connection:
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first() if event_id else None
            report = connection.execute(select(reports_table).where(reports_table.c.id == report_id)).first() if report_id else None
        if event_id and event is None:
            return error_response(404, "NOT_FOUND", "Event not found.")
        if report_id and (report is None or report.status != "Counted" or not report.item_counts):
            return error_response(404, "NOT_FOUND", "Shareable report not found.")
        viewer = optional_current_user()
        if report is not None and (viewer is None or viewer.id != report.reporter_id):
            return error_response(404, "NOT_FOUND", "Shareable report not found.")
        if event is not None and report is not None and event.beach_id != report.beach_id:
            return error_response(400, "VALIDATION_FAILED", "The report and event must refer to the same beach.")
        token = create_share_token(event_id, report_id, jwt_secret)
        return jsonify({"token": token, "path": "/share/" + quote(token, safe="")})

    @application.get("/share-links/<token>")
    def read_share_link(token: str):
        claims = decode_share_token(token, jwt_secret)
        if claims is None:
            return error_response(404, "NOT_FOUND", "Shared item not found.")
        event_id, report_id = claims["eventId"], claims["reportId"]
        with engine.connect() as connection:
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first() if event_id else None
            report = connection.execute(select(reports_table).where(reports_table.c.id == report_id)).first() if report_id else None
            actions = connection.execute(
                select(cleanup_actions_table).where(cleanup_actions_table.c.target_report_id == report_id)
            ).all() if report_id else []
        if event_id and event is None:
            return error_response(404, "NOT_FOUND", "Shared item not found.")
        if report_id and (report is None or report.status != "Counted" or not report.item_counts):
            return error_response(404, "NOT_FOUND", "Shared item not found.")
        if event is not None and report is not None and event.beach_id != report.beach_id:
            return error_response(404, "NOT_FOUND", "Shared item not found.")
        shared_report = None
        if report is not None:
            try:
                item_counts = json.loads(report.item_counts or "{}")
            except (TypeError, ValueError):
                item_counts = {}
            remaining = remaining_counts_for(report, actions)
            shared_report = {
                "id": report.id,
                "beachId": report.beach_id,
                "beachName": beach_names.get(report.beach_id, report.beach_id),
                "reportedAt": contract_timestamp(report.created_at),
                "status": report.status,
                "quantities": quantities_from_row(report),
                "itemCounts": item_counts,
                "remainingItemCounts": remaining,
                "remainingTotal": sum(remaining.values()),
                "photoAvailable": photo_available(engine, directory, report.photo_key, report.reporter_id),
            }
        return jsonify({
            "event": event_dict(event) if event is not None else None,
            "report": shared_report,
        })

    @application.get("/share-links/<token>/photo")
    def read_shared_report_photo(token: str):
        claims = decode_share_token(token, jwt_secret)
        report_id = claims.get("reportId") if claims else None
        if not report_id:
            return error_response(404, "NOT_FOUND", "Shared photo not found.")
        with engine.connect() as connection:
            report = connection.execute(select(reports_table).where(reports_table.c.id == report_id)).first()
        if report is None or report.status != "Counted" or not report.item_counts:
            return error_response(404, "NOT_FOUND", "Shared photo not found.")
        source = read_photo_source(engine, directory, report.photo_key, report.reporter_id)
        if source is None:
            return error_response(404, "NOT_FOUND", "Shared photo not found.")
        response = send_file(source, mimetype="image/jpeg", max_age=0, conditional=True)
        response.headers["Cache-Control"] = "private, no-store"
        return response

    @application.get("/events/<event_id>/cleanups")
    def list_event_cleanups(event_id: str):
        with engine.connect() as connection:
            event = connection.execute(select(events_table.c.id).where(events_table.c.id == event_id)).first()
            if event is None:
                return error_response(404, "NOT_FOUND", "Event not found.")
            actions = connection.execute(
                select(cleanup_actions_table)
                .where(cleanup_actions_table.c.event_id == event_id)
                .order_by(cleanup_actions_table.c.created_at)
            ).all()
        return jsonify([cleanup_action_dict(action) for action in actions])

    @application.post("/events")
    @require_moderator
    def create_moderator_event():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return error_response(400, "VALIDATION_FAILED", "An event object is required.")
        fields = set(payload)
        date_only = fields in ({"beachId", "date"}, {"beachId", "date", "meetingPoint"})
        explicit_times = fields in (
            {"beachId", "startsAt", "endsAt"},
            {"beachId", "startsAt", "endsAt", "meetingPoint"},
        )
        if not date_only and not explicit_times:
            return error_response(400, "VALIDATION_FAILED", "Send beachId and date, or beachId with startsAt and endsAt.")
        meeting_point = payload.get("meetingPoint")
        if meeting_point is not None:
            if not isinstance(meeting_point, str):
                return error_response(400, "VALIDATION_FAILED", "meetingPoint must be text.")
            meeting_point = meeting_point.strip()
            if not meeting_point:
                meeting_point = None
            elif len(meeting_point) > 160:
                return error_response(400, "VALIDATION_FAILED", "meetingPoint must be 160 characters or fewer.")
        beach_id = str(payload.get("beachId") or "").strip()
        if not any(beach["id"] == beach_id for beach in beaches):
            return error_response(404, "NOT_FOUND", "Beach not found.")
        event_date: str | None = None
        if date_only:
            raw_date = payload["date"]
            if not isinstance(raw_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date):
                return error_response(400, "VALIDATION_FAILED", "date must use YYYY-MM-DD format.")
            try:
                event_date = datetime.strptime(raw_date, "%Y-%m-%d").date().isoformat()
            except ValueError:
                return error_response(400, "VALIDATION_FAILED", "date must use YYYY-MM-DD format.")
            starts_at = datetime.fromisoformat(f"{event_date}T{EVENT_START_LOCAL_HOUR:02}:00:00+08:00")
            ends_at = datetime.fromisoformat(f"{event_date}T{EVENT_END_LOCAL_HOUR:02}:00:00+08:00")
        else:
            try:
                starts_at = datetime.fromisoformat(str(payload["startsAt"]))
                ends_at = datetime.fromisoformat(str(payload["endsAt"]))
            except (TypeError, ValueError):
                return error_response(400, "VALIDATION_FAILED", "startsAt and endsAt must be ISO 8601 timestamps with a timezone.")
            if starts_at.tzinfo is None or ends_at.tzinfo is None:
                return error_response(400, "VALIDATION_FAILED", "Event timestamps must include a timezone.")
        starts_at, ends_at = utc_datetime(starts_at), utc_datetime(ends_at)
        if ends_at <= starts_at or ends_at - starts_at > timedelta(hours=12):
            return error_response(400, "VALIDATION_FAILED", "An event must last between 0 and 12 hours.")
        now = datetime.now(timezone.utc)
        event_id = f"{beach_id}-{event_date}" if event_date else "ev_" + secrets.token_hex(10)
        with engine.begin() as connection:
            conflict = connection.execute(select(events_table).where(
                events_table.c.beach_id == beach_id,
                events_table.c.starts_at == starts_at,
            )).first()
            if conflict is not None:
                return (jsonify(event_dict(conflict, request.current_user.id)), 200)
            try:
                with connection.begin_nested():
                    connection.execute(insert(events_table).values(
                        id=event_id,
                        beach_id=beach_id,
                        starts_at=starts_at,
                        ends_at=ends_at,
                        status="Open" if ends_at > now else "Closed",
                        source="moderator",
                        meeting_point=meeting_point,
                        created_by=request.current_user.id,
                        created_at=now,
                        updated_at=now,
                    ))
            except IntegrityError:
                return error_response(409, "EVENT_SLOT_TAKEN", "An event is already scheduled for that beach and start time.")
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
        return jsonify(event_dict(event, request.current_user.id)), 201

    @application.post("/events/<event_id>/join")
    @require_auth
    def join_event(event_id: str):
        now = datetime.now(timezone.utc)
        with engine.begin() as connection:
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
            if event is None:
                return error_response(404, "NOT_FOUND", "Event not found.")
            if event.status != "Open" or utc_datetime(event.ends_at) <= now:
                return error_response(409, "EVENT_CLOSED", "This event is closed.")
            existing = connection.execute(select(event_members_table).where(
                event_members_table.c.event_id == event_id,
                event_members_table.c.participant_id == request.current_user.id,
            )).first()
            if existing is None:
                try:
                    with connection.begin_nested():
                        connection.execute(insert(event_members_table).values(
                            event_id=event_id,
                            participant_id=request.current_user.id,
                            joined_at=now,
                            checked_in_at=None,
                            location_passed=False,
                        ))
                except IntegrityError:
                    # A concurrent join already created this membership.
                    pass
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
        return jsonify(event_dict(event, request.current_user.id))

    @application.delete("/events/<event_id>/join")
    @require_auth
    def leave_event(event_id: str):
        with engine.begin() as connection:
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
            if event is None:
                return error_response(404, "NOT_FOUND", "Event not found.")
            connection.execute(
                event_members_table.delete().where(
                    event_members_table.c.event_id == event_id,
                    event_members_table.c.participant_id == request.current_user.id,
                )
            )
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
        return jsonify(event_dict(event, request.current_user.id))

    @application.post("/events/<event_id>/check-in")
    @require_auth
    def check_in_event(event_id: str):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or set(payload) != {"lat", "lng"}:
            return error_response(400, "VALIDATION_FAILED", "lat and lng are required for check-in.")
        if not is_json_number(payload["lat"]) or not is_json_number(payload["lng"]):
            return error_response(400, "VALIDATION_FAILED", "lat and lng must be numbers.")
        try:
            lat, lng = float(payload["lat"]), float(payload["lng"])
        except (TypeError, ValueError):
            return error_response(400, "VALIDATION_FAILED", "lat and lng must be numbers.")
        if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
            return error_response(400, "VALIDATION_FAILED", "lat or lng is outside its valid range.")
        with engine.connect() as connection:
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
            member = connection.execute(select(event_members_table).where(
                event_members_table.c.event_id == event_id,
                event_members_table.c.participant_id == request.current_user.id,
            )).first()
        if event is None:
            return error_response(404, "NOT_FOUND", "Event not found.")
        if member is None:
            return error_response(409, "JOIN_REQUIRED", "Join this event before checking in.")
        now = datetime.now(timezone.utc)
        if event.status != "Open" or not (utc_datetime(event.starts_at) <= now <= utc_datetime(event.ends_at)):
            return error_response(409, "EVENT_NOT_ACTIVE", "Check-in is available only while the event is active.")
        beach = next((item for item in beaches if item["id"] == event.beach_id), None)
        if beach is not None and (beach["lat"] is None or beach["lng"] is None):
            return error_response(409, "LOCATION_UNAVAILABLE", "This beach has no published coordinates for check-in.")
        if beach is None or distance_km(lat, lng, beach["lat"], beach["lng"]) > EVENT_CHECKIN_RADIUS_KM:
            return error_response(403, "LOCATION_OUT_OF_RANGE", "You must be within 25 km of the event beach to check in.")
        with engine.begin() as connection:
            connection.execute(event_members_table.update().where(
                event_members_table.c.event_id == event_id,
                event_members_table.c.participant_id == request.current_user.id,
            ).values(checked_in_at=now, location_passed=True))
            event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
        return jsonify(event_dict(event, request.current_user.id))

    @application.get("/cleanup-targets")
    def list_cleanup_targets():
        beach_id = request.args.get("beachId")
        report_id = request.args.get("reportId")
        if beach_id and not any(beach["id"] == beach_id for beach in beaches):
            return error_response(404, "NOT_FOUND", "Beach not found.")
        query = select(reports_table).where(
            reports_table.c.status == "Counted",
            reports_table.c.item_counts.is_not(None),
        ).order_by(reports_table.c.created_at.desc())
        if beach_id:
            query = query.where(reports_table.c.beach_id == beach_id)
        if report_id:
            query = query.where(reports_table.c.id == report_id)
        with engine.connect() as connection:
            reports = connection.execute(query).all()
            targets: list[dict[str, Any]] = []
            for report in reports:
                actions = connection.execute(select(cleanup_actions_table).where(
                    cleanup_actions_table.c.target_report_id == report.id
                )).all()
                target = cleanup_target_dict(report, actions)
                if target:
                    targets.append(target)
        return jsonify(targets)

    @application.post("/cleanup-actions")
    @require_auth
    @rate_limited("cleanup-create", 60)
    def create_cleanup_action():
        payload = request.get_json(silent=True)
        required = {"targetReportId", "handling"}
        allowed = required | {"removed", "removedCounts", "eventId", "note", "idempotencyKey"}
        if (
            not isinstance(payload, dict)
            or not required <= set(payload)
            or set(payload) - allowed
            or ("removed" in payload) == ("removedCounts" in payload)
        ):
            return error_response(400, "VALIDATION_FAILED", "targetReportId, removed and handling are required.")
        target_report_id = str(payload.get("targetReportId") or "").strip()
        handling = payload.get("handling")
        removed_counts = validate_item_counts(payload.get("removed", payload.get("removedCounts")))
        note = payload.get("note")
        event_id = payload.get("eventId")
        idempotency_key = str(
            payload.get("idempotencyKey")
            or request.headers.get("Idempotency-Key")
            or secrets.token_urlsafe(24)
        ).strip()
        if not target_report_id or not removed_counts:
            return error_response(400, "VALIDATION_FAILED", "removedCounts must contain positive whole-item counts.")
        if handling not in EVENT_HANDLING_VALUES:
            return error_response(400, "VALIDATION_FAILED", "handling is not a supported value.")
        if note is not None and (not isinstance(note, str) or len(note) > 500):
            return error_response(400, "VALIDATION_FAILED", "note must be 500 characters or fewer.")
        if event_id is not None and (not isinstance(event_id, str) or not event_id.strip() or len(event_id) > 100):
            return error_response(400, "VALIDATION_FAILED", "eventId must be a valid event identifier.")
        if len(idempotency_key) > 128:
            return error_response(400, "VALIDATION_FAILED", "idempotencyKey must be at most 128 characters.")
        fingerprint_value = {
            "targetReportId": target_report_id,
            "removedCounts": dict(sorted(removed_counts.items())),
            "handling": handling,
            "note": note,
            "eventId": event_id,
        }
        fingerprint = hashlib.sha256(json.dumps(fingerprint_value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with engine.begin() as connection:
            existing = connection.execute(select(cleanup_actions_table).where(
                cleanup_actions_table.c.participant_id == request.current_user.id,
                cleanup_actions_table.c.idempotency_key == idempotency_key,
            )).first()
            if existing is not None:
                if existing.request_fingerprint != fingerprint:
                    return error_response(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different cleanup.")
                return jsonify(cleanup_action_dict(existing)), 200
            target = connection.execute(
                select(reports_table).where(reports_table.c.id == target_report_id).with_for_update()
            ).first()
            if target is None or target.status != "Counted" or not target.item_counts:
                return error_response(404, "CLEANUP_TARGET_NOT_FOUND", "The cleanup target is no longer available.")
            if event_id is not None:
                event = connection.execute(select(events_table).where(events_table.c.id == event_id)).first()
                member = connection.execute(select(event_members_table).where(
                    event_members_table.c.event_id == event_id,
                    event_members_table.c.participant_id == request.current_user.id,
                )).first()
                now = datetime.now(timezone.utc)
                if event is None or event.beach_id != target.beach_id:
                    return error_response(400, "VALIDATION_FAILED", "eventId must refer to an event at the target beach.")
                if member is None or not member.location_passed:
                    return error_response(409, "EVENT_CHECKIN_REQUIRED", "Join and check in to the event before linking this cleanup.")
                if event.status != "Open" or not (utc_datetime(event.starts_at) <= now <= utc_datetime(event.ends_at)):
                    return error_response(409, "EVENT_NOT_ACTIVE", "An event-linked cleanup must be recorded during the event.")
            prior_actions = connection.execute(select(cleanup_actions_table).where(
                cleanup_actions_table.c.target_report_id == target_report_id
            )).all()
            remaining = remaining_counts_for(target, prior_actions)
            if not remaining:
                return error_response(409, "CLEANUP_TARGET_COMPLETE", "This cleanup target has already been fully cleared.")
            if any(category not in remaining or count > remaining[category] for category, count in removed_counts.items()):
                return error_response(409, "REMOVED_COUNT_EXCEEDS_REMAINING", "Removed counts cannot exceed the target's remaining item counts.")
            rows = []
            for category in FRONTEND_CATEGORIES:
                removed = removed_counts.get(category, 0)
                if removed <= 0:
                    continue
                before = remaining[category]
                rows.append({"category": category, "removed": removed, "before": before, "after": before - removed})
            now = datetime.now(timezone.utc)
            action_id = "c_" + secrets.token_hex(10)
            try:
                with connection.begin_nested():
                    connection.execute(insert(cleanup_actions_table).values(
                        id=action_id,
                        target_report_id=target_report_id,
                        participant_id=request.current_user.id,
                        event_id=event_id,
                        beach_id=target.beach_id,
                        removed_counts=json.dumps(removed_counts, separators=(",", ":")),
                        rows=json.dumps(rows, separators=(",", ":")),
                        total_removed=sum(removed_counts.values()),
                        handling=handling,
                        note=note,
                        idempotency_key=idempotency_key,
                        request_fingerprint=fingerprint,
                        created_at=now,
                    ))
                action = connection.execute(select(cleanup_actions_table).where(cleanup_actions_table.c.id == action_id)).first()
                response_status = 201
            except IntegrityError:
                action = connection.execute(select(cleanup_actions_table).where(
                    cleanup_actions_table.c.participant_id == request.current_user.id,
                    cleanup_actions_table.c.idempotency_key == idempotency_key,
                )).first()
                if action is None or action.request_fingerprint != fingerprint:
                    return error_response(409, "IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different cleanup.")
                response_status = 200
        return jsonify(cleanup_action_dict(action)), response_status

    @application.get("/cleanups/mine")
    @require_auth
    def list_my_cleanup_actions():
        with engine.connect() as connection:
            actions = connection.execute(select(cleanup_actions_table).where(
                cleanup_actions_table.c.participant_id == request.current_user.id
            ).order_by(cleanup_actions_table.c.created_at.desc())).all()
        return jsonify([cleanup_action_dict(action) for action in actions])

    @application.post("/geo/resolve-beach")
    @require_auth
    def resolve_beach():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or set(payload) != {"lat", "lng"}:
            return error_response(400, "VALIDATION_FAILED", "lat and lng are required.")
        if not is_json_number(payload["lat"]) or not is_json_number(payload["lng"]):
            return error_response(400, "VALIDATION_FAILED", "lat and lng must be numbers.")
        try:
            lat, lng = float(payload["lat"]), float(payload["lng"])
        except (TypeError, ValueError):
            return error_response(400, "VALIDATION_FAILED", "lat and lng must be numbers.")
        if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
            return error_response(400, "VALIDATION_FAILED", "lat or lng is outside its valid range.")
        nearest: dict[str, Any] | None = None
        nearest_distance = float("inf")
        for beach in beaches:
            if beach["lat"] is None or beach["lng"] is None:
                continue
            phi1, phi2 = math.radians(lat), math.radians(beach["lat"])
            dphi = math.radians(beach["lat"] - lat)
            dlambda = math.radians(beach["lng"] - lng)
            haversine = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
            distance = 6371 * 2 * math.asin(math.sqrt(haversine))
            if distance < nearest_distance:
                nearest, nearest_distance = beach, distance
        return jsonify(beach_summary(engine, nearest)) if nearest is not None and nearest_distance <= 25 else jsonify(None)

    @application.post("/uploads/photos")
    @require_auth
    @rate_limited("photo-upload", 60)
    def upload_photo():
        photo = request.files.get("photo")
        if photo is None or not photo.filename:
            return error_response(400, "PHOTO_REQUIRED", "A photo is required.")
        mime = (photo.mimetype or "").lower().split(";", 1)[0]
        if mime not in PHOTO_MIME_TYPES:
            return error_response(400, "PHOTO_UNSUPPORTED_TYPE", "Only JPEG, PNG, or HEIC photos are accepted.")
        raw = photo.read(PHOTO_MAX_BYTES + 1)
        if len(raw) > PHOTO_MAX_BYTES:
            return error_response(400, "PHOTO_TOO_LARGE", "Photo exceeds the 10 MB limit.")
        try:
            processed = process_photo(raw)
        except ValueError as error:
            return error_response(400, "VALIDATION_FAILED", str(error))
        sweep_orphan_photos(engine, directory)
        photo_key = secrets.token_hex(16) + ".jpg"
        created_at = datetime.now(timezone.utc)
        with engine.begin() as connection:
            connection.execute(
                insert(report_photos_table).values(
                    photo_key=photo_key,
                    owner_id=request.current_user.id,
                    mime="image/jpeg",
                    data=processed,
                    created_at=created_at,
                )
            )
        application.extensions["photo_cleanup_timers"].append(
            schedule_orphan_cleanup(engine, directory, photo_key, created_at)
        )
        preview_url = signed_photo_url(photo_key, request.current_user.id, jwt_secret, directory, engine)
        return jsonify({"photoKey": photo_key, "previewUrl": preview_url, "metadataStripped": True}), 201

    @application.get("/uploads/photos/<photo_key>/preview-url")
    @require_auth
    def renew_photo_preview_url(photo_key: str):
        preview_url = signed_photo_url(photo_key, request.current_user.id, jwt_secret, directory, engine)
        if not preview_url:
            return error_response(404, "NOT_FOUND", "Photo not found.")
        return jsonify({"previewUrl": preview_url})

    @application.get("/uploads/photos/<photo_key>")
    def view_signed_photo(photo_key: str):
        token = request.args.get("token", "")
        try:
            claims = jwt.decode(token, jwt_secret, algorithms=[AUTH_JWT_ALGORITHM])
        except jwt.PyJWTError:
            return error_response(401, "UNAUTHENTICATED", "This photo link is invalid or has expired.")
        if claims.get("purpose") != "photo-preview" or claims.get("photoKey") != photo_key:
            return error_response(401, "UNAUTHENTICATED", "This photo link is invalid or has expired.")
        source = read_photo_source(engine, directory, photo_key, claims.get("sub"))
        if source is None:
            return error_response(404, "NOT_FOUND", "Photo not found.")
        return send_file(source, mimetype="image/jpeg", max_age=0, conditional=True)

    @application.post("/reports")
    @require_auth
    @rate_limited("report-create", 30)
    def create_report():
        data, problem = validate_report_payload(request.get_json(silent=True), beaches, request.current_user.id, directory, True, engine)
        if problem:
            return error_response(*problem)
        assert data is not None
        now = datetime.now(timezone.utc)
        report_id = "r_" + secrets.token_hex(10)
        geo_secret = os.getenv("GEO_PRIVACY_HMAC_KEY", "").strip() or hmac.new(
            jwt_secret.encode("utf-8"), b"radar-sampah-geo-key-v1", hashlib.sha256
        ).hexdigest()
        target_proximity_ref = None
        if data["item_counts"] is not None and data["location_source"] == "gps":
            assert data["lat"] is not None and data["lng"] is not None
            with engine.begin() as connection:
                targets = connection.execute(
                    select(reports_table).where(
                        reports_table.c.status == "Counted",
                        reports_table.c.item_counts.is_not(None),
                        reports_table.c.proximity_ref.is_not(None),
                    )
                ).all()
                for target in targets:
                    actions = connection.execute(
                        select(cleanup_actions_table).where(cleanup_actions_table.c.target_report_id == target.id)
                    ).all()
                    if not remaining_counts_for(target, actions):
                        continue
                    candidate_refs = nearby_proximity_refs(data["lat"], data["lng"], target.id, geo_secret)
                    if target.proximity_ref in candidate_refs:
                        return error_response(409, "ACTIVE_CLEANUP_TARGET_NEARBY", "A cleanup target is already recorded within 10 metres.")
            target_proximity_ref = proximity_ref(data["lat"], data["lng"], report_id, geo_secret)
        if data["event_id"] is not None:
            with engine.connect() as connection:
                event = connection.execute(select(events_table).where(events_table.c.id == data["event_id"])).first()
            if event is None or event.beach_id != data["beach"]["id"]:
                return error_response(400, "VALIDATION_FAILED", "eventId must refer to an event on the selected beach.")
            if not (utc_datetime(event.starts_at) <= now <= utc_datetime(event.ends_at)):
                return error_response(400, "VALIDATION_FAILED", "The report timestamp must fall within the selected event.")
        with engine.begin() as connection:
            status = duplicate_status(connection, request.current_user.id, data["beach"]["id"], now)
            connection.execute(
                insert(reports_table).values(
                    id=report_id,
                    reporter_id=request.current_user.id,
                    beach_id=data["beach"]["id"],
                    beach_name=data["beach"]["name"],
                    quantities=json.dumps(data["quantities"], separators=(",", ":")),
                    category=data["category"],
                    quantity=data["quantity"],
                    photo_key=data["photo_key"],
                    photo_mime=data["photo_mime"] or "image/jpeg",
                    photo_stripped=bool(data["photo_stripped"]),
                    location_source=data["location_source"],
                    lat=None if data["item_counts"] is not None else data["lat"],
                    lng=None if data["item_counts"] is not None else data["lng"],
                    item_counts=json.dumps(data["item_counts"], separators=(",", ":")) if data["item_counts"] is not None else None,
                    proximity_ref=target_proximity_ref,
                    event_id=data["event_id"],
                    status=status,
                    created_at=now,
                    updated_at=now,
                    **quantity_values(data["quantities"]),
                )
            )
            row = connection.execute(select(reports_table).where(reports_table.c.id == report_id)).first()
        return jsonify(report_dict(row, request.current_user.id, jwt_secret, directory, beach_names, engine)), 201

    @application.get("/reports/mine")
    @require_auth
    def get_my_reports():
        status = request.args.get("status")
        if status is not None and status not in REPORT_STATUSES:
            return error_response(400, "VALIDATION_FAILED", "status is not valid.")
        query = (
            select(reports_table)
            .where(reports_table.c.reporter_id == request.current_user.id)
            .order_by(reports_table.c.created_at.desc())
        )
        if status:
            query = query.where(reports_table.c.status == status)
        with engine.connect() as connection:
            rows = connection.execute(query).all()
            report_ids = [row.id for row in rows]
            actions = connection.execute(
                select(cleanup_actions_table).where(cleanup_actions_table.c.target_report_id.in_(report_ids))
            ).all() if report_ids else []
            photo_keys = [row.photo_key for row in rows if row.photo_key]
            photo_rows = connection.execute(
                select(report_photos_table.c.photo_key, report_photos_table.c.owner_id, report_photos_table.c.mime)
                .where(report_photos_table.c.photo_key.in_(photo_keys))
            ).all() if photo_keys else []
        actions_by_report: defaultdict[str, list[Any]] = defaultdict(list)
        for action in actions:
            actions_by_report[action.target_report_id].append(action)
        photos = {photo.photo_key: {"ownerId": photo.owner_id, "mime": photo.mime, "metadataStripped": True} for photo in photo_rows}
        for row in rows:
            if row.photo_key not in photos and read_photo_metadata(directory, row.photo_key):
                photos[row.photo_key] = {"ownerId": row.reporter_id, "legacy": True}
        return jsonify([
            report_dict(row, request.current_user.id, jwt_secret, directory, beach_names, engine,
                        actions_by_report.get(row.id, []), photos.get(row.photo_key, False))
            for row in rows
        ])

    @application.get("/reports/mine/counts")
    @require_auth
    def get_my_report_counts():
        with engine.connect() as connection:
            statuses = connection.execute(
                select(reports_table.c.status).where(reports_table.c.reporter_id == request.current_user.id)
            ).scalars().all()
        return jsonify(
            {
                "counted": statuses.count("Counted"),
                "duplicate": statuses.count("Duplicate"),
                "incomplete": statuses.count("Incomplete"),
            }
        )

    @application.patch("/reports/<report_id>")
    @require_auth
    def update_report(report_id: str):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or not payload or set(payload) - REPORT_INPUT_FIELDS:
            return error_response(400, "VALIDATION_FAILED", "Send at least one supported report field.")
        with engine.connect() as connection:
            old = connection.execute(select(reports_table).where(reports_table.c.id == report_id)).first()
        if old is None:
            return error_response(404, "NOT_FOUND", "Report not found.")
        if old.reporter_id != request.current_user.id:
            return error_response(403, "NOT_OWNER", "You can only correct your own report.")
        with engine.connect() as connection:
            has_cleanup = connection.execute(
                select(cleanup_actions_table.c.id).where(cleanup_actions_table.c.target_report_id == report_id).limit(1)
            ).first()
        if has_cleanup:
            return error_response(409, "REPORT_IMMUTABLE", "A report with cleanup history cannot be edited.")
        if getattr(old, "item_counts", None):
            return error_response(409, "REPORT_IMMUTABLE", "Iteration 2 model-confirmed counts are immutable after submission.")

        if "locationSource" in payload or "coords" in payload:
            location_source = payload.get("locationSource", old.location_source)
            coords = payload.get("coords")
        else:
            location_source = old.location_source
            coords = None
        merged = {
            "beachId": payload.get("beachId", old.beach_id),
            "quantities": payload.get("quantities", quantities_from_row(old)),
            "photoKey": payload.get("photoKey", old.photo_key),
            "locationSource": location_source,
        }
        unchanged_gps = old.location_source == "gps" and "coords" not in payload and "locationSource" not in payload and merged["beachId"] == old.beach_id
        if old.location_source == "gps" and "coords" not in payload and merged["beachId"] != old.beach_id:
            merged["locationSource"] = location_source = "manual"
        if unchanged_gps:
            # The old raw coordinate is intentionally unavailable. Validate the
            # non-location fields as manual, then retain the privacy reference.
            merged["locationSource"] = "manual"
        if coords is not None:
            merged["coords"] = coords
        raw_gps_coords = None
        if location_source == "gps" and isinstance(coords, dict) and is_json_number(coords.get("lat")) and is_json_number(coords.get("lng")):
            raw_gps_coords = (float(coords["lat"]), float(coords["lng"]))
        require_uploaded_photo = "photoKey" in payload and payload["photoKey"] != old.photo_key
        data, problem = validate_report_payload(merged, beaches, request.current_user.id, directory, require_uploaded_photo, engine)
        if problem:
            return error_response(*problem)
        assert data is not None
        if all(band == "Small" for band in data["quantities"].values()):
            return error_response(422, "SMALL_ONLY_REPORT", "At least one non-Small quantity band is required.")
        if unchanged_gps:
            data["location_source"] = "gps"
            data["lat"] = data["lng"] = None
        created_at = utc_datetime(old.created_at)
        now = datetime.now(timezone.utc)
        geo_secret = os.getenv("GEO_PRIVACY_HMAC_KEY", "").strip() or hmac.new(
            jwt_secret.encode("utf-8"), b"radar-sampah-geo-key-v1", hashlib.sha256
        ).hexdigest()
        new_proximity_ref = old.proximity_ref if unchanged_gps else (
            proximity_ref(raw_gps_coords[0], raw_gps_coords[1], report_id, geo_secret)
            if data["location_source"] == "gps" and raw_gps_coords is not None else None
        )
        if data["location_source"] == "gps":
            data["lat"] = data["lng"] = None
        gps_decision = application.extensions.get("gps_proximity_decision")
        reviewed_status, refresh_target_id = gps_decision({**merged, "locationSource": "gps"}, report_id) if raw_gps_coords is not None and gps_decision else (None, None)
        with engine.begin() as connection:
            status = duplicate_status(
                connection,
                request.current_user.id,
                data["beach"]["id"],
                created_at,
                exclude_report_id=report_id,
            )
            if unchanged_gps and old.status == "Duplicate":
                # Without a new location measurement the earlier privacy-safe
                # duplicate decision cannot be recomputed from raw coordinates.
                status = old.status
                data["status_note"] = old.status_note
            elif reviewed_status is not None:
                status = reviewed_status
                if status == "Duplicate":
                    data["status_note"] = "Matching report within 10 metres: an active report already records the same current categories and quantity bands."
                if refresh_target_id:
                    connection.execute(reports_table.update().where(reports_table.c.id == refresh_target_id).values(
                        proximity_ref=proximity_ref(raw_gps_coords[0], raw_gps_coords[1], refresh_target_id, geo_secret)
                    ))
            connection.execute(
                reports_table.update()
                .where(reports_table.c.id == report_id)
                .values(
                    beach_id=data["beach"]["id"],
                    beach_name=data["beach"]["name"],
                    quantities=json.dumps(data["quantities"], separators=(",", ":")),
                    category=data["category"],
                    quantity=data["quantity"],
                    photo_key=data["photo_key"],
                    photo_mime=data["photo_mime"] or old.photo_mime,
                    photo_stripped=bool(data["photo_stripped"]) if data["photo_stripped"] is not None else old.photo_stripped,
                    location_source=data["location_source"],
                    lat=data["lat"],
                    lng=data["lng"],
                    proximity_ref=new_proximity_ref,
                    status_note=data.get("status_note"),
                    status=status,
                    updated_at=now,
                    **quantity_values(data["quantities"]),
                )
            )
            row = connection.execute(select(reports_table).where(reports_table.c.id == report_id)).first()
        if old.photo_key != data["photo_key"]:
            delete_photo_if_unreferenced(engine, directory, old.photo_key)
        return jsonify(report_dict(row, request.current_user.id, jwt_secret, directory, beach_names, engine))

    return application


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
