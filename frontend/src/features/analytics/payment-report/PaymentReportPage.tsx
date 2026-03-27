import { useDeferredValue, useEffect, useState } from "react";
import { fetchPaymentReport } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
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
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaymentReportResponse | null>(null);

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

    fetchPaymentReport({
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
  }, [currentClinic, deferredSearch, page, range.fromDate, range.toDate]);

  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));
  const currency = currentClinic?.currency || "MMK";

  return (
    <div className="page-stack analytics-report">
      <PageHeader
        eyebrow="Analytics"
        title="Payment report"
        description="Payment mix, invoice totals, and detailed payment rows for the active clinic."
        actions={
          <div className="filter-row analytics-report__filters">
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

      {error ? <ErrorState label="Payment report could not be loaded" detail={error} /> : null}

      <div className="report-kpi-strip analytics-report__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Amount</span>
          <span className="report-kpi-strip__value">{formatCurrency(data?.summary.totalAmount ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Paid net total in range</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Invoices</span>
          <span className="report-kpi-strip__value">{(data?.summary.invoiceCount ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Distinct invoices matched</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Methods</span>
          <span className="report-kpi-strip__value">{(data?.summary.methodsCount ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Payment methods in use</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Average invoice</span>
          <span className="report-kpi-strip__value">{formatCurrency(data?.summary.averageInvoice ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Average invoice value</span>
        </div>
      </div>

      <div className="panel-grid panel-grid--split analytics-report__grid">
        <Panel className="analytics-report__panel" title="Payment mix" subtitle="Share of value by payment method.">
          {loading ? (
            <div className="inline-note">Loading payment methods...</div>
          ) : !data || data.methods.length === 0 ? (
            <EmptyState label="No payment methods found" />
          ) : (
            <HorizontalBarList
              items={data.methods.map((row) => ({
                label: row.paymentMethod,
                value: row.totalAmount,
                valueDisplay: `${formatCurrency(row.totalAmount, currency)} · ${row.transactionCount.toLocaleString("en-US")} txns`,
              }))}
            />
          )}
        </Panel>

        <Panel className="analytics-report__panel" title="Method summary" subtitle="Volume and amount by payment method.">
          {loading ? (
            <div className="inline-note">Loading method summary...</div>
          ) : !data || data.methods.length === 0 ? (
            <EmptyState label="No payment summary found" />
          ) : (
            <DataTable
              rows={data.methods}
              rowKey={(row) => row.paymentMethod}
              columns={[
                { key: "method", header: "Method", render: (row) => row.paymentMethod },
                {
                  key: "transactions",
                  header: "Transactions",
                  render: (row) => row.transactionCount.toLocaleString("en-US"),
                },
                {
                  key: "amount",
                  header: "Amount",
                  render: (row) => formatCurrency(row.totalAmount, currency),
                },
              ]}
            />
          )}
        </Panel>
      </div>

      <Panel
        className="analytics-report__panel"
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
        {!loading && !error && (!data || data.rows.length === 0) ? (
          <EmptyState label="No payment rows matched these filters" />
        ) : null}
        {data && data.rows.length > 0 ? (
          <DataTable
            rows={data.rows}
            rowKey={(row) => `${row.invoiceNumber}-${row.dateLabel}-${row.serviceName ?? ""}`}
            columns={[
              { key: "date", header: "Date", render: (row) => row.dateLabel },
              { key: "invoice", header: "Invoice", render: (row) => row.invoiceNumber },
              { key: "customer", header: "Customer", render: (row) => row.customerName },
              { key: "seller", header: "Seller", render: (row) => row.salePerson },
              { key: "method", header: "Method", render: (row) => row.paymentMethod || "—" },
              {
                key: "amount",
                header: "Net total",
                render: (row) => formatCurrency(row.invoiceNetTotal, currency),
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
