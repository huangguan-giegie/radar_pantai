#!/usr/bin/env python3
"""Nightly, non-disruptive PostgreSQL custom-format dump to private GCS.

No google-cloud SDK or static service-account keys: use the VM's metadata token.
The VM identity requires storage.objects.create on the private backup bucket
and an OAuth scope permitting Cloud Storage writes.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import quote
from urllib.request import Request, urlopen

BUCKET = "project-5db6723a-ac19-4d7c-94a-radar-pantai-neon-backup"
ROOT = Path("/opt/radar-local-db/backup-work")
CONTAINER = "radar-postgres18"
API_HOST = "storage.googleapis.com"
METADATA_URL = (
    "http://metadata.google.internal/computeMetadata/v1/"
    "instance/service-accounts/default/token"
)


def access_token() -> str:
    req = Request(METADATA_URL, headers={"Metadata-Flavor": "Google"})
    with urlopen(req, timeout=12) as response:
        token = json.load(response).get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("GCE metadata service returned no access token")
    return token


def local_hashes(path: Path) -> tuple[str, str, int]:
    sha = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
            md5.update(chunk)
            size += len(chunk)
    return sha.hexdigest(), base64.b64encode(md5.digest()).decode("ascii"), size


def upload(path: Path, name: str, content_type: str) -> None:
    """Stream file directly from disk; do not load the dump into VM RAM."""
    _, expected_md5, size = local_hashes(path)
    resource = (
        "/upload/storage/v1/b/" + quote(BUCKET, safe="")
        + "/o?uploadType=media&name=" + quote(name, safe="")
        + "&ifGenerationMatch=0"
    )
    conn = http.client.HTTPSConnection(API_HOST, timeout=120)
    try:
        conn.putrequest("POST", resource)
        conn.putheader("Authorization", "Bearer " + access_token())
        conn.putheader("Content-Type", content_type)
        conn.putheader("Content-Length", str(size))
        conn.putheader("Content-MD5", expected_md5)
        conn.endheaders()
        with path.open("rb") as stream:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                conn.send(chunk)
        response = conn.getresponse()
        body = response.read(8192)
        if response.status not in (200, 201):
            # Avoid logging a token or arbitrary user data in HTTP error bodies.
            raise RuntimeError(f"GCS upload failed: HTTP {response.status} for {name}")
        obj = json.loads(body)
        if int(obj.get("size", -1)) != size:
            raise RuntimeError(f"GCS byte-size verification failed for {name}")
        if obj.get("md5Hash") != expected_md5:
            raise RuntimeError(f"GCS MD5 verification failed for {name}")
        if obj.get("name") != name:
            raise RuntimeError(f"GCS object-name verification failed for {name}")
    finally:
        conn.close()


def pg_dump(path: Path) -> None:
    cmd = [
        "docker", "exec", CONTAINER,
        "pg_dump", "-U", "radar", "-d", "neondb",
        "--format=custom", "--compress=3", "--blobs",
    ]
    with path.open("wb") as target:
        proc = subprocess.run(cmd, stdout=target, stderr=subprocess.PIPE, check=False)
    if proc.returncode:
        raise RuntimeError(f"pg_dump failed (exit {proc.returncode}): "
                           + proc.stderr.decode("utf-8", "replace")[-500:])
    if path.stat().st_size < 1024:
        raise RuntimeError("pg_dump output is unexpectedly small")
    with path.open("rb") as source:
        checked = subprocess.run(
            ["docker", "exec", "-i", CONTAINER, "pg_restore", "--list"],
            stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            check=False,
        )
    if checked.returncode:
        raise RuntimeError(f"pg_restore archive check failed (exit {checked.returncode}): "
                           + checked.stderr.decode("utf-8", "replace")[-500:])


def main() -> None:
    if os.geteuid() != 0:
        raise RuntimeError("Run via the root-owned systemd service")
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    ROOT.chmod(0o700)
    lock_path = ROOT / "backup.lock"
    with lock_path.open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        probe = subprocess.run(
            ["docker", "exec", CONTAINER, "pg_isready", "-U", "radar", "-d", "neondb"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
        )
        if probe.returncode:
            raise RuntimeError("Local PostgreSQL is not ready; aborting backup")

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        name = f"radar-pantai-{timestamp}.dump"
        with tempfile.TemporaryDirectory(prefix="nightly-", dir=ROOT) as tmp:
            archive = Path(tmp) / name
            checksum_file = Path(tmp) / (name + ".sha256")
            print("Exporting PostgreSQL snapshot...", flush=True)
            pg_dump(archive)
            digest, _, size = local_hashes(archive)
            checksum_file.write_text(f"{digest}  {name}\n", encoding="ascii")
            print(f"Archive verified: {size} bytes", flush=True)
            upload(archive, f"daily/{name}", "application/octet-stream")
            upload(checksum_file, f"daily/{name}.sha256", "text/plain")
            print(f"BACKUP SUCCESS: gs://{BUCKET}/daily/{name}", flush=True)
            print(f"SHA256: {digest}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"BACKUP FAILED: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
