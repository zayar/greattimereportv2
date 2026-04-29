import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { navigationSections, type NavigationItem } from "./navigation";
import { useAccess } from "../access/AccessProvider";
import { useSession } from "../auth/SessionProvider";
import { AiLanguageSelector } from "../ai/AiLanguageSelector";
import { EmptyState, ErrorState, ScreenLoader } from "../../components/StatusViews";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "gt-v2report-sidebar-collapsed";

function flattenNavigationItems(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) => (item.children ? flattenNavigationItems(item.children) : [item]));
}

function getNavigationMonogram(label: string): string {
  const tokens = label
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return "•";
  }

  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }

  return tokens
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() ?? "")
    .join("");
}

function isNavigationItemActive(item: NavigationItem, pathname: string): boolean {
  if (item.to) {
    return item.to === pathname;
  }

  return item.children?.some((child) => isNavigationItemActive(child, pathname)) ?? false;
}

export function AppShell() {
  const { loading, error, clinics, canSwitchClinics, currentBusiness, currentClinic, selectClinic } = useAccess();
  const { gtUser, logout } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  });
  const location = useLocation();

  const pageTitle = useMemo(() => {
    const items = navigationSections.flatMap((section) => flattenNavigationItems(section.items));
    const currentItem =
      items.find((item) => item.to === location.pathname) ??
      items.find((item) => item.to && location.pathname.startsWith(`${item.to}/`));

    return currentItem?.label ?? "GT V2 Report";
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

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

  function renderNavigationItems(items: NavigationItem[], depth = 0): ReactNode {
    return items.map((item) => {
      if (item.children?.length) {
        const active = isNavigationItemActive(item, location.pathname);

        return (
          <div
            key={`${item.label}-${depth}`}
            className={`nav-group ${active ? "nav-group--active" : ""}`.trim()}
          >
            <div className="nav-group__label">{item.label}</div>
            <div className="nav-group__children">{renderNavigationItems(item.children, depth + 1)}</div>
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
            {getNavigationMonogram(item.label)}
          </span>
          <span className="nav-link__text">{item.label}</span>
        </NavLink>
      );
    });
  }

  return (
    <div className={`shell ${sidebarCollapsed ? "shell--sidebar-collapsed" : ""}`.trim()}>
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
          <span>{currentBusiness.name}</span>
          <strong>{currentClinic.name}</strong>
        </div>

        <nav className="nav-sections">
          {navigationSections.map((section) => (
            <div key={section.title} className="nav-section">
              <span className="nav-section__title">{section.title}</span>
              {renderNavigationItems(section.items)}
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
              ↩
            </span>
            <span className="sidebar-signout__label">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="shell__main">
        <header className="topbar">
          <div className="topbar__left">
            <button className="menu-toggle" onClick={() => setSidebarOpen((open) => !open)}>
              Browse
            </button>
            <div>
              <span className="topbar__eyebrow">{currentBusiness.name}</span>
              <h2>{pageTitle}</h2>
            </div>
          </div>

          <div className="topbar__controls">
            <AiLanguageSelector className="topbar__ai-field" />
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
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
