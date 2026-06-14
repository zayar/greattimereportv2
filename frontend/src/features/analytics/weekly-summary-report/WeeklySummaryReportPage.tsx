import { useEffect, useMemo, useState } from "react";
import { fetchWeeklySummaryReport } from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { ReportAiSections } from "../../../components/ReportAiSections";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type { WeeklySummaryReportResponse } from "../../../types/domain";
import { formatCurrency } from "../../../utils/format";
import { useAccess } from "../../access/AccessProvider";

const DEFAULT_TIMEZONE = "Asia/Yangon";

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toInputDate(date);
}

function getPreviousMonday() {
  const date = new Date();
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday - 7);
  return toInputDate(date);
}

function formatCount(value: number | null | undefined) {
  return (value ?? 0).toLocaleString("en-US");
}

function formatRate(value: number | null | undefined) {
  return value == null ? "No data" : `${value}%`;
}

function formatChange(value: number | null | undefined) {
  if (value == null) {
    return "No comparison";
  }

  return `${value > 0 ? "+" : ""}${value}%`;
}

export function WeeklySummaryReportPage() {
  const { currentClinic } = useAccess();
  const [weekStartDate, setWeekStartDate] = useState(getPreviousMonday());
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [data, setData] = useState<WeeklySummaryReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currency = currentClinic?.currency || "MMK";

  useEffect(() => {
    if (!currentClinic) {
      setData(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchWeeklySummaryReport({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      clinicName: currentClinic.name,
      weekStartDate,
      timezone,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load weekly summary report.");
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
  }, [currentClinic, timezone, weekStartDate]);

  const weekEndDate = useMemo(() => addDays(weekStartDate, 6), [weekStartDate]);

  if (!currentClinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report sales-details-report">
        <EmptyState label="No clinic selected" detail="Choose a clinic to view the weekly summary report." />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report sales-details-report">
      <PageHeader
        eyebrow="GT Growth AI"
        title="Weekly Summary Report"
        description="Weekly appointments, revenue movement, package evidence, rebooking opportunities, and premium AI actions."
      />

      <section className="sales-details-report__toolbar">
        <div className="sales-details-report__toolbar-group sales-details-report__toolbar-group--filters">
          <label className="field">
            <span>Week start</span>
            <input type="date" value={weekStartDate} onChange={(event) => setWeekStartDate(event.target.value)} />
          </label>
          <label className="field">
            <span>Week end</span>
            <input type="date" value={weekEndDate} disabled />
          </label>
          <label className="field">
            <span>Timezone</span>
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>
          <button className="button button--secondary" onClick={() => setWeekStartDate(getPreviousMonday())}>
            Previous week
          </button>
        </div>
      </section>

      {error ? <ErrorState label="Weekly summary could not be loaded" detail={error} /> : null}

      <div className="sales-details-report__summary">
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Weekly revenue</span>
          <strong>{formatCurrency(data?.paymentSummary.totalPaymentAmount ?? 0, currency)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Revenue change</span>
          <strong>{formatChange(data?.paymentSummary.weekOverWeekRevenueChangePercent)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Appointments</span>
          <strong>{formatCount(data?.appointmentSummary.totalAppointments)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Completed</span>
          <strong>{formatCount(data?.appointmentSummary.completedAppointments)}</strong>
        </div>
        <div className="sales-details-report__summary-card">
          <span className="sales-details-report__summary-label">Rebooking opportunity</span>
          <strong>
            {data?.customerRetentionOpportunityCount == null
              ? "No data"
              : formatCount(data.customerRetentionOpportunityCount)}
          </strong>
        </div>
      </div>

      {data?.gtGrowthAi || data?.premium ? (
        <ReportAiSections payload={data.gtGrowthAi ?? null} premium={data.premium ?? null} />
      ) : null}

      <Panel
        className="analytics-report__panel sales-details-report__panel"
        title="Weekly Appointment Summary"
        subtitle={`${data?.weekStartDateKey ?? weekStartDate} to ${data?.weekEndDateKey ?? weekEndDate}.`}
      >
        {loading ? <div className="inline-note inline-note--loading">Loading weekly summary...</div> : null}
        {!loading && !error ? (
          <div className="sales-details-report__summary">
            <div className="sales-details-report__summary-card">
              <span className="sales-details-report__summary-label">Cancelled</span>
              <strong>{formatCount(data?.appointmentSummary.cancelledAppointments)}</strong>
            </div>
            <div className="sales-details-report__summary-card">
              <span className="sales-details-report__summary-label">No-show</span>
              <strong>{formatCount(data?.appointmentSummary.noShowAppointments)}</strong>
            </div>
            <div className="sales-details-report__summary-card">
              <span className="sales-details-report__summary-label">Completion rate</span>
              <strong>{formatRate(data?.appointmentSummary.completionRatePercent)}</strong>
            </div>
            <div className="sales-details-report__summary-card">
              <span className="sales-details-report__summary-label">Appointment change</span>
              <strong>{formatChange(data?.weekOverWeekAppointmentChangePercent)}</strong>
            </div>
          </div>
        ) : null}
      </Panel>

      <div className="analytics-report__grid">
        <Panel className="analytics-report__panel" title="Top Services" subtitle="Top services by appointment count.">
          {data?.topServices.length ? (
            <DataTable
              rows={data.topServices}
              rowKey={(row) => row.name}
              columns={[
                { key: "service", header: "Service", render: (row) => row.name },
                { key: "count", header: "Appointments", render: (row) => formatCount(row.count) },
                { key: "share", header: "Share", render: (row) => (row.percentage == null ? "No data" : `${row.percentage}%`) },
              ]}
            />
          ) : (
            <EmptyState label="No service evidence" detail="No service activity was found for this week." />
          )}
        </Panel>

        <Panel className="analytics-report__panel" title="Top Therapists" subtitle="Appointment load by therapist.">
          {data?.therapistSummary.length ? (
            <DataTable
              rows={data.therapistSummary.slice(0, 5)}
              rowKey={(row) => row.name}
              columns={[
                { key: "therapist", header: "Therapist", render: (row) => row.name },
                { key: "count", header: "Appointments", render: (row) => formatCount(row.count) },
              ]}
            />
          ) : (
            <EmptyState label="No therapist evidence" detail="No therapist activity was found for this week." />
          )}
        </Panel>

        <Panel className="analytics-report__panel" title="Payment Methods" subtitle="Revenue by payment method.">
          {data?.paymentSummary.paymentMethods.length ? (
            <DataTable
              rows={data.paymentSummary.paymentMethods}
              rowKey={(row) => row.paymentMethod}
              columns={[
                { key: "method", header: "Method", render: (row) => row.paymentMethod },
                { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount, currency) },
                { key: "count", header: "Payments", render: (row) => formatCount(row.count) },
              ]}
            />
          ) : (
            <EmptyState label="No payment evidence" detail="No payment activity was found for this week." />
          )}
        </Panel>

        <Panel className="analytics-report__panel" title="Schedule Pattern" subtitle="Busy and weak days.">
          {data?.busyDays.length || data?.underutilizedDays.length ? (
            <DataTable
              rows={[
                ...(data?.busyDays ?? []).map((row) => ({ ...row, type: "Busy" })),
                ...(data?.underutilizedDays ?? []).map((row) => ({ ...row, type: "Weak" })),
              ]}
              rowKey={(row) => `${row.type}-${row.label}`}
              columns={[
                { key: "type", header: "Type", render: (row) => row.type },
                { key: "day", header: "Day", render: (row) => row.label },
                { key: "count", header: "Appointments", render: (row) => formatCount(row.count) },
              ]}
            />
          ) : (
            <EmptyState label="No schedule pattern" detail="No busy or weak day pattern was detected." />
          )}
        </Panel>
      </div>

      <Panel
        className="analytics-report__panel sales-details-report__panel"
        title="Package and Rebooking Evidence"
        subtitle="Deterministic evidence used by GT Growth AI when premium access is enabled."
      >
        <div className="sales-details-report__summary">
          <div className="sales-details-report__summary-card">
            <span className="sales-details-report__summary-label">Package sales</span>
            <strong>{data?.packageSalesSummary ?? "No data"}</strong>
          </div>
          <div className="sales-details-report__summary-card">
            <span className="sales-details-report__summary-label">Customers without next booking</span>
            <strong>
              {data?.customerRetentionOpportunityCount == null
                ? "No data"
                : formatCount(data.customerRetentionOpportunityCount)}
            </strong>
          </div>
          <div className="sales-details-report__summary-card">
            <span className="sales-details-report__summary-label">Previous week revenue</span>
            <strong>
              {data?.paymentSummary.previousWeekTotalPaymentAmount == null
                ? "No comparison"
                : formatCurrency(data.paymentSummary.previousWeekTotalPaymentAmount, currency)}
            </strong>
          </div>
        </div>
      </Panel>
    </div>
  );
}
