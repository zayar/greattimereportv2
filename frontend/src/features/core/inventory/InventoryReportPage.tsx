import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { InventoryReportRow } from "../../../types/domain";
import { today } from "../../../utils/date";
import {
  buildInventoryReportVariables,
  GENERATE_INVENTORY_REPORT,
  GET_TOTAL_PRODUCT_STOCK_ITEMS_COUNT,
} from "./queries";

type InventoryReportResponse = {
  generateInventoryReport: InventoryReportRow[];
};

type ProductStockItemCountResponse = {
  aggregateProductStockItem: {
    _count: {
      id: number;
    };
  };
};

const PAGE_SIZE = 20;

export function InventoryReportPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [reportDate, setReportDate] = useState(today());
  const [page, setPage] = useState(1);

  const variables = currentClinic
    ? buildInventoryReportVariables({
        clinicId: currentClinic.id,
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
        searchText: deferredSearch,
        toDate: new Date(`${reportDate}T00:00:00.000Z`),
      })
    : undefined;

  const { data, loading, error } = useQuery<InventoryReportResponse>(GENERATE_INVENTORY_REPORT, {
    variables,
    skip: !currentClinic,
  });

  const { data: countData, loading: countLoading, error: countError } = useQuery<ProductStockItemCountResponse>(
    GET_TOTAL_PRODUCT_STOCK_ITEMS_COUNT,
    {
      variables: variables ? { where: variables.where } : undefined,
      skip: !variables,
    },
  );

  const rows = data?.generateInventoryReport ?? [];
  const totalCount = countData?.aggregateProductStockItem._count.id ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const zeroStockCount = useMemo(() => rows.filter((row) => row.current_qty <= 0).length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Inventory report"
        description="As-of stock position from core, including receipts, sales, and adjustments."
        actions={
          <div className="filter-row core-catalog-page__filters">
            <label className="field field--compact">
              <span>Report date</span>
              <input
                type="date"
                value={reportDate}
                onChange={(event) => {
                  setPage(1);
                  setReportDate(event.target.value);
                }}
              />
            </label>
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Product name"
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
            </label>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Matching stock items</span>
          <strong className="report-kpi-strip__value">{totalCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Product stock items included in this as-of report.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Out of stock on page</span>
          <strong className="report-kpi-strip__value">{zeroStockCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible rows where current quantity is zero or below.</span>
        </article>
      </div>

      <Panel
        className="core-catalog-page__panel core-catalog-page__wide-table"
        title="As-of stock report"
        subtitle={`Inventory position as of ${reportDate}`}
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
        {loading || countLoading ? <div className="inline-note">Loading inventory report...</div> : null}
        {error ? <ErrorState label="Inventory report could not be loaded" detail={error.message} /> : null}
        {countError ? <ErrorState label="Inventory report count could not be loaded" detail={countError.message} /> : null}
        {!loading && !countLoading && !error && !countError && rows.length === 0 ? (
          <EmptyState label="No stock items matched this report" detail="Try clearing the search or moving the report date." />
        ) : null}
        {!error && !countError && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Product", render: (row) => <strong>{row.name}</strong> },
              { key: "current", header: "Current qty", render: (row) => `${row.current_qty}` },
              { key: "received", header: "Received qty", render: (row) => `${row.received_qty}` },
              { key: "sale", header: "Sale qty", render: (row) => `${row.sale_qty}` },
              { key: "adj_in", header: "Adjustment in", render: (row) => `${row.adjustment_in_qty}` },
              { key: "adj_out", header: "Adjustment out", render: (row) => `${row.adjustment_out_qty}` },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
