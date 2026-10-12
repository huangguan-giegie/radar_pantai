import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./AppContext', () => ({ useApp: () => ({ toast: null, authSyncError: null, retryAuth: vi.fn() }) }));
vi.mock('./screens/HomeScreen', () => ({ default: () => <p>Home destination</p> }));
vi.mock('./screens/MapScreen', () => ({ default: () => <p>Map destination</p> }));
vi.mock('leaflet', () => ({ default: {} }));
import App from './App';

function RouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output>{location.pathname + location.search}</output><button onClick={() => navigate(-1)}>Test Back</button></>;
}

let view: ReactTestRenderer;
async function render(entries: string[]) {
  await act(async () => { view = create(<MemoryRouter initialEntries={entries}><RouteProbe /><App /></MemoryRouter>); });
}
const path = () => view.root.findByType('output').children.join('');
const text = () => JSON.stringify(view.toJSON());

beforeEach(() => { vi.stubGlobal('document', { title: '' }); });
afterEach(() => { if (view) act(() => view.unmount()); vi.unstubAllGlobals(); });

describe('brand entry routing', () => {
  it.each(['/', '/splash'])('shows the real brand page at %s, with an immediately available entry action', async (entry) => {
    await render([entry]);
    expect(path()).toBe(entry);
    expect(text()).toContain('REPORT LITTER. SUPPORT CLEANUPS. PROTECT MARINE LIFE.');
    expect(text()).toContain('COMMUNITY BEACH LITTER REPORTING & CLEANUP SUPPORT FOR MALAYSIA © 2026');
    const button = view.root.findAllByType('button').find(node => node.children.includes('Get Started '));
    expect(button?.props.disabled).not.toBe(true);
    expect(view.root.findAllByType('nav')).toHaveLength(0);
    act(() => button!.props.onClick());
    expect(path()).toBe('/welcome');
    expect(text()).toContain('can make a difference.');
  });

  it('replaces the splash history entry so Back does not send the visitor through it again', async () => {
    await render(['/home', '/']);
    act(() => view.root.findAllByType('button').find(node => node.children.includes('Get Started '))!.props.onClick());
    act(() => view.root.findAllByType('button').find(node => node.children.includes('Test Back'))!.props.onClick());
    expect(path()).toBe('/home');
    expect(text()).toContain('Home destination');
  });

  it.each(['/home', '/map?region=selangor&marine=on'])('preserves the direct destination %s', async (entry) => {
    await render([entry]);
    expect(path()).toBe(entry);
    expect(text()).not.toContain('Get Started');
  });
});
