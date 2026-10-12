// Step 1 of the report: the photo.
//
// The photo comes first because it is the evidence, and because the volunteer
// is standing in front of the litter right now. Asking for it last would mean
// asking them to walk back. Nothing here guesses what the litter is - the user
// picks that on the next screen, so no machine guess is stored as a human one.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { photoPreviewUrl, refreshPhotoPreview, uploadPhoto, USE_MOCK } from '../api';
import { ArrowRight, Camera, ChevronRight, Shield, Upload } from '../components/Icon';
import { BackButton, ErrorNote, PrimaryButton, StepBadge } from '../components/ui';
import { C, MONO } from '../theme';
import { OverlayChip } from '../components/ds';
import { useApp } from '../AppContext';
import { useAppBack } from '../navigation';


/**
 * Can the browser actually turn these bytes into pixels?
 *
 * Accepting a file is not the same as being able to show it. HEIC is the
 * iPhone default and desktop browsers cannot decode it, yet the upload still
 * reported success with a 0 x 0 preview. naturalWidth is the real test: a
 * failed decode can still fire onload, but never with a size.
 */
function decodesToPixels(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve(probe.naturalWidth > 0 && probe.naturalHeight > 0);
    probe.onerror = () => resolve(false);
    probe.src = url;
  });
}

