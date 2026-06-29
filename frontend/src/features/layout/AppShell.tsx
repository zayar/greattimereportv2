import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { navigationSections, type NavigationIconName, type NavigationItem } from "./navigation";
import { useAccess } from "../access/AccessProvider";
import { useSession } from "../auth/SessionProvider";
import { canAccessAiAgentMonitoring, canAccessAiControlPanel } from "../ai/adminAccess";
import { EmptyState, ErrorState, ScreenLoader } from "../../components/StatusViews";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "gt-v2report-sidebar-collapsed";
const SIDEBAR_GROUPS_STORAGE_KEY = "gt-v2report-sidebar-groups-v2";

function readStoredGroups() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_GROUPS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function isNavigationItemActive(item: NavigationItem, pathname: string): boolean {
  if (item.to) {
    return item.to === pathname || pathname.startsWith(`${item.to}/`);
  }

  return item.children?.some((child) => isNavigationItemActive(child, pathname)) ?? false;
}

function findNavigationTrail(items: NavigationItem[], pathname: string, parents: string[] = []): string[] | null {
  for (const item of items) {
    const nextTrail = [...parents, item.label];

    if (item.to && (item.to === pathname || pathname.startsWith(`${item.to}/`))) {
      return nextTrail;
    }

    if (item.children?.length) {
      const childTrail = findNavigationTrail(item.children, pathname, nextTrail);
      if (childTrail) {
        return childTrail;
      }
    }
  }

  return null;
}

function getGroupKey(sectionTitle: string, path: string[], label: string) {
  return [sectionTitle, ...path, label].join(" / ");
}

function collectActiveGroupKeys(items: NavigationItem[], pathname: string, sectionTitle: string, path: string[] = []) {
  const keys = new Set<string>();

  for (const item of items) {
    if (!item.children?.length) {
      continue;
    }

    const key = getGroupKey(sectionTitle, path, item.label);

    if (isNavigationItemActive(item, pathname)) {
      keys.add(key);
    }

    collectActiveGroupKeys(item.children, pathname, sectionTitle, [...path, item.label]).forEach((childKey) =>
      keys.add(childKey),
    );
  }

  return keys;
}

function filterNavigationItems(
  items: NavigationItem[],
  canUseAiControlPanel: boolean,
  canUseAiAgentMonitoring: boolean,
): NavigationItem[] {
  return items.flatMap((item) => {
    if (item.requiresAiControlPanelAdmin && !canUseAiControlPanel) {
      return [];
    }
    if (item.requiresAiAgentMonitoringAdmin && !canUseAiAgentMonitoring) {
      return [];
    }

    if (!item.children?.length) {
      return [item];
    }

    const children = filterNavigationItems(item.children, canUseAiControlPanel, canUseAiAgentMonitoring);
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}

function NavIcon({ name }: { name: NavigationIconName | undefined }) {
  const iconName = name ?? "grid";

  switch (iconName) {
    case "activity":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12h4l2.5-7 4 14 2.5-7h3" />
        </svg>
      );
    case "ai":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v3" />
          <rect x="5" y="6" width="14" height="12" rx="4" />
          <path d="M8 18v2M16 18v2M9 11h.01M15 11h.01M9 15h6" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16" />
        </svg>
      );
    case "chart":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 16l3-4 3 2 4-7" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 11l3 3L21 5" />
          <path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8" />
        </svg>
      );
    case "clipboard":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="3" width="8" height="4" rx="1" />
          <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
        </svg>
      );
    case "customers":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.85M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "document":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5M9 13h6M9 17h4" />
        </svg>
      );
    case "inventory":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4 9-4V7" />
          <path d="M12 11v10" />
        </svg>
      );
    case "layers":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3L3 8l9 5 9-5-9-5z" />
          <path d="M3 13l9 5 9-5" />
        </svg>
      );
    case "package":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 8l-9-5-9 5 9 5 9-5z" />
          <path d="M3 8v8l9 5 9-5V8" />
          <path d="M12 13v8" />
        </svg>
      );
    case "payment":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M7 15h4" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6V20a2 2 0 1 1-4 0v-.06a1.7 1.7 0 0 0-1-.54 1.7 1.7 0 0 0-1.87.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H4a2 2 0 1 1 0-4h.06a1.7 1.7 0 0 0 .54-1 1.7 1.7 0 0 0-.34-1.87l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6V4a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1 .54 1.7 1.7 0 0 0 1.87-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 9c.2.34.4.66.6 1H20a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-.54 1z" />
        </svg>
      );
    case "tag":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V4h9l8.6 8.6a2 2 0 0 1 0 2.8z" />
          <circle cx="7.5" cy="8.5" r="1" />
        </svg>
      );
    case "telegram":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 4L3 11.5l6 2.2L11.5 20l3.2-4.4 4.8 3L21 4z" />
          <path d="M9 13.7L21 4" />
        </svg>
      );
    case "wallet":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7V6a2 2 0 0 1 2-2h12" />
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M17 13h.01" />
        </svg>
      );
    case "grid":
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`nav-group__chevron ${open ? "nav-group__chevron--open" : ""}`} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 4l6 6-6 6" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M21 4v16" />
    </svg>
  );
}

