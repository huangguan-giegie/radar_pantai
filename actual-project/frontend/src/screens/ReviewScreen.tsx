// Last step: check everything, then submit.
// Every row can be changed from here. A review screen that shows a mistake
// without a way to fix it makes people guess how many times to press Back,
// and on a phone that usually ends with them starting again.
// New reports and corrections both land here; buildReportSubmission in
// flowRules.ts decides which, so this screen never has to branch on it.
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { createReport, getBeaches, getMyReports, photoPreviewUrl, updateReport } from '../api';
import { ArrowRight, Check, Info, Shield } from '../components/Icon';
import { BackButton, ErrorNote, PrimaryButton, StepBadge, TextButton } from '../components/ui';
import { C, formatDate } from '../theme';
import { Alert, InfoChip, OverlayChip, StatusBadge } from '../components/ds';
import { useApp } from '../AppContext';
import type { BeachSummary, LitterCategory, LitterReport, QuantityBand } from '../types';
import { buildReportSubmission, findExactDuplicateReport, finishReportSubmission, isSmallOnlyRejection } from '../flowRules';
import { linkEventReportData } from '../iteration2Api';
import { useAppBack } from '../navigation';
import { pendingReportSave } from '../pendingReportSave';

export default function ReviewScreen() {
  const nav = useNavigate();
  const location = useLocation();
  const back = useAppBack((location.state as { from?: string } | null)?.from === 'suggestions' ? '/report/suggestions' : '/report/details');
  const { draft, user, setLastSavedReport, bumpReports, showToast } = useApp();
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const [beaches, setBeaches] = useState<BeachSummary[]>([]);
  // busy disables the submit button while the request is in flight - the one
  // place a disabled button is right, since a second tap would file twice.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] = useState<LitterReport | null>(null);
  // Set when the server turned the report away because every category is
  // Small. That is the scope rule working, not a failure, so the page becomes
  // a calm "not recorded" outcome instead of showing a red error.
  const [smallOnly, setSmallOnly] = useState(false);
  const smallOnlyDraft = Object.values(draft.quantities).length > 0
    && Object.values(draft.quantities).every((quantity) => quantity === 'Small');
  const showSmallOnly = smallOnly || smallOnlyDraft;

  useEffect(() => {
    getBeaches()
      .then((list) => setBeaches(list))
      .catch(() => setBeaches([]));
  }, []);

  useEffect(() => {
    let active = true;
    getMyReports()
      .then((reports) => {
        if (active) setDuplicateMatch(findExactDuplicateReport(draft, reports));
      })
      .catch(() => {
        if (active) setDuplicateMatch(null);
      });
    return () => { active = false; };
  }, [draft]);

  const beach = beaches.find((b) => b.id === draft.beachId);

  const photoUrl =
    draft.photo?.previewUrl || photoPreviewUrl(draft.photo?.photoKey) || draft.existingPhotoUrl;

  async function submit() {
    if (submitting.current) return;
    // Two try blocks on purpose. This one is about the DRAFT being wrong, and
    // the user can fix that here. The one below is about the REQUEST failing,
    // which they can only retry. Merged, an outage would read as their fault.
    let submission: ReturnType<typeof buildReportSubmission>;
    try {
      submission = buildReportSubmission(draft);
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : 'This report is missing a required field.',
      );
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await pendingReportSave(JSON.stringify([user?.participantId, submission]), () =>
        submission.kind === 'update'
          ? updateReport(submission.reportId, submission.changes)
          : createReport(submission.payload));
      // A browser Back can leave even while the page controls are disabled.
      // Refresh saved data, but never redirect or clear a later draft.
      bumpReports();
      const linkedEventId = draft.linkedEventId ?? draft.eventId;
      if (linkedEventId && user) {
        try {
          await linkEventReportData(linkedEventId, user.participantId, saved.id, saved.beachId);
        } catch {
          // A successful report must not be presented as failed merely because
          // the event context expired while the form was open. Attendance is
          // never inferred from a report, so there is no unsafe fallback here.
          if (active.current) showToast('Report saved. Return to the activity to check your attendance steps.');
        }
      }
      // Order matters. Keep the saved report first, so the next screen needs no
      // second request that might fail. Refresh the counts. Then navigate via
      // finishReportSubmission, which commits the move before the confirmation
      // screen clears the draft - clear it first and this page's route guard
      // sees an empty draft and bounces the user back to step 1.
      if (!active.current) return;
      setLastSavedReport(saved);
      finishReportSubmission(nav);
    } catch (err) {
      if (!active.current) return;
      if (isSmallOnlyRejection(err)) {
        setSmallOnly(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not save this report.');
      showToast('Save failed');
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }


  // Pop the previous step when available; a direct link replaces with the
  // relevant edit step. Never push a second copy of the same form.
  const backToDetails = () => {
    if (!submitting.current) back();
  };


  // The label doubles as the React key. A category appears at most once in a
  // report, so it is unique, while an array index would rebind rows to the
  // wrong data as soon as a category was removed.
  //
  // The optional badge is how the location row says what was stored: "GPS
  // PRIVATE" means coordinates were used but stay unpublished, "NO GPS STORED"
  // means there were none. Last screen before the data leaves the phone.
  const row = (label: string, value: string, action?: () => void, badge?: string) => (
    <button
      key={label}
      type="button"
      onClick={action}
      disabled={busy && Boolean(action)}
      className={action ? 'row-hover' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 17px',
        borderBottom: `1px solid rgba(11,33,97,.06)`,
        width: '100%',
        cursor: action ? 'pointer' : 'default',
      }}
    >
      <span style={{ width: 92, flex: 'none', fontSize: 11.5, fontWeight: 600, color: C.dim }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 640, flex: 1 }}>{value}</span>
      {action && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.navy }}>Change</span>}
      {badge && (
        <StatusBadge status="duplicate" style={{ marginLeft: 'auto' }}>
          {badge}
        </StatusBadge>
      )}
    </button>
  );

  // A quiet green line for an outcome the user chose or a rule that applied -
  // neither is an error, so neither gets the red treatment.
  const greenNote = (text: string) => (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 14, background: C.greenBg, border: '1px solid rgba(23,122,62,.22)', color: C.green, fontSize: 12.5, fontWeight: 650 }}>
      <Check color={C.green} size={13} />
      {text}
    </div>
  );

  return (
    <div className="screen scroll-y" style={{ zIndex: 26 }}>
      <div
        className="anim-fade-up pt-page measure"
        style={{ paddingInline: 20, paddingBottom: 'calc(var(--safe-bottom) + 32px)', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <BackButton onClick={backToDetails} disabled={busy} />
          <StepBadge>STEP 6 OF 6 · REVIEW</StepBadge>
        </div>

        <div>
          <div style={{ fontSize: 29, fontWeight: 640, letterSpacing: '-.7px' }}>
            {showSmallOnly ? 'Small — not recorded' : 'Review your report'}
          </div>
        </div>

        <div style={{ position: 'relative', height: 150, borderRadius: 24, overflow: 'hidden', background: '#A19C90' }}>
          {photoUrl && (
            <img src={photoUrl} alt="Report evidence" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          )}
          {/* Correcting a report whose original photo will not load. Say so
              plainly, because the old photo is still kept unless they pick
              a replacement. */}
          {draft.existingPhotoUnavailable && !photoUrl && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: C.slate, fontSize: 12 }}>
              Existing photo unavailable. The existing record will be kept unless you choose a replacement photo.
            </div>
          )}
          {(draft.photo?.metadataStripped || draft.existingPhotoUrl || draft.existingPhotoUnavailable) && (
            <OverlayChip style={{ position: 'absolute', left: 12, bottom: 12 }}>
              <Shield size={10} />
              {draft.photo ? 'LOCATION METADATA REMOVED' : draft.existingPhotoUnavailable ? 'EXISTING PHOTO UNAVAILABLE' : 'EXISTING PHOTO RETAINED'}
            </OverlayChip>
          )}
        </div>

        <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 24, overflow: 'hidden' }}>
          {row('Beach', draft.beachName ?? beach?.name ?? 'Not selected', () => nav('/report/confirm', { replace: true }))}
          {(Object.keys(draft.quantities) as LitterCategory[]).length === 0
            ? row('Litter', 'Not selected', () => backToDetails())
            : (Object.entries(draft.quantities) as [LitterCategory, QuantityBand][]).map(([cat, q]) =>
                row(cat, q ?? 'Not selected', () => backToDetails()),
              )}
          {draft.locationSource === 'gps'
            ? row('Location', 'Beach area confirmed', undefined, 'GPS PRIVATE')
            : row('Location', 'Selected manually', undefined, 'NO GPS STORED')}
        </div>

        {/* Only an accepted AI suggestion gets this row. Manual values need no
            label: the rows above already are what the user entered. */}
        {draft.aiDecision === 'confirmed' && !showSmallOnly && greenNote('Confirmed by you')}
        {showSmallOnly && greenNote('Small-only reports are not counted and will not be saved.')}
        {showSmallOnly && (
          <Alert title="Choose a larger quantity before submitting" tone="caution">
            Small records the lowest amount, but the current reporting rule needs
            at least one Medium, Large or Very Large category to save a report.
          </Alert>
        )}

        {duplicateMatch && !showSmallOnly && (
          <Alert title="You already filed this one" tone="caution">
            <div>A report from {formatDate(duplicateMatch.createdAt)} at {duplicateMatch.beachName} looks the same as this one. If it really is a new find, you can still submit it.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              <InfoChip>Same participant</InfoChip>
              <InfoChip>{duplicateMatch.beachName}</InfoChip>
              <InfoChip>Same local day</InfoChip>
              {(Object.entries(duplicateMatch.quantities) as [LitterCategory, QuantityBand][]).map(([category, quantity]) => (
                <InfoChip key={category}>{category} · {quantity}</InfoChip>
              ))}
            </div>
            <div style={{ marginTop: 9 }}>This is a warning only, not a rejection.</div>
            {/* Below the chips rather than as the alert's side action, which
                would squeeze the chips into a narrow column on a phone. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => nav(`/reports/${duplicateMatch.id}`)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, marginTop: 4, color: 'inherit', fontSize: 13, fontWeight: 760 }}
            >
              View Existing Report
              <ArrowRight color="currentColor" />
            </button>
          </Alert>
        )}

        {error && <ErrorNote title="Could not save" body={error} />}

        {showSmallOnly ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <PrimaryButton onClick={() => backToDetails()}>Change amount</PrimaryButton>
            {/* The draft is left as it is, so the photo and beach are still
                there if the user comes back to report something bigger. */}
            <TextButton onClick={() => nav(`/beach/${draft.beachId}`)}>Back to beach</TextButton>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: C.tint, borderRadius: 16, padding: '13px 14px' }}>
              <Info style={{ flex: 'none', marginTop: 1 }} />
              <div style={{ fontSize: 12, lineHeight: 1.55, color: C.slate }}>
                Duplicate or incomplete reports are excluded from the severity calculation — the same
                rule for every beach.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <PrimaryButton onClick={submit} disabled={busy}>
                {busy ? 'Saving…' : duplicateMatch ? 'Submit anyway — new observation' : 'Submit Report'}
                {!busy && <ArrowRight />}
              </PrimaryButton>
              <TextButton onClick={backToDetails} disabled={busy}>
                {draft.aiDecision === 'confirmed' ? 'Change type or amount' : 'Back to details'}
              </TextButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
