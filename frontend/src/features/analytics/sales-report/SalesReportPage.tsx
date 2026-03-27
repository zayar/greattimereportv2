import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { fetchSalesReport } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import type { SalesReportResponse } from "../../../types/domain";
import { daysAgo, startOfCurrentMonth, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";

const PAGE_SIZE = 20;

type PaymentReportRow = SalesReportResponse["rows"][number] & {
  rowId: string;
};

function formatCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadPaymentReport(rows: PaymentReportRow[], currency: string) {
  const headers = [
    "Date",
    "Invoice Number",
    "Customer Name",
    "Sales Person",
    "Service Name",
    "Payment Method",
    "Net Total",
  ];

  const body = rows.map((row) =>
    [
      row.dateLabel,
      row.invoiceNumber,
      row.customerName,
      row.salePerson,
      row.serviceName,
      row.paymentMethod,
      formatCurrency(row.totalAmount, currency),
    ]
      .map(formatCsvValue)
      .join(","),
  );

  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `payment-report-${today()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SalesReportPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: startOfCurrentMonth(),
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

  const rows = useMemo<PaymentReportRow[]>(
    () =>
      (data?.rows ?? []).map((row, index) => ({
        ...row,
        rowId: `${row.invoiceNumber}-${row.serviceName}-${index}`,
      })),
    [data?.rows],
  );

  function applyPreset(type: "today" | "7d" | "30d" | "month") {
    if (type === "today") {
      setRange({
        fromDate: today(),
        toDate: today(),
      });
      return;
    }

    if (type === "7d") {
      setRange({
        fromDate: daysAgo(6),
        toDate: today(),
      });
      return;
    }

    if (type === "30d") {
      setRange({
        fromDate: daysAgo(29),
        toDate: today(),
      });
      return;
    }

    setRange({
      fromDate: startOfCurrentMonth(),
      toDate: today(),
    });
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report payment-workspace-report">
      <PageHeader
        eyebrow="Revenue"
        title="Payment report"
        description="Paid invoice performance, service ranking, and detailed payment-backed rows."
      />

      <section className="sales-details-report__toolbar payment-workspace-report__toolbar">
        <div className="sales-details-report__toolbar-group sales-details-report__toolbar-group--filters">
          <div className="sales-details-report__preset-row">
            <button className="button button--secondary" onClick={() => applyPreset("today")}>
              Today
            </button>
            <button className="button button--secondary" onClick={() => applyPreset("7d")}>
              7D
            </button>
            <button className="button button--secondary" onClick={() => applyPreset("30d")}>
              30D
            </button>
            <button className="button button--secondary" onClick={() => applyPreset("month")}>
              Month
            </button>
          </div>

          <DateRangeControls
            fromDate={range.fromDate}
            toDate={range.toDate}
            onChange={(next) => {
              setPage(1);
              setRange(next);
            }}
          />
        </div>

        <div className="sales-details-report__toolbar-group sales-details-report__toolbar-group--actions">
          <label className="field field--compact field--search sales-details-report__search">
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

          <button
            className="button button--secondary"
            disabled={rows.length === 0}
            onClick={() => downloadPaymentReport(rows, currency)}
          >
            Export CSV
          </button>
        </div>
      </section>

      {error ? <ErrorState label="Payment report could not be loaded" detail={error} /> : null}

      <div className="sales-details-report__summary">
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Revenue</span>
          <strong>{formatCurrency(data?.summary.totalRevenue ?? 0, currency)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Invoices</span>
          <strong>{(data?.summary.invoiceCount ?? 0).toLocaleString("en-US")}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Customers</span>
          <strong>{(data?.summary.customerCount ?? 0).toLocaleString("en-US")}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Average ticket</span>
          <strong>{formatCurrency(data?.summary.averageInvoice ?? 0, currency)}</strong>
        </div>
      </div>

      <div className="panel-grid panel-grid--split analytics-report__grid payment-workspace-report__grid">
        <Panel
          className="analytics-report__panel analytics-report__panel--tall"
          title="Revenue trend"
          subtitle="Daily paid revenue across the selected range."
        >
          {loading ? (
            <div className="inline-note">Loading revenue trend...</div>
          ) : !data || data.trend.length === 0 ? (
            <EmptyState label="No payment trend data found" />
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
          title="Service ranking"
          subtitle="Top services by paid value. Click a service row to filter the ledger below."
        >
          {loading ? (
            <div className="inline-note">Loading service ranking...</div>
          ) : !data || data.topServices.length === 0 ? (
            <EmptyState label="No service ranking found" />
          ) : (
            <DataTable
              rows={data.topServices}
              rowKey={(row) => row.serviceName}
              columns={[
                {
                  key: "service",
                  header: "Service",
                  render: (row) => (
                    <button
                      type="button"
                      className="payment-workspace-report__service-button"
                      onClick={() => {
                        setPage(1);
                        setSearch(row.serviceName);
                      }}
                    >
                      {row.serviceName}
                    </button>
                  ),
                },
                { key: "invoices", header: "Invoices", render: (row) => row.invoiceCount.toLocaleString("en-US") },
                {
                  key: "amount",
                  header: "Revenue",
                  render: (row) => formatCurrency(row.totalRevenue, currency),
                },
              ]}
            />
          )}
        </Panel>
      </div>

      <Panel
        className="analytics-report__panel sales-details-report__panel payment-workspace-report__ledger-panel"
        title={`${currentClinic?.name ?? "Clinic"} payment ledger`}
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
        {loading ? <div className="inline-note">Loading payment rows...</div> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No payment rows matched these filters" detail="Try clearing the search or widening the date range." />
        ) : null}
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.rowId}
            columns={[
              { key: "date", header: "Date", render: (row) => row.dateLabel },
              {
                key: "invoice",
                header: "Invoice Number",
                render: (row) => <span className="sales-details-report__strong">{row.invoiceNumber}</span>,
              },
              { key: "customer", header: "Customer Name", render: (row) => row.customerName },
              { key: "seller", header: "Sales Person", render: (row) => row.salePerson },
              { key: "service", header: "Service Name", render: (row) => row.serviceName },
              { key: "method", header: "Payment Method", render: (row) => row.paymentMethod },
              {
                key: "amount",
                header: "Net Total",
                render: (row) => <span className="sales-details-report__strong">{formatCurrency(row.totalAmount, currency)}</span>,
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
