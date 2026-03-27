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

export function CustomersBySalespersonPage() {
  const { currentClinic } = useAccess();
  const [sellerName, setSellerName] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CustomersBySalespersonResponse | null>(null);

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

    fetchCustomersBySalesperson({
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
          if (!sellerName && result.sellers.length > 0) {
            setSellerName(result.sellers[0]);
          }
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load customers by sales person.");
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
  const summary = data?.summary ?? { customerCount: 0, totalSpend: 0, averageSpend: 0 };

  const sellerOptions = useMemo(() => data?.sellers ?? [], [data?.sellers]);

  return (
    <div className="page-stack analytics-report">
      <PageHeader
        eyebrow="Revenue"
        title="Customer by sales person"
        description="Customers attributed to a selected sales person, ranked by spend and recency."
        actions={
          <div className="filter-row analytics-report__filters">
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
            <label className="field field--compact">
              <span>Sales person</span>
              <select value={sellerName} onChange={(event) => setSellerName(event.target.value)}>
                {sellerOptions.length === 0 ? <option value="">No sellers</option> : null}
                {sellerOptions.map((seller) => (
                  <option key={seller} value={seller}>
                    {seller}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="text"
                value={search}
                placeholder="Customer, phone, member ID"
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
            </label>
          </div>
        }
      />

      {error ? <ErrorState label="Customer by sales person could not be loaded" detail={error} /> : null}

      <div className="report-kpi-strip analytics-report__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Sales person</span>
          <span className="report-kpi-strip__value">{sellerName || "—"}</span>
          <span className="report-kpi-strip__hint">Current attribution filter</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Customers</span>
          <span className="report-kpi-strip__value">{summary.customerCount.toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Matched customer profiles</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Total spend</span>
          <span className="report-kpi-strip__value">{formatCurrency(summary.totalSpend, currency)}</span>
          <span className="report-kpi-strip__hint">Across matched customers</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Average spend</span>
          <span className="report-kpi-strip__value">{formatCurrency(summary.averageSpend, currency)}</span>
          <span className="report-kpi-strip__hint">Per customer</span>
        </div>
      </div>

      <Panel
        className="analytics-report__panel"
        title={`${sellerName || "Sales person"} customers`}
        subtitle={`${(data?.totalCount ?? 0).toLocaleString("en-US")} customers matched the current filters`}
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
        {loading ? <div className="inline-note">Loading customer attribution...</div> : null}
        {!loading && !error && (!data || data.customers.length === 0) ? (
          <EmptyState
            label={sellerName ? "No customers matched these filters" : "Select a sales person to load customers"}
            detail={sellerName ? "Try widening the date range or clearing the search." : undefined}
          />
        ) : null}
        {data && data.customers.length > 0 ? (
          <DataTable
            rows={data.customers}
            rowKey={(row) => `${row.name}-${row.phoneNumber}-${row.lastInvoiceNumber}`}
            columns={[
              { key: "name", header: "Customer", render: (row) => row.name },
              { key: "phone", header: "Phone", render: (row) => row.phoneNumber || "—" },
              { key: "member", header: "Member ID", render: (row) => row.memberId || "—" },
              {
                key: "spend",
                header: "Total Spend",
                render: (row) => <span className="sales-details-report__strong">{formatCurrency(row.totalSpend, currency)}</span>,
              },
              { key: "invoice", header: "Last Invoice", render: (row) => row.lastInvoiceNumber || "—" },
              { key: "date", header: "Last Purchase", render: (row) => row.lastPurchaseDate || "—" },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
