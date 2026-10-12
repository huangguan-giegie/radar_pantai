import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import appSource from "./App.tsx?raw";
import previewSource from "./screens/InsightsScreen.tsx?raw";

const state = vi.hoisted(() => ({
  topic: "",
  beachId: undefined as string | undefined,
  loading: false,
  error: null as string | null,
  data: null as any,
  actions: new Map<string, () => unknown>(),
  refresh: vi.fn(),
  request: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async (original) => ({
  ...await original<typeof import("react-router-dom")>(),
  useNavigate: () => state.navigate,
  useParams: () => ({ topic: state.topic, beachId: state.beachId }),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock("./AppContext", () => ({ useApp: () => ({ reportsVersion: 1 }) }));
vi.mock("./iteration3Api", () => ({ iteration3Request: (...args: unknown[]) => state.request(...args) }));
vi.mock("./useAsyncData", () => ({
  useAsyncData: () => ({ data: state.data, loading: state.loading, error: state.error, refresh: state.refresh }),
}));
vi.mock("./components/CoastalUI", async (original) => {
  const components = await original<typeof import("./components/CoastalUI")>();
  return {
    ...components,
    CoastalPage: ({ children, title }: { children: ReactNode; title: string }) => <main><h1>{title}</h1>{children}</main>,
    ActionTile: (props: { title: string; subtitle: string; icon: ReactNode; onClick: () => void }) => {
      state.actions.set(props.title, props.onClick);
      return <components.ActionTile {...props} />;
    },
    DataUnavailable: ({ title, retry }: { title: string; retry?: () => unknown }) => {
      if (retry) state.actions.set("Retry", retry);
      return <section>{title}{retry && <button>Retry</button>}</section>;
    },
  };
});
vi.mock("./components/ui", async (original) => ({
  ...await original<typeof import("./components/ui")>(),
  Skeleton: () => <span>Loading placeholder</span>,
}));

import LiveInsightsScreen from "./screens/LiveInsightsScreen";

function summary() {
  const beach = {
    id: "morib", name: "Pantai Morib", area: "Selangor", severity: "High",
    eligibleReportCount: 3, latestContributingReportAt: "2026-10-04T12:00:00Z",
    trend: { eligible: false, currentBand: "High", previousBand: null, direction: null, previousAsOf: "2026-09-05", message: "Insufficient data to compare" },
    composition: [{ category: "Plastic", percentage: 100, band: "Very Large" }],
    leadingCategories: ["Plastic"], evidence: { sufficiency: "Sufficient data", freshnessLabel: "Recently reported" },
    needsVolunteers: { flag: false, reasons: [], nextEventJoinedCount: "Fewer than 3", href: "/beach/morib", eventMessage: null },
  };
  return {
    asOf: "2026-10-05", overview: { countedReports: 3, recordedCleanups: 0, joinedParticipants: "Fewer than 3", sufficientBeaches: 1, needsVolunteers: 0 },
    headlines: [], headlinesEmptyState: "Not enough recent reports to generate insights yet.", beaches: [beach],
    trends: { monthlyReports: { months: ["2026-09", "2026-10"], beaches: [{ beachId: "morib", counts: [0, 3] }], caption: "Report counts reflect reporting activity, not the true amount of litter. Zero means no reports, not zero litter." } },
    cleanup: {
      recent: [], emptyState: "Not enough cleanups recorded yet.",
      hardestToClear: { eligible: false, categories: [], emptyState: "Not enough cleanups recorded yet." },
      handling: { eligible: false, statuses: [], label: "Participant-recorded handling; this does not verify disposal or recycling.", emptyState: "Not enough cleanups recorded yet." },
      recurrence: { beaches: [], emptyState: "Not enough cleanups recorded yet." },
    },
    participation: {
      steps: [{ key: "joined", label: "Joined participants", count: "Fewer than 3" }, { key: "recordedAttendance", label: "Recorded attendances", count: "Fewer than 3" }],
      conversions: [{ from: "joined", to: "recordedAttendance", percentage: null }],
      caption: "Recorded attendance does not prove cleanup work was completed.",
    },
    evidence: { windowDays: 90, sufficientBeachCount: 1, countedNote: "Counted is community evidence accepted for calculation, not expert verification.", beaches: [{ beachId: "morib", beachName: "Pantai Morib", statuses: { countedActive: 3, countedResolved: 2, duplicate: 1, incomplete: 0 }, eligibleReportCount: 3, latestContributingReportAt: "2026-10-04T12:00:00Z", sufficiency: "Sufficient data", freshnessLabel: "Recently reported" }] },
    wildlife: { beaches: [{ beachId: "morib", beachName: "Pantai Morib", species: [{ id: "green-sea-turtle", name: "Green Sea Turtle", relativeOccurrenceScore: 0.73, locationMatchScore: 0.91, source: { label: "OBIS model", url: "https://obis.org/" }, reviewDate: "2026-10-05", destination: "/species/green-sea-turtle" }], sourceStatus: "ready", coordinateContext: { requestedLatitude: 2.746, requestedLongitude: 101.44, usedLatitude: 2.75, usedLongitude: 101.35, method: 'nearest_marine_grid', moved: true, distanceKm: 10, maxDistanceKm: 15, requestedInsideMalaysianEez: false } }] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.topic = "";
  state.beachId = undefined;
  state.loading = false;
  state.error = null;
  state.data = summary();
  state.actions.clear();
});

describe("live Insights acceptance display", () => {
  it("uses a neutral empty headline state without substituting design fixtures", () => {
    state.data.overview.countedReports = 0;
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Not enough recent reports to generate insights yet.");
    expect(markup).not.toContain("Preview");
    expect(markup).toContain("Counted reports are accepted community evidence");
  });

  it("renders placeholders while the summary is pending", () => {
    state.loading = true;
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Loading placeholder");
    expect(markup).not.toContain("Pantai Morib");
    expect(markup).not.toContain("Insights could not be loaded");
  });

  it("shows a Retry action after a summary error", () => {
    state.error = "Connection unavailable";
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Insights could not be loaded");
    expect(markup).toContain("Retry");
    state.actions.get("Retry")?.();
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(markup).not.toContain("Pantai Morib");
  });

  it("keeps insufficient trend comparison separate from available composition and report activity", () => {
    state.topic = "trends";
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Insufficient data to compare");
    expect(markup).toContain("Plastic");
    expect(markup).toContain("100%");
    expect(markup).toContain("2026-09: 0 reports");
    expect(markup).toContain("Zero means no reports, not zero litter");
  });

  it("offers every required insight topic and keeps volunteers as a supplemental entry", () => {
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup.match(/class="action-tile press"/g)).toHaveLength(6);
    for (const topic of ['Trends', 'Cleanup', 'Participation', 'Evidence', 'Marine Life', 'Volunteers']) {
      expect(state.actions.has(topic)).toBe(true);
    }
    state.actions.get('Evidence')?.();
    expect(state.navigate).toHaveBeenCalledWith('/insights/evidence');
    expect(markup).toContain("not expert verification");
  });

  it("routes both evidence URLs to Insights and preserves the teammate filter label", () => {
    expect(appSource).toContain('<Route path="/insights/:topic" element={<InsightsScreen />} />');
    expect(appSource).toContain('<Route path="/insights/:topic/:beachId" element={<InsightsScreen />} />');
    expect(appSource).not.toMatch(/<Route path="\/insights\/evidence(?:\/:beachId)?" element={<Navigate/);
    expect(previewSource).toContain('["Severe", "High", "Moderate", "Low", "Insufficient Data"]');
    expect(previewSource).not.toContain('["Very high", "High", "Moderate", "Low", "Insufficient Data"]');
  });

  it("shows backend report statuses and evidence coverage for all four pilot beaches", () => {
    state.topic = "evidence";
    const otherBeaches = [
      { beachId: 'bagan', beachName: 'Pantai Bagan Lalang', statuses: { countedActive: 2, countedResolved: 0, duplicate: 0, incomplete: 1 }, eligibleReportCount: 2, latestContributingReportAt: '2026-08-17T08:00:00Z', sufficiency: 'Insufficient data', freshnessLabel: 'Reported 50 days ago' },
      { beachId: 'remis', beachName: 'Pantai Remis', statuses: { countedActive: 0, countedResolved: 0, duplicate: 0, incomplete: 0 }, eligibleReportCount: 0, latestContributingReportAt: null, sufficiency: 'Insufficient data', freshnessLabel: 'Not recently reported' },
      { beachId: 'kelanang', beachName: 'Pantai Kelanang', statuses: { countedActive: 4, countedResolved: 1, duplicate: 0, incomplete: 0 }, eligibleReportCount: 4, latestContributingReportAt: '2026-10-05T06:00:00Z', sufficiency: 'Sufficient data', freshnessLabel: 'Recently reported' },
    ];
    state.data.evidence.beaches.push(...otherBeaches);
    state.data.beaches.push(...otherBeaches.map(beach => ({ ...state.data.beaches[0], id: beach.beachId, name: beach.beachName })));
    state.data.evidence.sufficientBeachCount = 2;
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain('<h1>Evidence</h1>');
    expect(markup).toContain('Evidence coverage · last 90 days');
    expect(markup).toContain('<strong>2</strong><span>of 4 pilot beaches have sufficient data</span>');
    expect(markup).toContain('Pantai Morib report status counts in the last 90 days: Counted Active: 3, Counted Resolved: 2, Duplicate: 1, Incomplete: 0');
    expect(markup).toContain('width:50%');
    expect(markup.match(/report status counts in the last 90 days:/g)).toHaveLength(4);
    expect(markup).toContain('active eligible Counted reports in the last 90 days');
    expect(markup).toContain('04/10/2026');
    expect(markup).toContain('Sufficient data');
    expect(markup).toContain('Insufficient data');
    expect(markup).toContain('Recently reported');
    expect(markup).toContain('Reported 50 days ago');
    expect(markup).toContain('Not recently reported');
    expect(markup).toContain('No contributing report');
    expect(markup).toContain('No reports recorded in the last 90 days.');
    expect(markup).not.toContain('NaN');
    expect(markup).toContain('Counted is community evidence accepted for calculation, not expert verification.');
  });

  it("shows only the requested beach evidence without inferring another beach's counts", () => {
    state.topic = "evidence";
    state.beachId = "missing-beach";
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Beach evidence not found");
    expect(markup).not.toContain("Pantai Morib report status counts");
  });

  it.each([undefined, { windowDays: 90, beaches: [], sufficientBeachCount: 0, countedNote: "" }])("offers retry when the evidence aggregate is missing or empty", (evidence) => {
    state.topic = "evidence";
    state.data.evidence = evidence;
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Evidence is not available yet");
    state.actions.get("Retry")?.();
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(markup).not.toContain("0 of");
  });

  it("keeps the evidence loading and error states recoverable without displaying stale counts", () => {
    state.topic = "evidence";
    state.loading = true;
    const pending = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(pending).toContain("Loading placeholder");
    expect(pending).not.toContain("report status counts");
    state.loading = false;
    state.error = "Connection unavailable";
    const failed = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(failed).toContain("Insights could not be loaded");
    expect(failed).not.toContain("report status counts");
    state.actions.get("Retry")?.();
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it("displays suppressed small participation counts without inferring conversion percentages", () => {
    state.topic = "participation";
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Fewer than 3");
    expect(markup).toContain("Insufficient data");
    expect(markup.replace(/<[^>]*>/g, "")).not.toContain("100%");
  });

  it("shows confirmed before-and-after bands without displaying cleanup scores", () => {
    state.topic = "cleanup";
    state.data.cleanup.recent = [{ beachId: "morib", beachName: "Pantai Morib", date: "2026-10-04", categories: [{ category: "Plastic", beforeBand: "Large", afterBand: "Small" }], cleanupScore: 2, handling: "Not recorded", status: "Resolved — source report kept in history" }];
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Cleanup Recorded");
    expect(markup).toContain("Large → Small");
    expect(markup).toContain("Resolved — source report kept in history");
    expect(markup).not.toContain("Cleanup Score");
  });

  it("distinguishes location match from raw wildlife scores and discloses the nearby reference", () => {
    state.topic = "wildlife";
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup).toContain("Location match: 91/100");
    expect(markup).toContain("Raw relative model score: 0.73");
    expect(markup).not.toContain("73%");
    expect(markup).not.toContain("91%");
    expect(markup).toContain("not confirmed sightings");
    expect(markup).toContain("an occurrence probability");
    expect(markup).toContain("Marine-grid reference: 2.7500, 101.3500");
    expect(markup).toContain("10.0 km from the beach");
    expect(markup).toContain("15 km search limit");
    expect(markup).toContain('href="https://obis.org/"');
  });

  it("preserves the supplied wildlife order instead of sorting species by raw score", () => {
    state.topic = "wildlife";
    const first = state.data.wildlife.beaches[0].species[0];
    first.relativeOccurrenceScore = 0.01;
    state.data.wildlife.beaches[0].species.push({ ...first, id: 'moorish-idol', name: 'Moorish idol', relativeOccurrenceScore: 0.99, locationMatchScore: 0.85, destination: '/species/moorish-idol' });
    const markup = renderToStaticMarkup(<LiveInsightsScreen />);
    expect(markup.indexOf('Green Sea Turtle')).toBeLessThan(markup.indexOf('Moorish idol'));
    expect(markup).toContain('Raw relative model score: 0.01');
    expect(markup).toContain('Location match: 85/100');
  });
});
