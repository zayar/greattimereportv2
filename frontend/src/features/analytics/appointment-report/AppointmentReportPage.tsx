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
  return value == null ? "No data" : `${value}%`;
}

function formatCount(value: number | null | undefined) {
  return (value ?? 0).toLocaleString("en-US");
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

  if (!currentClinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report sales-details-report">
        <EmptyState label="No clinic selected" detail="Choose a clinic to view the appointment report." />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report sales-details-report">
      <PageHeader
        eyebrow="GT Growth AI"
        title="Daily Appointment Report"
        description="Appointment flow, utilization signals, rebooking opportunities, and premium AI actions for one clinic day."
      />

      <section className="sales-details-report__toolbar">
        <div className="sales-details-report__toolbar-group sales-details-report__toolbar-group--filters">
          <label className="field">
            <span>Report date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Timezone</span>
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>
          <button className="button button--secondary" onClick={() => setDate(today())}>
            Today
          </button>
        </div>
      </section>

      {error ? <ErrorState label="Appointment report could not be loaded" detail={error} /> : null}

      <div className="sales-details-report__summary">
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Appointments</span>
          <strong>{formatCount(data?.totalAppointments)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Completed</span>
          <strong>{formatCount(data?.completedCount)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Upcoming</span>
          <strong>{formatCount(data?.upcomingCount)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Cancel / no-show</span>
          <strong>
            {formatRate(data?.cancellationRatePercent)} / {formatRate(data?.noShowRatePercent)}
          </strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Rebooking opportunity</span>
          <strong>
            {data?.completedCustomersWithoutFutureBookingCount == null
              ? "No data"
              : formatCount(data.completedCustomersWithoutFutureBookingCount)}
          </strong>
        </div>
      </div>

      {data?.gtGrowthAi || data?.premium ? (
        <ReportAiSections payload={data.gtGrowthAi ?? null} premium={data.premium ?? null} />
      ) : null}

      <Panel
        className="analytics-report__panel sales-details-report__panel"
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
              { key: "time", header: "Time", render: (row) => row.time },
              { key: "customer", header: "Customer", render: (row) => row.customerName },
              { key: "service", header: "Service", render: (row) => row.serviceName },
              { key: "therapist", header: "Therapist", render: (row) => row.therapistName },
              { key: "status", header: "Status", render: (row) => row.status },
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
                { key: "count", header: "Appointments", render: (row) => formatCount(row.count) },
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
                { key: "count", header: "Appointments", render: (row) => formatCount(row.count) },
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
                { key: "count", header: "Appointments", render: (row) => formatCount(row.count) },
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
                { key: "count", header: "Appointments", render: (row) => formatCount(row.count) },
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
