import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { ProductRow } from "../../../types/domain";
import { formatDate } from "../../../utils/format";
import { buildProductVariables, GET_PRODUCTS } from "./queries";

type ProductsResponse = {
  products: ProductRow[];
};

export function ProductListPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { data, loading, error } = useQuery<ProductsResponse>(GET_PRODUCTS, {
    variables: currentClinic ? buildProductVariables(currentClinic.id, deferredSearch, status) : undefined,
    skip: !currentClinic,
  });

  const rows = data?.products ?? [];
  const withBrandCount = useMemo(() => rows.filter((row) => row.brand?.name).length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Product list"
        description="Clinic product catalog from core, including measurement and brand data."
        actions={
          <div className="filter-row core-catalog-page__filters">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Product name"
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
          <span className="report-kpi-strip__label">Loaded products</span>
          <strong className="report-kpi-strip__value">{rows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Current product catalog records in scope.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">With brand</span>
          <strong className="report-kpi-strip__value">{withBrandCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Products linked to a brand record in core.</span>
        </article>
      </div>

      <Panel
        className="core-catalog-page__panel core-catalog-page__wide-table"
        title="Product catalog"
        subtitle="Read-only operational view of products, measurement amounts, and brand mapping."
      >
        {loading ? <div className="inline-note">Loading products...</div> : null}
        {error ? <ErrorState label="Product list could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No products matched these filters" detail="Try clearing the search or adjusting the status filter." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Product", render: (row) => <strong>{row.name}</strong> },
              { key: "status", header: "Status", render: (row) => <span className="chip">{row.status}</span> },
              {
                key: "measurement",
                header: "Measurement",
                render: (row) => `${row.measurement_amount ?? 0} ${row.measurement?.name ?? ""}`.trim() || "—",
              },
              { key: "brand", header: "Brand", render: (row) => row.brand?.name || "—" },
              { key: "order", header: "Sort order", render: (row) => `${row.sort_order ?? 0}` },
              { key: "created", header: "Created", render: (row) => formatDate(row.created_at) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
