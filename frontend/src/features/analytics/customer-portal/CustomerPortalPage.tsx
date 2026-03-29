import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchCustomerPortalList } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type { CustomerPortalListResponse } from "../../../types/domain";
import { startOfCurrentYear, today } from "../../../utils/date";
import { formatCurrency, formatDate } from "../../../utils/format";
import {
  churnRiskTone,
  formatChurnRiskLabel,
  formatRebookingStatusLabel,
  rebookingTone,
} from "../../ai/aiLabels";
import { useAccess } from "../../access/AccessProvider";
import { buildCustomerPortalDetailPath } from "./customerPortalLink";

const PAGE_SIZE = 25;

function formatCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadCustomerPortfolio(
  rows: CustomerPortalListResponse["rows"],
  currency: string,
) {
  const headers = [
    "Customer Name",
    "Phone Number",
    "Member ID",
    "Lifetime Spend",
    "Average Spend",
    "Joined Date",
    "Last Visit Date",
    "Days Since Last Visit",
    "Visit Count",
    "Last Service",
    "Primary Therapist",
    "Last Payment Method",
    "Status",
    "Spend Tier",
    "Package Status",
    "Remaining Sessions",
    "Service Category",
  ];

  const body = rows.map((row) =>
    [
      row.customerName,
      row.phoneNumber,
      row.memberId,
      formatCurrency(row.lifetimeSpend, currency),
      formatCurrency(row.averageSpend, currency),
      row.joinedDate ?? "",
      row.lastVisitDate ?? "",
      row.daysSinceLastVisit ?? "",
      row.visitCount,
      row.lastService,
      row.primaryTherapist,
      row.lastPaymentMethod,
      row.status,
      row.spendTier,
      row.packageStatus,
      row.remainingSessions,
      row.serviceCategory,
    ]
      .map(formatCsvValue)
      .join(","),
  );

  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `customer-portal-${today()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getStatusTone(status: string) {
  if (status === "Dormant" || status === "At risk") {
    return "attention";
  }

  if (status === "Returning" || status === "Active" || status === "New") {
    return "positive";
  }

  return "neutral";
}

function getSpendTierTone(tier: string) {
  if (tier === "VIP" || tier === "High") {
    return "premium";
  }

  return "neutral";
}

type SortBy = "lifetimeSpend" | "lastVisitDate" | "visitCount" | "averageSpend";
type SortDirection = "asc" | "desc";

export function CustomerPortalPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const [range, setRange] = useState(() => ({
    fromDate: searchParams.get("fromDate") ?? startOfCurrentYear(),
    toDate: searchParams.get("toDate") ?? today(),
  }));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [spendTier, setSpendTier] = useState("");
  const [therapist, setTherapist] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("lifetimeSpend");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CustomerPortalListResponse | null>(null);

  useEffect(() => {
    setPage(1);
  }, [
    currentClinic?.id,
    deferredSearch,
    range.fromDate,
    range.toDate,
    status,
    spendTier,
    therapist,
    serviceCategory,
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

    fetchCustomerPortalList({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      search: deferredSearch,
      status,
      spendTier,
      therapist,
      serviceCategory,
      sortBy,
      sortDirection,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load customer portal.");
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
  }, [
    currentClinic,
    deferredSearch,
    page,
    range.fromDate,
    range.toDate,
    serviceCategory,
    sortBy,
    sortDirection,
    spendTier,
    status,
    therapist,
  ]);

  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));
  const currency = currentClinic?.currency || "MMK";
  const summary = data?.summary;

  const kpiCards = [
    {
      label: "Total customers",
      value: (summary?.totalCustomers ?? 0).toLocaleString("en-US"),
      hint: "Matched records in the current customer scope",
    },
    {
      label: "Active customers",
      value: (summary?.activeCustomers ?? 0).toLocaleString("en-US"),
      hint: "New, active, and returning relationships",
    },
    {
      label: "Returning customers",
      value: (summary?.returningCustomers ?? 0).toLocaleString("en-US"),
      hint: "Customers with established repeat visits",
    },
    {
      label: "At-risk customers",
      value: ((summary?.atRiskCustomers ?? 0) + (summary?.dormantCustomers ?? 0)).toLocaleString("en-US"),
      hint: "Customers needing retention attention",
    },
    {
      label: "Customer revenue",
      value: formatCurrency(summary?.totalRevenue ?? 0, currency),
      hint: "Lifetime spend across the filtered portfolio",
    },
    {
      label: "Average spend",
      value: formatCurrency(summary?.averageSpend ?? 0, currency),
      hint: "Average lifetime value per visible customer",
    },
    {
      label: "Average visits",
      value: (summary?.averageVisits ?? 0).toLocaleString("en-US"),
      hint: "Typical visit depth per customer",
    },
  ];

  return (
    <div className="page-stack page-stack--workspace analytics-report customer-portal">
      <PageHeader
        eyebrow="Customers"
        title="Customer portal"
        description="Search, segment, and open a full customer 360 record without loading heavy analytics until you need them."
      />

      {error ? <ErrorState label="Customer portal could not be loaded" detail={error} /> : null}

      <Panel
        className="analytics-report__panel customer-portal__filter-panel"
        title="Portfolio filters"
        subtitle="Use the existing clinic selector in the shell, then refine this portfolio by lifecycle, value, therapist, and service focus."
        action={
          <button
            className="button button--secondary"
            disabled={!data || data.rows.length === 0}
            onClick={() => downloadCustomerPortfolio(data?.rows ?? [], currency)}
          >
            Export CSV
          </button>
        }
      >
        <div className="customer-portal__filter-grid">
          <label className="field field--search customer-portal__search">
            <span>Search</span>
            <input
              type="search"
              placeholder="Name, phone, or member ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />

          <label className="field field--compact">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {(data?.filterOptions.statuses ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Spend tier</span>
            <select value={spendTier} onChange={(event) => setSpendTier(event.target.value)}>
              <option value="">All tiers</option>
              {(data?.filterOptions.spendTiers ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Therapist</span>
            <select value={therapist} onChange={(event) => setTherapist(event.target.value)}>
              <option value="">All therapists</option>
              {(data?.filterOptions.therapists ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Service category</span>
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
            <span>Sort by</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)}>
              <option value="lifetimeSpend">Lifetime spend</option>
              <option value="lastVisitDate">Last visit</option>
              <option value="visitCount">Visit count</option>
              <option value="averageSpend">Average spend</option>
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

      <div className="report-kpi-strip customer-portal__kpis">
        {kpiCards.map((card) => (
          <div key={card.label} className="report-kpi-strip__card">
            <span className="report-kpi-strip__label">{card.label}</span>
            <span className="report-kpi-strip__value">{card.value}</span>
            <span className="report-kpi-strip__hint">{card.hint}</span>
          </div>
        ))}
      </div>

      <Panel
        className="analytics-report__panel customer-portal__list-panel"
        title="Customer portfolio"
        subtitle={`${(data?.totalCount ?? 0).toLocaleString("en-US")} customers matched the current filters`}
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
        {loading ? <div className="inline-note">Loading customer portfolio...</div> : null}
        {!loading && !error && (!data || data.rows.length === 0) ? (
          <EmptyState
            label="No customers matched these filters"
            detail="Try widening the date range or clearing one of the lifecycle filters."
          />
        ) : null}
        {data && data.rows.length > 0 ? (
          <DataTable
            rows={data.rows}
            rowKey={(row) => `${row.customerName}-${row.phoneNumber}`}
            rowClassName={(row) =>
              row.spendTier === "VIP"
                ? "customer-portal__row customer-portal__row--vip"
                : row.churnRiskLevel === "high" || row.rebookingStatus === "overdue"
                  ? "customer-portal__row customer-portal__row--attention"
                  : "customer-portal__row"
            }
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
                  <div className="customer-portal__customer-cell">
                    <div className="customer-portal__customer-main">
                      <strong>{row.customerName}</strong>
                      {row.spendTier === "VIP" ? <span className="status-pill status-pill--premium">VIP</span> : null}
                    </div>
                    <span>{row.phoneNumber}</span>
                  </div>
                ),
              },
              {
                key: "member",
                header: "Member",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.memberId || "—"}</strong>
                    <span>Joined {row.joinedDate ? formatDate(row.joinedDate) : "Unknown"}</span>
                  </div>
                ),
              },
              {
                key: "value",
                header: "Value",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{formatCurrency(row.lifetimeSpend, currency)}</strong>
                    <span>Avg {formatCurrency(row.averageSpend, currency)}</span>
                  </div>
                ),
              },
              {
                key: "visits",
                header: "Visits",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.visitCount.toLocaleString("en-US")}</strong>
                    <span>
                      {row.lastVisitDate ? `${formatDate(row.lastVisitDate)} • ${row.daysSinceLastVisit ?? 0}d ago` : "No recent visit"}
                    </span>
                  </div>
                ),
              },
              {
                key: "service",
                header: "Service focus",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.lastService || "—"}</strong>
                    <span>{row.serviceCategory}</span>
                  </div>
                ),
              },
              {
                key: "relationship",
                header: "Relationship",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.primaryTherapist || "Unknown"}</strong>
                    <span>{row.lastPaymentMethod || "Unknown"}</span>
                  </div>
                ),
              },
              {
                key: "health",
                header: "Health",
                render: (row) => (
                  <div className="customer-portal__health-stack">
                    <div className="customer-portal__health-cell">
                      <span className="status-pill status-pill--neutral">{row.healthScore}/100</span>
                      <span className={`status-pill status-pill--${churnRiskTone(row.churnRiskLevel)}`.trim()}>
                        {formatChurnRiskLabel(row.churnRiskLevel)}
                      </span>
                      <span className={`status-pill status-pill--${rebookingTone(row.rebookingStatus)}`.trim()}>
                        {formatRebookingStatusLabel(row.rebookingStatus)}
                      </span>
                    </div>
                    <span className="customer-portal__health-note">
                      {row.status} • {row.packageStatus}
                    </span>
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
