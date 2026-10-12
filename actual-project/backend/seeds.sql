-- ============================================================================
-- Radar Pantai — seeds.sql
--
-- Every value copied out of frontend/src/mockData.ts and frontend/src/sources.ts.
-- Nothing added, nothing rounded, nothing invented.
--
-- Run after schema.sql. Safe to re-run: every insert is ON CONFLICT DO NOTHING
-- and the uuids are derived from the names, so they do not change between runs.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- users — the demo participant. mockData.ts MOCK_USER
-- ---------------------------------------------------------------------------
INSERT INTO users (id, participant_id, role) VALUES
  ('u_anon_1637', '1637', 'volunteer')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- beaches — the four MVP beaches. mockData.ts BEACHES
-- Coordinates are real. severity / validReports / freshness are NOT here —
-- they are computed from `reports` on every request (API.md §7, §9).
-- ---------------------------------------------------------------------------
INSERT INTO beaches
  (id, name, area, lat, lng, habitat, habitat_tag, sensitivity,
   primary_species_glyph, cover_image_url, scene, ecological_note)
VALUES
  ('morib', 'Pantai Morib', 'Banting, Selangor',
   2.746, 101.44,
   'Intertidal mudflat & sandy shore', 'MUDFLAT', 'Migratory feeding ground',
   'turtle', NULL,
   'linear-gradient(180deg,transparent 42%,rgba(221,227,236,.2) 47%,transparent 55%),radial-gradient(110% 55% at 72% 18%,rgba(221,227,236,.35),transparent 58%),linear-gradient(178deg,#8FD0E8 0%,#4E9EC9 36%,#2E6EA8 58%,#173E77 100%)',
   'Plastic and abandoned fishing gear may affect turtles and shorebirds that feed in this coastal environment.'),
  ('remis', 'Pantai Remis', 'Jeram, Kuala Selangor',
   3.218, 101.302,
   'Mudflat & shallow coastal waters', 'MUDFLAT', 'Seasonal bird activity',
   'bird', NULL,
   'radial-gradient(100% 60% at 30% 14%,rgba(255,255,255,.4),transparent 55%),linear-gradient(180deg,#D8ECF4 0%,#8FC6DC 38%,#5FA3C4 52%,#CFC9BA 78%,#B5AF9E 100%)',
   'Litter that settles on mudflats may be swallowed by, or entangle, the birds and invertebrates feeding here.'),
  ('kelanang', 'Pantai Kelanang', 'Banting, Selangor',
   2.789, 101.415,
   'Mangrove-lined estuary shore', 'MANGROVE', 'Evidence still being gathered',
   'mangrove', NULL,
   'radial-gradient(90% 55% at 70% 16%,rgba(156,174,168,.35),transparent 60%),linear-gradient(178deg,#2F6B7C 0%,#245A6B 44%,#1B4557 72%,#123244 100%)',
   'Litter caught in mangrove roots can persist for years and may break down into microplastics.'),
  ('bagan', 'Pantai Bagan Lalang', 'Sepang, Selangor',
   2.601, 101.688,
   'Wide sandy beach & seagrass patches', 'SEAGRASS', 'Horseshoe crab spawning shore',
   'crab', NULL,
   'radial-gradient(110% 60% at 60% 12%,rgba(255,255,255,.45),transparent 58%),linear-gradient(178deg,#E4EEF3 0%,#9CCAD8 34%,#5FA3C4 52%,#D6CFBE 76%,#BFB8A6 100%)',
   'Ghost nets and plastic sheeting may trap horseshoe crabs that come ashore to spawn.')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- dim_threat — EMPTY ON PURPOSE.
-- Every card in mockData.ts has threatCategory: null, so the frontend gives no
-- dictionary to copy. The IUCN categories come from DMP §6, not from here.
-- Do not invent them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- dim_species — only real species. 2 of the 11 cards qualify; the other 9 are
-- habitats and groups with no scientific name, so under DMP §4.1 they cannot
-- enter this table at all.
-- threat_id is NULL because the frontend records no threat category for either.
-- ---------------------------------------------------------------------------
INSERT INTO dim_species (species_id, scientific_name, common_name, threat_id, glyph, picture_url)
VALUES
  ('4e8b7d8e-ce94-58eb-b567-89b050794009', 'Chelonia mydas', 'Green Sea Turtle', NULL, 'turtle', NULL),
  ('0833d547-8d63-5656-90bd-e236fb664f2a', 'Carcinoscorpius rotundicauda', 'Horseshoe Crab', NULL, 'crab', NULL)
