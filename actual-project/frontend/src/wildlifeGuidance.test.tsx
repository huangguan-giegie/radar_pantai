import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import WildlifeHelpScreen from "./screens/WildlifeHelpScreen";
import { SpeciesScreen } from "./screens/MarineLifeScreen";
import { WildlifeGuide } from "./components/CleanupGuide";
import { iteration3Request } from "./iteration3Api";
import type { WildlifeGuidance } from "./iteration3Personal";
import { WILDLIFE_GUIDANCE_FALLBACK } from "./wildlifeGuidance";

vi.mock("./iteration3Api", () => ({ iteration3Request: vi.fn() }));
let view: ReactTestRenderer;
afterEach(() => {
  if (view) act(() => view.unmount());
  vi.resetAllMocks();
});
function nodeText(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(nodeText).join("");
}
function phoneLinks() {
  return view.root.findAllByType("a").map(link => link.props.href).filter(href => href?.startsWith("tel:"));
}
function renderHelp() {
  act(() => { view = create(<MemoryRouter><WildlifeHelpScreen /></MemoryRouter>); });
}

describe("wildlife help availability", () => {
  it("keeps verified authority numbers available before the API responds", () => {
    vi.mocked(iteration3Request).mockReturnValue(new Promise(() => {}));
    renderHelp();
    expect(phoneLinks()).toContain("tel:1800885151");
    expect(phoneLinks()).toContain("tel:+60388885019");
    expect(JSON.stringify(view.toJSON())).toContain("stranded turtles");
  });

  it("keeps authority calls and safety advice available after an API failure", async () => {
    vi.mocked(iteration3Request).mockRejectedValue(new Error("Network unavailable"));
    renderHelp();
    await act(async () => {});
    expect(phoneLinks()).toContain("tel:999");
    expect(phoneLinks()).toContain("tel:1800885151");
    expect(phoneLinks()).toContain("tel:+60388885019");
    expect(JSON.stringify(view.toJSON())).toContain("Do not touch, move or disentangle the animal");
  });

  it("retains bundled numbers when an older API response omits a phone", async () => {
    const legacy = structuredClone(WILDLIFE_GUIDANCE_FALLBACK) as WildlifeGuidance;
    delete legacy.authorities[1].phone;
    delete legacy.authorities[1].telephoneUri;
    vi.mocked(iteration3Request).mockResolvedValue(legacy);
    renderHelp();
    await act(async () => {});
    expect(phoneLinks()).toContain("tel:+60388885019");
    expect(JSON.stringify(view.toJSON())).toContain("2026-10-09");
  });

  it("keeps locally reviewed cleanup advice visible when guidance is unavailable", async () => {
    vi.mocked(iteration3Request).mockRejectedValue(new Error("Network unavailable"));
    act(() => { view = create(<MemoryRouter><WildlifeGuide /></MemoryRouter>); });
    await act(async () => {});
    expect(JSON.stringify(view.toJSON())).toContain("Keep away from nests and burrows");
    expect(JSON.stringify(view.toJSON())).toContain("Reviewed");
  });

  it("opens wildlife help from the species detail page", () => {
    act(() => {
      view = create(<MemoryRouter initialEntries={["/species/green-sea-turtle"]}>
        <Routes>
          <Route path="/species/:speciesId" element={<SpeciesScreen />} />
          <Route path="/community/wildlife-help" element={<p>Wildlife help destination</p>} />
        </Routes>
      </MemoryRouter>);
    });
    const button = view.root.findAllByType("button").find(node => nodeText(node).includes("Hurt or Stranded Animal"));
    expect(button).toBeDefined();
    act(() => button!.props.onClick());
    expect(JSON.stringify(view.toJSON())).toContain("Wildlife help destination");
  });
});
