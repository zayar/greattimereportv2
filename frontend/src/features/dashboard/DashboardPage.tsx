import { useMemo, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAccess } from "../access/AccessProvider";
import {
  buildDirectorySearch,
  directoryItems,
  type DirectoryItem,
  type DirectoryWindow,
} from "./reportDirectory";

// SVG Icons
const IconED = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
  </svg>
);

const IconCP = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
);

const IconFinance = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
    <line x1="12" y1="8" x2="12" y2="16"></line>
    <line x1="8" y1="12" x2="16" y2="12"></line>
  </svg>
);

const IconTransactions = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
    <path d="M12 11h4"></path>
    <path d="M12 15h4"></path>
    <path d="M8 11h.01"></path>
    <path d="M8 15h.01"></path>
  </svg>
);

const IconPerformance = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
  </svg>
);

const IconCRM = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
    <polyline points="2 17 12 22 22 17"></polyline>
    <polyline points="2 12 12 17 22 12"></polyline>
  </svg>
);

const IconKit = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
  </svg>
);

const IconCalendar = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>
);

type HomeCardConfig = {
  id?: string;
  title: string;
  description: string;
  eyebrow: string;
  iconNode?: ReactNode;
  tone: "primary" | "secondary" | "tertiary" | "neutral";
  route?: string;
  window?: DirectoryWindow;
  cta: string;
};

const quickAccessConfig: HomeCardConfig[] = [
  {
    id: "executive-dashboard",
    title: "Executive Dashboard",
    description: "Comprehensive overview of clinic performance, revenue trends, and growth metrics.",
    eyebrow: "Quick Access",
    iconNode: <IconED />,
    tone: "primary",
    cta: "Explore Analytics →",
  },
  {
    id: "customer-portal",
    title: "Customer Portal",
    description: "Manage client profiles, treatment history, and premium membership status.",
    eyebrow: "Quick Access",
    iconNode: <IconCP />,
    tone: "secondary",
    cta: "View Directory →",
  },
];

const reportCardsConfig: HomeCardConfig[] = [
  {
    id: "payment-report",
    title: "Payment Report",
    description: "Daily settlement & clearing",
    eyebrow: "Finance",
    iconNode: <IconFinance />,
    tone: "neutral",
    cta: "Open report",
  },
  {
    id: "sales-details",
    title: "Sales Details",
    description: "Itemized treatment logs",
    eyebrow: "Transactions",
    iconNode: <IconTransactions />,
    tone: "neutral",
    cta: "Open report",
  },
  {
    id: "sales-by-salesperson",
    title: "Sales by Person",
    description: "Staff commission tracking",
    eyebrow: "Performance",
    iconNode: <IconPerformance />,
    tone: "neutral",
    cta: "Open report",
  },
  {
    id: "customer-by-salesperson",
    title: "Customer by Salesperson",
    description: "Relationship assignments",
    eyebrow: "CRM",
    iconNode: <IconCRM />,
    tone: "neutral",
    cta: "Open report",
  },
];

const intelligenceCardsConfig: HomeCardConfig[] = [
  {
    id: "service-portal",
    title: "Service Portal",
    description: "Service-level intelligence, pricing quality, and growth signals",
    eyebrow: "",
    tone: "neutral",
    cta: "",
  },
  {
    id: "customer-behavior",
    title: "Customer Behavior",
    description: "Retention and churn analysis",
    eyebrow: "",
    tone: "neutral",
    cta: "",
  },
  {
    id: "service-behavior",
    title: "Service Behavior",
    description: "Popularity & resource load",
    eyebrow: "",
    tone: "neutral",
    cta: "",
  },
  {
    id: "customer-portal",
    title: "Customer Portal",
    description: "Customer 360, retention signals, and rebooking follow-up",
    eyebrow: "",
    tone: "neutral",
    cta: "",
  },
];

