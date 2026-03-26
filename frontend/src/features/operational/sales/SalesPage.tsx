import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { daysAgo, today } from "../../../utils/date";
import { formatCurrency, formatDate } from "../../../utils/format";
import type { OrderRow } from "../../../types/domain";
import { GET_SALES } from "./queries";

type SalesResponse = {
  orders: OrderRow[];
  aggregateOrder: {
    _count: {
      id: number;
    };
  };
};

const PAGE_SIZE = 20;

function buildOrderWhere(params: {
  clinicId: string;
  fromDate: string;
  toDate: string;
  search: string;
}) {
  const search = params.search.trim();
  const where: Record<string, unknown> = {
    clinic_id: { equals: params.clinicId },
    created_at: {
      gte: new Date(`${params.fromDate}T00:00:00.000Z`).toISOString(),
      lte: new Date(`${params.toDate}T23:59:59.999Z`).toISOString(),
    },
  };

  if (search) {
    where.OR = [
      {
        member: {
          is: {
            OR: [{ name: { contains: search } }, { phonenumber: { contains: search } }],
          },
        },
      },
      {
        user: {
          is: {
            name: { contains: search },
          },
        },
      },
      {
        order_id: {
          contains: search,
        },
      },
    ];
  }

  return where;
}

export function SalesPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });

  const where = useMemo(() => {
    if (!currentClinic?.id) {
      return undefined;
    }

    return buildOrderWhere({
      clinicId: currentClinic.id,
      fromDate: range.fromDate,
      toDate: range.toDate,
      search,
    });
  }, [currentClinic?.id, range.fromDate, range.toDate, search]);

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

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operational"
        title="Sales"
        description="Orders are pulled from the existing gt.report GraphQL model, but the page itself is rebuilt with cleaner layout, filters, and pagination."
        actions={
          <div className="filter-row">
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
          </div>
        }
      />

      <Panel
        title={`${currentClinic?.name ?? "Clinic"} sales`}
        subtitle={`${totalCount.toLocaleString("en-US")} orders matched the current filters`}
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
        {loading ? <div className="inline-note">Loading orders...</div> : null}
        {error ? <ErrorState label="Sales could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No orders found" detail="Try a broader date range or clear the search text." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
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

