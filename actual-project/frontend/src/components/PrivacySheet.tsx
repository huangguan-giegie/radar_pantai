import { C } from '../theme';
import { ShieldCheck } from './Icon';
import { GhostButton } from './ui';

// The two things GPS is used for, in the prototype's words. The second one is
// the duplicate check - a report with the same category and band within 10
// metres - which is the use a user would least expect. It stays on the list:
// a privacy explanation that leaves out the awkward use is worse than none,
// because it is the one they would object to if they found out later.
const POINTS = [
  'Suggest the correct beach',
  'Check nearby litter type and amount matches',
];

/**
 * The sheet behind "Why do we need this?".
 *
 * It appears where the question is asked, not in a policy page nobody opens.
 * It says what GPS is used FOR, that it is thrown away after the check, and
 * what other people can see - which is only ever the beach.
 */
export function PrivacySheet({ onClose }: { onClose: () => void }) {
  return (
    /* Above Leaflet's own layers, which sit between 400 and 700. This sheet
       opens on top of screens that have a map, and at a lower z-index the map
       would simply cover it. */
    <div style={{ position: 'absolute', inset: 0, zIndex: 900 }}>
      {/* The dark backdrop is a real <button>. Tapping outside to close is
          what people expect from a sheet, and making it a button means the
          keyboard and screen readers get that same way out - a div with an
          onClick gives them nothing. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="anim-fade-in"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(9,22,48,.45)',
          backdropFilter: 'blur(3px)',
          width: '100%',
        }}
      />
      <div
        className="anim-sheet-up measure"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: C.bg,
          borderRadius: '28px 28px 0 0',
          padding: '14px 22px calc(var(--safe-bottom) + 32px)',
        }}
      >
        {/* The grab handle. Purely a visual cue that this is a sheet which
            came up from the bottom, so the way to dismiss it is obvious. */}
        <div
          style={{
            width: 40,
            height: 4.5,
            borderRadius: 3,
            background: 'rgba(30,36,44,.15)',
            margin: '0 auto 18px',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              background: 'rgba(11,33,97,.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={19} color={C.navy} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-.4px' }}>
            Your privacy matters
          </div>
        </div>
        <div style={{ fontSize: 13, color: C.muted, margin: '14px 0 10px', lineHeight: 1.5 }}>
          GPS is used temporarily to:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {POINTS.map((p) => (
            <div key={p} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, color: C.ink2 }}>
              <i style={{ width: 5, height: 5, borderRadius: 3, background: C.navy, display: 'block', flex: 'none' }} />
              {p}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 16,
            background: C.navy,
            borderRadius: 18,
            padding: '15px 16px',
            color: C.cloud,
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        >
          {/* The strongest claim on the sheet, so it gets the dark box. The API
              turns the fix into a private proximity reference for the check
              and no public endpoint returns coordinates, only the beach. */}
          GPS is used for the check, then discarded. Others see only the beach.
        </div>
        <GhostButton onClick={onClose} height={52} style={{ marginTop: 14, borderRadius: 16, fontSize: 14.5, fontWeight: 640 }}>
          Understood
        </GhostButton>
      </div>
    </div>
  );
}
