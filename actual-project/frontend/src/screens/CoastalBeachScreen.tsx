import { useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiRequest, getBeach, USE_MOCK } from "../api";
import content from "../content/coastalContent.json";
import { useApp } from "../AppContext";
import { useAsyncData } from "../useAsyncData";
import {
  fetchCleanupEvents,
  fetchLatestCleanupForBeach,
} from "../iteration2Api";
import { getLitterGallery, litterGalleryPhotoUrl } from "../litterGallery";
import {
  BackButton,
  DraftChoiceDialog,
  GhostButton,
  Skeleton,
} from "../components/ui";
import {
  ActionTile,
  CoastalPage,
  DataUnavailable,
  LinkRow,
  SectionHeading,
  Sheet,
  WhiteCard,
} from "../components/CoastalUI";
import { Camera, Check, CommunityIcon } from "../components/Icon";
import { SpeciesPicture } from "../components/SpeciesPicture";
import { attentionStateFor, C, formatDate, SEVERITY, severityLabel } from "../theme";
import { hasDraftProgress, resumePath } from "../flowRules";
import { compositionFooter } from "./BeachScreen";
import { BandMeter } from "../components/ds";
import { cleanupDestination } from "../cleanupFlow";
import { RecurrenceEvidence } from "../components/RecurrenceEvidence";
import type { SeverityBand } from "../types";
import { useAppBack } from "../navigation";
import { eventIsAvailable, useEventClock } from "../eventAvailability";
import { StaticMap } from "../components/Visuals";
import { beachPhoto } from "../visuals";
import { beachMarineCards, type BeachWildlifeSpecies } from "../beachMarineLife";

type BeachWildlife = { beachId: string; sourceStatus: string; species: BeachWildlifeSpecies[]; coordinateContext?: { distanceKm: number } | null };

