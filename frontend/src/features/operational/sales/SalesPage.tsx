import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { apolloClient } from "../../../api/apollo";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { today } from "../../../utils/date";
import { buildDatedExportFileName, downloadExcelWorkbook } from "../../../utils/exportExcel";
import { formatCurrency, formatDate } from "../../../utils/format";
import type { OrderRow } from "../../../types/domain";
import { GET_SALES } from "./queries";
import { buildSalesOrderWhere } from "./salesFilters";
import { buildSalesDetailPath } from "./salesDetailLink";

type SalesResponse = {
  orders: OrderRow[];
  aggregateOrder: {
    _count: {
      id: number;
    };
  };
};

const PAGE_SIZE = 20;
const EXPORT_BATCH_SIZE = 500;

function parseBooleanSearchParam(value: string | null) {
  return value === "1" || value === "true";
}

function parsePositivePage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

async function loadAllSales(params: {
  where: Record<string, unknown>;
  clinicId: string;
}) {
  const rows: OrderRow[] = [];
  let totalCount = Number.POSITIVE_INFINITY;
  let skip = 0;

  while (skip < totalCount) {
    const result = await apolloClient.query<SalesResponse>({
      query: GET_SALES,
      variables: {
        where: params.where,
        orderBy: [{ created_at: "desc" }],
        take: EXPORT_BATCH_SIZE,
        skip,
        clinicMembersWhere2: { clinic_id: { equals: params.clinicId } },
      },
      fetchPolicy: "network-only",
    });

    const batch = result.data?.orders ?? [];
    totalCount = result.data?.aggregateOrder?._count.id ?? 0;

    if (batch.length === 0) {
      break;
    }

    rows.push(...batch);
    skip += batch.length;

    if (batch.length < EXPORT_BATCH_SIZE) {
      break;
    }
  }

  return rows;
}

