import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { ServicePackageRow } from "../../../types/domain";
import { formatCurrency, formatDate } from "../../../utils/format";
import { buildServicePackageVariables, GET_SERVICE_PACKAGES } from "./queries";

type ServicePackagesResponse = {
  servicePackages: ServicePackageRow[];
};

export function ServicePackagesPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { data, loading, error } = useQuery<ServicePackagesResponse>(GET_SERVICE_PACKAGES, {
    variables: currentClinic ? buildServicePackageVariables(currentClinic.id, deferredSearch, status) : undefined,
    skip: !currentClinic,
  });

  const rows = data?.servicePackages ?? [];
  const lockedCount = useMemo(() => rows.filter((row) => row.isLock).length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Service packages"
        description="Package catalog from core with pricing, expiry, and locking state."
        actions={
          <div className="filter-row internal-workspace__filters core-catalog-page__filters">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Package name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="field field--compact">
              <span>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Loaded packages</span>
          <strong className="report-kpi-strip__value">{rows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Packages visible in the current clinic scope.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Locked packages</span>
          <strong className="report-kpi-strip__value">{lockedCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Packages currently marked as locked in core.</span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel core-catalog-page__panel"
        title="Package catalog"
        subtitle="Package pricing, expiry day, and publishing state."
      >
        {loading ? <div className="inline-note inline-note--loading">Loading service packages...</div> : null}
        {error ? <ErrorState label="Service packages could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No packages matched these filters" detail="Try clearing the search or changing the status filter." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Package", render: (row) => <strong>{row.name}</strong> },
              { key: "status", header: "Status", render: (row) => <span className="chip">{row.status}</span> },
              {
                key: "price",
                header: "Price",
                render: (row) => formatCurrency(row.price, currentClinic?.currency || "MMK"),
              },
              {
                key: "original_price",
                header: "Original price",
                render: (row) => formatCurrency(row.original_price, currentClinic?.currency || "MMK"),
              },
              { key: "expiry", header: "Expiry day", render: (row) => `${row.expiry_day ?? 0}` },
              { key: "locked", header: "Locked", render: (row) => <span className="chip">{row.isLock ? "Locked" : "Open"}</span> },
              { key: "order", header: "Sort order", render: (row) => `${row.sort_order ?? 0}` },
              { key: "created", header: "Created", render: (row) => formatDate(row.created_at) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
