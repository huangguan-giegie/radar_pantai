import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  draft: { quantities: {}, beachId: null as string | null },
  reset: vi.fn(), patch: vi.fn(), saved: vi.fn(),
}));
vi.mock('./api', () => ({ USE_MOCK: false, apiRequest: vi.fn() }));
vi.mock('./AppContext', () => ({ useApp: () => ({ user: { participantId: 'TEST-PERSONAL' }, reportsVersion: 1,
  draft: state.draft, resetDraft: state.reset, patchDraft: state.patch, setLastSavedReport: state.saved }) }));
vi.mock('./useAsyncData', () => ({ useAsyncData: (load: () => unknown, _deps: unknown, initial: unknown) => ({
  data: load.toString().includes('/personal-insights') ? {
    sections: [{ id: 'since_cleanup', title: 'Since your cleanup', text: '', aiAssisted: false, sources: [],
      facts: { beachId: 'remis', beachName: 'Pantai Remis', intervalDays: null, daysSinceCleanup: 5 },
      action: { label: 'Report litter', path: '/report/photo?beach=remis' } }], links: { map: '/map', insights: '/insights' },
  } : initial,
  loading: !load.toString().includes('/personal-insights'), error: null, refresh: vi.fn(),
}) }));
import InsightsScreen from './screens/InsightsScreen';

let view: ReactTestRenderer;
const button = (label: string) => view.root.findAllByType('button').find(node =>
  node.children.includes(label) || node.findAllByType('strong').some(text => text.children.includes(label)))!;
function render() {
  act(() => { view = create(<MemoryRouter initialEntries={['/insights?panel=personal']}><Routes>
    <Route path="/insights" element={<InsightsScreen />} />
    <Route path="/report/photo" element={<p>Report photo destination</p>} />
  </Routes></MemoryRouter>); });
}
beforeEach(() => {
  state.draft = { quantities: {}, beachId: null }; vi.clearAllMocks();
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), querySelector: () => null });
});
afterEach(() => { if (view) act(() => view.unmount()); vi.unstubAllGlobals(); });

describe('personal follow-up reporting', () => {
  it('preselects the cleanup beach before opening the photo step', () => {
    render();
    act(() => button('Report Litter').props.onClick());
    expect(state.reset).toHaveBeenCalledOnce();
    expect(state.patch).toHaveBeenCalledWith({ beachId: 'remis', beachName: 'Pantai Remis', locationSource: 'manual', coords: null });
    expect(state.saved).toHaveBeenCalledWith(null);
    expect(JSON.stringify(view.toJSON())).toContain('Report photo destination');
  });

  it('preserves an existing draft until the participant chooses what to do', () => {
    state.draft.beachId = 'morib';
    render();
    act(() => button('Report Litter').props.onClick());
    expect(state.reset).not.toHaveBeenCalled();
    expect(state.patch).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain('Continue Draft');
  });
});
