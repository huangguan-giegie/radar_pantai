import appSource from './App.tsx?raw';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', async original => ({
  ...await original<typeof import('react-router-dom')>(),
  useParams: () => ({ beachId: 'kelanang' }),
}));
vi.mock('./api', () => ({ USE_MOCK: false, getBeach: vi.fn() }));
vi.mock('./insightsApi', () => ({ fetchInsights: vi.fn(async () => ({ beaches: [{ id: 'kelanang', from: null, to: null, reportsPrevious30Days: 1, reportsLast30Days: 0, activeReports: 1, reports: 1 }], asOf: '2026-10-05', comparisonAt: '2026-09-05' })) }));
vi.mock('./AppContext', () => ({
  useApp: () => ({
    user: null,
    draft: {},
    resetDraft: vi.fn(),
    patchDraft: vi.fn(),
    setLastSavedReport: vi.fn(),
    reportsVersion: 1,
  }),
}));
vi.mock('./navigation', () => ({ useAppBack: () => vi.fn() }));
vi.mock('./eventAvailability', () => ({ useEventClock: () => Date.now(), eventIsAvailable: () => false }));
vi.mock('./useAsyncData', () => ({
  useAsyncData: (load: () => unknown, _dependencies: unknown, initial: unknown) => ({
    data: load.toString().includes('fetchInsights') ? {
      asOf: '2026-10-05', comparisonAt: '2026-09-05',
      beaches: [{ id: 'kelanang', from: null, to: null, reportsPrevious30Days: 1, reportsLast30Days: 0, activeReports: 1, reports: 1 }],
    } : load.toString().includes('/wildlife') ? {
      beachId: 'kelanang', sourceStatus: 'published_reference',
      species: [{ name: 'Thalassina kelanang', scientificName: 'Thalassina kelanang', evidenceType: 'published_reference' }],
    } : Array.isArray(initial) ? [] : {
      id: 'kelanang',
      name: 'Pantai Kelanang',
      area: 'Selangor',
      lat: 2.789,
      lng: 101.415,
      severity: null,
      insufficientData: true,
      validReports: 0,
      scene: '#edf2f8',
      habitat: 'Coastal habitat',
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import CoastalBeachScreen from './screens/CoastalBeachScreen';

const renderBeach = () => renderToStaticMarkup(
  <StaticRouter location="/beach/kelanang"><CoastalBeachScreen /></StaticRouter>,
);

describe('teammate frontend v2 beach integration', () => {
  it('keeps the production beach route on the teammate v2 beach screen', () => {
    expect(appSource).toContain("const BeachScreen = lazy(() => import('./screens/CoastalBeachScreen'));");
    expect(appSource).toContain('<Route path="/beach/:beachId" element={<BeachScreen />}');
    const html = renderBeach();
    expect(html).toContain('Nearby Marine Life');
    expect(html).not.toContain('Coastal context for Pantai Kelanang');
    expect(html).toContain('beach-marine-carousel');
    expect(html.indexOf('Nearby Marine Life')).toBeLessThan(html.indexOf('What You Can Do Here'));
    expect(html.indexOf('Nearby Marine Life')).toBeLessThan(html.indexOf('Litter Gallery'));
    expect(html).toContain('Species Guide');
  });

  it('keeps the teammate v2 beach action tiles', () => {
    const html = renderBeach();
    expect(html).toContain('What You Can Do Here');
    expect(html).toContain('Report Litter');
    expect(html).toContain('Join Cleanup');
    expect(html).toContain('Log Cleanup');
  });

  it('keeps the trend destination without the removed technical comparison block', () => {
    const html = renderBeach();
    expect(html).not.toContain('30-day Band Change');
    expect(html).toContain('See Changes Over Time');
    expect(html).toContain('Insufficient Data');
    expect(html).not.toContain('At least 3 active reports are needed in both 90-day windows');
  });

  it('keeps the wildlife explanation behind a help button and insets the sources link on phones', () => {
    const html = renderBeach();
    expect(html).toContain('wildlife-evidence-actions');
    expect(html).toContain('aria-label="About Marine Life Evidence"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('Marine Life Sources ↗');
    expect(html).not.toContain('Published coastal reference · not confirmed beach sightings');
  });

  it('uses the verified v2 species media on the beach page', () => {
    const html = renderBeach();
    expect(html).toContain('/images/coastal/thalassina-kelanang.jpg');
    expect(html).toContain('Thalassina kelanang');
    expect(html).toContain('Published reference');
    expect(html).toContain('Image credit &amp; licence');
    expect(html).not.toContain('Modelled Nearby Marine Species');
  });
});
