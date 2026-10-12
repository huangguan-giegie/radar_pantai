import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ pathname: '/home' }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: testState.pathname }),
}));

import { TABS, TabBar, ownsPath, owningTab } from './components/TabBar';

// Every URL App.tsx shows the tab bar on. A page that shows the bar and lights
// no tab is telling the user they are nowhere, which is what happened on My
// reports and on the marine life and habitat pages.
//
// /reports/:id, /habitats/:id and /beach/:id are deliberately absent: those are
// focused screens with a Back button, and App.tsx hides the bar on them.
const TAB_BAR_ROUTES = [
  '/home',
  '/map',
  '/insights',
  '/insights/trends',
  '/community',
  '/community/needs-volunteers',
  '/account',
  '/account/leaderboard',
  '/reports',
  '/marine-life',
  '/habitats',
];

function markupFor(pathname: string): string {
  testState.pathname = pathname;
  return renderToStaticMarkup(<TabBar />);
}

function currentCount(markup: string): number {
  return markup.match(/aria-current="page"/g)?.length ?? 0;
}

describe('Tab bar selection', () => {
  it.each(TAB_BAR_ROUTES)('lights exactly one tab on %s', (pathname) => {
    expect(currentCount(markupFor(pathname))).toBe(1);
  });

  it('recognises a prefix and nothing that merely starts with it', () => {
    expect(ownsPath('/map', '/map')).toBe(true);
    expect(ownsPath('/map', '/map/pantai-morib')).toBe(true);
    expect(ownsPath('/map', '/map-room')).toBe(false);
    expect(ownsPath('/map', '/mapping')).toBe(false);
  });

  // My reports is opened from Account and Back from a single report returns
  // there. It has no tab of its own, so the Account tab is the honest answer.
  it('puts My reports under Account', () => {
    expect(owningTab('/reports')).toBe(TABS.find((tab) => tab.to === '/account'));
    expect(markupFor('/reports')).toContain('aria-current="page"');
  });

  // Both are reached from the map's marine layer.
  it('puts marine life and the habitat pages under Map', () => {
    expect(owningTab('/marine-life')?.to).toBe('/map');
    expect(owningTab('/habitats')?.to).toBe('/map');
    expect(owningTab('/habitats/mudflat')?.to).toBe('/map');
  });

  it('has one tab per destination, with no duplicates', () => {
    expect(TABS.map((tab) => tab.to)).toEqual(['/map', '/insights', '/home', '/community', '/account']);
    expect(new Set(TABS.map((tab) => tab.label)).size).toBe(TABS.length);
  });

  it('leaves an unknown page unlit rather than guessing', () => {
    expect(owningTab('/report/photo')).toBeNull();
    expect(currentCount(markupFor('/report/photo'))).toBe(0);
  });
});

describe('The raised Home disc', () => {
  // The disc is part of the shape of the bar. Dropping it on the other tabs
  // would shift the remaining four sideways on every navigation, so it keeps
  // its place and the selection is carried by aria-current instead.
  it('keeps its position on every page', () => {
    for (const pathname of ['/home', '/map', '/account', '/reports', '/insights']) {
      expect(markupFor(pathname)).toContain('class="home-tab"');
    }
  });

  // The rest of this fix is colour, and it hangs off the same attribute: see
  // `.coastal-tabs .home-tab[aria-current="page"] .tab-icon` in iteration3.css,
  // where the navy disc is scoped. That half cannot be asserted here without
  // either a browser or a stylesheet reader this project has no types for, so
  // it is checked in the usability run's screenshots instead. What this file
  // guarantees is the attribute those styles depend on.
  it('is marked current on Home only', () => {
    expect(markupFor('/home')).toContain('class="home-tab" aria-current="page"');
    const account = markupFor('/account');
    expect(account).toContain('class="home-tab"');
    expect(account).not.toContain('class="home-tab" aria-current="page"');
  });
});
