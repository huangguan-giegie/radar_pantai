# Radar Pantai — Backend API Specification v1 (Iteration 1)

> **Historical Iteration 1 specification.** The current source of truth is
> [`API_ITERATION2.md`](../backend/API_ITERATION2.md) and [`openapi.yaml`](./openapi.yaml).
> Older same-day duplicate rules, three-decimal GPS storage, exact-count reporting,
> composition, and event-generation requirements below are superseded by Iteration 2.

> **This is the English version.** The same contract exists three times and they must stay in
> step — change one, change all three:
>
> | File | Language | For |
> | --- | --- | --- |
> | [`API.en.md`](./API.en.md) ← you are here | English | LiHanXia (backend), Keith (database) |
> | [`API.md`](./API.md) | 中文 | Qian Jiang (frontend) |
> | [`openapi.yaml`](./openapi.yaml) | English | tooling — Swagger UI, server stubs |

> **This is a contract, not a discussion draft.** The frontend supports both the real API and a
> mock fallback. The deployed compatibility API is `team04-marine-observation-api.onrender.com`;
> the newer `radar-sampah-api.onrender.com` hostname is not enabled.
> If something here is impractical, say so before changing it — the frontend then adjusts
> in one file, `src/api.ts`.
>
> Chinese version: [`API.md`](./API.md) · Machine-readable: [`openapi.yaml`](./openapi.yaml)
> · Data governance: [the DMP](../docs/DATA_MANAGEMENT_PLAN.md) ([.docx](../docs/RadarSampah_Data_Management_Plan_Iteration1_MVP.docx))

---

## 0. Conventions

> ✅ **`actual-project/backend/app.py` implements this contract.** The earlier `/api/*`
> recognition, heatmap and cleanup-mission routes are no longer active Iteration 1 endpoints.
> Contract coverage is kept in `backend/tests/test_api.py`.
>
> **Runtime modes:** leave `VITE_API_BASE_URL` empty for the local mock mode (the app uses the
> seed data in `src/mockData.ts` and stores mock records in local storage). The deployed
> frontend selects the real API at `https://team04-marine-observation-api.onrender.com` and sends
> the bearer token on authenticated requests.

| Item | Convention |
| --- | --- |
| Transport | HTTPS, JSON (except photo upload, which is `multipart/form-data`) |
| Encoding | UTF-8 |
| Time | ISO 8601 with offset, e.g. `2026-08-28T09:41:00+08:00`. **"Same day" is always evaluated in `Asia/Kuala_Lumpur`** |
| Auth | `Authorization: Bearer <token>`, stored by the frontend in localStorage |
| Paging | Not in Iteration 1. Four beaches and one person's own reports — return the full set |

### Error shape

Every non-2xx returns:

```json
{ "code": "PHOTO_TOO_LARGE", "message": "Photo exceeds the 10 MB limit." }
```

`message` is a **finished English sentence shown directly to the user** — the frontend does not
rewrite or template it.

| HTTP | code | When |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | A required field is missing or a value is outside its enum |
| 400 | `PHOTO_REQUIRED` | A report was submitted without `photoKey` |
| 400 | `PHOTO_TOO_LARGE` | Photo over 10 MB |
| 400 | `PHOTO_UNSUPPORTED_TYPE` | Not JPEG, PNG or HEIC |
| 401 | `UNAUTHENTICATED` | Token missing, expired or invalid |
| 403 | `NOT_OWNER` | Editing or deleting someone else's report |
| 404 | `NOT_FOUND` | Unknown beach or report |
| 404 | `UNKNOWN_PARTICIPANT` | The participant number does not exist |
| 413 | `PAYLOAD_TOO_LARGE` | Upload rejected at the server layer |
| 429 | `RATE_LIMITED` | See §8 |
| 500 | `INTERNAL_ERROR` | Fallback |

> ⚠️ **A duplicate report is not an error.** Return `201` with `status: "Duplicate"`. The
> frontend shows it as saved-but-not-counted. See §6.

---

## 1. Auth — anonymous participant numbers

**Team decision: the app collects no personal data.** No name, email or phone number.
A person receives a 4-digit ID plus a system-generated recovery token. The token works like a password.

| Method | Path | Auth | |
| --- | --- | --- | --- |
| POST | `/auth/anonymous` | no | Issue a new number |
| POST | `/auth/restore` | no | Continue with an existing number |
| POST | `/auth/logout` | yes | 204 |
| GET | `/auth/me` | yes | |

**POST `/auth/anonymous`** (no body)

```json
// 201
{
  "token": "eyJhbGciOi...",
  "recoveryToken": "RS-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
  "user": { "id": "u_01H...", "participantId": "1637", "role": "volunteer" }
}
```

**POST `/auth/restore`** — body `{ "participantId": "1637", "token": "RS-..." }`. The recovery token is required and verified before a new session JWT is returned.

**GET `/auth/me`** — returns `user`; 401 if the token is invalid.

The frontend clears the stored token only for this explicit 401 response. A timeout, network
failure or 5xx response keeps the anonymous session snapshot and shows a retry notice instead of
turning the participant into Guest.

- `participantId` — 4 digits, **randomly assigned, never sequential**. A sequence would leak how
  many participants exist and who joined first.
