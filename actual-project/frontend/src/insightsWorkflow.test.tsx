import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ api: vi.fn(), data: null as any, wildlifeData: null as any, wildlifeLoading: false, wildlifeError: null as string | null }));
vi.mock('./api', () => ({ USE_MOCK: false, apiRequest: (...args: unknown[]) => state.api(...args) }));
vi.mock('./AppContext', () => ({ useApp: () => ({ user: null, reportsVersion: 1 }) }));
vi.mock('./iteration3Api', () => ({ iteration3Request: vi.fn(async () => null) }));
vi.mock('./coastalData', () => ({ getCoastalBeaches: vi.fn(async () => []) }));
vi.mock('./useAsyncData', () => ({
  useAsyncData: (load: () => Promise<unknown>, _dependencies: unknown, initial: unknown) => {
    void load();
    if (load.toString().includes('/insights/wildlife')) {
      return { data: state.wildlifeData, loading: state.wildlifeLoading, error: state.wildlifeError, refresh: vi.fn() };
    }
    return { data: load.toString().includes('fetchInsights') ? state.data : Array.isArray(initial) ? [] : null, loading: false, error: null, refresh: vi.fn() };
  },
}));

import InsightsScreen from './screens/InsightsScreen';

function render(location: string) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[location]}><Routes>
    <Route path="/insights/:topic?" element={<InsightsScreen />} />
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  state.api.mockReset();
  state.api.mockResolvedValue({});
  state.wildlifeData = null;
  state.wildlifeLoading = false;
  state.wildlifeError = null;
  state.data = {
    asOf: '2026-10-05T00:00:00Z', windowDays: 90, comparisonAt: '2026-09-05T00:00:00Z',
    comparisonBasis: 'Earlier bands are reconstructed from saved reports and dated cleanup records.',
    overview: { reports: 2, cleanups: 1, joined: 0, needHelp: 0, registeredBeaches: 1, beachesWithReports: 0, beachesWithBand: 0 },
    trendSummary: { changed: 0, movedUp: 0, movedDown: 0, noBand: 1, comparable: 0 },
    beaches: [{ id: 'morib', name: 'Pantai Morib', area: 'Selangor', photo: null, from: null, to: null, reports: 2, activeReports: 0,
      reportsLast30Days: 0, reportsPrevious30Days: 1, attentionScore: null, needsHelp: false, monthlyReports: [], composition: [], habitat: '', speciesNames: [] }],
    cleanup: { total: 1, evaluatedCleanups: 0, remaining: [], handling: [['Not recorded', 100]], history: [{ id: 'clean-1', beachId: 'morib', beachName: 'Pantai Morib', targetReportId: null, eventId: null, createdAt: '2026-10-04', handling: 'Not recorded', rows: [{ category: 'Plastic', removedBand: 'Medium' }], linked: false, nextReportedAt: null, daysUntilNextReport: null, daysSinceCleanup: 1 }] },
    participation: { all: [0, 0, 0], morib: [0, 0, 0] }, participationBasis: 'Person-event records.', wildlife: [],
  };
});

describe('production Insights scope and count labels', () => {
  it('requests cleanup aggregates and records for the selected beach', () => {
    render('/insights/cleanup?beach=morib');
    expect(state.api).toHaveBeenCalledWith('/insights?beachId=morib');
  });

  function prepareWildlifeEvidence() {
    const mvpIds = ['morib', 'remis', 'kelanang', 'bagan'];
    state.data.wildlife = Array.from({ length: 179 }, (_, index) => ({
      beachId: mvpIds[index] ?? 'beach-' + index,
      name: 'Coastal Beach ' + index,
      habitat: 'Coastal environment',
      // Legacy /insights wrongly presents the four modelled MVP beaches as
      // curated; the authoritative /insights/wildlife response must win.
      species: index < 101 ? ['Legacy species ' + index] : [],
      activeReports: 0,
      composition: [],
    }));
    state.wildlifeData = { beaches: state.data.wildlife.map((beach: any, index: number) => ({
      beachId: beach.beachId,
      sourceStatus: index < 4 || index >= 101 ? 'modelled' : 'published_reference',
      species: [{ name: index === 0 ? 'OBIS modelled turtle' : 'Evidence species ' + index,
        scientificName: 'Species ' + index, locationMatchScore: 0.8,
        evidenceType: index < 4 || index >= 101 ? 'modelled' : 'published_reference' }],
      coordinateContext: index < 4 || index >= 101 ? { distanceKm: 8.1 } : null,
    })) };
  }

  it('classifies 179 beaches by actual wildlife evidence (97 curated, 82 OBIS) and uses the MVP model results', () => {
    prepareWildlifeEvidence();
    const markup = render('/insights/wildlife');
    expect(markup).toContain('179');
    expect(markup).toContain('97 with curated reference data');
    expect(markup).toContain('82 with OBIS-derived model context');
    expect(markup).toContain('Coastal Beach 178');
    expect(markup).toContain('OBIS modelled turtle');
    expect(markup).not.toContain('Legacy species 0');
    expect(markup).toContain('Curated coastal reference');
    expect(markup).toContain('OBIS-derived marine-grid model');
    expect(markup).not.toContain('All registered beaches are listed.');
    expect(markup).not.toContain('no currently available species suggestion');
  });

  it('keeps missing-species fallback in individual cards without a warning paragraph above the list', () => {
    prepareWildlifeEvidence();
    state.wildlifeData.beaches.pop();
    const markup = render('/insights/wildlife');
    expect(markup).toContain('97 with curated reference data');
    expect(markup).toContain('81 with OBIS-derived model context');
    expect(markup).toContain('No species suggestion available');
    expect(markup).not.toContain('1 beach has');
    expect(markup).not.toContain('no currently available species suggestion');
    expect(markup).not.toContain('All registered beaches are listed.');
  });

  it('does not mistake loading or a failed wildlife request for unavailable species', () => {
    prepareWildlifeEvidence();
    state.wildlifeData = null;
    state.wildlifeLoading = true;
    const loading = render('/insights/wildlife');
    expect(loading).toContain('checking wildlife sources');
    expect(loading).not.toContain('no currently available species suggestion');
    state.wildlifeLoading = false;
    state.wildlifeError = 'network failed';
    const failure = render('/insights/wildlife');
    expect(failure).toContain('Wildlife source data temporarily unavailable');
    expect(failure).not.toContain('no currently available species suggestion');
    expect(failure).not.toContain('0 with curated reference data');
  });

  it('labels cleanup history and active scoring windows separately', () => {
    const markup = render('/insights/cleanup?beach=morib');
    expect(markup).toContain('Cleanup records · last 90 days');
    expect(markup).toContain('Active reports · latest 90 days');
    expect(markup).toContain('not litter-item counts');
  });
});
