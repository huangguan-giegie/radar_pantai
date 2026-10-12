// Background - why this app exists.
//
// Two versions of one page, both from the Iteration 2 prototype:
//   /background/intro  shown once between the splash and the welcome screen.
//                      Three countries, "See the data" and "Skip".
//   /background        reached from the Background card on Home. All five
//                      countries, tap a region on the map for its share, and
//                      the caveat that none of this is about a single beach.
//
// The caveat matters more than the chart. These are national estimates of
// plastic entering the sea. Read carelessly they look like a verdict on
// Malaysian beaches, and this app's whole job is to separate what volunteers
// actually recorded at a beach from everything else.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SectionLabel } from '../components/ds';
import { Close, RadarMark } from '../components/Icon';
import { BackButton, TextButton } from '../components/ui';
import { useAppBack } from '../navigation';
import { PHOTOS } from '../visuals';
import {
  MALAYSIA_NOTE,
  OCEAN_PLASTIC_IMAGE,
  OCEAN_PLASTIC_SOURCE,
  OCEAN_PLASTIC_YEAR,
  OWID_CHART_URL,
  OWID_MALAYSIA_URL,
  OWID_MAP_URL,
  REGIONS,
  TOP_COUNTRIES,
  WORLD,
  owidCountryUrl,
  type RegionShare,
} from '../oceanPlastic';
import { C, MONO } from '../theme';

// Links out open in a new tab with no opener, the same as every other link to
// a data source in the app, so the volunteer's place in the app is kept.
const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

const IMAGE_ALT =
  'World map from Our World in Data shading each country by its share of global plastic waste emitted to the ocean in 2019. ' +
  'The Philippines, India and Malaysia are among the darkest.';

