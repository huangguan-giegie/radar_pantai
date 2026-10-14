#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "Run using sudo bash and supply the verified Neon dump." >&2
  exit 2
fi

ARCHIVE="${1:-}"
EXPECTED_SHA='17c5d4bc9d6deb078edba8df2e5b54141b3dc8617e1db2bc6c3f178ee5f1ace4'
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ] ||
   [ "$(sha256sum "$ARCHIVE" | awk '{print $1}')" != "$EXPECTED_SHA" ]; then
  echo "Backup absent or SHA256 mismatch; nothing changed." >&2
  exit 1
fi

DEPLOY='/opt/radar-sampah/deploy/gcp'
PRIVATE='/opt/radar-local-db'
SECRETS="$PRIVATE/secrets"
BACKUPS="$PRIVATE/backups"
PG_CONTAINER='radar-postgres18'

test -f "$DEPLOY/docker-compose.yml"
test -f "$DEPLOY/.env"
cd "$DEPLOY"
# This existing GCP VM uses the older standalone docker-compose executable.
# The Docker CLI may be present without the v2 "docker compose" plugin.
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1 &&
     docker-compose version >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "No supported Docker Compose installation found." >&2
  exit 2
fi
echo "Compose command: ${COMPOSE[*]}"
install -d -m 0700 "$PRIVATE" "$SECRETS" "$BACKUPS"

if [ ! -e "$SECRETS/pg_password" ]; then
  openssl rand -hex 24 > "$SECRETS/pg_password"
fi
chmod 600 "$SECRETS/pg_password"
install -m 0600 "$ARCHIVE" "$BACKUPS/radar-pantai-20261013T151321Z.dump"

cat > "$PRIVATE/postgres.compose.yml" <<'YAML'
services:
  postgres:
    image: postgres:18-alpine
    container_name: radar-postgres18
    restart: unless-stopped
    mem_limit: 192m
    memswap_limit: 320m
    shm_size: 32m
    pids_limit: 100
    environment:
      POSTGRES_DB: neondb
      POSTGRES_USER: radar
      POSTGRES_PASSWORD_FILE: /run/secrets/radar_pg_password
      PGDATA: /var/lib/postgresql/18/docker
    secrets:
      - radar_pg_password
    volumes:
      - radar_postgres18_data:/var/lib/postgresql
    command:
      - postgres
      - -c
      - shared_buffers=16MB
      - -c
      - max_connections=10
      - -c
      - work_mem=2MB
      - -c
      - maintenance_work_mem=16MB
      - -c
      - effective_cache_size=128MB
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U radar -d neondb"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 60s
secrets:
  radar_pg_password:
    file: /opt/radar-local-db/secrets/pg_password
volumes:
  radar_postgres18_data:
YAML
chmod 600 "$PRIVATE/postgres.compose.yml"

echo '=== Starting low-memory PostgreSQL in existing Compose network ==='
"${COMPOSE[@]}" -f "$DEPLOY/docker-compose.yml" -f "$PRIVATE/postgres.compose.yml" up -d postgres

ready=0
for i in $(seq 1 36); do
  if docker exec "$PG_CONTAINER" pg_isready -U radar -d neondb >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  docker logs --tail 60 "$PG_CONTAINER" >&2
  echo 'PostgreSQL did not start; production env unchanged.' >&2
  exit 1
fi

if [ "$(docker exec "$PG_CONTAINER" psql -U radar -d neondb -At -c "SELECT to_regclass('app.reports') IS NOT NULL;")" != 't' ]; then
  echo '=== Restoring complete Neon snapshot ==='
  docker cp "$BACKUPS/radar-pantai-20261013T151321Z.dump" "$PG_CONTAINER:/tmp/radar-pantai.dump"
  docker exec "$PG_CONTAINER" pg_restore -U radar -d neondb --no-owner --no-acl --exit-on-error /tmp/radar-pantai.dump
  docker exec "$PG_CONTAINER" rm -f /tmp/radar-pantai.dump
else
  echo 'Existing database data found: skipping restore to avoid overwrite.'
