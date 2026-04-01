import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { apolloClient } from "../../../api/apollo";
import { Link, useSearchParams } from "react-router-dom";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import type { CheckInOrderItemRow, CheckInOutRow } from "../../../types/domain";
import { daysAgo, today } from "../../../utils/date";
import { buildDatedExportFileName, chunkArray, downloadExcelWorkbook } from "../../../utils/exportExcel";
import { formatCurrency, formatDateTime } from "../../../utils/format";
import {
  buildCheckInOrderItemsVariables,
  buildCheckInOutVariables,
  GET_CHECKIN_ORDER_ITEMS,
  GET_CHECKIN_OUT_DATA,
} from "./queries";

type CheckInOutResponse = {
  checkIns: CheckInOutRow[];
  aggregateCheckIn: {
    _count: {
      _all: number;
    };
  };
};

type CheckInOrderItemsResponse = {
  orderItems: CheckInOrderItemRow[];
};

const PAGE_SIZE = 20;
const EXPORT_BATCH_SIZE = 500;
const ORDER_ITEM_EXPORT_BATCH_SIZE = 250;

function parsePositivePage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function resolveMemberName(row: CheckInOutRow) {
  return row.member?.clinic_members?.[0]?.name || row.member?.name || "—";
}

function resolveMemberPhone(row: CheckInOutRow) {
  return row.member?.clinic_members?.[0]?.phonenumber || row.member?.phonenumber || "—";
}

function buildOrderItemLookup(items: CheckInOrderItemRow[]) {
  const lookup = new Map<string, CheckInOrderItemRow[]>();

  for (const item of items) {
    const key = `${item.order_id}::${item.service_id}`;
    const current = lookup.get(key) ?? [];
    current.push(item);
    lookup.set(key, current);
  }

  return lookup;
}

function getMatchedOrderItem(row: CheckInOutRow, orderItemLookup: Map<string, CheckInOrderItemRow[]>) {
  if (row.status !== "CHECKOUT" || !row.order_id || !row.service?.id) {
    return null;
  }

  const matches = orderItemLookup.get(`${row.order_id}::${row.service.id}`) ?? [];

  if (row.isUsePurchaseService) {
    return matches.find((item) => Number(item.price ?? 0) === 0) ?? null;
  }

  return matches[0] ?? null;
}

