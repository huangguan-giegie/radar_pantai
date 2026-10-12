"""Provision a moderator account and print its recovery token once.

Run with DATABASE_URL configured. Deliver the printed participant ID and
recovery token to the designated activity administrator using a private channel.
"""

from __future__ import annotations

import argparse
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import (  # noqa: E402
    create_recovery_token,
    create_engine_for_url,
    generate_participant_id,
    initialise_database,
    normalise_database_url,
    recovery_token_digest,
    users_table,
)
from sqlalchemy import insert, select  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Radar Pantai activity moderator.")
    parser.add_argument("--participant-id", help="Optional unused four-digit participant ID")
    args = parser.parse_args()

    engine = create_engine_for_url(normalise_database_url(None))
    initialise_database(engine)
    token = create_recovery_token()
    with engine.begin() as connection:
        participant_id = args.participant_id or generate_participant_id(connection)
        if len(participant_id) != 4 or not participant_id.isdigit():
            parser.error("--participant-id must be four digits")
        if connection.execute(select(users_table.c.id).where(users_table.c.participant_id == participant_id)).first():
            parser.error("The participant ID is already in use")
        connection.execute(insert(users_table).values(
            id="u_mod_" + secrets.token_hex(12),
            participant_id=participant_id,
            role="moderator",
            user_token=recovery_token_digest(token),
            created_at=datetime.now(timezone.utc),
        ))
    print(f"participantId: {participant_id}")
    print(f"recoveryToken: {token}")
    print("Store the recovery token securely; the database contains only its SHA-256 digest.")


if __name__ == "__main__":
    main()
