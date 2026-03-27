import { useEffect, useMemo, useState } from "react";
import { fetchServiceBehavior } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { startOfCurrentYear, today } from "../../../utils/date";
import type { ServiceBehaviorResponse } from "../../../types/domain";

export function ServiceBehaviorPage() {
  const { currentClinic } = useAccess();
  const [granularity, setGranularity] = useState<"month" | "quarter" | "year">("month");
  const [range, setRange] = useState({
    fromDate: startOfCurrentYear(),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ServiceBehaviorResponse | null>(null);
  const [serviceSearch, setServiceSearch] = useState("");
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

  const summary = data?.summary;
  const filteredTopServices = useMemo(() => {
    if (!data?.topServices.length) {
      return [];
    }
    const q = serviceSearch.trim().toLowerCase();
    if (!q) {
      return data.topServices;
    }
    return data.topServices.filter((row) => row.serviceName.toLowerCase().includes(q));
  }, [data?.topServices, serviceSearch]);

  return (
    <div className="page-stack behavior-report analytics-report">
      <PageHeader
        eyebrow="Analytics"
        title="Service behavior"
        description="Service demand, rankings, and practitioner mix for the current year."
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

      {error ? <ErrorState label="Service behavior could not be loaded" detail={error} /> : null}

      <div className="behavior-report__workspace">
        {data && summary && !loading ? (
          <div className="report-kpi-strip">
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Total bookings</span>
              <span className="report-kpi-strip__value">{summary.totalBookings.toLocaleString("en-US")}</span>
              <span className="report-kpi-strip__hint">Service rows in the selected period</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Distinct services</span>
              <span className="report-kpi-strip__value">{summary.distinctServices.toLocaleString("en-US")}</span>
              <span className="report-kpi-strip__hint">Active service names</span>
            </div>
            <div className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Avg bookings / service</span>
              <span className="report-kpi-strip__value">{summary.avgBookingsPerService.toLocaleString("en-US")}</span>
              <span className="report-kpi-strip__hint">Demand spread across catalog</span>
            </div>
          </div>
        ) : null}

        <Panel className="panel--tall behavior-report__panel" title="Monthly service bookings" subtitle="Total service bookings by period.">
          {loading ? (
            <div className="inline-note">Loading trend...</div>
          ) : !data || data.trend.length === 0 ? (
            <EmptyState label="No booking trend data found" />
          ) : (
            <BarChart items={data.trend.map((row) => ({ label: row.bucket, value: row.totalBookings }))} />
          )}
        </Panel>

        <Panel
          className="behavior-report__panel"
          title="Top service rankings"
          subtitle="Highest-booked services in the selected range."
          action={
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Search services…"
                value={serviceSearch}
                onChange={(event) => setServiceSearch(event.target.value)}
                autoComplete="off"
              />
            </label>
          }
        >
          {!data || data.topServices.length === 0 ? (
            <EmptyState label="No service data found" />
          ) : filteredTopServices.length === 0 ? (
            <EmptyState label="No matches" detail="Try a different search." />
          ) : (
            <DataTable
              rows={filteredTopServices}
              rowKey={(row) => row.serviceName}
              columns={[
                {
                  key: "rank",
                  header: "#",
                  render: (row) =>
                    (data.topServices.findIndex((r) => r.serviceName === row.serviceName) + 1).toLocaleString("en-US"),
                },
                { key: "service", header: "Service name", render: (row) => row.serviceName },
                { key: "bookings", header: "Bookings", render: (row) => row.bookingCount.toLocaleString("en-US") },
              ]}
            />
          )}
        </Panel>

        <Panel
          className="behavior-report__panel"
          title="Top practitioner-service combinations"
          subtitle="Practitioner and service combinations ranked by bookings."
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
    </div>
  );
}
