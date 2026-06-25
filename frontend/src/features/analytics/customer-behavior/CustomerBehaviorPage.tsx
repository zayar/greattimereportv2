import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCustomerBehavior, fetchCustomerBehaviorCustomerSearch } from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DualMetricBarChart } from "../../../components/DualMetricBarChart";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { startOfCurrentYear, today } from "../../../utils/date";
import type { CustomerBehaviorCustomerRow, CustomerBehaviorResponse } from "../../../types/domain";
import { buildCustomerPortalDetailPath } from "../customer-portal/customerPortalLink";

const CUSTOMER_SEARCH_LIMIT = 25;

type CustomerTableRow = CustomerBehaviorCustomerRow & {
  rank: number;
};

function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function isRunnableCustomerSearch(value: string) {
  const trimmed = value.trim();
  const digits = normalizePhoneDigits(trimmed);
  return trimmed.length >= 2 || digits.length >= 3;
}

export function CustomerBehaviorPage() {
  const navigate = useNavigate();
  const { currentClinic } = useAccess();
  const [granularity, setGranularity] = useState<"month" | "quarter" | "year">("month");
  const [range, setRange] = useState({
    fromDate: startOfCurrentYear(),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CustomerBehaviorResponse | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSearchRows, setCustomerSearchRows] = useState<CustomerBehaviorCustomerRow[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const trimmedCustomerSearch = customerSearch.trim();
  const deferredCustomerSearch = useDeferredValue(trimmedCustomerSearch);
  const isCustomerSearchActive = trimmedCustomerSearch.length > 0;
  const canRunCustomerSearch = isRunnableCustomerSearch(deferredCustomerSearch);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchCustomerBehavior({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      granularity,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load customer behavior.");
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
  }, [currentClinic, granularity, range.fromDate, range.toDate]);

  useEffect(() => {
    if (!currentClinic || !deferredCustomerSearch || !canRunCustomerSearch) {
      setCustomerSearchRows([]);
      setCustomerSearchLoading(false);
      setCustomerSearchError(null);
      return;
    }

    let active = true;
    setCustomerSearchLoading(true);
    setCustomerSearchError(null);

    fetchCustomerBehaviorCustomerSearch({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      search: deferredCustomerSearch,
      limit: CUSTOMER_SEARCH_LIMIT,
    })
      .then((result) => {
        if (active) {
          setCustomerSearchRows(result.rows);
        }
      })
      .catch((loadError) => {
        if (active) {
          setCustomerSearchError(loadError instanceof Error ? loadError.message : "Customer search failed.");
          setCustomerSearchRows([]);
        }
      })
      .finally(() => {
        if (active) {
          setCustomerSearchLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [canRunCustomerSearch, currentClinic, deferredCustomerSearch]);

  const customerTableRows = useMemo<CustomerTableRow[]>(() => {
    const rows = isCustomerSearchActive ? customerSearchRows : data?.topCustomers ?? [];
    return rows.map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
  }, [customerSearchRows, data?.topCustomers, isCustomerSearchActive]);

  const openCustomerDetail = (row: CustomerBehaviorCustomerRow) => {
    navigate(
      buildCustomerPortalDetailPath({
        customerName: row.customerName,
        customerPhone: row.phoneNumber,
        fromDate: range.fromDate,
        toDate: range.toDate,
      }),
    );
  };

  const renderCustomerTable = () => (
    <DataTable
      rows={customerTableRows}
      rowKey={(row) => `${row.customerName}-${row.phoneNumber || row.memberId || row.rank}`}
      columns={[
        {
          key: "rank",
          header: "#",
          render: (row) => row.rank.toLocaleString("en-US"),
        },
        {
          key: "customer",
          header: "Customer",
          render: (row) => (
            <div className="behavior-report__customer-cell">
              <button
                type="button"
                className="entity-link-button entity-link-button--strong"
                onClick={() => openCustomerDetail(row)}
              >
                {row.customerName}
              </button>
              <small>{row.memberId ? `Member ${row.memberId}` : "Member ID unavailable"}</small>
            </div>
          ),
        },
        {
          key: "phone",
          header: "Phone",
          render: (row) => row.phoneNumber || row.phoneMasked || "—",
        },
        { key: "visits", header: "Visits", render: (row) => row.visitCount.toLocaleString("en-US") },
        {
          key: "lastActivity",
          header: isCustomerSearchActive ? "Last activity" : "Last visit",
          render: (row) => row.lastActivityDate ?? row.lastVisitDate ?? "—",
        },
      ]}
    />
  );

  const renderCustomerPanelContent = () => {
    if (isCustomerSearchActive && !canRunCustomerSearch) {
      return <EmptyState label="Keep typing" detail="Enter at least 2 letters or 3 phone digits." />;
    }

    if (isCustomerSearchActive && customerSearchLoading) {
      return <div className="inline-note inline-note--loading">Searching customers...</div>;
    }

    if (isCustomerSearchActive && customerSearchError) {
      return <ErrorState label="Customer search could not be loaded" detail={customerSearchError} />;
    }

    if (!isCustomerSearchActive && loading) {
      return <div className="inline-note inline-note--loading">Loading active members...</div>;
    }

    if (!isCustomerSearchActive && (!data || data.topCustomers.length === 0)) {
      return <EmptyState label="No customer activity found" />;
    }

    if (customerTableRows.length === 0) {
      return (
        <EmptyState
          label={isCustomerSearchActive ? "No customer matches" : "No matches"}
          detail={isCustomerSearchActive ? "Try another customer name or phone number." : "Try a different search."}
        />
      );
    }

    return renderCustomerTable();
  };

  const summary = data?.summary;

  return (
    <div className="page-stack page-stack--workspace behavior-report analytics-report">
      <PageHeader
        eyebrow="Analytics"
        title="Customer behavior"
        description="Customer activity, visit frequency, and top active members for the current year."
        actions={
          <div className="filter-row behavior-report__filters">
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
            <label className="field field--compact">
              <span>Group by</span>
              <select value={granularity} onChange={(event) => setGranularity(event.target.value as "month" | "quarter" | "year")}>
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="year">Year</option>
              </select>
            </label>
          </div>
        }
      />

      {error ? <ErrorState label="Customer behavior could not be loaded" detail={error} /> : null}

      <div className="behavior-report__workspace">
        {data && summary && !loading ? (
          <div className="report-kpi-strip">
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Unique customers</span>
              <span className="report-kpi-strip__value">{summary.uniqueCustomers.toLocaleString("en-US")}</span>
              <span className="report-kpi-strip__hint">Distinct members with check-ins in range</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Total visits</span>
              <span className="report-kpi-strip__value">{summary.visits.toLocaleString("en-US")}</span>
              <span className="report-kpi-strip__hint">All visits across the selected period</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Avg visits / customer</span>
              <span className="report-kpi-strip__value">{summary.avgVisitsPerCustomer.toLocaleString("en-US")}</span>
              <span className="report-kpi-strip__hint">Activity intensity per customer</span>
            </div>
          </div>
        ) : null}

        <Panel
          className="panel--tall behavior-report__panel"
          title="Monthly customer count"
          subtitle="Unique customers and total visits by period."
        >
          {loading ? (
            <div className="inline-note inline-note--loading">Loading trend...</div>
          ) : !data || data.trend.length === 0 ? (
            <EmptyState label="No customer trend data found" />
          ) : (
            <DualMetricBarChart
              items={data.trend.map((row) => ({
                label: row.bucket,
                primary: row.uniqueCustomers,
                secondary: row.visits,
              }))}
              primaryLabel="Unique customers"
              secondaryLabel="Visits"
            />
          )}
        </Panel>

        <Panel
          className="behavior-report__panel"
          title={isCustomerSearchActive ? "Customer search results" : "Top active members"}
          subtitle={
            isCustomerSearchActive
              ? "Matching customers from the selected merchant."
              : "Highest-activity members in the selected range."
          }
          action={
            <label className="field field--compact field--search">
              <span>Customer search</span>
              <input
                type="search"
                placeholder="Search name or phone..."
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                autoComplete="off"
              />
            </label>
          }
        >
          {renderCustomerPanelContent()}
        </Panel>
      </div>
    </div>
  );
}