async function loadAllCheckInRows(params: {
  clinicId: string;
  fromDate: string;
  toDate: string;
  search: string;
  status: string;
}) {
  const rows: CheckInOutRow[] = [];
  let totalCount = Number.POSITIVE_INFINITY;
  let skip = 0;

  while (skip < totalCount) {
    const result = await apolloClient.query<CheckInOutResponse>({
      query: GET_CHECKIN_OUT_DATA,
      variables: buildCheckInOutVariables({
        clinicId: params.clinicId,
        fromDate: params.fromDate,
        toDate: params.toDate,
        search: params.search,
        status: params.status,
        take: EXPORT_BATCH_SIZE,
        skip,
      }),
      fetchPolicy: "network-only",
    });

    const batch = result.data?.checkIns ?? [];
    totalCount = result.data?.aggregateCheckIn?._count._all ?? 0;

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

async function loadOrderItemsForCheckIns(rows: CheckInOutRow[]) {
  const orderIds = Array.from(
    new Set(
      rows
        .filter((row) => row.status === "CHECKOUT" && row.order_id)
        .map((row) => row.order_id as string),
    ),
  );
  const items: CheckInOrderItemRow[] = [];

  for (const chunk of chunkArray(orderIds, ORDER_ITEM_EXPORT_BATCH_SIZE)) {
    const result = await apolloClient.query<CheckInOrderItemsResponse>({
      query: GET_CHECKIN_ORDER_ITEMS,
      variables: buildCheckInOrderItemsVariables(chunk),
      fetchPolicy: "network-only",
    });
    items.push(...(result.data?.orderItems ?? []));
  }

  return buildOrderItemLookup(items);
}

export function CheckInOutPage() {
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [status, setStatus] = useState(() => searchParams.get("status") ?? "");
  const [page, setPage] = useState(() => parsePositivePage(searchParams.get("page")));
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState({
    fromDate: searchParams.get("fromDate") ?? daysAgo(6),
    toDate: searchParams.get("toDate") ?? today(),
  });

  const variables = useMemo(() => {
    if (!currentClinic?.id) {
      return undefined;
    }

    return buildCheckInOutVariables({
      clinicId: currentClinic.id,
      fromDate: range.fromDate,
      toDate: range.toDate,
      search,
      status,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    });
  }, [currentClinic?.id, page, range.fromDate, range.toDate, search, status]);

  const { data, loading, error } = useQuery<CheckInOutResponse>(GET_CHECKIN_OUT_DATA, {
    variables,
    skip: !variables,
  });

  const rows = data?.checkIns ?? [];
  const totalCount = data?.aggregateCheckIn?._count._all ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const orderIds = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .filter((row) => row.status === "CHECKOUT" && row.order_id)
            .map((row) => row.order_id as string),
        ),
      ),
    [rows],
  );

  const orderItemVariables = useMemo(
    () => (orderIds.length > 0 ? buildCheckInOrderItemsVariables(orderIds) : undefined),
    [orderIds],
  );

  const { data: orderItemsData } = useQuery<CheckInOrderItemsResponse>(GET_CHECKIN_ORDER_ITEMS, {
    variables: orderItemVariables,
    skip: !orderItemVariables,
  });

  const orderItemLookup = useMemo(() => buildOrderItemLookup(orderItemsData?.orderItems ?? []), [orderItemsData?.orderItems]);

  const checkedInCount = useMemo(() => rows.filter((row) => row.status === "CHECKIN").length, [rows]);
  const checkedOutCount = useMemo(() => rows.filter((row) => row.status === "CHECKOUT").length, [rows]);
  const loadedValue = useMemo(
    () => rows.reduce((total, row) => total + Number(getMatchedOrderItem(row, orderItemLookup)?.total ?? 0), 0),
    [rows, orderItemLookup],
  );
  const visibleServices = useMemo(
    () =>
      new Set(
        rows
          .map((row) => row.service?.name ?? "")
          .filter(Boolean),
      ).size,
    [rows],
  );

  async function handleExport() {
    if (!currentClinic?.id) {
      return;
    }

    setExporting(true);

    try {
      const exportRows = await loadAllCheckInRows({
        clinicId: currentClinic.id,
        fromDate: range.fromDate,
        toDate: range.toDate,
        search,
        status,
      });
      const exportOrderItems = await loadOrderItemsForCheckIns(exportRows);

      await downloadExcelWorkbook({
        fileName: buildDatedExportFileName("check-in-out", range.fromDate, range.toDate),
        sheetName: "Check In Out",
        headers: [
          "Check-In Time",
          "Check-Out Time",
          "Order ID",
          "Service",
          "Therapist",
          "Helper",
          "Customer",
          "Phone",
          "Seller Name",
          "Payment Method",
          "Payment Status",
          "Visit Status",
          "Item Price",
          "Total",
        ],
        rows: exportRows.map((row) => {
          const item = getMatchedOrderItem(row, exportOrderItems);
          return [
            formatDateTime(row.in_time),
            row.out_time ? formatDateTime(row.out_time) : "",
            row.orders?.order_id || "",
            row.service?.name || "",
            row.practitioner?.name || "",
            row.booking?.service_helper?.name || row.helper?.name || "",
            resolveMemberName(row),
            resolveMemberPhone(row),
            row.orders?.seller?.display_name || "",
            row.orders?.payment_method || "",
            row.orders?.payment_status || "",
            row.status,
            item?.price == null ? "" : Number(item.price),
            item?.total == null ? "" : Number(item.total),
          ];
        }),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace checkin-report">
      <PageHeader
        eyebrow="Operational"
        title="Check In/Out"
        description="Core-database treatment flow visibility for arrivals, checkouts, therapist delivery, and related sales context."
        actions={
          <div className="filter-row internal-workspace__filters checkin-report__filters">
            <DateRangeControls
              fromDate={range.fromDate}
              toDate={range.toDate}
              onChange={(next) => {
                setPage(1);
                setRange(next);
              }}
            />
            <label className="field field--compact field--search internal-workspace__search-field">
              <span>Search</span>
              <input
                type="text"
                value={search}
                placeholder="Service, therapist, helper, customer"
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
            </label>
            <label className="field field--compact">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value);
                }}
              >
                <option value="">All statuses</option>
                <option value="CHECKIN">Check In</option>
                <option value="CHECKOUT">Check Out</option>
              </select>
            </label>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Matching sessions</span>
          <strong className="report-kpi-strip__value">{totalCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Check-in records matched to the clinic, time window, and search filters.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Checked in on page</span>
          <strong className="report-kpi-strip__value">{checkedInCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible visits that are still in progress on the current page.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Checked out on page</span>
          <strong className="report-kpi-strip__value">{checkedOutCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible visits already completed in the current page.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Visible service value</span>
          <strong className="report-kpi-strip__value">
            {formatCurrency(loadedValue, currentClinic?.currency || "MMK")}
          </strong>
          <span className="report-kpi-strip__hint">
            Service-level value found from matching order items for the loaded result page.
          </span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel checkin-report__panel"
        title="Check in / out ledger"
        subtitle={`${totalCount.toLocaleString("en-US")} records matched · ${visibleServices.toLocaleString("en-US")} visible services on this page`}
        action={
          <div className="report-panel__actions">
            <button
              className="button button--secondary"
              disabled={loading || exporting || !currentClinic?.id || totalCount === 0}
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
        {loading ? <div className="inline-note inline-note--loading">Loading check in / out records...</div> : null}
        {error ? <ErrorState label="Check in / out data could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState
            label="No check-in records found"
            detail="Try widening the date range, clearing the search text, or switching the visit status filter."
          />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "in", header: "Check-In Time", render: (row) => formatDateTime(row.in_time) },
              {
                key: "out",
                header: "Check-Out Time",
                render: (row) => (row.out_time ? formatDateTime(row.out_time) : "—"),
              },
              {
                key: "order",
                header: "Order ID",
                render: (row) =>
                  row.order_id && row.orders?.order_id ? (
                    <Link className="checkin-report__order-link" to={`/operational/sales/${row.order_id}`}>
                      {row.orders.order_id}
                    </Link>
                  ) : (
                    row.orders?.order_id || "—"
                  ),
              },
              { key: "service", header: "Service", render: (row) => row.service?.name || "—" },
              { key: "therapist", header: "Therapist", render: (row) => row.practitioner?.name || "—" },
              {
                key: "helper",
                header: "Helper",
                render: (row) => row.booking?.service_helper?.name || row.helper?.name || "—",
              },
              { key: "customer", header: "Customer", render: (row) => resolveMemberName(row) },
              { key: "phone", header: "Phone", render: (row) => resolveMemberPhone(row) },
              {
                key: "seller",
                header: "Seller Name",
                render: (row) => row.orders?.seller?.display_name || "—",
              },
              {
                key: "paymentMethod",
                header: "Payment Method",
                render: (row) => row.orders?.payment_method || "—",
              },
              {
                key: "paymentStatus",
                header: "Status",
                render: (row) => <span className="chip">{row.orders?.payment_status || row.status || "—"}</span>,
              },
              {
                key: "itemPrice",
                header: "Item Price",
                render: (row) => {
                  const item = getMatchedOrderItem(row, orderItemLookup);
                  return item ? formatCurrency(item.price, currentClinic?.currency || "MMK") : "—";
                },
              },
              {
                key: "total",
                header: "Total",
                render: (row) => {
                  const item = getMatchedOrderItem(row, orderItemLookup);
                  return item ? formatCurrency(item.total, currentClinic?.currency || "MMK") : "—";
                },
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
