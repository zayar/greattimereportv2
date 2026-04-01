import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { Link, useSearchParams } from "react-router-dom";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import type { CheckInOrderItemRow, CheckInOutRow } from "../../../types/domain";
import { daysAgo, today } from "../../../utils/date";
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

export function CheckInOutPage() {
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [status, setStatus] = useState(() => searchParams.get("status") ?? "");
  const [page, setPage] = useState(() => parsePositivePage(searchParams.get("page")));
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

  const orderItemLookup = useMemo(() => {
    const lookup = new Map<string, CheckInOrderItemRow[]>();

    for (const item of orderItemsData?.orderItems ?? []) {
      const key = `${item.order_id}::${item.service_id}`;
      const current = lookup.get(key) ?? [];
      current.push(item);
      lookup.set(key, current);
    }

    return lookup;
  }, [orderItemsData?.orderItems]);

  const getServiceAmount = (row: CheckInOutRow) => {
    if (row.status !== "CHECKOUT" || !row.order_id || !row.service?.id) {
      return null;
    }

    const matches = orderItemLookup.get(`${row.order_id}::${row.service.id}`) ?? [];

    if (row.isUsePurchaseService) {
      return matches.find((item) => Number(item.price ?? 0) === 0)?.price ?? null;
    }

    return matches[0]?.price ?? null;
  };

  const checkedInCount = useMemo(() => rows.filter((row) => row.status === "CHECKIN").length, [rows]);
  const checkedOutCount = useMemo(() => rows.filter((row) => row.status === "CHECKOUT").length, [rows]);
  const loadedValue = useMemo(
    () => rows.reduce((total, row) => total + Number(getServiceAmount(row) ?? 0), 0),
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
                key: "total",
                header: "Total",
                render: (row) => {
                  const amount = getServiceAmount(row);
                  return amount == null ? "—" : formatCurrency(amount, currentClinic?.currency || "MMK");
                },
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
