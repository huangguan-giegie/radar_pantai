import { useLocation, useNavigate } from "react-router-dom";
import { BarChart, CommunityIcon, HomeIcon, Pin, UserIcon } from "./Icon";

/**
 * The five main destinations, and every URL that belongs to each of them.
 *
 * The invariant is that a page showing the tab bar lights up exactly one tab.
 * A bar with nothing lit says "you are nowhere", and it used to happen on two
 * groups of screens: My reports, and the marine life and habitat pages.
 * Neither has a tab of its own, so each is listed under the tab it belongs to.
 *
 * `owns` is a list of path prefixes rather than the tab's own `to`, because the
 * owning tab is not always a parent of the URL:
 *
 *   - My reports opens from Account, and Back from a single report goes there,
 *     so both /reports and /account light the same tab.
 *   - Marine life and the habitat pages are reached from the map's marine
 *     layer, and from the beach pages behind it.
 *
 * Add a new destination here and it is highlighted automatically; leave it out
 * and the bar goes blank again. tabBarSelection.test.tsx holds that line.
 */
export const TABS = [
  { to: "/map", label: "Map", Icon: Pin, owns: ["/map", "/marine-life", "/habitats"] },
  { to: "/insights", label: "Insights", Icon: BarChart, owns: ["/insights"] },
  { to: "/home", label: "Home", Icon: HomeIcon, owns: ["/home"] },
  { to: "/community", label: "Community", Icon: CommunityIcon, owns: ["/community"] },
  { to: "/account", label: "Account", Icon: UserIcon, owns: ["/account", "/reports"] },
];

/** True for the prefix itself and anything under it, but not for a lookalike
 *  such as "/map-room" - a bare startsWith would treat that as "/map". */
export function ownsPath(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function owningTab(pathname: string): typeof TABS[number] | null {
  return TABS.find(({ owns }) => owns.some((prefix) => ownsPath(prefix, pathname))) ?? null;
}

export function TabBar() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav className="coastal-tabs" aria-label="Main navigation">
      {TABS.map(({ to, label, Icon, owns }) => {
        const current = owns.some((prefix) => ownsPath(prefix, pathname));
        return (
          <button
            key={to}
            onClick={() => nav(to)}
            // Kept on Home whatever the page is: the raised disc is part of the
            // shape of the bar, and dropping it would make the other four tabs
            // jump sideways every time. Which tab is current is said by colour
            // (see iteration3.css) and by aria-current below.
            className={to === "/home" ? "home-tab" : ""}
            aria-current={current ? "page" : undefined}
          >
            <span className="tab-icon">
              <Icon size={22} color="currentColor" />
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
