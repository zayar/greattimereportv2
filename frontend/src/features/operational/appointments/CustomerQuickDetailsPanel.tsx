import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCustomerQuickView } from "../../../api/analytics";
import { EntityInspectorPanel } from "../../../components/EntityInspectorPanel";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type { CustomerQuickViewResponse } from "../../../types/domain";
import { formatCurrency, formatDate } from "../../../utils/format";
import { buildCustomerPortalDetailPath } from "../../analytics/customer-portal/customerPortalLink";

type Props = {
  clinicId: string;
  clinicCode: string;
  currency: string;
  fromDate: string;
  toDate: string;
  isPinned: boolean;
  canPin: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  customer: {
    customerName: string;
    customerPhone: string;
  };
};

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function buildRevisitSignal(data: CustomerQuickViewResponse) {
  const { daysSinceLastVisit, avgVisitIntervalDays, recent3MonthVisits, previous3MonthVisits } = data.customer;

  if (daysSinceLastVisit == null) {
    return "No recent completed visit is visible yet.";
  }

  if (avgVisitIntervalDays && daysSinceLastVisit > avgVisitIntervalDays * 1.2) {
    return `This customer is now ${daysSinceLastVisit} days out, which is beyond the usual ${avgVisitIntervalDays.toFixed(0)}-day return gap.`;
  }

  if (recent3MonthVisits < previous3MonthVisits && previous3MonthVisits > 0) {
    return `Visit momentum softened from ${previous3MonthVisits} to ${recent3MonthVisits} across the last two 3-month windows.`;
  }

  return `Current revisit timing still looks steady at ${daysSinceLastVisit} days since the last visit.`;
}

function buildPackageNote(data: CustomerQuickViewResponse) {
  const { packageSummary } = data;

  if (packageSummary.activePackages === 0) {
    return "No active package balance is visible right now.";
  }

  if (packageSummary.lowBalancePackages > 0) {
    return `${packageSummary.lowBalancePackages} active package${packageSummary.lowBalancePackages === 1 ? "" : "s"} are running low, so renewal planning matters now.`;
  }

  return `${packageSummary.activePackages} active package${packageSummary.activePackages === 1 ? "" : "s"} still support future visits and rebooking continuity.`;
}

