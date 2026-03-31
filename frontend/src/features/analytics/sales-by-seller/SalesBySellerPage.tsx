import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { fetchSalesBySeller } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import { daysAgo, startOfCurrentMonth, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";
import type { SalesBySellerResponse } from "../../../types/domain";

const PAGE_SIZE = 25;

type SalesByPersonRow = SalesBySellerResponse["recentTransactions"][number] & {
  rowId: string;
};

function formatCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadSalesByPerson(rows: SalesByPersonRow[], currency: string) {
  const headers = [
    "Date",
    "Sales Person",
    "Invoice Number",
    "Customer Name",
    "Service Name",
    "Service Package",
    "Payment Method",
    "Payment Status",
    "Amount",
  ];

  const body = rows.map((row) =>
    [
      row.dateLabel,
      row.sellerName,
      row.invoiceNumber,
      row.customerName,
      row.serviceName,
      row.servicePackageName || "",
      row.paymentMethod || "",
      row.paymentStatus || "",
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
  link.download = `sales-by-sales-person-${today()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SalesBySellerPage() {
  const { currentClinic } = useAccess();
  const [sellerName, setSellerName] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: startOfCurrentMonth(),
    toDate: today(),
  });
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SalesBySellerResponse | null>(null);

  useEffect(() => {
    setPage(1);
  }, [currentClinic?.id, range.fromDate, range.toDate, sellerName]);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchSalesBySeller({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      sellerName,
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
          setError(loadError instanceof Error ? loadError.message : "Failed to load sales by sales person.");
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
  }, [currentClinic, deferredSearch, page, range.fromDate, range.toDate, sellerName]);

  const currency = currentClinic?.currency || "MMK";
  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));

  const summary = useMemo(() => {
    const sellers = data?.sellers ?? [];
    const sellerCount = sellers.length;
    const invoiceCount = sellers.reduce((sum, row) => sum + row.invoiceCount, 0);
    const totalAmount = sellers.reduce((sum, row) => sum + row.totalAmount, 0);
    const averagePerSeller = sellerCount > 0 ? totalAmount / sellerCount : 0;

    return {
      sellerCount,
      invoiceCount,
      totalAmount,
      averagePerSeller,
    };
  }, [data?.sellers]);

  const rows = useMemo<SalesByPersonRow[]>(
    () =>
      (data?.recentTransactions ?? []).map((row, index) => ({
        ...row,
        rowId: `${row.invoiceNumber}-${row.sellerName}-${index}`,
      })),
    [data?.recentTransactions],
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
    <div className="page-stack page-stack--workspace analytics-report sales-by-person-report">
      <PageHeader
        eyebrow="Revenue"
        title="Sales by sales person"
        description="Seller ranking and invoice-level attribution in one focused workspace."
      />

      <section className="sales-details-report__toolbar sales-by-person-report__toolbar">
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
              placeholder="Invoice, customer, service"
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </label>

          <label className="field field--compact sales-details-report__method">
            <span>Sales person</span>
            <select
              value={sellerName}
              onChange={(event) => {
                setPage(1);
                setSellerName(event.target.value);
              }}
            >
              <option value="">All sales people</option>
              {(data?.sellers ?? []).map((row) => (
                <option key={row.sellerName} value={row.sellerName}>
                  {row.sellerName}
                </option>
              ))}
            </select>
          </label>

          <button
            className="button button--secondary"
            disabled={rows.length === 0}
            onClick={() => downloadSalesByPerson(rows, currency)}
          >
            Export CSV
          </button>
        </div>
      </section>

      {error ? <ErrorState label="Sales by sales person could not be loaded" detail={error} /> : null}

      <div className="sales-details-report__summary">
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Sales people</span>
          <strong>{summary.sellerCount.toLocaleString("en-US")}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Invoices</span>
          <strong>{summary.invoiceCount.toLocaleString("en-US")}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Revenue</span>
          <strong>{formatCurrency(summary.totalAmount, currency)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Average / person</span>
          <strong>{formatCurrency(summary.averagePerSeller, currency)}</strong>
        </div>
      </div>

      <Panel
        className="analytics-report__panel"
        title="Sales summary"
        subtitle={
          sellerName
            ? `Detailed rows below are filtered to ${sellerName}.`
            : "Click a sales person row to narrow the detailed invoice rows below."
        }
        action={
          sellerName ? (
            <button className="button button--secondary" onClick={() => setSellerName("")}>
              Clear sales person
            </button>
          ) : null
        }
      >
        {loading ? <div className="inline-note inline-note--loading">Loading sales summary...</div> : null}
        {!loading && !error && (!data || data.sellers.length === 0) ? (
          <EmptyState label="No sales people found for this range" />
        ) : null}
        {data && data.sellers.length > 0 ? (
          <div className="table-wrap sales-by-person-report__summary-wrap">
            <table className="data-table sales-by-person-report__summary-table">
              <thead>
                <tr>
                  <th>Sales Person</th>
                  <th>Invoices</th>
                  <th>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.sellers.map((row) => {
                  const active = row.sellerName === sellerName;

                  return (
                    <tr
                      key={row.sellerName}
                      className={active ? "sales-by-person-report__summary-row sales-by-person-report__summary-row--active" : "sales-by-person-report__summary-row"}
                      onClick={() => {
                        setPage(1);
                        setSellerName((current) => (current === row.sellerName ? "" : row.sellerName));
                      }}
                    >
                      <td>
                        <button type="button" className="sales-by-person-report__summary-button">
                          {row.sellerName}
                        </button>
                      </td>
                      <td>{row.invoiceCount.toLocaleString("en-US")}</td>
                      <td>{formatCurrency(row.totalAmount, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <Panel
        className="analytics-report__panel sales-details-report__panel sales-by-person-report__ledger-panel"
        title={`${currentClinic?.name ?? "Clinic"} attributed invoices`}
        subtitle={`${(data?.totalCount ?? 0).toLocaleString("en-US")} invoice rows matched the current filters`}
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
        {loading ? <div className="inline-note inline-note--loading">Loading invoice rows...</div> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No invoice rows matched these filters" detail="Try clearing the search or widening the date range." />
        ) : null}
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.rowId}
            columns={[
              { key: "date", header: "Date", render: (row) => row.dateLabel },
              { key: "seller", header: "Sales Person", render: (row) => row.sellerName },
              {
                key: "invoice",
                header: "Invoice Number",
                render: (row) => <span className="sales-details-report__strong">{row.invoiceNumber}</span>,
              },
              { key: "customer", header: "Customer Name", render: (row) => row.customerName },
              { key: "service", header: "Service Name", render: (row) => row.serviceName || "—" },
              { key: "package", header: "Service Package", render: (row) => row.servicePackageName || "—" },
              { key: "method", header: "Payment Method", render: (row) => row.paymentMethod || "—" },
              {
                key: "status",
                header: "Status",
                render: (row) => (row.paymentStatus ? <span className="chip">{row.paymentStatus}</span> : "—"),
              },
              {
                key: "amount",
                header: "Amount",
                render: (row) => <span className="sales-details-report__strong">{formatCurrency(row.totalAmount, currency)}</span>,
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
