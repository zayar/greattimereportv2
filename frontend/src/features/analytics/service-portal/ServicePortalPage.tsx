import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchServicePortalList } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type { ServicePortalListResponse, ServiceRow } from "../../../types/domain";
import { startOfCurrentYear, today } from "../../../utils/date";
import { formatCompactNumber, formatCurrency, formatDate, formatPercent } from "../../../utils/format";
import { useAccess } from "../../access/AccessProvider";
import { GET_SERVICES } from "../../core/services/queries";
import { buildServicePortalDetailPath } from "./servicePortalLink";

const PAGE_SIZE = 25;

type ServiceCatalogResponse = {
  services: ServiceRow[];
};

type SortBy =
  | "totalRevenue"
  | "bookingCount"
  | "customerCount"
  | "averageSellingPrice"
  | "repeatPurchaseRate"
  | "growthRate";
type SortDirection = "asc" | "desc";
type CatalogStatusFilter = "" | "ACTIVE" | "INACTIVE";

function performanceLabel(row: ServicePortalListResponse["rows"][number]) {
  if (row.growthRate >= 18) {
    return "Growing";
  }

  if (row.growthRate <= -12) {
    return "Watch";
  }

  if (row.repeatPurchaseRate >= 35) {
    return "Retention-led";
  }

  return "Stable";
}

function performanceTone(row: ServicePortalListResponse["rows"][number]) {
  if (row.growthRate >= 18 || row.repeatPurchaseRate >= 35) {
    return "positive";
  }

  if (row.growthRate <= -12) {
    return "attention";
  }

  return "neutral";
}