- `role` — `"volunteer" | "moderator"`. Iteration 1 only ever issues `volunteer`;
  `moderator` is reserved for the later review flow. Create the value, leave it unused.
- Token — JWT, 30-day expiry, no refresh flow.

> **One thing to be aware of (does not block this iteration).** The number *is* the credential,
> so anyone who types `1637` sees participant 1637's records. That is acceptable for an MVP
> running on synthetic data. Before this holds real public submissions it needs a secret
> alongside the number.

---

## 2. Beaches

| Method | Path | Auth | |
| --- | --- | --- | --- |
| GET | `/beaches` | no | List, for the map and home screen |
| GET | `/beaches/:id` | no | Detail |

**No auth required** — "Browsing needs nothing at all" is a promise made on the welcome screen.

### GET `/beaches` → `BeachSummary[]`

```json
[{
  "id": "morib",
  "name": "Pantai Morib",
  "area": "Banting, Selangor",
  "lat": 2.746,
  "lng": 101.440,

  "severity": "High",
  "band": 3,
  "insufficientData": false,
  "validReports": 8,
  "attentionScore": 2.55,
  "eligibleReportCount": 8,
  "lastReportedAt": "2026-08-19T16:00:00+08:00",
  "freshnessKind": "ok",

  "habitat": "Intertidal mudflat & sandy shore",
  "habitatTag": "MUDFLAT",
  "sensitivity": "Migratory feeding ground",
  "primarySpeciesGlyph": "turtle",
  "speciesNames": ["Green Sea Turtle", "Mangrove Fringe", "Coastal Birds"],

  "coverImageUrl": "https://cdn.example.com/beaches/morib.jpg",
  "scene": "linear-gradient(178deg,#8FD0E8 0%,#4E9EC9 36%,#2E6EA8 58%,#173E77 100%)"
}]
```

| Field | Type | Notes |
| --- | --- | --- |
| `severity` | `"Low"｜"Moderate"｜"High"｜"Severe"｜null` | **Must be `null` when fewer than 3 active reports qualify.** Never fall back to `"Low"` |
| `band` | `1｜2｜3｜4｜null` | Paired with `severity`; null together. Drives the four-bar marker |
| `insufficientData` | boolean | True exactly when `severity === null` |
| `validReports` | int | Number of active `Counted` reports in the 90-day window that still have litter after cleanup. Fully cleared reports remain historical but are excluded |
| `attentionScore` | number｜null | Median of active Report Scores, rounded to two decimals; null when fewer than 3 active reports qualify |
| `eligibleReportCount` | int | Same active report count used by the median and minimum-evidence rule |
| `lastReportedAt` | string｜null | Newest historical **Counted** report; retained for history and no longer used to drive current freshness |
| `newestCountedReportAt` | string｜null | Newest active **Counted** report inside the latest 90-day window after cleanup state is applied; resolved and expired reports are excluded |
| `latestContributingReportAt` | string｜null | Backward-compatible alias of `newestCountedReportAt` |
| `freshnessKind` | `"ok"｜"aging"｜"stale"` | Derived from `newestCountedReportAt`: under 30 days / 30–90 / no active Counted report in the current 90-day window |
| `primarySpeciesGlyph` | `"turtle"｜"bird"｜"mangrove"｜"grass"｜"crab"｜"fish"` | Icon for the biodiversity map marker |
| `speciesNames` | string[] | The names of this beach's biodiversity cards, in `sort_order`. The map's biodiversity layer renders them directly — without it that layer carries habitat only and names no species at all. Names only; the full cards stay in `BeachDetail.species` |
| `coverImageUrl` | string｜null | Real photo. **Send `null` when there is none** — the frontend falls back to `scene`, so a new beach never renders a blank header |
| `scene` | string | A valid CSS `background` value used as the no-photo placeholder. Present in the seed data — store and return it verbatim |

### GET `/beaches/:id` → `BeachDetail`

`BeachSummary` plus three fields:

```json
{
  "composition": [
    { "category": "Plastic", "quantity": "Large" },
    { "category": "Fishing gear", "quantity": "Medium" }
  ],
  "compositionSource": { "reportId": "r_01H...", "createdAt": "2026-08-19T16:00:00+08:00" },
  "species": [ /* see §2c */ ],
  "ecologicalNote": "Plastic and abandoned fishing gear may affect turtles and shorebirds that feed in this coastal environment."
}
```

- `composition` — the non-null category columns of the beach's newest `Counted` report, ordered by
  category weight. It is **not** an aggregate and does not depend on `insufficientData`; see §2b.
  **`null`, not `[]`, when the beach has no `Counted` report at all.**
- `compositionSource` — which report the composition came from. Required whenever `composition`
  is non-null; the screen prints its date.
- `species` — static reference content, 0–5 entries. See §2c for provenance.
- `ecologicalNote` — one sentence, static.

> **Why severity, band, validReports and composition are all computed server-side.** The product's
> central claim to the user is that one identical rule runs on every beach — the scoring-method
> screen is entirely about this. That rule must have exactly one implementation, on the server,
> auditable. A second implementation in the client would be a second rule.

---

## 2b. Species occurrence score (offline contextual baseline)

