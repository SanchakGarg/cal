import type { ReactNode } from "react";
import { useState } from "react";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Avatar } from "../ui/Layout.tsx";
import { Popover, DropdownMenu } from "../ui/Popover.tsx";
import { Link, useRouter } from "./router.tsx";
import { useAuth } from "./auth.tsx";
import { useTheme } from "./theme.tsx";
import "./Shell.css";

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  match: string[];
}

const NAV: NavItem[] = [
  { label: "Event Types", href: "/event-types", icon: "link", match: ["/event-types"] },
  { label: "Bookings", href: "/bookings/upcoming", icon: "calendar", match: ["/bookings"] },
  { label: "Availability", href: "/availability", icon: "clock", match: ["/availability"] },
  { label: "Teams", href: "/teams", icon: "users", match: ["/teams"] },
];

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { me, logout } = useAuth();
  const { path, navigate } = useRouter();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="cal-shell">
      <aside className={`cal-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="cal-sidebar__top">
          <Link to="/event-types" className="cal-sidebar__brand">
            <span className="cal-sidebar__logo">Cal</span>
          </Link>
          <button
            type="button"
            className="cal-sidebar__close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <nav className="cal-sidebar__nav">
          {NAV.map((item) => {
            const active = item.match.some((prefix) => path.startsWith(prefix));
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`cal-sidebar__link ${active ? "is-active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon name={item.icon} size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {me?.organizationId ? (
            <Link
              to="/settings/organization/members"
              className={`cal-sidebar__link ${path.startsWith("/settings/organization") ? "is-active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <Icon name="building" size={16} />
              <span>Organization</span>
            </Link>
          ) : null}
        </nav>

        <div className="cal-sidebar__footer">
          <Link to="/availability/troubleshoot" className="cal-sidebar__link">
            <Icon name="search" size={16} />
            <span>Troubleshoot</span>
          </Link>
          <Popover
            align="start"
            width={220}
            trigger={({ toggle, ref }) => (
              <button
                type="button"
                ref={ref as (node: HTMLButtonElement | null) => void}
                className="cal-sidebar__user"
                onClick={toggle}
              >
                <Avatar name={me?.name ?? "Guest"} src={me?.avatarUrl} size={28} />
                <span className="cal-sidebar__user-text">
                  <span className="cal-sidebar__user-name">{me?.name ?? "Guest"}</span>
                  <span className="cal-sidebar__user-handle">/{me?.username ?? ""}</span>
                </span>
                <Icon name="chevronUp" size={14} />
              </button>
            )}
          >
            {({ close }) => (
              <DropdownMenu
                close={close}
                items={[
                  { label: "My profile", onSelect: () => navigate("/settings/profile") },
                  { label: "General settings", onSelect: () => navigate("/settings/general") },
                  { label: "Out of office", onSelect: () => navigate("/settings/out-of-office") },
                  {
                    label: theme === "dark" ? "Light theme" : "Dark theme",
                    onSelect: () => setTheme(theme === "dark" ? "light" : "dark"),
                  },
                  { label: "View public page", onSelect: () => navigate(`/${me?.username ?? ""}`) },
                  {
                    label: "Sign out",
                    destructive: true,
                    onSelect: () => {
                      void logout().then(() => navigate("/auth/login"));
                    },
                  },
                ]}
              />
            )}
          </Popover>
        </div>
      </aside>

      <div className="cal-main">
        <header className="cal-topbar">
          <button
            type="button"
            className="cal-topbar__menu"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Icon name="dots" size={18} />
          </button>
          <span className="cal-topbar__brand">Cal</span>
        </header>
        <main className={`cal-content ${wide ? "is-wide" : ""}`}>{children}</main>
      </div>
    </div>
  );
}
