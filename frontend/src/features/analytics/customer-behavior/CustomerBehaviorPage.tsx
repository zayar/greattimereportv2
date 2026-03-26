import { useEffect, useState } from "react";
import { fetchCustomerBehavior } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { daysAgo, today } from "../../../utils/date";
import type { CustomerBehaviorResponse } from "../../../types/domain";

export function CustomerBehaviorPage() {
  const { currentClinic } = useAccess();
  const [granularity, setGranularity] = useState<"month" | "quarter" | "year">("month");
  const [range, setRange] = useState({
    fromDate: daysAgo(180),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CustomerBehaviorResponse | null>(null);

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

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Customer behavior"
        description="BigQuery-backed customer trend reporting rebuilt behind secure backend endpoints."
        actions={
          <div className="filter-row">
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

      <div className="panel-grid panel-grid--split">
        <Panel title="Trend" subtitle="Unique customers and visit volume across the selected period">
          {loading ? (
            <div className="inline-note">Loading trend...</div>
          ) : !data || data.trend.length === 0 ? (
            <EmptyState label="No customer trend data found" />
          ) : (
            <BarChart items={data.trend.map((row) => ({ label: row.bucket, value: row.uniqueCustomers, meta: `${row.visits} visits` }))} />
          )}
        </Panel>

        <Panel title="Top customers" subtitle="Most active customers in the selected period">
          {!data || data.topCustomers.length === 0 ? (
            <EmptyState label="No customer activity found" />
          ) : (
            <DataTable
              rows={data.topCustomers}
              rowKey={(row) => row.customerName}
              columns={[
                { key: "customer", header: "Customer", render: (row) => row.customerName },
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

