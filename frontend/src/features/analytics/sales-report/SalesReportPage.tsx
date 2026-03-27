import { useDeferredValue, useEffect, useState } from "react";
import { fetchSalesReport } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
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
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SalesReportResponse | null>(null);

  useEffect(() => {
    setPage(1);
  }, [currentClinic?.id, range.fromDate, range.toDate]);

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
      search: deferredSearch,
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
  }, [currentClinic, deferredSearch, page, range.fromDate, range.toDate]);

  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));
  const currency = currentClinic?.currency || "MMK";

  return (
    <div className="page-stack analytics-report">
      <PageHeader
        eyebrow="Analytics"
        title="Sales report"
        description="Paid sales, service rankings, and invoice detail for the selected clinic."
        actions={
          <div className="filter-row analytics-report__filters">
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

      <div className="report-kpi-strip analytics-report__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Revenue</span>
          <span className="report-kpi-strip__value">{formatCurrency(data?.summary.totalRevenue ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Paid revenue in range</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Invoices</span>
          <span className="report-kpi-strip__value">{(data?.summary.invoiceCount ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Distinct paid invoices</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Customers</span>
          <span className="report-kpi-strip__value">{(data?.summary.customerCount ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Paying customers</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Average ticket</span>
          <span className="report-kpi-strip__value">{formatCurrency(data?.summary.averageInvoice ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Average invoice value</span>
        </div>
      </div>

      <div className="panel-grid panel-grid--split analytics-report__grid">
        <Panel
          className="analytics-report__panel analytics-report__panel--tall"
          title="Revenue trend"
          subtitle="Daily paid revenue for the selected range."
        >
          {loading ? (
            <div className="inline-note">Loading revenue trend...</div>
          ) : !data || data.trend.length === 0 ? (
            <EmptyState label="No sales trend data found" />
          ) : (
            <BarChart
              items={data.trend.map((row) => ({
                label: row.dateLabel.slice(5),
                value: row.totalRevenue,
                valueLabel: formatCurrency(row.totalRevenue, currency),
                meta: `${row.invoiceCount.toLocaleString("en-US")} invoices`,
              }))}
            />
          )}
        </Panel>

        <Panel
          className="analytics-report__panel"
          title="Top services"
          subtitle="Highest-value services in the same window."
        >
          {loading ? (
            <div className="inline-note">Loading top services...</div>
          ) : !data || data.topServices.length === 0 ? (
            <EmptyState label="No sales services found" />
          ) : (
            <HorizontalBarList
              items={data.topServices.map((row) => ({
                label: row.serviceName,
                value: row.totalRevenue,
                valueDisplay: `${formatCurrency(row.totalRevenue, currency)} · ${row.invoiceCount.toLocaleString("en-US")} invoices`,
              }))}
            />
          )}
        </Panel>
      </div>

      <Panel
        className="analytics-report__panel"
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
