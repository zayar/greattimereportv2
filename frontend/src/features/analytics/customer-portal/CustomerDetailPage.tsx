import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchCustomerPortalBookings,
  fetchCustomerPortalOverview,
  fetchCustomerPortalPackages,
  fetchCustomerPortalPayments,
  fetchCustomerPortalUsage,
} from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { DualMetricBarChart } from "../../../components/DualMetricBarChart";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type {
  CustomerPortalBookingsResponse,
  CustomerPortalOverviewResponse,
  CustomerPortalPackagesResponse,
  CustomerPortalPaymentsResponse,
  CustomerPortalUsageResponse,
} from "../../../types/domain";
import { startOfCurrentYear, today } from "../../../utils/date";
import { formatCurrency, formatDate } from "../../../utils/format";
import { useAccess } from "../../access/AccessProvider";

const SECTION_PAGE_SIZE = 12;

type DetailTab = "overview" | "packages" | "bookings" | "payments" | "usage";

type SectionState<Data> = {
  data: Data | null;
  loading: boolean;
  error: string | null;
};

function createIdleState<Data>(): SectionState<Data> {
  return {
    data: null,
    loading: false,
    error: null,
  };
}

function formatCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadCustomerPaymentHistory(
  rows: CustomerPortalPaymentsResponse["rows"],
  currency: string,
) {
  const headers = [
    "Date",
    "Invoice Number",
    "Service",
    "Package",
    "Payment Method",
    "Sales Person",
    "Invoice Total",
    "Discount",
    "Net Amount",
    "Outstanding",
    "Payment Status",
  ];

  const body = rows.map((row) =>
    [
      row.dateLabel,
      row.invoiceNumber,
      row.serviceName,
      row.servicePackageName || "",
      row.paymentMethod,
      row.salePerson,
      formatCurrency(row.invoiceTotal, currency),
      formatCurrency(row.discount, currency),
      formatCurrency(row.netAmount, currency),
      formatCurrency(row.outstandingAmount, currency),
      row.paymentStatus,
    ]
      .map(formatCsvValue)
      .join(","),
  );

  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `customer-payments-${today()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function displayText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return fallback;
  }

  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object") {
    if ("value" in value) {
      return displayText((value as { value: unknown }).value, fallback);
    }

    if ("preferredService" in value) {
      return displayText((value as { preferredService: unknown }).preferredService, fallback);
    }

    if ("preferredTherapist" in value) {
      return displayText((value as { preferredTherapist: unknown }).preferredTherapist, fallback);
    }
  }

  return fallback;
}

function toneClass(tone: "positive" | "attention" | "neutral") {
  if (tone === "positive") {
    return "positive";
  }

  if (tone === "attention") {
    return "attention";
  }

  return "neutral";
}

function statusTone(status: string) {
  if (status === "Dormant" || status === "At risk") {
    return "attention";
  }

  if (status === "Returning" || status === "Active" || status === "New" || status === "VIP") {
    return "positive";
  }

  return "neutral";
}

function UsageHeatmap({
  data,
}: {
  data: CustomerPortalUsageResponse;
}) {
  if (data.services.length === 0) {
    return (
      <EmptyState
        label="No service usage found"
        detail="Try a different year or widen the overall date range."
      />
    );
  }

  const maxValue = Math.max(
    ...data.services.flatMap((service) => service.counts),
    1,
  );

  return (
    <div className="customer-detail__usage-heatmap">
      <div className="customer-detail__usage-header">
        <div />
        {data.months.map((month) => (
          <span key={month}>{month}</span>
        ))}
      </div>
      <div className="customer-detail__usage-body">
        {data.services.map((service) => (
          <div key={`${service.serviceName}-${service.serviceCategory}`} className="customer-detail__usage-row">
            <div className="customer-detail__usage-service">
              <strong>{service.serviceName}</strong>
              <span>{service.serviceCategory}</span>
            </div>
            {service.counts.map((count, index) => (
              <div
                key={`${service.serviceName}-${data.months[index]}`}
                className="customer-detail__usage-cell"
                title={`${service.serviceName} • ${data.months[index]} • ${count} use${count === 1 ? "" : "s"}`}
                style={{
                  backgroundColor:
                    count === 0
                      ? "rgba(29, 110, 242, 0.06)"
                      : `rgba(29, 110, 242, ${0.18 + (count / maxValue) * 0.42})`,
                }}
              >
                {count > 0 ? count : ""}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CustomerDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const customerName = searchParams.get("name") ?? "";
  const customerPhone = searchParams.get("phone") ?? "";
  const [range, setRange] = useState(() => ({
    fromDate: searchParams.get("fromDate") ?? startOfCurrentYear(),
    toDate: searchParams.get("toDate") ?? today(),
  }));
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [overviewState, setOverviewState] = useState<SectionState<CustomerPortalOverviewResponse>>(
    createIdleState(),
  );
  const [packagesState, setPackagesState] = useState<SectionState<CustomerPortalPackagesResponse>>(
    createIdleState(),
  );
  const [bookingsState, setBookingsState] = useState<SectionState<CustomerPortalBookingsResponse>>(
    createIdleState(),
  );
  const [paymentsState, setPaymentsState] = useState<SectionState<CustomerPortalPaymentsResponse>>(
    createIdleState(),
  );
  const [usageState, setUsageState] = useState<SectionState<CustomerPortalUsageResponse>>(createIdleState());
  const [bookingsSearch, setBookingsSearch] = useState("");
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [bookingsPage, setBookingsPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [usageYear, setUsageYear] = useState<number>(Number((searchParams.get("toDate") ?? today()).slice(0, 4)));
  const [usageCategory, setUsageCategory] = useState("");
  const deferredBookingsSearch = useDeferredValue(bookingsSearch.trim());
  const deferredPaymentsSearch = useDeferredValue(paymentsSearch.trim());

  const hasIdentity = customerName.trim() !== "" || customerPhone.trim() !== "";

  useEffect(() => {
    setBookingsPage(1);
  }, [deferredBookingsSearch]);

  useEffect(() => {
    setPaymentsPage(1);
  }, [deferredPaymentsSearch]);

  useEffect(() => {
    setPackagesState(createIdleState());
    setBookingsState(createIdleState());
    setPaymentsState(createIdleState());
    setUsageState(createIdleState());
    setBookingsSearch("");
    setPaymentsSearch("");
    setBookingsPage(1);
    setPaymentsPage(1);
    setUsageCategory("");
    setUsageYear(Number(range.toDate.slice(0, 4)));
  }, [currentClinic?.id, customerName, customerPhone, range.fromDate, range.toDate]);

  useEffect(() => {
    if (!currentClinic || !hasIdentity) {
      return;
    }

    let active = true;
    setOverviewState({
      data: overviewState.data,
      loading: true,
      error: null,
    });

    fetchCustomerPortalOverview({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      customerName,
      customerPhone,
    })
      .then((result) => {
        if (active) {
          setOverviewState({
            data: result,
            loading: false,
            error: null,
          });
        }
      })
      .catch((loadError) => {
        if (active) {
          setOverviewState({
            data: null,
            loading: false,
            error:
              loadError instanceof Error
                ? loadError.message
                : "Failed to load the customer overview.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [currentClinic, customerName, customerPhone, hasIdentity, range.fromDate, range.toDate]);

  useEffect(() => {
    if (!currentClinic || !hasIdentity || activeTab !== "packages" || packagesState.data || packagesState.loading) {
      return;
    }

    let active = true;
    setPackagesState({ data: packagesState.data, loading: true, error: null });

    fetchCustomerPortalPackages({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      customerName,
      customerPhone,
    })
      .then((result) => {
        if (active) {
          setPackagesState({ data: result, loading: false, error: null });
        }
      })
      .catch((loadError) => {
        if (active) {
          setPackagesState({
            data: null,
            loading: false,
            error: loadError instanceof Error ? loadError.message : "Failed to load package holdings.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [
    activeTab,
    currentClinic,
    customerName,
    customerPhone,
    hasIdentity,
    range.fromDate,
    range.toDate,
  ]);

  useEffect(() => {
    if (!currentClinic || !hasIdentity || activeTab !== "bookings") {
      return;
    }

    let active = true;
    setBookingsState((current) => ({ ...current, loading: true, error: null }));

    fetchCustomerPortalBookings({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      customerName,
      customerPhone,
      search: deferredBookingsSearch,
      page: bookingsPage,
      pageSize: SECTION_PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setBookingsState({ data: result, loading: false, error: null });
        }
      })
      .catch((loadError) => {
        if (active) {
          setBookingsState({
            data: null,
            loading: false,
            error: loadError instanceof Error ? loadError.message : "Failed to load booking history.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [
    activeTab,
    bookingsPage,
    currentClinic,
    customerName,
    customerPhone,
    deferredBookingsSearch,
    hasIdentity,
    range.fromDate,
    range.toDate,
  ]);

  useEffect(() => {
    if (!currentClinic || !hasIdentity || activeTab !== "payments") {
      return;
    }

    let active = true;
    setPaymentsState((current) => ({ ...current, loading: true, error: null }));

    fetchCustomerPortalPayments({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      customerName,
      customerPhone,
      search: deferredPaymentsSearch,
      page: paymentsPage,
      pageSize: SECTION_PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setPaymentsState({ data: result, loading: false, error: null });
        }
      })
      .catch((loadError) => {
        if (active) {
          setPaymentsState({
            data: null,
            loading: false,
            error: loadError instanceof Error ? loadError.message : "Failed to load payment history.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [
    activeTab,
    currentClinic,
    customerName,
    customerPhone,
    deferredPaymentsSearch,
    hasIdentity,
    paymentsPage,
    range.fromDate,
    range.toDate,
  ]);

  useEffect(() => {
    if (!currentClinic || !hasIdentity || activeTab !== "usage") {
      return;
    }

    let active = true;
    setUsageState((current) => ({ ...current, loading: true, error: null }));

    fetchCustomerPortalUsage({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      customerName,
      customerPhone,
      year: usageYear,
      serviceCategory: usageCategory,
    })
      .then((result) => {
        if (active) {
          setUsageState({ data: result, loading: false, error: null });
        }
      })
      .catch((loadError) => {
        if (active) {
          setUsageState({
            data: null,
            loading: false,
            error:
              loadError instanceof Error ? loadError.message : "Failed to load service usage history.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [
    activeTab,
    currentClinic,
    customerName,
    customerPhone,
    hasIdentity,
    range.fromDate,
    range.toDate,
    usageCategory,
    usageYear,
  ]);

  const currency = currentClinic?.currency || "MMK";
  const overview = overviewState.data;
  const customer = overview?.customer;
  const bookingsTotalPages = Math.max(
    1,
    Math.ceil((bookingsState.data?.totalCount ?? 0) / SECTION_PAGE_SIZE),
  );
  const paymentsTotalPages = Math.max(
    1,
    Math.ceil((paymentsState.data?.totalCount ?? 0) / SECTION_PAGE_SIZE),
  );
  const usageYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, index) => currentYear - index);
  }, []);

  const tabCounts = {
    packages: packagesState.data?.packages.length ?? 0,
    bookings: bookingsState.data?.totalCount ?? 0,
    payments: paymentsState.data?.totalCount ?? 0,
    usage: usageState.data?.summary.distinctServices ?? 0,
  };

  const usageTopServices = useMemo(() => {
    if (!usageState.data) {
      return [];
    }

    return usageState.data.services.slice(0, 6).map((service) => ({
      label: service.serviceName,
      value: service.totalUsage,
      valueDisplay: `${service.totalUsage.toLocaleString("en-US")} uses`,
    }));
  }, [usageState.data]);
  const displayName = displayText(customer?.customerName, customerName || customerPhone || "Customer");
  const displayPhone = displayText(customer?.phoneNumber, customerPhone || "Phone unavailable");
  const displayMemberId = displayText(customer?.memberId);
  const preferredServiceLabel = displayText(customer?.preferredService, "No clear favorite yet");
  const preferredTherapistLabel = displayText(customer?.preferredTherapist, "Unknown");
  const displayInitials = initialsFor(displayName || "C");

  if (!hasIdentity) {
    return (
      <div className="page-stack page-stack--workspace analytics-report customer-detail">
        <ErrorState
          label="Customer identity is missing"
          detail="Open this page from the customer list so the portal knows which record to load."
        />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report customer-detail">
      <PageHeader
        eyebrow="Customers"
        title="Customer 360"
        description="A focused customer intelligence workspace for value, retention, service usage, and next-action signals."
        hideContext
        actions={
          <div className="customer-detail__header-actions">
            <button
              className="button button--secondary"
              onClick={() =>
                navigate(`/analytics/customers?fromDate=${encodeURIComponent(range.fromDate)}&toDate=${encodeURIComponent(range.toDate)}`)
              }
            >
              Back to list
            </button>
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
          </div>
        }
      />

      {overviewState.error ? (
        <ErrorState label="Customer overview could not be loaded" detail={overviewState.error} />
      ) : null}

      <section className="customer-detail__hero">
        <div className="customer-detail__identity-card">
          <div className="customer-detail__avatar">{displayInitials}</div>
          <div className="customer-detail__identity-copy">
            <span className="page-header__eyebrow">Customer profile</span>
            <h2>{displayName}</h2>
            <p>
              {displayPhone}
              {displayMemberId ? ` • Member ${displayMemberId}` : ""}
              {customer?.joinedDate ? ` • Joined ${formatDate(customer.joinedDate)}` : ""}
            </p>
            <div className="customer-detail__badges">
              {(customer?.badges ?? []).map((badge) => (
                <span key={badge} className={`status-pill status-pill--${statusTone(badge)}`.trim()}>
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="customer-detail__action-card">
          <span className="customer-detail__action-label">Recommended action</span>
          <strong>{overview?.recommendedAction ?? "Open the overview to see retention guidance."}</strong>
          <p>
            Rule-based guidance grounded in visit, spend, package, and retention patterns for this
            customer.
          </p>
        </div>
      </section>

      <div className="report-kpi-strip customer-detail__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Lifetime spend</span>
          <span className="report-kpi-strip__value">{formatCurrency(customer?.lifetimeSpend ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Total paid value captured in the current clinic</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Total visits</span>
          <span className="report-kpi-strip__value">{(customer?.totalVisits ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Completed visit count across visit history</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Average visit spend</span>
          <span className="report-kpi-strip__value">
            {formatCurrency(customer?.averageSpendPerVisit ?? 0, currency)}
          </span>
          <span className="report-kpi-strip__hint">Average spend per visit</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Last visit</span>
          <span className="report-kpi-strip__value">
            {customer?.lastVisitDate ? formatDate(customer.lastVisitDate) : "No recent visit"}
          </span>
          <span className="report-kpi-strip__hint">
            {customer?.daysSinceLastVisit != null ? `${customer.daysSinceLastVisit} days ago` : "Waiting for activity"}
          </span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Preferred service</span>
          <span className="report-kpi-strip__value">{preferredServiceLabel}</span>
          <span className="report-kpi-strip__hint">{customer?.preferredServiceCategory || "Other"}</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Preferred therapist</span>
          <span className="report-kpi-strip__value">{preferredTherapistLabel}</span>
          <span className="report-kpi-strip__hint">
            {customer?.remainingSessions ? `${customer.remainingSessions} sessions remaining` : "No active package balance"}
          </span>
        </div>
      </div>

      <div className="customer-detail__tabs">
        {([
          { id: "overview", label: "Overview" },
          { id: "packages", label: "Packages", count: tabCounts.packages },
          { id: "bookings", label: "Bookings", count: tabCounts.bookings },
          { id: "payments", label: "Payments", count: tabCounts.payments },
          { id: "usage", label: "Usage over time", count: tabCounts.usage },
        ] as Array<{ id: DetailTab; label: string; count?: number }>).map((tab) => (
          <button
            key={tab.id}
            className={`customer-detail__tab ${activeTab === tab.id ? "customer-detail__tab--active" : ""}`.trim()}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.count != null && tab.count > 0 ? <small>{tab.count.toLocaleString("en-US")}</small> : null}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="customer-detail__section-stack">
          <div className="panel-grid panel-grid--split customer-detail__overview-grid">
            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Spend and visit trend"
              subtitle="Monthly revenue and visit depth for this customer inside the selected date range."
            >
              {overviewState.loading ? (
                <div className="inline-note">Loading customer trend...</div>
              ) : !overview || overview.trend.length === 0 ? (
                <EmptyState label="No trend data found" detail="The current range may not include any completed visits or payments." />
              ) : (
                <DualMetricBarChart
                  items={overview.trend.map((row) => ({
                    label: row.bucket,
                    primary: row.revenue,
                    secondary: row.visits,
                  }))}
                  primaryLabel="Revenue"
                  secondaryLabel="Visits"
                  formatPrimary={(value) => formatCurrency(value, currency)}
                />
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Business insights"
              subtitle="Signal-first observations designed for doctors, managers, and owners."
            >
              {overviewState.loading ? (
                <div className="inline-note">Loading insight rules...</div>
              ) : !overview ? (
                <EmptyState label="No insights available" />
              ) : (
                <div className="customer-detail__insight-list">
                  {overview.insights.map((insight) => (
                    <article
                      key={insight.id}
                      className={`customer-detail__insight customer-detail__insight--${toneClass(insight.tone)}`.trim()}
                    >
                      <strong>{insight.title}</strong>
                      <p>{insight.detail}</p>
                    </article>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="panel-grid panel-grid--split customer-detail__overview-grid">
            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Therapist relationship"
              subtitle="Who handled this customer most often and where the visit value concentrates."
            >
              {!overview ? (
                <EmptyState label="No therapist relationship found" />
              ) : overview.therapistRelationship.length === 0 ? (
                <EmptyState label="No therapist records available" />
              ) : (
                <HorizontalBarList
                  items={overview.therapistRelationship.map((row) => ({
                    label: row.therapistName,
                    value: row.visitCount,
                    valueDisplay: `${row.visitCount.toLocaleString("en-US")} visits • ${formatCurrency(row.serviceValue, currency)}`,
                  }))}
                />
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Service mix"
              subtitle="Category concentration helps identify breadth, upsell room, and over-reliance."
            >
              {!overview ? (
                <EmptyState label="No service mix available" />
              ) : overview.serviceMix.length === 0 ? (
                <EmptyState label="No service mix available" />
              ) : (
                <HorizontalBarList
                  items={overview.serviceMix.map((row) => ({
                    label: row.serviceCategory,
                    value: row.visitCount,
                    valueDisplay: `${row.visitCount.toLocaleString("en-US")} visits • ${formatCurrency(row.serviceValue, currency)}`,
                  }))}
                />
              )}
            </Panel>
          </div>

          <div className="panel-grid panel-grid--split customer-detail__overview-grid">
            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Recent service footprint"
              subtitle="Most recently used services give the team context for the next conversation."
            >
              {!overview ? (
                <EmptyState label="No recent services found" />
              ) : overview.recentServices.length === 0 ? (
                <EmptyState label="No recent services found" />
              ) : (
                <div className="customer-detail__recent-services">
                  {overview.recentServices.map((service) => (
                    <article key={`${service.serviceName}-${service.lastUsedDate}`} className="customer-detail__recent-card">
                      <strong>{service.serviceName}</strong>
                      <span>{formatDate(service.lastUsedDate)}</span>
                      <small>{service.visitCount.toLocaleString("en-US")} total uses</small>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Portfolio profile"
              subtitle="A small set of relationship signals to make the record legible at a glance."
            >
              <div className="customer-detail__mini-stats">
                <div className="customer-detail__mini-stat">
                  <span>Visit interval</span>
                  <strong>
                    {customer?.avgVisitIntervalDays != null ? `${customer.avgVisitIntervalDays} days` : "Not enough history"}
                  </strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>Payment preference</span>
                  <strong>{customer?.lastPaymentMethod || "Unknown"}</strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>Category breadth</span>
                  <strong>{customer?.categoryBreadth ?? 0} categories</strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>Recent momentum</span>
                  <strong>
                    {(customer?.recent3MonthVisits ?? 0).toLocaleString("en-US")} vs {(customer?.previous3MonthVisits ?? 0).toLocaleString("en-US")}
                  </strong>
                </div>
              </div>
              {overview?.assumptions.length ? (
                <div className="customer-detail__assumptions">
                  {overview.assumptions.map((assumption) => (
                    <p key={assumption}>{assumption}</p>
                  ))}
                </div>
              ) : null}
            </Panel>
          </div>
        </div>
      ) : null}

      {activeTab === "packages" ? (
        <Panel
          className="analytics-report__panel customer-detail__panel"
          title="Purchased services and package holdings"
          subtitle="Package health, remaining counts, and most recent usage in one place."
        >
          {packagesState.loading ? <div className="inline-note">Loading package holdings...</div> : null}
          {packagesState.error ? (
            <ErrorState label="Package holdings could not be loaded" detail={packagesState.error} />
          ) : null}
          {!packagesState.loading && !packagesState.error && (!packagesState.data || packagesState.data.packages.length === 0) ? (
            <EmptyState label="No package records found" detail="This customer may only purchase one-off services." />
          ) : null}
          {packagesState.data && packagesState.data.packages.length > 0 ? (
            <DataTable
              rows={packagesState.data.packages}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "service",
                  header: "Service",
                  render: (row) => (
                    <div className="customer-detail__metric-cell">
                      <strong>{row.serviceName}</strong>
                      <span>{row.packageName || row.serviceCategory}</span>
                    </div>
                  ),
                },
                { key: "category", header: "Category", render: (row) => row.serviceCategory },
                { key: "total", header: "Package total", render: (row) => row.packageTotal.toLocaleString("en-US") },
                { key: "used", header: "Used", render: (row) => row.usedCount.toLocaleString("en-US") },
                { key: "remaining", header: "Remaining", render: (row) => row.remainingCount.toLocaleString("en-US") },
                { key: "latest", header: "Latest usage", render: (row) => formatDate(row.latestUsageDate) },
                { key: "therapist", header: "Therapist", render: (row) => row.latestTherapist || "Unknown" },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => (
                    <span className={`status-pill status-pill--${statusTone(row.status)}`.trim()}>{row.status}</span>
                  ),
                },
              ]}
            />
          ) : null}
        </Panel>
      ) : null}

      {activeTab === "bookings" ? (
        <Panel
          className="analytics-report__panel customer-detail__panel"
          title="Booking history"
          subtitle={`${(bookingsState.data?.totalCount ?? 0).toLocaleString("en-US")} visits matched the current range`}
          action={
            <div className="customer-detail__table-tools">
              <label className="field field--compact field--search">
                <span>Search</span>
                <input
                  type="search"
                  placeholder="Service, package, therapist"
                  value={bookingsSearch}
                  onChange={(event) => setBookingsSearch(event.target.value)}
                />
              </label>
              <div className="pagination-controls">
                <button
                  className="button button--secondary"
                  disabled={bookingsPage <= 1}
                  onClick={() => setBookingsPage((value) => value - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {bookingsPage} of {bookingsTotalPages}
                </span>
                <button
                  className="button button--secondary"
                  disabled={bookingsPage >= bookingsTotalPages}
                  onClick={() => setBookingsPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          }
        >
          {bookingsState.loading ? <div className="inline-note">Loading booking history...</div> : null}
          {bookingsState.error ? (
            <ErrorState label="Booking history could not be loaded" detail={bookingsState.error} />
          ) : null}
          {!bookingsState.loading && !bookingsState.error && (!bookingsState.data || bookingsState.data.rows.length === 0) ? (
            <EmptyState label="No bookings found" detail="Try a wider range or clear the booking search." />
          ) : null}
          {bookingsState.data && bookingsState.data.rows.length > 0 ? (
            <DataTable
              rows={bookingsState.data.rows}
              rowKey={(row) => row.bookingId}
              columns={[
                { key: "time", header: "Visit time", render: (row) => row.checkInTime },
                { key: "service", header: "Service", render: (row) => row.serviceName || "—" },
                { key: "therapist", header: "Therapist", render: (row) => row.therapistName || "Unknown" },
                { key: "category", header: "Category", render: (row) => row.serviceCategory },
                { key: "clinic", header: "Clinic", render: (row) => row.clinicCode },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => <span className="status-pill status-pill--positive">{row.status}</span>,
                },
              ]}
            />
          ) : null}
        </Panel>
      ) : null}

      {activeTab === "payments" ? (
        <div className="customer-detail__section-stack">
          <div className="report-kpi-strip customer-detail__kpis">
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Total spent</span>
              <span className="report-kpi-strip__value">
                {formatCurrency(paymentsState.data?.summary.totalSpent ?? 0, currency)}
              </span>
              <span className="report-kpi-strip__hint">Paid invoice value in the selected range</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Invoices</span>
              <span className="report-kpi-strip__value">
                {(paymentsState.data?.summary.invoiceCount ?? 0).toLocaleString("en-US")}
              </span>
              <span className="report-kpi-strip__hint">Distinct paid invoices for this customer</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Average invoice</span>
              <span className="report-kpi-strip__value">
                {formatCurrency(paymentsState.data?.summary.averageInvoice ?? 0, currency)}
              </span>
              <span className="report-kpi-strip__hint">Average paid invoice size</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Outstanding</span>
              <span className="report-kpi-strip__value">
                {formatCurrency(paymentsState.data?.summary.outstandingAmount ?? 0, currency)}
              </span>
              <span className="report-kpi-strip__hint">Remaining balance still carried on invoices</span>
            </div>
          </div>

          <Panel
            className="analytics-report__panel customer-detail__panel"
            title="Payment history"
            subtitle={`${(paymentsState.data?.totalCount ?? 0).toLocaleString("en-US")} invoices matched the current filters`}
            action={
              <div className="customer-detail__table-tools">
                <label className="field field--compact field--search">
                  <span>Search</span>
                  <input
                    type="search"
                    placeholder="Invoice, service, package, payment"
                    value={paymentsSearch}
                    onChange={(event) => setPaymentsSearch(event.target.value)}
                  />
                </label>
                <button
                  className="button button--secondary"
                  disabled={!paymentsState.data || paymentsState.data.rows.length === 0}
                  onClick={() =>
                    downloadCustomerPaymentHistory(paymentsState.data?.rows ?? [], currency)
                  }
                >
                  Export CSV
                </button>
                <div className="pagination-controls">
                  <button
                    className="button button--secondary"
                    disabled={paymentsPage <= 1}
                    onClick={() => setPaymentsPage((value) => value - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {paymentsPage} of {paymentsTotalPages}
                  </span>
                  <button
                    className="button button--secondary"
                    disabled={paymentsPage >= paymentsTotalPages}
                    onClick={() => setPaymentsPage((value) => value + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            }
          >
            {paymentsState.loading ? <div className="inline-note">Loading payment history...</div> : null}
            {paymentsState.error ? (
              <ErrorState label="Payment history could not be loaded" detail={paymentsState.error} />
            ) : null}
            {!paymentsState.loading && !paymentsState.error && (!paymentsState.data || paymentsState.data.rows.length === 0) ? (
              <EmptyState label="No payment history found" detail="Try clearing the payment search or widening the date range." />
            ) : null}
            {paymentsState.data && paymentsState.data.rows.length > 0 ? (
              <DataTable
                rows={paymentsState.data.rows}
                rowKey={(row) => `${row.invoiceNumber}-${row.dateLabel}`}
                columns={[
                  { key: "date", header: "Date", render: (row) => formatDate(row.dateLabel) },
                  {
                    key: "invoice",
                    header: "Invoice",
                    render: (row) => <span className="customer-detail__strong">{row.invoiceNumber}</span>,
                  },
                  { key: "service", header: "Service", render: (row) => row.serviceName || "—" },
                  { key: "package", header: "Package", render: (row) => row.servicePackageName || "—" },
                  { key: "method", header: "Payment method", render: (row) => row.paymentMethod || "—" },
                  { key: "seller", header: "Sales person", render: (row) => row.salePerson || "Unknown" },
                  { key: "invoiceTotal", header: "Invoice total", render: (row) => formatCurrency(row.invoiceTotal, currency) },
                  { key: "discount", header: "Discount", render: (row) => formatCurrency(row.discount, currency) },
                  { key: "netAmount", header: "Net amount", render: (row) => formatCurrency(row.netAmount, currency) },
                  {
                    key: "outstanding",
                    header: "Outstanding",
                    render: (row) => formatCurrency(row.outstandingAmount, currency),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => (
                      <span className={`status-pill status-pill--${statusTone(row.paymentStatus)}`.trim()}>
                        {row.paymentStatus || "Unknown"}
                      </span>
                    ),
                  },
                ]}
              />
            ) : null}
          </Panel>
        </div>
      ) : null}

      {activeTab === "usage" ? (
        <div className="customer-detail__section-stack">
          <div className="report-kpi-strip customer-detail__kpis customer-detail__kpis--compact">
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Total usage</span>
              <span className="report-kpi-strip__value">
                {(usageState.data?.summary.totalUsage ?? 0).toLocaleString("en-US")}
              </span>
              <span className="report-kpi-strip__hint">Completed uses across the selected year</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Distinct services</span>
              <span className="report-kpi-strip__value">
                {(usageState.data?.summary.distinctServices ?? 0).toLocaleString("en-US")}
              </span>
              <span className="report-kpi-strip__hint">Tracked services in the heat map</span>
            </div>
          </div>

          <Panel
            className="analytics-report__panel customer-detail__panel"
            title="Service usage over time"
            subtitle="A month-by-month heat map of this customer's treatment pattern."
            action={
              <div className="customer-detail__table-tools">
                <label className="field field--compact">
                  <span>Year</span>
                  <select value={usageYear} onChange={(event) => setUsageYear(Number(event.target.value))}>
                    {usageYearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field--compact">
                  <span>Category</span>
                  <select value={usageCategory} onChange={(event) => setUsageCategory(event.target.value)}>
                    <option value="">All categories</option>
                    {(usageState.data?.categories ?? []).map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            }
          >
            {usageState.loading ? <div className="inline-note">Loading usage heat map...</div> : null}
            {usageState.error ? (
              <ErrorState label="Usage history could not be loaded" detail={usageState.error} />
            ) : null}
            {!usageState.loading && !usageState.error && usageState.data ? <UsageHeatmap data={usageState.data} /> : null}
          </Panel>

          <Panel
            className="analytics-report__panel customer-detail__panel"
            title="Top used services"
            subtitle="The strongest service patterns in the selected year."
          >
            {!usageState.data ? (
              <EmptyState label="No usage summary available" />
            ) : usageTopServices.length === 0 ? (
              <EmptyState label="No usage summary available" />
            ) : (
              <HorizontalBarList items={usageTopServices} />
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
