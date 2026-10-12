import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getIteration2SharedItems, iteration2SharedPhotoUrl } from '../api';
import { EmptyState, SectionLabel } from '../components/ds';
import { BackButton, GhostButton, PrimaryButton } from '../components/ui';
import { sharedBandRows } from '../sharedReportPresentation';
import { C, formatDate } from '../theme';
import type { QuantityByCategory } from '../types';
import { useAppBack } from '../navigation';

type SharedItems = {
  event: {
    id: string; beachId: string; beachName: string; area: string; date: string;
    startsAt: string; endsAt: string; meetingPoint?: string; status: string;
    participantCount: number; attendanceCount: number;
  } | null;
  report: {
    id: string; beachId: string; beachName: string; reportedAt: string;
    currentState: 'active' | 'resolved' | 'excluded'; quantities: QuantityByCategory;
    remainingQuantities: QuantityByCategory; photoAvailable: boolean;
  } | null;
};

export default function SharedItemScreen() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const back = useAppBack('/home');
  const [items, setItems] = useState<SharedItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    setPhotoFailed(false);
    getIteration2SharedItems(token)
      .then((value) => { if (active) setItems(value); })
      .catch(() => { if (active) setError('This link is invalid or the shared item is unavailable.'); });
    return () => { active = false; };
  }, [token]);

  const report = items?.report;
  const event = items?.event;
  return (
    <div className="screen scroll-y">
      <div className="measure i2-page" style={{ paddingBottom: 'calc(var(--safe-bottom) + 34px)' }}>
        <BackButton onClick={back} />
        <SectionLabel size="sm">RADAR PANTAI · SHARED ITEM</SectionLabel>
        {error || (items && !report && !event) ? <EmptyState title="Shared item unavailable" body={error ?? 'This link has no available item.'} /> : !items ? (
          <div role="status">Loading shared item...</div>
        ) : (
          <>
            <h1 className="i2-title">{report?.beachName ?? event?.beachName}</h1>
            {event && (
              <section>
                <SectionLabel size="sm">CLEANUP ACTIVITY · {event.status.toUpperCase()}</SectionLabel>
                <p>{formatDate(event.date)} · {event.startsAt}–{event.endsAt}</p>
                {event.meetingPoint && <p>Meeting point: {event.meetingPoint}</p>}
                <p>{event.participantCount} participants · {event.attendanceCount} recorded attendance</p>
                <PrimaryButton onClick={() => nav(`/events/${encodeURIComponent(event.id)}`)}>Open activity</PrimaryButton>
              </section>
            )}
            {report && (
              <section style={{ display: 'grid', gap: 14 }}>
                <SectionLabel size="sm">REPORT · {report.currentState.toUpperCase()}</SectionLabel>
                <p style={{ margin: 0 }}>Reported {formatDate(report.reportedAt)}</p>
                {report.currentState === 'resolved' && <p style={{ margin: 0 }}>This target has been resolved. The original report is retained as history and no longer contributes to the current beach score.</p>}
                {report.currentState === 'excluded' && <p style={{ margin: 0 }}>This historical report does not contribute to the current beach score.</p>}
                {report.photoAvailable && !photoFailed ? (
                  <img src={iteration2SharedPhotoUrl(token)} alt="Original report photo" onError={() => setPhotoFailed(true)} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', background: C.tint, borderRadius: 8 }} />
                ) : <p>Original photo unavailable.</p>}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr><th style={{ textAlign: 'left' }}>Category</th><th>Reported</th><th>Remaining</th></tr></thead>
                  <tbody>{sharedBandRows(report.quantities, report.remainingQuantities).map((row) => (
                    <tr key={row.category}><td style={{ paddingBlock: 10 }}>{row.category}</td><td style={{ textAlign: 'center' }}>{row.reported}</td><td style={{ textAlign: 'center' }}>{row.current ?? 'None recorded'}</td></tr>
                  ))}</tbody>
                </table>
              </section>
            )}
            <GhostButton onClick={() => nav(`/beach/${encodeURIComponent(report?.beachId ?? event?.beachId ?? '')}`)}>View beach</GhostButton>
          </>
        )}
      </div>
    </div>
  );
}