> ⚠️ **This is not a probability of occurrence.** The Iteration 1 baseline uses a packaged OBIS
> snapshot, generated background points and coordinates. It returns a **relative occurrence
> score** that has not been calibrated. It is not a real-time OBIS query, must not be shown with a
> percent sign, and never contributes to litter severity. The static biodiversity cards remain
> contextual reference content; only an exact scientific-name match may show a model score.

The model currently covers four species: **green sea turtle, clown anemonefish, Irrawaddy dolphin
and sicklefin Moorish idol**. A card outside those four — a group name like "Coastal Birds" —
**has no score**, and will not get one this iteration.

```json
{
  "name": "Green Sea Turtle",
  "kind": "species",
  "scientificName": "Chelonia mydas",
  "glyph": "turtle",
  "text": "Occasional visitor along the Strait of Malacca…",
  "source": { "dataset": "OBIS", "citation": "…", "url": "…", "accessedAt": "2026-08-20" },
  "likelihood": {
    "state": "ready",
    "score": 38,
    "basis": "Coordinate model over OBIS occurrence records and background samples."
  }
}
```

### `state` has three values and the screen says three different things

| state | Meaning | On screen |
| --- | --- | --- |
| `ready` | connected, `score` is set | the score plus `RELATIVE OCCURRENCE SCORE · NOT A PROBABILITY` |
| `pending` | the static card has no sourced occurrence result | `SOURCE PENDING · NOT YET FROM FISHBASE / OBIS` |
| `unavailable` | the species is not one of the four | `OCCURRENCE MODEL · NO DATA FOR THIS CARD` |

**`pending` and `unavailable` must stay apart**: one means not built yet, the other means it
cannot be built. Collapsed into one sentence, a reader waits for something that is never coming.

- `score` — a 0–100 integer, **a relative score and not a probability**. Sent only when
  `state = 'ready'`.
- `basis` — one sentence saying where the number comes from, **displayed verbatim**. Never empty.
- Omit `likelihood` entirely and the card renders as pure reference content.

### Three hard constraints (already implemented on the frontend)

1. **Never merge it into the litter severity score.** They answer different questions; combined,
   a reader will misread both.
2. **It must look different.** The frontend deliberately avoids the four severity colours and uses
   an amber dashed block.
3. **The copy must not call it a probability.** The beach page now reads: "…reports a relative
   occurrence score, built from OBIS records and background samples at coordinate level. It is not
   a calibrated probability of presence…" On the method page, "No model, no judgement call" is
   scoped to the **litter severity** band only.

> These are not fastidiousness. The product's promise is that its data is trustworthy and its rules
> are visible. A relative score presented as a probability spends the credibility Epic 4 was built
> to earn.

The live model route is separate from the static card `likelihood` field. The UI labels its output
as modelled context and includes the model version; it does not invent a confidence interval.

### `POST /api/species-distribution/predict`

This endpoint loads four trained models once at API startup and accepts a public beach broad-area
coordinate. It does not query OBIS at request time and does not persist the coordinate or result.

```json
{ "latitude": 2.746, "longitude": 101.44 }
```

The response contains `insideMalaysianEez`, `scoreType: "relative_occurrence"`,
`calibratedProbability: false`, four predictions with `speciesSlug`, `scientificName`,
`commonNameEn`, `relativeOccurrenceScore` and `selectedModel`, plus `modelVersion`.
Coordinates outside the supported Malaysian EEZ return `422 OUTSIDE_MODEL_AREA`; malformed
coordinates return `400 VALIDATION_FAILED`.

## 2c. Where biodiversity data comes from (required by DMP §2 and §9)

The DMP's source register recognises exactly two open datasets. Both are **CC BY-NC — non-commercial
use only** — and both **require the attribution to be displayed**, with source URL and access date
retained (DMP §9).

Provenance is therefore **part of the data**, not a comment:

```json
{
  "name": "Green Sea Turtle",
  "kind": "species",
  "scientificName": "Chelonia mydas",
  "threatCategory": null,
  "glyph": "turtle",
  "text": "Occasional visitor along the Strait of Malacca…",
  "pictureUrl": null,
  "source": {
    "dataset": "OBIS",
    "citation": "OBIS — Ocean Biodiversity Information System. Intergovernmental Oceanographic Commission of UNESCO. www.obis.org — CC BY-NC",
    "url": "https://api.obis.org/occurrence",
    "accessedAt": "2026-08-28"
  }
}
```

- `kind` — `species` / `habitat` / `group`. **Only `species` can carry a scientific name or threat
  category.** Habitats (mangrove, seagrass) and groups (migratory birds, marine fish) cannot.
- `threatCategory` — from the FishBase extract. **Null when not retrieved. Do not guess.**
- `source.dataset` — `FishBase` / `OBIS` / `other` / `pending`.
- `pictureUrl` — FishBase `picture_url`. **Image rights are separate from the dataset licence** and
  must be checked per image.

### ⚠️ All 11 species cards are currently unsourced

Every entry in `src/mockData.ts` uses `PENDING_SOURCE`, which the UI renders as an amber
`SOURCE PENDING · NOT YET FROM FISHBASE / OBIS` badge. This is deliberate: **better a visible gap
than a fabricated citation in a demo or a report.**

### ⚠️ Only 1 of the 11 can actually come from FishBase