export function SalesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [page, setPage] = useState(() => parsePositivePage(searchParams.get("page")));
  const [exporting, setExporting] = useState(false);
  const [showZeroValue, setShowZeroValue] = useState(() => parseBooleanSearchParam(searchParams.get("showZeroValue")));
  const [showCoOrders, setShowCoOrders] = useState(() => parseBooleanSearchParam(searchParams.get("showCoOrders")));
  const [range, setRange] = useState({
    fromDate: searchParams.get("fromDate") ?? today(),
    toDate: searchParams.get("toDate") ?? today(),
  });

  const where = useMemo(() => {
    if (!currentClinic?.id) {
      return undefined;
    }

    return buildSalesOrderWhere({
      clinicId: currentClinic.id,
      fromDate: range.fromDate,
      toDate: range.toDate,
      search,
      showZeroValue,
      showCoOrders,
    });
  }, [currentClinic?.id, range.fromDate, range.toDate, search, showCoOrders, showZeroValue]);

  const { data, loading, error } = useQuery<SalesResponse>(GET_SALES, {
    variables: {
      where,
      orderBy: [{ created_at: "desc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      clinicMembersWhere2: { clinic_id: { equals: currentClinic?.id } },
    },
    skip: !currentClinic?.id || !where,
  });

  const rows = data?.orders ?? [];
  const totalCount = data?.aggregateOrder?._count.id ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const loadedRevenue = useMemo(
    () => rows.reduce((total, row) => total + Number(row.net_total ?? 0), 0),
    [rows],
  );
  const visibleSellers = useMemo(
    () =>
      new Set(
        rows
          .map((row) => row.seller?.display_name || row.user?.name || "")
          .filter(Boolean),
      ).size,
    [rows],
  );

  async function handleExport() {
    if (!currentClinic?.id || !where) {
      return;
    }

    setExporting(true);

    try {
      const exportRows = await loadAllSales({
        where,
        clinicId: currentClinic.id,
      });

      await downloadExcelWorkbook({
        fileName: buildDatedExportFileName("sales", range.fromDate, range.toDate),
        sheetName: "Sales",
        headers: [
          "Date",
          "Order",
          "Member",
          "Seller",
          "Payment Method",
          "Payment Status",
          "Gross Total",
          "Discount",
          "Tax",
          "Net Total",
          "Balance",
          "Credit Balance",
        ],
        rows: exportRows.map((row) => [
          formatDate(row.created_at),
          row.order_id,
          row.member.clinic_members?.[0]?.name || row.member.name,
          row.seller?.display_name || row.user?.name || "",
          row.payment_method || "",
          row.payment_status || "",
          Number(row.total ?? 0),
          Number(row.discount ?? 0),
          Number(row.tax ?? 0),
          Number(row.net_total ?? 0),
          Number(row.balance ?? 0),
          Number(row.credit_balance ?? 0),
        ]),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace">
      <PageHeader
        eyebrow="Operational"
        title="Sales"
        description="Operational sales activity for the current clinic, using the shared V2 report layout and existing GT order model."
        actions={
          <div className="filter-row internal-workspace__filters">
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
                type="text"
                value={search}
                placeholder="Order no, member, seller"
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
            </label>
            <label className="sales-details-report__toggle">
              <input
                type="checkbox"
                checked={showZeroValue}
                onChange={(event) => {
                  setPage(1);
                  setShowZeroValue(event.target.checked);
                }}
              />
              <span>Show 0 value</span>
            </label>
            <label className="sales-details-report__toggle">
              <input
                type="checkbox"
                checked={showCoOrders}
                onChange={(event) => {
                  setPage(1);
                  setShowCoOrders(event.target.checked);
                }}
              />
              <span>Show CO orders</span>
            </label>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Matching orders</span>
          <strong className="report-kpi-strip__value">{totalCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">
            Orders matched to the clinic, date range, search, and visibility filters.
          </span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Loaded revenue</span>
          <strong className="report-kpi-strip__value">
            {formatCurrency(loadedRevenue, currentClinic?.currency || "MMK")}
          </strong>
          <span className="report-kpi-strip__hint">Net total across the visible result page.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Visible sellers</span>
          <strong className="report-kpi-strip__value">{visibleSellers.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Distinct sellers represented in the current page.</span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel"
        title="Sales ledger"
        subtitle={`${totalCount.toLocaleString("en-US")} orders matched the current filters${!showZeroValue || !showCoOrders ? " · Default cleanup filters are active" : ""}`}
        action={
          <div className="report-panel__actions">
            <button
              className="button button--secondary"
              disabled={loading || exporting || !currentClinic?.id || !where || totalCount === 0}
              onClick={() => void handleExport()}
            >
              {exporting ? "Exporting..." : "Export Excel"}
            </button>
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
          </div>
        }
      >
        {loading ? <div className="inline-note inline-note--loading">Loading orders...</div> : null}
        {error ? <ErrorState label="Sales could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState
            label="No orders found"
            detail="Try a broader date range, clear the search text, or turn on Show 0 value / Show CO orders."
          />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={(row) =>
              navigate(
                buildSalesDetailPath({
                  saleId: row.id,
                  fromDate: range.fromDate,
                  toDate: range.toDate,
                  search,
                  page,
                  showZeroValue,
                  showCoOrders,
                }),
              )
            }
            columns={[
              { key: "date", header: "Date", render: (row) => formatDate(row.created_at) },
              { key: "order", header: "Order", render: (row) => row.order_id },
              {
                key: "member",
                header: "Member",
                render: (row) => row.member.clinic_members?.[0]?.name || row.member.name,
              },
              { key: "seller", header: "Seller", render: (row) => row.seller?.display_name || row.user?.name || "—" },
              {
                key: "status",
                header: "Payment",
                render: (row) => <span className="chip">{row.payment_status || row.payment_method || "—"}</span>,
              },
              {
                key: "amount",
                header: "Net Total",
                render: (row) => formatCurrency(row.net_total, currentClinic?.currency || "MMK"),
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
