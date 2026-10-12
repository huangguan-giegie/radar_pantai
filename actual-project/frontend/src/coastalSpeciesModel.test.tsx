import appSource from './App.tsx?raw';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { StaticRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ go: vi.fn() }));
const state = vi.hoisted(() => ({
  beachId: 'kelanang', beachName: 'Pantai Kelanang', lastReportedAt: null as string | null,
  galleryLoading: false, galleryError: null as string | null, refreshGallery: vi.fn(),
  cleanup: null as { id: string; createdAt: string } | null,
  cleanupLoading: false, cleanupError: null as string | null, refreshCleanup: vi.fn(),
  wildlifeLoading: false, wildlifeError: null as string | null, sourceStatus: 'published_reference',
  species: [{ name: 'Thalassina kelanang', scientificName: 'Thalassina kelanang', evidenceType: 'published_reference' }],
}));
vi.mock('react-router-dom', async original => ({
  ...await original<typeof import('react-router-dom')>(),
  useParams: () => ({ beachId: state.beachId, speciesId: 'thalassina-kelanang' }),
  useNavigate: () => navigation.go,
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
      beachId: state.beachId, sourceStatus: state.sourceStatus,
      species: state.species,
    } : load.toString().includes('fetchLatestCleanupForBeach') ? state.cleanup : Array.isArray(initial) ? [] : {
      id: state.beachId,
      name: state.beachName,
      area: 'Selangor',
      lat: 2.789,
      lng: 101.415,
      severity: null,
      insufficientData: true,
      validReports: 0,
      lastReportedAt: state.lastReportedAt,
      scene: '#edf2f8',
      habitat: 'Coastal habitat',
    },
    loading: load.toString().includes('getLitterGallery') ? state.galleryLoading
      : load.toString().includes('/wildlife') ? state.wildlifeLoading
      : load.toString().includes('fetchLatestCleanupForBeach') ? state.cleanupLoading : false,
    error: load.toString().includes('getLitterGallery') ? state.galleryError
      : load.toString().includes('/wildlife') ? state.wildlifeError
      : load.toString().includes('fetchLatestCleanupForBeach') ? state.cleanupError : null,
    refresh: load.toString().includes('getLitterGallery') ? state.refreshGallery
      : load.toString().includes('fetchLatestCleanupForBeach') ? state.refreshCleanup : vi.fn(),
  }),
}));

import CoastalBeachScreen from './screens/CoastalBeachScreen';
import { SpeciesScreen } from './screens/MarineLifeScreen';

const renderBeach = () => renderToStaticMarkup(
  <StaticRouter location="/beach/kelanang"><CoastalBeachScreen /></StaticRouter>,
);

