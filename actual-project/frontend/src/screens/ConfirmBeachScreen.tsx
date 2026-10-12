// Confirm which beach this report is about.
//
// Two faces, picked at render time: GPS worked, so offer that one beach to
// accept; anything else, so show a searchable list of every supported beach.
// A person always confirms, GPS only suggests. A wrong beach does not just
// spoil one report - it feeds the litter status we publish for that beach.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBeaches } from '../api';
import { MiniMap } from '../components/MiniMap';
import { Alert, Check, Pin, Search } from '../components/Icon';
import { BackButton, ErrorNote, PrimaryButton, Skeleton, StepBadge, TextButton } from '../components/ui';
import { attentionStateFor, C, MONO } from '../theme';
import { OverlayChip, SeverityBadge } from '../components/ds';
import { useApp } from '../AppContext';
import type { BeachSummary } from '../types';
import type { ReportDraft } from '../AppContext';
import { useAppBack } from '../navigation';
import { hasMapCoordinates } from '../mapGeometry';

/**
 * What to say when locating did not work out. Six causes get six sentences:
 * one shared "permission was declined" line used to send people who had
 * refused nothing hunting through their browser settings. Every line names the
 * problem and then points at the list, so nobody is left at a dead end.
 */
const GPS_MESSAGE: Record<NonNullable<ReportDraft['gpsIssue']>, string> = {
  denied: 'Location permission was declined — choose your beach below.',
  unavailable: "Your device couldn't provide a location — choose your beach below.",
  timeout: 'Locating took too long — choose your beach below.',
  inaccurate: 'The location was too rough to pick a beach from — choose it below.',
  noBeach: 'No supported beach within 25 km — choose the closest one below.',
  failed: "Couldn't check your location just now — choose your beach below.",
};

