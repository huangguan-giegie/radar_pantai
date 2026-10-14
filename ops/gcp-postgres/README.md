# Radar Pantai: nightly PostgreSQL 18 backups

Production data lives in PostgreSQL 18 Docker container `radar-postgres18` on GCP
VM `radar-sampah` (zone us-west1-b). Do not restore the old Neon migration
snapshot over the live database.

## Schedule and transport

The GitHub Actions workflow `.github/workflows/gcp-postgres-backup.yml` runs
daily at 19:00 UTC = 03:00 Malaysia time (UTC+8), and supports manual dispatch.
It reuses the existing GitHub Actions Workload Identity Federation identity and
the already-provisioned IAP SSH authorization used for deployment.
No new GCP SDK, service-account keys, or recurring processes are added to the VM.

The runner streams a consistent PostgreSQL 18 pg_dump from the existing
container without allocating an SSH pseudo-terminal. In an ephemeral directory
it verifies the custom-format dump with PG18 pg_restore, then uploads both
a dump and SHA256 manifest to the private GCS backup bucket. It downloads
both back and verifies the SHA256 and byte-for-byte equality. DB contents
are not printed in logs or published as GitHub artifacts.

## One-time bucket setup (Cloud Shell)

Grant the existing GitHub deploy service account *bucket-scoped*
`roles/storage.objectCreator` and `roles/storage.objectViewer`. Do not give
the role storage.objectAdmin; deletion and bucket administration are unnecessary.

Bucket: `project-5db6723a-ac19-4d7c-94a-radar-pantai-neon-backup`.
Account: `github-actions-deploy@project-5db6723a-ac19-4d7c-94a.iam.gserviceaccount.com`.

Set a Cloud Storage lifecycle Delete rule for age 30 days, matching only
the prefix `daily/`, keeping all existing lifecycle rules intact. The
historical migration snapshot is at the root of the bucket, outside `daily/`.
GCS lifecycle deletion is asynchronous and soft deletion may keep objects
longer than 30 days, affecting billing.

After granting the two bucket IAM roles and applying lifecycle config, merge
the workflow into `main`, then manually trigger it from GitHub Actions and
confirm a successful run with dump and checksum under `gs://BUCKET/daily/`.

## Operational safeguards

- Never restore a nightly dump over production without a cutover plan.
- Restore test recent GCS dumps periodically on isolated PostgreSQL 18.
- Watch scheduled GitHub Actions for IAP or upload failures; alert behavior
  depends on repository notification settings.
- Preserve GCP Docker volume `gcp_radar_postgres18_data`, `/opt/radar-local-db`
  and `/opt/radar-sampah/deploy/gcp/.env`.
- GitHub-hosted actions schedules can sometimes be delayed; they are not a
  guaranteed minute-accurate scheduler.