const operationsCardsConfig: HomeCardConfig[] = [
  {
    id: "daily-treatment",
    title: "Daily Treatment",
    description: "",
    eyebrow: "",
    iconNode: <IconKit />,
    tone: "neutral",
    cta: "",
  },
  {
    id: "appointments",
    title: "Appointments",
    description: "",
    eyebrow: "",
    iconNode: <IconCalendar />,
    tone: "neutral",
    cta: "",
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
    <div className="page-stack page-stack--workspace home-directory home-directory--luxe">
      <section className="home-directory__hero home-directory__hero--single">
        <div className="home-directory__hero-copy">
          <span className="home-directory__welcome-kicker">Welcome back, Administrator</span>
          <h1 className="home-directory__welcome-heading">
            {currentBusiness?.name ?? "Great Time App"} Clinic{" "}
            <span className="home-directory__welcome-accent">Hub</span>
          </h1>
          <p className="home-directory__welcome-subtitle">
            A calmer command space for clinic teams to move from daily operations into high-signal reporting.
          </p>
        </div>
      </section>

      <section className="home-directory__section home-directory__section--compact">
        <h2 className="home-directory__title">Quick Access</h2>
        <div className="home-directory__featured-grid">
          {quickAccess.map((item) => (
            <button
              key={item.id}
              className={`home-directory__featured-card home-directory__featured-card--${item.tone}`.trim()}
              onClick={() => openRoute(item.route, item.window)}
            >
              <div className="home-directory__featured-copy">
                <div className="home-directory__card-top">
                  <span className={`home-directory__quick-icon home-directory__quick-icon--${item.tone}`.trim()}>
                    {item.iconNode}
                  </span>
                  <span className="home-directory__featured-tag">{item.eyebrow}</span>
                </div>
                <div className="home-directory__featured-text">
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
                <span className="home-directory__card-link">{item.cta}</span>
              </div>
              <div className={`home-directory__featured-art home-directory__featured-art--${item.tone}`.trim()} aria-hidden />
            </button>
          ))}
        </div>
      </section>

      <section className="home-directory__section home-directory__section--compact">
        <h2 className="home-directory__title">Reports &amp; Analytics</h2>
        <div className="home-directory__report-grid">
          {reportCards.map((item) => (
            <button
              key={item.id}
              className={`home-directory__mini-card home-directory__mini-card--${item.eyebrow.toLowerCase().replace(/\s+/g, "-")}`.trim()}
              onClick={() => openRoute(item.route, item.window)}
            >
              <div className={`home-directory__mini-icon home-directory__mini-icon--${item.eyebrow.toLowerCase().replace(/\s+/g, "-")}`.trim()}>
                {item.iconNode}
              </div>
              <span className="home-directory__card-eyebrow">{item.eyebrow}</span>
              <strong>{item.title}</strong>
              <p>{item.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="home-directory__bottom-grid">
        <div className="home-directory__section home-directory__section--compact">
          <h2 className="home-directory__title">Intelligence &amp; Insights</h2>
          <div className="home-directory__insight-grid">
            {intelligenceCards.map((item, i) => {
                const toneVariant = i % 2 === 0 ? "sage" : "blush";

                return (
                  <button
                    key={item.id}
                    className={`home-directory__insight-card home-directory__insight-card--${toneVariant}`.trim()}
                    onClick={() => openRoute(item.route, item.window)}
                  >
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <div className={`home-directory__mini-bars home-directory__mini-bars--${toneVariant}`.trim()}>
                      {toneVariant === "sage" ? (
                        <>
                          <span className="home-directory__mini-bar home-directory__mini-bar--short" />
                          <span className="home-directory__mini-bar home-directory__mini-bar--medium" />
                          <span className="home-directory__mini-bar home-directory__mini-bar--small" />
                          <span className="home-directory__mini-bar home-directory__mini-bar--tall" />
                          <span className="home-directory__mini-bar home-directory__mini-bar--large" />
                        </>
                      ) : (
                        <>
                          <span className="home-directory__mini-bar home-directory__mini-bar--mid-short" />
                          <span className="home-directory__mini-bar home-directory__mini-bar--very-tall" />
                          <span className="home-directory__mini-bar home-directory__mini-bar--small" />
                          <span className="home-directory__mini-bar home-directory__mini-bar--medium-large" />
                          <span className="home-directory__mini-bar home-directory__mini-bar--medium" />
                        </>
                      )}
                    </div>
                    <div className="home-directory__insight-glow" aria-hidden />
                  </button>
                );
              })}
          </div>
        </div>

        <div className="home-directory__section home-directory__section--compact">
          <h2 className="home-directory__title">Daily Operations</h2>
          <div className="home-directory__operations-stack">
            {operationsCards.slice(0, 2).map((item) => (
              <button
                key={item.title}
                className="home-directory__operation-card"
                onClick={() => openRoute(item.route, item.window)}
              >
                <div className={`home-directory__operation-icon home-directory__operation-icon--${item.id}`.trim()}>
                  {item.iconNode}
                </div>
                <div className="home-directory__operation-copy">
                  <strong>{item.title}</strong>
                  <p>{item.title === "Daily Treatment" ? "Open today’s treatment workspace." : "Review schedule flow and today’s bookings."}</p>
                </div>
              </button>
            ))}

            <button
              className="home-directory__activity-card"
              onClick={() => openRoute("/operational/appointments", "today")}
            >
              <div className="home-directory__activity-top">
                <span className="home-directory__card-eyebrow">Daily Queue</span>
                <span className="home-directory__activity-action">Open board</span>
              </div>
              <div className="home-directory__activity-copy">
                <strong className="home-directory__activity-title">Today Appointment List</strong>
                <p className="home-directory__activity-description">
                  Open today&apos;s appointment board for arrivals, room flow, and live schedule changes.
                </p>
                <div className="home-directory__activity-meta">
                  <span className="home-directory__activity-chip">Live updates</span>
                  <span className="home-directory__activity-chip">Front desk quick view</span>
                </div>
                <span className="home-directory__activity-subline">For arrivals, room coordination, and same-day schedule control</span>
              </div>
              <div className="home-directory__activity-mesh" aria-hidden />
            </button>
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
