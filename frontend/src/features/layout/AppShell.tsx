import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { navigationSections, type NavigationItem } from "./navigation";
import { useAccess } from "../access/AccessProvider";
import { useSession } from "../auth/SessionProvider";
import { EmptyState, ErrorState, ScreenLoader } from "../../components/StatusViews";

function flattenNavigationItems(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) => (item.children ? flattenNavigationItems(item.children) : [item]));
}

function isNavigationItemActive(item: NavigationItem, pathname: string): boolean {
  if (item.to) {
    return item.to === pathname;
  }

  return item.children?.some((child) => isNavigationItemActive(child, pathname)) ?? false;
}

export function AppShell() {
  const { loading, error, businesses, currentBusiness, currentClinic, selectBusiness, selectClinic } =
    useAccess();
  const { gtUser, logout } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const pageTitle = useMemo(() => {
    const items = navigationSections.flatMap((section) => flattenNavigationItems(section.items));
    const currentItem =
      items.find((item) => item.to === location.pathname) ??
      items.find((item) => item.to && location.pathname.startsWith(`${item.to}/`));

    return currentItem?.label ?? "GT V2 Report";
  }, [location.pathname]);

  const hidesShellSelectors =
    location.pathname === "/dashboard" || location.pathname === "/dashboard/overview";

  if (loading) {
    return <ScreenLoader label="Loading your clinics and businesses..." />;
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
        >
          <span>{item.label}</span>
        </NavLink>
      );
    });
  }

  return (
    <div className="shell">
      <aside className={`shell__sidebar ${sidebarOpen ? "shell__sidebar--open" : ""}`.trim()}>
        <div className="brand">
          <div className="brand__mark">GT</div>
          <div className="brand__copy">
            <strong>GreatTime Reports</strong>
            <span>Minimal clinic workspace</span>
          </div>
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
          <button className="button button--ghost" onClick={() => void logout()}>
            Sign out
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

          {!hidesShellSelectors ? (
            <div className="topbar__controls">
              <label className="field field--compact">
                <span>Business</span>
                <select
                  value={currentBusiness.id}
                  onChange={(event) => selectBusiness(event.target.value)}
                >
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field field--compact">
                <span>Clinic</span>
                <select value={currentClinic.id} onChange={(event) => selectClinic(event.target.value)}>
                  {currentBusiness.clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