| Card type | Count | FishBase | OBIS |
| --- | --- | --- | --- |
| Marine fish (group) | 1 | yes | yes |
| Sea turtle, horseshoe crab | 2 | no — fish only | yes |
| Mangrove, seagrass (habitats) | 5 | no | no |
| Migratory and coastal birds | 3 | no | no |
| | | | |

**Seven exist in neither dataset.** FishBase covers fish; OBIS covers marine taxa but not
terrestrial birds or plant habitats. Those seven need either a different cited source
(`dataset: "other"`) or a rewrite that does not claim species-level provenance.
**Su and Keith need to settle this together** — it affects both Epic 5's content and the DMP's
source register.

---

### Species storage: `dim_species` + `area_species` (decided)

The species master and "which cards this area shows" are separated. The old `beach_species`
is replaced by these two tables.

```sql
-- Species master, extracted from FishBase. DMP §4.1: upsert on scientific_name
CREATE TABLE dim_threat (
  threat_id     serial PRIMARY KEY,
  threat_name   text NOT NULL UNIQUE          -- threat category dictionary
);

CREATE TABLE dim_species (
  species_id      uuid PRIMARY KEY,
  scientific_name text NOT NULL UNIQUE,       -- upsert key; rows without one are discarded
  common_name     text,
  threat_id       int  REFERENCES dim_threat(threat_id),
  glyph           text NOT NULL,              -- one of the six icon values
  picture_url     text,                       -- image rights are separate; check per image
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- "the biodiversity cards for this area". areas 1 ─ N area_species ─ N…1 dim_species
CREATE TABLE area_species (
  id                  uuid PRIMARY KEY,
  area_id             text NOT NULL REFERENCES beaches(id) ON DELETE CASCADE,
  species_id          uuid NULL REFERENCES dim_species(species_id),

  kind                text NOT NULL CHECK (kind IN ('species','habitat','group')),
  display_name        text NOT NULL,
  glyph               text NOT NULL,          -- one of the six icon names. It has to live
                                              -- here: habitats and group names have no
                                              -- dim_species row, and the icon cannot be
                                              -- inferred from kind either — 'group' covers
                                              -- both bird and fish
  text                text NOT NULL,
  sort_order          int  NOT NULL DEFAULT 0,
  origin              text NOT NULL DEFAULT 'curated'
                           CHECK (origin IN ('curated','derived')),

  source_dataset      text NOT NULL,
  source_citation     text NOT NULL,
  source_url          text,
  source_accessed_at  date,

  occurrence_state    text NOT NULL DEFAULT 'unavailable'
                           CHECK (occurrence_state IN ('ready','pending','unavailable')),
  occurrence_score    int  CHECK (occurrence_score BETWEEN 0 AND 100),
                           -- a relative score, NOT a probability. Set only when state='ready'
  occurrence_basis    text,

  UNIQUE (area_id, species_id),
  CHECK ((kind = 'species') = (species_id IS NOT NULL)),
  CHECK ((occurrence_score IS NULL) = (occurrence_state <> 'ready')),
  CHECK ((occurrence_score IS NULL) OR (occurrence_basis IS NOT NULL))
);
```

**A nullable `species_id` is the crux.** Only 2 of the 11 cards are actual species (Green Sea
Turtle, Horseshoe Crab). The other 9 are habitats (mangrove, seagrass) and groups (coastal birds,
migratory shorebirds, marine fish). They have no scientific name, so under DMP §4.1 — *"Rows
without a usable scientific name are discarded"* — they cannot enter `dim_species` at all. The
nullable FK lets those 9 live on their own `area_species` row while `dim_species` stays purely
FishBase-derived.

**Why `text` sits on the junction, not on `dim_species`.** The same card reads differently per
beach: `Coastal Birds` at Morib is *"Migratory shorebirds feed along this tide line…"*, at Kelanang
it is *"Egrets and herons hunt along the shallow channels…"*. `likelihood_*` follows the same logic
— it is inherently a (species × place) value.

**The two CHECKs are guardrails.** `kind='species'` must carry a master row and nothing else may;
the two likelihood columns must be set or null together.

**The API response shape does not change.** The backend joins the two tables and flattens them into
the existing `species[]` array — no frontend code changes.

> **Two open items:**
> ① The DDL says `area_id REFERENCES beaches(id)`. The DMP calls this concept `areas`, the contract
>   calls it `beaches` — same thing, two names. Renaming is a separate step, not part of this change.
> ② `origin` remains `curated` for the static cards. The current offline model route returns
>   contextual predictions separately and does not generate `derived` database rows.

---


### One report, six categories: six new columns on `reports` (decided)

A report used to carry one `category` and one `quantity`. With a column per category, a single
report can describe a mixed pile of litter.

