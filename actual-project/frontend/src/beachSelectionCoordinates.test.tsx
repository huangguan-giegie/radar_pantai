import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  beaches: [] as any[],
  map: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [Array.isArray(initial) ? state.beaches : initial === true ? false : initial, vi.fn()],
}));
vi.mock("react-router-dom", async (original) => ({
  ...await original<typeof import("react-router-dom")>(),
  useNavigate: () => vi.fn(),
}));
vi.mock("./navigation", () => ({ useAppBack: () => vi.fn() }));
vi.mock("./AppContext", () => ({
  useApp: () => ({ draft: { beachId: "selected", coords: null, locationSource: "manual" }, patchDraft: vi.fn() }),
}));
vi.mock("./api", () => ({ getBeaches: vi.fn() }));
vi.mock("./components/MiniMap", () => ({
  MiniMap: (props: unknown) => { state.map(props); return null; },
}));

import ConfirmBeachScreen from "./screens/ConfirmBeachScreen";

beforeEach(() => {
  vi.clearAllMocks();
  state.beaches = [{ id: "selected", name: "Selected beach", area: "Malaysia", lat: null, lng: null, severity: null, insufficientData: true, validReports: 0 }];
});

describe("manual beach selection coordinates", () => {
  it("uses the broad default view when the selected beach has no verified coordinates", () => {
    const markup = renderToStaticMarkup(<ConfirmBeachScreen />);
    expect(state.map).toHaveBeenCalledWith({ lat: 4.05, lng: 109.5, zoom: 4 });
    expect(markup).toContain("Selected beach");
  });

  it("keeps long beach names and areas in their own non-shrinking rows on phones", () => {
    state.beaches = [
      { id: "long-1", name: "Adam and Eve Beach", area: "Northern Perhentian Kecil Island, Besut, Terengganu", lat: null, lng: null, severity: null, insufficientData: true, validReports: 0 },
      { id: "long-2", name: "Adventure Beach", area: "Penang National Park, near Teluk Bahang and Kampung Nelayan", lat: null, lng: null, severity: null, insufficientData: true, validReports: 0 },
    ];

    const markup = renderToStaticMarkup(<ConfirmBeachScreen />);
    const rows = markup.match(/<button[^>]*class="chip-hover"[^>]*>/g) ?? [];

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toContain("flex-shrink:0");
      expect(row).toContain("min-height:58px");
    }
    expect(markup).toContain("Northern Perhentian Kecil Island");
    expect(markup).toContain("Penang National Park");
    expect(markup).toContain("overflow-wrap:anywhere");
    expect(markup).toContain("scroll-y");
  });

  it("keeps a supported beach's verified coordinates", () => {
    state.beaches[0].lat = 2.746;
    state.beaches[0].lng = 101.44;
    renderToStaticMarkup(<ConfirmBeachScreen />);
    expect(state.map).toHaveBeenCalledWith({ lat: 2.746, lng: 101.44, zoom: 9 });
  });
});