export default function ConfirmBeachScreen() {
  const nav = useNavigate();
  const back = useAppBack('/report/location');
  const { draft, patchDraft } = useApp();
  const [beaches, setBeaches] = useState<BeachSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  function loadBeaches() {
    setLoading(true);
    setFailed(false);
    getBeaches()
      .then((list) => setBeaches(list))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }

  useEffect(loadBeaches, []);
  const [query, setQuery] = useState('');

  // The beach GPS suggested, looked up in the list we just loaded. It can be
  // null even after a good fix - a failed list leaves no name to show.
  const suggested = beaches.find((b) => b.id === draft.beachId) || null;

  // Which face to show. The `|| !suggested` earns its keep: with nothing to
  // display we fall back to the list instead of an empty confirmation card.
  const manual = draft.locationSource !== 'gps' || !hasMapCoordinates(suggested);

  // Search by name or by area, because a volunteer may know "Banting" without
  // knowing which beach sits there. Filtering stays in the browser.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? beaches.filter(
        (b) => b.name.toLowerCase().includes(q) || b.area.toLowerCase().includes(q),
      )
    : beaches;

  const located = hasMapCoordinates(draft.coords) ? draft.coords : hasMapCoordinates(suggested) ? suggested : null;
  const center = located ?? { lat: 4.05, lng: 109.5 };

  return (
    <div className="screen" style={{ zIndex: 26, background: C.cloud, overflow: 'hidden' }}>
      {/* Missing beach coordinates keep a broad navigation view. They never
          become an invented beach location. */}
      <MiniMap lat={center.lat} lng={center.lng} zoom={located ? manual ? 9 : 12 : 4} />

      {/* Above Leaflet's own layers, which occupy 400 to 700. */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 800, background: 'linear-gradient(180deg,rgba(221,227,236,.3) 0%,transparent 30%,rgba(12,28,58,.4) 100%)', pointerEvents: 'none' }} />

      {/* Tapping the map behind the sheet leaves, exactly like Back. This map is
          not interactive (see MiniMap), so the layer costs nothing - and without
          it the only way out of the sheet was the small back button. */}
      <div onClick={back} aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 810 }} />

      <BackButton
        onClick={back}
        style={{ position: 'absolute', top: 'var(--top-inset)', left: 18, zIndex: 820, background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(10px)' }}
      />
      <div style={{ position: 'absolute', top: 'var(--top-inset)', right: 18, zIndex: 820 }}><StepBadge>STEP 3 OF 6 · BEACH</StepBadge></div>
      <OverlayChip
        tone="light"
        style={{ position: 'absolute', top: 'var(--top-inset)', left: '50%', transform: 'translateX(-50%)', zIndex: 820 }}
      >
        {/* Says how this report was located. The same wording turns up on the
            review screen, so the user always knows what they are attesting to. */}
        {manual ? 'MANUAL BEACH SELECTION' : 'GPS USED ONCE · PRIVATE'}
      </OverlayChip>

      <div
        className="anim-sheet-up measure"
        style={{ position: 'absolute', left: 16, right: 16, bottom: 'calc(var(--safe-bottom) + 28px)', zIndex: 820 }}
      >
        {draft.gpsIssue && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              background: 'rgba(217,162,75,.95)',
              borderRadius: 16,
              padding: '12px 14px',
              marginBottom: 10,
              boxShadow: '0 14px 30px -12px rgba(90,60,20,.5)',
            }}
          >
            <Alert size={15} color="#4A3208" strokeWidth={2} />
            <div style={{ fontSize: 12.5, fontWeight: 640, color: '#3D2A08', lineHeight: 1.4 }}>
              {GPS_MESSAGE[draft.gpsIssue]}
            </div>
          </div>
        )}

        <div
          style={{
            background: 'rgba(255,255,255,.94)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,.8)',
            borderRadius: 28,
            padding: 22,
            boxShadow: '0 30px 60px -20px rgba(9,24,52,.5)',
          }}
        >
          {!manual && suggested ? (
            <>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.16em', color: C.dim }}>
                SUGGESTED FROM YOUR LOCATION
              </div>
              <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-.4px', marginTop: 8 }}>
                Is this the correct beach?
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 20,
                  background: C.tint,
                  border: `1px solid ${C.line}`,
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 16, background: 'linear-gradient(160deg,#4E9EC9,#1C4A85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Pin color={C.lime} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16.5, fontWeight: 650 }}>{suggested.name}</div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>{suggested.area}</div>
                </div>
                {/* Never show a band we have not earned. attentionStateFor
                    hands one back only once a beach has enough active reports;
                    below that the badge reads "Insufficient data". The map and
                    the beach page call the same function, so a beach cannot
                    look rated here and unrated there. */}
                <SeverityBadge
                  band={attentionStateFor(suggested.severity, suggested.insufficientData, suggested.validReports).hasBand ? suggested.severity : null}
                  label={attentionStateFor(suggested.severity, suggested.insufficientData, suggested.validReports).pageLabel}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 16 }}>
                <PrimaryButton onClick={() => nav(draft.editingReportId && !draft.photo ? '/report/details' : '/report/suggestions')} height={54} style={{ borderRadius: 17, boxShadow: 'none' }}>
                  <Check />
                  Yes, Confirm
                </PrimaryButton>
                {/* Rejecting the suggestion drops the coordinates as well as
                    the beach: if the GPS answer was wrong, the fix behind it
                    proves nothing and would only confuse the backend's
                    duplicate check. It does not navigate - clearing beachId
                    re-renders this screen as the list, which is why the flow
                    guard reads a missing beach as 'confirm' and not 'location'. */}
                <TextButton
                  onClick={() =>
                    patchDraft({ locationSource: 'manual', coords: null, beachId: null, beachName: null })
                  }
                >
                  Choose Another Beach
                </TextButton>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-.4px' }}>Choose Your Beach</div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  marginTop: 12,
                  padding: '12px 14px',
                  borderRadius: 15,
                  background: C.tint,
                  border: `1px solid ${C.line}`,
                }}
              >
                <Search />
                {/* The placeholder is the prototype's plain "Search beaches".
                    It only turns into a status line when the list failed to
                    load, so nobody types into a search that cannot answer. */}
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={failed ? 'Beach list unavailable' : 'Search beaches'}
                  style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13.5, color: C.ink }}
                />
              </div>
              {/* The list scrolls inside the card. The cap is in vh as well as
                  px so the sheet still fits on a short screen. */}
              <div className="scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, maxHeight: 'min(340px, 42vh)' }}>
                {loading && <Skeleton h={58} r={16} />}
                {filtered.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      patchDraft({ beachId: b.id, beachName: b.name, locationSource: 'manual', coords: null });
                      nav(draft.editingReportId && !draft.photo ? '/report/details' : '/report/suggestions');
                    }}
                    className="chip-hover"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '12px 13px',
                      borderRadius: 16,
                      border: '1px solid transparent',
                      width: '100%',
                    }}
                  >
                    <div style={{ width: 34, height: 34, borderRadius: 12, background: 'rgba(11,33,97,.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Pin size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 640 }}>{b.name}</div>
                      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 3 }}>{b.area}</div>
                    </div>
                    <SeverityBadge
                      band={attentionStateFor(b.severity, b.insufficientData, b.validReports).hasBand ? b.severity : null}
                      label={attentionStateFor(b.severity, b.insufficientData, b.validReports).pageLabel}
                    />
                  </button>
                ))}
                {/* "Your photo is safe" is the sentence that matters here. The
                    photo is already uploaded, and the first fear on seeing an
                    error is having to shoot it again. */}
                {!loading && failed && (
                  <ErrorNote
                    title="Couldn't load the beach list"
                    body="Your photo is safe — this is just the connection."
                    onRetry={loadBeaches}
                  />
                )}
                {/* Empty because the search matched nothing, or because there is
                    genuinely nothing to show - two different messages. */}
                {!loading && !failed && filtered.length === 0 && (
                  <div style={{ fontSize: 12.5, color: C.dim, padding: '10px 4px' }}>
                    {q ? `No supported beach matches “${query}”.` : 'No beaches available right now.'}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 8, textAlign: 'center' }}>
                Selecting a beach confirms your report location.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