ON CONFLICT (scientific_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- area_species — the 11 biodiversity cards, in the order the frontend lists them.
-- source_* all come from sources.ts PENDING_SOURCE: no card has a confirmed
-- source yet, which is why the app shows an amber "SOURCE PENDING" badge instead
-- of a citation someone made up.
-- ---------------------------------------------------------------------------
INSERT INTO area_species
  (id, area_id, species_id, kind, display_name, glyph, text, sort_order, origin,
   source_dataset, source_citation, source_url, source_accessed_at,
   occurrence_state, occurrence_score, occurrence_basis)
VALUES
  ('f52d3e75-d37e-5b61-8fae-c3be7553fd4d', 'morib', '4e8b7d8e-ce94-58eb-b567-89b050794009',
   'species', 'Green Sea Turtle', 'turtle',
   'Occasional visitor along the Strait of Malacca. Floating plastic may be mistaken for food.',
   1, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'pending', NULL, 'Green sea turtle is one of the four modelled species. Backend not connected yet.'),
  ('616b56fc-e572-5590-bf23-bd97a80f0930', 'morib', NULL,
   'habitat', 'Mangrove Fringe', 'mangrove',
   'Young mangroves at the northern end shelter juvenile fish and crabs.',
   2, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL),
  ('063c8542-8156-5054-8857-747aa4e21b53', 'morib', NULL,
   'group', 'Coastal Birds', 'bird',
   'Migratory shorebirds feed along this tide line between September and April.',
   3, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, 'Not one of the four modelled species, so no occurrence score exists for this card.'),
  ('03ea690b-1a14-571e-93c9-b9c4867ab7a6', 'remis', NULL,
   'group', 'Migratory Shorebirds', 'bird',
   'The Jeram mudflats are a stopover for migratory waders crossing the strait.',
   1, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL),
  ('9e411ff4-713f-53d9-af8e-9ddd043d2c48', 'remis', NULL,
   'group', 'Marine Fish', 'fish',
   'Shallow nursery waters for coastal fish species.',
   2, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL),
  ('ac8a8745-3dc9-5525-a8cb-f5848c8d8632', 'remis', NULL,
   'habitat', 'Mangrove Belt', 'mangrove',
   'A narrow mangrove belt lines the river mouth south of the beach.',
   3, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL),
  ('3031f511-9654-59fa-abf9-92093bcb4b89', 'kelanang', NULL,
   'habitat', 'Mangrove Habitat', 'mangrove',
   'Dense mangrove roots trap sediment and shelter juvenile marine life.',
   1, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL),
  ('3db1eda4-3f69-5934-8dc7-ee85f3803102', 'kelanang', NULL,
   'group', 'Coastal Birds', 'bird',
   'Egrets and herons hunt along the shallow channels at low tide.',
   2, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL),
  ('a7737c08-6daf-5ccd-a5ef-2404f96c9e8c', 'bagan', '0833d547-8d63-5656-90bd-e236fb664f2a',
   'species', 'Horseshoe Crab', 'crab',
   'One of the few Selangor shores where mangrove horseshoe crabs still come up to spawn.',
   1, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL),
  ('a17fca63-1333-5ad2-9fd7-555b8ca95b07', 'bagan', NULL,
   'habitat', 'Seagrass Patches', 'grass',
   'Seagrass in the shallows feeds and shelters small marine animals.',
   2, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL),
  ('1abc5ed2-fe4b-532b-ac46-1430da1fe74e', 'bagan', NULL,
   'habitat', 'Mangrove Habitat', 'mangrove',
   'The Sepang river-mouth mangroves sit just south of this beach.',
   3, 'curated',
   'pending', 'Awaiting FishBase / OBIS extract — not yet sourced', NULL, NULL,
   'unavailable', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- reports — the four seed reports. mockData.ts SEED_REPORTS
--
-- Three things the frontend does not give, and how they are filled here:
--
--   photo_key / photo_mime  The seed reports carry no photo. The app refuses to
--                           submit without one (flowRules.ts:96), so the column
--                           is NOT NULL. These keys point at nothing in storage —
--                           the beach page falls back to the gradient, exactly as
--                           it does today. Replace them if you upload demo images.
--   location_source         Not recorded in the seeds. 'manual' is the honest
--                           choice: no coordinates are stored either way.
--   category / quantity      Derived by the frontend already, and copied verbatim
--                           so the backend's own derivation can be checked
--                           against them.
-- ---------------------------------------------------------------------------
INSERT INTO reports
  (id, reporter_id, beach_id, location_source,
   photo_key, photo_mime, photo_stripped,
   qty_plastic, qty_fishing_gear, qty_glass, qty_metal, qty_paper, qty_other,
   category, quantity, lat, lng, status, status_note, created_at, updated_at)
VALUES
  ('r1', 'u_anon_1637', 'morib', 'manual',
   'seed/r1.jpg', 'image/jpeg', true,
   'Medium', NULL, 'Small', NULL, NULL, NULL,
   'Plastic', 'Medium', NULL, NULL,
   'Counted', NULL,
   '2026-08-14T02:00:00Z', '2026-08-14T02:00:00Z'),

  ('r2', 'u_anon_1637', 'morib', 'manual',
   'seed/r2.jpg', 'image/jpeg', true,
   'Small', NULL, NULL, NULL, NULL, NULL,
   'Plastic', 'Small', NULL, NULL,
   'Duplicate',
   'Same participant, beach and local day as an existing counted report. Saved here but excluded from the beach score.',
   '2026-08-09T02:00:00Z', '2026-08-09T02:00:00Z'),

  ('r3', 'u_anon_1637', 'remis', 'manual',
   'seed/r3.jpg', 'image/jpeg', true,
   'Small', 'Small', NULL, NULL, NULL, NULL,
   'Fishing gear', 'Small', NULL, NULL,
   'Counted', NULL,
   '2026-07-20T02:00:00Z', '2026-07-20T02:00:00Z'),

  ('r4', 'u_anon_1637', 'kelanang', 'manual',
   'seed/r4.jpg', 'image/jpeg', true,
   NULL, NULL, NULL, NULL, NULL, 'Small',
   'Other', 'Small', NULL, NULL,
   'Incomplete',
   'Photo unreadable — excluded until you correct and save the record.',
   '2026-07-02T02:00:00Z', '2026-07-02T02:00:00Z')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================================
-- ⚠️  READ THIS BEFORE YOU DEMO
--
-- These four reports will NOT reproduce the prototype's map. The numbers on the
-- prototype (Morib High / 8 valid reports, Remis Moderate / 6, Bagan High / 7)
-- are hand-written display values in mockData.ts, not something the four seed
-- reports produce.
--
-- Counting active Counted reports inside the 90-day window, as API.md §7 requires:
--
--   morib     1  →  Insufficient data   (prototype shows High, 8 valid)
--   remis     1  →  Insufficient data   (prototype shows Moderate, 6 valid)
--   kelanang  0  →  Insufficient data   (prototype shows the same — this one matches)
--   bagan     0  →  Insufficient data   (prototype shows High, 7 valid)
--
-- Three of the four beaches would go grey, and the map would show no severity
-- colours at all. That is the correct behaviour under the published rule — it is
-- the seed data that is thin, not the rule.
--
-- Two honest ways forward, both fine:
--
--   1. Ship it as is. Every beach reads "Insufficient data — not a sign the
--      beach is clean", which is true and is exactly what the app is designed to
--      say. Nothing has to be invented.
--
--   2. Add more demo reports so the map has colour for the presentation. Each
--      beach needs at least 3 active Counted reports inside the last 90 days,
--      and the median of active report scores decides which colour. Mark any
--      such rows clearly as demo padding — they are not in the frontend and not
--      in this file for a reason.
--
-- Do not fix this by writing severity into the beaches table. That is the one
-- thing the schema deliberately prevents.
-- ============================================================================