```sql
ALTER TABLE reports
  ADD COLUMN qty_plastic      text CHECK (qty_plastic      IN ('Small','Medium','Large','Very Large')),
  ADD COLUMN qty_fishing_gear text CHECK (qty_fishing_gear IN ('Small','Medium','Large','Very Large')),
  ADD COLUMN qty_glass        text CHECK (qty_glass        IN ('Small','Medium','Large','Very Large')),
  ADD COLUMN qty_metal        text CHECK (qty_metal        IN ('Small','Medium','Large','Very Large')),
  ADD COLUMN qty_paper        text CHECK (qty_paper        IN ('Small','Medium','Large','Very Large')),
  ADD COLUMN qty_other        text CHECK (qty_other        IN ('Small','Medium','Large','Very Large')),

  -- a report with nothing recorded is not a report
  ADD CONSTRAINT reports_at_least_one_category CHECK (
    num_nonnulls(qty_plastic, qty_fishing_gear, qty_glass,
                 qty_metal, qty_paper, qty_other) >= 1
  );
```

**`NULL` means "this category was not seen"**, not "seen, amount zero". The interface has to keep
those apart: an unrecorded category draws no bar, rather than a zero-length one.

**The old `category` / `quantity` columns become derived**, kept so existing responses keep working:

```
category  = the category with the highest category score among the six
            (category weight × its quantity weight; ties use the published category order)
quantity  = the value in that category's column
```

Drop them once the record screen is multi-select and the frontend no longer reads them.

### "Learn More" shows the latest report's composition (decided)

**Learn More** on the biodiversity map card and **View Beach** on the litter card go to the same
place — the beach detail page. That page's "LITTER COMPOSITION" block changes meaning:

> **The six-column breakdown of that beach's most recent `Counted` report**, rather than an
> aggregate over the 90-day window.

`GET /beaches/:id` changes accordingly:

```json
"composition": [
  { "category": "Plastic",      "quantity": "Large"  },
  { "category": "Fishing gear", "quantity": "Medium" },
  { "category": "Glass",        "quantity": "Small"  }
],
"compositionSource": {
  "reportId":  "r_01H...",
  "createdAt": "2026-08-19T16:00:00+08:00"
}
```

- List only the **non-null** categories, ordered by weight, descending.
- `compositionSource` is required — the current on-screen line
  `SHARE OF 8 VERIFIED REPORTS · BROAD CATEGORIES` becomes **false** under this change and has to
  say which report it came from instead. Leaving it would mislead the reader.
- With no `Counted` report at all, both `composition` and `compositionSource` return `null`.

> ⚠️ **This makes `area_garbage` pointless.** That table materialises "share of N reports by
> category". If composition is just the latest report, you read it off that one row and no
> aggregate is needed. **`area_garbage` will not be created (decided).**

### Three things this change pulls with it

| Where | Today | Has to become |
| --- | --- | --- |
| `RecordScreen.tsx` | Single-select category (`patchDraft({ category: cat })`) | A quantity band per category, several selectable |
| Severity formula (§7) | `category weight × quantity level` | Report Score is the maximum category score; Beach Attention Score is the median of active report scores |
| `BeachScreen.tsx` caption | `SHARE OF n VERIFIED REPORTS` | Point at the specific report and its date |

The scoring choice is now fixed for the current MVP: a multi-category report uses the maximum
category score, and a beach uses the median of active report scores from the latest 90 days.

---

## 3. Scoring rule (US4.3) — published rule

| Method | Path | Auth | |
| --- | --- | --- | --- |
| GET | `/scoring-method` | no | Publishes the active scoring rule used by the frontend and backend |

The weights, thresholds, aggregation methods and window are published by the backend and mirrored
in `src/scoring.ts`. The frontend keeps the local copy for mock/offline mode and compares it with
the live response when a real API is configured.

```json
{
  "categoryWeights": [
    { "category": "Fishing gear", "weight": 1.00 },
    { "category": "Plastic",      "weight": 0.85 },
    { "category": "Glass",        "weight": 0.70 },
    { "category": "Metal",        "weight": 0.60 },
    { "category": "Other",        "weight": 0.50 },
    { "category": "Paper",        "weight": 0.35 }
  ],
  "quantityWeights": [
    { "quantity": "Small",      "weight": 1 },
    { "quantity": "Medium",     "weight": 2 },
    { "quantity": "Large",      "weight": 3 },
    { "quantity": "Very Large", "weight": 4 }
  ],
  "bands": [
    { "band": "Low",      "range": "below 1.5",     "color": "#7CA98B" },
    { "band": "Moderate", "range": "1.5 – <2.5",    "color": "#D9A24B" },
    { "band": "High",     "range": "2.5 – <3.5",    "color": "#CE6B45" },
    { "band": "Severe",   "range": "3.5 and above", "color": "#B84A3F" }
  ],
  "windowDays": 90,
  "minReports": 3,
  "reportAggregation": "max",
  "beachAggregation": "median-of-active-reports",
  "ruleVersion": "radar-sampah-scoring-v3"
}
```

Severity is computed by the backend (§7); the published rule is rendered by the frontend. **If the
two disagree, the screen explaining the rule is lying about the rule.**

- The numbers above are the specification; `src/scoring.ts` is their executable copy.
- When a real API is configured, the frontend uses the published response and logs a console warning
  in development if it differs from the local mock copy.
- Changing any weight or threshold means changing both sides and bumping the rule version.

> DMP §7.1 requires the rule set to be **fixed and versioned** so past scores stay explainable.
> The `/scoring-method` response publishes a `ruleVersion` string so the active rule remains
> explainable alongside the returned report and beach scores.

---

## 4. Location → beach

