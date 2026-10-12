
// The anonymous participant number - this app's whole idea of an account.
// No name, no email, no password. The user gets a four digit number and their
// reports hang off it. Data we never collect cannot leak, and a volunteer
// standing on a beach in the sun will not stop to verify an email address.
// The cost is real, so the screen says it twice: lose the number and the old
// reports still count for their beach, but nobody can reopen them.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { C, MONO } from '../theme';
import { ShieldCheck } from '../components/Icon';
import { BackButton, ErrorNote, GhostButton, PrimaryButton, TextButton, downloadRecoveryKit } from '../components/ui';
import { useApp } from '../AppContext';
import { safeNextPath } from '../flowRules';
import { useAppBack } from '../navigation';

export default function IdentityScreen() {
  const nav = useNavigate();
  const back = useAppBack('/home');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const { createId, restore } = useApp();

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [typedId, setTypedId] = useState('');
  const [typedToken, setTypedToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The number we have just issued. Null means show the two choices; set means
  // show the number and nothing else. State rather than its own route on
  // purpose - Back must not bring "here is your number" up a second time, when
  // the number on screen would no longer be the one they were given.
  const [newSession, setNewSession] = useState<{ participantId: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [savedRecovery, setSavedRecovery] = useState(false);

  const canRestore = !busy && /^\d{4}$/.test(typedId) && typedToken.trim() !== '';

  function saveRecoveryKit() {
    if (!newSession) return;
    downloadRecoveryKit(newSession.participantId, newSession.token);
    setSavedRecovery(true);
  }

  function goBack() {
    if (newSession && !savedRecovery && !window.confirm('Leave without saving your recovery token?')) return;
    back();
  }


  // Ask for a new number.
  async function getNewId() {
    setBusy(true);
    setError(null);
    try {
      const session = await createId();
      if (!active.current) return;
      // Deliberately no navigation here. The user has to see the number and
      // save it first - moving straight on would lose it before they read it.
      setNewSession(session);
    } catch (err) {
      if (!active.current) return;
      setError(err instanceof Error ? err.message : 'Could not get an ID. Please try again.');
    }
    if (active.current) setBusy(false);
  }


  // Continue with a number the user already has.
  //
  // The field feeding this is inputMode="numeric", not type="number". A number
  // input silently drops a leading zero, which would send a different ID.
  async function useExistingId(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await restore(typedId.trim(), typedToken.trim());
      if (!active.current) return;
      // On to wherever they were heading before we asked for an ID. Replace,
      // so Back does not drop them onto this screen again.
      nav(next, { replace: true });
    } catch (err) {
      if (!active.current) return;
      // A server fault or a dead connection lands here too, so we must not
      // blame the user's typing every time. Prefer the message from the API.
      setError(err instanceof Error ? err.message : 'Could not use that ID. Please check the number.');
    }
    if (active.current) setBusy(false);
  }

  return (
    <div className="screen scroll-y" style={{ zIndex: 50 }}>
      <div
        className="anim-fade-up pt-page-lg measure"
        style={{
          paddingInline: 24,
          paddingBottom: 'calc(var(--safe-bottom) + 32px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <BackButton onClick={goBack} />

        <div>
          {/* One headline for the whole flow, as in the prototype. Switching
              between "get" and "restore", or being issued a number, changes
              what is below it - not what the page is about. */}
          <div style={{ fontSize: 31, fontWeight: 640, letterSpacing: '-.8px' }}>
            Join in — no name needed
          </div>
          {/* No subtitle once the number is issued: the token card says what
              matters there, right next to the token. */}
          {!newSession && (
            <div style={{ fontSize: 14, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
              {mode === 'existing'
                ? 'Use your participant ID and recovery token.'
                : 'No name, email or phone number required.'}
            </div>
          )}
        </div>

        {newSession ? (
          // The number is issued. Two cards, as in the prototype: the
          // participant ID is how others see you, the recovery token is marked
          // KEEP PRIVATE. The save checkbox is the honest price of having no
          // password, and the Account page repeats the warning.
          //
          // How restore should work is still being decided with the backend
          // (see docs/BACKEND_FOLLOWUPS_PROTOTYPE_ALIGNMENT.md), so nothing on
          // this screen makes promises about what the ID can or cannot do.
          <>
            <div style={{ background: C.navy, borderRadius: 24, padding: '18px 18px 20px', color: C.bg }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.14em', color: 'rgba(221,227,236,.62)' }}>
                  YOUR PARTICIPANT ID
                </div>
                <button
                  type="button"
                  className="press"
                  onClick={async () => {
                    if (!navigator.clipboard) return;
                    try {
                      await navigator.clipboard.writeText(newSession.participantId);
                      setCopiedId(true);
                    } catch {
                      setCopiedId(false);
                    }
                  }}
                  style={{
                    flex: 'none',
                    padding: '6px 11px',
                    borderRadius: 10,
                    border: '1px solid rgba(221,227,236,.32)',
                    color: C.bg,
                    fontSize: 12.5,
                    fontWeight: 620,
                  }}
                >
                  {copiedId ? 'Copied' : 'Copy ID'}
                </button>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 40, fontWeight: 700, color: C.lime, marginTop: 10, userSelect: 'all' }}>
                {newSession.participantId}
              </div>
              <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: 'rgba(221,227,236,.78)' }}>
                Others see you as Volunteer {newSession.participantId}.
              </div>
            </div>

            <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 24, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 650, color: C.ink2 }}>Recovery token</div>
                <span
                  style={{
                    flex: 'none',
                    padding: '4px 9px',
                    borderRadius: 999,
                    background: 'rgba(156,66,55,.09)',
                    color: C.red,
                    fontFamily: MONO,
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: '.14em',
                  }}
                >
                  KEEP PRIVATE
                </span>
              </div>
              {/* The prototype's "the only way back in" waits on the restore
                  decision with the backend, so this line only promises what we
                  can keep today. */}
              <div style={{ fontSize: 13, lineHeight: 1.5, color: C.muted, marginTop: 5 }}>
                You won't see this token again after leaving this screen.
              </div>
              <div
                style={{
                  marginTop: 14,
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: C.bg,
                  border: `1px solid ${C.line2}`,
                  fontFamily: MONO,
                  fontSize: 16,
                  fontWeight: 600,
                  lineHeight: 1.5,
                  letterSpacing: '.04em',
                  color: C.ink2,
                  wordBreak: 'break-word',
                  userSelect: 'all',
                }}
              >
                {newSession.token}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                <GhostButton
                  height={46}
                  style={{ fontSize: 14 }}
                  onClick={async () => {
                    if (!navigator.clipboard) return;
                    try {
                      // Restore accepts the token plus the participant ID. Copy
                      // only the token so pasting it into the password field
                      // cannot accidentally include the recovery file labels.
                      await navigator.clipboard.writeText(newSession.token);
                      setCopied(true);
                      setSavedRecovery(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? 'Copied' : 'Copy token'}
                </GhostButton>
                <GhostButton height={46} style={{ fontSize: 14 }} onClick={saveRecoveryKit}>Download</GhostButton>
              </div>

              <label style={{ display: 'flex', gap: 11, alignItems: 'center', marginTop: 14, color: C.ink2, fontSize: 13.5, fontWeight: 620, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={savedRecovery}
                  onChange={(event) => setSavedRecovery(event.target.checked)}
                  style={{ width: 20, height: 20, accentColor: C.navy }}
                />
                I have saved my recovery token
              </label>
            </div>

            <PrimaryButton disabled={!savedRecovery} trailingArrow onClick={() => nav(next, { replace: true })}>
              Continue
            </PrimaryButton>
            {/* For someone who tapped "Create" by mistake and already had a
                profile. They are after the restore form, not this new token. */}
            <TextButton
              onClick={() => {
                // The new profile is already signed in at this point. Say so, or
                // someone backing out would think it had been thrown away.
                if (!savedRecovery && !window.confirm('Leave without saving your recovery token? The new profile stays signed in until you sign out from Account.')) return;
                setNewSession(null);
                setCopied(false);
                setCopiedId(false);
                setSavedRecovery(false);
                setMode('existing');
              }}
            >
              I already have a token
            </TextButton>
          </>
        ) : (
          // No number yet. A segmented control instead of two separate pages,
          // so someone who picked the wrong side can switch back without losing
          // what they typed. It ends with a way out for people who only want to
          // look around.
          <>

            <div
              style={{
                display: 'flex',
                gap: 5,
                background: C.white,
                border: `1px solid ${C.line}`,
                padding: 4,
                borderRadius: 999,
              }}
            >
              <button
                type="button"
                onClick={() => setMode('new')}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '10px 0',
                  borderRadius: 999,
                  background: mode === 'new' ? C.navy : 'transparent',
                  color: mode === 'new' ? C.bg : C.muted,
                  fontSize: 12.5,
                  fontWeight: mode === 'new' ? 650 : 600,
                }}
              >
                Get an ID
              </button>
              <button
                type="button"
                onClick={() => setMode('existing')}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '10px 0',
                  borderRadius: 999,
                  background: mode === 'existing' ? C.navy : 'transparent',
                  color: mode === 'existing' ? C.bg : C.muted,
                  fontSize: 12.5,
                  fontWeight: mode === 'existing' ? 650 : 600,
                }}
              >
                Restore Profile
              </button>
            </div>

            {error && <ErrorNote title="Could not continue" body={error} />}

            {mode === 'new' ? (
              <>
                <PrimaryButton onClick={getNewId} disabled={busy}>
                  {busy ? 'Creating your profile…' : 'Create my profile'}
                </PrimaryButton>
                <TextButton onClick={() => setMode('existing')}>I already have a token</TextButton>
              </>
            ) : (
              <form onSubmit={useExistingId} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.14em', color: C.dim }}>
                    PARTICIPANT ID
                  </span>
                  <input
                    className="field"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    value={typedId}
                    onChange={(e) => setTypedId(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="1637"
                    style={{
                      background: C.white,
                      border: `1.5px solid ${C.cloud}`,
                      borderRadius: 16,
                      padding: 16,
                      fontSize: 20,
                      fontFamily: MONO,
                      letterSpacing: '.1em',
                      color: C.ink,
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.14em', color: C.dim }}>
                    RECOVERY TOKEN
                  </span>
                  <input
                    className="field"
                    type="password"
                    autoComplete="current-password"
                    value={typedToken}
                    onChange={(e) => setTypedToken(e.target.value)}
                    placeholder="Enter your recovery token"
                    style={{
                      background: C.white,
                      border: `1.5px solid ${C.cloud}`,
                      borderRadius: 16,
                      padding: 16,
                      fontSize: 16,
                      fontFamily: MONO,
                      color: C.ink,
                    }}
                  />
                </label>

                {/* Both fields stay required. The prototype restores from the
                    token alone; that depends on a backend change that has not
                    been agreed yet. */}
                <PrimaryButton type="submit" trailingArrow={canRestore} disabled={!canRestore}>
                  {busy ? 'Checking…' : 'Restore profile'}
                </PrimaryButton>
                <TextButton onClick={() => setMode('new')}>+ Create a new profile</TextButton>

              </form>
            )}

            {/* A rule, not a slogan: flowRules drops the coordinates and the
                backend strips EXIF. Said here, where we ask for an identity,
                rather than buried in a policy page. */}
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                background: C.tint,
                borderRadius: 16,
                padding: '13px 14px',
              }}
            >
              <ShieldCheck style={{ flex: 'none', marginTop: 1 }} />
              <div style={{ fontSize: 12, lineHeight: 1.55, color: C.slate }}>
                Reports use your participant ID, not your name. Exact location stays private.
              </div>
            </div>

            <TextButton onClick={() => nav('/map')} style={{ fontSize: 13.5, color: C.dim, padding: 9 }}>
              Keep browsing without an ID
            </TextButton>
          </>
        )}
      </div>
    </div>
  );
}