export default function BackgroundScreen({ intro = false }: { intro?: boolean }) {
  const nav = useNavigate();
  const goBack = useAppBack('/home');
  const [region, setRegion] = useState<RegionShare | null>(null);
  const countries = intro ? TOP_COUNTRIES.slice(0, 3) : TOP_COUNTRIES;
  const widest = TOP_COUNTRIES[0].percent;

  return (
    <div className="screen scroll-y" style={{ zIndex: 26, background: C.bg }}>
      <div className="measure i2-page anim-fade-up" style={{ paddingBottom: 'calc(var(--safe-bottom) + 34px)', gap: 14 }}>
        {!intro && <BackButton onClick={goBack} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 26, height: 26, borderRadius: 13, background: C.deep, display: 'grid', placeItems: 'center', flex: 'none' }}>
            <RadarMark size={18} />
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 680, color: C.ink3 }}>Radar Pantai</span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '.14em',
              color: C.dim,
              background: 'rgba(11,33,97,.06)',
              borderRadius: 10,
              padding: '5px 9px',
            }}
          >
            ABOUT US
          </span>
        </div>

        <div>
          <h1 className="i2-title">{intro ? 'Where ocean plastic comes from' : 'About Us'}</h1>
          <p className="i2-subtitle" style={{ fontSize: 13.5 }}>
            {intro
              ? 'Malaysia is the third largest source in the world. That is the problem behind every beach report here.'
              : 'Connecting beach litter, marine biodiversity and community action.'}
          </p>
        </div>

        {!intro && <>
          <figure className="page-cover" style={{ margin: 0 }}>
            <img src={PHOTOS.volunteers} alt="Volunteers collecting litter on a beach" />
            <figcaption>Beach cleanup volunteers · public domain · Wikimedia Commons</figcaption>
          </figure>
          <section className="coastal-summary" aria-labelledby="about-purpose">
            <p className="eyebrow">Radar Pantai</p>
            <h2 id="about-purpose" style={{ color: 'white', fontSize: 24, margin: 0 }}>Beach litter & marine biodiversity in Malaysia</h2>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: '#ffffffcc' }}>
              Marine litter can harm marine life and coastal habitats. Radar Pantai connects beach litter reports with marine biodiversity awareness, helping people understand our coast and take action together.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: '#ffffffcc' }}>Pantai means beach in Malay. Explore freely, and use an anonymous ID to contribute.</p>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[
                'Report litter with a photo. Review AI suggestions before submitting.',
                'Explore litter and biodiversity maps to understand beaches and their marine life.',
                'Discover species and habitats, and learn why reducing litter matters to them.',
                'Join community cleanups and record what you cleared.',
              ].map((line, i) => <li key={line} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 15, fontSize: 14, lineHeight: 1.4 }}>
                <span aria-hidden="true" style={{ color: C.lime, fontWeight: 700 }}>{i + 1}</span>{line}
              </li>)}
            </ol>
            <p style={{ color: '#ffffff99', fontSize: 11, marginTop: 22 }}>Built by a student team at Monash University Malaysia.</p>
          </section>
          <section aria-labelledby="about-sdgs">
            <SectionLabel>SDG GOALS</SectionLabel>
            <h2 id="about-sdgs" style={{ margin: '0 0 10px', fontSize: 22, color: C.navy }}>Our connection to the Global Goals</h2>
            <p className="subtle">Our focus on marine litter awareness and community participation supports UN Sustainable Development Goal 14: Life Below Water.</p>
            <div style={{ display: 'grid', gap: 10 }}>
              <article className="i2-card">
                <h3 style={{ margin: 0, fontSize: 16, color: C.navy }}>SDG 14 · Life Below Water</h3>
                <p className="subtle" style={{ margin: '8px 0' }}>Connect marine litter awareness with learning about coastal species and habitats.</p>
                <a href="https://sdgs.un.org/goals/goal14" {...EXTERNAL} style={{ color: C.navy, fontSize: 13 }}>Read UN Goal 14 ↗</a>
              </article>
            </div>
          </section>
          <SectionLabel>BACKGROUND</SectionLabel>
          <h2 style={{ margin: 0, fontSize: 22, color: C.navy }}>From plastic waste to the ocean</h2>
        </>}
        <div className="i2-card" style={{ padding: 13 }}>
          {/* On the intro the whole map is one link to the live chart. On the
              full page it is a map you can question: each continent is a tap
              target, and a tap anywhere else gives the world split. */}
          {intro ? (
            <a href={OWID_MAP_URL} {...EXTERNAL} aria-label="Open the ocean plastic map on Our World in Data" style={{ display: 'block' }}>
              <img src={OCEAN_PLASTIC_IMAGE} alt={IMAGE_ALT} style={{ width: '100%', display: 'block', borderRadius: 10 }} />
            </a>
          ) : (
            <div style={{ position: 'relative' }}>
              <img src={OCEAN_PLASTIC_IMAGE} alt={IMAGE_ALT} style={{ width: '100%', display: 'block', borderRadius: 10 }} />
              <button
                type="button"
                aria-label={`World: ${WORLD.share} of global ocean plastic. Show the regional split`}
                onClick={() => setRegion(WORLD)}
                style={{ position: 'absolute', inset: 0, background: 'transparent', borderRadius: 10 }}
              />
              {REGIONS.flatMap((r) =>
                r.hotspots.map((h, i) => (
                  <button
                    key={`${r.id}-${i}`}
                    type="button"
                    aria-label={`${r.name}: ${r.share} of global ocean plastic`}
                    onClick={() => setRegion(r)}
                    className="bg-region"
                    style={{
                      position: 'absolute',
                      left: `${h.left}%`,
                      top: `${h.top}%`,
                      width: `${h.width}%`,
                      height: `${h.height}%`,
                      background: 'transparent',
                      borderRadius: 8,
                    }}
                  />
                )),
              )}
            </div>
          )}
          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.04em', color: C.dim, marginTop: 9, lineHeight: 1.5 }}>
            Share of global plastic waste emitted to the ocean, {OCEAN_PLASTIC_YEAR}
          </div>
          {!intro && (
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.04em', color: C.navy, marginTop: 3 }}>
              Tap a region for its share
            </div>
          )}
        </div>

        <div className="i2-card">
          <SectionLabel size="sm">SHARE OF GLOBAL OCEAN PLASTIC · {OCEAN_PLASTIC_YEAR}</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
            {countries.map((c) => {
              const home = c.iso3 === 'MYS';
              return (
                <a
                  key={c.iso3}
                  href={owidCountryUrl(c.iso3)}
                  {...EXTERNAL}
                  aria-label={`${c.name}: ${c.share}. Open on Our World in Data`}
                  className="press"
                  style={{ display: 'grid', gridTemplateColumns: '96px 1fr 48px', alignItems: 'center', gap: 10, padding: '5px 0', color: 'inherit', textDecoration: 'none' }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: home ? 720 : 560, color: home ? C.ink : C.ink2 }}>{c.name}</span>
                  <span style={{ height: 8, borderRadius: 4, background: 'rgba(11,33,97,.07)', overflow: 'hidden' }}>
                    {/* Bars are scaled to the largest country, not to 100%,
                        so the differences between them stay visible. Malaysia
                        is the one bar in the accent colour. */}
                    <span style={{ display: 'block', height: '100%', width: `${(c.percent / widest) * 100}%`, borderRadius: 4, background: home ? C.lime : C.navy }} />
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 650, color: C.ink3, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {c.share}
                  </span>
                </a>
              );
            })}
          </div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{MALAYSIA_NOTE}</div>
        </div>

        {!intro && (
          <div style={{ background: C.tint, borderRadius: 16, padding: '11px 14px', fontSize: 13, lineHeight: 1.55, color: C.slate }}>
            These national estimates are background context. They do not measure litter or cleanliness at any single beach.
          </div>
        )}

        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.55 }}>
          Source: {OCEAN_PLASTIC_SOURCE}.{intro ? '' : ` Data year: ${OCEAN_PLASTIC_YEAR}.`}
        </div>

        {intro ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <a
              href={OWID_CHART_URL}
              {...EXTERNAL}
              className="btn-primary press"
              style={{
                minHeight: 54,
                borderRadius: 18,
                background: C.navy,
                color: C.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                fontSize: 15.5,
                fontWeight: 650,
                textDecoration: 'none',
                boxShadow: '0 16px 32px -14px rgba(11,33,97,.55)',
              }}
            >
              See the data <span aria-hidden="true" style={{ color: C.lime }}>↗</span>
            </a>
            {/* Skip goes where the splash used to go, so a returning volunteer
                is one tap from where they were before this page existed. */}
            <TextButton onClick={() => nav('/welcome', { replace: true })}>Skip</TextButton>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a
              href={OWID_MALAYSIA_URL}
              {...EXTERNAL}
              className="btn-ghost press"
              style={{
                minHeight: 46,
                borderRadius: 16,
                background: C.white,
                border: `1.5px solid ${C.line2}`,
                color: C.navy,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: 14.5,
                fontWeight: 620,
                textDecoration: 'none',
              }}
            >
              See the source <span aria-hidden="true">↗</span>
            </a>
            <TextButton onClick={() => nav('/home')}>Back to Home</TextButton>
          </div>
        )}
      </div>

      {region && <RegionDetail region={region} onClose={() => setRegion(null)} />}
    </div>
  );
}

