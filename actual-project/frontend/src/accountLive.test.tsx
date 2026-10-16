import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  section: "" as string,
  asyncCursor: 0,
  stateCursor: 0,
  nickname: "TideWatcher",
  validation: "",
  profile: { nickname: "TideWatcher", joinedLeaderboard: true, points: 6, rank: 2 as number | null },
  contributions: {
    points: 6,
    countedReports: 1,
    attendanceCount: 1,
    reportCount: 1,
    reportCounts: { counted: 1, duplicate: 0, incomplete: 0 },
    history: [
      { kind: "attendance", id: "event-1", points: 5, beachId: "morib", beachName: "Pantai Morib", createdAt: "2026-10-04T12:00:00Z" },
      { kind: "report", id: "report-1", points: 1, beachId: "morib", beachName: "Pantai Morib", createdAt: "2026-10-03T12:00:00Z" },
    ],
    asOf: "2026-10-06T00:00:00Z",
  },
  rows: [{ rank: 2, nickname: "TideWatcher", points: 6 }],
  actions: new Map<string, () => unknown>(),
  loaders: [] as (() => Promise<unknown>)[],
  request: vi.fn(),
  setProfile: vi.fn(),
  refreshBoard: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = state.stateCursor++;
      if (index === 0) return [state.nickname, (value: string) => { state.nickname = value; }];
      if (index === 1) return [state.validation, (value: string) => { state.validation = value; }];
      return [typeof initial === "function" ? initial() : initial, vi.fn()];
    },
  };
});
vi.mock("react-router-dom", async (original) => ({
  ...await original<typeof import("react-router-dom")>(),
  useNavigate: () => state.navigate,
  useParams: () => ({ section: state.section }),
}));
vi.mock("./AppContext", () => ({
  useApp: () => ({ user: { participantId: "1234" }, reportsVersion: 1, signOut: vi.fn(), showToast: state.toast }),
}));
vi.mock("./api", () => ({
  USE_MOCK: false,
  apiRequest: (...args: unknown[]) => state.request(...args),
  getMyReports: async () => [],
  getMyReportCounts: vi.fn(),
  storedRecoveryToken: () => null,
}));
vi.mock("./iteration2Api", () => ({ fetchCleanupEvents: vi.fn() }));
vi.mock("./useAsyncData", () => ({
  useAsyncData: (load: () => Promise<unknown>) => {
    const index = state.asyncCursor++;
    state.loaders.push(load);
    const data = [
      state.contributions,
      state.profile,
      state.section === "leaderboard" ? { entries: state.rows, asOf: "2026-10-06T00:00:00Z" } : null,
    ][index];
    return {
      data,
      setData: index === 1 ? state.setProfile : vi.fn(),
      loading: false,
      error: null,
      refresh: index === 2 ? state.refreshBoard : vi.fn(),
    };
  },
}));
vi.mock("./components/CoastalUI", async (original) => ({
  ...await original<typeof import("./components/CoastalUI")>(),
  CoastalPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("./components/ui", async (original) => {
  const actual = await original<typeof import("./components/ui")>();
  const button = ({ children, onClick }: { children: ReactNode; onClick?: () => unknown }) => {
    const label = renderToStaticMarkup(<>{children}</>);
    if (onClick) state.actions.set(label, onClick);
    return <button>{children}</button>;
  };
  return { ...actual, PrimaryButton: button, GhostButton: button };
});

import AccountScreen from "./screens/AccountScreen";

function renderAccount() {
  state.asyncCursor = 0;
  state.stateCursor = 0;
  state.actions.clear();
  state.loaders = [];
  return renderToStaticMarkup(<AccountScreen />);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.section = "";
  state.nickname = "TideWatcher";
  state.validation = "";
  state.profile = { nickname: "TideWatcher", joinedLeaderboard: true, points: 6, rank: 2 };
  state.rows = [{ rank: 2, nickname: "TideWatcher", points: 6 }];
  state.request.mockImplementation(async (url: string, method?: string, body?: Record<string, unknown>) => {
    if (url === "/account/contributions") return state.contributions;
    if (url === "/account/profile" && method === "PATCH") return { ...state.profile, ...body };
    if (url === "/account/profile") return state.profile;
    if (url === "/leaderboard") return { entries: state.rows, asOf: "2026-10-06T00:00:00Z" };
    return null;
  });
  state.refreshBoard.mockResolvedValue({ entries: state.rows, asOf: "2026-10-06T00:00:00Z" });
});

describe("backend v1 contribution account", () => {
  it("shows a bottom-of-Account Feedback link that opens a pre-addressed email draft", () => {
    const markup = renderAccount();
    expect(markup).toContain('href="mailto:1838217031@qq.com?subject=Radar%20Pantai%20Feedback"');
    expect(markup).toContain(">Feedback</strong>");
    expect(markup).toContain("Email the Radar Pantai team");
    expect(markup.indexOf(">Feedback</strong>")).toBeGreaterThan(markup.indexOf(">Sign Out</strong>"));
    // Feedback never sends messages through the backend or includes credentials.
    expect(markup).not.toContain("recoveryToken=");
    expect(state.request).not.toHaveBeenCalled();
  });

  it("loads the authenticated backend v1 profile and contributions", async () => {
    renderAccount();
    await state.loaders[0]();
    await state.loaders[1]();
    expect(state.request).toHaveBeenCalledWith("/account/contributions");
    expect(state.request).toHaveBeenCalledWith("/account/profile");
  });

  it("uses backend awarded points and contribution history", () => {
    state.section = "history";
    const markup = renderAccount();
    expect(markup).toContain("6");
    expect(markup).toContain("Recorded attendance");
    expect(markup).toContain("+5");
    expect(markup).toContain("Counted report");
    expect(markup).not.toContain("Preview");
  });

  it("shows backend leaderboard entries with backend ranks", async () => {
    state.section = "leaderboard";
    const markup = renderAccount();
    await state.loaders[2]();
    expect(state.request).toHaveBeenCalledWith("/leaderboard", "GET", undefined, 15_000, false);
    expect(markup).toContain("#2");
    expect(markup).toContain("TideWatcher");
    expect(markup).not.toContain("PenyuPal");
  });

  it("saves nickname through the backend v1 account profile endpoint", async () => {
    state.section = "nickname";
    renderAccount();
    await state.actions.get("Save Nickname")?.();
    await Promise.resolve(); await Promise.resolve();
    expect(state.request).toHaveBeenCalledWith("/account/profile", "PATCH", { nickname: "TideWatcher" });
    expect(state.setProfile).toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledWith("/account");
  });

  it("withdraws leaderboard consent through the backend v1 profile endpoint", async () => {
    state.section = "leaderboard";
    renderAccount();
    await state.actions.get("Leave Leaderboard")?.();
    expect(state.request).toHaveBeenCalledWith("/account/profile", "PATCH", { joinedLeaderboard: false });
  });

  it("rejects private contact information before a profile mutation", async () => {
    state.section = "nickname";
    state.nickname = "user@example.com";
    renderAccount();
    await state.actions.get("Save Nickname")?.();
    expect(state.request).not.toHaveBeenCalledWith("/account/profile", "PATCH", expect.anything());
  });

  it("shows a persistence error when leaving the leaderboard fails", async () => {
    state.section = "leaderboard";
    state.request.mockRejectedValue(new Error("Could not save your preference."));
    renderAccount();
    await state.actions.get("Leave Leaderboard")?.();
    await Promise.resolve(); await Promise.resolve();
    expect(state.setProfile).not.toHaveBeenCalled();
    const markup = renderAccount();
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Could not save your preference.");
  });
});
