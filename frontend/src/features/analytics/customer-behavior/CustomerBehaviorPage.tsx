import { useEffect, useMemo, useState } from "react";
import { fetchCustomerBehavior } from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DualMetricBarChart } from "../../../components/DualMetricBarChart";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { startOfCurrentYear, today } from "../../../utils/date";
import type { CustomerBehaviorResponse } from "../../../types/domain";

export function CustomerBehaviorPage() {
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

  const filteredTopCustomers = useMemo(() => {
    if (!data?.topCustomers.length) {
      return [];
    }
    const q = customerSearch.trim().toLowerCase();
    if (!q) {
      return data.topCustomers;
    }
    return data.topCustomers.filter((row) => row.customerName.toLowerCase().includes(q));
  }, [data?.topCustomers, customerSearch]);

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
            <div className="inline-note">Loading trend...</div>
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
          title="Top active members"
          subtitle="Highest-activity members in the selected range."
          action={
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Search name…"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                autoComplete="off"
              />
            </label>
          }
        >
          {!data || data.topCustomers.length === 0 ? (
            <EmptyState label="No customer activity found" />
          ) : filteredTopCustomers.length === 0 ? (
            <EmptyState label="No matches" detail="Try a different search." />
          ) : (
            <DataTable
              rows={filteredTopCustomers}
              rowKey={(row) => row.customerName}
              columns={[
                {
                  key: "rank",
                  header: "#",
                  render: (row) =>
                    (data.topCustomers.findIndex((r) => r.customerName === row.customerName) + 1).toLocaleString("en-US"),
                },
                { key: "customer", header: "Member name", render: (row) => row.customerName },
                { key: "visits", header: "Visits", render: (row) => row.visitCount.toLocaleString("en-US") },
                { key: "lastVisit", header: "Last visit", render: (row) => row.lastVisitDate },
              ]}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