/**
 * The card that opens when a region is tapped.
 *
 * A real dialog: focus moves into it, Escape closes it, and the backdrop is a
 * button - so a keyboard or screen-reader user gets the same way out as a
 * thumb. Focus goes back to the page when it closes.
 */
function RegionDetail({ region, onClose }: { region: RegionShare; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 900, display: 'grid', placeItems: 'center', padding: 20 }}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="anim-fade-in"
        style={{ position: 'absolute', inset: 0, width: '100%', background: 'rgba(9,22,48,.45)', backdropFilter: 'blur(3px)' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="region-name"
        className="anim-fade-up"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 362,
          background: C.white,
          borderRadius: 22,
          padding: '18px 20px 20px',
          boxShadow: '0 30px 60px -28px rgba(9,22,48,.6)',
        }}
      >
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="press"
          style={{ position: 'absolute', top: 10, right: 10, width: 44, height: 44, borderRadius: 22, display: 'grid', placeItems: 'center', background: 'transparent' }}
        >
          <Close size={13} color={C.muted} />
        </button>

        <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.14em', color: C.faint }}>
          REGION · OCEAN PLASTIC {OCEAN_PLASTIC_YEAR}
        </div>
        <div id="region-name" style={{ fontSize: 20, fontWeight: 700, color: C.ink3, marginTop: 8 }}>
          {region.name}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color: C.navy, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {region.share}
        </div>
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 4 }}>of the world total · Meijer et al. (2021)</div>

        <div style={{ height: 1, background: C.line, margin: '14px 0 12px' }} />

        <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.14em', color: C.faint }}>TOP CONTRIBUTORS IN THIS REGION</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {region.top.map(([name, share]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 620, color: C.ink2 }}>{name}</span>
              <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 650, color: C.ink3, fontVariantNumeric: 'tabular-nums' }}>{share}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 12, lineHeight: 1.5 }}>{region.note}</div>

        <a
          href={OWID_MAP_URL}
          {...EXTERNAL}
          className="btn-ghost press"
          style={{
            marginTop: 16,
            minHeight: 46,
            borderRadius: 16,
            background: C.white,
            border: `1.5px solid ${C.line2}`,
            color: C.navy,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontSize: 14,
            fontWeight: 620,
            textDecoration: 'none',
          }}
        >
          See the source <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  );
}
