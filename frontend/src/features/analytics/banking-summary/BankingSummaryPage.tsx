import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { fetchBankingDetails } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import type { BankingSummaryResponse } from "../../../types/domain";
import { daysAgo, startOfCurrentMonth, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";

const PAGE_SIZE = 50;

type BankingDetailRow = BankingSummaryResponse["rows"][number] & {
  rowId: string;
  walletLabel: string;
};

function formatWalletLabel(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return "—";
  }

  if (typeof value === "number") {
    return value > 0 ? "Topup" : "—";
  }

  const normalized = value.toLowerCase();
  if (normalized.includes("point") || normalized.includes("topup")) {
    return "Topup";
  }

  return value;
}

function formatCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadBankingDetails(rows: BankingDetailRow[], currency: string) {
  const headers = [
    "Date",
    "Invoice Number",
    "Customer Name",
    "Member ID",
    "Sale Person",
    "Service Name",
    "Service Package",
    "Payment Method",
    "Payment Status",
    "Wallet",
    "Invoice Net Total",
  ];

  const body = rows.map((row) =>
    [
      row.dateLabel,
      row.invoiceNumber,
      row.customerName,
      row.memberId,
      row.salePerson,
      row.serviceName,
      row.servicePackageName || "",
      row.paymentMethod,
      row.paymentStatus,
      row.walletLabel,
      formatCurrency(row.invoiceNetTotal, currency),
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

export function BankingSummaryPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [walletTopupFilter, setWalletTopupFilter] = useState<"all" | "hide" | "only">("all");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: startOfCurrentMonth(),
    toDate: today(),
  });
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BankingSummaryResponse | null>(null);

  useEffect(() => {
    setPage(1);
  }, [currentClinic?.id, range.fromDate, range.toDate, paymentMethod, walletTopupFilter]);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchBankingDetails({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      search: deferredSearch,
      paymentMethod,
      walletTopupFilter,
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
  }, [currentClinic, deferredSearch, page, paymentMethod, range.fromDate, range.toDate, walletTopupFilter]);

  const currency = currentClinic?.currency || "MMK";
  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));

  const rows = useMemo<BankingDetailRow[]>(
    () =>
      (data?.rows ?? []).map((row, index) => ({
        ...row,
        rowId: `${row.invoiceNumber}-${row.paymentMethod}-${index}`,
        walletLabel: formatWalletLabel(row.walletTopUp),
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
    <div className="page-stack page-stack--workspace analytics-report banking-details-report">
      <PageHeader
        eyebrow="Revenue"
        title="Payment report"
        description="Payment-method summary and transaction-level payment detail in one workspace."
      />

      <section className="sales-details-report__toolbar banking-details-report__toolbar">
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
              {(data?.methods ?? []).map((row) => (
                <option key={row.paymentMethod} value={row.paymentMethod}>
                  {row.paymentMethod}
                </option>
              ))}
            </select>
          </label>

          <div className="banking-details-report__wallet-filter">
            <span>Wallet</span>
            <div className="banking-details-report__wallet-options">
              {[
                { value: "all", label: "All" },
                { value: "hide", label: "Hide topup" },
                { value: "only", label: "Only topup" },
              ].map((option) => (
                <button
                  key={option.value}
                  className={`button button--secondary ${
                    walletTopupFilter === option.value ? "banking-details-report__wallet-button--active" : ""
                  }`.trim()}
                  onClick={() => {
                    setPage(1);
                    setWalletTopupFilter(option.value as "all" | "hide" | "only");
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <button
            className="button button--secondary"
            disabled={rows.length === 0}
            onClick={() => downloadBankingDetails(rows, currency)}
          >
            Export CSV
          </button>
        </div>
      </section>

      {error ? <ErrorState label="Payment report could not be loaded" detail={error} /> : null}

      <div className="sales-details-report__summary">
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Collected</span>
          <strong>{formatCurrency(data?.summary.totalRevenue ?? 0, currency)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Transactions</span>
          <strong>{(data?.summary.transactionCount ?? 0).toLocaleString("en-US")}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Methods</span>
          <strong>{(data?.summary.methodsCount ?? 0).toLocaleString("en-US")}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Average ticket</span>
          <strong>{formatCurrency(data?.summary.averageTicket ?? 0, currency)}</strong>
        </div>
      </div>

      <Panel
        className="analytics-report__panel sales-details-report__panel banking-details-report__panel"
        title="Payment methods summary"
        subtitle={
          paymentMethod
            ? `Detail rows below are currently filtered to ${paymentMethod}.`
            : "Click a payment method row to filter the detailed transactions below."
        }
        action={
          paymentMethod ? (
            <button className="button button--secondary" onClick={() => setPaymentMethod("")}>
              Clear method filter
            </button>
          ) : null
        }
      >
        {loading ? <div className="inline-note">Loading payment method summary...</div> : null}
        {!loading && !error && (!data || data.methods.length === 0) ? (
          <EmptyState label="No payment methods found for this range" />
        ) : null}
        {data && data.methods.length > 0 ? (
          <div className="table-wrap banking-details-report__methods-wrap">
            <table className="data-table banking-details-report__methods-table">
              <thead>
                <tr>
                  <th>Payment Method</th>
                  <th>Transactions</th>
                  <th>Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.methods.map((row) => {
                  const active = row.paymentMethod === paymentMethod;

                  return (
                    <tr
                      key={row.paymentMethod}
                      className={active ? "banking-details-report__method-row banking-details-report__method-row--active" : "banking-details-report__method-row"}
                      onClick={() => {
                        setPage(1);
                        setPaymentMethod((current) => (current === row.paymentMethod ? "" : row.paymentMethod));
                      }}
                    >
                      <td>
                        <button type="button" className="banking-details-report__method-button">
                          {row.paymentMethod}
                        </button>
                      </td>
                      <td>{row.transactionCount.toLocaleString("en-US")}</td>
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
        className="analytics-report__panel sales-details-report__panel banking-details-report__panel"
        title={`${currentClinic?.name ?? "Clinic"} banking ledger`}
        subtitle={`${(data?.totalCount ?? 0).toLocaleString("en-US")} detailed transaction rows matched the current filters`}
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
        {loading ? <div className="inline-note">Loading detailed transactions...</div> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No banking details matched these filters" detail="Try clearing the search or widening the date range." />
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
              { key: "method", header: "Payment Method", render: (row) => row.paymentMethod || "—" },
              {
                key: "status",
                header: "Payment Status",
                render: (row) => (row.paymentStatus ? <span className="chip">{row.paymentStatus}</span> : "—"),
              },
              { key: "wallet", header: "Wallet Top Up", render: (row) => row.walletLabel },
              {
                key: "amount",
                header: "Invoice Net Total",
                render: (row) => <span className="sales-details-report__strong">{formatCurrency(row.invoiceNetTotal, currency)}</span>,
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
