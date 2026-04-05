import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchPackagePortal, fetchPackagePortalDetail } from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { EntityInspectorPanel } from "../../../components/EntityInspectorPanel";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type { PackagePortalDetailResponse, PackagePortalResponse } from "../../../types/domain";
import { startOfCurrentYear, today } from "../../../utils/date";
import { buildDatedExportFileName, downloadExcelWorkbook } from "../../../utils/exportExcel";
import { formatDate } from "../../../utils/format";
import { useAccess } from "../../access/AccessProvider";
import { buildCustomerPortalDetailPath } from "../customer-portal/customerPortalLink";

function formatStatusTone(status: string) {
  if (status === "at_risk" || status.startsWith("inactive_")) {
    return "attention";
  }

  if (status === "near_completion") {
    return "premium";
  }

  if (status === "completed") {
    return "neutral";
  }

  return "positive";
}

function formatStatusLabel(status: string) {
  switch (status) {
    case "new":
      return "New";
    case "in_progress":
      return "In progress";
    case "near_completion":
      return "Near completion";
    case "completed":
      return "Completed";
    case "inactive_30":
      return "Inactive 30+";
    case "inactive_60":
      return "Inactive 60+";
    case "inactive_90":
      return "Inactive 90+";
    case "at_risk":
      return "At risk";
    default:
      return status;
  }
}

function formatInactivityLabel(bucket: string) {
  switch (bucket) {
    case "0_29":
      return "0-29 days";
    case "30_59":
      return "30-59 days";
    case "60_89":
      return "60-89 days";
    case "90_plus":
      return "90+ days";
    case "never_used":
      return "Never used";
    default:
      return bucket;
  }
}

