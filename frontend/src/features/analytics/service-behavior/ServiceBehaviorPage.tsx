import { useEffect, useMemo, useState } from "react";
import { fetchServiceBehavior } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
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
  const [mixSearch, setMixSearch] = useState("");

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

  const filteredPractitionerRows = useMemo(() => {
    if (!data?.practitionerServices.length) {
      return [];
    }
    const q = mixSearch.trim().toLowerCase();
    if (!q) {
      return data.practitionerServices;
    }
    return data.practitionerServices.filter(
      (row) =>
        row.practitionerName.toLowerCase().includes(q) ||
        row.serviceName.toLowerCase().includes(q),
    );
  }, [data?.practitionerServices, mixSearch]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Service behavior"
        description="Aligned with GT_NewReport’s service and practitioner breakdowns: bookings from MainDataView, aggregated by time bucket and ranked lists — all via server-side SQL."
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

      {data && !loading ? (
        <div className="report-kpi-strip">
          <div className="report-kpi-strip__card">
            <span className="report-kpi-strip__label">Total bookings</span>
            <span className="report-kpi-strip__value">{data.summary.totalBookings.toLocaleString("en-US")}</span>
            <span className="report-kpi-strip__hint">Service rows in the selected period</span>
          </div>
          <div className="report-kpi-strip__card">
            <span className="report-kpi-strip__label">Distinct services</span>
            <span className="report-kpi-strip__value">{data.summary.distinctServices.toLocaleString("en-US")}</span>
            <span className="report-kpi-strip__hint">Active service names</span>
          </div>
          <div className="report-kpi-strip__card">
            <span className="report-kpi-strip__label">Avg bookings / service</span>
            <span className="report-kpi-strip__value">{data.summary.avgBookingsPerService.toLocaleString("en-US")}</span>
            <span className="report-kpi-strip__hint">Demand spread across catalog</span>
          </div>
        </div>
      ) : null}

      <div className="panel-grid panel-grid--split">
        <Panel className="panel--tall" title="Booking trend" subtitle="Total service bookings per time bucket.">
          {loading ? (
            <div className="inline-note">Loading trend...</div>
          ) : !data || data.trend.length === 0 ? (
            <EmptyState label="No booking trend data found" />
          ) : (
            <BarChart items={data.trend.map((row) => ({ label: row.bucket, value: row.totalBookings }))} />
          )}
        </Panel>

        <Panel className="panel--tall" title="Top services" subtitle="Most-booked services — bar length vs #1 in range.">
          {!data || data.topServices.length === 0 ? (
            <EmptyState label="No service data found" />
          ) : (
            <HorizontalBarList
              items={data.topServices.map((row) => ({
                label: row.serviceName,
                value: row.bookingCount,
              }))}
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Practitioner mix"
        subtitle="Which practitioners are driving which services (top combinations)."
        action={
          <label className="field field--compact field--search">
            <span>Filter</span>
            <input
              type="search"
              placeholder="Practitioner or service…"
              value={mixSearch}
              onChange={(event) => setMixSearch(event.target.value)}
              autoComplete="off"
            />
          </label>
        }
      >
        {!data || data.practitionerServices.length === 0 ? (
          <EmptyState label="No practitioner-service rows found" />
        ) : filteredPractitionerRows.length === 0 ? (
          <EmptyState label="No matches" detail="Try a different filter." />
        ) : (
          <DataTable
            rows={filteredPractitionerRows}
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
