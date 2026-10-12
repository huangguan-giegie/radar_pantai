-- ============================================================================
-- Radar Pantai — schema.sql
--
-- Current app:create_app() contract, including account profiles and attendance.
-- PostgreSQL. Keep this file aligned with the deployed database.
-- ============================================================================

BEGIN;

CREATE TABLE users (
  id             text        PRIMARY KEY,
  participant_id text        NOT NULL UNIQUE,
  role           text        NOT NULL DEFAULT 'volunteer'
                             CHECK (role IN ('volunteer','moderator')),
  user_token     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE beaches (
  id                    text        PRIMARY KEY,
  name                  text        NOT NULL,
  area                  text        NOT NULL,
  lat                   double precision NOT NULL,
  lng                   double precision NOT NULL,
  habitat               text        NOT NULL,
  habitat_tag           text        NOT NULL,
  sensitivity           text        NOT NULL,
  primary_species_glyph text        NOT NULL
                        CHECK (primary_species_glyph IN ('turtle','bird','mangrove','grass','crab','fish')),
  cover_image_url       text,
  scene                 text        NOT NULL,
  ecological_note       text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dim_threat (
  threat_id   serial PRIMARY KEY,
  threat_name text NOT NULL UNIQUE
);

CREATE TABLE dim_species (
  species_id       text PRIMARY KEY,
  scientific_name  text NOT NULL UNIQUE,
  common_name      text,
  threat_id        int REFERENCES dim_threat(threat_id),
  glyph            text NOT NULL CHECK (glyph IN ('turtle','bird','mangrove','grass','crab','fish')),
  picture_url      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE area_species (
  id                 text PRIMARY KEY,
  area_id            text NOT NULL REFERENCES beaches(id) ON DELETE CASCADE,
  species_id         text NULL REFERENCES dim_species(species_id),
  kind               text NOT NULL CHECK (kind IN ('species','habitat','group')),
  display_name       text NOT NULL,
  glyph              text NOT NULL CHECK (glyph IN ('turtle','bird','mangrove','grass','crab','fish')),
  text               text NOT NULL,
  sort_order         int NOT NULL DEFAULT 0,
  origin             text NOT NULL DEFAULT 'curated' CHECK (origin IN ('curated','derived')),
  source_dataset     text NOT NULL DEFAULT 'pending' CHECK (source_dataset IN ('FishBase','OBIS','other','pending')),
  source_citation    text NOT NULL,
  source_url         text,
  source_accessed_at date,
  occurrence_state   text NOT NULL DEFAULT 'unavailable' CHECK (occurrence_state IN ('ready','pending','unavailable')),
  occurrence_score   int CHECK (occurrence_score BETWEEN 0 AND 100),
  occurrence_basis   text,
  UNIQUE (area_id, species_id),
  CHECK ((kind = 'species') = (species_id IS NOT NULL)),
  CHECK ((occurrence_score IS NULL) = (occurrence_state <> 'ready')),
  CHECK ((occurrence_score IS NULL) OR (occurrence_basis IS NOT NULL))
);

CREATE TABLE report_photos (
  photo_key  varchar(500) PRIMARY KEY,
  owner_id   text NOT NULL REFERENCES users(id),
  mime       varchar(64) NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE reports (
  id              text        PRIMARY KEY,
  reporter_id     text        NOT NULL REFERENCES users(id),
  beach_id        text        NOT NULL REFERENCES beaches(id),
  location_source text        NOT NULL CHECK (location_source IN ('gps','manual')),
  photo_key       text        NOT NULL,
  photo_mime      text        NOT NULL CHECK (photo_mime IN ('image/jpeg','image/png','image/heic')),
  photo_stripped  boolean     NOT NULL DEFAULT false,
  qty_plastic      text CHECK (qty_plastic      IN ('Small','Medium','Large','Very Large')),
  qty_fishing_gear text CHECK (qty_fishing_gear IN ('Small','Medium','Large','Very Large')),
  qty_glass        text CHECK (qty_glass        IN ('Small','Medium','Large','Very Large')),
  qty_metal        text CHECK (qty_metal        IN ('Small','Medium','Large','Very Large')),
  qty_paper        text CHECK (qty_paper        IN ('Small','Medium','Large','Very Large')),
  qty_other        text CHECK (qty_other        IN ('Small','Medium','Large','Very Large')),
  category        text        NOT NULL CHECK (category IN ('Plastic','Fishing gear','Glass','Metal','Paper','Other')),
  quantity        text        NOT NULL CHECK (quantity IN ('Small','Medium','Large','Very Large')),
  lat             numeric(9,3),
  lng             numeric(9,3),
  item_counts     text,
  proximity_ref   char(64),
  event_id        text,
  status          text        NOT NULL DEFAULT 'Counted' CHECK (status IN ('Counted','Duplicate','Incomplete')),
  status_note     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  beach_name      varchar(160),
  quantities      text,
  CONSTRAINT reports_at_least_one_category CHECK (
    num_nonnulls(qty_plastic, qty_fishing_gear, qty_glass, qty_metal, qty_paper, qty_other) >= 1
  ),
  CONSTRAINT reports_manual_has_no_coords CHECK (
    location_source = 'gps' OR (lat IS NULL AND lng IS NULL)
  ),
  CONSTRAINT reports_note_only_when_excluded CHECK (
    status <> 'Counted' OR status_note IS NULL
  )
);

CREATE INDEX reports_severity_window ON reports (beach_id, status, created_at);
CREATE INDEX reports_duplicate_check ON reports (reporter_id, beach_id, created_at);

CREATE TABLE community_events (
  id          text PRIMARY KEY,
  beach_id    text NOT NULL REFERENCES beaches(id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  status      text NOT NULL CHECK (status IN ('Open','Closed')),
  source      text NOT NULL CHECK (source IN ('scheduled','moderator')),
  meeting_point varchar(160),
  created_by  text REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_events_time_check CHECK (ends_at > starts_at),
  UNIQUE (beach_id, starts_at)
);

CREATE INDEX community_events_window ON community_events (beach_id, starts_at);

CREATE TABLE community_event_members (
  event_id        text NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
  participant_id  text NOT NULL REFERENCES users(id),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  checked_in_at   timestamptz,
  location_passed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (event_id, participant_id),
  CONSTRAINT community_event_members_location_check CHECK (location_passed = (checked_in_at IS NOT NULL))
);

CREATE TABLE community_event_attendance (
  event_id       varchar(100) NOT NULL,
  participant_id varchar(80) NOT NULL,
  confirmed_at   timestamptz NOT NULL,
  PRIMARY KEY (event_id, participant_id)
);

CREATE TABLE account_profiles (
  user_id            text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname           varchar(30) NOT NULL,
  joined_leaderboard boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL
);

CREATE TABLE cleanup_actions (
  id                   text PRIMARY KEY,
  target_report_id     text REFERENCES reports(id),
  participant_id       text NOT NULL REFERENCES users(id),
  event_id             text REFERENCES community_events(id),
  beach_id             text NOT NULL REFERENCES beaches(id),
  -- Legacy exact-count fields stay nullable/readable for historical clients.
  removed_counts       text,
  total_removed        integer CHECK (total_removed > 0),
  -- Canonical Iteration 2 cleanup state.
  remaining_quantities text,
  removed_quantities   text,
  cleanup_score        integer CHECK (cleanup_score > 0),
  rows                 text NOT NULL,
  handling             text NOT NULL CHECK (handling IN ('Collected for disposal','Recycled / handled','Not recorded')),
  note                 text,
  idempotency_key      varchar(128) NOT NULL,
  request_fingerprint  char(64) NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, idempotency_key)
);

ALTER TABLE reports
  ADD CONSTRAINT reports_event_fk FOREIGN KEY (event_id) REFERENCES community_events(id);

CREATE INDEX cleanup_actions_target ON cleanup_actions (target_report_id, created_at);

COMMIT;
