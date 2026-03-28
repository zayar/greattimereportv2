import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { ProductStockItemRow } from "../../../types/domain";
import { formatCurrency, formatDate } from "../../../utils/format";
import { buildProductStockItemVariables, GET_PRODUCT_STOCK_ITEMS } from "./queries";

type ProductStockItemsResponse = {
  productStockItems: ProductStockItemRow[];
};

export function ProductStockItemsPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { data, loading, error } = useQuery<ProductStockItemsResponse>(GET_PRODUCT_STOCK_ITEMS, {
    variables: currentClinic ? buildProductStockItemVariables(currentClinic.id, deferredSearch, status) : undefined,
    skip: !currentClinic,
  });

  const rows = data?.productStockItems ?? [];
  const lowStockCount = useMemo(() => rows.filter((row) => Number(row.stock ?? 0) <= 10).length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Product stock items"
        description="Sellable stock-unit records from core, including SKU, stock quantity, and pricing."
        actions={
          <div className="filter-row internal-workspace__filters core-catalog-page__filters">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Stock item or product"
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
          <span className="report-kpi-strip__label">Loaded stock items</span>
          <strong className="report-kpi-strip__value">{rows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Stock-level product rows visible in this clinic scope.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Low stock</span>
          <strong className="report-kpi-strip__value">{lowStockCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Items with stock at or below 10 units.</span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel core-catalog-page__panel"
        title="Stock item registry"
        subtitle="Operational view of SKU-level stock items and their linked product definitions."
      >
        {loading ? <div className="inline-note">Loading product stock items...</div> : null}
        {error ? <ErrorState label="Product stock items could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No stock items matched these filters" detail="Try clearing the search or adjusting the status filter." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Stock item", render: (row) => <strong>{row.name}</strong> },
              { key: "product", header: "Product", render: (row) => row.product?.name || "—" },
              { key: "status", header: "Status", render: (row) => <span className="chip">{row.status}</span> },
              { key: "stock", header: "Stock", render: (row) => `${row.stock ?? 0}` },
              { key: "unit", header: "Control unit", render: (row) => row.stock_control_unit || "—" },
              { key: "sku", header: "SKU", render: (row) => row.sku || "—" },
              { key: "price", header: "Price", render: (row) => formatCurrency(row.price, currentClinic?.currency || "MMK") },
              {
                key: "original",
                header: "Original price",
                render: (row) => formatCurrency(row.original_price, currentClinic?.currency || "MMK"),
              },
              { key: "created", header: "Created", render: (row) => formatDate(row.created_at) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
