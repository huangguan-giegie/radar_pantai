import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoastalBeach } from "./coastalData";

const state = vi.hoisted(() => ({
  beaches: [] as CoastalBeach[],
  loading: true,
  error: null as string | null,
  getCoastalBeaches: vi.fn(),
  refresh: vi.fn(),
  retry: null as (() => unknown) | null,
}));

vi.mock("leaflet", () => ({ default: {} }));
vi.mock("./api", () => ({ USE_MOCK: false, getBeaches: vi.fn() }));
vi.mock("./AppContext", () => ({ useApp: () => ({ user: null, reportsVersion: 1, offline: false }) }));
vi.mock("./iteration2Api", () => ({ fetchCleanupEvents: vi.fn() }));
vi.mock("./iteration3Api", () => ({ iteration3Request: vi.fn() }));
vi.mock("./eventAvailability", async original => ({
  ...await original<typeof import("./eventAvailability")>(),
  useEventClock: () => Date.parse("2026-10-06T09:00:00+08:00"),
}));
vi.mock("./coastalData", async original => ({
  ...await original<typeof import("./coastalData")>(),
  getCoastalBeaches: state.getCoastalBeaches,
}));
vi.mock("./components/useLeafletMap", () => ({ useLeafletMap: () => ({
  elRef: { current: null }, mapRef: { current: null }, ready: false,
}) }));
vi.mock("./useAsyncData", () => ({
  useAsyncData: (load: unknown, _dependencies: unknown[], initial: unknown) => ({
    data: load === state.getCoastalBeaches ? state.beaches : Array.isArray(initial) ? [] : null,
    loading: load === state.getCoastalBeaches && state.loading,
    error: load === state.getCoastalBeaches ? state.error : null,
    refresh: state.refresh,
  }),
}));
vi.mock("./components/CoastalUI", async original => {
  const components = await original<typeof import("./components/CoastalUI")>();
  return {
    ...components,
    DataUnavailable: (props: { title: string; retry?: () => unknown }) => {
      if (props.retry) state.retry = props.retry;
      return <components.DataUnavailable {...props} />;
    },
  };
});

import MapScreen from "./screens/MapScreen";

const renderList = (search = "") => renderToStaticMarkup(
  <StaticRouter location={`/map?panel=beaches${search}`}><MapScreen /></StaticRouter>,
);

beforeEach(() => {
  state.beaches = [];
  state.loading = true;
  state.error = null;
  state.retry = null;
  state.refresh.mockClear();
});

describe("direct beach list", () => {
  it("shows loading inside the open list without claiming no beaches match", () => {
    const html = renderList();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('role="status">Loading beaches');
    expect(html).not.toContain("No matching beaches");
  });

  it("offers a working retry inside the list after the beach request fails", () => {
    state.loading = false;
    state.error = "Beach data is unavailable.";
    const html = renderList();
    expect(html).toContain("Could not load beaches");
    expect(html).toContain("Try Again");
    expect(html).not.toContain("No matching beaches");
    state.retry!();
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("makes every API beach available, including entries without map coordinates", () => {
    state.loading = false;
    state.beaches = Array.from({ length: 85 }, (_, index) => ({
      id: `expanded-${index}`, name: `Expanded Beach ${index}`, area: "Malaysia", region: "north",
      severity: null, validReports: 0, lat: null, lng: null, image: null, previewOnly: false,
    }));
    const html = renderList();
    for (const beach of state.beaches) expect(html).toContain(`${beach.name}</button>`);
    expect(html).not.toContain("No matching beaches");
    expect(renderList("&q=missing")).toContain("No matching beaches");
  });
});
