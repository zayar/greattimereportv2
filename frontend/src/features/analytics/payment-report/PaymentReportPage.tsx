import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { fetchPaymentReport } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { startOfCurrentMonth, today, daysAgo } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";
import type { PaymentReportResponse } from "../../../types/domain";

const PAGE_SIZE = 30;

type SalesDetailRow = PaymentReportResponse["rows"][number] & {
  rowId: string;
  showInvoiceValues: boolean;
  walletLabel: string;
};

function formatOptionalCurrency(value: number | null | undefined, currency: string) {
  if (value == null) {
    return "—";
  }

  return formatCurrency(value, currency);
}

function formatWalletLabel(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return "—";
  }

  if (typeof value === "number") {
    return value > 0 ? "Topup" : "—";
  }

  return value.includes("*Point") ? "Topup" : value;
}

function formatCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadSalesDetails(rows: SalesDetailRow[], currency: string) {
  const headers = [
    "Date",
    "Invoice Number",
    "Customer Name",
    "Member ID",
    "Sale Person",
    "Service Name",
    "Service Package",
    "Wallet",
    "Qty",
    "Item Price",
    "Item Total",
    "Sub Total",
    "Total",
    "Discount",
    "Net Total",
    "Order Balance",
    "Order Credit Balance",
    "Tax",
    "Invoice Total",
    "Payment Status",
    "Payment Method",
    "Payment Type",
  ];

  const body = rows.map((row) =>
    [
      row.dateLabel,
      row.invoiceNumber,
      row.customerName,
      row.memberId || "",
      row.salePerson || "",
      row.serviceName || "",
      row.servicePackageName || "",
      row.walletLabel,
      row.itemQuantity ?? "",
      row.itemPrice == null ? "" : formatCurrency(row.itemPrice, currency),
      row.itemTotal == null ? "" : formatCurrency(row.itemTotal, currency),
      row.subTotal == null ? "" : formatCurrency(row.subTotal, currency),
      row.total == null ? "" : formatCurrency(row.total, currency),
      row.discount == null ? "" : formatCurrency(row.discount, currency),
      row.netTotal == null ? "" : formatCurrency(row.netTotal, currency),
      row.orderBalance == null ? "" : formatCurrency(row.orderBalance, currency),
      row.orderCreditBalance == null ? "" : formatCurrency(row.orderCreditBalance, currency),
      row.tax == null ? "" : formatCurrency(row.tax, currency),
      formatCurrency(row.invoiceNetTotal, currency),
      row.paymentStatus || "",
      row.paymentMethod || "",
      row.paymentType || "",
    ]
      .map(formatCsvValue)
      .join(","),
  );

  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sales-details-${today()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function PaymentReportPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [includeZeroValues, setIncludeZeroValues] = useState(false);
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: startOfCurrentMonth(),
    toDate: today(),
  });
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PaymentReportResponse | null>(null);

  useEffect(() => {
    setPage(1);
  }, [currentClinic?.id, range.fromDate, range.toDate, paymentMethod, includeZeroValues]);

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
      paymentMethod,
      includeZeroValues,
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
          setError(loadError instanceof Error ? loadError.message : "Failed to load sales details.");
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
  }, [currentClinic, deferredSearch, includeZeroValues, page, paymentMethod, range.fromDate, range.toDate]);

  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));
  const currency = currentClinic?.currency || "MMK";
  const methodOptions = data?.methods ?? [];

  const rows = useMemo<SalesDetailRow[]>(() => {
    if (!data) {
      return [];
    }

    let previousInvoice = "";

    return data.rows.map((row, index) => {
      const showInvoiceValues = row.invoiceNumber !== previousInvoice;
      previousInvoice = row.invoiceNumber;

      return {
        ...row,
        rowId: `${row.invoiceNumber}-${row.serviceName ?? "item"}-${index}`,
        showInvoiceValues,
        walletLabel: formatWalletLabel(row.walletTopUp),
      };
    });
  }, [data]);

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
    <div className="page-stack page-stack--workspace analytics-report sales-details-report">
      <PageHeader
        eyebrow="Revenue"
        title="Sales details"
        description="Invoice-level sales detail with service lines, payment attribution, and quick filtering."
      />

      <section className="sales-details-report__toolbar">
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
              placeholder="Invoice, customer, seller, service"
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </label>

          <label className="field field--compact sales-details-report__method">
            <span>Payment</span>
            <select
              value={paymentMethod}
              onChange={(event) => {
                setPage(1);
                setPaymentMethod(event.target.value);
              }}
            >
              <option value="">All methods</option>
              {methodOptions.map((row) => (
                <option key={row.paymentMethod} value={row.paymentMethod}>
                  {row.paymentMethod}
                </option>
              ))}
            </select>
          </label>

          <label className="sales-details-report__toggle">
            <input
              type="checkbox"
              checked={includeZeroValues}
              onChange={(event) => {
                setPage(1);
                setIncludeZeroValues(event.target.checked);
              }}
            />
            <span>Show zero values</span>
          </label>

          <button
            className="button button--secondary"
            disabled={rows.length === 0}
            onClick={() => downloadSalesDetails(rows, currency)}
          >
            Export CSV
          </button>
        </div>
      </section>

      {error ? <ErrorState label="Sales details could not be loaded" detail={error} /> : null}

      <div className="sales-details-report__summary">
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Net revenue</span>
          <strong>{formatCurrency(data?.summary.totalAmount ?? 0, currency)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Invoices</span>
          <strong>{(data?.summary.invoiceCount ?? 0).toLocaleString("en-US")}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Rows</span>
          <strong>{(data?.totalCount ?? 0).toLocaleString("en-US")}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Avg invoice</span>
          <strong>{formatCurrency(data?.summary.averageInvoice ?? 0, currency)}</strong>
        </div>
      </div>

      <Panel
        className="analytics-report__panel sales-details-report__panel"
        title={`${currentClinic?.name ?? "Clinic"} ledger`}
        subtitle="Service-level invoice detail inspired by GTDashboard_ST, rebuilt with server-side filtering."
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
        {loading ? <div className="inline-note inline-note--loading">Loading sales details...</div> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No sales details matched these filters" detail="Try clearing the search or widening the date range." />
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
              { key: "member", header: "Member ID", render: (row) => row.memberId || "—" },
              { key: "seller", header: "Sale Person", render: (row) => row.salePerson || "—" },
              { key: "service", header: "Service Name", render: (row) => row.serviceName || "—" },
              { key: "package", header: "Service Package", render: (row) => row.servicePackageName || "—" },
              { key: "wallet", header: "Wallet", render: (row) => row.walletLabel },
              { key: "qty", header: "Qty", render: (row) => (row.itemQuantity == null ? "—" : row.itemQuantity) },
              {
                key: "itemPrice",
                header: "Item Price",
                render: (row) => formatOptionalCurrency(row.itemPrice, currency),
              },
              {
                key: "itemTotal",
                header: "Item Total",
                render: (row) => formatOptionalCurrency(row.itemTotal, currency),
              },
              {
                key: "subTotal",
                header: "Sub Total",
                render: (row) => formatOptionalCurrency(row.subTotal, currency),
              },
              {
                key: "total",
                header: "Total",
                render: (row) =>
                  row.showInvoiceValues ? formatOptionalCurrency(row.total, currency) : <span className="sales-details-report__muted">—</span>,
              },
              {
                key: "discount",
                header: "Discount",
                render: (row) =>
                  row.showInvoiceValues
                    ? formatOptionalCurrency(row.discount, currency)
                    : <span className="sales-details-report__muted">—</span>,
              },
              {
                key: "netTotal",
                header: "Net Total",
                render: (row) =>
                  row.showInvoiceValues
                    ? formatOptionalCurrency(row.netTotal, currency)
                    : <span className="sales-details-report__muted">—</span>,
              },
              {
                key: "balance",
                header: "Order Balance",
                render: (row) =>
                  row.showInvoiceValues
                    ? formatOptionalCurrency(row.orderBalance, currency)
                    : <span className="sales-details-report__muted">—</span>,
              },
              {
                key: "creditBalance",
                header: "Order Credit",
                render: (row) =>
                  row.showInvoiceValues
                    ? formatOptionalCurrency(row.orderCreditBalance, currency)
                    : <span className="sales-details-report__muted">—</span>,
              },
              {
                key: "tax",
                header: "Tax",
                render: (row) =>
                  row.showInvoiceValues ? formatOptionalCurrency(row.tax, currency) : <span className="sales-details-report__muted">—</span>,
              },
              {
                key: "invoiceTotal",
                header: "Invoice Total",
                render: (row) =>
                  row.showInvoiceValues ? (
                    <span className="sales-details-report__strong">{formatCurrency(row.invoiceNetTotal, currency)}</span>
                  ) : (
                    <span className="sales-details-report__muted">—</span>
                  ),
              },
              {
                key: "paymentStatus",
                header: "Payment Status",
                render: (row) => (row.paymentStatus ? <span className="chip">{row.paymentStatus}</span> : "—"),
              },
              { key: "paymentMethod", header: "Payment Method", render: (row) => row.paymentMethod || "—" },
              { key: "paymentType", header: "Payment Type", render: (row) => row.paymentType || "—" },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
