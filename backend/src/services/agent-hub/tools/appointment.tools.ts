import { z } from "zod";
import { getServiceBehaviorReport } from "../../reports/service-behavior.service.js";
import { isTreatmentStartUnsupportedIntent } from "../appointment-lifecycle.js";
import { fetchLiveAppointmentSnapshot, liveAppointmentEntityRef, type LiveAppointmentRow } from "../appointment-live.service.js";
import { limitRows, nowIso } from "../safety.js";
import type { AgentToolDefinition, AgentToolInput, AgentToolResult } from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);

function tableRows(rows: LiveAppointmentRow[]) {
  return rows.map((row) => ({
    appointmentId: row.appointmentId,
    customerName: row.customerName,
    customerPhoneMasked: row.customerPhoneMasked,
    serviceName: row.serviceName,
    practitionerName: row.practitionerName,
    scheduledFrom: row.scheduledFrom ?? "",
    checkInTime: row.checkInTime ?? "",
    checkOutTime: row.checkOutTime ?? "",
    rawStatus: row.rawStatus,
    lifecycleState: row.lifecycleState,
    stateConfidence: row.stateConfidence,
  }));
}

function liveTable(title: string, rows: LiveAppointmentRow[]) {
  return {
    title,
    columns: [
      { key: "customerName", title: "Customer" },
      { key: "customerPhoneMasked", title: "Phone" },
      { key: "serviceName", title: "Service" },
      { key: "practitionerName", title: "Practitioner" },
      { key: "scheduledFrom", title: "Scheduled" },
      { key: "checkInTime", title: "Check-in" },
      { key: "checkOutTime", title: "Check-out" },
      { key: "lifecycleState", title: "State" },
      { key: "stateConfidence", title: "Confidence" },
    ],
    rows: tableRows(limitRows(rows, 30)),
  };
}

async function snapshot(input: AgentToolInput) {
  return fetchLiveAppointmentSnapshot({
    clinicId: input.clinic.clinicId,
    clinicCode: input.clinic.clinicCode,
    dateKey: input.period.toDate,
    timezone: input.request.timezone ?? "",
    authorizationHeader: input.requestContext.authorizationHeader,
    rowLimit: 200,
  });
}

async function getLiveAppointmentCounts(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await snapshot(input);

  return {
    toolName: "get_live_appointment_counts",
    sourceName: "APICORE live bookings and check-ins",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: data.dataStatus,
    live: true,
    summary: `Live appointment snapshot has ${data.rows.length.toLocaleString("en-US")} rows for ${input.period.toDate}.`,
    metrics: [
      { label: "Total live rows", value: data.rows.length },
      { label: "Booked", value: data.countsByLifecycle.booked ?? 0 },
      { label: "Checked in", value: data.countsByLifecycle.arrived_start_unknown ?? 0, helperText: "Treatment start is not confirmed by current source fields." },
      { label: "Checked out", value: data.countsByLifecycle.checked_out ?? 0 },
      { label: "Cancelled", value: data.countsByLifecycle.cancelled ?? 0 },
      { label: "No-show", value: data.countsByLifecycle.no_show ?? 0 },
    ],
    tables: [liveTable("Live appointment rows", data.rows)],
    warnings: data.warnings,
    entityRefs: data.rows.map((row, index) => liveAppointmentEntityRef(row, index + 1)),
  };
}

async function listLiveAppointments(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await snapshot(input);

  if (isTreatmentStartUnsupportedIntent(input.intent)) {
    return {
      toolName: "list_live_appointments",
      sourceName: "APICORE live bookings and check-ins",
      checkedAt: data.checkedAt,
      period: input.period.toDate,
      dataStatus: "not_ready",
      live: true,
      tables: [liveTable("Checked-in customers with unknown treatment-start state", data.rows.filter((row) => row.lifecycleState === "arrived_start_unknown"))],
      warnings: [
        ...data.warnings,
        {
          type: "treatment_start_not_available",
          title: "Treatment start is not confirmed",
          message:
            "Current APICORE fields expose check-in and check-out times but no treatment_started_at event, so waiting/in-progress status cannot be confirmed.",
        },
      ],
      entityRefs: data.rows.map((row, index) => liveAppointmentEntityRef(row, index + 1)),
    };
  }

  return {
    toolName: "list_live_appointments",
    sourceName: "APICORE live bookings and check-ins",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: data.dataStatus,
    live: true,
    tables: [liveTable("Live appointment rows", data.rows)],
    warnings: data.warnings,
    entityRefs: data.rows.map((row, index) => liveAppointmentEntityRef(row, index + 1)),
  };
}