fi

echo '=== Verifying restored data ==='
COUNTS="$(docker exec "$PG_CONTAINER" psql -U radar -d neondb -At -c "SELECT (SELECT COUNT(*) FROM app.beaches) || ',' || (SELECT COUNT(*) FROM app.reports) || ',' || (SELECT COUNT(*) FROM app.users) || ',' || (SELECT COUNT(*) FROM app.report_photos) || ',' || (SELECT COUNT(*) FROM app.cleanup_actions) || ',' || (SELECT COUNT(*) FROM app.community_events) || ',' || (SELECT COALESCE(SUM(octet_length(data)),0) FROM app.report_photos);")"
echo "beaches,reports,users,photos,cleanups,events,photo_bytes: $COUNTS"
if [ "$COUNTS" != '179,148,148,79,100,41,25248043' ]; then
  echo 'Count mismatch; NOT switching app.' >&2
  exit 1
fi

# Keep existing AUTH_JWT_SECRET and GEO_PRIVACY_HMAC_KEY unchanged.
# Save original .env privately, update only database routing and Compose file.
ENV_PATH="$DEPLOY/.env"
ENV_BACKUP="$PRIVATE/production.env.before-local-postgres"
if [ ! -f "$ENV_BACKUP" ]; then
  cp -p "$ENV_PATH" "$ENV_BACKUP"
  chmod 600 "$ENV_BACKUP"
fi

RADAR_ENV_PATH="$ENV_PATH" RADAR_PASSWORD_FILE="$SECRETS/pg_password" python3 - <<'PY'
import os
import pathlib
import tempfile
from urllib.parse import quote

path = pathlib.Path(os.environ['RADAR_ENV_PATH'])
password = pathlib.Path(os.environ['RADAR_PASSWORD_FILE']).read_text().strip()
if not password:
    raise SystemExit('Empty Postgres password')
url = f'postgresql+psycopg://radar:{quote(password, safe="")}@postgres:5432/neondb'
updates = {
    'DATABASE_URL': url,
    'DATABASE_SCHEMA': 'app',
    'COMPOSE_FILE': 'docker-compose.yml:/opt/radar-local-db/postgres.compose.yml',
}
lines = path.read_text().splitlines(keepends=True)
found = set()
for i, line in enumerate(lines):
    if not line or line.lstrip().startswith('#') or '=' not in line:
        continue
    key = line.split('=', 1)[0].strip()
    if key in updates:
        lines[i] = key + '=' + updates[key] + '\n'
        found.add(key)
for key in updates:
    if key not in found:
        if lines and not lines[-1].endswith('\n'):
            lines[-1] += '\n'
        lines.append(key + '=' + updates[key] + '\n')
st = path.stat()
fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix='.env-localdb-')
try:
    with os.fdopen(fd, 'w') as file:
        file.writelines(lines)
        file.flush()
        os.fsync(file.fileno())
    os.chown(tmp, st.st_uid, st.st_gid)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
except Exception:
    pathlib.Path(tmp).unlink(missing_ok=True)
    raise
PY

echo '=== Switching app to local PostgreSQL (Neon remains untouched) ==='
"${COMPOSE[@]}" up -d --no-deps --force-recreate app

status='starting'
for i in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' gcp_app_1)"
  if [ "$status" = 'healthy' ]; then break; fi
  printf 'Check %s: %s\n' "$i" "$status"
  sleep 10
done

echo "App health: $status"
echo '=== Memory and container state ==='
free -m
docker stats --no-stream
cat /proc/pressure/memory

echo '=== Local DB row count ==='
docker exec "$PG_CONTAINER" psql -U radar -d neondb -At -c 'SELECT COUNT(*) FROM app.reports;'

if [ "$status" != 'healthy' ]; then
  echo 'Local DB restored and configured, but app is not yet healthy. Collect app logs; do not discard DB.' >&2
  exit 1
fi

echo '=== CUTOVER COMPLETE: app healthy with local PostgreSQL ==='
echo 'Original environment saved privately under /opt/radar-local-db/'