beforeEach(() => {
  state.beachId = 'kelanang'; state.beachName = 'Pantai Kelanang'; state.lastReportedAt = null;
  state.galleryLoading = false; state.galleryError = null;
  state.cleanup = null; state.cleanupLoading = false; state.cleanupError = null;
  state.wildlifeLoading = false; state.wildlifeError = null; state.sourceStatus = 'published_reference';
  state.species = [{ name: 'Thalassina kelanang', scientificName: 'Thalassina kelanang', evidenceType: 'published_reference' }];
  vi.clearAllMocks();
  vi.stubGlobal('document', { activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), querySelector: () => null });
});
afterEach(() => vi.unstubAllGlobals());

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
    expect(html).not.toContain('Reference area');
    expect(html).not.toContain('Image credit &amp; licence');
    expect(html).toContain('Coastal references and model estimates are not confirmed sightings.');
    expect(html).not.toContain('Modelled Nearby Marine Species');
  });

  it('keeps each simplified photo card linked to its species guide with original attribution', () => {
    navigation.go.mockClear();
    let view: ReturnType<typeof create>;
    act(() => { view = create(<StaticRouter location="/beach/kelanang"><CoastalBeachScreen /></StaticRouter>); });
    const mudLobster = view!.root.findAllByType('button').find(button =>
      button.findAllByType('strong').some(label => label.children.includes('Mud Lobster')))!;
    expect(mudLobster).toBeDefined();
    act(() => mudLobster.props.onClick());
    expect(navigation.go).toHaveBeenCalledWith('/species/thalassina-kelanang?beach=kelanang');
    act(() => view!.unmount());

    const species = renderToStaticMarkup(
      <StaticRouter location="/species/thalassina-kelanang?beach=kelanang"><SpeciesScreen /></StaticRouter>,
    );
    expect(species).toContain('Sources &amp; Photo Credit');
    expect(species).toContain('Moh H. H. &amp; Chong V. C.');
    expect(species).toContain('https://zenodo.org/records/4509165');
    expect(species).toContain('https://creativecommons.org/licenses/by/4.0/');
  });

  it('does not replace a live null report date with the design catalogue date', () => {
    state.beachId = 'morib'; state.beachName = 'Pantai Morib';
    const empty = renderBeach();
    expect(empty).toContain('No counted reports yet');
    expect(empty).not.toContain('Reported 39 days ago');

    state.lastReportedAt = '2026-05-21T08:00:00Z';
    const historical = renderBeach();
    expect(historical).toContain('Last reported 21-05-2026 (Thu)');
    expect(historical).not.toContain('No counted reports yet');
  });

  it('distinguishes loading and failed galleries from a confirmed empty gallery, and retries failure', () => {
    state.galleryLoading = true;
    const loading = renderBeach();
    expect(loading).toContain('Loading public report photos');
    expect(loading).not.toContain('No public report photos yet.');
    state.galleryLoading = false; state.galleryError = 'Network unavailable';
    const failed = renderBeach();
    expect(failed).toContain('Could not load litter photos');
    expect(failed).not.toContain('No public report photos yet.');

    let view: ReturnType<typeof create>;
    act(() => { view = create(<StaticRouter location="/beach/kelanang"><CoastalBeachScreen /></StaticRouter>); });
    const retry = view!.root.findAllByType('button').find(button => button.children.includes('Try Again'))!;
    act(() => retry.props.onClick());
    expect(state.refreshGallery).toHaveBeenCalledOnce();
    act(() => view!.unmount());

    state.galleryError = null;
    expect(renderBeach()).toContain('No public report photos yet.');
  });

  it('keeps pending and failed cleanup requests visible, retries failures, and hides only confirmed empty records', () => {
    state.cleanupLoading = true;
    expect(renderBeach()).toContain('Loading cleanup records');
    state.cleanupLoading = false; state.cleanupError = 'Network unavailable';
    // Previously saved data must not make a failed refresh look successful.
    state.cleanup = { id: 'cleanup-old', createdAt: '2026-10-01T08:00:00Z' };
    const failed = renderBeach();
    expect(failed).toContain('Could not load the latest cleanup');
    expect(failed).not.toContain('View Recorded Change');
    let view: ReturnType<typeof create>;
    act(() => { view = create(<StaticRouter location="/beach/kelanang"><CoastalBeachScreen /></StaticRouter>); });
    const retry = view!.root.findAllByType('button').find(button => button.children.includes('Try Again'))!;
    act(() => retry.props.onClick());
    expect(state.refreshCleanup).toHaveBeenCalledOnce();
    act(() => view!.unmount());

    state.cleanupError = null; state.cleanup = null;
    const empty = renderBeach();
    expect(empty).not.toContain('Latest Recorded Cleanup');
    expect(empty).not.toContain('Could not load the latest cleanup');
    expect(empty).not.toContain('Loading cleanup records');

    state.cleanup = { id: 'cleanup-latest', createdAt: '2026-10-01T08:00:00Z' };
    const loaded = renderBeach();
    expect(loaded).toContain('Latest Recorded Cleanup');
    expect(loaded).toContain('01-10-2026 (Thu)');
    expect(loaded).toContain('View Recorded Change');
  });

  it.each(['empty', 'loading', 'error', 'modelled', 'published'] as const)('describes the actual %s marine evidence in the help sheet', kind => {
    state.beachId = 'pantai-air-batang-tioman'; state.beachName = 'Pantai Air Batang';
    state.species = [];
    if (kind === 'loading') state.wildlifeLoading = true;
    if (kind === 'error') state.wildlifeError = 'Network unavailable';
    if (kind === 'modelled' || kind === 'published') {
      state.species = [{ name: 'Greenfish', scientificName: 'Stichopus chloronotus', evidenceType: kind === 'modelled' ? 'modelled' : 'published_reference' }];
    }
    let view: ReturnType<typeof create>;
    act(() => { view = create(<StaticRouter location={'/beach/' + state.beachId}><CoastalBeachScreen /></StaticRouter>); });
    const help = view!.root.findByProps({ 'aria-label': 'About Marine Life Evidence', 'aria-haspopup': 'dialog' });
    act(() => help.props.onClick());
    const sheet = view!.root.findByProps({ role: 'dialog' });
    const text = sheet.findAllByType('p').map(paragraph => paragraph.children.join('')).join(' ');
    if (kind === 'empty') expect(text).toContain('No published reference or modelled context is currently available for Pantai Air Batang.');
    if (kind === 'loading') expect(text).toBe('Marine life evidence is still loading.');
    if (kind === 'error') expect(text).toContain('Marine life evidence could not be loaded.');
    if (kind === 'modelled') expect(text).toBe('Species are suggested from OBIS marine-grid data around a nearby coastal reference. They provide context, not confirmed sightings at this beach.');
    if (kind === 'published') expect(text).toBe('Published coastal references provide context, not confirmed sightings at this beach.');
    if (kind !== 'modelled' && kind !== 'published') expect(text).not.toContain('Published coastal references provide context');
    act(() => view!.unmount());
  });
});
