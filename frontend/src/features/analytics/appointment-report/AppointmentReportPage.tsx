import { useEffect, useMemo, useState } from "react";
import { fetchAppointmentReport } from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { ReportAiSections } from "../../../components/ReportAiSections";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type { AppointmentReportResponse } from "../../../types/domain";
import { today } from "../../../utils/date";
import { useAccess } from "../../access/AccessProvider";

const DEFAULT_TIMEZONE = "Asia/Yangon";

type AppointmentRow = AppointmentReportResponse["appointments"][number] & {
  rowId: string;
};

function formatRate(value: number | null | undefined) {
  return value == null ? "—" : `${value}%`;
}

function formatCount(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("en-US");
}

function formatCountValue(value: number | null | undefined) {
  return (value ?? 0).toLocaleString("en-US");
}

function formatCompletionRate(completed: number | null | undefined, total: number | null | undefined) {
  if (!total) {
    return "No completed-rate signal yet";
  }

  return `${Math.round(((completed ?? 0) / total) * 100)}% completion rate`;
}

function getAppointmentStatusTone(status: string) {
  const normalized = status.toLowerCase();

  if (normalized.includes("complete") || normalized.includes("done") || normalized.includes("finished")) {
    return "success";
  }

  if (normalized.includes("cancel") || normalized.includes("no-show") || normalized.includes("no show")) {
    return "danger";
  }

  if (normalized.includes("check") || normalized.includes("progress") || normalized.includes("start")) {
    return "warning";
  }

  if (normalized.includes("book") || normalized.includes("upcoming") || normalized.includes("confirm")) {
    return "info";
  }

  return "neutral";
}