| Method | Path | Auth | |
| --- | --- | --- | --- |
| POST | `/geo/resolve-beach` | yes | body `{ lat, lng }` → `BeachSummary` or `null` |

After the user taps "Allow Once", the browser hands over one reading and the backend resolves the
nearest supported beach. Out of range returns `null` (a 200 with a null body, not a 404) and the
frontend switches to manual selection.

- Haversine distance; **a hit requires ≤ 25 km**. The two closest beaches (Morib and Kelanang) are
  about 6 km apart, so 25 km separates them while tolerating coastal GPS drift.
- **These coordinates are not persisted by this endpoint.** They are used for the lookup and dropped.

---

## 5. Photo upload

Processed, EXIF-stripped JPEG bytes are stored privately in `report_photos`
(PostgreSQL `bytea` in deployment). `reports` references the opaque photo key.
Legacy private filesystem photos remain readable. See the current
[September 17 contract decisions](../../docs/core-update-20260917.md).

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/uploads/photos` | yes | `multipart/form-data`, field name `photo` |
| GET | `/uploads/photos/<photo_key>/preview-url` | yes | Renew an owner-only short-lived preview URL |

```json
// 201
{
  "photoKey": "2026/08/8f3a....jpg",
  "previewUrl": "https://cdn.example.com/photos/ph_01H....jpg",
  "metadataStripped": true
}
```

The browser creates a JPEG copy with native `Image` and `canvas` before sending the multipart
request, so the original file's metadata is not uploaded. The field name is `photo` and the
upload response is used as-is by the report form.

If a report is reopened after a refresh and its previous signed URL has expired, the owner can
call `GET /uploads/photos/<photo_key>/preview-url`. The endpoint checks the photo metadata owner
and file before returning a fresh `{ "previewUrl": "..." }`; another participant cannot renew it.

Three columns on the report:

```sql
ALTER TABLE reports
  ADD COLUMN photo_key      text    NOT NULL,   -- a storage key, not a reachable address
  ADD COLUMN photo_stripped boolean NOT NULL,
  ADD COLUMN photo_mime     text    NOT NULL CHECK (photo_mime IN ('image/jpeg','image/png'));
