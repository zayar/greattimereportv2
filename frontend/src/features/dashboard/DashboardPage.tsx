import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAccess } from "../access/AccessProvider";
import { buildDirectorySearch, directoryItems, type DirectoryGroup } from "./reportDirectory";

const directoryGroups: Array<{ id: DirectoryGroup; title: string }> = [
  { id: "Revenue", title: "Revenue" },
  { id: "Customers", title: "Customer intelligence" },
  { id: "Operations", title: "Operations" },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const { currentBusiness, currentClinic } = useAccess();

  const featuredItems = useMemo(
    () => directoryItems.filter((item) => item.group === "Featured"),
    [],
  );

  function openItem(route: string, window: Parameters<typeof buildDirectorySearch>[1]) {
    navigate({
      pathname: route,
      search: buildDirectorySearch(currentClinic, window),
    });
  }

  return (
    <div className="page-stack page-stack--workspace home-directory">
      <section className="home-directory__hero">
        <div className="home-directory__hero-copy">
          <span className="page-header__eyebrow">GreatTime Reports</span>
          <h1>Home</h1>
          <p>Open a workspace.</p>
        </div>

        <div className="home-directory__context">
          <span>{currentBusiness?.name ?? "Business"}</span>
          <strong>{currentClinic?.name ?? "Clinic"}</strong>
        </div>
      </section>

      <section className="home-directory__featured-grid">
        {featuredItems.map((item) => (
          <button
            key={item.id}
            className={`home-directory__featured-card ${
              item.id === "executive-dashboard" ? "home-directory__featured-card--primary" : ""
            }`.trim()}
            onClick={() => openItem(item.route, item.window)}
          >
            <span className="home-directory__card-eyebrow">{item.eyebrow}</span>
            <strong>{item.title}</strong>
            <p>{item.description}</p>
            <span className="home-directory__card-link">
              {item.id === "executive-dashboard" ? "Open dashboard" : "Open workspace"}
            </span>
          </button>
        ))}
      </section>

      {directoryGroups.map((group) => {
        const items = directoryItems.filter((item) => item.group === group.id);

        return (
          <section key={group.id} className="home-directory__section">
            <div className="home-directory__section-header">
              <h2>{group.title}</h2>
            </div>

            <div className="home-directory__grid">
              {items.map((item) => (
                <button
                  key={item.id}
                  className="home-directory__card"
                  onClick={() => openItem(item.route, item.window)}
                >
                  <span className="home-directory__card-eyebrow">{item.eyebrow}</span>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <span className="home-directory__card-link">Open</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
