import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { photoPreviewUrl } from '../api';
import { Check, Shield } from '../components/Icon';
import { Alert, Callout, OverlayChip, SectionLabel } from '../components/ds';
import { BackButton, GhostButton, PrimaryButton, StepBadge, TextButton } from '../components/ui';
import { useApp } from '../AppContext';
import { analyseReportPhoto, type AiSuggestion } from '../iteration2';
import { C, MONO } from '../theme';
import type { LitterCategory, QuantityBand, QuantityByCategory } from '../types';
import { useAppBack } from '../navigation';

const CATEGORIES: LitterCategory[] = ['Plastic', 'Fishing gear', 'Glass', 'Metal', 'Paper', 'Other'];
const QUANTITIES: QuantityBand[] = ['Small', 'Medium', 'Large', 'Very Large'];

// A green "kept" row. When the AI cannot help, the first worry is whether the
// work so far is lost, so the fallback states answer that before anything else.
function KeptRow({ children }: { children: string }) {
  return (
    <div
      role="status"
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 14, background: C.greenBg, border: '1px solid rgba(23,122,62,.22)', color: C.green, fontSize: 12.5, fontWeight: 650 }}
    >
      <Check color={C.green} size={13} />
      {children}
    </div>
  );
}

export default function AiSuggestionScreen() {
  const nav = useNavigate();
  const back = useAppBack('/report/confirm');
  const [params] = useSearchParams();
  const { draft, patchDraft } = useApp();
  const [result, setResult] = useState<AiSuggestion | null>(null);
  const [editable, setEditable] = useState<QuantityByCategory>({});
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const photoUrl =
    draft.photo?.previewUrl || photoPreviewUrl(draft.photo?.photoKey) || draft.existingPhotoUrl;

  function run(forcedState: 'unavailable' | 'unreadable' | null) {
    const key = draft.photo?.photoKey ?? draft.existingPhotoKey ?? '';
    const id = ++requestId.current;
    setLoading(true);
    setResult(null);
    analyseWithTimeout(key, forcedState)
      .then((suggestion) => {
        // Ignore requests from a previous route visit or retry.
        if (requestId.current !== id) return;
        setResult(suggestion);
        setEditable(suggestion.suggestions);
        patchDraft({
          ...(suggestion.modelState === 'ready' ? { quantities: suggestion.suggestions } : {}),
          aiModelState: suggestion.modelState === 'ready' ? 'ready' : suggestion.modelState === 'empty' ? 'empty' : 'unavailable',
          aiModelVersion: suggestion.modelVersion,
          aiDecision: null,
        }, key);
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });
  }

  useEffect(() => {
    // Recognition is cached in the draft. Revisiting this route must preserve
    // the AI result and the participant's edits instead of charging/rerunning
    // the same photo.
    if (draft.aiModelState) {
      const state = draft.aiModelState === 'ready' ? 'ready' : draft.aiModelState;
      setResult({ modelState: state, modelVersion: draft.aiModelVersion ?? 'cached', suggestions: draft.quantities, supportedClasses: [] });
      setEditable(draft.quantities);
      setLoading(false);
    } else {
      // Optional demo states apply only to the first attempt.
      const requestedState = params.get('ai');
      run(requestedState === 'unreadable' ? 'unreadable' : requestedState === 'fail' ? 'unavailable' : null);
    }
    return () => {
      // Invalidate late results when the route unmounts or the photo changes.
      requestId.current += 1;
    };
  }, [draft.photo?.photoKey, draft.existingPhotoKey, params]);

  async function analyseWithTimeout(key: string, forcedState: 'unavailable' | 'unreadable' | null) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        analyseReportPhoto(key, forcedState),
        new Promise<AiSuggestion>((_, reject) => {
          timer = setTimeout(() => reject(new Error('AI check timed out')), 15_000);
        }),
      ]);
    } catch {
      return { modelState: 'unavailable', modelVersion: 'unavailable', suggestions: {}, supportedClasses: [] } satisfies AiSuggestion;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const modelVersion = result?.modelVersion ?? null;

  function confirm() {
    if (Object.keys(editable).length === 0) return;
    patchDraft({ quantities: editable, aiDecision: 'confirmed', aiModelState: 'ready', aiModelVersion: modelVersion });
    nav('/report/review', { state: { from: 'suggestions' } });
  }

  // Edit the suggestion on the details step. The suggested bands go with it,
  // unless every category was removed here, in which case the user's own
  // entries stay rather than being wiped.
  function changeCategoryOrBand() {
    patchDraft({
      ...(Object.keys(editable).length > 0 ? { quantities: editable } : {}),
      aiDecision: null,
      aiModelState: 'ready',
      aiModelVersion: modelVersion,
    });
    nav('/report/details', { replace: true });
  }

  function keepManual() {
    nav('/report/details', { replace: true });
  }

  // No usable suggestion. The details already entered stay; the user checks
  // them on the details step, and Continue there goes on to Review as manual.
  function continueManually(state: 'empty' | 'unavailable') {
    patchDraft({ aiDecision: null, aiModelState: state, aiModelVersion: modelVersion });
    nav('/report/details', { replace: true });
  }

  function toggle(category: LitterCategory) {
    const next = { ...editable };
    if (category in next) delete next[category];
    else next[category] = 'Small';
    setEditable(next);
    patchDraft({ quantities: next });
  }

  const title = loading
    ? 'Checking your photo…'
    : result?.modelState === 'ready'
      ? 'Check the AI suggestion'
      : result?.modelState === 'unreadable'
        ? 'We couldn’t read that photo.'
        : result?.modelState === 'unavailable'
          ? 'AI check unavailable'
          : "We're not sure";

  return (
    <div className="screen scroll-y" style={{ zIndex: 27 }}>
      <div className="measure i2-page anim-fade-up" style={{ paddingBottom: 'calc(var(--safe-bottom) + 34px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <BackButton onClick={back} />
          {/* The suggestion itself is checked on the review step, so a ready
              result is step 4; checking and every fallback are step 3. */}
          <StepBadge>STEP 4 OF 6 · AI CHECK</StepBadge>
        </div>
        <div>
          <SectionLabel size="sm">AI SUGGESTION · REVIEW BEFORE SAVING</SectionLabel>
          <h1 className="i2-title" style={{ marginTop: 7 }}>{title}</h1>
          <p className="i2-subtitle">You decide the final litter types and amounts. A suggestion is never submitted on its own.</p>
        </div>

        {loading ? (
          <div className="i2-hero" style={{ minHeight: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 74, height: 74, borderRadius: 37, border: `2px solid ${C.lime}`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pulseDot 1.4s ease infinite' }}>
              <span style={{ width: 18, height: 18, borderRadius: 9, background: C.lime }} />
            </div>
            <div style={{ marginTop: 18, fontFamily: MONO, fontSize: 10, letterSpacing: '.13em', color: 'rgba(255,255,255,.72)' }}>AI SUGGESTION · NOT YET CONFIRMED</div>
          </div>
        ) : result?.modelState === 'ready' ? (
          <>
            {/* The analysed photo, so each suggestion can be checked against
                it. No boxes or scores are drawn: the recognition response does
                not include them. */}
            <div style={{ position: 'relative', height: 150, borderRadius: 24, overflow: 'hidden', background: '#A19C90' }}>
              {photoUrl && (
                <img src={photoUrl} alt="Photo the AI checked" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              )}
              {draft.photo?.metadataStripped && (
                <OverlayChip style={{ position: 'absolute', left: 12, bottom: 12 }}>
                  <Shield size={10} />
                  LOCATION METADATA REMOVED
                </OverlayChip>
              )}
            </div>

            <Callout title="Suggestion ready" tone="reassurance" icon={<Check color={C.green} />}>
              Check each selected category and change any amount that does not match what you saw.
            </Callout>

            <div className="i2-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <SectionLabel size="sm">DETECTED CATEGORIES</SectionLabel>
                <button type="button" onClick={() => nav('/method/ai')} style={{ minWidth: 34, minHeight: 34, borderRadius: 17, background: C.tint, color: C.navy, fontWeight: 800 }} aria-label="How AI suggestions work">?</button>
              </div>
              <div className="i2-chip-row" style={{ marginTop: 11 }}>
                {CATEGORIES.map((category) => (
                  <button key={category} type="button" className="i2-chip press" aria-pressed={category in editable} onClick={() => toggle(category)}>{category}</button>
                ))}
              </div>
              <div style={{ display: 'grid', gap: 11, marginTop: 16 }}>
                {(Object.keys(editable) as LitterCategory[]).map((category) => (
                  <label key={category} className="i2-quantity-row">
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{category}</span>
                    <select className="i2-field" aria-label={`${category} suggested amount`} value={editable[category]} onChange={(event) => {
                      const next = { ...editable, [category]: event.target.value as QuantityBand };
                      setEditable(next);
                      patchDraft({ quantities: next });
                    }}>
                      {QUANTITIES.map((quantity) => <option key={quantity}>{quantity}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            {Object.keys(editable).length === 0 && <Alert title="Choose at least one category" tone="caution">You can enter the litter types and amounts manually.</Alert>}
            {Object.keys(editable).length > 0 && Object.values(editable).every((quantity) => quantity === 'Small') && (
              <Alert title="Small-only reports are not counted" tone="caution">
                Choose Medium, Large or Very Large for at least one category. Your draft is kept while you make this change.
              </Alert>
            )}
            <PrimaryButton onClick={confirm} disabled={Object.keys(editable).length === 0}>Confirm suggestions</PrimaryButton>
            <GhostButton onClick={changeCategoryOrBand}>Change type or amount</GhostButton>
            <TextButton onClick={keepManual}>Enter manually</TextButton>
          </>
        ) : result?.modelState === 'unreadable' ? (
          <>
            <p style={{ margin: 0, color: C.muted, fontSize: 13, lineHeight: 1.55 }}>Nothing has been submitted.</p>
            <KeptRow>{`${draft.beachName ?? 'Beach'} and draft kept`}</KeptRow>
            <PrimaryButton onClick={() => nav('/report/photo', { replace: true })}>Choose another photo</PrimaryButton>
            <GhostButton onClick={() => continueManually('unavailable')}>Continue manually</GhostButton>
          </>
        ) : result?.modelState === 'unavailable' ? (
          <>
            <KeptRow>Photo, beach and draft kept</KeptRow>
            <PrimaryButton onClick={() => continueManually('unavailable')}>Continue manually</PrimaryButton>
            <GhostButton onClick={() => run(null)}>Try again</GhostButton>
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: C.muted, fontSize: 13, lineHeight: 1.55 }}>
              The AI couldn't tell what litter this is.
              <br />
              Your photo and beach are still here. You can enter the litter types and amounts manually.
            </p>
            <PrimaryButton onClick={() => continueManually('empty')}>Select Manually</PrimaryButton>
          </>
        )}

        <TextButton onClick={() => nav('/method/ai')}>How the AI suggestion works</TextButton>
      </div>
    </div>
  );
}