async function getCheckedInCustomers(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await snapshot(input);
  const rows = data.rows.filter((row) => row.lifecycleState === "arrived_start_unknown");

  return {
    toolName: "get_checked_in_customers",
    sourceName: "APICORE live check-ins",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: rows.length ? data.dataStatus : "no_activity",
    live: true,
    summary: `${rows.length.toLocaleString("en-US")} customer${rows.length === 1 ? "" : "s"} are checked in or arrived, with treatment-start status unknown.`,
    metrics: [{ label: "Checked in", value: rows.length, helperText: "Mapped to arrived_start_unknown." }],
    tables: [liveTable("Checked-in customers", rows)],
    warnings: [
      ...data.warnings,
      {
        type: "state_inferred",
        title: "Treatment start unknown",
        message: "`CHECKIN` confirms arrival/check-in, not whether treatment has started.",
      },
    ],
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1)),
  };
}

async function getCheckedOutCustomers(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await snapshot(input);
  const rows = data.rows.filter((row) => row.lifecycleState === "checked_out");

  return {
    toolName: "get_checked_out_customers",
    sourceName: "APICORE live check-outs",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: rows.length ? data.dataStatus : "no_activity",
    live: true,
    metrics: [{ label: "Checked out", value: rows.length }],
    tables: [liveTable("Checked-out customers", rows)],
    warnings: data.warnings,
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1)),
  };
}

async function getCancelledNoShowCustomers(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await snapshot(input);
  const rows = data.rows.filter((row) => row.lifecycleState === "cancelled" || row.lifecycleState === "no_show");

  return {
    toolName: "get_cancelled_no_show_customers",
    sourceName: "APICORE live bookings",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: rows.length ? data.dataStatus : "no_activity",
    live: true,
    metrics: [
      { label: "Cancelled", value: rows.filter((row) => row.lifecycleState === "cancelled").length },
      { label: "No-show", value: rows.filter((row) => row.lifecycleState === "no_show").length },
    ],
    tables: [liveTable("Cancelled and no-show customers", rows)],
    warnings: data.warnings,
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1)),
  };
}

async function getAppointmentDetail(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await snapshot(input);
  const appointmentId = input.entityContext?.appointmentId ?? input.entityContext?.entityId;
  const rows = appointmentId
    ? data.rows.filter((row) => row.appointmentId === appointmentId)
    : data.rows.slice(0, 1);

  return {
    toolName: "get_appointment_detail",
    sourceName: "APICORE live bookings and check-ins",
    checkedAt: data.checkedAt,
    period: input.period.toDate,
    dataStatus: rows.length ? data.dataStatus : "not_found",
    live: true,
    tables: [liveTable("Appointment detail", rows)],
    warnings: data.warnings,
    entityRefs: rows.map((row, index) => liveAppointmentEntityRef(row, index + 1)),
  };
}

async function getAppointmentTrends(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await getServiceBehaviorReport({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    granularity: "month",
  });

  return {
    toolName: "get_appointment_trends",
    sourceName: "BigQuery historical appointment/service behavior",
    checkedAt: nowIso(),
    period: `${input.period.fromDate} to ${input.period.toDate}`,
    dataStatus: data.summary.totalBookings > 0 ? "ok" : "no_activity",
    live: false,
    metrics: [
      { label: "Historical appointments", value: data.summary.totalBookings },
      { label: "Services", value: data.summary.distinctServices },
    ],
    tables: [
      {
        title: "Appointment trend",
        columns: [
          { key: "bucket", title: "Period" },
          { key: "totalBookings", title: "Bookings" },
        ],
        rows: data.trend,
      },
    ],
  };
}

export function createAppointmentTools(): AgentToolDefinition[] {
  return [
    {
      name: "get_live_appointment_counts",
      agentId: "appointment",
      description: "Get live appointment lifecycle counts.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live appointment data",
      live: true,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: getLiveAppointmentCounts,
    },
    {
      name: "list_live_appointments",
      agentId: "appointment",
      description: "List live appointment rows.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live appointment data",
      live: true,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: listLiveAppointments,
    },
    {
      name: "get_checked_in_customers",
      agentId: "appointment",
      description: "List checked-in customers.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live check-ins",
      live: true,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: getCheckedInCustomers,
    },
    {
      name: "get_checked_out_customers",
      agentId: "appointment",
      description: "List checked-out customers.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live check-outs",
      live: true,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: getCheckedOutCustomers,
    },
    {
      name: "get_cancelled_no_show_customers",
      agentId: "appointment",
      description: "List cancelled and no-show customers.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live bookings",
      live: true,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: getCancelledNoShowCustomers,
    },
    {
      name: "get_appointment_detail",
      agentId: "appointment",
      description: "Get appointment detail.",
      inputSchema: toolInputSchema,
      sourceName: "APICORE live appointment data",
      live: true,
      maxRows: 20,
      timeoutMs: 20_000,
      execute: getAppointmentDetail,
    },
    {
      name: "get_appointment_trends",
      agentId: "appointment",
      description: "Get historical appointment trends.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery historical appointment behavior",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getAppointmentTrends,
    },
  ];
}
