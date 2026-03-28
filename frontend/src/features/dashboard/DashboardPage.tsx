import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAccess } from "../access/AccessProvider";
import {
  buildDirectorySearch,
  directoryItems,
  type DirectoryItem,
  type DirectoryWindow,
} from "./reportDirectory";

type HomeCardConfig = {
  id?: string;
  title: string;
  description: string;
  eyebrow: string;
  badge: string;
  tone: "primary" | "secondary" | "tertiary" | "neutral";
  route?: string;
  window?: DirectoryWindow;
  cta: string;
};

const quickAccessConfig: HomeCardConfig[] = [
  {
    id: "executive-dashboard",
    title: "Executive Dashboard",
    description: "Comprehensive overview of clinic performance, revenue rhythm, and care delivery.",
    eyebrow: "Quick access",
    badge: "ED",
    tone: "primary",
    cta: "Explore analytics",
  },
  {
    id: "customer-portal",
    title: "Customer Portal",
    description: "Manage client profiles, treatment history, and retention signals in one place.",
    eyebrow: "Quick access",
    badge: "CP",
    tone: "secondary",
    cta: "View directory",
  },
];

const reportCardsConfig: HomeCardConfig[] = [
  {
    id: "payment-report",
    title: "Payment Report",
    description: "Settlement and banking detail by payment method.",
    eyebrow: "Finance",
    badge: "PM",
    tone: "secondary",
    cta: "Open report",
  },
  {
    id: "sales-details",
    title: "Sales Details",
    description: "Itemized treatment and invoice lines with discounts.",
    eyebrow: "Transactions",
    badge: "SD",
    tone: "neutral",
    cta: "Open report",
  },
  {
    id: "sales-by-salesperson",
    title: "Sales by Person",
    description: "Staff commission tracking and seller performance.",
    eyebrow: "Performance",
    badge: "SP",
    tone: "tertiary",
    cta: "Open report",
  },
  {
    id: "customer-by-salesperson",
    title: "Customer by Salesperson",
    description: "Relationship assignment and customer ownership view.",
    eyebrow: "CRM",
    badge: "CS",
    tone: "neutral",
    cta: "Open report",
  },
];

const intelligenceCardsConfig: HomeCardConfig[] = [
  {
    id: "customer-behavior",
    title: "Customer Behavior",
    description: "Retention, visit cadence, and customer health signals.",
    eyebrow: "Intelligence",
    badge: "CB",
    tone: "neutral",
    cta: "Explore insights",
  },
  {
    id: "service-behavior",
    title: "Service Behavior",
    description: "Popularity, ranking, and clinic resource demand.",
    eyebrow: "Insights",
    badge: "SB",
    tone: "tertiary",
    cta: "Open analysis",
  },
];

