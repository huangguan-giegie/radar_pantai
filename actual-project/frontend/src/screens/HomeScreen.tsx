import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getBeach, getBeaches, USE_MOCK } from "../api";
import { useApp } from "../AppContext";
import { Camera, Check, CommunityIcon, UserIcon } from "../components/Icon";
import {
  CoastalPage,
  WhiteCard,
  ActionTile,
  DataUnavailable,
  Sheet,
  LinkRow,
} from "../components/CoastalUI";
import {
  DraftChoiceDialog,
  GhostButton,
  PrimaryButton,
  Skeleton,
} from "../components/ui";
import { SeverityBadge } from "../components/ds";
import { hasDraftProgress, resumePath } from "../flowRules";
import { fetchInsights } from "../insightsApi";
import { useAsyncData } from "../useAsyncData";
import { C } from "../theme";
import { iteration3Request } from "../iteration3Api";
import { fallbackNextAction, type NextAction } from "../iteration3Personal";
import { PHOTOS } from "../visuals";
import { closestSupportedBeach } from "../homeNearby";
import type { BeachSummary } from "../types";

export default function HomeScreen() {
  const nav = useNavigate();
  const {
    user,
    draft,
    resetDraft,
    patchDraft,
    setLastSavedReport,
    reportsVersion,
  } = useApp();
  const [draftChoice, setDraftChoice] = useState(false);
  const [pendingReport, setPendingReport] = useState<NextAction['destination'] | null>(null);
  const [chooseCleanupBeach, setChooseCleanupBeach] = useState(false);
  const [nearbyBeachId, setNearbyBeachId] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const { data: loadedAction } = useAsyncData(
    () => USE_MOCK
      ? Promise.resolve(fallbackNextAction(Boolean(user)))
      : iteration3Request<NextAction>('/recommendations/next-action'),
    [user?.participantId, reportsVersion], null,
  );
  const nextAction = user ? loadedAction ?? fallbackNextAction(true) : fallbackNextAction(false);
  const {
    data: beaches,
    loading,
    error,
    refresh,
  } = useAsyncData(getBeaches, [reportsVersion], []);
  useEffect(() => {
    if (USE_MOCK || !beaches.length) return;
    const timer = window.setTimeout(() => { void fetchInsights(); }, 250);
    return () => window.clearTimeout(timer);
  }, [beaches.length, reportsVersion]);
  // Never store or transmit precise GPS coordinates. Only the selected beach ID
  // stays in component state until this page is unmounted.
  const locateNearest = (catalogue: BeachSummary[]) => {
    if (!navigator.geolocation) {
      setLocationMessage("Location is not supported by this browser.");
      return;
    }
    setLocating(true);
    setLocationMessage("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const closest = closestSupportedBeach(catalogue, { lat: coords.latitude, lng: coords.longitude });
        setNearbyBeachId(closest?.id ?? null);
        setLocationMessage(closest ? "" : "No beaches with verified coordinates are available.");
        setLocating(false);
      },
      (reason) => {
        setLocating(false);
        setLocationMessage(reason.code === 1 ? "Location access declined. Showing the featured beach." : "Unable to get your location. Showing the featured beach.");
      },
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 },
    );
  };
  useEffect(() => {
    if (!beaches.length || !navigator.permissions?.query || !navigator.geolocation) return;
    let cancelled = false;
    navigator.permissions.query({ name: "geolocation" }).then(permission => {
      if (!cancelled && permission.state === "granted") locateNearest(beaches);
    }).catch(() => {});
    return () => { cancelled = true; };
    // Permission discovery is tied only to the beach catalogue, not each render.
  }, [beaches]);
  const beach = beaches.find((b) => b.id === nearbyBeachId)
    ?? beaches.find((b) => b.id === "morib") ?? beaches[0];
  const { data: detail } = useAsyncData(
    () => (beach ? getBeach(beach.id) : Promise.resolve(null)),
    [beach?.id, reportsVersion],
    null,
  );
  const dominant = detail?.composition
    ?.slice()
    .sort((a, b) => b.percentage - a.percentage)[0];
  const beginReport = (destination?: NextAction['destination']) => {
    resetDraft();
    setLastSavedReport(null);
    const target = beaches.find(item => item.id === destination?.beachId);
    if (target) patchDraft({ beachId: target.id, beachName: target.name, locationSource: 'manual', coords: null });
    nav(destination?.path ?? "/report/photo");
  };
  const exploreBeaches = () => nav("/map?panel=beaches", { state: { fromHome: true } });
  const nextStep = () => {
    if (nextAction.destination.type === 'report') {
      if (hasDraftProgress(draft)) { setPendingReport(nextAction.destination); setDraftChoice(true); return; }
      beginReport(nextAction.destination);
      return;
    }
    nav(nextAction.destination.path);
  };
  const nextActionCard = <section className="home-next-step" aria-label="Next Action">
    <div><p className="eyebrow">Next Action</p><h2>{nextAction.actionLabel}</h2><p className="subtle">{nextAction.reason}</p></div>
    <PrimaryButton height={44} onClick={nextStep} trailingArrow style={{ width: 'auto', maxWidth: 155, padding: '10px 14px', fontSize: 12, boxShadow: 'none' }}>{nextAction.actionLabel}</PrimaryButton>
  </section>;
  const h = new Date().getHours();
  return (
    <CoastalPage className="design-home">
      {draftChoice && (
        <DraftChoiceDialog
          onCancel={() => { setDraftChoice(false); setPendingReport(null); }}
          onResume={() => nav(resumePath(draft))}
          onStartNew={() => {
            setDraftChoice(false);
            beginReport(pendingReport ?? undefined);
            setPendingReport(null);
          }}
        />
      )}
      {chooseCleanupBeach && (
        <Sheet title="Where did you clean?" onClose={() => setChooseCleanupBeach(false)}>
          {loading ? <Skeleton h={160} /> : error ? (
            <DataUnavailable title="Could not load beaches" retry={() => void refresh()}>{error}</DataUnavailable>
          ) : beaches.length ? beaches.map((item) => (
            <LinkRow key={item.id} title={item.name} subtitle={item.area} onClick={() => nav("/cleanup/" + item.id)} />
          )) : <DataUnavailable title="No beaches available" />}
        </Sheet>
      )}
      <header className="home-header">
        <div>
          <p>
            {h < 12
              ? "Good morning,"
              : h < 18
                ? "Good afternoon,"
                : "Good evening,"}
          </p>
          <h1>{user ? "Participant " + user.participantId : "Anonymous"}</h1>
        </div>
        <button
          className="icon-button navy"
          onClick={() => nav("/account")}
          aria-label="Account"
        >
          <UserIcon size={28} color="white" />
        </button>
      </header>
      {!loading && (!beach || error) && <WhiteCard>{nextActionCard}</WhiteCard>}
      {!loading && (!beach || error) && (
        <GhostButton height={44} onClick={exploreBeaches}>
          Explore Beaches
        </GhostButton>
      )}
      <div className="action-grid">
        <ActionTile
          title="Report Litter"
          subtitle="Take a photo"
          icon={<Camera color={C.navy} size={18} />}
          onClick={() => {
            if (hasDraftProgress(draft)) { setPendingReport(null); setDraftChoice(true); }
            else beginReport();
          }}
        />
        <ActionTile
          title="Join Cleanup"
          subtitle="Choose an event"
          icon={<CommunityIcon color={C.navy} size={19} />}
          onClick={() => nav("/community")}
        />
        <ActionTile
          title="Log Cleanup"
          subtitle="What you cleared"
          icon={<Check color={C.navy} size={21} />}
          onClick={() => setChooseCleanupBeach(true)}
        />
      </div>
      {loading && !beach ? (
        <div>
          <Skeleton h={280} />
          <GhostButton height={44} style={{ marginTop: 14 }} onClick={exploreBeaches}>Explore Beaches</GhostButton>
        </div>
      ) : error ? (
        <DataUnavailable
          title="Could not load beaches"
          retry={() => void refresh()}
        >
          {error}
        </DataUnavailable>
      ) : beach ? (
        <section className="home-beach-card">
          <div className="home-beach-photo" style={{ background: beach.scene }}>
            {(beach.coverImageUrl || beach.id === "morib") && (
              <img
                src={beach.coverImageUrl || "/home/pantai-morib.jpg"}
                alt={beach.name}
              />
            )}
            <div className="home-beach-overlay">
              <span className="photo-pill">{nearbyBeachId ? "Nearest Beach to You" : "Featured Beach"}</span>
              <div className="home-place">{beach.name}</div>
              <small>{beach.area}</small>
              <div className="home-band">
                <SeverityBadge
                  band={beach.insufficientData ? null : beach.severity}
                />
                {dominant && (
                  <small>
                    Mostly {dominant.category.toLowerCase()} ·{" "}
                    {Math.round(dominant.percentage)}%
                  </small>
                )}
              </div>
            </div>
          </div>
          <div className="home-beach-body">
            <button type="button" className="home-location-button" onClick={() => locateNearest(beaches)} disabled={locating}>
              {locating ? "Finding Nearest Beach…" : nearbyBeachId ? "Update Nearby Beach" : "Find Nearest Beach"}
            </button>
            {locationMessage && <p className="coastal-footnote" role="status">{locationMessage}</p>}
            {nextActionCard}
            <div className="button-pair">
              <GhostButton height={44} onClick={exploreBeaches}>
                See Other Beaches
              </GhostButton>
              <GhostButton
                height={44}
                onClick={() => nav("/beach/" + beach.id)}
              >
                View Beach Details
              </GhostButton>
            </div>
          </div>
        </section>
      ) : (
        <DataUnavailable title="No beaches available" />
      )}
      <button
        className="marine-banner press"
        onClick={() => nav("/marine-life")}
      >
        <img
          src="/images/coastal/marine-life-feedback.png"
          alt="Green sea turtle swimming underwater"
        />
        <div>
          <strong>
            Discover
            <br />
            Marine Life
          </strong>
          <span>Explore marine biodiversity →</span>
        </div>
      </button>
      <WhiteCard>
        <p className="eyebrow">Marine life needs space too</p>
        <h2>Found a hurt or stranded animal?</h2>
        <p className="subtle">
          Keep your distance and use the official marine life contacts before you
          continue a cleanup.
        </p>
        <GhostButton onClick={() => nav("/community/wildlife-help")}>
          Find Help Contacts
        </GhostButton>
      </WhiteCard>
      <WhiteCard>
        <figure className="page-cover card-cover">
          <img src={PHOTOS.moribDusk} alt="Morib Beach at dusk" loading="lazy" />
          <figcaption>Morib Beach · Ajayrb135 · CC BY-SA 4.0</figcaption>
        </figure>
        <h2>About Us</h2>
        <p className="subtle">
          Connect beach litter reports, marine biodiversity awareness and
          community cleanups. Learn about our purpose and SDG goals.
        </p>
        <PrimaryButton
          style={{ marginTop: 14 }}
          onClick={() => nav("/about")}
          trailingArrow
        >
          Read About Us
        </PrimaryButton>
      </WhiteCard>
      {USE_MOCK && <p className="demo-label">Preview · example data</p>}
    </CoastalPage>
  );
}
