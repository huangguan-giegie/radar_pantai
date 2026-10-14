# Radar Sampah production deployment

Production source of truth is `main`:

`GitHub main -> GitHub Actions -> Google Cloud VM -> Cloudflare`

## Existing infrastructure

- VM: `radar-sampah`, project `project-5db6723a-ac19-4d7c-94a`, zone `us-west1-b`.
- Machine: `e2-micro`, approximately 1 GB RAM, with swap enabled.
- Cloudflare reaches the web origin over external IPv6.
- External IPv4 is retained for Neon/database outbound connectivity.
- Public IPv4 web ingress on ports 80/443 stays closed; IPv6 web ingress stays enabled.
- SSH administration uses IAP. Do not change `academy.huangguanedu.cn`.

The provisioning scripts are historical first-install tools, not instructions to
recreate the working production network. Their IPv6-only initial setup differs
from the current dual-stack outbound configuration. External IPv4 and traffic
can incur charges; monitor billing rather than assume a zero-cost deployment.

## Deploy from main

`.github/workflows/gcp-deploy.yml` uses the existing Workload Identity Federation
provider and deployment service account. It does not require a service-account
JSON key. Relevant application/deployment changes pushed to `main` deploy
automatically; documentation-only changes outside the deployment directory do
not. Manual dispatch is available on `main` only.

The workflow clones `main`, checks out the triggering commit, syncs source over
IAP, rebuilds the application container, waits for health, and prints the actual
deployed SHA and resource diagnostics. The current frontend uses `/api` on the
same origin, so Render is not part of the normal frontend/API traffic path.

The VM retains these files across source sync:

- `/opt/radar-sampah/deploy/gcp/.env`: production secrets; never commit or print it.
- `actual-project/ml-model/models/sea_taco_yolo11m_best.onnx`: frozen resident model.

ONNX is downloaded only if the resident file is missing or is an LFS pointer.
`actual-project/backend/species_distribution/models/` is always synced from
`main`; the build validates all 40 species models. The workflow checks that the
production env and resident model remain unchanged during deployment.

## Connectivity checks

`test-ipv6-dependencies.sh` retains its historical filename. It checks package
registry HTTPS using whichever address family works, and verifies database TCP
connectivity using IPv4 or IPv6. Compose parses the production dotenv file; the
script does not source secret values as shell code or print resolved settings.

Run it on the VM when required:

```bash
cd /opt/radar-sampah/deploy/gcp
sudo bash ./test-ipv6-dependencies.sh
```

`bootstrap.sh` runs it on initial installation. `update.sh` can enable it with
`RUN_IPV6_PREFLIGHT=1`. Web-origin IPv6 is a separate check from database egress:

```bash
curl -6 --fail http://[ORIGIN_IPV6]/api/health
```

## Runtime validation

`diagnostics.sh` prints container state, RAM, swap, CPU sampling, the health
response, selected non-secret performance settings, and two requests to each
public API. Deployment requires `database=connected`.

Performance settings in Compose:

```env
LITTER_PRELOAD=true
EVENT_SCHEDULER_TTL_SECONDS=60
INSIGHTS_CACHE_TTL_SECONDS=60
RADAR_PREWARM_PUBLIC_VIEWS=1
```

Low-memory staging settings (on the 1 GiB VM):

- Compose bounds idle SQLAlchemy connections at 2, plus at most 2 overflow connections.
  Other deployments retain SQLAlchemy's previous defaults.
- `MALLOC_ARENA_MAX=2`, `OPENBLAS_NUM_THREADS=1`, and `OMP_NUM_THREADS=1`
  bound native allocator/BLAS thread resources without removing either AI model.
- ONNX CPU arena and memory-pattern tuning is **off by default**. To trial it,
  add `RADAR_ONNX_LOW_MEMORY=1` to the private `deploy/gcp/.env`, restart only
  the app container, then measure idle and repeated inference RSS/PSS, latency,
  swap and memory PSI. Undo the flag and restart if latency or memory worsens.
- These settings are experiments, not evidence the VM has enough headroom for
  PostgreSQL: stress-test local PostgreSQL and both AI paths before any cutover.
- Keep the database in a persistent Docker volume, not under the rsynced
  deployment source; keep Neon as production until final fresh backup and
  reconciliation have succeeded. Never expose PostgreSQL port 5432 publicly.

Keep the single worker configured in `gunicorn.conf.py`; inspect measured memory
and swap activity before changing concurrency. Environment settings alone do
not prove recognition or cache effectiveness. Check model availability, database
connectivity, key public APIs, and repeated request timings after deployment.
This migration uses the existing verified business code, so deployment checks do
not create participants, reports, cleanup records, or uploads. Expand into full
business-flow testing only when a deployment smoke check identifies a problem.

## Administration

```bash
gcloud compute ssh radar-sampah \
  --project=project-5db6723a-ac19-4d7c-94a \
  --zone=us-west1-b --tunnel-through-iap
```

Production code belongs on `main`; do not maintain a long-lived deployment
branch. Retire `deploy/gcp-e2-micro` after the `main` deployment and acceptance
checks succeed. Preserve Neon and the working network during cleanup.