```

`POST /reports` carries `photoKey` — the key the upload returned.

### Access control: scoped signed access

Owner previews require ownership checks. Public beach galleries and signed share
links expose only the selected historical report image through separately scoped
tokens. They do not expose raw photo keys, participant identities or GPS coordinates.

So the rule is simple:

- The bucket or directory is **not publicly readable**. No long-lived public address exists.
- In the responses of `GET /reports/mine` and `POST` / `PATCH /reports`, `photoUrl` is a
  **short-lived signed URL** (15 minutes is plenty), minted from `photo_key` at serialisation time.
- The same owner-only responses include the opaque `photoKey` so the client can request a fresh
  preview URL after reload. The key is not a public address and is omitted from other users' views.
- **Check ownership before minting**: `report.reporter_id` must equal the caller's user. If it
  does not, do not sign — omit the `photoUrl` field entirely.
- The signed URL expires on its own. The app does not cache it; every list fetch gets a fresh one.

An `<img>` tag cannot carry an Authorization header, which is why this is a signed URL rather
than an authenticated endpoint. That is the standard object-storage mechanism (S3 presigned URLs,
GCS signed URLs), not a workaround.

> ⚠️ **Stripping EXIF and using unguessable filenames is not access control.**
> Those stop a photo leaking a location, and stop somebody guessing an address. They do nothing
> once an address is forwarded. The control is the three things together: a private bucket, an
> ownership check, and a short expiry.

### Three things the backend must do

1. **Strip EXIF**, the GPS block above all. Only return `metadataStripped: true`, and only write
   `reports.photo_stripped = true`, once it is really gone — the app shows its
   "LOCATION METADATA REMOVED" badge from that field. **Return `false` rather than lying**; that
   badge is a promise to the user.
2. **Limits**: ≤ 10 MB; accept `image/jpeg`, `image/png` and `image/heic` (an iPhone shoots HEIC,
   so it must be accepted and converted to JPEG); resize the long edge to ≤ 2048 px.
3. **Sweep orphans**: uploads referenced by no report within 24 hours are eligible
   for the orphan cleanup job, including their private database bytes.

Resolved reports retain the original image and report for audit. An all-Small
cleanup removes the report from active scoring, without deleting its history.

---

## 6. Reports ★ core

| Method | Path | Auth | |
| --- | --- | --- | --- |
| POST | `/reports` | yes | Submit |
| GET | `/reports/mine?status=` | yes | Own reports, newest first |
| GET | `/reports/mine/counts` | yes | `{ counted, duplicate, incomplete }` |
| PATCH | `/reports/:id` | yes | Correct a report |

### POST `/reports`

```json
{
  "beachId": "morib",
  "quantities": {
    "Plastic": "Large",
    "Fishing gear": "Medium",
    "Glass": "Small"
  },
  "photoKey": "2026/08/8f3a....jpg",
  "locationSource": "gps",
  "coords": { "lat": 2.746, "lng": 101.440 }
}
```

- **`quantities` is an object, not an array.** Keys are the category strings verbatim
  (`Plastic` / `Fishing gear` / `Glass` / `Metal` / `Paper` / `Other`), values are one of the four
  bands. **At least one entry.** A category that was not seen is simply absent — do not send
  `null` and do not send 0. The backend maps this onto the six `qty_*` columns and leaves the
  rest `NULL`.
- **`category` and `quantity` are no longer in the request.** They are derived server-side from
  `quantities` — the maximum category score and its band (see §2c) — and still come
  back in every response.
- **The response must also carry the full `quantities` map.** The derived pair alone is not
  enough: the app's "correct this record" flow reads the response back into the form and PATCHes
  the whole set. If the response names only one category, a user replacing just the photo would
  silently clear the other five columns — a real data-loss bug, not a cosmetic one.

```json
// 201
{
  "id": "r_01H...",
  "beachId": "morib",
  "beachName": "Pantai Morib",
  "quantities": {
    "Plastic": "Large",
    "Fishing gear": "Medium",
    "Glass": "Small"
  },
  "category": "Plastic",
  "quantity": "Large",
  "categoryScores": {
    "Plastic": 2.55,
    "Fishing gear": 2.00,
    "Glass": 0.70
  },
  "reportScore": 2.55,
  "createdAt": "2026-08-28T09:41:00+08:00",
  "status": "Counted",
  "photoUrl": "https://cdn.example.com/photos/ph_01H....jpg"
}
```

When the same participant submits again for the same beach on the same Kuala Lumpur local day,
the same 201 shape carries `status: "Duplicate"`. This is a same-day submission limit; it does
not prove that the photos or litter content are identical:

```json
{
  "status": "Duplicate",
  "statusNote": "Same participant, beach and local day as an existing counted report. Saved here but excluded from the beach score."
}
```

### Status is decided synchronously, inside the POST transaction

**Why synchronous.** The design takes the user straight to a "Record saved" screen that prints the
conclusion — `VALID · NOT A DUPLICATE · COUNTED`. An asynchronous review would need a Pending state
and a notification system, which is the Iteration 2 moderation flow and explicitly out of scope.

Evaluated in order, first match wins:

| # | Condition | Result |
| --- | --- | --- |
| 1 | `photoKey` missing | 400 `PHOTO_REQUIRED`, nothing stored |
| 2 | `quantities` empty, or a key/value outside its enum | 400 `VALIDATION_FAILED`, nothing stored |
| 3 | Same **reporter** + same **beachId** + same **calendar day** (`Asia/Kuala_Lumpur`) already has a `Counted` row | `Duplicate` |
| 4 | Otherwise | `Counted` |

**Rule 3 is the entire duplicate definition — do not add a coordinate-distance or content-similarity
test.** The app describes this as a same-participant, same-beach, same-local-day submission limit.
It is an anti-double-counting rule, not a claim that two photos or litter observations are identical.

**Where does `Incomplete` come from?** Never from a POST — a missing field is rejected with a 400 and
nothing is stored. `Incomplete` is set **afterwards**, from one of two places:

- the photo pipeline finding the image unreadable (all black, hopelessly blurred, decode failure)
- Iteration 2 human review (not implemented now; the value exists so the state machine is complete)

So in Iteration 1, `Incomplete` appears only in seed data and from the photo pipeline. The frontend
already handles it: tapping such a record opens the correction flow pre-filled, and a PATCH re-runs
the judgement.

### `statusNote`

**The backend sends a finished English sentence; the frontend prints it verbatim.** Two standard
strings:

- Duplicate → `Same participant, beach and local day as an existing counted report. Saved here but excluded from the beach score.`
- Incomplete → `Photo unreadable — excluded until you correct and save the record.`

Omit the field (or send `null`) when `Counted`.

### How location is stored (decided)

Coordinates live **on the `reports` row itself** (`lat` / `lng`, nullable) rather than in a separate
table, matching DMP §6's `litter_reports: photo ref, approx location, category, quantity, status…`.

- Written only when `locationSource = 'gps'`; both columns null for a manual beach pick.
- Used for exactly two things: matching the beach, and detecting duplicates.
- **Precision: 3 decimal places (~110 m).** The frontend rounds at capture in `GpsScreen`, so the
  full-precision reading never leaves the device. That is what makes both the DMP's
  `no exact locations are stored` and the on-screen "EXACT GPS IS PRIVATE" true at the same time.

### Privacy requirements (hard)

- **No endpoint may ever return `lat` / `lng`** — not report detail, not the record list, not a CSV
  export, not an admin screen.
- Public geography stops at `beachId`.

> ⚠️ **The coordinates now sit in the same table as business fields, so `SELECT *` will carry them
> out.** Exclude the two columns explicitly in the ORM or serialisation layer — never assemble a
> response straight from `SELECT *` — and make it a standing code-review check.

Two on-screen promises depend on this: "GPS USED ONCE · PRIVATE" on the confirm screen, and
"BROAD AREA SHOWN — EXACT GPS IS PRIVATE" on the map card.

### GET `/reports/mine?status=`

Optional `status` filter (`Counted` / `Duplicate` / `Incomplete`); omitted returns everything.
**Newest first.** Only the authenticated user's own rows.

### GET `/reports/mine/counts`

```json
{ "counted": 3, "duplicate": 1, "incomplete": 1 }
```

### PATCH `/reports/:id`

Body is any subset of the POST body (`beachId` / `quantities` / `photoKey`).
**Sending `quantities` replaces the whole set**, it is not a per-key merge — a category left out is a column cleared.

- Own reports only, otherwise 403 `NOT_OWNER`.
- **Re-run the status judgement.** An `Incomplete` record with a fixed photo must return to `Counted`.
- Returns the full updated `LitterReport`.

---

## 7. How severity is computed (backend detail)

```
For one beach:

