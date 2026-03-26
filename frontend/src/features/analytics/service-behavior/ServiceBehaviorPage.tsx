import { useEffect, useState } from "react";
import { fetchServiceBehavior } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { daysAgo, today } from "../../../utils/date";
import type { ServiceBehaviorResponse } from "../../../types/domain";

export function ServiceBehaviorPage() {
  const { currentClinic } = useAccess();
  const [granularity, setGranularity] = useState<"month" | "quarter" | "year">("month");
  const [range, setRange] = useState({
    fromDate: daysAgo(180),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ServiceBehaviorResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchServiceBehavior({
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
          setError(loadError instanceof Error ? loadError.message : "Failed to load service behavior.");
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
        title="Service behavior"
        description="Service demand and practitioner-service patterns drawn from BigQuery without exposing raw query execution to the browser."
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

      {error ? <ErrorState label="Service behavior could not be loaded" detail={error} /> : null}

      <div className="panel-grid panel-grid--split">
        <Panel title="Booking trend" subtitle="Total service bookings over time">
          {loading ? (
            <div className="inline-note">Loading trend...</div>
          ) : !data || data.trend.length === 0 ? (
            <EmptyState label="No booking trend data found" />
          ) : (
            <BarChart items={data.trend.map((row) => ({ label: row.bucket, value: row.totalBookings }))} />
          )}
        </Panel>

        <Panel title="Top services" subtitle="Most-booked services in the selected period">
          {!data || data.topServices.length === 0 ? (
            <EmptyState label="No service data found" />
          ) : (
            <DataTable
              rows={data.topServices}
              rowKey={(row) => row.serviceName}
              columns={[
                { key: "service", header: "Service", render: (row) => row.serviceName },
                { key: "bookings", header: "Bookings", render: (row) => row.bookingCount.toLocaleString("en-US") },
              ]}
            />
          )}
        </Panel>
      </div>

      <Panel title="Practitioner mix" subtitle="Which practitioners are driving which services">
        {!data || data.practitionerServices.length === 0 ? (
          <EmptyState label="No practitioner-service rows found" />
        ) : (
          <DataTable
            rows={data.practitionerServices}
            rowKey={(row) => `${row.practitionerName}-${row.serviceName}`}
            columns={[
              { key: "practitioner", header: "Practitioner", render: (row) => row.practitionerName },
              { key: "service", header: "Service", render: (row) => row.serviceName },
              { key: "bookings", header: "Bookings", render: (row) => row.bookingCount.toLocaleString("en-US") },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

