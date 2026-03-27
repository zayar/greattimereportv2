import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { navigationSections } from "./navigation";
import { useAccess } from "../access/AccessProvider";
import { useSession } from "../auth/SessionProvider";
import { EmptyState, ErrorState, ScreenLoader } from "../../components/StatusViews";

export function AppShell() {
  const { loading, error, businesses, currentBusiness, currentClinic, selectBusiness, selectClinic } =
    useAccess();
  const { gtUser, logout } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const pageTitle = useMemo(() => {
    const currentItem = navigationSections
      .flatMap((section) => section.items)
      .find((item) => item.to === location.pathname);

    return currentItem?.label ?? "GT V2 Report";
  }, [location.pathname]);

  const isDashboardLanding = location.pathname === "/dashboard";

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

  return (
    <div className="shell">
      <aside className={`shell__sidebar ${sidebarOpen ? "shell__sidebar--open" : ""}`.trim()}>
        <div className="brand">
          <div className="brand__mark">GT</div>
          <div>
            <strong>GT_V2Report</strong>
            <span>Modern reporting workspace</span>
          </div>
        </div>

        <nav className="nav-sections">
          {navigationSections.map((section) => (
            <div key={section.title} className="nav-section">
              <span className="nav-section__title">{section.title}</span>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? "nav-link--active" : ""}`.trim()
                  }
                  onClick={() => setSidebarOpen(false)}
                >
                  <span>{item.label}</span>
                  <small>{item.badge}</small>
                </NavLink>
              ))}
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
              Menu
            </button>
            <div>
              <span className="topbar__eyebrow">{currentBusiness.name}</span>
              <h2>{pageTitle}</h2>
            </div>
          </div>

          <div className="topbar__controls">
            {isDashboardLanding ? (
              <div className="topbar__workspace-note">
                No analytics are loaded until you choose a report.
              </div>
            ) : (
              <>
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
              </>
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
