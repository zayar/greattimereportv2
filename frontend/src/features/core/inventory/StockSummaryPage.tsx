import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { StockSummaryRow } from "../../../types/domain";
import { daysAgo, today } from "../../../utils/date";
import { buildStockSummaryVariables, GENERATE_STOCK_SUMMARY, GET_TOTAL_PRODUCT_STOCK_ITEMS_COUNT } from "./queries";

type StockSummaryResponse = {
  generateStockSummaryReport: StockSummaryRow[];
};

type ProductStockItemCountResponse = {
  aggregateProductStockItem: {
    _count: {
      id: number;
    };
  };
};

const PAGE_SIZE = 20;

function stockHealthLabel(value: number) {
  if (value <= 0) {
    return "Out of stock";
  }
  if (value <= 10) {
    return "Low stock";
  }
  return "In stock";
}

export function StockSummaryPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });

  const variables = currentClinic
    ? buildStockSummaryVariables({
        clinicId: currentClinic.id,
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
        searchText: deferredSearch,
        fromDate: new Date(`${range.fromDate}T00:00:00.000Z`),
        toDate: new Date(`${range.toDate}T23:59:59.999Z`),
      })
    : undefined;

  const { data, loading, error } = useQuery<StockSummaryResponse>(GENERATE_STOCK_SUMMARY, {
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

  const rows = data?.generateStockSummaryReport ?? [];
  const totalCount = countData?.aggregateProductStockItem._count.id ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const lowStockCount = useMemo(() => rows.filter((row) => row.closing_qty <= 10).length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Stock summary"
        description="Opening, in, out, and closing stock movement summary for the selected window."
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
          <span className="report-kpi-strip__label">Matching products</span>
          <strong className="report-kpi-strip__value">{totalCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Stock items included in the selected date window.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Low stock on page</span>
          <strong className="report-kpi-strip__value">{lowStockCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible rows with 10 or fewer units closing stock.</span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel core-catalog-page__panel core-catalog-page__wide-table"
        title="Stock summary table"
        subtitle="A compact audit view of opening, incoming, outgoing, and closing stock."
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
        {loading || countLoading ? <div className="inline-note inline-note--loading">Loading stock summary...</div> : null}
        {error ? <ErrorState label="Stock summary could not be loaded" detail={error.message} /> : null}
        {countError ? <ErrorState label="Stock summary count could not be loaded" detail={countError.message} /> : null}
        {!loading && !countLoading && !error && !countError && rows.length === 0 ? (
          <EmptyState label="No stock summary rows matched these filters" detail="Try widening the date range or clearing the search." />
        ) : null}
        {!error && !countError && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Product", render: (row) => <strong>{row.name}</strong> },
              { key: "opening", header: "Opening qty", render: (row) => `${row.opening_qty}` },
              { key: "in", header: "In qty", render: (row) => `${row.in_qty}` },
              { key: "out", header: "Out qty", render: (row) => `${row.out_qty}` },
              { key: "closing", header: "Closing qty", render: (row) => `${row.closing_qty}` },
              { key: "health", header: "Stock health", render: (row) => <span className="chip">{stockHealthLabel(row.closing_qty)}</span> },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