export function CustomerQuickDetailsPanel({
  clinicId,
  clinicCode,
  currency,
  fromDate,
  toDate,
  isPinned,
  canPin,
  onClose,
  onTogglePin,
  customer,
}: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CustomerQuickViewResponse | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);

    fetchCustomerQuickView({
      clinicId,
      clinicCode,
      fromDate,
      toDate,
      customerName: customer.customerName,
      customerPhone: customer.customerPhone,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load customer quick detail.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [clinicCode, clinicId, customer.customerName, customer.customerPhone, fromDate, toDate]);

  const title = data?.customer.customerName || customer.customerName || "Customer";
  const badgeMarkup =
    data?.customer.badges?.length ? (
      <span className="status-pill status-pill--neutral">{data.customer.badges[0]}</span>
    ) : null;

  const customerPath = useMemo(
    () =>
      buildCustomerPortalDetailPath({
        customerName: customer.customerName,
        customerPhone: customer.customerPhone,
        fromDate,
        toDate,
      }),
    [customer.customerName, customer.customerPhone, fromDate, toDate],
  );

  const navigateToTab = (tab?: "overview" | "packages" | "bookings" | "payments" | "usage") => {
    navigate(
      buildCustomerPortalDetailPath({
        customerName: customer.customerName,
        customerPhone: customer.customerPhone,
        fromDate,
        toDate,
        tab,
      }),
    );
  };

  return (
    <EntityInspectorPanel
      title={title}
      subtitle="Operational customer context for the current appointment workflow."
      badge={badgeMarkup}
      isPinned={isPinned}
      canPin={canPin}
      onClose={onClose}
      onTogglePin={onTogglePin}
      className="customer-quick-panel"
    >
      {loading ? (
        <div className="customer-quick-panel__loading">
          <div className="customer-quick-panel__skeleton customer-quick-panel__skeleton--hero" />
          <div className="customer-quick-panel__skeleton-grid">
            <div className="customer-quick-panel__skeleton customer-quick-panel__skeleton--card" />
            <div className="customer-quick-panel__skeleton customer-quick-panel__skeleton--card" />
            <div className="customer-quick-panel__skeleton customer-quick-panel__skeleton--card" />
            <div className="customer-quick-panel__skeleton customer-quick-panel__skeleton--card" />
          </div>
          <div className="customer-quick-panel__skeleton customer-quick-panel__skeleton--section" />
          <div className="customer-quick-panel__skeleton customer-quick-panel__skeleton--section" />
        </div>
      ) : null}

      {!loading && error ? <ErrorState label="Customer quick detail could not be loaded" detail={error} /> : null}

      {!loading && !error && !data ? <EmptyState label="No customer record found" /> : null}

      {!loading && !error && data ? (
        <div className="customer-quick-panel__content">
          <section className="customer-quick-panel__hero">
            <div className="customer-quick-panel__identity">
              <div className="customer-quick-panel__avatar">{initialsFor(data.customer.customerName || "C")}</div>
              <div className="customer-quick-panel__identity-copy">
                <strong>{data.customer.customerName}</strong>
                <p>{data.customer.phoneNumber || customer.customerPhone || "Phone unavailable"}</p>
                <p>
                  {data.customer.memberId ? `Member ${data.customer.memberId}` : "Member ID unavailable"}
                  {data.customer.joinedDate ? ` • Joined ${formatDate(data.customer.joinedDate)}` : ""}
                </p>
                <div className="customer-quick-panel__badges">
                  {data.customer.badges.map((badge) => (
                    <span key={badge} className="status-pill status-pill--neutral">
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="customer-quick-panel__quick-actions">
              <button type="button" className="button button--secondary" onClick={() => navigate(customerPath)}>
                Open full customer portal
              </button>
              <button type="button" className="button button--ghost" onClick={() => navigateToTab("packages")}>
                View packages
              </button>
              <button type="button" className="button button--ghost" onClick={() => navigateToTab("payments")}>
                View payments
              </button>
              <button type="button" className="button button--ghost" onClick={() => navigateToTab("bookings")}>
                View booking history
              </button>
            </div>
          </section>

          <div className="customer-quick-panel__kpis">
            <article className="customer-quick-panel__kpi">
              <span>Lifetime spend</span>
              <strong>{formatCurrency(data.customer.lifetimeSpend, currency)}</strong>
            </article>
            <article className="customer-quick-panel__kpi">
              <span>Total visits</span>
              <strong>{data.customer.totalVisits.toLocaleString("en-US")}</strong>
            </article>
            <article className="customer-quick-panel__kpi">
              <span>Average spend</span>
              <strong>{formatCurrency(data.customer.averageSpendPerVisit, currency)}</strong>
            </article>
            <article className="customer-quick-panel__kpi">
              <span>Last visit</span>
              <strong>{data.customer.lastVisitDate ? formatDate(data.customer.lastVisitDate) : "No visit yet"}</strong>
              <small>
                {data.customer.daysSinceLastVisit != null
                  ? `${data.customer.daysSinceLastVisit} days ago`
                  : "Waiting for activity"}
              </small>
            </article>
            <article className="customer-quick-panel__kpi">
              <span>Package balance</span>
              <strong>{data.packageSummary.remainingSessions.toLocaleString("en-US")} sessions</strong>
              <small>{data.packageSummary.activePackages} active package(s)</small>
            </article>
            <article className="customer-quick-panel__kpi">
              <span>Recent momentum</span>
              <strong>{data.customer.recent3MonthVisits.toLocaleString("en-US")} visits</strong>
              <small>Last 3 months</small>
            </article>
          </div>

          <div className="customer-quick-panel__grid">
            <section className="customer-quick-panel__section">
              <span className="customer-quick-panel__section-label">Operational insights</span>
              <div className="customer-quick-panel__fact-list">
                <div>
                  <span>Preferred service</span>
                  <strong>{data.customer.preferredService || "No clear favorite yet"}</strong>
                </div>
                <div>
                  <span>Preferred therapist</span>
                  <strong>{data.customer.preferredTherapist || "Unknown"}</strong>
                </div>
                <div>
                  <span>Payment preference</span>
                  <strong>{data.customer.lastPaymentMethod || "Unknown"}</strong>
                </div>
                <div>
                  <span>Revisit signal</span>
                  <strong>{buildRevisitSignal(data)}</strong>
                </div>
              </div>
            </section>

            <section className="customer-quick-panel__section">
              <span className="customer-quick-panel__section-label">Next best action</span>
              <article className="customer-quick-panel__action-callout">
                <strong>{data.recommendedAction}</strong>
                <p>{buildPackageNote(data)}</p>
              </article>
              {data.insights.length > 0 ? (
                <div className="customer-quick-panel__insight-list">
                  {data.insights.map((insight) => (
                    <article key={insight.id} className="customer-quick-panel__insight">
                      <strong>{insight.title}</strong>
                      <p>{insight.detail}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          </div>

          <div className="customer-quick-panel__grid">
            <section className="customer-quick-panel__section">
              <span className="customer-quick-panel__section-label">Recent treatments</span>
              {data.recentServices.length === 0 ? (
                <EmptyState label="No recent treatments visible" />
              ) : (
                <div className="customer-quick-panel__compact-list">
                  {data.recentServices.map((service) => (
                    <article key={`${service.serviceName}-${service.lastUsedDate}`} className="customer-quick-panel__compact-card">
                      <strong>{service.serviceName}</strong>
                      <p>{formatDate(service.lastUsedDate)}</p>
                      <small>{service.visitCount.toLocaleString("en-US")} visits</small>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="customer-quick-panel__section">
              <span className="customer-quick-panel__section-label">Recent bookings</span>
              {data.recentBookings.length === 0 ? (
                <EmptyState label="No booking history in this window" />
              ) : (
                <div className="customer-quick-panel__booking-list">
                  {data.recentBookings.map((booking) => (
                    <article key={booking.bookingId} className="customer-quick-panel__booking-row">
                      <div>
                        <strong>{booking.serviceName}</strong>
                        <p>{booking.therapistName}</p>
                      </div>
                      <span>{booking.checkInTime}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="customer-quick-panel__section">
            <span className="customer-quick-panel__section-label">Package watch</span>
            {data.packages.length === 0 ? (
              <EmptyState label="No active package balance" detail="This customer currently has no visible remaining package sessions." />
            ) : (
              <div className="customer-quick-panel__package-list">
                {data.packages.map((entry) => (
                  <article key={entry.id} className="customer-quick-panel__package-row">
                    <div>
                      <strong>{entry.serviceName}</strong>
                      <p>{entry.latestTherapist || "Unknown therapist"}</p>
                    </div>
                    <span>{entry.remainingCount.toLocaleString("en-US")} left</span>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </EntityInspectorPanel>
  );
}
