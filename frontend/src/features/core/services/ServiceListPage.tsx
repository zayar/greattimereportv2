import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { ServiceRow } from "../../../types/domain";
import { formatCurrency, formatDate } from "../../../utils/format";
import { buildServiceVariables, GET_SERVICES } from "./queries";

type ServicesResponse = {
  services: ServiceRow[];
};

export function ServiceListPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { data, loading, error } = useQuery<ServicesResponse>(GET_SERVICES, {
    variables: currentClinic ? buildServiceVariables(currentClinic.id, deferredSearch, status) : undefined,
    skip: !currentClinic,
  });

  const rows = data?.services ?? [];
  const activeCount = useMemo(() => rows.filter((row) => row.status === "ACTIVE").length, [rows]);
  const avgPrice = useMemo(() => {
    if (rows.length === 0) {
      return 0;
    }

    return rows.reduce((total, row) => total + Number(row.price ?? 0), 0) / rows.length;
  }, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Service list"
        description="Live service catalog from core, scoped to the selected clinic."
        actions={
          <div className="filter-row core-catalog-page__filters">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Service name"
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
          <span className="report-kpi-strip__label">Loaded services</span>
          <strong className="report-kpi-strip__value">{rows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Showing the current catalog window from core.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Active services</span>
          <strong className="report-kpi-strip__value">{activeCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Published and available service entries.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Average listed price</span>
          <strong className="report-kpi-strip__value">{formatCurrency(avgPrice, currentClinic?.currency || "MMK")}</strong>
          <span className="report-kpi-strip__hint">Average based on loaded service rows.</span>
        </article>
      </div>

      <Panel
        className="core-catalog-page__panel"
        title={`${currentClinic?.name ?? "Clinic"} services`}
        subtitle="Service catalog, pricing, cadence, and status from the core service table."
      >
        {loading ? <div className="inline-note">Loading service catalog...</div> : null}
        {error ? <ErrorState label="Service list could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No services matched these filters" detail="Try clearing the search or changing the status filter." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Service", render: (row) => <strong>{row.name}</strong> },
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
              { key: "duration", header: "Duration", render: (row) => `${row.duration ?? 0} min` },
              { key: "interval", header: "Interval day", render: (row) => `${row.interval_day ?? 0}` },
              { key: "order", header: "Sort order", render: (row) => `${row.sort_order ?? 0}` },
              { key: "created", header: "Created", render: (row) => formatDate(row.created_at) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
