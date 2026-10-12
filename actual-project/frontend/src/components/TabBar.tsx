import { useLocation, useNavigate } from "react-router-dom";
import { BarChart, CommunityIcon, HomeIcon, Pin, UserIcon } from "./Icon";
const TABS = [
  { to: "/map", label: "Map", Icon: Pin },
  { to: "/insights", label: "Insights", Icon: BarChart },
  { to: "/home", label: "Home", Icon: HomeIcon },
  { to: "/community", label: "Community", Icon: CommunityIcon },
  { to: "/account", label: "Account", Icon: UserIcon },
];
export function TabBar() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav className="coastal-tabs" aria-label="Main navigation">
      {TABS.map(({ to, label, Icon }) => (
        <button
          key={to}
          onClick={() => nav(to)}
          className={to === "/home" ? "home-tab" : ""}
          aria-current={
            pathname === to || (to !== "/home" && pathname.startsWith(to + "/"))
              ? "page"
              : undefined
          }
        >
          <span className="tab-icon">
            <Icon size={22} color="currentColor" />
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