const operationsCardsConfig: HomeCardConfig[] = [
  {
    id: "daily-treatment",
    title: "Daily Treatment",
    description: "Track today's treatment matrix and therapist activity.",
    eyebrow: "Daily operations",
    badge: "DT",
    tone: "neutral",
    cta: "Open workspace",
  },
  {
    id: "appointments",
    title: "Appointments",
    description: "Review schedule flow, arrivals, and booking momentum.",
    eyebrow: "Daily operations",
    badge: "AP",
    tone: "neutral",
    cta: "Open schedule",
  },
  {
    title: "Service List",
    description: "Open the live clinic catalog from core services.",
    route: "/core/services/list",
    eyebrow: "Clinic portal",
    badge: "SL",
    tone: "primary",
    cta: "Open catalog",
  },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const { currentBusiness, currentClinic } = useAccess();

  const directoryIndex = useMemo(
    () => Object.fromEntries(directoryItems.map((item) => [item.id, item])),
    [],
  );

  const quickAccess = useMemo(
    () =>
      quickAccessConfig
        .map((config) => hydrateCard(config, directoryIndex))
        .filter((item): item is ResolvedHomeCard => item !== null),
    [directoryIndex],
  );

  const reportCards = useMemo(
    () =>
      reportCardsConfig
        .map((config) => hydrateCard(config, directoryIndex))
        .filter((item): item is ResolvedHomeCard => item !== null),
    [directoryIndex],
  );

  const intelligenceCards = useMemo(
    () =>
      intelligenceCardsConfig
        .map((config) => hydrateCard(config, directoryIndex))
        .filter((item): item is ResolvedHomeCard => item !== null),
    [directoryIndex],
  );

  const operationsCards = useMemo(
    () =>
      operationsCardsConfig
        .map((config) => hydrateCard(config, directoryIndex))
        .filter((item): item is ResolvedHomeCard => item !== null),
    [directoryIndex],
  );

  function openRoute(route: string, window?: DirectoryWindow) {
    navigate({
      pathname: route,
      search: window ? buildDirectorySearch(currentClinic, window) : "",
    });
  }

  return (
    <div className="page-stack page-stack--workspace home-directory">
      <section className="home-directory__hero">
        <div className="home-directory__hero-copy">
          <span className="page-header__eyebrow">Welcome back</span>
          <h1>{currentBusiness?.name ?? "Clinic"} Clinic Hub</h1>
          <p>
            A curated home for executive reporting, customer intelligence, and daily clinic
            operations.
          </p>
        </div>

        <div className="home-directory__hero-meta">
          <div className="home-directory__hero-pill">Premium clinic systems</div>
          <div className="home-directory__context">
            <span>{currentBusiness?.name ?? "Business"}</span>
            <strong>{currentClinic?.name ?? "Clinic"}</strong>
            <small>{reportCards.length + intelligenceCards.length + operationsCards.length + quickAccess.length} workspaces ready</small>
          </div>
        </div>
      </section>

      <section className="home-directory__section">
        <div className="home-directory__section-header">
          <div>
            <span className="home-directory__section-kicker">Quick access</span>
            <h2>Start from the workspaces your team uses most</h2>
          </div>
        </div>

        <div className="home-directory__featured-grid">
          {quickAccess.map((item) => (
            <button
              key={item.id}
              className={`home-directory__featured-card home-directory__featured-card--${item.tone}`.trim()}
              onClick={() => openRoute(item.route, item.window)}
            >
              <div className="home-directory__featured-copy">
                <div className="home-directory__card-top">
                  <span className={`home-directory__icon-badge home-directory__icon-badge--${item.tone}`.trim()}>
                    {item.badge}
                  </span>
                  <span className="home-directory__featured-tag">{item.eyebrow}</span>
                </div>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <span className="home-directory__card-link">{item.cta}</span>
              </div>
              <div className={`home-directory__featured-art home-directory__featured-art--${item.tone}`.trim()} aria-hidden />
            </button>
          ))}
        </div>
      </section>

      <section className="home-directory__section">
        <div className="home-directory__section-header">
          <div>
            <span className="home-directory__section-kicker">Reports &amp; analytics</span>
            <h2>Open focused revenue and CRM workspaces</h2>
          </div>
        </div>

        <div className="home-directory__report-grid">
          {reportCards.map((item) => (
            <button
              key={item.id}
              className={`home-directory__mini-card home-directory__mini-card--${item.tone}`.trim()}
              onClick={() => openRoute(item.route, item.window)}
            >
              <span className={`home-directory__icon-badge home-directory__icon-badge--${item.tone}`.trim()}>
                {item.badge}
              </span>
              <span className="home-directory__card-eyebrow">{item.eyebrow}</span>
              <strong>{item.title}</strong>
              <p>{item.description}</p>
              <span className="home-directory__card-link">{item.cta}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-directory__bottom-grid">
        <div className="home-directory__section">
          <div className="home-directory__section-header">
            <div>
              <span className="home-directory__section-kicker">Intelligence &amp; insights</span>
              <h2>Behavior views for retention and treatment demand</h2>
            </div>
          </div>

          <div className="home-directory__insight-grid">
            {intelligenceCards.map((item) => (
              <button
                key={item.id}
                className={`home-directory__insight-card home-directory__insight-card--${item.tone}`.trim()}
                onClick={() => openRoute(item.route, item.window)}
              >
                <span className={`home-directory__icon-badge home-directory__icon-badge--${item.tone}`.trim()}>
                  {item.badge}
                </span>
                <span className="home-directory__card-eyebrow">{item.eyebrow}</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <div className={`home-directory__mini-bars home-directory__mini-bars--${item.tone}`.trim()} aria-hidden>
                  <span />
                  <span />
                  <span />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="home-directory__section">
          <div className="home-directory__section-header">
            <div>
              <span className="home-directory__section-kicker">Daily operations</span>
              <h2>Keep the clinic moving without opening heavy analytics</h2>
            </div>
          </div>

          <div className="home-directory__operations-stack">
            {operationsCards.slice(0, 2).map((item) => (
              <button
                key={item.title}
                className="home-directory__operation-card"
                onClick={() => openRoute(item.route, item.window)}
              >
                <span className={`home-directory__icon-badge home-directory__icon-badge--${item.tone}`.trim()}>
                  {item.badge}
                </span>
                <div className="home-directory__operation-copy">
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </button>
            ))}

            {operationsCards[2] ? (
              <button
                className="home-directory__activity-card"
                onClick={() => openRoute(operationsCards[2].route, operationsCards[2].window)}
              >
                <span className="home-directory__card-eyebrow">{operationsCards[2].eyebrow}</span>
                <strong>{operationsCards[2].title}</strong>
                <p>{operationsCards[2].description}</p>
                <span className="home-directory__card-link">{operationsCards[2].cta}</span>
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

type ResolvedHomeCard = HomeCardConfig & {
  id: string;
  route: string;
};

function hydrateCard(
  config: HomeCardConfig,
  directoryIndex: Record<string, DirectoryItem>,
): ResolvedHomeCard | null {
  if (config.id) {
    const item = directoryIndex[config.id];
    if (!item) {
      return null;
    }

    return {
      ...config,
      id: config.id,
      title: config.title || item.title,
      description: config.description || item.description,
      eyebrow: config.eyebrow || item.eyebrow,
      route: item.route,
      window: item.window,
    };
  }

  if (!config.route) {
    return null;
  }

  return {
    ...config,
    id: config.title.toLowerCase().replace(/\s+/g, "-"),
    route: config.route,
  };
}
