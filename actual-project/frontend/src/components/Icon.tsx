// Every icon in the app, written by hand as SVG.
//
// WHY NO ICON LIBRARY. A package would ship hundreds of icons to download so
// we could use fifteen, and it would be one more licence to check for a
// university submission. Written here they are a few hundred bytes, they all
// share one stroke weight, and none of them can change under us in a version
// bump.
//
// Every icon takes size, color and strokeWidth, so the same drawing works in a
// tab bar, on a dark photo and inside a button without a second copy.
import type { CSSProperties } from 'react';
import type { SpeciesGlyph } from '../types';

type Props = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
};

// The attributes shared by nearly every icon. Pulled out so the drawings
// below are just their path data - and so a change to the stroke style is one
// edit rather than fifteen. The round caps and joins are what make them look
// like one family instead of fifteen separate drawings.
function base(size: number, color: string, strokeWidth: number, style?: CSSProperties) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as 'round',
    strokeLinejoin: 'round' as 'round',
    style,
  };
}

export const ChevronLeft = ({ size = 13, color = '#26303F', strokeWidth = 2.4, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const ChevronRight = ({ size = 13, color = '#98A4B5', strokeWidth = 2.2, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const ArrowRight = ({ size = 15, color = '#B8FF36', strokeWidth = 2.2, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const Check = ({ size = 15, color = '#B8FF36', strokeWidth = 2.2, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const Camera = ({ size = 19, color = '#B8FF36', strokeWidth = 1.8, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.4" />
  </svg>
);

export const Upload = ({ size = 19, color = '#0B2161', strokeWidth = 1.8, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
    <path d="M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" />
  </svg>
);

export const Pin = ({ size = 18, color = '#0B2161', strokeWidth = 1.8, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M12 21c0 0-6.6-5.8-6.6-10.7A6.6 6.6 0 1 1 18.6 10.3C18.6 15.2 12 21 12 21Z" />
    <circle cx="12" cy="10.2" r="2.3" />
  </svg>
);

export const Shield = ({ size = 15, color = '#B8FF36', strokeWidth = 2, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6Z" />
  </svg>
);

export const ShieldCheck = ({ size = 15, color = '#3E4F6E', strokeWidth = 1.8, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6Z" />
    <path d="M9.5 12l1.8 1.8 3.4-3.6" />
  </svg>
);

export const MailIcon = ({ size = 21, color = '#0B2161', strokeWidth = 1.8, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)} aria-hidden="true">
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </svg>
);

export const Info = ({ size = 15, color = '#3E4F6E', strokeWidth = 1.8, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 7.6v.4" />
  </svg>
);

export const Alert = ({ size = 16, color = '#9C4237', strokeWidth = 1.9, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5M12 15.8v.4" />
  </svg>
);

export const Clock = ({ size = 15, color = '#5A6474', strokeWidth = 1.8, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const WifiOff = ({ size = 15, color = '#D9A24B', strokeWidth = 2, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M2 8.5a14 14 0 0 1 20 0M5.5 12a9 9 0 0 1 13 0M9 15.5a4.5 4.5 0 0 1 6 0" />
    <path d="M3 3l18 18" />
  </svg>
);

export const Close = ({ size = 11, color = '#5A6474', strokeWidth = 1.8, style }: Props) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" style={style}>
    <path d="M2 2l8 8M10 2l-8 8" />
  </svg>
);

export const Search = ({ size = 15, color = '#7A879B', strokeWidth = 2, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </svg>
);

export const BarChart = ({ size = 19, color = '#0B2161', strokeWidth = 1.8, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M4 19.5V13M9.3 19.5V8.5M14.7 19.5v-8M20 19.5V5" />
  </svg>
);

export const HomeIcon = ({ size = 21, color = 'currentColor', strokeWidth = 1.7, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M4 11.2 12 4.8l8 6.4V19a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 19Z" />
  </svg>
);

export const BookmarkIcon = ({ size = 21, color = 'currentColor', strokeWidth = 1.7, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <path d="M7 4.5h10a1.3 1.3 0 0 1 1.3 1.3v13.4a.8.8 0 0 1-1.2.7L12 17.2l-5.1 2.7a.8.8 0 0 1-1.2-.7V5.8A1.3 1.3 0 0 1 7 4.5Z" />
  </svg>
);

export const UserIcon = ({ size = 21, color = 'currentColor', strokeWidth = 1.7, style }: Props) => (
  <svg {...base(size, color, strokeWidth, style)}>
    <circle cx="12" cy="8.3" r="3.4" />
    <path d="M5.2 19.5a6.8 6.8 0 0 1 13.6 0" />
  </svg>
);

export const CommunityIcon = ({ size = 21, color = 'currentColor', strokeWidth = 1.7, style }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
    <circle cx="9" cy="8" r="3" />
    <circle cx="17" cy="9" r="2.3" />
    <path d="M3.8 19.2c.5-3.4 2.2-5.2 5.2-5.2s4.7 1.8 5.2 5.2M14.5 14.2c2.9-.7 4.9.8 5.5 3.8" />
  </svg>
);

const GLYPH_PATHS: Record<SpeciesGlyph, JSX.Element> = {
  turtle: (
    <>
      <ellipse cx="12" cy="12" rx="6.2" ry="4.8" />
      <circle cx="19.4" cy="12" r="1.7" />
      <path d="M8 8.2 6 6.4M16 8.2 18 6.4M8 15.8 6 17.6M16 15.8 18 17.6" />
      <path d="M12 7.2v9.6M8.4 10h7.2M8.4 14h7.2" />
    </>
  ),
  bird: <path d="M3 13.5Q7.5 7.5 12 13.5M12 13.5Q16.5 7.5 21 13.5" />,
  mangrove: (
    <>
      <path d="M12 4.5v8M12 12.5c0 3.5-3.5 3-4.6 6.5M12 12.5c0 3.5 3.5 3 4.6 6.5M12 15.5c0 2-1.6 2-2.2 3.5M12 15.5c0 2 1.6 2 2.2 3.5" />
      <circle cx="12" cy="5.5" r="3.2" />
    </>
  ),
  grass: <path d="M8 19c0-6-1.5-8-3-10M12 19c0-8 .5-10 2-13M16 19c0-6 1.8-7 3.4-9" />,
  crab: (
    <>
      <path d="M4.5 13a7.5 5.8 0 0 1 15 0l-1.4 3.5H5.9Z" />
      <path d="M12 16.5v4M9 7.5l-1.6-2M15 7.5l1.6-2" />
    </>
  ),
  fish: (
    <>
      <ellipse cx="10.5" cy="12" rx="6" ry="3.6" />
      <path d="M16.5 12l4-3v6Z" />
      <circle cx="7.8" cy="11.2" r=".6" />
    </>
  ),
};

export const SpeciesIcon = ({
  glyph,
  size = 20,
  color = '#0B2161',
}: { glyph: SpeciesGlyph } & Props) => (
  <svg {...base(size, color, 1.5)}>{GLYPH_PATHS[glyph] ?? GLYPH_PATHS.bird}</svg>
);

/** The radar mark used on the splash screen - the app's own logo. */
export const RadarMark = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
    <circle cx="15" cy="15" r="13" stroke="#B8FF36" strokeOpacity=".5" strokeWidth="1.4" />
    <path d="M15 6 A9 9 0 0 1 24 15" stroke="#B8FF36" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="15" cy="15" r="2.6" fill="#B8FF36" />
    <circle cx="20.5" cy="10" r="1.4" fill="#DDE3EC" />
  </svg>
);
