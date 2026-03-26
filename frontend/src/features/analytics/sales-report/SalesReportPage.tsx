import { useEffect, useState } from "react";
import { fetchSalesReport } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import type { SalesReportResponse } from "../../../types/domain";
import { daysAgo, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";

const PAGE_SIZE = 20;

export function SalesReportPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SalesReportResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchSalesReport({
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
          setError(loadError instanceof Error ? loadError.message : "Failed to load sales report.");
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
  const currency = currentClinic?.currency || "MMK";

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Sales report"
        description="A dedicated BigQuery sales workspace with paid revenue summary, daily trend, top services, and searchable invoice rows."
        actions={
          <div className="filter-row">
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="text"
                value={search}
                placeholder="Customer, invoice, seller, service"
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
            </label>
          </div>
        }
      />

      {error ? <ErrorState label="Sales report could not be loaded" detail={error} /> : null}

      <div className="panel-grid panel-grid--quad">
        <Panel title="Revenue" subtitle="Paid revenue in the selected range">
          <strong className="panel-stat">{formatCurrency(data?.summary.totalRevenue ?? 0, currency)}</strong>
        </Panel>
        <Panel title="Invoices" subtitle="Distinct paid invoice count">
          <strong className="panel-stat">{(data?.summary.invoiceCount ?? 0).toLocaleString("en-US")}</strong>
        </Panel>
        <Panel title="Customers" subtitle="Distinct paying customers">
          <strong className="panel-stat">{(data?.summary.customerCount ?? 0).toLocaleString("en-US")}</strong>
        </Panel>
        <Panel title="Average ticket" subtitle="Average net total per paid invoice">
          <strong className="panel-stat">{formatCurrency(data?.summary.averageInvoice ?? 0, currency)}</strong>
        </Panel>
      </div>

      <div className="panel-grid panel-grid--split">
        <Panel title="Daily revenue trend" subtitle="Paid sales grouped by day">
          {loading ? (
            <div className="inline-note">Loading revenue trend...</div>
          ) : !data || data.trend.length === 0 ? (
            <EmptyState label="No sales trend data found" />
          ) : (
            <BarChart
              items={data.trend.map((row) => ({
                label: row.dateLabel.slice(5),
                value: row.totalRevenue,
                meta: `${row.invoiceCount.toLocaleString("en-US")} invoices`,
              }))}
            />
          )}
        </Panel>

        <Panel title="Top services" subtitle="Highest-revenue services in the same window">
          {loading ? (
            <div className="inline-note">Loading top services...</div>
          ) : !data || data.topServices.length === 0 ? (
            <EmptyState label="No sales services found" />
          ) : (
            <DataTable
              rows={data.topServices}
              rowKey={(row) => row.serviceName}
              columns={[
                { key: "service", header: "Service", render: (row) => row.serviceName },
                { key: "invoices", header: "Invoices", render: (row) => row.invoiceCount.toLocaleString("en-US") },
                {
                  key: "revenue",
                  header: "Revenue",
                  render: (row) => formatCurrency(row.totalRevenue, currency),
                },
              ]}
            />
          )}
        </Panel>
      </div>

      <Panel
        title={`${currentClinic?.name ?? "Clinic"} sales rows`}
        subtitle={`${(data?.totalCount ?? 0).toLocaleString("en-US")} paid rows matched the current filters`}
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
        {loading ? <div className="inline-note">Loading sales rows...</div> : null}
        {!loading && !error && (!data || data.rows.length === 0) ? (
          <EmptyState label="No sales rows matched these filters" />
        ) : null}
        {data && data.rows.length > 0 ? (
          <DataTable
            rows={data.rows}
            rowKey={(row) => `${row.invoiceNumber}-${row.dateLabel}-${row.serviceName}`}
            columns={[
              { key: "date", header: "Date", render: (row) => row.dateLabel },
              { key: "invoice", header: "Invoice", render: (row) => row.invoiceNumber },
              { key: "customer", header: "Customer", render: (row) => row.customerName },
              { key: "seller", header: "Seller", render: (row) => row.salePerson },
              { key: "service", header: "Service", render: (row) => row.serviceName },
              { key: "method", header: "Method", render: (row) => row.paymentMethod },
              {
                key: "amount",
                header: "Net total",
                render: (row) => formatCurrency(row.totalAmount, currency),
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
