import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchServicePortalCustomers,
  fetchServicePortalOverview,
  fetchServicePortalPayments,
} from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { DonutChart } from "../../../components/DonutChart";
import { DualMetricBarChart } from "../../../components/DualMetricBarChart";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type {
  ServicePortalCustomersResponse,
  ServicePortalOverviewResponse,
  ServicePortalPaymentsResponse,
  ServiceRow,
} from "../../../types/domain";
import { startOfCurrentYear, today } from "../../../utils/date";
import { formatCurrency, formatDate, formatPercent } from "../../../utils/format";
import { useAccess } from "../../access/AccessProvider";
import { GET_SERVICES } from "../../core/services/queries";
import { buildCustomerPortalDetailPath } from "../customer-portal/customerPortalLink";

const SECTION_PAGE_SIZE = 12;

type ServiceCatalogResponse = {
  services: ServiceRow[];
};

type DetailTab = "overview" | "customers" | "payments";

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

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
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
  if (status === "Growing" || status === "Retention-led") {
    return "positive";
  }

  if (status === "Needs attention") {
    return "attention";
  }

  return "neutral";
}

export function ServiceDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const serviceName = searchParams.get("name") ?? "";
  const [range, setRange] = useState(() => ({
    fromDate: searchParams.get("fromDate") ?? startOfCurrentYear(),
    toDate: searchParams.get("toDate") ?? today(),
  }));
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [overviewState, setOverviewState] = useState<SectionState<ServicePortalOverviewResponse>>(createIdleState());
  const [customersState, setCustomersState] = useState<SectionState<ServicePortalCustomersResponse>>(createIdleState());
  const [paymentsState, setPaymentsState] = useState<SectionState<ServicePortalPaymentsResponse>>(createIdleState());
  const [customersSearch, setCustomersSearch] = useState("");
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [customersPage, setCustomersPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const deferredCustomersSearch = useDeferredValue(customersSearch.trim());
  const deferredPaymentsSearch = useDeferredValue(paymentsSearch.trim());

  const { data: catalogData } = useQuery<ServiceCatalogResponse>(GET_SERVICES, {
    variables: currentClinic
      ? {
          where: {
            clinic_id: { equals: currentClinic.id },
            name: { contains: serviceName },
            status: { notIn: ["CANCEL"] },
          },
          orderBy: [{ created_at: "desc" }],
          take: 50,
        }
      : undefined,
    skip: !currentClinic || !serviceName,
  });

  useEffect(() => {
    setCustomersPage(1);
  }, [deferredCustomersSearch]);

  useEffect(() => {
    setPaymentsPage(1);
  }, [deferredPaymentsSearch]);

  useEffect(() => {
    setCustomersState(createIdleState());
    setPaymentsState(createIdleState());
    setCustomersSearch("");
    setPaymentsSearch("");
    setCustomersPage(1);
    setPaymentsPage(1);
  }, [currentClinic?.id, serviceName, range.fromDate, range.toDate]);

  useEffect(() => {
    if (!currentClinic || !serviceName.trim()) {
      return;
    }

    let active = true;
    setOverviewState((current) => ({ ...current, loading: true, error: null }));

    fetchServicePortalOverview({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      serviceName,
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
            error: loadError instanceof Error ? loadError.message : "Failed to load the service overview.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [currentClinic, range.fromDate, range.toDate, serviceName]);

  useEffect(() => {
    if (!currentClinic || !serviceName.trim() || activeTab !== "customers") {
      return;
    }

    let active = true;
    setCustomersState((current) => ({ ...current, loading: true, error: null }));

    fetchServicePortalCustomers({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      serviceName,
      search: deferredCustomersSearch,
      page: customersPage,
      pageSize: SECTION_PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setCustomersState({
            data: result,
            loading: false,
            error: null,
          });
        }
      })
      .catch((loadError) => {
        if (active) {
          setCustomersState({
            data: null,
            loading: false,
            error: loadError instanceof Error ? loadError.message : "Failed to load service customers.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, currentClinic, customersPage, deferredCustomersSearch, range.fromDate, range.toDate, serviceName]);

  useEffect(() => {
    if (!currentClinic || !serviceName.trim() || activeTab !== "payments") {
      return;
    }

    let active = true;
    setPaymentsState((current) => ({ ...current, loading: true, error: null }));

    fetchServicePortalPayments({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      serviceName,
      search: deferredPaymentsSearch,
      page: paymentsPage,
      pageSize: SECTION_PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setPaymentsState({
            data: result,
            loading: false,
            error: null,
          });
        }
      })
      .catch((loadError) => {
        if (active) {
          setPaymentsState({
            data: null,
            loading: false,
            error: loadError instanceof Error ? loadError.message : "Failed to load service payments.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, currentClinic, deferredPaymentsSearch, paymentsPage, range.fromDate, range.toDate, serviceName]);

  const currency = currentClinic?.currency || "MMK";
  const overview = overviewState.data;
  const service = overview?.service;
  const customersTotalPages = Math.max(1, Math.ceil((customersState.data?.totalCount ?? 0) / SECTION_PAGE_SIZE));
  const paymentsTotalPages = Math.max(1, Math.ceil((paymentsState.data?.totalCount ?? 0) / SECTION_PAGE_SIZE));
  const catalogService = useMemo(
    () =>
      (catalogData?.services ?? []).find(
        (row) => row.name.trim().toLowerCase() === serviceName.trim().toLowerCase(),
      ) ?? null,
    [catalogData?.services, serviceName],
  );
  const displayInitials = initialsFor(serviceName || "S");

  const overviewTopTherapists = useMemo(
    () =>
      (overview?.therapistPerformance ?? []).map((row) => ({
        label: row.therapistName,
        value: row.bookingCount,
        valueDisplay: `${row.bookingCount.toLocaleString("en-US")} bookings • ${formatCurrency(row.revenue, currency)}`,
      })),
    [currency, overview?.therapistPerformance],
  );
  const overviewRelatedServices = useMemo(
    () =>
      (overview?.relatedServices ?? []).map((row) => ({
        label: row.serviceName,
        value: row.sharedCustomerCount,
        valueDisplay: `${row.sharedCustomerCount.toLocaleString("en-US")} shared customers • ${row.pairCount.toLocaleString("en-US")} pairings`,
      })),
    [overview?.relatedServices],
  );

  if (!serviceName.trim()) {
    return (
      <div className="page-stack page-stack--workspace analytics-report service-detail">
        <ErrorState
          label="Service identity is missing"
          detail="Open this page from the Service Portal so the workspace knows which service to load."
        />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report service-detail">
      <PageHeader
        eyebrow="Services"
        title="Service 360"
        description="A premium workspace for understanding service demand, repeat strength, therapist dependence, and commercial health."
        hideContext
        actions={
          <div className="customer-detail__header-actions">
            <button
              className="button button--secondary"
              onClick={() =>
                navigate(`/analytics/services?fromDate=${encodeURIComponent(range.fromDate)}&toDate=${encodeURIComponent(range.toDate)}`)
              }
            >
              Back to list
            </button>
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
          </div>
        }
      />

      {overviewState.error ? (
        <ErrorState label="Service overview could not be loaded" detail={overviewState.error} />
      ) : null}

      <section className="customer-detail__hero service-detail__hero">
        <div className="customer-detail__identity-card service-detail__identity-card">
          <div className="customer-detail__avatar service-detail__avatar">{displayInitials}</div>
          <div className="customer-detail__identity-copy">
            <span className="page-header__eyebrow">Service intelligence</span>
            <h2>{serviceName}</h2>
            <p>
              {service?.serviceCategory || "Other"}
              {catalogService?.status ? ` • Catalog ${catalogService.status}` : ""}
              {service?.lastBookedDate ? ` • Last booked ${formatDate(service.lastBookedDate)}` : ""}
            </p>
            <div className="customer-detail__badges">
              {service ? (
                <span className={`status-pill status-pill--${statusTone(service.status)}`.trim()}>
                  {service.status}
                </span>
              ) : null}
              {catalogService?.status ? (
                <span className={`status-pill status-pill--${catalogService.status === "ACTIVE" ? "positive" : "neutral"}`.trim()}>
                  {catalogService.status}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="customer-detail__action-card service-detail__action-card">
          <span className="customer-detail__action-label">Recommended action</span>
          <strong>{overview?.recommendedAction ?? "Loading service recommendation..."}</strong>
          <p>
            Designed to help clinic owners, aesthetic doctors, and operations leaders decide how this service should grow, improve, or be protected.
          </p>
        </div>
      </section>

      <div className="report-kpi-strip customer-detail__kpis service-detail__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Revenue</span>
          <span className="report-kpi-strip__value">{formatCurrency(service?.totalRevenue ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Paid service-line revenue within the selected period.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Bookings</span>
          <span className="report-kpi-strip__value">{(service?.bookingCount ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Completed visits attributed to this service.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Customers</span>
          <span className="report-kpi-strip__value">{(service?.customerCount ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Distinct customers touched by this service.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Avg selling price</span>
          <span className="report-kpi-strip__value">{formatCurrency(service?.averageSellingPrice ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Typical paid line value for this service.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Repeat rate</span>
          <span className="report-kpi-strip__value">{(service?.repeatPurchaseRate ?? 0).toFixed(1)}%</span>
          <span className="report-kpi-strip__hint">Customers who came back for a second or later session.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Growth</span>
          <span className="report-kpi-strip__value">{formatPercent(service?.growthRate ?? 0)}</span>
          <span className="report-kpi-strip__hint">Compared with the previous matching date window.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Package mix</span>
          <span className="report-kpi-strip__value">{(service?.packageMixPct ?? 0).toFixed(1)}%</span>
          <span className="report-kpi-strip__hint">Share of paid lines sold through packages.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Top therapist</span>
          <span className="report-kpi-strip__value">{service?.topTherapist || "Unknown"}</span>
          <span className="report-kpi-strip__hint">
            {service ? `${service.topTherapistShare.toFixed(1)}% of visible bookings` : "Loading therapist mix"}
          </span>
        </div>
      </div>

      <div className="customer-detail__tabs">
        {([
          { id: "overview", label: "Overview" },
          { id: "customers", label: "Customers", count: customersState.data?.totalCount ?? 0 },
          { id: "payments", label: "Payments", count: paymentsState.data?.totalCount ?? 0 },
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
              title="Revenue and booking trend"
              subtitle="Monthly commercial demand and operational usage for this service."
            >
              {overviewState.loading ? (
                <div className="inline-note inline-note--loading">Loading service trend...</div>
              ) : !overview || overview.trend.length === 0 ? (
                <EmptyState label="No trend data found" detail="The selected range may not include paid or completed activity for this service." />
              ) : (
                <DualMetricBarChart
                  items={overview.trend.map((row) => ({
                    label: row.bucket,
                    primary: row.revenue,
                    secondary: row.bookings,
                  }))}
                  primaryLabel="Revenue"
                  secondaryLabel="Bookings"
                  formatPrimary={(value) => formatCurrency(value, currency)}
                />
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Business insights"
              subtitle="Signals designed to help teams decide whether to promote, protect, reprice, or improve this service."
            >
              {overviewState.loading ? (
                <div className="inline-note inline-note--loading">Loading service insights...</div>
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
              title="Therapist performance"
              subtitle="Which therapist carries demand and where the service value concentrates."
            >
              {!overview ? (
                <EmptyState label="No therapist performance available" />
              ) : overviewTopTherapists.length === 0 ? (
                <EmptyState label="No therapist performance available" />
              ) : (
                <HorizontalBarList items={overviewTopTherapists} />
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Payment mix"
              subtitle="How customers are currently paying for this service."
            >
              {!overview ? (
                <EmptyState label="No payment mix available" />
              ) : overview.paymentMix.length === 0 ? (
                <EmptyState label="No payment mix available" />
              ) : (
                <DonutChart
                  items={overview.paymentMix.map((row) => ({
                    label: row.paymentMethod,
                    value: row.totalAmount,
                    meta: `${row.transactionCount.toLocaleString("en-US")} payments`,
                  }))}
                  totalLabel="Revenue"
                  centerLabel={formatCurrency(service?.totalRevenue ?? 0, currency)}
                />
              )}
            </Panel>
          </div>

          <div className="panel-grid panel-grid--split customer-detail__overview-grid">
            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Services often bought around this one"
              subtitle="Shared-customer overlap helps surface bundle ideas and care-plan adjacency."
            >
              {!overview ? (
                <EmptyState label="No related services found" />
              ) : overviewRelatedServices.length === 0 ? (
                <EmptyState label="No related services found" />
              ) : (
                <HorizontalBarList items={overviewRelatedServices} />
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Peak booking periods"
              subtitle="Useful for staffing, promotion timing, and premium availability planning."
            >
              {!overview ? (
                <EmptyState label="No peak period data found" />
              ) : (
                <div className="service-detail__peak-grid">
                  <div className="service-detail__peak-card">
                    <span>Strongest weekdays</span>
                    {overview.peakPeriods.weekdays.length === 0 ? (
                      <strong>No pattern yet</strong>
                    ) : (
                      overview.peakPeriods.weekdays.map((row) => (
                        <p key={row.label}>
                          <strong>{row.label}</strong>
                          <span>{row.bookingCount.toLocaleString("en-US")} bookings</span>
                        </p>
                      ))
                    )}
                  </div>
                  <div className="service-detail__peak-card">
                    <span>Strongest hours</span>
                    {overview.peakPeriods.hours.length === 0 ? (
                      <strong>No pattern yet</strong>
                    ) : (
                      overview.peakPeriods.hours.map((row) => (
                        <p key={row.label}>
                          <strong>{row.label}</strong>
                          <span>{row.bookingCount.toLocaleString("en-US")} bookings</span>
                        </p>
                      ))
                    )}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="panel-grid panel-grid--split customer-detail__overview-grid">
            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Top customers for this service"
              subtitle="A quick read on who values the service most and where repeat behavior is concentrated."
            >
              {!overview ? (
                <EmptyState label="No customer highlights found" />
              ) : overview.topCustomers.length === 0 ? (
                <EmptyState label="No customer highlights found" />
              ) : (
                <div className="service-detail__customer-grid">
                  {overview.topCustomers.map((row) => (
                    <button
                      type="button"
                      key={`${row.customerName}-${row.phoneNumber}`}
                      className="service-detail__customer-card"
                      onClick={() =>
                        navigate(
                          buildCustomerPortalDetailPath({
                            customerName: row.customerName,
                            customerPhone: row.phoneNumber,
                            fromDate: range.fromDate,
                            toDate: range.toDate,
                          }),
                        )
                      }
                    >
                      <div>
                        <strong>{row.customerName}</strong>
                        <span>{row.relationship}</span>
                      </div>
                      <p>{formatCurrency(row.totalRevenue, currency)}</p>
                      <small>
                        {row.visitCount.toLocaleString("en-US")} visits
                        {row.lastVisitDate ? ` • ${formatDate(row.lastVisitDate)}` : ""}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Pricing and package profile"
              subtitle="A compact commercial view for margin pressure, package behavior, and revenue quality."
            >
              <div className="customer-detail__mini-stats">
                <div className="customer-detail__mini-stat">
                  <span>Average discount</span>
                  <strong>{(service?.averageDiscountRate ?? 0).toFixed(1)}%</strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>Revenue per customer</span>
                  <strong>{formatCurrency(service?.revenuePerCustomer ?? 0, currency)}</strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>Remaining package usage</span>
                  <strong>{(service?.packageRemainingUsage ?? 0).toLocaleString("en-US")} sessions</strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>One-off mix</span>
                  <strong>{(service?.oneOffMixPct ?? 0).toFixed(1)}%</strong>
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

      {activeTab === "customers" ? (
        <div className="customer-detail__section-stack">
          <div className="report-kpi-strip customer-detail__kpis">
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Customers</span>
              <span className="report-kpi-strip__value">
                {(customersState.data?.summary.customerCount ?? 0).toLocaleString("en-US")}
              </span>
              <span className="report-kpi-strip__hint">Distinct customers who bought or used this service.</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Repeat customers</span>
              <span className="report-kpi-strip__value">
                {(customersState.data?.summary.repeatCustomers ?? 0).toLocaleString("en-US")}
              </span>
              <span className="report-kpi-strip__hint">Customers with more than one visible session.</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Avg revenue / customer</span>
              <span className="report-kpi-strip__value">
                {formatCurrency(customersState.data?.summary.averageRevenuePerCustomer ?? 0, currency)}
              </span>
              <span className="report-kpi-strip__hint">Commercial depth of the service relationship.</span>
            </div>
          </div>

          <Panel
            className="analytics-report__panel customer-detail__panel"
            title="Customer portfolio for this service"
            subtitle={`${(customersState.data?.totalCount ?? 0).toLocaleString("en-US")} customers matched the current range`}
            action={
              <div className="customer-detail__table-tools">
                <label className="field field--compact field--search">
                  <span>Search</span>
                  <input
                    type="search"
                    placeholder="Name, phone, member"
                    value={customersSearch}
                    onChange={(event) => setCustomersSearch(event.target.value)}
                  />
                </label>
                <div className="pagination-controls">
                  <button
                    className="button button--secondary"
                    disabled={customersPage <= 1}
                    onClick={() => setCustomersPage((value) => value - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {customersPage} of {customersTotalPages}
                  </span>
                  <button
                    className="button button--secondary"
                    disabled={customersPage >= customersTotalPages}
                    onClick={() => setCustomersPage((value) => value + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            }
          >
            {customersState.loading ? <div className="inline-note inline-note--loading">Loading service customers...</div> : null}
            {customersState.error ? (
              <ErrorState label="Service customers could not be loaded" detail={customersState.error} />
            ) : null}
            {!customersState.loading && !customersState.error && (!customersState.data || customersState.data.rows.length === 0) ? (
              <EmptyState label="No customers found" detail="Try widening the range or clearing the customer search." />
            ) : null}
            {customersState.data && customersState.data.rows.length > 0 ? (
              <DataTable
                rows={customersState.data.rows}
                rowKey={(row) => `${row.customerName}-${row.phoneNumber}`}
                onRowClick={(row) =>
                  navigate(
                    buildCustomerPortalDetailPath({
                      customerName: row.customerName,
                      customerPhone: row.phoneNumber,
                      fromDate: range.fromDate,
                      toDate: range.toDate,
                    }),
                  )
                }
                columns={[
                  {
                    key: "customer",
                    header: "Customer",
                    render: (row) => (
                      <div className="customer-detail__metric-cell">
                        <strong>{row.customerName}</strong>
                        <span>{row.phoneNumber}</span>
                      </div>
                    ),
                  },
                  {
                    key: "member",
                    header: "Member",
                    render: (row) => row.memberId || "—",
                  },
                  {
                    key: "revenue",
                    header: "Revenue",
                    render: (row) => formatCurrency(row.totalRevenue, currency),
                  },
                  {
                    key: "visits",
                    header: "Visits",
                    render: (row) => row.visitCount.toLocaleString("en-US"),
                  },
                  {
                    key: "last",
                    header: "Last visit",
                    render: (row) => (row.lastVisitDate ? formatDate(row.lastVisitDate) : "—"),
                  },
                  {
                    key: "relationship",
                    header: "Relationship",
                    render: (row) => (
                      <span className={`status-pill status-pill--${row.relationship === "New" ? "neutral" : "positive"}`.trim()}>
                        {row.relationship}
                      </span>
                    ),
                  },
                ]}
              />
            ) : null}
          </Panel>
        </div>
      ) : null}

      {activeTab === "payments" ? (
        <div className="customer-detail__section-stack">
          <div className="report-kpi-strip customer-detail__kpis">
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Revenue</span>
              <span className="report-kpi-strip__value">
                {formatCurrency(paymentsState.data?.summary.totalRevenue ?? 0, currency)}
              </span>
              <span className="report-kpi-strip__hint">Paid service-line revenue in the selected range.</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Invoices</span>
              <span className="report-kpi-strip__value">
                {(paymentsState.data?.summary.invoiceCount ?? 0).toLocaleString("en-US")}
              </span>
              <span className="report-kpi-strip__hint">Distinct invoices that included this service.</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Avg line value</span>
              <span className="report-kpi-strip__value">
                {formatCurrency(paymentsState.data?.summary.averageLineValue ?? 0, currency)}
              </span>
              <span className="report-kpi-strip__hint">Average paid value per service line.</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Avg discount</span>
              <span className="report-kpi-strip__value">
                {(paymentsState.data?.summary.averageDiscountRate ?? 0).toFixed(1)}%
              </span>
              <span className="report-kpi-strip__hint">Average discount intensity on invoices carrying this service.</span>
            </div>
          </div>

          <Panel
            className="analytics-report__panel customer-detail__panel"
            title="Service payment lines"
            subtitle={`${(paymentsState.data?.totalCount ?? 0).toLocaleString("en-US")} paid lines matched the current filters`}
            action={
              <div className="customer-detail__table-tools">
                <label className="field field--compact field--search">
                  <span>Search</span>
                  <input
                    type="search"
                    placeholder="Invoice, customer, package, payment"
                    value={paymentsSearch}
                    onChange={(event) => setPaymentsSearch(event.target.value)}
                  />
                </label>
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
            {paymentsState.loading ? <div className="inline-note inline-note--loading">Loading service payments...</div> : null}
            {paymentsState.error ? (
              <ErrorState label="Service payments could not be loaded" detail={paymentsState.error} />
            ) : null}
            {!paymentsState.loading && !paymentsState.error && (!paymentsState.data || paymentsState.data.rows.length === 0) ? (
              <EmptyState label="No payment lines found" detail="Try widening the range or clearing the payment search." />
            ) : null}
            {paymentsState.data && paymentsState.data.rows.length > 0 ? (
              <DataTable
                rows={paymentsState.data.rows}
                rowKey={(row) =>
                  `${row.invoiceNumber}-${row.dateLabel}-${row.customerName}-${row.servicePackageName ?? "one-off"}-${row.lineTotal}-${row.itemQuantity}`
                }
                columns={[
                  { key: "date", header: "Date", render: (row) => row.dateLabel },
                  { key: "invoice", header: "Invoice", render: (row) => row.invoiceNumber },
                  {
                    key: "customer",
                    header: "Customer",
                    render: (row) => (
                      <div className="customer-detail__metric-cell">
                        <strong>{row.customerName}</strong>
                        <span>{row.phoneNumber}</span>
                      </div>
                    ),
                  },
                  {
                    key: "package",
                    header: "Package",
                    render: (row) => row.servicePackageName || "One-off",
                  },
                  {
                    key: "quantity",
                    header: "Qty",
                    render: (row) => row.itemQuantity.toLocaleString("en-US"),
                  },
                  {
                    key: "price",
                    header: "Unit price",
                    render: (row) => formatCurrency(row.unitPrice, currency),
                  },
                  {
                    key: "total",
                    header: "Line total",
                    render: (row) => formatCurrency(row.lineTotal, currency),
                  },
                  {
                    key: "payment",
                    header: "Payment",
                    render: (row) => (
                      <div className="customer-detail__metric-cell">
                        <strong>{row.paymentMethod}</strong>
                        <span>{row.salePerson || "Unknown"}</span>
                      </div>
                    ),
                  },
                ]}
              />
            ) : null}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
