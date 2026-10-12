import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cleanupDestination,
  cleanupDoneDestination,
  confirmedCleanupBands,
} from "./cleanupFlow";
import { CleanupGuide } from "./components/CleanupGuide";
import {
  validNickname,
  readPreviewProfile,
  savePreviewProfile,
} from "./accountPreview";
import content from "./content/coastalContent.json";

describe("cleanup journey", () => {
  it("returns to the originating event, and Home for standalone cleanups", () => {
    expect(cleanupDoneDestination("morib-2026-10-03")).toBe(
      "/events/morib-2026-10-03",
    );
    expect(cleanupDoneDestination(null)).toBe("/home");
    expect(cleanupDestination("morib", "event / 1")).toBe(
      "/cleanup/morib?event=event%20%2F%201",
    );
  });
  it("preserves other types when confirming one reduced band", () => {
    const before = { Plastic: "Large", Glass: "Small" } as const;
    expect(confirmedCleanupBands(before, "Plastic", "Medium")).toEqual({
      Plastic: "Medium",
      Glass: "Small",
    });
    expect(before.Plastic).toBe("Large");
    expect(() => confirmedCleanupBands(before, "Plastic", "Large")).toThrow();
    expect(() => confirmedCleanupBands(before, "Glass", "Medium")).toThrow();
    expect(() => confirmedCleanupBands(before, "Metal", "Small")).toThrow();
  });
  it("retains only the last step after a cleanup, without inventing a destination", () => {
    const before = renderToStaticMarkup(<CleanupGuide />);
    const after = renderToStaticMarkup(<CleanupGuide recorded />);
    expect(before).toContain("Prepare");
    expect(before).toContain("Sort as you go");
    expect(after).not.toContain("Sort as you go");
    expect(after).not.toContain("Prepare");
    expect(after).toContain("Drop off your bags");
    expect(after).toContain("Drop-off point not confirmed");
    expect(after).toContain("A recycling point has not been confirmed");
    expect(after).toContain("take your bags with you");
    for (const html of [before, after]) {
      expect(html).not.toMatch(/\[(Drop-off point name|Recycling point name|DD-MM-YYYY)\]/);
      expect(html).not.toContain("Checked by Radar Pantai");
      expect(html).not.toContain("Open in Maps");
    }
    expect(after).toContain('href="tel:999"');
  });
  it('keeps the event cleanup guidance image-free', () => {
    const eventGuide = renderToStaticMarkup(<CleanupGuide imageFree />);
    expect(eventGuide).not.toContain('<img');
    expect(eventGuide).toContain('Prepare');
    expect(eventGuide).toContain('Sort as you go');
  });
});
describe("preview profile", () => {
  it("rejects short names and contact details", () => {
    expect(validNickname("ab")).toBe(false);
    expect(validNickname("name@example.com")).toBe(false);
    expect(validNickname("+60 123456789")).toBe(false);
    expect(validNickname("TideWatcher")).toBe(true);
  });
  it("keeps preferences separate for each participant", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    });
    savePreviewProfile("1", {
      nickname: "TideWatcher",
      joinedLeaderboard: true,
    });
    expect(readPreviewProfile("1").joinedLeaderboard).toBe(true);
    expect(readPreviewProfile("2")).toEqual({
      nickname: "",
      joinedLeaderboard: false,
    });
    vi.unstubAllGlobals();
  });
});
describe("handoff content integrity", () => {
  it("keeps the complete, uniquely addressable catalogue and botanical filter", () => {
    expect(content.beaches).toHaveLength(101);
    expect(new Set(content.beaches.map((b) => b.id)).size).toBe(101);
    expect(content.species).toHaveLength(38);
    expect(content.species.filter((s) => s.category === "plant")).toHaveLength(
      12,
    );
    expect(content.regions).toHaveLength(9);
    for (const b of content.beaches)
      for (const id of b.species)
        expect(content.species.some((s) => s.id === id)).toBe(true);
  });
});