export function AppointmentReportPage() {
  const { currentClinic } = useAccess();
  const [date, setDate] = useState(today());
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [data, setData] = useState<AppointmentReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      setData(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchAppointmentReport({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      clinicName: currentClinic.name,
      date,
      timezone,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load appointment report.");
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
  }, [currentClinic, date, timezone]);

  const rows = useMemo<AppointmentRow[]>(
    () =>
      (data?.appointments ?? []).map((row, index) => ({
        ...row,
        rowId: `${row.time}-${row.customerName}-${index}`,
      })),
    [data?.appointments],
  );
  const cancelledNoShowCount = data ? (data.cancelledCount ?? 0) + (data.noShowCount ?? 0) : null;

  if (!currentClinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report appointment-report">
        <EmptyState label="No clinic selected" detail="Choose a clinic to view the appointment report." />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report appointment-report">
      <PageHeader
        title="Daily appointments"
        description="Monitor today’s schedule, completion, cancellations, and rebooking opportunities."
        actions={
          <div className={`appointment-report__freshness ${loading ? "appointment-report__freshness--loading" : ""}`.trim()}>
            <span>{loading ? "Refreshing" : error ? "Issue" : "Updated"}</span>
            <strong>{data?.dateKey ?? date}</strong>
          </div>
        }
      />

      <section className="appointment-report__filters" aria-label="Appointment report filters">
        <div className="appointment-report__filter-fields">
          <label className="field">
            <span>Report date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Timezone</span>
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>
          <button type="button" className="button button--secondary" onClick={() => setDate(today())}>
            Today
          </button>
        </div>
      </section>

      {error ? <ErrorState label="Appointment report could not be loaded" detail={error} /> : null}

      <div className="appointment-report__kpis">
        <article className="appointment-kpi">
          <span>Appointments</span>
          <strong>{formatCount(data?.totalAppointments)}</strong>
          <small>{data ? `${rows.length.toLocaleString("en-US")} rows shown` : "Waiting for report data"}</small>
        </article>
        <article className="appointment-kpi appointment-kpi--success">
          <span>Completed</span>
          <strong>{formatCount(data?.completedCount)}</strong>
          <small>{formatCompletionRate(data?.completedCount, data?.totalAppointments)}</small>
        </article>
        <article className="appointment-kpi">
          <span>Upcoming</span>
          <strong>{formatCount(data?.upcomingCount)}</strong>
          <small>Appointments still ahead</small>
        </article>
        <article className="appointment-kpi appointment-kpi--danger">
          <span>Cancelled / no-show</span>
          <strong>{formatCount(cancelledNoShowCount)}</strong>
          <small>
            {formatRate(data?.cancellationRatePercent)} cancelled · {formatRate(data?.noShowRatePercent)} no-show
          </small>
        </article>
        <article className="appointment-kpi appointment-kpi--warning">
          <span>Rebooking opportunity</span>
          <strong>{formatCount(data?.completedCustomersWithoutFutureBookingCount)}</strong>
          <small>Completed customers without a future booking</small>
        </article>
      </div>

      {data?.gtGrowthAi || data?.premium ? (
        <ReportAiSections payload={data.gtGrowthAi ?? null} premium={data.premium ?? null} compact ctaHref="/ai/agent-hub" />
      ) : null}

      <Panel
        className="analytics-report__panel appointment-report__panel"
        title="Appointments"
        subtitle={`${rows.length.toLocaleString("en-US")} appointments shown for ${data?.dateKey ?? date}.`}
      >
        {loading ? <div className="inline-note inline-note--loading">Loading appointment report...</div> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No appointments found" detail="Try another date or check the selected timezone." />
        ) : null}
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.rowId}
            columns={[
              { key: "time", header: "Time", render: (row) => <strong className="appointment-table__time">{row.time}</strong> },
              {
                key: "customer",
                header: "Customer",
                render: (row) => (
                  <span className="appointment-table__primary" title={row.customerName}>
                    {row.customerName}
                  </span>
                ),
              },
              {
                key: "service",
                header: "Service",
                render: (row) => (
                  <span title={row.serviceName} className="appointment-table__service">
                    {row.serviceName}
                  </span>
                ),
              },
              {
                key: "therapist",
                header: "Therapist",
                render: (row) => (
                  <span title={row.therapistName}>
                    {row.therapistName}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (row) => (
                  <span className={`status-chip status-chip--${getAppointmentStatusTone(row.status)}`.trim()}>
                    {row.status}
                  </span>
                ),
              },
            ]}
          />
        ) : null}
      </Panel>

      <div className="analytics-report__grid">
        <Panel className="analytics-report__panel" title="Top Services" subtitle="Appointment count by service.">
          {data?.topServices.length ? (
            <DataTable
              rows={data.topServices}
              rowKey={(row) => row.serviceName}
              columns={[
                { key: "service", header: "Service", render: (row) => row.serviceName },
                { key: "count", header: "Appointments", render: (row) => formatCountValue(row.count) },
              ]}
            />
          ) : (
            <EmptyState label="No service evidence" detail="Service names were not available for this date." />
          )}
        </Panel>

        <Panel className="analytics-report__panel" title="Therapist Load" subtitle="Appointment count by therapist.">
          {data?.therapistLoad.length ? (
            <DataTable
              rows={data.therapistLoad}
              rowKey={(row) => row.therapistName}
              columns={[
                { key: "therapist", header: "Therapist", render: (row) => row.therapistName },
                { key: "count", header: "Appointments", render: (row) => formatCountValue(row.count) },
              ]}
            />
          ) : (
            <EmptyState label="No therapist evidence" detail="Therapist names were not available for this date." />
          )}
        </Panel>

        <Panel className="analytics-report__panel" title="Busy Hours" subtitle="Highest appointment concentration.">
          {data?.busyHours.length ? (
            <DataTable
              rows={data.busyHours}
              rowKey={(row) => row.label}
              columns={[
                { key: "hour", header: "Hour", render: (row) => row.label },
                { key: "count", header: "Appointments", render: (row) => formatCountValue(row.count) },
              ]}
            />
          ) : (
            <EmptyState label="No busy-hour evidence" detail="Appointment time data was not available." />
          )}
        </Panel>

        <Panel className="analytics-report__panel" title="Underutilized Hours" subtitle="Weakest appointment slots.">
          {data?.underutilizedHours.length ? (
            <DataTable
              rows={data.underutilizedHours}
              rowKey={(row) => row.label}
              columns={[
                { key: "hour", header: "Hour", render: (row) => row.label },
                { key: "count", header: "Appointments", render: (row) => formatCountValue(row.count) },
              ]}
            />
          ) : (
            <EmptyState label="No weak-hour evidence" detail="No underutilized slots were detected." />
          )}
        </Panel>
      </div>
    </div>
  );
}