eligible = that beach's `Counted` reports from the latest 90 days that still have
           remaining litter after cleanup; fully cleared reports are excluded from
           the current score/count but retained for historical audit
           and created_at falls within the last 90 days

if count(eligible) < 3:
    severity = null;  band = null;  insufficientData = true
else:
    category_score[category] = category_weight[category] × quantity_weight[quantity]
    record_score  = max(category_score for every category in the report)
    beach_score   = median(record_score across active eligible reports)
    severity      = < 1.5 → Low | < 2.5 → Moderate | < 3.5 → High | else Severe
    band          = Low=1, Moderate=2, High=3, Severe=4

validReports    = count(eligible)  # active reports only; fully cleared reports stay in history
lastReportedAt  = max(created_at) across ALL that beach's Counted reports (window ignored)
freshnessKind   = now - lastReportedAt: < 30d → 'ok' | ≤ 90d → 'aging' | else 'stale'

composition       = the non-null qty_* columns of that beach's newest Counted report,
                    ordered by category weight, descending
compositionSource = that report's { reportId, createdAt }
                    both null when the beach has no Counted report at all
                    ← composition ignores the 90-day window and does not depend
                      on insufficientData
```

Note `lastReportedAt` **deliberately ignores the 90-day window** — "nothing reported recently" is
itself the finding being reported, so an empty window is not the same as no history.

Use the weights and thresholds from §3 — do not introduce a second set.

Implementation is free: a cached column updated on write, or computed at read time (four beaches
makes live computation entirely viable).

---

## 8. Rate limits

Per user: `POST /reports` 30/hour, `POST /uploads/photos` 60/hour.
Over the limit returns 429 `RATE_LIMITED`.

---

## 9. Suggested tables

![Entity relationship diagram](./docs/erd.png)


```
users            id, participant_id(uniq), role, created_at
                 ← no name, email or phone columns of any kind

beaches          id, name, area, lat, lng, habitat, habitat_tag, sensitivity,
                 primary_species_glyph, cover_image_url, scene,
                 ecological_note, created_at

dim_threat       threat_id(PK), threat_name(uniq)          ← DMP §6 dictionary
dim_species      species_id(PK), scientific_name(uniq), common_name,
                 threat_id(FK), glyph, picture_url, created_at
                 ← real species only, upserted on scientific_name
area_species     id(PK), area_id(FK→beaches), species_id(FK→dim_species, nullable),
                 kind, display_name, glyph, text, sort_order, origin,
                 source_dataset, source_citation, source_url, source_accessed_at,
                 occurrence_state, occurrence_score(nullable), occurrence_basis(nullable)
                 ← a relative score, not a probability; state separates
                   a static source-pending card from "no data for this card"
                 ← area×species junction; habitats and groups have a null species_id

reports          id, reporter_id, beach_id, location_source,
                 photo_key, photo_mime, photo_stripped
                 ← photo_key references private report_photos bytes; signed
                   owner/gallery/share access follows the relevant scope (§5)
                 qty_plastic, qty_fishing_gear, qty_glass,
                 qty_metal, qty_paper, qty_other        ← each nullable, at least one set
                  category, quantity                     ← derived: maximum category score
                 lat(nullable), lng(nullable),
                 status, status_note, created_at, updated_at, deleted_at
                 ← new GPS writes keep lat/lng null and use an opaque privacy
                   reference; exact coordinates are never returned

```

Two indexes carry the whole application:
`(beach_id, status, created_at)` for the severity window, and
`(reporter_id, beach_id, created_at)` for the duplicate check.

`beaches` and `area_species` are **seed data** — four beaches fixed for Iteration 1, no CRUD
endpoints. Copy the contents from the frontend's `src/mockData.ts`; the field names line up.

---

## 10. Out of scope for Iteration 1 (do not build)

Marked out of scope in the design and the team's MVP split: US2.3 AI category suggestions,
peer and moderator review flows, Epic 1 cleanup activities, Epic 3 report reliability,
Epic 6 outcomes, Epic 7 recurrence, Epic 8 recognition, US5.3 quizzes, US5.4 species cards.

> ⚠️ **The DMP disagrees with this list.** Its Iteration 1 scope statement includes a
> "basic verification workflow", "community cleanup missions" and "basic points" — Epics 3, 1 and 8.
> The team's MVP split removed Epic 3 and parked the rest. **Both documents are signed and they
> contradict each other.** Settle it before anyone builds from the DMP's scope line.

---

## 11. Connecting the frontend when the backend is ready

```bash
cd actual-project/frontend
cp .env.example .env
# set VITE_API_BASE_URL=https://your-api.example.com
npm run dev
```

The frontend switches from mock data to real HTTP automatically; no page code changes. If field
names or paths differ from this document, the edits are confined to `src/api.ts`.