// HEIC is deliberately absent, and that is what makes an iPhone work.
//
// iOS Safari CAN decode HEIC; desktop browsers cannot. But when accept does not
// list HEIC, iOS transcodes the picked photo to JPEG on its way into the input.
// Listing it did the opposite: the picker handed over the raw HEIC, and the app
// then refused it - after the hint and the wrong-type error had both told the
// user HEIC was fine. Leaving it out is what actually accepts an iPhone photo.
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];
// 10 MB, the ceiling written down in API.md section 5.
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export default function PhotoScreen() {
  const nav = useNavigate();
  const back = useAppBack('/home');
  const uploadRequest = useRef(0);
  useEffect(() => () => { uploadRequest.current += 1; }, []);
  const { draft, patchDraft } = useApp();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Desktop drag and drop. The photo goes through the same handleFile gate as
  // the picker, so a dropped HEIC gets the same answer as a picked one.
  const [dragging, setDragging] = useState(false);

  // Preview links from the real backend expire, so a draft opened again later
  // has a live photo key but a dead link. Ask for a fresh one. If that fails
  // for a report being corrected, flag the photo unavailable and let the panel
  // below offer a way out; a photo picked in this session is simply dropped,
  // because a blank grey box with no words reads as a bug. Mock links persist.
  useEffect(() => {
    const photoKey = draft.photo?.photoKey ?? draft.existingPhotoKey;
    if (!photoKey || draft.photo?.previewUrl || USE_MOCK) return;
    let active = true;
    refreshPhotoPreview(photoKey)
      .then((previewUrl) => {
        if (active && previewUrl) {
          if (draft.photo) patchDraft({ photo: { ...draft.photo, previewUrl }, existingPhotoUnavailable: false });
          else patchDraft({ existingPhotoUrl: previewUrl, existingPhotoUnavailable: false });
        }
      })
      .catch(() => {
        if (active) {
          if (!draft.photo && draft.existingPhotoKey) {
            patchDraft({ existingPhotoUrl: null, existingPhotoUnavailable: true });
          } else {
            patchDraft({ photo: null, existingPhotoUrl: null, existingPhotoKey: null, aiDecision: null, aiModelVersion: null });
            setUploadError('That photo preview has expired. Please choose the photo again.');
          }
        }
      });
    return () => {
      active = false;
    };
  }, [draft.photo?.photoKey, draft.existingPhotoKey]);

  // Guard the file before we spend an upload on it. The accept attribute is
  // only a hint to the picker, and with the mock running the backend checks
  // nothing at all. Zero bytes earns its own case: it uploads happily and only
  // shows up later as a broken picture. Every failure uses the same red panel.
  async function handleFile(file: File | undefined) {
    if (!file || uploading) return;



    // The `|| /\.heic$/` escape hatch that used to be here let a HEIC through
    // this gate so it could fail further along, with a vaguer message. Now it
    // is refused where the reason is clearest, and consistently with the accept
    // attribute and the hint - which is the whole point: one answer about HEIC,
    // not three.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError('That file is not a photo we can read. Use JPG or PNG.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      setUploadError(`That photo is ${mb} MB, just over the 10 MB limit. Please choose a smaller one.`);
      return;
    }
    if (file.size === 0) {
      setUploadError('That photo is empty. Please choose another photo.');
      return;
    }

    setUploading(true);
    const request = ++uploadRequest.current;
    setUploadError(null);
    try {
      const photo = await uploadPhoto(file);
      if (request !== uploadRequest.current) return;
      // AC2.2.3 - check the stored photo really opens before we call it added.
      // Nothing else in the flow verified this, so an undecodable file reached
      // the review screen and the submitted report as a blank box.
      const preview = photo.previewUrl || photoPreviewUrl(photo.photoKey);
      if (preview && !(await decodesToPixels(preview))) {
        throw new Error(
          'This browser could not open that photo. HEIC photos often only open on an iPhone — please choose a JPG or PNG.',
        );
      }
      if (request !== uploadRequest.current) return;
      // Refuse the photo if the location is still baked into it. Phone photos
      // carry the exact spot they were taken, and publishing that would break
      // the promise made two screens earlier.
      if (!photo.metadataStripped) {
        throw new Error('Location metadata could not be removed. Please choose another photo.');
      }
      patchDraft({ photo, existingPhotoUnavailable: false, aiDecision: null, aiModelVersion: null });
    } catch (error) {
      if (request !== uploadRequest.current) return;
      setUploadError(error instanceof Error ? error.message : 'Please try again.');
      // Clear the photo as well as showing the error. A half-failed upload left
      // in the draft would let Continue submit a report pointing at nothing.
      patchDraft({ photo: null, aiDecision: null, aiModelVersion: null });
    } finally {
      if (request === uploadRequest.current) setUploading(false);
    }
  }

  const photo = draft.photo;

  // Two hidden inputs below, one visible pair of buttons. capture="environment"
  // opens the back camera straight away on a phone; a laptop has no such
  // camera, so the browser ignores it and shows the normal file picker. That
  // one attribute is how a single code path serves both, with no device sniff.
  return (
    <div className="screen scroll-y" style={{ zIndex: 26 }}>

      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <div
        className="anim-fade-up pt-page measure"
        style={{ paddingInline: 20, paddingBottom: 'calc(var(--safe-bottom) + 32px)', display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <BackButton onClick={() => { uploadRequest.current += 1; back(); }} />
          <StepBadge>STEP 1 OF 6 · PHOTO</StepBadge>
        </div>

        <div>
          <div style={{ fontSize: 30, fontWeight: 640, letterSpacing: '-.8px' }}>Show us what you found</div>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 7, lineHeight: 1.5 }}>
          We'll check the photo first. Then you can confirm or change the suggested categories and amounts.
          </div>
        </div>

        {uploadError && (
          // Retry reopens whichever picker fits the failure: an expired preview
          // means the photo is already in their library, anything else is fresh.
          <ErrorNote
            title="Photo upload failed"
            body={uploadError}
            onRetry={() => (uploadError.includes('expired') ? libraryRef.current?.click() : cameraRef.current?.click())}
          />
        )}

        {/* The stored photo of a report being corrected would not load. Offer
            both ways out, rather than blocking the correction on a lost file. */}
        {draft.existingPhotoUnavailable && !photo && (
          <div style={{ background: C.tint, border: `1px solid ${C.line}`, borderRadius: 16, padding: '13px 14px', color: C.slate, fontSize: 12, lineHeight: 1.5 }}>
            <div>Existing photo unavailable. You can keep this report or choose a replacement photo.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button type="button" onClick={() => nav('/report/details')} style={{ color: C.navy, fontWeight: 650, fontSize: 14 }}>
                Keep Existing Record
              </button>
              <button type="button" onClick={() => libraryRef.current?.click()} style={{ color: C.navy, fontWeight: 650, fontSize: 14 }}>
                Choose Replacement Photo
              </button>
            </div>
          </div>
        )}

        {!photo ? (
          <>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={uploading}
              onDragOver={(e) => {
                e.preventDefault();
                if (!uploading) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
              className="lift press"
              style={{
                position: 'relative',
                height: 210,
                borderRadius: 26,
                overflow: 'hidden',
                background: 'radial-gradient(100% 70% at 50% 0%,#2A5E97 0%,#153A6E 60%,#081739 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                width: '100%',
              }}
            >
              <div style={{ position: 'absolute', inset: 14, border: `1.5px ${dragging ? 'solid' : 'dashed'} rgba(184,255,54,${dragging ? '.9' : '.35'})`, borderRadius: 18 }} />
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  background: 'rgba(184,255,54,.14)',
                  border: '1px solid rgba(184,255,54,.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Camera size={26} strokeWidth={1.7} />
              </div>
              <div style={{ color: C.bg, fontSize: 14, fontWeight: 650 }}>
                {uploading ? 'Uploading…' : dragging ? 'Drop the Photo Here' : 'Take Photo'}
              </div>

            </button>

            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              disabled={uploading}
              className="chip-hover press"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 13,
                background: C.white,
                border: '1.5px solid rgba(11,33,97,.12)',
                borderRadius: 22,
                padding: '17px 18px',
                width: '100%',
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 15, background: 'rgba(11,33,97,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Upload />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 650 }}>Upload Photo</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>JPG or PNG · up to 10 MB</div>
              </div>
              <ChevronRight size={14} />
            </button>

          </>
        ) : (
          <>
            <div style={{ position: 'relative', height: 280, borderRadius: 26, overflow: 'hidden', background: '#87847B' }}>
              {/* previewUrl first, then look the key up. AppContext strips the
                  preview before saving the draft, so after a reload the key is
                  what brings the picture back instead of a broken image. */}
              <img
                src={photo.previewUrl || photoPreviewUrl(photo.photoKey) || undefined}
                alt="Litter you photographed"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <div style={{ position: 'absolute', top: 14, left: 14, fontFamily: MONO, fontSize: 8.5, letterSpacing: '.14em', color: 'rgba(255,255,255,.9)', background: 'rgba(30,36,44,.45)', backdropFilter: 'blur(6px)', padding: '5px 9px', borderRadius: 8 }}>
                PHOTO
              </div>
              <button
                type="button"
                onClick={() => {
                  patchDraft({ photo: null, aiDecision: null, aiModelVersion: null });
                  cameraRef.current?.click();
                }}
                style={{ position: 'absolute', top: 14, right: 14, fontSize: 14, fontWeight: 650, color: 'rgba(255,255,255,.9)', background: 'rgba(30,36,44,.45)', backdropFilter: 'blur(6px)', padding: '6px 11px', borderRadius: 999 }}
              >
                Retake
              </button>
              {photo.metadataStripped && (
                // Say out loud that we removed the location. A privacy step
                // nobody can see is one nobody can trust.
                <OverlayChip style={{ position: 'absolute', left: 14, bottom: 14 }}>
                  <Shield size={11} />
                  LOCATION METADATA REMOVED
                </OverlayChip>
              )}
            </div>

            <PrimaryButton onClick={() => nav('/report/location')}>
              Continue
              <ArrowRight />
            </PrimaryButton>
          </>
        )}
      </div>
    </div>
  );
}
