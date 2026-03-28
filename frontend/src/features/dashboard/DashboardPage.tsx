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
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#fff' }}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
  </svg>
);

const IconCP = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#fff' }}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
);

const IconFinance = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#4CAF50' }}>
    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
    <line x1="12" y1="8" x2="12" y2="16"></line>
    <line x1="8" y1="12" x2="16" y2="12"></line>
  </svg>
);

const IconTransactions = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#607D8B' }}>
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
    <path d="M12 11h4"></path>
    <path d="M12 15h4"></path>
    <path d="M8 11h.01"></path>
    <path d="M8 15h.01"></path>
  </svg>
);

const IconPerformance = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8D6E63' }}>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
  </svg>
);

const IconCRM = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#9C27B0' }}>
    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
    <polyline points="2 17 12 22 22 17"></polyline>
    <polyline points="2 12 12 17 22 12"></polyline>
  </svg>
);

const IconKit = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#2d6969' }}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
  </svg>
);

const IconCalendar = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#4b5563' }}>
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
    <div className="page-stack page-stack--workspace home-directory" style={{ gap: '32px' }}>
      <section className="home-directory__hero" style={{ display: 'block', marginBottom: '12px' }}>
        <div className="home-directory__hero-copy">
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.12em', color: '#886d5e', fontSize: '0.75rem', fontWeight: 600 }}>
            Welcome back, Administrator
          </span>
          <h1 style={{ marginTop: '4px', fontSize: '2.4rem', color: '#163b36', letterSpacing: '-0.02em', fontWeight: '500', fontFamily: 'Georgia, serif' }}>
            {currentBusiness?.name ?? "Aura Luxe"} Clinic <span style={{ color: '#8bbaa6' }}>Hub</span>
          </h1>
        </div>
      </section>

      <section className="home-directory__section" style={{ gap: '16px' }}>
        <h2 style={{ fontSize: '1.1rem', color: '#111827', margin: 0, fontWeight: 500 }}>Quick Access</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '24px' }}>
          {quickAccess.map((item) => (
            <button
              key={item.id}
              onClick={() => openRoute(item.route, item.window)}
              style={{
                background: '#ffffff',
                border: '1px solid rgba(17, 24, 39, 0.05)',
                borderRadius: '32px',
                padding: '32px',
                textAlign: 'left',
                display: 'grid',
                gap: '16px',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 16px 40px rgba(15, 23, 42, 0.04)',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 24px 48px rgba(15, 23, 42, 0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = '0 16px 40px rgba(15, 23, 42, 0.04)';
              }}
            >
              <div style={{
                width: '48px', height: '48px', borderRadius: '16px',
                background: item.tone === 'primary' ? '#074142' : '#855c51',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {item.iconNode}
              </div>
              <div>
                <strong style={{ fontSize: '1.25rem', color: '#074142', display: 'block', marginBottom: '8px' }}>{item.title}</strong>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '0.95rem', lineHeight: '1.5', maxWidth: '85%' }}>{item.description}</p>
              </div>
              <span style={{ color: '#074142', fontWeight: 600, fontSize: '0.95rem', marginTop: '8px' }}>{item.cta}</span>
              
              {/* Background Decoration */}
              {item.tone === 'primary' && (
                <div style={{ position: 'absolute', right: '-10%', top: '-10%', opacity: 0.05, transform: 'rotate(-15deg)', pointerEvents: 'none' }}>
                  <svg width="240" height="240" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="2" y="10" width="6" height="12" rx="2" />
                    <rect x="10" y="4" width="6" height="18" rx="2" />
                    <rect x="18" y="14" width="6" height="8" rx="2" />
                  </svg>
                </div>
              )}
              {item.tone === 'secondary' && (
                <div style={{ position: 'absolute', right: '-5%', top: '-5%', opacity: 0.05, pointerEvents: 'none' }}>
                  <svg width="220" height="220" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="home-directory__section" style={{ gap: '16px' }}>
        <h2 style={{ fontSize: '1.1rem', color: '#111827', margin: 0, fontWeight: 500 }}>Reports &amp; Analytics</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '20px' }}>
          {reportCards.map((item) => (
            <button
              key={item.id}
              onClick={() => openRoute(item.route, item.window)}
              style={{
                background: '#ffffff',
                border: '1px solid rgba(17, 24, 39, 0.04)',
                borderRadius: '28px',
                padding: '28px 24px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 12px 32px rgba(15, 23, 42, 0.03)',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.boxShadow = '0 16px 40px rgba(15, 23, 42, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = '0 12px 32px rgba(15, 23, 42, 0.03)';
              }}
            >
              <div style={{
                width: '44px', height: '44px', borderRadius: '12px',
                background: '#f3f6f5', display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '8px'
              }}>
                {item.iconNode}
              </div>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: '0.65rem', color: '#88929e', fontWeight: 600 }}>{item.eyebrow}</span>
              <strong style={{ fontSize: '1.05rem', color: '#111827' }}>{item.title}</strong>
              <p style={{ margin: 0, color: '#8ba2a5', fontSize: '0.85rem' }}>{item.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        <div className="home-directory__section" style={{ gap: '16px' }}>
          <h2 style={{ fontSize: '1.1rem', color: '#111827', margin: 0, fontWeight: 500 }}>Intelligence &amp; Insights</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px' }}>
            {intelligenceCards.map((item, i) => (
              <button
                key={item.id}
                onClick={() => openRoute(item.route, item.window)}
                style={{
                  background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,252,251,1) 100%)',
                  border: '1px solid rgba(17, 24, 39, 0.04)',
                  borderRadius: '32px',
                  padding: '32px 28px',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  boxShadow: '0 16px 40px rgba(15, 23, 42, 0.03)',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  minHeight: '220px',
                }}
              >
                <strong style={{ fontSize: '1.15rem', color: '#1a3b34' }}>{item.title}</strong>
                <p style={{ margin: 0, color: '#889896', fontSize: '0.9rem' }}>{item.description}</p>

                {/* Decorative bar chart */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: 'auto', opacity: 0.8 }}>
                  {i === 0 ? (
                    <>
                      <div style={{ width: '12px', height: '24px', background: '#c6d1ce', borderRadius: '4px' }} />
                      <div style={{ width: '12px', height: '36px', background: '#aabcb6', borderRadius: '4px' }} />
                      <div style={{ width: '12px', height: '28px', background: '#c6d1ce', borderRadius: '4px' }} />
                      <div style={{ width: '12px', height: '54px', background: '#396b66', borderRadius: '4px' }} />
                      <div style={{ width: '12px', height: '42px', background: '#8bbaa6', borderRadius: '4px' }} />
                    </>
                  ) : (
                    <>
                      <div style={{ width: '12px', height: '32px', background: '#e1d0cb', borderRadius: '4px' }} />
                      <div style={{ width: '12px', height: '48px', background: '#ccada4', borderRadius: '4px' }} />
                      <div style={{ width: '12px', height: '28px', background: '#e1d0cb', borderRadius: '4px' }} />
                      <div style={{ width: '12px', height: '42px', background: '#845343', borderRadius: '4px' }} />
                      <div style={{ width: '12px', height: '36px', background: '#ccada4', borderRadius: '4px' }} />
                    </>
                  )}
                </div>
                
                {/* Decorative sparkle icon at bottom right */}
                <svg style={{ position: 'absolute', right: '20px', bottom: '20px', opacity: 0.1, color: '#396b66' }} width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>
                </svg>
              </button>
            ))}
          </div>
        </div>

        <div className="home-directory__section" style={{ gap: '16px' }}>
          <h2 style={{ fontSize: '1.1rem', color: '#111827', margin: 0, fontWeight: 500 }}>Daily Operations</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {operationsCards.slice(0, 2).map((item) => (
              <button
                key={item.title}
                onClick={() => openRoute(item.route, item.window)}
                style={{
                  background: '#ffffff',
                  border: '1px solid rgba(17, 24, 39, 0.04)',
                  borderRadius: '24px',
                  padding: '22px 24px',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.03)',
                  cursor: 'pointer',
                }}
              >
                <div style={{
                  width: '40px', height: '40px', borderRadius: '12px',
                  background: '#f3f6f5', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {item.iconNode}
                </div>
                <strong style={{ fontSize: '1.05rem', color: '#111827' }}>{item.title}</strong>
              </button>
            ))}

            {/* Deep Purple Next Activity Card */}
            <button
              onClick={() => openRoute("/core/services/list")}
              style={{
                background: 'linear-gradient(135deg, #32213e 0%, #1c1023 100%)',
                border: 'none',
                borderRadius: '32px',
                padding: '28px',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                boxShadow: '0 16px 32px rgba(45, 14, 52, 0.15)',
                cursor: 'pointer',
                minHeight: '120px',
                position: 'relative',
                overflow: 'hidden',
                marginTop: '8px'
              }}
            >
               <span style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: '0.65rem', color: '#9788a1', fontWeight: 600 }}>Next Activity</span>
               <strong style={{ fontSize: '1.05rem', color: '#ffffff', fontStyle: 'italic', fontWeight: '500', fontFamily: 'Georgia, serif' }}>
                 VIP Consultation: Sarah J.<br/>
                 <span style={{ fontStyle: 'normal', fontSize: '0.9rem', color: '#a69ba8', fontFamily: '-apple-system, sans-serif' }}>Room 4 • 14:30 PM</span>
               </strong>
               
               {/* Abstract subtle mesh/gradient on right side */}
               <div style={{ position: 'absolute', right: '-20%', top: '-50%', width: '150%', height: '200%', background: 'radial-gradient(ellipse at right, rgba(255,255,255,0.03) 0%, transparent 60%)', pointerEvents: 'none' }} />
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
