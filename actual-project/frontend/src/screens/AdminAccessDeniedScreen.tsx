import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield } from '../components/Icon';
import { Alert, SectionLabel } from '../components/ds';
import { BackButton, GhostButton } from '../components/ui';
import { useApp } from '../AppContext';
import { C } from '../theme';

/**
 * The "SIGNED IN AS" strip at the top of the platform console. Both the console
 * and this refusal screen show it, so the person always sees which account the
 * decision was made for - green when the account may create activities, red
 * when it may not. The colour is never the only signal: the words say it too.
 */
export function SignedInBanner({ tone, children }: { tone: 'admin' | 'participant'; children: ReactNode }) {
  const admin = tone === 'admin';
  const color = admin ? C.green : C.red;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '10px 15px',
        borderRadius: 14,
        border: `1px solid ${admin ? 'rgba(23,122,62,.22)' : 'rgba(156,66,55,.22)'}`,
        background: admin ? C.greenBg : '#FFF0EE',
      }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: color, flex: 'none' }} />
      <span style={{ minWidth: 0 }}>
        <SectionLabel size="sm">SIGNED IN AS</SectionLabel>
        <strong style={{ display: 'block', marginTop: 2, color, fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>
          {children}
        </strong>
      </span>
    </div>
  );
}

export default function AdminAccessDeniedScreen() {
  const nav = useNavigate();
  const { user } = useApp();

  return (
    <div className="screen scroll-y" style={{ zIndex: 28 }}>
      <div className="measure i2-page anim-fade-up" style={{ paddingBottom: 'calc(var(--safe-bottom) + 34px)' }}>
        <BackButton onClick={() => nav('/community')} />
        <div>
          <SectionLabel size="sm">PLATFORM CONSOLE</SectionLabel>
          <h1 className="i2-title" style={{ marginTop: 7 }}>Create an activity</h1>
        </div>

        <SignedInBanner tone="participant">
          Participant account · Volunteer {user?.participantId}
        </SignedInBanner>

        <Alert title="Not authorised" tone="error">
          A participant account cannot create activities. Nothing was created.
        </Alert>

        <div className="i2-card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ width: 38, height: 38, borderRadius: 19, background: 'rgba(11,33,97,.07)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <Shield color={C.navy} />
          </span>
          <div>
            <strong style={{ display: 'block', color: C.ink2, fontSize: 14 }}>Platform access only</strong>
            <span style={{ display: 'block', marginTop: 4, color: C.muted, fontSize: 12.5, lineHeight: 1.5 }}>
              Activities are created by moderator accounts.
            </span>
          </div>
        </div>

        <GhostButton onClick={() => nav('/community')}>Back to Community</GhostButton>
      </div>
    </div>
  );
}