function formatUsageRate(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatVisitLabel(row: {
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  daysSinceActivity: number;
}) {
  if (row.lastVisitDate) {
    return `${row.daysSinceLastVisit ?? row.daysSinceActivity} days`;
  }

  return `${row.daysSinceActivity} days since purchase`;
}

type CustomerPortalLinkProps = {
  customerName: string;
  customerPhone: string;
  fromDate: string;
  toDate: string;
  stopPropagation?: boolean;
};

function CustomerPortalLink({
  customerName,
  customerPhone,
  fromDate,
  toDate,
  stopPropagation = false,
}: CustomerPortalLinkProps) {
  return (
    <Link
      to={buildCustomerPortalDetailPath({
        customerName,
        customerPhone,
        fromDate,
        toDate,
      })}
      className="entity-link-button entity-link-button--strong"
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
    >
      {customerName || customerPhone || "Unknown customer"}
    </Link>
  );
}

async function exportPerformanceRows(
  rows: PackagePortalResponse["performanceRows"],
  fromDate: string,
  toDate: string,
) {
  await downloadExcelWorkbook({
    fileName: buildDatedExportFileName("package-performance", fromDate, toDate),
    sheetName: "Package performance",
    headers: [
      "Package",
      "Category",
      "Packages Sold",
      "Total Units Sold",
      "Used Units",
      "Package Remaining",
      "Active Customers",
      "Completed Customers",
      "Inactive Customers",
      "Latest Purchase",
      "Latest Usage",
      "Usage Rate",
      "Follow-up Summary",
    ],
    rows: rows.map((row) => [
      row.packageName,
      row.category,
      row.soldCount,
      row.totalSoldUnits,
      row.usedUnits,
      row.remainingUnits,
      row.activeCustomers,
      row.completedCustomers,
      row.inactiveCustomers,
      row.latestPurchaseDate || "",
      row.latestUsageDate || "",
      formatUsageRate(row.usageRatePct),
      row.followUpSummary,
    ]),
  });
}

async function exportFollowUpRows(
  rows: PackagePortalResponse["followUpRows"],
  fromDate: string,
  toDate: string,
) {
  await downloadExcelWorkbook({
    fileName: buildDatedExportFileName("package-follow-up", fromDate, toDate),
    sheetName: "Package follow-up",
    headers: [
      "Customer",
      "Phone",
      "Member ID",
      "Package",
      "Category",
      "Purchase Date",
      "Purchase Qty",
      "Purchased Units",
      "Used Units",
      "Remaining Units",
      "Last Visit",
      "Days Since Last Visit",
      "Therapist",
      "Salesperson",
      "Status",
      "Inactivity Bucket",
      "Needs Follow-up",
    ],
    rows: rows.map((row) => [
      row.customerName,
      row.customerPhone,
      row.memberId,
      row.packageName,
      row.category,
      row.purchaseDate,
      row.purchaseCount,
      row.purchasedUnits,
      row.usedUnits,
      row.remainingUnits,
      row.lastVisitDate || "Never used",
      formatVisitLabel(row),
      row.therapist || "",
      row.salesperson || "",
      row.statusLabel,
      row.inactivityLabel,
      row.needsFollowUp ? "Yes" : "No",
    ]),
  });
}

async function exportPackageCustomerRows(
  packageName: string,
  rows: PackagePortalDetailResponse["customers"],
  fromDate: string,
  toDate: string,
) {
  const safePackageName = packageName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  await downloadExcelWorkbook({
    fileName: buildDatedExportFileName(`package-customers-${safePackageName || "detail"}`, fromDate, toDate),
    sheetName: "Package customers",
    headers: [
      "Customer",
      "Phone",
      "Member ID",
      "Package",
      "Category",
      "Purchase Date",
      "Last Visit Date",
      "Purchased Qty",
      "Used Qty",
      "Remaining Qty",
      "Therapist",
      "Salesperson",
      "Status",
      "Days Inactive",
      "Needs Follow-up",
    ],
    rows: rows.map((row) => [
      row.customerName,
      row.customerPhone,
      row.memberId,
      row.packageName,
      row.category,
      row.purchaseDate,
      row.lastVisitDate || "No visit yet",
      row.purchasedUnits,
      row.usedUnits,
      row.remainingUnits,
      row.therapist || "",
      row.salesperson || "",
      row.statusLabel,
      formatVisitLabel(row),
      row.needsFollowUp ? "Yes" : "No",
    ]),
  });
}

type InspectorProps = {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
  packageId: string;
  category: string;
  therapist: string;
  salesperson: string;
  status: string;
  inactivityBucket: string;
  onlyRemaining: boolean;
  isPinned: boolean;
  canPin: boolean;
  onClose: () => void;
  onTogglePin: () => void;
};

function PackageDetailInspector({
  clinicId,
  clinicCode,
  fromDate,
  toDate,
  packageId,
  category,
  therapist,
  salesperson,
  status,
  inactivityBucket,
  onlyRemaining,
  isPinned,
  canPin,
  onClose,
  onTogglePin,
}: InspectorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PackagePortalDetailResponse | null>(null);
  const [detailExporting, setDetailExporting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchPackagePortalDetail({
      clinicId,
      clinicCode,
      fromDate,
      toDate,
      packageId,
      category,
      therapist,
      salesperson,
      status,
      inactivityBucket,
      onlyRemaining,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load package detail.");
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
  }, [category, clinicCode, clinicId, fromDate, inactivityBucket, onlyRemaining, packageId, salesperson, status, therapist, toDate]);

  const followUpQueue = useMemo(
    () => (data?.customers ?? []).filter((row) => row.needsFollowUp).slice(0, 5),
    [data?.customers],
  );

  async function handleDetailExport() {
    if (!data?.package || data.customers.length === 0) {
      return;
    }

    setDetailExporting(true);

    try {
      await exportPackageCustomerRows(data.package.packageName, data.customers, fromDate, toDate);
    } finally {
      setDetailExporting(false);
    }
  }

  return (
    <EntityInspectorPanel
      title={data?.package?.packageName || "Package detail"}
      subtitle="Owner-facing package drilldown with follow-up priorities first."
      badge={
        data?.package ? (
          <span className="status-pill status-pill--neutral">{data.package.totalRemainingUnits} units left</span>
        ) : null
      }
      isPinned={isPinned}
      canPin={canPin}
      onClose={onClose}
      onTogglePin={onTogglePin}
      className="package-portal__inspector"
    >
      {loading ? <div className="inline-note inline-note--loading">Loading package detail...</div> : null}
      {!loading && error ? <ErrorState label="Package detail could not be loaded" detail={error} /> : null}
      {!loading && !error && !data?.package ? <EmptyState label="No package detail found" /> : null}

      {!loading && !error && data?.package ? (
        <>
          <Panel
            className="package-portal__detail-panel"
            title="Package summary"
            subtitle="Current owner view of delivery balance, completion, and usage."
          >
            <div className="package-portal__detail-metrics">
              <article className="package-portal__detail-metric">
                <span>Packages sold</span>
                <strong>{data.package.soldCount.toLocaleString("en-US")}</strong>
              </article>
              <article className="package-portal__detail-metric">
                <span>Total sold units</span>
                <strong>{data.package.totalSoldUnits.toLocaleString("en-US")}</strong>
              </article>
              <article className="package-portal__detail-metric">
                <span>Used units</span>
                <strong>{data.package.totalUsedUnits.toLocaleString("en-US")}</strong>
              </article>
              <article className="package-portal__detail-metric package-portal__detail-metric--remaining">
                <span>Package remaining</span>
                <strong>{data.package.totalRemainingUnits.toLocaleString("en-US")}</strong>
              </article>
              <article className="package-portal__detail-metric">
                <span>Avg usage rate</span>
                <strong>{formatUsageRate(data.package.averageUsageRatePct)}</strong>
              </article>
              <article className="package-portal__detail-metric">
                <span>Category</span>
                <strong>{data.package.category}</strong>
              </article>
              <article className="package-portal__detail-metric">
                <span>Active customers</span>
                <strong>{data.package.activeCustomers.toLocaleString("en-US")}</strong>
              </article>
              <article className="package-portal__detail-metric">
                <span>Completed customers</span>
                <strong>{data.package.completedCustomers.toLocaleString("en-US")}</strong>
              </article>
              <article className="package-portal__detail-metric">
                <span>Inactive customers</span>
                <strong>{data.package.inactiveCustomers.toLocaleString("en-US")}</strong>
              </article>
            </div>
          </Panel>

          <Panel
            className="package-portal__detail-panel"
            title="Immediate follow-up queue"
            subtitle="Sorted by the highest remaining balance and the longest inactive span."
          >
            {followUpQueue.length === 0 ? (
              <EmptyState label="No customers currently need follow-up" />
            ) : (
              <div className="package-portal__followup-stack">
                {followUpQueue.map((row) => (
                  <article key={row.id} className="package-portal__followup-card">
                    <div className="package-portal__followup-card-copy">
                      <CustomerPortalLink
                        customerName={row.customerName}
                        customerPhone={row.customerPhone}
                        fromDate={fromDate}
                        toDate={toDate}
                      />
                      <p>
                        {row.remainingUnits.toLocaleString("en-US")} units remaining
                        {row.lastVisitDate ? ` • Last visit ${formatDate(row.lastVisitDate)}` : " • No visit yet"}
                      </p>
                    </div>
                    <span className={`status-pill status-pill--${formatStatusTone(row.status)}`.trim()}>
                      {row.statusLabel}
                    </span>
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            className="package-portal__detail-panel"
            title="Customers in this package"
            subtitle={`${data.customers.length.toLocaleString("en-US")} customer-package records matched the current filters`}
            action={
              <button
                className="button button--secondary"
                disabled={detailExporting || data.customers.length === 0}
                onClick={() => void handleDetailExport()}
              >
                {detailExporting ? "Exporting..." : "Export Excel"}
              </button>
            }
          >
            {data.customers.length === 0 ? (
              <EmptyState label="No customers matched the current package filters" />
            ) : (
              <DataTable
                rows={data.customers}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: "customer",
                    header: "Customer",
                    render: (row) => (
                      <div className="package-portal__customer-cell">
                        <CustomerPortalLink
                          customerName={row.customerName}
                          customerPhone={row.customerPhone}
                          fromDate={fromDate}
                          toDate={toDate}
                          stopPropagation
                        />
                        <span>{row.customerPhone || row.memberId || "No phone"}</span>
                      </div>
                    ),
                  },
                  { key: "purchase", header: "Purchase date", render: (row) => formatDate(row.purchaseDate) },
                  {
                    key: "visit",
                    header: "Last visit",
                    render: (row) => (row.lastVisitDate ? formatDate(row.lastVisitDate) : "No visit yet"),
                  },
                  { key: "purchased", header: "Purchased", render: (row) => row.purchasedUnits.toLocaleString("en-US") },
                  { key: "used", header: "Used", render: (row) => row.usedUnits.toLocaleString("en-US") },
                  { key: "remaining", header: "Remaining", render: (row) => row.remainingUnits.toLocaleString("en-US") },
                  { key: "therapist", header: "Therapist", render: (row) => row.therapist || "Unknown" },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => (
                      <span className={`status-pill status-pill--${formatStatusTone(row.status)}`.trim()}>
                        {row.statusLabel}
                      </span>
                    ),
                  },
                  { key: "days", header: "Days inactive", render: (row) => formatVisitLabel(row) },
                ]}
              />
            )}
          </Panel>
        </>
      ) : null}
    </EntityInspectorPanel>
  );
}

export function PackagePortalPage() {
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const [range, setRange] = useState(() => ({
    fromDate: searchParams.get("fromDate") ?? startOfCurrentYear(),
    toDate: searchParams.get("toDate") ?? today(),
  }));
  const [packageId, setPackageId] = useState("");
  const [category, setCategory] = useState("");
  const [therapist, setTherapist] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [status, setStatus] = useState("");
  const [inactivityBucket, setInactivityBucket] = useState("");
  const [onlyRemaining, setOnlyRemaining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PackagePortalResponse | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [inspectorPinned, setInspectorPinned] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1440,
  );
  const [canPinInspector, setCanPinInspector] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1440,
  );
  const [performanceExporting, setPerformanceExporting] = useState(false);
  const [followUpExporting, setFollowUpExporting] = useState(false);

  useEffect(() => {
    function syncViewport() {
      const nextCanPin = window.innerWidth >= 1440;
      setCanPinInspector(nextCanPin);
      if (!nextCanPin) {
        setInspectorPinned(false);
      }
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  useEffect(() => {
    setSelectedPackageId(null);
  }, [currentClinic?.id]);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchPackagePortal({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      packageId,
      category,
      therapist,
      salesperson,
      status,
      inactivityBucket,
      onlyRemaining,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load package portal.");
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
  }, [category, currentClinic, inactivityBucket, onlyRemaining, packageId, salesperson, status, therapist, range.fromDate, range.toDate]);

  useEffect(() => {
    if (!selectedPackageId || !data) {
      return;
    }

    const visible = data.performanceRows.some((row) => row.packageId === selectedPackageId);

    if (!visible) {
      setSelectedPackageId(null);
    }
  }, [data, selectedPackageId]);

  const showPinnedInspector = Boolean(selectedPackageId && inspectorPinned && canPinInspector);
  const kpiCards = useMemo(
    () => [
      {
        label: "Total packages sold",
        value: (data?.summary.totalPackagesSold ?? 0).toLocaleString("en-US"),
        hint: "Customer-package holdings matched by the current purchase window.",
      },
      {
        label: "Active package customers",
        value: (data?.summary.activePackageCustomers ?? 0).toLocaleString("en-US"),
        hint: "Customers who still hold a package balance.",
      },
      {
        label: "Total units sold",
        value: (data?.summary.totalUnitsSold ?? 0).toLocaleString("en-US"),
        hint: "Current purchased package units across the visible portfolio.",
      },
      {
        label: "Used units",
        value: (data?.summary.totalUnitsUsed ?? 0).toLocaleString("en-US"),
        hint: "Units already redeemed from visible package balances.",
      },
      {
        label: "Units remaining",
        value: (data?.summary.totalUnitsRemaining ?? 0).toLocaleString("en-US"),
        hint: "Outstanding delivery liability still owed to customers.",
      },
      {
        label: "Need follow-up",
        value: (data?.summary.customersNeedingFollowUp ?? 0).toLocaleString("en-US"),
        hint: "Customers with remaining balance who now need outreach.",
      },
      {
        label: "Inactive 30+",
        value: (data?.summary.inactive30Count ?? 0).toLocaleString("en-US"),
        hint: "Customers inactive for 30-59 days.",
      },
      {
        label: "Inactive 60+",
        value: (data?.summary.inactive60Count ?? 0).toLocaleString("en-US"),
        hint: "Customers inactive for 60-89 days.",
      },
      {
        label: "Inactive 90+",
        value: (data?.summary.inactive90Count ?? 0).toLocaleString("en-US"),
        hint: "Customers inactive for at least 90 days.",
      },
    ],
    [data],
  );

  async function handlePerformanceExport() {
    if (!data?.performanceRows.length) {
      return;
    }

    setPerformanceExporting(true);

    try {
      await exportPerformanceRows(data.performanceRows, range.fromDate, range.toDate);
    } finally {
      setPerformanceExporting(false);
    }
  }

  async function handleFollowUpExport() {
    if (!data?.followUpRows.length) {
      return;
    }

    setFollowUpExporting(true);

    try {
      await exportFollowUpRows(data.followUpRows, range.fromDate, range.toDate);
    } finally {
      setFollowUpExporting(false);
    }
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report package-portal">
      <PageHeader
        eyebrow="Behavior"
        title="Package portal"
        description="Owner-facing visibility into package performance, delivery liability, and follow-up priorities."
      />

      {error ? <ErrorState label="Package portal could not be loaded" detail={error} /> : null}

      <Panel
        className="analytics-report__panel package-portal__filter-panel"
        title="Package portfolio filters"
        subtitle="Use the clinic selector in the shell, then focus this view by purchase window, package, therapist, salesperson, and inactivity risk."
      >
        <div className="package-portal__filter-grid">
          <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />

          <label className="field field--compact">
            <span>Package</span>
            <select value={packageId} onChange={(event) => setPackageId(event.target.value)}>
              <option value="">All packages</option>
              {(data?.filterOptions.packages ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {(data?.filterOptions.categories ?? []).map((option) => (
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
            <span>Salesperson</span>
            <select value={salesperson} onChange={(event) => setSalesperson(event.target.value)}>
              <option value="">All salespeople</option>
              {(data?.filterOptions.salespeople ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {(data?.filterOptions.statuses ?? []).map((option) => (
                <option key={option} value={option}>
                  {formatStatusLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Inactivity</span>
            <select value={inactivityBucket} onChange={(event) => setInactivityBucket(event.target.value)}>
              <option value="">All buckets</option>
              {(data?.filterOptions.inactivityBuckets ?? []).map((option) => (
                <option key={option} value={option}>
                  {formatInactivityLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="package-portal__toggle">
            <input
              type="checkbox"
              checked={onlyRemaining}
              onChange={(event) => setOnlyRemaining(event.target.checked)}
            />
            <span>Only show customers with remaining balance</span>
          </label>
        </div>
      </Panel>

      <div className="report-kpi-strip package-portal__kpis">
        {kpiCards.map((card) => (
          <article key={card.label} className="report-kpi-strip__card">
            <span className="report-kpi-strip__label">{card.label}</span>
            <strong className="report-kpi-strip__value">{card.value}</strong>
            <span className="report-kpi-strip__hint">{card.hint}</span>
          </article>
        ))}
      </div>

      <div className={`package-portal__workspace ${showPinnedInspector ? "package-portal__workspace--split" : ""}`.trim()}>
        <div className="package-portal__main">
          <Panel
            className="analytics-report__panel package-portal__table-panel"
            title="Package performance"
            subtitle={`${(data?.performanceRows.length ?? 0).toLocaleString("en-US")} packages matched the current scope`}
            action={
              <button
                className="button button--secondary"
                disabled={loading || performanceExporting || (data?.performanceRows.length ?? 0) === 0}
                onClick={() => void handlePerformanceExport()}
              >
                {performanceExporting ? "Exporting..." : "Export summary"}
              </button>
            }
          >
            {loading ? <div className="inline-note inline-note--loading">Loading package performance...</div> : null}
            {!loading && !error && (!data || data.performanceRows.length === 0) ? (
              <EmptyState label="No packages matched the current filters" detail="Try widening the purchase window or clearing one of the filters." />
            ) : null}
            {data && data.performanceRows.length > 0 ? (
              <DataTable
                rows={data.performanceRows}
                rowKey={(row) => row.packageId}
                onRowClick={(row) => setSelectedPackageId(row.packageId)}
                rowClassName={(row) => (row.followUpCount > 0 ? "package-portal__row--attention" : undefined)}
                columns={[
                  {
                    key: "package",
                    header: "Package",
                    render: (row) => (
                      <div className="package-portal__package-cell">
                        <strong>{row.packageName}</strong>
                        <span>{row.followUpSummary}</span>
                      </div>
                    ),
                  },
                  { key: "category", header: "Category", render: (row) => row.category },
                  { key: "sold", header: "Packages sold", render: (row) => row.soldCount.toLocaleString("en-US") },
                  {
                    key: "soldUnits",
                    header: "Units sold",
                    render: (row) => row.totalSoldUnits.toLocaleString("en-US"),
                  },
                  { key: "used", header: "Used units", render: (row) => row.usedUnits.toLocaleString("en-US") },
                  {
                    key: "remaining",
                    header: "Package remaining",
                    render: (row) => row.remainingUnits.toLocaleString("en-US"),
                  },
                  {
                    key: "active",
                    header: "Active customers",
                    render: (row) => row.activeCustomers.toLocaleString("en-US"),
                  },
                  {
                    key: "completed",
                    header: "Completed customers",
                    render: (row) => row.completedCustomers.toLocaleString("en-US"),
                  },
                  {
                    key: "inactive",
                    header: "Inactive customers",
                    render: (row) => row.inactiveCustomers.toLocaleString("en-US"),
                  },
                  {
                    key: "purchaseDate",
                    header: "Latest purchase",
                    render: (row) => (row.latestPurchaseDate ? formatDate(row.latestPurchaseDate) : "—"),
                  },
                  {
                    key: "usageDate",
                    header: "Latest usage",
                    render: (row) => (row.latestUsageDate ? formatDate(row.latestUsageDate) : "No usage yet"),
                  },
                  { key: "usageRate", header: "Usage rate", render: (row) => formatUsageRate(row.usageRatePct) },
                  {
                    key: "summary",
                    header: "Follow-up",
                    render: (row) => (
                      <span className={`status-pill status-pill--${row.followUpCount > 0 ? "attention" : "positive"}`.trim()}>
                        {row.followUpSummary}
                      </span>
                    ),
                  },
                ]}
              />
            ) : null}
          </Panel>

          <Panel
            className="analytics-report__panel package-portal__table-panel"
            title="Follow-up queue"
            subtitle="Customers with package balance are sorted so action is obvious right away."
            action={
              <button
                className="button button--secondary"
                disabled={loading || followUpExporting || (data?.followUpRows.length ?? 0) === 0}
                onClick={() => void handleFollowUpExport()}
              >
                {followUpExporting ? "Exporting..." : "Export follow-up"}
              </button>
            }
          >
            {loading ? <div className="inline-note inline-note--loading">Loading customer follow-up queue...</div> : null}
            {!loading && !error && data && data.followUpRows.length === 0 ? (
              <EmptyState label="No customer-package balances matched the current filters" />
            ) : null}
            {data && data.followUpRows.length > 0 ? (
              <DataTable
                rows={data.followUpRows}
                rowKey={(row) => row.id}
                onRowClick={(row) => setSelectedPackageId(row.packageId)}
                rowClassName={(row) => (row.needsFollowUp ? "package-portal__row--attention" : undefined)}
                columns={[
                  {
                    key: "customer",
                    header: "Customer",
                    render: (row) => (
                      <div className="package-portal__customer-cell">
                        <CustomerPortalLink
                          customerName={row.customerName}
                          customerPhone={row.customerPhone}
                          fromDate={range.fromDate}
                          toDate={range.toDate}
                          stopPropagation
                        />
                        <span>{row.customerPhone || row.memberId || "No phone"}</span>
                      </div>
                    ),
                  },
                  {
                    key: "package",
                    header: "Package",
                    render: (row) => (
                      <div className="package-portal__package-cell">
                        <strong>{row.packageName}</strong>
                        <span>{row.category}</span>
                      </div>
                    ),
                  },
                  { key: "purchaseQty", header: "Purchased qty", render: (row) => row.purchaseCount.toLocaleString("en-US") },
                  { key: "used", header: "Used qty", render: (row) => row.usedUnits.toLocaleString("en-US") },
                  { key: "remaining", header: "Remaining qty", render: (row) => row.remainingUnits.toLocaleString("en-US") },
                  {
                    key: "lastVisit",
                    header: "Last visit",
                    render: (row) => (row.lastVisitDate ? formatDate(row.lastVisitDate) : "No visit yet"),
                  },
                  { key: "days", header: "Days since visit", render: (row) => formatVisitLabel(row) },
                  { key: "therapist", header: "Therapist", render: (row) => row.therapist || "Unknown" },
                  { key: "salesperson", header: "Salesperson", render: (row) => row.salesperson || "—" },
                  {
                    key: "status",
                    header: "Follow-up status",
                    render: (row) => (
                      <span className={`status-pill status-pill--${formatStatusTone(row.status)}`.trim()}>
                        {row.statusLabel}
                      </span>
                    ),
                  },
                ]}
              />
            ) : null}
          </Panel>

        </div>

        {selectedPackageId && currentClinic ? (
          <PackageDetailInspector
            clinicId={currentClinic.id}
            clinicCode={currentClinic.code}
            fromDate={range.fromDate}
            toDate={range.toDate}
            packageId={selectedPackageId}
            category={category}
            therapist={therapist}
            salesperson={salesperson}
            status={status}
            inactivityBucket={inactivityBucket}
            onlyRemaining={onlyRemaining}
            isPinned={inspectorPinned}
            canPin={canPinInspector}
            onClose={() => setSelectedPackageId(null)}
            onTogglePin={() => setInspectorPinned((value) => !value)}
          />
        ) : null}
      </div>
    </div>
  );
}
