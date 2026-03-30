import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchTherapistPortalCustomers,
  fetchTherapistPortalOverview,
  fetchTherapistPortalTreatments,
} from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DualMetricBarChart } from "../../../components/DualMetricBarChart";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type {
  TherapistPortalCustomersResponse,
  TherapistPortalOverviewResponse,
  TherapistPortalTreatmentsResponse,
} from "../../../types/domain";
import { startOfCurrentYear, today } from "../../../utils/date";
import { formatCurrency, formatDate, formatPercent } from "../../../utils/format";
import { useAccess } from "../../access/AccessProvider";
import { buildCustomerPortalDetailPath } from "../customer-portal/customerPortalLink";
import { buildServicePortalDetailPath } from "../service-portal/servicePortalLink";

const SECTION_PAGE_SIZE = 12;

type DetailTab = "overview" | "customers" | "treatments";

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

export function TherapistDetailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const therapistName = searchParams.get("name") ?? "";
  const [range, setRange] = useState(() => ({
    fromDate: searchParams.get("fromDate") ?? startOfCurrentYear(),
    toDate: searchParams.get("toDate") ?? today(),
  }));
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [overviewState, setOverviewState] = useState<SectionState<TherapistPortalOverviewResponse>>(createIdleState());
  const [customersState, setCustomersState] = useState<SectionState<TherapistPortalCustomersResponse>>(createIdleState());
  const [treatmentsState, setTreatmentsState] = useState<SectionState<TherapistPortalTreatmentsResponse>>(createIdleState());
  const [customersSearch, setCustomersSearch] = useState("");
  const [treatmentsSearch, setTreatmentsSearch] = useState("");
  const [customersPage, setCustomersPage] = useState(1);
  const [treatmentsPage, setTreatmentsPage] = useState(1);
  const deferredCustomersSearch = useDeferredValue(customersSearch.trim());
  const deferredTreatmentsSearch = useDeferredValue(treatmentsSearch.trim());

  useEffect(() => {
    setCustomersPage(1);
  }, [deferredCustomersSearch]);

  useEffect(() => {
    setTreatmentsPage(1);
  }, [deferredTreatmentsSearch]);

  useEffect(() => {
    setCustomersState(createIdleState());
    setTreatmentsState(createIdleState());
    setCustomersSearch("");
    setTreatmentsSearch("");
    setCustomersPage(1);
    setTreatmentsPage(1);
  }, [currentClinic?.id, therapistName, range.fromDate, range.toDate]);

  useEffect(() => {
    if (!currentClinic || !therapistName.trim()) {
      return;
    }

    let active = true;
    setOverviewState((current) => ({ ...current, loading: true, error: null }));

    fetchTherapistPortalOverview({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      therapistName,
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
            error: loadError instanceof Error ? loadError.message : "Failed to load therapist overview.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [currentClinic, range.fromDate, range.toDate, therapistName]);

  useEffect(() => {
    if (!currentClinic || !therapistName.trim() || activeTab !== "customers") {
      return;
    }

    let active = true;
    setCustomersState((current) => ({ ...current, loading: true, error: null }));

    fetchTherapistPortalCustomers({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      therapistName,
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
            error: loadError instanceof Error ? loadError.message : "Failed to load therapist customers.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, currentClinic, customersPage, deferredCustomersSearch, range.fromDate, range.toDate, therapistName]);

  useEffect(() => {
    if (!currentClinic || !therapistName.trim() || activeTab !== "treatments") {
      return;
    }

    let active = true;
    setTreatmentsState((current) => ({ ...current, loading: true, error: null }));

    fetchTherapistPortalTreatments({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      therapistName,
      search: deferredTreatmentsSearch,
      page: treatmentsPage,
      pageSize: SECTION_PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setTreatmentsState({
            data: result,
            loading: false,
            error: null,
          });
        }
      })
      .catch((loadError) => {
        if (active) {
          setTreatmentsState({
            data: null,
            loading: false,
            error: loadError instanceof Error ? loadError.message : "Failed to load therapist treatments.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, currentClinic, deferredTreatmentsSearch, range.fromDate, range.toDate, therapistName, treatmentsPage]);

  const currency = currentClinic?.currency || "MMK";
  const overview = overviewState.data;
  const therapist = overview?.therapist;
  const customersTotalPages = Math.max(1, Math.ceil((customersState.data?.totalCount ?? 0) / SECTION_PAGE_SIZE));
  const treatmentsTotalPages = Math.max(1, Math.ceil((treatmentsState.data?.totalCount ?? 0) / SECTION_PAGE_SIZE));
  const displayInitials = initialsFor(therapistName || "T");

  const serviceMixItems = useMemo(
    () =>
      (overview?.serviceMix ?? []).map((row) => ({
        label: row.serviceCategory,
        value: row.treatmentsCompleted,
        valueDisplay: `${row.treatmentsCompleted.toLocaleString("en-US")} treatments • ${formatCurrency(row.estimatedTreatmentValue, currency)}`,
      })),
    [currency, overview?.serviceMix],
  );

  const tabCounts = {
    customers: customersState.data?.totalCount ?? 0,
    treatments: treatmentsState.data?.totalCount ?? 0,
  };

  if (!therapistName.trim()) {
    return (
      <div className="page-stack page-stack--workspace analytics-report therapist-detail">
        <ErrorState
          label="Therapist identity is missing"
          detail="Open this page from Therapist Portal so the workspace knows which therapist to load."
        />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report therapist-detail">
      <PageHeader
        eyebrow="Therapists"
        title="Therapist detail"
        description="A premium owner view for therapist demand, continuity, service specialization, and workload quality."
        hideContext
        actions={
          <div className="customer-detail__header-actions">
            <button
              className="button button--secondary"
              onClick={() =>
                navigate(
                  `/analytics/therapists?fromDate=${encodeURIComponent(range.fromDate)}&toDate=${encodeURIComponent(range.toDate)}`,
                )
              }
            >
              Back to list
            </button>
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
          </div>
        }
      />

      {overviewState.error ? <ErrorState label="Therapist overview could not be loaded" detail={overviewState.error} /> : null}

      <section className="customer-detail__hero therapist-detail__hero">
        <div className="customer-detail__identity-card therapist-detail__identity-card">
          <div className="customer-detail__avatar therapist-detail__avatar">{displayInitials}</div>
          <div className="customer-detail__identity-copy">
            <span className="page-header__eyebrow">Therapist intelligence</span>
            <h2>{therapistName}</h2>
            <p>
              {therapist?.topCategory || "Mixed category"}
              {therapist?.lastTreatmentDate ? ` • Last active ${formatDate(therapist.lastTreatmentDate)}` : ""}
            </p>
            <div className="customer-detail__badges">
              {therapist ? (
                <span className={`status-pill status-pill--${therapist.utilizationScore >= 78 ? "attention" : "positive"}`.trim()}>
                  {therapist.workloadBand}
                </span>
              ) : null}
              {therapist?.topService ? <span className="status-pill status-pill--neutral">{therapist.topService}</span> : null}
            </div>
          </div>
        </div>

        <div className="customer-detail__action-card therapist-detail__action-card">
          <span className="customer-detail__action-label">Recommended action</span>
          <strong>{overview?.recommendedAction ?? "Loading therapist recommendation..."}</strong>
          <p>
            Built to help clinic owners decide whether this therapist should be protected, promoted, diversified, or given more capacity support.
          </p>
        </div>
      </section>

      <div className="report-kpi-strip customer-detail__kpis therapist-detail__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Treatment value</span>
          <span className="report-kpi-strip__value">{formatCurrency(therapist?.estimatedTreatmentValue ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Estimated from treatment row prices in the selected date window.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Treatments</span>
          <span className="report-kpi-strip__value">{(therapist?.treatmentsCompleted ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Completed treatment rows handled by this therapist.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Customers served</span>
          <span className="report-kpi-strip__value">{(therapist?.customersServed ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Distinct customers touched in the selected window.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Repeat customers</span>
          <span className="report-kpi-strip__value">{(therapist?.repeatCustomerRate ?? 0).toFixed(1)}%</span>
          <span className="report-kpi-strip__hint">{(therapist?.repeatCustomers ?? 0).toLocaleString("en-US")} returning customers</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Top service</span>
          <span className="report-kpi-strip__value">{therapist?.topService || "Unknown"}</span>
          <span className="report-kpi-strip__hint">
            {therapist ? `${therapist.topServiceShare.toFixed(1)}% of visible treatments` : "Loading service profile"}
          </span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Active days</span>
          <span className="report-kpi-strip__value">{(therapist?.activeDays ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">
            {therapist ? `${therapist.averageTreatmentsPerActiveDay.toFixed(1)} treatments per active day` : "Loading coverage"}
          </span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Growth</span>
          <span className="report-kpi-strip__value">{formatPercent(therapist?.growthRate ?? 0)}</span>
          <span className="report-kpi-strip__hint">Compared with the previous matching date window.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Utilization</span>
          <span className="report-kpi-strip__value">{(therapist?.utilizationScore ?? 0).toLocaleString("en-US")}/100</span>
          <span className="report-kpi-strip__hint">{therapist?.workloadBand || "Loading workload profile"}</span>
        </div>
      </div>

      <div className="customer-detail__tabs">
        {([
          { id: "overview", label: "Overview" },
          { id: "customers", label: "Customers", count: tabCounts.customers },
          { id: "treatments", label: "Treatments", count: tabCounts.treatments },
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
              title="Treatment contribution trend"
              subtitle="Treatment flow and estimated treatment value across the selected date range."
            >
              {overviewState.loading ? (
                <div className="inline-note">Loading therapist trend...</div>
              ) : !overview || overview.trend.length === 0 ? (
                <EmptyState label="No trend data found" detail="The current date range may not include completed treatment activity for this therapist." />
              ) : (
                <DualMetricBarChart
                  items={overview.trend.map((row) => ({
                    label: row.bucket,
                    primary: row.estimatedTreatmentValue,
                    secondary: row.treatmentsCompleted,
                  }))}
                  primaryLabel="Estimated treatment value"
                  secondaryLabel="Treatments"
                  formatPrimary={(value) => formatCurrency(value, currency)}
                />
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Business insights"
              subtitle="Signal-first observations for growth, continuity, specialization, and workload balance."
            >
              {overviewState.loading ? (
                <div className="inline-note">Loading therapist insights...</div>
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
              title="Top services performed"
              subtitle="Which services this therapist carries most often, and how much customer depth sits behind them."
            >
              {!overview ? (
                <EmptyState label="No service performance available" />
              ) : overview.topServices.length === 0 ? (
                <EmptyState label="No service performance available" />
              ) : (
                <DataTable
                  rows={overview.topServices}
                  rowKey={(row) => row.serviceName}
                  columns={[
                    {
                      key: "service",
                      header: "Service",
                      render: (row) => (
                        <button
                          type="button"
                          className="entity-link-button entity-link-button--strong"
                          onClick={() =>
                            navigate(
                              buildServicePortalDetailPath({
                                serviceName: row.serviceName,
                                fromDate: range.fromDate,
                                toDate: range.toDate,
                              }),
                            )
                          }
                        >
                          {row.serviceName}
                        </button>
                      ),
                    },
                    { key: "category", header: "Category", render: (row) => row.serviceCategory },
                    {
                      key: "treatments",
                      header: "Treatments",
                      render: (row) => row.treatmentsCompleted.toLocaleString("en-US"),
                    },
                    {
                      key: "customers",
                      header: "Customers",
                      render: (row) => (
                        <div className="customer-detail__metric-cell">
                          <strong>{row.customersServed.toLocaleString("en-US")}</strong>
                          <span>{row.repeatCustomerRate.toFixed(1)}% repeat</span>
                        </div>
                      ),
                    },
                    {
                      key: "value",
                      header: "Treatment value",
                      render: (row) => formatCurrency(row.estimatedTreatmentValue, currency),
                    },
                  ]}
                />
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Service mix"
              subtitle="Category concentration helps show whether this therapist is a specialist or a broad operator."
            >
              {!overview ? (
                <EmptyState label="No service mix available" />
              ) : serviceMixItems.length === 0 ? (
                <EmptyState label="No service mix available" />
              ) : (
                <HorizontalBarList items={serviceMixItems} />
              )}
            </Panel>
          </div>

          <div className="panel-grid panel-grid--split customer-detail__overview-grid">
            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Busiest periods"
              subtitle="Useful for staffing, schedule design, and premium availability planning."
            >
              {!overview ? (
                <EmptyState label="No activity pattern found" />
              ) : (
                <div className="service-detail__peak-grid">
                  <div className="service-detail__peak-card">
                    <span>Strongest weekdays</span>
                    {overview.busiestPeriods.weekdays.length === 0 ? (
                      <strong>No pattern yet</strong>
                    ) : (
                      overview.busiestPeriods.weekdays.map((row) => (
                        <p key={row.label}>
                          <strong>{row.label}</strong>
                          <span>{row.treatmentCount.toLocaleString("en-US")} treatments</span>
                        </p>
                      ))
                    )}
                  </div>
                  <div className="service-detail__peak-card">
                    <span>Strongest hours</span>
                    {overview.busiestPeriods.hours.length === 0 ? (
                      <strong>No pattern yet</strong>
                    ) : (
                      overview.busiestPeriods.hours.map((row) => (
                        <p key={row.label}>
                          <strong>{row.label}</strong>
                          <span>{row.treatmentCount.toLocaleString("en-US")} treatments</span>
                        </p>
                      ))
                    )}
                  </div>
                </div>
              )}
            </Panel>

            <Panel
              className="analytics-report__panel customer-detail__panel"
              title="Operating profile"
              subtitle="A compact read on therapist specialization, load, and treatment cadence."
            >
              <div className="customer-detail__mini-stats">
                <div className="customer-detail__mini-stat">
                  <span>Average treatment value</span>
                  <strong>{formatCurrency(therapist?.averageTreatmentValue ?? 0, currency)}</strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>Service breadth</span>
                  <strong>{(therapist?.serviceBreadth ?? 0).toLocaleString("en-US")} services</strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>Top service share</span>
                  <strong>{(therapist?.topServiceShare ?? 0).toFixed(1)}%</strong>
                </div>
                <div className="customer-detail__mini-stat">
                  <span>Last treatment</span>
                  <strong>{therapist?.lastTreatmentDate ? formatDate(therapist.lastTreatmentDate) : "No recent activity"}</strong>
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

          <Panel
            className="analytics-report__panel customer-detail__panel"
            title="Recent customers served"
            subtitle="A quick owner view of who this therapist recently handled and whether the relationship is repeating."
          >
            {!overview ? (
              <EmptyState label="No recent customers found" />
            ) : overview.recentCustomers.length === 0 ? (
              <EmptyState label="No recent customers found" />
            ) : (
              <DataTable
                rows={overview.recentCustomers}
                rowKey={(row) => `${row.customerName}-${row.phoneNumber}`}
                columns={[
                  {
                    key: "customer",
                    header: "Customer",
                    render: (row) => (
                      <button
                        type="button"
                        className="entity-link-button entity-link-button--strong"
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
                        {row.customerName}
                      </button>
                    ),
                  },
                  {
                    key: "relationship",
                    header: "Relationship",
                    render: (row) => (
                      <div className="customer-detail__metric-cell">
                        <strong>{row.relationship}</strong>
                        <span>{row.lastService || "No recent service"}</span>
                      </div>
                    ),
                  },
                  { key: "visits", header: "Visits", render: (row) => row.visitCount.toLocaleString("en-US") },
                  {
                    key: "lastVisit",
                    header: "Last visit",
                    render: (row) => (row.lastVisitDate ? formatDate(row.lastVisitDate) : "—"),
                  },
                  {
                    key: "value",
                    header: "Treatment value",
                    render: (row) => formatCurrency(row.estimatedTreatmentValue, currency),
                  },
                ]}
              />
            )}
          </Panel>
        </div>
      ) : null}

      {activeTab === "customers" ? (
        <div className="customer-detail__section-stack">
          <div className="report-kpi-strip customer-detail__kpis customer-detail__kpis--compact">
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Customers served</span>
              <span className="report-kpi-strip__value">
                {(customersState.data?.summary.customersServed ?? 0).toLocaleString("en-US")}
              </span>
              <span className="report-kpi-strip__hint">Distinct customers served in the current date window.</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Repeat customers</span>
              <span className="report-kpi-strip__value">
                {(customersState.data?.summary.repeatCustomers ?? 0).toLocaleString("en-US")}
              </span>
              <span className="report-kpi-strip__hint">Customers who returned to this therapist more than once.</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Avg value / customer</span>
              <span className="report-kpi-strip__value">
                {formatCurrency(customersState.data?.summary.averageTreatmentValuePerCustomer ?? 0, currency)}
              </span>
              <span className="report-kpi-strip__hint">Estimated treatment value per customer relationship.</span>
            </div>
          </div>

          <Panel
            className="analytics-report__panel customer-detail__panel"
            title="Customers served by this therapist"
            subtitle={`${(customersState.data?.totalCount ?? 0).toLocaleString("en-US")} customers matched the current range`}
            action={
              <div className="customer-detail__table-tools">
                <label className="field field--compact field--search">
                  <span>Search</span>
                  <input
                    type="search"
                    placeholder="Customer, phone, service"
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
            {customersState.loading ? <div className="inline-note">Loading therapist customers...</div> : null}
            {customersState.error ? (
              <ErrorState label="Therapist customers could not be loaded" detail={customersState.error} />
            ) : null}
            {!customersState.loading && !customersState.error && (!customersState.data || customersState.data.rows.length === 0) ? (
              <EmptyState label="No customers found" detail="Try clearing the search or widening the date range." />
            ) : null}
            {customersState.data && customersState.data.rows.length > 0 ? (
              <DataTable
                rows={customersState.data.rows}
                rowKey={(row) => `${row.customerName}-${row.phoneNumber}`}
                columns={[
                  {
                    key: "customer",
                    header: "Customer",
                    render: (row) => (
                      <button
                        type="button"
                        className="entity-link-button entity-link-button--strong"
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
                        {row.customerName}
                      </button>
                    ),
                  },
                  {
                    key: "relationship",
                    header: "Relationship",
                    render: (row) => (
                      <div className="customer-detail__metric-cell">
                        <strong>{row.relationship}</strong>
                        <span>{row.visitCount.toLocaleString("en-US")} visits</span>
                      </div>
                    ),
                  },
                  {
                    key: "lastService",
                    header: "Last service",
                    render: (row) =>
                      row.lastService ? (
                        <button
                          type="button"
                          className="entity-link-button"
                          onClick={() =>
                            navigate(
                              buildServicePortalDetailPath({
                                serviceName: row.lastService,
                                fromDate: range.fromDate,
                                toDate: range.toDate,
                              }),
                            )
                          }
                        >
                          {row.lastService}
                        </button>
                      ) : (
                        "—"
                      ),
                  },
                  {
                    key: "lastVisit",
                    header: "Last visit",
                    render: (row) => (row.lastVisitDate ? formatDate(row.lastVisitDate) : "—"),
                  },
                  {
                    key: "value",
                    header: "Treatment value",
                    render: (row) => formatCurrency(row.estimatedTreatmentValue, currency),
                  },
                ]}
              />
            ) : null}
          </Panel>
        </div>
      ) : null}

      {activeTab === "treatments" ? (
        <Panel
          className="analytics-report__panel customer-detail__panel"
          title="Treatment ledger"
          subtitle={`${(treatmentsState.data?.totalCount ?? 0).toLocaleString("en-US")} treatment rows matched the current filters`}
          action={
            <div className="customer-detail__table-tools">
              <label className="field field--compact field--search">
                <span>Search</span>
                <input
                  type="search"
                  placeholder="Customer, service, category"
                  value={treatmentsSearch}
                  onChange={(event) => setTreatmentsSearch(event.target.value)}
                />
              </label>
              <div className="pagination-controls">
                <button
                  className="button button--secondary"
                  disabled={treatmentsPage <= 1}
                  onClick={() => setTreatmentsPage((value) => value - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {treatmentsPage} of {treatmentsTotalPages}
                </span>
                <button
                  className="button button--secondary"
                  disabled={treatmentsPage >= treatmentsTotalPages}
                  onClick={() => setTreatmentsPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          }
        >
          {treatmentsState.loading ? <div className="inline-note">Loading treatment ledger...</div> : null}
          {treatmentsState.error ? (
            <ErrorState label="Treatment ledger could not be loaded" detail={treatmentsState.error} />
          ) : null}
          {!treatmentsState.loading && !treatmentsState.error && (!treatmentsState.data || treatmentsState.data.rows.length === 0) ? (
            <EmptyState label="No treatments found" detail="Try clearing the search or widening the date range." />
          ) : null}
          {treatmentsState.data && treatmentsState.data.rows.length > 0 ? (
            <DataTable
              rows={treatmentsState.data.rows}
              rowKey={(row) => `${row.checkInTime}-${row.customerName}-${row.serviceName}`}
              columns={[
                { key: "time", header: "Check-in", render: (row) => row.checkInTime },
                {
                  key: "customer",
                  header: "Customer",
                  render: (row) => (
                    <button
                      type="button"
                      className="entity-link-button entity-link-button--strong"
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
                      {row.customerName}
                    </button>
                  ),
                },
                {
                  key: "service",
                  header: "Service",
                  render: (row) => (
                    <button
                      type="button"
                      className="entity-link-button entity-link-button--strong"
                      onClick={() =>
                        navigate(
                          buildServicePortalDetailPath({
                            serviceName: row.serviceName,
                            fromDate: range.fromDate,
                            toDate: range.toDate,
                          }),
                        )
                      }
                    >
                      {row.serviceName}
                    </button>
                  ),
                },
                { key: "category", header: "Category", render: (row) => row.serviceCategory },
                { key: "member", header: "Member ID", render: (row) => row.memberId || "—" },
                {
                  key: "value",
                  header: "Treatment value",
                  render: (row) => formatCurrency(row.estimatedTreatmentValue, currency),
                },
              ]}
            />
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
