import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Pin, ShieldCheck } from '../components/Icon';
import { Alert, InfoChip, SectionLabel } from '../components/ds';
import { BackButton, GhostButton, PrimaryButton } from '../components/ui';
import { useApp } from '../AppContext';
import { formatEventDate, formatEventTimeRange, getCleanupEvent, getCleanupTarget, type CheckInState } from '../iteration2';
import { fetchCleanupEvent, fetchCleanupTarget, recordCheckInData } from '../iteration2Api';
import { C } from '../theme';
import { useAsyncData } from '../useAsyncData';
import { CoastalPage, DataUnavailable, Sheet } from '../components/CoastalUI';
import { useAppBack } from '../navigation';
import { eventCanCheckIn, eventPhase, useEventClock } from '../eventAvailability';
import { iteration3Request } from '../iteration3Api';
import type { WildlifeGuidance } from '../iteration3Personal';

/** The grey shield banner: one short line about what check-in does or asks. */
function ShieldBanner({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 15, border: `1px solid ${C.line2}`, background: C.tint, color: C.slate, fontSize: 12.5, fontWeight: 650, lineHeight: 1.4 }}>
      <ShieldCheck size={15} color={C.green} style={{ flex: 'none' }} />
      <span>{children}</span>
    </div>
  );
}

