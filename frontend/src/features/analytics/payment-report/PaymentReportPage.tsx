import { useEffect, useState } from "react";
import { fetchPaymentReport } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { daysAgo, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";
import type { PaymentReportResponse } from "../../../types/domain";

const PAGE_SIZE = 20;

export function PaymentReportPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaymentReportResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchPaymentReport({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      search,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load payment report.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentClinic, page, range.fromDate, range.toDate, search]);

  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Payment report"
        description="Server-side BigQuery payment reporting with explicit filtering and pagination."
        actions={
          <div className="filter-row">
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="text"
                value={search}
                placeholder="Customer, invoice, seller"
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
        title={`${currentClinic?.name ?? "Clinic"} payments`}
        subtitle={`${(data?.totalCount ?? 0).toLocaleString("en-US")} rows in the selected window`}
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
        {loading ? <div className="inline-note">Loading payment report...</div> : null}
        {error ? <ErrorState label="Payment report could not be loaded" detail={error} /> : null}
        {!loading && !error && (!data || data.rows.length === 0) ? (
          <EmptyState label="No payment rows matched these filters" />
        ) : null}
        {data && data.rows.length > 0 ? (
          <DataTable
            rows={data.rows}
            rowKey={(row) => `${row.invoiceNumber}-${row.dateLabel}`}
            columns={[
              { key: "date", header: "Date", render: (row) => row.dateLabel },
              { key: "invoice", header: "Invoice", render: (row) => row.invoiceNumber },
              { key: "customer", header: "Customer", render: (row) => row.customerName },
              { key: "seller", header: "Seller", render: (row) => row.salePerson },
              { key: "method", header: "Method", render: (row) => row.paymentMethod || "—" },
              {
                key: "amount",
                header: "Net total",
                render: (row) => formatCurrency(row.invoiceNetTotal, currentClinic?.currency || "MMK"),
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}

