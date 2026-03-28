import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { InventoryHistoryRow } from "../../../types/domain";
import { daysAgo, today } from "../../../utils/date";
import { formatDateTime } from "../../../utils/format";
import { buildStockHistoryVariables, GET_STOCK_HISTORIES, GET_TOTAL_STOCK_HISTORY_COUNT } from "./queries";

type InventoryHistoryResponse = {
  stockHistories: InventoryHistoryRow[];
};

type InventoryHistoryCountResponse = {
  aggregateStockHistory: {
    _count: {
      id: number;
    };
  };
};

const PAGE_SIZE = 20;

function eventLabel(value: string | null | undefined) {
  switch (value) {
    case "sale":
      return "Sale";
    case "product":
      return "Product";
    case "service":
      return "Service";
    case "adjustment":
      return "Adjustment";
    case "opening":
      return "Opening";
    default:
      return value || "—";
  }
}

export function InventoryHistoryPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [refType, setRefType] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });

  const variables = currentClinic
    ? buildStockHistoryVariables({
        clinicId: currentClinic.id,
        fromDate: new Date(`${range.fromDate}T00:00:00.000Z`).toISOString(),
        toDate: new Date(`${range.toDate}T23:59:59.999Z`).toISOString(),
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
        searchText: deferredSearch,
        refType,
      })
    : undefined;

  const { data, loading, error } = useQuery<InventoryHistoryResponse>(GET_STOCK_HISTORIES, {
    variables,
    skip: !currentClinic,
  });

  const { data: countData, loading: countLoading, error: countError } = useQuery<InventoryHistoryCountResponse>(
    GET_TOTAL_STOCK_HISTORY_COUNT,
    {
      variables: variables ? { where: variables.where } : undefined,
      skip: !variables,
    },
  );

  const rows = data?.stockHistories ?? [];
  const totalCount = countData?.aggregateStockHistory._count.id ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const adjustmentCount = useMemo(() => rows.filter((row) => row.ref_type === "adjustment").length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Inventory history"
        description="Stock movement history from core with searchable event trails."
        actions={
          <div className="filter-row internal-workspace__filters core-catalog-page__filters">
            <DateRangeControls
              fromDate={range.fromDate}
              toDate={range.toDate}
              onChange={(next) => {
                setPage(1);
                setRange(next);
              }}
            />
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Stock name"
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
            </label>
            <label className="field field--compact">
              <span>Event</span>
              <select
                value={refType}
                onChange={(event) => {
                  setPage(1);
                  setRefType(event.target.value);
                }}
              >
                <option value="">All events</option>
                <option value="sale">Sale</option>
                <option value="product">Product</option>
                <option value="service">Service</option>
                <option value="adjustment">Adjustment</option>
                <option value="opening">Opening</option>
              </select>
            </label>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Matching events</span>
          <strong className="report-kpi-strip__value">{totalCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Events in the selected date window and clinic scope.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Adjustments on this page</span>
          <strong className="report-kpi-strip__value">{adjustmentCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible adjustment rows in the current result page.</span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel core-catalog-page__panel core-catalog-page__wide-table"
        title="Stock movement trail"
        subtitle="Use this page to trace stock changes by event type and closing quantity."
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
        {loading || countLoading ? <div className="inline-note">Loading inventory history...</div> : null}
        {error ? <ErrorState label="Inventory history could not be loaded" detail={error.message} /> : null}
        {countError ? <ErrorState label="Inventory history count could not be loaded" detail={countError.message} /> : null}
        {!loading && !countLoading && !error && !countError && rows.length === 0 ? (
          <EmptyState label="No stock movements matched these filters" detail="Try widening the date range or clearing the event filter." />
        ) : null}
        {!error && !countError && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "date", header: "Date", render: (row) => formatDateTime(row.stock_date) },
              { key: "stock", header: "Stock", render: (row) => <strong>{row.stock.name}</strong> },
              { key: "product", header: "Product", render: (row) => row.stock.product?.name || "—" },
              {
                key: "qty",
                header: "Delta",
                render: (row) => (
                  <span className={row.qty >= 0 ? "core-catalog-page__positive" : "core-catalog-page__negative"}>
                    {row.qty >= 0 ? "+" : ""}
                    {row.qty}
                  </span>
                ),
              },
              { key: "closing", header: "Closing qty", render: (row) => `${row.closing_qty}` },
              { key: "event", header: "Event", render: (row) => <span className="chip">{eventLabel(row.ref_type)}</span> },
              { key: "description", header: "Description", render: (row) => row.description || "—" },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
