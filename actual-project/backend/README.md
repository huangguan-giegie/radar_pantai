# Radar Pantai API

For the frontend v2 backend, local review and same-origin deployment, start with
[README_V2.md](README_V2.md). The notes below describe the earlier API contracts.

This Flask API keeps the frontend contract from commit `1a113fbb1f900192e4cf0ec0d1620abc7cba309f` in
[`../frontend/API.en.md`](../frontend/API.en.md) and adds Iteration 2 endpoints
specified in [`API_ITERATION2.md`](API_ITERATION2.md): local litter recognition,
remaining-count cleanup targets, append-only partial cleanup actions, community
events, moderator event creation and attendance checks. It does not collect
names, email addresses or phone numbers.

## Local setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

The development server listens on `http://localhost:5000` by default.

## Storage and database rollout

- `DATABASE_URL` selects PostgreSQL; absent means the local SQLite fallback.
  PostgreSQL tables use the database's default schema unless an already-created
  schema is selected with `DATABASE_SCHEMA`.
- Schema setup is idempotent. Startup creates the contract tables, safely
  renames a legacy `frontend_reports` table to `reports`, backfills compatible
  report fields and quantity columns, inserts missing fixed reference rows, and
  repairs missing Iteration 2 PostgreSQL constraints when necessary.
- Existing report rows are preserved. Startup does not run `seeds.sql`, so a
  production deploy cannot silently add synthetic reports.
- For an existing PostgreSQL database, apply
  `migrations/001_rename_frontend_reports_to_reports.sql` when the legacy table
  still exists, then apply `migrations/002_add_iteration2.sql` before deploying
  the Iteration 2 backend.
- Migration 002 adds actual item counts, privacy-preserving proximity
  references, event links, community events/members, cleanup actions, foreign
  keys, CHECK constraints and indexes. Legacy numeric quantity codes are
  converted to the current text bands (`Small` through `Very Large`).
- `schema.sql` is the clean-new-database PostgreSQL definition and is kept
  aligned with the runtime schema and migration 002.
- Legacy reports may contain coordinates rounded to three decimal places. New
  Iteration 2 count-backed reports do not persist raw coordinates; the active
  target proximity check stores a target-scoped HMAC of an approximately
  one-metre grid cell instead. No API response serialises report `lat` or `lng`.
- New report photos live in the private `report_photos` database table (`bytea`
  on PostgreSQL), using the existing `reports.photo_key` reference. Startup
  creates the table without changing existing reports. Preview, recognition,
  gallery and share routes read these bytes across service redeploys.
- `PHOTO_STORAGE_DIR` is a read fallback for legacy files only. Files already
  lost from an ephemeral disk cannot be recovered by this change. Keep database
  backups; move photo bytes to object storage if database size becomes a concern.
- Original report photos are retained for audit. Optional after-cleanup photos
  are passed to inference in memory and are not retained.

## Authentication

Anonymous signup returns a random 4-digit `participantId`, a session JWT and a
one-time `recoveryToken`. The database stores only the recovery-token digest.

`POST /auth/restore` requires **both** the participant ID and recovery token.
The participant ID alone is not a credential. Missing or incorrect recovery
tokens return `401 INVALID_RECOVERY_TOKEN`.

Use `scripts/provision_moderator.py` to create a controlled activity moderator.
Normal anonymous signup creates `volunteer` accounts only.

## Model integration

- Model weights are Git LFS-managed. The checkout must include the real
  `sea_taco_yolo11m_best.pt` file, and the backend deployment must install
  `requirements-ml.txt` to enable YOLO. If the weights or ML dependencies are
  unavailable, recognition falls back to manual counts instead of inventing a
  model result.
- Four packaged OBIS species-distribution models load once per process. Their
  scores are relative occurrence/suitability context, not calibrated
  probabilities or real-time OBIS results, and they do not affect litter
  severity or report status.

## Production settings

- `FRONTEND_ORIGINS`: deployed frontend URL.
- `DATABASE_URL`: PostgreSQL connection string.
- `DATABASE_SCHEMA`: optional non-default PostgreSQL schema.
- `AUTH_JWT_SECRET`: private signing secret for session/share tokens.
- `DEMO_PARTICIPANT_ID`: optional controlled demo participant ID. It does not
  bypass Recovery Token authentication.
- `PHOTO_STORAGE_DIR`: optional private directory for legacy photo reads.
- `GEO_PRIVACY_HMAC_KEY`: stable private key for proximity references.
- `LITTER_MODEL_PATH`, `LITTER_MODEL_VERSION`: optional recognition model
  overrides.
- `TEAMOROUTER_API_KEY`: backend-only key for custom species questions.
  The key's TeamoRouter routing configuration must have Gemini capacity.

Custom species questions use the shared published guide at
`../frontend/src/content/coastalContent.json`; deploy the repository with that
file present. The three prepared questions are answered locally in the frontend.
The guide identifies the selected species and supplies reference context; custom
answers may also use the model's general scientific knowledge. Relevant questions
are answered even when the guide lacks the answer, while possible general causes
are distinguished from established species-specific findings. Unrelated questions
receive only a statement that they have no relation to this species. All custom
answers use the question's language, including the unrelated-question statement.
Returned `sources` are species guide references, not citations for every AI claim.
Only the custom question calls TeamoRouter's native Gemini endpoint, using
`gemini-3.5-flash-lite` first and `gemini-3.8-flash` if the primary call fails.
Each model has a 20-second timeout and 1,500-token output budget. Authentication
errors and blocked questions do not trigger the fallback. The public endpoint allows two
concurrent calls and 60 attempts per rolling hour per worker. This deployment
uses one worker; additional workers would each have their own limit.

`POST /species/<id>/questions` accepts `{"question": "..."}` (1–500 characters)
and returns `{"answer": "...", "sources": [...]}`. It requires no account.
Invalid questions return 400, unknown species 404, busy/rate limits 429,
gateway failures 502, missing configuration 503 and timeouts 504.

## Active endpoints

- `GET /health`
- `POST /auth/anonymous`
- `POST /auth/restore`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /beaches`
- `GET /beaches/<id>`
- `GET /scoring-method`
- `GET /scoring-method/iteration2`
- `POST /api/species-distribution/predict`
- `POST /species/<id>/questions`
- `POST /geo/resolve-beach`
- `POST /uploads/photos`
- `POST /reports`
- `GET /reports/mine`
- `GET /reports/mine/counts`
- `PATCH /reports/<id>`
- `POST /recognitions`
- `POST /recognitions/cleanup-photo`
- `GET /cleanup-targets`
- `POST /cleanup-actions`
- `GET /cleanups/mine`
- `GET /events`, `GET /events/<id>`, `GET /events/<id>/cleanups`
- `POST /events` (moderator; event creation only)
- `POST /events/<id>/join`, `DELETE /events/<id>/join`
- `POST /events/<id>/check-in`
- `GET /share-links`, `GET /share-links/{token}`, `GET /share-links/{token}/photo`

Read `../frontend/API.en.md` for the base frontend contract and
`API_ITERATION2.md` for the reviewed Iteration 2 integration, scoring, privacy
and database rules.