export default function CheckInScreen() {
  const { eventId = '' } = useParams();
  const nav = useNavigate();
  const back = useAppBack(`/events/${encodeURIComponent(eventId)}`);
  const now = useEventClock();
  const { user } = useApp();
  const { data: wildlife } = useAsyncData(() => iteration3Request<WildlifeGuidance>('/wildlife-guidance'), [], null);
  const { data: event, setData: setEvent, loading, error, refresh } = useAsyncData(
    () => fetchCleanupEvent(eventId),
    [eventId, user?.participantId],
    getCleanupEvent(eventId),
  );
  const { data: cleanupTarget } = useAsyncData(
    () => event ? fetchCleanupTarget(event.beachId) : Promise.resolve(null),
    [event?.beachId],
    event ? getCleanupTarget(event.beachId) : null,
  );
  const initial = user && event ? (event.checkedIn ? 'within_area' : 'idle') : 'idle';
  const [state, setState] = useState<CheckInState>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [reminder, setReminder] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    request.current += 1;
    setMessage(null);
    setReminder(false);
    return () => { request.current += 1; };
  }, [eventId, user?.participantId]);

  useEffect(() => {
    if (user && event) setState(event.checkedIn ? 'within_area' : 'idle');
  }, [event, user]);

  function checkIn() {
    if (!event || !user || state === 'checking') return;
    if (!eventCanCheckIn(event)) {
      setMessage('Check-in is available during the event.');
      return;
    }
    if (!event.joined) {
      setMessage('Join this activity before checking in.');
      return;
    }
    if (!navigator.geolocation) {
      setState('denied');
      setMessage('Location is not available on this device. Attendance remains Not recorded.');
      return;
    }
    setState('checking');
    setMessage(null);
    const currentRequest = ++request.current;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (currentRequest !== request.current) return;
        if (!eventCanCheckIn(event)) {
          setState('idle');
          setMessage('Check-in is available during the event.');
          return;
        }
        const current = { lat: position.coords.latitude, lng: position.coords.longitude };
        try {
          const updated = await recordCheckInData(event.id, user.participantId, current);
          if (currentRequest !== request.current) return;
          setEvent(updated);
          setState(updated.checkedIn ? 'within_area' : 'idle');
          if (updated.attendanceConfirmed) setReminder(true);
        } catch (reason) {
          if (currentRequest !== request.current) return;
          setState('denied');
          setMessage(reason instanceof Error ? reason.message : 'Check-in could not be recorded.');
        }
      },
      (failure) => {
        if (currentRequest !== request.current) return;
        setState('denied');
        // Say "refused" only when the browser says the person refused. A
        // timeout or a weak signal is not a refusal, and telling someone they
        // said no when they did not sends them to the wrong setting.
        setMessage(failure.code === failure.PERMISSION_DENIED
          ? 'Location permission was refused.'
          : 'Location was not available. Retry when you are ready.');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  if (loading && !event) return <CoastalPage title="Check In" back="/community" tabs={false}><div role="status">Loading check-in…</div></CoastalPage>;
  if (!event || !user) return <CoastalPage title="Check In" back="/community" tabs={false}><DataUnavailable title="Check-in unavailable" retry={error ? () => void refresh() : undefined}>{error ?? 'This activity could not be found.'}</DataUnavailable></CoastalPage>;
  const available = eventCanCheckIn(event, now);
  const joined = Boolean(event.joined);
  const attendanceRecorded = Boolean(event.attendanceConfirmed);
  const withinArea = state === 'within_area';
  const readyToConfirm = false;
  // Anything short of a recorded check-in keeps the location button up.
  const needsLocation = available && !withinArea && !attendanceRecorded;
  // A refused or failed location attempt explains itself inside the status
  // card, so the same sentence is not repeated in a second alert below.
  const messageInStatus = state === 'denied' && Boolean(message);
  // The prototype lists "Confirmed you were there" before the report or
  // cleanup. The backend refuses attendance until a linked report or cleanup
  // exists (EVENT_EVIDENCE_REQUIRED), so the list keeps the order that works.
  const attendanceSteps = [
    ['Joined this event', joined],
    ['Near the beach on the day', withinArea],
    ['Attendance recorded automatically', attendanceRecorded],
  ] as const;

  const statusTitle = state === 'checking'
    ? 'Checking the beach area…'
    : withinArea
      ? 'Checked in'
      : state === 'outside_area'
        ? 'Outside the beach area'
        : state === 'denied'
          ? 'Check-in did not happen'
          : 'Check in on the event day';
  const reportHere = () => nav(`/beach/${event.beachId}?event=${encodeURIComponent(event.id)}`);
  const cleanUpHere = () => nav(`/cleanup/${event.beachId}?event=${encodeURIComponent(event.id)}`);

  return (
    <div className="screen scroll-y" style={{ zIndex: 26 }}>
      {reminder && <Sheet title="Two Quick Reminders" onClose={() => setReminder(false)}>{(wildlife?.reminder ?? ['Do not handle stranded or entangled animals', 'Keep away from nests and burrows']).map((tip, index) => <div key={tip} className="wildlife-rule"><span>{index + 1}</span><p>{tip}</p></div>)}<PrimaryButton onClick={() => setReminder(false)}>Understood</PrimaryButton></Sheet>}
      <div className="measure i2-page anim-fade-up" style={{ paddingBottom: 'calc(var(--safe-bottom) + 34px)' }}>
        <BackButton onClick={back} />
        <div>
          <SectionLabel size="sm">CHECK IN</SectionLabel>
          <h1 className="i2-title" style={{ marginTop: 7 }}>{readyToConfirm ? 'Confirm attendance' : 'Check in'}</h1>
        </div>

        <div className="i2-card i2-event-strip">
          <div>
            <strong>{event.beachName} cleanup</strong>
            {/* Styled here: the strip's stylesheet rule only reaches a span
                nested in a span, so this line was rendering at body size. */}
            <span style={{ display: 'block', marginTop: 4, color: C.muted, fontSize: 11.5, lineHeight: 1.4 }}>
              {formatEventDate(event.date)} · {formatEventTimeRange(event.startsAt, event.endsAt)}
            </span>
          </div>
          <InfoChip color={joined ? C.green : C.muted} background={joined ? C.greenBg : undefined}>{joined ? 'Joined' : 'Not joined'}</InfoChip>
        </div>

        {readyToConfirm ? (
          <ShieldBanner>You were near the beach. Confirm you took part.</ShieldBanner>
        ) : (
          <div className={`i2-checkin-status${withinArea ? ' is-success' : ''}`}>
            <span className="i2-checkin-icon">
              {withinArea ? <Check size={22} color={C.navy} /> : <Pin size={22} color={C.navy} />}
            </span>
            <div>
              <strong>{statusTitle}</strong>
              <span>
                {withinArea
                  ? 'Near this beach · exact location not kept'
                  : messageInStatus
                    ? message
                    : 'Only a broad beach-area result is kept.'}
              </span>
            </div>
          </div>
        )}

        {attendanceRecorded && (
          <div className="i2-confirmed-row"><Check size={15} color={C.green} /><strong>Attendance confirmed</strong></div>
        )}

        {!available && !attendanceRecorded && <Alert tone="caution">{eventPhase(event, now) === 'upcoming' ? 'Check-in opens when the event starts.' : 'This activity is no longer open for check-in.'}</Alert>}
        {needsLocation && (
          <>
            <PrimaryButton onClick={checkIn} disabled={state === 'checking'}>
              {state !== 'checking' && <Pin size={16} color={C.lime} />}
              {state === 'checking' ? 'Checking…' : state === 'idle' ? 'Check in — use my location' : 'Try location again'}
            </PrimaryButton>
            <ShieldBanner>Checking in only shows you were near the beach.</ShieldBanner>
          </>
        )}

        <div className="i2-card">
          <SectionLabel size="sm">RECORDED ATTENDANCE NEEDS</SectionLabel>
          <div className="i2-step-list">
            {attendanceSteps.map(([label, done]) => (
              <div className="i2-step" key={label}>
                <span className="i2-step-index" data-done={done}>{done ? <Check size={13} /> : '○'}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <InfoChip color={attendanceRecorded ? C.green : C.muted} background={attendanceRecorded ? C.greenBg : undefined} style={{ marginTop: 12 }}>
            {attendanceRecorded
              ? 'Recorded attendance'
              : 'Attendance is recorded automatically after a successful check-in'}
          </InfoChip>
        </div>

        {message && !messageInStatus && <Alert title="Check-in not completed" tone="caution">{message}</Alert>}

        <div className="i2-action-stack">
          {available && withinArea && !attendanceRecorded ? (
            <>
              {cleanupTarget ? (
                <PrimaryButton onClick={cleanUpHere}>Add a Cleanup</PrimaryButton>
              ) : (
                <PrimaryButton onClick={reportHere}>Report litter here</PrimaryButton>
              )}
              {cleanupTarget && <GhostButton onClick={reportHere}>Report litter here instead</GhostButton>}
            </>
          ) : attendanceRecorded ? (
            <PrimaryButton onClick={back}>Back to event</PrimaryButton>
          ) : available && joined && state !== 'checking' ? (
            // A report or cleanup counts for the event whether or not location
            // works, so both stay on offer before and after a location attempt.
            <>
              {cleanupTarget && <GhostButton onClick={cleanUpHere}>Add a Cleanup</GhostButton>}
              <GhostButton onClick={reportHere}>Report litter here instead</GhostButton>
            </>
          ) : null}
          {!attendanceRecorded && <GhostButton onClick={back}>Back to activity</GhostButton>}
        </div>
        <p style={{ margin: 0, textAlign: 'center', color: C.dim, fontSize: 11 }}>Being nearby is not proof of a cleanup.</p>
      </div>
    </div>
  );
}