export function ServicePortalPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const [range, setRange] = useState(() => ({
    fromDate: searchParams.get("fromDate") ?? startOfCurrentYear(),
    toDate: searchParams.get("toDate") ?? today(),
  }));
  const [search, setSearch] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatusFilter>("");
  const [sortBy, setSortBy] = useState<SortBy>("totalRevenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ServicePortalListResponse | null>(null);

  const { data: catalogData } = useQuery<ServiceCatalogResponse>(GET_SERVICES, {
    variables: currentClinic
      ? {
          where: {
            clinic_id: { equals: currentClinic.id },
            status: { notIn: ["CANCEL"] },
          },
          orderBy: [{ created_at: "desc" }],
          take: 400,
        }
      : undefined,
    skip: !currentClinic,
  });

  useEffect(() => {
    setPage(1);
  }, [
    currentClinic?.id,
    deferredSearch,
    range.fromDate,
    range.toDate,
    serviceCategory,
    catalogStatus,
    sortBy,
    sortDirection,
  ]);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchServicePortalList({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      search: deferredSearch,
      serviceCategory,
      sortBy,
      sortDirection,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load service portal.");
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
  }, [currentClinic, deferredSearch, range.fromDate, range.toDate, serviceCategory, sortBy, sortDirection]);

  const currency = currentClinic?.currency || "MMK";
  const catalogStatusMap = useMemo(() => {
    const map = new Map<string, string>();

    for (const service of catalogData?.services ?? []) {
      map.set(service.name.trim().toLowerCase(), service.status || "ACTIVE");
    }

    return map;
  }, [catalogData?.services]);

  const visibleRows = useMemo(() => {
    const baseRows = (data?.rows ?? []).map((row) => ({
      ...row,
      catalogStatus: (catalogStatusMap.get(row.serviceName.trim().toLowerCase()) ?? "ACTIVE").toUpperCase(),
      performanceLabel: performanceLabel(row),
      performanceTone: performanceTone(row),
    }));

    if (!catalogStatus) {
      return baseRows;
    }

    return baseRows.filter((row) => row.catalogStatus === catalogStatus);
  }, [catalogStatus, catalogStatusMap, data?.rows]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pagedRows = visibleRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const summary = useMemo(() => {
    const serviceCount = visibleRows.length;
    const totalRevenue = visibleRows.reduce((sum, row) => sum + row.totalRevenue, 0);
    const totalBookings = visibleRows.reduce((sum, row) => sum + row.bookingCount, 0);
    const totalCustomers = visibleRows.reduce((sum, row) => sum + row.customerCount, 0);

    return {
      serviceCount,
      totalRevenue,
      totalBookings,
      totalCustomers,
      averagePrice:
        serviceCount > 0
          ? visibleRows.reduce((sum, row) => sum + row.averageSellingPrice, 0) / serviceCount
          : 0,
      averageRepeatRate:
        serviceCount > 0
          ? visibleRows.reduce((sum, row) => sum + row.repeatPurchaseRate, 0) / serviceCount
          : 0,
      averagePackageMix:
        serviceCount > 0 ? visibleRows.reduce((sum, row) => sum + row.packageMixPct, 0) / serviceCount : 0,
    };
  }, [visibleRows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report service-portal">
      <PageHeader
        eyebrow="Services"
        title="Service portal"
        description="A premium service intelligence directory for demand, pricing quality, therapist dependence, repeat depth, and business momentum."
      />

      {error ? <ErrorState label="Service portal could not be loaded" detail={error} /> : null}

      <Panel
        className="analytics-report__panel service-portal__filter-panel"
        title="Service intelligence filters"
        subtitle="Use the clinic selector in the shell, then refine this service view by date, category, catalog status, and commercial priority."
      >
        <div className="service-portal__filter-grid">
          <label className="field field--search service-portal__search">
            <span>Search</span>
            <input
              type="search"
              placeholder="Service name or category"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />

          <label className="field field--compact">
            <span>Category</span>
            <select value={serviceCategory} onChange={(event) => setServiceCategory(event.target.value)}>
              <option value="">All categories</option>
              {(data?.filterOptions.serviceCategories ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Status</span>
            <select
              value={catalogStatus}
              onChange={(event) => setCatalogStatus(event.target.value as CatalogStatusFilter)}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>

          <label className="field field--compact">
            <span>Sort by</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)}>
              <option value="totalRevenue">Revenue</option>
              <option value="bookingCount">Bookings</option>
              <option value="customerCount">Customers</option>
              <option value="averageSellingPrice">Avg selling price</option>
              <option value="repeatPurchaseRate">Repeat rate</option>
              <option value="growthRate">Growth</option>
            </select>
          </label>

          <label className="field field--compact">
            <span>Direction</span>
            <select
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value as SortDirection)}
            >
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </select>
          </label>
        </div>
      </Panel>

      <div className="report-kpi-strip service-portal__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Services in view</span>
          <span className="report-kpi-strip__value">{summary.serviceCount.toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Visible services after catalog and category filters.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Revenue</span>
          <span className="report-kpi-strip__value">{formatCurrency(summary.totalRevenue, currency)}</span>
          <span className="report-kpi-strip__hint">Paid service-line revenue in the selected period.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Bookings</span>
          <span className="report-kpi-strip__value">{summary.totalBookings.toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Completed treatment records attributed to visible services.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Customers</span>
          <span className="report-kpi-strip__value">{summary.totalCustomers.toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Distinct customers touched by this visible service set.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Avg selling price</span>
          <span className="report-kpi-strip__value">{formatCurrency(summary.averagePrice, currency)}</span>
          <span className="report-kpi-strip__hint">Typical paid service-line value across visible services.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Repeat depth</span>
          <span className="report-kpi-strip__value">{summary.averageRepeatRate.toFixed(1)}%</span>
          <span className="report-kpi-strip__hint">Average repeat-customer rate across the visible set.</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Package share</span>
          <span className="report-kpi-strip__value">{summary.averagePackageMix.toFixed(1)}%</span>
          <span className="report-kpi-strip__hint">Average package-led mix across visible services.</span>
        </div>
      </div>

      <Panel
        className="analytics-report__panel service-portal__list-panel"
        title="Service intelligence directory"
        subtitle={`${visibleRows.length.toLocaleString("en-US")} services matched the current service intelligence filters`}
        action={
          <div className="pagination-controls">
            <button className="button button--secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              className="button button--secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        }
      >
        {loading ? <div className="inline-note">Loading service intelligence...</div> : null}
        {!loading && !error && visibleRows.length === 0 ? (
          <EmptyState
            label="No services matched these filters"
            detail="Try clearing the catalog status filter or widening the date range."
          />
        ) : null}
        {pagedRows.length > 0 ? (
          <DataTable
            rows={pagedRows}
            rowKey={(row) => row.serviceName}
            rowClassName={(row) =>
              row.performanceTone === "attention"
                ? "service-portal__row service-portal__row--attention"
                : row.catalogStatus === "INACTIVE"
                  ? "service-portal__row service-portal__row--inactive"
                  : "service-portal__row"
            }
            onRowClick={(row) =>
              navigate(
                buildServicePortalDetailPath({
                  serviceName: row.serviceName,
                  fromDate: range.fromDate,
                  toDate: range.toDate,
                }),
              )
            }
            columns={[
              {
                key: "service",
                header: "Service",
                render: (row) => (
                  <div className="service-portal__service-cell">
                    <div className="service-portal__service-main">
                      <strong>{row.serviceName}</strong>
                      <span className={`status-pill status-pill--${row.performanceTone}`.trim()}>
                        {row.performanceLabel}
                      </span>
                    </div>
                    <span>{row.serviceCategory}</span>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Catalog status",
                render: (row) => (
                  <span className={`status-pill status-pill--${row.catalogStatus === "ACTIVE" ? "positive" : "neutral"}`.trim()}>
                    {row.catalogStatus}
                  </span>
                ),
              },
              {
                key: "revenue",
                header: "Revenue",
                render: (row) => (
                  <div className="service-portal__metric-cell">
                    <strong>{formatCurrency(row.totalRevenue, currency)}</strong>
                    <span>Avg {formatCurrency(row.averageSellingPrice, currency)}</span>
                  </div>
                ),
              },
              {
                key: "demand",
                header: "Demand",
                render: (row) => (
                  <div className="service-portal__metric-cell">
                    <strong>{formatCompactNumber(row.bookingCount)} bookings</strong>
                    <span>{formatCompactNumber(row.customerCount)} customers</span>
                  </div>
                ),
              },
              {
                key: "relationship",
                header: "Relationship",
                render: (row) => (
                  <div className="service-portal__metric-cell">
                    <strong>{row.repeatPurchaseRate.toFixed(1)}% repeat</strong>
                    <span>{row.lastBookedDate ? `Last booked ${formatDate(row.lastBookedDate)}` : "No recent booking"}</span>
                  </div>
                ),
              },
              {
                key: "delivery",
                header: "Delivery",
                render: (row) => (
                  <div className="service-portal__metric-cell">
                    <strong>{row.topTherapist || "Unknown"}</strong>
                    <span>{row.packageMixPct.toFixed(1)}% package mix</span>
                  </div>
                ),
              },
              {
                key: "momentum",
                header: "Momentum",
                render: (row) => (
                  <div className="service-portal__metric-cell">
                    <strong>{formatPercent(row.growthRate)}</strong>
                    <span>{row.highValueCustomers.toLocaleString("en-US")} repeat-heavy customers</span>
                  </div>
                ),
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
