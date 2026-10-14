#!/usr/bin/env bash
set -euo pipefail

echo "== Dependency connectivity preflight =="

for url in   https://deb.debian.org/   https://registry-1.docker.io/v2/   https://pypi.org/simple/   https://registry.npmjs.org/react
do
  echo "Checking HTTPS: ${url}"
  curl -sSI --connect-timeout 8 --max-time 15 "${url}" >/dev/null
done

if [ ! -f .env ]; then
  echo ".env is missing; cannot test DATABASE_URL."
  exit 2
fi

python3 - <<'PY'
import json
import socket
import subprocess
from urllib.parse import urlparse

compose = ["sudo", "docker", "compose"]
if subprocess.run(compose + ["version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    compose = ["sudo", "docker-compose"]
# Let Compose parse dotenv quoting; never print the resolved environment.
config = json.loads(subprocess.check_output(compose + ["config", "--format", "json"])) if len(compose) == 3 else None
if config is None:
    # Compose v1 emits YAML, and its installed Python runtime provides PyYAML.
    import yaml
    config = yaml.safe_load(subprocess.check_output(compose + ["config"]))
raw = config["services"]["app"]["environment"].get("DATABASE_URL", "").strip()
if not raw:
    raise SystemExit("DATABASE_URL is missing.")
u = urlparse(raw)
host = u.hostname
port = u.port or 5432
if not host:
    raise SystemExit("DATABASE_URL has no hostname.")

# Docker Compose service names (e.g. postgres) resolve from the app container
# network, not from the VM host. Check the service readiness inside Compose.
if host in config.get("services", {}) and host != "app":
    service = config["services"][host]
    service_env = service.get("environment", {})
    database_user = service_env.get("POSTGRES_USER", "postgres")
    database_name = service_env.get("POSTGRES_DB", database_user)
    subprocess.run(
        compose + ["exec", "-T", host, "pg_isready", "-U", database_user, "-d", database_name],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print("Local Docker Compose database is ready.")
    raise SystemExit(0)

records = socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
if not records:
    raise SystemExit("Database hostname did not resolve.")

last_error = None
for family, socktype, proto, _, sockaddr in records:
    s = socket.socket(family, socktype, proto)
    s.settimeout(6)
    try:
        s.connect(sockaddr)
        print(f"Database TCP reachable over {'IPv6' if family == socket.AF_INET6 else 'IPv4'}.")
        break
    except OSError as exc:
        last_error = exc
    finally:
        s.close()
else:
    raise SystemExit(f"Database TCP connection failed: {last_error}")
PY

echo "Dependency preflight passed."
