import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { fetchCustomersBySalesperson } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import type { CustomersBySalespersonResponse } from "../../../types/domain";
import { daysAgo, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";

const PAGE_SIZE = 25;

function formatCsvValue(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadCustomersBySalesperson(
  rows: CustomersBySalespersonResponse["customers"],
  sellerName: string,
  currency: string,
) {
  const headers = [
    "Customer Name",
    "Phone Number",
    "Member ID",
    "Total Spend",
    "Last Invoice Number",
    "Last Purchase Date",
    "Sales Person",
  ];

  const body = rows.map((row) =>
    [
      row.name,
      row.phoneNumber,
      row.memberId,
      formatCurrency(row.totalSpend, currency),
      row.lastInvoiceNumber,
      row.lastPurchaseDate,
      sellerName,
    ]
      .map(formatCsvValue)
      .join(","),
  );

  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `customers-by-salesperson-${today()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function CustomersBySalespersonPage() {
  const { currentClinic } = useAccess();
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [selectedSellerName, setSelectedSellerName] = useState("");
  const [activeSellerName, setActiveSellerName] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [loadingSellers, setLoadingSellers] = useState(true);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sellers, setSellers] = useState<string[]>([]);
  const [data, setData] = useState<CustomersBySalespersonResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoadingSellers(true);
    setError(null);

    fetchCustomersBySalesperson({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      sellerName: "",
      search: "",
      page: 1,
      pageSize: 1,
    })
      .then((result) => {
        if (!active) {
          return;
        }

        setSellers(result.sellers);
        setSelectedSellerName((current) => {
          if (current && result.sellers.includes(current)) {
            return current;
          }

          return result.sellers[0] ?? "";
        });
        setActiveSellerName("");
        setData(null);
        setSearch("");
        setPage(1);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load sales people.");
          setSellers([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoadingSellers(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentClinic, range.fromDate, range.toDate]);

  useEffect(() => {
    setPage(1);
  }, [activeSellerName, deferredSearch]);

  useEffect(() => {
    if (!currentClinic || !activeSellerName) {
      return;
    }

    let active = true;
    setLoadingCustomers(true);
    setError(null);

    fetchCustomersBySalesperson({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      sellerName: activeSellerName,
      search: deferredSearch,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setData(result);
          setSellers(result.sellers);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load customers by salesperson.");
        }
      })
      .finally(() => {
        if (active) {
          setLoadingCustomers(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeSellerName, currentClinic, deferredSearch, page, range.fromDate, range.toDate]);

  const currency = currentClinic?.currency || "MMK";
  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));
  const summary = data?.summary ?? { customerCount: 0, totalSpend: 0, averageSpend: 0 };

  return (
    <div className="page-stack page-stack--workspace analytics-report customer-salesperson-report">
      <PageHeader
        eyebrow="Revenue"
        title="Customer by salesperson"
        description="Select a sales person, then load the customer list attributed to them."
        actions={
          <div className="filter-row analytics-report__filters">
            <DateRangeControls
              fromDate={range.fromDate}
              toDate={range.toDate}
              onChange={(next) => {
                setRange(next);
              }}
            />
          </div>
        }
      />

      {error ? <ErrorState label="Customer by salesperson could not be loaded" detail={error} /> : null}

      <Panel
        className="analytics-report__panel customer-salesperson-report__selector-panel"
        title="Select salesperson"
        subtitle="Choose a salesperson first, then load the customer list when you are ready."
      >
        <div className="customer-salesperson-report__selector-row">
          <label className="field field--compact customer-salesperson-report__selector-field">
            <span>Salesperson</span>
            <select
              value={selectedSellerName}
              disabled={loadingSellers || sellers.length === 0}
              onChange={(event) => setSelectedSellerName(event.target.value)}
            >
              {sellers.length === 0 ? <option value="">No sales people</option> : null}
              {sellers.map((seller) => (
                <option key={seller} value={seller}>
                  {seller}
                </option>
              ))}
            </select>
          </label>

          <button
            className="button"
            disabled={loadingSellers || !selectedSellerName}
            onClick={() => {
              setPage(1);
              setSearch("");
              setActiveSellerName(selectedSellerName);
            }}
          >
            Load customers
          </button>
        </div>
      </Panel>

      {activeSellerName ? (
        <div className="sales-details-report__summary customer-salesperson-report__summary">
          <div className="sales-details-report__summary-card">
            <span className="sales-details-report__summary-label">Salesperson</span>
            <strong>{activeSellerName}</strong>
          </div>
          <div className="sales-details-report__summary-card">
            <span className="sales-details-report__summary-label">Customers</span>
            <strong>{summary.customerCount.toLocaleString("en-US")}</strong>
          </div>
          <div className="sales-details-report__summary-card">
            <span className="sales-details-report__summary-label">Total amount spent</span>
            <strong>{formatCurrency(summary.totalSpend, currency)}</strong>
          </div>
          <div className="sales-details-report__summary-card">
            <span className="sales-details-report__summary-label">Average spend</span>
            <strong>{formatCurrency(summary.averageSpend, currency)}</strong>
          </div>
        </div>
      ) : null}

      <Panel
        className="analytics-report__panel customer-salesperson-report__results-panel"
        title={activeSellerName ? `${activeSellerName} customers` : "Customer list"}
        subtitle={
          activeSellerName
            ? `Showing ${(data?.totalCount ?? 0).toLocaleString("en-US")} customers attributed to ${activeSellerName}.`
            : "Load a salesperson first to view the customer table."
        }
        action={
          activeSellerName ? (
            <div className="customer-salesperson-report__table-actions">
              <label className="field field--compact field--search customer-salesperson-report__search">
                <span>Search</span>
                <input
                  type="text"
                  value={search}
                  placeholder="Search by name, phone, or member ID"
                  onChange={(event) => {
                    setPage(1);
                    setSearch(event.target.value);
                  }}
                />
              </label>

              <button
                className="button button--secondary"
                disabled={!data || data.customers.length === 0}
                onClick={() =>
                  downloadCustomersBySalesperson(data?.customers ?? [], activeSellerName, currency)
                }
              >
                Export CSV
              </button>
            </div>
          ) : null
        }
      >
        {loadingCustomers ? <div className="inline-note">Loading customer list...</div> : null}
        {!loadingCustomers && !activeSellerName ? (
          <EmptyState label="Select a salesperson to load customers" />
        ) : null}
        {!loadingCustomers && activeSellerName && (!data || data.customers.length === 0) ? (
          <EmptyState
            label="No customers matched these filters"
            detail="Try clearing the search or choosing a different salesperson."
          />
        ) : null}
        {data && data.customers.length > 0 ? (
          <>
            <DataTable
              rows={data.customers}
              rowKey={(row) => `${row.name}-${row.phoneNumber}-${row.lastInvoiceNumber}`}
              columns={[
                { key: "name", header: "Customer Name", render: (row) => row.name },
                { key: "phone", header: "Phone Number", render: (row) => row.phoneNumber || "—" },
                { key: "member", header: "Member ID", render: (row) => row.memberId || "—" },
                {
                  key: "spend",
                  header: "Total Amount Spent",
                  render: (row) => (
                    <span className="sales-details-report__strong">{formatCurrency(row.totalSpend, currency)}</span>
                  ),
                },
                { key: "date", header: "Last Purchase Date", render: (row) => row.lastPurchaseDate || "—" },
                { key: "invoice", header: "Last Invoice Number", render: (row) => row.lastInvoiceNumber || "—" },
              ]}
            />

            <div className="pagination-controls customer-salesperson-report__pagination">
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
          </>
        ) : null}
      </Panel>
    </div>
  );
}
