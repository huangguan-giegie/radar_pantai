// One beach in full: the litter status, what the litter is made of, how the
// band was worked out, and what lives nearby.
//
// The order of the page is an argument. Status first, because that is why the
// user came. Then the evidence, then the method, then the wildlife that makes
// litter matter, and last the report button - by then the user has a reason.
//
// Litter data and biodiversity data are kept visibly apart all the way down.
// Volunteers measure one; the other is reference and modelled context. Mixing
// them would let a species score be read as something seen on this beach.
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { getBeach, getSpeciesDistribution, USE_MOCK } from '../api';
import { BeachCover } from '../components/BeachCover';
import { BeachCleanupCard } from '../components/BeachCleanupCard';
import { EcologicalBackgroundLink } from '../components/EcologicalBackgroundLink';
import { Camera, Check, ChevronRight, Clock, Info } from '../components/Icon';
import { BackButton, DraftChoiceDialog, ErrorNote, GhostButton, Label, PrimaryButton, Skeleton } from '../components/ui';
import { attentionStateFor, C, formatDate, freshnessLabel, freshStyle, MONO, NOISE, reportWord, SEVERITY, severityLabel } from '../theme';
import { BandMeter, Callout, GlassPanel, InfoChip } from '../components/ds';
import { useApp } from '../AppContext';
import type { BeachDetail, SpeciesDistributionResult } from '../types';
import { hasDraftProgress, resumePath } from '../flowRules';
import { getCleanupEvent, getCleanupTarget, getLatestCleanupForBeach } from '../iteration2';
import { fetchCleanupEvent, fetchCleanupTarget, fetchLatestCleanupForBeach } from '../iteration2Api';
import { SCORING_METHOD } from '../scoring';
import { SpeciesModelCards, speciesModelError, type SpeciesModelError } from '../components/SpeciesModelCards';
export { SpeciesModelCards, speciesModelError, decimalScoreLabel, locationMatchLabel } from '../components/SpeciesModelCards';
import { useAsyncData } from '../useAsyncData';
import { hasMapCoordinates } from '../mapGeometry';

// Location match compares reference locations for each species. The raw
// historical model score remains separate and is never shown as a probability.

// Bar colours for the composition rows. They only separate one row from the
// next - they carry no meaning, which is why they are deliberately NOT the four
// severity colours. Reusing those would suggest that a row is "severe".
const COMP_COLORS = ['#B8FF36', '#2C4A8C', '#5470A8', '#7A879B', '#98A4B5', '#CBD3E0'];

/*
 * The footer names the evidence behind the bars, because the live API
 * aggregates the active unresolved reports inside the scoring window while the
 * local mock still describes one report. Which method produced the shares is
 * ours to know, so the wording stays on the evidence and the date.
 */
export function compositionFooter(source: BeachDetail['compositionSource']): string {
  if (!source) return 'BACKEND CALCULATED';
  if (source.method === 'active_report_estimate') {
    return `${source.activeReportCount ?? 0} ACTIVE REPORTS · LAST ${source.windowDays ?? 90} DAYS`;
  }
  return source.createdAt ? `REPORT ${formatDate(source.createdAt).toUpperCase()}` : 'REPORT ESTIMATE';
}

/** Beach composition is an aggregate share, so it is always presented as a
 * percentage. Quantity bands remain on individual reports and cleanup flows. */
export function compositionPercentageLabel(percentage: number): string {
  return `${Math.max(0, Math.min(100, Math.round(percentage)))}%`;
}