export function AppShell() {
  const { loading, error, clinics, canSwitchClinics, currentBusiness, currentClinic, selectClinic } = useAccess();
  const { gtUser, logout } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(readStoredGroups);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  });
  const location = useLocation();
  const canUseAiControlPanel = canAccessAiControlPanel(gtUser?.email);
  const canUseAiAgentMonitoring = canAccessAiAgentMonitoring(gtUser?.email);
  const visibleNavigationSections = useMemo(
    () =>
      navigationSections
        .map((section) => ({
          ...section,
          items: filterNavigationItems(section.items, canUseAiControlPanel, canUseAiAgentMonitoring),
        }))
        .filter((section) => section.items.length > 0),
    [canUseAiAgentMonitoring, canUseAiControlPanel],
  );

  const pageTrail = useMemo(() => {
    for (const section of visibleNavigationSections) {
      const trail = findNavigationTrail(section.items, location.pathname);

      if (trail) {
        return [section.title, ...trail];
      }
    }

    return ["GreatTime", "Reports"];
  }, [location.pathname, visibleNavigationSections]);

  const pageTitle = pageTrail[pageTrail.length - 1] ?? "GT V2 Report";
  const pageContext = pageTrail.slice(0, -1).join(" / ");

  const activeGroupKeys = useMemo(() => {
    const keys = new Set<string>();

    for (const section of visibleNavigationSections) {
      collectActiveGroupKeys(section.items, location.pathname, section.title).forEach((key) => keys.add(key));
    }

    return keys;
  }, [location.pathname, visibleNavigationSections]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SIDEBAR_GROUPS_STORAGE_KEY, JSON.stringify(expandedGroups));
  }, [expandedGroups]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (sidebarOpen) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }

    return undefined;
  }, [sidebarOpen]);

  if (loading) {
    return <ScreenLoader label="Loading your clinic access..." />;
  }

  if (error && !currentClinic) {
    return (
      <div className="status-screen">
        <div className="status-card">
          <ErrorState label="Access could not be loaded" detail={error} />
          <button className="button button--secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (!currentClinic || !currentBusiness) {
    return (
      <div className="status-screen">
        <div className="status-card">
          <EmptyState
            label="No clinic access assigned"
            detail="This account authenticated correctly, but it does not currently have any allowed clinic assignments."
          />
          <button className="button button--secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  function toggleGroup(groupKey: string) {
    setExpandedGroups((current) => ({ ...current, [groupKey]: !(current[groupKey] ?? false) }));
  }

  function renderNavigationItems(items: NavigationItem[], sectionTitle: string, depth = 0, path: string[] = []): ReactNode {
    return items.map((item) => {
      if (item.children?.length) {
        const active = isNavigationItemActive(item, location.pathname);
        const groupKey = getGroupKey(sectionTitle, path, item.label);
        const open = !sidebarCollapsed && (expandedGroups[groupKey] ?? activeGroupKeys.has(groupKey));

        return (
          <div
            key={groupKey}
            className={`nav-group ${active ? "nav-group--active" : ""} ${open ? "nav-group--open" : ""}`.trim()}
          >
            <button
              type="button"
              className="nav-group__button"
              onClick={() => toggleGroup(groupKey)}
              aria-expanded={open}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="nav-link__icon">
                <NavIcon name={item.icon} />
              </span>
              <span className="nav-link__text">{item.label}</span>
              <ChevronIcon open={open} />
            </button>
            {open ? (
              <div className="nav-group__children">
                {renderNavigationItems(item.children, sectionTitle, depth + 1, [...path, item.label])}
              </div>
            ) : null}
          </div>
        );
      }

      return (
        <NavLink
          key={item.to}
          to={item.to!}
          className={({ isActive }) =>
            `nav-link ${depth > 0 ? "nav-link--nested" : ""} ${isActive ? "nav-link--active" : ""}`.trim()
          }
          onClick={() => setSidebarOpen(false)}
          title={sidebarCollapsed ? item.label : undefined}
          aria-label={item.label}
        >
          <span className="nav-link__icon" aria-hidden="true">
            <NavIcon name={item.icon} />
          </span>
          <span className="nav-link__text">{item.label}</span>
        </NavLink>
      );
    });
  }

  return (
    <div
      className={`shell ${sidebarCollapsed ? "shell--sidebar-collapsed" : ""} ${
        sidebarOpen ? "shell--sidebar-open" : ""
      }`.trim()}
    >
      <button
        type="button"
        className="shell__backdrop"
        onClick={() => setSidebarOpen(false)}
        aria-label="Close navigation"
      />
      <aside className={`shell__sidebar ${sidebarOpen ? "shell__sidebar--open" : ""}`.trim()} aria-label="Primary navigation">
        <div className="sidebar-head">
          <div className="brand">
            <div className="brand__mark">GT</div>
            <div className="brand__copy">
              <div className="brand__title">
                <strong>GreatTime</strong>
                <span className="brand__badge">Reports</span>
              </div>
              <span className="brand__subtitle">Clinic systems</span>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <CloseIcon />
          </button>
          <button
            type="button"
            className="sidebar-collapse"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="sidebar-collapse__glyph" aria-hidden="true">
              {sidebarCollapsed ? "›" : "‹"}
            </span>
            <span className="sidebar-collapse__label">{sidebarCollapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>

        <div className="sidebar-context">
          <span>Workspace</span>
          <strong>{currentClinic.name}</strong>
          <small>{currentBusiness.name}</small>
        </div>

        <nav className="nav-sections">
          {visibleNavigationSections.map((section) => (
            <div key={section.title} className="nav-section">
              <span className="nav-section__title">{section.title}</span>
              {renderNavigationItems(section.items, section.title)}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="identity-chip">
            <strong>{gtUser?.name ?? gtUser?.email ?? "Authenticated user"}</strong>
            <span>{(gtUser?.roles ?? []).join(", ") || "Role not set"}</span>
          </div>
          <button
            className="button button--ghost sidebar-signout"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
          >
            <span className="sidebar-signout__icon" aria-hidden="true">
              <LogOutIcon />
            </span>
            <span className="sidebar-signout__label">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="shell__main">
        <header className="topbar">
          <div className="topbar__left">
            <button
              type="button"
              className="menu-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="Open navigation"
              aria-expanded={sidebarOpen}
            >
              <MenuIcon />
            </button>
            <div className="topbar__location">
              <span className="topbar__eyebrow">{pageContext}</span>
              <span className="topbar__title">{pageTitle}</span>
            </div>
          </div>

          <div className="topbar__controls">
            <NavLink className="topbar__ask" to="/ai/agent-hub">
              <SparklesIcon />
              <span>Ask GT</span>
            </NavLink>
            {canSwitchClinics ? (
              <label className="field field--compact topbar__clinic-field">
                <span>Clinic</span>
                <select value={currentClinic.id} onChange={(event) => selectClinic(event.target.value)}>
                  {clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.code ? `${clinic.name} (${clinic.code})` : clinic.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="topbar__context-pill">
                <span>Clinic</span>
                <strong>{currentClinic.name}</strong>
              </div>
            )}
            <div className="topbar__account" title={gtUser?.email ?? undefined}>
              <span>{gtUser?.name ?? gtUser?.email ?? "User"}</span>
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