export default function CoastalBeachScreen() {
  const { beachId = "" } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const now = useEventClock();
  const [params] = useSearchParams();
  const fixture = content.beaches.find((b) => b.id === beachId);
  const goBack = useAppBack("/map" + (fixture?.region ? "?region=" + fixture.region : ""));
  const pilot = ["morib", "bagan", "remis", "kelanang"].includes(beachId);
  const previewOnly = USE_MOCK && !pilot;
  const {
    user,
    draft,
    resetDraft,
    patchDraft,
    setLastSavedReport,
    reportsVersion,
  } = useApp();
  const [draftChoice, setDraftChoice] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [showWildlifeEvidenceInfo, setShowWildlifeEvidenceInfo] = useState(false);
  const {
    data: detail,
    loading,
    error,
    refresh,
  } = useAsyncData(
    () => (previewOnly ? Promise.resolve(null) : getBeach(beachId)),
    [beachId, reportsVersion],
    null,
  );
  const { data: gallery } = useAsyncData(
    () => (previewOnly ? Promise.resolve([]) : getLitterGallery(beachId)),
    [beachId, reportsVersion],
    [],
  );
  const { data: events } = useAsyncData(
    () => fetchCleanupEvents(user?.participantId),
    [user?.participantId, reportsVersion],
    [],
  );
  const { data: cleanup } = useAsyncData(
    () =>
      previewOnly ? Promise.resolve(null) : fetchLatestCleanupForBeach(beachId),
    [beachId, reportsVersion],
    null,
  );
  const { data: wildlife, loading: wildlifeLoading, error: wildlifeError, refresh: refreshWildlife } = useAsyncData<BeachWildlife | null>(
    () => USE_MOCK ? Promise.resolve(null) : apiRequest<BeachWildlife>(`/beaches/${encodeURIComponent(beachId)}/wildlife`, "GET", undefined, 45_000, false),
    [beachId, previewOnly],
    null,
  );
  const b = detail ?? (previewOnly ? fixture : null);
  const event = events.find(
    (e) => e.beachId === beachId && eventIsAvailable(e, now),
  );
  const linkedEvent = params.get("event");
  const beginReport = () => {
    if (!b) return;
    resetDraft();
    setLastSavedReport(null);
    patchDraft({
      beachId,
      beachName: b.name,
      ...(linkedEvent &&
      events.some(
        (e) => e.id === linkedEvent && e.beachId === beachId && e.joined,
      )
        ? { linkedEventId: linkedEvent }
        : {}),
    });
    nav("/report/photo");
  };
  const startReport = () =>
    previewOnly
      ? setUnsupported(true)
      : hasDraftProgress(draft)
        ? setDraftChoice(true)
        : beginReport();
  if (loading)
    return (
      <CoastalPage back="/map" tabs={false}>
        <Skeleton h={220} />
        <Skeleton h={200} />
      </CoastalPage>
    );
  if (error || !b)
    return (
      <CoastalPage title="Beach" back="/map" tabs={false}>
        <DataUnavailable
          title={error ? "Could not load beach" : "Beach not found"}
          retry={error ? () => void refresh() : undefined}
        >
          {error ?? "Choose a beach from the map."}
        </DataUnavailable>
      </CoastalPage>
    );
  const band = b.severity as SeverityBand | null;
  const attention = attentionStateFor(
    band,
    detail?.insufficientData ?? !band,
    b.validReports,
  );
  const image = beachPhoto(beachId, detail?.coverImageUrl ?? fixture?.image);
  const heroLat = detail?.lat ?? null;
  const heroLng = detail?.lng ?? null;
  const region = detail?.region ?? fixture?.region ?? "";
  const hasDocumentedHabitat = Boolean((detail?.habitat ?? fixture?.habitat) && (detail?.habitat ?? fixture?.habitat) !== "Biodiversity information not yet available");
  const hasWildlifeContext = wildlife?.beachId === beachId;
  const currentSpecies = hasWildlifeContext ? wildlife.species : [];
  const marineCards = beachMarineCards(beachId, currentSpecies);
  const wildlifeEvidenceNote = hasWildlifeContext && wildlife?.sourceStatus === "modelled"
    ? "Species are suggested from OBIS marine-grid data around a nearby coastal reference. They provide context, not confirmed sightings at this beach."
    : hasWildlifeContext && wildlife?.sourceStatus === "published_reference"
      ? "Published coastal reference · not confirmed beach sightings"
      : "Published coastal references from the map, not confirmed sightings at this beach";
  const goMap = () => {
    const mapParams = new URLSearchParams(region ? { region } : {});
    if (location.state?.fromMarineMap) { mapParams.set('marine', 'on'); mapParams.set('beach', beachId); }
    nav('/map' + (mapParams.size ? '?' + mapParams.toString() : ''));
  };
  return (
    <main className="screen scroll-y coastal-screen beach-detail-screen">
      <header className={"coastal-beach-hero" + (!image && heroLat != null ? " has-map" : "")}>
        {image ? <img src={image} alt={b.name} /> : heroLat != null && heroLng != null && (
          <StaticMap lat={heroLat} lng={heroLng} zoom={12} focus={[0.72, 0.46]} reach={[640, 254]} />
        )}
        <div className="beach-hero-top">
          <BackButton dark onClick={goBack} />
          {image && fixture?.photoSource ? (
            <a href={fixture.photoSource} target="_blank" rel="noreferrer">
              {fixture.credit || "Photo source ↗"}
            </a>
          ) : (
            <span>
              {image ? fixture?.credit || b.name : heroLat != null ? "No photo yet · map © OpenStreetMap" : "No photo of this beach yet"}
            </span>
          )}
        </div>
        <div>
          <h1>{b.name}</h1>
          <p>{b.area} · Malaysia</p>
        </div>
      </header>
      <div className="coastal-page measure beach-body">
        <WhiteCard>
          <div className="beach-band-header">
            <p className="eyebrow">Litter Severity</p>
            <div className="beach-report-meta">
              <small>{b.validReports} active {b.validReports === 1 ? 'report' : 'reports'}</small>
              <small>{detail?.lastReportedAt ? 'Last reported ' + formatDate(detail.lastReportedAt) : (fixture?.reported ?? 'No recent report')}</small>
            </div>
          </div>
          <div
            className="beach-band-value"
            style={{
              color:
                attention.hasBand && band ? SEVERITY[band].text : "#586070",
            }}
          >
            <strong>
              {attention.hasBand && band ? severityLabel(band).toUpperCase() : "Insufficient Data"}
            </strong>
            {attention.hasBand && band && (
              <BandMeter
                level={
                  (detail?.band ??
                    ["Low", "Moderate", "High", "Severe"].indexOf(band) + 1) as
                    0 | 1 | 2 | 3 | 4
                }
                tone={
                  band.toLowerCase() as "low" | "moderate" | "high" | "severe"
                }
              />
            )}
          </div>
          {!attention.hasBand && (
            <p className="coastal-footnote">{attention.detail}</p>
          )}
          <div className="beach-rating-links">
          <button onClick={() => nav("/method")}>
            How It’s Rated →
          </button>
          <button onClick={() => nav('/insights/trends/' + beachId)}>
            See Changes Over Time →
          </button>
          </div>
        </WhiteCard>
        <section className="beach-nearby-marine" aria-label="Nearby marine life">
          <SectionHeading
            action="Species Guide →"
            onAction={() => nav("/marine-life")}
          >
            Nearby Marine Life
          </SectionHeading>

          <p className="subtle">
            {hasDocumentedHabitat
              ? `Habitat · ${detail?.habitat ?? fixture?.habitat}`
              : "Habitat · Not individually documented for this beach"}
          </p>
          {wildlifeLoading && !USE_MOCK && <p className="coastal-footnote" role="status">Loading available marine-life context…</p>}
          {wildlifeError && !USE_MOCK && (
            <DataUnavailable title="Marine life context temporarily unavailable" retry={() => { void refreshWildlife(); }}>
              Please retry to load the marine-life information for this beach.
            </DataUnavailable>
          )}
          {marineCards.length > 0 && (
            <div className="beach-marine-carousel" tabIndex={0} role="region" aria-label="Marine life photos, scroll to explore">
              {marineCards.map(item => (
                  <div className="wildlife-photo-card" key={item.id}>
                    <button onClick={() => nav(item.destination)}>
                      <SpeciesPicture image={item.image} name={item.name} />
                      <strong>{item.name}</strong>
                      {item.scientificName && item.scientificName !== item.name && <small><em>{item.scientificName}</em></small>}
                      {item.referencePlace && <small>Reference area · {item.referencePlace}</small>}
                    </button>
                    <div className="marine-source-labels">
                      {item.published && <span>Published reference</span>}
                      {item.modelled && <span className="model-source">OBIS · Modelled nearby</span>}
                    </div>
                    {item.image && (
                      <a href={item.creditsUrl} target="_blank" rel="noopener noreferrer">
                        Image credit & licence ↗
                      </a>
                    )}
                  </div>
              ))}
            </div>
          )}
          {!marineCards.length && !wildlifeLoading && !wildlifeError && <p className="coastal-footnote">Species information is currently unavailable for this beach. This does not mean marine life is absent.</p>}
          <p className="coastal-footnote">Coastal references and model estimates are not confirmed sightings.{USE_MOCK ? ' Preview · model results are not loaded.' : ''}</p>
          <div className="wildlife-evidence-actions">
            <button
              type="button"
              className="wildlife-evidence-help"
              aria-label="About Marine Life Evidence"
              title="About Marine Life Evidence"
              aria-haspopup="dialog"
              onClick={() => setShowWildlifeEvidenceInfo(true)}
            >
              ?
            </button>
            <button
              type="button"
              className="wildlife-evidence-link"
              onClick={() => nav(hasWildlifeContext ? "/insights/wildlife" : "/marine-area/" + region + "?beach=" + beachId)}
            >
              {hasWildlifeContext ? "Marine Life Sources ↗" : "Sources ↗"}
            </button>
          </div>
        </section>
        <section>
          <SectionHeading>What You Can Do Here</SectionHeading>
          <div className="action-grid" style={{ marginTop: 16 }}>
            <ActionTile
              title="Report Litter"
              subtitle="Take a photo"
              icon={<Camera color={C.navy} size={18} />}
              onClick={startReport}
            />
            <ActionTile
              title="Join Cleanup"
              subtitle={event ? "Choose an event" : "Find one nearby"}
              icon={<CommunityIcon color={C.navy} size={19} />}
              onClick={() => nav(event ? "/events/" + event.id : "/community")}
            />
            <ActionTile
              title="Log Cleanup"
              subtitle="What you cleared"
              icon={<Check color={C.navy} size={21} />}
              onClick={() =>
                previewOnly
                  ? setUnsupported(true)
                  : nav(cleanupDestination(beachId, linkedEvent))
              }
            />
          </div>
        </section>
        <section>
          <SectionHeading
            action="View All →"
            onAction={() => nav("/beach/" + beachId + "/gallery")}
          >
            Litter Gallery
          </SectionHeading>
          <p className="subtle">Public reports from this beach</p>
          {gallery.length ? (
            <div className="beach-gallery">
              {gallery.map((g) => (
                <button
                  key={g.reportId}
                  onClick={() => nav("/beach/" + beachId + "/gallery")}
                >
                  <img
                    src={litterGalleryPhotoUrl(g.photoUrl)}
                    alt="Reported beach litter"
                  />
                  <span>{formatDate(g.reportedAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="dashed-empty">No public report photos yet.</div>
          )}
        </section>
        <section className="beach-composition">
          <SectionHeading>Litter Composition</SectionHeading>
          {detail?.composition?.length ? (
            <WhiteCard>
              {detail.composition.map((c, i) => (
                <div key={c.category} className="composition-row">
                  <div>
                    <span>{c.category}</span>
                    <strong>{Math.round(c.percentage)}%</strong>
                  </div>
                  <i>
                    <b
                      style={{
                        width: c.percentage + "%",
                        background: i === 0 ? "#b8ff36" : "#5470a8",
                      }}
                    />
                  </i>
                </div>
              ))}
              <p className="coastal-footnote">
                {compositionFooter(detail.compositionSource)}
              </p>
            </WhiteCard>
          ) : (
            <div className="dashed-empty">
              Shown once counted reports list litter types.
            </div>
          )}
        </section>
        {cleanup && (
          <WhiteCard>
            <p className="eyebrow">Latest Recorded Cleanup</p>
            <h2>{formatDate(cleanup.createdAt)}</h2>
            {detail?.recurrence ? <RecurrenceEvidence evidence={detail.recurrence} embedded /> : (
              <p className="subtle">Recurrence is shown after a follow-up report is recorded.</p>
            )}
            <button
              style={{ marginTop: 14 }}
              onClick={() => nav("/cleanup/result/" + cleanup.id)}
            >
              View Recorded Change →
            </button>
          </WhiteCard>
        )}
        <GhostButton onClick={goMap}>Back to Map</GhostButton>
        {USE_MOCK && <p className="demo-label">Preview · example data</p>}
      </div>
      {showWildlifeEvidenceInfo && (
        <Sheet title="About Marine Life Evidence" onClose={() => setShowWildlifeEvidenceInfo(false)}>
          <p className="subtle" style={{ lineHeight: 1.65 }}>{wildlifeEvidenceNote}</p>
          <GhostButton onClick={() => setShowWildlifeEvidenceInfo(false)}>Close</GhostButton>
        </Sheet>
      )}
      {draftChoice && (
        <DraftChoiceDialog
          onCancel={() => setDraftChoice(false)}
          onResume={() => nav(resumePath(draft))}
          onStartNew={() => {
            setDraftChoice(false);
            beginReport();
          }}
        />
      )}
      {unsupported && (
        <Sheet
          title="Choose a Pilot Beach"
          onClose={() => setUnsupported(false)}
        >
          <p className="subtle">
            This beach is available to browse in the preview. Reporting and
            cleanup records are currently available for the four pilot beaches.
          </p>
          {content.beaches
            .filter((b) =>
              ["morib", "bagan", "remis", "kelanang"].includes(b.id),
            )
            .map((b) => (
              <LinkRow
                key={b.id}
                title={b.name}
                onClick={() => {
                  setUnsupported(false);
                  nav("/beach/" + b.id);
                }}
              />
            ))}
        </Sheet>
      )}
    </main>
  );
}
