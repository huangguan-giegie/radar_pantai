// The welcome screen. Its one job is to offer two doors:
//
//   "See What's Out There"  -> the home page, with no account at all
//   "Count Me In"           -> get a participant number, then the home page
//
// Looking comes first on purpose. Asking a stranger to sign up before they
// have seen anything is the fastest way to lose them, and browsing genuinely
// needs no identity in this app - only filing a report does.
//
// The small line under the two buttons says the same thing in plain words.
// People hesitate at a sign up button because they expect to be asked for an
// email; that line answers it before they have to worry about it.
import { useNavigate } from 'react-router-dom';
import { C, MONO, NOISE } from '../theme';
import { Pin } from '../components/Icon';

// Morib Beach at dusk, the walk the headline is talking about. Like the photo
// on Home it is one of the four beaches in this app and ships with the app, so
// opening it sends nothing to a photo site. The file was only resized.
//
// CC BY-SA 4.0 requires credit, shown under the buttons. The author has no
// Commons user page, so the name is plain text and the link goes to the file.
const WELCOME_PHOTO = {
  src: '/home/morib-beach-dusk.jpg',
  place: 'Morib Beach',
  author: 'Ajayrb135',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Morib_Beach.jpg',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
};

export default function WelcomeScreen() {
  const nav = useNavigate();

  return (
    <div
      className="screen"
      style={{
        zIndex: 50,
        // The old sky gradient stays underneath as the colour shown while the
        // photo loads, or if it never does - the text is readable on both.
        background: 'linear-gradient(180deg,#4E6FA8 0%,#2E4F86 45%,#102E5C 100%)',
      }}
      /* Three layers over the photo: a light grain, a dark band at the top for
         the place label, and a dark wash at the bottom. The wash is not
         decoration - it is what keeps the white headline readable over sand. */
    >
      <img
        src={WELCOME_PHOTO.src}
        alt=""
        aria-hidden="true"
        draggable={false}
        fetchPriority="high"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          // Right of centre, so a narrow phone still gets the tree line and
          // the lamps along the path, not only sky and sand.
          objectPosition: '56% center',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.2, backgroundImage: NOISE }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(7,20,44,.5) 0%,transparent 22%,transparent 40%,rgba(7,20,44,.72) 66%,rgba(7,20,44,.92) 100%)' }} />

      <div
        style={{
          position: 'absolute',
          top: 'calc(var(--top-inset) + 8px)',
          left: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '.2em',
          color: 'rgba(232,238,245,.86)',
        }}
      >
        <i style={{ width: 6, height: 6, borderRadius: 3, background: C.lime, display: 'block' }} />
        SDG 14 · LIFE BELOW WATER
      </div>

      <div
        /* className="measure" caps the text column at 640px and centres it.
           On a phone nothing changes; on a laptop it stops the headline from
           stretching across the whole window, which is unreadable. This one
           class is how the same code serves both, with no separate web build. */
        className="measure"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '24px 24px calc(var(--safe-bottom) + 36px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 41, lineHeight: 1.06, fontWeight: 620, letterSpacing: '-1.2px', color: C.bg }}>
          Every beach walk
          <br />
          can make a difference.
        </div>
        <div style={{ fontSize: 14.5, lineHeight: 1.55, color: 'rgba(232,238,245,.82)', maxWidth: 310 }}>
          Explore Malaysia’s beaches, report litter, and support cleaner coasts for marine life.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => nav('/home')}
            className="btn-primary press"
            style={{
              height: 56,
              borderRadius: 18,
              background: C.bg,
              color: C.navy,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              fontSize: 15.5,
              fontWeight: 650,
              boxShadow: '0 14px 34px -12px rgba(0,0,0,.5)',
            }}
          >
            <Pin size={16} color={C.navy} strokeWidth={2} />
            See What's Out There
          </button>
          <button
            type="button"
            onClick={() => nav('/identity?next=/home')}
            className="btn-ghost press"
            style={{
              height: 56,
              borderRadius: 18,
              background: 'rgba(255,255,255,.12)',
              backdropFilter: 'blur(8px)',
              border: '1.5px solid rgba(255,255,255,.35)',
              color: C.bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15.5,
              fontWeight: 650,
            }}
          >
            Count Me In
          </button>
          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(221,227,236,.7)', lineHeight: 1.5 }}>
            You’ll only need to sign in to save your activity.
          </div>
          {/* Same credit format as Home and the species cards. */}
          <div style={{ textAlign: 'center', fontSize: 9.5, color: 'rgba(221,227,236,.55)', lineHeight: 1.5 }}>
            Photo:{' '}
            <a href={WELCOME_PHOTO.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
              {WELCOME_PHOTO.place}
            </a>{' '}
            by {WELCOME_PHOTO.author} ·{' '}
            <a href={WELCOME_PHOTO.licenseUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
              {WELCOME_PHOTO.license}
            </a>{' '}
            <span style={{ whiteSpace: 'nowrap' }}>· Wikimedia Commons</span>
          </div>
        </div>
      </div>
    </div>
  );
}