export default function BeachScreen() {
  const { beachId = '' } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  // "Learn More" on the map's biodiversity layer asks for the species cards,
  // not the top of the page, so it arrives with focus: 'species'.
  const speciesRef = useRef<HTMLDivElement | null>(null);
  const { user, draft, resetDraft, patchDraft, setLastSavedReport } = useApp();
  const [b, setB] = useState<BeachDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDraftChoice, setShowDraftChoice] = useState(false);
  const [modelResult, setModelResult] = useState<SpeciesDistributionResult | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<SpeciesModelError | null>(null);
  const beachRequestId = useRef(0);
  const modelRequestId = useRef(0);
  const requestedEventId = new URLSearchParams(location.search).get('event');
  const { data: latestCleanup } = useAsyncData(
    () => fetchLatestCleanupForBeach(beachId),
    [beachId],
    getLatestCleanupForBeach(beachId),
  );
  const { data: cleanupTarget, loading: cleanupTargetLoading, error: cleanupTargetError, refresh: refreshCleanupTarget } = useAsyncData(
    () => fetchCleanupTarget(beachId),
    [beachId],
    getCleanupTarget(beachId),
  );
  const { data: linkedEvent } = useAsyncData(
    () => requestedEventId ? fetchCleanupEvent(requestedEventId) : Promise.resolve(null),
    [requestedEventId, user?.participantId],
    requestedEventId ? getCleanupEvent(requestedEventId) : null,
  );
  const canLinkReportToEvent = Boolean(
    user
      && linkedEvent
      && linkedEvent.beachId === beachId
      && linkedEvent.joined,
  );

  function loadSpecies(data: BeachDetail) {
    if (!hasMapCoordinates(data)) return;
    const requestId = ++modelRequestId.current;
    setModelLoading(true);
    setModelResult(null);
    setModelError(null);
    getSpeciesDistribution(data.lat, data.lng, { mode: 'nearby_marine', topK: 5 })
      .then((result) => {
        if (requestId === modelRequestId.current) setModelResult(result);
      })
      .catch((reason) => {
        if (requestId === modelRequestId.current) setModelError(speciesModelError(reason));
      })
      .finally(() => {
        if (requestId === modelRequestId.current) setModelLoading(false);
      });
  }

  function loadBeach() {
    const requestId = ++beachRequestId.current;
    ++modelRequestId.current;
    setLoading(true);
    setFailed(false);
    setLoadError(null);
    setB(null);
    setModelResult(null);
    setModelError(null);
    setModelLoading(false);
    getBeach(beachId)
      .then((data) => {
        if (requestId !== beachRequestId.current) return;
        setB(data);
        if (!USE_MOCK && hasMapCoordinates(data)) loadSpecies(data);
      })
      .catch((reason) => {
        if (requestId !== beachRequestId.current) return;
        setFailed(true);
        setLoadError(reason instanceof Error ? reason.message : 'Could not load this beach.');
      })
      .finally(() => {
        if (requestId === beachRequestId.current) setLoading(false);
      });
  }

  // beachId is in the dependency list, so moving between beaches refetches.
  // Retry calls the same loader, so the error state and the first load cannot
  // quietly drift into different behaviour.
  useEffect(() => {
    loadBeach();
    return () => {
      ++beachRequestId.current;
      ++modelRequestId.current;
    };
  }, [beachId]);

  // Scroll once the beach has loaded - before that the section does not exist
  // yet. scrollIntoView is skipped for anyone who has asked for reduced motion.
  useEffect(() => {
    if (!b || (location.state as { focus?: string } | null)?.focus !== 'species') return;
    const target = speciesRef.current;
    if (!target) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }, [b, location.state]);

  // Reporting from this page pre-fills the beach and its name, so the user
  // skips the location step for a beach they are already looking at.
  //
  // An unfinished draft is never thrown away without asking. If one exists the
  // user is offered it back, and Resume returns them to the furthest step they
  // had reached. Choosing Cancel starts a new report instead, which also has to
  // clear the last saved report: while that value is set the report routes send
  // the user to /reports, so a new report would bounce straight out of the flow
  // if it were left behind.
  const beginNewReport = () => {
    resetDraft();
    setLastSavedReport(null);
    patchDraft({
      beachId,
      beachName: b?.name ?? null,
      linkedEventId: canLinkReportToEvent ? linkedEvent!.id : null,
    });
    nav(user ? '/report/photo' : `/identity?next=${encodeURIComponent('/report/photo')}`);
  };

  const startReport = () => {
    if (hasDraftProgress(draft)) {
      setShowDraftChoice(true);
      return;
    }
    beginNewReport();
  };

  // A bad route and a lost connection are different recovery paths. The old
  // screen collapsed both into one sentence and offered neither a map exit nor
  // a retry.
  if (loading || !b) {
    const notFound = Boolean(loadError && /not found|could not be found/i.test(loadError));
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <div className="screen scroll-y" style={{ zIndex: 20 }}>
        <div className="pt-page measure" style={{ paddingInline: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <BackButton onClick={() => nav(-1)} />
          {failed ? (
            notFound ? (
              <div className="i2-card">
                <div style={{ fontSize: 17, fontWeight: 700, color: C.ink2 }}>Beach not found</div>
                <p style={{ margin: '7px 0 0', color: C.muted, fontSize: 13, lineHeight: 1.5 }}>
                  This link does not match a current beach.
                </p>
                <GhostButton onClick={() => nav('/map')} style={{ marginTop: 12 }}>Back to map</GhostButton>
              </div>
            ) : (
              <ErrorNote
                title={offline ? 'You seem to be offline' : 'Could not load this beach'}
                body={offline ? 'Reconnect, then retry this beach.' : 'The beach could not be loaded. Try the request again.'}
                onRetry={loadBeach}
              />
            )
          ) : (
            <>
              <Skeleton h={240} r={24} />
              <Skeleton h={120} r={24} />
              <Skeleton h={200} r={24} />
            </>
          )}
        </div>
      </div>
    );
  }

  // One shared helper decides whether a beach has earned a band, so this page,
  // the home list, the map markers and the confirm screen all draw that line in
  // the same place. sev stays null unless the helper agrees there is a band, so
  // a severity value that arrives with too few reports behind it still cannot
  // be shown as one.
  const attention = attentionStateFor(b.severity, b.insufficientData, b.validReports);
  const sev = attention.hasBand && b.severity ? SEVERITY[b.severity] : null;
  const fs = freshStyle(b.freshnessKind);
  const newestCountedAt = b.newestCountedReportAt
    ?? (b.latestContributingReportAt === undefined ? b.lastReportedAt : b.latestContributingReportAt);

  return (
    <div className="screen scroll-y" style={{ zIndex: 20 }}>
      {showDraftChoice && (
        <DraftChoiceDialog
          onResume={() => {
            setShowDraftChoice(false);
            nav(resumePath(draft));
          }}
          onStartNew={() => {
            setShowDraftChoice(false);
            beginNewReport();
          }}
        />
      )}

      <BeachCover coverImageUrl={b.coverImageUrl} scene={b.scene} alt={b.name} style={{ height: 300 }}>
        {/* The cover is a real photo when the backend has one. When it does
            not, the gradient the backend sends is used instead, so a beach
            looks the same everywhere in the app rather than getting a random
            placeholder per screen. The noise layer only goes on that gradient. */}
        {!b.coverImageUrl && (
          <div style={{ position: 'absolute', inset: 0, opacity: 0.32, backgroundImage: NOISE }} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(9,24,52,.35) 0%,transparent 30%,transparent 52%,rgba(9,22,48,.72) 100%)' }} />
        <BackButton dark onClick={() => nav(-1)} style={{ position: 'absolute', top: 'var(--top-inset)', left: 18, zIndex: 5 }} />

        {/* The title follows the reading column. On a wide window without this
            it would sit hard against the left edge while the content it
            introduces sits in the middle of the screen, hundreds of pixels
            away. The back button above is chrome and stays at the edge. */}
        <div className="measure" style={{ position: 'absolute', left: 20, right: 20, bottom: 52 }}>
          <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.2em', color: 'rgba(9,26,64,.8)', marginBottom: 8 }}>
            WEST COAST · {b.habitatTag}
          </div>
          <div style={{ fontSize: 33, fontWeight: 650, letterSpacing: '-.8px', color: C.bg, lineHeight: 1.05 }}>
            {b.name}
          </div>
          <div style={{ fontSize: 13.5, color: 'rgba(232,238,245,.8)', marginTop: 5 }}>
            {b.area} · Malaysia
          </div>
        </div>
      </BeachCover>



      {/* The status card, pulled up over the cover photo by the negative top
          margin. The width is set with calc() rather than the .measure class,
          because this card's 16px side margins are written inline and inline
          styles beat a stylesheet. On a phone calc(100% - 32px) is exactly the
          width it had before, so the phone layout did not change. */}
      <GlassPanel
        style={{
          margin: '-40px auto 0',
          width: 'calc(100% - 32px)',
          maxWidth: 'var(--measure)',
          position: 'relative',
          padding: 18,
          background: C.white,
        }}
      >
        {/* wrap, and let the left block shrink. "MODERATE" is the widest band
            word we render - 163px against HIGH's 76px, wider even than
            "SEVERE" - and next to a long freshness chip it used to push the
            chip column past the right edge of the phone, clipping "6 counted
            reports" to "6 counted repor". Wrapping drops the chips onto their
            own row instead of overflowing; minWidth 0 lets the band block give
            way first, because a flex item will not shrink below its content
            without it. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', rowGap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.16em', color: C.muted }}>
              LITTER SEVERITY
            </div>
            {/* A band, or an honest refusal to give one. Never a default and
                never a zero - both would read as "this beach is fine". The
                words of the refusal come from the shared helper, so this page
                and the map explain the gap in the same terms. */}
            {sev ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <div style={{ fontSize: 29, fontWeight: 750, letterSpacing: '.02em', color: sev.text }}>
                  {b.severity ? severityLabel(b.severity).toUpperCase() : null}
                </div>
                <BandMeter
                  level={(b.band ?? 0) as 0 | 1 | 2 | 3 | 4}
                  tone={b.severity?.toLowerCase() as 'low' | 'moderate' | 'high' | 'severe' | undefined}
                  style={{ paddingBottom: 4 }}
                />
              </div>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.2px', color: C.muted, marginTop: 6 }}>
                  {attention.pageLabel}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: C.muted, marginTop: 5, maxWidth: 250 }}>
                  {attention.detail}
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <InfoChip>
              {/* A tick only once the reports add up to a band. Beside a count
                  too small to band, the same tick would read as approval of a
                  beach nobody has measured enough. */}
              {attention.hasBand ? (
                <Check size={11} color={C.slate} strokeWidth={2.2} />
              ) : (
                <Info size={11} color={C.slate} strokeWidth={2.2} />
              )}
              {b.validReports} counted {reportWord(b.validReports)}
              {/* Below the minimum, say how far off a band is, in the chip
                  itself - "2 counted reports · 3 needed". Only while the count
                  really is short: a beach with enough reports but no band
                  (nothing recent) must not be told it needs more. */}
              {!attention.hasBand && b.validReports < SCORING_METHOD.minReports
                ? ` · ${SCORING_METHOD.minReports} needed`
                : null}
            </InfoChip>
            {/* The raw attention score is deliberately NOT shown. Epic 4's
                call: the public sees the band, not the number behind it. The
                value still arrives on BeachDetail and /method still publishes
                the whole rule, so the arithmetic is still checkable - you just
                cannot read one beach's score off its own page. No acceptance
                criterion asks for the number: AC4.1.2 asks for the band,
                AC4.2.4 lists count, date and freshness as the evidence
                context, and AC4.3.2 asks for the rule to be documented. Do not
                re-add this chip without asking Epic 4. */}
            <InfoChip color={fs.c} background={fs.bg}>
              <i style={{ width: 6, height: 6, borderRadius: 3, background: fs.dot, display: 'block' }} />
              {freshnessLabel(b.freshnessKind, newestCountedAt)}
            </InfoChip>
            <div style={{ maxWidth: 190, textAlign: 'right', fontFamily: MONO, fontSize: 8.5, letterSpacing: '.08em', color: C.dim, lineHeight: 1.45 }}>
              {newestCountedAt
                ? `NEWEST COUNTED · ${formatDate(newestCountedAt).toUpperCase()}`
                : `NO ACTIVE COUNTED REPORT · LAST ${SCORING_METHOD.windowDays} DAYS`}
            </div>
          </div>
        </div>

        {/* 'stale' covers two different situations (API.md section 4): nothing
            in 90 days, and never reported at all. They need different
            sentences. Without the split, a beach nobody has ever reported would
            be told how old its most recent report is - a report that does not
            exist. */}
        {b.freshnessKind === 'stale' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 14, padding: '11px 13px', borderRadius: 16, background: 'rgba(30,36,44,.05)', border: '1px solid rgba(30,36,44,.12)' }}>
            <Clock style={{ flex: 'none', marginTop: 1 }} />
            <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: C.muted }}>

              {b.lastReportedAt
                ? `No active counted report in the last ${SCORING_METHOD.windowDays} days — not a sign it’s clean.`
                : 'No counted report yet. That means unchecked, not clean.'}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => nav('/insights/trends/' + encodeURIComponent(beachId))}
          style={{ display: 'block', marginTop: 14, color: C.navy, fontSize: 12.5, fontWeight: 700, textAlign: 'left' }}
        >
          See Whether This Beach Improved or Worsened in the Last 30 Days →
        </button>
      </GlassPanel>

      <div className="measure" style={{ padding: '20px 16px calc(var(--safe-bottom) + 36px)', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* A question and one button, as in the Iteration 2 prototype. The
            cleanup screen itself shows which report and which bands are being
            confirmed, so repeating the report id here only added noise. */}
        <BeachCleanupCard
          target={cleanupTarget}
          loading={cleanupTargetLoading}
          error={cleanupTargetError}
          onCleanup={() => nav(user ? `/cleanup/${beachId}` : `/identity?next=${encodeURIComponent(`/cleanup/${beachId}`)}`)}
          onReport={startReport}
          onRetry={() => { void refreshCleanupTarget(); }}
        />

        <div>
          <Label style={{ marginBottom: 12 }}>LITTER COMPOSITION</Label>
          {/* What the litter is made of. The live API aggregates the active
              unresolved reports inside the 90-day window and the footer under
              the bars names that evidence, so the rows cannot be read as a
              physical measurement. How the share was computed (model or
              estimate) is ours to know, not the volunteer's, so it is not
              printed. The prototype shows a quantity band per row instead of a
              share; that needs the band in the beach response. */}
          {b.composition ? (
            <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 24, padding: 20, display: 'flex', flexDirection: 'column', gap: 11 }}>
              {b.composition.map((c, i) => (
                <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 88, flex: 'none', fontSize: 12.5, fontWeight: 620, color: C.ink2 }}>
                    {c.category}
                  </span>
                  <div style={{ flex: 1, height: 14, borderRadius: 7, background: 'rgba(11,33,97,.05)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, c.percentage))}%`,
                        height: '100%',
                        borderRadius: 7,
                        background: COMP_COLORS[i % COMP_COLORS.length],
                      }}
                    />
                  </div>
                  <span style={{ width: 44, flex: 'none', textAlign: 'right', fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.ink2 }}>
                    {compositionPercentageLabel(c.percentage)}
                  </span>
                </div>
              ))}
              <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: C.faint, marginTop: 4 }}>
                {compositionFooter(b.compositionSource)}
              </div>
            </div>
          ) : (
            /* No counted report yet. A dashed empty box, not a chart of
               zeroes: an empty chart still looks like a measurement. */
            <div style={{ border: '1.5px dashed rgba(11,33,97,.18)', borderRadius: 24, padding: 22, textAlign: 'center' }}>
              <div style={{ fontSize: 13.5, fontWeight: 640, color: C.muted }}>
                No counted report yet
              </div>

            </div>
          )}
        </div>

        {latestCleanup && (
          <Callout title="Cleanup recorded" tone="reassurance" icon={<Check color={C.green} />}>
            {/* Date first, as its own phrase: formatDate can answer "Today",
                which cannot follow "on". */}
            {formatDate(latestCleanup.createdAt)} · Cleanup score {latestCleanup.score} from the recorded quantity bands. Future reports help track conditions at this beach.
          </Callout>
        )}


        {/* The whole card is the link. It carries the three lines that matter
            most from the method, with a way through to the full page: somebody
            who has just read a band about their own beach should not have to go
            looking for how it was calculated. */}
        <button
          type="button"
          onClick={() => nav('/method')}
          className="press"
          style={{
            background: C.deep,
            borderRadius: 24,
            padding: 20,
            color: C.bg,
            position: 'relative',
            overflow: 'hidden',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', border: '1px solid rgba(184,255,54,.15)' }} />
          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.16em', color: C.dim }}>
            HOW THIS BAND IS CALCULATED
          </div>
          <div style={{ fontSize: 15.5, fontWeight: 650, marginTop: 9 }}>Same rule for every beach</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px solid rgba(255,255,255,.1)', marginTop: 13, paddingTop: 11 }}>

            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650, color: C.lime, whiteSpace: 'nowrap' }}>
              Full method <ChevronRight size={12} color={C.lime} strokeWidth={2.4} />
            </span>
          </div>
        </button>


        <div ref={speciesRef} id="species-model">
          <Label style={{ marginBottom: 12 }}>BIODIVERSITY NEARBY</Label>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.muted, margin: '-4px 0 12px' }}>
            Habitat · {b.habitat}
          </div>

          {hasMapCoordinates(b) ? (
            <SpeciesModelCards
              result={modelResult}
              loading={modelLoading}
              error={modelError}
              onRetry={() => loadSpecies(b)}
              scene={b.scene}
              preview={USE_MOCK}
            />
          ) : (
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.muted }}>
              Species information is unavailable until this beach's coordinates are verified.
            </div>
          )}

          <div style={{ marginTop: 16, background: C.tint, borderRadius: 20, padding: '16px 17px' }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.14em', color: C.slate }}>
              WHY LITTER MATTERS HERE
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: C.ink2, marginTop: 7 }}>
              {b.ecologicalNote}
            </div>
            {/* The shared link, so every beach points at the same approved
                Our World in Data chart with Malaysia selected. */}
            <EcologicalBackgroundLink />
          </div>

        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <PrimaryButton onClick={startReport}>
            <Camera size={16} strokeWidth={1.9} />
            Report Litter Here
          </PrimaryButton>
          {!cleanupTargetLoading && !cleanupTargetError && cleanupTarget && (
            <GhostButton onClick={() => nav(user ? `/cleanup/${beachId}` : `/identity?next=${encodeURIComponent(`/cleanup/${beachId}`)}`)}>
              Add a Cleanup
            </GhostButton>
          )}
          <GhostButton onClick={() => nav('/community')}>Community Cleanups</GhostButton>
          {/* With the other actions at the foot of the page, where the
              Iteration 2 prototype puts it - it is somewhere to go next, not
              part of the litter status the top of the page is about. */}
          <GhostButton onClick={() => nav(`/beach/${beachId}/gallery`)}>Litter gallery</GhostButton>
          <GhostButton onClick={() => nav('/map')}>Back to Map</GhostButton>
        </div>
      </div>
    </div>
  );
}
